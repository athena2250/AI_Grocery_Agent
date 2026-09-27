"""Purchase prediction rules (plan_10). Statistics, not ML — pure functions, no I/O, no LLM.

Mirrors mobile/src/state/prediction.ts; keep the numbers in sync.

  - Only products with >= 3 purchases (trips < 1 day apart count once) get a
    prediction. No extrapolating from one or two data points.
  - mean / std = exponentially-weighted mean / stddev of the gaps, alpha = 0.4.
  - BUY_NOW     if days_since >= mean - 0.5 * std
    LIKELY_SOON if days_since >= mean - 1.5 * std
    NOT_NEEDED  otherwise.
  - Pantry `almost_finished` / `out` forces BUY_NOW.
  - Pantry `available` said within the cooldown (half an interval, <= 7 days)
    demotes BUY_NOW to LIKELY_SOON — the house just said it has enough.

Predictions only ever become proposals flagged `needs_confirmation` — never auto-added.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from itertools import pairwise
from typing import Literal, cast

from app.ambiguity.safety_net import Catalog
from app.history.models import Purchase
from app.inventory.models import Inventory
from app.inventory.store import needs_restock
from app.memory.rules import as_utc, confidence_level
from app.planner.rules import Category, Confidence, ProposedListItem, categorize
from app.understanding.schema import InventoryStateLiteral

MIN_PURCHASES = 3
EW_ALPHA = 0.4
BUY_NOW_STDS = 0.5
LIKELY_SOON_STDS = 1.5
COOLDOWN_FRACTION = 0.5
COOLDOWN_MAX_DAYS = 7.0
SNOOZE = timedelta(days=3)
"""A "Not now" on a suggestion hides it for this long."""

_DAY = timedelta(days=1)
_STATE_LABEL = {
    "available": "stocked up",
    "running_low": "running low",
    "almost_finished": "almost finished",
    "out": "finished",
}


class PredictionStatus(str, Enum):
    BUY_NOW = "BUY_NOW"
    LIKELY_SOON = "LIKELY_SOON"
    NOT_NEEDED = "NOT_NEEDED"


PredictionReason = Literal["interval", "pantry_low", "pantry_cooldown"]


@dataclass(frozen=True)
class Prediction:
    product_id: str
    status: PredictionStatus
    reason: PredictionReason
    mean_interval_days: float
    std_interval_days: float
    days_since: float
    last_purchased_at: datetime
    purchase_count: int


def _days(a: datetime, b: datetime) -> float:
    return (as_utc(b) - as_utc(a)) / _DAY


def ew_stats(intervals: Sequence[float], alpha: float = EW_ALPHA) -> tuple[float, float]:
    """Exponentially-weighted (mean, stddev) — the standard incremental EW variance, oldest first."""

    mean = intervals[0]
    variance = 0.0
    for x in intervals[1:]:
        diff = x - mean
        incr = alpha * diff
        mean += incr
        variance = (1 - alpha) * (variance + diff * incr)
    return mean, math.sqrt(variance)


def classify(days_since: float, mean: float, std: float) -> PredictionStatus:
    if days_since >= mean - BUY_NOW_STDS * std:
        return PredictionStatus.BUY_NOW
    if days_since >= mean - LIKELY_SOON_STDS * std:
        return PredictionStatus.LIKELY_SOON
    return PredictionStatus.NOT_NEEDED


def _trips(purchased_at: Iterable[datetime]) -> list[datetime]:
    """Purchase times oldest first, with purchases less than a day apart folded into one trip."""

    out: list[datetime] = []
    for at in sorted(as_utc(t) for t in purchased_at):
        if not out or _days(out[-1], at) >= 1:
            out.append(at)
    return out


def predict_product(
    product_id: str,
    purchased_at: Iterable[datetime],
    pantry: Inventory | None,
    now: datetime,
) -> Prediction | None:
    """One product's prediction, or None when there isn't enough history."""

    trips = _trips(purchased_at)
    if len(trips) < MIN_PURCHASES:
        return None
    intervals = [_days(a, b) for a, b in pairwise(trips)]
    mean, std = ew_stats(intervals)
    days_since = _days(trips[-1], now)

    status = classify(days_since, mean, std)
    reason: PredictionReason = "interval"
    if pantry is not None and needs_restock(pantry.state):
        status, reason = PredictionStatus.BUY_NOW, "pantry_low"
    elif (
        status is PredictionStatus.BUY_NOW
        and pantry is not None
        and pantry.state == InventoryStateLiteral.AVAILABLE
        and _days(pantry.updated_at, now) < min(COOLDOWN_MAX_DAYS, COOLDOWN_FRACTION * mean)
    ):
        status, reason = PredictionStatus.LIKELY_SOON, "pantry_cooldown"
    return Prediction(
        product_id=product_id,
        status=status,
        reason=reason,
        mean_interval_days=mean,
        std_interval_days=std,
        days_since=days_since,
        last_purchased_at=trips[-1],
        purchase_count=len(trips),
    )


def predict(
    purchases: Sequence[Purchase], inventory: Sequence[Inventory], now: datetime
) -> list[Prediction]:
    """Predictions for every product with enough history, in product-id order."""

    by_product: dict[str, list[datetime]] = {}
    for p in purchases:
        by_product.setdefault(p.product_id, []).append(p.purchased_at)
    pantry = {row.product_id: row for row in inventory}
    out: list[Prediction] = []
    for product_id in sorted(by_product):
        prediction = predict_product(
            product_id, by_product[product_id], pantry.get(product_id), now
        )
        if prediction is not None:
            out.append(prediction)
    return out


def _amount(qty: float | None, unit: str | None, brand: str | None) -> str:
    return f"{qty:g} {unit}" + (f" {brand}" if brand else "")


def prediction_proposals(
    predictions: Sequence[Prediction],
    purchases: Sequence[Purchase],
    inventory: Sequence[Inventory],
    on_list_product_ids: Iterable[str],
    catalog: Catalog,
    now: datetime,
    dismissed: Mapping[str, datetime] | None = None,
) -> list[ProposedListItem]:
    """BUY_NOW predictions → proposals for products not on the list and not snoozed, most overdue first.

    The amount is the household's usual if memory has one, else what was bought
    last time — never an invented one. `dismissed` maps product id → when the
    user said "Not now"; it's hidden for `SNOOZE`.
    """

    on_list = set(on_list_product_ids)
    dismissed = dismissed or {}
    pantry = {row.product_id: row for row in inventory}
    due = sorted(
        (
            p
            for p in predictions
            if p.status is PredictionStatus.BUY_NOW
            and p.product_id not in on_list
            and not (
                p.product_id in dismissed and as_utc(now) - as_utc(dismissed[p.product_id]) < SNOOZE
            )
        ),
        key=lambda p: p.days_since / p.mean_interval_days,
        reverse=True,
    )
    out: list[ProposedListItem] = []
    for p in due:
        product = catalog.product(p.product_id)
        if product is None:
            continue
        pref = catalog.preference(product.id)
        usual = pref if pref and pref.typical_qty is not None and pref.typical_unit else None
        last = next(
            (
                h
                for h in purchases
                if h.product_id == p.product_id and as_utc(h.purchased_at) == p.last_purchased_at
            ),
            None,
        )
        last_amount = last if not usual and last and last.qty is not None and last.unit else None
        name = product.name.lower()
        rationale = (
            f"You buy {name} about every {round(p.mean_interval_days)} days"
            f" — last bought {round(p.days_since)} days ago."
        )
        row = pantry.get(p.product_id)
        if p.reason == "pantry_low" and row is not None:
            rationale += f" Pantry says {name} is {_STATE_LABEL[row.state.value]}."
        qty, unit, brand = None, None, None
        if usual:
            qty, unit, brand = usual.typical_qty, usual.typical_unit, usual.preferred_brand
            rationale += f" You usually get {_amount(qty, unit, brand)}."
        elif last_amount:
            qty, unit, brand = last_amount.qty, last_amount.unit, last_amount.brand
            rationale += f" Last time: {_amount(qty, unit, brand)}."
        out.append(
            ProposedListItem(
                product_id=product.id,
                product=product.name,
                qty=qty,
                unit=unit,
                brand=brand,
                variant=usual.preferred_variant if usual else None,
                category=categorize(product.id, catalog, Category.HOUSEHOLD),
                source="purchase_history",
                confidence=cast(Confidence, confidence_level(usual.confidence)) if usual else "low",
                rationale=rationale,
                needs_confirmation=True,
            )
        )
    return out
