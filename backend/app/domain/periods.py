"""
Period label normalisation.

Canonical periods are ``FY2025`` and ``FY2025-Q3``, always named by the calendar year in which the
fiscal year ends. Documents use many variants; all of these are recognised:

    FY2025   FY25   FY2024-25   FY 2024-25   Q3 FY2025   Q3 FY2024-25   Q3FY25   2025Q3   Q3-25
"""

import re

# One regex that finds every period label inside a longer string (e.g. a table header line).
_PERIOD_RE = re.compile(
    r"""
    FY(?P<y3>\d{4})-Q(?P<q3>[1-4])                          # canonical FY2025-Q3
    |
    (?:
        (?:Q(?P<q1>[1-4])\s*[- ]?\s*)?                    # optional "Q3 " prefix
        FY\s?(?P<y1>\d{4}|\d{2})(?:\s*[-/]\s*(?P<y1end>\d{2,4}))?   # FY2025 | FY25 | FY2024-25
    )
    |
    (?P<y2>\d{4})\s?Q(?P<q2>[1-4])                          # 2025Q3
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _full_year(text: str, base: int | None = None) -> int:
    """Expand a 2-digit year; for a range end ("24-25") use the century of the start year."""
    year = int(text)
    if len(text) == 4:
        return year
    century = (base // 100) * 100 if base else 2000
    return century + year


def _from_match(m: re.Match) -> str:
    if m.group("y3"):
        return f"FY{m.group('y3')}-Q{m.group('q3')}"
    if m.group("y2"):
        return f"FY{int(m.group('y2'))}-Q{m.group('q2')}"
    start = _full_year(m.group("y1"))
    year = _full_year(m.group("y1end"), base=start) if m.group("y1end") else start
    quarter = m.group("q1")
    return f"FY{year}" + (f"-Q{quarter}" if quarter else "")


def parse_period(text: str) -> str | None:
    """Return the canonical period if ``text`` is exactly one period label, else ``None``."""
    text = text.strip()
    m = _PERIOD_RE.fullmatch(text)
    return _from_match(m) if m else None


def find_periods(text: str) -> list[tuple[str, int, int]]:
    """Find all period labels in ``text``: list of (canonical period, start index, end index)."""
    return [(_from_match(m), m.start(), m.end()) for m in _PERIOD_RE.finditer(text)]


def fiscal_year(period: str) -> int:
    """``FY2025-Q3`` -> 2025."""
    return int(period[2:6])


def previous_year_period(period: str) -> str:
    """Same period one year earlier: ``FY2025`` -> ``FY2024``, ``FY2025-Q3`` -> ``FY2024-Q3``."""
    year = fiscal_year(period)
    rest = period[6:]
    return f"FY{year - 1}{rest}"


def is_quarter(period: str) -> bool:
    return "-Q" in period
