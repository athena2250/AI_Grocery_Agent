"""Tables only the admin console owns. Everything else is read through the backend's models.

- `admin_household_status`: active / suspended / under review, with the reason. No row = active.
  The family app's API (Phase 2 middleware) reads this to turn a suspended home away; the admin
  never deletes or rewrites a family's own data to suspend it.
- `admin_action`: every write the console makes, who made it, and what changed. Append-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

import app.core.models  # noqa: F401  (registers household for the FK below)
from app.core.access import AdminHouseholdStatus, HouseholdStatus  # noqa: F401
from app.core.sqltypes import JSONType, TZDateTime, utcnow


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
