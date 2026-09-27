"""Tests for the grocery planner (plan_08): dedupe, categorize, low-stock proposals, approval."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity.safety_net import Catalog, CatalogProduct, HouseholdPreference
from app.inventory import get_inventory, upsert_inventory
from app.planner import (
    CATEGORY_ORDER,
    DEFAULT_RATIONALE,
    Category,
    GroceryList,
    ItemStatus,
    ListStatus,
    ProposedListItem,
    add_items,
    approve,
    categorize,
    current_list,
    group_by_category,
    grouped_view,
    list_items,
    low_stock_proposals,
    mark_purchased,
    merge_qty,
    remove_items,
    store_order,
    visible_items,
)
from app.understanding.schema import InventoryStateLiteral as S

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)
EARLIER = NOW - timedelta(days=5)

# Same ids + categories as mobile/src/data/seed.ts.
_C = Category
CATALOG_CATEGORIES: dict[str, tuple[str, Category]] = {
    "p_tomato": ("Tomatoes", _C.VEGETABLES),
    "p_onion": ("Onions", _C.VEGETABLES),
    "p_coriander_leaves": ("Coriander leaves", _C.VEGETABLES),
    "p_ginger": ("Ginger", _C.VEGETABLES),
    "p_banana": ("Bananas", _C.FRUITS),
    "p_lemon": ("Lemons", _C.FRUITS),
    "p_milk": ("Milk", _C.DAIRY),
    "p_curd": ("Curd", _C.DAIRY),
    "p_paneer": ("Paneer", _C.DAIRY),
    "p_bread": ("Bread", _C.DAIRY),
    "p_rice": ("Rice", _C.RICE_GRAINS),
    "p_wheat_atta": ("Wheat atta", _C.RICE_GRAINS),
    "p_toor_dal": ("Toor dal", _C.PULSES),
    "p_rajma": ("Rajma", _C.PULSES),
    "p_coriander_seeds": ("Coriander seeds", _C.SPICES),
    "p_turmeric": ("Turmeric powder", _C.SPICES),
    "p_sunflower_oil": ("Sunflower oil", _C.COOKING_ESSENTIALS),
    "p_salt": ("Salt", _C.COOKING_ESSENTIALS),
    "p_biscuits": ("Biscuits", _C.SNACKS),
    "p_tea": ("Tea", _C.BEVERAGES),
}
CATALOG = Catalog(
    products=tuple(
        CatalogProduct(id=pid, name=name, category=cat.value)
        for pid, (name, cat) in CATALOG_CATEGORIES.items()
    ),
    preferences=(
        HouseholdPreference(
            product_id="p_rice",
            preferred_brand="Aashirvaad",
            typical_qty=5,
            typical_unit="kg",
            confidence=0.95,
        ),
    ),
)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture
def glist(session: Session) -> GroceryList:
    ids = count()
    return current_list(session, HH, NOW, new_id=lambda: f"list_{next(ids)}")


def item(product_id: str, qty: float | None, unit: str | None, **kw: object) -> ProposedListItem:
    fields: dict[str, object] = {
        "product_id": product_id,
        "product": CATALOG_CATEGORIES[product_id][0],
        "qty": qty,
        "unit": unit,
        "source": "user",
        "confidence": "high",
        "rationale": f"You said {qty} {unit}.",
    }
    fields.update(kw)
    return ProposedListItem(**fields)  # type: ignore[arg-type]


def add(session: Session, glist: GroceryList, *ps: ProposedListItem) -> None:
    add_items(session, glist, ps, CATALOG, NOW)
    session.commit()


def rows(session: Session, glist: GroceryList) -> list[tuple[str, float | None, str | None]]:
    return [(i.product, i.qty, i.unit) for i in visible_items(session, glist.id)]


# --- Dedupe ------------------------------------------------------------------


def test_same_item_twice_merges_to_one_row(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"))
    add(session, glist, item("p_tomato", 1, "kg"))
    assert rows(session, glist) == [("Tomatoes", 2, "kg")]
    [row] = list_items(session, glist.id)
    assert row.rationale == "You said 1 kg. Then you added 1 kg more."


def test_convertible_units_merge_into_the_bigger_unit(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"), item("p_tomato", 500, "g"))
    assert rows(session, glist) == [("Tomatoes", 1.5, "kg")]


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ((1, "kg"), (500, "g"), (1.5, "kg")),
        ((500, "g"), (1, "kg"), (1.5, "kg")),
        ((0.2, "kg"), (300, "g"), (500, "g")),
        ((500, "ml"), (1, "L"), (1.5, "L")),
        ((0.1, "kg"), (0.2, "kg"), (0.3, "kg")),
        ((1, "pack"), (2, "pack"), (3, "pack")),
        ((1, "pack"), (200, "g"), None),
        ((1, "L"), (500, "g"), None),
        ((None, None), (1, "kg"), None),
    ],
)
def test_merge_qty(
    a: tuple[float | None, str | None],
    b: tuple[float | None, str | None],
    expected: tuple[float, str] | None,
) -> None:
    assert merge_qty(*a, *b) == expected


def test_unbridgeable_units_stay_separate_rows(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_biscuits", 1, "pack"), item("p_biscuits", 200, "g"))
    assert rows(session, glist) == [("Biscuits", 1, "pack"), ("Biscuits", 200, "g")]


def test_different_brand_is_a_different_row(session: Session, glist: GroceryList) -> None:
    add(
        session,
        glist,
        item("p_rice", 5, "kg", brand="Aashirvaad"),
        item("p_rice", 5, "kg", brand="India Gate"),
    )
    assert len(rows(session, glist)) == 2


def test_merge_keeps_the_lower_confidence(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"), item("p_tomato", 1, "kg", confidence="medium"))
    assert list_items(session, glist.id)[0].confidence == "medium"


def test_purchased_rows_are_not_merge_targets(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"))
    mark_purchased(session, glist.id, [list_items(session, glist.id)[0].id])
    add(session, glist, item("p_tomato", 1, "kg"))
    assert [(i.qty, i.status) for i in list_items(session, glist.id)] == [
        (1, ItemStatus.PURCHASED),
        (1, ItemStatus.PENDING),
    ]


def test_reusing_a_pending_id_refines_instead_of_summing(
    session: Session, glist: GroceryList
) -> None:
    add(
        session,
        glist,
        item("p_tomato", 1, "kg", id="it_1", source="household_memory", confidence="medium"),
    )
    add(session, glist, item("p_tomato", 2, "kg", id="it_1"))
    [row] = list_items(session, glist.id)
    assert (row.id, row.qty, row.source, row.confidence) == ("it_1", 2, "user", "high")


def test_missing_rationale_gets_the_default(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_onion", 1, "kg", rationale="  "))
    assert list_items(session, glist.id)[0].rationale == DEFAULT_RATIONALE


# --- Categorize ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("product_id", "expected"), [(k, v[1]) for k, v in CATALOG_CATEGORIES.items()]
)
def test_category_comes_from_the_catalog(product_id: str, expected: Category) -> None:
    assert categorize(product_id, CATALOG, Category.HOUSEHOLD) is expected


def test_proposal_category_is_only_a_fallback(session: Session, glist: GroceryList) -> None:
    add(
        session,
        glist,
        item("p_rice", 5, "kg", category=Category.SNACKS),
        ProposedListItem(
            product_id="p_unknown", product="Mystery", qty=1, unit="pcs",
            source="user", confidence="high", category=Category.PERSONAL_CARE,
        ),
    )  # fmt: skip
    assert [i.category for i in list_items(session, glist.id)] == ["Rice & Grains", "Personal Care"]


def test_grouped_view_uses_the_fixed_order(session: Session, glist: GroceryList) -> None:
    add(
        session,
        glist,
        *(
            item(pid, 1, "kg")
            for pid in ["p_tea", "p_onion", "p_rice", "p_tomato", "p_milk", "p_salt"]
        ),
    )
    view = grouped_view(session, glist.id)
    assert [(cat, [i.product for i in items]) for cat, items in view] == [
        ("Vegetables", ["Onions", "Tomatoes"]),
        ("Dairy", ["Milk"]),
        ("Rice & Grains", ["Rice"]),
        ("Cooking Essentials", ["Salt"]),
        ("Beverages", ["Tea"]),
    ]


def test_category_order_is_the_plan_order() -> None:
    assert [c.value for c in CATEGORY_ORDER] == [
        "Vegetables", "Fruits", "Dairy", "Rice & Grains", "Pulses", "Spices",
        "Cooking Essentials", "Snacks", "Beverages", "Household", "Personal Care",
    ]  # fmt: skip


def test_unknown_categories_sort_last() -> None:
    class Row:
        def __init__(self, category: str) -> None:
            self.category = category

    groups = group_by_category([Row("Misc"), Row("Snacks"), Row("Vegetables")])
    assert [c for c, _ in groups] == ["Vegetables", "Snacks", "Misc"]


def test_store_order_is_the_same_list_sorted_differently(
    session: Session, glist: GroceryList
) -> None:
    order = store_order(["Dairy", "Beverages", "Not a category", "Dairy", "Vegetables"])
    assert [c.value for c in order[:4]] == ["Dairy", "Beverages", "Vegetables", "Fruits"]
    assert sorted(order) == sorted(CATEGORY_ORDER)

    add(session, glist, *(item(pid, 1, "kg") for pid in ["p_tea", "p_onion", "p_milk", "p_salt"]))
    view = grouped_view(session, glist.id, order)
    assert [cat for cat, _ in view] == ["Dairy", "Beverages", "Vegetables", "Cooking Essentials"]


# --- Low-stock proposals ---------------------------------------------------------


def test_low_stock_proposals(session: Session) -> None:
    upsert_inventory(session, HH, "p_rice", S.ALMOST_FINISHED, now=EARLIER)
    upsert_inventory(session, HH, "p_milk", S.OUT, now=EARLIER)
    upsert_inventory(session, HH, "p_toor_dal", S.RUNNING_LOW, now=EARLIER)
    upsert_inventory(session, HH, "p_onion", S.AVAILABLE, now=EARLIER)
    session.commit()
    inv = get_inventory(session, HH)
    milk, rice = low_stock_proposals(inv, [], CATALOG)  # pantry rows come back in product-id order
    assert (rice.qty, rice.unit, rice.brand, rice.confidence) == (5, "kg", "Aashirvaad", "high")
    assert rice.rationale == "Pantry says rice is almost finished. You usually get 5 kg Aashirvaad."
    assert rice.category is Category.RICE_GRAINS
    # No memory → no invented amount.
    assert (milk.qty, milk.unit, milk.confidence) == (None, None, "low")
    assert milk.rationale == "Pantry says milk is finished."
    assert all(p.needs_confirmation and p.source == "household_memory" for p in (rice, milk))

    assert [p.product_id for p in low_stock_proposals(inv, ["p_rice"], CATALOG)] == ["p_milk"]
    rice_row = next(r for r in inv if r.product_id == "p_rice")
    dismissed = {"p_rice": rice_row.updated_at}
    assert [p.product_id for p in low_stock_proposals(inv, [], CATALOG, dismissed)] == ["p_milk"]


# --- Approval flow & item states -----------------------------------------------


def test_approve_then_add_reopens_as_draft(session: Session, glist: GroceryList) -> None:
    assert approve(session, glist) is False  # nothing pending
    add(session, glist, item("p_tomato", 1, "kg"))
    assert approve(session, glist) is True
    assert glist.status is ListStatus.APPROVED
    assert approve(session, glist) is False
    add(session, glist, item("p_onion", 1, "kg"))
    assert glist.status is ListStatus.DRAFT


def test_marking_purchased_keeps_the_list_approved(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"))
    approve(session, glist)
    [row] = mark_purchased(session, glist.id, [list_items(session, glist.id)[0].id])
    assert row.status is ItemStatus.PURCHASED
    assert glist.status is ListStatus.APPROVED
    assert mark_purchased(session, glist.id, [row.id]) == []  # already purchased


def test_remove_is_soft_and_only_for_pending(session: Session, glist: GroceryList) -> None:
    add(session, glist, item("p_tomato", 1, "kg"), item("p_onion", 1, "kg"))
    tomato, onion = list_items(session, glist.id)
    mark_purchased(session, glist.id, [onion.id])
    assert [r.id for r in remove_items(session, glist.id, [tomato.id, onion.id])] == [tomato.id]
    session.commit()
    assert [i.status for i in list_items(session, glist.id)] == [
        ItemStatus.REMOVED,
        ItemStatus.PURCHASED,
    ]
    assert rows(session, glist) == [("Onions", 1, "kg")]


def test_current_list_is_created_once_per_household(session: Session, glist: GroceryList) -> None:
    session.commit()
    assert current_list(session, HH, NOW).id == glist.id
    assert current_list(session, "hh_2", NOW).id != glist.id
