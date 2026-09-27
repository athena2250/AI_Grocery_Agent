"""SQL tables for household memory (plan_05).

Column names match the mobile `Preference` / `AliasPreference` fields
(camelCased there) so the Phase 2 switch needs no adapter code.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/product for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class Preference(SQLModel, table=True):
    """What this household usually buys for one product."""

    __tablename__ = "preference"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    product_id: str = Field(foreign_key="product.id", primary_key=True)
    preferred_brand: str | None = None
    preferred_variant: str | None = None
    typical_qty: float | None = None
    typical_unit: str | None = None
    typical_interval_days: int | None = None
    confidence: float = Field(ge=0, le=1)
    last_confirmed_at: datetime = Field(sa_type=TZDateTime)
    times_confirmed: int = 0
    times_overridden: int = 0


class AliasPreference(SQLModel, table=True):
    """Per-household default for a disambiguation group ("coriander" → seeds)."""

    __tablename__ = "alias_preference"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    disambiguation_group: str = Field(primary_key=True)
    product_id: str = Field(foreign_key="product.id")
    confidence: float = Field(ge=0, le=1)
    last_confirmed_at: datetime = Field(sa_type=TZDateTime)
    times_confirmed: int = 0
    times_overridden: int = 0


class MemoryAction(str, Enum):
    CREATED = "created"
    CONFIRMED = "confirmed"
    OVERRIDDEN = "overridden"


class MemoryEvent(SQLModel, table=True):
    """Why memory changed: every confirmed/overridden write, with before/after. Principle 7 audit trail."""

    __tablename__ = "memory_event"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    member_id: str | None = Field(default=None, foreign_key="member.id")
    product_id: str | None = Field(default=None, foreign_key="product.id")
    disambiguation_group: str | None = None
    action: MemoryAction = Field(sa_type=enum_type(MemoryAction))
    before_json: dict[str, Any] | None = Field(default=None, sa_type=JSONType)
    after_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSONType)
    turn_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
