"""Grocery planner — list assembly rules (plan_08). Pure functions — no I/O, no LLM.

Mirrors mobile/src/state/planner.ts.

  1. Dedupe against the draft: same product + brand + variant and a unit the
     conversion table can bridge → one row with the quantities summed. Anything
     else (1 pack + 200 g, an unknown qty) stays a separate row. A proposal that
     reuses a pending item's id refines that item — replaced, not summed.
  2. Categorize from the product catalog only — never from the LLM.
  3. Default rationale when the proposal had none.
  4. Pantry `almost_finished` / `out` → proposals flagged `needs_confirmation`;
     they reach the list only when the user confirms.
  5. Group + sort in the fixed store-walk order below.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Literal, Protocol, TypeVar, cast

from app.ambiguity.safety_net import Catalog
from app.inventory.models import Inventory
from app.inventory.store import needs_restock
from app.memory.rules import confidence_level, convert_qty

Confidence = Literal["high", "medium", "low"]
Source = Literal["user", "household_memory", "purchase_history", "guess"]


class Category(str, Enum):
    """Fixed list categories, declared in store-walk order. Phase 4 makes this per-store."""

    VEGETABLES = "Vegetables"
    FRUITS = "Fruits"
    DAIRY = "Dairy"
    RICE_GRAINS = "Rice & Grains"
    PULSES = "Pulses"
    SPICES = "Spices"
    COOKING_ESSENTIALS = "Cooking Essentials"
    SNACKS = "Snacks"
    BEVERAGES = "Beverages"
    HOUSEHOLD = "Household"
    PERSONAL_CARE = "Personal Care"


CATEGORY_ORDER: tuple[Category, ...] = tuple(Category)
DEFAULT_RATIONALE = "You added this in chat."

_CONFIDENCE_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2}
_STATE_LABEL = {
    "available": "stocked up",
    "running_low": "running low",
    "almost_finished": "almost finished",
    "out": "finished",
}
# Cross-unit sums are expressed in the bigger unit once they reach it: 1 kg + 500 g → 1.5 kg.
_BIG_UNIT: dict[str, tuple[str, str]] = {
    "g": ("g", "kg"),
    "kg": ("g", "kg"),
    "ml": ("ml", "L"),
    "L": ("ml", "L"),
}


@dataclass(frozen=True)
class ProposedListItem:
    """A resolved item ready for the list — mirrors the TS `ProposedItem`.

    `id` is set only when the proposal refines a provisional item already on the
    list (the answer to "Go with 1 kg?"); otherwise the store assigns one.
    `category` is a fallback for a product the catalog doesn't know.
    """

    product_id: str
    product: str
    qty: float | None
    unit: str | None
    source: Source
    confidence: Confidence
    rationale: str = ""
    brand: str | None = None
    variant: str | None = None
    category: Category | None = None
    needs_confirmation: bool = False
    id: str | None = None


def _as_category(value: str | None) -> Category | None:
    try:
        return Category(value) if value else None
    except ValueError:
        return None


def categorize(product_id: str, catalog: Catalog, fallback: Category) -> Category:
    product = catalog.product(product_id)
    return (product and _as_category(product.category)) or fallback


def _round3(n: float) -> float:
    return round(n, 3)


def merge_qty(
    a_qty: float | None, a_unit: str | None, b_qty: float | None, b_unit: str | None
) -> tuple[float, str] | None:
    """Sum two amounts, or None when they can't be added (unknown qty, or unbridgeable units)."""

    if a_qty is None or b_qty is None or not a_unit or not b_unit:
        return None
    if a_unit == b_unit:
        return _round3(a_qty + b_qty), a_unit
    pair = _BIG_UNIT.get(a_unit)
    b_small = convert_qty(b_qty, b_unit, pair[0]) if pair else None
    if pair is None or b_small is None:
        return None
    small, big = pair
    total = convert_qty(a_qty, a_unit, small)
    assert total is not None
    total += b_small
    in_big = convert_qty(total, small, big)
    assert in_big is not None
    return (_round3(in_big), big) if in_big >= 1 else (_round3(total), small)


class _Choice(Protocol):
    @property
    def product_id(self) -> str: ...
    @property
    def brand(self) -> str | None: ...
    @property
    def variant(self) -> str | None: ...


def same_choice(a: _Choice, b: _Choice) -> bool:
    """Merge candidates: same product *and* same brand/variant — a different brand is a different row."""

    return a.product_id == b.product_id and a.brand == b.brand and a.variant == b.variant


def lower_confidence(a: str, b: str) -> str:
    return a if _CONFIDENCE_RANK[a] <= _CONFIDENCE_RANK[b] else b


def rationale_or_default(rationale: str) -> str:
    return rationale.strip() or DEFAULT_RATIONALE


def merged_rationale(prior: str, qty: float | None, unit: str | None) -> str:
    return f"{prior} Then you added {qty:g} {unit} more."


class _Categorized(Protocol):
    @property
    def category(self) -> str: ...


C = TypeVar("C", bound=_Categorized)


def _rank(category: str) -> int:
    c = _as_category(category)
    return CATEGORY_ORDER.index(c) if c else len(CATEGORY_ORDER)


def group_by_category(items: Iterable[C]) -> list[tuple[str, list[C]]]:
    """Sections in the fixed category order; within a section, items keep their input order."""

    groups: dict[str, list[C]] = {}
    for item in items:
        groups.setdefault(item.category, []).append(item)
    return sorted(groups.items(), key=lambda kv: _rank(kv[0]))


def low_stock_proposals(
    inventory: Sequence[Inventory],
    on_list_product_ids: Iterable[str],
    catalog: Catalog,
    dismissed: Mapping[str, datetime] | None = None,
) -> list[ProposedListItem]:
    """Pantry says almost finished / out and it isn't on the list → propose it.

    Uses the remembered amount if there is one (the catalog's preferences carry
    staleness-decayed confidence), never an invented one. `dismissed` maps
    product id → the pantry row's `updated_at` when the user said "Not now"; a
    newer pantry update shows it again.
    """

    on_list = set(on_list_product_ids)
    dismissed = dismissed or {}
    out: list[ProposedListItem] = []
    for row in inventory:
        if not needs_restock(row.state) or row.product_id in on_list:
            continue
        if dismissed.get(row.product_id) == row.updated_at:
            continue
        product = catalog.product(row.product_id)
        if product is None:
            continue
        pref = catalog.preference(product.id)
        usual = pref if pref and pref.typical_qty is not None and pref.typical_unit else None
        name = product.name.lower()
        rationale = f"Pantry says {name} is {_STATE_LABEL[row.state.value]}."
        if usual:
            brand = f" {usual.preferred_brand}" if usual.preferred_brand else ""
            rationale += f" You usually get {usual.typical_qty:g} {usual.typical_unit}{brand}."
        out.append(
            ProposedListItem(
                product_id=product.id,
                product=product.name,
                qty=usual.typical_qty if usual else None,
                unit=usual.typical_unit if usual else None,
                brand=usual.preferred_brand if usual else None,
                variant=usual.preferred_variant if usual else None,
                category=categorize(product.id, catalog, Category.HOUSEHOLD),
                source="household_memory",
                confidence=cast(Confidence, confidence_level(usual.confidence)) if usual else "low",
                rationale=rationale,
                needs_confirmation=True,
            )
        )
    return out
