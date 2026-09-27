"""WhatsApp message adapter (plan_11). Pure text in, text out — no webhook, no network.

Mom texts the bot exactly as she'd type in the app; the same chat pipeline
answers. WhatsApp has no tappable chips, so a clarification goes out as
numbered options, and a bare number coming back ("2", "2.", a keycap emoji) is mapped
to that option. Anything else passes through untouched as a normal message.

The inbound webhook (WhatsApp Business API / Twilio) needs a public HTTPS
deployment and will be a thin route around `render` / `resolve_reply`.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

_NUMBER_REPLY = re.compile(
    r"^\s*(?:option\s*)?(\d{1,2})\s*(?:\ufe0f?\u20e3)?\s*[.)]?\s*$", re.IGNORECASE
)
REPLY_HINT = "Reply with a number, or just type your answer."


def render(reply: str, question: str | None = None, options: Sequence[str] = ()) -> str:
    """One outbound WhatsApp message: the reply, then the question with numbered options."""

    parts = [reply.strip()] if reply.strip() else []
    if question and question.strip() and question.strip() != reply.strip():
        parts.append(question.strip())
    if options:
        parts.append("\n".join(f"{n}. {opt}" for n, opt in enumerate(options, start=1)))
        parts.append(REPLY_HINT)
    return "\n\n".join(parts)


def resolve_reply(text: str, options: Sequence[str]) -> str:
    """A bare in-range number → that option's text; anything else is returned unchanged.

    An out-of-range number is left as typed — "5" might be an amount, and the
    chat pipeline asks rather than us guessing.
    """

    m = _NUMBER_REPLY.match(text)
    if m and options:
        n = int(m.group(1))
        if 1 <= n <= len(options):
            return options[n - 1]
    return text
