"""
Document ingestion: validate uploads, store them safely, register them in the database.

Security notes
--------------
* Only whitelisted extensions are accepted, and the file's magic bytes must match its extension
  (a renamed executable is rejected).
* Filenames are reduced to a safe basename; files are written inside the set's own folder, so a
  crafted name cannot escape the upload directory.
* Size is enforced while streaming, before the whole file is held in memory.
"""

import hashlib
import re
import shutil
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Company, Document, DocumentSet

_MAGIC = {".pdf": b"%PDF", ".xlsx": b"PK\x03\x04"}  # CSV is plain text: no magic bytes
_CHUNK = 1024 * 1024


class IngestionError(ValueError):
    """Raised for invalid uploads; the API turns it into HTTP 400."""


def safe_filename(name: str) -> str:
    """Keep a readable basename with only safe characters."""
    base = Path(name).name
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    if not base:
        raise IngestionError("Empty filename")
    return base[:120]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def _next_set_id(db: Session, company_id: str, fiscal_year: int) -> str:
    """C004-FY2024, then C004-FY2024-v2, -v3 ... if earlier uploads exist."""
    base = f"{company_id}-FY{fiscal_year}"
    candidate, n = base, 1
    while db.get(DocumentSet, candidate) is not None:
        n += 1
        candidate = f"{base}-v{n}"
    return candidate


def create_set_from_uploads(
    db: Session, company_id: str, fiscal_year: int, files: list[tuple[str, BinaryIO]]
) -> DocumentSet:
    """Validate and store uploaded files as a new document set. All-or-nothing."""
    settings = get_settings()
    if db.get(Company, company_id) is None:
        raise IngestionError(f"Unknown company {company_id}")
    if not 1990 <= fiscal_year <= 2100:
        raise IngestionError("fiscal_year out of range")
    if not files:
        raise IngestionError("No files uploaded")

    set_id = _next_set_id(db, company_id, fiscal_year)
    folder = settings.upload_dir / set_id
    folder.mkdir(parents=True, exist_ok=False)
    try:
        ds = DocumentSet(id=set_id, company_id=company_id, fiscal_year=fiscal_year, source="upload")
        db.add(ds)
        seen: set[str] = set()
        for original_name, stream in files:
            name = safe_filename(original_name)
            ext = Path(name).suffix.lower()
            if ext not in settings.allowed_extensions:
                raise IngestionError(f"{original_name}: type {ext or '(none)'} not allowed")
            if name in seen:
                raise IngestionError(f"Duplicate filename {name}")
            seen.add(name)
            target = folder / name
            size = _write_limited(stream, target, settings.max_upload_mb * _CHUNK)
            _check_magic(target, ext)
            db.add(
                Document(
                    set_id=set_id,
                    filename=name,
                    format=ext[1:],
                    storage_path=str(target.resolve()),
                    sha256=_sha256(target),
                    size_bytes=size,
                )
            )
        db.flush()
        return ds
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)  # never leave half a set on disk
        raise


def _write_limited(stream: BinaryIO, target: Path, limit: int) -> int:
    size = 0
    with open(target, "wb") as out:
        while chunk := stream.read(_CHUNK):
            size += len(chunk)
            if size > limit:
                raise IngestionError(f"{target.name} exceeds the upload size limit")
            out.write(chunk)
    if size == 0:
        raise IngestionError(f"{target.name} is empty")
    return size


def _check_magic(path: Path, ext: str) -> None:
    magic = _MAGIC.get(ext)
    if magic is None:
        return
    with open(path, "rb") as f:
        if not f.read(len(magic)).startswith(magic):
            raise IngestionError(f"{path.name} is not a valid {ext} file")


def register_existing_file(db: Session, set_id: str, path: Path) -> Document:
    """Register a file that already exists on disk (used by corpus seeding; files stay in place)."""
    return Document(
        set_id=set_id,
        filename=path.name,
        format=path.suffix.lower()[1:],
        storage_path=str(path.resolve()),
        sha256=_sha256(path),
        size_bytes=path.stat().st_size,
    )
