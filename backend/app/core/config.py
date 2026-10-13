"""
Application settings.

All configuration comes from environment variables (prefix ``FINQA_``) or a ``.env`` file, so the
same image runs in dev, CI and production without code changes. Nothing secret is hard-coded:
the defaults below are only safe for local development.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings object. Read once per process via :func:`get_settings`."""

    model_config = SettingsConfigDict(env_prefix="FINQA_", env_file=".env", extra="ignore")

    # --- Storage ---------------------------------------------------------------------------------
    # Root for everything the service writes: SQLite files and uploaded documents.
    data_dir: Path = Path("./data")
    # SQLAlchemy URL for the application database. Defaults to SQLite inside data_dir.
    # For Postgres use e.g. postgresql+psycopg://user:pass@host:5432/finqa
    database_url: str | None = None
    # Where LangGraph keeps run checkpoints (SQLite file). Kept separate from the app DB so the
    # checkpoint tables never collide with application migrations.
    checkpoint_db: str | None = None

    # --- Agent runtime ---------------------------------------------------------------------------
    # Upper bound on graph steps per run; protects against routing loops.
    max_steps: int = 200
    # Number of runs executed concurrently in the background worker pool.
    worker_threads: int = 2
    # Retries for a failing tool call (transient errors only) and the base backoff in seconds.
    tool_max_attempts: int = 3
    tool_backoff_seconds: float = 0.5
    # Resume runs that were "running" when the process died (crash recovery).
    resume_on_startup: bool = True

    # --- Reconciliation rules (defaults; admins can override at runtime via /api/settings) ------
    # Metrics the baseline agent checks for unusual year-on-year moves.
    baseline_metrics: list[str] = ["revenue", "capex", "employee_costs", "headcount"]
    # |YoY change| above this fraction is flagged as a baseline anomaly.
    anomaly_threshold: float = 0.30

    # --- Optional LLM ----------------------------------------------------------------------------
    # langchain init_chat_model identifier, e.g. "anthropic:<model-name>". Empty = rules only.
    llm_model: str = ""
    # Hard cap on LLM calls per run (cost control).
    llm_max_calls_per_run: int = 50

    # --- Security --------------------------------------------------------------------------------
    # Demo bearer tokens: "token:username:role,...". Replace with SSO/OIDC in production.
    auth_tokens: str = Field(
        default="analyst-token:alice:analyst,controller-token:carol:controller,"
        "auditor-token:arun:auditor,admin-token:adam:admin"
    )
    # Browser origins allowed to call the API (the React dev server by default).
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Upload limits.
    max_upload_mb: int = 100
    allowed_extensions: list[str] = [".pdf", ".xlsx", ".csv"]

    log_level: str = "INFO"
    log_json: bool = False

    # --- Derived paths ---------------------------------------------------------------------------
    @property
    def resolved_database_url(self) -> str:
        """App DB URL, defaulting to a SQLite file in ``data_dir``."""
        return self.database_url or f"sqlite:///{(self.data_dir / 'finqa.db').resolve()}"

    @property
    def resolved_checkpoint_db(self) -> str:
        """Path of the SQLite file holding LangGraph checkpoints."""
        return self.checkpoint_db or str((self.data_dir / "checkpoints.db").resolve())

    @property
    def upload_dir(self) -> Path:
        """Directory for uploaded documents (one sub-folder per document set)."""
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, creating the data directories on first use."""
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    return settings
