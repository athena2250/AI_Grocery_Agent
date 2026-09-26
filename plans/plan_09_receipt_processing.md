# plan_09 — Receipt Processing (OCR ingest)

## Goal

Given a phone photo of a grocery receipt, extract line items and update purchase history, inventory (mark bought items as `available`), and price history — with graceful degradation when OCR is imperfect. Phase 3 concern.

## Approach

Two-stage:

1. **OCR** — `pytesseract` locally, or a multimodal LLM (Claude / GPT-4o vision) when we accept cloud dependency. Output: raw text with rough positions.
2. **LLM structured extraction** — same Ollama pipeline as chat, different prompt. Feed OCR text + shop context if known. Return array of:
   ```
   { raw_line, product_guess, brand?, qty?, unit?, package_size?, price?, confidence }
   ```

Then run the same alias resolution and disambiguation safety net as chat — if any line is ambiguous, surface a review UI ("we found 12 items; 2 need your input"). No silent writes.

## Human review is required

Every parsed receipt lands in a **review draft** the user approves in the app. Only on approval do rows commit to `purchase`, `inventory`, and `price_history`.

## Store detection

Try to detect store from the header (regex on known chains → GreenBazaar, Reliance Fresh, DMart, etc.). If unknown, ask the user once and remember.

## Failure modes to handle

- Blurry photo → OCR returns garbage → LLM should refuse rather than hallucinate; return an error card "couldn't read this — try a clearer photo".
- Bilingual receipts (English + Hindi/Tamil): OCR must be configured with multi-lang traineddata.
- Discounts and taxes as separate lines: skip lines whose `product_guess` is null or matches a "tax|gst|discount|round off" allowlist.

## Data flow

```
photo → OCR → LLM parse → alias resolve → ambiguity safety net → review draft
     → user approves → write purchase rows → update inventory to `available`
     → update price_history (derived view) → bump preference confidence
```

## Testing

- Fixture set of 5 real receipts, expected parse in YAML.
- Fault-injection: swap OCR output with noisy strings; assert graceful refusal.

## Not in scope (yet)

- Automatic photo capture (in-app camera). Phase 1 sandbox has no upload path at all.
- Auto-matching a receipt against the current draft list — nice-to-have for later.
