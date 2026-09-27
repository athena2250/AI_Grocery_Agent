"""Household tasks: plumbing, repairs, ticket booking, "pay the current bill" …

A task is always announced through a `post`. Repeated alerts are `reminder` rows on that post.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlmodel import Field, SQLModel

import app.feed.models  # noqa: F401  (registers post/member for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow
from app.feed.models import Priority


class TaskStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class Task(SQLModel, table=True):
    __tablename__ = "task"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    created_by_member_id: str = Field(foreign_key="member.id")
    assigned_to_member_id: str | None = Field(default=None, foreign_key="member.id", index=True)
    category: str
    """plumbing / electrical / repair / maintenance / ticket_booking / bill / internet / other — free text."""
    title: str
    details: str | None = None
    details_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSONType)
    """Kind-specific extras, e.g. tickets: {from, to, travel_date, passengers, mode}."""
    location_in_house: str | None = None
    budget: float | None = Field(default=None, ge=0)
    due_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    priority: Priority = Field(default=Priority.NORMAL, sa_type=enum_type(Priority))
    status: TaskStatus = Field(default=TaskStatus.OPEN, sa_type=enum_type(TaskStatus))
    done_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    post_id: str | None = Field(default=None, foreign_key="post.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    updated_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class TaskEvent(SQLModel, table=True):
    """Who moved the task, when, and what they said."""

    __tablename__ = "task_event"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    task_id: str = Field(foreign_key="task.id", index=True)
    member_id: str | None = Field(default=None, foreign_key="member.id")
    from_status: TaskStatus | None = Field(default=None, sa_type=enum_type(TaskStatus))
    to_status: TaskStatus = Field(sa_type=enum_type(TaskStatus))
    note: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
