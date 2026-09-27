"""Tests for household memory (plan_05): confidence rules + gated writes + reads."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity import Catalog, CatalogAlias, CatalogProduct, apply_safety_net
from app.memory import (
    AliasPreference,
    Preference,
    choose_alias,
    confirm_preference,
    correct_alias,
    get_alias_defaults,
    get_preferences,
    override_preference,
    record_purchase,
    rules,
    save_as_usual,
)
from app.understanding.schema import AmbiguityKind, ExtractedItem, Intent, LLMExtraction

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)


def days_ago(n: float) -> datetime:
    return NOW - timedelta(days=n)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def seed_tomato(session: Session, **overrides: object) -> None:
    fields: dict[str, object] = {
        "household_id": HH,
        "product_id": "p_tomato",
        "typical_qty": 1.0,
        "typical_unit": "kg",
        "confidence": 0.5,
        "last_confirmed_at": days_ago(10),
        "times_confirmed": 1,
    }
    fields.update(overrides)
    session.add(Preference.model_validate(fields))
    session.commit()


# --- Pure rules ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("fn", "before", "after"),
    [
        (rules.confirmed, 0.5, 0.6),
        (rules.confirmed, 0.95, 1.0),
        (rules.overridden, 0.9, 0.7),
        (rules.overridden, 0.1, 0.0),
    ],
)
def test_confidence_steps(fn, before, after) -> None:  # type: ignore[no-untyped-def]
    assert fn(before) == after


def test_staleness_decay_is_read_time_only() -> None:
    assert rules.effective_confidence(0.9, days_ago(200), NOW) == 0.63
    assert rules.effective_confidence(0.9, days_ago(100), NOW) == 0.9
    # Naive datetimes (as SQLite returns them) are treated as UTC.
    assert rules.effective_confidence(0.9, days_ago(200).replace(tzinfo=None), NOW) == 0.63


@pytest.mark.parametrize(
    ("typical", "unit", "qty", "qty_unit", "expected"),
    [
        (1.0, "kg", 2.0, "kg", (1.3, "kg")),
        (1.0, "kg", 500.0, "g", (0.85, "kg")),
        (1.0, "kg", 2.0, "pack", (1.0, "kg")),  # incomparable → unchanged
        (None, None, 2.0, "pack", (2.0, "pack")),  # nothing remembered → take it
        (1.0, "kg", None, None, (1.0, "kg")),
    ],
)
def test_fold_qty(typical, unit, qty, qty_unit, expected) -> None:  # type: ignore[no-untyped-def]
    assert rules.fold_qty(typical, unit, qty, qty_unit) == expected


def test_fold_interval() -> None:
    assert rules.fold_interval(None, days_ago(7), NOW) == 7
    assert rules.fold_interval(10, days_ago(4), NOW) == 8
    assert rules.fold_interval(10, None, NOW) == 10
    assert rules.fold_interval(10, days_ago(0.1), NOW) == 10  # same-day repeat ignored


# --- Gated writes ---------------------------------------------------------------


def test_purchase_updates_moving_avg_interval_and_confidence(session: Session) -> None:
    seed_tomato(session, typical_interval_days=10)
    pref = record_purchase(
        session, HH, "p_tomato", qty=2.0, unit="kg", previous_purchase_at=days_ago(4), now=NOW
    )
    session.commit()
    assert pref is not None
    assert (pref.typical_qty, pref.typical_interval_days, pref.confidence) == (1.3, 8, 0.6)
    assert pref.times_confirmed == 2


def test_first_purchase_does_not_create_a_preference(session: Session) -> None:
    got = record_purchase(
        session, HH, "p_onion", qty=1.0, unit="kg", previous_purchase_at=None, now=NOW
    )
    assert got is None
    assert session.get(Preference, (HH, "p_onion")) is None


def test_override_decreases_and_confirm_increases(session: Session) -> None:
    seed_tomato(session, confidence=0.9)
    pref = override_preference(session, HH, "p_tomato")
    assert pref is not None
    assert (pref.confidence, pref.times_overridden) == (0.7, 1)
    pref = confirm_preference(session, HH, "p_tomato", NOW)
    assert pref is not None
    assert pref.confidence == 0.8


def test_save_as_usual(session: Session) -> None:
    new = save_as_usual(session, HH, "p_onion", typical_qty=2.0, typical_unit="kg", now=NOW)
    assert new.confidence == 0.6

    seed_tomato(session, confidence=0.9)
    same = save_as_usual(session, HH, "p_tomato", typical_qty=1.0, typical_unit="kg", now=NOW)
    assert (same.confidence, same.times_overridden) == (0.9, 0)
    changed = save_as_usual(session, HH, "p_tomato", typical_qty=2.0, typical_unit="kg", now=NOW)
    assert (changed.typical_qty, changed.confidence, changed.times_overridden) == (2.0, 0.6, 1)


def test_alias_choice_starts_confirms_and_flips(session: Session) -> None:
    row = choose_alias(session, HH, "coriander", "p_coriander_seeds", NOW)
    assert (row.product_id, row.confidence) == ("p_coriander_seeds", 0.5)
    row = choose_alias(session, HH, "coriander", "p_coriander_seeds", NOW)
    assert row.confidence == 0.6
    row = choose_alias(session, HH, "coriander", "p_coriander_leaves", NOW)
    assert (row.product_id, row.confidence) == ("p_coriander_leaves", 0.5)


def test_alias_correction_sets_default_at_0_6(session: Session) -> None:
    choose_alias(session, HH, "coriander", "p_coriander_powder", NOW)
    row = correct_alias(session, HH, "coriander", "p_coriander_seeds", NOW)
    session.commit()
    stored = session.get(AliasPreference, (HH, "coriander"))
    assert stored is row
    assert (row.product_id, row.confidence, row.times_overridden) == ("p_coriander_seeds", 0.6, 1)


# --- Reads ----------------------------------------------------------------------


def test_get_preferences_filters_and_decays(session: Session) -> None:
    seed_tomato(session, confidence=0.9, last_confirmed_at=days_ago(200))
    session.add(
        Preference(
            household_id="someone_else",
            product_id="p_tomato",
            confidence=1.0,
            last_confirmed_at=NOW,
        )
    )
    session.add(
        Preference(household_id=HH, product_id="p_rice", confidence=1.0, last_confirmed_at=NOW)
    )
    session.commit()

    prefs = get_preferences(session, HH, ["p_tomato"], NOW)
    assert list(prefs) == ["p_tomato"]
    assert prefs["p_tomato"].confidence == 0.63
    assert prefs["p_tomato"].typical_qty == 1.0


def test_get_alias_defaults(session: Session) -> None:
    correct_alias(session, HH, "coriander", "p_coriander_seeds", NOW)
    session.commit()
    got = get_alias_defaults(session, HH, ["coriander", "dal"], NOW)
    assert list(got) == ["coriander"]
    assert got["coriander"].product_id == "p_coriander_seeds"


def test_preferences_feed_the_safety_net(session: Session) -> None:
    """Integration: remembered typical_qty means the net doesn't force a quantity question."""

    seed_tomato(session)
    catalog = Catalog(
        products=(
            CatalogProduct("p_tomato", "Tomatoes", "kg"),
            CatalogProduct("p_onion", "Onions", "kg"),
        ),
        aliases=(CatalogAlias("tomatoes", "p_tomato"), CatalogAlias("onions", "p_onion")),
        preferences=tuple(get_preferences(session, HH, ["p_tomato", "p_onion"], NOW).values()),
    )
    extraction = LLMExtraction(
        intent=Intent.ADD_ITEMS,
        items=[ExtractedItem(raw_text="tomatoes"), ExtractedItem(raw_text="onions")],
    )
    out = apply_safety_net(extraction, catalog)
    assert [(a.raw_text, a.kind) for a in out.ambiguities] == [("onions", AmbiguityKind.QUANTITY)]
