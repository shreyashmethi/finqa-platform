"""
Reconciliation rules.

Given every observation of one (metric, period) across a document set, decide whether the
documents agree, which document is the outlier, and what kind of error it looks like.

Key ideas
---------
* **Rounding-aware equality.** Two displayed values agree when they differ by no more than half of
  each one's display step: ``|a - b| <= (step_a + step_b) / 2``. A value shown as 8,659.7 (USD m)
  and 8,659,697 (USD '000) therefore agree.
* **Consensus by agreement count.** The value most documents agree with is the expected value;
  ties are broken by an independent reference (audited baseline for the same period), then by
  finer precision, then by a document-type priority (management accounts are the book of record).
* **Classification** of the outlier, in order: sign flip, unit/scale error, stale (prior-period)
  value, digit transposition, otherwise a plain value mismatch.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable

from app.domain.types import Finding, Observation
from app.domain.vocabulary import HEADLINE_METRICS, SIGNED_METRICS, display_metric

# Scale factors that indicate a value was entered in the wrong unit (thousands vs units,
# lakh vs crore, millions vs units, ...).
UNIT_FACTORS = (1e3, 1e-3, 1e2, 1e-2, 1e5, 1e-5, 1e6, 1e-6, 1e7, 1e-7)

# When documents tie, prefer the more authoritative document type.
DOC_PRIORITY = {"xlsx": 5, "csv": 4, "pdf": 3}


def agree(a: float, step_a: float, b: float, step_b: float) -> bool:
    """True if two displayed values can be the same underlying number after rounding."""
    return abs(a - b) <= (step_a + step_b) / 2 * 1.001 + 1e-6


def _representative(obs: list[Observation]) -> Observation | None:
    """A document may show a figure several times; take its most common value (finest precision)."""
    present = [o for o in obs if o.value is not None]
    if not present:
        return None
    counts = Counter(round(o.value, 6) for o in present)
    top_value = counts.most_common(1)[0][0]
    candidates = [o for o in present if round(o.value, 6) == top_value]
    return min(candidates, key=lambda o: o.precision)


def _doc_priority(o: Observation) -> int:
    return DOC_PRIORITY.get(o.filename.rsplit(".", 1)[-1].lower(), 1)


def _evidence(o: Observation) -> dict:
    """Serialisable evidence entry for one observation."""
    return {
        "line_item_id": o.line_item_id,
        "document_id": o.document_id,
        "filename": o.filename,
        "value": o.value,
        "displayed": o.raw_value,
        "location": o.location,
        "missing": o.is_missing,
    }


def _is_transposition(reported: float, expected: float, step: float) -> bool:
    """
    True if the reported digits equal the expected digits with two adjacent digits swapped.

    The swap may have happened in a document shown at coarser precision than the copy we parsed
    (e.g. "$11.62bn" typed as "$16.12bn", while our parsed table shows 16,120.0 million), so the
    digits are compared at the parsed step and at up to four coarser steps.
    """
    if step <= 0:
        return False
    for k in range(5):
        s = step * 10**k
        r = str(int(round(abs(reported) / s)))
        e = str(int(round(abs(expected) / s)))
        if len(r) < 3 or len(r) != len(e) or r == e:
            continue
        diffs = [i for i in range(len(r)) if r[i] != e[i]]
        if len(diffs) == 2 and diffs[1] == diffs[0] + 1 and r[diffs[0]] == e[diffs[1]] and r[diffs[1]] == e[diffs[0]]:
            return True
    return False


def classify(
    reported: float,
    reported_step: float,
    expected: float,
    expected_step: float,
    prior_value: float | None,
    prior_step: float,
) -> tuple[str, dict]:
    """Return (discrepancy type, detail numbers) for a reported value that disagrees with expected."""
    tol = (reported_step + expected_step) / 2 * 1.001 + 1e-6
    if expected != 0 and abs(reported + expected) <= tol:
        return "sign_error", {}
    if expected != 0:
        for factor in UNIT_FACTORS:
            scaled = expected * factor
            if abs(reported - scaled) <= reported_step / 2 + expected_step * factor / 2 + abs(scaled) * 1e-3:
                return "unit_error", {"factor": factor}
    if prior_value is not None and agree(reported, reported_step, prior_value, prior_step):
        return "stale_period", {"prior_value": prior_value}
    if _is_transposition(reported, expected, reported_step):
        return "transposition", {}
    rel = (reported - expected) / abs(expected) if expected else None
    return "value_mismatch", {"relative_difference": rel}


def severity(kind: str, metric: str, expected: float | None, reported: float | None) -> str:
    """
    BRD severity rules.
    unit / sign / stale errors are always high; missing items and baseline anomalies medium;
    value differences scale with size, with tighter limits for headline metrics.
    """
    if kind in {"unit_error", "sign_error", "stale_period"}:
        return "high"
    if kind in {"missing_item", "baseline_anomaly"}:
        return "medium"
    if expected is None or reported is None:
        return "medium"
    rel = abs(reported - expected) / max(1.0, abs(expected))
    high, medium = (0.05, 0.01) if metric in HEADLINE_METRICS else (0.10, 0.02)
    return "high" if rel >= high else "medium" if rel >= medium else "low"


def reconcile_key(
    metric: str,
    period: str,
    observations: Iterable[Observation],
    prior: tuple[float, float] | None = None,
    reference: float | None = None,
) -> Finding | None:
    """
    Reconcile one (metric, period).

    ``prior``     (value, step) for the same period a year earlier - used to spot stale values.
    ``reference`` independent value for this exact period (e.g. audited baseline) - tie-breaker.
    Returns a Finding when documents disagree or a document is missing the figure, else None.
    """
    by_doc: dict[str, list[Observation]] = defaultdict(list)
    for o in observations:
        by_doc[o.document_id].append(o)
    reps = {d: r for d, obs in by_doc.items() if (r := _representative(obs)) is not None}
    missing = [obs[0] for d, obs in by_doc.items() if d not in reps and any(o.is_missing for o in obs)]
    if not reps or (len(reps) == 1 and not missing):
        return None  # nothing to compare

    def support(d: str) -> int:
        r = reps[d]
        return sum(agree(r.value, r.precision, o.value, o.precision) for o in reps.values())

    def rank(d: str) -> tuple:
        r = reps[d]
        ref_ok = reference is not None and agree(r.value, r.precision, reference, 0.0)
        # A value equal to last year's figure is a likely stale carry-forward, so it should lose a tie.
        not_stale = prior is None or not agree(r.value, r.precision, prior[0], prior[1])
        return (support(d), ref_ok, not_stale, -r.precision, _doc_priority(r))

    anchor = reps[max(reps, key=rank)]
    agreeing = [r for r in reps.values() if agree(anchor.value, anchor.precision, r.value, r.precision)]
    outliers = [r for r in reps.values() if r not in agreeing]
    supporting_ev = [_evidence(o) for d in by_doc for o in by_doc[d] if reps.get(d) in agreeing and o.value is not None]

    if not outliers:
        if not missing:
            return None
        # Every document that shows the figure agrees, but at least one leaves it blank.
        return Finding(
            metric=metric,
            period=period,
            type="missing_item",
            expected_value=anchor.value,
            reported_value=None,
            outlier_documents=sorted({m.filename for m in missing}),
            supporting=supporting_ev,
            conflicting=[_evidence(m) for m in missing],
            severity=severity("missing_item", metric, anchor.value, None),
        )

    # The most deviant outlier determines the classification.
    worst = max(outliers, key=lambda r: abs(r.value - anchor.value))
    kind, detail = classify(
        worst.value,
        worst.precision,
        anchor.value,
        anchor.precision,
        prior[0] if prior else None,
        prior[1] if prior else 0.0,
    )
    if kind == "sign_error" and metric not in SIGNED_METRICS:
        kind = "value_mismatch"  # a sign flip on a balance (e.g. assets) is just a wrong value
    outlier_ids = {r.document_id for r in outliers}
    return Finding(
        metric=metric,
        period=period,
        type=kind,
        expected_value=anchor.value,
        reported_value=worst.value,
        outlier_documents=sorted({r.filename for r in outliers}),
        supporting=supporting_ev,
        conflicting=[_evidence(o) for d in outlier_ids for o in by_doc[d]],
        severity=severity(kind, metric, anchor.value, worst.value),
        detail=detail
        | {
            "documents_agreeing": len(agreeing),
            "documents_disagreeing": len(outliers),
            "reference_used": reference is not None and len(agreeing) == 1,
        },
    )


def consensus(observations: Iterable[Observation]) -> tuple[float, float, list[dict]] | None:
    """
    The value most documents agree on for one key: (value, precision, supporting evidence).
    Used by the baseline agent, which needs a single "current" figure per metric.
    """
    by_doc: dict[str, list[Observation]] = defaultdict(list)
    for o in observations:
        by_doc[o.document_id].append(o)
    reps = [r for obs in by_doc.values() if (r := _representative(obs)) is not None]
    if not reps:
        return None
    best = max(
        reps,
        key=lambda r: (
            sum(agree(r.value, r.precision, o.value, o.precision) for o in reps),
            -r.precision,
            _doc_priority(r),
        ),
    )
    support = [
        _evidence(o)
        for obs in by_doc.values()
        for o in obs
        if o.value is not None and agree(best.value, best.precision, o.value, o.precision)
    ]
    return best.value, best.precision, support


def baseline_anomaly(
    metric: str, period: str, current: float, prior: float, threshold: float, evidence: list[dict]
) -> Finding | None:
    """Flag a consistent but unusually large year-on-year move (|YoY| > threshold)."""
    if prior == 0:
        return None
    yoy = current / prior - 1
    if abs(yoy) <= threshold:
        return None
    return Finding(
        metric=metric,
        period=period,
        type="baseline_anomaly",
        expected_value=prior,
        reported_value=current,
        outlier_documents=[],
        supporting=evidence,
        conflicting=[],
        baseline={"period": "prior", "value": prior},
        severity=severity("baseline_anomaly", metric, prior, current),
        detail={"yoy": yoy, "threshold": threshold},
    )


# ------------------------------------------------------------------------------------- explanation
def format_amount(value: float | None, unit: str) -> str:
    """Compact human format: 8.66bn USD, 412.3m INR, 27,022 persons."""
    if value is None:
        return "(blank)"
    if unit == "persons":
        return f"{value:,.0f} persons"
    a = abs(value)
    sign = "-" if value < 0 else ""
    if a >= 1e9:
        return f"{sign}{a / 1e9:,.3f}bn {unit}"
    if a >= 1e6:
        return f"{sign}{a / 1e6:,.2f}m {unit}"
    return f"{sign}{a:,.0f} {unit}"


def explain(f: Finding, unit: str) -> str:
    """Deterministic, reviewer-friendly explanation of a finding."""
    name = f"{display_metric(f.metric)} {f.period}"
    docs = ", ".join(f.outlier_documents)
    exp, rep = format_amount(f.expected_value, unit), format_amount(f.reported_value, unit)
    if f.type == "missing_item":
        return f"{name} is blank in {docs}, while other documents report {exp}."
    if f.type == "baseline_anomaly":
        return (
            f"{name} is {rep}, a {f.detail['yoy']:+.1%} change on the prior year ({exp}); "
            f"this exceeds the {f.detail['threshold']:.0%} review threshold. All documents agree, "
            "so confirm the change is genuine (e.g. acquisition, disposal, restatement)."
        )
    lead = f"{name}: {docs} reports {rep} but {f.detail.get('documents_agreeing', 1)} other document(s) show {exp}."
    reason = {
        "sign_error": " The sign is reversed.",
        "unit_error": f" The value is off by a factor of {f.detail.get('factor', 0):g}, which suggests a unit error.",
        "stale_period": (
            " The reported value equals the prior-year figure, which suggests a stale number was carried forward."
        ),
        "transposition": " Two adjacent digits appear to be swapped.",
        "value_mismatch": (
            f" Difference: {f.detail['relative_difference']:+.2%}."
            if f.detail.get("relative_difference") is not None
            else ""
        ),
    }[f.type]
    return lead + reason
