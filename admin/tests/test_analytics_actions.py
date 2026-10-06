"""Monthly purchases + top items add up; admin actions keep a family safe and are logged."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlmodel import Session, select

from app.core.models import Member, MemberRole
from app.core.sqltypes import utcnow
from app.feed.models import Post, PostRecipient, PostStatus, Reminder
from app.history.models import Purchase, PurchaseSource
from app.tasks.models import Task, TaskEvent
from hearth_admin import actions, analytics
from hearth_admin.models import AdminAction, AdminHouseholdStatus, HouseholdStatus

NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)


def _buy(s: Session, i: int, pid: str, when: datetime, price: float | None, qty=1.0, unit="kg",
         hid="h_home"):
    s.add(Purchase(id=f"t{i}", household_id=hid, product_id=pid, product=pid, qty=qty, unit=unit,
                   price=price, purchased_at=when, source=PurchaseSource.MANUAL))


def test_last_months_crosses_year():
    assert analytics.last_months(datetime(2026, 2, 3, tzinfo=UTC), 4) == [
        "2025-11", "2025-12", "2026-01", "2026-02"]
    assert analytics.next_month("2025-12") == "2026-01"


def test_monthly_spend_only_counts_priced_lines(engine):
    with Session(engine) as s:
        for p in s.exec(select(Purchase)).all():
            s.delete(p)
        _buy(s, 1, "p_rice", datetime(2026, 10, 2, tzinfo=UTC), 350)
        _buy(s, 2, "p_milk", datetime(2026, 10, 3, tzinfo=UTC), None)
        _buy(s, 3, "p_milk", datetime(2026, 9, 30, 23, tzinfo=UTC), 56)
        s.commit()
        rows = {r["month"]: r for r in analytics.monthly_purchases(s, NOW, 3)}
    assert list(rows) == ["2026-08", "2026-09", "2026-10"]
    assert rows["2026-10"] == {"month": "2026-10", "purchases": 2, "priced": 1, "spend": 350.0,
                               "households": 1}
    assert rows["2026-09"]["spend"] == 56.0
    assert rows["2026-08"]["purchases"] == 0


def test_top_items_ranks_by_frequency_and_refuses_to_sum_mixed_units(engine):
    with Session(engine) as s:
        for p in s.exec(select(Purchase)).all():
            s.delete(p)
        for i in range(3):
            _buy(s, i, "p_milk", datetime(2026, 10, 1 + i, tzinfo=UTC), 56, qty=1, unit="L")
        _buy(s, 10, "p_curd", datetime(2026, 10, 1, tzinfo=UTC), 30, qty=400, unit="g")
        _buy(s, 11, "p_curd", datetime(2026, 10, 2, tzinfo=UTC), None, qty=1, unit="kg")
        _buy(s, 12, "p_rice", datetime(2026, 1, 1, tzinfo=UTC), 300)  # outside 90 days
        s.commit()
        top = analytics.top_items(s, NOW, 90)
    assert [t["product_id"] for t in top] == ["p_milk", "p_curd"]
    assert top[0]["qty"] == 3 and top[0]["unit"] == "L" and top[0]["spend"] == 168
    assert top[1]["qty"] is None and top[1]["unit"] == "mixed" and top[1]["priced"] == 1


def test_household_status_needs_a_reason_and_is_logged(engine):
    with Session(engine) as s:
        with pytest.raises(actions.Refused):
            actions.set_household_status(s, "a", "h_home", "suspended", " ", NOW)
        actions.set_household_status(s, "a", "h_home", "suspended", "chargeback", NOW)
        s.commit()
        assert s.get(AdminHouseholdStatus, "h_home").status == HouseholdStatus.SUSPENDED
        log = s.exec(select(AdminAction)).one()
    assert log.detail_json == {"before": "active", "after": "suspended"}


def test_cannot_remove_or_demote_the_only_owner(engine):
    with Session(engine) as s:
        with pytest.raises(actions.Refused):
            actions.set_member_active(s, "a", "m_mom", False, "left", NOW)
        with pytest.raises(actions.Refused):
            actions.set_member_role(s, "a", "m_mom", "member", None, NOW)
        actions.set_member_role(s, "a", "m_dad", "owner", None, NOW)
        actions.set_member_role(s, "a", "m_mom", "member", None, NOW)
        s.commit()
        assert s.get(Member, "m_mom").role == MemberRole.MEMBER


def test_task_status_keeps_done_at_consistent_and_logs_event(engine):
    with Session(engine) as s:
        s.add(Task(id="t1", household_id="h_home", created_by_member_id="m_mom",
                   assigned_to_member_id="m_dad", category="plumbing", title="Tap"))
        s.commit()
        actions.set_task_status(s, "a", "t1", "done", "fixed by plumber", NOW)
        assert s.get(Task, "t1").done_at is not None
        actions.set_task_status(s, "a", "t1", "open", "not actually fixed", NOW)
        s.commit()
        assert s.get(Task, "t1").done_at is None
        events = s.exec(select(TaskEvent).where(TaskEvent.task_id == "t1")).all()
    assert [e.to_status.value for e in events] == ["done", "open"]
    assert events[0].note.startswith("[admin a]")


def test_reassign_only_within_the_home_to_active_members(demo):
    with Session(demo) as s:
        with pytest.raises(actions.Refused):
            actions.assign_task(s, "a", "demo_task_6", "m_dad", None, NOW)  # other home
        with pytest.raises(actions.Refused):
            actions.assign_task(s, "a", "demo_task_6", "m_s_old", None, NOW)  # removed
        actions.assign_task(s, "a", "demo_task_6", "m_s_appa", None, NOW)
        s.commit()
        assert s.get(Task, "demo_task_6").assigned_to_member_id == "m_s_appa"


def test_resend_adds_missing_and_resets_unacknowledged(demo):
    with Session(demo) as s:
        out = actions.resend_post(s, "a", "demo_post_ok", None, utcnow())
        s.commit()
        recs = s.exec(select(PostRecipient).where(PostRecipient.post_id == "demo_post_ok")).all()
    assert out == {"added": [], "reset": ["m_dad", "m_me"]}
    assert all(r.delivered_at is None for r in recs)


def test_cancel_post_needs_reason_and_stops_reminders(demo):
    with Session(demo) as s:
        s.add(Reminder(id="r_live", post_id="demo_post_ok", member_id="m_dad",
                       interval_minutes=30, next_fire_at=utcnow()))
        s.commit()
        with pytest.raises(actions.Refused):
            actions.cancel_post(s, "a", "demo_post_ok", None, utcnow())
        actions.cancel_post(s, "a", "demo_post_ok", "duplicate", utcnow())
        s.commit()
        assert s.get(Post, "demo_post_ok").status == PostStatus.CANCELLED
        assert s.get(Reminder, "r_live").active is False
