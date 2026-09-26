# AI Grocery Agent

An intelligent household grocery assistant that understands messy natural language ("get coriander", "rice is almost finished"), asks clarifying questions when ambiguous, consults household memory and pantry state, and produces a human-approved grocery list. See [CLAUDE.md](./CLAUDE.md) for the full brief and [plans/](./plans/) for phased build plans.

## Phases

- **Phase 1 — Mobile Sandbox** (current): Expo + React Native + TypeScript app running against a rule-based `MockAIService` and AsyncStorage. See [plans/plan_01_project_setup.md](./plans/plan_01_project_setup.md).
- **Phase 2 — Real backend**: Python 3.11 + FastAPI + SQLite + local LLM (Ollama). Mobile swaps `MockAIService` → `HttpAIService` via a factory. No UI changes.
- **Phase 3+**: Confidence-gated suggestions, purchase prediction, receipt OCR, budget, recipes, web UI, WhatsApp bot.

## Run Phase 1 (mobile sandbox)

```bash
cd mobile
npm install
npx expo start
# Scan the QR code with Expo Go on your phone (same Wi-Fi).
# If Wi-Fi blocks it: npx expo start --tunnel
```

## Run Phase 2 (backend)

Not yet implemented — placeholder at [backend/](./backend/).

## Repo layout

```
mobile/    Expo React Native app (Phase 1)
backend/   FastAPI + SQLite + local LLM (Phase 2)
tests/     Cross-cutting integration tests; unit tests live in mobile/__tests__
plans/     Numbered build plans, one per milestone
docs/      Architecture, database schema, API contract, sandbox notes
```
