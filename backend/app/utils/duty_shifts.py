"""Which shifts count as duty coverage when shift hours are totalled."""

from sqlalchemy import ColumnElement

from app.models.training import Shift


def duty_shifts_only() -> ColumnElement[bool]:
    """Exclude community outreach signup sheets from a shift-hours query.

    Owner decision, 2026-11-24: a station tour or a school visit is staffed
    from the schedule, but the time is community outreach and not shift
    staffing. Its hours are credited through the event the sheet staffs
    (``app/services/outreach_sheet_credit.py``), so a total that also counted
    the sheet would count the same time twice.

    Every figure that totals shift hours or counts shifts worked applies this
    one clause, so they cannot disagree about what a shift is (pitfall #29).
    The sheet's own record of who was there is not filtered: only totals are.
    """
    return Shift.is_outreach.is_(False)
