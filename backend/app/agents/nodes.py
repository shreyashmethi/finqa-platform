"""
Graph nodes: one supervisor and four specialist agents.

    supervisor      plans the review and routes to the next agent (records a reason for each route)
    extraction      parses ONE document per step so a crash loses at most one document of work
    reconciliation  compares every (metric, period) across documents and classifies mismatches
    baseline        compares current-year figures with audited history; flags unusual swings
    exceptions      writes structured, idempotent exception records and closes stale ones
    finish          computes the run summary

Every node receives ``(state, config)`` and returns a *partial* state update. Nodes talk to the
outside world only through :class:`~app.agents.tools.ToolExecutor`, which validates, retries and
traces each call.
"""

import logging

from langchain_core.runnables import RunnableConfig

from app.agents.llm import LabelResolver
from app.agents.state import ReviewState, RunContext
from app.agents.tools import ToolExecutor, dedupe_key
from app.db.session import session_scope
from app.domain.periods import fiscal_year, previous_year_period
from app.domain.reconcile import baseline_anomaly, consensus, explain, reconcile_key
from app.domain.types import Finding, Observation
from app.services.rules import load_rules

log = logging.getLogger(__name__)

# Agent node names (also used as routing targets).
EXTRACTION, RECONCILIATION, BASELINE, EXCEPTIONS, FINISH = (
    "extraction",
    "reconciliation",
    "baseline",
    "exceptions",
    "finish",
)


def _ctx(config: RunnableConfig) -> RunContext:
    return config["configurable"]["ctx"]


def _resolver(state: ReviewState, config: RunnableConfig) -> LabelResolver | None:
    """
    The run's label resolver, built on first use. It lives in the (non-checkpointed) RunContext, so
    after a crash the new process rebuilds it here - whichever node the resumed run starts at.
    """
    ctx = _ctx(config)
    if ctx.label_resolver is None and "segments" in state:
        ctx.label_resolver = LabelResolver(state["segments"], ctx.llm)
    return ctx.label_resolver


def _tools(state: ReviewState, node: str, config: RunnableConfig) -> ToolExecutor:
    resolver = _resolver(state, config)
    extra = {"mapper": resolver} if resolver else {}
    return ToolExecutor(state["run_id"], node, context=extra)


# ======================================================================================= supervisor
def supervisor(state: ReviewState, config: RunnableConfig) -> dict:
    """
    Decide the next step. The plan is deterministic so results are reproducible and auditable:
    extract every document -> reconcile -> baseline check -> persist exceptions -> finish.
    """
    update: dict = {}
    if not state.get("documents"):
        # First visit: discover the set's documents and context, and freeze the rules for this run.
        docs = _tools(state, "supervisor", config).call("list_documents", set_id=state["set_id"])
        with session_scope() as db:
            rules = load_rules(db).to_dict()
        update |= {
            "company_id": docs.company_id,
            "fiscal_year": docs.fiscal_year,
            "currency": docs.currency,
            "segments": docs.segments,
            "documents": [d.model_dump() for d in docs.documents],
            "rules": rules,
        }
        state = {**state, **update}

    pending = [d for d in state["documents"] if d["document_id"] not in state.get("extracted", [])]
    if pending:
        nxt, reason = EXTRACTION, f"{len(pending)} document(s) not yet extracted"
    elif not state.get("reconciled"):
        nxt, reason = RECONCILIATION, "all documents extracted"
    elif not state.get("baseline_checked"):
        nxt, reason = BASELINE, f"{len(state.get('findings', []))} cross-document finding(s); check history"
    elif not state.get("exceptions_persisted"):
        nxt, reason = EXCEPTIONS, "findings ready to persist"
    else:
        nxt, reason = FINISH, "review complete"
    return update | {"next_agent": nxt, "route_log": [{"next": nxt, "reason": reason}]}


def route(state: ReviewState) -> str:
    """Conditional-edge function: read the supervisor's decision."""
    return state["next_agent"]


# ======================================================================================= extraction
def extraction(state: ReviewState, config: RunnableConfig) -> dict:
    """Extract the next pending document (one per step = fine-grained checkpoints)."""
    done = set(state.get("extracted", []))
    doc = next(d for d in state["documents"] if d["document_id"] not in done)
    out = _tools(state, EXTRACTION, config).call("extract_line_items", document_id=doc["document_id"])
    stats = out.model_dump()
    resolver = _resolver(state, config)
    stats["label_mapping"] = dict(resolver.stats) if resolver else {}
    log.info("extracted %s: %d items (%d missing cells)", out.filename, out.items, out.missing_cells)
    return {"extracted": [doc["document_id"]], "extraction_stats": [stats]}


# =================================================================================== reconciliation
def _observations(groups: dict[str, list[dict]]) -> dict[tuple[str, str], list[Observation]]:
    return {tuple(k.split("|", 1)): [Observation(**o) for o in v] for k, v in groups.items()}


def reconciliation(state: ReviewState, config: RunnableConfig) -> dict:
    """Cross-document reconciliation of every (metric, period) seen in at least two documents."""
    tools = _tools(state, RECONCILIATION, config)
    fy = state["fiscal_year"]
    obs = _observations(tools.call("load_observations", set_id=state["set_id"]).groups)
    # Audited history for the two prior years: tie-breaker for comparatives and stale-value check.
    base = tools.call(
        "get_historical_baseline", company_id=state["company_id"], as_of_fiscal_year=fy, from_fiscal_year=fy - 2
    ).values

    def prior_for(metric: str, period: str) -> tuple[float, float] | None:
        prev = previous_year_period(period)
        if f"{metric}|{prev}" in base:
            return base[f"{metric}|{prev}"], 0.0
        c = consensus(obs.get((metric, prev), []))
        return (c[0], c[1]) if c else None

    findings: list[dict] = []
    for (metric, period), observations in sorted(obs.items()):
        reference = base.get(f"{metric}|{period}") if fiscal_year(period) < fy else None
        f = reconcile_key(metric, period, observations, prior=prior_for(metric, period), reference=reference)
        if f is not None:
            findings.append(f.to_dict())

    # Hand the baseline agent the agreed current and prior-year values for the metrics it checks.
    baseline_inputs = {}
    for metric in state["rules"]["baseline_metrics"]:
        for period in (f"FY{fy}", f"FY{fy - 1}"):
            c = consensus(obs.get((metric, period), []))
            if c:
                baseline_inputs[f"{metric}|{period}"] = {"value": c[0], "precision": c[1], "evidence": c[2]}
    log.info("reconciled %d keys: %d finding(s)", len(obs), len(findings))
    return {"findings": findings, "baseline_inputs": baseline_inputs, "reconciled": True}


# ========================================================================================= baseline
def baseline(state: ReviewState, config: RunnableConfig) -> dict:
    """Flag consistent-but-unusual year-on-year moves against audited history."""
    fy = state["fiscal_year"]
    rules = state["rules"]
    hist = (
        _tools(state, BASELINE, config)
        .call(
            "get_historical_baseline",
            company_id=state["company_id"],
            as_of_fiscal_year=fy,
            metrics=rules["baseline_metrics"],
            from_fiscal_year=fy - 1,
        )
        .values
    )
    already = {(f["metric"], f["period"]) for f in state.get("findings", [])}
    anomalies = []
    for metric in rules["baseline_metrics"]:
        period = f"FY{fy}"
        current = state.get("baseline_inputs", {}).get(f"{metric}|{period}")
        if current is None or (metric, period) in already:
            continue  # nothing agreed to compare, or the figure is already disputed across documents
        prior = hist.get(f"{metric}|FY{fy - 1}")
        source = "audited baseline"
        if prior is None:  # unknown company: fall back to the prior-year figure in the documents
            p = state.get("baseline_inputs", {}).get(f"{metric}|FY{fy - 1}")
            prior, source = (p["value"], "prior-year comparative in documents") if p else (None, None)
        if prior is None:
            continue
        f = baseline_anomaly(metric, period, current["value"], prior, rules["anomaly_threshold"], current["evidence"])
        if f:
            f.baseline = {"period": f"FY{fy - 1}", "value": prior, "source": source}
            anomalies.append(f.to_dict())
    return {"anomalies": anomalies, "baseline_checked": True}


# ======================================================================================= exceptions
def exceptions(state: ReviewState, config: RunnableConfig) -> dict:
    """Persist every finding as a structured exception record, then close ones no longer found."""
    tools = _tools(state, EXCEPTIONS, config)
    ids, keys = [], []
    for raw in state.get("findings", []) + state.get("anomalies", []):
        f = Finding(**raw)
        unit = "persons" if f.metric == "headcount" else state["currency"]
        out = tools.call(
            "persist_exception",
            set_id=state["set_id"],
            run_id=state["run_id"],
            metric=f.metric,
            period=f.period,
            type=f.type,
            severity=f.severity,
            expected_value=f.expected_value,
            reported_value=f.reported_value,
            unit=unit,
            outlier_documents=f.outlier_documents,
            explanation=explain(f, unit),
            evidence={
                "supporting": f.supporting,
                "conflicting": f.conflicting,
                "baseline": f.baseline,
                "detail": f.detail,
            },
        )
        ids.append(out.exception_id)
        keys.append(dedupe_key(state["set_id"], f.metric, f.period))
    closed = tools.call("close_stale_exceptions", set_id=state["set_id"], run_id=state["run_id"], keep_keys=keys)
    return {
        "exception_ids": ids,
        "exceptions_persisted": True,
        "summary": {"exceptions": len(ids), "closed_stale": closed.closed},
    }


# =========================================================================================== finish
def finish(state: ReviewState, config: RunnableConfig) -> dict:
    stats = state.get("extraction_stats", [])
    by_type: dict[str, int] = {}
    for f in state.get("findings", []) + state.get("anomalies", []):
        by_type[f["type"]] = by_type.get(f["type"], 0) + 1
    ctx = _ctx(config)
    llm = ctx.llm
    return {
        "summary": {
            **state.get("summary", {}),
            "documents": len(state.get("documents", [])),
            "line_items": sum(s["items"] for s in stats),
            "pages": sum(s.get("pages") or 0 for s in stats),
            "unmapped_labels": sorted({lbl for s in stats for lbl in s.get("unmapped_labels", [])})[:30],
            "findings_by_type": by_type,
            "label_mapping": dict(ctx.label_resolver.stats) if ctx.label_resolver else {},
            "llm": {"calls": llm.calls, "input_tokens": llm.input_tokens, "output_tokens": llm.output_tokens}
            if llm
            else None,
            "rules": state.get("rules"),
        }
    }
