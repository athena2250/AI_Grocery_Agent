"""Household memory reads and gated writes (plan_05).

Every write function here corresponds to a *confirmed user action*: a purchase,
an explicit "save as usual", picking (or rejecting) the remembered option, or a
correction. The LLM never calls these — the orchestrator does, after the user
acts. Writes are added to the session; the caller commits.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from sqlmodel import Session, col, select

from app.ambiguity.safety_net import HouseholdPreference

from . import rules
from .models import AliasPreference, Preference


@dataclass(frozen=True)
class AliasDefault:
    """Read view of an `alias_preference` row, confidence already decayed."""

    disambiguation_group: str
    product_id: str
    confidence: float


# --- Reads -------------------------------------------------------------------


def get_preferences(
    session: Session,
    household_id: str,
    product_ids: Iterable[str],
    now: datetime,
) -> dict[str, HouseholdPreference]:
    """Preferences for the given products, keyed by product id, with staleness decay applied.

    Returns the safety net's `HouseholdPreference`, so the result drops straight
    into `Catalog(preferences=...)`; `dataclasses.asdict` gives prompt context.
    """

    ids = list(product_ids)
    rows = session.exec(
        select(Preference).where(
            Preference.household_id == household_id, col(Preference.product_id).in_(ids)
        )
    )
    return {
        r.product_id: HouseholdPreference(
            product_id=r.product_id,
            preferred_brand=r.preferred_brand,
            preferred_variant=r.preferred_variant,
            typical_qty=r.typical_qty,
            typical_unit=r.typical_unit,
            confidence=rules.effective_confidence(r.confidence, r.last_confirmed_at, now),
        )
        for r in rows
    }


def get_alias_defaults(
    session: Session,
    household_id: str,
    groups: Iterable[str],
    now: datetime,
) -> dict[str, AliasDefault]:
    rows = session.exec(
        select(AliasPreference).where(
            AliasPreference.household_id == household_id,
            col(AliasPreference.disambiguation_group).in_(list(groups)),
        )
    )
    return {
        r.disambiguation_group: AliasDefault(
            disambiguation_group=r.disambiguation_group,
            product_id=r.product_id,
            confidence=rules.effective_confidence(r.confidence, r.last_confirmed_at, now),
        )
        for r in rows
    }


# --- Gated writes ------------------------------------------------------------


def record_purchase(
    session: Session,
    household_id: str,
    product_id: str,
    *,
    qty: float | None,
    unit: str | None,
    previous_purchase_at: datetime | None,
    now: datetime,
) -> Preference | None:
    """Fold a confirmed purchase into memory. Only updates an existing preference."""

    pref = session.get(Preference, (household_id, product_id))
    if pref is None:
        return None
    pref.typical_qty, pref.typical_unit = rules.fold_qty(
        pref.typical_qty, pref.typical_unit, qty, unit
    )
    pref.typical_interval_days = rules.fold_interval(
        pref.typical_interval_days, previous_purchase_at, now
    )
    pref.confidence = rules.confirmed(pref.confidence)
    pref.last_confirmed_at = now
    pref.times_confirmed += 1
    session.add(pref)
    return pref


def save_as_usual(
    session: Session,
    household_id: str,
    product_id: str,
    *,
    preferred_brand: str | None = None,
    preferred_variant: str | None = None,
    typical_qty: float | None = None,
    typical_unit: str | None = None,
    now: datetime,
) -> Preference:
    """Explicit "save as usual". New → 0.6. Same values never lower confidence;
    different values replace the old ones at 0.6 (and count as an override)."""

    fields = {
        "preferred_brand": preferred_brand,
        "preferred_variant": preferred_variant,
        "typical_qty": typical_qty,
        "typical_unit": typical_unit,
    }
    pref = session.get(Preference, (household_id, product_id))
    if pref is None:
        pref = Preference(
            household_id=household_id,
            product_id=product_id,
            preferred_brand=preferred_brand,
            preferred_variant=preferred_variant,
            typical_qty=typical_qty,
            typical_unit=typical_unit,
            confidence=rules.SAVE_AS_USUAL_CONFIDENCE,
            last_confirmed_at=now,
            times_confirmed=1,
        )
    else:
        same = all(getattr(pref, k) == v for k, v in fields.items())
        for k, v in fields.items():
            setattr(pref, k, v)
        pref.confidence = (
            max(pref.confidence, rules.SAVE_AS_USUAL_CONFIDENCE)
            if same
            else rules.SAVE_AS_USUAL_CONFIDENCE
        )
        pref.last_confirmed_at = now
        pref.times_confirmed += 1
        pref.times_overridden += 0 if same else 1
    session.add(pref)
    return pref


def confirm_preference(
    session: Session, household_id: str, product_id: str, now: datetime
) -> Preference | None:
    """The user picked the remembered option ("yes, 1 kg")."""

    pref = session.get(Preference, (household_id, product_id))
    if pref is None:
        return None
    pref.confidence = rules.confirmed(pref.confidence)
    pref.last_confirmed_at = now
    pref.times_confirmed += 1
    session.add(pref)
    return pref


def override_preference(session: Session, household_id: str, product_id: str) -> Preference | None:
    """The user picked something other than the remembered option."""

    pref = session.get(Preference, (household_id, product_id))
    if pref is None:
        return None
    pref.confidence = rules.overridden(pref.confidence)
    pref.times_overridden += 1
    session.add(pref)
    return pref


def choose_alias(
    session: Session, household_id: str, group: str, product_id: str, now: datetime
) -> AliasPreference:
    """The user answered a disambiguation question. None remembered → 0.5; same →
    +0.1; different → -0.2, flipping to the new choice at 0.5 once below 0.5."""

    row = session.get(AliasPreference, (household_id, group))
    if row is None:
        row = AliasPreference(
            household_id=household_id,
            disambiguation_group=group,
            product_id=product_id,
            confidence=rules.START_CONFIDENCE,
            last_confirmed_at=now,
            times_confirmed=1,
        )
    elif row.product_id == product_id:
        row.confidence = rules.confirmed(row.confidence)
        row.last_confirmed_at = now
        row.times_confirmed += 1
    else:
        lowered = rules.overridden(row.confidence)
        if lowered < rules.START_CONFIDENCE:
            row.product_id = product_id
            row.confidence = rules.START_CONFIDENCE
            row.last_confirmed_at = now
        else:
            row.confidence = lowered
        row.times_overridden += 1
    session.add(row)
    return row


def correct_alias(
    session: Session, household_id: str, group: str, product_id: str, now: datetime
) -> AliasPreference:
    """An explicit correction ("no, seeds not powder") sets the group default at 0.6."""

    row = session.get(AliasPreference, (household_id, group))
    if row is None:
        row = AliasPreference(
            household_id=household_id,
            disambiguation_group=group,
            product_id=product_id,
            confidence=rules.CORRECTION_CONFIDENCE,
            last_confirmed_at=now,
            times_confirmed=1,
        )
    else:
        same = row.product_id == product_id
        row.product_id = product_id
        row.confidence = (
            max(row.confidence, rules.CORRECTION_CONFIDENCE)
            if same
            else rules.CORRECTION_CONFIDENCE
        )
        row.last_confirmed_at = now
        row.times_confirmed += 1
        row.times_overridden += 0 if same else 1
    session.add(row)
    return row
