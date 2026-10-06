"""Every write the console makes. Each one is checked, applied, and logged to `admin_action`
in the same transaction; the caller commits.

Admins repair state; they do not act as a family member. So: no publishing a post for someone,
no deleting family rows, and nothing that leaves a home without an active owner.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.auth.models import SessionEndReason
from app.auth.store import revoke_member_sessions
from app.core.models import Household, Member, MemberRole
from app.feed.models import Post, PostRecipient, PostStatus, Reminder
from app.feed.store import check as recheck
from app.tasks.models import Task, TaskEvent, TaskStatus

from . import diagnostics
from .models import AdminAction, AdminHouseholdStatus, HouseholdStatus
from .queries import iso


class Refused(Exception):
    """The action would be unsafe or makes no sense in the row's current state."""


class NotFound(Exception):
    pass


def _log(s: Session, admin: str, action: str, kind: str, target: str, household_id: str | None,
         now: datetime, note: str | None = None, **detail: Any) -> AdminAction:
    row = AdminAction(at=now, admin=admin, action=action, target_kind=kind, target_id=target,
                      household_id=household_id, note=note, detail_json=detail)
    s.add(row)
    return row


def _get(s: Session, model: Any, key: str) -> Any:
    row = s.get(model, key)
    if row is None:
        raise NotFound(f"{model.__tablename__} {key}")
    return row


def _need_note(note: str | None, what: str) -> str:
    if not (note or "").strip():
        raise Refused(f"say why ({what}) — it goes in the audit log")
    return note.strip()  # type: ignore[union-attr]


def _active_owners(s: Session, hid: str) -> list[Member]:
    return list(s.exec(select(Member).where(
        Member.household_id == hid, Member.role == MemberRole.OWNER,
        Member.is_active == True)).all())


# ------------------------------------------------------------------------------ households

def set_household_status(s: Session, admin: str, hid: str, status: str, note: str | None,
                         now: datetime) -> dict[str, Any]:
    _get(s, Household, hid)
    new = HouseholdStatus(status)
    if new != HouseholdStatus.ACTIVE:
        note = _need_note(note, f"setting {new.value}")
    row = s.get(AdminHouseholdStatus, hid)
    before = row.status.value if row else HouseholdStatus.ACTIVE.value
    if row is None:
        row = AdminHouseholdStatus(household_id=hid, updated_by=admin)
    row.status, row.note, row.updated_by, row.updated_at = new, note, admin, now
    s.add(row)
    _log(s, admin, "household_status", "household", hid, hid, now, note,
         before=before, after=new.value)
    return {"status": new.value}


# ------------------------------------------------------------------------------ members

def set_member_active(s: Session, admin: str, mid: str, active: bool, note: str | None,
                      now: datetime) -> dict[str, Any]:
    m = _get(s, Member, mid)
    if m.is_active == active:
        return {"is_active": active}
    revoked = 0
    if not active:
        note = _need_note(note, "removing a member")
        if m.role == MemberRole.OWNER and len(_active_owners(s, m.household_id)) <= 1:
            raise Refused(f"{m.name} is the only owner — make someone else owner first")
        revoked = revoke_member_sessions(s, mid, now, SessionEndReason.REMOVED)
    m.is_active = active
    s.add(m)
    _log(s, admin, "member_active", "member", mid, m.household_id, now, note,
         before=not active, after=active, sessions_revoked=revoked)
    return {"is_active": active, "sessions_revoked": revoked}


def set_member_role(s: Session, admin: str, mid: str, role: str, note: str | None,
                    now: datetime) -> dict[str, Any]:
    m = _get(s, Member, mid)
    new = MemberRole(role)
    if m.role == new:
        return {"role": new.value}
    if new == MemberRole.OWNER and not m.is_active:
        raise Refused(f"{m.name} was removed — restore them before making them owner")
    if m.role == MemberRole.OWNER and len(_active_owners(s, m.household_id)) <= 1 and m.is_active:
        raise Refused(f"{m.name} is the only owner — make someone else owner first")
    before = m.role.value
    m.role = new
    s.add(m)
    _log(s, admin, "member_role", "member", mid, m.household_id, now, note,
         before=before, after=new.value)
    return {"role": new.value}


def sign_out_member(s: Session, admin: str, mid: str, note: str | None,
                    now: datetime) -> dict[str, Any]:
    """Force a fresh sign-in — clears a phone stuck on stale state. Data is untouched."""

    m = _get(s, Member, mid)
    n = revoke_member_sessions(s, mid, now, SessionEndReason.SIGNED_OUT)
    if n == 0:
        raise Refused(f"{m.name} is not signed in anywhere")
    _log(s, admin, "revoke_sessions", "member", mid, m.household_id, now, note, revoked=n)
    return {"revoked": n}


# ------------------------------------------------------------------------------ tasks

def set_task_status(s: Session, admin: str, tid: str, status: str, note: str | None,
                    now: datetime) -> dict[str, Any]:
    t = _get(s, Task, tid)
    new = TaskStatus(status)
    if t.status == new:
        raise Refused(f"task is already {new.value}")
    before = t.status
    t.status, t.updated_at = new, now
    # Keep done_at consistent with status — the board/history split reads it.
    t.done_at = (t.done_at or now) if new == TaskStatus.DONE else None
    s.add(t)
    s.add(TaskEvent(id=f"te_{uuid.uuid4().hex[:12]}", task_id=tid, member_id=None,
                    from_status=before, to_status=new, note=f"[admin {admin}] {note or ''}".strip(),
                    created_at=now))
    _log(s, admin, "task_status", "task", tid, t.household_id, now, note,
         before=before.value, after=new.value)
    return {"status": new.value, "done_at": iso(t.done_at)}


def assign_task(s: Session, admin: str, tid: str, member_id: str, note: str | None,
                now: datetime) -> dict[str, Any]:
    t = _get(s, Task, tid)
    m = _get(s, Member, member_id)
    if m.household_id != t.household_id:
        raise Refused(f"{m.name} is not in this task's home")
    if not m.is_active:
        raise Refused(f"{m.name} was removed from the home")
    before = t.assigned_to_member_id
    t.assigned_to_member_id, t.updated_at = member_id, now
    s.add(t)
    s.add(TaskEvent(id=f"te_{uuid.uuid4().hex[:12]}", task_id=tid, member_id=None,
                    from_status=t.status, to_status=t.status,
                    note=f"[admin {admin}] reassigned to {m.name}. {note or ''}".strip(),
                    created_at=now))
    _log(s, admin, "task_assign", "task", tid, t.household_id, now, note,
         before=before, after=member_id)
    return {"assigned_to_member_id": member_id}


# ------------------------------------------------------------------------------ posts

def resend_post(s: Session, admin: str, pid: str, note: str | None, now: datetime) -> dict[str, Any]:
    """Show a published post's pop-up again to everyone who hasn't acknowledged it."""

    p = _get(s, Post, pid)
    if p.status != PostStatus.PUBLISHED:
        raise Refused(f"only published posts can be resent (this one is {p.status.value})")
    recs = {r.member_id: r for r in s.exec(select(PostRecipient).where(PostRecipient.post_id == pid)).all()}
    added, reset = [], []
    for m in s.exec(select(Member).where(Member.household_id == p.household_id,
                                         Member.is_active == True)).all():
        if m.id == p.author_member_id:
            continue
        r = recs.get(m.id)
        if r is None:
            s.add(PostRecipient(post_id=pid, member_id=m.id))
            added.append(m.id)
        elif r.acknowledged_at is None:
            r.delivered_at = r.seen_at = None
            s.add(r)
            reset.append(m.id)
    _log(s, admin, "post_resend", "post", pid, p.household_id, now, note, added=added, reset=reset)
    return {"added": added, "reset": reset}


def recheck_post(s: Session, admin: str, pid: str, note: str | None, now: datetime) -> dict[str, Any]:
    p = _get(s, Post, pid)
    if p.status not in diagnostics.OPEN_POST:
        raise Refused(f"only unsent posts are re-checked (this one is {p.status.value})")
    before = p.status.value
    missing = recheck(s, p, now)
    _log(s, admin, "post_recheck", "post", pid, p.household_id, now, note,
         before=before, after=p.status.value, missing=[m.field for m in missing])
    return {"status": p.status.value, "missing": [m.field for m in missing]}


def cancel_post(s: Session, admin: str, pid: str, note: str | None, now: datetime) -> dict[str, Any]:
    """Take a broken or duplicate post off everyone's feed. The row stays for audit."""

    p = _get(s, Post, pid)
    note = _need_note(note, "cancelling a family's post")
    if p.status == PostStatus.CANCELLED:
        raise Refused("post is already cancelled")
    before = p.status.value
    p.status, p.updated_at = PostStatus.CANCELLED, now
    s.add(p)
    stopped = []
    for r in s.exec(select(Reminder).where(Reminder.post_id == pid, Reminder.active == True)).all():
        r.active = False
        s.add(r)
        stopped.append(r.id)
    _log(s, admin, "post_cancel", "post", pid, p.household_id, now, note,
         before=before, reminders_stopped=stopped)
    return {"status": "cancelled", "reminders_stopped": stopped}


# ------------------------------------------------------------------------------ issues

def apply_fix(s: Session, admin: str, check: str, ref: str, now: datetime) -> dict[str, Any]:
    issue = next((i for i in diagnostics.BY_NAME[check].detect(s, now) if i.ref == ref), None) \
        if check in diagnostics.BY_NAME else None
    try:
        result = diagnostics.fix(s, check, ref, now)
    except KeyError:
        raise Refused(f"{check} has no automatic fix") from None
    except LookupError as e:
        raise Refused(str(e)) from None
    _log(s, admin, f"fix:{check}", issue.ref_kind if issue else "row", ref,
         issue.household_id if issue else None, now, None, **result)
    return result
