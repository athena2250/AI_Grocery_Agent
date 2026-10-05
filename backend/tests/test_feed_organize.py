"""Multi-item feed: extraction → drafts → dedupe → rate → question → confirmation.

Everything after the LLM is deterministic, so these run without a model. TODAY is a
Monday, which is what makes "next Friday" ambiguous.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlmodel import Session

from app.db import get_engine
from app.feed.categorize import categorize
from app.feed.completeness import missing_fields
from app.feed.confirm import confirmation
from app.feed.dates import resolve_date, resolve_time
from app.feed.dedupe import OpenEntry, find_duplicates, similar
from app.feed.drafts import drafts_from_extraction
from app.feed.expected_rate import (
    RateObservation,
    estimate_rate,
    fill_expected_rates,
    observations_for,
)
from app.feed.models import Priority
from app.feed.people import MemberRef, resolve_member
from app.feed.questions import next_question
from app.feed.store import requirements_for
from app.history.models import Purchase, PurchaseSource
from app.seed import main
from app.understanding import UnderstandingClient
from app.understanding.prompts import MULTI_FEW_SHOTS, MULTI_SYSTEM_PROMPT, build_multi_messages
from app.understanding.schema import ExtractedAction, LLMExtraction, UnderstandingContext

TODAY = date(2026, 10, 5)  # Monday
NOW = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
MEMBERS = [MemberRef("m_mom", "Mom", "mom"), MemberRef("m_dad", "Dad", "dad"),
           MemberRef("m_me", "Me", "child")]
SHOTS = {s["utterance"]: s for s in MULTI_FEW_SHOTS}


@pytest.fixture()
def session():
    eng = get_engine("sqlite://")
    main(eng)
    with Session(eng) as s:
        yield s


def _drafts(utterance: str, author: str = "m_me", **kw):
    extraction = LLMExtraction.model_validate(SHOTS[utterance]["output"])
    return drafts_from_extraction(extraction, today=TODAY, members=MEMBERS, author_id=author,
                                  utterance=utterance, **kw)


def _gaps(session, drafts):
    return [missing_fields(d.fields, requirements_for(session, d.kind)) for d in drafts]


# ── dates: Python resolves, never the LLM ──────────────────────────────────────

@pytest.mark.parametrize(("phrase", "expected"), [
    ("today", date(2026, 10, 5)), ("tomorrow", date(2026, 10, 6)), ("repu", date(2026, 10, 6)),
    ("day after tomorrow", date(2026, 10, 7)), ("ellundi", date(2026, 10, 7)),
    ("Friday", date(2026, 10, 9)), ("this friday", date(2026, 10, 9)),
    ("next Monday", date(2026, 10, 12)), ("on Monday", date(2026, 10, 5)),
    ("on the 10th", date(2026, 10, 10)), ("the 3rd", date(2026, 11, 3)), ("31st", date(2026, 10, 31)),
    ("Oct 20", date(2026, 10, 20)), ("5th March", date(2027, 3, 5)), ("2026-12-01", date(2026, 12, 1)),
    ("in 3 days", date(2026, 10, 8)), ("in two weeks", date(2026, 10, 19)),
    ("end of month", date(2026, 10, 31)),
])
def test_dates_resolve_against_today(phrase, expected):
    res = resolve_date(phrase, TODAY)
    assert res is not None and res.exact_day and res.end == expected


@pytest.mark.parametrize(("phrase", "start", "end"), [
    ("next week", date(2026, 10, 12), date(2026, 10, 18)),
    ("this weekend", date(2026, 10, 10), date(2026, 10, 11)),
    ("next weekend", date(2026, 10, 17), date(2026, 10, 18)),
    ("next month", date(2026, 11, 1), date(2026, 11, 30)),
])
def test_spans_keep_both_ends(phrase, start, end):
    res = resolve_date(phrase, TODAY)
    assert (res.start, res.end, res.exact_day) == (start, end, False)


def test_next_friday_on_a_monday_has_two_readings():
    res = resolve_date("next Friday", TODAY)
    assert not res.resolved
    assert res.candidates == (date(2026, 10, 9), date(2026, 10, 16))


def test_next_friday_on_a_saturday_has_one():
    assert resolve_date("next Friday", date(2026, 10, 10)).end == date(2026, 10, 16)


@pytest.mark.parametrize("phrase", ["before Diwali", "kal", "soon", "whenever", ""])
def test_unknown_phrases_stay_unresolved(phrase):
    assert resolve_date(phrase, TODAY) is None


def test_named_dates_come_from_the_caller_and_keep_the_relation():
    res = resolve_date("before Diwali", TODAY, {"diwali": date(2026, 11, 8)})
    assert (res.end, res.relation) == (date(2026, 11, 8), "before")
    assert resolve_date("by Friday", TODAY).relation == "by"


@pytest.mark.parametrize(("phrase", "value", "assumed"), [
    ("at 5", time(17, 0), True), ("5:30 pm", time(17, 30), False), ("10 am", time(10, 0), False),
    ("17:00", time(17, 0), False), ("7 in the morning", time(7, 0), False),
    ("8 at night", time(20, 0), False), ("noon", time(12, 0), False),
])
def test_times(phrase, value, assumed):
    res = resolve_time(phrase)
    assert (res.value, res.assumed_meridiem) == (value, assumed)


def test_at_seven_could_be_morning_or_evening():
    assert resolve_time("at 7").candidates == (time(7, 0), time(19, 0))


# ── people / categories ────────────────────────────────────────────────────────

@pytest.mark.parametrize(("mention", "expected"), [
    ("me", "m_me"), ("I", "m_me"), ("Dad", "m_dad"), ("papa", "m_dad"), ("Amma", "m_mom"),
    ("Mom's", "m_mom"), ("the watchman", None), ("we", None), (None, None),
])
def test_resolve_member(mention, expected):
    assert resolve_member(mention, MEMBERS, "m_me") == expected


@pytest.mark.parametrize(("title", "raw", "kind", "label"), [
    ("Fix bathroom tap", "bathroom tap is gone again", "task", "Home Repair"),
    ("Get the AC serviced", "get the AC serviced", "task", "Maintenance"),
    ("Pay EB bill", "pay EB bill", "bill", "Bills & Payments"),
    ("Deposit cheque at bank", "deposit a cheque", "errand", "Errands"),
    ("Doctor appointment", "Mom's doctor appointment", "appointment", "Appointments"),
    ("Book train tickets", "book train tickets to Chennai", "ticket_booking", "Tickets"),
    ("Water the plants", "water the plants", "task", "Household Chores"),
    ("Buy a pressure cooker", "buy a pressure cooker", "shopping", "Shopping"),
    ("Call grandma", "call grandma on Sunday", "misc", "Miscellaneous"),
])
def test_categorize(title, raw, kind, label):
    c = categorize(ExtractedAction(raw_text=raw, title=title))
    assert (c.kind, c.label) == (kind, label)


# ── prompt: extraction only ────────────────────────────────────────────────────

@pytest.mark.parametrize("shot", MULTI_FEW_SHOTS, ids=lambda s: s["utterance"][:30])
def test_few_shots_validate_and_only_copy_the_authors_words(shot):
    out = LLMExtraction.model_validate(shot["output"])
    said = shot["utterance"].lower()
    for a in out.actions:
        for phrase in (a.date_phrase, a.time_phrase, a.assignee_mention, a.for_mention,
                       a.priority_phrase, a.recurrence_phrase, a.location_phrase):
            assert phrase is None or phrase.lower() in said
    for i in out.items:
        assert i.needed_by_phrase is None or i.needed_by_phrase.lower() in said
    assert "category" not in json.dumps(shot["output"])


def test_multi_prompt_never_sees_today():
    messages = build_multi_messages("pay EB bill next week", UnderstandingContext())
    assert messages[0]["content"] == MULTI_SYSTEM_PROMPT
    assert all(str(TODAY.year) not in m["content"] for m in messages)


class _Fake:
    def __init__(self, reply: str) -> None:
        self.reply, self.calls = reply, []

    async def chat(self, model, messages):
        self.calls.append(messages)
        return self.reply


@pytest.mark.asyncio
async def test_extract_multi_uses_the_multi_prompt_and_the_shared_validator():
    shot = MULTI_FEW_SHOTS[0]
    fake = _Fake(json.dumps(shot["output"]))
    out = await UnderstandingClient(fake).extract_multi(shot["utterance"])
    assert [a.title for a in out.actions] == ["Fix bathroom tap", "Pay EB bill"]
    assert fake.calls[0][0]["content"] == MULTI_SYSTEM_PROMPT


# ── drafts: the Hearth examples, end to end ────────────────────────────────────

def test_mixed_message_becomes_three_posts(session):
    utterance = "Need milk, bathroom tap is gone again, also remind me to pay EB bill next week"
    drafts = _drafts(utterance)
    assert [(d.kind, d.category) for d in drafts] == [
        ("grocery", "Groceries"), ("task", "Home Repair"), ("bill", "Bills & Payments")]
    grocery, tap, bill = drafts
    assert grocery.fields["items"] == [{"item": "milk"}]
    assert tap.fields == {"what": "Fix bathroom tap", "location_in_house": "bathroom",
                          "category": "Home Repair"}
    # A bill needs a day; "next week" is kept as words and asked about, never guessed.
    assert bill.fields == {"bill_type": "Electricity", "assigned_to": "m_me",
                           "due_date_text": "next week"}

    q = next_question(drafts, _gaps(session, drafts))
    assert q.field == "needed_by" and q.draft_index == 0
    assert "milk" in q.question

    text = confirmation(drafts, question=q)
    assert text.splitlines()[:4] == [
        "Got it. I added:", "• Milk to Groceries", "• Fix bathroom tap to Home Repair",
        "• Pay EB bill to Bills & Payments (next week)"]


def test_appointment_asks_which_friday_and_keeps_the_time(session):
    [d] = _drafts("Mom's doctor appointment is next Friday at 5")
    assert d.kind == "appointment"
    assert d.fields["for_member"] == "m_mom"
    assert "assigned_to" not in d.fields  # nobody named → unassigned, not guessed
    assert d.fields["appointment_time"] == "17:00"
    assert "appointment_date" not in d.fields
    q = next_question([d], _gaps(session, [d]))
    assert (q.field, q.chips) == ("appointment_date", ("Fri, Oct 9", "Fri, Oct 16"))


def test_resolved_appointment_confirms_with_date_and_time(session):
    extraction = LLMExtraction(intent="ADD_ITEMS", actions=[ExtractedAction(
        raw_text="dentist on the 10th at 5:30 pm", title="Dentist appointment",
        date_phrase="on the 10th", time_phrase="at 5:30 pm")])
    [d] = drafts_from_extraction(extraction, today=TODAY, members=MEMBERS, author_id="m_me",
                                 utterance="dentist on the 10th at 5:30 pm")
    assert _gaps(session, [d]) == [[]]
    assert confirmation([d]) == "Got it. I added:\n• Dentist appointment to Appointments for Sat, Oct 10 at 5:30 PM"


def test_i_means_the_author(session):
    [d] = _drafts("I need to go to the bank and deposit a cheque", author="m_dad")
    assert (d.kind, d.fields["assigned_to"], d.fields["location"]) == ("errand", "m_dad", "bank")
    assert next_question([d], _gaps(session, [d])).field == "needed_by"


def test_urgent_and_unresolvable_deadline(session):
    plumber, ac = _drafts("Dad should get the plumber, urgent. Fix the AC before Diwali")
    assert (plumber.priority, plumber.fields["assigned_to"]) == (Priority.URGENT, "m_dad")
    assert ac.priority == Priority.NORMAL
    assert ac.fields["needed_by_text"] == "before Diwali" and "needed_by" not in ac.fields
    resolved = _drafts("Dad should get the plumber, urgent. Fix the AC before Diwali",
                       named_dates={"diwali": date(2026, 11, 8)})[1]
    assert (resolved.fields["needed_by"], resolved.fields["needed_by_relation"]) == ("2026-11-08", "before")


def test_grocery_dates_and_buyer(session):
    [d] = _drafts("Mom needs to buy vegetables tomorrow and 2 kg onions")
    assert d.fields["assigned_to"] == "m_mom"
    assert [i["needed_by"] for i in d.fields["items"]] == ["2026-10-06", "2026-10-06"]
    # onions are complete without anyone being asked a price
    assert [m.field for m in _gaps(session, [d])[0]] == ["qty", "unit"]


def test_meaning_ambiguity_is_asked_before_anything_else(session):
    drafts = _drafts("get coriander and pay internet bill 799 on the 10th")
    grocery, bill = drafts
    assert bill.fields == {"bill_type": "Internet", "amount": 799, "due_date": "2026-10-10",
                           "due_date_text": "on the 10th"}
    q = next_question(drafts, _gaps(session, drafts))
    assert (q.field, q.chips) == ("variant", ("leaves", "seeds", "powder"))


def test_recurring_chore(session):
    [d] = _drafts("rice almost khatam. water the plants every morning")
    assert (d.kind, d.category, d.fields["recurrence_text"]) == ("task", "Household Chores", "every morning")


def test_phrases_the_author_never_typed_are_dropped():
    extraction = LLMExtraction(intent="ADD_ITEMS", actions=[ExtractedAction(
        raw_text="fix the tap", title="Fix the tap", date_phrase="2026-10-09",
        assignee_mention="Dad")])
    [d] = drafts_from_extraction(extraction, today=TODAY, members=MEMBERS, author_id="m_me",
                                 utterance="fix the tap")
    assert "needed_by" not in d.fields and "assigned_to" not in d.fields


# ── duplicates ─────────────────────────────────────────────────────────────────

def test_existing_milk_is_kept_not_duplicated():
    drafts = _drafts("Need milk, bathroom tap is gone again, also remind me to pay EB bill next week")
    existing = [OpenEntry("li_1", "grocery", "Milk", {"item": "Milk", "qty": 1, "unit": "L"}),
                OpenEntry("p_7", "task", "Bathroom tap repair", {"what": "Bathroom tap repair"})]
    kept, dups = find_duplicates(drafts, existing)
    assert [d.kind for d in kept] == ["bill"]
    assert [(x.existing.ref, x.fills) for x in dups] == [
        ("li_1", {}), ("p_7", {"location_in_house": "bathroom", "category": "Home Repair"})]
    assert confirmation(kept, dups).splitlines() == [
        "Got it. I added:", "• Pay EB bill to Bills & Payments (next week)",
        "Already on the list:", "• Milk", "• Bathroom tap repair"]


def test_partial_grocery_duplicate_keeps_the_rest_and_reindexes_questions():
    utterance = "tomatoes and coriander"
    extraction = LLMExtraction.model_validate({
        "intent": "ADD_ITEMS",
        "items": [{"raw_text": "tomatoes", "canonical_guess": "tomatoes"},
                  {"raw_text": "coriander", "canonical_guess": "coriander"}],
        "ambiguities": [{"raw_text": "coriander", "kind": "product_type",
                         "question": "Which coriander?", "options": ["leaves", "seeds"]}],
    })
    drafts = drafts_from_extraction(extraction, today=TODAY, members=MEMBERS, author_id="m_me",
                                    utterance=utterance)
    assert [q.item_index for q in drafts[0].questions] == [1]
    kept, dups = find_duplicates(drafts, [OpenEntry("li_2", "grocery", "Tomato")])
    assert kept[0].fields["items"] == [{"item": "coriander"}]
    assert [q.item_index for q in kept[0].questions] == [0]
    assert dups[0].existing.ref == "li_2"


@pytest.mark.parametrize(("a", "b", "same"), [
    ("Fix bathroom tap", "Bathroom tap repair", True),
    ("Pay EB bill", "Pay electricity bill", True),
    ("Fix kitchen tap", "Fix bathroom tap", False),
    ("Fix the AC", "Fix the fan", False),
])
def test_similar(a, b, same):
    assert similar(a, b) is same


# ── expected rate: from history, never asked ───────────────────────────────────

def _obs(unit, price, days, source="purchase_history"):
    return RateObservation(unit, price, NOW - timedelta(days=days), source)


def test_rate_is_median_of_recent_purchases_in_any_convertible_unit():
    obs = [_obs("kg", 40, 3), _obs("g", 0.05, 10), _obs("kg", 45, 20), _obs("kg", 99, 30),
           _obs("kg", 200, 400), _obs("kg", 10, 1, "market_price")]
    est = estimate_rate(obs, "kg", NOW)
    assert (est.rate, est.source, est.observations) == (45, "purchase_history", 3)
    assert estimate_rate(obs, "g", NOW).rate == 0.045


def test_market_price_only_when_no_purchases_and_nothing_across_units():
    assert estimate_rate([_obs("kg", 30, 2, "market_price")], "kg", NOW).source == "market_price"
    assert estimate_rate([_obs("L", 60, 2)], "kg", NOW) is None


def test_fill_expected_rates_never_invents():
    fields = {"items": [{"item": "Onions", "qty": 2, "unit": "kg"},
                        {"item": "Saffron", "qty": 1, "unit": "g"},
                        {"item": "Rice", "qty": 5, "unit": "kg", "expected_rate": 70}]}
    lookup = {"Onions": [_obs("kg", 40, 3)], "Saffron": [], "Rice": [_obs("kg", 60, 3)]}
    out = fill_expected_rates(fields, lambda i: lookup[i["item"]], NOW)["items"]
    assert out[0] == {"item": "Onions", "qty": 2, "unit": "kg", "expected_rate": 40,
                           "expected_rate_unit": "kg", "price_source": "purchase_history",
                           "expected_total": 80}
    assert "expected_rate" not in out[1] and out[1]["price_source"] == "unknown"
    assert (out[2]["expected_rate"], out[2]["price_source"]) == (70, "user")


def test_observations_come_from_this_households_priced_purchases(session):
    session.add(Purchase(id="hp1", household_id="h_home", product_id="p_onion", product="Onions",
                         qty=2, unit="kg", price=90, purchased_at=NOW - timedelta(days=4),
                         source=PurchaseSource.MANUAL))
    session.flush()
    est = estimate_rate(observations_for(session, "h_home", "p_onion"), "kg", NOW)
    assert (est.rate, est.source) == (45, "purchase_history")
