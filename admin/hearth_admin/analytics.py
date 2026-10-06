"""Read-only numbers for the console: monthly purchases, frequently bought items, overview tiles.

Spend only adds lines that carry a price; every figure says how many lines were priced, so an
unpriced purchase never turns into an invented amount. Aggregation is in Python so the same code
runs on Postgres and the SQLite tests; move it to SQL `date_trunc` once volume needs it.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, col, func, select

from app.auth.models import AuthSession
from app.core.models import Household, Member, Product
from app.history.models import Purchase
from app.memory.rules import as_utc
from app.tasks.models import Task, TaskStatus

from .models import AdminHouseholdStatus, HouseholdStatus

OPEN_TASK = (TaskStatus.OPEN, TaskStatus.ACKNOWLEDGED, TaskStatus.IN_PROGRESS)


def month_key(dt: datetime) -> str:
    return as_utc(dt).strftime("%Y-%m")


def month_start(key: str) -> datetime:
    y, m = (int(p) for p in key.split("-"))
    return datetime(y, m, 1, tzinfo=UTC)


def next_month(key: str) -> str:
    y, m = (int(p) for p in key.split("-"))
    return f"{y + m // 12}-{m % 12 + 1:02d}"


def last_months(now: datetime, n: int) -> list[str]:
    keys = [month_key(now)]
    for _ in range(n - 1):
        y, m = (int(p) for p in keys[-1].split("-"))
        keys.append(f"{y - (m == 1)}-{(m - 2) % 12 + 1:02d}")
    return keys[::-1]


def _purchases(s: Session, since: datetime, until: datetime | None, household_id: str | None):
    q = select(Purchase).where(Purchase.purchased_at >= since)
    if until is not None:
        q = q.where(Purchase.purchased_at < until)
    if household_id:
        q = q.where(Purchase.household_id == household_id)
    return s.exec(q).all()


def monthly_purchases(
    s: Session, now: datetime, months: int = 12, household_id: str | None = None
) -> list[dict[str, Any]]:
    keys = last_months(now, months)
    rows = {k: {"month": k, "purchases": 0, "priced": 0, "spend": 0.0, "households": set()}
            for k in keys}
    for p in _purchases(s, month_start(keys[0]), None, household_id):
        r = rows.get(month_key(p.purchased_at))
        if r is None:
            continue
        r["purchases"] += 1
        r["households"].add(p.household_id)
        if p.price is not None:
            r["priced"] += 1
            r["spend"] += p.price
    return [{**r, "spend": round(r["spend"], 2), "households": len(r["households"])}
            for r in rows.values()]


def month_detail(s: Session, month: str, household_id: str | None = None) -> list[dict[str, Any]]:
    start = month_start(month)
    rows = _purchases(s, start, month_start(next_month(month)), household_id)
    names = {h.id: h.name for h in s.exec(select(Household)).all()}
    members = {m.id: m.name for m in s.exec(select(Member)).all()}
    return [
        {
            "id": p.id, "purchased_at": as_utc(p.purchased_at).isoformat(),
            "household_id": p.household_id, "household": names.get(p.household_id),
            "product_id": p.product_id, "product": p.product, "qty": p.qty, "unit": p.unit,
            "brand": p.brand, "price": p.price, "store": p.store, "source": p.source.value,
            "member": members.get(p.member_id or ""),
        }
        for p in sorted(rows, key=lambda p: as_utc(p.purchased_at), reverse=True)
    ]


def top_items(
    s: Session, now: datetime, days: int = 90, household_id: str | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """Most often bought products. Quantity is only summed when every line used the same unit."""

    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "times": 0, "households": set(), "qty": 0.0, "units": set(), "spend": 0.0, "priced": 0,
        "last": None, "name": None,
    })
    for p in _purchases(s, now - timedelta(days=days), None, household_id):
        a = agg[p.product_id]
        a["name"] = a["name"] or p.product
        a["times"] += 1
        a["households"].add(p.household_id)
        if p.qty is not None:
            a["qty"] += p.qty
            a["units"].add(p.unit or "")
        if p.price is not None:
            a["spend"] += p.price
            a["priced"] += 1
        at = as_utc(p.purchased_at)
        a["last"] = max(a["last"] or at, at)
    products = {p.id: p for p in s.exec(select(Product).where(col(Product.id).in_(list(agg)))).all()}
    out = []
    for pid, a in agg.items():
        prod = products.get(pid)
        single_unit = len(a["units"]) == 1
        out.append({
            "product_id": pid,
            "product": prod.name if prod else a["name"],
            "category": prod.category if prod else None,
            "times": a["times"],
            "households": len(a["households"]),
            "qty": round(a["qty"], 2) if single_unit else None,
            "unit": next(iter(a["units"])) if single_unit else ("mixed" if a["units"] else None),
            "spend": round(a["spend"], 2),
            "priced": a["priced"],
            "last_bought": a["last"].isoformat() if a["last"] else None,
        })
    out.sort(key=lambda r: (-r["times"], -r["spend"], r["product"]))
    return out[:limit]


def household_statuses(s: Session) -> dict[str, AdminHouseholdStatus]:
    return {r.household_id: r for r in s.exec(select(AdminHouseholdStatus)).all()}


def overview(s: Session, now: datetime) -> dict[str, Any]:
    statuses = household_statuses(s)
    households = s.exec(select(Household.id)).all()
    by_status = {st.value: 0 for st in HouseholdStatus}
    for hid in households:
        st = statuses.get(hid)
        by_status[(st.status if st else HouseholdStatus.ACTIVE).value] += 1

    this_m, last_m = last_months(now, 2)[::-1]
    months = {r["month"]: r for r in monthly_purchases(s, now, 2)}
    tasks = s.exec(select(Task).where(col(Task.status).in_(OPEN_TASK))).all()
    overdue = [t for t in tasks if t.due_at is not None and as_utc(t.due_at) < now]
    seen_since = now - timedelta(days=30)
    return {
        "households": len(households),
        "households_by_status": by_status,
        "members_active": s.exec(
            select(func.count()).select_from(Member).where(Member.is_active == True)
        ).one(),
        "signed_in_30d": s.exec(
            select(func.count()).select_from(AuthSession).where(
                col(AuthSession.revoked_at).is_(None), AuthSession.last_seen_at >= seen_since)
        ).one(),
        "this_month": months[this_m],
        "last_month": months[last_m],
        "open_tasks": len(tasks),
        "overdue_tasks": len(overdue),
    }
