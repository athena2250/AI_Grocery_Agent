# plan_06 — Pantry Inventory

## Goal

Track what's in the house at a resolution that matches how the user talks about it: coarse states + optional approximate quantity, never forced precision.

## States (enum)

- `available` — plenty in stock.
- `running_low` — noticeable but still usable for a bit.
- `almost_finished` — imminent buy signal.
- `out` — zero on hand.

Optional `approxQty` + `approxUnit` where the user gives one ("half a packet", "about 200 g"). Never require it.

## Updates

Natural-language phrases the mock/LLM must map to state changes:

| Phrase | State |
|---|---|
| "X is almost finished" / "khatam hone wala" | `almost_finished` |
| "X is running low" / "kam hai" | `running_low` |
| "only half a packet of X left" | `almost_finished` + approxQty |
| "we still have plenty of X" | `available` |
| "no X left" / "finished" | `out` |
| "bought X" (via mark purchased) | `available` (with fresh timestamp) |

Marking an item purchased auto-flips the corresponding inventory row to `available`.

## Signal to planner

When state becomes `almost_finished` or `out`, the orchestrator can propose adding that product to the current draft list (with rationale "you said it's almost finished") — BUT only proposes; the user still confirms via chip.

## UI (Phase 1)

Pantry screen groups rows by state (three collapsible sections). Long-press to change state. Adding via chat is the primary path; direct edits are a fallback.

## Data

Table `inventory`:
```
household_id, product_id, state, approx_qty?, approx_unit?, updated_at
```

One row per (household, product). Upsert on update.

## Testing

- Table-driven test on the parse layer: N phrases → expected state transitions.
- Reducer test: applying an inventory update on a product not previously in inventory creates a new row.
