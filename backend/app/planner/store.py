"""Grocery list reads and writes (plan_08). Mirrors the list half of mobile/src/state/reducer.ts.

  - One open list per household: the newest `grocery_list` row.
  - `add_items` plans proposals into it (see `rules`); any addition to an
    approved list reopens it as `draft` — the caller confirms with the user first.
  - Marking purchased never reopens an approved list.
  - Removal is soft (`removed`), and only a pending item can be removed.

Writes are added to the session; the caller commits.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from uuid import uuid4

from sqlmodel import Session, col, select

from app.ambiguity.safety_net import Catalog

from . import rules
from .models import GroceryList, GroceryListItem, ItemStatus, ListStatus


def _new_id() -> str:
    return uuid4().hex


def current_list(
    session: Session, household_id: str, now: datetime, new_id: Callable[[], str] = _new_id
) -> GroceryList:
    """The household's open list, created on first use."""

    row = session.exec(
        select(GroceryList)
        .where(GroceryList.household_id == household_id)
        .order_by(col(GroceryList.created_at).desc())
    ).first()
    if row is None:
        row = GroceryList(id=new_id(), household_id=household_id, created_at=now)
        session.add(row)
    return row


def list_items(session: Session, list_id: str) -> list[GroceryListItem]:
    """Every row, in the order added — including purchased and soft-removed (the audit trail)."""

    return list(
        session.exec(
            select(GroceryListItem)
            .where(GroceryListItem.list_id == list_id)
            .order_by(col(GroceryListItem.position))
        )
    )


def visible_items(session: Session, list_id: str) -> list[GroceryListItem]:
    return [i for i in list_items(session, list_id) if i.status != ItemStatus.REMOVED]


def grouped_view(
    session: Session, list_id: str, order: Sequence[rules.Category] = rules.CATEGORY_ORDER
) -> list[tuple[str, list[GroceryListItem]]]:
    """What the List screen shows: visible rows grouped by category, in the default
    store walk or a store's own aisle order (`rules.store_order`)."""

    return rules.group_by_category(visible_items(session, list_id), order)


def add_items(
    session: Session,
    grocery_list: GroceryList,
    proposed: Sequence[rules.ProposedListItem],
    catalog: Catalog,
    now: datetime,
    new_id: Callable[[], str] = _new_id,
) -> list[GroceryListItem]:
    """Plan proposals into the list; returns the rows written (new, merged or refined)."""

    if not proposed:
        return []
    rows = list_items(session, grocery_list.id)
    by_id = {r.id: r for r in rows}
    touched: list[GroceryListItem] = []

    for p in proposed:
        category = rules.categorize(
            p.product_id, catalog, p.category or rules.Category.HOUSEHOLD
        ).value
        rationale = rules.rationale_or_default(p.rationale)

        refined = by_id.get(p.id) if p.id else None
        if refined is not None and refined.status == ItemStatus.PENDING:
            refined.sqlmodel_update(
                {
                    "product_id": p.product_id, "product": p.product, "qty": p.qty,
                    "unit": p.unit, "brand": p.brand, "variant": p.variant,
                    "category": category, "source": p.source,
                    "confidence": p.confidence, "rationale": rationale,
                }
            )  # fmt: skip
            touched.append(refined)
            continue

        target = next(
            (r for r in rows if r.status == ItemStatus.PENDING and rules.same_choice(r, p)), None
        )
        total = target and rules.merge_qty(target.qty, target.unit, p.qty, p.unit)
        if target is not None and total:
            target.rationale = rules.merged_rationale(target.rationale, p.qty, p.unit)
            target.qty, target.unit = total
            target.confidence = rules.lower_confidence(target.confidence, p.confidence)
            touched.append(target)
            continue

        row = GroceryListItem(
            id=p.id if p.id and p.id not in by_id else new_id(),
            list_id=grocery_list.id,
            product_id=p.product_id,
            product=p.product,
            qty=p.qty,
            unit=p.unit,
            brand=p.brand,
            variant=p.variant,
            category=category,
            source=p.source,
            confidence=p.confidence,
            rationale=rationale,
            position=len(rows),
            created_at=now,
        )
        rows.append(row)
        by_id[row.id] = row
        touched.append(row)

    for r in touched:
        session.add(r)
    if grocery_list.status == ListStatus.APPROVED:
        grocery_list.status = ListStatus.DRAFT
        session.add(grocery_list)
    return touched


def approve(session: Session, grocery_list: GroceryList) -> bool:
    """Draft → approved. False (no change) if already approved or nothing is pending."""

    pending = any(i.status == ItemStatus.PENDING for i in list_items(session, grocery_list.id))
    if grocery_list.status == ListStatus.APPROVED or not pending:
        return False
    grocery_list.status = ListStatus.APPROVED
    session.add(grocery_list)
    return True


def _set_status(
    session: Session, list_id: str, item_ids: Sequence[str], status: ItemStatus
) -> list[GroceryListItem]:
    ids = set(item_ids)
    changed = [
        i for i in list_items(session, list_id) if i.id in ids and i.status == ItemStatus.PENDING
    ]
    for i in changed:
        i.status = status
        session.add(i)
    return changed


def mark_purchased(
    session: Session, list_id: str, item_ids: Sequence[str]
) -> list[GroceryListItem]:
    """Pending → purchased; the list's approval is untouched. Returns the rows that changed,
    for the caller to feed into purchase history, memory, and the pantry."""

    return _set_status(session, list_id, item_ids, ItemStatus.PURCHASED)


def remove_items(session: Session, list_id: str, item_ids: Sequence[str]) -> list[GroceryListItem]:
    """Soft remove: pending → removed. Purchased rows stay purchased."""

    return _set_status(session, list_id, item_ids, ItemStatus.REMOVED)
