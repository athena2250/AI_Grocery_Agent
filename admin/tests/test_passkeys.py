"""Passkey Issue: waiting list → Generate passkey → the phone signs in with it; resets and dismissals."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import store
from app.core.sqltypes import utcnow
from hearth_admin import db
from hearth_admin.main import app

TOKEN = "test-token"
H = {"Authorization": f"Bearer {TOKEN}", "X-Admin-Name": "Priya"}
RAVI = "+919811112222"


@pytest.fixture()
def client(demo, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    db.set_engine(demo)
    c = TestClient(app)
    c.engine = demo  # type: ignore[attr-defined]
    yield c
    db.set_engine(None)  # type: ignore[arg-type]


def phone_asks(c, phone=RAVI, name="Ravi"):
    with Session(c.engine) as s:
        store.request_access(s, phone=phone, name=name, now=utcnow())
        s.commit()


def phone_signs_in(c, passkey, phone=RAVI, name="Ravi"):
    with Session(c.engine) as s:
        r = store.sign_in_with_passkey(s, phone=phone, name=name, passkey=passkey, now=utcnow())
        s.commit()
        return r.member.id


def test_someone_asking_shows_up_waiting_with_their_full_number(client):
    assert client.get("/api/passkeys/waiting", headers=H).json() == []
    phone_asks(client)
    waiting = client.get("/api/passkeys/waiting", headers=H).json()
    assert [(w["name"], w["phone"]) for w in waiting] == [("Ravi", RAVI)]


def test_generate_passkey_adds_them_and_the_passkey_works_on_the_phone(client):
    phone_asks(client)
    rid = client.get("/api/passkeys/waiting", headers=H).json()[0]["id"]
    r = client.post(f"/api/passkeys/requests/{rid}/approve", headers=H,
                    json={"household_id": "h_home", "relation": "Dad", "role": "member"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["household_id"] == "h_home" and len(out["passkey"]) == 9 and out["passkey"][4] == "-"
    assert client.get("/api/passkeys/waiting", headers=H).json() == []

    mid = phone_signs_in(client, out["passkey"])
    person = next(m for m in client.get("/api/passkeys", headers=H).json()["members"] if m["id"] == mid)
    assert person["passkey"]["issued_by"] == "Priya" and person["signed_in"] is not None

    audit = client.get("/api/audit", headers=H).json()
    assert audit[0]["action"] == "passkey_issued" and out["passkey"] not in str(audit[0])  # never logged

    again = client.post(f"/api/passkeys/requests/{rid}/approve", headers=H, json={})
    assert again.status_code == 409 and "already answered" in again.json()["detail"]


def test_reset_gives_a_new_passkey_and_signs_them_out(client):
    phone_asks(client)
    rid = client.get("/api/passkeys/waiting", headers=H).json()[0]["id"]
    first = client.post(f"/api/passkeys/requests/{rid}/approve", headers=H, json={"household_id": "h_home"}).json()
    mid = phone_signs_in(client, first["passkey"])

    r = client.post(f"/api/members/{mid}/passkey", headers=H).json()
    assert r["replaced"] is True
    person = next(m for m in client.get("/api/passkeys", headers=H).json()["members"] if m["id"] == mid)
    assert person["signed_in"] is None
    assert phone_signs_in(client, r["passkey"]) == mid
    assert client.get("/api/audit", headers=H).json()[0]["action"] == "passkey_reset"


def test_dismiss_takes_them_off_the_list(client):
    phone_asks(client)
    rid = client.get("/api/passkeys/waiting", headers=H).json()[0]["id"]
    assert client.post(f"/api/passkeys/requests/{rid}/dismiss", headers=H).status_code == 200
    assert client.get("/api/passkeys/waiting", headers=H).json() == []


def test_unknown_member_and_no_token(client):
    assert client.post("/api/members/m_nobody/passkey", headers=H).status_code == 404
    assert client.get("/api/passkeys").status_code == 401
