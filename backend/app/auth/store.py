"""Sign-in rules over the auth tables. Deterministic; writes are added to the session.

The caller commits — on success *and* on `AuthRefused`, since refusals and wrong passkeys are
recorded before the error is raised (the log and the lockout count must survive a refusal).

Flow (the mobile `AuthService` shapes map onto these):
  request_access(phone, name)                     → a join request for the admin (always "ok")
  approve_request / issue_passkey                 → admin console: adds them, makes a passkey
  sign_in_with_passkey(phone, name, passkey)      → `SignedIn.token` goes to the phone
  authenticate(token)                             → every request after that
  sign_out(token)

Rules (agreed 2026-10-10):
- No OTP, no self sign-up. The admin adds each person to a home and gives them a passkey
  ("K7M4-PX9Q": 8 characters, no look-alikes), read out to them in person or on a call.
- The phone is the account. Sign-in needs number + name (case and spaces ignored) + passkey.
  Every mismatch gets the same answer, so a stranger learns nothing about a number.
- 5 wrong tries lock the number for 15 minutes. A new passkey ends the old one and signs that
  person out everywhere.
- Asking to join never says whether the number already has a passkey; repeat asks update the
  one pending request.
- One signed-in phone per person: signing in elsewhere ends the old session ("replaced").
- Sessions end on sign-out or after 90 days without use.
- Retention: answered join requests after 30 days, the login log after one year (`purge`).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from random import Random
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, or_
from sqlmodel import Session, col, func, select

from app.core.models import Household, Member, MemberRole
from app.memory.rules import as_utc

from .models import (
    AuthEvent,
    AuthEventKind,
    AuthSession,
    JoinRequest,
    JoinRequestStatus,
    MemberPasskey,
    SessionEndReason,
)

PASSKEY_LENGTH = 8
PASSKEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
"""No 0/O, 1/I/L — read out over the phone without mix-ups."""
MAX_ATTEMPTS = 5
LOCK_FOR = timedelta(minutes=15)
SESSION_IDLE = timedelta(days=90)
MAX_PENDING_REQUESTS = 50
"""Past this, new asks are dropped quietly: nobody can flood the admin's list."""
REQUEST_RETENTION = timedelta(days=30)
EVENT_RETENTION = timedelta(days=365)

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

MESSAGES = {
    "invalid_phone": "That doesn’t look like a mobile number.",
    "invalid_name": "Please tell us your name.",
    "invalid_passkey": f"The passkey has {PASSKEY_LENGTH} letters and numbers.",
    "wrong_details": "Those details don’t match. Check your name, number and passkey.",
    "locked": "Too many tries. Wait 15 minutes, or ask the admin for a new passkey.",
    "rate_limited": "Too many tries. Please try again later.",
    "not_allowed": "You can’t do that for this home.",
    "not_pending": "That request was already answered.",
    "removed": "This person was taken out of their home. Restore them first.",
    "no_home": "That home doesn’t exist.",
}


class AuthRefused(Exception):
    def __init__(self, error: str, **detail: Any):
        super().__init__(error)
        self.error = error
        self.message = MESSAGES[error]
        self.detail = detail


@dataclass(frozen=True)
class SignedIn:
    member: Member
    session: AuthSession
    token: str
    """Given to the phone once; only its hash is stored."""
    created: bool
    """True on this person's first sign-in."""
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


def normalize_passkey(typed: str) -> str:
    """"k7m4 - px9q" → "K7M4PX9Q"."""

    return re.sub(r"[^A-Za-z0-9]", "", typed).upper()


def format_passkey(passkey: str) -> str:
    """"K7M4PX9Q" → "K7M4-PX9Q", as shown to the admin and typed on the phone."""

    k = normalize_passkey(passkey)
    return f"{k[:4]}-{k[4:]}"


def hash_passkey(passkey: str, salt: bytes | None = None) -> str:
    """Slow on purpose (scrypt), salted per person, peppered with AUTH_SECRET."""

    salt = salt if salt is not None else secrets.token_bytes(16)
    dk = hashlib.scrypt(normalize_passkey(passkey).encode(), salt=salt + _secret(), **_SCRYPT)
    return f"scrypt${salt.hex()}${dk.hex()}"


def passkey_matches(stored: str, typed: str) -> bool:
    try:
        _, salt_hex, _ = stored.split("$")
        expected = hash_passkey(typed, bytes.fromhex(salt_hex))
    except ValueError:
        return False
    return hmac.compare_digest(stored, expected)


@lru_cache(maxsize=1)
def _decoy() -> str:
    """Checked against when there is no passkey, so an unknown number answers just as slowly."""

    return hash_passkey("decoy")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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
            member: Member | None = None, **detail: Any):
    _log(s, AuthEventKind.REFUSED, now, phone=phone, member=member, error=error)
    raise AuthRefused(error, **detail)


def member_by_phone(s: Session, phone: str) -> Member | None:
    return s.exec(select(Member).where(Member.phone == phone)).first()


def has_joined(s: Session, member_id: str) -> bool:
    """Has this person ever signed in?"""

    return s.exec(select(AuthSession.id).where(AuthSession.member_id == member_id)).first() is not None


def _active_session(s: Session, member_id: str) -> AuthSession | None:
    return s.exec(
        select(AuthSession).where(AuthSession.member_id == member_id, col(AuthSession.revoked_at).is_(None))
    ).first()


def _end(s: Session, row: AuthSession, reason: SessionEndReason, now: datetime) -> None:
    row.revoked_at = now
    row.revoked_reason = reason
    s.add(row)


def _pending_for(s: Session, phone: str) -> JoinRequest | None:
    return s.exec(select(JoinRequest).where(
        JoinRequest.phone == phone, JoinRequest.status == JoinRequestStatus.PENDING)).first()


# ---------------------------------------------------------------- asking to join

def request_access(s: Session, *, phone: str, name: str, now: datetime) -> None:
    """Name + number from a phone → the admin's list. The answer is the same whether or not the
    number already has a passkey; only the typing itself (bad number, no name) is refused."""

    now = as_utc(now)
    if not _E164.match(phone):
        raise AuthRefused("invalid_phone")
    if not clean_name(name):
        raise AuthRefused("invalid_name")
    member = member_by_phone(s, phone)
    if member is not None and s.get(MemberPasskey, member.id) is not None:
        return  # already set up: they only need the passkey they have
    pending = _pending_for(s, phone)
    if pending is not None:
        pending.name, pending.last_at, pending.times = clean_name(name), now, pending.times + 1
        s.add(pending)
        return
    waiting = s.exec(select(func.count()).select_from(JoinRequest)
                     .where(JoinRequest.status == JoinRequestStatus.PENDING)).one()
    if waiting >= MAX_PENDING_REQUESTS:
        return
    s.add(JoinRequest(id=_id("jr"), phone=phone, name=clean_name(name), first_at=now, last_at=now))


def pending_requests(s: Session) -> list[JoinRequest]:
    return list(s.exec(select(JoinRequest).where(JoinRequest.status == JoinRequestStatus.PENDING)
                       .order_by(col(JoinRequest.last_at).desc())).all())


# ---------------------------------------------------------------- admin: passkeys

def issue_passkey(s: Session, *, member_id: str, now: datetime, by: str, rng: Random | None = None) -> str:
    """A new passkey for this person; returns it (shown to the admin once, never stored).
    Replacing one ends the old passkey and signs them out everywhere."""

    now = as_utc(now)
    member = s.get(Member, member_id)
    if member is None:
        raise AuthRefused("not_allowed")
    if not member.is_active:
        raise AuthRefused("removed")
    r = rng or secrets.SystemRandom()
    passkey = "".join(r.choice(PASSKEY_ALPHABET) for _ in range(PASSKEY_LENGTH))
    row = s.get(MemberPasskey, member_id)
    if row is None:
        row = MemberPasskey(member_id=member_id, passkey_hash=hash_passkey(passkey), issued_at=now, issued_by=by)
    else:
        row.passkey_hash, row.issued_at, row.issued_by = hash_passkey(passkey), now, by
        row.failed_attempts, row.locked_until = 0, None
        revoke_member_sessions(s, member_id, now, SessionEndReason.SIGNED_OUT)
    s.add(row)
    # Anything they were waiting on is answered now.
    if member.phone and (pending := _pending_for(s, member.phone)) is not None:
        _resolve(s, pending, JoinRequestStatus.APPROVED, now, by, member.id)
    return passkey


def _resolve(s: Session, req: JoinRequest, status: JoinRequestStatus, now: datetime, by: str,
             member_id: str | None = None) -> None:
    req.status, req.resolved_at, req.resolved_by, req.member_id = status, now, by, member_id
    s.add(req)


def approve_request(
    s: Session, *, request_id: str, now: datetime, by: str, household_id: str | None = None,
    relation: str | None = None, role: MemberRole = MemberRole.MEMBER, rng: Random | None = None,
) -> tuple[Member, str]:
    """Adds the person who asked (to `household_id`, or a new home with them as owner) and issues
    their passkey. A number that already belongs to someone keeps that person and their home."""

    now = as_utc(now)
    req = s.get(JoinRequest, request_id)
    if req is None or req.status is not JoinRequestStatus.PENDING:
        raise AuthRefused("not_pending")
    member = member_by_phone(s, req.phone)
    if member is not None:
        if not member.is_active:
            raise AuthRefused("removed")
        if clean_name(relation):
            member.relation = clean_name(relation)
            s.add(member)
    else:
        if household_id:
            if s.get(Household, household_id) is None:
                raise AuthRefused("no_home")
        else:
            household = Household(id=_id("h"), name=f"{req.name}’s home")
            s.add(household)
            household_id, role = household.id, MemberRole.OWNER
        member = Member(id=_id("m"), household_id=household_id, name=req.name,
                        relation=clean_name(relation) or None, phone=req.phone, role=role)
        s.add(member)
        s.flush()
    passkey = issue_passkey(s, member_id=member.id, now=now, by=by, rng=rng)
    _resolve(s, req, JoinRequestStatus.APPROVED, now, by, member.id)
    return member, passkey


def dismiss_request(s: Session, *, request_id: str, now: datetime, by: str) -> JoinRequest:
    req = s.get(JoinRequest, request_id)
    if req is None or req.status is not JoinRequestStatus.PENDING:
        raise AuthRefused("not_pending")
    _resolve(s, req, JoinRequestStatus.DISMISSED, as_utc(now), by)
    return req


# ---------------------------------------------------------------- signing in

def sign_in_with_passkey(
    s: Session, *, phone: str, name: str, passkey: str, now: datetime,
    device_id: str | None = None, device_label: str | None = None,
) -> SignedIn:
    """Number + name + passkey → this phone's session. Any mismatch is "wrong_details"."""

    now = as_utc(now)
    if not clean_name(name):
        raise AuthRefused("invalid_name")
    if len(normalize_passkey(passkey)) != PASSKEY_LENGTH:
        raise AuthRefused("invalid_passkey")
    member = member_by_phone(s, phone) if _E164.match(phone) else None
    row = s.get(MemberPasskey, member.id) if member is not None else None

    if row is not None and row.locked_until is not None and now < as_utc(row.locked_until):
        _refuse(s, now, "locked", phone=phone, member=member, locked_until=as_utc(row.locked_until))

    right_key = passkey_matches(row.passkey_hash if row is not None else _decoy(), passkey)
    ok = (row is not None and member is not None and member.is_active and right_key
          and name_key(member.name) == name_key(name))
    if not ok:
        if row is None:
            _refuse(s, now, "wrong_details", phone=phone, member=member)
        assert row is not None
        row.failed_attempts += 1
        if row.failed_attempts >= MAX_ATTEMPTS:
            row.failed_attempts, row.locked_until = 0, now + LOCK_FOR
            s.add(row)
            _log(s, AuthEventKind.PASSKEY_LOCKED, now, phone=phone, member=member)
            raise AuthRefused("locked", locked_until=row.locked_until)
        s.add(row)
        _log(s, AuthEventKind.PASSKEY_FAILED, now, phone=phone, member=member,
             attempts_left=MAX_ATTEMPTS - row.failed_attempts)
        raise AuthRefused("wrong_details")

    assert member is not None and row is not None
    row.failed_attempts, row.locked_until = 0, None
    s.add(row)
    created = not has_joined(s, member.id)
    if created:
        _log(s, AuthEventKind.SIGNED_UP, now, phone=phone, member=member, how="passkey")
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
    elif row.revoked_at is None and now - as_utc(row.last_seen_at) > SESSION_IDLE:
        _end(s, row, SessionEndReason.SIGNED_OUT, now)  # a lost or forgotten phone
        _log(s, AuthEventKind.SESSIONS_REVOKED, now, phone=member.phone if member else None,
             member=member, session_id=row.id, reason="idle")
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
    """Someone was taken out of the home (set `member.is_active = False` too), or got a new passkey."""

    now = as_utc(now)
    rows = s.exec(
        select(AuthSession).where(AuthSession.member_id == member_id, col(AuthSession.revoked_at).is_(None))
    ).all()
    for row in rows:
        _end(s, row, reason, now)
    if rows:
        _log(s, AuthEventKind.SESSIONS_REVOKED, now, member=s.get(Member, member_id), reason=reason.value)
    return len(rows)


# ---------------------------------------------------------------- retention

def purge(s: Session, now: datetime) -> dict[str, int]:
    """Daily job: join requests 30 days after they were answered (or last asked), the log after a year."""

    now = as_utc(now)
    cutoff = now - REQUEST_RETENTION
    requests = s.execute(delete(JoinRequest).where(or_(
        col(JoinRequest.resolved_at) < cutoff,
        (col(JoinRequest.status) == JoinRequestStatus.PENDING) & (col(JoinRequest.last_at) < cutoff),
    )))
    events = s.execute(delete(AuthEvent).where(col(AuthEvent.at) < now - EVENT_RETENTION))
    return {"join_request": requests.rowcount, "auth_event": events.rowcount}  # type: ignore[attr-defined]


# ---------------------------------------------------------------- account deletion

DELETED_NAME = "Former member"


def delete_account(s: Session, *, member_id: str, now: datetime) -> bool:
    """"Delete my account" (App Store / Play rule). The row stays for the home's history
    (who added what) but no longer names or reaches the person: name, relation and number
    are cleared, every session ends, and their passkey, join requests and logged numbers go.
    An owner's role passes to the longest-standing member left. Returns True when nobody is
    left in the home, so the caller can drop the home's shared data too.
    """

    now = as_utc(now)
    member = s.get(Member, member_id)
    if member is None or not member.is_active:
        _refuse(s, now, "not_allowed")
    assert member is not None
    revoke_member_sessions(s, member.id, now, SessionEndReason.REMOVED)
    s.execute(delete(MemberPasskey).where(col(MemberPasskey.member_id) == member.id))
    if member.phone:
        s.execute(delete(JoinRequest).where(col(JoinRequest.phone) == member.phone))
    for ev in s.exec(select(AuthEvent).where(
            or_(col(AuthEvent.member_id) == member.id, col(AuthEvent.phone) == member.phone))):
        ev.phone = None
        s.add(ev)
    was_owner = member.role is MemberRole.OWNER
    member.name, member.relation, member.phone = DELETED_NAME, None, None
    member.is_active = False
    member.role = MemberRole.MEMBER
    s.add(member)
    s.flush()

    others = s.exec(
        select(Member).where(Member.household_id == member.household_id, col(Member.is_active).is_(True))
        .order_by(col(Member.created_at))
    ).all()
    if was_owner and others:
        others[0].role = MemberRole.OWNER
        s.add(others[0])
    _log(s, AuthEventKind.SESSIONS_REVOKED, now, household_id=member.household_id,
         member=member, reason="account_deleted")
    return not others
