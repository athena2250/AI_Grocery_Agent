"""Purchase history reads and writes (plan_07).

Rows are written only for confirmed purchases — a list item marked bought, an
approved receipt, a manual add. Writes are added to the session; the caller commits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlmodel import Session, col, select

from .models import Purchase


@dataclass(frozen=True)
class PricePoint:
    """One point of a product's price series (plan_07's `price_history` view)."""

    purchased_at: datetime
    price: float
    qty: float | None
    unit: str | None
    unit_price: float | None
    """`price / qty` in currency per `unit`; None when the qty is unknown."""
    brand: str | None
    package_size: str | None
    store: str | None


def log_purchase(session: Session, purchase: Purchase) -> Purchase:
    session.add(purchase)
    return purchase


def last_purchased_at(
    session: Session, household_id: str, product_id: str, before: datetime
) -> datetime | None:
    """The most recent purchase of this product strictly before `before`."""

    return session.exec(
        select(Purchase.purchased_at)
        .where(
            Purchase.household_id == household_id,
            Purchase.product_id == product_id,
            col(Purchase.purchased_at) < before,
        )
        .order_by(col(Purchase.purchased_at).desc())
    ).first()


def price_history(
    session: Session, household_id: str, product_id: str, brand: str | None = None
) -> list[PricePoint]:
    """Priced purchases of one product (optionally one brand), oldest first."""

    query = select(Purchase).where(
        Purchase.household_id == household_id,
        Purchase.product_id == product_id,
        col(Purchase.price).is_not(None),
    )
    if brand is not None:
        query = query.where(Purchase.brand == brand)
    return [
        PricePoint(
            purchased_at=p.purchased_at,
            price=p.price,
            qty=p.qty,
            unit=p.unit,
            unit_price=round(p.price / p.qty, 2) if p.qty else None,
            brand=p.brand,
            package_size=p.package_size,
            store=p.store,
        )
        for p in session.exec(query.order_by(col(Purchase.purchased_at)))
        if p.price is not None
    ]
