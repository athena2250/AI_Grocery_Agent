"""Who may use the console: anyone holding `ADMIN_TOKEN`.

The token is set per environment (never committed). With no token set every API call is
refused, so a forgotten env var fails closed. The admin's name (`X-Admin-Name`) goes into
the audit log; it identifies, it does not authorize.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException


def _token() -> str | None:
    return os.environ.get("ADMIN_TOKEN") or None


def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_name: str | None = Header(default=None),
) -> str:
    """FastAPI dependency. Returns the admin's name for the audit log."""

    expected = _token()
    if expected is None:
        raise HTTPException(503, "ADMIN_TOKEN is not set on the server")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not given or not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, "wrong or missing admin token")
    name = (x_admin_name or "").strip()[:60]
    return name or "admin"
