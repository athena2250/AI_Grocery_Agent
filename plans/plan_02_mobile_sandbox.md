# plan_02 — Mobile Sandbox (Phase 1)

## Goal

A functional Expo (React Native + TypeScript) app on the user's phone that proves the core UX loop end-to-end using a rule-based mock AI and local AsyncStorage data. This exists to feel the interaction before we invest in the backend.

## Framework choice

Expo/React Native over Flutter:
- Runs on the user's phone via **Expo Go + QR code** — no Xcode/Android Studio required.
- TypeScript matches the future HTTP backend cleanly.
- Chat UIs are trivial in RN (`FlatList` of bubbles).
- Flutter's raw-performance edge doesn't matter for a household chat app.

## Screens (build in this order)

1. **Chat** (primary). Full-screen bubble list, text input at bottom, agent bubbles can render quick-reply chips. Above input: subtle "N items in list · tap to review" banner.
2. **List**. Sections by category. Row: checkbox, product, qty·unit, confidence dot. Tap → Item Detail modal. Top bar: "Approve list" button.
3. **Item Detail modal**. Product, qty, brand, variant, confidence, source badge, rationale. Actions: edit qty, change variant, remove, "save as household preference".
4. **Pantry**. Groups: Available / Running low / Almost finished / Out of stock. Long-press to change state.
5. **Memory**. Read-only list of learned preferences with "last confirmed" date and a small forget-trash icon.
6. **History**. Reverse-chronological purchases.

Bottom-tab order: Chat, List, Pantry, Memory, History.

## Service boundary

```
UI ─▶ AIService (interface) ─▶ MockAIService (Phase 1)  |  HttpAIService (Phase 2)
UI ─▶ DataService (interface) ─▶ LocalDataService       |  HttpDataService
```

`serviceFactory.ts` selects the impl. The `AIResponse` JSON is deliberately identical to the future FastAPI response — see [docs/API.md](../docs/API.md).

## MockAIService coverage (minimum table)

| Mom says | Mock does |
|---|---|
| `get coriander` | Alias-group clarification: leaves / seeds / powder |
| `coriander seeds` (follow-up) | Asks quantity: 100 g default (from memory once seeded) |
| `100g` | Adds item; offers "save as usual?" |
| `tomatoes I don't know how much` | Proposes 1 kg from memory, chips [Yes 1 kg, ½ kg, 2 kg] |
| `usual biscuits` | No preference → asks brand |
| `rice is almost finished` | Updates inventory; adds Aashirvaad 5 kg with rationale |
| `mark parle-g purchased` | Moves item to history; increments preference confidence |
| `show list` | Returns current draft grouped by category |

Fallback: friendly "I didn't catch that — could you say it another way?"

## Milestones

1. Scaffold (see [plan_01](plan_01_project_setup.md)).
2. Types + service interfaces + factory returning mocks.
3. Seed products/aliases/memory/history in TS.
4. `HouseholdContext` + AsyncStorage persistence.
5. `MockAIService` v1 — coriander + tomatoes must work.
6. Chat screen with bubbles + chips.
7. List screen + Item Detail + approve flow.
8. `MockAIService` v2 — inventory updates, usual biscuits, mark purchased.
9. Pantry, Memory, History screens.
10. Jest tests (mock AI table, reducer).

Ship on phone at milestone 6.

## Verification

10-step script in [docs/SANDBOX.md](../docs/SANDBOX.md). All 10 pass on a real phone → Phase 1 done.
