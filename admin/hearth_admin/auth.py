"""Named operator credentials; audit identity is derived from the authenticated token."""
from __future__ import annotations

import hmac
import json
import os

from fastapi import Header, HTTPException


def operator_tokens() -> dict[str, str]:
    raw = os.environ.get("ADMIN_TOKENS")
    if raw is None:
        return {}
    try:
        tokens = json.loads(raw)
        if not isinstance(tokens, dict) or not tokens:
            raise ValueError()
        if any(not isinstance(name, str) or not name.strip() or len(name) > 60
               or not isinstance(token, str) or len(token) < 32
               for name, token in tokens.items()):
            raise ValueError()
        if len(set(tokens.values())) != len(tokens):
            raise ValueError()
        return tokens
    except (ValueError, TypeError):
        raise HTTPException(503, "ADMIN_TOKENS must map unique operator names to unique tokens of at least 32 characters") from None


def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_name: str | None = Header(default=None),
) -> str:
    given = (authorization or "").removeprefix("Bearer ").strip()
    tokens = operator_tokens()
    if tokens:
        identity = None
        for name, token in tokens.items():
            if hmac.compare_digest(given.encode(), token.encode()):
                identity = name
        if identity is not None:
            return identity
    elif os.environ.get("APP_ENV", "").lower() == "production":
        raise HTTPException(503, "Production admin requires ADMIN_TOKENS")
    else:
        expected = os.environ.get("ADMIN_TOKEN")
        if not expected:
            raise HTTPException(503, "ADMIN_TOKEN is not set on the server")
        if given and hmac.compare_digest(given.encode(), expected.encode()):
            return (x_admin_name or "admin").strip()[:60] or "admin"
    raise HTTPException(401, "wrong or missing admin token")
