"""`sync_event` — the household's shared change log.

Each phone sends what it changed (add item, tick purchased, add task …) as an event; every phone
replays the household's events in `seq` order through the same pure reducers, so all phones end
up with the same list, pantry, tasks and members. The server only orders and stores events — it
never interprets them. The first event of a new home is usually a snapshot of the phone that
set it up (its data from before sign-in).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Column, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, utcnow

STREAMS = ("grocery", "tasks", "profile")
"""One log per state slice on the phone (HouseholdContext, TasksContext, ProfileContext)."""


class SyncEvent(SQLModel, table=True):
    __tablename__ = "sync_event"  # type: ignore[assignment]
    __table_args__ = (UniqueConstraint("household_id", "client_id"),)

    # BIGSERIAL in Postgres; SQLite only autoincrements a plain INTEGER primary key.
    seq: int | None = Field(
        default=None,
        sa_column=Column(BigInteger().with_variant(Integer(), "sqlite"), primary_key=True, autoincrement=True),
    )
    household_id: str = Field(foreign_key="household.id", index=True)
    stream: str = Field(index=True)
    client_id: str
    """Made by the phone; resending the same event is a no-op."""
    member_id: str | None = Field(default=None, foreign_key="member.id")
    at: datetime = Field(sa_type=TZDateTime)
    """When it happened on the phone — replay uses it as "now", so every phone computes the same."""
    received_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    body: dict[str, Any] = Field(sa_type=JSONType)
