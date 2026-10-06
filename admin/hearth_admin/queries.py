"""Read-only views for the console's pages: families, one family, tasks, posts, audit log.

Phone numbers are masked to the last four digits; the console is for fixing app state, not for
contacting families.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, col, func, select

from app.auth.models import AuthEvent, AuthSession
from app.bills.models import BillAccount, BillPayment
from app.conversation.models import ConversationTurn
from app.core.models import Household, Member, MemberRole
from app.feed.models import Post, PostRecipient, PostStatus
from app.history.models import Purchase
from app.memory.rules import as_utc
from app.planner.models import GroceryList, GroceryListItem
from app.tasks.models import Task, TaskEvent, TaskStatus

from .analytics import OPEN_TASK, household_statuses
from .diagnostics import scan
from .models import AdminAction, HouseholdStatus


def iso(dt: datetime | None) -> str | None:
    return as_utc(dt).isoformat() if dt else None


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    return phone[:3] + "•" * max(len(phone) - 7, 0) + phone[-4:]


def _max(*dts: datetime | None) -> datetime | None:
    vals = [as_utc(d) for d in dts if d is not None]
    return max(vals) if vals else None


def _last_activity(s: Session, hid: str) -> datetime | None:
    member_ids = select(Member.id).where(Member.household_id == hid)
    return _max(
        s.exec(select(func.max(Post.created_at)).where(Post.household_id == hid)).one(),
        s.exec(select(func.max(ConversationTurn.created_at)).where(
            ConversationTurn.household_id == hid)).one(),
        s.exec(select(func.max(Purchase.purchased_at)).where(Purchase.household_id == hid)).one(),
        s.exec(select(func.max(Task.updated_at)).where(Task.household_id == hid)).one(),
        s.exec(select(func.max(AuthSession.last_seen_at)).where(
            col(AuthSession.member_id).in_(member_ids))).one(),
    )


def _status_json(st: Any) -> dict[str, Any]:
    if st is None:
        return {"status": HouseholdStatus.ACTIVE.value, "note": None, "updated_by": None,
                "updated_at": None}
    return {"status": st.status.value, "note": st.note, "updated_by": st.updated_by,
            "updated_at": iso(st.updated_at)}


def families(s: Session, now: datetime) -> list[dict[str, Any]]:
    statuses = household_statuses(s)
    members = s.exec(select(Member)).all()
    issues = scan(s, now)
    month_ago = now - timedelta(days=30)
    out = []
    for h in s.exec(select(Household)).all():
        mine = [m for m in members if m.household_id == h.id]
        owner = next((m for m in mine if m.role == MemberRole.OWNER and m.is_active), None)
        out.append({
            "id": h.id, "name": h.name, "created_at": iso(h.created_at),
            **_status_json(statuses.get(h.id)),
            "members": sum(m.is_active for m in mine),
            "members_removed": sum(not m.is_active for m in mine),
            "owner": owner.name if owner else None,
            "last_activity": iso(_last_activity(s, h.id)),
            "open_tasks": s.exec(select(func.count()).select_from(Task).where(
                Task.household_id == h.id, col(Task.status).in_(OPEN_TASK))).one(),
            "purchases_30d": s.exec(select(func.count()).select_from(Purchase).where(
                Purchase.household_id == h.id, Purchase.purchased_at >= month_ago)).one(),
            "issues": sum(i.household_id == h.id for i in issues),
            "issues_high": sum(i.household_id == h.id and i.severity == "high" for i in issues),
        })
    out.sort(key=lambda f: (-f["issues_high"], f["name"].lower()))
    return out


def member_json(s: Session, m: Member) -> dict[str, Any]:
    sess = s.exec(select(AuthSession).where(
        AuthSession.member_id == m.id, col(AuthSession.revoked_at).is_(None))).first()
    return {
        "id": m.id, "name": m.name, "role": m.role.value, "relation": m.relation,
        "phone": mask_phone(m.phone), "is_active": m.is_active, "created_at": iso(m.created_at),
        "session": {"device": sess.device_label, "since": iso(sess.created_at),
                    "last_seen": iso(sess.last_seen_at)} if sess else None,
    }


def task_json(t: Task, names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": t.id, "household_id": t.household_id, "title": t.title, "category": t.category,
        "status": t.status.value, "priority": t.priority.value,
        "assigned_to_member_id": t.assigned_to_member_id,
        "assigned_to": names.get(t.assigned_to_member_id or ""),
        "created_by": names.get(t.created_by_member_id), "due_at": iso(t.due_at),
        "done_at": iso(t.done_at), "post_id": t.post_id, "details": t.details,
        "created_at": iso(t.created_at), "updated_at": iso(t.updated_at),
    }


def post_json(s: Session, p: Post, names: dict[str, str]) -> dict[str, Any]:
    recs = s.exec(select(PostRecipient).where(PostRecipient.post_id == p.id)).all()
    return {
        "id": p.id, "household_id": p.household_id, "kind": p.kind, "status": p.status.value,
        "title": p.title, "raw_text": p.raw_text, "author": names.get(p.author_member_id),
        "missing": [m.get("field") for m in p.missing_fields_json or []],
        "published_at": iso(p.published_at), "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
        "recipients": [{
            "member": names.get(r.member_id, r.member_id), "delivered_at": iso(r.delivered_at),
            "seen_at": iso(r.seen_at), "acknowledged_at": iso(r.acknowledged_at),
        } for r in recs],
    }


def _names(s: Session) -> dict[str, str]:
    return {m.id: m.name for m in s.exec(select(Member)).all()}


def family_detail(s: Session, hid: str, now: datetime) -> dict[str, Any] | None:
    h = s.get(Household, hid)
    if h is None:
        return None
    names = _names(s)
    members = s.exec(select(Member).where(Member.household_id == hid)).all()
    lists = s.exec(select(GroceryList).where(GroceryList.household_id == hid)
                   .order_by(col(GroceryList.created_at).desc()).limit(5)).all()
    bills = s.exec(select(BillAccount).where(BillAccount.household_id == hid)).all()
    payments = s.exec(select(BillPayment).where(
        col(BillPayment.bill_account_id).in_([b.id for b in bills]))
        .order_by(col(BillPayment.due_date).desc())).all() if bills else []
    return {
        "id": h.id, "name": h.name, "currency": h.currency, "timezone": h.timezone,
        "monthly_grocery_budget": h.monthly_grocery_budget, "created_at": iso(h.created_at),
        **_status_json(household_statuses(s).get(hid)),
        "last_activity": iso(_last_activity(s, hid)),
        "members": [member_json(s, m) for m in members],
        "tasks": [task_json(t, names) for t in s.exec(
            select(Task).where(Task.household_id == hid)
            .order_by(col(Task.updated_at).desc()).limit(50)).all()],
        "posts": [post_json(s, p, names) for p in s.exec(
            select(Post).where(Post.household_id == hid)
            .order_by(col(Post.created_at).desc()).limit(30)).all()],
        "lists": [{
            "id": lst.id, "status": lst.status.value, "created_at": iso(lst.created_at),
            "items": [{
                "id": i.id, "product": i.product, "qty": i.qty, "unit": i.unit, "brand": i.brand,
                "category": i.category, "status": i.status.value,
                "needs_clarification": i.needs_clarification,
                "expected_total": i.expected_total,
            } for i in s.exec(select(GroceryListItem).where(GroceryListItem.list_id == lst.id)
                              .order_by(col(GroceryListItem.position))).all()],
        } for lst in lists],
        "bills": [{
            "id": b.id, "kind": b.kind, "provider": b.provider, "active": b.active,
            "assigned_to": names.get(b.assigned_to_member_id or ""),
            "payments": [{
                "id": p.id, "period": p.period, "due_date": p.due_date.isoformat(),
                "status": p.status.value, "amount_due": p.amount_due,
            } for p in payments if p.bill_account_id == b.id][:6],
        } for b in bills],
        "auth_events": [{
            "at": iso(e.at), "kind": e.kind.value, "member": names.get(e.member_id or ""),
            "detail": e.detail_json,
        } for e in s.exec(select(AuthEvent).where(AuthEvent.household_id == hid)
                          .order_by(col(AuthEvent.at).desc()).limit(30)).all()],
        "issues": [i.as_json() for i in scan(s, now, hid)],
    }


def tasks(
    s: Session, now: datetime, *, status: str | None = None, household_id: str | None = None,
    q: str | None = None, overdue: bool = False, limit: int = 300,
) -> list[dict[str, Any]]:
    query = select(Task)
    if status == "active":  # not finished: open, acknowledged or in progress
        query = query.where(col(Task.status).in_(OPEN_TASK))
    elif status:
        query = query.where(Task.status == TaskStatus(status))
    if household_id:
        query = query.where(Task.household_id == household_id)
    if q:
        query = query.where(col(Task.title).ilike(f"%{q}%"))
    rows = s.exec(query.order_by(col(Task.updated_at).desc()).limit(limit)).all()
    if overdue:
        rows = [t for t in rows if t.status in OPEN_TASK and t.due_at and as_utc(t.due_at) < now]
    names = _names(s)
    households = {h.id: h.name for h in s.exec(select(Household)).all()}
    return [{**task_json(t, names), "household": households.get(t.household_id)} for t in rows]


def task_events(s: Session, task_id: str) -> list[dict[str, Any]]:
    names = _names(s)
    return [{
        "at": iso(e.created_at), "member": names.get(e.member_id or ""),
        "from": e.from_status.value if e.from_status else None, "to": e.to_status.value,
        "note": e.note,
    } for e in s.exec(select(TaskEvent).where(TaskEvent.task_id == task_id)
                      .order_by(col(TaskEvent.created_at))).all()]


def posts(
    s: Session, *, status: str | None = None, kind: str | None = None,
    household_id: str | None = None, limit: int = 200,
) -> list[dict[str, Any]]:
    query = select(Post)
    if status:
        query = query.where(Post.status == PostStatus(status))
    if kind:
        query = query.where(Post.kind == kind)
    if household_id:
        query = query.where(Post.household_id == household_id)
    names = _names(s)
    households = {h.id: h.name for h in s.exec(select(Household)).all()}
    return [{**post_json(s, p, names), "household": households.get(p.household_id)}
            for p in s.exec(query.order_by(col(Post.created_at).desc()).limit(limit)).all()]


def audit(s: Session, household_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    query = select(AdminAction)
    if household_id:
        query = query.where(AdminAction.household_id == household_id)
    return [{
        "id": a.id, "at": iso(a.at), "admin": a.admin, "action": a.action,
        "target_kind": a.target_kind, "target_id": a.target_id, "household_id": a.household_id,
        "note": a.note, "detail": a.detail_json,
    } for a in s.exec(query.order_by(col(AdminAction.at).desc(), col(AdminAction.id).desc())
                      .limit(limit)).all()]
