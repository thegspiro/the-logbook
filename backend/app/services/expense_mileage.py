"""
The mileage trip log on an expense line.

Owner decision 2026-11-01 (docs/KNOWN_LIMITATIONS.md, "Finance — Expense
Receipts: What the Requirement Does Not Cover"): a mileage line records its
trips in the form -- date, from, to, purpose, miles -- instead of carrying an
uploaded log, and the log stands in for the receipt the line would otherwise
need before its report is submitted.

The member does not type the amount of such a line. It is the log's miles at
the department's rate per mile, worked out here on every write so the screen,
the approver and the payment all see the server's figure (Pitfall #29). The
line's date is its earliest trip: the substantiation deadline runs from when
an expense was incurred, and the first trip is the oldest part of the claim.

The rate is ``finance.mileage_rate`` in the organization settings, written
through ``PATCH /organization/settings`` (``settings.manage``) like the other
reimbursement rules, and stored as a decimal string. There is no built-in
default: the IRS business rate changes every year and a department may pay
less, so a figure the module chose would be wrong somewhere. Until a
department sets one, a trip log is refused with a message saying so, and a
mileage line is claimed as before, with an uploaded log (Pitfall #19: absence
keeps the current behaviour).
"""

from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import ExpenseType
from app.models.user import Organization
from app.utils.finance_settings import FINANCE_SETTINGS_KEY
from app.utils.mileage_rate import MILEAGE_RATE_KEY, parse_mileage_rate

# A hundred trips is a busy year on one line.
MAX_TRIPS_PER_LINE = 100

_CENT = Decimal("0.01")


def mileage_rate_in(settings: Any) -> Optional[Decimal]:
    """The department's rate per mile out of its settings JSON, or None."""
    section = settings.get(FINANCE_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        return None
    return parse_mileage_rate(section.get(MILEAGE_RATE_KEY))


async def load_mileage_rate(
    db: AsyncSession, organization_id: str
) -> Optional[Decimal]:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return mileage_rate_in(result.scalar_one_or_none())


def trip_log_miles(trips: Any) -> Decimal:
    """The total miles on a stored log; zero for none or a malformed one."""
    total = Decimal("0")
    if not isinstance(trips, list):
        return total
    for trip in trips:
        if not isinstance(trip, dict):
            continue
        try:
            total += Decimal(str(trip.get("miles")))
        except (InvalidOperation, ValueError):
            continue
    return total


def has_trip_log(trips: Any) -> bool:
    """Whether a line's log stands in for its receipt: at least one trip."""
    return isinstance(trips, list) and len(trips) > 0


def price_trip_log(trips: list[dict], rate: Decimal) -> Decimal:
    """Miles times the rate, to the cent, half up."""
    return (trip_log_miles(trips) * rate).quantize(_CENT, rounding=ROUND_HALF_UP)


def _incurred(trips: list[dict]) -> datetime:
    """The line's date: its earliest trip, at noon UTC.

    Noon, as the expense form enters a typed date, so the day reads back the
    same in every timezone a department is in (``incurred_day`` takes the
    stored value's date).
    """
    earliest = min(date.fromisoformat(trip["trip_date"]) for trip in trips)
    return datetime.combine(earliest, time(12, 0), tzinfo=timezone.utc)


def settle_mileage_fields(
    fields: dict[str, Any],
    *,
    expense_type: Any,
    trips: Optional[list[dict]],
    rate: Optional[Decimal],
    today: date,
) -> None:
    """Price a line's trip log into ``fields`` (a create or update payload).

    ``trips`` is the log the line will carry once written, already in the
    stored shape (the request schema settles it); ``rate`` the rate to price
    it at. Writes ``amount``, ``date_incurred`` and ``mileage_rate`` over
    whatever the caller sent, since with a log those are the server's
    figures. Raises ``ValueError`` for a log on a line that is not mileage,
    a trip dated after today, or a department with no rate set.
    """
    if not trips:
        return
    kind = getattr(expense_type, "value", expense_type)
    if kind != ExpenseType.MILEAGE.value:
        raise ValueError("Only a mileage line can carry a trip log")
    if len(trips) > MAX_TRIPS_PER_LINE:
        raise ValueError(f"A line can log at most {MAX_TRIPS_PER_LINE} trips")
    if any(date.fromisoformat(trip["trip_date"]) > today for trip in trips):
        raise ValueError("A trip cannot be dated after today")
    if rate is None:
        raise ValueError(
            "Your department has not set a mileage rate, so a trip log cannot "
            "be priced yet. Ask the finance office to set it, or attach your "
            "mileage log as a receipt instead."
        )
    amount = price_trip_log(trips, rate)
    if amount < _CENT:
        raise ValueError("The trips come to less than a cent at the mileage rate")
    fields["amount"] = amount
    fields["date_incurred"] = _incurred(trips)
    fields["mileage_rate"] = rate
