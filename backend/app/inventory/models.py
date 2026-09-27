"""SQL tables for pantry inventory (plan_06).

Column names match the mobile `InventoryEntry` fields (camelCased there) so the
Phase 2 switch needs no adapter code. `inventory` is one row per (household, product)
— the current snapshot. `inventory_event` is the history of how it got there.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/product for the FKs below)
from app.core.sqltypes import TZDateTime, enum_type, utcnow
from app.understanding.schema import InventoryStateLiteral


class Inventory(SQLModel, table=True):
    """What's in the house for one product: a coarse state, an amount only if one was said."""

    __tablename__ = "inventory"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    product_id: str = Field(foreign_key="product.id", primary_key=True)
    state: InventoryStateLiteral = Field(sa_type=enum_type(InventoryStateLiteral))
    approx_qty: float | None = Field(default=None, ge=0)
    approx_unit: str | None = None
    updated_at: datetime = Field(sa_type=TZDateTime)


class InventoryEventSource(str, Enum):
    CHAT = "chat"
    RECEIPT = "receipt"
    MANUAL = "manual"
    PURCHASE = "purchase"


class InventoryEvent(SQLModel, table=True):
    """One pantry change ("rice is almost finished"), kept for prediction and audit."""

    __tablename__ = "inventory_event"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    member_id: str | None = Field(default=None, foreign_key="member.id")
    old_state: InventoryStateLiteral | None = Field(
        default=None, sa_type=enum_type(InventoryStateLiteral)
    )
    new_state: InventoryStateLiteral = Field(sa_type=enum_type(InventoryStateLiteral))
    approx_qty: float | None = Field(default=None, ge=0)
    approx_unit: str | None = None
    source: InventoryEventSource = Field(sa_type=enum_type(InventoryEventSource))
    turn_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
