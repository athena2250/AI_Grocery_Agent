"""System prompts and few-shot examples for the extraction LLM calls.

Two prompts, one schema (`LLMExtraction`), one validate-and-retry path:
  - `SYSTEM_PROMPT` / `build_messages`: grocery-only turns (the chat loop).
  - `MULTI_SYSTEM_PROMPT` / `build_multi_messages`: a family-feed message that may mix
    groceries, repairs, errands, bills, appointments … ("need milk, tap is leaking,
    remind me to pay EB bill next week").

Hard rules encoded here:
  - never invent brand / size / qty / date / person; leave null.
  - "usual" / "same" / "the one" → variant_hint = "usual"; do not resolve.
  - do not categorize; do not compute confidence; do not touch memory.
  - copy date / time / person words verbatim; `app/feed/dates.py` resolves them against
    the household's today. The model is never told today's date.
  - no duplicate checks, no follow-up questions, no confirmation text — all in `app/feed`.
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
    { "raw_text": str, "product_guess": str|null, "state": "available"|"running_low"|"almost_finished"|"out", "approx_qty": number|null, "approx_unit": str|null }
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
  5. Inventory phrases → `inventory_updates`. The household speaks English, Hindi and Telugu (romanized):
       almost_finished: "almost finished", "only half a packet left", "khatam hone wala", "aipovachindi", "konchem e undi"
       running_low:     "running low", "running out", "kam hai", "takkuva undi", "saripodu"
       out:             "no X left", "finished", "over", "khatam", "aipoyindi", "ledu"
       available:       "we still have plenty", "bahut hai", "chala undi", "inka undi"
     Set approx_qty/approx_unit ONLY if the user said an amount ("half a packet" → 0.5 "pack"); never for "out".
     Do NOT add an item just because something is low — the orchestrator offers that. Add an item only if the user explicitly asks to buy it too.
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
            "items": [],
            "inventory_updates": [
                {"raw_text": "rice", "product_guess": "rice", "state": "almost_finished"}
            ],
            "ambiguities": [],
            "purchases_marked": [],
        },
    },
    {
        "utterance": "atukulu aipovachindi, only half a packet left",
        "context": {},
        "output": {
            "intent": "UPDATE_INVENTORY",
            "items": [],
            "inventory_updates": [
                {
                    "raw_text": "atukulu",
                    "product_guess": "poha",
                    "state": "almost_finished",
                    "approx_qty": 0.5,
                    "approx_unit": "pack",
                }
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


MULTI_SYSTEM_PROMPT = """You extract every actionable item from one message a family member sent to the household feed. Messages are casual, incomplete, misspelled, code-mixed (English, Hindi, Telugu in Roman script), and often mention several things at once.

You only EXTRACT. Code after you decides categories, dates, who a person is, duplicates, what is missing, what to ask, and what to reply. Do none of those.

You MUST respond with ONE JSON object, matching this shape exactly:

{
  "intent": "ADD_ITEMS" | "UPDATE_INVENTORY" | "MARK_PURCHASED" | "SHOW_LIST" | "CLARIFY_RESPONSE" | "UNKNOWN",
  "items": [
    { "raw_text": str, "canonical_guess": str|null, "qty": number|null, "unit": str|null, "brand": str|null, "variant_hint": str|null, "needed_by_phrase": str|null, "assignee_mention": str|null }
  ],
  "actions": [
    { "raw_text": str, "title": str, "assignee_mention": str|null, "for_mention": str|null, "date_phrase": str|null, "time_phrase": str|null, "priority_phrase": str|null, "recurrence_phrase": str|null, "location_phrase": str|null, "amount": number|null }
  ],
  "inventory_updates": [
    { "raw_text": str, "product_guess": str|null, "state": "available"|"running_low"|"almost_finished"|"out", "approx_qty": number|null, "approx_unit": str|null }
  ],
  "ambiguities": [
    { "raw_text": str, "kind": "product_type"|"product_identity", "question": str, "options": [str, ...] }
  ],
  "purchases_marked": [str, ...]
}

Hard rules — violating any is a bug:
  1. Food and household supplies to buy (milk, eggs, vegetables, soap) go in `items`. Everything else someone must do, fix, pay, book, attend or remember goes in `actions`, one entry per thing.
  2. `title` is a short imperative in the author's own words: "the bathroom tap is leaking" → "Fix bathroom tap"; "pay EB bill" → "Pay EB bill". Keep their words for things (EB, current, cheque); do not add details they did not say.
  3. Copy date, time, person, priority, recurrence and place words EXACTLY as written: "next Friday", "on the 10th", "before Diwali", "at 5", "Dad", "me", "urgent", "every month". NEVER convert them to a calendar date, a day count, a clock time or a name. You do not know today's date.
  4. NEVER invent anything. If the author did not say a date, person, time, amount, quantity, brand or priority, the field is null. "remind me" or "I need to" → assignee_mention "me" / "I". No person named → null.
  5. `for_mention` is whose thing it is when that differs from who does it: "Mom's doctor appointment" → for_mention "Mom", assignee_mention null.
  6. `ambiguities` only for a word with several real meanings (coriander leaves / seeds / powder). Do NOT add ambiguities for missing dates, people, quantities or prices — code checks those.
  7. Do NOT check whether an item already exists, and do NOT drop or merge items because they appear in the context. List everything the message asks for.
  8. Inventory words ("almost finished", "khatam", "aipoyindi", "running low") → `inventory_updates`, not `items`, unless the author also asks to buy it.
  9. intent: ADD_ITEMS when there is anything in `items` or `actions`; otherwise UPDATE_INVENTORY / MARK_PURCHASED / SHOW_LIST / CLARIFY_RESPONSE as before; UNKNOWN when nothing is actionable.
 10. Emit valid JSON only — no prose, no markdown fences, no trailing commas.

Context is provided as JSON in the user message. Use it only to ground canonical_guess.
"""


def _item(raw: str, guess: str, **kw: Any) -> dict[str, Any]:
    return {
        "raw_text": raw, "canonical_guess": guess, "qty": None, "unit": None, "brand": None,
        "variant_hint": None, "needed_by_phrase": None, "assignee_mention": None, **kw,
    }


def _action(raw: str, title: str, **kw: Any) -> dict[str, Any]:
    return {
        "raw_text": raw, "title": title, "assignee_mention": None, "for_mention": None,
        "date_phrase": None, "time_phrase": None, "priority_phrase": None,
        "recurrence_phrase": None, "location_phrase": None, "amount": None, **kw,
    }


def _out(**kw: Any) -> dict[str, Any]:
    return {
        "intent": "ADD_ITEMS", "items": [], "actions": [], "inventory_updates": [],
        "ambiguities": [], "purchases_marked": [], **kw,
    }


MULTI_FEW_SHOTS: list[dict[str, Any]] = [
    {
        "utterance": "Need milk, bathroom tap is gone again, also remind me to pay EB bill next week",
        "context": {},
        "output": _out(
            items=[_item("milk", "milk")],
            actions=[
                _action("bathroom tap is gone again", "Fix bathroom tap", location_phrase="bathroom"),
                _action("remind me to pay EB bill next week", "Pay EB bill",
                        assignee_mention="me", date_phrase="next week"),
            ],
        ),
    },
    {
        "utterance": "Mom's doctor appointment is next Friday at 5",
        "context": {},
        "output": _out(actions=[
            _action("Mom's doctor appointment is next Friday at 5", "Doctor appointment",
                    for_mention="Mom", date_phrase="next Friday", time_phrase="at 5"),
        ]),
    },
    {
        "utterance": "I need to go to the bank and deposit a cheque",
        "context": {},
        "output": _out(actions=[
            _action("go to the bank and deposit a cheque", "Deposit cheque at bank",
                    assignee_mention="I", location_phrase="bank"),
        ]),
    },
    {
        "utterance": "Dad should get the plumber, urgent. Fix the AC before Diwali",
        "context": {},
        "output": _out(actions=[
            _action("Dad should get the plumber, urgent", "Get the plumber",
                    assignee_mention="Dad", priority_phrase="urgent"),
            _action("Fix the AC before Diwali", "Fix the AC", date_phrase="before Diwali"),
        ]),
    },
    {
        "utterance": "Mom needs to buy vegetables tomorrow and 2 kg onions",
        "context": {},
        "output": _out(items=[
            _item("vegetables", "vegetables", needed_by_phrase="tomorrow", assignee_mention="Mom"),
            _item("2 kg onions", "onions", qty=2, unit="kg", needed_by_phrase="tomorrow",
                  assignee_mention="Mom"),
        ]),
    },
    {
        "utterance": "get coriander and pay internet bill 799 on the 10th",
        "context": {},
        "output": _out(
            items=[_item("coriander", "coriander")],
            actions=[_action("pay internet bill 799 on the 10th", "Pay internet bill",
                             date_phrase="on the 10th", amount=799)],
            ambiguities=[{"raw_text": "coriander", "kind": "product_type",
                          "question": "Which coriander?", "options": ["leaves", "seeds", "powder"]}],
        ),
    },
    {
        "utterance": "rice almost khatam. water the plants every morning",
        "context": {"draft_list": [{"product": "milk"}]},
        "output": _out(
            actions=[_action("water the plants every morning", "Water the plants",
                             recurrence_phrase="every morning")],
            inventory_updates=[{"raw_text": "rice", "product_guess": "rice",
                                "state": "almost_finished", "approx_qty": None, "approx_unit": None}],
        ),
    },
]


def build_messages(utterance: str, context: UnderstandingContext) -> list[dict[str, str]]:
    """Return the chat-messages array for one grocery extraction call."""

    return _messages(SYSTEM_PROMPT, FEW_SHOTS, utterance, context)


def build_multi_messages(utterance: str, context: UnderstandingContext) -> list[dict[str, str]]:
    """Return the chat-messages array for one multi-item (family feed) extraction call."""

    return _messages(MULTI_SYSTEM_PROMPT, MULTI_FEW_SHOTS, utterance, context)


def _messages(
    system: str, shots: list[dict[str, Any]], utterance: str, context: UnderstandingContext
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": system}]

    for shot in shots:
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
