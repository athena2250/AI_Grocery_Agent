"""Passkey Issue: who is waiting to sign in, and the passkeys the admin gives out.

Unlike the rest of the console, numbers are shown in full here: the admin has to recognise who
is asking before giving them a way in. A passkey is returned once, to the admin who made it,
and never stored or logged in plain.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlmodel import Session, col, select

from app.auth import store as auth
from app.auth.models import AuthSession, MemberPasskey
from app.core.models import Household, Member, MemberRole

from .actions import NotFound, Refused, _log
from .queries import iso


def _refused(e: auth.AuthRefused) -> Refused:
    return Refused(e.message)


def overview(s: Session) -> dict[str, Any]:
    homes = {h.id: h.name for h in s.exec(select(Household)).all()}
    members = s.exec(select(Member).where(col(Member.is_active).is_(True))).all()
    by_phone = {m.phone: m for m in members if m.phone}
    keys = {k.member_id: k for k in s.exec(select(MemberPasskey)).all()}
    signed_in = {a.member_id: a for a in s.exec(
        select(AuthSession).where(col(AuthSession.revoked_at).is_(None))).all()}

    def key_json(m: Member) -> dict[str, Any] | None:
        k = keys.get(m.id)
        return {"issued_at": iso(k.issued_at), "issued_by": k.issued_by,
                "locked_until": iso(k.locked_until)} if k else None

    requests = []
    for r in auth.pending_requests(s):
        known = by_phone.get(r.phone)
        requests.append({
            "id": r.id, "name": r.name, "phone": r.phone, "first_at": iso(r.first_at),
            "last_at": iso(r.last_at), "times": r.times,
            "member": {"id": known.id, "name": known.name, "relation": known.relation,
                       "household_id": known.household_id, "household": homes.get(known.household_id),
                       "passkey": key_json(known)} if known else None,
        })
    people = sorted(members, key=lambda m: (homes.get(m.household_id, ""), m.created_at))
    return {
        "requests": requests,
        "homes": [{"id": hid, "name": name} for hid, name in homes.items()],
        "members": [{
            "id": m.id, "name": m.name, "relation": m.relation, "phone": m.phone, "role": m.role.value,
            "household_id": m.household_id, "household": homes.get(m.household_id),
            "passkey": key_json(m),
            "signed_in": {"device": signed_in[m.id].device_label,
                          "last_seen": iso(signed_in[m.id].last_seen_at)} if m.id in signed_in else None,
        } for m in people],
    }


def approve(s: Session, admin: str, rid: str, household_id: str | None, relation: str | None,
            role: str, now: datetime) -> dict[str, Any]:
    try:
        member, passkey = auth.approve_request(
            s, request_id=rid, now=now, by=admin, household_id=household_id or None,
            relation=relation, role=MemberRole(role or "member"))
    except auth.AuthRefused as e:
        raise _refused(e) from None
    _log(s, admin, "passkey_issued", "member", member.id, member.household_id, now,
         None, request_id=rid, phone=member.phone)
    return {"passkey": auth.format_passkey(passkey), "name": member.name, "phone": member.phone,
            "household_id": member.household_id}


def dismiss(s: Session, admin: str, rid: str, now: datetime) -> dict[str, Any]:
    try:
        req = auth.dismiss_request(s, request_id=rid, now=now, by=admin)
    except auth.AuthRefused as e:
        raise _refused(e) from None
    _log(s, admin, "join_request_dismissed", "join_request", rid, None, now, None, phone=req.phone)
    return {"dismissed": rid}


def issue(s: Session, admin: str, mid: str, now: datetime) -> dict[str, Any]:
    m = s.get(Member, mid)
    if m is None:
        raise NotFound(f"member {mid}")
    replacing = s.get(MemberPasskey, mid) is not None
    try:
        passkey = auth.issue_passkey(s, member_id=mid, now=now, by=admin)
    except auth.AuthRefused as e:
        raise _refused(e) from None
    _log(s, admin, "passkey_reset" if replacing else "passkey_issued", "member", mid,
         m.household_id, now, None, phone=m.phone)
    return {"passkey": auth.format_passkey(passkey), "name": m.name, "phone": m.phone, "replaced": replacing}
