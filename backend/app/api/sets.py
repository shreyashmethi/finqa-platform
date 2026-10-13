"""Companies and document sets: list, inspect, upload."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import ADMIN_ROLES, READ_ROLES, User, require_roles
from app.db.models import Company, Document, DocumentSet, ExceptionRecord, ExceptionStatus, Run
from app.db.session import get_db
from app.schemas import CompanyIn, CompanyOut, DocumentOut, RunBrief, SetDetail, SetSummary
from app.services.ingestion import IngestionError, create_set_from_uploads

router = APIRouter(tags=["sets"])


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    return db.scalars(select(Company).order_by(Company.id)).all()


@router.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(body: CompanyIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN_ROLES))):
    if db.get(Company, body.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Company already exists")
    company = Company(**body.model_dump())
    db.add(company)
    db.flush()
    return company


def _set_summaries(db: Session, set_ids: list[str] | None = None) -> list[SetSummary]:
    """Build list rows with counts in a fixed number of queries (no N+1)."""
    q = select(DocumentSet, Company).join(Company).order_by(DocumentSet.id)
    if set_ids is not None:
        q = q.where(DocumentSet.id.in_(set_ids))
    rows = db.execute(q).all()
    ids = [ds.id for ds, _ in rows]
    doc_counts = dict(
        db.execute(
            select(Document.set_id, func.count()).where(Document.set_id.in_(ids)).group_by(Document.set_id)
        ).all()
    )
    exc_total = dict(
        db.execute(
            select(ExceptionRecord.set_id, func.count())
            .where(ExceptionRecord.set_id.in_(ids), ExceptionRecord.status != ExceptionStatus.RESOLVED_BY_RERUN)
            .group_by(ExceptionRecord.set_id)
        ).all()
    )
    exc_open = dict(
        db.execute(
            select(ExceptionRecord.set_id, func.count())
            .where(ExceptionRecord.set_id.in_(ids), ExceptionRecord.status == ExceptionStatus.OPEN)
            .group_by(ExceptionRecord.set_id)
        ).all()
    )
    # Latest run per set: max(created_at) subquery joined back to runs.
    latest_sub = (
        select(Run.set_id, func.max(Run.created_at).label("mx"))
        .where(Run.set_id.in_(ids))
        .group_by(Run.set_id)
        .subquery()
    )
    latest = {
        r.set_id: r
        for r in db.scalars(
            select(Run).join(latest_sub, (Run.set_id == latest_sub.c.set_id) & (Run.created_at == latest_sub.c.mx))
        )
    }
    return [
        SetSummary(
            id=ds.id,
            company_id=co.id,
            company_name=co.name,
            currency=co.currency,
            fiscal_year=ds.fiscal_year,
            source=ds.source,
            documents=doc_counts.get(ds.id, 0),
            latest_run=RunBrief.model_validate(latest[ds.id]) if ds.id in latest else None,
            open_exceptions=exc_open.get(ds.id, 0),
            total_exceptions=exc_total.get(ds.id, 0),
        )
        for ds, co in rows
    ]


@router.get("/sets", response_model=list[SetSummary])
def list_sets(db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    return _set_summaries(db)


@router.get("/sets/{set_id}", response_model=SetDetail)
def get_set(set_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    ds = db.get(DocumentSet, set_id)
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set not found")
    summary = _set_summaries(db, [set_id])[0]
    return SetDetail(**summary.model_dump(), document_list=[DocumentOut.model_validate(d) for d in ds.documents])


@router.post("/sets", response_model=SetDetail, status_code=status.HTTP_201_CREATED)
def upload_set(
    company_id: str = Form(...),
    fiscal_year: int = Form(...),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*ADMIN_ROLES)),
):
    """Upload a new document set (PDF / XLSX / CSV files) for a company and fiscal year."""
    try:
        ds = create_set_from_uploads(db, company_id, fiscal_year, [(f.filename or "", f.file) for f in files])
    except IngestionError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    summary = _set_summaries(db, [ds.id])[0]
    return SetDetail(**summary.model_dump(), document_list=[DocumentOut.model_validate(d) for d in ds.documents])
