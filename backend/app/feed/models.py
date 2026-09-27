"""The family feed: every message a member sends becomes a `post`.

A post starts as `draft`. The AI extracts fields into `fields_json`, the deterministic
completeness check (see `completeness.py`) compares them with `post_kind_field`, and the
post only reaches `published` — the pop-up for everyone else — once nothing required is
missing and the author tapped Send.

Kinds are rows in `post_kind`, and what each kind needs is rows in `post_kind_field`,
so a new kind ("doctor appointment") is data, not code.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class PostStatus(str, Enum):
    DRAFT = "draft"
    """Just typed; not yet checked."""
    CLARIFYING = "clarifying"
    """Something required is missing; questions are open to the author."""
    READY = "ready"
    """Complete; waiting for the author to tap Send."""
    PUBLISHED = "published"
    DONE = "done"
    CANCELLED = "cancelled"


class Priority(str, Enum):
    NORMAL = "normal"
    URGENT = "urgent"


class FieldScope(str, Enum):
    POST = "post"
    ITEM = "item"
    """Checked on every entry of `fields_json["items"]` (grocery lines)."""


class ReminderStopOn(str, Enum):
    ACKNOWLEDGED = "acknowledged"
    DONE = "done"


class ReminderChannel(str, Enum):
    PUSH = "push"
    IN_APP = "in_app"
    WHATSAPP = "whatsapp"


class PostKind(SQLModel, table=True):
    __tablename__ = "post_kind"  # type: ignore[assignment]

    kind: str = Field(primary_key=True)
    label: str
    description: str | None = None
    is_active: bool = True


class PostKindField(SQLModel, table=True):
    """One field a post of this kind must (or may) carry, and how to ask for it."""

    __tablename__ = "post_kind_field"  # type: ignore[assignment]

    kind: str = Field(foreign_key="post_kind.kind", primary_key=True)
    field: str = Field(primary_key=True)
    label: str
    required: bool = True
    applies_to: FieldScope = Field(default=FieldScope.POST, sa_type=enum_type(FieldScope))
    question: str
    """What the AI asks when this is missing, e.g. "When do you need it at home?"."""
    default_chips: list[str] = Field(default_factory=list, sa_type=JSONType)
    depends_on_field: str | None = None
    depends_on_value: Any | None = Field(default=None, sa_type=JSONType)
    """Only required when `depends_on_field` equals this (alert: interval only if repeat is true)."""
    position: int = 0


class Post(SQLModel, table=True):
    __tablename__ = "post"  # type: ignore[assignment]
    __table_args__ = (Index("ix_post_feed", "household_id", "status", "published_at"),)

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    author_member_id: str = Field(foreign_key="member.id", index=True)
    kind: str = Field(foreign_key="post_kind.kind")
    ref_id: str | None = None
    """Id of the grocery_list / task / bill_payment this post is about."""
    raw_text: str
    """Exactly what the author typed — kept for audit."""
    fields_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSONType)
    missing_fields_json: list[dict[str, Any]] = Field(default_factory=list, sa_type=JSONType)
    title: str | None = None
    body: str | None = None
    priority: Priority = Field(default=Priority.NORMAL, sa_type=enum_type(Priority))
    status: PostStatus = Field(default=PostStatus.DRAFT, sa_type=enum_type(PostStatus))
    published_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    updated_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class PostRecipient(SQLModel, table=True):
    __tablename__ = "post_recipient"  # type: ignore[assignment]

    post_id: str = Field(foreign_key="post.id", primary_key=True)
    member_id: str = Field(foreign_key="member.id", primary_key=True)
    delivered_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    seen_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    acknowledged_at: datetime | None = Field(default=None, sa_type=TZDateTime)


class PostComment(SQLModel, table=True):
    __tablename__ = "post_comment"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    post_id: str = Field(foreign_key="post.id", index=True)
    member_id: str = Field(foreign_key="member.id")
    text: str
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class Reminder(SQLModel, table=True):
    """Keep alerting one member every `interval_minutes` until they acknowledge / finish."""

    __tablename__ = "reminder"  # type: ignore[assignment]
    __table_args__ = (Index("ix_reminder_due", "active", "next_fire_at"),)

    id: str = Field(primary_key=True)
    post_id: str = Field(foreign_key="post.id", index=True)
    member_id: str = Field(foreign_key="member.id", index=True)
    created_by_member_id: str | None = Field(default=None, foreign_key="member.id")
    interval_minutes: int = Field(gt=0)
    next_fire_at: datetime = Field(sa_type=TZDateTime)
    stop_on: ReminderStopOn = Field(
        default=ReminderStopOn.ACKNOWLEDGED, sa_type=enum_type(ReminderStopOn)
    )
    max_times: int | None = Field(default=None, gt=0)
    times_sent: int = 0
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class ReminderLog(SQLModel, table=True):
    """Proof each alert went out."""

    __tablename__ = "reminder_log"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    reminder_id: str = Field(foreign_key="reminder.id", index=True)
    fired_at: datetime = Field(sa_type=TZDateTime)
    channel: ReminderChannel = Field(sa_type=enum_type(ReminderChannel))
    delivered: bool = False
    error: str | None = None
