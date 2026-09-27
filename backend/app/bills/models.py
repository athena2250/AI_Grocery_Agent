"""Recurring bills: electricity ("current"), internet, maintenance, water, gas, phone …

`bill_account` is the standing bill; `bill_payment` is one period of it. A daily job
(not built yet) creates the next period's row and a post + reminder before the due date.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

import app.feed.models  # noqa: F401  (registers post/member for the FKs below)
from app.core.sqltypes import TZDateTime, enum_type, utcnow


class Recurrence(str, Enum):
    MONTHLY = "monthly"
    BIMONTHLY = "bimonthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class BillStatus(str, Enum):
    UPCOMING = "upcoming"
    DUE = "due"
    PAID = "paid"
    OVERDUE = "overdue"


class BillAccount(SQLModel, table=True):
    __tablename__ = "bill_account"  # type: ignore[assignment]

    id: str = Field(primary_key=True)
    household_id: str = Field(foreign_key="household.id", index=True)
    kind: str
    """electricity / internet / maintenance / water / gas / phone / other — free text."""
    provider: str | None = None
    account_ref: str | None = None
    typical_amount: float | None = Field(default=None, ge=0)
    due_day_of_month: int | None = Field(default=None, ge=1, le=31)
    recurrence: Recurrence = Field(default=Recurrence.MONTHLY, sa_type=enum_type(Recurrence))
    assigned_to_member_id: str | None = Field(default=None, foreign_key="member.id")
    remind_days_before: int = Field(default=3, ge=0)
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)


class BillPayment(SQLModel, table=True):
    __tablename__ = "bill_payment"  # type: ignore[assignment]
    __table_args__ = (UniqueConstraint("bill_account_id", "period", name="uq_bill_period"),)

    id: str = Field(primary_key=True)
    bill_account_id: str = Field(foreign_key="bill_account.id", index=True)
    period: str
    """"2026-10" (monthly) or "2026-09/10" (bimonthly)."""
    amount_due: float | None = Field(default=None, ge=0)
    due_date: date
    status: BillStatus = Field(default=BillStatus.UPCOMING, sa_type=enum_type(BillStatus))
    paid_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    paid_by_member_id: str | None = Field(default=None, foreign_key="member.id")
    amount_paid: float | None = Field(default=None, ge=0)
    post_id: str | None = Field(default=None, foreign_key="post.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)
