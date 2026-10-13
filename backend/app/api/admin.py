"""Identity, dashboard summary, tool schemas and admin-tunable rules."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.tools import TOOLS
from app.core.security import ADMIN_ROLES, READ_ROLES, User, get_current_user, require_roles
from app.db.models import DocumentSet, ExceptionRecord, ExceptionStatus, Run
from app.db.session import get_db
from app.domain.vocabulary import METRICS
from app.schemas import Me, RulesIn, RulesOut, Summary
from app.services.rules import load_rules, save_rules

router = APIRouter(tags=["admin"])


@router.get("/me", response_model=Me)
def me(user: User = Depends(get_current_user)):
    return Me(username=user.username, role=user.role)


@router.get("/summary", response_model=Summary)
def summary(db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    def grouped(col, *where):
        return {k: v for k, v in db.execute(select(col, func.count()).where(*where).group_by(col)).all()}

    open_ = ExceptionRecord.status == ExceptionStatus.OPEN
    return Summary(
        sets=db.scalar(select(func.count()).select_from(DocumentSet)) or 0,
        runs_by_status=grouped(Run.status),
        exceptions_by_status=grouped(ExceptionRecord.status),
        open_by_severity=grouped(ExceptionRecord.severity, open_),
        open_by_type=grouped(ExceptionRecord.type, open_),
    )


@router.get("/tools")
def tool_schemas(_: User = Depends(require_roles(*READ_ROLES))):
    """JSON schemas of the agents' function-calling tools (documentation / LLM tool binding)."""
    return [t.schema() for t in TOOLS.values()]


@router.get("/settings", response_model=RulesOut)
def get_rules(db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    return load_rules(db).to_dict()


@router.put("/settings", response_model=RulesOut)
def put_rules(body: RulesIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*ADMIN_ROLES))):
    changes = body.model_dump(exclude_none=True)
    unknown = [m for m in changes.get("baseline_metrics", []) if m not in METRICS]
    if unknown:
        raise HTTPException(422, f"Unknown metrics: {unknown}")
    return save_rules(db, changes, user.username).to_dict()
