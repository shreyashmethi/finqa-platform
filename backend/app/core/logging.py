"""
Logging setup.

Every log line can carry the current ``run_id`` (set via a context variable by the agent runner),
so a whole review can be followed in the logs. JSON output is available for log shippers.
"""

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime

# Context variable holding the run being executed by the current thread (or "-" when none).
current_run_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_run_id", default="-")


class _RunIdFilter(logging.Filter):
    """Inject ``run_id`` into every record so formatters can print it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.run_id = current_run_id.get()
        return True


class _JsonFormatter(logging.Formatter):
    """One JSON object per line: timestamp, level, logger, run_id, message (+ exception)."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "run_id": getattr(record, "run_id", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level: str = "INFO", json_output: bool = False) -> None:
    """Configure the root logger once at startup."""
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(_RunIdFilter())
    if json_output:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s [%(run_id)s] %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # pdfminer is extremely chatty at INFO/DEBUG; keep it quiet.
    logging.getLogger("pdfminer").setLevel(logging.WARNING)
