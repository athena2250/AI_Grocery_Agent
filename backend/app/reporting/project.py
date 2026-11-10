"""Replay the actual mobile reducers, then materialize admin-readable rows.

The caller holds the household row lock and commits events + projection together.
A failed replay rolls the transaction back. Node runs only our generated code, never user code.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlmodel import Session, col, delete, select

from app.core.models import Household, Member, Product
from app.history.models import Purchase, PurchaseSource
from app.memory.rules import as_utc
from app.planner.models import GroceryList, GroceryListItem, ItemStatus, ListStatus
from app.reporting.models import ReportState
from app.sync.models import SyncEvent
from app.tasks.models import Task, TaskStatus

REPLAY = Path(__file__).with_name("replay.cjs")


def date(value):
    return as_utc(datetime.fromisoformat(value)) if value else None


def row_id(hid, kind, ident):
    # Namespace local ids: two families may import the same sandbox seed ids.
    return f"sync:{hid}:{kind}:{ident}"


def catch_up(s: Session, hid: str, stream: str, *, refresh: bool = False) -> None:
    if stream not in ("grocery", "tasks", "profile"):
        return
    report = s.get(ReportState, (hid, stream))
    events = s.exec(select(SyncEvent).where(
        SyncEvent.household_id == hid, SyncEvent.stream == stream,
        col(SyncEvent.seq) > (report.last_seq if report else 0)
    ).order_by(col(SyncEvent.seq))).all()
    if not events:
        if not refresh or report is None:
            return
        events = s.exec(select(SyncEvent).where(SyncEvent.seq == report.last_seq)).all()
    payload = {"stream": stream, "state": report.state if report else None, "events": [
        {"id": e.client_id, "at": as_utc(e.at).isoformat(), "body": e.body} for e in events
        if not report or e.seq > report.last_seq
    ]}
    result = subprocess.run(["node", str(REPLAY)], input=json.dumps(payload), text=True,
                            capture_output=True, timeout=20, check=True)
    state = json.loads(result.stdout)
    if report is None:
        report = ReportState(household_id=hid, stream=stream)
    if stream == "profile":
        report.state, report.last_seq = state, events[-1].seq
        s.add(report)
        s.flush()
        for other in ("grocery", "tasks"):
            catch_up(s, hid, other, refresh=True)
        return
    people = s.exec(select(Member).where(Member.household_id == hid)).all()
    members = {m.id for m in people}
    profile = s.get(ReportState, (hid, "profile"))
    phones = {m.phone: m.id for m in people if m.phone}
    aliases = {m["id"]: phones[m["phone"]] for m in profile.state.get("members", [])
               if m.get("phone") in phones} if profile else {}
    actor = next((e.member_id for e in events if e.member_id in members), None)
    if actor is None and members:
        actor = min(members)
    def member(ident):
        return ident if ident in members else aliases.get(ident)
    def product(pid, name, category="Other", unit="pcs"):
        if s.get(Product, pid) is None:
            s.add(Product(id=pid, name=name, category=category, default_unit=unit or "pcs"))
            s.flush()
    current = []
    if stream == "grocery":
        for p in state.get("products", []):
            product(p["id"], p["name"], p["category"], p.get("defaultUnit"))
        for p in state.get("history", []):
            product(p["productId"], p["product"])
            ident = row_id(hid, "purchase", p["id"])
            current.append(ident)
            s.merge(Purchase(id=ident, household_id=hid, product_id=p["productId"],
                product=p["product"], member_id=member(p.get("memberId")), qty=p.get("qty"),
                unit=p.get("unit"), brand=p.get("brand"), price=p.get("price"),
                purchased_at=date(p["purchasedAt"]), source=PurchaseSource.MANUAL))
        stale = set(report.row_ids) - set(current)
        if stale:
            s.exec(delete(Purchase).where(col(Purchase.id).in_(stale)))
        lid = row_id(hid, "list", "current")
        lst = s.get(GroceryList, lid) or GroceryList(id=lid, household_id=hid,
            created_by_member_id=actor, created_at=events[0].at)
        lst.status = ListStatus(state.get("list", {}).get("status", "draft"))
        s.add(lst)
        s.flush()
        s.exec(delete(GroceryListItem).where(GroceryListItem.list_id == lid))
        for pos, item in enumerate(state.get("listItems", [])):
            product(item["productId"], item["product"], item["category"])
            s.add(GroceryListItem(id=row_id(hid, "item", item["id"]), list_id=lid,
                product_id=item["productId"], product=item["product"], category=item["category"],
                qty=item.get("qty"), unit=item.get("unit"), brand=item.get("brand"),
                variant=item.get("variant"), status=ItemStatus(item["status"]),
                source=item.get("source", "user"), confidence=item.get("confidence", "high"),
                rationale=item.get("rationale", ""), position=pos,
                added_by_member_id=member(item.get("addedByMemberId")), created_at=events[0].at))
    else:
        home = s.get(Household, hid)
        tz = ZoneInfo(home.timezone)
        for t in state.get("tasks", []) + state.get("archive", []):
            ident = row_id(hid, "task", t["id"])
            current.append(ident)
            due = t.get("due")
            due_at = None
            if due:
                parsed = datetime.fromisoformat(due)
                if "T" not in due:
                    parsed = datetime.combine(parsed.date(), time.max)
                due_at = parsed.replace(tzinfo=tz).astimezone(ZoneInfo("UTC"))
            old = s.get(Task, ident)
            status = TaskStatus.DONE if t.get("done") else TaskStatus.OPEN
            # Preserve richer admin workflow statuses until the phone changes done/open.
            if old and not t.get("done") and old.status in (
                TaskStatus.ACKNOWLEDGED, TaskStatus.IN_PROGRESS
            ):
                status = old.status
            task = Task(id=ident, household_id=hid,
                created_by_member_id=member(t.get("createdBy")) or actor,
                assigned_to_member_id=member(t.get("whoId")), category=t.get("section", "Other"),
                title=t["title"], details=t.get("notes"), details_json={**t.get("details", {}),
                    "sync_id": t["id"], "sync_assignee": t.get("whoId"), "sync_task": t},
                status=status, due_at=due_at, done_at=date(t.get("doneAt")),
                created_at=date(t["createdAt"]), updated_at=events[-1].at)
            s.merge(task)
        stale = set(report.row_ids) - set(current)
        if stale:
            for removed in s.exec(select(Task).where(col(Task.id).in_(stale))):
                removed.status, removed.done_at, removed.updated_at = TaskStatus.CANCELLED, None, events[-1].at
                s.add(removed)
            # Retain reporting rows for audit/history, including tasks removed on a phone.
            current.extend(stale)
    report.state, report.last_seq, report.row_ids = state, events[-1].seq, current
    s.add(report)
    s.flush()


def backfill(s: Session) -> None:
    for hid in s.exec(select(Household.id)):
        s.exec(select(Household).where(Household.id == hid).with_for_update()).one()
        for stream in ("profile", "grocery", "tasks"):
            catch_up(s, hid, stream)


def profile_member_id(s: Session, hid: str, server_id: str) -> str:
    person = s.get(Member, server_id)
    profile = s.get(ReportState, (hid, "profile"))
    if person and person.phone and profile:
        return next((m["id"] for m in profile.state.get("members", [])
                     if m.get("phone") == person.phone), server_id)
    return server_id
