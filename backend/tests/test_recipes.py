"""Tests for recipe intelligence (plan_11): seed data, dish matching, pantry diff, never auto-add."""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity.safety_net import Catalog, CatalogProduct, HouseholdPreference
from app.inventory import Inventory, upsert_inventory
from app.planner import Category, ProposedListItem, add_items, current_list
from app.recipes import (
    RECIPES,
    Recipe,
    check_recipe,
    check_recipe_for_household,
    find_recipe,
    recipe_message,
)
from app.understanding.schema import InventoryStateLiteral as S

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)
SEED_TS = Path(__file__).resolve().parents[2] / "mobile" / "src" / "data" / "seed.ts"

CATALOG = Catalog(
    products=(
        CatalogProduct("p_toor_dal", "Toor dal", "kg", Category.PULSES.value),
        CatalogProduct("p_tomato", "Tomatoes", "kg", Category.VEGETABLES.value),
        CatalogProduct("p_onion", "Onions", "kg", Category.VEGETABLES.value),
        CatalogProduct("p_turmeric", "Turmeric powder", "g", Category.SPICES.value),
        CatalogProduct("p_salt", "Salt", "kg", Category.COOKING_ESSENTIALS.value),
    ),
    preferences=(
        HouseholdPreference(
            "p_toor_dal", preferred_brand="Tata Sampann", typical_qty=1, typical_unit="kg",
            confidence=0.8,
        ),
    ),
)  # fmt: skip
SAMBAR = Recipe(
    "r_test", "Sambar", ("sambar",),
    ("p_toor_dal", "p_tomato", "p_onion", "p_turmeric", "p_salt", "p_tamarind", "p_tomato"),
)  # fmt: skip


def row(pid: str, state: S) -> Inventory:
    return Inventory(household_id=HH, product_id=pid, state=state, updated_at=NOW)


# --- Seed data -----------------------------------------------------------------------------


def test_seed_has_about_thirty_dishes_with_unique_ids() -> None:
    assert len(RECIPES) >= 30
    assert len({r.id for r in RECIPES}) == len(RECIPES)


def test_every_ingredient_is_a_seed_catalog_product() -> None:
    seed_ids = set(re.findall(r"id: '(p_\w+)'", SEED_TS.read_text()))
    unknown = {(r.id, pid) for r in RECIPES for pid in r.ingredients if pid not in seed_ids}
    assert not unknown


def test_aliases_do_not_collide_across_dishes() -> None:
    seen: dict[str, str] = {}
    for r in RECIPES:
        for alias in r.aliases:
            assert seen.setdefault(alias, r.id) == r.id, alias


# --- Matching ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "recipe_id"),
    [
        ("I'm making sambar tomorrow", "r_sambar"),
        ("making moong dal tonight", "r_moong_dal"),
        ("dal for dinner", "r_dal_tadka"),
        ("Rajma chawal on Sunday!", "r_rajma"),
        ("kids want payasam", "r_kheer"),
        ("get coriander", None),
        ("dalia", None),
    ],
)
def test_find_recipe(text: str, recipe_id: str | None) -> None:
    found = find_recipe(text, RECIPES)
    assert (found.id if found else None) == recipe_id


# --- Pantry diff -----------------------------------------------------------------------------


def test_check_recipe_buckets_each_ingredient_once() -> None:
    inventory = [
        row("p_toor_dal", S.OUT),
        row("p_tomato", S.ALMOST_FINISHED),
        row("p_turmeric", S.RUNNING_LOW),
        row("p_salt", S.AVAILABLE),
    ]
    check = check_recipe(SAMBAR, inventory, on_list_product_ids=[], catalog=CATALOG)
    assert [p.product_id for p in check.proposals] == ["p_toor_dal", "p_tomato"]
    assert check.have == ["p_turmeric", "p_salt"]
    assert check.unsure == ["p_onion"]  # no pantry row → ask; p_tamarind isn't in the catalog
    assert check.on_list == []


def test_proposals_need_confirmation_and_use_memory_or_no_amount() -> None:
    inventory = [row("p_toor_dal", S.OUT), row("p_tomato", S.OUT)]
    dal, tomato = check_recipe(SAMBAR, inventory, [], CATALOG).proposals
    assert all(p.needs_confirmation for p in (dal, tomato))
    assert (dal.qty, dal.unit, dal.brand, dal.source, dal.confidence) == (
        1, "kg", "Tata Sampann", "household_memory", "high",
    )  # fmt: skip
    assert dal.category is Category.PULSES
    assert dal.rationale == (
        "For sambar — pantry says toor dal is low. You usually get 1 kg Tata Sampann."
    )
    assert (tomato.qty, tomato.unit, tomato.source, tomato.confidence) == (
        None,
        None,
        "user",
        "low",
    )


def test_items_already_on_the_list_are_not_proposed_again() -> None:
    check = check_recipe(SAMBAR, [row("p_toor_dal", S.OUT)], ["p_toor_dal"], CATALOG)
    assert check.proposals == [] and check.on_list == ["p_toor_dal"]


@pytest.mark.parametrize(
    ("inventory", "message"),
    [
        (
            [row("p_toor_dal", S.OUT), row("p_tomato", S.OUT), row("p_onion", S.AVAILABLE)],
            (
                "For sambar, the pantry is low on toor dal and tomatoes. Add them to the list?"
                " Do you have turmeric powder and salt?"
            ),
        ),
        (
            [row(p, S.AVAILABLE) for p in ("p_toor_dal", "p_tomato", "p_onion")],
            "For sambar: do you have turmeric powder and salt?",
        ),
        (
            [row(p, S.AVAILABLE) for p in ("p_toor_dal", "p_tomato", "p_onion", "p_turmeric")]
            + [row("p_salt", S.OUT)],
            "For sambar, the pantry is low on salt. Add it to the list?",
        ),
        (
            [row(p, S.AVAILABLE) for p in ("p_toor_dal", "p_tomato", "p_onion", "p_turmeric")]
            + [row("p_salt", S.RUNNING_LOW)],
            "You have everything for sambar.",
        ),
    ],
)
def test_recipe_message(inventory: list[Inventory], message: str) -> None:
    assert recipe_message(check_recipe(SAMBAR, inventory, [], CATALOG), CATALOG) == message


# --- Store read ------------------------------------------------------------------------------


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_household_check_reads_pantry_and_list_without_writing(session: Session) -> None:
    upsert_inventory(session, HH, "p_toor_dal", S.OUT, now=NOW)
    upsert_inventory(session, HH, "p_tomato", S.OUT, now=NOW)
    glist = current_list(session, HH, NOW, new_id=lambda: "list_1")
    add_items(
        session, glist, [ProposedListItem("p_tomato", "Tomatoes", 1, "kg", "user", "high")],
        CATALOG, NOW, new_id=lambda: "li_1",
    )  # fmt: skip
    session.commit()

    check = check_recipe_for_household(session, HH, glist, SAMBAR, CATALOG)
    assert [p.product_id for p in check.proposals] == ["p_toor_dal"]
    assert check.on_list == ["p_tomato"]
    assert not session.dirty and not session.new
