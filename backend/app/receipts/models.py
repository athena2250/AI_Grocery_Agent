"""SQL tables for receipt review drafts (plan_09).

A parsed receipt is only ever a draft. Nothing reaches `purchase`, `inventory`
or memory until the user approves it (see `store.approve_receipt`).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member/product for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type


class ReceiptStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    DISCARDED = "discarded"


class LineStatus(str, Enum):
    READY = "ready"
    NEEDS_REVIEW = "needs_review"
    SKIPPED = "skipped"


class Receipt(SQLModel, table=True):
    __tablename__ = "receipt"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    uploaded_by_member_id: str | None = Field(default=None, foreign_key="member.id")
    status: ReceiptStatus = Field(default=ReceiptStatus.DRAFT, sa_type=enum_type(ReceiptStatus))
    store: str | None = None
    """None until detected or answered — the draft then asks which shop it was."""
    store_header: str | None = None
    """`rules.header_key` of the receipt, used to remember an unknown shop."""
    purchased_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    """The date printed on the receipt; approval falls back to the approval time."""
    ocr_text: str
    """Kept for audit and re-parsing."""
    created_at: datetime = Field(sa_type=TZDateTime)


class ReceiptLine(SQLModel, table=True):
    __tablename__ = "receipt_line"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    receipt_id: str = Field(foreign_key="receipt.id", index=True)
    position: int
    raw_line: str
    product_guess: str | None = None
    product_id: str | None = Field(default=None, foreign_key="product.id")
    product: str | None = None
    brand: str | None = None
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    package_size: str | None = None
    price: float | None = Field(default=None, ge=0)
    confidence: str
    status: LineStatus = Field(sa_type=enum_type(LineStatus))
    review_kind: str | None = None
    review_question: str | None = None
    review_options: list[str] = Field(default_factory=list, sa_type=JSONType)


class StoreAlias(SQLModel, table=True):
    """A shop the household named once for a receipt header we didn't recognise."""

    __tablename__ = "store_alias"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    header_key: str = Field(primary_key=True)
    store: str
