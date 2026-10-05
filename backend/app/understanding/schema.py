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
    needed_by_phrase: str | None = Field(
        default=None,
        description='Verbatim date words ("tomorrow", "for Sunday"); resolved by feed/dates.py.',
    )
    assignee_mention: str | None = Field(
        default=None, description='Verbatim person who should buy it ("Mom", "me").'
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
    approx_qty: float | None = Field(
        default=None, ge=0, description='Only when said: "half a packet left" → 0.5.'
    )
    approx_unit: str | None = None


class Ambiguity(BaseModel):
    raw_text: str
    kind: AmbiguityKind
    question: str
    options: list[str] = Field(default_factory=list)


class ExtractedAction(BaseModel):
    """One non-grocery thing to do, in the author's own words.

    No category, no resolved date, no member id: the phrases are copied verbatim and
    `app/feed` turns them into a post kind, a calendar date and a member deterministically.
    """

    raw_text: str
    title: str
    """Short imperative restatement in the author's words: "Fix bathroom tap"."""
    assignee_mention: str | None = None
    """Who should do it, verbatim ("Dad", "me"). Null when nobody was named."""
    for_mention: str | None = None
    """Whom it is for, verbatim ("Mom" in "Mom's doctor appointment")."""
    date_phrase: str | None = None
    """Verbatim: "next Friday", "on the 10th", "before Diwali"."""
    time_phrase: str | None = None
    """Verbatim: "at 5", "5:30 pm", "morning"."""
    priority_phrase: str | None = None
    """Verbatim, only if said: "urgent", "asap"."""
    recurrence_phrase: str | None = None
    """Verbatim, only if said: "every month", "daily"."""
    location_phrase: str | None = None
    """Verbatim: "bathroom", "bank"."""
    amount: float | None = Field(default=None, ge=0)
    """Only when the author said a number (a bill amount, a budget)."""


class LLMExtraction(BaseModel):
    """Exactly what the LLM must return. One turn's worth of extraction."""

    intent: Intent
    items: list[ExtractedItem] = Field(default_factory=list)
    inventory_updates: list[InventoryUpdate] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    purchases_marked: list[str] = Field(default_factory=list)
    actions: list[ExtractedAction] = Field(default_factory=list)
    """Non-grocery actionable items (repairs, errands, bills, appointments …).
    Only the multi-item prompt asks for these; the grocery prompt leaves it empty."""


class UnderstandingContext(BaseModel):
    """Compact context handed to the LLM alongside the utterance.

    Kept small enough to fit a 7B model's context comfortably. The orchestrator
    is responsible for trimming to the top ~20 preferences before calling.
    """

    preferences: list[dict[str, Any]] = Field(default_factory=list)
    inventory: list[dict[str, Any]] = Field(default_factory=list)
    draft_list: list[dict[str, Any]] = Field(default_factory=list)
