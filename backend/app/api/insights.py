"""Cross-cutting read views: the audit log, reports, users and system status."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ADMIN_ROLES, READ_ROLES, User, configured_users, require_roles
from app.db.models import (
    Company,
    Document,
    DocumentSet,
    ExceptionRecord,
    ExceptionStatus,
    HistoricalBaseline,
    LabelMapping,
    LineItem,
    ReviewDecision,
    Run,
)
from app.db.session import get_db
from app.schemas import AuditEntry, AuditPage, CompanyReport, Reports, SystemStatus, UserOut
from app.services.rules import load_rules

router = APIRouter(tags=["insights"])

_DECIDED = (ExceptionStatus.ACCEPTED, ExceptionStatus.REJECTED, ExceptionStatus.OVERRIDDEN)


@router.get("/decisions", response_model=AuditPage)
def audit_log(
    username: str | None = None,
    action: str | None = Query(None, description="comma-separated actions"),
    set_id: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    """Every reviewer decision across all exceptions, newest first."""
    stmt = select(ReviewDecision, ExceptionRecord).join(ExceptionRecord)
    if username:
        stmt = stmt.where(ReviewDecision.username == username)
    if action:
        stmt = stmt.where(ReviewDecision.action.in_(action.split(",")))
    if set_id:
        stmt = stmt.where(ExceptionRecord.set_id == set_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(ReviewDecision.id.desc()).limit(limit).offset(offset)).all()
    items = [
        AuditEntry(
            id=d.id,
            exception_id=e.id,
            set_id=e.set_id,
            metric=e.metric,
            period=e.period,
            severity=e.severity,
            unit=e.unit,
            action=d.action,
            comment=d.comment,
            override_value=d.override_value,
            status_before=d.status_before,
            status_after=d.status_after,
            username=d.username,
            role=d.role,
            created_at=d.created_at,
        )
        for d, e in rows
    ]
    return AuditPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/reports", response_model=Reports)
def reports(db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    """Aggregates for the reports page, computed in SQL (no per-row work in Python)."""
    open_ = ExceptionRecord.status == ExceptionStatus.OPEN
    per_company = db.execute(
        select(
            Company.id,
            Company.name,
            func.count(func.distinct(DocumentSet.id)),
            func.count(case((open_, ExceptionRecord.id))),
            func.count(case(((open_ & (ExceptionRecord.severity == "high")), ExceptionRecord.id))),
            func.count(case((ExceptionRecord.status.in_(_DECIDED), ExceptionRecord.id))),
        )
        .select_from(Company)
        .join(DocumentSet, DocumentSet.company_id == Company.id, isouter=True)
        .join(ExceptionRecord, ExceptionRecord.set_id == DocumentSet.id, isouter=True)
        .group_by(Company.id, Company.name)
    ).all()
    by_company = sorted(
        (
            CompanyReport(company_id=i, company_name=n, sets=s, open=o, high=h, decided=d)
            for i, n, s, o, h, d in per_company
        ),
        key=lambda c: (-c.open, c.company_id),
    )
    type_by_severity: dict[str, dict[str, int]] = {}
    for t, sev, n in db.execute(
        select(ExceptionRecord.type, ExceptionRecord.severity, func.count())
        .where(open_)
        .group_by(ExceptionRecord.type, ExceptionRecord.severity)
    ):
        type_by_severity.setdefault(t, {})[sev] = n
    by_metric = dict(
        db.execute(select(ExceptionRecord.metric, func.count()).where(open_).group_by(ExceptionRecord.metric)).all()
    )
    by_user = dict(db.execute(select(ReviewDecision.username, func.count()).group_by(ReviewDecision.username)).all())
    by_action = dict(db.execute(select(ReviewDecision.action, func.count()).group_by(ReviewDecision.action)).all())
    return Reports(
        by_company=by_company,
        type_by_severity=type_by_severity,
        by_metric=by_metric,
        decisions_by_user=by_user,
        decisions_by_action=by_action,
    )


@router.get("/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN_ROLES))):
    """Configured users (never their tokens) with their activity."""
    decisions = dict(db.execute(select(ReviewDecision.username, func.count()).group_by(ReviewDecision.username)).all())
    last_decision = dict(
        db.execute(
            select(ReviewDecision.username, func.max(ReviewDecision.created_at)).group_by(ReviewDecision.username)
        ).all()
    )
    runs = dict(db.execute(select(Run.created_by, func.count()).group_by(Run.created_by)).all())
    last_run = dict(db.execute(select(Run.created_by, func.max(Run.created_at)).group_by(Run.created_by)).all())
    out = []
    for user in configured_users():
        times = [t for t in (last_decision.get(user.username), last_run.get(user.username)) if t]
        out.append(
            UserOut(
                username=user.username,
                role=user.role,
                decisions=decisions.get(user.username, 0),
                runs_started=runs.get(user.username, 0),
                last_active=max(times) if times else None,
            )
        )
    return sorted(out, key=lambda u: u.username)


@router.get("/system", response_model=SystemStatus)
def system(db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN_ROLES))):
    settings = get_settings()

    def count(model) -> int:
        return db.scalar(select(func.count()).select_from(model)) or 0

    return SystemStatus(
        version="0.1.0",
        database=db.get_bind().dialect.name,
        llm_enabled=bool(settings.llm_model),
        llm_model=settings.llm_model or None,
        llm_max_calls_per_run=settings.llm_max_calls_per_run,
        worker_threads=settings.worker_threads,
        max_steps=settings.max_steps,
        anomaly_threshold=load_rules(db).anomaly_threshold,
        counts={
            "companies": count(Company),
            "document_sets": count(DocumentSet),
            "documents": count(Document),
            "line_items": count(LineItem),
            "baselines": count(HistoricalBaseline),
            "exceptions": count(ExceptionRecord),
            "decisions": count(ReviewDecision),
            "label_mappings": count(LabelMapping),
        },
        runs_by_status=dict(db.execute(select(Run.status, func.count()).group_by(Run.status)).all()),
    )
