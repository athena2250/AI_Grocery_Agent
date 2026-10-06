"""The HTTP surface: token required, pages load, writes land and are audited."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hearth_admin import db
from hearth_admin.main import app

TOKEN = "test-token"
H = {"Authorization": f"Bearer {TOKEN}", "X-Admin-Name": "Priya"}


@pytest.fixture()
def client(demo, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    db.set_engine(demo)
    yield TestClient(app)
    db.set_engine(None)  # type: ignore[arg-type]


def test_no_token_configured_fails_closed(demo, monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    db.set_engine(demo)
    assert TestClient(app).get("/api/overview", headers=H).status_code == 503


def test_wrong_or_missing_token_is_refused(client):
    assert client.get("/api/overview").status_code == 401
    assert client.get("/api/overview", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_console_page_is_public_but_has_no_data(client):
    r = client.get("/")
    assert r.status_code == 200 and "Hearth Admin" in r.text
    assert client.get("/static/app.js").status_code == 200


@pytest.mark.parametrize("path", [
    "/api/me", "/api/overview", "/api/purchases/monthly", "/api/purchases/top?days=30",
    "/api/purchases/month/2026-09", "/api/families", "/api/families/h_sharma", "/api/tasks",
    "/api/tasks?status=done", "/api/tasks?status=active", "/api/tasks?overdue=true", "/api/posts?status=published",
    "/api/issues", "/api/audit",
])
def test_reads(client, path):
    r = client.get(path, headers=H)
    assert r.status_code == 200, r.text


def test_bad_inputs(client):
    assert client.get("/api/purchases/month/oct", headers=H).status_code == 422
    assert client.get("/api/tasks?status=bogus", headers=H).status_code == 422
    assert client.get("/api/families/nope", headers=H).status_code == 404


def test_phones_are_masked(client):
    fam = client.get("/api/families/h_sharma", headers=H).json()
    phones = [m["phone"] for m in fam["members"] if m["phone"]]
    assert phones and all("•" in p for p in phones)


def test_write_then_audit(client):
    r = client.post("/api/families/h_new/status", headers=H,
                    json={"status": "under_review", "note": "no owner after sign-up"})
    assert r.status_code == 200
    r = client.post("/api/members/m_mom/active", headers=H, json={"is_active": False, "note": "x"})
    assert r.status_code == 409 and "only owner" in r.json()["detail"]
    audit = client.get("/api/audit", headers=H).json()
    assert [(a["admin"], a["action"]) for a in audit] == [("Priya", "household_status")]
    assert client.get("/api/families", headers=H).json()[-1]["status"] in {"active", "under_review"}


def test_fix_endpoint_fixes_and_skips(client):
    r = client.post("/api/issues/fix", headers=H,
                    json={"check": "task_done_without_done_at", "refs": ["demo_task_3", "demo_task_0"]})
    body = r.json()
    assert body["fixed"] == ["demo_task_3"]
    assert body["skipped"][0]["ref"] == "demo_task_0"
    checks = {i["check"] for i in client.get("/api/issues", headers=H).json()["issues"]}
    assert "task_done_without_done_at" not in checks
