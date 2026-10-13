"""
CSV extraction for long-format KPI files (one row per metric x period).

Columns are found by name rather than position, so files with extra or reordered columns still
work: metric (metric_code / metric / line_item), period, value (value / amount), and optional unit.
"""

import csv

from app.domain.periods import parse_period
from app.domain.types import ExtractedItem
from app.domain.units import parse_number, unit_for_plain_values
from app.parsers import LabelMapper, ParseResult

_METRIC_COLS = ("metric_code", "metric", "line_item", "account", "kpi")
_PERIOD_COLS = ("period", "fiscal_period")
_VALUE_COLS = ("value", "amount")


def _find(header: list[str], names: tuple[str, ...]) -> int | None:
    lowered = [h.strip().lower() for h in header]
    return next((lowered.index(n) for n in names if n in lowered), None)


def parse_csv(path, mapper: LabelMapper) -> ParseResult:
    result = ParseResult(items=[])
    filename = str(path).rsplit("/", 1)[-1]
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            result.warnings.append("empty file")
            return result
        mi, pi, vi = _find(header, _METRIC_COLS), _find(header, _PERIOD_COLS), _find(header, _VALUE_COLS)
        ui = _find(header, ("unit",))
        if None in (mi, pi, vi):
            result.warnings.append(f"could not find metric/period/value columns in {header}")
            return result
        for line_no, row in enumerate(reader, start=2):
            if len(row) <= max(mi, pi, vi):
                continue
            label, period = row[mi], parse_period(row[pi])
            metric = mapper(label, False)
            if metric is None:
                result.unmapped_labels.append(label)
                continue
            if period is None:
                result.warnings.append(f"line {line_no}: unrecognised period {row[pi]!r}")
                continue
            unit = unit_for_plain_values(row[ui]) if ui is not None and row[ui] else None
            multiplier = unit.multiplier if unit else 1.0
            location = {"doc": filename, "line": line_no, "row": label, "column": row[pi]}
            num = parse_number(row[vi])
            if num is None:
                result.items.append(
                    ExtractedItem(
                        metric,
                        period,
                        None,
                        multiplier,
                        label,
                        row[vi],
                        row[ui] if ui is not None else "",
                        location,
                        is_missing=True,
                    )
                )
                continue
            result.items.append(
                ExtractedItem(
                    metric=metric,
                    period=period,
                    value=num.value * multiplier,
                    precision=multiplier * 10 ** (-num.decimals),
                    raw_label=label,
                    raw_value=row[vi],
                    unit_label=row[ui] if ui is not None else "units",
                    location=location,
                )
            )
    return result
