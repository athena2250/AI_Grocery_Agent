# plan_10 — Purchase Prediction

## Goal

For each frequently-purchased product, classify current status as `BUY_NOW`, `LIKELY_SOON`, or `NOT_NEEDED`, and surface `BUY_NOW` items as gentle suggestions on the Chat/List screens. Phase 3.

## Approach: statistics, not ML

Purchase intervals for household groceries are noisy but rice-cooker-simple to model. No ML in v1.

For each product with ≥ 3 historical purchases:

```
mean_interval  = EWMA(intervals, alpha=0.4)
std_interval   = EW-stddev(intervals, alpha=0.4)
last_purchase  = most recent purchased_at
days_since     = today - last_purchase
```

Classification:
- `BUY_NOW` if `days_since >= mean_interval - 0.5 * std_interval`.
- `LIKELY_SOON` if `days_since >= mean_interval - 1.5 * std_interval` (but not BUY_NOW).
- `NOT_NEEDED` otherwise.

Override signals:
- Inventory `almost_finished` or `out` → force `BUY_NOW` regardless of interval.
- Inventory `available` after a recent purchase → suppress `BUY_NOW` for a cooldown window.

## Products with < 3 purchases

Skip. Do not extrapolate from a single data point. The UI simply doesn't show a prediction until we have enough history.

## Surface in UI

- Chat: at the top of a fresh conversation, a subtle system bubble "3 items may be running low: rice, curd, oil. Add to list?" with per-item chips.
- List: predicted-but-not-added items appear in a collapsed "Suggested" section separate from user-added items.

Never auto-add. Always confirm.

## Later (v2)

Once we have ≥ 6 months of data across ≥ 2 households, revisit with a Poisson or renewal-process model. Not before.

## Testing

- Deterministic tests over synthetic purchase series (regular, irregular, one-off) → expected classification.
- Inventory-override tests: `almost_finished` beats a NOT_NEEDED verdict.
