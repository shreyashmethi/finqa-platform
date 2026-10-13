"""Unit tests for pure domain logic: periods, units, vocabulary, reconciliation rules."""

import pytest

from app.domain.periods import find_periods, parse_period, previous_year_period
from app.domain.reconcile import agree, baseline_anomaly, classify, consensus, reconcile_key, severity
from app.domain.types import Observation
from app.domain.units import decimals_from_excel_format, parse_number, parse_unit
from app.domain.vocabulary import map_label


# ------------------------------------------------------------------------------------------ periods
@pytest.mark.parametrize(
    "text,expected",
    [
        ("FY2025", "FY2025"),
        ("FY25", "FY2025"),
        ("FY2024-25", "FY2025"),
        ("FY 2024-25", "FY2025"),
        ("Q3 FY2025", "FY2025-Q3"),
        ("Q3 FY2024-25", "FY2025-Q3"),
        ("Q3FY25", "FY2025-Q3"),
        ("2025Q3", "FY2025-Q3"),
        ("FY2025-Q3", "FY2025-Q3"),
        ("Revenue", None),
        ("2025", None),
    ],
)
def test_parse_period(text, expected):
    assert parse_period(text) == expected


def test_find_periods_in_header_line():
    found = [p for p, _, _ in find_periods("Metric Q4 FY2024-25 Q4 FY2023-24 YoY")]
    assert found == ["FY2025-Q4", "FY2024-Q4"]


def test_previous_year_period():
    assert previous_year_period("FY2025") == "FY2024"
    assert previous_year_period("FY2025-Q2") == "FY2024-Q2"


# -------------------------------------------------------------------------------------------- units
@pytest.mark.parametrize(
    "text,mult",
    [
        ("Consolidated statement (USD million)", 1e6),
        ("INR crore", 1e7),
        ("All amounts in USD '000", 1e3),
        ("INR lakh", 1e5),
        ("USD billion", 1e9),
    ],
)
def test_parse_unit(text, mult):
    assert parse_unit(text).multiplier == mult


def test_parse_unit_ignores_words_containing_scale_letters():
    assert parse_unit("Credit risk and concentration") is None


@pytest.mark.parametrize(
    "token,value,decimals",
    [
        ("8,659.7", 8659.7, 1),
        ("(885.1)", -885.1, 1),
        ("1,23,456.78", 123456.78, 2),
        ("-12", -12, 0),
    ],
)
def test_parse_number(token, value, decimals):
    n = parse_number(token)
    assert n.value == pytest.approx(value) and n.decimals == decimals


def test_parse_number_rejects_text():
    assert parse_number("+12.1%") is None and parse_number("n/m") is None


def test_excel_decimals():
    assert decimals_from_excel_format("#,##0.00;(#,##0.00)") == 2
    assert decimals_from_excel_format("#,##0") == 0


# --------------------------------------------------------------------------------------- vocabulary
@pytest.mark.parametrize(
    "label,metric",
    [
        ("Revenue from operations", "revenue"),
        ("Net sales", "revenue"),
        ("REV", "revenue"),
        ("PAT", "net_income"),
        ("Headcount (FTE)", "headcount"),
        ("Shareholders' equity", "total_equity"),
        ("D&A", "d_and_a"),
        ("Total", None),
        ("North America", None),
    ],
)
def test_map_label(label, metric):
    assert map_label(label, ["Freight"]) == metric


def test_map_label_segments():
    assert map_label("Last Mile", ["Last Mile"]) == "segment_revenue:Last Mile"
    assert map_label("SEG_LAST_MILE", ["Last Mile"]) == "segment_revenue:Last Mile"
    assert map_label("New Segment", [], segment_context=True) == "segment_revenue:New Segment"


# ----------------------------------------------------------------------------------- reconciliation
def obs(doc: str, value, precision, missing=False, ext="pdf") -> Observation:
    return Observation(
        line_item_id=hash(doc) % 1000,
        document_id=doc,
        filename=f"{doc}.{ext}",
        value=value,
        precision=precision,
        raw_value=str(value),
        location={},
        is_missing=missing,
    )


def test_agree_within_rounding():
    # 8,659.7 (USD m, step 0.1m) vs 8,659,697 (USD '000)
    assert agree(8_659_700_000, 100_000, 8_659_697_000, 1_000)
    assert not agree(8_659_700_000, 100_000, 8_659_500_000, 1_000)


@pytest.mark.parametrize(
    "reported,expected,prior,kind",
    [
        (-500.0, 500.0, None, "sign_error"),
        (500_000.0, 500.0, None, "unit_error"),
        (480.0, 500.0, 480.0, "stale_period"),
        (1243.0, 1234.0, None, "transposition"),
        (530.0, 500.0, None, "value_mismatch"),
    ],
)
def test_classify(reported, expected, prior, kind):
    assert classify(reported, 1, expected, 1, prior, 0)[0] == kind


def test_reconcile_majority_wins_and_rounding_is_not_a_finding():
    clean = [
        obs("a", 1_234_500_000, 100_000),
        obs("b", 1_234_549_000, 1_000, ext="xlsx"),
        obs("c", 1_234_549_000, 1, ext="csv"),
    ]
    assert reconcile_key("revenue", "FY2025", clean) is None
    f = reconcile_key("revenue", "FY2025", clean + [obs("d", 1_334_500_000, 100_000)])
    assert f.type == "value_mismatch" and f.outlier_documents == ["d.pdf"]
    assert f.expected_value == pytest.approx(1_234_549_000, rel=1e-6)


def test_reconcile_missing_item():
    f = reconcile_key("net_income", "FY2025", [obs("a", 95.2e6, 1e5), obs("x", None, 1e3, missing=True, ext="xlsx")])
    assert f.type == "missing_item" and f.outlier_documents == ["x.xlsx"]


def test_tie_prefers_non_stale_value():
    # Two documents disagree; one equals last year's figure -> it is the outlier, typed stale.
    f = reconcile_key(
        "ebit", "FY2025", [obs("ar", 86.0e6, 1e5), obs("mx", 65_623_000, 1e3, ext="xlsx")], prior=(65_623_000, 0.0)
    )
    assert f.type == "stale_period" and f.outlier_documents == ["mx.xlsx"]


def test_consensus_and_baseline_anomaly():
    value, _, support = consensus([obs("a", 80e6, 1e5), obs("b", 80e6, 1e3, ext="xlsx")])
    assert value == 80e6 and len(support) == 2
    f = baseline_anomaly("capex", "FY2025", 80e6, 50e6, 0.30, support)
    assert f.type == "baseline_anomaly" and f.detail["yoy"] == pytest.approx(0.6)
    assert baseline_anomaly("capex", "FY2025", 55e6, 50e6, 0.30, support) is None


def test_severity_rules():
    assert severity("value_mismatch", "revenue", 100.0, 106.0) == "high"
    assert severity("value_mismatch", "capex", 100.0, 106.0) == "medium"
    assert severity("value_mismatch", "capex", 100.0, 101.0) == "low"
    assert severity("unit_error", "capex", 100.0, 1.0e5) == "high"
