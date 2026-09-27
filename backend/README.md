# backend/ — Phase 2

Python 3.11 + FastAPI + SQLite (SQLModel) service with a local LLM (Ollama running Qwen 2.5 7B, fallback Llama 3.1 8B) behind a single `/chat` endpoint. One LLM call per user turn returns structured JSON; a deterministic orchestrator handles the rest.

The JSON shape returned here mirrors what `mobile/src/services/MockAIService` already returns in Phase 1, so the mobile app switches implementations via its factory with no UI changes.

Tooling target: `uv` for deps, `ruff` + `mypy` for lint/type-check.

## Layout

```
backend/
├── pyproject.toml
├── app/
│   ├── ambiguity/            # plan_04 — deterministic safety net run after the LLM
│   │   └── safety_net.py     # force product_type / quantity / usual_unresolved; merge + dedupe
│   ├── budget/               # plan_11 — list total from price history; warn, never auto-remove
│   │   ├── rules.py          # pure: price per line (same brand first), 60% coverage gate, review
│   │   └── store.py          # estimate_list() — read-only over pending rows + `purchase` prices
│   ├── channels/             # plan_11 — other front doors onto the same chat pipeline
│   │   └── whatsapp.py       # pure: numbered options out, "2" back → option (webhook needs HTTPS)
│   ├── history/              # plan_07 — confirmed purchases
│   │   ├── models.py         # `purchase` table (source: chat_confirmed / receipt_ocr / manual)
│   │   └── store.py          # log_purchase, last_purchased_at, price_history (a read, not a table)
│   ├── memory/               # plan_05 — household memory (learned preferences)
│   │   ├── models.py         # `preference` + `alias_preference` SQLModel tables
│   │   ├── rules.py          # pure confidence rules (mirrors mobile/src/state/memory.ts)
│   │   └── store.py          # get_preferences() + gated writes (purchase, save-as-usual, correction)
│   ├── prediction/           # plan_10 — BUY_NOW / LIKELY_SOON / NOT_NEEDED (statistics, not ML)
│   │   ├── rules.py          # pure: EW mean/std of intervals (α 0.4), pantry overrides, proposals
│   │   └── store.py          # predict_household() — read-only over `purchase` + `inventory`
│   ├── receipts/             # plan_09 — receipt photo → review draft → approved purchases
│   │   ├── ocr.py            # OcrEngine protocol + Tesseract (eng+hin+tam+tel), optional `[ocr]` extra
│   │   ├── prompts.py        # parse prompt: verbatim lines, refuse garbled text
│   │   ├── parser.py         # LLM call (same client + retry as chat)
│   │   ├── rules.py          # pure: noise check, grounding, skip tax/total, store + date, review
│   │   ├── pipeline.py       # read_receipt() → ReceiptReading | Unreadable (error card)
│   │   ├── models.py         # `receipt`, `receipt_line`, `store_alias` tables
│   │   └── store.py          # draft / answer / skip / set_store / approve (the only write path)
│   ├── recipes/              # plan_11 — "making sambar" → pantry diff → proposals to confirm
│   │   ├── data.py           # ~30 seed dishes → catalog product ids (nothing outside the catalog)
│   │   ├── rules.py          # pure: find_recipe, check_recipe (propose / have / unsure / on list)
│   │   └── store.py          # check_recipe_for_household() — read-only
│   └── understanding/        # plan_03 — LLM extraction (utterance → structured JSON)
│       ├── llm.py            # Ollama httpx client + JSON-mode + one-retry wrapper
│       ├── prompts.py        # system prompt + few-shot examples
│       └── schema.py         # Pydantic models mirroring TS AIResponse
└── tests/
    ├── fixtures/receipts.yaml       # receipt OCR + canned LLM output + expected parse
    ├── test_budget.py               # pricing, coverage gate, over-budget review
    ├── test_recipes.py              # seed data vs catalog, matching, pantry diff
    ├── test_whatsapp.py             # numbered options render + reply resolution
    ├── test_prediction.py           # synthetic series, inventory overrides, proposals
    ├── test_receipts.py             # fixtures, fault injection, review + approval writes
    ├── test_memory.py               # confidence rules, gated writes, reads → safety net
    ├── test_safety_net.py           # table tests + "LLM forgot coriander" integration
    ├── test_understanding_unit.py   # fake client — validates retry/parse logic
    └── test_understanding_live.py   # `pytest -m llm` — hits local Ollama
```

The live-eval set lives at `tests/eval/utterances.yaml` at the repo root.

## Install & run

```
cd backend
uv sync                              # or: pip install -e ".[dev]"
pytest -m "not llm"                  # unit tests only
pytest -m llm                        # live eval (requires Ollama running locally)
pip install -e ".[ocr]"              # receipt OCR (plus: brew install tesseract tesseract-lang)
```
