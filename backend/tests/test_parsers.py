"""Parser tests on the generated fixture documents: values, units, missing cells and locations."""

from app.domain.vocabulary import map_label
from app.parsers import parse_document
from tests import fixtures


def _mapper(label, ctx):
    return map_label(label, fixtures.COMPANY["segments"], ctx)


def _by_key(items):
    return {(i.metric, i.period): i for i in items}


def test_pdf_tables_with_units_and_bboxes(tmp_path):
    files = fixtures.build(tmp_path)
    r = parse_document(files[0], _mapper)
    items = _by_key(r.items)
    rev = items[("revenue", "FY2025")]
    assert rev.value == 1_234_500_000 and rev.precision == 100_000
    assert rev.location["page"] == 2 and rev.location["table"].startswith("Consolidated statement")
    assert len(rev.location["bbox"]) == 4
    assert items[("segment_revenue:Services", "FY2024")].value == 400_000_000
    assert "Total" in r.unmapped_labels  # ambiguous subtotal is never mapped


def test_deck_skips_non_period_columns(tmp_path):
    files = fixtures.build(tmp_path)
    items = parse_document(files[1], _mapper).items
    assert {i.period for i in items} == {"FY2025", "FY2024"}  # the YoY % column is ignored
    assert _by_key(items)[("revenue", "FY2025")].value == 1_334_500_000


def test_xlsx_units_and_missing_cell(tmp_path):
    files = fixtures.build(tmp_path)
    items = _by_key(parse_document(files[2], _mapper).items)
    assert items[("revenue", "FY2025")].value == 1_234_500_000 and items[("revenue", "FY2025")].precision == 1000
    ni = items[("net_income", "FY2025")]
    assert ni.is_missing and ni.location["cell"] == "B7"


def test_csv_codes_and_lines(tmp_path):
    files = fixtures.build(tmp_path)
    items = _by_key(parse_document(files[3], _mapper).items)
    assert items[("segment_revenue:Machinery", "FY2025")].value == 800_000_000
    assert items[("revenue", "FY2025")].location["line"] == 2
