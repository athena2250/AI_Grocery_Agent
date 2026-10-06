"""Issue scanner: data states that make something invisible or stuck in the family app.

Each check finds rows in a known-bad state and, where the right repair is unambiguous, offers a
fix. Fixes only put data back into a state the app already understands — they never publish a
post for someone, invent a field, or delete a family's rows (principles 2 and 3). Where the
repair needs a choice (who to reassign a task to, who becomes owner) the issue has no fix and
the console links to the control that makes that choice.

Add a check: write `_detect_<name>` returning `Issue`s, optionally `_fix_<name>(s, ref, now)`,
and list it in `CHECKS`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.auth.models import AuthSession, SessionEndReason
from app.auth.store import revoke_member_sessions
from app.bills.models import BillAccount, BillPayment, BillStatus
from app.conversation.models import ClarificationStatus, PendingClarification
from app.core.models import Device, Member, MemberRole, Product
from app.feed.completeness import missing_fields
from app.feed.models import Post, PostRecipient, PostStatus, Reminder
from app.feed.store import check as recheck_post
from app.feed.store import requirements_for
from app.memory.rules import as_utc
from app.planner.models import GroceryList, GroceryListItem, ItemStatus
from app.planner.rules import CATEGORY_ORDER
from app.tasks.models import Task, TaskStatus

CATEGORIES = {c.value for c in CATEGORY_ORDER}
OPEN_POST = (PostStatus.DRAFT, PostStatus.CLARIFYING, PostStatus.READY)
OPEN_TASK = (TaskStatus.OPEN, TaskStatus.ACKNOWLEDGED, TaskStatus.IN_PROGRESS)

STUCK_POST_AFTER = timedelta(hours=48)
UNDELIVERED_AFTER = timedelta(hours=1)
STALE_QUESTION_AFTER = timedelta(days=7)
REMINDER_LATE_AFTER = timedelta(minutes=15)


@dataclass(frozen=True)
class Issue:
    check: str
    severity: str
    """high = something is hidden or wrong right now; medium = stuck; low = housekeeping."""
    household_id: str | None
    ref: str
    """Row the issue is about (and what its fix receives)."""
    ref_kind: str
    title: str
    detail: str
    fix_label: str | None = None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Check:
    name: str
    severity: str
    summary: str
    detect: Callable[[Session, datetime], list[Issue]]
    fix: Callable[[Session, str, datetime], dict[str, Any]] | None = None
    fix_label: str | None = None


def _members(s: Session) -> dict[str, Member]:
    return {m.id: m for m in s.exec(select(Member)).all()}


# ------------------------------------------------------------------------------------ feed

def _detect_post_missing_recipients(s: Session, now: datetime) -> list[Issue]:
    members = _members(s)
    out = []
    for post in s.exec(select(Post).where(Post.status == PostStatus.PUBLISHED)).all():
        have = set(s.exec(select(PostRecipient.member_id).where(PostRecipient.post_id == post.id)).all())
        missing = [m for m in members.values()
                   if m.household_id == post.household_id and m.is_active
                   and m.id != post.author_member_id and m.id not in have]
        if missing:
            out.append(Issue(
                "post_missing_recipients", "high", post.household_id, post.id, "post",
                f"“{post.title or post.raw_text[:40]}” never reached {', '.join(m.name for m in missing)}",
                "Published, but these members have no recipient row, so the pop-up and feed entry "
                "never appear on their phone.",
            ))
    return out


def _fix_post_missing_recipients(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    post = s.get(Post, ref)
    if post is None:
        return {"added": []}
    have = set(s.exec(select(PostRecipient.member_id).where(PostRecipient.post_id == ref)).all())
    added = []
    for m in s.exec(select(Member).where(Member.household_id == post.household_id,
                                         Member.is_active == True)).all():
        if m.id != post.author_member_id and m.id not in have:
            s.add(PostRecipient(post_id=ref, member_id=m.id))
            added.append(m.id)
    return {"added": added}


def _detect_post_published_incomplete(s: Session, now: datetime) -> list[Issue]:
    out = []
    for post in s.exec(select(Post).where(Post.status == PostStatus.PUBLISHED)).all():
        missing = missing_fields(post.fields_json or {}, requirements_for(s, post.kind))
        if missing:
            out.append(Issue(
                "post_published_incomplete", "high", post.household_id, post.id, "post",
                f"Published {post.kind} post is missing {', '.join(m.field for m in missing)}",
                "publish() refuses incomplete posts, so this was written around it (or the kind's "
                "required fields changed afterwards). Members may see blanks. Ask the author.",
            ))
    return out


def _detect_post_stuck_open(s: Session, now: datetime) -> list[Issue]:
    out = []
    for post in s.exec(select(Post).where(col(Post.status).in_(OPEN_POST))).all():
        if now - as_utc(post.updated_at) > STUCK_POST_AFTER:
            missing = [m.get("field") for m in post.missing_fields_json or []]
            out.append(Issue(
                "post_stuck_open", "medium", post.household_id, post.id, "post",
                f"Post stuck in {post.status.value} since {as_utc(post.updated_at):%d %b}",
                f"Never sent to the family. Missing: {', '.join(map(str, missing)) or 'nothing'}. "
                "Re-check moves it to ready/clarifying from its current fields; it is never sent "
                "for the author.",
                "Re-check",
            ))
    return out


def _fix_post_stuck_open(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    post = s.get(Post, ref)
    if post is None or post.status not in OPEN_POST:
        return {}
    before = post.status.value
    missing = recheck_post(s, post, now)
    return {"before": before, "after": post.status.value, "missing": [m.field for m in missing]}


def _detect_recipient_undelivered(s: Session, now: datetime) -> list[Issue]:
    members = _members(s)
    with_phone = set(s.exec(select(Device.member_id)).all()) | set(s.exec(
        select(AuthSession.member_id).where(col(AuthSession.revoked_at).is_(None))).all())
    out = []
    rows = s.exec(
        select(PostRecipient, Post).join(Post, Post.id == PostRecipient.post_id).where(
            Post.status == PostStatus.PUBLISHED, col(PostRecipient.delivered_at).is_(None))
    ).all()
    for rec, post in rows:
        if post.published_at is None or now - as_utc(post.published_at) < UNDELIVERED_AFTER:
            continue
        m = members.get(rec.member_id)
        why = ("they have no signed-in phone" if rec.member_id not in with_phone
               else "push delivery failed or the app has not synced")
        out.append(Issue(
            "recipient_undelivered", "medium", post.household_id, f"{post.id}:{rec.member_id}",
            "post_recipient",
            f"{m.name if m else rec.member_id} hasn't received “{post.title or post.raw_text[:40]}”",
            f"Published {as_utc(post.published_at):%d %b %H:%M} UTC, still undelivered — {why}.",
        ))
    return out


def _detect_clarification_stale(s: Session, now: datetime) -> list[Issue]:
    out = []
    for c in s.exec(select(PendingClarification).where(
            PendingClarification.status == ClarificationStatus.OPEN)).all():
        if now - as_utc(c.created_at) > STALE_QUESTION_AFTER:
            out.append(Issue(
                "clarification_stale", "low", c.household_id, c.id, "pending_clarification",
                f"Unanswered question for {as_utc(c.created_at):%d %b}: “{c.question}”",
                "Expiring closes the chip prompt; the item or post keeps its other fields.",
                "Expire",
            ))
    return out


def _fix_clarification_stale(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    c = s.get(PendingClarification, ref)
    if c is None or c.status != ClarificationStatus.OPEN:
        return {}
    c.status, c.resolved_at = ClarificationStatus.EXPIRED, now
    s.add(c)
    return {"status": "expired"}


# ------------------------------------------------------------------------------------ tasks

def _detect_task_assignee_invalid(s: Session, now: datetime) -> list[Issue]:
    members = _members(s)
    out = []
    for t in s.exec(select(Task).where(col(Task.status).in_(OPEN_TASK))).all():
        m = members.get(t.assigned_to_member_id or "")
        if t.assigned_to_member_id is None:
            why = "has nobody assigned"
        elif m is None or m.household_id != t.household_id:
            why = "is assigned to someone outside this home"
        elif not m.is_active:
            why = f"is assigned to {m.name}, who was removed"
        else:
            continue
        out.append(Issue(
            "task_assignee_invalid", "high", t.household_id, t.id, "task",
            f"Task “{t.title}” {why}",
            "Nobody sees it as theirs. Reassign it from the Tasks page.",
        ))
    return out


def _detect_task_done_without_done_at(s: Session, now: datetime) -> list[Issue]:
    return [
        Issue("task_done_without_done_at", "medium", t.household_id, t.id, "task",
              f"Done task “{t.title}” never moves to history",
              "Status is done but done_at is empty, so the 3-day board → history move never runs. "
              "The fix sets done_at to the task's last update.", "Set done time")
        for t in s.exec(select(Task).where(Task.status == TaskStatus.DONE,
                                           col(Task.done_at).is_(None))).all()
    ]


def _fix_task_done_without_done_at(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    t = s.get(Task, ref)
    if t is None or t.status != TaskStatus.DONE or t.done_at is not None:
        return {}
    t.done_at = t.updated_at
    s.add(t)
    return {"done_at": as_utc(t.done_at).isoformat()}


def _detect_task_done_at_on_open(s: Session, now: datetime) -> list[Issue]:
    return [
        Issue("task_done_at_on_open", "medium", t.household_id, t.id, "task",
              f"Open task “{t.title}” carries a done time",
              f"Status is {t.status.value} but done_at is set, so the app may file it under "
              "history and hide it from the board. The fix clears done_at.", "Clear done time")
        for t in s.exec(select(Task).where(col(Task.status).in_(OPEN_TASK),
                                           col(Task.done_at).is_not(None))).all()
    ]


def _fix_task_done_at_on_open(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    t = s.get(Task, ref)
    if t is None or t.status not in OPEN_TASK:
        return {}
    before = t.done_at
    t.done_at, t.updated_at = None, now
    s.add(t)
    return {"before": as_utc(before).isoformat() if before else None}


# ------------------------------------------------------------------------------------ grocery

def _pending_items(s: Session):
    return s.exec(
        select(GroceryListItem, GroceryList).join(GroceryList, GroceryList.id == GroceryListItem.list_id)
        .where(GroceryListItem.status == ItemStatus.PENDING)
    ).all()


def _detect_list_item_unknown_category(s: Session, now: datetime) -> list[Issue]:
    return [
        Issue("list_item_unknown_category", "high", lst.household_id, item.id, "grocery_list_item",
              f"“{item.product}” is filed under unknown category “{item.category}”",
              "The list groups by a fixed set of categories; this item falls outside every group "
              "and is not rendered. The fix uses the catalog's category, or Other.", "Re-file")
        for item, lst in _pending_items(s) if item.category not in CATEGORIES
    ]


def _fix_list_item_unknown_category(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    item = s.get(GroceryListItem, ref)
    if item is None or item.category in CATEGORIES:
        return {}
    prod = s.get(Product, item.product_id)
    before = item.category
    item.category = prod.category if prod and prod.category in CATEGORIES else "Other"
    s.add(item)
    return {"before": before, "after": item.category}


def _detect_list_item_orphan_question(s: Session, now: datetime) -> list[Issue]:
    open_targets = set(s.exec(select(PendingClarification.target_id).where(
        PendingClarification.status == ClarificationStatus.OPEN)).all())
    return [
        Issue("list_item_orphan_question", "medium", lst.household_id, item.id, "grocery_list_item",
              f"“{item.product}” waits on a question nobody is asking",
              "Flagged needs-clarification but there is no open question for it, so it can never "
              "be answered or approved. The fix clears the flag; the item keeps its fields.",
              "Clear flag")
        for item, lst in _pending_items(s)
        if item.needs_clarification and item.id not in open_targets
    ]


def _fix_list_item_orphan_question(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    item = s.get(GroceryListItem, ref)
    if item is None or not item.needs_clarification:
        return {}
    item.needs_clarification, item.clarification_prompt = False, None
    s.add(item)
    return {"needs_clarification": False}


# ------------------------------------------------------------------------------------ reminders

def _detect_reminder_on_closed_post(s: Session, now: datetime) -> list[Issue]:
    rows = s.exec(select(Reminder, Post).join(Post, Post.id == Reminder.post_id).where(
        Reminder.active == True,
        col(Post.status).in_((PostStatus.DONE, PostStatus.CANCELLED)))).all()
    return [
        Issue("reminder_on_closed_post", "medium", post.household_id, r.id, "reminder",
              f"Still reminding about a {post.status.value} post",
              f"“{post.title or post.raw_text[:40]}” is closed but its reminder is active and "
              "will keep alerting.", "Stop reminder")
        for r, post in rows
    ]


def _fix_reminder_stop(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    r = s.get(Reminder, ref)
    if r is None or not r.active:
        return {}
    r.active = False
    s.add(r)
    return {"active": False}


def _detect_reminder_maxed(s: Session, now: datetime) -> list[Issue]:
    rows = s.exec(select(Reminder, Post).join(Post, Post.id == Reminder.post_id).where(
        Reminder.active == True, col(Reminder.max_times).is_not(None))).all()
    return [
        Issue("reminder_maxed", "low", post.household_id, r.id, "reminder",
              f"Reminder sent {r.times_sent} of {r.max_times} times but still active",
              "It has used up its allowance; stopping it changes nothing the family sees.",
              "Stop reminder")
        for r, post in rows if r.max_times is not None and r.times_sent >= r.max_times
    ]


def _detect_reminder_late(s: Session, now: datetime) -> list[Issue]:
    rows = s.exec(select(Reminder, Post).join(Post, Post.id == Reminder.post_id).where(
        Reminder.active == True)).all()
    return [
        Issue("reminder_late", "high", post.household_id, r.id, "reminder",
              f"Reminder overdue since {as_utc(r.next_fire_at):%d %b %H:%M} UTC",
              "The reminder worker has not fired it. Check the worker is running; nothing to "
              "repair in the data.")
        for r, post in rows
        if post.status not in (PostStatus.DONE, PostStatus.CANCELLED)
        and now - as_utc(r.next_fire_at) > REMINDER_LATE_AFTER
    ]


# ------------------------------------------------------------------------------------ people

def _detect_session_on_removed_member(s: Session, now: datetime) -> list[Issue]:
    rows = s.exec(select(AuthSession, Member).join(Member, Member.id == AuthSession.member_id).where(
        col(AuthSession.revoked_at).is_(None), Member.is_active == False)).all()
    return [
        Issue("session_on_removed_member", "high", m.household_id, m.id, "member",
              f"{m.name} was removed but is still signed in",
              f"Active session on {sess.device_label or 'a phone'}. The fix signs them out.",
              "Sign out")
        for sess, m in rows
    ]


def _fix_session_on_removed_member(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    return {"revoked": revoke_member_sessions(s, ref, now, SessionEndReason.REMOVED)}


def _detect_household_no_owner(s: Session, now: datetime) -> list[Issue]:
    from app.core.models import Household

    owners = set(s.exec(select(Member.household_id).where(
        Member.role == MemberRole.OWNER, Member.is_active == True)).all())
    return [
        Issue("household_no_owner", "high", h.id, h.id, "household",
              f"{h.name} has no active owner",
              "Nobody can manage members or admin-only screens (e.g. Task history). Make a member "
              "owner from the family page.")
        for h in s.exec(select(Household)).all() if h.id not in owners
    ]


# ------------------------------------------------------------------------------------ bills

def _detect_bill_past_due(s: Session, now: datetime) -> list[Issue]:
    rows = s.exec(select(BillPayment, BillAccount).join(
        BillAccount, BillAccount.id == BillPayment.bill_account_id).where(
        col(BillPayment.status).in_((BillStatus.UPCOMING, BillStatus.DUE)))).all()
    return [
        Issue("bill_past_due", "medium", acc.household_id, pay.id, "bill_payment",
              f"{acc.kind.title()} bill for {pay.period} is past due but shows {pay.status.value}",
              f"Due {pay.due_date:%d %b %Y}. The fix marks it overdue so it surfaces as urgent.",
              "Mark overdue")
        for pay, acc in rows if pay.due_date < now.date()
    ]


def _fix_bill_past_due(s: Session, ref: str, now: datetime) -> dict[str, Any]:
    pay = s.get(BillPayment, ref)
    if pay is None or pay.status not in (BillStatus.UPCOMING, BillStatus.DUE):
        return {}
    before = pay.status.value
    pay.status = BillStatus.OVERDUE
    s.add(pay)
    return {"before": before, "after": "overdue"}


CHECKS: tuple[Check, ...] = (
    Check("post_missing_recipients", "high", "Published posts some members never got",
          _detect_post_missing_recipients, _fix_post_missing_recipients, "Deliver to everyone"),
    Check("post_published_incomplete", "high", "Published posts with required fields missing",
          _detect_post_published_incomplete),
    Check("task_assignee_invalid", "high", "Open tasks with nobody valid assigned",
          _detect_task_assignee_invalid),
    Check("list_item_unknown_category", "high", "List items outside every category",
          _detect_list_item_unknown_category, _fix_list_item_unknown_category, "Re-file"),
    Check("session_on_removed_member", "high", "Removed members still signed in",
          _detect_session_on_removed_member, _fix_session_on_removed_member, "Sign out"),
    Check("household_no_owner", "high", "Homes with no active owner", _detect_household_no_owner),
    Check("reminder_late", "high", "Reminders the worker missed", _detect_reminder_late),
    Check("post_stuck_open", "medium", "Posts never sent (48 h+)",
          _detect_post_stuck_open, _fix_post_stuck_open, "Re-check"),
    Check("recipient_undelivered", "medium", "Pop-ups not delivered (1 h+)",
          _detect_recipient_undelivered),
    Check("task_done_without_done_at", "medium", "Done tasks that never reach history",
          _detect_task_done_without_done_at, _fix_task_done_without_done_at, "Set done time"),
    Check("task_done_at_on_open", "medium", "Open tasks hidden as done",
          _detect_task_done_at_on_open, _fix_task_done_at_on_open, "Clear done time"),
    Check("list_item_orphan_question", "medium", "List items waiting on a missing question",
          _detect_list_item_orphan_question, _fix_list_item_orphan_question, "Clear flag"),
    Check("reminder_on_closed_post", "medium", "Reminders on closed posts",
          _detect_reminder_on_closed_post, _fix_reminder_stop, "Stop reminder"),
    Check("bill_past_due", "medium", "Bills past due but not overdue",
          _detect_bill_past_due, _fix_bill_past_due, "Mark overdue"),
    Check("clarification_stale", "low", "Questions unanswered for a week",
          _detect_clarification_stale, _fix_clarification_stale, "Expire"),
    Check("reminder_maxed", "low", "Reminders past their send limit",
          _detect_reminder_maxed, _fix_reminder_stop, "Stop reminder"),
)
BY_NAME = {c.name: c for c in CHECKS}
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def scan(s: Session, now: datetime, household_id: str | None = None) -> list[Issue]:
    issues: list[Issue] = []
    for c in CHECKS:
        for i in c.detect(s, now):
            if household_id is None or i.household_id == household_id:
                issues.append(Issue(**{**asdict(i), "fix_label": c.fix_label if c.fix else None}))
    issues.sort(key=lambda i: (_SEVERITY_ORDER[i.severity], i.check, i.household_id or ""))
    return issues


def fix(s: Session, check: str, ref: str, now: datetime) -> dict[str, Any]:
    """Apply one check's fix to one row. Re-detects first: a row that is no longer bad is left alone."""

    c = BY_NAME.get(check)
    if c is None or c.fix is None:
        raise KeyError(check)
    if not any(i.ref == ref for i in c.detect(s, now)):
        raise LookupError(f"{check}: {ref} is no longer an issue")
    return c.fix(s, ref, now)
