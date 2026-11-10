"""Household access policy, shared by the family API and admin console."""
from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

from app.core.sqltypes import TZDateTime, enum_type, utcnow


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


