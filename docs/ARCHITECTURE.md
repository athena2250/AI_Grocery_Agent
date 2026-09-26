# docs/ARCHITECTURE.md — System Architecture

## Design stance

- **Not multi-agent for the sake of it.** One LLM call per user turn (extraction). Everything else — orchestration, memory lookup, categorization, planning — is deterministic code. Cheaper, faster, testable.
- **LLM only earns its place at natural-language boundaries.** Understanding messy input is the ONE thing the LLM does. It never orchestrates, never writes to memory, never categorizes.
- **Same JSON shape from mock and real backend.** Mobile switches implementations via a factory. UI is completely agnostic.

## Phase 1 (sandbox)

```
Expo app (TS)
├── UI (screens + components)
├── HouseholdContext (React) ← AsyncStorage
└── Services layer
    ├── AIService interface
    │   └── MockAIService (rule engine in TS)
    └── DataService interface
        └── LocalDataService (in-memory + AsyncStorage)
```

All product logic lives in TypeScript. No network calls.

## Phase 2 (real backend)

```
┌────────────────────┐   HTTP JSON   ┌────────────────────────────────────┐
│ Expo app (same UI) │ ────────────▶ │ FastAPI app                        │
│ HttpAIService      │ ◀──────────── │  /chat  /list  /purchase           │
│ HttpDataService    │               │  /inventory                        │
└────────────────────┘               └──────────────┬─────────────────────┘
                                                    │
                                       ┌────────────▼────────────┐
                                       │   Orchestrator (Py)     │
                                       └────────────┬────────────┘
                          ┌────────────┬────────────┼────────────┬────────────┐
                          ▼            ▼            ▼            ▼            ▼
                    Understanding   Memory     Inventory     History      Planner
                    (Ollama LLM)   (SQL rw)   (SQL rw)      (SQL r)     (Py rules)
                          │            │            │            │            │
                          └────────────┴─────┬──────┴────────────┴────────────┘
                                             ▼
                                   SQLite (SQLModel)
```

## Modules & responsibilities

| Module | Job | LLM? |
|---|---|---|
| Understanding | User utterance → `{intent, items, ambiguities, inventory_updates}` | Yes (1 call/turn) |
| Ambiguity safety net | Force clarifications the LLM missed (alias groups, missing qty, unresolved "usual") | No |
| Memory | Read prefs for context; write on confirmed actions only | No |
| Inventory | Read/write pantry states; parse simple phrases | No (Phase 2 uses same LLM-emitted `inventory_updates`) |
| History | Append purchases; compute EWMA intervals & typical qty | No |
| Planner | Dedupe, categorize, group, order, produce approval-ready list | No |
| Orchestrator | Route intent → modules → response | No |
| Receipt (Phase 3) | OCR + LLM parse → review draft | Yes |
| Prediction (Phase 3) | Statistical BUY_NOW classifier | No |

## Turn lifecycle (Phase 2)

1. Client sends `POST /chat { household_id, text }`.
2. Orchestrator loads context (recent items, top prefs, inventory, draft list).
3. Understanding LLM call → validated Pydantic response (retry once on parse fail).
4. Ambiguity safety net merges forced clarifications with LLM ambiguities.
5. If any ambiguities → return them; persist pending state; UI shows chips.
6. Else → apply changes: upsert list items, update inventory, insert purchases.
7. Planner assembles current list snapshot.
8. Template-based natural-language reply (deterministic, not LLM — no hallucinated confirmations).
9. Return `AIResponse` JSON.

## Where deterministic beats LLM (deliberate choices)

- Reply text is templated. LLMs saying "I've added tomatoes" have a nonzero rate of saying "I've added potatoes" instead. Templates never do.
- Categorization comes from `product.category`. Cheaper and never drifts.
- "Usual" resolution is a SQL lookup on `preference`. The LLM only *flags* the reference; it does not resolve it.
- Confidence scores are computed by a rule, not a model.

## Data flow guarantees

- Preferences update ONLY on confirmed user actions. LLM cannot write them.
- Purchases are append-only. Corrections happen via a new purchase or a manual delete with confirmation.
- Every write action has a corresponding UI approval step. No silent state changes.

## Scaling notes (later)

- SQLite fine for a household. Postgres if we ever cloud-host multi-tenant.
- Ollama on the user's laptop is fine for a single-family MVP. For hosted, either a small managed model provider or a self-hosted inference server with proper auth.
