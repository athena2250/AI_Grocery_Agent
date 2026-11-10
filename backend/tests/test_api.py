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


def test_local_web_preflight_allows_authenticated_requests(client):
    r = client.options('/sync/grocery', headers={
        'Origin': 'http://localhost:8081',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert r.status_code == 200
    assert r.headers['access-control-allow-origin'] == 'http://localhost:8081'


def test_unlisted_web_origin_is_refused(client):
    r = client.options('/sync/grocery', headers={
        'Origin': 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
    })
    assert r.status_code == 400
    assert 'access-control-allow-origin' not in r.headers


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

    ev = {"id": "ev_priya_0001", "at": "2026-10-06T09:00:00.120Z", "body": {"type": "APPROVE_LIST"}}
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


def test_suspended_home_denies_existing_session_and_sign_in_but_allows_deletion(client):
    from app.core.access import AdminHouseholdStatus, HouseholdStatus
    out = join(client)
    # Existing sessions must lose access immediately; no app restart required.
    with Session(client.engine) as s:
        s.add(AdminHouseholdStatus(household_id=out['account']['householdId'],
            status=HouseholdStatus.SUSPENDED, updated_by='Admin', note='Review'))
        s.commit()
    headers = bearer(out['token'])
    assert client.get('/me', headers=headers).status_code == 403
    assert client.get('/sync/grocery', headers=headers).status_code == 403
    assert client.post('/sync/tasks', headers=headers, json={'events': []}).status_code == 403
    assert client.delete('/me', headers=headers).status_code == 200


def test_sync_materializes_reports_and_retries_are_idempotent(client):
    from app.history.models import Purchase
    from app.tasks.models import Task
    from app.reporting.models import ReportState
    from sqlmodel import select
    out = join(client)
    headers = bearer(out['token'])
    hid = out['account']['householdId']
    mid = out['account']['memberId']
    at = '2026-11-10T09:00:00.000Z'
    def push(stream, events):
        r = client.post('/sync/' + stream, headers=headers, json={'events': events})
        assert r.status_code == 200, r.text
    item = {'product': {'id': 'p_tomato', 'name': 'Tomatoes', 'category': 'Vegetables', 'defaultUnit': 'kg'},
            'qty': 2, 'unit': 'kg', 'brand': None, 'variant': None}
    events = [
        {'id': 'ev_add_0001', 'at': at, 'body': {'type': 'ADD_ITEM', 'item': item, 'by': mid}},
        {'id': 'ev_buy_0001', 'at': at, 'body': {'type': 'MARK_PURCHASED_BY_ID', 'itemId': 'it_ev_add_0001_0', 'by': mid}},
    ]
    push('grocery', events)
    push('grocery', events)
    task = {'title': 'Fix tap', 'section': 'Home Repair', 'kind': 'task', 'notes': '',
            'whoId': mid, 'due': '2026-11-12', 'details': {}}
    push('tasks', [{'id': 'ev_task_001', 'at': at, 'body': {'type': 'ADD_TASK', 'task': task, 'by': mid}}])
    with Session(client.engine) as s:
        purchases = s.exec(select(Purchase).where(Purchase.household_id == hid)).all()
        bought = [p for p in purchases if p.id.endswith('h_ev_buy_0001_0')]
        assert len(bought) == 1 and bought[0].qty == 2 and bought[0].member_id == mid
        tasks = s.exec(select(Task).where(Task.household_id == hid)).all()
        assert len(tasks) == 1 and tasks[0].title == 'Fix tap'
        # Date-only deadlines last the whole day in the household timezone.
        assert tasks[0].due_at.hour == 18 and tasks[0].due_at.minute == 29
        assert s.get(ReportState, (hid, 'grocery')).last_seq == 2
    assert client.delete('/me', headers=headers).status_code == 200
    with Session(client.engine) as s:
        assert not s.exec(select(Purchase).where(Purchase.household_id == hid)).all()
        assert not s.exec(select(Task).where(Task.household_id == hid)).all()


def test_sync_rejects_admin_actions_and_bad_reducer_input_atomically(client):
    out = join(client)
    headers = bearer(out['token'])
    event = {'id': 'ev_bad_0001', 'at': '2026-11-10T09:00:00Z', 'body': {'type': 'ADMIN_PATCH_TASK'}}
    assert client.post('/sync/tasks', headers=headers, json={'events': [event]}).status_code == 403
    event['body'] = {'type': 'ADD_ITEM'}
    assert client.post('/sync/grocery', headers=headers, json={'events': [event]}).status_code == 422
    assert client.get('/sync/grocery', headers=headers).json()['events'] == []


def test_privacy_has_real_contact_and_escapes_configuration(client, monkeypatch):
    assert 'rithvika.tiruveedhula51@gmail.com' in client.get('/privacy').text
    assert '[CONTACT EMAIL]' not in client.get('/privacy').text
    monkeypatch.setenv('PRIVACY_CONTACT_EMAIL', '<script>bad</script>')
    assert '&lt;script&gt;' in client.get('/privacy').text


def test_production_config_refuses_missing_or_weak_settings(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('AUTH_SECRET', '')
    with pytest.raises(RuntimeError, match='AUTH_SECRET'):
        api.validate_production_config()
    monkeypatch.setenv('AUTH_SECRET', 'x' * 48)
    monkeypatch.delenv('DATABASE_URL', raising=False)
    with pytest.raises(RuntimeError, match='DATABASE_URL'):
        api.validate_production_config()
    monkeypatch.setenv('DATABASE_URL', 'postgresql://example/hearth')
    monkeypatch.setenv('CORS_ORIGINS', 'http://localhost:8081')
    with pytest.raises(RuntimeError, match='HTTPS'):
        api.validate_production_config()
    monkeypatch.setenv('CORS_ORIGINS', 'https://hearth.example.com')
    api.validate_production_config()


def test_suspension_blocks_passkey_and_resuming_restores_access(client):
    from app.core.access import AdminHouseholdStatus, HouseholdStatus
    client.post('/auth/request', json={'phone': PRIYA, 'name': 'Priya'})
    key = admin_approves(client, PRIYA)
    body = {'phone': PRIYA, 'name': 'Priya', 'passkey': key}
    out = client.post('/auth/passkey', json=body).json()
    hid = out['account']['householdId']
    with Session(client.engine) as s:
        s.add(AdminHouseholdStatus(household_id=hid, status=HouseholdStatus.SUSPENDED,
                                  updated_by='Admin', note='Review'))
        s.commit()
    assert client.post('/auth/passkey', json=body).status_code == 403
    # A refused attempt must not replace the existing session.
    with Session(client.engine) as s:
        row = s.get(AdminHouseholdStatus, hid)
        row.status = HouseholdStatus.UNDER_REVIEW
        s.add(row)
        s.commit()
    assert client.get('/me', headers=bearer(out['token'])).status_code == 200


def test_reporting_rebuilds_existing_event_log(client):
    from app.reporting.project import backfill
    from app.reporting.models import ReportState
    from app.sync.models import SyncEvent
    from app.tasks.models import Task
    from sqlmodel import select
    out = join(client)
    hid, mid = out['account']['householdId'], out['account']['memberId']
    with Session(client.engine) as s:
        s.add(SyncEvent(household_id=hid, member_id=mid, stream='tasks', client_id='ev_old_0001',
            at=utcnow(), body={'type': 'ADD_TASK', 'by': mid, 'task': {
                'title': 'Existing task', 'section': 'Errands', 'kind': 'errand',
                'notes': '', 'whoId': mid, 'due': None, 'details': {}}}))
        s.commit()
        backfill(s)
        s.commit()
        backfill(s)
        s.commit()
        assert len(s.exec(select(Task).where(Task.household_id == hid)).all()) == 1
        assert s.get(ReportState, (hid, 'tasks')).last_seq == 1
