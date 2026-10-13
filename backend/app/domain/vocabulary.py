"""
Canonical metric vocabulary and label normalisation.

Documents name the same figure differently ("Revenue from operations", "Net sales", "REV").
Extraction maps every row label to one canonical metric name so figures can be compared across
documents. Unknown labels are returned as ``None``; the extraction agent may then ask the optional
LLM label mapper, whose answers are cached in the ``label_mappings`` table.
"""

import re

# Canonical metric names, in the order the UI lists them.
METRICS: tuple[str, ...] = (
    "revenue",
    "cogs",
    "gross_profit",
    "opex",
    "ebitda",
    "d_and_a",
    "ebit",
    "interest_expense",
    "pbt",
    "tax",
    "net_income",
    "total_assets",
    "total_liabilities",
    "total_equity",
    "cash",
    "employee_costs",
    "headcount",
    "capex",
)
SEGMENT_PREFIX = "segment_revenue:"

# Human-readable names for the UI and explanations.
METRIC_DISPLAY: dict[str, str] = {
    "revenue": "Revenue",
    "cogs": "Cost of goods sold",
    "gross_profit": "Gross profit",
    "opex": "Operating expenses",
    "ebitda": "EBITDA",
    "d_and_a": "Depreciation & amortisation",
    "ebit": "EBIT",
    "interest_expense": "Interest / finance costs",
    "pbt": "Profit before tax",
    "tax": "Tax",
    "net_income": "Net income",
    "total_assets": "Total assets",
    "total_liabilities": "Total liabilities",
    "total_equity": "Total equity",
    "cash": "Cash",
    "employee_costs": "Employee costs",
    "headcount": "Headcount",
    "capex": "Capex",
}

# Headline metrics carry a lower severity threshold (BRD severity rules).
HEADLINE_METRICS = frozenset({"revenue", "ebitda", "net_income", "total_assets", "cash"})

# Metrics whose sign can legitimately be negative (profit lines); used by sign-error detection.
SIGNED_METRICS = frozenset({"ebitda", "ebit", "pbt", "net_income", "gross_profit"})

# Synonym table. Keys are normalised labels (see normalise_label). Extend via config if needed.
_SYNONYMS: dict[str, str] = {}


def _add(metric: str, *labels: str) -> None:
    for label in labels:
        _SYNONYMS[normalise_label(label)] = metric


def normalise_label(label: str) -> str:
    """Lower-case, drop bracketed qualifiers like "(number)" or "(FTE)", collapse whitespace."""
    text = re.sub(r"\(.*?\)", " ", label.lower())
    text = text.replace("&", " and ").replace("’", "'")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


_add(
    "revenue",
    "Revenue from operations",
    "Net sales",
    "Total revenue",
    "Revenue",
    "Revenues",
    "REV",
    "Sales",
    "Turnover",
    "Total income from operations",
)
_add("cogs", "Cost of materials and services", "COGS", "Cost of goods sold", "Cost of sales", "Cost of revenue")
_add("gross_profit", "Gross profit", "GP", "Gross margin")
_add("opex", "Operating expenses", "Total opex", "OPEX", "Opex", "Total operating expenses")
_add("ebitda", "EBITDA")
_add("d_and_a", "Depreciation and amortisation", "Depreciation and amortization", "D&A", "D and A")
_add("ebit", "Operating profit", "EBIT", "Operating income")
_add("interest_expense", "Finance costs", "Interest expense", "Net interest expense", "Finance cost")
_add("pbt", "Profit before tax", "PBT", "Income before tax", "Pre-tax profit")
_add("tax", "Tax expense", "Income tax", "Income tax expense", "Tax")
_add("net_income", "Profit for the year", "Net income", "PAT", "NI", "Net profit", "Profit after tax", "Net earnings")
_add("total_assets", "Total assets")
_add("total_liabilities", "Total liabilities")
_add("total_equity", "Total equity", "Shareholders' equity", "Shareholders equity", "Total shareholders' equity")
_add("cash", "Cash and cash equivalents", "Cash on hand", "Cash & equivalents", "Cash")
_add("employee_costs", "Employee benefits expense", "Personnel costs", "EMP_COST", "Employee costs", "Staff costs")
_add(
    "headcount",
    "Employees at year end",
    "Headcount",
    "Headcount (FTE)",
    "Headcount (period end)",
    "Employees",
    "Number of employees",
)
_add("capex", "Additions to property, plant and equipment", "Capex", "CAPEX", "Capital expenditure")

# Labels that look like metrics but are ambiguous in context; never map them.
_AMBIGUOUS = {"total", "subtotal", "other"}


def map_label(label: str, segments: list[str] | None = None, segment_context: bool = False) -> str | None:
    """
    Map a raw row label to a canonical metric, or ``None`` if it is not a tracked figure.

    ``segments`` are the company's known segment names; ``segment_context`` is True when the label
    sits in a table or sheet about segments, which lets unknown names become segment metrics.
    """
    norm = normalise_label(label)
    if not norm or norm in _AMBIGUOUS:
        return None
    # Segment codes in machine files, e.g. SEG_LAST_MILE.
    if norm.startswith("seg "):
        return segment_metric(norm[4:], segments)
    # Known segment names win over the synonym table (a segment could be called "Services").
    for seg in segments or []:
        if normalise_label(seg) == norm:
            return SEGMENT_PREFIX + seg
    if norm in _SYNONYMS:
        return _SYNONYMS[norm]
    if segment_context:
        return SEGMENT_PREFIX + label.strip()
    return None


def segment_metric(code: str, segments: list[str] | None) -> str:
    """Turn a segment code ("last mile", "LAST_MILE") into ``segment_revenue:<Name>``."""
    norm = normalise_label(code.replace("_", " "))
    for seg in segments or []:
        if normalise_label(seg) == norm:
            return SEGMENT_PREFIX + seg
    return SEGMENT_PREFIX + norm.title()


def display_metric(metric: str) -> str:
    """Readable metric name for explanations and the UI."""
    if metric.startswith(SEGMENT_PREFIX):
        return f"Segment revenue - {metric[len(SEGMENT_PREFIX) :]}"
    return METRIC_DISPLAY.get(metric, metric)
