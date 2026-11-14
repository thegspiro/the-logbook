"""Moving an event must not strand the check-ins already on it.

Workflow review, training events: a Training event with three members checked
in was moved a week later through Edit. The check-ins stayed, and crediting
clamps an early check-in forward to the scheduled start, so a tap at the
original drill would have been credited as a full session on the new date.
The update now refuses a schedule change that leaves a check-in outside the
new check-in window, and still allows a correction that contains them.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.event import CheckInWindowType, Event
from app.services.event_service import EventService

pytestmark = pytest.mark.unit

START = datetime(2026, 11, 8, 16, 0, tzinfo=timezone.utc)
END = START + timedelta(hours=2)


def _event(window=CheckInWindowType.FLEXIBLE):
    return Event(
        id="event-1",
        start_datetime=START,
        end_datetime=END,
        check_in_window_type=window,
        check_in_minutes_before=15,
        check_in_minutes_after=15,
        actual_start_time=None,
        actual_end_time=None,
    )


def _service(check_ins):
    db = MagicMock()
    rows = MagicMock()
    rows.all.return_value = [(at,) for at in check_ins]
    db.execute = AsyncMock(return_value=rows)
    return EventService(db), db


async def test_moving_a_week_out_with_check_ins_is_refused():
    svc, _ = _service([START + timedelta(minutes=4), START + timedelta(minutes=6)])

    with pytest.raises(ValueError, match="^2 members are already checked in"):
        await svc._refuse_orphaning_check_ins(
            _event(),
            {
                "start_datetime": START + timedelta(days=7),
                "end_datetime": END + timedelta(days=7),
            },
        )


async def test_a_correction_that_still_holds_every_check_in_is_allowed():
    """10:00 fixed to 10:30 with taps at 10:04: inside the early-arrival grace
    a flexible event gives, so the check-in is one the event would accept."""
    svc, _ = _service([START + timedelta(minutes=4)])

    await svc._refuse_orphaning_check_ins(
        _event(),
        {
            "start_datetime": START + timedelta(minutes=30),
            "end_datetime": END + timedelta(minutes=30),
        },
    )


async def test_a_strict_event_gets_no_early_grace():
    svc, _ = _service([START + timedelta(minutes=4)])

    with pytest.raises(ValueError, match="^1 member is already checked in"):
        await svc._refuse_orphaning_check_ins(
            _event(CheckInWindowType.STRICT),
            {"start_datetime": START + timedelta(minutes=30)},
        )


async def test_resending_the_same_schedule_reads_nothing():
    """The edit form resends every field; an unchanged window must not even
    query the check-ins, or every title fix would pay for it."""
    svc, db = _service([START])

    await svc._refuse_orphaning_check_ins(
        _event(), {"start_datetime": START, "end_datetime": END, "title": "x"}
    )

    db.execute.assert_not_awaited()


async def test_no_check_ins_means_any_move_is_allowed():
    svc, _ = _service([])

    await svc._refuse_orphaning_check_ins(
        _event(),
        {
            "start_datetime": START + timedelta(days=7),
            "end_datetime": END + timedelta(days=7),
        },
    )
