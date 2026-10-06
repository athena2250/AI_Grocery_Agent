"""HTTP API: sign up → home code → second phone joins → shared log → sign out / delete."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app import db
from app import main as api
from app.auth.sms import ConsoleSender

PRIYA = "+919876543210"
RAVI = "+919811112222"


class RecordingSender(ConsoleSender):
    def __init__(self) -> None:
        self.sent: dict[str, str] = {}

    async def send_code(self, phone: str, code: str) -> None:
        self.sent[phone] = code


@pytest.fixture()
def client(monkeypatch):
    # One in-memory DB shared by the test and the server's worker threads.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", db._sqlite_foreign_keys)
    monkeypatch.setattr(db, "_engine", engine)
    api._ip_hits.clear()
    sms = RecordingSender()
    api.app.state.sms = sms
    with TestClient(api.app) as c:
        c.sms = sms  # type: ignore[attr-defined]
        yield c
    api.app.state.sms = None


def sign_up(c, phone=PRIYA, name="Priya", relation="Mom", invite=None):
    r = c.post("/auth/code", json={"mode": "sign_up", "phone": phone, "name": name, "relation": relation,
                                   "inviteCode": invite})
    assert r.status_code == 200, r.text
    assert r.json()["devCode"] == c.sms.sent[phone]
    r = c.post("/auth/verify", json={"mode": "sign_up", "phone": phone, "code": c.sms.sent[phone]})
    assert r.status_code == 200, r.text
    return r.json()


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_sign_up_starts_a_home_and_me_works(client):
    out = sign_up(client)
    assert out["created"] is True
    assert out["account"]["role"] == "owner"
    r = client.get("/me", headers=bearer(out["token"]))
    assert r.json()["account"]["name"] == "Priya"


def test_errors_are_flat_and_friendly(client):
    r = client.post("/auth/code", json={"mode": "sign_in", "phone": PRIYA, "name": "Priya"})
    assert r.status_code == 400
    assert r.json()["error"] == "no_account"
    assert "Sign up" in r.json()["message"]
    assert client.get("/me").json()["error"] == "signed_out"


def test_home_code_joins_the_same_home_and_events_are_shared(client):
    priya = sign_up(client)
    code = client.post("/household/invites", headers=bearer(priya["token"])).json()["code"]
    ravi = sign_up(client, RAVI, "Ravi", "Dad", invite=code.lower().replace("-", " "))
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
    priya = sign_up(client)
    other = sign_up(client, RAVI, "Ravi", "Dad")
    client.post("/sync/tasks", json={"events": [{"id": "ev_secret_01", "at": "2026-10-06T09:00:00Z",
                                                 "body": {}}]}, headers=bearer(priya["token"]))
    assert client.get("/sync/tasks", headers=bearer(other["token"])).json()["events"] == []


def test_sign_out_ends_the_session(client):
    priya = sign_up(client)
    assert client.post("/auth/sign-out", headers=bearer(priya["token"])).json() == {"ok": True}
    assert client.get("/me", headers=bearer(priya["token"])).status_code == 401


def test_delete_account_hands_over_the_home_and_frees_the_number(client):
    priya = sign_up(client)
    code = client.post("/household/invites", headers=bearer(priya["token"])).json()["code"]
    ravi = sign_up(client, RAVI, "Ravi", "Dad", invite=code)
    client.post("/sync/grocery", json={"events": [{"id": "ev_keep_0001", "at": "2026-10-06T09:00:00Z",
                                                   "body": {}}]}, headers=bearer(priya["token"]))

    r = client.delete("/me", headers=bearer(priya["token"]))
    assert r.json() == {"ok": True, "householdDeleted": False}
    assert client.get("/me", headers=bearer(priya["token"])).status_code == 401
    members = client.get("/household", headers=bearer(ravi["token"])).json()["members"]
    assert [(m["name"], m["role"]) for m in members] == [("Ravi", "owner")]
    assert len(client.get("/sync/grocery", headers=bearer(ravi["token"])).json()["events"]) == 1

    # The number is free again: signing up makes a new account in a new home.
    again = sign_up(client)
    assert again["account"]["householdId"] != priya["account"]["householdId"]

    # The last one out takes the home's data with them.
    r = client.delete("/me", headers=bearer(ravi["token"]))
    assert r.json()["householdDeleted"] is True


def test_codes_per_ip_are_capped(client, monkeypatch):
    monkeypatch.setattr(api, "CODES_PER_IP_PER_HOUR", 2)
    for i in range(2):
        client.post("/auth/code", json={"mode": "sign_in", "phone": f"+9198000000{i:02d}", "name": "X"})
    r = client.post("/auth/code", json={"mode": "sign_in", "phone": "+919800000099", "name": "X"})
    assert r.status_code == 429


def test_privacy_and_health(client):
    assert "Privacy Policy" in client.get("/privacy").text
    assert client.get("/healthz").json() == {"ok": True}


def test_console_sms_is_refused_in_production(monkeypatch):
    from app.auth.sms import sender_from_env

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    with pytest.raises(RuntimeError):
        sender_from_env()


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

    priya = sign_up(client)
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
    priya = sign_up(client)
    api.app.state.llm = FakeLLM(error=ConnectionError("ollama down"))
    try:
        r = client.post("/understand", json={"text": "get rice"}, headers=bearer(priya["token"]))
        assert (r.status_code, r.json()["error"]) == (503, "llm_unavailable")
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.delenv("OLLAMA_HOST", raising=False)
        assert client.post("/understand", json={"text": "get rice"}, headers=bearer(priya["token"])).status_code == 503
    finally:
        api.app.state.llm = None
