"""Shared pytest fixtures.

The production module `database` builds the SQLAlchemy engine at import time
against the on-disk `photocull.db`, and `main` immediately calls
`Base.metadata.create_all(bind=engine)` against that engine. We rebind both
`database.engine` and `database.SessionLocal` to an in-memory SQLite *before*
anything in `main` is imported, so the entire app runs against the test DB.
"""
import os
import sys

# Make backend/ importable so `import main`, `import models`, etc. resolve
# the same way they do when uvicorn is run from backend/.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database

_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestSession = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

database.engine = _test_engine
database.SessionLocal = _TestSession

import models  # noqa: E402  (must come after the engine swap)
import main  # noqa: E402

models.Base.metadata.create_all(bind=_test_engine)


@pytest.fixture()
def db_session():
    """Yield a session bound to the test engine; reset all tables after."""
    session = _TestSession()
    try:
        yield session
    finally:
        session.close()
        # Wipe rows so tests don't leak into each other. Dropping tables would
        # also work but truncating per-test is faster and preserves schema.
        with _test_engine.begin() as conn:
            for table in reversed(models.Base.metadata.sorted_tables):
                conn.execute(table.delete())


@pytest.fixture()
def client(db_session):
    """FastAPI TestClient wired to the test DB via dependency override."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # session cleanup handled by db_session fixture

    main.app.dependency_overrides[main.get_db] = _override_get_db
    try:
        with TestClient(main.app) as c:
            yield c
    finally:
        main.app.dependency_overrides.clear()
