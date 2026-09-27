"""SQL tables for household memory (plan_05).

Column names match the mobile `Preference` / `AliasPreference` fields
(camelCased there) so the Phase 2 switch needs no adapter code.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Preference(SQLModel, table=True):
    """What this household usually buys for one product."""

    __tablename__ = "preference"  # type: ignore[assignment]

    household_id: str = Field(primary_key=True)
    product_id: str = Field(primary_key=True)
    preferred_brand: str | None = None
    preferred_variant: str | None = None
    typical_qty: float | None = None
    typical_unit: str | None = None
    typical_interval_days: int | None = None
    confidence: float = Field(ge=0, le=1)
    last_confirmed_at: datetime
    times_confirmed: int = 0
    times_overridden: int = 0


class AliasPreference(SQLModel, table=True):
    """Per-household default for a disambiguation group ("coriander" → seeds)."""

    __tablename__ = "alias_preference"  # type: ignore[assignment]

    household_id: str = Field(primary_key=True)
    disambiguation_group: str = Field(primary_key=True)
    product_id: str
    confidence: float = Field(ge=0, le=1)
    last_confirmed_at: datetime
    times_confirmed: int = 0
    times_overridden: int = 0
