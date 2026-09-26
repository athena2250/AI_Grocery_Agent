# plan_04 — Ambiguity Resolution

## Goal

Guarantee the system never silently guesses. Every place uncertainty can hide is caught either by the LLM or, more importantly, by a **deterministic safety net** — because 7B models miss edge cases.

## Kinds of ambiguity we handle

- `product_type` — one word maps to multiple products in an alias disambiguation group. Example: "coriander" → {leaves, seeds, powder}.
- `quantity` — item has no qty and no strong household preference for a default.
- `brand` — item needs a variant but no preferred brand is known.
- `package_size` — brand known but multiple SKUs exist and no preference.
- `product_identity` — a phrase resolves to ≥2 unrelated products (e.g. "dal" without qualifier). Treat as `product_type`.
- `usual_unresolved` — user said "the usual X" but no `preference` row exists for X.

## Deterministic safety net (runs AFTER the LLM)

Independent of what the LLM returns, the orchestrator re-scans:

1. For each extracted item, look up the alias table. If the alias maps to a `disambiguationGroup` with ≥2 products, force a `product_type` ambiguity even if the LLM didn't add one.
2. If item has no `qty` and no `preference.typicalQty` for that product → force a `quantity` ambiguity.
3. If item has `variant_hint: "usual"` and no `preference.preferredVariant` → force a `usual_unresolved` ambiguity.
4. Merge with LLM-emitted ambiguities, dedupe by `(raw_text, kind)`.

## Ambiguity policy (v1 vs v2)

- **v1 (Phase 1 sandbox + first Phase 2 cut):** always ask on any detected ambiguity. Zero silent choices.
- **v2 (later):** confidence gate. If `preference.confidence ≥ threshold`, suggest the value with a chip like `[Yes, add usual: Aashirvaad 5 kg]` instead of asking a question. Threshold and confidence formula defined in [plan_05](plan_05_household_memory.md).

## Clarification UI contract

Each ambiguity emits a `Clarification`:
```
{ id, itemRawText, kind, question, options[] }
```
Rendered as quick-reply chips under the agent bubble. Tapping a chip sends the next turn with `intent: CLARIFY_RESPONSE` and the resolution.

## Turn state

Pending clarifications are stored on the current draft turn. On the next user message:
- If `intent = CLARIFY_RESPONSE`, apply resolution to the referenced item.
- If a new unrelated request comes in first, keep the old ambiguity pending — the agent bubble stays visible with unresolved chips.

## Testing

- Unit tests on the safety-net function: table of (item input, alias table, preference table) → expected forced ambiguities.
- Integration: send "coriander" through the mock/real pipeline, assert `Clarification` with 3 options.
