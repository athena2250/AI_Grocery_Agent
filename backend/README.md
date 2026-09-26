# backend/ — Phase 2

Placeholder. Phase 2 will implement the Python 3.11 + FastAPI + SQLite (SQLModel) service with a local LLM (Ollama running Qwen 2.5 7B or Llama 3.1 8B) behind a single `/chat` endpoint. One LLM call per user turn returns structured JSON; a deterministic orchestrator handles the rest.

The JSON shape returned here mirrors what `mobile/src/services/MockAIService` already returns in Phase 1, so the mobile app switches implementations via its factory with no UI changes.

Tooling target: `uv` for deps, `ruff` + `mypy` for lint/type-check.
