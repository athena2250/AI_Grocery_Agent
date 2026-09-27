"""SQL table for pantry inventory (plan_06).

Column names match the mobile `InventoryEntry` fields (camelCased there) so the
Phase 2 switch needs no adapter code. One row per (household, product).
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.understanding.schema import InventoryStateLiteral


class Inventory(SQLModel, table=True):
    """What's in the house for one product: a coarse state, an amount only if one was said."""

    __tablename__ = "inventory"  # type: ignore[assignment]

    household_id: str = Field(primary_key=True)
    product_id: str = Field(primary_key=True)
    state: InventoryStateLiteral
    approx_qty: float | None = Field(default=None, ge=0)
    approx_unit: str | None = None
    updated_at: datetime
