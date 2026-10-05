"""Is this draft already on the board? Pure — no DB, no LLM.

Matching is deliberately conservative: a duplicate the family can delete costs less than
two different jobs silently merged ("kitchen tap" vs "bathroom tap" stay separate).

  - Grocery: an item whose normalized name equals an open grocery item's.
  - Everything else: same post kind and token-set Jaccard ≥ 0.6 on the title, after
    dropping verbs / filler ("Fix bathroom tap" == "bathroom tap repair").

A match never overwrites the existing entry: `merge_fields` only fills its empty fields
with what the new message added ("we also need milk, 2 L" fills a missing qty).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from .completeness import is_empty
from .drafts import DraftPost

STOPWORDS = {
    "a", "an", "the", "to", "at", "for", "of", "in", "on", "my", "our", "please", "and",
    "need", "needs", "get", "fix", "repair", "call", "pay", "do", "buy", "go", "again",
    "some", "more", "also", "is", "it",
}
SYNONYMS = {"eb": "electricity", "current": "electricity", "wifi": "internet",
            "broadband": "internet", "dr": "doctor"}
THRESHOLD = 0.6


@dataclass(frozen=True)
class OpenEntry:
    """Something already open: a draft / published post, or a line of the grocery list."""

    ref: str
    kind: str
    title: str
    fields: Mapping[str, Any] = field(default_factory=dict)


@dataclass
class Duplicate:
    draft_index: int
    existing: OpenEntry
    item_index: int | None = None
    """For a grocery item: which item of the draft."""
    fills: dict[str, Any] = field(default_factory=dict)
    """Empty fields of the existing entry the new message can fill."""


def _singular(w: str) -> str:
    if len(w) > 3 and w.endswith("oes"):
        return w[:-2]
    if len(w) > 3 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def tokens(text: str) -> frozenset[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = {SYNONYMS.get(_singular(w), _singular(w)) for w in words}
    return frozenset(out - STOPWORDS)


def similar(a: str, b: str) -> bool:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= THRESHOLD


def merge_fields(existing: Mapping[str, Any], new: Mapping[str, Any]) -> dict[str, Any]:
    """New values only for fields the existing entry has empty."""

    return {k: v for k, v in new.items() if not is_empty(v) and is_empty(existing.get(k))}


def find_duplicates(
    drafts: Sequence[DraftPost], open_entries: Sequence[OpenEntry]
) -> tuple[list[DraftPost], list[Duplicate]]:
    """Split drafts into what is new and what already exists.

    Grocery drafts lose only the items that already exist (the rest stay one draft);
    other drafts are dropped whole when they match. Duplicates inside the same message
    ("milk … and milk") collapse to the first mention.
    """

    kept: list[DraftPost] = []
    dups: list[Duplicate] = []
    seen: list[OpenEntry] = list(open_entries)

    for di, d in enumerate(drafts):
        if d.kind == "grocery":
            new_items: list[dict[str, Any]] = []
            new_index: dict[int, int] = {}
            for ii, item in enumerate(d.fields.get("items", [])):
                name = tokens(str(item.get("item", "")))
                match = next((e for e in seen if e.kind == "grocery" and tokens(e.title) == name), None)
                if match:
                    dups.append(Duplicate(di, match, ii, merge_fields(match.fields, item)))
                else:
                    new_index[ii] = len(new_items)
                    new_items.append(item)
                    seen.append(OpenEntry(f"draft:{di}:{ii}", "grocery", str(item.get("item", "")), item))
            if new_items:
                questions = [
                    replace(q, item_index=new_index[q.item_index]) if q.item_index is not None else q
                    for q in d.questions
                    if q.item_index is None or q.item_index in new_index
                ]
                kept.append(replace(d, title=", ".join(i["item"] for i in new_items),
                                    fields={**d.fields, "items": new_items}, questions=questions))
            continue
        match = next((e for e in seen if e.kind == d.kind and similar(e.title, d.title)), None)
        if match:
            dups.append(Duplicate(di, match, None, merge_fields(match.fields, d.fields)))
        else:
            kept.append(d)
            seen.append(OpenEntry(f"draft:{di}", d.kind, d.title, d.fields))
    return kept, dups
