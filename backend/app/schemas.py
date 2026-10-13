"""
API request/response schemas (Pydantic v2).

Response models decouple the public API from the ORM: internal columns can change without
breaking the frontend, and FastAPI publishes these shapes in the OpenAPI document (/docs).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Me(BaseModel):
    username: str
    role: str


class CompanyOut(_ORM):
    id: str
    name: str
    sector: str | None
    currency: str
    fiscal_year_end: str | None
    segments: list[str]


class CompanyIn(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,32}$")
    name: str = Field(min_length=1, max_length=200)
    sector: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    fiscal_year_end: str | None = None
    segments: list[str] = []


class DocumentOut(_ORM):
    id: str
    filename: str
    format: str
    size_bytes: int
    pages: int | None
    sha256: str


class RunBrief(_ORM):
    id: str
    status: str
    created_at: datetime
    finished_at: datetime | None
    step_count: int
    current_node: str | None


class SetSummary(BaseModel):
    id: str
    company_id: str
    company_name: str
    currency: str
    fiscal_year: int
    source: str
    documents: int
    latest_run: RunBrief | None
    open_exceptions: int
    total_exceptions: int


class SetDetail(SetSummary):
    document_list: list[DocumentOut]


class RunStepOut(_ORM):
    seq: int
    node: str
    started_at: datetime
    duration_ms: int
    summary: dict


class ToolCallOut(_ORM):
    id: int
    node: str
    tool: str
    input: dict
    output_summary: dict | None
    status: str
    attempts: int
    duration_ms: int
    error: str | None
    created_at: datetime


class RunOut(_ORM):
    id: str
    set_id: str
    status: str
    current_node: str | None
    step_count: int
    created_by: str
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None
    stats: dict


class RunDetail(RunOut):
    steps: list[RunStepOut]


class DecisionOut(_ORM):
    id: int
    action: str
    comment: str | None
    override_value: float | None
    status_before: str
    status_after: str
    username: str
    role: str
    created_at: datetime


class ExceptionOut(_ORM):
    id: str
    set_id: str
    metric: str
    period: str
    type: str
    severity: str
    status: str
    expected_value: float | None
    reported_value: float | None
    override_value: float | None
    unit: str
    outlier_documents: list[str]
    explanation: str
    created_at: datetime
    updated_at: datetime


class ExceptionDetail(ExceptionOut):
    evidence: dict
    decisions: list[DecisionOut]
    documents: dict[str, str]  # filename -> document id (for evidence links)


class ExceptionPage(BaseModel):
    items: list[ExceptionOut]
    total: int
    limit: int
    offset: int


class DecisionIn(BaseModel):
    action: Literal["accept", "reject", "override", "comment", "reopen"]
    comment: str | None = Field(default=None, max_length=4000)
    override_value: float | None = None


class RulesOut(BaseModel):
    anomaly_threshold: float
    baseline_metrics: list[str]


class RulesIn(BaseModel):
    anomaly_threshold: float | None = Field(default=None, gt=0, lt=10)
    baseline_metrics: list[str] | None = None


class Summary(BaseModel):
    sets: int
    runs_by_status: dict[str, int]
    exceptions_by_status: dict[str, int]
    open_by_severity: dict[str, int]
    open_by_type: dict[str, int]


class AuditEntry(BaseModel):
    """One reviewer decision with enough of its exception to read it out of context."""

    id: int
    exception_id: str
    set_id: str
    metric: str
    period: str
    severity: str
    unit: str
    action: str
    comment: str | None
    override_value: float | None
    status_before: str
    status_after: str
    username: str
    role: str
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditEntry]
    total: int
    limit: int
    offset: int


class CompanyReport(BaseModel):
    company_id: str
    company_name: str
    sets: int
    open: int
    high: int
    decided: int


class Reports(BaseModel):
    by_company: list[CompanyReport]
    type_by_severity: dict[str, dict[str, int]]  # open exceptions: type -> severity -> count
    by_metric: dict[str, int]  # open exceptions per metric
    decisions_by_user: dict[str, int]
    decisions_by_action: dict[str, int]


class UserOut(BaseModel):
    username: str
    role: str
    decisions: int
    runs_started: int
    last_active: datetime | None


class SystemStatus(BaseModel):
    version: str
    database: str  # backend name only, never the URL (it may hold credentials)
    llm_enabled: bool
    llm_model: str | None
    llm_max_calls_per_run: int
    worker_threads: int
    max_steps: int
    anomaly_threshold: float
    counts: dict[str, int]
    runs_by_status: dict[str, int]
