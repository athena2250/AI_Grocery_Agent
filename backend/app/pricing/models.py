"""Observed market rates — where a grocery item's "expected rate" chip comes from.

Rows come from what the family actually paid or typed. Nothing here is invented;
if there's no row, the AI asks the author for the rate.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers product/household for the FKs below)
from app.core.sqltypes import TZDateTime, enum_type


class PriceSource(str, Enum):
    MANUAL = "manual"
    PURCHASE = "purchase"
    RECEIPT = "receipt"
    ONLINE = "online"


class MarketPrice(SQLModel, table=True):
    __tablename__ = "market_price"  # type: ignore[assignment]
    __table_args__ = (Index("ix_market_price_lookup", "product_id", "observed_at"),)

    id: str = Field(primary_key=True)
    product_id: str = Field(foreign_key="product.id")
    household_id: str | None = Field(default=None, foreign_key="household.id")
    """NULL = a general rate; set = what this household saw/paid."""
    unit: str
    """Price is per this unit (per kg, per L, per pack)."""
    price: float = Field(ge=0)
    currency: str = "INR"
    source: PriceSource = Field(sa_type=enum_type(PriceSource))
    store: str | None = None
    observed_at: datetime = Field(sa_type=TZDateTime)
