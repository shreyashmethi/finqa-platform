"""
Engine and session factory.

Sessions are short-lived and scoped to one unit of work (one request, or one tool call inside an
agent run). Use :func:`session_scope` everywhere outside FastAPI handlers so commits and rollbacks
are never forgotten.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _configure_sqlite(engine: Engine) -> None:
    """SQLite tuning: WAL for concurrent readers, enforced foreign keys, a busy timeout for writers."""

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record):  # pragma: no cover - driver callback
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()


def get_engine() -> Engine:
    """Create the engine lazily (so tests can point settings at a temp DB first)."""
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().resolved_database_url
        kwargs = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            # Background worker threads share the engine; SQLite needs this flag for that.
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        _engine = create_engine(url, **kwargs)
        if url.startswith("sqlite"):
            _configure_sqlite(_engine)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Drop the cached engine (used by tests that switch databases)."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine, _SessionLocal = None, None


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope: commit on success, roll back on any exception, always close."""
    get_engine()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    with session_scope() as session:
        yield session
