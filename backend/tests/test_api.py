"""HTTP API: ask → admin approves → passkey sign-in → shared log → sign out / delete."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from app import db
from app import main as api
from app.auth import store
from app.core.sqltypes import utcnow

PRIYA = "+919876543210"
RAVI = "+919811112222"


@pytest.fixture()
def client(monkeypatch):
    # One in-memory DB shared by the test and the server's worker threads.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", db._sqlite_foreign_keys)
    monkeypatch.setattr(db, "_engine", engine)
    api._ip_hits.clear()
    with TestClient(api.app) as c:
        c.engine = engine  # type: ignore[attr-defined]
        yield c


def admin_approves(c, phone, household_id=None, relation="Mom"):
    """What the admin console does when the admin clicks Generate passkey."""
    with Session(c.engine) as s:
        req = next(r for r in store.pending_requests(s) if r.phone == phone)
        _, key = store.approve_request(s, request_id=req.id, now=utcnow(), by="Admin",
                                       household_id=household_id, relation=relation)
        s.commit()
    return store.format_passkey(key)


def join(c, phone=PRIYA, name="Priya", household_id=None, relation="Mom"):
    assert c.post("/auth/request", json={"phone": phone, "name": name}).json() == {}
    key = admin_approves(c, phone, household_id, relation)
    r = c.post("/auth/passkey", json={"phone": phone, "name": name, "passkey": key, "deviceLabel": "Pixel"})
    assert r.status_code == 200, r.text
    return r.json()


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_ask_then_passkey_starts_a_home_and_me_works(client):
    out = join(client)
    assert out["created"] is True
    assert out["account"]["role"] == "owner"
    r = client.get("/me", headers=bearer(out["token"]))
    assert r.json()["account"]["name"] == "Priya"


def test_errors_are_flat_and_friendly(client):
    r = client.post("/auth/passkey", json={"phone": PRIYA, "name": "Priya", "passkey": "K7M4-PX9Q"})
    assert r.status_code == 400
    assert r.json() == {"error": "wrong_details", "message": store.MESSAGES["wrong_details"]}
    assert client.post("/auth/request", json={"phone": "12345", "name": "P"}).json()["error"] == "invalid_phone"
    assert client.get("/me").json()["error"] == "signed_out"


def test_asking_never_says_whether_the_number_is_set_up(client):
    join(client)
    assert client.post("/auth/request", json={"phone": PRIYA, "name": "Priya"}).json() == {}
    assert client.post("/auth/request", json={"phone": RAVI, "name": "Ravi"}).json() == {}


def test_too_many_wrong_passkeys_lock_with_429(client):
    join(client)
    codes = [client.post("/auth/passkey", json={"phone": PRIYA, "name": "Priya", "passkey": "ZZZZ-ZZZZ"}).status_code
             for _ in range(store.MAX_ATTEMPTS)]
    assert codes == [400] * (store.MAX_ATTEMPTS - 1) + [429]


def test_joining_the_same_home_shares_events(client):
    priya = join(client)
    ravi = join(client, RAVI, "Ravi", household_id=priya["account"]["householdId"], relation="Dad")
    assert ravi["account"]["householdId"] == priya["account"]["householdId"]
    assert ravi["account"]["role"] == "member"

    ev = {"id": "ev_priya_0001", "at": "2026-10-06T09:00:00.120Z", "body": {"type": "ADD_ITEM"}}
    r = client.post("/sync/grocery", json={"events": [ev, ev]}, headers=bearer(priya["token"]))
    seqs = {a["seq"] for a in r.json()["accepted"]}
    assert len(seqs) == 1  # resending is a no-op

    got = client.get("/sync/grocery?after=0", headers=bearer(ravi["token"])).json()
    assert [e["id"] for e in got["events"]] == ["ev_priya_0001"]
    assert got["events"][0]["by"] == priya["account"]["memberId"]
    assert got["events"][0]["at"] == ev["at"]  # replays use it as "now": must round-trip exactly
    last = got["events"][-1]["seq"]
    assert client.get(f"/sync/grocery?after={last}", headers=bearer(ravi["token"])).json()["events"] == []
    assert client.get("/sync/tasks?after=0", headers=bearer(ravi["token"])).json()["events"] == []
    assert client.get("/sync/nope", headers=bearer(ravi["token"])).status_code == 404

    members = client.get("/household", headers=bearer(ravi["token"])).json()["members"]
    assert {m["name"] for m in members} == {"Priya", "Ravi"}


def test_other_homes_never_see_your_events(client):
    priya = join(client)
    other = join(client, RAVI, "Ravi", relation="Dad")
    client.post("/sync/tasks", json={"events": [{"id": "ev_secret_01", "at": "2026-10-06T09:00:00Z",
                                                 "body": {}}]}, headers=bearer(priya["token"]))
    assert client.get("/sync/tasks", headers=bearer(other["token"])).json()["events"] == []


def test_sign_out_ends_the_session(client):
    priya = join(client)
    assert client.post("/auth/sign-out", headers=bearer(priya["token"])).json() == {"ok": True}
    assert client.get("/me", headers=bearer(priya["token"])).status_code == 401


def test_delete_account_hands_over_the_home_and_frees_the_number(client):
    priya = join(client)
    ravi = join(client, RAVI, "Ravi", household_id=priya["account"]["householdId"], relation="Dad")
    client.post("/sync/grocery", json={"events": [{"id": "ev_keep_0001", "at": "2026-10-06T09:00:00Z",
                                                   "body": {}}]}, headers=bearer(priya["token"]))

    r = client.delete("/me", headers=bearer(priya["token"]))
    assert r.json() == {"ok": True, "householdDeleted": False}
    assert client.get("/me", headers=bearer(priya["token"])).status_code == 401
    members = client.get("/household", headers=bearer(ravi["token"])).json()["members"]
    assert [(m["name"], m["role"]) for m in members] == [("Ravi", "owner")]
    assert len(client.get("/sync/grocery", headers=bearer(ravi["token"])).json()["events"]) == 1

    # The number is free again: asking again makes a new account in a new home.
    again = join(client)
    assert again["account"]["householdId"] != priya["account"]["householdId"]

    # The last one out takes the home's data with them.
    r = client.delete("/me", headers=bearer(ravi["token"]))
    assert r.json()["householdDeleted"] is True


def test_tries_per_ip_are_capped(client, monkeypatch):
    monkeypatch.setattr(api, "AUTH_TRIES_PER_IP_PER_HOUR", 2)
    for i in range(2):
        client.post("/auth/request", json={"phone": f"+9198000000{i:02d}", "name": "X"})
    r = client.post("/auth/passkey", json={"phone": "+919800000099", "name": "X", "passkey": "K7M4PX9Q"})
    assert r.status_code == 429


def test_a_made_up_forwarded_for_does_not_get_round_the_ip_cap(client, monkeypatch):
    monkeypatch.setattr(api, "AUTH_TRIES_PER_IP_PER_HOUR", 2)
    def ask(i):
        return client.post("/auth/request", json={"phone": f"+9198000000{i:02d}", "name": "X"},
                           headers={"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.7"})  # proxy adds the last
    assert [ask(i).status_code for i in range(3)] == [200, 200, 429]


def test_privacy_and_health(client):
    assert "Privacy Policy" in client.get("/privacy").text
    assert client.get("/healthz").json() == {"ok": True}


class FakeLLM:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.seen = result, error, []

    async def extract(self, text):
        self.seen.append(text)
        if self.error:
            raise self.error
        return self.result


def test_understand_returns_the_extraction(client):
    from app.understanding.schema import LLMExtraction

    priya = join(client)
    api.app.state.llm = FakeLLM(LLMExtraction.model_validate({
        "intent": "UPDATE_INVENTORY",
        "inventory_updates": [{"raw_text": "biyyam aipovachindi", "product_guess": "rice", "state": "almost_finished"}],
    }))
    try:
        r = client.post("/understand", json={"text": "biyyam aipovachindi"}, headers=bearer(priya["token"]))
        assert r.status_code == 200
        ext = r.json()["extraction"]
        assert ext["intent"] == "UPDATE_INVENTORY"
        assert ext["inventory_updates"][0]["product_guess"] == "rice"
        assert client.post("/understand", json={"text": "x"}).status_code == 401
    finally:
        api.app.state.llm = None


def test_understand_says_unavailable_when_the_llm_fails(client, monkeypatch):
    priya = join(client)
    api.app.state.llm = FakeLLM(error=ConnectionError("ollama down"))
    try:
        r = client.post("/understand", json={"text": "get rice"}, headers=bearer(priya["token"]))
        assert (r.status_code, r.json()["error"]) == (503, "llm_unavailable")
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.delenv("OLLAMA_HOST", raising=False)
        assert client.post("/understand", json={"text": "get rice"}, headers=bearer(priya["token"])).status_code == 503
    finally:
        api.app.state.llm = None
