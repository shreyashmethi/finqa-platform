"""
Plain data types passed between parsers, reconciliation and agents.

These are dataclasses (not ORM models) so the domain logic stays independent of the database and
is trivial to unit-test.
"""

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ExtractedItem:
    """One figure read from one location in one document."""

    metric: str  # canonical metric
    period: str  # canonical period
    value: float | None  # base units; None when the cell shows a dash / is blank
    precision: float  # rounding step in base units, from displayed decimals x unit multiplier
    raw_label: str
    raw_value: str
    unit_label: str
    location: dict[str, Any]  # page/table/row/column/bbox | sheet/cell | line
    is_missing: bool = False
    method: str = "rules"


@dataclass
class Observation:
    """An extracted item enriched with its document identity, as used by reconciliation."""

    line_item_id: int
    document_id: str
    filename: str
    value: float | None
    precision: float
    raw_value: str
    location: dict[str, Any]
    is_missing: bool = False


@dataclass
class Finding:
    """A candidate discrepancy for one (metric, period), produced by reconciliation or baseline."""

    metric: str
    period: str
    # value_mismatch | unit_error | transposition | stale_period | sign_error | missing_item | baseline_anomaly
    type: str
    expected_value: float | None  # consensus (or baseline) value
    reported_value: float | None  # value in the outlier document(s)
    outlier_documents: list[str]
    supporting: list[dict] = field(default_factory=list)  # evidence agreeing with expected value
    conflicting: list[dict] = field(default_factory=list)  # evidence carrying the outlier value
    baseline: dict | None = None  # baseline value(s) consulted, if any
    severity: str = "medium"
    detail: dict = field(default_factory=dict)  # extra numbers for the explanation (ratio, yoy, ...)

    def to_dict(self) -> dict:
        return asdict(self)
