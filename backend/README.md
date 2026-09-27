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
│   ├── memory/               # plan_05 — household memory (learned preferences)
│   │   ├── models.py         # `preference` + `alias_preference` SQLModel tables
│   │   ├── rules.py          # pure confidence rules (mirrors mobile/src/state/memory.ts)
│   │   └── store.py          # get_preferences() + gated writes (purchase, save-as-usual, correction)
│   └── understanding/        # plan_03 — LLM extraction (utterance → structured JSON)
│       ├── llm.py            # Ollama httpx client + JSON-mode + one-retry wrapper
│       ├── prompts.py        # system prompt + few-shot examples
│       └── schema.py         # Pydantic models mirroring TS AIResponse
└── tests/
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
```
