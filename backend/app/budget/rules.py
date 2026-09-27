"""Budget engine rules (plan_11). Pure functions — no I/O, no LLM.

- Each pending line is priced from the household's own price history: the
  latest price for the same brand if there is one, else the latest for the
  product, scaled by unit price. No qty, or a unit that can't be bridged →
  the line stays unpriced. Prices are never invented.
- The estimate is `reliable` only when >= 60% of lines are priced. Below
  that there is no over-budget warning — a warning built on guesses is worse
  than none.
- Over budget → a warning plus the biggest lines to review. Nothing is ever
  removed; Mom decides.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.history.store import PricePoint
from app.memory.rules import convert_qty

COVERAGE_GATE = 0.6
REVIEW_COUNT = 3


class _Line(Protocol):
    @property
    def id(self) -> str: ...
    @property
    def product_id(self) -> str: ...
    @property
    def product(self) -> str: ...
    @property
    def qty(self) -> float | None: ...
    @property
    def unit(self) -> str | None: ...
    @property
    def brand(self) -> str | None: ...


@dataclass(frozen=True)
class LineEstimate:
    item_id: str
    product: str
    cost: float | None
    """None when the line can't be priced from history."""
    basis: str
    """Plain-English why, shown next to the number."""


@dataclass(frozen=True)
class BudgetEstimate:
    lines: list[LineEstimate]
    total: float
    """Sum of the priced lines only."""
    coverage: float
    """Share of lines priced, 0..1. An empty list counts as fully covered."""
    reliable: bool
    budget: float | None
    over_by: float | None
    """Set only when the estimate is reliable and above the budget."""
    review: list[LineEstimate]
    """Biggest priced lines, largest first — offered for review when over budget, never removed."""


def _money(amount: float, currency: str) -> str:
    return f"{currency}{amount:,.0f}"


def _pick_point(points: Sequence[PricePoint], brand: str | None) -> PricePoint | None:
    """Latest point for the same brand, falling back to the latest for the product."""

    if not points:
        return None
    same_brand = [p for p in points if brand is not None and p.brand == brand]
    return max(same_brand or points, key=lambda p: p.purchased_at)


def price_line(line: _Line, points: Sequence[PricePoint], currency: str = "₹") -> LineEstimate:
    point = _pick_point(points, line.brand)
    if point is None:
        return LineEstimate(line.id, line.product, None, "No price seen for this yet.")
    if line.qty is None or not line.unit:
        return LineEstimate(line.id, line.product, None, "No amount on the list yet.")
    if point.unit_price is None or not point.unit:
        return LineEstimate(line.id, line.product, None, "Last bill had no amount to compare.")
    qty_in_point_unit = convert_qty(line.qty, line.unit, point.unit)
    if qty_in_point_unit is None:
        return LineEstimate(
            line.id, line.product, None, f"Last bought in {point.unit}, listed in {line.unit}."
        )
    cost = round(point.unit_price * qty_in_point_unit, 2)
    brand = f" {point.brand}" if point.brand else ""
    basis = (
        f"Last paid {_money(point.price, currency)} for {point.qty:g} {point.unit}{brand}"
        f" on {point.purchased_at:%d %b}."
    )
    return LineEstimate(line.id, line.product, cost, basis)


def estimate(
    lines: Sequence[_Line],
    prices: Mapping[str, Sequence[PricePoint]],
    budget: float | None = None,
    currency: str = "₹",
) -> BudgetEstimate:
    """Estimate the list total from `prices` (product id → that product's price points)."""

    priced = [price_line(line, prices.get(line.product_id, ()), currency) for line in lines]
    costed = [e for e in priced if e.cost is not None]
    total = round(sum(e.cost for e in costed if e.cost is not None), 2)
    coverage = len(costed) / len(priced) if priced else 1.0
    reliable = coverage >= COVERAGE_GATE
    over_by = (
        round(total - budget, 2) if reliable and budget is not None and total > budget else None
    )
    review = sorted(costed, key=lambda e: e.cost or 0.0, reverse=True)[:REVIEW_COUNT]
    return BudgetEstimate(priced, total, coverage, reliable, budget, over_by, review)


def budget_message(est: BudgetEstimate, currency: str = "₹") -> str | None:
    """The chat line for an estimate, or None when there's nothing worth saying."""

    if not est.reliable:
        return None
    unpriced = sum(1 for e in est.lines if e.cost is None)
    extra = f" (plus {unpriced} item{'s' if unpriced != 1 else ''} I don't have prices for)"
    about = f"This list comes to about {_money(est.total, currency)}{extra if unpriced else ''}."
    if est.over_by is None or est.budget is None:
        return about
    biggest = ", ".join(e.product.lower() for e in est.review)
    return (
        f"{about} That's {_money(est.over_by, currency)} over your"
        f" {_money(est.budget, currency)} budget. The biggest items are {biggest}"
        " — want to look at them?"
    )
