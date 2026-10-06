"""Sign-in rules over the auth tables. Deterministic; writes are added to the session.

The caller commits — on success *and* on `AuthRefused`, since refusals, wrong codes and
used-up tries are recorded before the error is raised (the log and the per-code try count
must survive a refusal).

Flow (the mobile `AuthService` shapes map onto these):
  request_code(purpose=sign_up|sign_in, phone, name …) → text `CodeSent.code` to the phone
  verify_sign_in(...)                                   → `SignedIn.token` goes to the phone
  authenticate(token)                                   → every request after that
  sign_out(token)

Rules (agreed 2026-10-06):
- The phone is the account. Sign-in needs the name to match it (case and spaces ignored).
- Sign-up claims a member row the owner already added with that phone (the typed name
  wins — the code proves the number), or joins a household with a home code, or starts a
  new household with the person as owner. One household per person.
- One signed-in phone per person: signing in elsewhere ends the old session ("replaced").
- Sessions last until sign-out. Codes: 6 digits, 5 minutes, 5 tries, 30 s between sends,
  at most 5 sent per number per hour and 10 per day.
- Home codes: any member can make one; it works for 7 days for any number of people.
- Retention: used/expired codes deleted after 24 h, the login log after one year (`purge`).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from random import Random
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, delete, or_
from sqlmodel import Session, col, func, select

from app.core.models import Household, Member, MemberRole
from app.memory.rules import as_utc

from .models import (
    AuthEvent,
    AuthEventKind,
    AuthSession,
    HouseholdInvite,
    OtpCode,
    OtpPurpose,
    SessionEndReason,
)

CODE_LENGTH = 6
CODE_TTL = timedelta(minutes=5)
RESEND_AFTER = timedelta(seconds=30)
MAX_ATTEMPTS = 5
CODES_PER_HOUR = 5
CODES_PER_DAY = 10
INVITE_TTL = timedelta(days=7)
CODE_RETENTION = timedelta(days=1)
EVENT_RETENTION = timedelta(days=365)

INVITE_PREFIX = "HRTH-"
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
"""No 0/O, 1/I/L — read out over the phone without mix-ups."""

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")

MESSAGES = {
    "invalid_phone": "That doesn’t look like a mobile number.",
    "invalid_name": "Please tell us your name.",
    "invalid_relation": "Please choose who you are at home.",
    "no_account": "There’s no account for this number yet. Sign up instead?",
    "account_exists": "This number already has an account. Sign in instead?",
    "removed": "This number was taken out of its home. Ask someone there to add it again.",
    "name_mismatch": "That name doesn’t match the account for this number.",
    "invalid_invite": "That home code isn’t working. It may have expired — ask for a new one.",
    "phone_in_other_home": "This number already belongs to another home.",
    "phone_taken": "Someone already uses this number.",
    "rate_limited": "Too many codes for this number. Please try again later.",
    "resend_too_soon": "Please wait a moment before asking for another code.",
    "no_code": "Ask for a code first.",
    "expired": "That code has expired. Send a new one.",
    "wrong_code": "That code isn’t right. Check it and try again.",
    "too_many_attempts": "Too many tries. Send a new code.",
    "not_allowed": "You can’t do that for this home.",
}


class AuthRefused(Exception):
    def __init__(self, error: str, **detail: Any):
        super().__init__(error)
        self.error = error
        self.message = MESSAGES[error]
        self.detail = detail


@dataclass(frozen=True)
class CodeSent:
    code: str
    """Text this to the phone. Never store or log it."""
    expires_at: datetime
    resend_after: datetime


@dataclass(frozen=True)
class SignedIn:
    member: Member
    session: AuthSession
    token: str
    """Given to the phone once; only its hash is stored."""
    created: bool
    """True when this was a sign-up."""
    replaced: AuthSession | None
    """The other phone this sign-in signed out, if any."""


@dataclass(frozen=True)
class SessionCheck:
    status: str
    """"active", "revoked" or "unknown"."""
    member: Member | None = None
    reason: SessionEndReason | None = None
    now_on: str | None = None
    """When replaced: the label of the phone they are signed in on now."""


# ---------------------------------------------------------------- helpers

def name_key(name: str) -> str:
    """"  Lakshmi  Rao" and "lakshmirao" are the same name."""

    return re.sub(r"\s+", "", name).lower()


def clean_name(name: str | None) -> str:
    return " ".join((name or "").split())


def _secret() -> bytes:
    return os.environ.get("AUTH_SECRET", "dev-only-change-me").encode()


def hash_code(phone: str, purpose: OtpPurpose, code: str) -> str:
    """HMAC, not a bare hash: six digits are trivial to brute-force without the secret."""

    return hmac.new(_secret(), f"{purpose.value}:{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_invite(code: str) -> str:
    """"hrth 4k9p", "4K9P" → "HRTH-4K9P"."""

    raw = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    if raw.startswith(INVITE_PREFIX[:-1]):
        raw = raw[len(INVITE_PREFIX) - 1:]
    return INVITE_PREFIX + raw


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _log(s: Session, kind: AuthEventKind, now: datetime, *, phone: str | None = None,
         member: Member | None = None, household_id: str | None = None,
         session_id: str | None = None, **detail: Any) -> None:
    s.add(AuthEvent(
        at=now, kind=kind, phone=phone,
        member_id=member.id if member else None,
        household_id=household_id or (member.household_id if member else None),
        session_id=session_id, detail_json=detail or None,
    ))


def _refuse(s: Session, now: datetime, error: str, *, phone: str | None = None,
            member: Member | None = None, purpose: OtpPurpose | None = None, **detail: Any):
    _log(s, AuthEventKind.REFUSED, now, phone=phone, member=member, error=error,
         **({"purpose": purpose.value} if purpose else {}))
    raise AuthRefused(error, **detail)


def member_by_phone(s: Session, phone: str) -> Member | None:
    return s.exec(select(Member).where(Member.phone == phone)).first()


def has_joined(s: Session, member_id: str) -> bool:
    """Has this person ever signed in? Before that, the row is an invite the owner made."""

    return s.exec(select(AuthSession.id).where(AuthSession.member_id == member_id)).first() is not None


def _open_code(s: Session, phone: str, purpose: OtpPurpose) -> OtpCode | None:
    return s.exec(
        select(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.purpose == purpose, col(OtpCode.consumed_at).is_(None))
        .order_by(col(OtpCode.sent_at).desc())
    ).first()


def _codes_sent_since(s: Session, phone: str, since: datetime) -> int:
    return s.exec(
        select(func.count()).select_from(AuthEvent)
        .where(AuthEvent.phone == phone, AuthEvent.kind == AuthEventKind.CODE_SENT, AuthEvent.at > since)
    ).one()


def _valid_invite(s: Session, code: str, now: datetime) -> HouseholdInvite | None:
    inv = s.exec(select(HouseholdInvite).where(HouseholdInvite.code == normalize_invite(code))).first()
    if inv is None or inv.revoked_at is not None or now >= as_utc(inv.expires_at):
        return None
    return inv


def _active_session(s: Session, member_id: str) -> AuthSession | None:
    return s.exec(
        select(AuthSession).where(AuthSession.member_id == member_id, col(AuthSession.revoked_at).is_(None))
    ).first()


def _end(s: Session, row: AuthSession, reason: SessionEndReason, now: datetime) -> None:
    row.revoked_at = now
    row.revoked_reason = reason
    s.add(row)


# ---------------------------------------------------------------- codes

def request_code(
    s: Session, *, purpose: OtpPurpose, phone: str, now: datetime, name: str | None = None,
    relation: str | None = None, invite_code: str | None = None, member_id: str | None = None,
    rng: Random | None = None,
) -> CodeSent:
    """Checks the person may have a code, then makes one. `member_id` is for change_phone."""

    now = as_utc(now)
    if not _E164.match(phone):
        _refuse(s, now, "invalid_phone", purpose=purpose)
    if (_codes_sent_since(s, phone, now - timedelta(hours=1)) >= CODES_PER_HOUR
            or _codes_sent_since(s, phone, now - timedelta(days=1)) >= CODES_PER_DAY):
        _refuse(s, now, "rate_limited", phone=phone, purpose=purpose)
    prev = _open_code(s, phone, purpose)
    if prev is not None and now < as_utc(prev.resend_after):
        _refuse(s, now, "resend_too_soon", phone=phone, purpose=purpose, resend_after=as_utc(prev.resend_after))

    existing = member_by_phone(s, phone)
    who: Member | None = existing
    invite: HouseholdInvite | None = None

    if purpose is OtpPurpose.SIGN_IN:
        if not clean_name(name):
            _refuse(s, now, "invalid_name", phone=phone, purpose=purpose)
        if existing is None:
            _refuse(s, now, "no_account", phone=phone, purpose=purpose)
        assert existing is not None
        if not existing.is_active:
            _refuse(s, now, "removed", phone=phone, member=existing, purpose=purpose)
        if name_key(existing.name) != name_key(name or ""):
            _refuse(s, now, "name_mismatch", phone=phone, member=existing, purpose=purpose)

    elif purpose is OtpPurpose.SIGN_UP:
        if not clean_name(name):
            _refuse(s, now, "invalid_name", phone=phone, purpose=purpose)
        if existing is not None and not existing.is_active:
            _refuse(s, now, "removed", phone=phone, member=existing, purpose=purpose)
        if existing is not None and has_joined(s, existing.id):
            _refuse(s, now, "account_exists", phone=phone, member=existing, purpose=purpose)
        if not clean_name(relation) and not (existing and existing.relation):
            _refuse(s, now, "invalid_relation", phone=phone, purpose=purpose)
        if invite_code:
            invite = _valid_invite(s, invite_code, now)
            if invite is None:
                _refuse(s, now, "invalid_invite", phone=phone, purpose=purpose)
            assert invite is not None
            if existing is not None and existing.household_id != invite.household_id:
                _refuse(s, now, "phone_in_other_home", phone=phone, member=existing, purpose=purpose)

    else:  # change_phone
        who = s.get(Member, member_id) if member_id else None
        if who is None or not who.is_active:
            _refuse(s, now, "no_account", phone=phone, purpose=purpose)
        if existing is not None:
            _refuse(s, now, "phone_taken", phone=phone, member=who, purpose=purpose)

    if prev is not None:
        s.delete(prev)  # a new code replaces the old one
    r = rng or secrets.SystemRandom()
    code = "".join(str(r.randrange(10)) for _ in range(CODE_LENGTH))
    row = OtpCode(
        id=_id("otp"), phone=phone, purpose=purpose, code_hash=hash_code(phone, purpose, code),
        member_id=who.id if purpose is OtpPurpose.CHANGE_PHONE and who else None,
        pending_name=clean_name(name) if purpose is OtpPurpose.SIGN_UP else None,
        pending_relation=clean_name(relation) or None if purpose is OtpPurpose.SIGN_UP else None,
        invite_id=invite.id if invite else None,
        sent_at=now, expires_at=now + CODE_TTL, resend_after=now + RESEND_AFTER, attempts_left=MAX_ATTEMPTS,
    )
    s.add(row)
    _log(s, AuthEventKind.CODE_SENT, now, phone=phone, member=who, purpose=purpose.value)
    return CodeSent(code=code, expires_at=row.expires_at, resend_after=row.resend_after)


def _consume(s: Session, phone: str, purpose: OtpPurpose, code: str, now: datetime) -> OtpCode:
    row = _open_code(s, phone, purpose)
    if row is None:
        _refuse(s, now, "no_code", phone=phone, purpose=purpose)
    assert row is not None
    if now >= as_utc(row.expires_at):
        row.consumed_at = now
        s.add(row)
        _log(s, AuthEventKind.CODE_EXPIRED, now, phone=phone, purpose=purpose.value)
        raise AuthRefused("expired")
    if not hmac.compare_digest(row.code_hash, hash_code(phone, purpose, re.sub(r"\D", "", code))):
        row.attempts_left = max(0, row.attempts_left - 1)
        if row.attempts_left == 0:
            row.consumed_at = now
            s.add(row)
            _log(s, AuthEventKind.CODE_LOCKED, now, phone=phone, purpose=purpose.value)
            raise AuthRefused("too_many_attempts")
        s.add(row)
        _log(s, AuthEventKind.CODE_FAILED, now, phone=phone, purpose=purpose.value,
             attempts_left=row.attempts_left)
        raise AuthRefused("wrong_code", attempts_left=row.attempts_left)
    row.consumed_at = now
    s.add(row)
    return row


# ---------------------------------------------------------------- sign in / up

def verify_sign_in(
    s: Session, *, purpose: OtpPurpose, phone: str, code: str, now: datetime,
    device_id: str | None = None, device_label: str | None = None,
) -> SignedIn:
    """The code is right → the account (new for sign-up) gets this phone's session."""

    if purpose is OtpPurpose.CHANGE_PHONE:
        raise ValueError("use verify_phone_change")
    now = as_utc(now)
    row = _consume(s, phone, purpose, code, now)
    member = member_by_phone(s, phone)
    created = purpose is OtpPurpose.SIGN_UP

    if purpose is OtpPurpose.SIGN_IN:
        if member is None or not member.is_active:
            _refuse(s, now, "no_account", phone=phone, purpose=purpose)
        assert member is not None
    else:
        # Re-checked: things can change in the five minutes the code was out.
        if member is not None and (has_joined(s, member.id) or not member.is_active):
            _refuse(s, now, "account_exists", phone=phone, member=member, purpose=purpose)
        invite = s.get(HouseholdInvite, row.invite_id) if row.invite_id else None
        if row.invite_id and (invite is None or _valid_invite(s, invite.code, now) is None):
            _refuse(s, now, "invalid_invite", phone=phone, purpose=purpose)
        if member is not None and invite is not None and member.household_id != invite.household_id:
            _refuse(s, now, "phone_in_other_home", phone=phone, member=member, purpose=purpose)
        name = row.pending_name or ""

        if member is not None:
            # The owner added this number already: claim that row. The typed name wins.
            member.name = name
            member.relation = row.pending_relation or member.relation
            s.add(member)
            how = "claimed"
        elif invite is not None:
            member = Member(id=_id("m"), household_id=invite.household_id, name=name,
                            relation=row.pending_relation, phone=phone, role=MemberRole.MEMBER)
            s.add(member)
            invite.uses += 1
            s.add(invite)
            _log(s, AuthEventKind.INVITE_USED, now, phone=phone, household_id=invite.household_id,
                 invite_id=invite.id)
            how = "invite"
        else:
            household = Household(id=_id("h"), name=f"{name}’s home")
            s.add(household)
            member = Member(id=_id("m"), household_id=household.id, name=name,
                            relation=row.pending_relation, phone=phone, role=MemberRole.OWNER)
            s.add(member)
            how = "new_home"
        s.flush()
        _log(s, AuthEventKind.SIGNED_UP, now, phone=phone, member=member, how=how)

    session, token, replaced = _start_session(s, member, now, device_id, device_label)
    return SignedIn(member=member, session=session, token=token, created=created, replaced=replaced)


def _start_session(s: Session, member: Member, now: datetime, device_id: str | None,
                   device_label: str | None) -> tuple[AuthSession, str, AuthSession | None]:
    replaced = _active_session(s, member.id)
    if replaced is not None:
        _end(s, replaced, SessionEndReason.REPLACED, now)
        _log(s, AuthEventKind.SESSION_REPLACED, now, phone=member.phone, member=member,
             session_id=replaced.id, by_device=device_label)
        s.flush()  # free the one-active-session slot before the new row goes in
    token = secrets.token_urlsafe(32)
    session = AuthSession(id=_id("as"), member_id=member.id, device_id=device_id, device_label=device_label,
                          token_hash=hash_token(token), created_at=now, last_seen_at=now)
    s.add(session)
    s.flush()
    _log(s, AuthEventKind.SIGNED_IN, now, phone=member.phone, member=member, session_id=session.id)
    return session, token, replaced


def authenticate(s: Session, token: str, now: datetime) -> SessionCheck:
    """Every request: is this phone still signed in, and as whom?"""

    now = as_utc(now)
    row = s.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(token))).first()
    if row is None:
        return SessionCheck("unknown")
    member = s.get(Member, row.member_id)
    if row.revoked_at is None and (member is None or not member.is_active):
        _end(s, row, SessionEndReason.REMOVED, now)
    if row.revoked_at is not None:
        now_on = None
        if row.revoked_reason is SessionEndReason.REPLACED and (current := _active_session(s, row.member_id)):
            now_on = current.device_label
        return SessionCheck("revoked", member=member, reason=row.revoked_reason, now_on=now_on)
    row.last_seen_at = now
    s.add(row)
    return SessionCheck("active", member=member)


def sign_out(s: Session, token: str, now: datetime) -> bool:
    now = as_utc(now)
    row = s.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(token))).first()
    if row is None or row.revoked_at is not None:
        return False
    _end(s, row, SessionEndReason.SIGNED_OUT, now)
    member = s.get(Member, row.member_id)
    _log(s, AuthEventKind.SIGNED_OUT, now, phone=member.phone if member else None, member=member,
         session_id=row.id)
    return True


def revoke_member_sessions(s: Session, member_id: str, now: datetime,
                           reason: SessionEndReason = SessionEndReason.REMOVED) -> int:
    """Someone was taken out of the home (set `member.is_active = False` too)."""

    now = as_utc(now)
    rows = s.exec(
        select(AuthSession).where(AuthSession.member_id == member_id, col(AuthSession.revoked_at).is_(None))
    ).all()
    for row in rows:
        _end(s, row, reason, now)
    if rows:
        _log(s, AuthEventKind.SESSIONS_REVOKED, now, member=s.get(Member, member_id), reason=reason.value)
    return len(rows)


# ---------------------------------------------------------------- phone change

def verify_phone_change(s: Session, *, member_id: str, phone: str, code: str, now: datetime) -> Member:
    """The code sent to the new number is right → it becomes the sign-in number."""

    now = as_utc(now)
    row = _consume(s, phone, OtpPurpose.CHANGE_PHONE, code, now)
    member = s.get(Member, member_id)
    if member is None or row.member_id != member_id or not member.is_active:
        _refuse(s, now, "not_allowed", phone=phone, purpose=OtpPurpose.CHANGE_PHONE)
    assert member is not None
    if member_by_phone(s, phone) is not None:
        _refuse(s, now, "phone_taken", phone=phone, member=member, purpose=OtpPurpose.CHANGE_PHONE)
    old = member.phone
    member.phone = phone
    s.add(member)
    _log(s, AuthEventKind.PHONE_CHANGED, now, phone=phone, member=member, old_phone=old)
    return member


# ---------------------------------------------------------------- home codes

def create_invite(s: Session, *, member_id: str, now: datetime, rng: Random | None = None) -> HouseholdInvite:
    """Any member of the home can make a code; it works for 7 days, for anyone."""

    now = as_utc(now)
    member = s.get(Member, member_id)
    if member is None or not member.is_active:
        _refuse(s, now, "not_allowed")
    assert member is not None
    r = rng or secrets.SystemRandom()
    while True:
        code = INVITE_PREFIX + "".join(r.choice(INVITE_ALPHABET) for _ in range(4))
        if s.exec(select(HouseholdInvite.id).where(HouseholdInvite.code == code)).first() is None:
            break
    inv = HouseholdInvite(id=_id("inv"), household_id=member.household_id, code=code,
                          created_by_member_id=member.id, created_at=now, expires_at=now + INVITE_TTL)
    s.add(inv)
    s.flush()
    _log(s, AuthEventKind.INVITE_CREATED, now, member=member, invite_id=inv.id)
    return inv


def revoke_invite(s: Session, *, invite_id: str, member_id: str, now: datetime) -> HouseholdInvite:
    now = as_utc(now)
    inv = s.get(HouseholdInvite, invite_id)
    member = s.get(Member, member_id)
    if inv is None or member is None or not member.is_active or member.household_id != inv.household_id:
        _refuse(s, now, "not_allowed")
    assert inv is not None
    if inv.revoked_at is None:
        inv.revoked_at = now
        s.add(inv)
        _log(s, AuthEventKind.INVITE_REVOKED, now, member=member, invite_id=inv.id)
    return inv


# ---------------------------------------------------------------- retention

def purge(s: Session, now: datetime) -> dict[str, int]:
    """Daily job: used/expired codes after 24 h, login log after a year."""

    now = as_utc(now)
    cutoff = now - CODE_RETENTION
    codes = s.execute(delete(OtpCode).where(or_(
        and_(col(OtpCode.consumed_at).is_not(None), col(OtpCode.consumed_at) < cutoff),
        and_(col(OtpCode.consumed_at).is_(None), col(OtpCode.expires_at) < cutoff),
    )))
    events = s.execute(delete(AuthEvent).where(col(AuthEvent.at) < now - EVENT_RETENTION))
    return {"otp_code": codes.rowcount, "auth_event": events.rowcount}  # type: ignore[attr-defined]
