"""Tests for the budget engine (plan_11): pricing from history, coverage gate, never auto-remove."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity.safety_net import Catalog, CatalogProduct
from app.budget import budget_message, estimate, estimate_list, price_line
from app.history import PricePoint, Purchase, PurchaseSource, log_purchase
from app.planner import ItemStatus, ProposedListItem, add_items, current_list, mark_purchased

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)


@dataclass(frozen=True)
class Line:
    id: str
    product_id: str
    product: str
    qty: float | None
    unit: str | None
    brand: str | None = None


def point(
    price: float,
    qty: float | None,
    unit: str | None,
    brand: str | None = None,
    days_ago: float = 10,
) -> PricePoint:
    return PricePoint(
        purchased_at=NOW - timedelta(days=days_ago),
        price=price,
        qty=qty,
        unit=unit,
        unit_price=round(price / qty, 2) if qty else None,
        brand=brand,
        package_size=None,
        store=None,
    )


# --- Pricing one line ----------------------------------------------------------------


def test_prices_by_unit_price_across_units() -> None:
    est = price_line(Line("i1", "p_tomato", "Tomatoes", 500, "g"), [point(40, 1, "kg")])
    assert est.cost == 20
    assert "Last paid ₹40 for 1 kg" in est.basis


def test_same_brand_beats_a_newer_other_brand() -> None:
    points = [point(300, 5, "kg", "Aashirvaad", days_ago=30), point(250, 5, "kg", "India Gate", 2)]
    assert price_line(Line("i1", "p_rice", "Rice", 5, "kg", "Aashirvaad"), points).cost == 300
    assert price_line(Line("i1", "p_rice", "Rice", 5, "kg"), points).cost == 250


@pytest.mark.parametrize(
    ("line", "points", "why"),
    [
        (Line("i", "p_x", "X", 1, "kg"), [], "No price seen"),
        (Line("i", "p_x", "X", None, None), [point(40, 1, "kg")], "No amount"),
        (Line("i", "p_x", "X", 1, "kg"), [point(40, None, None)], "no amount to compare"),
        (Line("i", "p_x", "X", 2, "pack"), [point(40, 1, "kg")], "listed in pack"),
    ],
)
def test_never_invents_a_price(line: Line, points: list[PricePoint], why: str) -> None:
    est = price_line(line, points)
    assert est.cost is None
    assert why in est.basis


# --- Whole-list estimate ---------------------------------------------------------------

PRICES = {
    "p_rice": [point(300, 5, "kg")],
    "p_oil": [point(180, 1, "L")],
    "p_tomato": [point(40, 1, "kg")],
}
LINES = [
    Line("i1", "p_rice", "Rice", 5, "kg"),
    Line("i2", "p_oil", "Sunflower oil", 2, "L"),
    Line("i3", "p_tomato", "Tomatoes", 1, "kg"),
    Line("i4", "p_new", "Namkeen", 200, "g"),
]


def test_over_budget_warns_and_offers_biggest_items_to_review() -> None:
    est = estimate(LINES, PRICES, budget=500)
    assert est.total == 700
    assert est.coverage == 0.75 and est.reliable
    assert est.over_by == 200
    assert [e.product for e in est.review] == ["Sunflower oil", "Rice", "Tomatoes"]
    assert [e.item_id for e in est.lines] == ["i1", "i2", "i3", "i4"]  # nothing removed
    assert budget_message(est) == (
        "This list comes to about ₹700 (plus 1 item I don't have prices for)."
        " That's ₹200 over your ₹500 budget."
        " The biggest items are sunflower oil, rice, tomatoes — want to look at them?"
    )


def test_under_budget_just_states_the_total() -> None:
    est = estimate(LINES[:3], PRICES, budget=1000)
    assert est.over_by is None
    assert budget_message(est) == "This list comes to about ₹700."


def test_below_coverage_gate_no_warning() -> None:
    lines = [*LINES[:1], Line("a", "p_a", "A", 1, "kg"), Line("b", "p_b", "B", 1, "kg")]
    est = estimate(lines, PRICES, budget=100)
    assert est.coverage == pytest.approx(1 / 3)
    assert not est.reliable
    assert est.over_by is None
    assert budget_message(est) is None


def test_empty_list() -> None:
    est = estimate([], PRICES, budget=100)
    assert est.total == 0 and est.reliable and est.over_by is None


# --- Store read ----------------------------------------------------------------------------


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_estimate_list_prices_pending_rows_from_history(session: Session) -> None:
    ids = count()
    for pid, price, qty, unit in [("p_rice", 300, 5, "kg"), ("p_tomato", 40, 1, "kg")]:
        log_purchase(
            session,
            Purchase(
                id=f"pu_{next(ids)}", household_id=HH, product_id=pid, product=pid, qty=qty,
                unit=unit, price=price, purchased_at=NOW - timedelta(days=7),
                source=PurchaseSource.RECEIPT_OCR,
            ),
        )  # fmt: skip
    catalog = Catalog(products=(CatalogProduct("p_rice", "Rice"), CatalogProduct("p_tomato", "T")))
    glist = current_list(session, HH, NOW, new_id=lambda: "list_1")
    rows = add_items(
        session,
        glist,
        [
            ProposedListItem("p_rice", "Rice", 5, "kg", "user", "high"),
            ProposedListItem("p_tomato", "Tomatoes", 2, "kg", "user", "high"),
        ],
        catalog,
        NOW,
        new_id=lambda: f"li_{next(ids)}",
    )
    session.commit()

    est = estimate_list(session, HH, glist.id, budget=350)
    assert est.total == 380 and est.over_by == 30

    mark_purchased(session, glist.id, [rows[0].id])
    session.commit()
    assert rows[0].status == ItemStatus.PURCHASED
    assert estimate_list(session, HH, glist.id, budget=350).total == 80
