"""LLM stage: OCR text → `ReceiptExtraction` (plan_09).

Same client protocol and validate-then-retry-once wrapper as the chat
extractor; only the prompt and the output schema differ.
"""

from __future__ import annotations

from app.understanding.llm import (
    DEFAULT_MODEL,
    HttpxOllamaClient,
    OllamaChatClient,
    extract_validated,
)

from .prompts import build_messages
from .schema import ReceiptExtraction


class ReceiptParser:
    def __init__(self, client: OllamaChatClient | None = None, *, model: str = DEFAULT_MODEL):
        self._client: OllamaChatClient = client or HttpxOllamaClient()
        self._model = model

    async def parse(self, ocr_text: str, store: str | None = None) -> ReceiptExtraction:
        """Raises `UnderstandingError` if no valid JSON comes back after the retry."""

        return await extract_validated(
            self._client, self._model, build_messages(ocr_text, store), ReceiptExtraction
        )
