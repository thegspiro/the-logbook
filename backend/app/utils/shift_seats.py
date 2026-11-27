"""The seat a member held on a shift, for every reader that cuts shift credit
by seat.

Three readers ask the same question: Hours by Position (My Hours, the profile
and the department report), the shared count of shifts worked that grades a
Shifts requirement, and the Shift Compliance report's hours. They read the
seat from one derived table, so a shift counts under the same seat everywhere
(CLAUDE.md pitfall 29).
"""

from datetime import date
from typing import Any, List, Optional

from sqlalchemy import ColumnElement, Subquery, func, select

from app.models.training import ShiftAssignment
from app.utils.positions import canonical_position, position_spellings


def member_seat_on_shift(*filters: Any) -> Subquery:
    """One row per shift and member: ``shift_id``, ``user_id``, ``position``.

    A member seated twice on one shift is read once, at the lowest seat value,
    so joining this never counts a shift twice. Outer-join it on both
    ``shift_id`` and ``user_id``: a shift the member worked with no
    assignment has no row, and reads as no seat recorded.

    A derived table rather than a correlated subquery: MySQL 8's
    ONLY_FULL_GROUP_BY rejects grouping on a subquery that reads
    ``shifts.id`` (error 1055), which MariaDB's default mode lets through.
    """
    return (
        select(
            ShiftAssignment.shift_id.label("shift_id"),
            ShiftAssignment.user_id.label("user_id"),
            func.min(ShiftAssignment.position).label("position"),
        )
        .where(*filters)
        .group_by(ShiftAssignment.shift_id, ShiftAssignment.user_id)
        .subquery()
    )


def seat_key(value: Any) -> Optional[str]:
    """A seat as compared: canonical, case-folded; None for no seat."""
    raw = str(getattr(value, "value", value) or "").strip()
    if not raw:
        return None
    return canonical_position(raw).casefold() or None


def seat_matches(column: Any, seat: str) -> ColumnElement[bool]:
    """``column`` holds ``seat`` in any of its stored spellings."""
    return func.lower(column).in_(sorted(position_spellings(seat)))


class SeatedDate(date):
    """A shift date carrying the seat the member held on that shift.

    The shared count of shifts worked hands graders one date per shift, and
    about fifty call sites pass those lists through untouched. A ``date``
    subclass lets the seat travel with each date without changing what any
    of them see: it compares, sorts and formats as the date it is.
    """

    seat: Optional[str]

    def __new__(cls, *args: Any, seat: Optional[str] = None) -> "SeatedDate":
        # SeatedDate(a_date, seat) is the form callers use. date.replace(),
        # date arithmetic and unpickling construct a subclass as
        # cls(year, month, day) or cls(state_bytes); those produce a date the
        # member did not work a seat on, so they carry no seat.
        if args and isinstance(args[0], date):
            value = args[0]
            made = super().__new__(cls, value.year, value.month, value.day)
            made.seat = seat_key(args[1] if len(args) > 1 else seat)
            return made
        made = super().__new__(cls, *args)
        made.seat = None
        return made

    def __reduce__(self) -> Any:
        return (SeatedDate, (date(self.year, self.month, self.day), self.seat))


def dates_in_seat(dates: List[date], seat: Optional[str]) -> List[date]:
    """The dates whose shift was worked in ``seat``; every date when None.

    A plain ``date`` carries no seat, so it never counts toward a seat.
    """
    wanted = seat_key(seat)
    if wanted is None:
        return list(dates)
    return [d for d in dates if getattr(d, "seat", None) == wanted]
