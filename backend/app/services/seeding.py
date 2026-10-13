"""
Load the synthetic test corpus (companies, audited baselines, document sets) into the database.

Corpus files are registered in place (not copied). Ground truth is deliberately NOT loaded: the
system under test must never see it. Seeding is idempotent - already-present rows are skipped.
"""

import csv
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Company, DocumentSet, HistoricalBaseline
from app.services.ingestion import register_existing_file

log = logging.getLogger(__name__)


def seed_corpus(db: Session, corpus: Path, kinds: tuple[str, ...] = ("standard", "stress")) -> dict:
    corpus = corpus.resolve()
    if (corpus / "ground_truth").exists():
        log.info("ground_truth/ found in corpus and ignored (never loaded into the app)")
    counts = {"companies": 0, "baselines": 0, "sets": 0, "documents": 0}

    with open(corpus / "companies.csv", newline="") as f:
        for r in csv.DictReader(f):
            if db.get(Company, r["company_id"]) is None:
                db.add(
                    Company(
                        id=r["company_id"],
                        name=r["name"],
                        sector=r["sector"],
                        currency=r["currency"],
                        fiscal_year_end=r["fiscal_year_end"],
                        segments=r["segments"].split("|"),
                    )
                )
                counts["companies"] += 1
    db.flush()

    existing = set(db.execute(select(HistoricalBaseline.company_id).distinct()).scalars())
    rows = []
    with open(corpus / "baselines" / "historical_baselines.csv", newline="") as f:
        for r in csv.DictReader(f):
            if r["company_id"] in existing:
                continue
            rows.append(
                HistoricalBaseline(
                    company_id=r["company_id"],
                    metric=r["metric"],
                    period=r["period"],
                    fiscal_year=int(r["period"][2:6]),
                    value=float(r["value"]),
                    unit=r["unit"],
                    source=r.get("source", "audited_history"),
                )
            )
    db.add_all(rows)
    counts["baselines"] = len(rows)

    with open(corpus / "manifest.csv", newline="") as f:
        for r in csv.DictReader(f):
            if r["kind"] not in kinds or db.get(DocumentSet, r["set_id"]) is not None:
                continue
            ds = DocumentSet(
                id=r["set_id"], company_id=r["company_id"], fiscal_year=int(r["fiscal_year"]), source="corpus"
            )
            db.add(ds)
            for path in sorted((corpus / "sets" / r["set_id"]).iterdir()):
                if path.suffix.lower() in {".pdf", ".xlsx", ".csv"}:
                    ds.documents.append(register_existing_file(db, r["set_id"], path))
                    counts["documents"] += 1
            counts["sets"] += 1
    db.flush()
    return counts
