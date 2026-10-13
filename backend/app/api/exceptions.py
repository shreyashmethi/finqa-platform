"""Exception queue, detail with evidence, reviewer decisions (audited) and CSV export."""

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.security import READ_ROLES, REVIEW_ROLES, User, require_roles
from app.db.models import DecisionAction, Document, DocumentSet, ExceptionRecord, ExceptionStatus, ReviewDecision
from app.db.session import get_db
from app.schemas import DecisionIn, ExceptionDetail, ExceptionOut, ExceptionPage

router = APIRouter(tags=["exceptions"])

_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _filtered(
    status_: str | None,
    severity: str | None,
    type_: str | None,
    metric: str | None,
    set_id: str | None,
    q: str | None,
    company_id: str | None = None,
):
    stmt = select(ExceptionRecord)
    if status_:
        stmt = stmt.where(ExceptionRecord.status.in_(status_.split(",")))
    else:  # by default hide items a later run no longer finds
        stmt = stmt.where(ExceptionRecord.status != ExceptionStatus.RESOLVED_BY_RERUN)
    if severity:
        stmt = stmt.where(ExceptionRecord.severity.in_(severity.split(",")))
    if type_:
        stmt = stmt.where(ExceptionRecord.type.in_(type_.split(",")))
    if metric:
        stmt = stmt.where(ExceptionRecord.metric == metric)
    if set_id:
        stmt = stmt.where(ExceptionRecord.set_id == set_id)
    if company_id:
        stmt = stmt.where(
            ExceptionRecord.set_id.in_(select(DocumentSet.id).where(DocumentSet.company_id == company_id))
        )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            ExceptionRecord.set_id.ilike(like)
            | ExceptionRecord.metric.ilike(like)
            | ExceptionRecord.explanation.ilike(like)
        )
    return stmt


@router.get("/exceptions", response_model=ExceptionPage)
def list_exceptions(
    status_: str | None = Query(None, alias="status", description="comma-separated statuses"),
    severity: str | None = None,
    type_: str | None = Query(None, alias="type"),
    metric: str | None = None,
    set_id: str | None = None,
    company_id: str | None = None,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    """Filterable queue, most severe and most recent first."""
    base = _filtered(status_, severity, type_, metric, set_id, q, company_id)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    sev_rank = case(_SEVERITY_ORDER, value=ExceptionRecord.severity, else_=9)  # portable CASE ordering
    items = db.scalars(base.order_by(sev_rank, ExceptionRecord.updated_at.desc()).limit(limit).offset(offset)).all()
    return ExceptionPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/exceptions/export.csv")
def export_csv(
    status_: str | None = Query(None, alias="status"),
    severity: str | None = None,
    type_: str | None = Query(None, alias="type"),
    set_id: str | None = None,
    company_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    """Export exceptions (default: every status except resolved-by-rerun) with latest decision."""
    rows = db.scalars(
        _filtered(status_, severity, type_, None, set_id, None, company_id).order_by(ExceptionRecord.set_id)
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "exception_id",
            "set_id",
            "metric",
            "period",
            "type",
            "severity",
            "status",
            "expected_value",
            "reported_value",
            "override_value",
            "unit",
            "outlier_documents",
            "explanation",
            "last_decision_by",
            "last_decision_at",
            "last_comment",
        ]
    )
    for e in rows:
        last = e.decisions[-1] if e.decisions else None
        w.writerow(
            [
                e.id,
                e.set_id,
                e.metric,
                e.period,
                e.type,
                e.severity,
                e.status,
                e.expected_value,
                e.reported_value,
                e.override_value,
                e.unit,
                ";".join(e.outlier_documents),
                e.explanation,
                last.username if last else "",
                last.created_at.isoformat() if last else "",
                (last.comment or "") if last else "",
            ]
        )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=exceptions.csv"},
    )


@router.get("/exceptions/{exception_id}", response_model=ExceptionDetail)
def get_exception(exception_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    e = db.get(ExceptionRecord, exception_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exception not found")
    docs = dict(db.execute(select(Document.filename, Document.id).where(Document.set_id == e.set_id)).all())
    return ExceptionDetail(
        **ExceptionOut.model_validate(e).model_dump(), evidence=e.evidence, decisions=e.decisions, documents=docs
    )


# Status transitions per action. COMMENT and REOPEN keep/restore without judging.
_TRANSITIONS = {
    DecisionAction.ACCEPT: ExceptionStatus.ACCEPTED,
    DecisionAction.REJECT: ExceptionStatus.REJECTED,
    DecisionAction.OVERRIDE: ExceptionStatus.OVERRIDDEN,
    DecisionAction.REOPEN: ExceptionStatus.OPEN,
}


@router.post("/exceptions/{exception_id}/decisions", response_model=ExceptionDetail)
def decide(
    exception_id: str,
    body: DecisionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*REVIEW_ROLES)),
):
    """Record a reviewer action. Every action is appended to the audit log with user and timestamp."""
    # Row lock (Postgres) so two reviewers cannot race on the same item; SQLite serialises writes anyway.
    e = db.get(ExceptionRecord, exception_id, with_for_update=True)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exception not found")
    action = DecisionAction(body.action)
    if action == DecisionAction.OVERRIDE and (body.override_value is None or not (body.comment or "").strip()):
        raise HTTPException(422, "Override needs a value and a comment")
    if action in (DecisionAction.REJECT, DecisionAction.COMMENT) and not (body.comment or "").strip():
        raise HTTPException(422, f"'{action}' needs a comment")
    before = e.status
    after = _TRANSITIONS.get(action, ExceptionStatus(before))
    e.status = after
    if action == DecisionAction.OVERRIDE:
        e.override_value = body.override_value
    db.add(
        ReviewDecision(
            exception_id=e.id,
            action=action,
            comment=body.comment,
            override_value=body.override_value,
            status_before=before,
            status_after=after,
            username=user.username,
            role=user.role,
        )
    )
    db.flush()
    db.refresh(e)
    return get_exception(exception_id, db)
