"""The HTTP API the phones talk to.

    cd backend && .venv/bin/uvicorn app.main:app --reload
    APP_ENV=production DATABASE_URL=… AUTH_SECRET=… uvicorn app.main:app --host 0.0.0.0

Sign-in (`/auth/*`, name + number + the passkey the admin issued) wraps `auth/store.py`; family sharing (`/sync/*`) wraps `sync/store.py`.
Every route but sign-in, `/healthz` and `/privacy` needs `Authorization: Bearer <token>`.
`/understand` is the LLM (Ollama): the phones ask it only about messages their own rules
don't recognise, and turn what it extracted back into commands for those rules.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app import db
from app.auth import store as auth
from app.core.models import Member
from app.core.sqltypes import utcnow
from app.seed import main as seed_main
from app.sync import store as sync
from app.sync.models import STREAMS
from app.understanding.llm import client_from_env

log = logging.getLogger("hearth.api")

MAX_PUSH_BYTES = 4_000_000
"""A home's first snapshot (catalog + history) is the biggest thing a phone sends."""
AUTH_TRIES_PER_IP_PER_HOUR = 30
"""Join requests + passkey tries from one address, on top of the per-number lockout in auth/store."""
PURGE_EVERY_S = 24 * 3600


# ---------------------------------------------------------------- app + lifecycle

def _engine():
    if db._engine is None:
        db._engine = db.get_engine()
    return db._engine


async def _purge_daily() -> None:
    while True:
        try:
            with Session(_engine()) as s:
                auth.purge(s, utcnow())
                s.commit()
        except Exception:  # keep the loop alive; the next day retries
            log.exception("purge failed")
        await asyncio.sleep(PURGE_EVERY_S)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if os.environ.get("APP_ENV", "").lower() == "production" and \
            os.environ.get("AUTH_SECRET", "dev-only-change-me") == "dev-only-change-me":
        raise RuntimeError("set AUTH_SECRET in production")
    seed_main(_engine(), demo=False)  # tables + catalog; never the demo household
    task = asyncio.create_task(_purge_daily())
    yield
    task.cancel()


app = FastAPI(title="Hearth API", lifespan=lifespan, docs_url=None, redoc_url=None)


def get_session() -> Iterator[Session]:
    with Session(_engine()) as s:
        yield s


SessionDep = Annotated[Session, Depends(get_session)]


@app.exception_handler(auth.AuthRefused)
async def _refused(_: Request, e: auth.AuthRefused) -> JSONResponse:
    detail: dict[str, Any] = {"error": e.error, "message": e.message}
    for k, v in e.detail.items():
        detail[k] = _ms(v) if isinstance(v, datetime) else v
    status = 429 if e.error in ("rate_limited", "locked") else 400
    return JSONResponse(detail, status_code=status)


@app.exception_handler(HTTPException)
async def _http_error(_: Request, e: HTTPException) -> JSONResponse:
    """Same flat `{error, message}` shape as a refusal, so the app reads one kind of error."""

    body = e.detail if isinstance(e.detail, dict) else {"error": "http_error", "message": str(e.detail)}
    return JSONResponse(body, status_code=e.status_code)


def _js_iso(d: datetime) -> str:
    """`2026-10-06T09:00:00.123Z` — exactly what the phone's `toISOString()` sent, so a replay's
    "now" is the same string on every phone."""

    d = auth.as_utc(d)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _ms(d: datetime) -> int:
    return int(auth.as_utc(d).timestamp() * 1000)


# ---------------------------------------------------------------- who is calling

@dataclass(frozen=True)
class Caller:
    member: Member
    token: str


def caller(s: SessionDep, authorization: Annotated[str | None, Header()] = None) -> Caller:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, {"error": "signed_out", "message": "Please sign in."})
    check = auth.authenticate(s, token, utcnow())
    s.commit()
    if check.status != "active" or check.member is None:
        raise HTTPException(401, {
            "error": "signed_out",
            "reason": check.reason.value if check.reason else check.status,
            "now_on": check.now_on,
            "message": "You were signed out." if check.reason is None
            else "You signed in on another phone." if check.reason.value == "replaced"
            else "You're no longer part of this home." if check.reason.value == "removed"
            else "You were signed out.",
        })
    return Caller(member=check.member, token=token)


CallerDep = Annotated[Caller, Depends(caller)]


def _account(m: Member) -> dict[str, Any]:
    return {
        "memberId": m.id, "householdId": m.household_id, "name": m.name, "relation": m.relation or "",
        "phone": m.phone, "role": m.role.value, "createdAt": m.created_at.isoformat(),
    }


# ---------------------------------------------------------------- sign in

_ip_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    """The address our own proxy saw. The left of X-Forwarded-For is whatever the client
    typed, so count in from the right: TRUSTED_PROXY_HOPS is how many proxies we run behind
    (1 = the last entry; raise it if a CDN sits in front and every caller shares its IP)."""

    fwd = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    hops = max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))
    if fwd:
        return fwd[-min(hops, len(fwd))]
    return request.client.host if request.client else "?"


def _ip_allowed(ip: str) -> bool:
    now, hits = time.monotonic(), _ip_hits[ip]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= AUTH_TRIES_PER_IP_PER_HOUR:
        return False
    hits.append(now)
    return True


def _limit(request: Request) -> None:
    if not _ip_allowed(_client_ip(request)):
        raise HTTPException(429, {"error": "rate_limited", "message": auth.MESSAGES["rate_limited"]})


class AccessRequest(BaseModel):
    phone: str = Field(max_length=20)
    name: str = Field(max_length=80)


@app.post("/auth/request")
def request_access(body: AccessRequest, s: SessionDep, request: Request) -> dict[str, Any]:
    """Name + number → the admin's list. Always the same answer for a well-typed request."""

    _limit(request)
    auth.request_access(s, phone=body.phone, name=body.name, now=utcnow())
    s.commit()
    return {}


class PasskeyIn(BaseModel):
    phone: str = Field(max_length=20)
    name: str = Field(max_length=80)
    passkey: str = Field(max_length=20)
    deviceLabel: str | None = Field(default=None, max_length=80)


@app.post("/auth/passkey")
def passkey_sign_in(body: PasskeyIn, s: SessionDep, request: Request) -> dict[str, Any]:
    _limit(request)
    try:
        r = auth.sign_in_with_passkey(s, phone=body.phone, name=body.name, passkey=body.passkey,
                                      now=utcnow(), device_label=body.deviceLabel)
    except auth.AuthRefused:
        s.commit()  # wrong tries are logged and count toward the lockout
        raise
    s.commit()
    return {"token": r.token, "created": r.created, "account": _account(r.member)}


@app.get("/me")
def me(c: CallerDep) -> dict[str, Any]:
    return {"account": _account(c.member)}


@app.post("/auth/sign-out")
def sign_out(c: CallerDep, s: SessionDep) -> dict[str, bool]:
    auth.sign_out(s, c.token, utcnow())
    s.commit()
    return {"ok": True}


@app.delete("/me")
def delete_me(c: CallerDep, s: SessionDep) -> dict[str, bool]:
    try:
        last = auth.delete_account(s, member_id=c.member.id, now=utcnow())
        if last:
            sync.forget_household(s, c.member.household_id)
    except auth.AuthRefused:
        s.commit()
        raise
    s.commit()
    return {"ok": True, "householdDeleted": last}


# ---------------------------------------------------------------- the home

@app.get("/household")
def household(c: CallerDep, s: SessionDep) -> dict[str, Any]:
    members = s.exec(select(Member).where(
        Member.household_id == c.member.household_id, col(Member.is_active).is_(True))).all()
    return {"members": [_account(m) for m in members]}


# ---------------------------------------------------------------- family sharing

class PushedEvent(BaseModel):
    id: str = Field(min_length=8, max_length=80)
    at: datetime
    body: dict[str, Any]


class Push(BaseModel):
    events: list[PushedEvent] = Field(max_length=sync.MAX_EVENTS_PER_PUSH)


def _stream(stream: str) -> str:
    if stream not in STREAMS:
        raise HTTPException(404, {"error": "unknown_stream"})
    return stream


@app.post("/sync/{stream}")
async def push(stream: str, c: CallerDep, s: SessionDep, request: Request) -> dict[str, Any]:
    _stream(stream)
    raw = await request.body()
    if len(raw) > MAX_PUSH_BYTES:
        raise HTTPException(413, {"error": "too_large"})
    body = Push.model_validate_json(raw)
    seqs = sync.append(s, household_id=c.member.household_id, member_id=c.member.id, stream=stream,
                       events=[sync.NewEvent(e.id, e.at, e.body) for e in body.events])
    s.commit()
    return {"accepted": [{"id": cid, "seq": seq} for cid, seq in seqs]}


@app.get("/sync/{stream}")
def pull(stream: str, c: CallerDep, s: SessionDep, after: int = 0) -> dict[str, Any]:
    _stream(stream)
    rows = sync.since(s, household_id=c.member.household_id, stream=stream, after=after)
    return {
        "events": [
            {"seq": r.seq, "id": r.client_id, "by": r.member_id, "at": _js_iso(r.at), "body": r.body}
            for r in rows
        ],
        "more": len(rows) == sync.PAGE,
    }


# ---------------------------------------------------------------- understanding (LLM)

UNDERSTAND_TIMEOUT_S = 20.0
UNDERSTAND_PER_MEMBER_PER_MIN = 20
_understand_hits: dict[str, deque[float]] = defaultdict(deque)


def _llm_configured() -> bool:
    """In production the LLM must be pointed at explicitly; locally the default Ollama is fine."""

    return bool(os.environ.get("OLLAMA_HOST")) or os.environ.get("APP_ENV", "").lower() != "production"


class UnderstandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@app.post("/understand")
async def understand(body: UnderstandRequest, c: CallerDep, request: Request) -> dict[str, Any]:
    unavailable = HTTPException(503, {"error": "llm_unavailable", "message": "Hearth can’t think right now."})
    if not _llm_configured():
        raise unavailable
    now, hits = time.monotonic(), _understand_hits[c.member.id]
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= UNDERSTAND_PER_MEMBER_PER_MIN:
        raise HTTPException(429, {"error": "rate_limited", "message": "Too many messages. Wait a moment."})
    hits.append(now)

    client = getattr(request.app.state, "llm", None) or client_from_env()
    try:
        extraction = await asyncio.wait_for(client.extract(body.text), UNDERSTAND_TIMEOUT_S)
    except Exception:  # unreachable, slow, or unusable output: the phone's rules answer instead
        log.warning("understand failed", exc_info=True)
        raise unavailable from None
    return {"extraction": extraction.model_dump(mode="json")}


# ---------------------------------------------------------------- public pages

_PRIVACY = Path(__file__).with_name("static") / "privacy.html"


@app.get("/privacy", response_class=HTMLResponse)
def privacy() -> str:
    return _PRIVACY.read_text()


@app.get("/healthz")
def healthz(s: SessionDep) -> dict[str, bool]:
    s.exec(select(1)).first()
    return {"ok": True}
