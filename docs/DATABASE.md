# docs/DATABASE.md — Data Model

Same field names across Phase 1 (TypeScript in-memory + AsyncStorage) and Phase 2 (SQLite + SQLModel) so the swap is copy-paste. Phase 2 uses SQLite via SQLModel; migrations via Alembic when the schema stabilizes.

## Entities

### `household`
`id, name, created_at`

### `member`  (→ household)
`id, household_id, name, role, created_at`

### `product`  (catalog master)
`id, canonical_name, category, default_unit, disambiguation_group?`

`disambiguation_group` groups products that share a common short name (e.g. `coriander` → coriander-leaves, coriander-seeds, coriander-powder).

### `product_alias`  (→ product)
`alias (text), product_id`

Case-insensitive text lookup; SQLite FTS5 in Phase 2 for typo tolerance.

### `product_variant`  (→ product)
`id, product_id, brand, package_size, unit, notes`

Example: `(Aashirvaad, 5, kg)`.

### `preference`  (→ household, product) — household memory
`household_id, product_id, preferred_brand?, preferred_variant_id?, typical_qty?, typical_unit?, typical_interval_days?, confidence float, last_confirmed_at, times_confirmed, times_overridden`

PK: `(household_id, product_id)`.

### `alias_preference`  (→ household, disambiguation_group)
`household_id, disambiguation_group, resolved_product_id, confidence, last_confirmed_at`

For "in this household, 'coriander' means coriander seeds".

### `inventory`  (→ household, product)
`household_id, product_id, state (enum), approx_qty?, approx_unit?, updated_at`

PK: `(household_id, product_id)`.

### `grocery_list`  (→ household)
`id, household_id, status (draft|approved|completed), created_at`

### `grocery_list_item`  (→ grocery_list, product, product_variant?)
`id, list_id, product_id, product_variant_id?, qty, unit, category, source (user|household_memory|purchase_history|guess), confidence (high|medium|low), rationale, status (pending|purchased|removed), needs_clarification bool, clarification_prompt?, created_at`

### `purchase`  (→ household, product, product_variant?, member?)
`id, household_id, product_id, product_variant_id?, member_id?, qty, unit, brand?, package_size?, price?, currency?, store?, purchased_at, notes?, source (chat_confirmed|receipt_ocr|manual)`

### `conversation_turn`  (→ household)
`id, household_id, role (user|agent), text, parsed_json?, clarifications_json?, created_at`

Audit trail + future fine-tuning data.

## Deferred entities (Phase 3+)

- `receipt` — id, household_id, uploaded_by, image_ref, ocr_text, status, created_at.
- `receipt_line` (→ receipt) — parsed rows before approval.
- `price_history` — a **view** over `purchase` (product_variant → time series); no separate write path.
- `recipe`, `recipe_ingredient`.
- `store`, `shopping_route`.

## Enums

```
INVENTORY_STATE = { available, running_low, almost_finished, out }
LIST_STATUS     = { draft, approved, completed }
ITEM_STATUS     = { pending, purchased, removed }
INTENT          = { ADD_ITEMS, UPDATE_INVENTORY, MARK_PURCHASED, SHOW_LIST, CLARIFY_RESPONSE, UNKNOWN }
SOURCE          = { user, household_memory, purchase_history, guess }
CONFIDENCE      = { high, medium, low }
PURCHASE_SRC    = { chat_confirmed, receipt_ocr, manual }
```

## Relationships (quick view)

```
household 1─┬─* member
            ├─* preference
            ├─* alias_preference
            ├─* inventory
            ├─* grocery_list ─* grocery_list_item ─▶ product / product_variant
            ├─* purchase                        ─▶ product / product_variant / member
            └─* conversation_turn

product 1─* product_alias
product 1─* product_variant
```

## Indexing (Phase 2)

- `product_alias(alias)` — text index (FTS5).
- `preference(household_id, product_id)` — PK.
- `purchase(household_id, product_id, purchased_at desc)` — for interval computation.
- `grocery_list_item(list_id, status)` — for list rendering.

## Multi-tenancy

Everything is scoped by `household_id`. Adding auth later is a middleware concern, not a schema change.

## Migrations

SQLModel table-drop-and-recreate acceptable pre-v1. Once real users exist, wire Alembic. Never migrate destructively without a backup command in the same PR.
