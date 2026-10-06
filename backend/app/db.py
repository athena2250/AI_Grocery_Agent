"""Database bootstrap: engine, table creation, FastAPI session dependency.

Real DB is local PostgreSQL (`DATABASE_URL`, default below). Tests use in-memory SQLite.
The SQLModel classes are the single source of truth for the schema; `init_db` creates
anything missing and never drops. Alembic comes in once real data must be migrated.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

DEFAULT_DATABASE_URL = "postgresql+psycopg://localhost:5432/ai_grocery_agent"

MODEL_MODULES = (
    "app.core.models",
    "app.feed.models",
    "app.conversation.models",
    "app.tasks.models",
    "app.bills.models",
    "app.pricing.models",
    "app.memory.models",
    "app.inventory.models",
    "app.planner.models",
    "app.history.models",
    "app.receipts.models",
    "app.auth.models",
)


def import_models() -> None:
    """Register every table on `SQLModel.metadata`."""

    import importlib

    for name in MODEL_MODULES:
        importlib.import_module(name)


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def _sqlite_foreign_keys(dbapi_conn: Any, _record: Any) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def get_engine(url: str | None = None, echo: bool = False) -> Engine:
    url = url or database_url()
    if url.startswith("sqlite"):
        engine = create_engine(url, echo=echo)
        event.listen(engine, "connect", _sqlite_foreign_keys)
        return engine
    return create_engine(url, echo=echo, pool_pre_ping=True)


def init_db(engine: Engine) -> None:
    import_models()
    SQLModel.metadata.create_all(engine)


_engine: Engine | None = None


def get_session() -> Iterator[Session]:
    """FastAPI dependency: `session: Session = Depends(get_session)`."""

    global _engine
    if _engine is None:
        _engine = get_engine()
    with Session(_engine) as session:
        yield session
