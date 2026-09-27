"""OCR stage: receipt photo bytes → raw text (plan_09).

Behind a small `Protocol` so a multimodal model can replace Tesseract later and
tests can hand in canned text. `pytesseract` / Pillow are an optional extra
(`pip install -e ".[ocr]"`) and need the `tesseract` binary plus the language
packs (`brew install tesseract tesseract-lang`).
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Protocol

# Receipts here are English with Hindi / Tamil / Telugu lines mixed in.
DEFAULT_LANGS = "eng+hin+tam+tel"


class OcrError(RuntimeError):
    """The photo could not be turned into text at all."""


class OcrEngine(Protocol):
    def read_text(self, image: bytes) -> str: ...


@dataclass
class TesseractOcr:
    langs: str = DEFAULT_LANGS

    def read_text(self, image: bytes) -> str:
        try:
            import pytesseract  # type: ignore[import-not-found,import-untyped,unused-ignore]
            from PIL import Image  # type: ignore[import-not-found,unused-ignore]
        except ImportError as e:
            raise OcrError('OCR extra not installed: pip install -e ".[ocr]"') from e
        try:
            with Image.open(io.BytesIO(image)) as img:
                # psm 4: one column of variable-size text — the shape of a till receipt.
                text: str = pytesseract.image_to_string(img, lang=self.langs, config="--psm 4")
        except Exception as e:
            raise OcrError(f"OCR failed: {e}") from e
        return text
