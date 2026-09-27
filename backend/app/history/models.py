"""SQL table for purchase history (plan_07).

Column names match the mobile `Purchase` fields (camelCased there) so the
Phase 2 switch needs no adapter code. `price_history` is a read over this table
(see `store.price_history`), never a separate write path.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class PurchaseSource(str, Enum):
    CHAT_CONFIRMED = "chat_confirmed"
    RECEIPT_OCR = "receipt_ocr"
    MANUAL = "manual"


class Purchase(SQLModel, table=True):
    """One confirmed purchase of one product. The LLM never writes these."""

    __tablename__ = "purchase"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(index=True)
    product_id: str = Field(index=True)
    product: str
    """Display name at the time of purchase."""
    product_variant_id: str | None = None
    member_id: str | None = None
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    brand: str | None = None
    package_size: str | None = None
    price: float | None = Field(default=None, ge=0)
    """What was paid for the whole line, as printed."""
    currency: str | None = None
    store: str | None = None
    purchased_at: datetime
    notes: str | None = None
    source: PurchaseSource
