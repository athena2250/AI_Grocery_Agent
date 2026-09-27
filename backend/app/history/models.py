"""SQL table for purchase history (plan_07).

Column names match the mobile `Purchase` fields (camelCased there) so the
Phase 2 switch needs no adapter code. `price_history` is a read over this table
(see `store.price_history`), never a separate write path.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member/product for the FKs below)
from app.core.sqltypes import TZDateTime, enum_type


class PurchaseSource(str, Enum):
    CHAT_CONFIRMED = "chat_confirmed"
    RECEIPT_OCR = "receipt_ocr"
    MANUAL = "manual"


class Purchase(SQLModel, table=True):
    """One confirmed purchase of one product. The LLM never writes these."""

    __tablename__ = "purchase"  # type: ignore[assignment]
    __table_args__ = (
        Index("ix_purchase_interval", "household_id", "product_id", "purchased_at"),
    )

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    product: str
    """Display name at the time of purchase."""
    product_variant_id: str | None = Field(default=None, foreign_key="product_variant.id")
    member_id: str | None = Field(default=None, foreign_key="member.id")
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    brand: str | None = None
    package_size: str | None = None
    price: float | None = Field(default=None, ge=0)
    """What was paid for the whole line, as printed."""
    currency: str | None = None
    store: str | None = None
    purchased_at: datetime = Field(sa_type=TZDateTime)
    notes: str | None = None
    source: PurchaseSource = Field(sa_type=enum_type(PurchaseSource))
