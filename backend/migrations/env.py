"""Alembic environment: binds migrations to the app's models and configured database URL."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.db.models import Base

config = context.config
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", get_settings().resolved_database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL without a live connection (alembic upgrade --sql)."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        # render_as_batch lets ALTER TABLE work on SQLite as well as Postgres.
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
