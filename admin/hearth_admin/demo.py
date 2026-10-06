"""Fill a *throwaway* database with a year of purchases, two homes, tasks, posts — and one of
each broken state the issue scanner looks for — so the console has something to show.

    ../backend/.venv/bin/python -m hearth_admin.demo sqlite:///demo.db

The URL is required on purpose: this never falls back to DATABASE_URL, so it cannot write
demo rows into the real family database by accident. Safe to re-run (skips if already filled).
"""

from __future__ import annotations

import random
import sys
from datetime import timedelta
from typing import Any

from sqlmodel import Session

from app.auth.models import AuthSession
from app.bills.models import BillPayment, BillStatus
from app.conversation.models import PendingClarification
from app.core.models import Household, Member, MemberRole
from app.core.sqltypes import utcnow
from app.db import get_engine
from app.feed.models import Post, PostRecipient, PostStatus, Reminder
from app.history.models import Purchase, PurchaseSource
from app.planner.models import GroceryList, GroceryListItem
from app.seed import main as seed
from app.tasks.models import Task, TaskStatus

from .db import init_admin_db

# product_id, name, unit, typical qty, price per unit (INR), buys per month
BASKET = (
    ("p_milk", "Milk", "L", 1, 56, 12), ("p_tomato", "Tomatoes", "kg", 1, 40, 4),
    ("p_onion", "Onions", "kg", 1, 35, 3), ("p_curd", "Curd", "g", 400, 0.14, 4),
    ("p_bread", "Bread", "pack", 1, 45, 4), ("p_rice", "Rice", "kg", 5, 70, 1),
    ("p_toor_dal", "Toor dal", "kg", 1, 160, 1), ("p_sunflower_oil", "Sunflower oil", "L", 1, 150, 1),
    ("p_biscuits", "Biscuits", "pack", 2, 30, 2), ("p_tea", "Tea", "g", 250, 0.6, 0.5),
    ("p_potato", "Potatoes", "kg", 1, 30, 2), ("p_banana", "Bananas", "dozen", 1, 60, 3),
)


def _id(prefix: str, n: Any) -> str:
    return f"demo_{prefix}_{n}"


def fill(s: Session, rng: random.Random | None = None) -> None:
    rng = rng or random.Random(7)
    now = utcnow()
    s.add(Household(id="h_sharma", name="Sharma home", created_at=now - timedelta(days=300)))
    for mid, name, role, rel in (("m_s_amma", "Lakshmi", MemberRole.OWNER, "mom"),
                                 ("m_s_appa", "Ravi", MemberRole.MEMBER, "dad"),
                                 ("m_s_kid", "Anu", MemberRole.MEMBER, "daughter")):
        s.add(Member(id=mid, household_id="h_sharma", name=name, role=role, relation=rel,
                     phone=f"+9198450{rng.randint(10000, 99999)}"))
    s.add(Household(id="h_new", name="Iyer home", created_at=now - timedelta(days=20)))
    s.add(Member(id="m_i_owner", household_id="h_new", name="Meena", role=MemberRole.MEMBER,
                 relation="mom"))  # no owner → household_no_owner
    s.flush()

    n = 0
    for hid, who, scale in (("h_home", "m_mom", 1.0), ("h_sharma", "m_s_amma", 1.4)):
        for day in range(365):
            for pid, name, unit, qty, rate, per_month in BASKET:
                if rng.random() < per_month * scale / 30:
                    n += 1
                    q = qty * rng.choice((1, 1, 1, 2))
                    priced = rng.random() > 0.15  # some lines have no price — never invented
                    s.add(Purchase(
                        id=_id("pur", n), household_id=hid, product_id=pid, product=name,
                        member_id=who, qty=q, unit=unit,
                        price=round(q * rate * rng.uniform(0.9, 1.15), 2) if priced else None,
                        purchased_at=now - timedelta(days=day, hours=rng.randint(0, 12)),
                        source=PurchaseSource.CHAT_CONFIRMED, currency="INR"))

    tasks = (
        ("h_home", "Fix kitchen tap leak", "plumbing", "m_dad", TaskStatus.OPEN, 2, None),
        ("h_home", "Book train to Chennai", "ticket_booking", "m_me", TaskStatus.IN_PROGRESS, 5, None),
        ("h_home", "Service the AC", "maintenance", "m_dad", TaskStatus.OPEN, -3, None),  # overdue
        ("h_home", "Pay school fees", "other", "m_mom", TaskStatus.DONE, -1, "no_done_at"),
        ("h_sharma", "Call electrician for fan", "electrical", "m_s_appa", TaskStatus.ACKNOWLEDGED, 1, None),
        ("h_sharma", "Courier documents", "errand", "m_s_kid", TaskStatus.OPEN, 3, "done_at_set"),
        ("h_sharma", "Repaint balcony grill", "repair", "m_s_old", TaskStatus.OPEN, 10, "removed"),
    )
    s.add(Member(id="m_s_old", household_id="h_sharma", name="Uncle (moved out)", is_active=False))
    s.flush()
    for i, (hid, title, cat, who, status, due_days, broken) in enumerate(tasks):
        creator = "m_mom" if hid == "h_home" else "m_s_amma"
        s.add(Task(id=_id("task", i), household_id=hid, created_by_member_id=creator,
                   assigned_to_member_id=who, category=cat, title=title, status=status,
                   due_at=now + timedelta(days=due_days),
                   done_at=(now - timedelta(days=1)) if broken == "done_at_set" else None,
                   created_at=now - timedelta(days=4), updated_at=now - timedelta(days=1)))

    # Posts: one healthy, one that skipped Dad (missing recipient), one stuck clarifying.
    def post(pid: str, hid: str, author: str, kind: str, title: str, status: PostStatus,
             fields: dict[str, Any], age_h: int, missing: list[str] | None = None) -> Post:
        p = Post(id=pid, household_id=hid, author_member_id=author, kind=kind, raw_text=title,
                 title=title, status=status, fields_json=fields,
                 missing_fields_json=[{"field": f} for f in missing or []],
                 published_at=now - timedelta(hours=age_h) if status == PostStatus.PUBLISHED else None,
                 created_at=now - timedelta(hours=age_h), updated_at=now - timedelta(hours=age_h))
        s.add(p)
        return p

    task_fields = {"what": "x", "assigned_to": "m_dad", "needed_by": "2026-10-10"}
    post("demo_post_ok", "h_home", "m_mom", "task", "Fix kitchen tap leak", PostStatus.PUBLISHED,
         task_fields, 30)
    post("demo_post_skip", "h_home", "m_mom", "task", "Service the AC", PostStatus.PUBLISHED,
         task_fields, 20)
    post("demo_post_stuck", "h_sharma", "m_s_appa", "task", "something with the geyser",
         PostStatus.CLARIFYING, {"what": "geyser"}, 80, ["assigned_to", "needed_by"])
    post("demo_post_closed", "h_sharma", "m_s_amma", "alert", "Remind Ravi about the gas",
         PostStatus.CANCELLED, {}, 50)
    s.flush()
    for m in ("m_dad", "m_me"):
        s.add(PostRecipient(post_id="demo_post_ok", member_id=m, delivered_at=now - timedelta(hours=29)))
    s.add(PostRecipient(post_id="demo_post_skip", member_id="m_me", delivered_at=None))
    s.add(Reminder(id="demo_rem_1", post_id="demo_post_closed", member_id="m_s_appa",
                   interval_minutes=60, next_fire_at=now + timedelta(minutes=20)))
    s.add(Reminder(id="demo_rem_maxed", post_id="demo_post_ok", member_id="m_dad",
                   interval_minutes=30, max_times=3, times_sent=3,
                   next_fire_at=now + timedelta(minutes=10)))
    s.add(Reminder(id="demo_rem_late", post_id="demo_post_skip", member_id="m_dad",
                   interval_minutes=60, next_fire_at=now - timedelta(hours=2)))  # worker missed it

    s.add(GroceryList(id="demo_list", household_id="h_sharma", created_at=now - timedelta(hours=5)))
    s.flush()
    for i, (pid, name, cat, flag) in enumerate((
            ("p_tomato", "Tomatoes", "Vegetables", False), ("p_spinach", "Spinach", "Veggies", False),
            ("p_ghee", "Ghee", "Dairy", True), ("p_milk", "Milk", "Dairy", False))):
        s.add(GroceryListItem(id=_id("item", i), list_id="demo_list", product_id=pid, product=name,
                              qty=1, unit="kg", category=cat, source="user", confidence="high",
                              rationale="You asked for it.", needs_clarification=flag,
                              position=i, created_at=now - timedelta(hours=5)))

    s.add(PendingClarification(id="demo_q_old", household_id="h_home", field="brand",
                               question="Which brand of biscuits?", options=["Marie", "Parle-G"],
                               created_at=now - timedelta(days=12)))
    s.add(AuthSession(id="demo_sess_old", member_id="m_s_old", device_label="Uncle's Nokia",
                      token_hash="demo_hash_old", last_seen_at=now - timedelta(days=2)))
    s.add(AuthSession(id="demo_sess_mom", member_id="m_mom", device_label="Mom's Redmi",
                      token_hash="demo_hash_mom", last_seen_at=now - timedelta(hours=3)))
    today = now.date()
    s.add(BillPayment(id="demo_bill_1", bill_account_id="bill_electricity",
                      period=f"{today:%Y-%m}", amount_due=1840, status=BillStatus.DUE,
                      due_date=today - timedelta(days=4)))


def main(url: str) -> None:
    engine = get_engine(url)
    seed(engine)
    init_admin_db(engine)
    with Session(engine) as s:
        if s.get(Household, "h_sharma"):
            print("demo data already there")
            return
        fill(s)
        s.commit()
    print(f"demo data written to {url}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m hearth_admin.demo <database-url>   e.g. sqlite:///demo.db")
    main(sys.argv[1])
