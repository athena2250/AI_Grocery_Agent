"""Column types shared by every table, so SQLite (tests) and Postgres (real DB) store the same shapes.

- Timestamps are `timestamptz` in Postgres. The code writes UTC-aware datetimes.
- Enums are stored as their lowercase *value* in a VARCHAR with a CHECK constraint
  (not a native Postgres ENUM), so DBeaver shows `draft`, not `DRAFT`, and adding a value
  later is a constraint change instead of an `ALTER TYPE`.
- JSON is `jsonb` in Postgres, plain JSON elsewhere.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import SQLModel

# Unnamed CHECK constraints (the enum ones) are named per table + column, so the same enum on
# two columns of one table doesn't collide in Postgres. Set before any table is defined.
SQLModel.metadata.naming_convention = {
    **SQLModel.metadata.naming_convention,  # type: ignore[dict-item]
    "ck": "ck_%(table_name)s_%(column_0_name)s",
}

TZDateTime = DateTime(timezone=True)
JSONType = JSON().with_variant(JSONB(), "postgresql")


def enum_type(cls: type[Enum]) -> Any:
    """VARCHAR + CHECK storing each member's value."""

    t = SAEnum(
        cls,
        values_callable=lambda members: [m.value for m in members],
        native_enum=False,
        create_constraint=True,
        length=32,
        validate_strings=True,
    )
    t.name = None  # let the "ck" naming convention name the CHECK per table + column
    return t


def utcnow() -> datetime:
    return datetime.now(UTC)
