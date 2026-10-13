"""
PDF table extraction with exact coordinates.

Approach
--------
1. **Pre-filter pages** with pypdfium2 (fast, ~2 ms/page): keep only pages that contain a unit in
   brackets such as "(USD million)" - financial tables state their unit in the title. This lets a
   300-page report be processed in seconds instead of running layout analysis on every page.
2. **Rebuild text lines** on candidate pages from pdfplumber word boxes (grouped by vertical
   position), so every number keeps its bounding box for highlighting in the review UI.
3. **Walk the lines with a small state machine**:
      title line with a unit   -> start a table, remember unit and title
      line with period labels  -> header: the x-position of each period column
      line ending in numbers   -> data row: label on the left, values matched to columns by x
      anything else            -> table ends
   Rows whose label maps to a canonical metric become extracted items; others are reported as
   unmapped so the agent can try the LLM label mapper.

Prose figures (e.g. the CEO letter) are not parsed by rules; every figure that matters also
appears in a table of the same document.
"""

import re
from dataclasses import dataclass

import pdfplumber
import pypdfium2 as pdfium

from app.domain.periods import find_periods
from app.domain.types import ExtractedItem
from app.domain.units import MISSING_TOKENS, Unit, is_number_token, parse_number, parse_unit
from app.parsers import LabelMapper, ParseResult
from app.parsers.pdfium_lock import PDFIUM_LOCK

# Unit inside brackets in a title: "(USD million)", "(INR crore; headcount in FTE)", "(USD '000)".
_TITLE_UNIT_RE = re.compile(r"\(([^()]*?(?:million|billion|crore|lakh|thousand|'000|\bbn\b|\bmn\b)[^()]*)\)", re.I)
_PERCENT_RE = re.compile(r"^[+-]?[\d.,]+%$")
_LINE_TOLERANCE = 2.5  # points: words whose tops differ by less than this are on one line
_COLUMN_TOLERANCE = 30.0  # points: max distance between a value's right edge and its column's
_HEADER_FOOTER_MARGIN = 0.05  # top/bottom 5% of the page holds running headers and page numbers


@dataclass
class _Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float


@dataclass
class _Column:
    period: str
    x1: float  # right edge of the header label (values are right-aligned under it)
    header: str


def candidate_pages(path: str) -> list[int]:
    """0-based indexes of pages whose text contains a bracketed unit (cheap pre-filter)."""
    with PDFIUM_LOCK:
        return _candidate_pages_locked(path)


def _candidate_pages_locked(path: str) -> list[int]:
    doc = pdfium.PdfDocument(path)
    try:
        hits = []
        for i in range(len(doc)):
            page = doc[i]
            textpage = page.get_textpage()
            text = textpage.get_text_range()
            # Close children before the document; pypdfium2 asserts on out-of-order cleanup.
            textpage.close()
            page.close()
            if _TITLE_UNIT_RE.search(text):
                hits.append(i)
        return hits
    finally:
        doc.close()


def _lines(words: list[dict]) -> list[list[_Word]]:
    """Group pdfplumber words into lines (top-to-bottom), each sorted left-to-right."""
    ws = sorted(
        (_Word(w["text"], w["x0"], w["x1"], w["top"], w["bottom"]) for w in words), key=lambda w: (round(w.top), w.x0)
    )
    lines: list[list[_Word]] = []
    for w in ws:
        if lines and abs(lines[-1][0].top - w.top) <= _LINE_TOLERANCE:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w.x0) for line in lines]


def _header_columns(line: list[_Word]) -> list[_Column]:
    """Find period labels in a line and the x-position where each one ends."""
    text, spans, pos = "", [], 0
    for w in line:  # rebuild the line text while remembering each word's char span
        if text:
            text += " "
            pos += 1
        spans.append((pos, pos + len(w.text), w))
        text += w.text
        pos += len(w.text)
    cols = []
    for period, start, end in find_periods(text):
        # Right edge of the last word overlapping this period label.
        covering = [w for s, e, w in spans if s < end and e > start]
        if covering:
            cols.append(_Column(period, covering[-1].x1, text[start:end]))
    return cols


def _split_row(line: list[_Word]) -> tuple[str, list[_Word]]:
    """Split a row into its text label and the trailing value tokens (numbers, dashes, percents)."""
    values: list[_Word] = []
    i = len(line)
    while i > 0:
        t = line[i - 1].text
        if is_number_token(t) or t.lower() in MISSING_TOKENS or _PERCENT_RE.match(t) or t.lower() == "n/m":
            values.insert(0, line[i - 1])
            i -= 1
        else:
            break
    return " ".join(w.text for w in line[:i]), values


def parse_pdf(path, mapper: LabelMapper) -> ParseResult:
    result = ParseResult(items=[])
    pages_to_read = candidate_pages(str(path))
    filename = str(path).rsplit("/", 1)[-1]
    with pdfplumber.open(path) as pdf:
        result.pages = len(pdf.pages)
        for index in pages_to_read:
            page = pdf.pages[index]
            _parse_page(page, index + 1, filename, mapper, result)
    return result


def _parse_page(page, page_no: int, filename: str, mapper: LabelMapper, result: ParseResult) -> None:
    """Run the table state machine over one page, appending items to ``result``."""
    unit: Unit | None = None
    title = ""
    columns: list[_Column] = []
    # Ignore running headers/footers (page numbers would otherwise look like table values).
    margin = page.height * _HEADER_FOOTER_MARGIN
    for line in _lines(page.extract_words(keep_blank_chars=False, use_text_flow=False)):
        if line[0].top < margin or line[0].bottom > page.height - margin:
            continue
        text = " ".join(w.text for w in line)
        m = _TITLE_UNIT_RE.search(text)
        if m and not _split_row(line)[1]:
            # New table: title carrying the unit (and no trailing numbers, so not a data row).
            unit, title, columns = parse_unit(m.group(1)), text, []
            continue
        if unit is None:
            continue
        if not columns:
            columns = _header_columns(line)
            if not columns:
                unit = None  # a titled block without a period header is not a comparable table
            continue
        label, value_words = _split_row(line)
        if not value_words or not label:
            unit, columns = None, []  # table ended
            continue
        segment_ctx = "segment" in title.lower()
        metric = mapper(label, segment_ctx)
        if metric is None:
            if any(is_number_token(w.text) for w in value_words):
                result.unmapped_labels.append(label)
            continue
        for w in value_words:
            col = min(columns, key=lambda c: abs(c.x1 - w.x1))
            if abs(col.x1 - w.x1) > _COLUMN_TOLERANCE:
                continue  # value under a non-period column (e.g. "YoY", "Share")
            _add_item(result, metric, col, w, label, unit, title, page_no, filename, page)


def _add_item(result, metric, col, w: _Word, label, unit: Unit, title, page_no, filename, page) -> None:
    location = {
        "doc": filename,
        "page": page_no,
        "table": title,
        "row": label,
        "column": col.header,
        "bbox": [round(w.x0, 1), round(w.top, 1), round(w.x1, 1), round(w.bottom, 1)],
        "page_size": [round(page.width, 1), round(page.height, 1)],
    }
    # Headcount is a count even inside a "(USD million unless stated)" table.
    multiplier = 1.0 if metric == "headcount" else unit.multiplier
    unit_label = "persons" if metric == "headcount" else unit.label
    if w.text.lower() in MISSING_TOKENS:
        result.items.append(
            ExtractedItem(metric, col.period, None, multiplier, label, w.text, unit_label, location, is_missing=True)
        )
        return
    num = parse_number(w.text)
    if num is None:  # percentages etc.
        return
    result.items.append(
        ExtractedItem(
            metric=metric,
            period=col.period,
            value=num.value * multiplier,
            precision=multiplier * 10 ** (-num.decimals),
            raw_label=label,
            raw_value=w.text,
            unit_label=unit_label,
            location=location,
        )
    )
