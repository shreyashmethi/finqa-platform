"""Evidence endpoints: highlighted PDF pages, spreadsheet windows, CSV lines, raw file download."""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.security import READ_ROLES, User, require_roles
from app.db.models import Document
from app.db.session import get_db
from app.services.evidence import csv_window, page_png, xlsx_window

router = APIRouter(tags=["evidence"])


def _document(db: Session, document_id: str) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or not Path(doc.storage_path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


def _parse_boxes(raw: list[str]) -> list[tuple[list[float], str]]:
    """'x0,top,x1,bottom,colour' strings from the query string -> boxes."""
    boxes = []
    for item in raw:
        parts = item.split(",")
        if len(parts) != 5:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "box must be x0,top,x1,bottom,colour")
        try:
            boxes.append(([float(p) for p in parts[:4]], parts[4]))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid box") from exc
    return boxes[:20]


@router.get("/documents/{document_id}/pages/{page}.png")
def page_image(
    document_id: str,
    page: int,
    box: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    """Rendered PDF page; each ``box`` param draws a highlight around a value."""
    doc = _document(db, document_id)
    if doc.format != "pdf":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a PDF")
    try:
        png = page_png(doc.storage_path, page, _parse_boxes(box), os.path.getmtime(doc.storage_path))
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/documents/{document_id}/cells")
def sheet_cells(
    document_id: str,
    sheet: str,
    cell: str = Query(pattern=r"^[A-Z]{1,3}[0-9]{1,7}$"),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    doc = _document(db, document_id)
    if doc.format != "xlsx":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a spreadsheet")
    try:
        return xlsx_window(doc.storage_path, sheet, cell)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sheet {sheet} not found") from exc


@router.get("/documents/{document_id}/lines")
def csv_lines(
    document_id: str,
    line: int = Query(ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*READ_ROLES)),
):
    doc = _document(db, document_id)
    if doc.format != "csv":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a CSV")
    return csv_window(doc.storage_path, line)


@router.get("/documents/{document_id}/file")
def download(document_id: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*READ_ROLES))):
    doc = _document(db, document_id)
    return FileResponse(doc.storage_path, filename=doc.filename)
