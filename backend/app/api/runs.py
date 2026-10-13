"""Runs: start a review, follow its progress and trace, resume or cancel it."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.runner import get_run_manager
from app.core.security import READ_ROLES, RUN_ROLES, User, require_roles
from app.db.models import DocumentSet, Run, RunStatus, RunStep, ToolCall
from app.db.session import get_db
from app.schemas import RunDetail, RunOut, RunStepOut, ToolCallOut

router = APIRouter(tags=["runs"])


@router.post("/sets/{set_id}/runs", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def start_run(set_id: str, db: Session = Depends(get_db), user: User = Depends(require_roles(*RUN_ROLES))):
    """Queue a review of the set. Returns immediately; poll GET /runs/{id} for progress."""
    if db.get(DocumentSet, set_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set not found")
    active = db.scalar(select(Run).where(Run.set_id == set_id, Run.status.in_([RunStatus.QUEUED, RunStatus.RUNNING])))
    if active is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Run {active.id} is already in progress for this set")
    mgr = get_run_manager()
    db.commit()  # release the request transaction before the worker writes (SQLite single writer)
    run_id = mgr.create_run(set_id, user.username)
    mgr.submit(run_id)
    return db.get(Run, run_id)


@router.get("/runs", response_model=list[RunOut])
def list_runs(
    set_id: str | None = None,
    status_: str | None = Query(None, alias="status", description="comma-separated statuses"),
    created_by: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    q = select(Run).order_by(Run.created_at.desc()).limit(limit).offset(offset)
    if set_id:
        q = q.where(Run.set_id == set_id)
    if status_:
        q = q.where(Run.status.in_(status_.split(",")))
    if created_by:
        q = q.where(Run.created_by == created_by)
    return db.scalars(q).all()


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(run_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    steps = db.scalars(select(RunStep).where(RunStep.run_id == run_id).order_by(RunStep.seq)).all()
    return RunDetail(**RunOut.model_validate(run).model_dump(), steps=[RunStepOut.model_validate(s) for s in steps])


@router.get("/runs/{run_id}/tool-calls", response_model=list[ToolCallOut])
def get_tool_calls(run_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    return db.scalars(select(ToolCall).where(ToolCall.run_id == run_id).order_by(ToolCall.id)).all()


@router.post("/runs/{run_id}/resume", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def resume_run(run_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*RUN_ROLES))):
    """Continue a failed or cancelled run from its last checkpoint."""
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if run.status not in (RunStatus.FAILED, RunStatus.CANCELLED):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Run is {run.status}; only failed/cancelled runs resume")
    run.status = RunStatus.QUEUED
    db.commit()
    get_run_manager().submit(run_id, resume=True)
    db.refresh(run)
    return run


@router.post("/runs/{run_id}/cancel", response_model=RunOut)
def cancel_run(run_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*RUN_ROLES))):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    db.commit()
    get_run_manager().cancel(run_id)
    db.refresh(run)
    return run
