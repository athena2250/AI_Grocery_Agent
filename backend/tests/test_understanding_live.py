"""Live eval — hits a real local Ollama.

Run with:  `pytest -m llm backend/tests/test_understanding_live.py`

Reads `tests/eval/utterances.yaml`, runs each utterance through the extractor,
and enforces ≥90% pass across all assertions.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from app.understanding import UnderstandingClient
from app.understanding.schema import LLMExtraction

pytestmark = pytest.mark.llm

_REPO_ROOT = Path(__file__).resolve().parents[2]
_EVAL_FILE = _REPO_ROOT / "tests" / "eval" / "utterances.yaml"
_PASS_THRESHOLD = 0.9


def _load_cases() -> list[dict]:
    if not _EVAL_FILE.exists():
        pytest.skip(f"eval file missing: {_EVAL_FILE}")
    with _EVAL_FILE.open() as f:
        return list(yaml.safe_load(f))


def _check(case: dict, result: LLMExtraction) -> list[str]:
    """Return a list of failure reasons; empty means pass."""
    failures: list[str] = []

    expected_intent = case.get("intent")
    if expected_intent and result.intent.value != expected_intent:
        failures.append(f"intent={result.intent.value} != {expected_intent}")

    if kind := case.get("requires_ambiguity"):
        kinds = {a.kind.value for a in result.ambiguities}
        if kind not in kinds:
            failures.append(f"missing required ambiguity kind={kind}, got {sorted(kinds)}")

    if kind := case.get("requires_no_ambiguity_of_kind"):
        kinds = {a.kind.value for a in result.ambiguities}
        if kind in kinds:
            failures.append(f"unexpected ambiguity kind={kind}")

    if hint := case.get("requires_variant_hint"):
        hints = {i.variant_hint for i in result.items if i.variant_hint}
        if hint not in hints:
            failures.append(f"missing variant_hint={hint}, got {sorted(h for h in hints if h)}")

    if state := case.get("requires_inventory_state"):
        states = {u.state.value for u in result.inventory_updates}
        if state not in states:
            failures.append(f"missing inventory state={state}, got {sorted(states)}")

    if case.get("requires_purchase_marked") and not result.purchases_marked:
        failures.append("purchases_marked is empty")

    if (n := case.get("min_items")) and len(result.items) < n:
        failures.append(f"items={len(result.items)} < min_items={n}")

    return failures


@pytest.mark.asyncio
async def test_live_eval_pass_rate() -> None:
    if not os.environ.get("OLLAMA_HOST") and not _default_ollama_reachable():
        pytest.skip("Ollama not reachable at http://localhost:11434")

    cases = _load_cases()
    client = UnderstandingClient()

    passes = 0
    reports: list[str] = []
    for case in cases:
        utterance = case["utterance"]
        try:
            result = await client.extract(utterance)
        except Exception as e:  # noqa: BLE001
            reports.append(f"[EXCEPTION] {utterance!r}: {e}")
            continue
        failures = _check(case, result)
        if not failures:
            passes += 1
        else:
            reports.append(f"[FAIL] {utterance!r}: {'; '.join(failures)}")

    rate = passes / len(cases)
    detail = "\n".join(reports) if reports else "(all passed)"
    assert rate >= _PASS_THRESHOLD, (
        f"live eval pass rate {rate:.0%} < {_PASS_THRESHOLD:.0%} ({passes}/{len(cases)})\n{detail}"
    )


def _default_ollama_reachable() -> bool:
    import socket

    try:
        with socket.create_connection(("localhost", 11434), timeout=0.5):
            return True
    except OSError:
        return False
