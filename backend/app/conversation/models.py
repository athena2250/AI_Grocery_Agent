"""Chat log and the questions the AI is waiting on (replaces the phone-only `turns` / `pendingClarifications`)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

import app.feed.models  # noqa: F401  (registers post/member for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class TurnRole(str, Enum):
    USER = "user"
    AGENT = "agent"


class Channel(str, Enum):
    APP = "app"
    WHATSAPP = "whatsapp"


class ClarificationStatus(str, Enum):
    OPEN = "open"
    ANSWERED = "answered"
    EXPIRED = "expired"


class ClarificationTarget(str, Enum):
    POST = "post"
    GROCERY_ITEM = "grocery_item"


class ConversationTurn(SQLModel, table=True):
    __tablename__ = "conversation_turn"  # type: ignore[assignment]
    __table_args__ = (Index("ix_turn_household_time", "household_id", "created_at"),)

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id")
    member_id: str | None = Field(default=None, foreign_key="member.id")
    """Who typed it (user turns); NULL for agent turns."""
    role: TurnRole = Field(sa_type=enum_type(TurnRole))
    text: str
    channel: Channel = Field(default=Channel.APP, sa_type=enum_type(Channel))
    intent: str | None = None
    parsed_json: dict[str, Any] | None = Field(default=None, sa_type=JSONType)
    """The LLM's structured output for this turn — audit + future eval data."""
    chips: list[str] = Field(default_factory=list, sa_type=JSONType)
    clarification_id: str | None = None
    """The question this agent turn asked (see pending_clarification.turn_id for the reverse link)."""
    post_id: str | None = Field(default=None, foreign_key="post.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class PendingClarification(SQLModel, table=True):
    """One missing field the AI asked the author about. Answered → the field is filled and re-checked."""

    __tablename__ = "pending_clarification"  # type: ignore[assignment]
    __table_args__ = (Index("ix_clarification_open", "household_id", "status"),)

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id")
    post_id: str | None = Field(default=None, foreign_key="post.id", index=True)
    asked_member_id: str | None = Field(default=None, foreign_key="member.id")
    turn_id: str | None = Field(default=None, foreign_key="conversation_turn.id")
    target_kind: ClarificationTarget = Field(
        default=ClarificationTarget.POST, sa_type=enum_type(ClarificationTarget)
    )
    target_id: str | None = None
    """Post id, or grocery_list_item id for a per-item question."""
    field: str
    """product / qty / expected_rate / needed_by / assigned_to / travel_date …"""
    kind: str | None = None
    """The mobile `Clarification.kind` (product_type, quantity, brand, …) when it came from the chat flow."""
    item_raw_text: str | None = None
    question: str
    options: list[str] = Field(default_factory=list, sa_type=JSONType)
    suggested_option: str | None = None
    """Pre-filled from memory/history. Picking it confirms memory; the AI never picks it by itself."""
    product_id: str | None = Field(default=None, foreign_key="product.id")
    status: ClarificationStatus = Field(
        default=ClarificationStatus.OPEN, sa_type=enum_type(ClarificationStatus)
    )
    chosen_option: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    resolved_at: datetime | None = Field(default=None, sa_type=TZDateTime)
