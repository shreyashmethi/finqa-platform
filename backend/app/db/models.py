"""
ORM models (SQLAlchemy 2.0 typed mappings).

Table overview
--------------
companies              reference data: currency, fiscal year end, segment names
historical_baselines   audited prior-period values used by the baseline agent
document_sets          one company x fiscal year bundle of documents to reconcile
documents              files in a set (PDF / XLSX / CSV) with storage path and checksum
line_items             every figure extracted from a document, with its exact source location
runs                   one execution of the agent graph over a set
run_steps              one row per graph node execution (trace)
tool_calls             one row per tool invocation (trace: inputs, output summary, timing, errors)
exceptions             structured exception records, one per (set, metric, period)
review_decisions       append-only audit log of reviewer actions on exceptions
app_settings           runtime-tunable rules (tolerances, thresholds) edited by admins

Monetary values are stored as base units (whole currency units, or persons for headcount) in
double precision. The largest realistic value (~1e14 for a unit error on a large company) still
keeps sub-unit precision, and avoiding Decimal keeps the reconciliation maths simple.
"""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Declarative base shared by all models (and by Alembic autogenerate)."""


# ------------------------------------------------------------------------------------------ enums
class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExceptionStatus(StrEnum):
    OPEN = "open"  # waiting for review
    ACCEPTED = "accepted"  # reviewer confirmed it is a real discrepancy
    REJECTED = "rejected"  # reviewer marked it a false positive
    OVERRIDDEN = "overridden"  # reviewer recorded the correct value with a comment
    RESOLVED_BY_RERUN = "resolved_by_rerun"  # a later run no longer finds it


class DecisionAction(StrEnum):
    ACCEPT = "accept"
    REJECT = "reject"
    OVERRIDE = "override"
    COMMENT = "comment"
    REOPEN = "reopen"


# ----------------------------------------------------------------------------------- reference data
class Company(Base):
    __tablename__ = "companies"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    sector: Mapped[str | None] = mapped_column(String(80))
    currency: Mapped[str] = mapped_column(String(3))
    fiscal_year_end: Mapped[str | None] = mapped_column(String(40))
    segments: Mapped[list[str]] = mapped_column(JSON, default=list)


class HistoricalBaseline(Base):
    __tablename__ = "historical_baselines"

    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"), primary_key=True)
    metric: Mapped[str] = mapped_column(String(120), primary_key=True)
    period: Mapped[str] = mapped_column(String(16), primary_key=True)  # FY2024 or FY2024-Q3
    # Fiscal year of the period, denormalised so "only data before FY Y" is a cheap indexed filter.
    fiscal_year: Mapped[int] = mapped_column(Integer, index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(40), default="audited_history")


# ---------------------------------------------------------------------------------------- documents
class DocumentSet(Base):
    __tablename__ = "document_sets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. C004-FY2024
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"), index=True)
    fiscal_year: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(20), default="upload")  # upload | corpus
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    company: Mapped[Company] = relationship()
    documents: Mapped[list["Document"]] = relationship(
        back_populates="document_set", cascade="all, delete-orphan", order_by="Document.filename"
    )


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("set_id", "filename", name="uq_document_set_filename"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    set_id: Mapped[str] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    format: Mapped[str] = mapped_column(String(8))  # pdf | xlsx | csv
    storage_path: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    pages: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    document_set: Mapped[DocumentSet] = relationship(back_populates="documents")


class LineItem(Base):
    """One figure found in one place of one document."""

    __tablename__ = "line_items"
    __table_args__ = (Index("ix_line_items_set_metric_period", "set_id", "metric", "period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    set_id: Mapped[str] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"))
    metric: Mapped[str] = mapped_column(String(120))  # canonical metric name
    period: Mapped[str] = mapped_column(String(16))  # canonical period
    value: Mapped[float | None] = mapped_column(Float)  # base units; None = shown as missing
    is_missing: Mapped[bool] = mapped_column(Boolean, default=False)
    precision: Mapped[float] = mapped_column(Float)  # display step in base units (rounding tolerance)
    raw_label: Mapped[str] = mapped_column(String(255))
    raw_value: Mapped[str] = mapped_column(String(64))
    unit_label: Mapped[str] = mapped_column(String(64))
    # Exact source location: page/table/row/column/bbox for PDFs, sheet/cell for XLSX, line for CSV.
    location: Mapped[dict] = mapped_column(JSON)
    method: Mapped[str] = mapped_column(String(20), default="rules")  # rules | llm


# --------------------------------------------------------------------------------------------- runs
class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    set_id: Mapped[str] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default=RunStatus.QUEUED, index=True)
    current_node: Mapped[str | None] = mapped_column(String(40))
    step_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    # Summary numbers: items extracted, exceptions found, LLM calls/tokens, timings.
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)


class RunStep(Base):
    __tablename__ = "run_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    node: Mapped[str] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    node: Mapped[str] = mapped_column(String(40))
    tool: Mapped[str] = mapped_column(String(60))
    input: Mapped[dict] = mapped_column(JSON)
    output_summary: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(12))  # ok | error
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# --------------------------------------------------------------------------------------- exceptions
class ExceptionRecord(Base):
    """A flagged discrepancy. Unique per (set, metric, period) so re-runs update, never duplicate."""

    __tablename__ = "exceptions"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_exception_dedupe"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dedupe_key: Mapped[str] = mapped_column(String(64))  # sha256(set|metric|period)
    set_id: Mapped[str] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(120), index=True)
    period: Mapped[str] = mapped_column(String(16))
    type: Mapped[str] = mapped_column(String(32), index=True)
    severity: Mapped[str] = mapped_column(String(8), index=True)
    status: Mapped[str] = mapped_column(String(20), default=ExceptionStatus.OPEN, index=True)
    expected_value: Mapped[float | None] = mapped_column(Float)  # consensus / baseline value
    reported_value: Mapped[float | None] = mapped_column(Float)  # the outlier value
    unit: Mapped[str] = mapped_column(String(16))
    outlier_documents: Mapped[list[str]] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text)
    # Evidence: line items on both sides (ids + locations + displayed text), baseline values used.
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    first_run_id: Mapped[str] = mapped_column(String(36))
    last_run_id: Mapped[str] = mapped_column(String(36))
    override_value: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    decisions: Mapped[list["ReviewDecision"]] = relationship(
        back_populates="exception", order_by="ReviewDecision.created_at", cascade="all, delete-orphan"
    )


class ReviewDecision(Base):
    """Append-only audit trail. Rows are never updated or deleted by the application."""

    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exception_id: Mapped[str] = mapped_column(ForeignKey("exceptions.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(16))
    comment: Mapped[str | None] = mapped_column(Text)
    override_value: Mapped[float | None] = mapped_column(Float)
    status_before: Mapped[str] = mapped_column(String(20))
    status_after: Mapped[str] = mapped_column(String(20))
    username: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    exception: Mapped[ExceptionRecord] = relationship(back_populates="decisions")


class AppSetting(Base):
    """Key/value store for admin-tunable rules (JSON values)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict | list | float | str] = mapped_column(JSON)
    updated_by: Mapped[str] = mapped_column(String(80), default="system")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class LabelMapping(Base):
    """Cache of labels the LLM mapped to canonical metrics, so each label is only asked once."""

    __tablename__ = "label_mappings"

    label: Mapped[str] = mapped_column(String(255), primary_key=True)  # normalised label text
    metric: Mapped[str | None] = mapped_column(String(120))  # None = "not a tracked metric"
    source: Mapped[str] = mapped_column(String(20), default="llm")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
