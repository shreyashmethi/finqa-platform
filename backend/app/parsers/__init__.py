"""
Document parsers: turn a PDF, XLSX or CSV file into :class:`~app.domain.types.ExtractedItem` rows.

Every parser takes a ``mapper`` callable so label mapping is pluggable: the extraction agent passes
one that tries the rule-based vocabulary first, then the cached / LLM label mapper.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.domain.types import ExtractedItem

# mapper(raw_label, segment_context) -> canonical metric or None
LabelMapper = Callable[[str, bool], str | None]


@dataclass
class ParseResult:
    items: list[ExtractedItem]
    pages: int | None = None
    unmapped_labels: list[str] = field(default_factory=list)  # row labels with numbers but no metric
    warnings: list[str] = field(default_factory=list)


def parse_document(path: str | Path, mapper: LabelMapper) -> ParseResult:
    """Dispatch on file extension."""
    # Imported lazily so importing app.parsers stays cheap.
    from app.parsers.csv_parser import parse_csv
    from app.parsers.pdf_parser import parse_pdf
    from app.parsers.xlsx_parser import parse_xlsx

    suffix = Path(path).suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(path, mapper)
    if suffix == ".xlsx":
        return parse_xlsx(path, mapper)
    if suffix == ".csv":
        return parse_csv(path, mapper)
    raise ValueError(f"Unsupported document type: {suffix}")
