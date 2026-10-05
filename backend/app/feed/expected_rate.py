"""A grocery item's expected market rate, from what the family actually paid. Never asked.

`expected_rate` is optional in `post_kind_field`: nobody is asked for a price. This module
fills it from the household's own purchase history (`purchase.price / qty`), falling back
to `market_price` rows. With no observations in that unit it stays empty and the item is
marked `price_source: "unknown"` — a price is never invented (principle 2).

`estimate_rate` / `fill_expected_rates` are pure; `observations_for` is the one DB read.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median
from typing import Any

from sqlmodel import Session, col, select

from app.history.store import price_history
from app.memory.rules import as_utc
from app.pricing.models import MarketPrice

MAX_AGE = timedelta(days=180)
RECENT = 3
"""Median of the last few prices: one festival-week spike doesn't set the rate."""

# unit → (base unit, how many base units one of it is)
UNITS: dict[str, tuple[str, float]] = {
    "kg": ("kg", 1), "kgs": ("kg", 1), "kilo": ("kg", 1), "g": ("kg", 0.001), "gm": ("kg", 0.001),
    "gms": ("kg", 0.001), "grams": ("kg", 0.001),
    "l": ("l", 1), "litre": ("l", 1), "liter": ("l", 1), "ml": ("l", 0.001),
    "pcs": ("pcs", 1), "pc": ("pcs", 1), "piece": ("pcs", 1), "dozen": ("pcs", 12),
    "pack": ("pack", 1), "packet": ("pack", 1), "bunch": ("bunch", 1),
}


@dataclass(frozen=True)
class RateObservation:
    unit: str | None
    unit_price: float
    """Currency per one `unit`."""
    observed_at: datetime
    source: str
    """"purchase_history" or "market_price"."""


@dataclass(frozen=True)
class RateEstimate:
    rate: float
    unit: str
    source: str
    observations: int
    last_seen: datetime


def _per(unit: str | None, unit_price: float, target: str) -> float | None:
    """`unit_price` per `unit` → per `target`, or None if they don't convert."""

    a, b = UNITS.get((unit or "").lower()), UNITS.get(target.lower())
    if a is None or b is None or a[0] != b[0]:
        return None
    return unit_price / a[1] * b[1]


def estimate_rate(
    observations: Sequence[RateObservation], unit: str, now: datetime
) -> RateEstimate | None:
    """Median of the most recent purchase prices in a convertible unit; market prices only
    if the family has no purchases of it in the last six months."""

    for source in ("purchase_history", "market_price"):
        usable = sorted(
            (
                (o.observed_at, per)
                for o in observations
                if o.source == source and now - o.observed_at <= MAX_AGE
                and (per := _per(o.unit, o.unit_price, unit)) is not None
            ),
            reverse=True,
        )[:RECENT]
        if usable:
            return RateEstimate(
                rate=round(median(p for _, p in usable), 4), unit=unit, source=source,
                observations=len(usable), last_seen=usable[0][0],
            )
    return None


def fill_expected_rates(
    fields: Mapping[str, Any],
    lookup: Callable[[Mapping[str, Any]], Sequence[RateObservation]],
    now: datetime,
) -> dict[str, Any]:
    """Grocery `fields_json` with `expected_rate` filled where history allows.

    `lookup(item)` returns observations for that item's product (the caller maps the item
    to a product id). Items that already carry a rate (the author typed one) are kept.
    """

    items = []
    for item in fields.get("items", []):
        item = dict(item)
        if item.get("expected_rate") is None:
            est = estimate_rate(lookup(item), item["unit"], now) if item.get("unit") else None
            if est:
                item.update(expected_rate=est.rate, expected_rate_unit=est.unit,
                            price_source=est.source)
                if item.get("qty") is not None:
                    item["expected_total"] = round(est.rate * float(item["qty"]), 2)
            else:
                item["price_source"] = "unknown"
        else:
            item.setdefault("price_source", "user")
        items.append(item)
    return {**fields, "items": items}


def observations_for(
    session: Session, household_id: str, product_id: str
) -> list[RateObservation]:
    """This household's priced purchases of the product, plus market_price rows
    (household-specific or general)."""

    out = [
        RateObservation(p.unit, p.unit_price, as_utc(p.purchased_at), "purchase_history")
        for p in price_history(session, household_id, product_id)
        if p.unit_price is not None
    ]
    rows = session.exec(
        select(MarketPrice).where(
            MarketPrice.product_id == product_id,
            (col(MarketPrice.household_id) == household_id) | col(MarketPrice.household_id).is_(None),
        )
    )
    out += [RateObservation(r.unit, r.price, as_utc(r.observed_at), "market_price") for r in rows]
    return out
