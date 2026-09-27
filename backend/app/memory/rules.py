"""Household memory confidence rules (plan_05). Pure functions — no I/O, no LLM.

Mirrors mobile/src/state/memory.ts; keep the numbers in sync.

  - First explicit choice starts at 0.5; "save as usual" / a correction at 0.6.
  - Confirmation (purchase, picking the remembered option)     → +0.1, cap 1.0.
  - Override (picking something other than the remembered one) → -0.2, floor 0.
  - Not confirmed for 180 days → read as confidence × 0.7 (never written back).
  - Auto-suggest gate: effective confidence ≥ 0.7.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

START_CONFIDENCE = 0.5
SAVE_AS_USUAL_CONFIDENCE = 0.6
CORRECTION_CONFIDENCE = 0.6
CONFIRM_STEP = 0.1
OVERRIDE_STEP = 0.2
STALE_AFTER = timedelta(days=180)
STALE_FACTOR = 0.7
AUTO_SUGGEST_GATE = 0.7
MOVING_AVG_WEIGHT = 0.3
"""Weight of the newest purchase in the typical-qty / interval moving averages."""

# Mass/volume only; anything else (pack, bunch, …) must match exactly.
_UNIT_BASE: dict[str, tuple[str, float]] = {
    "g": ("g", 1),
    "kg": ("g", 1000),
    "ml": ("ml", 1),
    "L": ("ml", 1000),
}


def _round_half_up(n: float, digits: int = 0) -> float:
    """JS `Math.round` semantics, so both sides agree on .5 cases."""

    scale = 10**digits
    return math.floor(n * scale + 0.5) / scale


def _clamp01(n: float) -> float:
    return min(1.0, max(0.0, _round_half_up(n, 2)))


def as_utc(dt: datetime) -> datetime:
    """SQLite hands datetimes back naive; they were written as UTC."""

    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def confirmed(confidence: float) -> float:
    return _clamp01(confidence + CONFIRM_STEP)


def overridden(confidence: float) -> float:
    return _clamp01(confidence - OVERRIDE_STEP)


def moving_average(old: float, new: float) -> float:
    return old * (1 - MOVING_AVG_WEIGHT) + new * MOVING_AVG_WEIGHT


def is_stale(last_confirmed_at: datetime, now: datetime) -> bool:
    return as_utc(now) - as_utc(last_confirmed_at) > STALE_AFTER


def effective_confidence(confidence: float, last_confirmed_at: datetime, now: datetime) -> float:
    if is_stale(last_confirmed_at, now):
        return _round_half_up(confidence * STALE_FACTOR, 2)
    return confidence


def confidence_level(score: float) -> str:
    """Numeric memory confidence → the high/medium/low shown on a list item."""

    if score >= AUTO_SUGGEST_GATE:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def convert_qty(qty: float, from_unit: str, to_unit: str) -> float | None:
    if from_unit == to_unit:
        return qty
    a, b = _UNIT_BASE.get(from_unit), _UNIT_BASE.get(to_unit)
    if a is None or b is None or a[0] != b[0]:
        return None
    return qty * a[1] / b[1]


def fold_qty(
    typical_qty: float | None,
    typical_unit: str | None,
    qty: float | None,
    unit: str | None,
) -> tuple[float | None, str | None]:
    """Fold one purchased quantity into the typical-qty moving average."""

    if qty is None or not unit:
        return typical_qty, typical_unit
    if typical_qty is None or not typical_unit:
        return qty, unit
    converted = convert_qty(qty, unit, typical_unit)
    if converted is None:
        return typical_qty, typical_unit
    return _round_half_up(moving_average(typical_qty, converted), 2), typical_unit


def fold_interval(
    typical_interval_days: int | None,
    previous_purchase_at: datetime | None,
    now: datetime,
) -> int | None:
    """Fold the gap since the previous purchase into the repurchase-interval average."""

    if previous_purchase_at is None:
        return typical_interval_days
    gap = int(_round_half_up((as_utc(now) - as_utc(previous_purchase_at)) / timedelta(days=1)))
    if gap < 1:
        return typical_interval_days
    if typical_interval_days is None:
        return gap
    return int(_round_half_up(moving_average(typical_interval_days, gap)))
