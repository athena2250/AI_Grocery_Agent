"""Sign-in tables: one-time codes, the signed-in phone, home-code invites, and the login log.

There is no separate account table: `member` is the account and `member.phone` (unique,
E.164) is the key. Signing up either claims a member row the owner already added with that
phone, joins a household through a home code, or starts a new household with the person
as owner. A person belongs to one household.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household/member/device for the FKs below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class OtpPurpose(str, Enum):
    SIGN_IN = "sign_in"
    SIGN_UP = "sign_up"
    CHANGE_PHONE = "change_phone"


class SessionEndReason(str, Enum):
    SIGNED_OUT = "signed_out"
    REPLACED = "replaced"
    """Signed in on another phone — one device per person."""
    REMOVED = "removed"
    """Taken out of the household."""
    PHONE_CHANGED = "phone_changed"


class AuthEventKind(str, Enum):
    CODE_SENT = "code_sent"
    CODE_FAILED = "code_failed"
    CODE_LOCKED = "code_locked"
    CODE_EXPIRED = "code_expired"
    REFUSED = "refused"
    """Asked for a code and was turned away (no account, name mismatch, rate limit …)."""
    SIGNED_UP = "signed_up"
    SIGNED_IN = "signed_in"
    SIGNED_OUT = "signed_out"
    SESSION_REPLACED = "session_replaced"
    SESSIONS_REVOKED = "sessions_revoked"
    PHONE_CHANGED = "phone_changed"
    INVITE_CREATED = "invite_created"
    INVITE_USED = "invite_used"
    INVITE_REVOKED = "invite_revoked"


class OtpCode(SQLModel, table=True):
    """A code that was sent. Only its HMAC is stored; deleted 24 h after use or expiry."""

    __tablename__ = "otp_code"  # type: ignore[assignment]
    __table_args__ = (Index("ix_otp_code_lookup", "phone", "purpose", "consumed_at"),)

    id: str = Field(primary_key=True)
    phone: str
    """E.164 the code went to — for change_phone, the *new* number."""
    purpose: OtpPurpose = Field(sa_type=enum_type(OtpPurpose))
    code_hash: str
    member_id: str | None = Field(default=None, foreign_key="member.id")
    """change_phone: who is changing their number."""
    pending_name: str | None = None
    pending_relation: str | None = None
    """sign_up: the details to save once the code is right."""
    invite_id: str | None = Field(default=None, foreign_key="household_invite.id")
    """sign_up with a home code: the household to join."""
    sent_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    expires_at: datetime = Field(sa_type=TZDateTime)
    resend_after: datetime = Field(sa_type=TZDateTime)
    attempts_left: int = Field(default=5, ge=0)
    consumed_at: datetime | None = Field(default=None, sa_type=TZDateTime)


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


class HouseholdInvite(SQLModel, table=True):
    """A home code ("HRTH-4K9P"): any member can make one; many people can use it for 7 days."""

    __tablename__ = "household_invite"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    code: str = Field(unique=True)
    created_by_member_id: str = Field(foreign_key="member.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
    expires_at: datetime = Field(sa_type=TZDateTime)
    revoked_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    uses: int = Field(default=0, ge=0)


class AuthEvent(SQLModel, table=True):
    """The login log: who signed in when, failed codes, refusals. Kept for one year.

    Also the rate limiter's source: codes sent per phone per hour/day are counted here.
    """

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
    """e.g. {"error": "name_mismatch"}, {"purpose": "sign_up"}, {"attempts_left": 3}."""
