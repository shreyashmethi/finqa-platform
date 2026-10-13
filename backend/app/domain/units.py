"""
Units and number parsing.

Each document states a unit somewhere (table title, sheet header, CSV column). We turn that into a
multiplier to base units, and we keep the *display precision* of every number: a value shown as
``8,659.7`` in USD million is only known to +/- 0.05 million. Comparing two documents within their
combined rounding is what keeps rounding differences from becoming false positives.
"""

import re
from dataclasses import dataclass

# Scale words and their multipliers to base units. Order matters: longer phrases first.
_SCALES: list[tuple[str, float]] = [
    ("'000", 1e3),
    ("000s", 1e3),
    ("thousand", 1e3),
    ("thousands", 1e3),
    ("lakh", 1e5),
    ("lakhs", 1e5),
    ("lac", 1e5),
    ("million", 1e6),
    ("millions", 1e6),
    ("mn", 1e6),
    ("$m", 1e6),
    ("usd m", 1e6),
    ("crore", 1e7),
    ("crores", 1e7),
    ("cr", 1e7),
    ("billion", 1e9),
    ("billions", 1e9),
    ("bn", 1e9),
]
_CURRENCIES = ("USD", "INR", "EUR", "GBP")


@dataclass(frozen=True)
class Unit:
    """A parsed unit: currency (may be None) and multiplier to base units."""

    currency: str | None
    multiplier: float
    label: str


def parse_unit(text: str) -> Unit | None:
    """
    Find a unit in free text such as "Consolidated statement (USD million)" or
    "All amounts in INR lakh unless stated". Returns None if no scale word is present.
    """
    low = text.lower()
    currency = next((c for c in _CURRENCIES if c.lower() in low), None)
    for word, mult in _SCALES:
        # Word boundary match so "cr" does not fire inside "credit".
        if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", low):
            return Unit(currency, mult, f"{currency + ' ' if currency else ''}{word}")
    return None


def unit_for_plain_values(text: str) -> Unit | None:
    """Units for machine files where values are already in base units ("units", "USD", "INR")."""
    low = text.strip().lower()
    if low in {"units", "unit", "usd", "inr", "eur", "gbp", "persons", "count", "number"}:
        return Unit(text.strip().upper() if low in {"usd", "inr", "eur", "gbp"} else None, 1.0, low)
    return parse_unit(text)


# A displayed number: optional parentheses / minus, digits with any comma grouping, decimals.
_NUMBER_RE = re.compile(r"^\(?-?[\d,]*\d(?:\.\d+)?\)?$")
MISSING_TOKENS = {"-", "–", "—", "n/a", "na", "nil"}


def is_number_token(token: str) -> bool:
    return bool(_NUMBER_RE.match(token.strip()))


@dataclass(frozen=True)
class ParsedNumber:
    value: float
    decimals: int  # digits after the decimal point as displayed


def parse_number(token: str) -> ParsedNumber | None:
    """Parse "1,23,456.78", "(885.1)" or "-12" -> value + displayed decimals. None if not a number."""
    t = token.strip()
    if not is_number_token(t):
        return None
    negative = t.startswith("(") and t.endswith(")") or t.startswith("-")
    digits = t.strip("()").lstrip("-").replace(",", "")
    decimals = len(digits.split(".")[1]) if "." in digits else 0
    value = float(digits)
    return ParsedNumber(-value if negative else value, decimals)


def decimals_from_excel_format(number_format: str | None) -> int:
    """Displayed decimals from an Excel number format such as '#,##0.00;(#,##0.00)'."""
    if not number_format:
        return 0
    first = number_format.split(";")[0]
    m = re.search(r"0\.(0+)", first)
    return len(m.group(1)) if m else 0
