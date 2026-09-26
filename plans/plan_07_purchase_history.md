# plan_07 — Purchase History

## Goal

Every confirmed purchase is logged with enough detail to power household memory statistics, price history, and (later) prediction.

## Schema

Table `purchase`:
```
id, household_id, product_id, product_variant_id?, member_id?,
qty, unit, brand?, package_size?, price?, currency?, store?,
purchased_at, notes?, source: 'chat_confirmed' | 'receipt_ocr' | 'manual'
```

`price_history` is a view over this table (product_variant → price series), not a separate write path.

## How rows get written

- User marks a list item purchased in the app → one `purchase` row.
- User uploads a receipt → many rows, one per line item (see [plan_09](plan_09_receipt_processing.md)).
- Manual add from History screen → one row with `source: 'manual'`.

The LLM never writes purchases.

## Statistics we derive

- **Typical interval**: exponentially-weighted moving average of days between consecutive purchases of the same product.
- **Typical qty**: EWMA of `qty` (per unit).
- **Preferred brand**: mode over last N purchases; ties broken by most recent.
- **Preferred variant**: same.

These roll into `preference` updates in [plan_05](plan_05_household_memory.md).

## Reads

- History screen: reverse-chronological, grouped by day.
- Prediction module (Phase 3): reads intervals to score `BUY_NOW / LIKELY_SOON / NOT_NEEDED`.
- Item Detail rationale: "last purchased 12 days ago at ₹310".

## Phase 1 sandbox

Purchases live in `HouseholdContext.history` (array). Mark-purchased action appends. Seed with 3–5 sample rows so the History screen isn't empty on first launch.

## Testing

- Marking the same product purchased twice N days apart updates `typical_interval_days` correctly.
- Purchases carry through to the preferred-brand computation.
