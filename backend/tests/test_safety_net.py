"""Tests for the deterministic ambiguity safety net (plan_04).

Table-driven: (extracted items, alias table, preference table) → forced ambiguity kinds.
Plus an integration test: a fake LLM that *forgets* the coriander ambiguity
still yields a product_type clarification with 3 options.
"""

from __future__ import annotations

import json

import pytest

from app.ambiguity import (
    Catalog,
    CatalogAlias,
    CatalogProduct,
    HouseholdPreference,
    apply_safety_net,
    merge_ambiguities,
    understand,
)
from app.understanding import UnderstandingClient
from app.understanding.schema import (
    Ambiguity,
    AmbiguityKind,
    ExtractedItem,
    Intent,
    InventoryUpdate,
    LLMExtraction,
)

PRODUCTS = (
    CatalogProduct("p_coriander_leaves", "Coriander leaves", "bunch"),
    CatalogProduct("p_coriander_seeds", "Coriander seeds", "g"),
    CatalogProduct("p_coriander_powder", "Coriander powder", "g"),
    CatalogProduct("p_tomato", "Tomatoes", "kg"),
    CatalogProduct("p_rice", "Rice", "kg"),
    CatalogProduct("p_biscuits", "Biscuits", "pack"),
    CatalogProduct("p_toor_dal", "Toor dal", "kg"),
    CatalogProduct("p_moong_dal", "Moong dal", "kg"),
)

ALIASES = (
    CatalogAlias("coriander", "p_coriander_leaves", "coriander"),
    CatalogAlias("coriander", "p_coriander_seeds", "coriander"),
    CatalogAlias("coriander", "p_coriander_powder", "coriander"),
    CatalogAlias("coriander leaves", "p_coriander_leaves"),
    CatalogAlias("coriander seeds", "p_coriander_seeds"),
    CatalogAlias("coriander powder", "p_coriander_powder"),
    CatalogAlias("tomatoes", "p_tomato"),
    CatalogAlias("rice", "p_rice"),
    CatalogAlias("biscuits", "p_biscuits"),
    # product_identity: "dal" maps to two unrelated products, no group.
    CatalogAlias("dal", "p_toor_dal"),
    CatalogAlias("dal", "p_moong_dal"),
    CatalogAlias("toor dal", "p_toor_dal"),
)

PREFS = (
    HouseholdPreference("p_tomato", typical_qty=1, typical_unit="kg", confidence=0.9),
    HouseholdPreference(
        "p_rice",
        preferred_brand="Aashirvaad",
        preferred_variant="Sona Masoori",
        typical_qty=5,
        typical_unit="kg",
        confidence=0.95,
    ),
)

CATALOG = Catalog(products=PRODUCTS, aliases=ALIASES, preferences=PREFS)


def _item(raw: str, **kw) -> ExtractedItem:
    return ExtractedItem(raw_text=raw, **kw)


CASES = [
    # (id, item, catalog, expected kinds)
    ("coriander → product_type only", _item("coriander"), CATALOG, ["product_type"]),
    (
        "dhania-style group via canonical fallback",
        _item("dhaniya", canonical_guess="coriander"),
        CATALOG,
        ["product_type"],
    ),
    ("coriander seeds explicit → qty only", _item("coriander seeds"), CATALOG, ["quantity"]),
    (
        "coriander + seeds hint narrows",
        _item("coriander", variant_hint="seeds"),
        CATALOG,
        ["quantity"],
    ),
    (
        "coriander seeds with qty → nothing",
        _item("coriander seeds", qty=100, unit="g"),
        CATALOG,
        [],
    ),
    ("dal without qualifier → product_type (identity)", _item("dal"), CATALOG, ["product_type"]),
    ("toor dal → qty (no pref)", _item("toor dal"), CATALOG, ["quantity"]),
    ("tomatoes, no qty, pref has typical_qty → nothing", _item("tomatoes"), CATALOG, []),
    (
        "tomatoes, no pref table → quantity",
        _item("tomatoes"),
        Catalog(PRODUCTS, ALIASES, ()),
        ["quantity"],
    ),
    ("usual rice, remembered → nothing", _item("rice", variant_hint="usual"), CATALOG, []),
    (
        "usual biscuits, nothing remembered → usual_unresolved + quantity",
        _item("the usual biscuits", variant_hint="usual"),
        CATALOG,
        ["usual_unresolved", "quantity"],
    ),
    (
        "usual biscuits with qty → usual_unresolved only",
        _item("biscuits", variant_hint="usual", qty=2, unit="pack"),
        CATALOG,
        ["usual_unresolved"],
    ),
    ("unknown product, no qty → quantity", _item("dragonfruit"), CATALOG, ["quantity"]),
    (
        "LLM canonical cannot override ambiguous raw text",
        _item("coriander", canonical_guess="coriander seeds"),
        CATALOG,
        ["product_type"],
    ),
]


@pytest.mark.parametrize("item,catalog,expected", [c[1:] for c in CASES], ids=[c[0] for c in CASES])
def test_forced_ambiguities_table(
    item: ExtractedItem, catalog: Catalog, expected: list[str]
) -> None:
    extraction = LLMExtraction(intent=Intent.ADD_ITEMS, items=[item])
    result = apply_safety_net(extraction, catalog)
    assert [a.kind.value for a in result.ambiguities] == expected


def test_product_type_options_come_from_catalog() -> None:
    extraction = LLMExtraction(intent=Intent.ADD_ITEMS, items=[_item("coriander")])
    [amb] = apply_safety_net(extraction, CATALOG).ambiguities
    assert amb.options == ["Coriander leaves", "Coriander seeds", "Coriander powder"]


def test_quantity_options_follow_product_unit() -> None:
    extraction = LLMExtraction(intent=Intent.ADD_ITEMS, items=[_item("coriander seeds")])
    [amb] = apply_safety_net(extraction, CATALOG).ambiguities
    assert amb.options == ["50 g", "100 g", "200 g", "custom"]


@pytest.mark.parametrize(
    "intent", [Intent.CLARIFY_RESPONSE, Intent.SHOW_LIST, Intent.MARK_PURCHASED, Intent.UNKNOWN]
)
def test_non_request_intents_are_not_rescanned(intent: Intent) -> None:
    extraction = LLMExtraction(intent=intent, items=[_item("seeds")])
    assert apply_safety_net(extraction, CATALOG).ambiguities == []


def test_ambiguous_inventory_update_forces_product_type() -> None:
    extraction = LLMExtraction(
        intent=Intent.UPDATE_INVENTORY,
        inventory_updates=[InventoryUpdate(raw_text="coriander", state="out")],
    )
    kinds = [a.kind.value for a in apply_safety_net(extraction, CATALOG).ambiguities]
    assert kinds == ["product_type"]


def test_merge_dedupes_and_forced_wins_on_collision() -> None:
    llm = [
        Ambiguity(
            raw_text="Coriander",
            kind=AmbiguityKind.PRODUCT_TYPE,
            question="Which coriander?",
            options=["leaves", "seeds", "powder"],
        ),
        Ambiguity(
            raw_text="coriander", kind=AmbiguityKind.PRODUCT_IDENTITY, question="dup", options=["x"]
        ),
        Ambiguity(
            raw_text="milk",
            kind=AmbiguityKind.BRAND,
            question="Which brand?",
            options=["Amul", "Nandini"],
        ),
    ]
    forced = [
        Ambiguity(
            raw_text="coriander",
            kind=AmbiguityKind.PRODUCT_TYPE,
            question="Which coriander?",
            options=["Coriander leaves", "Coriander seeds", "Coriander powder"],
        ),
    ]
    merged = merge_ambiguities(llm, forced)
    assert [(a.raw_text, a.kind.value) for a in merged] == [
        ("coriander", "product_type"),
        ("milk", "brand"),
    ]
    assert merged[0].options == ["Coriander leaves", "Coriander seeds", "Coriander powder"]


def test_llm_only_ambiguities_are_kept() -> None:
    # "tomatoes I don't know how much" — LLM asks qty even though memory has a default.
    # v1 policy is always-ask, so the net never removes an LLM question.
    extraction = LLMExtraction(
        intent=Intent.ADD_ITEMS,
        items=[_item("tomatoes")],
        ambiguities=[
            Ambiguity(
                raw_text="tomatoes",
                kind=AmbiguityKind.QUANTITY,
                question="How many tomatoes?",
                options=["500 g", "1 kg"],
            )
        ],
    )
    result = apply_safety_net(extraction, CATALOG)
    assert [a.kind.value for a in result.ambiguities] == ["quantity"]
    assert result.ambiguities[0].options == ["500 g", "1 kg"]


class _ForgetfulLLM:
    """Returns coriander with NO ambiguities — the case the safety net exists for."""

    async def chat(self, model: str, messages: list[dict[str, str]]) -> str:
        return json.dumps(
            {
                "intent": "ADD_ITEMS",
                "items": [
                    {
                        "raw_text": "coriander",
                        "canonical_guess": "coriander seeds",
                        "qty": None,
                        "unit": None,
                        "brand": None,
                        "variant_hint": None,
                    }
                ],
                "inventory_updates": [],
                "ambiguities": [],
                "purchases_marked": [],
            }
        )


@pytest.mark.asyncio
async def test_pipeline_coriander_yields_three_options_even_when_llm_forgets() -> None:
    result = await understand(UnderstandingClient(_ForgetfulLLM()), "get coriander", CATALOG)
    [amb] = result.ambiguities
    assert amb.kind is AmbiguityKind.PRODUCT_TYPE
    assert len(amb.options) == 3
