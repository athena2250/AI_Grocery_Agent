# docs/DATABASE.md — Data Model

**Database:** local PostgreSQL 17, database `ai_grocery_agent` (browse it in DBeaver).
**Schema source of truth:** the SQLModel classes in `backend/app/**/models.py`. `init_db()` creates
anything missing and never drops. Alembic comes in once real data has to be migrated.
**Tests** run the same models on in-memory SQLite with foreign keys switched on.

```
cd backend
.venv/bin/python -m app.seed          # create tables + load starter data (safe to re-run)
DATABASE_URL=postgresql+psycopg://localhost:5432/ai_grocery_agent   # default; override per env
```

Field names in the grocery tables match the mobile TypeScript types (camelCased there), so
`HttpAIService` needs no adapter code.

## The idea: everything a family member sends is a post

Mom, Dad, or anyone else types a message. It becomes a `post` in `draft`. The LLM only
*extracts* fields into `post.fields_json`. A deterministic check (`app/feed/completeness.py`)
compares them with the `post_kind_field` rows for that kind:

- Something required missing → post goes `clarifying`, each gap becomes a question (with chips) to the author.
- Nothing missing → `ready`; the author taps Send → `published`, a `post_recipient` row per other member (the pop-up).
- `app/feed/store.publish()` refuses (`PostIncomplete`) while anything is missing, whoever the author is.

Required fields are data, so a new kind is a row insert, not a code change.

| kind | required | optional |
|---|---|---|
| grocery (per item; item falls back to post-level value) | item, qty, unit, expected_rate, needed_by | brand, variant |
| task (plumbing, repairs, maintenance …) | what, assigned_to, needed_by | location_in_house, budget |
| ticket_booking | from, to, travel_date, passengers, assigned_to | mode, time_pref |
| bill | bill_type, amount, due_date, assigned_to | account_ref |
| alert | message, recipients, repeat, interval_minutes (only if repeat) | until |

Repeated alerts ("keep reminding Dad about the plumber") are `reminder` rows on the post:
fire every `interval_minutes` until the member acknowledges / finishes (`stop_on`).
Each alert sent is a `reminder_log` row.

## Tables (32)

### People — `app/core/models.py`
| table | purpose |
|---|---|
| `household` | id, name, currency, timezone, monthly_grocery_budget |
| `member` | family members; role owner/member, relation, phone (WhatsApp later) |
| `device` | Expo push token per phone, for the pop-up |

### Catalog — `app/core/models.py`, `app/pricing/models.py`
| table | purpose |
|---|---|
| `product` | global catalog (seeded from `mobile/src/data/seed.ts` via `backend/app/seed_data.json`) |
| `product_alias` | words people say → product; `disambiguation_group` = ask which one; `household_id` NULL = global |
| `product_variant` | buyable pack: brand, name, package_qty/unit |
| `market_price` | observed rates per unit → the "expected rate" chip. Never invented; no row = ask |

### Feed — `app/feed/models.py`
`post_kind`, `post_kind_field`, `post`, `post_recipient` (delivered/seen/acknowledged),
`post_comment`, `reminder`, `reminder_log`.

### Conversation — `app/conversation/models.py`
| table | purpose |
|---|---|
| `conversation_turn` | chat log: who, text, channel, intent, LLM's parsed JSON |
| `pending_clarification` | an open question: field, question, options, suggested_option, status, chosen_option |

### Grocery — `app/planner`, `app/memory`, `app/inventory`, `app/history`, `app/receipts`
| table | purpose |
|---|---|
| `grocery_list` | draft / approved / completed; `needed_by` default; `post_id` |
| `grocery_list_item` | qty, unit, brand, variant, confidence, source, rationale + `needed_by`, `expected_unit_price`, `expected_total`, `price_source`, `added_by_member_id` |
| `preference`, `alias_preference` | household memory (written only from confirmed actions) |
| `memory_event` | audit: every memory create/confirm/override with before/after |
| `inventory` | pantry snapshot, one row per product |
| `inventory_event` | pantry history |
| `suggestion_dismissal` | "Not now" on restock/prediction suggestions |
| `purchase` | confirmed purchases; price history is a read over this |
| `receipt`, `receipt_line`, `store_alias` | receipt drafts until approved |

### Tasks & bills — `app/tasks/models.py`, `app/bills/models.py`
| table | purpose |
|---|---|
| `task` | category, title, details_json (e.g. ticket from/to/date), assigned_to, due_at, status open→acknowledged→in_progress→done |
| `task_event` | who changed status, when, note |
| `bill_account` | standing bill: kind, provider, account_ref, due_day, recurrence, assigned_to, remind_days_before |
| `bill_payment` | one period: amount_due, due_date, status upcoming/due/paid/overdue, paid_by |

### Not stored
Predictions, budget estimates, price-history view — computed on read. No vector DB.

## Relationships (quick view)

```
household 1─┬─* member 1─* device
            ├─* post ─┬─* post_recipient ─▶ member
            │         ├─* post_comment
            │         └─* reminder ─* reminder_log
            ├─* task ─* task_event                 (task.post_id ─▶ post)
            ├─* bill_account ─* bill_payment       (bill_payment.post_id ─▶ post)
            ├─* grocery_list ─* grocery_list_item ─▶ product / product_variant
            ├─* conversation_turn, pending_clarification
            ├─* preference, alias_preference, memory_event
            ├─* inventory, inventory_event, suggestion_dismissal
            ├─* purchase ─▶ product / product_variant / member
            └─* receipt ─* receipt_line

post_kind 1─* post_kind_field
product 1─┬─* product_alias
          ├─* product_variant
          └─* market_price
```

## Conventions
- Ids are strings (`h_home`, `m_mom`, `p_tomato`); `product_alias.id` is an integer.
- Timestamps are `timestamptz`, written as UTC.
- Enums are VARCHAR + CHECK storing the lowercase value (`draft`, not `DRAFT`); constraint name `ck_<table>_<column>`.
- JSON columns are `jsonb` in Postgres.
- Everything is scoped by `household_id`; auth later is middleware, not a schema change.

## Seeded
1 household (`h_home`), members `m_mom` / `m_dad` / `m_me` (rename freely), 5 post kinds + 29
field rules, 42 products, 98 aliases, 6 preferences, 12 purchases, 3 bill accounts
(electricity, internet, maintenance — amounts left empty on purpose).

## Not built yet
API endpoints for feed/tasks/bills, the reminder worker (reads `reminder` where
`active and next_fire_at <= now()`), push sending, the mobile feed/tasks/bills screens,
recipe tables (recipes are still constants in `app/recipes/data.py`), `store` table.

## Migrations
Pre-v1: `init_db()` adds missing tables but does not alter existing ones. To pick up a column
change, drop and recreate the DB (`dropdb ai_grocery_agent && createdb ai_grocery_agent && python -m app.seed`)
only while it holds no real data. Once it does, wire Alembic; never migrate destructively without a backup.
