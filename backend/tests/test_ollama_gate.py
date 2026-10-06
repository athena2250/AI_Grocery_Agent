"""The gate in front of a home Ollama: only the right key, only /api/chat, forwarded as-is."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import ollama_gate
from app.understanding.llm import HttpxOllamaClient

TOKEN = "t" * 32


@pytest.fixture()
def gate(monkeypatch):
    monkeypatch.setenv("OLLAMA_GATE_TOKEN", TOKEN)
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "{}"}})

    monkeypatch.setattr(ollama_gate.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    with TestClient(ollama_gate.gate) as c:
        c.seen = seen  # type: ignore[attr-defined]
        yield c


def test_only_the_right_key_gets_through(gate):
    assert gate.post("/api/chat", json={}).status_code == 401
    assert gate.post("/api/chat", json={}, headers={"Authorization": "Bearer nope"}).status_code == 401
    r = gate.post("/api/chat", json={"model": "llama3:8b"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200 and r.json()["message"]["content"] == "{}"
    assert gate.seen[0].url.path == "/api/chat"


def test_nothing_else_is_reachable(gate):
    auth = {"Authorization": f"Bearer {TOKEN}"}
    assert gate.post("/api/generate", json={}, headers=auth).status_code in (404, 405)
    assert gate.post("/api/pull", json={"name": "x"}, headers=auth).status_code in (404, 405)
    assert gate.get("/api/tags", headers=auth).status_code in (404, 405)


def test_refuses_to_start_with_a_weak_token(monkeypatch):
    monkeypatch.setenv("OLLAMA_GATE_TOKEN", "short")
    with pytest.raises(RuntimeError), TestClient(ollama_gate.gate):
        pass


@pytest.mark.asyncio
async def test_server_client_sends_the_key_and_keeps_the_model_loaded():
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"message": {"content": "{}"}})

    httpx.AsyncClient = lambda **kw: real(transport=httpx.MockTransport(handler), **kw)  # type: ignore[assignment,misc]
    try:
        await HttpxOllamaClient("https://gate.example/", api_key="k").chat("llama3:8b", [])
    finally:
        httpx.AsyncClient = real  # type: ignore[misc]
    assert seen[0].headers["authorization"] == "Bearer k"
    assert str(seen[0].url) == "https://gate.example/api/chat"
    assert b'"keep_alive":"1h"' in seen[0].content.replace(b" ", b"")
