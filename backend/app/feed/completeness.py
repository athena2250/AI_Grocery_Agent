"""Is this post complete enough to send? Pure — no DB, no LLM.

The LLM only *extracts* fields from what the author typed. This module alone decides what
is still missing, from the `post_kind_field` rows for that kind. Whatever it returns becomes
a clarifying question to the author; the post can't be published until it returns nothing.

`fields` shape: flat keys for the post, plus `items: [ {...}, ... ]` for per-item kinds
(grocery). An item field that is empty falls back to the post-level field of the same name,
so one "needed by Saturday" covers every item.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

ITEMS_KEY = "items"


@dataclass(frozen=True)
class Requirement:
    field: str
    question: str
    required: bool = True
    applies_to: str = "post"
    """"post" or "item"."""
    chips: tuple[str, ...] = ()
    depends_on_field: str | None = None
    depends_on_value: Any = None
    position: int = 0


@dataclass(frozen=True)
class Missing:
    field: str
    question: str
    chips: tuple[str, ...] = ()
    item_index: int | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "question": self.question,
            "chips": list(self.chips),
            "item_index": self.item_index,
        }


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def _applies(req: Requirement, scope: Mapping[str, Any], post: Mapping[str, Any]) -> bool:
    if req.depends_on_field is None:
        return True
    value = scope.get(req.depends_on_field, post.get(req.depends_on_field))
    return bool(value == req.depends_on_value)


def _ask(req: Requirement, item: Mapping[str, Any] | None) -> str:
    name = (item or {}).get("item") or "it"
    return req.question.replace("{item}", str(name))


def missing_fields(fields: Mapping[str, Any], requirements: Sequence[Requirement]) -> list[Missing]:
    """Every required field that's empty, post-level first, then item by item, in `position` order."""

    reqs = sorted((r for r in requirements if r.required), key=lambda r: (r.position, r.field))
    post_reqs = [r for r in reqs if r.applies_to == "post"]
    item_reqs = [r for r in reqs if r.applies_to == "item"]
    out: list[Missing] = []

    for r in post_reqs:
        if _applies(r, fields, fields) and is_empty(fields.get(r.field)):
            out.append(Missing(r.field, _ask(r, None), r.chips))

    if item_reqs:
        items = fields.get(ITEMS_KEY) or []
        if not items:
            out.append(Missing(ITEMS_KEY, "What do you need?"))
        for i, item in enumerate(items):
            for r in item_reqs:
                if not _applies(r, item, fields):
                    continue
                value = item.get(r.field)
                if is_empty(value):
                    value = fields.get(r.field)
                if is_empty(value):
                    out.append(Missing(r.field, _ask(r, item), r.chips, item_index=i))
    return out


def is_complete(fields: Mapping[str, Any], requirements: Sequence[Requirement]) -> bool:
    return not missing_fields(fields, requirements)
