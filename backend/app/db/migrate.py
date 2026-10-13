"""
Schema management.

Production schema changes go through Alembic migrations (``backend/migrations``). ``upgrade()`` is
called at startup and by the CLI, so a fresh database is created and an old one brought up to date
the same way everywhere.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import get_settings

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().resolved_database_url)
    return cfg


def upgrade() -> None:
    """Apply all pending migrations (no-op when up to date)."""
    command.upgrade(alembic_config(), "head")
