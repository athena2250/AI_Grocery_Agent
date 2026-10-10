"""Schema + seed: every table is created, seed loads and is idempotent, FKs hold."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, func, select

from app.core.models import Member, Product, ProductAlias
from app.core.sqltypes import utcnow
from app.db import get_engine, init_db
from app.feed.models import PostKindField
from app.memory.models import Preference
from app.seed import SEED_FILE, main

EXPECTED_TABLES = {
    # existing
    "preference", "alias_preference", "inventory", "grocery_list", "grocery_list_item",
    "purchase", "receipt", "receipt_line", "store_alias",
    # core
    "household", "member", "device", "product", "product_alias", "product_variant",
    "suggestion_dismissal",
    # feed
    "post_kind", "post_kind_field", "post", "post_recipient", "post_comment", "reminder",
    "reminder_log",
    # conversation / tasks / bills / pricing / audit
    "conversation_turn", "pending_clarification", "task", "task_event", "bill_account",
    "bill_payment", "market_price", "inventory_event", "memory_event",
    # sign-in
    "member_passkey", "join_request", "auth_session", "auth_event",
}

MOBILE_SEED = Path(__file__).resolve().parents[2] / "mobile" / "src" / "data" / "seed.ts"


@pytest.fixture()
def engine():
    eng = get_engine("sqlite://")
    main(eng)
    return eng


def _count(session: Session, model: type[SQLModel]) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


def test_every_table_is_created(engine):
    init_db(engine)
    assert EXPECTED_TABLES <= set(SQLModel.metadata.tables)


def test_seed_counts(engine):
    data = json.loads(SEED_FILE.read_text())
    with Session(engine) as s:
        assert _count(s, Member) == 3
        assert _count(s, Product) == len(data["products"])
        assert _count(s, ProductAlias) == len(data["aliases"])
        assert _count(s, Preference) == len(data["preferences"])
        kinds = set(s.exec(select(PostKindField.kind)).all())
    assert kinds == {"grocery", "task", "ticket_booking", "bill", "alert",
                     "appointment", "errand", "shopping", "misc"}


def test_seed_is_idempotent(engine):
    assert not any(main(engine).values())


def test_foreign_keys_are_enforced(engine):
    with Session(engine) as s:
        s.add(Preference(household_id="h_home", product_id="p_does_not_exist", confidence=0.5,
                         last_confirmed_at=utcnow()))
        with pytest.raises(IntegrityError):
            s.commit()


def test_seed_json_matches_mobile_seed():
    """seed_data.json is exported from the mobile seed; product ids and aliases must not drift."""

    ts = MOBILE_SEED.read_text()
    data = json.loads(SEED_FILE.read_text())
    ts_products = set(re.findall(r"\{ id: '(p_\w+)'", ts))
    ts_aliases = set(re.findall(r"\{ alias: '([^']+)', productId: '(\w+)'", ts))
    assert {p["id"] for p in data["products"]} == ts_products
    assert {(a["alias"], a["product_id"]) for a in data["aliases"]} == ts_aliases
