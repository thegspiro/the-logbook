"""How a department's membership number pattern becomes a number.

A department describes its numbers as a pattern of literal text and tokens:

    {PREFIX}{SEQ}      FD-0001      (the default, and the only format before
                                     patterns existed)
    {YYYY}-{SEQ}       2026-014
    {SEQ}              142

This module is the single formatter. The generator, the preview endpoint and
the settings validator all call it, so the number an officer is shown is the
number a member receives. The frontend deliberately does not re-implement it
(CLAUDE.md pitfall #29); it asks the preview endpoint instead.

Everything here is pure: no database, no clock. The caller supplies "today" in
the organization's timezone.
"""

import re
from datetime import date

TOKEN_SEQ = "SEQ"
TOKEN_PREFIX = "PREFIX"
TOKEN_YEAR_FULL = "YYYY"
TOKEN_YEAR_SHORT = "YY"

ALLOWED_TOKENS = frozenset({TOKEN_SEQ, TOKEN_PREFIX, TOKEN_YEAR_FULL, TOKEN_YEAR_SHORT})
YEAR_TOKENS = frozenset({TOKEN_YEAR_FULL, TOKEN_YEAR_SHORT})

DEFAULT_PATTERN = "{PREFIX}{SEQ}"
MAX_PATTERN_LENGTH = 40

# users.membership_number is String(50).
MAX_MEMBERSHIP_NUMBER_LENGTH = 50

_TOKEN_RE = re.compile(r"\{([^{}]*)\}")

# Literal text is limited to characters that survive a badge printer, a CSV
# export and a URL unchanged. Braces are excluded so a stray "{" is reported as
# a malformed token rather than printed.
_LITERAL_RE = re.compile(r"^[A-Za-z0-9 ._/#-]*$")


def pattern_tokens(pattern: str) -> list[str]:
    """The token names in ``pattern``, in order, including repeats."""
    return _TOKEN_RE.findall(pattern)


def uses_year(pattern: str) -> bool:
    return any(token in YEAR_TOKENS for token in pattern_tokens(pattern))


def validate_pattern(pattern: str) -> None:
    """Raise ``ValueError`` describing the first problem with ``pattern``."""
    if not pattern:
        raise ValueError("The number pattern cannot be empty")
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise ValueError(
            f"The number pattern can be at most {MAX_PATTERN_LENGTH} characters"
        )

    tokens = pattern_tokens(pattern)
    unknown = sorted({t for t in tokens if t not in ALLOWED_TOKENS})
    if unknown:
        allowed = ", ".join(
            "{" + t + "}"
            for t in (TOKEN_SEQ, TOKEN_PREFIX, TOKEN_YEAR_FULL, TOKEN_YEAR_SHORT)
        )
        raise ValueError(
            f"Unknown token {{{unknown[0]}}} in the number pattern. " f"Use {allowed}"
        )

    # Exactly one {SEQ}: without it every member gets the same number, and with
    # two the counter would be printed twice for no meaning a reader can see.
    seq_count = tokens.count(TOKEN_SEQ)
    if seq_count != 1:
        raise ValueError(
            "The number pattern must contain {SEQ} exactly once — it is where "
            "the member's sequence number goes"
        )

    literal = _TOKEN_RE.sub("", pattern)
    if not _LITERAL_RE.match(literal):
        raise ValueError(
            "The number pattern can contain letters, digits, spaces and "
            "- _ . / # alongside its {TOKENS}"
        )


def period_year(
    today: date,
    *,
    year_basis: str,
    fiscal_year_start_month: int,
    fiscal_year_label: str,
) -> int:
    """The year ``{YYYY}`` prints, and the period a yearly counter belongs to.

    A calendar year is ``today.year``. A fiscal year starting in any month but
    January spans two calendar years, and departments name it differently —
    July 2026 to June 2027 is "FY2027" to most US municipalities and "2026" to
    others — so the label is the department's choice: the year it ``end``\\ s or
    the year it ``start``\\ s.
    """
    if year_basis != "fiscal" or fiscal_year_start_month == 1:
        return today.year
    starts_in = today.year if today.month >= fiscal_year_start_month else today.year - 1
    return starts_in + 1 if fiscal_year_label == "end" else starts_in


def format_membership_number(
    pattern: str, *, prefix: str, padding: int, number: int, year: int
) -> str:
    """Render ``pattern`` for one member. Assumes ``validate_pattern`` passed."""
    values = {
        TOKEN_SEQ: str(number).zfill(padding),
        TOKEN_PREFIX: prefix,
        TOKEN_YEAR_FULL: f"{year:04d}",
        TOKEN_YEAR_SHORT: f"{year % 100:02d}",
    }
    return _TOKEN_RE.sub(lambda m: values[m.group(1)], pattern)


def longest_membership_number(
    pattern: str, *, prefix: str, padding: int, number: int
) -> int:
    """The length of the number this pattern issues for ``number``.

    Used to refuse, at save time, a pattern whose output would not fit the
    column, instead of letting the first member created afterwards fail. The
    generator checks again for the number it actually issues.
    """
    return len(
        format_membership_number(
            pattern, prefix=prefix, padding=padding, number=number, year=9999
        )
    )
