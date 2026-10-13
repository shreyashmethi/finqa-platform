"""
Typed state shared by all nodes of the review graph.

Only small, JSON-serialisable data lives here because LangGraph checkpoints the full state after
every step. Bulky data (line items) is persisted in the database by tools and referenced by id.

Fields annotated with ``operator.add`` are *accumulated*: a node returns only its new entries and
LangGraph appends them, so parallel or resumed steps never overwrite each other's progress.
"""

import operator
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict


class ReviewState(TypedDict, total=False):
    # --- identity (set by the runner when the run starts)
    run_id: str
    set_id: str
    # --- context discovered by the supervisor
    company_id: str
    fiscal_year: int
    currency: str
    segments: list[str]
    documents: list[dict]  # [{document_id, filename, format, path}]
    rules: dict  # reconciliation rules in force for this run
    # --- progress
    extracted: Annotated[list[str], operator.add]  # document ids already parsed
    extraction_stats: Annotated[list[dict], operator.add]
    reconciled: bool
    baseline_checked: bool
    exceptions_persisted: bool
    # --- results
    findings: list[dict]  # cross-document discrepancies (domain.types.Finding as dict)
    baseline_inputs: dict[str, dict]  # "metric|period" -> {value, precision, evidence}
    anomalies: list[dict]  # baseline anomalies (Finding as dict)
    exception_ids: list[str]
    summary: dict
    # --- control / audit
    next_agent: str
    route_log: Annotated[list[dict], operator.add]  # supervisor decisions with reasons


@dataclass
class RunContext:
    """
    Per-run objects that cannot (and should not) be checkpointed, passed to nodes through
    LangGraph's ``config["configurable"]["ctx"]``. Rebuilt by the runner on resume.
    """

    run_id: str
    label_resolver: Any = None  # app.agents.llm.LabelResolver, built once documents are known
    llm: Any = None  # app.agents.llm.LLMLabelMapper or None
    extra: dict = field(default_factory=dict)
