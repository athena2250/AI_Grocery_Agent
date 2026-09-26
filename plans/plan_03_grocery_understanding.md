# plan_03 — Grocery Understanding (LLM extraction)

## Goal

Turn a single natural-language utterance from the user into a validated JSON structure — intent, items, inventory updates, ambiguities — via **one** LLM call per turn. Phase 2 concern; Phase 1 uses a hand-written rule engine that emits the same shape.

## Model

Local Ollama:
- Primary: `qwen2.5:7b-instruct` (best JSON adherence at 7B).
- Fallback: `llama3.1:8b-instruct`.

Call in JSON mode. Retry once with the validation error appended if Pydantic parsing fails.

## Response schema (Pydantic; mirrors TS `AIResponse`)

```
intent: ADD_ITEMS | UPDATE_INVENTORY | MARK_PURCHASED | SHOW_LIST | CLARIFY_RESPONSE | UNKNOWN
items:            [{ raw_text, canonical_guess, qty, unit, brand, variant_hint }]
inventory_updates:[{ raw_text, product_guess, state }]
ambiguities:      [{ raw_text, kind, question, options }]
purchases_marked: [item_id]
```

## Prompt design

- System prompt states hard rules: never invent brand/size/qty; if unknown, leave null and add an ambiguity; treat "usual"/"same"/"the one" as `variant_hint: "usual"` — do not resolve inside the LLM.
- Include a compact JSON context: top ~20 household preferences, current inventory states, current draft list. This is small enough to fit even a 7B context comfortably.
- 3–5 few-shot examples covering the tricky cases (coriander, "tomatoes I don't know", "usual biscuits", "rice almost finished", "mark parle-g purchased").

## What the LLM does NOT do

- Resolve "usual" against memory. That's a deterministic Python lookup after the call.
- Categorize the item. Category is a lookup on `product.category`.
- Decide confidence. That's derived from `preference.confidence` + rules.
- Update memory. Only the orchestrator does that, and only on confirmed user actions.

This separation keeps the LLM's job small (extraction) and makes the rest testable without an LLM.

## Testing

- Unit: fake Ollama client returns canned JSON per prompt — verifies the wrapper's retry/validation logic.
- Live eval: `pytest -m llm` runs ~20 real Mom-style utterances against Ollama; assertions check `intent` and required ambiguities (e.g. "coriander" MUST produce a `product_type` ambiguity). ≥90% pass rate required before merging prompt/model changes.

## Deliverables

- `backend/app/understanding/llm.py` — Ollama client + JSON-mode + retry.
- `backend/app/understanding/prompts.py` — system prompt + few-shot examples.
- `backend/app/understanding/schema.py` — Pydantic models.
- `tests/eval/utterances.yaml` — the eval set.
