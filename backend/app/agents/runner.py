"""
Custom run loop around the LangGraph graph.

Responsibilities
----------------
* **Background execution.** Runs execute on a bounded thread pool so API requests return at once.
* **State persistence.** LangGraph checkpoints the full state after every node (thread_id = run id)
  in a SQLite (or Postgres) checkpointer. A run can stop at any point and continue from its last
  checkpoint with :meth:`RunManager.submit` ``(resume=True)``.
* **Crash recovery.** On startup, runs left "running"/"queued" by a dead process are resumed.
  Combined with idempotent tools (line items replaced per document, exceptions upserted by a
  deterministic key) a resumed run never creates duplicates.
* **Tracing.** Each node execution becomes a ``run_steps`` row (node, duration, compact summary);
  tool calls are traced by the ToolExecutor. Together they are the per-run trace shown in the UI.
* **Guardrails.** Max-steps limit (LangGraph recursion limit) and cooperative cancellation checked
  between steps.
* **Graceful shutdown.** On SIGTERM, in-flight runs stop at the next step boundary and keep status
  "running"; the next process resumes them. Only genuine errors mark a run "failed".
"""

import logging
import sqlite3
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.errors import GraphRecursionError
from sqlalchemy import func, select

from app.agents.graph import build_graph
from app.agents.llm import build_llm_mapper
from app.agents.state import RunContext
from app.core.config import get_settings
from app.core.logging import current_run_id
from app.db.models import DocumentSet, Run, RunStatus, RunStep
from app.db.session import session_scope

log = logging.getLogger(__name__)


def _summarise_update(update: dict | None) -> dict:
    """Compact, bounded description of a node's state update for the trace."""
    out: dict = {}
    for k, v in (update or {}).items():
        if k in {"documents", "baseline_inputs", "findings", "anomalies", "exception_ids"}:
            out[k] = len(v) if hasattr(v, "__len__") else v
        elif k == "extraction_stats":
            out[k] = [{x: s.get(x) for x in ("filename", "items", "missing_cells", "pages")} for s in v]
        elif isinstance(v, str | int | float | bool) or v is None:
            out[k] = v
        else:
            out[k] = v if len(str(v)) < 600 else f"<{type(v).__name__}>"
    return out


def make_checkpointer():
    """SQLite checkpointer by default; Postgres when the app DB is Postgres and the extra is installed."""
    settings = get_settings()
    if settings.resolved_database_url.startswith("postgresql"):
        try:  # pragma: no cover - needs a Postgres server
            from langgraph.checkpoint.postgres import PostgresSaver
            from psycopg import Connection

            dsn = settings.resolved_database_url.replace("postgresql+psycopg", "postgresql")
            saver = PostgresSaver(Connection.connect(dsn, autocommit=True))
            saver.setup()
            return saver
        except ImportError:
            log.warning("langgraph-checkpoint-postgres not installed; using SQLite checkpoints")
    conn = sqlite3.connect(settings.resolved_checkpoint_db, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    return SqliteSaver(conn)  # SqliteSaver serialises access with its own lock


class RunManager:
    """Owns the compiled graph, the checkpointer and the worker pool."""

    def __init__(self):
        settings = get_settings()
        self.settings = settings
        self.checkpointer = make_checkpointer()
        self.graph = build_graph(self.checkpointer)
        self._pool = ThreadPoolExecutor(max_workers=settings.worker_threads, thread_name_prefix="run")
        self._futures: dict[str, Future] = {}
        self._lock = threading.Lock()
        # Set on graceful shutdown (e.g. SIGTERM during a deploy). Runs stop at the next step boundary
        # and stay "running", so the next process resumes them from their checkpoint.
        self._stopping = threading.Event()

    # ------------------------------------------------------------------------------------- public
    def create_run(self, set_id: str, username: str) -> str:
        with session_scope() as db:
            if db.get(DocumentSet, set_id) is None:
                raise KeyError(set_id)
            run = Run(set_id=set_id, created_by=username, status=RunStatus.QUEUED)
            db.add(run)
            db.flush()
            return run.id

    def submit(self, run_id: str, resume: bool = False) -> None:
        """Execute in the background. Ignored if the run is already executing in this process."""
        with self._lock:
            fut = self._futures.get(run_id)
            if fut is not None and not fut.done():
                return
            self._futures[run_id] = self._pool.submit(self.execute, run_id, resume)

    def execute(self, run_id: str, resume: bool = False) -> str:
        """Run (or resume) synchronously in the calling thread; returns the final status."""
        token = current_run_id.set(run_id)
        try:
            return self._execute(run_id, resume)
        finally:
            current_run_id.reset(token)

    def cancel(self, run_id: str) -> None:
        with session_scope() as db:
            run = db.get(Run, run_id)
            if run is not None and run.status in (RunStatus.QUEUED, RunStatus.RUNNING):
                run.cancel_requested = True

    def resume_incomplete(self) -> list[str]:
        """Crash recovery: resume every run a previous process left unfinished."""
        with session_scope() as db:
            ids = list(db.scalars(select(Run.id).where(Run.status.in_([RunStatus.RUNNING, RunStatus.QUEUED]))))
        for rid in ids:
            log.info("resuming unfinished run %s", rid)
            self.submit(rid, resume=True)
        return ids

    def shutdown(self) -> None:
        """Stop accepting work; in-flight runs pause at their next checkpoint (not marked failed)."""
        self._stopping.set()
        self._pool.shutdown(wait=False, cancel_futures=True)  # queued runs stay QUEUED -> resumed later

    # ------------------------------------------------------------------------------------ internals
    def _execute(self, run_id: str, resume: bool) -> str:
        with session_scope() as db:
            run = db.get(Run, run_id)
            if run is None:
                raise KeyError(run_id)
            set_id = run.set_id
            run.status, run.error, run.cancel_requested = RunStatus.RUNNING, None, False
            run.started_at = run.started_at or datetime.now(UTC)
            seq = db.scalar(select(func.count()).select_from(RunStep).where(RunStep.run_id == run_id)) or 0

        ctx = RunContext(run_id=run_id, llm=build_llm_mapper())
        config = {"configurable": {"thread_id": run_id, "ctx": ctx}, "recursion_limit": self.settings.max_steps}
        # Resume from the checkpoint if one exists; otherwise start from the initial state.
        snapshot = self.graph.get_state(config)
        has_checkpoint = bool(snapshot and snapshot.values)
        if has_checkpoint and not snapshot.next:
            log.info("run already complete in checkpoint; finalising")
            return self._finish(run_id, snapshot.values, RunStatus.SUCCEEDED, None)
        graph_input = (
            None
            if (resume and has_checkpoint)
            else {
                "run_id": run_id,
                "set_id": set_id,
                "extracted": [],
                "extraction_stats": [],
                "route_log": [],
            }
        )
        log.info("%s run for set %s", "resuming" if graph_input is None else "starting", set_id)

        t_start = time.perf_counter()
        t_last = t_start
        try:
            for update in self.graph.stream(graph_input, config, stream_mode="updates"):
                now = time.perf_counter()
                for node, node_update in update.items():
                    seq += 1
                    self._record_step(run_id, seq, node, int((now - t_last) * 1000), node_update)
                t_last = now
                if self._stopping.is_set():
                    log.info("shutting down: run paused after step %d; it resumes on next start", seq)
                    return RunStatus.RUNNING
                if self._cancel_requested(run_id):
                    return self._finish(
                        run_id, self.graph.get_state(config).values, RunStatus.CANCELLED, "cancelled by user"
                    )
            final = self.graph.get_state(config).values
            final.setdefault("summary", {})["elapsed_seconds"] = round(time.perf_counter() - t_start, 2)
            return self._finish(run_id, final, RunStatus.SUCCEEDED, None)
        except GraphRecursionError:
            log.error("max steps (%d) exceeded", self.settings.max_steps)
            return self._finish(run_id, None, RunStatus.FAILED, f"max steps ({self.settings.max_steps}) exceeded")
        except Exception as exc:
            if self._stopping.is_set():
                # The interpreter is shutting down underneath the run (thread pools refuse new work).
                # The last checkpoint is intact, so leave the run resumable instead of failing it.
                log.warning("run interrupted by shutdown (%r); it resumes on next start", exc)
                return RunStatus.RUNNING
            log.exception("run failed")
            return self._finish(run_id, None, RunStatus.FAILED, repr(exc)[:2000])

    def _record_step(self, run_id: str, seq: int, node: str, ms: int, update: dict | None) -> None:
        with session_scope() as db:
            db.add(RunStep(run_id=run_id, seq=seq, node=node, duration_ms=ms, summary=_summarise_update(update)))
            run = db.get(Run, run_id)
            run.current_node, run.step_count = node, seq

    def _cancel_requested(self, run_id: str) -> bool:
        with session_scope() as db:
            return bool(db.scalar(select(Run.cancel_requested).where(Run.id == run_id)))

    def _finish(self, run_id: str, state: dict | None, status: RunStatus, error: str | None) -> str:
        with session_scope() as db:
            run = db.get(Run, run_id)
            run.status, run.error = status, error
            run.finished_at = datetime.now(UTC)
            if state:
                run.stats = {**(state.get("summary") or {}), "route_log": state.get("route_log", [])[-20:]}
            run.current_node = None if status != RunStatus.FAILED else run.current_node
        log.info("run finished: %s%s", status, f" ({error})" if error else "")
        return status


_manager: RunManager | None = None


def get_run_manager() -> RunManager:
    """Process-wide RunManager (created on first use, e.g. at app startup)."""
    global _manager
    if _manager is None:
        _manager = RunManager()
    return _manager


def reset_run_manager() -> None:
    """Tests: drop the singleton so a new DB/checkpoint file is picked up."""
    global _manager
    if _manager is not None:
        _manager.shutdown()
    _manager = None
