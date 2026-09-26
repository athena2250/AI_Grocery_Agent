# PLAN.md — AI Grocery Agent Master Plan

This is the single top-level roadmap. Detailed per-area plans live in [plans/](plans/); architectural specs live in [docs/](docs/). Read [CLAUDE.md](CLAUDE.md) for the always-loaded project brief.

## 1. Product goal

An intelligent household grocery assistant whose primary user is a non-technical mom. She talks the way she actually talks — "get coriander", "tomatoes I don't know how much", "rice is almost finished", "usual biscuits" — and the system understands intent, detects ambiguity, resolves references against household memory / pantry / purchase history, and produces a category-organized shopping list that a human approves.

Non-goals: form-driven UX, silent guessing, auto-purchase, enterprise dashboards, "multi-agent for the sake of multi-agent".

## 2. Phases

| Phase | Deliverable | Status |
|---|---|---|
| 1 | **Mobile Sandbox** — Expo/RN app on phone, mock rule-based AI, local AsyncStorage data | in progress |
| 2 | **Real Backend** — FastAPI + SQLite + Ollama (Qwen 2.5 7B); mobile switches services via factory | not started |
| 3 | Confidence-gated ambiguity, purchase prediction, receipt OCR, budget, recipes | not started |
| 4 | Web UI, multi-user auth, WhatsApp bot, store route optimizer | not started |

## 3. Guiding principles

1. Optimize for understanding Mom, not for filling a form.
2. Never silently invent brand, quantity, variant, size, or intent.
3. Human approves important actions.
4. LLM only where it earns its place. Everything else is deterministic code.
5. Structured data stays structured (SQL); no dumping into vector DBs.
6. Learn only from confirmed corrections; explicit current instructions always override memory.
7. Start simple, expand incrementally.

## 4. Per-area plans

Each linked plan is scoped to one concern. Work is picked up plan-by-plan.

- [plan_01_project_setup.md](plans/plan_01_project_setup.md) — repo layout, tooling, folder skeletons, run scripts.
- [plan_02_mobile_sandbox.md](plans/plan_02_mobile_sandbox.md) — Expo app, screens, service boundary, mock AI, Phase 1 core loop.
- [plan_03_grocery_understanding.md](plans/plan_03_grocery_understanding.md) — LLM-based extraction of intent + items from natural language (Phase 2).
- [plan_04_ambiguity_resolution.md](plans/plan_04_ambiguity_resolution.md) — deterministic disambiguation over alias groups, missing qty, unresolved "usual".
- [plan_05_household_memory.md](plans/plan_05_household_memory.md) — preference storage, confidence updates, "save as usual".
- [plan_06_inventory.md](plans/plan_06_inventory.md) — pantry states, natural-language updates, low-stock signals.
- [plan_07_purchase_history.md](plans/plan_07_purchase_history.md) — purchase log, interval statistics, price capture.
- [plan_08_grocery_planner.md](plans/plan_08_grocery_planner.md) — list assembly, categorization, approval flow.
- [plan_09_receipt_processing.md](plans/plan_09_receipt_processing.md) — OCR ingest, purchase/inventory/price updates from receipts.
- [plan_10_prediction.md](plans/plan_10_prediction.md) — statistical "buy now / likely soon / not needed" forecasting.
- [plan_11_future_integrations.md](plans/plan_11_future_integrations.md) — WhatsApp, voice, multi-user, online grocery, store route.

## 5. Architectural docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system + orchestrator + agent boundaries; where LLM vs deterministic.
- [docs/DATABASE.md](docs/DATABASE.md) — SQL schema, relationships, migration approach.
- [docs/API.md](docs/API.md) — FastAPI endpoints, JSON contracts, mock-vs-real parity.
- [docs/SANDBOX.md](docs/SANDBOX.md) — Phase 1 build guide, run-on-phone instructions, verification script.

## 6. Current focus

Phase 1, milestones 1–2 of [plan_02_mobile_sandbox.md](plans/plan_02_mobile_sandbox.md): scaffold the Expo TypeScript app, define the `AIService` interface, and wire the factory to the mock. Every subsequent phase inherits from the interfaces set here — get them right first.

## 7. Definition of done for Phase 1

Ten-step verification in [docs/SANDBOX.md](docs/SANDBOX.md) passes on a real phone. Then Phase 2 (real backend) starts.
