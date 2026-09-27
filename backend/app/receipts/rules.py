"""Receipt rules (plan_09). Pure functions — no I/O, no LLM.

The LLM's parse is a proposal. Before anything reaches a review draft:

  1. Noise check — OCR text that doesn't look like a receipt never reaches the LLM.
  2. Grounding — every `raw_line` must be in the OCR text (else it was invented
     and is dropped); a qty, price or brand not printed on that line is cleared.
  3. Non-item lines (tax, GST, discount, round off, totals) are skipped.
  4. Alias resolution against the catalog, same longest-alias-wins lookup as chat.
  5. Review — one question per line until it's unambiguous: which product
     (unknown / several / low confidence), then how much (qty not printed).

Store and date come from the receipt text by regex, never from the LLM.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from app.ambiguity.safety_net import Catalog, CatalogAlias, match_aliases, quantity_options
from app.understanding.schema import AmbiguityKind

from .schema import Confidence, ReceiptExtraction, ReceiptLineGuess

UNREADABLE_MESSAGE = "Couldn't read this — try a clearer photo."
SKIP_OPTION = "Skip this line"

_HEADER_LINES = 5
_FUZZY_LINE_MATCH = 0.9

# Store chains matched against the receipt header. Unknown shops are asked once
# and remembered per household (see `store.set_store`).
KNOWN_STORES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (name, re.compile(pattern, re.IGNORECASE))
    for name, pattern in [
        ("DMart", r"\bd[\s-]?mart\b|avenue\s+supermarts"),
        ("Reliance Fresh", r"reliance\s+fresh"),
        ("Reliance Smart", r"reliance\s+smart"),
        ("More", r"\bmore\s+(?:retail|supermarket|megastore)"),
        ("Spencer's", r"\bspencer'?s\b"),
        ("Ratnadeep", r"\bratnadeep\b"),
        ("Vijetha", r"\bvijetha\b"),
        ("Nature's Basket", r"nature'?s\s+basket"),
        ("Star Bazaar", r"star\s+bazaar"),
        ("GreenBazaar", r"green\s?bazaar"),
    ]
)

_NON_ITEM = re.compile(
    r"\b(?:[csi]?gst|tax|vat|discount|round\s*off|sub\s*total|total|savings?|you\s+saved)\b",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_DATE_DMY = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b")
_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


# --- Text helpers ------------------------------------------------------------


def _is_letter(ch: str) -> bool:
    # Letters plus combining marks, so Devanagari / Tamil / Telugu words count as words.
    return unicodedata.category(ch)[0] in ("L", "M")


def _squash(s: str) -> str:
    """Lowercase letters and digits only — OCR spacing and punctuation are unreliable."""

    return "".join(ch for ch in s.lower() if ch.isdigit() or _is_letter(ch))


def _is_word(token: str) -> bool:
    letters = sum(_is_letter(ch) for ch in token)
    return letters >= 3 and letters / len(token) >= 0.8


def _numbers(s: str) -> list[float]:
    # Indian receipts print thousands as "1,250.00".
    return [float(n) for n in _NUMBER.findall(s.replace(",", ""))]


def _lines(text: str) -> list[str]:
    return [ln for ln in text.splitlines() if ln.strip()]


# --- Receipt-level -------------------------------------------------------------


def looks_readable(ocr_text: str) -> bool:
    """Cheap pre-check so noise never reaches the LLM: some real words, and at least
    one line that pairs a word with a number (an item and its price)."""

    tokens = [t.strip(".,:;()[]-*'\"") for t in ocr_text.split()]
    tokens = [t for t in tokens if t]
    words = [t for t in tokens if _is_word(t)]
    if len(words) < 3 or len(words) / len(tokens) < 0.3:
        return False
    return any(
        any(_is_word(t) for t in ln.split()) and _NUMBER.search(ln) for ln in _lines(ocr_text)
    )


def header_key(ocr_text: str) -> str | None:
    """Stable key for an unknown shop: its first header line, squashed."""

    first = next(iter(_lines(ocr_text)), "")
    return _squash(first)[:40] or None


def detect_store(ocr_text: str, remembered: Mapping[str, str] | None = None) -> str | None:
    """Known chain from the header, else what this household said the shop was last time."""

    header = "\n".join(_lines(ocr_text)[:_HEADER_LINES])
    for name, pattern in KNOWN_STORES:
        if pattern.search(header):
            return name
    key = header_key(ocr_text)
    return (remembered or {}).get(key) if key else None


def receipt_date(ocr_text: str) -> date | None:
    """First valid date printed on the receipt, day-first (Indian format)."""

    for m in _DATE_ISO.finditer(ocr_text):
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            continue
    for m in _DATE_DMY.finditer(ocr_text):
        year = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        try:
            return date(year, int(m[2]), int(m[1]))
        except ValueError:
            continue
    return None


# --- Line-level ------------------------------------------------------------------


def is_non_item(guess: ReceiptLineGuess) -> bool:
    return not guess.product_guess or bool(_NON_ITEM.search(guess.raw_line))


def _source_line(raw_line: str, ocr_text: str) -> str | None:
    """The OCR text `raw_line` came from, or None if the LLM made it up."""

    raw = _squash(raw_line)
    if not raw:
        return None
    if raw in _squash(ocr_text):
        return raw_line
    best = max(
        _lines(ocr_text),
        key=lambda ln: difflib.SequenceMatcher(None, raw, _squash(ln)).ratio(),
        default=None,
    )
    if best and difflib.SequenceMatcher(None, raw, _squash(best)).ratio() >= _FUZZY_LINE_MATCH:
        return best
    return None


def _printed(n: float | None, line: str) -> bool:
    return n is not None and any(abs(n - x) < 0.005 for x in _numbers(line))


def _brand_printed(brand: str, line: str) -> bool:
    b = _squash(brand)
    if b and b in _squash(line):
        return True
    # Receipts truncate brands: "AASHIR ATTA" → Aashirvaad.
    return any(len(t) >= 4 and b.startswith(t) for t in map(_squash, line.split()))


def ground(guess: ReceiptLineGuess, ocr_text: str) -> ReceiptLineGuess | None:
    """Drop an invented line; clear any qty / price / brand not printed on it.

    A missing qty of 1 is allowed — receipts don't print "1" for single items.
    """

    line = _source_line(guess.raw_line, ocr_text)
    if line is None:
        return None
    qty_ok = guess.qty == 1 or _printed(guess.qty, line)
    return guess.model_copy(
        update={
            "raw_line": line,
            "qty": guess.qty if qty_ok else None,
            "unit": guess.unit if qty_ok else None,
            "price": guess.price if _printed(guess.price, line) else None,
            "brand": guess.brand if guess.brand and _brand_printed(guess.brand, line) else None,
        }
    )


def resolve_product_ids(
    raw_line: str, product_guess: str | None, aliases: Sequence[CatalogAlias]
) -> list[str]:
    """Catalog products the line could be. The printed line wins; the LLM's expansion
    ("CORR PWD" → "coriander powder") may narrow an ambiguous match or fill a miss."""

    def ids(text: str) -> list[str]:
        return list(dict.fromkeys(a.product_id for a in match_aliases(text, aliases)))

    found = ids(raw_line)
    guessed = ids(product_guess) if product_guess else []
    if len(found) > 1 and len(guessed) == 1 and guessed[0] in found:
        return guessed
    return found or guessed


@dataclass(frozen=True)
class Review:
    """The one question a line needs answered before approval."""

    kind: AmbiguityKind
    question: str
    options: tuple[str, ...]


def review_line(
    raw_line: str,
    product_ids: Sequence[str],
    qty: float | None,
    unit: str | None,
    confidence: str,
    catalog: Catalog,
) -> Review | None:
    """Which product first (nothing else matters until that's known), then how much."""

    shown = raw_line.strip()
    products = [p for pid in product_ids if (p := catalog.product(pid))]
    if not products:
        return Review(AmbiguityKind.PRODUCT_IDENTITY, f'What is "{shown}"?', (SKIP_OPTION,))
    if len(products) > 1:
        return Review(
            AmbiguityKind.PRODUCT_TYPE,
            f'Which one is "{shown}"?',
            (*(p.name for p in products), SKIP_OPTION),
        )
    [product] = products
    if confidence == "low":
        return Review(
            AmbiguityKind.PRODUCT_IDENTITY,
            f'Is "{shown}" {product.name.lower()}?',
            (product.name, "Something else", SKIP_OPTION),
        )
    if qty is None:
        return Review(
            AmbiguityKind.QUANTITY,
            f"How much {product.name.lower()} did you buy?",
            (*quantity_options(unit or product.default_unit), SKIP_OPTION),
        )
    return None


@dataclass(frozen=True)
class DraftLine:
    """One receipt item on its way to the review draft."""

    raw_line: str
    product_guess: str | None
    product_id: str | None
    """Set only when exactly one catalog product matches."""
    product: str | None
    brand: str | None
    qty: float | None
    unit: str | None
    package_size: str | None
    price: float | None
    confidence: Confidence
    review: Review | None


def draft_line(guess: ReceiptLineGuess, catalog: Catalog) -> DraftLine:
    ids = [
        pid
        for pid in resolve_product_ids(guess.raw_line, guess.product_guess, catalog.aliases)
        if catalog.product(pid)
    ]
    product = catalog.product(ids[0]) if len(ids) == 1 else None
    return DraftLine(
        raw_line=guess.raw_line,
        product_guess=guess.product_guess,
        product_id=product.id if product else None,
        product=product.name if product else None,
        brand=guess.brand,
        qty=guess.qty,
        unit=guess.unit,
        package_size=guess.package_size,
        price=guess.price,
        confidence=guess.confidence,
        review=review_line(guess.raw_line, ids, guess.qty, guess.unit, guess.confidence, catalog),
    )


def draft_lines(extraction: ReceiptExtraction, ocr_text: str, catalog: Catalog) -> list[DraftLine]:
    """Item lines only, each grounded in the OCR text and resolved against the catalog."""

    out: list[DraftLine] = []
    for guess in extraction.lines:
        if is_non_item(guess):
            continue
        grounded = ground(guess, ocr_text)
        if grounded is not None:
            out.append(draft_line(grounded, catalog))
    return out


def review_summary(total: int, needing_review: int) -> str:
    items = f"{total} item{'s' if total != 1 else ''}"
    if needing_review == 0:
        return f"We found {items}. Check them and approve."
    return (
        f"We found {items}; {needing_review} need{'s' if needing_review == 1 else ''} your input."
    )
