"""Engine + session for the admin service. Same database as the family app (`DATABASE_URL`).

`init_admin_db` creates the backend's tables if missing (same as `app.db.init_db`) plus the
two `admin_*` tables. It never drops or alters anything.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.engine import Engine
from sqlmodel import Session

from app.db import get_engine, init_db

from . import models  # noqa: F401  (registers admin_* tables)

_engine: Engine | None = None


def init_admin_db(engine: Engine) -> None:
    init_db(engine)


def set_engine(engine: Engine) -> None:
    """Tests point the service at an in-memory database."""

    global _engine
    _engine = engine


def engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = get_engine()
        init_admin_db(_engine)
    return _engine


def get_session() -> Iterator[Session]:
    with Session(engine()) as session:
        yield session
