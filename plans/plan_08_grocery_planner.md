# plan_08 — Grocery Planner (List Assembly)

## Goal

Take resolved items (post-ambiguity, post-memory) and produce the categorized, human-approved shopping list. This is deterministic — no LLM involvement.

## Inputs

- `proposedItems[]` from the current turn (post safety net).
- `draftList` from `HouseholdContext` / DB.
- Inventory signals for `almost_finished`/`out` products not yet on the list.

## Steps

1. **Dedupe against draft**: same `product_id` + compatible unit → merge quantities. Different units → keep separate (don't attempt cross-unit math).
2. **Categorize** via `product.category`. Never LLM-based.
3. **Attach rationale** if not present: default to "you added it in this turn".
4. **Emit low-stock proposals** as ordinary items with `source: 'household_memory'` and rationale "pantry says X is almost finished" — but flagged `needsConfirmation: true` so the UI shows a confirm chip instead of silently adding.
5. **Group + sort**: fixed category order (Vegetables → Fruits → Dairy → Rice & Grains → Pulses → Spices → Cooking Essentials → Snacks → Beverages → Household → Personal Care).

## Category order (fixed)

```
Vegetables
Fruits
Dairy
Rice & Grains
Pulses
Spices
Cooking Essentials
Snacks
Beverages
Household
Personal Care
```

Later (Phase 4) this becomes configurable per store, ordered by shopping route.

## Approval flow

- `draft` → user hits "Approve list" → transitions to `approved`.
- Approved lists can still be edited; adding items post-approval reopens as `draft` (with confirmation).
- Marking items purchased in an approved list doesn't reopen it.

## Item states

```
pending → purchased | removed
```

Removal from a draft is soft — kept for audit but hidden from the list view.

## Data

Tables `grocery_list` (id, household_id, status, created_at) + `grocery_list_item` (list_id, product_id, variant_id?, qty, unit, category, source, confidence, rationale, status, needs_clarification, clarification_prompt).

## Testing

- Dedupe: adding tomatoes 1 kg twice → single row 2 kg.
- Dedupe with different units (1 kg + 500 g) → merged to 1.5 kg where unit conversion table supports it, else two rows.
- Category assignment for 20 sample products.
