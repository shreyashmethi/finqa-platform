"""
Agent graph tests: a full run finds the planted discrepancies; a crashed run resumes from its
checkpoint without duplicating exceptions; re-runs update rather than duplicate.
"""

import pytest
from sqlalchemy import func, select

from app.agents import nodes
from app.db.models import ExceptionRecord, ReviewDecision, Run, RunStatus, RunStep, ToolCall
from app.db.session import session_scope

EXPECTED = {
    ("revenue", "FY2025"): "value_mismatch",
    ("net_income", "FY2025"): "missing_item",
    ("capex", "FY2025"): "baseline_anomaly",
}


def _exceptions():
    with session_scope() as db:
        return {(e.metric, e.period): e.type for e in db.scalars(select(ExceptionRecord))}


def test_full_run_finds_planted_discrepancies(seeded):
    from app.agents.runner import get_run_manager

    mgr = get_run_manager()
    run_id = mgr.create_run("T001-FY2025", "tester")
    assert mgr.execute(run_id) == RunStatus.SUCCEEDED
    assert _exceptions() == EXPECTED
    with session_scope() as db:
        run = db.get(Run, run_id)
        assert run.stats["documents"] == 4 and run.stats["findings_by_type"]["value_mismatch"] == 1
        nodes_run = [s.node for s in db.scalars(select(RunStep).where(RunStep.run_id == run_id).order_by(RunStep.seq))]
        assert nodes_run.count("extraction") == 4 and nodes_run[-1] == "finish"
        assert db.scalar(select(func.count()).select_from(ToolCall).where(ToolCall.run_id == run_id)) >= 8


def test_crash_then_resume_without_duplicates(seeded, monkeypatch):
    from app.agents.runner import get_run_manager, reset_run_manager

    calls = {"n": 0}
    original = nodes.exceptions

    def flaky(state, config):
        # First call: the writes land, then the step "crashes" with a non-transient error, so the
        # run stops (no node retry). The later resume re-executes this node and succeeds.
        calls["n"] += 1
        if calls["n"] == 1:
            original(state, config)
            raise RuntimeError("simulated crash")
        return original(state, config)

    from app.agents import graph

    monkeypatch.setitem(graph.AGENTS, "exceptions", flaky)  # the graph is compiled from this table
    reset_run_manager()  # rebuild the graph with the patched node
    mgr = get_run_manager()
    run_id = mgr.create_run("T001-FY2025", "tester")
    assert mgr.execute(run_id) == RunStatus.FAILED
    assert calls["n"] == 1

    with session_scope() as db:
        steps_before = db.scalar(select(func.count()).select_from(RunStep).where(RunStep.run_id == run_id))
        extraction_steps = db.scalar(
            select(func.count()).select_from(RunStep).where(RunStep.run_id == run_id, RunStep.node == "extraction")
        )
    assert extraction_steps == 4

    assert mgr.execute(run_id, resume=True) == RunStatus.SUCCEEDED
    with session_scope() as db:
        # Resume continued from the checkpoint: no document was extracted again.
        assert (
            db.scalar(
                select(func.count()).select_from(RunStep).where(RunStep.run_id == run_id, RunStep.node == "extraction")
            )
            == 4
        )
        assert db.scalar(select(func.count()).select_from(RunStep).where(RunStep.run_id == run_id)) > steps_before
        # Idempotent persistence: still exactly one record per planted discrepancy.
        assert db.scalar(select(func.count()).select_from(ExceptionRecord)) == len(EXPECTED)


def test_resume_after_crash_mid_extraction_in_new_process(seeded, monkeypatch):
    """A restart resumes straight into the extraction node; per-run helpers must be rebuilt there."""
    from app.agents import graph
    from app.agents.runner import get_run_manager, reset_run_manager

    calls = {"n": 0}
    original = nodes.extraction

    def crash_on_second_document(state, config):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("process killed")
        return original(state, config)

    monkeypatch.setitem(graph.AGENTS, "extraction", crash_on_second_document)
    reset_run_manager()
    run_id = get_run_manager().create_run("T001-FY2025", "tester")
    assert get_run_manager().execute(run_id) == RunStatus.FAILED

    monkeypatch.setitem(graph.AGENTS, "extraction", original)
    reset_run_manager()  # simulate a new process: new graph, new RunContext, same checkpoint DB
    assert get_run_manager().execute(run_id, resume=True) == RunStatus.SUCCEEDED
    assert _exceptions() == EXPECTED
    with session_scope() as db:
        steps = db.scalars(select(RunStep.node).where(RunStep.run_id == run_id)).all()
        assert steps.count("extraction") == 4  # 1 before the crash + 3 after; nothing extracted twice


def test_rerun_updates_and_keeps_decisions(seeded):
    from app.agents.runner import get_run_manager

    mgr = get_run_manager()
    first = mgr.create_run("T001-FY2025", "tester")
    mgr.execute(first)
    with session_scope() as db:
        rec = db.scalar(select(ExceptionRecord).where(ExceptionRecord.metric == "revenue"))
        rec.status = "accepted"
        db.add(
            ReviewDecision(
                exception_id=rec.id,
                action="accept",
                status_before="open",
                status_after="accepted",
                username="alice",
                role="analyst",
            )
        )
    second = mgr.create_run("T001-FY2025", "tester")
    assert mgr.execute(second) == RunStatus.SUCCEEDED
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ExceptionRecord)) == len(EXPECTED)
        rec = db.scalar(select(ExceptionRecord).where(ExceptionRecord.metric == "revenue"))
        assert rec.status == "accepted" and rec.last_run_id == second and rec.first_run_id == first


@pytest.mark.parametrize("threshold,expect_anomaly", [(0.30, True), (0.70, False)])
def test_admin_threshold_changes_baseline_results(seeded, threshold, expect_anomaly):
    from app.agents.runner import get_run_manager
    from app.services.rules import save_rules

    with session_scope() as db:
        save_rules(db, {"anomaly_threshold": threshold}, "adam")
    mgr = get_run_manager()
    run_id = mgr.create_run("T001-FY2025", "tester")
    mgr.execute(run_id)
    assert (("capex", "FY2025") in _exceptions()) is expect_anomaly
