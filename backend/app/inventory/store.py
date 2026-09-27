"""Pantry inventory reads and upserts (plan_06).

Mirrors mobile/src/state/inventory.ts:

  - One row per (household, product); every update is an upsert with a fresh
    `updated_at`.
  - An update is a full statement of what the user said: an approximate amount
    is kept only if this update gave one, and `out` never carries one.
  - A confirmed purchase flips the row to `available`.
  - `almost_finished` / `out` are the buy signal — the orchestrator may *propose*
    adding the product (a chip the user confirms), never add it by itself.

Writes are added to the session; the caller commits.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from sqlmodel import Session, select

from app.understanding.schema import InventoryStateLiteral

from .models import Inventory

RESTOCK_STATES = frozenset({InventoryStateLiteral.ALMOST_FINISHED, InventoryStateLiteral.OUT})


def needs_restock(state: InventoryStateLiteral) -> bool:
    return state in RESTOCK_STATES


def get_inventory(session: Session, household_id: str) -> list[Inventory]:
    return list(session.exec(select(Inventory).where(Inventory.household_id == household_id)))


def upsert_inventory(
    session: Session,
    household_id: str,
    product_id: str,
    state: InventoryStateLiteral,
    *,
    approx_qty: float | None = None,
    approx_unit: str | None = None,
    now: datetime,
) -> Inventory:
    keep_amount = state != InventoryStateLiteral.OUT and approx_qty is not None and approx_unit
    row = session.get(Inventory, (household_id, product_id))
    if row is None:
        row = Inventory(
            household_id=household_id, product_id=product_id, state=state, updated_at=now
        )
    row.state = state
    row.approx_qty = approx_qty if keep_amount else None
    row.approx_unit = approx_unit if keep_amount else None
    row.updated_at = now
    session.add(row)
    return row


def mark_restocked(
    session: Session, household_id: str, product_ids: Iterable[str], now: datetime
) -> list[Inventory]:
    """Bought → `available`, creating the row if the pantry didn't track it yet."""

    return [
        upsert_inventory(session, household_id, pid, InventoryStateLiteral.AVAILABLE, now=now)
        for pid in dict.fromkeys(product_ids)
    ]
