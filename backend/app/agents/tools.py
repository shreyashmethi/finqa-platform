"""
Function-calling tools used by the agents.

Each tool is a plain function with a Pydantic input model and output model. That gives us:
  * a JSON schema per tool (``Tool.schema()``), the same contract an LLM tool-calling agent uses;
  * validation of every input before the call and every output after it;
  * a single :class:`ToolExecutor` that adds retries with backoff for transient errors and writes
    a trace row (``tool_calls``) for each invocation.

Tools
-----
list_documents           documents in a set
extract_line_items       parse one document and persist its line items (idempotent per document)
load_observations        all line items of a set, grouped by (metric, period), for reconciliation
get_historical_baseline  audited prior values, strictly earlier than the set's fiscal year
persist_exception        upsert one structured exception record (idempotent on a deterministic key)
close_stale_exceptions   mark open exceptions that a re-run no longer finds as resolved
"""

import hashlib
import logging
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from app.core.config import get_settings
from app.db.models import (
    Document,
    DocumentSet,
    ExceptionRecord,
    ExceptionStatus,
    HistoricalBaseline,
    LineItem,
    ToolCall,
)
from app.db.session import session_scope
from app.domain.types import Observation
from app.parsers import LabelMapper, parse_document

log = logging.getLogger(__name__)


class TransientToolError(RuntimeError):
    """Raise for failures worth retrying (lock timeouts, flaky storage)."""


# ===================================================================================== tool models
class ListDocumentsIn(BaseModel):
    set_id: str


class DocumentRef(BaseModel):
    document_id: str
    filename: str
    format: str
    path: str


class ListDocumentsOut(BaseModel):
    company_id: str
    fiscal_year: int
    currency: str
    segments: list[str]
    documents: list[DocumentRef]


class ExtractIn(BaseModel):
    document_id: str = Field(description="Document to parse")


class ExtractOut(BaseModel):
    document_id: str
    filename: str
    items: int
    missing_cells: int
    pages: int | None = None
    unmapped_labels: list[str] = []
    warnings: list[str] = []


class LoadObservationsIn(BaseModel):
    set_id: str


class LoadObservationsOut(BaseModel):
    # key "metric|period" -> observations (as dicts, see domain.types.Observation)
    groups: dict[str, list[dict]]

    def summary(self) -> dict:
        return {"keys": len(self.groups), "observations": sum(len(v) for v in self.groups.values())}


class BaselineIn(BaseModel):
    company_id: str
    as_of_fiscal_year: int = Field(description="Only periods strictly before this fiscal year are returned")
    metrics: list[str] | None = Field(default=None, description="None = all metrics")
    from_fiscal_year: int | None = None


class BaselineOut(BaseModel):
    values: dict[str, float]  # "metric|period" -> value

    def summary(self) -> dict:
        return {"values": len(self.values)}


class ExceptionIn(BaseModel):
    set_id: str
    run_id: str
    metric: str
    period: str
    type: str
    severity: str
    expected_value: float | None
    reported_value: float | None
    unit: str
    outlier_documents: list[str]
    explanation: str
    evidence: dict


class ExceptionOut(BaseModel):
    exception_id: str
    created: bool
    status: str


class CloseStaleIn(BaseModel):
    set_id: str
    run_id: str
    keep_keys: list[str]  # dedupe keys found by this run


class CloseStaleOut(BaseModel):
    closed: int


# ================================================================================ tool functions
def list_documents(args: ListDocumentsIn, **_) -> ListDocumentsOut:
    with session_scope() as db:
        ds = db.get(DocumentSet, args.set_id)
        if ds is None:
            raise ValueError(f"Unknown set {args.set_id}")
        return ListDocumentsOut(
            company_id=ds.company_id,
            fiscal_year=ds.fiscal_year,
            currency=ds.company.currency,
            segments=list(ds.company.segments or []),
            documents=[
                DocumentRef(document_id=d.id, filename=d.filename, format=d.format, path=d.storage_path)
                for d in ds.documents
            ],
        )


def extract_line_items(args: ExtractIn, mapper: LabelMapper | None = None, **_) -> ExtractOut:
    """Parse a document and replace its line items (delete + insert = idempotent on retry/resume)."""
    with session_scope() as db:
        doc = db.get(Document, args.document_id)
        if doc is None:
            raise ValueError(f"Unknown document {args.document_id}")
        path, filename, set_id = doc.storage_path, doc.filename, doc.set_id
    if not Path(path).exists():
        raise FileNotFoundError(path)
    assert mapper is not None, "extract_line_items needs a label mapper"
    result = parse_document(path, mapper)  # parsing happens outside any DB transaction
    with session_scope() as db:
        db.execute(delete(LineItem).where(LineItem.document_id == args.document_id))
        db.add_all(
            LineItem(
                document_id=args.document_id,
                set_id=set_id,
                metric=i.metric,
                period=i.period,
                value=i.value,
                is_missing=i.is_missing,
                precision=i.precision,
                raw_label=i.raw_label[:255],
                raw_value=i.raw_value[:64],
                unit_label=i.unit_label[:64],
                location=i.location,
                method=i.method,
            )
            for i in result.items
        )
        if result.pages:
            db.get(Document, args.document_id).pages = result.pages
    return ExtractOut(
        document_id=args.document_id,
        filename=filename,
        items=len(result.items),
        missing_cells=sum(i.is_missing for i in result.items),
        pages=result.pages,
        unmapped_labels=sorted(set(result.unmapped_labels))[:50],
        warnings=result.warnings[:20],
    )


def load_observations(args: LoadObservationsIn, **_) -> LoadObservationsOut:
    groups: dict[str, list[dict]] = defaultdict(list)
    with session_scope() as db:
        rows = db.execute(
            select(LineItem, Document.filename)
            .join(Document, Document.id == LineItem.document_id)
            .where(LineItem.set_id == args.set_id)
        ).all()
        for li, filename in rows:
            groups[f"{li.metric}|{li.period}"].append(
                Observation(
                    line_item_id=li.id,
                    document_id=li.document_id,
                    filename=filename,
                    value=li.value,
                    precision=li.precision,
                    raw_value=li.raw_value,
                    location=li.location,
                    is_missing=li.is_missing,
                ).__dict__
            )
    return LoadObservationsOut(groups=dict(groups))


def get_historical_baseline(args: BaselineIn, **_) -> BaselineOut:
    """Leakage guard: the query itself enforces fiscal_year < as_of_fiscal_year."""
    with session_scope() as db:
        q = select(HistoricalBaseline).where(
            HistoricalBaseline.company_id == args.company_id,
            HistoricalBaseline.fiscal_year < args.as_of_fiscal_year,
        )
        if args.from_fiscal_year is not None:
            q = q.where(HistoricalBaseline.fiscal_year >= args.from_fiscal_year)
        if args.metrics:
            q = q.where(HistoricalBaseline.metric.in_(args.metrics))
        return BaselineOut(values={f"{b.metric}|{b.period}": b.value for b in db.scalars(q)})


def dedupe_key(set_id: str, metric: str, period: str) -> str:
    """Deterministic exception key: the same discrepancy always maps to the same record."""
    return hashlib.sha256(f"{set_id}|{metric}|{period}".encode()).hexdigest()


def persist_exception(args: ExceptionIn, **_) -> ExceptionOut:
    """
    Upsert by dedupe key. A re-run refreshes the facts (type, values, evidence) but never touches a
    reviewer's decision; an exception closed as resolved-by-rerun is reopened if it reappears.
    """
    key = dedupe_key(args.set_id, args.metric, args.period)
    fields = dict(
        type=args.type,
        severity=args.severity,
        expected_value=args.expected_value,
        reported_value=args.reported_value,
        unit=args.unit,
        outlier_documents=args.outlier_documents,
        explanation=args.explanation,
        evidence=args.evidence,
        last_run_id=args.run_id,
    )
    with session_scope() as db:
        rec = db.scalar(select(ExceptionRecord).where(ExceptionRecord.dedupe_key == key))
        if rec is None:
            rec = ExceptionRecord(
                dedupe_key=key,
                set_id=args.set_id,
                metric=args.metric,
                period=args.period,
                first_run_id=args.run_id,
                status=ExceptionStatus.OPEN,
                **fields,
            )
            db.add(rec)
            db.flush()
            return ExceptionOut(exception_id=rec.id, created=True, status=rec.status)
        for k, v in fields.items():
            setattr(rec, k, v)
        if rec.status == ExceptionStatus.RESOLVED_BY_RERUN:
            rec.status = ExceptionStatus.OPEN
        return ExceptionOut(exception_id=rec.id, created=False, status=rec.status)


def close_stale_exceptions(args: CloseStaleIn, **_) -> CloseStaleOut:
    with session_scope() as db:
        stale = db.scalars(
            select(ExceptionRecord).where(
                ExceptionRecord.set_id == args.set_id,
                ExceptionRecord.status == ExceptionStatus.OPEN,
                ExceptionRecord.dedupe_key.not_in(args.keep_keys or [""]),
            )
        ).all()
        for rec in stale:
            rec.status, rec.last_run_id = ExceptionStatus.RESOLVED_BY_RERUN, args.run_id
        return CloseStaleOut(closed=len(stale))


# ===================================================================================== registry
@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    fn: Callable[..., BaseModel]

    def schema(self) -> dict:
        """OpenAI/Anthropic-style function schema (name, description, JSON-schema parameters)."""
        return {"name": self.name, "description": self.description, "parameters": self.input_model.model_json_schema()}


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool(
            "list_documents",
            "List the documents in a document set with company context.",
            ListDocumentsIn,
            ListDocumentsOut,
            list_documents,
        ),
        Tool(
            "extract_line_items",
            "Parse one document into traceable line items and store them.",
            ExtractIn,
            ExtractOut,
            extract_line_items,
        ),
        Tool(
            "load_observations",
            "Load all stored line items of a set grouped by metric and period.",
            LoadObservationsIn,
            LoadObservationsOut,
            load_observations,
        ),
        Tool(
            "get_historical_baseline",
            "Audited historical values strictly before a fiscal year.",
            BaselineIn,
            BaselineOut,
            get_historical_baseline,
        ),
        Tool(
            "persist_exception",
            "Create or update a structured exception record (idempotent).",
            ExceptionIn,
            ExceptionOut,
            persist_exception,
        ),
        Tool(
            "close_stale_exceptions",
            "Resolve open exceptions a re-run no longer finds.",
            CloseStaleIn,
            CloseStaleOut,
            close_stale_exceptions,
        ),
    ]
}


def _summarise(out: BaseModel) -> dict:
    """Small, bounded trace payload: tools can define summary(), otherwise a truncated dump."""
    if hasattr(out, "summary"):
        return out.summary()
    data = out.model_dump()
    return {k: (v if len(str(v)) < 500 else f"<{type(v).__name__} len={len(v)}>") for k, v in data.items()}


class ToolExecutor:
    """Validates, retries and traces tool calls for one node of one run."""

    def __init__(self, run_id: str, node: str, context: dict[str, Any] | None = None):
        self.run_id, self.node = run_id, node
        self.context = context or {}  # extra non-serialisable args (e.g. the label mapper)
        s = get_settings()
        self.max_attempts, self.backoff = s.tool_max_attempts, s.tool_backoff_seconds

    def call(self, name: str, **kwargs) -> Any:
        tool = TOOLS[name]
        args = tool.input_model.model_validate(kwargs)  # fail fast on bad input (never retried)
        started, attempt, error = time.perf_counter(), 0, None
        while True:
            attempt += 1
            try:
                out = tool.fn(args, **self.context)
                out = tool.output_model.model_validate(out.model_dump())  # output contract check
                self._trace(tool, args, _summarise(out), "ok", attempt, started, None)
                return out
            except (TransientToolError, OperationalError) as exc:
                error = exc
                if attempt >= self.max_attempts:
                    break
                log.warning("tool %s attempt %d failed (%s); retrying", name, attempt, exc)
                time.sleep(self.backoff * 2 ** (attempt - 1))
            except Exception as exc:  # non-transient: record and propagate
                self._trace(tool, args, None, "error", attempt, started, repr(exc))
                raise
        self._trace(tool, args, None, "error", attempt, started, repr(error))
        raise error

    def _trace(self, tool, args, summary, status, attempts, started, error) -> None:
        payload = args.model_dump()
        if tool.name == "persist_exception":  # keep traces small: evidence can be large
            payload.pop("evidence", None)
        try:
            with session_scope() as db:
                db.add(
                    ToolCall(
                        run_id=self.run_id,
                        node=self.node,
                        tool=tool.name,
                        input=payload,
                        output_summary=summary,
                        status=status,
                        attempts=attempts,
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        error=error,
                    )
                )
        except Exception:  # tracing must never break the run
            log.exception("could not write tool trace")
