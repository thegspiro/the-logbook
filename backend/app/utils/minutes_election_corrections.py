"""Which filed election result a later one replaces.

When an election whose result is filed with minutes is rolled back, that result
is superseded by a dated correction and stays on file (owner decision
2026-11-01, ELEC-49). If the re-run election closes and its result is filed
with the same minutes, the new result is shown as replacing the superseded
one. That link is read from the rows rather than stored: within one set of
minutes, a result replaces the most recent result of the same election that
was superseded before it was filed.

Every copy of the minutes (the screen, the PDF, the library and public copies)
reads it from here, so they cannot disagree about it.
"""

from datetime import datetime
from typing import Any, Dict, Iterable, Tuple


def filing_order(row: Any) -> Tuple[Any, ...]:
    """Sort key putting one election's results in the order they were filed.

    ``created_at`` has one-second resolution, so a re-run's result can share
    a second with the one it replaces. Within one election only the latest
    result can still stand, and the superseded ones were superseded in the
    order they were filed, so a tie is settled by the correction's date with
    the standing result last.
    """
    created_at = getattr(row, "created_at", None) or datetime.min
    superseded_at = getattr(row, "superseded_at", None)
    return (
        created_at,
        superseded_at is None,
        superseded_at or created_at,
        str(getattr(row, "id", "")),
    )


def replaced_corrections(rows: Iterable[Any]) -> Dict[str, datetime]:
    """Map each result that replaces a superseded one to that correction's date.

    ``rows`` are one set of minutes' ``MinutesElectionResult`` rows, in any
    order. Read with ``getattr``, as the renderers read them, so a row from
    before these columns existed (or a stand-in) reads as never superseded.
    """
    latest: Dict[str, datetime] = {}
    replaced: Dict[str, datetime] = {}
    for row in sorted(rows, key=filing_order):
        election_id = getattr(row, "election_id", None)
        if not election_id:
            continue
        if election_id in latest:
            replaced[row.id] = latest[election_id]
        superseded_at = getattr(row, "superseded_at", None)
        if superseded_at is not None:
            latest[election_id] = superseded_at
    return replaced
