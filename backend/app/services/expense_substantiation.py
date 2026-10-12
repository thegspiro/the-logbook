"""The accountable-plan substantiation deadline for expense reports.

A reimbursement is paid tax-free under an accountable plan only if the expense
is substantiated within a reasonable time of being incurred; the IRS safe
harbor is 60 days (Treas. Reg. 1.62-2(g)(2)). The department's rule
(``app/utils/finance_settings.py``) says how many days it allows and whether a
late line warns or blocks. ``FinanceService.submit_expense_report`` grades each
line once, at submission, and stores the result on the line, so changing the
rule later does not re-grade a report already submitted.
"""

from datetime import date, datetime
from typing import Iterable, Protocol, Sequence, TypeVar


class _Incurred(Protocol):
    date_incurred: datetime


T = TypeVar("T", bound=_Incurred)


def incurred_day(value: datetime) -> date:
    """The calendar date an expense was incurred.

    ``date_incurred`` is entered as a date (``YYYY-MM-DD``) and stored at
    midnight, so its date is the one the member wrote. Converting it to the
    department's timezone would move every expense in the Americas to the day
    before.
    """
    return value.date()


def days_late(incurred: date, submitted: date, allowed_days: int) -> int:
    """Days past the deadline; zero or less is on time."""
    return (submitted - incurred).days - allowed_days


def late_items(items: Iterable[T], submitted: date, allowed_days: int) -> list[T]:
    """The line items submitted more than *allowed_days* after they were incurred."""
    return [
        item
        for item in items
        if days_late(incurred_day(item.date_incurred), submitted, allowed_days) > 0
    ]


def describe_late(items: Sequence, allowed_days: int) -> str:
    """Name up to three late lines for a refusal or a warning."""
    named = ", ".join(f'"{item.description}"' for item in items[:3])
    more = f" and {len(items) - 3} more" if len(items) > 3 else ""
    return (
        f"{len(items)} line{'s' if len(items) != 1 else ''} "
        f"{'were' if len(items) != 1 else 'was'} incurred more than "
        f"{allowed_days} days before submission: {named}{more}"
    )
