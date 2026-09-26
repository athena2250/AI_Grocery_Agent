# docs/API.md — API Contracts

The mobile app talks to the world through two TypeScript interfaces, `AIService` and `DataService`. In Phase 1 both are backed by local mocks. In Phase 2 both are backed by HTTP calls to FastAPI. **The JSON shapes match exactly**, so the UI does not change.

## `AIService.chat(text, ctx) → AIResponse`

### Request

```ts
interface ChatContext {
  recentItems: ListItem[];
  preferences: Preference[];
  inventory: InventoryEntry[];
  draftList: ListItem[];
  pendingClarifications: Clarification[];
}
```

Phase 2 HTTP: `POST /chat` with body `{ household_id, text, ctx? }`. The server can rebuild `ctx` itself from DB — the client sends `ctx` only in Phase 1 so mocks can be pure functions.

### Response

```ts
interface AIResponse {
  reply: string;
  intent: 'ADD_ITEMS' | 'UPDATE_INVENTORY' | 'MARK_PURCHASED'
        | 'SHOW_LIST' | 'CLARIFY_RESPONSE' | 'UNKNOWN';
  proposedItems: ProposedItem[];
  clarifications: Clarification[];
  inventoryUpdates: InventoryUpdate[];
  purchasesMarked: string[];   // list item ids
}

interface ProposedItem {
  id: string;
  product: string;
  category: Category;
  qty: number | null;
  unit: string | null;
  brand: string | null;
  variant: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'user' | 'household_memory' | 'purchase_history' | 'guess';
  rationale: string;
  needsConfirmation: boolean;
}

interface Clarification {
  id: string;
  itemRawText: string;
  kind: 'product_type' | 'quantity' | 'brand' | 'package_size' | 'usual_unresolved' | 'product_identity';
  question: string;
  options: string[];
}

interface InventoryUpdate {
  productId: string;
  state: 'available' | 'running_low' | 'almost_finished' | 'out';
  approxQty?: number;
  approxUnit?: string;
}
```

### Semantics

- If `clarifications.length > 0`, the UI shows chips and the caller does not apply `proposedItems`.
- If `clarifications.length === 0`, apply `proposedItems` (add or update), apply `inventoryUpdates`, mark `purchasesMarked` items purchased.
- `reply` is the natural-language message rendered as the agent bubble. Kept short and templated.

## `DataService`

Read/write access to the household state. Split so the AI service stays purely computational.

```ts
interface DataService {
  loadState(): Promise<HouseholdState>;
  saveState(next: HouseholdState): Promise<void>;

  addListItems(items: ProposedItem[]): Promise<void>;
  markPurchased(itemId: string): Promise<void>;
  updateInventory(update: InventoryUpdate): Promise<void>;
  savePreference(pref: Preference): Promise<void>;
  forgetPreference(productId: string): Promise<void>;
}
```

Phase 2 HTTP endpoints (mapping):
- `GET  /household/state` → `loadState`.
- `POST /list/{id}/items` → `addListItems`.
- `POST /list/{id}/items/{itemId}/purchase` → `markPurchased`.
- `POST /inventory` → `updateInventory`.
- `POST /preferences` → `savePreference`.
- `DELETE /preferences/{productId}` → `forgetPreference`.
- `POST /list/{id}/approve` — transition list status.

## Error contract

- Structured errors: `{ error: { code, message, hint? } }`.
- `code`: `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `LLM_PARSE_FAILED`, `INTERNAL`.
- Client shows `hint` if present; otherwise a generic "something went wrong, try again".

## Versioning

- Response includes a top-level `version: 1` field once we ship Phase 2. Additive fields only; breaking changes bump to `version: 2` and the client negotiates via a request header.

## Rate limiting / auth (later)

- Phase 2 single-machine: no auth, bind to `127.0.0.1`.
- Once multi-user: JWT via Clerk (or equivalent); every endpoint enforces `household_id` scope via middleware. Spelled out in [plan_11](../plans/plan_11_future_integrations.md).

## Mock parity check

`MockAIService` and the Python understanding pipeline are validated against the SAME Pydantic-equivalent Zod schema in `mobile/src/types.ts`. Anything the mock returns must parse against that schema, and anything the real backend returns must too. This is the guarantee that the UI doesn't change when the backend arrives.
