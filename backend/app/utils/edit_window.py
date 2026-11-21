"""Was a record changed after the bulk write that touched it?

A bulk write (an import's commit, a Course Links link) stamps every record it
changes with the time it ran. A record whose ``updated_at`` is still within
``EDIT_TOLERANCE`` of that time has not been touched since; one later than that
was changed by somebody, and an undo leaves it alone as their work.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

#: Bulk writes run in seconds; two minutes leaves room for a slow one without
#: reaching an officer's later edit.
EDIT_TOLERANCE = timedelta(minutes=2)


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """MySQL returns naive datetimes for timezone-aware columns; they are UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def changed_since(updated_at: Optional[datetime], written_at: datetime) -> bool:
    """True when ``updated_at`` is later than the bulk write by more than the
    tolerance."""
    updated = as_utc(updated_at)
    written = as_utc(written_at)
    if updated is None or written is None:
        return False
    return updated - written > EDIT_TOLERANCE
