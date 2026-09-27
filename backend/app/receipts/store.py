"""Receipt review drafts: persist, answer, approve (plan_09).

  - `create_draft` stores a reading; every line is `ready` or `needs_review`.
  - The user answers line questions (`answer_line` / `skip_line`) and names an
    unknown shop once (`set_store`, remembered for that receipt header).
  - `approve_receipt` is the only write path into history, pantry and memory, and
    refuses while any line still needs review.

Writes are added to the session; the caller commits.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, time
from uuid import uuid4

from sqlmodel import Session, col, select

from app.ambiguity.safety_net import Catalog
from app.history import Purchase, PurchaseSource, last_purchased_at, log_purchase
from app.inventory import mark_restocked
from app.inventory.models import Inventory
from app.memory import record_purchase
from app.memory.rules import as_utc
from app.planner.rules import merge_qty

from . import rules
from .models import LineStatus, Receipt, ReceiptLine, ReceiptStatus, StoreAlias
from .pipeline import ReceiptReading

DEFAULT_CURRENCY = "INR"


def _new_id() -> str:
    return uuid4().hex


# --- Reads -------------------------------------------------------------------


def remembered_stores(session: Session, household_id: str) -> dict[str, str]:
    """Receipt header → shop name, for `rules.detect_store`."""

    rows = session.exec(select(StoreAlias).where(StoreAlias.household_id == household_id))
    return {r.header_key: r.store for r in rows}


def receipt_lines(session: Session, receipt_id: str) -> list[ReceiptLine]:
    return list(
        session.exec(
            select(ReceiptLine)
            .where(ReceiptLine.receipt_id == receipt_id)
            .order_by(col(ReceiptLine.position))
        )
    )


def pending_review(session: Session, receipt_id: str) -> list[ReceiptLine]:
    return [ln for ln in receipt_lines(session, receipt_id) if ln.status == LineStatus.NEEDS_REVIEW]


def summary(session: Session, receipt_id: str) -> str:
    """ "We found 12 items; 2 need your input." — skipped lines don't count."""

    lines = [ln for ln in receipt_lines(session, receipt_id) if ln.status != LineStatus.SKIPPED]
    review = sum(ln.status == LineStatus.NEEDS_REVIEW for ln in lines)
    return rules.review_summary(len(lines), review)


# --- Draft -------------------------------------------------------------------


def _apply_review(line: ReceiptLine, review: rules.Review | None) -> None:
    line.status = LineStatus.READY if review is None else LineStatus.NEEDS_REVIEW
    line.review_kind = review.kind.value if review else None
    line.review_question = review.question if review else None
    line.review_options = list(review.options) if review else []


def create_draft(
    session: Session,
    household_id: str,
    reading: ReceiptReading,
    now: datetime,
    new_id: Callable[[], str] = _new_id,
) -> Receipt:
    receipt = Receipt(
        id=new_id(),
        household_id=household_id,
        store=reading.store,
        store_header=reading.store_header,
        purchased_at=(
            datetime.combine(reading.purchased_at, time(), UTC) if reading.purchased_at else None
        ),
        ocr_text=reading.ocr_text,
        created_at=now,
    )
    session.add(receipt)
    for position, d in enumerate(reading.lines):
        line = ReceiptLine(
            id=new_id(),
            receipt_id=receipt.id,
            position=position,
            raw_line=d.raw_line,
            product_guess=d.product_guess,
            product_id=d.product_id,
            product=d.product,
            brand=d.brand,
            qty=d.qty,
            unit=d.unit,
            package_size=d.package_size,
            price=d.price,
            confidence=d.confidence,
            status=LineStatus.READY,
        )
        _apply_review(line, d.review)
        session.add(line)
    return receipt


def _require_draft(session: Session, receipt_id: str) -> Receipt:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None or receipt.status != ReceiptStatus.DRAFT:
        raise ValueError(f"receipt {receipt_id} is not an open draft")
    return receipt


def answer_line(
    session: Session,
    line: ReceiptLine,
    catalog: Catalog,
    *,
    product_id: str | None = None,
    qty: float | None = None,
    unit: str | None = None,
) -> ReceiptLine:
    """The user answered this line's question. Picking the product confirms it (high
    confidence); the next question, if any, is asked on the same line."""

    _require_draft(session, line.receipt_id)
    if product_id is not None:
        product = catalog.product(product_id)
        if product is None:
            raise ValueError(f"unknown product {product_id}")
        line.product_id, line.product, line.confidence = product.id, product.name, "high"
    if qty is not None:
        line.qty, line.unit = qty, unit or line.unit
    if line.product_id is not None:
        _apply_review(
            line,
            rules.review_line(
                line.raw_line, [line.product_id], line.qty, line.unit, line.confidence, catalog
            ),
        )
    if line.status == LineStatus.SKIPPED:
        line.status = LineStatus.NEEDS_REVIEW
    session.add(line)
    return line


def skip_line(session: Session, line: ReceiptLine) -> ReceiptLine:
    """Not a grocery item, or not worth recording — it won't be written on approval."""

    _require_draft(session, line.receipt_id)
    line.status = LineStatus.SKIPPED
    session.add(line)
    return line


def set_store(session: Session, receipt: Receipt, store: str) -> None:
    """The user named the shop. Remembered for this receipt header, so we ask once."""

    _require_draft(session, receipt.id)
    receipt.store = store
    session.add(receipt)
    if receipt.store_header:
        alias = session.get(StoreAlias, (receipt.household_id, receipt.store_header))
        if alias is None:
            alias = StoreAlias(
                household_id=receipt.household_id, header_key=receipt.store_header, store=store
            )
        alias.store = store
        session.add(alias)


def discard_receipt(session: Session, receipt: Receipt) -> bool:
    if receipt.status != ReceiptStatus.DRAFT:
        return False
    receipt.status = ReceiptStatus.DISCARDED
    session.add(receipt)
    return True


# --- Approval ----------------------------------------------------------------


def approve_receipt(
    session: Session,
    receipt: Receipt,
    now: datetime,
    new_id: Callable[[], str] = _new_id,
) -> list[Purchase] | None:
    """Commit the reviewed lines. None (nothing written) unless it's a draft with no
    line awaiting review and at least one line to record.

    Per line → one `purchase` row (`receipt_ocr`). Per product → pantry flips to
    `available` (unless the pantry was updated after the receipt date) and an
    existing preference folds in the purchase (+confidence). Price history is
    derived from the purchase rows, so it needs no write of its own.
    """

    if receipt.status != ReceiptStatus.DRAFT:
        return None
    lines = receipt_lines(session, receipt.id)
    if any(ln.status == LineStatus.NEEDS_REVIEW for ln in lines):
        return None
    ready = [ln for ln in lines if ln.status == LineStatus.READY]
    if not ready:
        return None

    hh = receipt.household_id
    when = as_utc(receipt.purchased_at) if receipt.purchased_at else now
    by_product: dict[str, list[ReceiptLine]] = {}
    for ln in ready:
        assert ln.product_id is not None and ln.product is not None
        by_product.setdefault(ln.product_id, []).append(ln)
    previous = {pid: last_purchased_at(session, hh, pid, before=when) for pid in by_product}

    purchases = [
        log_purchase(
            session,
            Purchase(
                id=new_id(),
                household_id=hh,
                product_id=ln.product_id,
                product=ln.product,
                qty=ln.qty,
                unit=ln.unit,
                brand=ln.brand,
                package_size=ln.package_size,
                price=ln.price,
                currency=DEFAULT_CURRENCY if ln.price is not None else None,
                store=receipt.store,
                purchased_at=when,
                source=PurchaseSource.RECEIPT_OCR,
            ),
        )
        for ln in ready
        if ln.product_id is not None and ln.product is not None
    ]

    for pid, product_lines in by_product.items():
        qty, unit = product_lines[0].qty, product_lines[0].unit
        for ln in product_lines[1:]:
            total = merge_qty(qty, unit, ln.qty, ln.unit)
            qty, unit = total if total else (qty, unit)
        record_purchase(
            session, hh, pid, qty=qty, unit=unit, previous_purchase_at=previous[pid], now=when
        )

    # An old receipt must not undo a newer "rice is almost finished".
    fresh = [
        pid
        for pid in by_product
        if (row := session.get(Inventory, (hh, pid))) is None or as_utc(row.updated_at) <= when
    ]
    mark_restocked(session, hh, fresh, when)

    receipt.status = ReceiptStatus.APPROVED
    session.add(receipt)
    return purchases
