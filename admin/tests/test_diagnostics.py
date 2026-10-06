"""Every planted broken state is found, every fix repairs it, and nothing healthy is flagged."""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.auth.models import AuthSession
from app.bills.models import BillPayment, BillStatus
from app.core.sqltypes import utcnow
from app.feed.models import Post, PostRecipient, PostStatus
from app.planner.models import GroceryListItem
from app.tasks.models import Task
from hearth_admin import actions, diagnostics
from hearth_admin.models import AdminAction

PLANTED = {
    "household_no_owner": "h_new",
    "list_item_unknown_category": "demo_item_1",
    "post_missing_recipients": "demo_post_skip",
    "session_on_removed_member": "m_s_old",
    "task_assignee_invalid": "demo_task_6",
    "bill_past_due": "demo_bill_1",
    "list_item_orphan_question": "demo_item_2",
    "post_stuck_open": "demo_post_stuck",
    "recipient_undelivered": "demo_post_skip:m_me",
    "reminder_on_closed_post": "demo_rem_1",
    "task_done_at_on_open": "demo_task_5",
    "task_done_without_done_at": "demo_task_3",
    "clarification_stale": "demo_q_old",
    "reminder_maxed": "demo_rem_maxed",
    "reminder_late": "demo_rem_late",
}


def test_fresh_seed_has_no_issues(engine):
    with Session(engine) as s:
        assert diagnostics.scan(s, utcnow()) == []


def test_every_planted_issue_is_found_once(demo):
    with Session(demo) as s:
        found = {(i.check, i.ref) for i in diagnostics.scan(s, utcnow())}
    assert found == set(PLANTED.items())


def test_scan_filters_by_household(demo):
    with Session(demo) as s:
        issues = diagnostics.scan(s, utcnow(), "h_new")
    assert [i.check for i in issues] == ["household_no_owner"]


def test_issues_sorted_high_first(demo):
    with Session(demo) as s:
        sev = [i.severity for i in diagnostics.scan(s, utcnow())]
    assert sev == sorted(sev, key={"high": 0, "medium": 1, "low": 2}.get)


@pytest.mark.parametrize("check", [c.name for c in diagnostics.CHECKS if c.fix])
def test_each_fix_clears_its_issue_and_is_audited(demo, check):
    ref = PLANTED[check]
    with Session(demo) as s:
        actions.apply_fix(s, "tester", check, ref, utcnow())
        s.commit()
        left = [i for i in diagnostics.BY_NAME[check].detect(s, utcnow()) if i.ref == ref]
        log = s.exec(select(AdminAction).where(AdminAction.action == f"fix:{check}")).all()
    assert left == []
    assert len(log) == 1 and log[0].admin == "tester" and log[0].target_id == ref


def test_fix_refuses_rows_that_are_not_broken(demo):
    with Session(demo) as s:
        with pytest.raises(actions.Refused):
            actions.apply_fix(s, "t", "task_done_without_done_at", "demo_task_0", utcnow())
        with pytest.raises(actions.Refused):
            actions.apply_fix(s, "t", "household_no_owner", "h_new", utcnow())  # needs a choice


def test_specific_fix_results(demo):
    now = utcnow()
    with Session(demo) as s:
        for check, ref in PLANTED.items():
            if diagnostics.BY_NAME[check].fix:
                actions.apply_fix(s, "t", check, ref, now)
        s.commit()
        assert s.get(GroceryListItem, "demo_item_1").category == "Vegetables"  # spinach, from catalog
        assert s.get(GroceryListItem, "demo_item_2").needs_clarification is False
        assert {r.member_id for r in s.exec(select(PostRecipient).where(
            PostRecipient.post_id == "demo_post_skip")).all()} == {"m_dad", "m_me"}
        assert s.get(Task, "demo_task_3").done_at is not None
        assert s.get(Task, "demo_task_5").done_at is None
        assert s.get(BillPayment, "demo_bill_1").status == BillStatus.OVERDUE
        assert s.get(AuthSession, "demo_sess_old").revoked_at is not None
        # Re-check never publishes for the author — still missing fields → still clarifying.
        assert s.get(Post, "demo_post_stuck").status == PostStatus.CLARIFYING
