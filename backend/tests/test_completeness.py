"""A post is only sent when complete — for every kind, whoever wrote it."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlmodel import Session, select

from app.db import get_engine
from app.feed.completeness import Requirement, missing_fields
from app.feed.models import Post, PostRecipient, PostStatus
from app.feed.store import PostIncomplete, check, publish, requirements_for
from app.seed import main

NOW = datetime(2026, 9, 27, 9, 0, tzinfo=UTC)

COMPLETE = {
    "grocery": {
        "needed_by": "2026-09-28",
        "items": [
            {"item": "Tomatoes", "qty": 1, "unit": "kg", "expected_rate": 40},
            {"item": "Coriander seeds", "qty": 100, "unit": "g", "expected_rate": 30,
             "needed_by": "2026-09-30"},
        ],
    },
    "task": {"what": "Fix kitchen tap leak", "assigned_to": "m_dad", "needed_by": "2026-09-29"},
    "ticket_booking": {"from": "Hyderabad", "to": "Chennai", "travel_date": "2026-10-10",
                       "passengers": ["Mom", "Dad"], "assigned_to": "m_me"},
    "bill": {"bill_type": "Electricity", "amount": 1450, "due_date": "2026-10-05",
             "assigned_to": "m_dad"},
    "alert": {"message": "Call the plumber", "recipients": ["m_dad"], "repeat": True,
              "interval_minutes": 240},
}

REQUIRED = {
    "grocery": ["item", "qty", "unit", "expected_rate", "needed_by"],
    "task": ["what", "assigned_to", "needed_by"],
    "ticket_booking": ["from", "to", "travel_date", "passengers", "assigned_to"],
    "bill": ["bill_type", "amount", "due_date", "assigned_to"],
    "alert": ["message", "recipients", "repeat", "interval_minutes"],
}


@pytest.fixture()
def session():
    eng = get_engine("sqlite://")
    main(eng)
    with Session(eng) as s:
        yield s


def _post(session: Session, kind: str, fields: dict, author: str = "m_mom", pid: str = "p1") -> Post:
    p = Post(id=pid, household_id="h_home", author_member_id=author, kind=kind,
             raw_text="…", fields_json=fields)
    session.add(p)
    session.flush()
    return p


@pytest.mark.parametrize("kind", sorted(COMPLETE))
def test_complete_payload_has_nothing_missing(session, kind):
    assert missing_fields(COMPLETE[kind], requirements_for(session, kind)) == []


@pytest.mark.parametrize(("kind", "field"), [(k, f) for k, fs in REQUIRED.items() for f in fs])
def test_each_required_field_is_reported(session, kind, field):
    fields = {k: v for k, v in COMPLETE[kind].items() if k != field}
    if kind == "grocery":
        fields["items"] = [{k: v for k, v in i.items() if k != field} for i in fields["items"]]
    missing = missing_fields(fields, requirements_for(session, kind))
    assert field in {m.field for m in missing}


def test_grocery_item_question_names_the_item(session):
    fields = {"needed_by": "tomorrow", "items": [{"item": "Tomatoes", "qty": 1, "unit": "kg"}]}
    [m] = missing_fields(fields, requirements_for(session, "grocery"))
    assert (m.field, m.item_index) == ("expected_rate", 0)
    assert "Tomatoes" in m.question


def test_post_level_needed_by_covers_items_but_item_level_alone_does_too(session):
    reqs = requirements_for(session, "grocery")
    item = {"item": "Rice", "qty": 5, "unit": "kg", "expected_rate": 60}
    assert [m.field for m in missing_fields({"items": [item]}, reqs)] == ["needed_by"]
    assert missing_fields({"items": [{**item, "needed_by": "today"}]}, reqs) == []


def test_empty_grocery_post_asks_what_is_needed(session):
    first = next(iter(missing_fields({}, requirements_for(session, "grocery"))))
    assert first.field == "items"


def test_alert_interval_only_required_when_repeating(session):
    reqs = requirements_for(session, "alert")
    once = {"message": "Dinner at 8", "recipients": ["m_dad"], "repeat": False}
    assert missing_fields(once, reqs) == []


def test_blank_strings_count_as_missing():
    reqs = [Requirement(field="what", question="What?")]
    assert missing_fields({"what": "   "}, reqs)


@pytest.mark.parametrize("author", ["m_mom", "m_dad", "m_me"])
def test_incomplete_post_is_never_published_whoever_wrote_it(session, author):
    p = _post(session, "task", {"what": "Plumbing work"}, author=author)
    with pytest.raises(PostIncomplete) as err:
        publish(session, p, ["m_mom", "m_dad", "m_me"], NOW)
    assert {m.field for m in err.value.missing} == {"assigned_to", "needed_by"}
    assert p.status == PostStatus.CLARIFYING
    assert p.published_at is None
    assert session.exec(select(PostRecipient)).all() == []


def test_complete_post_publishes_to_everyone_but_the_author(session):
    p = _post(session, "task", dict(COMPLETE["task"]))
    assert check(session, p, NOW) == []
    assert p.status == PostStatus.READY
    publish(session, p, ["m_mom", "m_dad", "m_me", "m_dad"], NOW)
    assert p.status == PostStatus.PUBLISHED
    assert p.published_at == NOW
    session.flush()
    assert {r.member_id for r in session.exec(select(PostRecipient))} == {"m_dad", "m_me"}


def test_published_post_cannot_be_published_again(session):
    p = _post(session, "bill", dict(COMPLETE["bill"]))
    publish(session, p, ["m_dad"], NOW)
    with pytest.raises(ValueError):
        publish(session, p, ["m_dad"], NOW)
