"""
Rows touched by an UPDATE, DELETE or INSERT.

``AsyncSession.execute()`` is typed as returning ``Result``, which has no
``rowcount``; only its ``CursorResult`` subclass does. A DML statement does
return a ``CursorResult`` at runtime, but nothing in the signature says so, so
every ``result.rowcount`` read in the codebase was an attribute the type checker
could not see.

Several of those reads are concurrency guards — a token rotation, a claim, a
withdrawal — that decide what happens by whether exactly one row moved. The
narrowing is therefore checked rather than asserted: a result that is not a
``CursorResult`` raises instead of being read as zero, which a guard would
otherwise take to mean "somebody else got there first".

Usage:

    from app.utils.sql_results import rows_affected

    result = await db.execute(update(Model).where(...).values(...))
    if rows_affected(result) == 0:
        ...
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.engine import CursorResult, Result


def rows_affected(result: Result[Any]) -> int:
    """The number of rows the statement behind ``result`` matched."""
    if not isinstance(result, CursorResult):
        raise TypeError(
            "rows_affected() needs the result of an UPDATE, DELETE or INSERT; "
            f"got {type(result).__name__}"
        )
    return result.rowcount
