"""
Test configuration: every test session gets its own temporary data directory (SQLite DB,
checkpoint DB, uploads), and cached singletons are reset so nothing leaks between tests.
"""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make "app" importable

ANALYST = {"Authorization": "Bearer analyst-token"}
ADMIN = {"Authorization": "Bearer admin-token"}
AUDITOR = {"Authorization": "Bearer auditor-token"}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Point the app at a fresh temp data dir and reset all cached singletons."""
    monkeypatch.setenv("FINQA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FINQA_LOG_LEVEL", "WARNING")
    monkeypatch.setenv("FINQA_TOOL_BACKOFF_SECONDS", "0")
    from app.agents.runner import reset_run_manager
    from app.core.config import get_settings
    from app.db.session import reset_engine

    get_settings.cache_clear()
    reset_engine()
    reset_run_manager()
    from app.db.migrate import upgrade

    upgrade()
    yield tmp_path
    reset_run_manager()
    reset_engine()
    get_settings.cache_clear()


@pytest.fixture()
def seeded(env):
    """Company T001 + audited baselines + a document set T001-FY2025 built from fixtures."""
    from app.db.models import Company, DocumentSet, HistoricalBaseline
    from app.db.session import session_scope
    from app.services.ingestion import register_existing_file
    from tests import fixtures

    files = fixtures.build(env / "fixture_set")
    with session_scope() as db:
        db.add(Company(**fixtures.COMPANY))
        for metric, period, value in fixtures.BASELINE:
            db.add(
                HistoricalBaseline(
                    company_id="T001",
                    metric=metric,
                    period=period,
                    fiscal_year=int(period[2:6]),
                    value=value,
                    unit="USD",
                )
            )
        ds = DocumentSet(id="T001-FY2025", company_id="T001", fiscal_year=fixtures.FY, source="test")
        db.add(ds)
        for f in files:
            ds.documents.append(register_existing_file(db, "T001-FY2025", f))
    return files


@pytest.fixture()
def client(seeded):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def pytest_configure():
    os.environ.setdefault("FINQA_LOG_LEVEL", "WARNING")
