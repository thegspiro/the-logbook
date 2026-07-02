"""
CSV Export Utilities

Formula-injection-safe CSV writing. Exported CSVs are opened in Excel /
Google Sheets, which execute cells beginning with =, +, -, @ (and treat
leading tab/CR specially). Free-text fields (course names, instructors,
external-provider data) are attacker-influenceable, so every cell written
to an export must be neutralized.
"""

import csv
from typing import Any, Iterable

# Characters that make spreadsheet applications interpret a cell as a formula
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe_cell(value: Any) -> Any:
    """Neutralize a cell value against spreadsheet formula injection.

    String values starting with a formula-trigger character are prefixed
    with a single quote (the standard spreadsheet escape, rendered
    invisibly by Excel/Sheets). Non-string values pass through unchanged.
    """
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


class SafeCsvWriter:
    """Drop-in replacement for ``csv.writer`` that sanitizes every cell.

    Use this instead of ``csv.writer`` for any CSV that leaves the system
    (member exports, compliance reports, audit hand-offs).
    """

    def __init__(self, output, **kwargs: Any):
        self._writer = csv.writer(output, **kwargs)

    def writerow(self, row: Iterable[Any]) -> None:
        self._writer.writerow([csv_safe_cell(cell) for cell in row])

    def writerows(self, rows: Iterable[Iterable[Any]]) -> None:
        for row in rows:
            self.writerow(row)
