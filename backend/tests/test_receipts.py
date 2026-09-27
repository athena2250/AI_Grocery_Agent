"""Tests for receipt processing (plan_09): fixture parses, fault injection, review, approval."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from datetime import UTC, date, datetime, timedelta
from itertools import count
from pathlib import Path
from typing import Any

import pytest
import yaml
from sqlmodel import Session, SQLModel, create_engine

from app.ambiguity.safety_net import Catalog, CatalogAlias, CatalogProduct
from app.history import PurchaseSource, price_history
from app.inventory import get_inventory, upsert_inventory
from app.memory import Preference, get_preferences
from app.receipts import (
    SKIP_OPTION,
    UNREADABLE_MESSAGE,
    LineStatus,
    OcrError,
    Receipt,
    ReceiptLineGuess,
    ReceiptParser,
    ReceiptReading,
    ReceiptStatus,
    Unreadable,
    answer_line,
    approve_receipt,
    create_draft,
    discard_receipt,
    pending_review,
    read_receipt,
    read_receipt_text,
    receipt_lines,
    remembered_stores,
    set_store,
    skip_line,
    summary,
)
from app.receipts.prompts import build_messages
from app.receipts.rules import (
    detect_store,
    ground,
    is_non_item,
    looks_readable,
    receipt_date,
    resolve_product_ids,
)
from app.understanding.schema import InventoryStateLiteral as S

HH = "hh_1"
NOW = datetime(2026, 9, 27, 10, tzinfo=UTC)
FIXTURES: list[dict[str, Any]] = yaml.safe_load(
    (Path(__file__).parent / "fixtures" / "receipts.yaml").read_text(encoding="utf-8")
)

_PRODUCTS = [
    ("p_toor_dal", "Toor dal", "kg", ["toor dal", "tuvar dal", "arhar dal"]),
    ("p_tomato", "Tomatoes", "kg", ["tomato", "tomatoes"]),
    ("p_onion", "Onions", "kg", ["onion", "onions"]),
    ("p_rice", "Rice", "kg", ["rice"]),
    ("p_wheat_atta", "Wheat atta", "kg", ["atta", "wheat atta"]),
    ("p_biscuits", "Biscuits", "pack", ["biscuits", "parle-g"]),
    ("p_milk", "Milk", "L", ["milk"]),
    ("p_curd", "Curd", "g", ["curd", "dahi"]),
    ("p_banana", "Bananas", "dozen", ["banana", "bananas"]),
    ("p_coriander_leaves", "Coriander leaves", "bunch", ["coriander leaves"]),
    ("p_coriander_seeds", "Coriander seeds", "g", ["coriander seeds"]),
    ("p_coriander_powder", "Coriander powder", "g", ["coriander powder"]),
    ("p_turmeric", "Turmeric powder", "g", ["turmeric", "turmeric powder", "haldi"]),
    ("p_sunflower_oil", "Sunflower oil", "L", ["sunflower oil"]),
    ("p_salt", "Salt", "kg", ["salt"]),
    ("p_tea", "Tea", "g", ["tea", "chai patti"]),
]
CATALOG = Catalog(
    products=tuple(CatalogProduct(id=i, name=n, default_unit=u) for i, n, u, _ in _PRODUCTS),
    aliases=(
        *(CatalogAlias(a, i) for i, _, _, aliases in _PRODUCTS for a in aliases),
        *(
            CatalogAlias("coriander", pid, "coriander")
            for pid in ("p_coriander_leaves", "p_coriander_seeds", "p_coriander_powder")
        ),
    ),
)


class FakeClient:
    def __init__(self, responses: Iterable[str]) -> None:
        self._responses = list(responses)
        self.calls: list[list[dict[str, str]]] = []

    async def chat(self, model: str, messages: list[dict[str, str]]) -> str:
        self.calls.append(messages)
        if not self._responses:
            raise AssertionError("FakeClient exhausted")
        return self._responses.pop(0)


class FakeOcr:
    def __init__(self, text: str | None = None) -> None:
        self._text = text

    def read_text(self, image: bytes) -> str:
        if self._text is None:
            raise OcrError("image is not a photo")
        return self._text


def fixture(name: str) -> dict[str, Any]:
    return next(f for f in FIXTURES if f["name"] == name)


def parser_for(*outputs: dict[str, Any] | str) -> tuple[ReceiptParser, FakeClient]:
    fake = FakeClient(o if isinstance(o, str) else json.dumps(o) for o in outputs)
    return ReceiptParser(fake), fake


async def read_fixture(name: str) -> ReceiptReading:
    f = fixture(name)
    parser, _ = parser_for(f["llm_output"])
    reading = await read_receipt_text(f["ocr_text"], parser, CATALOG)
    assert isinstance(reading, ReceiptReading), reading
    return reading


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def ids() -> Iterator[str]:
    return (f"id_{n}" for n in count())


def draft(session: Session, reading: ReceiptReading) -> Receipt:
    gen = ids()
    receipt = create_draft(session, HH, reading, NOW, new_id=lambda: next(gen))
    session.commit()
    return receipt


# --- Fixture set: expected parses -------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("case", FIXTURES, ids=[f["name"] for f in FIXTURES])
async def test_fixture_parses_as_expected(case: dict[str, Any]) -> None:
    parser, fake = parser_for(case["llm_output"])
    reading = await read_receipt_text(case["ocr_text"], parser, CATALOG)
    assert isinstance(reading, ReceiptReading), reading
    assert len(fake.calls) == 1

    expected = case["expected"]
    assert reading.store == expected["store"]
    assert reading.purchased_at == expected["purchased_at"]
    assert len(reading.lines) == len(expected["lines"])
    for line, exp in zip(reading.lines, expected["lines"], strict=True):
        status = "ready" if line.review is None else "needs_review"
        got = {
            "product_id": line.product_id,
            "qty": line.qty,
            "unit": line.unit,
            "price": line.price,
            "brand": line.brand,
            "status": status,
            "review_kind": line.review.kind.value if line.review else None,
        }
        assert {k: got[k] for k in exp} == exp, line.raw_line
        if line.review:
            assert line.review.options[-1] == SKIP_OPTION


@pytest.mark.asyncio
async def test_summary_counts_items_needing_input() -> None:
    reading = await read_fixture("unknown_kirana_store")
    assert reading.summary == "We found 3 items; 1 needs your input."
    reading = await read_fixture("dmart_with_tax_and_discount")
    assert reading.summary == "We found 4 items. Check them and approve."


def test_prompt_carries_the_detected_store() -> None:
    last = json.loads(build_messages("TOMATO 1 40.00", "DMart")[-1]["content"])
    assert last == {"ocr_text": "TOMATO 1 40.00", "store": "DMart"}


# --- Fault injection: graceful refusal ------------------------------------------


NOISY_OCR = [
    "",
    "   \n\n  ",
    "~~ ,.; |l1 %%# 0O0 ::\n~ -- ~ 8B&",
    "lIl1 Il1l |||| 1l1l\n0O0O 8B8B",
    "#### ---- ____ 12.00 ....",
    "▓▒░ ▓▒░ ▓▒ 45 ░▒▓",
    "TOTAL",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", NOISY_OCR)
async def test_noisy_ocr_is_refused_without_calling_the_llm(text: str) -> None:
    parser, fake = parser_for()
    result = await read_receipt_text(text, parser, CATALOG)
    assert isinstance(result, Unreadable)
    assert result.message == UNREADABLE_MESSAGE == "Couldn't read this — try a clearer photo."
    assert fake.calls == []


@pytest.mark.asyncio
async def test_llm_refusal_becomes_the_error_card() -> None:
    parser, _ = parser_for({"readable": False, "reason": "too blurry", "lines": []})
    result = await read_receipt_text(
        fixture("dmart_with_tax_and_discount")["ocr_text"], parser, CATALOG
    )
    assert result == Unreadable("too blurry")


@pytest.mark.asyncio
async def test_hallucinated_lines_only_is_unreadable() -> None:
    invented = {
        "readable": True,
        "lines": [
            {"raw_line": "BASMATI RICE 5KG 1 650.00", "product_guess": "rice", "qty": 1,
             "price": 650.0, "confidence": "high"},
            {"raw_line": "GHEE 1L 1 560.00", "product_guess": "ghee", "qty": 1,
             "price": 560.0, "confidence": "high"},
        ],
    }  # fmt: skip
    parser, _ = parser_for(invented)
    result = await read_receipt_text(
        fixture("reliance_fresh_bilingual")["ocr_text"], parser, CATALOG
    )
    assert isinstance(result, Unreadable)


@pytest.mark.asyncio
async def test_invalid_json_twice_is_unreadable_not_a_crash() -> None:
    parser, fake = parser_for("not json", '{"lines": "still wrong"}')
    result = await read_receipt_text(
        fixture("dmart_with_tax_and_discount")["ocr_text"], parser, CATALOG
    )
    assert isinstance(result, Unreadable)
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_ocr_failure_is_unreadable() -> None:
    parser, fake = parser_for()
    result = await read_receipt(b"\x00", FakeOcr(None), parser, CATALOG)
    assert isinstance(result, Unreadable) and fake.calls == []


@pytest.mark.asyncio
async def test_photo_goes_through_ocr_then_parse() -> None:
    f = fixture("greenbazaar_coriander_ambiguity")
    parser, _ = parser_for(f["llm_output"])
    result = await read_receipt(b"jpeg", FakeOcr(f["ocr_text"]), parser, CATALOG)
    assert isinstance(result, ReceiptReading) and len(result.lines) == 3


# --- Rules -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw_line", "guess", "skipped"),
    [
        ("CGST 2.5%   6.25", None, True),
        ("ROUND OFF  -0.50", "round off", True),
        ("Sub Total  152.00", "subtotal", True),
        ("DISCOUNT  -10.00", "discount", True),
        ("YOU SAVED  12.00", "savings", True),
        ("TOOR DAL 1KG 1 145.00", "toor dal", False),
        ("TOTAL WASH 1 99.00", None, True),
    ],
)
def test_non_item_lines(raw_line: str, guess: str | None, skipped: bool) -> None:
    assert is_non_item(ReceiptLineGuess(raw_line=raw_line, product_guess=guess)) is skipped


OCR = "RELIANCE FRESH\nAASHIR ATTA 5KG      1   265.00\nTOMATO  1.000 KG  40.00\n"


@pytest.mark.parametrize(
    ("guess", "expected"),
    [
        # Verbatim, spacing differs → kept.
        ({"raw_line": "AASHIR ATTA 5KG 1 265.00", "qty": 1, "price": 265.0, "brand": "Aashirvaad"},
         {"qty": 1, "price": 265.0, "brand": "Aashirvaad"}),
        # Price / qty not printed → cleared; brand not printed → cleared.
        ({"raw_line": "TOMATO  1.000 KG  40.00", "qty": 2, "unit": "kg", "price": 42.0, "brand": "Fresh"},
         {"qty": None, "unit": None, "price": None, "brand": None}),
        # qty 1 is implicit on receipts.
        ({"raw_line": "AASHIR ATTA 5KG", "qty": 1, "unit": "pcs"}, {"qty": 1, "unit": "pcs"}),
        # OCR-ish slip in the model's copy → matched to the real line, which replaces it.
        ({"raw_line": "AASHIR ATTA 5KG      1   265.0O", "price": 265.0},
         {"raw_line": "AASHIR ATTA 5KG      1   265.00", "price": 265.0}),
    ],
)  # fmt: skip
def test_grounding(guess: dict[str, Any], expected: dict[str, Any]) -> None:
    g = ground(ReceiptLineGuess(product_guess="x", **guess), OCR)
    assert g is not None
    assert {k: getattr(g, k) for k in expected} == expected


def test_invented_line_is_dropped() -> None:
    assert ground(ReceiptLineGuess(raw_line="SUGAR 1KG 44.00", product_guess="sugar"), OCR) is None
    assert ground(ReceiptLineGuess(raw_line=" .. ", product_guess="sugar"), OCR) is None


@pytest.mark.parametrize(
    ("raw", "guess", "expected"),
    [
        ("CORIANDER 100G", "coriander", ["p_coriander_leaves", "p_coriander_seeds", "p_coriander_powder"]),
        ("CORIANDER 100G", "coriander seeds", ["p_coriander_seeds"]),
        ("CORR PWD 100G", "coriander powder", ["p_coriander_powder"]),
        # The printed line beats a contradicting guess.
        ("TOOR DAL 1KG", "rice", ["p_toor_dal"]),
        ("XYZ SPL MIX", "mixture", []),
    ],
)  # fmt: skip
def test_resolve_product_ids(raw: str, guess: str, expected: list[str]) -> None:
    assert resolve_product_ids(raw, guess, CATALOG.aliases) == expected


@pytest.mark.parametrize(
    ("header", "remembered", "expected"),
    [
        ("D MART\nAvenue", {}, "DMart"),
        ("Avenue Supermarts Ltd\n", {}, "DMart"),
        ("RELIANCE SMART\n", {}, "Reliance Smart"),
        ("Spencers Retail\n", {}, "Spencer's"),
        ("RATNADEEP SUPER MARKET\n", {}, "Ratnadeep"),
        ("SRI LAKSHMI KIRANA\n", {}, None),
        ("SRI LAKSHMI KIRANA\n", {"srilakshmikirana": "Lakshmi anna shop"}, "Lakshmi anna shop"),
        ("Tomorrow's specials\nmore fresh stuff\n", {}, None),
        # Chain names deep in the body (an ad on line 9) don't count.
        ("\n".join(["SRI LAKSHMI"] + ["x"] * 8 + ["Shop at DMart"]), {}, None),
    ],
)
def test_detect_store(header: str, remembered: dict[str, str], expected: str | None) -> None:
    assert detect_store(header, remembered) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Dt 21/09/2026 18:42", date(2026, 9, 21)),
        ("Date: 18-09-26", date(2026, 9, 18)),
        ("Inv Dt: 2026-09-26", date(2026, 9, 26)),
        ("05.10.2026", date(2026, 10, 5)),
        ("Bill 31/02/2026 then 01/03/2026", date(2026, 3, 1)),
        ("Ph 98480 12345", None),
    ],
)
def test_receipt_date(text: str, expected: date | None) -> None:
    assert receipt_date(text) == expected


def test_bilingual_text_counts_as_readable() -> None:
    assert looks_readable("रिलायंस फ्रेश\nप्याज़ टमाटर आलू\nप्याज़  1.000 KG  38.00")


# --- Review draft -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_draft_blocks_approval_until_every_line_is_answered(session: Session) -> None:
    receipt = draft(session, await read_fixture("greenbazaar_coriander_ambiguity"))
    assert summary(session, receipt.id) == "We found 3 items; 1 needs your input."
    assert approve_receipt(session, receipt, NOW) is None

    [coriander] = pending_review(session, receipt.id)
    assert coriander.review_kind == "product_type"
    assert coriander.review_options == [
        "Coriander leaves", "Coriander seeds", "Coriander powder", SKIP_OPTION,
    ]  # fmt: skip
    answer_line(session, coriander, CATALOG, product_id="p_coriander_seeds")
    assert (coriander.status, coriander.product, coriander.confidence) == (
        LineStatus.READY,
        "Coriander seeds",
        "high",
    )
    assert approve_receipt(session, receipt, NOW) is not None


@pytest.mark.asyncio
async def test_answering_product_then_quantity(session: Session) -> None:
    receipt = draft(session, await read_fixture("more_invented_qty_and_low_confidence"))
    curd, tea = pending_review(session, receipt.id)

    assert tea.review_question == 'Is "T.B. DUST 250G      1     140.00" tea?'
    answer_line(session, tea, CATALOG, product_id="p_tea")
    assert tea.status == LineStatus.READY

    assert curd.review_question == "How much curd did you buy?"
    assert curd.review_options == ["50 g", "100 g", "200 g", "custom", SKIP_OPTION]
    answer_line(session, curd, CATALOG, qty=2, unit="pack")
    assert (curd.status, curd.qty, curd.unit) == (LineStatus.READY, 2, "pack")


@pytest.mark.asyncio
async def test_unknown_product_can_be_named_or_skipped(session: Session) -> None:
    receipt = draft(session, await read_fixture("unknown_kirana_store"))
    [mix] = pending_review(session, receipt.id)
    assert mix.review_question == 'What is "XYZ SPL MIX              1    45.00"?'
    answer_line(session, mix, CATALOG, qty=1)  # still no product → still asking
    assert mix.status == LineStatus.NEEDS_REVIEW
    with pytest.raises(ValueError):
        answer_line(session, mix, CATALOG, product_id="p_nonexistent")
    skip_line(session, mix)
    assert summary(session, receipt.id) == "We found 2 items. Check them and approve."
    purchases = approve_receipt(session, receipt, NOW)
    assert purchases is not None
    assert [p.product_id for p in purchases] == ["p_rice", "p_sunflower_oil"]


@pytest.mark.asyncio
async def test_unknown_store_is_asked_once_and_remembered(session: Session) -> None:
    f = fixture("unknown_kirana_store")
    receipt = draft(session, await read_fixture("unknown_kirana_store"))
    assert receipt.store is None
    set_store(session, receipt, "Lakshmi Kirana")
    session.commit()
    assert remembered_stores(session, HH) == {"srilakshmikiranastores": "Lakshmi Kirana"}

    parser, _ = parser_for(f["llm_output"])
    again = await read_receipt_text(f["ocr_text"], parser, CATALOG, remembered_stores(session, HH))
    assert isinstance(again, ReceiptReading) and again.store == "Lakshmi Kirana"
    assert remembered_stores(session, "hh_2") == {}


# --- Approval → purchase, pantry, price history, memory --------------------------


@pytest.mark.asyncio
async def test_approval_writes_history_pantry_and_memory(session: Session) -> None:
    bought_at = datetime(2026, 9, 21, tzinfo=UTC)
    # Rice pantry row is older than the receipt; atta was updated after it.
    upsert_inventory(session, HH, "p_toor_dal", S.OUT, now=bought_at - timedelta(days=3))
    upsert_inventory(
        session, HH, "p_wheat_atta", S.ALMOST_FINISHED, now=bought_at + timedelta(days=2)
    )
    session.add(
        Preference(
            household_id=HH, product_id="p_tomato", typical_qty=1, typical_unit="kg",
            confidence=0.6, last_confirmed_at=bought_at - timedelta(days=30),
        )
    )  # fmt: skip
    session.commit()

    receipt = draft(session, await read_fixture("dmart_with_tax_and_discount"))
    gen = (f"pur_{n}" for n in count())
    purchases = approve_receipt(session, receipt, NOW, new_id=lambda: next(gen))
    session.commit()
    assert purchases is not None

    assert [(p.product_id, p.qty, p.unit, p.price, p.brand, p.store) for p in purchases] == [
        ("p_toor_dal", 1, "pcs", 145.0, None, "DMart"),
        ("p_tomato", 1, "kg", 40.0, None, "DMart"),
        ("p_biscuits", 2, "pack", 50.0, "Parle-G", "DMart"),
        ("p_wheat_atta", 1, "pcs", 265.0, "Aashirvaad", "DMart"),
    ]
    assert all(
        p.source is PurchaseSource.RECEIPT_OCR
        and p.currency == "INR"
        and p.purchased_at.replace(tzinfo=UTC) == bought_at
        for p in purchases
    )

    pantry = {r.product_id: r.state for r in get_inventory(session, HH)}
    assert pantry == {
        "p_toor_dal": S.AVAILABLE,
        "p_tomato": S.AVAILABLE,
        "p_biscuits": S.AVAILABLE,
        "p_wheat_atta": S.ALMOST_FINISHED,  # newer than the receipt — left alone
    }

    [point] = price_history(session, HH, "p_biscuits")
    assert (point.price, point.unit_price, point.brand, point.store) == (
        50.0,
        25.0,
        "Parle-G",
        "DMart",
    )

    # Only an existing preference is bumped; receipts never create one.
    prefs = get_preferences(session, HH, ["p_tomato", "p_toor_dal"], NOW)
    assert prefs["p_tomato"].confidence == 0.7
    assert "p_toor_dal" not in prefs

    assert receipt.status is ReceiptStatus.APPROVED
    assert approve_receipt(session, receipt, NOW) is None  # never twice
    with pytest.raises(ValueError):
        skip_line(session, receipt_lines(session, receipt.id)[0])


@pytest.mark.asyncio
async def test_price_history_spans_receipts(session: Session) -> None:
    older = await read_fixture("dmart_with_tax_and_discount")
    r1 = draft(session, older)
    approve_receipt(session, r1, NOW)
    newer_text = older.ocr_text.replace("21/09/2026", "28/09/2026").replace("40.00", "46.00")
    newer = await read_receipt_text(
        newer_text,
        parser_for(
            {"readable": True, "lines": [{"raw_line": "TOMATO            1.000 KG  46.00",
             "product_guess": "tomatoes", "qty": 1, "unit": "kg", "price": 46.0,
             "confidence": "high"}]}
        )[0],
        CATALOG,
    )  # fmt: skip
    assert isinstance(newer, ReceiptReading)
    gen = (f"x_{n}" for n in count())
    r2 = create_draft(session, HH, newer, NOW, new_id=lambda: next(gen))
    approve_receipt(session, r2, NOW)
    session.commit()
    assert [(p.purchased_at.date(), p.price) for p in price_history(session, HH, "p_tomato")] == [
        (date(2026, 9, 21), 40.0),
        (date(2026, 9, 28), 46.0),
    ]


@pytest.mark.asyncio
async def test_receipt_without_a_date_uses_approval_time(session: Session) -> None:
    receipt = draft(session, await read_fixture("unknown_kirana_store"))
    skip_line(session, pending_review(session, receipt.id)[0])
    purchases = approve_receipt(session, receipt, NOW)
    assert purchases and all(p.purchased_at == NOW for p in purchases)


@pytest.mark.asyncio
async def test_discarded_or_all_skipped_receipts_write_nothing(session: Session) -> None:
    receipt = draft(session, await read_fixture("reliance_fresh_bilingual"))
    for line in receipt_lines(session, receipt.id):
        skip_line(session, line)
    assert approve_receipt(session, receipt, NOW) is None
    assert discard_receipt(session, receipt) is True
    assert discard_receipt(session, receipt) is False
    assert approve_receipt(session, receipt, NOW) is None
    session.commit()
    assert get_inventory(session, HH) == []
