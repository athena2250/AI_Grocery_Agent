"""Which one question to ask next, when a message left several gaps. Pure — no LLM.

Hearth asks one thing at a time. Candidates are each draft's own questions (which
coriander, which Friday) plus `completeness.missing_fields` for its fields; the most
important wins: what the thing *is* before when, when before who, who before how much.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .completeness import Missing
from .drafts import DraftPost

FIELD_RANK: dict[str, int] = {
    "variant": 0, "items": 1, "item": 1, "what": 1, "message": 1, "bill_type": 1,
    "from": 2, "to": 2,
    "needed_by": 3, "due_date": 3, "appointment_date": 3, "travel_date": 3,
    "appointment_time": 4, "time": 4,
    "amount": 5, "passengers": 5,
    "assigned_to": 6, "recipients": 6,
    "qty": 7, "unit": 8,
    "repeat": 9, "interval_minutes": 9,
}
_UNRANKED = 50


@dataclass(frozen=True)
class PendingQuestion:
    draft_index: int
    field: str
    question: str
    chips: tuple[str, ...] = ()
    item_index: int | None = None


def candidates(drafts: Sequence[DraftPost], missing: Sequence[Sequence[Missing]]) -> list[PendingQuestion]:
    """Every open question, most important first. `missing[i]` is completeness for `drafts[i]`.

    A field a draft already asks about itself ("which Friday?") replaces the generic
    completeness question for the same field.
    """

    out: list[tuple[int, int, int, PendingQuestion]] = []
    for di, (draft, gaps) in enumerate(zip(drafts, missing, strict=True)):
        own = {(q.field, q.item_index) for q in draft.questions}
        for q in [*draft.questions, *(g for g in gaps if (g.field, g.item_index) not in own)]:
            named = len(drafts) == 1 or draft.title.lower() in q.question.lower()
            text = q.question if named else f"{draft.title}: {q.question}"
            pq = PendingQuestion(di, q.field, text, q.chips, q.item_index)
            out.append((FIELD_RANK.get(q.field, _UNRANKED), di, q.item_index or 0, pq))
    return [pq for *_, pq in sorted(out, key=lambda t: t[:3])]


def next_question(
    drafts: Sequence[DraftPost], missing: Sequence[Sequence[Missing]]
) -> PendingQuestion | None:
    found = candidates(drafts, missing)
    return found[0] if found else None
