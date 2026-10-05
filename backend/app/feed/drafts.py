"""One extraction → draft posts (kind + `fields_json`). Pure — no DB, no LLM.

Every decision here is deterministic: the post kind comes from `categorize`, dates from
`dates`, member ids from `people`. Phrases the LLM returned that don't appear in what the
author typed are dropped (a model that "helpfully" turned "next Friday" into "2026-10-16"
gets no say), so a value can only come from the author's words.

What is still missing is not decided here — run `completeness.missing_fields` on each
draft's `fields`. The only questions a draft carries itself are the ones this module
creates: two real readings of a date or time ("which Friday?").
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.understanding.schema import Ambiguity, ExtractedAction, ExtractedItem, LLMExtraction

from .categorize import GROCERIES, bill_type, categorize
from .completeness import Missing
from .dates import (
    DateResolution,
    format_date,
    format_time,
    resolve_date,
    resolve_time,
)
from .models import Priority
from .people import MemberRef, resolve_member

DATE_FIELD = {
    "grocery": "needed_by", "task": "needed_by", "errand": "needed_by", "shopping": "needed_by",
    "misc": "needed_by", "bill": "due_date", "appointment": "appointment_date",
    "ticket_booking": "travel_date",
}
EXACT_DAY_KINDS = {"appointment", "ticket_booking", "bill"}
"""A week or a month is not an answer for these: "next week" still asks which day."""

_URGENT = re.compile(r"\b(?:urgent|urgently|asap|immediately|emergency|right now|jaldi|turant|vengane)\b")
_USUAL = {"usual", "same", "regular", "the one", "same as last time"}


@dataclass
class DraftPost:
    kind: str
    category: str
    """Display category: "Groceries", "Home Repair", "Bills & Payments" …"""
    title: str
    fields: dict[str, Any]
    """Goes into `post.fields_json`; `<date field>_text` keeps the author's words."""
    raw_text: str
    priority: Priority = Priority.NORMAL
    questions: list[Missing] = field(default_factory=list)
    """Questions this module raised (two readings of a date / time, which coriander)."""


def _said(phrase: str | None, utterance: str | None) -> str | None:
    """`phrase`, if the author actually typed it; otherwise None."""

    if not phrase or not phrase.strip():
        return None
    if utterance is None:
        return phrase.strip()
    squash = lambda s: re.sub(r"\s+", " ", s.lower()).strip()  # noqa: E731
    return phrase.strip() if squash(phrase) in squash(utterance) else None


def _apply_date(
    fields: dict[str, Any], key: str, res: DateResolution | None, phrase: str | None,
    exact_day: bool, questions: list[Missing], item_index: int | None = None,
) -> None:
    if phrase is None:
        return
    fields[f"{key}_text"] = phrase
    if res is None:
        return
    if res.candidates:
        questions.append(Missing(
            key, f"Which day do you mean by “{phrase}”?",
            tuple(format_date(d) for d in res.candidates), item_index=item_index,
        ))
        return
    if res.end is None or (exact_day and not res.exact_day):
        return
    fields[key] = res.end.isoformat()
    if res.relation != "on":
        fields[f"{key}_relation"] = res.relation


def _grocery_draft(
    items: Sequence[ExtractedItem], ambiguities: Sequence[Ambiguity], utterance: str | None,
    today: date, members: Sequence[MemberRef], author_id: str | None,
    named_dates: Mapping[str, date] | None,
) -> DraftPost:
    fields: dict[str, Any] = {"items": []}
    questions: list[Missing] = []
    assignee: str | None = None
    for i, it in enumerate(items):
        row: dict[str, Any] = {
            "item": it.canonical_guess or it.raw_text, "qty": it.qty, "unit": it.unit,
            "brand": it.brand,
        }
        if it.variant_hint and it.variant_hint.lower() not in _USUAL:
            row["variant"] = it.variant_hint
        elif it.variant_hint:
            row["variant_hint"] = "usual"
        phrase = _said(it.needed_by_phrase, utterance)
        _apply_date(row, "needed_by", resolve_date(phrase, today, named_dates), phrase,
                    False, questions, item_index=i)
        assignee = assignee or resolve_member(_said(it.assignee_mention, utterance), members, author_id)
        fields["items"].append({k: v for k, v in row.items() if v is not None})
        for amb in ambiguities:
            if amb.raw_text.lower() in it.raw_text.lower():
                questions.append(Missing("variant", amb.question, tuple(amb.options), item_index=i))
    if assignee:
        fields["assigned_to"] = assignee
    title = ", ".join(r["item"] for r in fields["items"])
    raw = "; ".join(it.raw_text for it in items)
    return DraftPost("grocery", GROCERIES, title, fields, raw, questions=questions)


def _action_draft(
    action: ExtractedAction, utterance: str | None, today: date, members: Sequence[MemberRef],
    author_id: str | None, named_dates: Mapping[str, date] | None,
) -> DraftPost:
    category = categorize(action)
    kind = category.kind
    fields: dict[str, Any] = {}
    questions: list[Missing] = []

    assignee = resolve_member(_said(action.assignee_mention, utterance), members, author_id)
    location = _said(action.location_phrase, utterance)
    if kind == "bill":
        fields.update(bill_type=bill_type(action), amount=action.amount)
    elif kind == "appointment":
        fields.update(what=action.title, location=location,
                      for_member=resolve_member(_said(action.for_mention, utterance), members, author_id))
    elif kind == "shopping":
        fields.update(item=action.title, budget=action.amount)
    elif kind == "task":
        fields.update(what=action.title, location_in_house=location, budget=action.amount,
                      category=category.label)
    elif kind == "errand":
        fields.update(what=action.title, location=location)
    elif kind == "ticket_booking":
        fields.update(what=action.title)
    else:
        fields.update(what=action.title)
    fields["assigned_to"] = assignee

    date_phrase = _said(action.date_phrase, utterance)
    _apply_date(fields, DATE_FIELD[kind], resolve_date(date_phrase, today, named_dates),
                date_phrase, kind in EXACT_DAY_KINDS, questions)

    if time_phrase := _said(action.time_phrase, utterance):
        res = resolve_time(time_phrase)
        key = "appointment_time" if kind == "appointment" else "time"
        fields[f"{key}_text"] = time_phrase
        if res and res.value:
            fields[key] = res.value.strftime("%H:%M")
            if res.assumed_meridiem:
                fields[f"{key}_assumed_meridiem"] = True
        elif res and res.candidates:
            questions.append(Missing(key, f"“{time_phrase}” in the morning or the evening?",
                                     tuple(format_time(t) for t in res.candidates)))
        elif res and res.part_of_day:
            fields[key] = res.part_of_day

    if recurrence := _said(action.recurrence_phrase, utterance):
        fields["recurrence_text"] = recurrence
    priority_phrase = _said(action.priority_phrase, utterance) or ""
    priority = Priority.URGENT if _URGENT.search(priority_phrase.lower()) else Priority.NORMAL

    fields = {k: v for k, v in fields.items() if v is not None}
    return DraftPost(kind, category.label, action.title, fields, action.raw_text, priority, questions)


def drafts_from_extraction(
    extraction: LLMExtraction,
    *,
    today: date,
    members: Sequence[MemberRef],
    author_id: str | None,
    utterance: str | None = None,
    named_dates: Mapping[str, date] | None = None,
) -> list[DraftPost]:
    """Groceries become one `grocery` draft (first); each action becomes its own draft.

    `today` is the household's local date. Pass `utterance` so phrases the author never
    typed are dropped; `named_dates` resolves "before Diwali" when the caller knows it.
    """

    drafts: list[DraftPost] = []
    if extraction.items:
        drafts.append(_grocery_draft(extraction.items, extraction.ambiguities, utterance,
                                     today, members, author_id, named_dates))
    for action in extraction.actions:
        drafts.append(_action_draft(action, utterance, today, members, author_id, named_dates))
    return drafts
