"""Understanding — turns a user utterance into validated structured JSON (extraction only)."""

from .llm import UnderstandingClient, UnderstandingError
from .schema import (
    Ambiguity,
    AmbiguityKind,
    ExtractedAction,
    ExtractedItem,
    Intent,
    InventoryUpdate,
    LLMExtraction,
    UnderstandingContext,
)

__all__ = [
    "UnderstandingClient",
    "UnderstandingError",
    "Ambiguity",
    "AmbiguityKind",
    "ExtractedAction",
    "ExtractedItem",
    "Intent",
    "InventoryUpdate",
    "LLMExtraction",
    "UnderstandingContext",
]
