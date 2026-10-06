"""Tables only the admin console owns. Everything else is read through the backend's models.

- `admin_household_status`: active / suspended / under review, with the reason. No row = active.
  The family app's API (Phase 2 middleware) reads this to turn a suspended home away; the admin
  never deletes or rewrites a family's own data to suspend it.
- `admin_action`: every write the console makes, who made it, and what changed. Append-only.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household for the FK below)
from app.core.sqltypes import JSONType, TZDateTime, enum_type, utcnow


class HouseholdStatus(str, Enum):
    ACTIVE = "active"
    UNDER_REVIEW = "under_review"
    """Something is being looked at; the family keeps using the app."""
    SUSPENDED = "suspended"


class AdminHouseholdStatus(SQLModel, table=True):
    __tablename__ = "admin_household_status"  # type: ignore[assignment]

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    status: HouseholdStatus = Field(
        default=HouseholdStatus.ACTIVE, sa_type=enum_type(HouseholdStatus)
    )
    note: str | None = None
    updated_by: str
    updated_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class AdminAction(SQLModel, table=True):
    __tablename__ = "admin_action"  # type: ignore[assignment]

    id: int | None = Field(default=None, primary_key=True)
    at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime, index=True)
    admin: str
    action: str
    """household_status / member_active / member_role / revoke_sessions / task_status /
    task_assign / post_resend / post_recheck / post_cancel / fix:<check> …"""
    target_kind: str
    target_id: str
    household_id: str | None = Field(default=None, index=True)
    note: str | None = None
    detail_json: dict[str, Any] = Field(default_factory=dict, sa_type=JSONType)
    """{"before": …, "after": …} or whatever the action changed."""
