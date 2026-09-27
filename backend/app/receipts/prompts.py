"""System prompt and few-shot examples for the receipt-parsing LLM call (plan_09).

Hard rules encoded here (and re-checked in code, see `rules.py`):
  - copy each line verbatim into `raw_line`; never invent a line, price or qty.
  - garbled OCR → `readable: false`, no lines. Refuse rather than hallucinate.
  - no store detection, no categories, no product ids — downstream does that.
"""

from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = """You read OCR text from a photo of an Indian grocery receipt and list its line items.

You MUST respond with ONE JSON object, matching this shape exactly:

{
  "readable": bool,
  "reason": str|null,
  "lines": [
    { "raw_line": str, "product_guess": str|null, "brand": str|null, "qty": number|null, "unit": str|null, "package_size": str|null, "price": number|null, "confidence": "high"|"medium"|"low" }
  ]
}

Hard rules — violating any is a bug:
  1. If the text is too garbled to read reliably, return {"readable": false, "reason": "<why>", "lines": []}. NEVER guess items from noise.
  2. `raw_line` is the receipt line copied EXACTLY as it appears in the OCR text. One entry per purchased item. Never invent a line.
  3. `product_guess` is the plain grocery name in lowercase English ("toor dal", "coriander powder", "tomatoes"). Expand receipt abbreviations only when obvious ("CORR PWD" → "coriander powder"). Hindi/Tamil/Telugu item names → the English name.
  4. `qty` and `price` must be numbers printed on that line. `price` is the amount charged for the whole line. If a number is not printed, use null — never compute or invent one. A line with no quantity printed means 1.
  5. `brand` only if the brand is printed on the line. `package_size` like "1 kg" / "500 g" only if printed.
  6. Tax, GST, discount, savings, round off, subtotal and total lines: include them with product_guess null.
  7. `confidence`: "high" when the line is clean and the product obvious, "medium" when you expanded an abbreviation, "low" when you are unsure what the product is.
  8. Emit valid JSON only — no prose, no markdown fences, no trailing commas.
"""


# fmt: off
FEW_SHOTS: list[dict[str, Any]] = [
    {
        "ocr_text": (
            "D-MART\nAvenue Supermarts Ltd\nBill No 4471  Dt 21/09/2026\n"
            "TOOR DAL 1KG        1  145.00\nTOMATO             1.000 KG  40.00\n"
            "PARLE-G 250G        2   50.00\nCGST 2.5%               4.20\n"
            "DISCOUNT               -10.00\nTOTAL                  229.20"
        ),
        "output": {
            "readable": True,
            "reason": None,
            "lines": [
                {"raw_line": "TOOR DAL 1KG        1  145.00", "product_guess": "toor dal",
                 "brand": None, "qty": 1, "unit": "pcs", "package_size": "1 kg",
                 "price": 145.0, "confidence": "high"},
                {"raw_line": "TOMATO             1.000 KG  40.00", "product_guess": "tomatoes",
                 "brand": None, "qty": 1, "unit": "kg", "package_size": None,
                 "price": 40.0, "confidence": "high"},
                {"raw_line": "PARLE-G 250G        2   50.00", "product_guess": "biscuits",
                 "brand": "Parle-G", "qty": 2, "unit": "pack", "package_size": "250 g",
                 "price": 50.0, "confidence": "high"},
                {"raw_line": "CGST 2.5%               4.20", "product_guess": None,
                 "brand": None, "qty": None, "unit": None, "package_size": None,
                 "price": 4.2, "confidence": "high"},
                {"raw_line": "DISCOUNT               -10.00", "product_guess": None,
                 "brand": None, "qty": None, "unit": None, "package_size": None,
                 "price": None, "confidence": "high"},
                {"raw_line": "TOTAL                  229.20", "product_guess": None,
                 "brand": None, "qty": None, "unit": None, "package_size": None,
                 "price": 229.2, "confidence": "high"},
            ],
        },
    },
    {
        "ocr_text": "~~ ,.; |l1 %%# 0O0 ::\n~ -- ~ 8B&",
        "output": {
            "readable": False,
            "reason": "The text is noise; no item lines are legible.",
            "lines": [],
        },
    },
]
# fmt: on


def build_messages(ocr_text: str, store: str | None = None) -> list[dict[str, str]]:
    """Return the chat-messages array for one receipt-parsing call.

    `store` (when already detected) helps with chain-specific abbreviations.
    """

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for shot in FEW_SHOTS:
        messages.append({"role": "user", "content": json.dumps({"ocr_text": shot["ocr_text"]})})
        messages.append({"role": "assistant", "content": json.dumps(shot["output"])})
    payload = {"ocr_text": ocr_text, "store": store} if store else {"ocr_text": ocr_text}
    messages.append({"role": "user", "content": json.dumps(payload, ensure_ascii=False)})
    return messages
