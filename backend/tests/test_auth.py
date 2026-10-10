"""Sign-in rules: join requests, admin-issued passkeys, lockout, one device, idle sign-out,
the login log, retention and account deletion."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from random import Random

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth import store
from app.auth.models import (
    AuthEvent,
    AuthEventKind,
    AuthSession,
    JoinRequest,
    JoinRequestStatus,
    MemberPasskey,
    SessionEndReason,
)
from app.auth.store import AuthRefused
from app.core.models import Household, Member, MemberRole
from app.db import get_engine
from app.seed import main

T0 = datetime(2026, 10, 10, 9, 0, tzinfo=UTC)
PRIYA = "+919876543210"
RAVI = "+919811112222"


@pytest.fixture()
def s():
    eng = get_engine("sqlite://")
    main(eng)
    with Session(eng) as session:
        yield session


def refused(fn, *args, **kwargs) -> AuthRefused:
    with pytest.raises(AuthRefused) as e:
        fn(*args, **kwargs)
    return e.value


def ask(s, phone=PRIYA, name="Priya", now=T0):
    store.request_access(s, phone=phone, name=name, now=now)
    return s.exec(select(JoinRequest).where(JoinRequest.phone == phone)
                  .order_by(JoinRequest.first_at.desc())).first()  # type: ignore[attr-defined]


def approve(s, phone=PRIYA, name="Priya", now=T0, **kw):
    req = ask(s, phone, name, now)
    return store.approve_request(s, request_id=req.id, now=now, by="Admin", **kw)


def sign_in(s, phone=PRIYA, name="Priya", passkey="", now=T0, label="Pixel"):
    return store.sign_in_with_passkey(s, phone=phone, name=name, passkey=passkey, now=now, device_label=label)


def joined(s, phone=PRIYA, name="Priya", now=T0, **kw):
    member, key = approve(s, phone, name, now, **kw)
    return member, key, sign_in(s, phone, name, key, now)


def events(s, kind):
    return s.exec(select(AuthEvent).where(AuthEvent.kind == kind)).all()


# ------------------------------------------------------------ asking to join

def test_asking_puts_one_pending_request_on_the_admins_list(s):
    ask(s, name="  Priya  ")
    req = ask(s, name="Priya Rao", now=T0 + timedelta(minutes=2))  # tapped Continue again
    assert len(store.pending_requests(s)) == 1
    assert (req.name, req.times, req.status) == ("Priya Rao", 2, JoinRequestStatus.PENDING)


def test_asking_checks_only_what_was_typed(s):
    assert refused(store.request_access, s, phone="9876543210", name="P", now=T0).error == "invalid_phone"
    assert refused(store.request_access, s, phone=PRIYA, name=" ", now=T0).error == "invalid_name"


def test_someone_with_a_passkey_asking_again_does_not_bother_the_admin(s):
    joined(s)
    store.request_access(s, phone=PRIYA, name="Anyone", now=T0 + timedelta(hours=1))  # same answer: nothing
    assert store.pending_requests(s) == []


def test_the_waiting_list_cannot_be_flooded(s, monkeypatch):
    monkeypatch.setattr(store, "MAX_PENDING_REQUESTS", 2)
    for i in range(4):
        store.request_access(s, phone=f"+9198000000{i:02d}", name="X", now=T0)
    assert len(store.pending_requests(s)) == 2


# ------------------------------------------------------------ admin: approve / issue

def test_approving_into_a_home_adds_the_member_and_returns_a_readable_passkey(s):
    member, key = approve(s, phone=RAVI, name="Ravi", household_id="h_home", relation="Dad")
    assert (member.household_id, member.relation, member.role) == ("h_home", "Dad", MemberRole.MEMBER)
    assert len(key) == store.PASSKEY_LENGTH and not set(key) & set("01OIL")
    assert store.format_passkey(key) == f"{key[:4]}-{key[4:]}"
    req = s.exec(select(JoinRequest)).one()
    assert (req.status, req.member_id, req.resolved_by) == (JoinRequestStatus.APPROVED, member.id, "Admin")


def test_approving_without_a_home_starts_one_with_them_as_owner(s):
    member, _ = approve(s, relation="Mom")
    home = s.get(Household, member.household_id)
    assert member.role is MemberRole.OWNER and home.name == "Priya’s home"


def test_a_number_already_in_a_home_keeps_its_person(s):
    dad = s.get(Member, "m_dad")
    dad.phone = RAVI
    s.add(dad)
    member, _ = approve(s, phone=RAVI, name="Ravi", household_id=None)
    assert member.id == "m_dad" and member.household_id == "h_home"


def test_passkeys_are_stored_only_as_a_slow_salted_hash(s):
    member, key = approve(s)
    row = s.get(MemberPasskey, member.id)
    assert key not in row.passkey_hash and row.passkey_hash.startswith("scrypt$")
    assert store.hash_passkey(key) != store.hash_passkey(key)  # salted
    assert store.passkey_matches(row.passkey_hash, key.lower())


def test_a_request_is_answered_once(s):
    req = ask(s)
    store.dismiss_request(s, request_id=req.id, now=T0, by="Admin")
    assert refused(store.approve_request, s, request_id=req.id, now=T0, by="Admin").error == "not_pending"


def test_removed_people_get_no_passkey(s):
    s.get(Member, "m_dad").is_active = False
    assert refused(store.issue_passkey, s, member_id="m_dad", now=T0, by="Admin").error == "removed"


def test_existing_members_can_be_given_a_passkey_directly(s):
    dad = s.get(Member, "m_dad")
    dad.phone = RAVI
    s.add(dad)
    key = store.issue_passkey(s, member_id="m_dad", now=T0, by="Admin", rng=Random(1))
    assert sign_in(s, RAVI, dad.name, key).member.id == "m_dad"


# ------------------------------------------------------------ signing in

def test_name_number_and_passkey_sign_in_first_as_new_then_returning(s):
    _, key, first = joined(s)
    assert first.created and first.member.phone == PRIYA
    again = sign_in(s, name="  priya ", passkey=key.lower()[:4] + " - " + key.lower()[4:], now=T0 + timedelta(minutes=1))
    assert not again.created
    assert events(s, AuthEventKind.SIGNED_UP)[0].detail_json["how"] == "passkey"


@pytest.mark.parametrize("phone,name,good_key", [(PRIYA, "Ravi", True), (PRIYA, "Priya", False), (RAVI, "Priya", True)])
def test_every_mismatch_gets_the_same_answer(s, phone, name, good_key):
    _, key = approve(s)
    typed = key if good_key else ("A" * 8 if key != "A" * 8 else "B" * 8)
    e = refused(sign_in, s, phone, name, typed)
    assert (e.error, e.message) == ("wrong_details", store.MESSAGES["wrong_details"])


def test_a_passkey_must_look_like_one(s):
    assert refused(sign_in, s, passkey="12").error == "invalid_passkey"


def test_five_wrong_tries_lock_the_number_for_15_minutes(s):
    _, key = approve(s)
    for _ in range(store.MAX_ATTEMPTS - 1):
        assert refused(sign_in, s, passkey="ZZZZZZZZ").error == "wrong_details"
    assert refused(sign_in, s, passkey="ZZZZZZZZ").error == "locked"
    assert refused(sign_in, s, passkey=key, now=T0 + timedelta(minutes=14)).error == "locked"  # even the right one
    assert sign_in(s, passkey=key, now=T0 + timedelta(minutes=15)).created
    s.commit()
    assert len(events(s, AuthEventKind.PASSKEY_FAILED)) == 4 and len(events(s, AuthEventKind.PASSKEY_LOCKED)) == 1


def test_a_new_passkey_ends_the_old_one_and_signs_them_out(s):
    member, old, first = joined(s)
    new = store.issue_passkey(s, member_id=member.id, now=T0 + timedelta(hours=1), by="Admin")
    check = store.authenticate(s, first.token, T0 + timedelta(hours=1))
    assert check.status == "revoked" and check.reason is SessionEndReason.SIGNED_OUT
    if new != old:
        assert refused(sign_in, s, passkey=old, now=T0 + timedelta(hours=2)).error == "wrong_details"
    assert sign_in(s, passkey=new, now=T0 + timedelta(hours=2)).member.id == member.id


def test_removed_people_cannot_sign_in(s):
    member, key = approve(s)
    member.is_active = False
    s.add(member)
    assert refused(sign_in, s, passkey=key).error == "wrong_details"


# ------------------------------------------------------------ sessions

def test_signing_in_on_another_phone_signs_the_old_one_out(s):
    _, key, first = joined(s)
    second = sign_in(s, passkey=key, now=T0 + timedelta(minutes=1), label="Priya's new iPhone")
    assert second.replaced is not None and second.replaced.id == first.session.id
    old = store.authenticate(s, first.token, T0 + timedelta(minutes=2))
    assert old.status == "revoked" and old.reason is SessionEndReason.REPLACED
    assert old.now_on == "Priya's new iPhone"
    assert store.authenticate(s, second.token, T0 + timedelta(minutes=2)).status == "active"


def test_the_database_allows_only_one_active_session_per_person(s):
    member, _, _ = joined(s)
    s.commit()
    s.add(AuthSession(id="as_dup", member_id=member.id, token_hash="x"))
    with pytest.raises(IntegrityError):
        s.commit()


def test_sessions_last_while_used_and_end_on_sign_out(s):
    _, _, r = joined(s)
    day = T0
    for _ in range(5):  # used every couple of months: still signed in after 400+ days
        day += timedelta(days=85)
        assert store.authenticate(s, r.token, day).status == "active"
    assert store.sign_out(s, r.token, day)
    check = store.authenticate(s, r.token, day)
    assert check.status == "revoked" and check.reason is SessionEndReason.SIGNED_OUT
    assert not store.sign_out(s, r.token, day)
    assert store.authenticate(s, "made-up", day).status == "unknown"


def test_a_phone_unused_for_90_days_is_signed_out(s):
    _, key, r = joined(s)
    assert store.authenticate(s, r.token, T0 + timedelta(days=90)).status == "active"
    check = store.authenticate(s, r.token, T0 + timedelta(days=181))
    assert check.status == "revoked" and check.reason is SessionEndReason.SIGNED_OUT
    s.commit()
    assert [e.detail_json["reason"] for e in events(s, AuthEventKind.SESSIONS_REVOKED)] == ["idle"]
    assert sign_in(s, passkey=key, now=T0 + timedelta(days=182)).replaced is None


def test_taking_someone_out_of_the_home_ends_their_session(s):
    member, _, r = joined(s)
    member.is_active = False
    s.add(member)
    store.revoke_member_sessions(s, member.id, T0)
    assert store.authenticate(s, r.token, T0).reason is SessionEndReason.REMOVED


# ------------------------------------------------------------ retention + deletion

def test_purge_drops_answered_requests_after_30_days_and_the_log_after_a_year(s):
    joined(s)  # an answered request + sign-in log entries
    ask(s, phone=RAVI, name="Ravi")
    s.commit()
    assert store.purge(s, T0 + timedelta(days=29)) == {"join_request": 0, "auth_event": 0}
    out = store.purge(s, T0 + timedelta(days=31))
    assert out["join_request"] == 2  # the answered one, and the stale pending one
    assert store.purge(s, T0 + timedelta(days=366))["auth_event"] >= 1


def test_delete_account_forgets_the_passkey_and_frees_the_number(s):
    member, _, _ = joined(s)
    assert store.delete_account(s, member_id=member.id, now=T0) is True  # last one in their home
    assert s.get(MemberPasskey, member.id) is None
    assert member.phone is None and member.name == store.DELETED_NAME
    again, _ = approve(s, now=T0 + timedelta(minutes=1))
    assert again.id != member.id
