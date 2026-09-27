"""Tests for pantry inventory (plan_06): one row per product, upsert semantics, restock."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.inventory import get_inventory, mark_restocked, needs_restock, upsert_inventory
from app.understanding.schema import InventoryStateLiteral as S
from app.understanding.schema import InventoryUpdate

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)
EARLIER = NOW - timedelta(days=5)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_update_on_untracked_product_creates_a_row(session: Session) -> None:
    upsert_inventory(
        session, HH, "p_poha", S.ALMOST_FINISHED, approx_qty=0.5, approx_unit="pack", now=NOW
    )
    session.commit()
    [row] = get_inventory(session, HH)
    assert (row.product_id, row.state, row.approx_qty, row.approx_unit) == (
        "p_poha",
        S.ALMOST_FINISHED,
        0.5,
        "pack",
    )
    assert row.updated_at.replace(tzinfo=UTC) == NOW


def test_upsert_keeps_one_row_and_drops_an_amount_not_restated(session: Session) -> None:
    upsert_inventory(
        session, HH, "p_rice", S.AVAILABLE, approx_qty=2, approx_unit="kg", now=EARLIER
    )
    upsert_inventory(session, HH, "p_rice", S.ALMOST_FINISHED, now=NOW)
    session.commit()
    [row] = get_inventory(session, HH)
    assert (row.state, row.approx_qty, row.approx_unit) == (S.ALMOST_FINISHED, None, None)
    assert row.updated_at.replace(tzinfo=UTC) == NOW


def test_out_never_carries_an_amount(session: Session) -> None:
    row = upsert_inventory(session, HH, "p_milk", S.OUT, approx_qty=1, approx_unit="L", now=NOW)
    assert row.approx_qty is None and row.approx_unit is None


def test_households_are_separate(session: Session) -> None:
    upsert_inventory(session, HH, "p_rice", S.OUT, now=NOW)
    upsert_inventory(session, "hh_2", "p_rice", S.AVAILABLE, now=NOW)
    session.commit()
    assert [r.state for r in get_inventory(session, HH)] == [S.OUT]


def test_purchase_flips_to_available_and_creates_missing_rows(session: Session) -> None:
    upsert_inventory(session, HH, "p_rice", S.OUT, now=EARLIER)
    mark_restocked(session, HH, ["p_rice", "p_onion", "p_rice"], NOW)
    session.commit()
    rows = {r.product_id: r for r in get_inventory(session, HH)}
    assert {pid: r.state for pid, r in rows.items()} == {
        "p_rice": S.AVAILABLE,
        "p_onion": S.AVAILABLE,
    }
    assert rows["p_rice"].updated_at.replace(tzinfo=UTC) == NOW


@pytest.mark.parametrize(
    ("state", "expected"),
    [(S.AVAILABLE, False), (S.RUNNING_LOW, False), (S.ALMOST_FINISHED, True), (S.OUT, True)],
)
def test_restock_signal(state: S, expected: bool) -> None:
    assert needs_restock(state) is expected


def test_llm_inventory_update_accepts_an_approximate_amount() -> None:
    u = InventoryUpdate.model_validate(
        {"raw_text": "poha", "state": "almost_finished", "approx_qty": 0.5, "approx_unit": "pack"}
    )
    assert (u.approx_qty, u.approx_unit) == (0.5, "pack")
    with pytest.raises(ValueError):
        InventoryUpdate.model_validate({"raw_text": "poha", "state": "out", "approx_qty": -1})
