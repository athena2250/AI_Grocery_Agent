"""Tests for purchase prediction (plan_10): EW stats, synthetic series, inventory overrides."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity.safety_net import Catalog, CatalogProduct, HouseholdPreference
from app.history import Purchase, PurchaseSource, log_purchase
from app.inventory import Inventory, upsert_inventory
from app.planner import Category
from app.prediction import (
    SNOOZE,
    PredictionStatus,
    classify,
    ew_stats,
    predict,
    predict_household,
    predict_product,
    prediction_proposals,
)
from app.understanding.schema import InventoryStateLiteral as S

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)
BUY_NOW, LIKELY_SOON, NOT_NEEDED = (
    PredictionStatus.BUY_NOW,
    PredictionStatus.LIKELY_SOON,
    PredictionStatus.NOT_NEEDED,
)

CATALOG = Catalog(
    products=[
        CatalogProduct("p_curd", "Curd", "g", Category.DAIRY.value),
        CatalogProduct("p_onion", "Onions", "kg", Category.VEGETABLES.value),
    ],
    preferences=[
        HouseholdPreference(
            "p_curd", preferred_brand="Amul", typical_qty=400, typical_unit="g", confidence=0.75
        )
    ],
)

_ids = count()


def ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def series(gaps: list[float], since_last: float) -> list[datetime]:
    """Purchase times for a series of gaps, ending `since_last` days before NOW."""

    out = [ago(since_last)]
    at = since_last
    for g in reversed(gaps):
        at += g
        out.insert(0, ago(at))
    return out


def pantry(state: S, updated_days_ago: float = 0) -> Inventory:
    return Inventory(
        household_id=HH, product_id="p_curd", state=state, updated_at=ago(updated_days_ago)
    )


def status_of(
    gaps: list[float], since_last: float, row: Inventory | None = None
) -> PredictionStatus:
    p = predict_product("p_curd", series(gaps, since_last), row, NOW)
    assert p is not None
    return p.status


def purchase(
    product_id: str, days: float, qty: float = 1, unit: str = "kg", brand: str | None = None
) -> Purchase:
    return Purchase(
        id=f"pu_{next(_ids)}",
        household_id=HH,
        product_id=product_id,
        product=product_id,
        qty=qty,
        unit=unit,
        brand=brand,
        purchased_at=ago(days),
        source=PurchaseSource.CHAT_CONFIRMED,
    )


# --- EW stats + thresholds ---------------------------------------------------------


def test_regular_series_has_no_spread() -> None:
    assert ew_stats([7, 7, 7]) == (7, 0)


def test_irregular_series_alpha_04() -> None:
    mean, std = ew_stats([5, 9, 6, 10])
    assert mean == pytest.approx(7.816, abs=1e-3)
    assert std == pytest.approx(2.148, abs=1e-3)


@pytest.mark.parametrize(
    ("days", "expected"),
    [(9, BUY_NOW), (8.9, LIKELY_SOON), (7, LIKELY_SOON), (6.9, NOT_NEEDED)],
)
def test_classification_thresholds(days: float, expected: PredictionStatus) -> None:
    assert classify(days, 10, 2) is expected


# --- Synthetic purchase series -------------------------------------------------------


@pytest.mark.parametrize(("since", "expected"), [(7, BUY_NOW), (10, BUY_NOW), (6, NOT_NEEDED)])
def test_regular_weekly(since: float, expected: PredictionStatus) -> None:
    assert status_of([7, 7, 7], since) is expected


@pytest.mark.parametrize(("since", "expected"), [(7, BUY_NOW), (5, LIKELY_SOON), (4, NOT_NEEDED)])
def test_irregular_spread_opens_a_likely_soon_window(
    since: float, expected: PredictionStatus
) -> None:
    # mean ≈ 7.82, std ≈ 2.15 → BUY_NOW ≥ 6.74, LIKELY_SOON ≥ 4.59
    assert status_of([5, 9, 6, 10], since) is expected


def test_one_off_and_two_off_get_no_prediction() -> None:
    assert predict_product("p_curd", [ago(40)], None, NOW) is None
    assert predict_product("p_curd", series([7], 20), None, NOW) is None


def test_purchases_less_than_a_day_apart_are_one_trip() -> None:
    same_day = [ago(14), ago(7), ago(7) + timedelta(hours=1)]
    assert predict_product("p_curd", same_day, None, NOW) is None
    p = predict_product("p_curd", [*same_day, ago(21)], None, NOW)
    assert p is not None and p.purchase_count == 3
    assert p.mean_interval_days == pytest.approx(7, abs=0.1)


def test_naive_sqlite_datetimes_are_read_as_utc() -> None:
    naive = [t.replace(tzinfo=None) for t in series([7, 7], 3)]
    assert predict_product("p_curd", naive, None, NOW) == predict_product(
        "p_curd", series([7, 7], 3), None, NOW
    )


# --- Inventory overrides ------------------------------------------------------------


@pytest.mark.parametrize("state", [S.ALMOST_FINISHED, S.OUT])
def test_low_pantry_beats_not_needed(state: S) -> None:
    assert status_of([7, 7, 7], 2) is NOT_NEEDED
    p = predict_product("p_curd", series([7, 7, 7], 2), pantry(state), NOW)
    assert p is not None and (p.status, p.reason) == (BUY_NOW, "pantry_low")


def test_running_low_alone_does_not_override() -> None:
    assert status_of([7, 7, 7], 2, pantry(S.RUNNING_LOW)) is NOT_NEEDED


def test_fresh_available_demotes_buy_now() -> None:
    p = predict_product("p_curd", series([7, 7, 7], 8), pantry(S.AVAILABLE, 1), NOW)
    assert p is not None and (p.status, p.reason) == (LIKELY_SOON, "pantry_cooldown")


def test_old_available_is_past_the_cooldown() -> None:
    assert status_of([7, 7, 7], 8, pantry(S.AVAILABLE, 4)) is BUY_NOW


def test_cooldown_is_capped_at_7_days() -> None:
    assert status_of([30, 30, 30], 31, pantry(S.AVAILABLE, 6)) is LIKELY_SOON
    assert status_of([30, 30, 30], 31, pantry(S.AVAILABLE, 8)) is BUY_NOW


# --- Over a history + proposals -----------------------------------------------------


def _history() -> list[Purchase]:
    return [
        *(purchase("p_curd", d, 400, "g", "Amul") for d in (8, 15, 22, 29)),
        *(purchase("p_onion", d) for d in (11, 21, 32)),
        purchase("p_milk", 2, 1, "L"),
    ]


def test_predict_groups_by_product_and_skips_thin_histories() -> None:
    got = [(p.product_id, p.status) for p in predict(_history(), [], NOW)]
    assert got == [("p_curd", BUY_NOW), ("p_onion", BUY_NOW)]


def test_proposals_are_confirm_first_with_usual_or_last_amount() -> None:
    history = _history()
    proposals = prediction_proposals(predict(history, [], NOW), history, [], [], CATALOG, NOW)
    by_id = {p.product_id: p for p in proposals}
    assert set(by_id) == {"p_curd", "p_onion"}
    curd, onion = by_id["p_curd"], by_id["p_onion"]
    assert (curd.qty, curd.unit, curd.brand, curd.confidence) == (400, "g", "Amul", "high")
    assert curd.rationale == (
        "You buy curd about every 7 days — last bought 8 days ago. You usually get 400 g Amul."
    )
    assert (onion.qty, onion.unit, onion.brand, onion.confidence) == (1, "kg", None, "low")
    assert onion.rationale.endswith("Last time: 1 kg.")
    assert onion.category is Category.VEGETABLES
    assert all(p.needs_confirmation and p.source == "purchase_history" for p in proposals)


def test_proposals_skip_items_on_the_list_and_snoozed() -> None:
    history = _history()
    preds = predict(history, [], NOW)
    assert [
        p.product_id for p in prediction_proposals(preds, history, [], ["p_curd"], CATALOG, NOW)
    ] == ["p_onion"]
    snoozed = {"p_onion": NOW - timedelta(days=1)}
    assert [
        p.product_id for p in prediction_proposals(preds, history, [], [], CATALOG, NOW, snoozed)
    ] == ["p_curd"]
    expired = {"p_onion": NOW - SNOOZE}
    assert len(prediction_proposals(preds, history, [], [], CATALOG, NOW, expired)) == 2


def test_pantry_low_rationale() -> None:
    history = [purchase("p_curd", d, 400, "g", "Amul") for d in (2, 9, 16)]
    inv = [pantry(S.OUT)]
    [p] = prediction_proposals(predict(history, inv, NOW), history, inv, [], CATALOG, NOW)
    assert "Pantry says curd is finished." in p.rationale


# --- Store ------------------------------------------------------------------------


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_predict_household_reads_purchases_and_pantry(session: Session) -> None:
    for p in _history():
        log_purchase(session, p)
    other = purchase("p_rice", 1)
    other.household_id = "hh_2"
    log_purchase(session, other)
    upsert_inventory(session, HH, "p_curd", S.AVAILABLE, now=ago(1))
    session.commit()
    got = {p.product_id: (p.status, p.reason) for p in predict_household(session, HH, NOW)}
    assert got == {"p_curd": (LIKELY_SOON, "pantry_cooldown"), "p_onion": (BUY_NOW, "interval")}
