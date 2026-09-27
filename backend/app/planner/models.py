"""SQL tables for the grocery list (plan_08).

Column names match the mobile `GroceryList` / `ListItem` fields (camelCased
there) so the Phase 2 switch needs no adapter code. The mobile sandbox keeps a
single list, so `list_id` / `household_id` are implicit on that side.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

import app.feed.models  # noqa: F401  (registers household/member/product/post for the FKs below)
from app.core.sqltypes import TZDateTime, enum_type


class ListStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    COMPLETED = "completed"
    """Everything bought. Clarifying / published live on the list's `post`."""


class ItemStatus(str, Enum):
    """`pending → purchased | removed`. Removal is soft: kept for audit, hidden from the list view."""

    PENDING = "pending"
    PURCHASED = "purchased"
    REMOVED = "removed"


class ItemPriceSource(str, Enum):
    """Where an item's expected rate came from. Never `guess` — no rate means ask."""

    USER = "user"
    PURCHASE_HISTORY = "purchase_history"
    MARKET = "market"


class GroceryList(SQLModel, table=True):
    __tablename__ = "grocery_list"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    status: ListStatus = Field(default=ListStatus.DRAFT, sa_type=enum_type(ListStatus))
    created_by_member_id: str | None = Field(default=None, foreign_key="member.id")
    needed_by: datetime | None = Field(default=None, sa_type=TZDateTime)
    """Default "needed at home by" for every item; an item's own `needed_by` wins."""
    post_id: str | None = Field(default=None, foreign_key="post.id")
    """The feed post that announces this list."""
    created_at: datetime = Field(sa_type=TZDateTime)


class GroceryListItem(SQLModel, table=True):
    __tablename__ = "grocery_list_item"  # type: ignore[assignment]
    __table_args__ = (Index("ix_list_item_render", "list_id", "status"),)

    id: str = Field(primary_key=True)
    list_id: str = Field(foreign_key="grocery_list.id", index=True)
    product_id: str = Field(foreign_key="product.id")
    product: str
    """Display name at the time it was added."""
    variant_id: str | None = Field(default=None, foreign_key="product_variant.id")
    """Reserved for a variant catalog; today the variant is the free-text `variant`."""
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    brand: str | None = None
    variant: str | None = None
    category: str
    source: str
    confidence: str
    rationale: str
    status: ItemStatus = Field(default=ItemStatus.PENDING, sa_type=enum_type(ItemStatus))
    needs_clarification: bool = False
    clarification_prompt: str | None = None
    position: int = 0
    """Order added within the list — rows from one turn share `created_at`."""
    needed_by: datetime | None = Field(default=None, sa_type=TZDateTime)
    expected_unit_price: float | None = Field(default=None, ge=0)
    """Expected market rate per `unit`. Required before the list's post can be published."""
    expected_total: float | None = Field(default=None, ge=0)
    price_source: ItemPriceSource | None = Field(default=None, sa_type=enum_type(ItemPriceSource))
    added_by_member_id: str | None = Field(default=None, foreign_key="member.id")
    created_at: datetime = Field(sa_type=TZDateTime)
