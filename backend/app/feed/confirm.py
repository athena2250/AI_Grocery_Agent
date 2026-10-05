"""The short "Got it, I added …" reply. Pure templating — the LLM never writes it.

Built only from what the drafts actually hold, so the reply can never claim something
that wasn't organized.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, time

from .dates import format_date, format_time
from .dedupe import Duplicate
from .drafts import DATE_FIELD, DraftPost
from .questions import PendingQuestion

_RELATION_WORD = {"on": "for", "by": "by", "before": "before"}


def _when(d: DraftPost) -> str:
    key = DATE_FIELD.get(d.kind, "needed_by")
    fields = d.fields
    if d.kind == "grocery":
        dates = {i.get("needed_by") for i in fields.get("items", [])} - {None}
        value = next(iter(dates)) if len(dates) == 1 else fields.get(key)
    else:
        value = fields.get(key)
    if value:
        text = f" {_RELATION_WORD[fields.get(f'{key}_relation', 'on')]} {format_date(date.fromisoformat(value))}"
    elif phrase := fields.get(f"{key}_text"):
        text = f" ({phrase})"
    else:
        return ""
    clock = fields.get("appointment_time") or fields.get("time")
    if clock and ":" in clock:
        text += f" at {format_time(time.fromisoformat(clock))}"
    return text


def _line(d: DraftPost) -> str:
    if d.kind == "grocery":
        names = [str(i["item"]) for i in d.fields.get("items", [])]
        return f"• {', '.join(n[:1].upper() + n[1:] for n in names)} to Groceries{_when(d)}"
    return f"• {d.title} to {d.category}{_when(d)}"


def confirmation(
    drafts: Sequence[DraftPost],
    duplicates: Sequence[Duplicate] = (),
    question: PendingQuestion | None = None,
) -> str:
    lines: list[str] = []
    if drafts:
        lines += ["Got it. I added:", *(_line(d) for d in drafts)]
    if duplicates:
        lines.append("Already on the list:" if drafts else "Already on the list, so I kept it:")
        lines += [f"• {dup.existing.title}" for dup in duplicates]
    if not lines:
        lines.append("I couldn't find anything to add from that.")
    if question:
        lines += ["", question.question]
    return "\n".join(lines)
