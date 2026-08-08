"""
Portable "sort NULLs to the end" ordering.

SQLAlchemy's ``.nulls_last()`` / ``.nullslast()`` compile to the SQL standard's
``ORDER BY col ASC NULLS LAST``. PostgreSQL, Oracle and SQLite understand that
clause; **MySQL and MariaDB do not** — the query fails outright:

    (1064, "You have an error in your SQL syntax; ... near 'NULLS LAST'")

This project runs on MySQL, so every ``.nulls_last()`` in a query that reaches
the database is a guaranteed 500, not a portability nicety. It reads fine in
review, passes type checking, and only fails when the endpoint is actually
called against a populated table — which is how three of them (grant
opportunities, pledges, and the certification-expiration report) shipped.

MySQL sorts NULLs *first* on an ascending sort and has no syntax to change
that, so the portable form adds a leading boolean sort key:

    ORDER BY (col IS NULL) ASC, col ASC

``col IS NULL`` yields 0 for present values and 1 for missing ones, so ascending
order on that key puts every non-NULL row ahead of every NULL row; the real
column then orders within each group. This is valid on PostgreSQL and SQLite
too, so it stays correct if the backing database ever changes.

Usage:

    from app.utils.sql_ordering import nulls_last_asc

    query = query.order_by(*nulls_last_asc(GrantOpportunity.deadline_date))
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import asc, desc


def nulls_last_asc(column: Any) -> tuple[Any, Any]:
    """Ascending order with NULLs last, expressed in MySQL-compatible SQL.

    Returns a pair of ORDER BY terms meant to be splatted into ``order_by``.
    """
    return asc(column.is_(None)), asc(column)


def nulls_last_desc(column: Any) -> tuple[Any, Any]:
    """Descending order with NULLs last, expressed in MySQL-compatible SQL."""
    return asc(column.is_(None)), desc(column)
