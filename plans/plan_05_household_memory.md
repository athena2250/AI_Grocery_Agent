# plan_05 — Household Memory

## Goal

Persist what the AI has learned about how this household actually shops — preferred brands, typical quantities, purchase intervals, disambiguation defaults ("coriander → seeds") — with a confidence score that grows on confirmations and decays on corrections.

## Data

Table: `preference`
```
household_id, product_id, preferred_brand?, preferred_variant?,
typical_qty?, typical_unit?, typical_interval_days?,
confidence: float [0..1], last_confirmed_at, times_confirmed, times_overridden
```

Additional: `alias_preference` for "coriander → coriander seeds" style resolutions (per-household override of the alias disambiguation group's default).

## Confidence model (simple, transparent)

- Start at 0.5 on first explicit save.
- On confirmed purchase or "yes that's right" → +0.1 (cap 1.0).
- On explicit override ("no, get the other one") → -0.2 (floor 0.0).
- Time decay: if `last_confirmed_at` older than 180 days, multiply by 0.7 (staleness).
- Confidence gate for v2 auto-suggest: ≥ 0.7.

No ML. Purely rules the user can inspect.

## Writes are gated

Preferences update ONLY on confirmed user actions:
- Mark item purchased → increment `typical_qty` moving average, update `typical_interval_days` from last purchase, `+0.1` confidence.
- Explicit "save as usual" in Item Detail → upsert with confidence 0.6 (higher than passive learning).
- Correction ("no, seeds not powder") → set `alias_preference`, confidence 0.6.

The LLM does NOT write to memory. Ever.

## Reads

`get_preferences(household_id, product_ids[])` returns a dict for prompt context and for the deterministic safety net. Also used by the Memory screen (read-only view).

## Sandbox implementation

In Phase 1, memory is a TS map inside `HouseholdContext`, persisted to AsyncStorage. Shape matches the SQL schema so Phase 2 migration is copy-paste of field names.

## Testing

- Reducer tests: applying a confirmed purchase updates typical_qty (moving avg) and confidence correctly; applying an override decreases confidence.
- Integration: seed a preference, send "get the usual X", assert item added with `source: household_memory` and correct rationale.
