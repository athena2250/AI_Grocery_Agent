"""System prompt and few-shot examples for the extraction LLM call.

Hard rules encoded here:
  - never invent brand / size / qty; leave null and emit an ambiguity instead.
  - "usual" / "same" / "the one" → variant_hint = "usual"; do not resolve.
  - do not categorize; do not compute confidence; do not touch memory.
"""

from __future__ import annotations

import json
from typing import Any

from .schema import UnderstandingContext

SYSTEM_PROMPT = """You extract structured grocery intent from one utterance by a household user (often terse, ambiguous, code-mixed English).

You MUST respond with ONE JSON object, matching this shape exactly:

{
  "intent": "ADD_ITEMS" | "UPDATE_INVENTORY" | "MARK_PURCHASED" | "SHOW_LIST" | "CLARIFY_RESPONSE" | "UNKNOWN",
  "items": [
    { "raw_text": str, "canonical_guess": str|null, "qty": number|null, "unit": str|null, "brand": str|null, "variant_hint": str|null }
  ],
  "inventory_updates": [
    { "raw_text": str, "product_guess": str|null, "state": "available"|"running_low"|"almost_finished"|"out" }
  ],
  "ambiguities": [
    { "raw_text": str, "kind": "product_type"|"quantity"|"brand"|"package_size"|"usual_unresolved"|"product_identity", "question": str, "options": [str, ...] }
  ],
  "purchases_marked": [str, ...]
}

Hard rules — violating any is a bug:
  1. NEVER invent a brand, quantity, unit, package size, or variant. If the user did not say it, leave the field null.
  2. If a field is null and the value matters (qty for a countable item, product type for polysemous items like "coriander"), you MUST add an entry to `ambiguities` with a short question and 2–4 options.
  3. Words like "usual", "same", "the one", "regular" → set `variant_hint` to "usual". DO NOT try to resolve which product this is; that is done downstream against memory.
  4. Do NOT assign categories. Do NOT compute confidence. Do NOT modify or reference memory beyond reading the provided context.
  5. Inventory phrases ("almost finished", "running out", "over", "khatam") → `inventory_updates`, and if the user also implies re-buying, ALSO add an item.
  6. "mark X purchased/bought/got" → intent MARK_PURCHASED and put the item name(s) in `purchases_marked`.
  7. "show / see / what's on the list" → intent SHOW_LIST, no items.
  8. If the utterance is a short reply to a prior clarification chip (e.g. just "seeds" or "100g"), intent is CLARIFY_RESPONSE.
  9. Emit valid JSON only — no prose, no markdown fences, no trailing commas.

Context is provided as JSON in the user message. Use it for grounding canonical_guess, but do NOT copy preferences into items unless the user asked for that item.
"""


FEW_SHOTS: list[dict[str, Any]] = [
    {
        "utterance": "get coriander",
        "context": {},
        "output": {
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
        },
    },
    {
        "utterance": "tomatoes I don't know how much",
        "context": {"preferences": [{"product": "tomatoes", "qty": 1, "unit": "kg"}]},
        "output": {
            "intent": "ADD_ITEMS",
            "items": [
                {
                    "raw_text": "tomatoes",
                    "canonical_guess": "tomatoes",
                    "qty": None,
                    "unit": None,
                    "brand": None,
                    "variant_hint": None,
                }
            ],
            "inventory_updates": [],
            "ambiguities": [
                {
                    "raw_text": "tomatoes",
                    "kind": "quantity",
                    "question": "How many tomatoes?",
                    "options": ["500 g", "1 kg", "2 kg"],
                }
            ],
            "purchases_marked": [],
        },
    },
    {
        "utterance": "get the usual biscuits",
        "context": {"preferences": [{"product": "biscuits", "brand": "Parle-G"}]},
        "output": {
            "intent": "ADD_ITEMS",
            "items": [
                {
                    "raw_text": "the usual biscuits",
                    "canonical_guess": "biscuits",
                    "qty": None,
                    "unit": None,
                    "brand": None,
                    "variant_hint": "usual",
                }
            ],
            "inventory_updates": [],
            "ambiguities": [],
            "purchases_marked": [],
        },
    },
    {
        "utterance": "rice is almost finished",
        "context": {},
        "output": {
            "intent": "UPDATE_INVENTORY",
            "items": [
                {
                    "raw_text": "rice",
                    "canonical_guess": "rice",
                    "qty": None,
                    "unit": None,
                    "brand": None,
                    "variant_hint": "usual",
                }
            ],
            "inventory_updates": [
                {"raw_text": "rice", "product_guess": "rice", "state": "almost_finished"}
            ],
            "ambiguities": [],
            "purchases_marked": [],
        },
    },
    {
        "utterance": "mark parle-g purchased",
        "context": {"draft_list": [{"product": "biscuits", "brand": "Parle-G"}]},
        "output": {
            "intent": "MARK_PURCHASED",
            "items": [],
            "inventory_updates": [],
            "ambiguities": [],
            "purchases_marked": ["Parle-G"],
        },
    },
]


def build_messages(utterance: str, context: UnderstandingContext) -> list[dict[str, str]]:
    """Return the chat-messages array for one extraction call."""

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    for shot in FEW_SHOTS:
        user_content = json.dumps(
            {"utterance": shot["utterance"], "context": shot["context"]},
            ensure_ascii=False,
        )
        messages.append({"role": "user", "content": user_content})
        messages.append(
            {"role": "assistant", "content": json.dumps(shot["output"], ensure_ascii=False)}
        )

    payload = {
        "utterance": utterance,
        "context": context.model_dump(exclude_none=False),
    }
    messages.append({"role": "user", "content": json.dumps(payload, ensure_ascii=False)})
    return messages


def retry_correction_message(error: str) -> dict[str, str]:
    """Message appended on the retry when the first response failed validation."""

    return {
        "role": "user",
        "content": (
            "Your previous response failed JSON schema validation with this error:\n"
            f"{error}\n\n"
            "Return corrected JSON only. Same shape. No prose."
        ),
    }
