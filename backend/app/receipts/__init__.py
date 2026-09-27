"""Receipt processing — photo → reviewed draft → approved purchases (plan_09)."""

from .models import LineStatus, Receipt, ReceiptLine, ReceiptStatus, StoreAlias
from .ocr import OcrEngine, OcrError, TesseractOcr
from .parser import ReceiptParser
from .pipeline import ReceiptReading, Unreadable, read_receipt, read_receipt_text
from .rules import SKIP_OPTION, UNREADABLE_MESSAGE, DraftLine, Review
from .schema import ReceiptExtraction, ReceiptLineGuess
from .store import (
    answer_line,
    approve_receipt,
    create_draft,
    discard_receipt,
    pending_review,
    receipt_lines,
    remembered_stores,
    set_store,
    skip_line,
    summary,
)

__all__ = [
    "SKIP_OPTION",
    "UNREADABLE_MESSAGE",
    "DraftLine",
    "LineStatus",
    "OcrEngine",
    "OcrError",
    "Receipt",
    "ReceiptExtraction",
    "ReceiptLine",
    "ReceiptLineGuess",
    "ReceiptParser",
    "ReceiptReading",
    "ReceiptStatus",
    "Review",
    "StoreAlias",
    "TesseractOcr",
    "Unreadable",
    "answer_line",
    "approve_receipt",
    "create_draft",
    "discard_receipt",
    "pending_review",
    "read_receipt",
    "read_receipt_text",
    "receipt_lines",
    "remembered_stores",
    "set_store",
    "skip_line",
    "summary",
]
