"""Core tables: who lives here, their phones, and the product catalog.

Everything else in the database hangs off `household` and `member`.
This module imports no other model module, so it can always be loaded first.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from .sqltypes import TZDateTime, enum_type, utcnow


class MemberRole(str, Enum):
    OWNER = "owner"
    MEMBER = "member"


class DevicePlatform(str, Enum):
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"


class DismissalKind(str, Enum):
    RESTOCK = "restock"
    PREDICTION = "prediction"


class Household(SQLModel, table=True):
    __tablename__ = "household"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    name: str
    currency: str = "INR"
    timezone: str = "Asia/Kolkata"
    monthly_grocery_budget: float | None = Field(default=None, ge=0)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class Member(SQLModel, table=True):
    """One family member. Anyone can post; the AI checks every post for completeness."""

    __tablename__ = "member"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    name: str
    role: MemberRole = Field(default=MemberRole.MEMBER, sa_type=enum_type(MemberRole))
    relation: str | None = None
    """Free text: mom, dad, son, daughter, grandma …"""
    phone: str | None = Field(default=None, unique=True)
    """E.164, for WhatsApp later."""
    language: str | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class Device(SQLModel, table=True):
    """A phone that receives the pop-up (Expo push token)."""

    __tablename__ = "device"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    member_id: str = Field(foreign_key="member.id", index=True)
    expo_push_token: str = Field(unique=True)
    platform: DevicePlatform = Field(sa_type=enum_type(DevicePlatform))
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    last_seen_at: datetime | None = Field(default=None, sa_type=TZDateTime)


class Product(SQLModel, table=True):
    """Global product catalog (seeded from mobile/src/data/seed.ts)."""

    __tablename__ = "product"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    name: str
    category: str
    """One of the planner's fixed categories (types.ts `Category`)."""
    default_unit: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class ProductAlias(SQLModel, table=True):
    """A word someone says for a product. Several products sharing a word + group = ask which one."""

    __tablename__ = "product_alias"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("alias", "product_id", "household_id", name="uq_product_alias"),
        Index("ix_product_alias_lower", text("lower(alias)")),
    )

    id: int | None = Field(default=None, primary_key=True)
    alias: str
    product_id: str = Field(foreign_key="product.id", index=True)
    disambiguation_group: str | None = Field(default=None, index=True)
    household_id: str | None = Field(default=None, foreign_key="household.id")
    """NULL = everyone's word; set = a word only this household uses."""


class ProductVariant(SQLModel, table=True):
    """A buyable pack: (Aashirvaad, Sona Masoori, 5 kg)."""

    __tablename__ = "product_variant"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    brand: str | None = None
    name: str | None = None
    package_qty: float | None = Field(default=None, ge=0)
    package_unit: str | None = None
    notes: str | None = None


class SuggestionDismissal(SQLModel, table=True):
    """"Not now" on a restock or prediction suggestion (replaces the phone-only dismissed maps)."""

    __tablename__ = "suggestion_dismissal"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    product_id: str = Field(foreign_key="product.id", primary_key=True)
    kind: DismissalKind = Field(primary_key=True, sa_type=enum_type(DismissalKind))
    dismissed_at: datetime = Field(sa_type=TZDateTime)
    snooze_until: datetime | None = Field(default=None, sa_type=TZDateTime)
