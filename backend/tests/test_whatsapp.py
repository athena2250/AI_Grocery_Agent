"""Tests for the WhatsApp adapter (plan_11): numbered options out, numbers back to options."""

from __future__ import annotations

import pytest

from app.channels import REPLY_HINT, render, resolve_reply

CORIANDER = ["Coriander leaves", "Coriander seeds", "Coriander powder"]


def test_clarification_renders_as_numbered_options() -> None:
    text = render("Which coriander?", options=CORIANDER)
    assert text == (
        "Which coriander?\n\n"
        "1. Coriander leaves\n2. Coriander seeds\n3. Coriander powder\n\n"
        f"{REPLY_HINT}"
    )


def test_question_is_not_repeated_when_it_is_the_reply() -> None:
    assert render("Which coriander?", "Which coriander?", ["a"]).count("Which coriander?") == 1
    assert render("Got it.", "How much?", ["100 g"]).startswith("Got it.\n\nHow much?\n\n1. 100 g")


def test_plain_reply_has_no_hint() -> None:
    assert render("Added tomatoes 1 kg.") == "Added tomatoes 1 kg."


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2", "Coriander seeds"),
        (" 2. ", "Coriander seeds"),
        ("3)", "Coriander powder"),
        ("2\ufe0f\u20e3", "Coriander seeds"),
        ("option 1", "Coriander leaves"),
        ("4", "4"),  # out of range → typed text, the pipeline asks
        ("0", "0"),
        ("seeds", "seeds"),
        ("2 kg", "2 kg"),
    ],
)
def test_resolve_reply(text: str, expected: str) -> None:
    assert resolve_reply(text, CORIANDER) == expected


def test_number_without_pending_options_passes_through() -> None:
    assert resolve_reply("2", []) == "2"
