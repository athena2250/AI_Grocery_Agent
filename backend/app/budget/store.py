"""Budget reads (plan_11). Read-only — the engine estimates and warns, it never edits the list."""

from __future__ import annotations

from sqlmodel import Session

from app.history.store import price_history
from app.planner.models import ItemStatus
from app.planner.store import list_items

from .rules import BudgetEstimate, estimate


def estimate_list(
    session: Session, household_id: str, list_id: str, budget: float | None = None
) -> BudgetEstimate:
    """Estimate what's still to buy on a list: pending rows only (purchased ones are already paid)."""

    pending = [i for i in list_items(session, list_id) if i.status == ItemStatus.PENDING]
    prices = {
        pid: price_history(session, household_id, pid) for pid in {i.product_id for i in pending}
    }
    return estimate(pending, prices, budget)
