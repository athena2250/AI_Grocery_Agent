"""Sign-in rules: codes, sign-up paths (new home / claimed invite / home code), one device,
the login log, rate limits, phone change and retention."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from app.auth import store
from app.auth.models import (
    AuthEvent,
    AuthEventKind,
    AuthSession,
    HouseholdInvite,
    OtpCode,
    OtpPurpose,
    SessionEndReason,
)
from app.auth.store import AuthRefused
from app.core.models import Household, Member, MemberRole
from app.db import get_engine
from app.seed import main

T0 = datetime(2026, 10, 6, 9, 0, tzinfo=UTC)
PRIYA = "+919876543210"
RAVI = "+919811112222"
UP, IN = OtpPurpose.SIGN_UP, OtpPurpose.SIGN_IN


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


def sign_up(s, phone=PRIYA, name="Priya", relation="Mom", now=T0, **kw):
    sent = store.request_code(s, purpose=UP, phone=phone, name=name, relation=relation, now=now, **kw)
    return store.verify_sign_in(s, purpose=UP, phone=phone, code=sent.code, now=now, device_label="Priya's Redmi")


def sign_in(s, phone=PRIYA, name="Priya", now=T0, label="Pixel"):
    sent = store.request_code(s, purpose=IN, phone=phone, name=name, now=now)
    return store.verify_sign_in(s, purpose=IN, phone=phone, code=sent.code, now=now, device_label=label)


def events(s, kind):
    return s.exec(select(AuthEvent).where(AuthEvent.kind == kind)).all()


# ------------------------------------------------------------ sign up

def test_sign_up_with_a_new_number_starts_a_home_with_you_as_owner(s):
    r = sign_up(s, name="  Priya  ")
    s.commit()
    assert r.created and r.replaced is None
    assert r.member.name == "Priya" and r.member.relation == "Mom" and r.member.role is MemberRole.OWNER
    home = s.get(Household, r.member.household_id)
    assert home is not None and home.id != "h_home" and home.name == "Priya’s home"
    assert store.authenticate(s, r.token, T0).status == "active"
    assert [e.detail_json["how"] for e in events(s, AuthEventKind.SIGNED_UP)] == ["new_home"]


def test_codes_and_tokens_are_never_stored_in_plain(s):
    sent = store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0)
    row = s.exec(select(OtpCode)).one()
    assert sent.code not in row.code_hash and len(sent.code) == 6
    r = store.verify_sign_in(s, purpose=UP, phone=PRIYA, code=sent.code, now=T0)
    assert r.token not in r.session.token_hash
    assert all(sent.code not in str(e.detail_json) for e in s.exec(select(AuthEvent)).all())


def test_sign_up_claims_the_row_the_owner_added_and_the_typed_name_wins(s):
    dad = s.get(Member, "m_dad")
    dad.phone = RAVI
    s.add(dad)
    s.commit()
    r = sign_up(s, phone=RAVI, name="Ravi Kumar", relation="")
    assert r.member.id == "m_dad" and r.member.household_id == "h_home"
    assert r.member.name == "Ravi Kumar" and r.member.relation == "dad"  # blank relation keeps the owner's
    assert events(s, AuthEventKind.SIGNED_UP)[0].detail_json["how"] == "claimed"


def test_sign_up_with_a_home_code_joins_that_home(s):
    inv = store.create_invite(s, member_id="m_dad", now=T0)  # any member, not just the owner
    assert inv.code.startswith("HRTH-") and len(inv.code) == 9
    r = sign_up(s, phone=RAVI, name="Arjun", relation="Son", invite_code=inv.code.lower().replace("-", " "))
    assert r.member.household_id == "h_home" and r.member.role is MemberRole.MEMBER
    assert s.get(HouseholdInvite, inv.id).uses == 1
    # Many people can use one code.
    sign_up(s, phone="+919800000001", name="Meera", relation="Daughter", invite_code=inv.code)
    assert s.get(HouseholdInvite, inv.id).uses == 2


def test_home_codes_stop_working_after_7_days_or_when_revoked(s):
    inv = store.create_invite(s, member_id="m_me", now=T0)
    late = T0 + timedelta(days=7)
    e = refused(store.request_code, s, purpose=UP, phone=RAVI, name="A", relation="Son", invite_code=inv.code, now=late)
    assert e.error == "invalid_invite"
    store.revoke_invite(s, invite_id=inv.id, member_id="m_mom", now=T0)
    e = refused(store.request_code, s, purpose=UP, phone=RAVI, name="A", relation="Son", invite_code=inv.code, now=T0)
    assert e.error == "invalid_invite"


def test_one_household_per_person(s):
    sign_up(s)  # Priya's own home
    s.commit()
    inv = store.create_invite(s, member_id="m_mom", now=T0)
    e = refused(store.request_code, s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom",
                invite_code=inv.code, now=T0 + timedelta(minutes=1))
    assert e.error == "account_exists"


def test_an_invited_number_cannot_use_another_homes_code(s):
    dad = s.get(Member, "m_dad")
    dad.phone = RAVI
    s.add(dad)
    other = sign_up(s, phone=PRIYA)
    inv = store.create_invite(s, member_id=other.member.id, now=T0)
    e = refused(store.request_code, s, purpose=UP, phone=RAVI, name="Ravi", relation="Dad", invite_code=inv.code, now=T0)
    assert e.error == "phone_in_other_home"


def test_a_second_sign_up_on_the_same_number_is_refused(s):
    sign_up(s)
    e = refused(store.request_code, s, purpose=UP, phone=PRIYA, name="Someone", relation="Dad", now=T0 + timedelta(minutes=1))
    assert e.error == "account_exists"


@pytest.mark.parametrize("name,relation,error", [("", "Mom", "invalid_name"), ("Priya", " ", "invalid_relation")])
def test_sign_up_needs_name_and_relation(s, name, relation, error):
    assert refused(store.request_code, s, purpose=UP, phone=PRIYA, name=name, relation=relation, now=T0).error == error


def test_phone_must_be_e164(s):
    assert refused(store.request_code, s, purpose=UP, phone="9876543210", name="P", relation="Mom", now=T0).error == "invalid_phone"


# ------------------------------------------------------------ sign in

def test_sign_in_needs_the_matching_name_ignoring_case_and_spaces(s):
    sign_up(s, name="Priya Rao")
    later = T0 + timedelta(minutes=1)
    assert refused(store.request_code, s, purpose=IN, phone=PRIYA, name="Ravi", now=later).error == "name_mismatch"
    r = sign_in(s, name="priyarao", now=later)
    assert not r.created and r.member.name == "Priya Rao"
    s.commit()
    assert [e.detail_json["error"] for e in events(s, AuthEventKind.REFUSED)] == ["name_mismatch"]


def test_sign_in_with_an_unknown_number(s):
    assert refused(store.request_code, s, purpose=IN, phone=PRIYA, name="Priya", now=T0).error == "no_account"


def test_signing_in_on_another_phone_signs_the_old_one_out(s):
    first = sign_up(s)
    second = sign_in(s, now=T0 + timedelta(minutes=1), label="Priya's new iPhone")
    assert second.replaced is not None and second.replaced.id == first.session.id
    old = store.authenticate(s, first.token, T0 + timedelta(minutes=2))
    assert old.status == "revoked" and old.reason is SessionEndReason.REPLACED
    assert old.now_on == "Priya's new iPhone"
    assert store.authenticate(s, second.token, T0 + timedelta(minutes=2)).status == "active"
    assert len(events(s, AuthEventKind.SESSION_REPLACED)) == 1


def test_the_database_allows_only_one_active_session_per_person(s):
    r = sign_up(s)
    s.commit()
    s.add(AuthSession(id="as_dup", member_id=r.member.id, token_hash="x"))
    with pytest.raises(IntegrityError):
        s.commit()


def test_sessions_last_until_sign_out(s):
    r = sign_up(s)
    year_later = T0 + timedelta(days=400)
    assert store.authenticate(s, r.token, year_later).status == "active"
    assert store.sign_out(s, r.token, year_later)
    check = store.authenticate(s, r.token, year_later)
    assert check.status == "revoked" and check.reason is SessionEndReason.SIGNED_OUT
    assert not store.sign_out(s, r.token, year_later)
    assert store.authenticate(s, "made-up", year_later).status == "unknown"


def test_taking_someone_out_of_the_home_ends_their_session(s):
    r = sign_up(s)
    r.member.is_active = False
    s.add(r.member)
    store.revoke_member_sessions(s, r.member.id, T0)
    assert store.authenticate(s, r.token, T0).reason is SessionEndReason.REMOVED
    assert refused(store.request_code, s, purpose=IN, phone=PRIYA, name="Priya", now=T0 + timedelta(minutes=1)).error == "removed"


# ------------------------------------------------------------ codes

def test_wrong_codes_count_down_then_lock(s):
    store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0)
    for left in (4, 3, 2, 1):
        e = refused(store.verify_sign_in, s, purpose=UP, phone=PRIYA, code="xxxxxx", now=T0)
        assert e.error == "wrong_code" and e.detail["attempts_left"] == left
    assert refused(store.verify_sign_in, s, purpose=UP, phone=PRIYA, code="xxxxxx", now=T0).error == "too_many_attempts"
    assert refused(store.verify_sign_in, s, purpose=UP, phone=PRIYA, code="xxxxxx", now=T0).error == "no_code"
    s.commit()
    assert len(events(s, AuthEventKind.CODE_FAILED)) == 4 and len(events(s, AuthEventKind.CODE_LOCKED)) == 1


def test_codes_expire_after_5_minutes(s):
    sent = store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0)
    late = T0 + timedelta(minutes=5)
    assert refused(store.verify_sign_in, s, purpose=UP, phone=PRIYA, code=sent.code, now=late).error == "expired"


def test_resend_waits_30_seconds_and_replaces_the_old_code(s):
    first = store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0)
    e = refused(store.request_code, s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0 + timedelta(seconds=29))
    assert e.error == "resend_too_soon"
    second = store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=T0 + timedelta(seconds=30))
    assert s.exec(select(func.count()).select_from(OtpCode)).one() == 1
    if first.code != second.code:
        e = refused(store.verify_sign_in, s, purpose=UP, phone=PRIYA, code=first.code, now=T0 + timedelta(seconds=31))
        assert e.error == "wrong_code"


def test_at_most_5_codes_an_hour_and_10_a_day(s):
    def ask(at):
        return store.request_code(s, purpose=UP, phone=PRIYA, name="Priya", relation="Mom", now=at)

    for i in range(5):
        ask(T0 + timedelta(minutes=i))
    assert refused(ask, T0 + timedelta(minutes=10)).error == "rate_limited"
    for i in range(5):
        ask(T0 + timedelta(hours=2, minutes=i))
    assert refused(ask, T0 + timedelta(hours=5)).error == "rate_limited"  # 10 today
    ask(T0 + timedelta(days=1, minutes=5))


# ------------------------------------------------------------ phone change

def test_changing_your_number_needs_a_code_on_the_new_one(s):
    r = sign_up(s)
    new = "+919700000000"
    sent = store.request_code(s, purpose=OtpPurpose.CHANGE_PHONE, phone=new, member_id=r.member.id, now=T0)
    m = store.verify_phone_change(s, member_id=r.member.id, phone=new, code=sent.code, now=T0)
    assert m.phone == new
    assert events(s, AuthEventKind.PHONE_CHANGED)[0].detail_json["old_phone"] == PRIYA
    assert store.authenticate(s, r.token, T0).status == "active"  # still signed in on this phone
    # The old number is free for a new sign-up.
    assert sign_up(s, phone=PRIYA, name="Someone", relation="Dad", now=T0 + timedelta(minutes=1)).created


def test_you_cannot_take_someone_elses_number(s):
    r = sign_up(s)
    sign_up(s, phone=RAVI, name="Ravi", relation="Dad")
    e = refused(store.request_code, s, purpose=OtpPurpose.CHANGE_PHONE, phone=RAVI, member_id=r.member.id, now=T0)
    assert e.error == "phone_taken"


# ------------------------------------------------------------ retention

def test_purge_drops_old_codes_after_a_day_and_the_log_after_a_year(s):
    sign_up(s)  # one used code + a few events
    store.request_code(s, purpose=UP, phone=RAVI, name="Ravi", relation="Dad", now=T0)  # never used
    s.commit()
    assert store.purge(s, T0 + timedelta(hours=23)) == {"otp_code": 0, "auth_event": 0}
    assert store.purge(s, T0 + timedelta(days=1, minutes=6))["otp_code"] == 2
    kept = s.exec(select(func.count()).select_from(AuthEvent)).one()
    assert store.purge(s, T0 + timedelta(days=366))["auth_event"] == kept
