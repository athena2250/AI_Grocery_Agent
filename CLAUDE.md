# AI Grocery Agent — Project Guide (CLAUDE.md)

This file is the durable, in-repo brief for any Claude session working on this project. Read it before making changes. Full plan lives at `~/.claude/plans/pasted-content-id-c2ea-i-want-encapsulated-bentley.md`.

## What we're building

An intelligent household grocery assistant whose primary user is a non-technical mom. She should be able to type or say things like "get coriander" or "tomatoes I don't know how much" or "rice is almost finished", and the system should:

1. Understand the intent from messy natural language.
2. Detect ambiguity (coriander leaves vs seeds vs powder; missing quantity; unknown brand) and ask short clarifying questions instead of guessing.
3. Consult household memory (learned preferences), pantry inventory, and purchase history to resolve references like "the usual" or "same as last time".
4. Produce a clean, category-organized grocery list.
5. Wait for human approval before finalizing. Update memory only from confirmed actions.

## Guiding principles (do not violate)

1. **Optimize for understanding Mom, not for filling a form.** Real-world Mom-speak is incomplete and ambiguous.
2. **Never silently invent** brand, quantity, variant, size, or intent. If unsure — ask.
3. **Human approves important actions.** No auto-purchases, no auto-deletes.
4. **LLM only where it earns its place** (natural language understanding). All orchestration, categorization, memory lookup, planning is deterministic Python/TS.
5. **Keep structured data structured.** SQL for structured entities; no dumping everything into a vector DB.
6. **Start simple.** MVP first, then layer. Don't build "multi-agent" for the sake of it.
7. **Learn only from confirmed corrections**, and let an explicit current instruction always override learned preferences.

## Phased plan

### Phase 1 — Mobile Sandbox (current phase)

A functional Expo (React Native + TypeScript) app on the user's phone that proves the core UX loop end-to-end using a **rule-based mock AI** and **local-only data (AsyncStorage)**. This exists to feel the interaction before we invest in the backend.

**Framework choice:** Expo/React Native over Flutter — installs on the phone via "Expo Go" + QR code (no Xcode/Android Studio), JS/TS matches the future HTTP backend cleanly, chat UIs are trivial in RN.

**Sandbox scope (in):**
- Bottom-tab navigation: Chat, List, Pantry, Memory, History.
- Chat screen with bubbles + quick-reply chips for clarifications.
- List screen grouped by category, with Item Detail modal showing product/qty/brand/variant/confidence/rationale/source.
- Pantry (Available / Running low / Out of stock).
- Memory screen (read-only view of learned household preferences).
- History screen (past purchases).
- Approve flow before a list is "final".
- Seed data: ~40 common Indian grocery products with aliases + categories, 5–7 preferences (rice, tomatoes, coriander→seeds, dal, oil, curd, biscuits), a couple of history rows.
- `MockAIService` rule engine covering: coriander disambiguation, tomatoes-from-memory, "usual biscuits" (asks brand), "rice is almost finished" (updates inventory + suggests item), mark-purchased, show-list.
- Jest tests for the mock AI table + the state reducer.

**Sandbox out (deferred to Phase 2+):** real LLM, real database, receipts/OCR, price analytics, budget, recipes, purchase prediction, multi-user auth, WhatsApp/voice, online ordering, store route optimization.

**Ambiguity policy in v1:** always ask on ambiguity (no silent guesses). Once the backend and real memory exist, we upgrade to a confidence-gated flow (suggest when household memory is strong, ask otherwise).

### Phase 2 — Real backend

Python 3.11 + FastAPI + SQLite (SQLModel) + Ollama running Qwen 2.5 7B (or Llama 3.1 8B) as a local LLM. **One LLM call per user turn** produces structured JSON (intent + items + ambiguities + inventory updates); a deterministic orchestrator handles the rest. Mobile app switches from `MockAIService` to `HttpAIService` via a factory — **no UI changes**.

The JSON shape returned by the mock in Phase 1 is deliberately identical to what the FastAPI `/chat` endpoint will return in Phase 2.

### Phase 3+ (roadmap)

Confidence-gated suggestions → purchase prediction (simple statistics first, no ML) → receipt OCR → budget engine + price history → recipe module → web UI → multi-user auth → WhatsApp bot → store route optimizer.

## Repo layout

```
AI_Grocery_Agent/
├── CLAUDE.md                 # this file
├── README.md
├── mobile/                   # Phase 1 — Expo sandbox
│   ├── App.tsx
│   ├── package.json / tsconfig.json / app.json
│   └── src/
│       ├── navigation/
│       ├── screens/          # ChatScreen, ListScreen, ItemDetailModal, PantryScreen, MemoryScreen, HistoryScreen
│       ├── components/       # ChatBubble, QuickReplyChip, ItemRow, ConfidenceDot
│       ├── state/            # HouseholdContext + AsyncStorage persistence
│       ├── services/         # AIService interface + MockAIService + HttpAIService stub + factory
│       ├── data/             # seed products, aliases, memory, history
│       ├── types.ts
│       └── theme.ts
├── backend/                  # Phase 2 — placeholder for now
└── tests/                    # jest for mock AI + reducer
```

## The service boundary (the swap point)

The UI never imports the mock directly. It imports an `AIService` interface. The factory returns `MockAIService` in Phase 1 and `HttpAIService` (thin `fetch` wrapper) in Phase 2. Response shape:

```
AIResponse {
  reply:               string,                 // natural-language message for the chat bubble
  intent:              'ADD_ITEMS' | 'UPDATE_INVENTORY' | 'MARK_PURCHASED'
                       | 'SHOW_LIST' | 'CLARIFY_RESPONSE' | 'UNKNOWN',
  proposedItems:       ProposedItem[],
  clarifications:      Clarification[],        // renders as quick-reply chips
  inventoryUpdates:    InventoryUpdate[],
  purchasesMarked:     string[],
  resolvedClarificationId?: string,            // which pending question this turn answered
  chosenOption?:       string,                 // the option picked — drives gated memory writes
  corrections?:        ItemCorrection[],       // "no, seeds not powder" → swap item + learn
}
```

A `Clarification` may carry `suggestedOption` (the chip pre-filled from household memory): picking it confirms that memory, picking another overrides it. Memory writes happen only in the state layer (reducer in Phase 1, `backend/app/memory/store.py` in Phase 2), never from the AI's own proposals.

Every `ProposedItem` carries `confidence` (high/medium/low), `source` (user / household_memory / purchase_history / guess), and a plain-English `rationale` shown in the Item Detail modal. This transparency is a product requirement — Mom should always be able to see *why* the AI proposed something.

## Data model (Phase 1 in TypeScript; Phase 2 mirrors this in SQL)

Entities: `Product`, `ProductAlias` (with `disambiguationGroup` for cases like coriander), `Preference` (household memory), `InventoryEntry`, `ListItem`, `Purchase`, `Turn` (conversation log).

Field names in TS match the future SQL column names exactly so `HttpAIService` needs zero adapter code.

## Build order (Phase 1 milestones)

1. Scaffold Expo TS app + bottom tabs + theme.
2. Types + service interfaces + factory (mock impls).
3. Seed products/aliases/memory/history.
4. `HouseholdContext` + AsyncStorage persistence.
5. `MockAIService` rule engine (coriander + tomatoes must-work first).
6. Chat screen with bubbles + quick-reply chips.
7. List screen + Item Detail modal + approve flow.
8. Rule engine v2 (inventory updates, usual biscuits, mark purchased).
9. Pantry, Memory, History screens.
10. Jest tests for mock AI table + reducer.

You can already put the app on your phone at step 6.

## How to run (once scaffolded)

```
cd mobile
npm install
npx expo start
# scan the QR with Expo Go on your phone (same Wi-Fi), or:
# npx expo start --tunnel   (if Wi-Fi is restrictive)
```

## Verification script (proves the sandbox works)

Executed on the phone, in order:

1. "get coriander" → agent asks leaves/seeds/powder (3 chips).
2. Tap "Coriander seeds" → agent asks quantity (chips 100 g / 200 g / custom).
3. Tap "100 g" → agent confirms + offers "save as usual" chip.
4. Tap "Yes, save" → Memory tab shows the new preference.
5. "get tomatoes I don't know how much" → agent proposes 1 kg from household memory (chips Yes 1 kg / ½ kg / 2 kg).
6. List tab: Coriander seeds under Spices, Tomatoes under Vegetables.
7. Tap Tomatoes → Item Detail shows rationale + high confidence + source=household_memory.
8. "rice is almost finished" → Pantry shows rice as almost finished; agent offers "Yes, 5 kg Aashirvaad" / "Other amount" / "Not now". Tap "Yes" → list adds Aashirvaad 5 kg with rationale (plan_06: low stock only *proposes*).
9. "mark tomatoes purchased" → item checked; History tab shows new row.
10. Kill/reopen app → state persists.

All 10 passing = green light for Phase 2 (real backend).

## Non-goals right now

- No polishing of secondary screens before the Chat → clarify → confirm → list loop is solid.
- No production auth, no real LLM, no cloud, no CI in Phase 1.
- No dashboards, charts, or "enterprise" UI patterns. The reference feel is WhatsApp.
