"""SQL tables for the grocery list (plan_08).

Column names match the mobile `GroceryList` / `ListItem` fields (camelCased
there) so the Phase 2 switch needs no adapter code. The mobile sandbox keeps a
single list, so `list_id` / `household_id` are implicit on that side.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class ListStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"


class ItemStatus(str, Enum):
    """`pending → purchased | removed`. Removal is soft: kept for audit, hidden from the list view."""

    PENDING = "pending"
    PURCHASED = "purchased"
    REMOVED = "removed"


class GroceryList(SQLModel, table=True):
    __tablename__ = "grocery_list"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(index=True)
    status: ListStatus = ListStatus.DRAFT
    created_at: datetime


class GroceryListItem(SQLModel, table=True):
    __tablename__ = "grocery_list_item"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    list_id: str = Field(foreign_key="grocery_list.id", index=True)
    product_id: str
    product: str
    """Display name at the time it was added."""
    variant_id: str | None = None
    """Reserved for a variant catalog; today the variant is the free-text `variant`."""
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    brand: str | None = None
    variant: str | None = None
    category: str
    source: str
    confidence: str
    rationale: str
    status: ItemStatus = ItemStatus.PENDING
    needs_clarification: bool = False
    clarification_prompt: str | None = None
    position: int = 0
    """Order added within the list — rows from one turn share `created_at`."""
    created_at: datetime
