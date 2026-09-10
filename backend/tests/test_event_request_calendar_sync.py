"""The calendar entry an outreach request creates must follow the request.

``schedule_request`` put the event on the department calendar and nothing ever
touched it again. Declining, cancelling, or postponing to a date TBD stood the
volunteer signup sheet down and left the calendar entry standing, so the
department kept an outreach event on its schedule for something nobody was
running. Postponing to a *new* date moved the sheet and left the entry at the
old time. And re-scheduling created a second entry, overwriting the request's
`event_id` and orphaning the first — one phantom event per reschedule, on the
surface members actually read.

These mirror ``sync_staffing_shift_*``'s contract: the sync is best-effort and
never raises into the caller, because a request that has already been
rescheduled is not worth failing to report a calendar problem.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.event_request import EventRequestActivity
from app.services.event_request_service import (
    sync_calendar_event_cancelled,
    sync_calendar_event_date,
)

ORG_ID = "00000000-0000-0000-0000-000000000001"
USER_ID = "00000000-0000-0000-0000-0000000000aa"
REQUEST_ID = "00000000-0000-0000-0000-0000000000bb"
EVENT_ID = "00000000-0000-0000-0000-0000000000dd"

START = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)


def _request(**overrides):
    row = {
        "id": REQUEST_ID,
        "organization_id": ORG_ID,
        "event_id": EVENT_ID,
        "event_date": START,
        "event_end_date": START + timedelta(hours=2),
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _event(**overrides):
    row = {
        "id": EVENT_ID,
        "organization_id": ORG_ID,
        "is_cancelled": False,
        "start_datetime": START - timedelta(days=14),
        "end_datetime": START - timedelta(days=14) + timedelta(hours=2),
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _db(event):
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.return_value = event
    return db


def _activity_actions(db):
    return [
        call.args[0].action
        for call in db.add.call_args_list
        if isinstance(call.args[0], EventRequestActivity)
    ]


class _Service:
    """Stands in for EventService, recording the call the sync makes."""

    instances: list = []

    def __init__(self, db):
        self.update_event = AsyncMock()
        self.cancel_event = AsyncMock()
        _Service.instances.append(self)


def _patch_event_service():
    _Service.instances = []
    return patch("app.services.event_service.EventService", _Service)


# ============================================
# Moving the entry
# ============================================


@pytest.mark.asyncio
async def test_a_new_confirmed_date_moves_the_calendar_entry():
    db = _db(_event())
    with _patch_event_service():
        await sync_calendar_event_date(db, _request(), USER_ID)

    service = _Service.instances[0]
    service.update_event.assert_awaited_once()
    kwargs = service.update_event.await_args.kwargs
    assert kwargs["event_data"].start_datetime == START
    assert "calendar_event_rescheduled" in _activity_actions(db)


@pytest.mark.asyncio
async def test_an_entry_already_at_the_new_date_is_left_alone():
    db = _db(_event(start_datetime=START, end_datetime=START + timedelta(hours=2)))
    with _patch_event_service():
        await sync_calendar_event_date(db, _request(), USER_ID)

    assert _Service.instances == []
    assert _activity_actions(db) == []


@pytest.mark.asyncio
async def test_a_cancelled_entry_is_not_moved():
    """A cancelled event refuses edits by design; rescheduling makes a new one."""
    db = _db(_event(is_cancelled=True))
    with _patch_event_service():
        await sync_calendar_event_date(db, _request(), USER_ID)

    assert _Service.instances == []


@pytest.mark.asyncio
async def test_a_request_with_no_linked_entry_is_a_no_op():
    db = _db(None)
    with _patch_event_service():
        await sync_calendar_event_date(db, _request(event_id=None), USER_ID)

    db.scalar.assert_not_awaited()
    assert _Service.instances == []


# ============================================
# Standing the entry down
# ============================================


@pytest.mark.asyncio
async def test_a_called_off_request_cancels_the_calendar_entry():
    db = _db(_event())
    with _patch_event_service():
        await sync_calendar_event_cancelled(
            db, _request(), USER_ID, reason="School closed"
        )

    service = _Service.instances[0]
    service.cancel_event.assert_awaited_once()
    kwargs = service.cancel_event.await_args.kwargs
    assert kwargs["reason"] == "School closed"
    assert kwargs["send_notifications"] is True
    assert "calendar_event_cancelled" in _activity_actions(db)


@pytest.mark.asyncio
async def test_an_already_cancelled_entry_is_not_cancelled_twice():
    db = _db(_event(is_cancelled=True))
    with _patch_event_service():
        await sync_calendar_event_cancelled(db, _request(), USER_ID)

    assert _Service.instances == []
    assert _activity_actions(db) == []


@pytest.mark.asyncio
async def test_a_refusing_event_service_does_not_raise_into_the_caller():
    """A finalized event refuses cancellation — its hours are already credited.

    That is an expected miss, not a reason to fail a request the coordinator
    has already declined.
    """
    db = _db(_event())

    class _Refusing(_Service):
        def __init__(self, db):
            super().__init__(db)
            self.cancel_event = AsyncMock(
                side_effect=ValueError("Attendance is finalized")
            )

    _Service.instances = []
    with patch("app.services.event_service.EventService", _Refusing):
        await sync_calendar_event_cancelled(db, _request(), USER_ID)

    assert _activity_actions(db) == []


# ============================================
# Tenancy — the link is still an id from a row
# ============================================


@pytest.mark.asyncio
async def test_the_linked_event_lookup_is_org_scoped():
    """CLAUDE.md pitfall #14a: a stored id is still a by-id read."""
    db = _db(_event())
    with _patch_event_service():
        await sync_calendar_event_cancelled(db, _request(), USER_ID)

    compiled = db.scalar.await_args.args[0].compile()
    assert ORG_ID in compiled.params.values()
    assert EVENT_ID in compiled.params.values()


# ============================================
# Rescheduling — one entry, not one per attempt
# ============================================


def _schedule_db(event_request, linked_event, org):
    """A db answering the lookups ``schedule_request`` makes, in order."""
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: event_request),  # the request
        SimpleNamespace(scalar_one_or_none=lambda: org),  # org, for the title
        SimpleNamespace(scalar_one_or_none=lambda: org),  # org, for the email
    ]
    db.scalar.return_value = linked_event
    return db


def _scheduled_request():
    from app.models.event_request import EventRequestStatus

    return SimpleNamespace(
        id=REQUEST_ID,
        organization_id=ORG_ID,
        status=EventRequestStatus.POSTPONED,
        outreach_type="station_tour",
        contact_name="Dana Reyes",
        organization_name="Maple Street Elementary",
        description="Station tour for a scout troop.",
        venue_address=None,
        event_id=EVENT_ID,
        event_date=None,
        event_end_date=None,
        event_location_id=None,
        staffing_shift_id=None,
        activity_log=[],
    )


def _org():
    return SimpleNamespace(
        id=ORG_ID,
        name="Oakville Fire Department",
        active=True,
        timezone="America/New_York",
        settings={"events": {}},
    )


async def _reschedule(linked_event):
    from app.api.v1.endpoints.event_requests import schedule_request
    from app.schemas.event_request import EventRequestSchedule

    event_request = _scheduled_request()
    db = _schedule_db(event_request, linked_event, _org())
    created = AsyncMock(return_value=SimpleNamespace(id="a-brand-new-event"))

    class _Sched(_Service):
        def __init__(self, db):
            super().__init__(db)
            self.create_event = created

    _Service.instances = []
    with (
        patch("app.services.event_service.EventService", _Sched),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        result = await schedule_request(
            request_id=REQUEST_ID,
            data=EventRequestSchedule(event_date=START, create_calendar_event=True),
            db=db,
            current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
        )
    return result, event_request, _Service.instances[0], created


@pytest.mark.asyncio
async def test_rescheduling_moves_the_existing_entry_instead_of_duplicating_it():
    result, event_request, service, created = await _reschedule(_event())

    created.assert_not_awaited()
    service.update_event.assert_awaited_once()
    assert service.update_event.await_args.kwargs["event_data"].start_datetime == START
    assert result["event_id"] == EVENT_ID
    assert event_request.event_id == EVENT_ID


@pytest.mark.asyncio
async def test_rescheduling_after_a_tbd_postponement_opens_a_fresh_entry():
    """A postponement to TBD cancels the entry, and a cancelled one is final."""
    result, event_request, service, created = await _reschedule(
        _event(is_cancelled=True)
    )

    service.update_event.assert_not_awaited()
    created.assert_awaited_once()
    assert result["event_id"] == "a-brand-new-event"
    assert event_request.event_id == "a-brand-new-event"


# ============================================
# An event needs a length
# ============================================


@pytest.mark.asyncio
async def test_scheduling_without_an_end_time_gives_the_entry_a_real_length():
    """`EventCreate` refuses an end at or before the start.

    The end time is optional on the schedule form, and the handler passed the
    start through as the end, so every request scheduled without one raised an
    uncaught ValidationError. The department's own default event length fills
    the gap.
    """
    result, event_request, service, created = await _reschedule(None)

    created.assert_awaited_once()
    event_data = created.await_args.kwargs["event_data"]
    assert event_data.start_datetime == START
    assert event_data.end_datetime == START + timedelta(minutes=60)
    assert result["event_id"] == "a-brand-new-event"


@pytest.mark.asyncio
async def test_a_moved_entry_keeps_the_length_the_coordinator_gave_it():
    three_hours = _event(
        start_datetime=START - timedelta(days=14),
        end_datetime=START - timedelta(days=14) + timedelta(hours=3),
    )
    _, _, service, _ = await _reschedule(three_hours)

    event_data = service.update_event.await_args.kwargs["event_data"]
    assert event_data.end_datetime == START + timedelta(hours=3)


# ============================================
# The pipeline transitions that stand an entry down
# ============================================


def _pipeline_db(event_request, org, linked_event=None):
    """`db.scalar` answers `get_linked_calendar_event`, not the organization —
    the org is loaded with `db.execute` on every one of these paths."""
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: event_request)
    db.scalar.return_value = linked_event
    return db


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("from_status", "new_status"),
    # DECLINED is only reachable before a date is agreed, so a declined request
    # rarely carries an entry — the sync is a no-op there and the call is kept
    # for the case where a coordinator linked an existing event by hand.
    # CANCELLED is the transition this actually matters on.
    [("in_progress", "declined"), ("scheduled", "cancelled")],
)
async def test_declining_or_cancelling_stands_the_calendar_entry_down(
    from_status, new_status
):
    from app.api.v1.endpoints.event_requests import update_event_request_status
    from app.models.event_request import EventRequestStatus
    from app.schemas.event_request import EventRequestStatusUpdate

    event_request = _scheduled_request()
    event_request.status = EventRequestStatus(from_status)
    db = _pipeline_db(event_request, _org())
    cancelled = AsyncMock()

    with (
        patch(
            "app.api.v1.endpoints.event_requests.sync_staffing_shift_cancelled",
            AsyncMock(),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.sync_calendar_event_cancelled",
            cancelled,
        ),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await update_event_request_status(
            request_id=REQUEST_ID,
            update=EventRequestStatusUpdate(status=new_status),
            db=db,
            current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
        )

    cancelled.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_requester_cancelling_stands_the_calendar_entry_down():
    from app.api.v1.endpoints.event_requests import public_cancel_request
    from app.models.event_request import EventRequestStatus
    from app.schemas.event_request import EventRequestPublicCancel

    event_request = _scheduled_request()
    event_request.status = EventRequestStatus.SCHEDULED
    db = _pipeline_db(event_request, _org())
    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: event_request),
        SimpleNamespace(scalar_one_or_none=lambda: _org()),
    ]
    cancelled = AsyncMock()

    with (
        patch(
            "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
            AsyncMock(return_value=(True, 1, 10)),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.sync_staffing_shift_cancelled",
            AsyncMock(),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.sync_calendar_event_cancelled",
            cancelled,
        ),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await public_cancel_request(
            token="a-status-token",
            data=EventRequestPublicCancel(reason="School closed"),
            request=SimpleNamespace(
                headers={},
                client=SimpleNamespace(host="203.0.113.4"),
                state=SimpleNamespace(),
            ),
            db=db,
        )

    cancelled.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("new_date", "moved", "stood_down"),
    [(START, True, False), (None, False, True)],
)
async def test_postponing_moves_or_stands_down_the_entry(new_date, moved, stood_down):
    """A new date moves the entry; a date TBD means there is nothing to attend."""
    from app.api.v1.endpoints.event_requests import postpone_request
    from app.models.event_request import EventRequestStatus
    from app.schemas.event_request import EventRequestPostpone

    event_request = _scheduled_request()
    event_request.status = EventRequestStatus.SCHEDULED
    db = _pipeline_db(event_request, _org(), linked_event=_event())
    # The date sync returns a refusal reason or None; None means it moved.
    move = AsyncMock(return_value=None)
    cancel = AsyncMock()

    with (
        patch(
            "app.api.v1.endpoints.event_requests.sync_staffing_shift_date", AsyncMock()
        ),
        patch(
            "app.api.v1.endpoints.event_requests.sync_staffing_shift_cancelled",
            AsyncMock(),
        ),
        patch("app.api.v1.endpoints.event_requests.sync_calendar_event_date", move),
        patch(
            "app.api.v1.endpoints.event_requests.sync_calendar_event_cancelled", cancel
        ),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await postpone_request(
            request_id=REQUEST_ID,
            data=EventRequestPostpone(new_event_date=new_date),
            db=db,
            current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
        )

    assert (move.await_count == 1) is moved
    assert (cancel.await_count == 1) is stood_down
