"""Unit tests for the extraction wrapper using a fake Ollama client.

Verifies: happy-path parse, retry on invalid JSON, retry on schema violation,
give-up after second failure.
"""

from __future__ import annotations

import json
from typing import Iterable

import pytest

from app.understanding import UnderstandingClient, UnderstandingError
from app.understanding.schema import Intent, UnderstandingContext


class FakeClient:
    def __init__(self, responses: Iterable[str]) -> None:
        self._responses = list(responses)
        self.calls: list[list[dict[str, str]]] = []

    async def chat(self, model: str, messages: list[dict[str, str]]) -> str:
        self.calls.append(messages)
        if not self._responses:
            raise AssertionError("FakeClient exhausted")
        return self._responses.pop(0)


VALID_ADD_ITEMS = json.dumps(
    {
        "intent": "ADD_ITEMS",
        "items": [
            {
                "raw_text": "coriander",
                "canonical_guess": "coriander",
                "qty": None,
                "unit": None,
                "brand": None,
                "variant_hint": None,
            }
        ],
        "inventory_updates": [],
        "ambiguities": [
            {
                "raw_text": "coriander",
                "kind": "product_type",
                "question": "Which coriander?",
                "options": ["leaves", "seeds", "powder"],
            }
        ],
        "purchases_marked": [],
    }
)


@pytest.mark.asyncio
async def test_happy_path_parses_valid_json() -> None:
    fake = FakeClient([VALID_ADD_ITEMS])
    client = UnderstandingClient(fake)

    result = await client.extract("get coriander", UnderstandingContext())

    assert result.intent is Intent.ADD_ITEMS
    assert len(result.items) == 1
    assert result.items[0].raw_text == "coriander"
    assert len(result.ambiguities) == 1
    assert result.ambiguities[0].kind.value == "product_type"
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_retries_once_on_bad_json_and_succeeds() -> None:
    fake = FakeClient(["not json at all", VALID_ADD_ITEMS])
    client = UnderstandingClient(fake)

    result = await client.extract("get coriander")

    assert result.intent is Intent.ADD_ITEMS
    assert len(fake.calls) == 2
    # The retry must include the previous assistant response + a correction message.
    retry_messages = fake.calls[1]
    assert retry_messages[-2]["role"] == "assistant"
    assert retry_messages[-2]["content"] == "not json at all"
    assert retry_messages[-1]["role"] == "user"
    assert "failed JSON schema validation" in retry_messages[-1]["content"]


@pytest.mark.asyncio
async def test_retries_on_schema_violation() -> None:
    bad_schema = json.dumps({"intent": "NOT_A_REAL_INTENT", "items": []})
    fake = FakeClient([bad_schema, VALID_ADD_ITEMS])
    client = UnderstandingClient(fake)

    result = await client.extract("get coriander")

    assert result.intent is Intent.ADD_ITEMS
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_raises_after_second_failure() -> None:
    fake = FakeClient(["nope", "still nope"])
    client = UnderstandingClient(fake)

    with pytest.raises(UnderstandingError):
        await client.extract("get coriander")

    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_context_is_included_in_final_user_message() -> None:
    fake = FakeClient([VALID_ADD_ITEMS])
    client = UnderstandingClient(fake)

    ctx = UnderstandingContext(
        preferences=[{"product": "tomatoes", "qty": 1, "unit": "kg"}],
        inventory=[{"product": "rice", "state": "almost_finished"}],
        draft_list=[],
    )
    await client.extract("tomatoes", ctx)

    final_user_msg = fake.calls[0][-1]
    assert final_user_msg["role"] == "user"
    payload = json.loads(final_user_msg["content"])
    assert payload["utterance"] == "tomatoes"
    assert payload["context"]["preferences"][0]["product"] == "tomatoes"
