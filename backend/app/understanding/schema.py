"""Pydantic models mirroring the TS `AIResponse` extraction shape.

These describe *only* what the LLM is asked to emit. Downstream deterministic
code resolves "usual", categorizes items, computes confidence, and updates
memory — none of that lives here.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class Intent(str, Enum):
    ADD_ITEMS = "ADD_ITEMS"
    UPDATE_INVENTORY = "UPDATE_INVENTORY"
    MARK_PURCHASED = "MARK_PURCHASED"
    SHOW_LIST = "SHOW_LIST"
    CLARIFY_RESPONSE = "CLARIFY_RESPONSE"
    UNKNOWN = "UNKNOWN"


class AmbiguityKind(str, Enum):
    PRODUCT_TYPE = "product_type"
    QUANTITY = "quantity"
    BRAND = "brand"
    PACKAGE_SIZE = "package_size"
    USUAL_UNRESOLVED = "usual_unresolved"
    PRODUCT_IDENTITY = "product_identity"


class InventoryStateLiteral(str, Enum):
    AVAILABLE = "available"
    RUNNING_LOW = "running_low"
    ALMOST_FINISHED = "almost_finished"
    OUT = "out"


class ExtractedItem(BaseModel):
    raw_text: str
    canonical_guess: str | None = None
    qty: float | None = None
    unit: str | None = None
    brand: str | None = None
    variant_hint: str | None = Field(
        default=None,
        description='e.g. "usual", "same", "seeds", "leaves", "powder"; never resolved by the LLM.',
    )

    @field_validator("qty")
    @classmethod
    def _qty_non_negative(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise ValueError("qty must be non-negative")
        return v


class InventoryUpdate(BaseModel):
    raw_text: str
    product_guess: str | None = None
    state: InventoryStateLiteral


class Ambiguity(BaseModel):
    raw_text: str
    kind: AmbiguityKind
    question: str
    options: list[str] = Field(default_factory=list)


class LLMExtraction(BaseModel):
    """Exactly what the LLM must return. One turn's worth of extraction."""

    intent: Intent
    items: list[ExtractedItem] = Field(default_factory=list)
    inventory_updates: list[InventoryUpdate] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    purchases_marked: list[str] = Field(default_factory=list)


class UnderstandingContext(BaseModel):
    """Compact context handed to the LLM alongside the utterance.

    Kept small enough to fit a 7B model's context comfortably. The orchestrator
    is responsible for trimming to the top ~20 preferences before calling.
    """

    preferences: list[dict[str, Any]] = Field(default_factory=list)
    inventory: list[dict[str, Any]] = Field(default_factory=list)
    draft_list: list[dict[str, Any]] = Field(default_factory=list)
