"""photo → OCR → LLM parse → grounding + alias resolve + review → `ReceiptReading` (plan_09).

Nothing here writes. The orchestrator persists a reading with
`store.create_draft`, or shows the `Unreadable` error card.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from app.ambiguity.safety_net import Catalog
from app.understanding.llm import UnderstandingError

from . import rules
from .ocr import OcrEngine, OcrError
from .parser import ReceiptParser


@dataclass(frozen=True)
class ReceiptReading:
    ocr_text: str
    store: str | None
    store_header: str | None
    purchased_at: date | None
    lines: tuple[rules.DraftLine, ...]

    @property
    def summary(self) -> str:
        return rules.review_summary(
            len(self.lines), sum(line.review is not None for line in self.lines)
        )


@dataclass(frozen=True)
class Unreadable:
    """The error card: why (for logs) and what Mom sees."""

    reason: str
    message: str = rules.UNREADABLE_MESSAGE


async def read_receipt(
    image: bytes,
    ocr: OcrEngine,
    parser: ReceiptParser,
    catalog: Catalog,
    remembered_stores: Mapping[str, str] | None = None,
) -> ReceiptReading | Unreadable:
    try:
        text = ocr.read_text(image)
    except OcrError as e:
        return Unreadable(str(e))
    return await read_receipt_text(text, parser, catalog, remembered_stores)


async def read_receipt_text(
    ocr_text: str,
    parser: ReceiptParser,
    catalog: Catalog,
    remembered_stores: Mapping[str, str] | None = None,
) -> ReceiptReading | Unreadable:
    if not rules.looks_readable(ocr_text):
        return Unreadable("OCR text looks like noise")

    store = rules.detect_store(ocr_text, remembered_stores)
    try:
        extraction = await parser.parse(ocr_text, store)
    except UnderstandingError as e:
        return Unreadable(f"parser gave no valid JSON: {e}")
    if not extraction.readable:
        return Unreadable(extraction.reason or "parser refused")

    lines = rules.draft_lines(extraction, ocr_text, catalog)
    if not lines:
        return Unreadable("no item lines grounded in the OCR text")
    return ReceiptReading(
        ocr_text=ocr_text,
        store=store,
        store_header=rules.header_key(ocr_text),
        purchased_at=rules.receipt_date(ocr_text),
        lines=tuple(lines),
    )
