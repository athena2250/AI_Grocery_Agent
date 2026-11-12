"""Hearth admin console — a separate service from the family app.

    cd admin && ADMIN_TOKEN=… ../backend/.venv/bin/uvicorn hearth_admin.main:app --port 8100

`/` serves the console (static files, no data). Everything under `/api` needs the admin token.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session

from app.core.sqltypes import utcnow

from . import actions, analytics, diagnostics, passkeys, queries
from .auth import operator_tokens, require_admin
from .db import get_session

STATIC = Path(__file__).with_name("static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get("APP_ENV", "").lower() == "production":
        from app.main import validate_production_config
        validate_production_config()
        if not operator_tokens():
            raise RuntimeError("Production admin requires ADMIN_TOKENS")
    yield


app = FastAPI(title="Hearth Admin", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.middleware("http")
async def _always_fresh(request: Request, call_next):  # type: ignore[no-untyped-def]
    """The console's own files are tiny: make the browser check for a newer copy every time, so a
    restarted console never runs yesterday's page."""

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response
api = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])


class Note(BaseModel):
    note: str | None = None


class StatusIn(Note):
    status: str


class ActiveIn(Note):
    is_active: bool


class RoleIn(Note):
    role: str


class AssignIn(Note):
    member_id: str


class ApproveIn(BaseModel):
    household_id: str | None = None
    """Empty = a new home, with them as its owner."""
    relation: str | None = None
    role: str = "member"


class FixIn(BaseModel):
    check: str
    refs: list[str]


def _write(s: Session, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        out = fn()
    except actions.NotFound as e:
        s.rollback()
        raise HTTPException(404, str(e)) from None
    except (actions.Refused, ValueError) as e:
        s.rollback()
        raise HTTPException(409, str(e)) from None
    s.commit()
    return out


# ------------------------------------------------------------------------------ reads

@api.get("/me")
def me(admin: str = Depends(require_admin)) -> dict[str, str]:
    return {"admin": admin}


@api.get("/overview")
def overview(s: Session = Depends(get_session)) -> dict[str, Any]:
    now = utcnow()
    issues = diagnostics.scan(s, now)
    return {
        **analytics.overview(s, now),
        "issues": {sev: sum(i.severity == sev for i in issues) for sev in ("high", "medium", "low")},
        "monthly": analytics.monthly_purchases(s, now, 12),
        "top_items": analytics.top_items(s, now, 90, limit=8),
    }


@api.get("/purchases/monthly")
def purchases_monthly(months: int = Query(12, ge=1, le=36), household_id: str | None = None,
                      s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return analytics.monthly_purchases(s, utcnow(), months, household_id)


@api.get("/purchases/month/{month}")
def purchases_month(month: str, household_id: str | None = None,
                    s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    try:
        analytics.month_start(month)
    except ValueError:
        raise HTTPException(422, "month must be YYYY-MM") from None
    return analytics.month_detail(s, month, household_id)


@api.get("/purchases/top")
def purchases_top(days: int = Query(90, ge=1, le=730), household_id: str | None = None,
                  limit: int = Query(25, ge=1, le=200),
                  s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return analytics.top_items(s, utcnow(), days, household_id, limit)


@api.get("/families")
def families(s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return queries.families(s, utcnow())


@api.get("/families/{hid}")
def family(hid: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=300),
           s: Session = Depends(get_session)) -> dict[str, Any]:
    out = queries.family_detail(s, hid, utcnow(), offset=offset, limit=limit)
    if out is None:
        raise HTTPException(404, f"household {hid}")
    return out


@api.get("/tasks")
def tasks(status: str | None = None, household_id: str | None = None, q: str | None = None,
          overdue: bool = False, offset: int = Query(0, ge=0),
          limit: int = Query(50, ge=1, le=300), category: str | None = None,
          s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    try:
        return queries.tasks(s, utcnow(), status=status, household_id=household_id, q=q,
                             overdue=overdue, offset=offset, limit=limit, category=category)
    except ValueError:
        raise HTTPException(422, f"unknown status {status}") from None


@api.get("/tasks/{tid}/events")
def task_events(tid: str, s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return queries.task_events(s, tid)


@api.get("/posts")
def posts(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=300), status: str | None = None,
          kind: str | None = None, household_id: str | None = None, s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    try:
        return queries.posts(s, status=status, kind=kind, household_id=household_id, offset=offset, limit=limit)
    except ValueError:
        raise HTTPException(422, f"unknown status {status}") from None


@api.get("/issues")
def issues(household_id: str | None = None, s: Session = Depends(get_session)) -> dict[str, Any]:
    return {
        "checks": [{"name": c.name, "severity": c.severity, "summary": c.summary,
                    "fix_label": c.fix_label if c.fix else None} for c in diagnostics.CHECKS],
        "issues": [i.as_json() for i in diagnostics.scan(s, utcnow(), household_id)],
    }


@api.get("/passkeys")
def passkey_overview(s: Session = Depends(get_session)) -> dict[str, Any]:
    return passkeys.overview(s)


@api.get("/passkeys/waiting")
def passkeys_waiting(s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    """Polled by every page for the "is trying to sign in" prompt — kept small."""

    return [{"id": r["id"], "name": r["name"], "phone": r["phone"], "last_at": r["last_at"]}
            for r in passkeys.overview(s)["requests"]]


@api.get("/audit")
def audit(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=300), household_id: str | None = None,
          s: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return queries.audit(s, household_id, offset=offset, limit=limit)


# ------------------------------------------------------------------------------ writes

@api.post("/families/{hid}/status")
def family_status(hid: str, body: StatusIn, admin: str = Depends(require_admin),
                  s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.set_household_status(s, admin, hid, body.status, body.note, utcnow()))


@api.post("/members/{mid}/active")
def member_active(mid: str, body: ActiveIn, admin: str = Depends(require_admin),
                  s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.set_member_active(s, admin, mid, body.is_active, body.note, utcnow()))


@api.post("/members/{mid}/role")
def member_role(mid: str, body: RoleIn, admin: str = Depends(require_admin),
                s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.set_member_role(s, admin, mid, body.role, body.note, utcnow()))


@api.post("/members/{mid}/sign-out")
def member_sign_out(mid: str, body: Note, admin: str = Depends(require_admin),
                    s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.sign_out_member(s, admin, mid, body.note, utcnow()))


@api.post("/tasks/{tid}/status")
def task_status(tid: str, body: StatusIn, admin: str = Depends(require_admin),
                s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.set_task_status(s, admin, tid, body.status, body.note, utcnow()))


@api.post("/tasks/{tid}/assign")
def task_assign(tid: str, body: AssignIn, admin: str = Depends(require_admin),
                s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: actions.assign_task(s, admin, tid, body.member_id, body.note, utcnow()))


@api.post("/posts/{pid}/{op}")
def post_action(pid: str, op: str, body: Note, admin: str = Depends(require_admin),
                s: Session = Depends(get_session)) -> dict[str, Any]:
    fn = {"resend": actions.resend_post, "recheck": actions.recheck_post,
          "cancel": actions.cancel_post}.get(op)
    if fn is None:
        raise HTTPException(404, f"unknown post action {op}")
    return _write(s, lambda: fn(s, admin, pid, body.note, utcnow()))


@api.post("/passkeys/requests/{rid}/approve")
def passkey_approve(rid: str, body: ApproveIn, admin: str = Depends(require_admin),
                    s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: passkeys.approve(s, admin, rid, body.household_id, body.relation, body.role, utcnow()))


@api.post("/passkeys/requests/{rid}/dismiss")
def passkey_dismiss(rid: str, admin: str = Depends(require_admin),
                    s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: passkeys.dismiss(s, admin, rid, utcnow()))


@api.post("/members/{mid}/passkey")
def member_passkey(mid: str, admin: str = Depends(require_admin),
                   s: Session = Depends(get_session)) -> dict[str, Any]:
    return _write(s, lambda: passkeys.issue(s, admin, mid, utcnow()))


@api.post("/issues/fix")
def issues_fix(body: FixIn, admin: str = Depends(require_admin),
               s: Session = Depends(get_session)) -> dict[str, Any]:
    """Fix each ref in its own savepoint, so one row that's no longer broken doesn't block the rest."""

    now = utcnow()
    done, skipped = [], []
    for ref in body.refs:
        try:
            with s.begin_nested():
                actions.apply_fix(s, admin, body.check, ref, now)
            done.append(ref)
        except actions.Refused as e:
            skipped.append({"ref": ref, "why": str(e)})
    s.commit()
    return {"fixed": done, "skipped": skipped}


app.include_router(api)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def index() -> HTMLResponse:
    """The page, with each file's address carrying its version, so a browser holding an old copy
    has to fetch the new one."""

    html = (STATIC / "index.html").read_text()
    for name in ("app.js", "styles.css"):
        version = int((STATIC / name).stat().st_mtime)
        html = html.replace(f"/static/{name}", f"/static/{name}?v={version}")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})
