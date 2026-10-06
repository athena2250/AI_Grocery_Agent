"""Append to / read from a household's change log. The caller commits."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlmodel import Session, col, delete, select

from app.memory.rules import as_utc

from .models import STREAMS, SyncEvent

MAX_EVENTS_PER_PUSH = 200
PAGE = 500


@dataclass(frozen=True)
class NewEvent:
    client_id: str
    at: datetime
    body: dict[str, Any]


def append(s: Session, *, household_id: str, member_id: str, stream: str,
           events: list[NewEvent]) -> list[tuple[str, int]]:
    """Adds the events in order; ones already stored (same client_id) keep their seq."""

    if stream not in STREAMS:
        raise ValueError(f"unknown stream {stream!r}")
    ids = [e.client_id for e in events]
    known: dict[str, int] = {
        r.client_id: r.seq  # type: ignore[misc]
        for r in s.exec(select(SyncEvent).where(
            SyncEvent.household_id == household_id, col(SyncEvent.client_id).in_(ids)))
    }
    out: list[tuple[str, int]] = []
    for e in events:
        if e.client_id not in known:
            row = SyncEvent(household_id=household_id, stream=stream, client_id=e.client_id,
                            member_id=member_id, at=as_utc(e.at), body=e.body)
            s.add(row)
            s.flush()
            known[e.client_id] = row.seq  # type: ignore[assignment]
        out.append((e.client_id, known[e.client_id]))
    return out


def since(s: Session, *, household_id: str, stream: str, after: int, limit: int = PAGE) -> list[SyncEvent]:
    return list(s.exec(
        select(SyncEvent)
        .where(SyncEvent.household_id == household_id, SyncEvent.stream == stream,
               col(SyncEvent.seq) > after)
        .order_by(col(SyncEvent.seq))
        .limit(limit)
    ))


def forget_household(s: Session, household_id: str) -> None:
    s.exec(delete(SyncEvent).where(col(SyncEvent.household_id) == household_id))  # type: ignore[call-overload]
