"""Household memory — learned preferences with inspectable confidence rules (plan_05)."""

from .models import AliasPreference, Preference
from .rules import AUTO_SUGGEST_GATE, confidence_level, effective_confidence
from .store import (
    AliasDefault,
    choose_alias,
    confirm_preference,
    correct_alias,
    get_alias_defaults,
    get_preferences,
    override_preference,
    record_purchase,
    save_as_usual,
)

__all__ = [
    "AUTO_SUGGEST_GATE",
    "AliasDefault",
    "AliasPreference",
    "Preference",
    "choose_alias",
    "confidence_level",
    "confirm_preference",
    "correct_alias",
    "effective_confidence",
    "get_alias_defaults",
    "get_preferences",
    "override_preference",
    "record_purchase",
    "save_as_usual",
]
