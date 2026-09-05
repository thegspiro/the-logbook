"""Keyset (cursor) pagination over a ``(sent_at, id)`` ordering key.

Offset paging asks the database for "rows 50-99 of the current answer", which
is only stable while the answer is. Notification lists are newest-first and
grow at the front, so a notification arriving between two pages shifts every
later row down one: the next page re-serves a row the client already holds and
steps over another entirely. The skipped row is the damaging half — nothing on
the client can tell it was missed.

Keyset paging asks for "rows after this one" instead, so an insertion at the
front cannot move the boundary.

**The ordering key is a pair, and the second half is not optional.**
``notification_logs.sent_at`` is MySQL ``datetime`` with no fractional-seconds
precision, so every row of a fan-out to fifty members carries the identical
timestamp. A cursor on the timestamp alone would skip or repeat across that
tie group — the exact case that produces the most rows at once. Pairing it
with the row id gives a total order.

The id is ``str(uuid.uuid4())`` — lowercase hex — so the column's
case-insensitive collation cannot make the comparison ambiguous. Introducing
uppercase ids would break that and is why the tiebreaker is documented rather
than merely written.

The encoded form is opaque on purpose: it carries a version prefix so its
contents can change without a client needing to understand them. Callers pass
back what they were handed and nothing more.
"""

import base64
import binascii
from datetime import datetime, timezone
from typing import Any, Optional, Tuple

from sqlalchemy import and_, or_

_CURSOR_VERSION = "1"


class InvalidCursor(ValueError):
    """A cursor that did not come from :func:`encode_cursor`, or was edited.

    Raised rather than ignored: silently starting from the top would hand a
    caller page one while they believed they were reading page nine.
    """


def _as_naive_utc(value: datetime) -> datetime:
    """Normalize to the naive-UTC form the datetime columns actually store.

    MySQL ``datetime`` holds no offset, and this application's convention is
    that every stored timestamp is UTC. A value read back from the driver is
    therefore naive and already UTC; one built in Python may be aware. Both
    have to reach the comparison in the same shape or the keyset predicate
    silently matches nothing.
    """
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def encode_cursor(sent_at: datetime, row_id: str) -> str:
    """Encode one row's position in the ``(sent_at, id)`` ordering."""
    payload = f"{_CURSOR_VERSION}|{_as_naive_utc(sent_at).isoformat()}|{row_id}"
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> Tuple[datetime, str]:
    """Decode a cursor into the naive-UTC timestamp and row id it names.

    Raises :class:`InvalidCursor` for anything this module did not produce.
    Every failure mode collapses to that one exception so an endpoint can
    answer 400 rather than 500 for a value a client controls.
    """
    if not isinstance(cursor, str) or not cursor:
        raise InvalidCursor("Cursor must be a non-empty string")

    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise InvalidCursor("Cursor is not valid base64url") from exc

    parts = raw.split("|")
    if len(parts) != 3:
        raise InvalidCursor("Cursor is malformed")

    version, timestamp, row_id = parts
    if version != _CURSOR_VERSION:
        raise InvalidCursor(f"Unsupported cursor version: {version}")
    if not row_id:
        raise InvalidCursor("Cursor is missing a row id")

    try:
        parsed = datetime.fromisoformat(timestamp)
    except ValueError as exc:
        raise InvalidCursor("Cursor timestamp is not a valid datetime") from exc

    return _as_naive_utc(parsed), row_id


def keyset_before(timestamp_column: Any, id_column: Any, cursor: str) -> Any:
    """Predicate selecting the rows that follow ``cursor`` under DESC ordering.

    Pair this with ``ORDER BY <timestamp> DESC, <id> DESC``; the two must agree
    or the page boundary drifts.
    """
    sent_at, row_id = decode_cursor(cursor)
    return or_(
        timestamp_column < sent_at,
        and_(timestamp_column == sent_at, id_column < row_id),
    )


def trim_to_page(rows: list, limit: int) -> Tuple[list, Optional[str]]:
    """Split an over-fetch of ``limit + 1`` rows into the page and its cursor.

    Callers ask the database for one row more than they intend to return. That
    extra row is the evidence another page exists, and it is the only honest
    way to know: a page that merely happens to be full proves nothing, so
    issuing a cursor on fullness alone advertises a next page that may not
    exist. With a list whose length is an exact multiple of the page size, that
    showed the member a "Load more (0 remaining)" button and made them spend a
    request to discover the end.

    Returns the page trimmed to ``limit`` and the cursor for the page after it,
    or ``None`` when this is the last one.
    """
    if len(rows) <= limit:
        return rows, None
    page = rows[:limit]
    last = page[-1]
    return page, encode_cursor(last.sent_at, last.id)
