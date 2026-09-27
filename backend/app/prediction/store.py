"""Purchase prediction reads (plan_10). Read-only — predictions are never stored or auto-added."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, select

from app.history.models import Purchase
from app.inventory.store import get_inventory

from .rules import Prediction, predict


def get_purchases(session: Session, household_id: str) -> list[Purchase]:
    return list(session.exec(select(Purchase).where(Purchase.household_id == household_id)))


def predict_household(session: Session, household_id: str, now: datetime) -> list[Prediction]:
    return predict(get_purchases(session, household_id), get_inventory(session, household_id), now)
