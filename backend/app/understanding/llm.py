"""Ollama client for the extraction call: JSON mode, one retry on validation failure.

Kept behind a small `Protocol` so tests can substitute a canned client without
touching HTTP. The default `HttpxOllamaClient` calls the local Ollama
`/api/chat` endpoint in JSON mode.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .prompts import build_messages, retry_correction_message
from .schema import LLMExtraction, UnderstandingContext

DEFAULT_MODEL = "qwen2.5:7b-instruct"
FALLBACK_MODEL = "llama3.1:8b-instruct"
DEFAULT_BASE_URL = "http://localhost:11434"

M = TypeVar("M", bound=BaseModel)


class UnderstandingError(RuntimeError):
    """Raised when the LLM cannot produce a valid extraction after the retry."""


class OllamaChatClient(Protocol):
    async def chat(self, model: str, messages: list[dict[str, str]]) -> str: ...


@dataclass
class HttpxOllamaClient:
    base_url: str = DEFAULT_BASE_URL
    timeout: float = 60.0

    async def chat(self, model: str, messages: list[dict[str, str]]) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "format": "json",
            "stream": False,
            "options": {"temperature": 0.1},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
        # Ollama chat response: { "message": { "role": "...", "content": "..." }, ... }
        content = data.get("message", {}).get("content", "")
        if not isinstance(content, str) or not content:
            raise UnderstandingError(f"Ollama returned empty content: {data!r}")
        return content


class UnderstandingClient:
    """One-call-per-turn extractor. Validates against `LLMExtraction`, retries once."""

    def __init__(
        self,
        client: OllamaChatClient | None = None,
        *,
        model: str = DEFAULT_MODEL,
        fallback_model: str | None = FALLBACK_MODEL,
    ) -> None:
        self._client: OllamaChatClient = client or HttpxOllamaClient()
        self._model = model
        self._fallback_model = fallback_model

    async def extract(
        self, utterance: str, context: UnderstandingContext | None = None
    ) -> LLMExtraction:
        ctx = context or UnderstandingContext()
        return await extract_validated(
            self._client, self._model, build_messages(utterance, ctx), LLMExtraction
        )


async def extract_validated(
    client: OllamaChatClient, model: str, messages: list[dict[str, str]], schema: type[M]
) -> M:
    """One JSON-mode call validated against `schema`; on failure, one retry that shows the
    model its own output and the validation error. Shared by chat and receipt parsing."""

    first_raw = await client.chat(model, messages)
    try:
        return _parse(first_raw, schema)
    except (ValidationError, ValueError) as first_err:
        messages_retry = [
            *messages,
            {"role": "assistant", "content": first_raw},
            retry_correction_message(str(first_err)),
        ]
        second_raw = await client.chat(model, messages_retry)
        try:
            return _parse(second_raw, schema)
        except (ValidationError, ValueError) as second_err:
            raise UnderstandingError(
                f"LLM extraction failed after retry: {second_err}\nraw={second_raw!r}"
            ) from second_err


def _parse(raw: str, schema: type[M]) -> M:
    """Parse JSON string → validated `schema`."""

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON: {e}") from e
    return schema.model_validate(data)
