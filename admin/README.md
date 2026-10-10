# admin/ — Hearth admin console

A separate service from the family app. It has its own FastAPI process, its own port and its own
token, and it never ships inside the mobile app. It reads the same database through the backend's
SQLModel classes (the schema is defined once, in `backend/app/**/models.py`) and owns two tables
of its own: `admin_household_status` and `admin_action`.

## What it does

| Page | For |
|---|---|
| Overview | families by status, active members, this month's spend, open/overdue tasks, issue counts, 12-month spend chart, most-bought items |
| Passkey Issue | people waiting to sign in (pops up "… is trying to sign in" on every page, checked every 20 s): pick their home and relation → **Generate passkey**, shown once to read out to them; everyone in a home with their passkey status, Generate / Reset passkey (reset signs them out) |
| Purchases | spend and purchase count per month (chart or table, per family), click a month for every purchase line, frequently bought items for 30/90/180/365 days |
| Families | every home: status, owner, members, open tasks, purchases (30 days), last activity, issues |
| Family | members (force sign-out, make owner/member, remove/restore), status (active / under review / suspended + reason), tasks, posts and who received them, grocery lists, bills, sign-in log, issues, admin log |
| Tasks | all tasks across homes; filter by status / family / title / overdue; change status, reassign, see history |
| Feed posts | every post and its delivery to each member; resend, re-check, cancel |
| Issues | the scanner (`hearth_admin/diagnostics.py`): data that hides or blocks something in the app, with a one-click fix where the right fix is unambiguous |
| Audit log | every change made from the console: who, when, why, before/after |

### The issue scanner ("Mom says she can't see it")

| check | what the family sees | fix |
|---|---|---|
| post_missing_recipients | a published post never popped up for some members | add the missing recipients |
| post_published_incomplete | a post with blanks | none: ask the author |
| task_assignee_invalid | a task nobody sees as theirs | none: reassign on Tasks |
| list_item_unknown_category | an item missing from the grouped list | re-file under the catalog category, or Other |
| session_on_removed_member | a removed person still gets the feed | sign them out |
| household_no_owner | nobody can manage the home | none: make someone owner |
| reminder_late | alerts stopped | none: the reminder worker is down |
| post_stuck_open | a message that never went out (48 h+) | re-check completeness (never sends it for the author) |
| recipient_undelivered | a pop-up never arrived (1 h+) | none: shows whether they have a signed-in phone |
| task_done_without_done_at | a done task that never moves to history | set done_at |
| task_done_at_on_open | an open task hidden as done | clear done_at |
| list_item_orphan_question | an item waiting on a question nobody asks | clear the flag |
| reminder_on_closed_post | reminders about a closed post | stop the reminder |
| bill_past_due | a late bill not shown as urgent | mark overdue |
| clarification_stale / reminder_maxed | housekeeping | expire / stop |

A fix re-runs its check before it writes, so a row that has already recovered is left alone.

### What admins cannot do (on purpose)

The console repairs state. It never acts as a family member. So it can't publish a post on
someone's behalf, delete a family's rows, remove or demote a home's only owner, or move a task to
someone outside the home. Suspending a home, removing a member and cancelling a post all need a
written reason, and every write goes to `admin_action` in the same transaction.

## Run

The easy way, from the repo root (makes and remembers the token, copies it, opens the browser):

```
scripts/admin.sh          # this Mac's database
scripts/admin.sh live     # the live (Render) database; asks for its address once
scripts/admin.sh demo     # made-up families
```

By hand:

Uses the backend's virtualenv (it already has FastAPI, SQLModel and uvicorn installed):

```
cd admin
export ADMIN_TOKEN=$(openssl rand -hex 24)        # no token set = every API call refused
PYTHONPATH=. ../backend/.venv/bin/uvicorn hearth_admin.main:app --host 127.0.0.1 --port 8100
# open http://127.0.0.1:8100 and paste the token
```

`DATABASE_URL` works the same as in the backend (defaults to local Postgres `ai_grocery_agent`).
On first start the two `admin_*` tables are created if missing. Nothing is dropped or altered.

### Demo data

To see the console with a year of purchases, three homes and one of each broken state:

```
PYTHONPATH=. ../backend/.venv/bin/python -m hearth_admin.demo sqlite:///demo.db
DATABASE_URL=sqlite:///demo.db ADMIN_TOKEN=dev PYTHONPATH=. ../backend/.venv/bin/uvicorn hearth_admin.main:app --port 8100
```

The demo command needs an explicit URL and never falls back to `DATABASE_URL`, so it can't write
demo rows into the real database.

### Tests

```
cd admin && ../backend/.venv/bin/python -m pytest -q
```

## Before production

- **Data source.** The mobile sandbox still keeps everything on the phone (AsyncStorage). The
  console shows what is in the database, so families only show up once the app talks to the
  Phase 2 API.
- **Suspension is enforced by the family API, not here.** The API's session middleware should
  refuse a member whose household has `admin_household_status.status = 'suspended'`.
- **Access.** Run it on an internal host or behind a VPN or SSO proxy, never on the public app
  domain, and serve it over HTTPS. The shared token suits one or two operators. Per-admin accounts
  are the next step (the audit log already records a name for each change).
- **Scale.** Monthly totals and the scanner run in Python over the rows they need, so the same
  code works on Postgres and SQLite. Move the month grouping to `date_trunc` once there are
  thousands of homes.
