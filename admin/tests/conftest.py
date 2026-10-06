import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

_ADMIN = Path(__file__).resolve().parents[1]
_BACKEND = _ADMIN.parent / "backend"
for p in (_ADMIN, _BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.db import _sqlite_foreign_keys
from app.seed import main as seed
from hearth_admin.db import init_admin_db
from hearth_admin.demo import fill


@pytest.fixture()
def engine():
    # One shared in-memory DB across threads (the TestClient runs requests in a worker thread).
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(eng, "connect", _sqlite_foreign_keys)
    seed(eng)
    init_admin_db(eng)
    return eng


@pytest.fixture()
def demo(engine):
    """Seed + the demo homes, which plant one of each broken state."""

    with Session(engine) as s:
        fill(s)
        s.commit()
    return engine
