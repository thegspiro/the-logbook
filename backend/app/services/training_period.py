"""Pure helpers for resolving the compliance evaluation ("as-of") date.

Kept dependency-free (only the stdlib ``datetime``) so it can be imported and
unit-tested without the database/ORM stack.
"""

from __future__ import annotations

from datetime import date, timedelta


def resolve_as_of_date(today: date, include_current_month: bool) -> date:
    """Return the effective evaluation date for compliance calculations.

    Departments run training on different cadences. Some hold their drills at
    the *end* of the month, so a mid-month dashboard that counts the
    in-progress month makes members look non-compliant before they have had
    the chance to train.

    - ``include_current_month=True`` (default): use the actual ``today`` so the
      current, in-progress month counts.
    - ``include_current_month=False``: evaluate as of the last day of the
      *previous* month, i.e. where members stood when this month began. The
      in-progress month is excluded from windows, proration, and overdue checks.
    """
    if include_current_month:
        return today
    # First day of the current month minus one day == last day of prior month.
    return today.replace(day=1) - timedelta(days=1)
