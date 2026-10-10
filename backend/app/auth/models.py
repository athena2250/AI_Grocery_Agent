"""Sign-in tables: the admin-issued passkeys, join requests, the signed-in phone, and the login log.

There is no separate account table: `member` is the account and `member.phone` (unique,
E.164) is the key. Nobody signs themselves up: a person gives their name and number (a
`join_request`), the admin adds them to a home and issues a passkey, and name + number +
passkey signs them in.

The OTP tables of the first release (`otp_code`, `household_invite`) are no longer used. They
are left in existing databases (setup never drops tables) and can be dropped by hand.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member/device for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class SessionEndReason(str, Enum):
    SIGNED_OUT = "signed_out"
    REPLACED = "replaced"
    """Signed in on another phone — one device per person."""
    REMOVED = "removed"
    """Taken out of the household."""
    PHONE_CHANGED = "phone_changed"


class AuthEventKind(str, Enum):
    """Stored as text with a CHECK of these values, so a value can't be added or dropped without a
    migration: old rows keep loading. The names say what they mean now; the values are historic."""

    PASSKEY_FAILED = "code_failed"
    PASSKEY_LOCKED = "code_locked"
    REFUSED = "refused"
    """Turned away (wrong details for a number we don't know, a locked number …)."""
    SIGNED_UP = "signed_up"
    """First sign-in for this person."""
    SIGNED_IN = "signed_in"
    SIGNED_OUT = "signed_out"
    SESSION_REPLACED = "session_replaced"
    SESSIONS_REVOKED = "sessions_revoked"
    # From the OTP release; never written now.
    CODE_SENT = "code_sent"
    CODE_EXPIRED = "code_expired"
    PHONE_CHANGED = "phone_changed"
    INVITE_CREATED = "invite_created"
    INVITE_USED = "invite_used"
    INVITE_REVOKED = "invite_revoked"


class MemberPasskey(SQLModel, table=True):
    """The passkey the admin gave this person. Only a salted scrypt hash is kept (peppered with
    AUTH_SECRET, so the database alone can't be used to test guesses)."""

    __tablename__ = "member_passkey"  # type: ignore[assignment]

    member_id: str = Field(primary_key=True, foreign_key="member.id")
    passkey_hash: str
    issued_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    issued_by: str
    """The admin's name, as in the admin log."""
    failed_attempts: int = Field(default=0, ge=0)
    locked_until: datetime | None = Field(default=None, sa_type=TZDateTime)


class JoinRequestStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DISMISSED = "dismissed"


class JoinRequest(SQLModel, table=True):
    """Someone typed their name and number on a new phone: the admin's to-do list."""

    __tablename__ = "join_request"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    phone: str = Field(index=True)
    name: str
    status: JoinRequestStatus = Field(default=JoinRequestStatus.PENDING, sa_type=enum_type(JoinRequestStatus))
    first_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    last_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    times: int = Field(default=1, ge=1)
    """How often they asked (they may tap Continue more than once)."""
    member_id: str | None = Field(default=None, foreign_key="member.id")
    """Approved: who they became."""
    resolved_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    resolved_by: str | None = None


class AuthSession(SQLModel, table=True):
    """A signed-in phone. At most one active row per member (partial unique index)."""

    __tablename__ = "auth_session"  # type: ignore[assignment]
    __table_args__ = (
        Index(
            "uq_auth_session_one_active", "member_id", unique=True,
            sqlite_where=text("revoked_at IS NULL"), postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: str = Field(primary_key=True)
    member_id: str = Field(foreign_key="member.id", index=True)
    device_id: str | None = Field(default=None, foreign_key="device.id")
    device_label: str | None = None
    """"Lakshmi's Redmi" — shown in "You signed in on another phone"."""
    token_hash: str = Field(unique=True)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    last_seen_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    revoked_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    revoked_reason: SessionEndReason | None = Field(default=None, sa_type=enum_type(SessionEndReason))


class AuthEvent(SQLModel, table=True):
    """The login log: who signed in when, wrong passkeys, refusals. Kept for one year."""

    __tablename__ = "auth_event"  # type: ignore[assignment]
    __table_args__ = (Index("ix_auth_event_phone", "phone", "kind", "at"),)

    id: int | None = Field(default=None, primary_key=True)
    at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime, index=True)
    kind: AuthEventKind = Field(sa_type=enum_type(AuthEventKind))
    phone: str | None = None
    member_id: str | None = Field(default=None, foreign_key="member.id", index=True)
    household_id: str | None = Field(default=None, foreign_key="household.id")
    session_id: str | None = Field(default=None, foreign_key="auth_session.id")
    detail_json: dict[str, Any] | None = Field(default=None, sa_type=JSONType)
    """e.g. {"error": "wrong_details"}, {"attempts_left": 3}."""
