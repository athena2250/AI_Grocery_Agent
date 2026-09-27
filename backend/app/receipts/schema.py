"""Pydantic models for what the receipt-parsing LLM call must return (plan_09).

Only extraction lives here. Store detection, the receipt date, alias
resolution, review and every write are deterministic code downstream.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]


class ReceiptLineGuess(BaseModel):
    raw_line: str
    """The receipt line copied verbatim from the OCR text — checked against it downstream."""
    product_guess: str | None = None
    """Plain grocery name ("toor dal"); null for tax, discount, total and other non-item lines."""
    brand: str | None = None
    qty: float | None = Field(default=None, ge=0)
    unit: str | None = None
    package_size: str | None = None
    price: float | None = Field(default=None, ge=0)
    confidence: Confidence = "low"


class ReceiptExtraction(BaseModel):
    readable: bool
    """False when the OCR text is too garbled to read — the model refuses instead of guessing."""
    reason: str | None = None
    lines: list[ReceiptLineGuess] = Field(default_factory=list)
