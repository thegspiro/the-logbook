"""Regression tests for recording an event's actual time interval."""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.events import record_actual_times as record_actual_times_api
from app.schemas.event import RecordActualTimes
from app.services.event_service import EventService

BASE_TIME = datetime(2026, 8, 22, 12, 0)


def _service(actual_start=None, actual_end=None):
    event = SimpleNamespace(
        is_cancelled=False,
        actual_start_time=actual_start,
        actual_end_time=actual_end,
        updated_at=None,
    )
    result = Mock()
    result.scalar_one_or_none.return_value = event
    db = SimpleNamespace(
        execute=AsyncMock(return_value=result),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    service = EventService(db)
    service.finalize_event_attendance = AsyncMock(return_value=(0, None))
    return service, db, event


async def _record(service, *, start=None, end=None):
    return await service.record_actual_times(
        event_id=uuid4(),
        organization_id=uuid4(),
        actual_start_time=start,
        actual_end_time=end,
    )


async def test_updating_only_start_after_existing_end_is_rejected():
    service, db, event = _service(actual_end=BASE_TIME)

    recorded, error = await _record(service, start=BASE_TIME + timedelta(minutes=1))

    assert recorded is None
    assert error == "Actual end time must be after actual start time"
    assert event.actual_start_time is None
    db.commit.assert_not_awaited()


async def test_updating_only_end_before_existing_start_is_rejected():
    service, db, event = _service(actual_start=BASE_TIME)

    recorded, error = await _record(service, end=BASE_TIME - timedelta(minutes=1))

    assert recorded is None
    assert error == "Actual end time must be after actual start time"
    assert event.actual_end_time is None
    db.commit.assert_not_awaited()


@pytest.mark.parametrize(
    ("existing_start", "existing_end", "new_start", "new_end"),
    [
        (None, BASE_TIME + timedelta(hours=1), BASE_TIME, None),
        (BASE_TIME, None, None, BASE_TIME + timedelta(hours=1)),
    ],
)
async def test_valid_one_sided_updates_are_accepted(
    existing_start, existing_end, new_start, new_end
):
    service, db, event = _service(existing_start, existing_end)

    recorded, error = await _record(service, start=new_start, end=new_end)

    assert error is None
    assert recorded is event
    assert event.actual_start_time == (new_start or existing_start)
    assert event.actual_end_time == (new_end or existing_end)
    db.commit.assert_awaited_once()


@pytest.mark.parametrize(
    ("new_start", "new_end"), [(BASE_TIME, None), (None, BASE_TIME)]
)
async def test_one_value_is_accepted_when_other_remains_unset(new_start, new_end):
    service, db, event = _service()

    recorded, error = await _record(service, start=new_start, end=new_end)

    assert error is None
    assert recorded is event
    assert event.actual_start_time == new_start
    assert event.actual_end_time == new_end
    db.commit.assert_awaited_once()


@pytest.mark.parametrize(
    ("end", "accepted"),
    [
        (BASE_TIME + timedelta(hours=1), True),
        (BASE_TIME, False),
        (BASE_TIME - timedelta(minutes=1), False),
    ],
)
async def test_supplying_both_values_validates_their_order(end, accepted):
    service, db, event = _service()

    recorded, error = await _record(service, start=BASE_TIME, end=end)

    assert (error is None) is accepted
    assert (recorded is event) is accepted
    if accepted:
        db.commit.assert_awaited_once()
    else:
        db.commit.assert_not_awaited()


async def test_record_times_api_returns_bad_request_for_invalid_effective_pair():
    service, db, _ = _service(actual_end=BASE_TIME)
    # Keep the endpoint's real service construction while supplying its fake DB.
    assert isinstance(service, EventService)

    with pytest.raises(HTTPException) as exc_info:
        await record_actual_times_api(
            event_id=uuid4(),
            times_data=RecordActualTimes(
                actual_start_time=BASE_TIME + timedelta(minutes=1)
            ),
            db=db,
            # ``id`` stands in for the acting user the endpoint now records as
            # the finalizer when an end time closes the event.
            current_user=SimpleNamespace(organization_id=uuid4(), id=uuid4()),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Actual end time must be after actual start time"
    db.commit.assert_not_awaited()


async def test_a_cancelled_event_is_refused():
    """As End Event: the auto-finalize would re-credit what cancelling voided."""
    service, db, event = _service()
    event.is_cancelled = True

    recorded, error = await _record(service, end=BASE_TIME)

    assert recorded is None
    assert error == "Cannot record actual times for a cancelled event"
    assert event.actual_end_time is None
    db.commit.assert_not_awaited()
    service.finalize_event_attendance.assert_not_awaited()


async def test_correcting_the_end_undoes_end_event_s_bulk_check_out():
    """End Event stamped its own instant as every open attendee's check-out.
    Left, that measured duration outranks the corrected end, so the officer's
    correction would change nobody's credit."""
    ended_late = BASE_TIME + timedelta(hours=3)
    event = SimpleNamespace(
        id="event-1",
        organization_id="org-1",
        is_cancelled=False,
        actual_start_time=BASE_TIME,
        actual_end_time=ended_late,
        updated_at=None,
    )
    bulk = SimpleNamespace(checked_out_at=ended_late, attendance_duration_minutes=180)
    own = SimpleNamespace(
        checked_out_at=BASE_TIME + timedelta(hours=1),
        attendance_duration_minutes=60,
    )

    def _one(value):
        result = Mock()
        result.scalar_one_or_none.return_value = value
        return result

    rsvps = Mock()
    rsvps.scalars.return_value.all.return_value = [bulk, own]
    db = SimpleNamespace(
        # The event lock, End Event's check-outs, then the re-read after the
        # auto-finalize.
        execute=AsyncMock(side_effect=[_one(event), rsvps, _one(event)]),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )
    service = EventService(db)
    service.finalize_event_attendance = AsyncMock(return_value=(1, None))

    recorded, error = await _record(service, end=BASE_TIME + timedelta(hours=1))

    assert error is None
    assert recorded is event
    assert (bulk.checked_out_at, bulk.attendance_duration_minutes) == (None, None)
    assert own.attendance_duration_minutes == 60
    service.finalize_event_attendance.assert_awaited_once()
    # Finalize resets the event's relationships (populate_existing); the
    # endpoint serializes location_obj, so the re-read has to load it.
    reread = db.execute.await_args_list[2].args[0]
    loaded = {
        str(element) for option in reread._with_options for element in option.path
    }
    assert "Event.location_obj" in loaded
