"""Create every table and load starter data. Safe to re-run: rows that exist are left alone,
except the post kind definitions (`post_kind`, `post_kind_field`), which the code owns and
are brought in line with POST_KINDS / POST_KIND_FIELDS on every run.

    cd backend && .venv/bin/python -m app.seed            # uses DATABASE_URL or the local default
    DATABASE_URL=sqlite:///dev.db .venv/bin/python -m app.seed

Nothing here invents prices or bill amounts — those come from the family (principle 2).
"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, select

from app.bills.models import BillAccount
from app.core.models import Household, Member, MemberRole, Product, ProductAlias
from app.core.sqltypes import utcnow
from app.db import get_engine, init_db
from app.feed.models import FieldScope, PostKind, PostKindField
from app.history.models import Purchase, PurchaseSource
from app.inventory.models import Inventory
from app.memory.models import AliasPreference, Preference
from app.understanding.schema import InventoryStateLiteral

SEED_FILE = Path(__file__).with_name("seed_data.json")
HOUSEHOLD_ID = "h_home"

MEMBERS: tuple[dict[str, Any], ...] = (
    # Rename in DBeaver or the app later; ids are what the code uses.
    {"id": "m_mom", "name": "Mom", "role": MemberRole.OWNER, "relation": "mom"},
    {"id": "m_dad", "name": "Dad", "role": MemberRole.MEMBER, "relation": "dad"},
    {"id": "m_me", "name": "Me", "role": MemberRole.MEMBER, "relation": "child"},
)

POST_KINDS = (
    ("grocery", "Grocery list", "Things to buy for the house."),
    ("task", "Task / repair", "Plumbing, electrical, repairs, maintenance — something someone must do."),
    ("ticket_booking", "Ticket booking", "Train / bus / flight / movie tickets to book."),
    ("bill", "Bill to pay", "Electricity, internet, maintenance, water, gas, phone."),
    ("alert", "Alert / reminder", "A message for someone, optionally repeated until they respond."),
    ("appointment", "Appointment", "Doctor, dentist, school meeting — somewhere to be at a time."),
    ("errand", "Errand", "Bank, post office, courier, pick up / drop off — a trip outside."),
    ("shopping", "Shopping", "Non-grocery things to buy: a pressure cooker, school shoes."),
    ("misc", "Miscellaneous", "Anything to remember that fits nowhere else."),
)

_WHEN = ["Today", "Tomorrow", "This week", "Pick a date"]
_WHO = ["Dad", "Mom", "Me"]

# (kind, field, label, required, applies_to, question, chips, depends_on_field, depends_on_value)
POST_KIND_FIELDS: tuple[tuple[Any, ...], ...] = (
    ("grocery", "item", "Item", True, "item", "Which item is this?", [], None, None),
    ("grocery", "qty", "Quantity", True, "item", "How much {item}?", [], None, None),
    ("grocery", "unit", "Unit", True, "item", "In what unit for {item}?",
     ["kg", "g", "L", "ml", "pack", "pcs", "dozen", "bunch"], None, None),
    # Never asked: filled from purchase history / market_price by app/feed/expected_rate.py.
    ("grocery", "expected_rate", "Expected market rate", False, "item",
     "About how much does {item} cost now (per unit)?", [], None, None),
    ("grocery", "needed_by", "Needed at home by", True, "item", "When do you need {item} at home?",
     _WHEN, None, None),
    ("grocery", "brand", "Brand", False, "item", "Any brand for {item}?", [], None, None),
    ("grocery", "variant", "Variant", False, "item", "Which kind of {item}?", [], None, None),

    ("task", "what", "What needs doing", True, "post", "What exactly needs to be done?", [], None, None),
    ("task", "assigned_to", "Who should do it", True, "post", "Who should take care of it?", _WHO, None, None),
    ("task", "needed_by", "Needed by", True, "post", "By when does it need to be done?", _WHEN, None, None),
    ("task", "location_in_house", "Where in the house", False, "post", "Where in the house?", [], None, None),
    ("task", "budget", "Budget", False, "post", "Any budget in mind?", [], None, None),

    ("ticket_booking", "from", "From", True, "post", "Travelling from where?", [], None, None),
    ("ticket_booking", "to", "To", True, "post", "Travelling to where?", [], None, None),
    ("ticket_booking", "travel_date", "Travel date", True, "post", "Which date?", [], None, None),
    ("ticket_booking", "passengers", "Passengers", True, "post", "Who is travelling?", [], None, None),
    ("ticket_booking", "assigned_to", "Who books it", True, "post", "Who should book the tickets?", _WHO, None, None),
    ("ticket_booking", "mode", "Mode / class", False, "post", "Train, bus or flight? Which class?",
     ["Train", "Bus", "Flight"], None, None),
    ("ticket_booking", "time_pref", "Time preference", False, "post", "Any preferred time?",
     ["Morning", "Afternoon", "Night"], None, None),

    ("bill", "bill_type", "Bill", True, "post", "Which bill is it?",
     ["Electricity", "Internet", "Maintenance", "Water", "Gas", "Phone"], None, None),
    ("bill", "amount", "Amount", True, "post", "How much is the bill?", [], None, None),
    ("bill", "due_date", "Due date", True, "post", "When is it due?", [], None, None),
    ("bill", "assigned_to", "Who pays", True, "post", "Who should pay it?", _WHO, None, None),
    ("bill", "account_ref", "Account / consumer no.", False, "post", "Account or consumer number?", [], None, None),

    ("alert", "message", "Message", True, "post", "What should the alert say?", [], None, None),
    ("alert", "recipients", "Send to", True, "post", "Who should get it?", _WHO, None, None),
    ("alert", "repeat", "Repeat", True, "post", "Should I keep reminding until they reply?",
     ["Yes", "No"], None, None),
    ("alert", "interval_minutes", "Repeat every", True, "post", "How often should I remind?",
     ["Every hour", "Every 4 hours", "Every morning"], "repeat", True),
    ("alert", "until", "Until", False, "post", "Until when?", [], None, None),

    # Kinds below were added for the multi-item feed (2026-10-05); appended so existing
    # positions don't move.
    ("grocery", "assigned_to", "Who buys it", False, "post", "Who should buy these?", _WHO, None, None),

    ("appointment", "what", "Appointment", True, "post", "What is the appointment for?", [], None, None),
    ("appointment", "appointment_date", "Date", True, "post", "Which day is it?",
     ["Today", "Tomorrow", "Pick a date"], None, None),
    ("appointment", "appointment_time", "Time", True, "post", "What time is it?",
     ["Morning", "Afternoon", "Evening"], None, None),
    ("appointment", "for_member", "For", False, "post", "Who is the appointment for?", _WHO, None, None),
    ("appointment", "assigned_to", "Who goes along", False, "post", "Who is taking them?", _WHO, None, None),
    ("appointment", "location", "Where", False, "post", "Where is it?", [], None, None),

    ("errand", "what", "Errand", True, "post", "What needs to be done?", [], None, None),
    ("errand", "assigned_to", "Who does it", True, "post", "Who should do it?", _WHO, None, None),
    ("errand", "needed_by", "Needed by", True, "post", "When would you like to do this?", _WHEN, None, None),
    ("errand", "location", "Where", False, "post", "Where do they need to go?", [], None, None),

    ("shopping", "item", "Item", True, "post", "What should we buy?", [], None, None),
    ("shopping", "assigned_to", "Who buys it", True, "post", "Who should buy it?", _WHO, None, None),
    ("shopping", "needed_by", "Needed by", False, "post", "When do you need it?", _WHEN, None, None),
    ("shopping", "budget", "Budget", False, "post", "Any budget in mind?", [], None, None),

    ("misc", "what", "What", True, "post", "What should I note down?", [], None, None),
    ("misc", "assigned_to", "Who", False, "post", "Is this for someone in particular?", _WHO, None, None),
    ("misc", "needed_by", "When", False, "post", "Is there a date for this?", _WHEN, None, None),
)

BILL_ACCOUNTS = (
    ("bill_electricity", "electricity"),
    ("bill_internet", "internet"),
    ("bill_maintenance", "maintenance"),
)


def _add_missing(session: Session, row: SQLModel, *pk: Any) -> int:
    if session.get(type(row), pk if len(pk) > 1 else pk[0]) is None:
        session.add(row)
        return 1
    return 0


def _upsert(session: Session, row: SQLModel, *pk: Any) -> int:
    """Insert, or overwrite an existing row's columns with the code's definition. 1 if anything changed."""

    existing = session.get(type(row), pk if len(pk) > 1 else pk[0])
    if existing is None:
        session.add(row)
        return 1
    changed = 0
    for name, value in row.model_dump().items():
        if getattr(existing, name) != value:
            setattr(existing, name, value)
            changed = 1
    if changed:
        session.add(existing)
    return changed


def seed(session: Session, data: dict[str, Any] | None = None) -> dict[str, int]:
    data = data or json.loads(SEED_FILE.read_text())
    now = utcnow()
    row: SQLModel
    added: dict[str, int] = {}

    def count(name: str, n: int) -> None:
        added[name] = added.get(name, 0) + n

    count("household", _add_missing(session, Household(id=HOUSEHOLD_ID, name="Home"), HOUSEHOLD_ID))
    for m in MEMBERS:
        count("member", _add_missing(session, Member(household_id=HOUSEHOLD_ID, **m), m["id"]))

    for kind, label, desc in POST_KINDS:
        count("post_kind", _upsert(session, PostKind(kind=kind, label=label, description=desc), kind))
    for pos, (kind, fld, label, req, scope, q, chips, dep_f, dep_v) in enumerate(POST_KIND_FIELDS):
        row = PostKindField(
            kind=kind, field=fld, label=label, required=req, applies_to=FieldScope(scope),
            question=q, default_chips=chips, depends_on_field=dep_f, depends_on_value=dep_v,
            position=pos,
        )
        count("post_kind_field", _upsert(session, row, kind, fld))

    for p in data["products"]:
        count("product", _add_missing(session, Product(**p), p["id"]))
    session.flush()

    existing = {
        (a.alias, a.product_id)
        for a in session.exec(select(ProductAlias).where(ProductAlias.household_id.is_(None)))  # type: ignore[union-attr]
    }
    for a in data["aliases"]:
        if (a["alias"], a["product_id"]) not in existing:
            session.add(ProductAlias(**a))
            count("product_alias", 1)

    for p in data["preferences"]:
        row = Preference(household_id=HOUSEHOLD_ID, last_confirmed_at=now, **p)
        count("preference", _add_missing(session, row, HOUSEHOLD_ID, p["product_id"]))
    for a in data["alias_preferences"]:
        row = AliasPreference(household_id=HOUSEHOLD_ID, last_confirmed_at=now, **a)
        count("alias_preference", _add_missing(session, row, HOUSEHOLD_ID, a["disambiguation_group"]))
    for i in data["inventory"]:
        row = Inventory(
            household_id=HOUSEHOLD_ID, updated_at=now,
            **{**i, "state": InventoryStateLiteral(i["state"])},
        )
        count("inventory", _add_missing(session, row, HOUSEHOLD_ID, i["product_id"]))
    for h in data["history"]:
        h = dict(h)
        days = h.pop("days_ago")
        row = Purchase(
            household_id=HOUSEHOLD_ID, member_id="m_mom", source=PurchaseSource.MANUAL,
            purchased_at=now - timedelta(days=days), **h,
        )
        count("purchase", _add_missing(session, row, h["id"]))

    for bill_id, kind in BILL_ACCOUNTS:
        row = BillAccount(id=bill_id, household_id=HOUSEHOLD_ID, kind=kind, assigned_to_member_id="m_dad")
        count("bill_account", _add_missing(session, row, bill_id))

    return added


def main(engine: Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    init_db(engine)
    with Session(engine) as session:
        added = seed(session)
        session.commit()
    return added


if __name__ == "__main__":
    result = main()
    print("tables ready; rows added:", result or "none (already seeded)")
