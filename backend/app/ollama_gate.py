"""A locked door in front of the Ollama on this Mac, so the Hearth server online can use it.

Ollama has no password: put it on the internet as-is and anyone can run models on your Mac.
This gate listens on its own port, lets through only `POST /api/chat` carrying
`Authorization: Bearer $OLLAMA_GATE_TOKEN`, and forwards it to the local Ollama. Expose the
gate (not Ollama) with any tunnel — see scripts/share-ollama.sh and backend/DEPLOY.md.

    OLLAMA_GATE_TOKEN=… .venv/bin/uvicorn app.ollama_gate:gate --host 127.0.0.1 --port 11435

On the server, set OLLAMA_HOST to the tunnel's https address and OLLAMA_API_KEY to the token.
"""

from __future__ import annotations

import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM = os.environ.get("OLLAMA_UPSTREAM", "http://127.0.0.1:11434")
MAX_BODY = 200_000


def _token() -> str:
    token = os.environ.get("OLLAMA_GATE_TOKEN", "")
    if len(token) < 24:
        raise RuntimeError("set OLLAMA_GATE_TOKEN to a long random string (24+ characters)")
    return token


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    _token()  # refuse to start unlocked
    yield


gate = FastAPI(title="Hearth Ollama gate", lifespan=_lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@gate.post("/api/chat")
async def chat(request: Request) -> Response:
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given.encode(), _token().encode()):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.body()
    if len(body) > MAX_BODY:
        return JSONResponse({"error": "too large"}, status_code=413)
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{UPSTREAM}/api/chat", content=body, headers={"Content-Type": "application/json"})
    return Response(r.content, status_code=r.status_code, media_type="application/json")


@gate.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}
