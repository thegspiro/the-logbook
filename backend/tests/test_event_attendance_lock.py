"""The attendance lock: finalizing an event closes it, reopening is a grant.

Finalizing used to be a recalculation with no state behind it. It wrote
``custom_fields["attendance_finalized"]``, which exactly one consumer read (the
post-event validation reminder) and no mutation checked — so check-in, adding
and removing attendees, correcting credited times, re-recording the clock and
deleting the event all kept working afterwards. A correction made then never
reached the admin-hours entry already credited from the finalized duration,
because ``credit_event_attendance`` skips an RSVP it has already credited: the
event screen and the hours ledger disagreed permanently, behind a success
toast.

These tests lock the state transition (every attendance write refused once
``attendance_finalized_at`` is set), the way back (reopen clears the derived
durations so re-finalizing genuinely recomputes), and the resync that carries a
correction into the ledger. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.events import _resolve_display_names
from app.core.permissions import ALL_PERMISSIONS, OPERATIONAL_RANKS
from app.models.admin_hours import AdminHoursEntryMethod, AdminHoursEntryStatus
from app.models.event import CheckInWindowType, EventType
from app.schemas.event import EventUpdate
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    EventService,
    attendance_is_finalized,
    attendance_locked_error,
    changed_attendance_fields,
)


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _event(finalized=True, **overrides):
    now = datetime.now(timezone.utc)
    fields = {
        "id": "event-1",
        "organization_id": "org-1",
        "title": "Monthly Drill",
        "custom_fields": {"attendance_finalized": True} if finalized else {},
        "attendance_finalized_at": now - timedelta(hours=1) if finalized else None,
        "attendance_finalized_by": "chief-1" if finalized else None,
        "start_datetime": now - timedelta(hours=4),
        "end_datetime": now - timedelta(hours=2),
        "actual_start_time": None,
        "actual_end_time": now - timedelta(hours=2),
        "is_cancelled": False,
        "max_attendees": None,
        "event_type": None,
        "custom_category": None,
        "updated_at": now,
        "check_in_window_type": None,
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
        "require_checkout": False,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


@pytest.fixture(autouse=True)
def _no_room_booking_lock(monkeypatch):
    """update_event takes the room-booking lock first (EV-26). It is a
    statement these mocked sessions would otherwise have to answer, and it is
    covered on a real database by test_room_booking_race.py."""
    monkeypatch.setattr(
        "app.services.location_service.LocationService.lock_room_bookings",
        AsyncMock(),
    )


def _mock_db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    return db


class TestLockPredicate:
    def test_column_is_the_authority(self):
        assert attendance_is_finalized(_event()) is True
        assert attendance_is_finalized(_event(finalized=False)) is False

    def test_legacy_json_marker_still_locks(self):
        """A row the migration's dialect guard skipped keeps its lock rather
        than silently reopening on deploy."""
        legacy = _event(finalized=False, custom_fields={"attendance_finalized": True})
        assert attendance_is_finalized(legacy) is True

    def test_refusal_carries_the_sentinel_prefix(self):
        message = attendance_locked_error("checking a member in")
        assert message.startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "checking a member in" in message


class TestFinalizedEventRefusesAttendanceWrites:
    async def test_check_in_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.check_in_attendee("event-1", "user-1", "org-1")
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_add_attendee_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.manager_add_attendee(
            event_id="event-1",
            user_id="user-1",
            organization_id="org-1",
            manager_id="mgr-1",
        )
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_override_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.override_rsvp_attendance(
            event_id="event-1",
            user_id="user-1",
            organization_id="org-1",
            manager_id="mgr-1",
            override_data=SimpleNamespace(model_dump=lambda **_: {}),
        )
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_remove_attendee_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        err = await svc.remove_attendee("event-1", "user-1", "org-1")
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_record_actual_times_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        event, err = await svc.record_actual_times(
            event_id="event-1",
            organization_id="org-1",
            actual_start_time=None,
            actual_end_time=datetime.now(timezone.utc),
        )
        assert event is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_self_check_in_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err, notice = await svc.self_check_in("event-1", "user-1", "org-1")
        assert rsvp is None
        assert notice is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_end_event_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        event, count, err = await svc.end_event("event-1", "org-1")
        assert event is None
        assert count == 0
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_delete_is_refused(self):
        """Deleting cascades the RSVPs — the record the credited hours came
        from."""
        db = _mock_db(_one(_event()))
        svc = EventService(db)
        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.delete_event("event-1", "org-1")
        assert str(excinfo.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        db.delete.assert_not_called()

    async def test_qr_payload_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        data, err = await svc.get_qr_check_in_data("event-1", "org-1")
        assert data is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_waitlist_promotion_declines_quietly(self):
        """This one runs unattended from remove_attendee, so it returns None
        rather than an error string nobody would read."""
        svc = EventService(_mock_db(_one(_event(max_attendees=10))))
        assert await svc.promote_from_waitlist("event-1", "org-1") is None


class TestOpenEventStillAcceptsWrites:
    async def test_check_in_reaches_the_window_check_when_not_finalized(self):
        """The guard must key on the lock, not on the event being over."""
        event = _event(finalized=False)
        db = _mock_db(_one(event), _one(SimpleNamespace(timezone="UTC")))
        svc = EventService(db)
        rsvp, err = await svc.check_in_attendee("event-1", "user-1", "org-1")
        # Refused by the check-in window (the event ended two hours ago), which
        # is a different refusal — and specifically not the lock.
        assert rsvp is None
        assert not (err or "").startswith(ATTENDANCE_LOCKED_PREFIX)


class TestUpdateSplitsDescriptiveFromAttendanceSensitive:
    async def test_retitling_a_closed_event_is_allowed(self):
        event = _event(
            title="Old title",
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        svc = EventService(db)
        payload = SimpleNamespace(
            model_dump=lambda **_: {"title": "Monthly Drill (corrected)"}
        )

        result = await svc.update_event("event-1", "org-1", payload)

        assert result is event
        assert event.title == "Monthly Drill (corrected)"

    async def test_moving_the_clock_of_a_closed_event_is_refused(self):
        event = _event()
        svc = EventService(_mock_db(_one(event)))
        new_end = datetime.now(timezone.utc)
        payload = SimpleNamespace(model_dump=lambda **_: {"end_datetime": new_end})

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.update_event("event-1", "org-1", payload)

        assert str(excinfo.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "end_datetime" in str(excinfo.value)
        assert event.end_datetime != new_end


def _closed_meeting(**overrides):
    """A finalized event as the service sees it: UTC times on whole seconds
    and enum members, no location to double-book against. The times are aware
    because the ORM's load and refresh listeners stamp UTC on what MySQL
    returns (``app.core.database``); one case below feeds a naive value
    directly, as a defensive check."""
    start = datetime(2026, 9, 12, 13, 0, tzinfo=timezone.utc)
    fields = {
        "title": "Ladder drill",
        "description": None,
        "location_id": None,
        "location": None,
        "location_obj": None,
        "is_draft": False,
        "updated_by": None,
        "event_type": EventType.BUSINESS_MEETING,
        "check_in_window_type": CheckInWindowType.FLEXIBLE,
        "start_datetime": start,
        "end_datetime": start + timedelta(hours=3),
        "actual_end_time": None,
    }
    fields.update(overrides)
    return _event(**fields)


def _form_save(event, **changes):
    """A save that restates every schedule and check-in field the edit form
    shows for ``event`` — what an API client, or an edit page from before it
    left the locked fields out, sends. Times as the browser's
    ``…T13:00:00.000Z``, enums as their lowercase values, parsed by the real
    schema as the endpoint does."""
    body = {
        "title": event.title,
        "event_type": "business_meeting",
        "start_datetime": event.start_datetime.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "end_datetime": event.end_datetime.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "check_in_window_type": "flexible",
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
        "require_checkout": False,
    }
    body.update(changes)
    return EventUpdate.model_validate(body)


def _raw(**update_data):
    return SimpleNamespace(model_dump=lambda **_: dict(update_data))


class TestUpdateLocksOnChangeNotPresence:
    """The lock refuses a change to what attendance was measured against, not
    a field's mere presence. A client that restates every field the form shows
    must still be able to save a finalized event: a presence check refused
    every such save, title fixes included."""

    async def test_unchanged_locked_fields_restated_with_a_title_fix_are_accepted(
        self,
    ):
        event = _closed_meeting()
        svc = EventService(_mock_db(_one(event)))

        result = await svc.update_event(
            "event-1", "org-1", _form_save(event, title="Ladder drill (corrected)")
        )

        assert result is event
        assert event.title == "Ladder drill (corrected)"

    async def test_an_equal_instant_in_another_zone_or_naive_utc_is_unchanged(self):
        event = _closed_meeting()
        start, end = event.start_datetime, event.end_datetime
        svc = EventService(_mock_db(_one(event)))

        await svc.update_event(
            "event-1",
            "org-1",
            _raw(
                start_datetime=start.astimezone(timezone(timedelta(hours=-4))),
                end_datetime=end.replace(tzinfo=None),
            ),
        )

        assert (event.start_datetime, event.end_datetime) == (start, end)

    async def test_naive_stored_times_match_the_browser_s_utc_times(self):
        """Defensive: the ORM stamps UTC on load, but a naive value (one
        assigned in memory, say) must still be read as UTC."""
        event = _closed_meeting()
        event.start_datetime = event.start_datetime.replace(tzinfo=None)
        event.end_datetime = event.end_datetime.replace(tzinfo=None)
        svc = EventService(_mock_db(_one(event)))

        await svc.update_event(
            "event-1",
            "org-1",
            _form_save(_closed_meeting(), title="Ladder drill (corrected)"),
        )

        assert event.title == "Ladder drill (corrected)"
        assert event.start_datetime.tzinfo is None

    async def test_enum_members_and_their_string_values_compare_equal(self):
        event = _closed_meeting(check_in_window_type=CheckInWindowType.WINDOW)
        svc = EventService(_mock_db(_one(event)))

        await svc.update_event(
            "event-1",
            "org-1",
            _raw(event_type="business_meeting", check_in_window_type="window"),
        )

    async def test_unchanged_locked_values_are_not_rewritten(self):
        """Nothing about a closed event's locked columns is written, not even
        an equal value in another representation."""
        event = _closed_meeting()
        svc = EventService(_mock_db(_one(event)))

        await svc.update_event("event-1", "org-1", _form_save(event))

        assert event.event_type is EventType.BUSINESS_MEETING
        assert event.check_in_window_type is CheckInWindowType.FLEXIBLE

    async def test_a_refusal_names_only_the_fields_that_change(self):
        event = _closed_meeting()
        svc = EventService(_mock_db(_one(event)))

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.update_event(
                "event-1",
                "org-1",
                _form_save(event, title="Renamed", check_in_minutes_before=30),
            )

        assert str(excinfo.value) == attendance_locked_error(
            "changing check_in_minutes_before"
        )
        assert (event.title, event.check_in_minutes_before) == ("Ladder drill", 60)

    async def test_filling_in_a_null_lead_time_is_a_change(self):
        """NULL means 15 minutes on a window-type event; the form shows 60.
        Saving 60 would move the window members were measured against."""
        event = _closed_meeting(
            check_in_window_type=CheckInWindowType.WINDOW, check_in_minutes_before=None
        )
        svc = EventService(_mock_db(_one(event)))

        with pytest.raises(ValueError, match="check_in_minutes_before"):
            await svc.update_event(
                "event-1", "org-1", _form_save(event, check_in_window_type="window")
            )

        assert event.check_in_minutes_before is None

    async def test_a_one_second_move_is_a_change(self):
        event = _closed_meeting()
        svc = EventService(_mock_db(_one(event)))

        with pytest.raises(ValueError, match="end_datetime"):
            await svc.update_event(
                "event-1",
                "org-1",
                _raw(end_datetime=event.end_datetime + timedelta(seconds=1)),
            )

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("start_datetime", datetime(2026, 9, 12, 13, 15, tzinfo=timezone.utc)),
            ("end_datetime", datetime(2026, 9, 12, 16, 15, tzinfo=timezone.utc)),
            ("actual_start_time", datetime(2026, 9, 12, 13, 5, tzinfo=timezone.utc)),
            ("actual_end_time", datetime(2026, 9, 12, 16, 5, tzinfo=timezone.utc)),
            ("require_checkout", True),
            ("check_in_window_type", "strict"),
            ("check_in_minutes_before", 30),
            ("check_in_minutes_after", 30),
            ("event_type", "training"),
            ("custom_category", "Drills"),
        ],
    )
    async def test_each_sensitive_field_is_refused_when_it_changes(self, field, value):
        event = _closed_meeting()
        before = getattr(event, field)
        svc = EventService(_mock_db(_one(event)))

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.update_event("event-1", "org-1", _raw(**{field: value}))

        assert str(excinfo.value) == attendance_locked_error(f"changing {field}")
        assert getattr(event, field) == before

    async def test_an_open_event_still_takes_a_changed_clock(self):
        event = _closed_meeting(
            custom_fields={}, attendance_finalized_at=None, attendance_finalized_by=None
        )
        new_end = event.end_datetime + timedelta(minutes=30)
        svc = EventService(_mock_db(_one(event)))

        await svc.update_event("event-1", "org-1", _raw(end_datetime=new_end))

        assert event.end_datetime == new_end


class TestTheLockComparesValuesNotPresence:
    """The edit form re-sends every schedule and check-in field it shows.

    Deciding the lock by which fields were present refused a title fix on a
    finalized event; it is decided by which ones would change.
    """

    def test_a_naive_stored_time_equals_the_same_aware_instant(self):
        stored = datetime(2026, 6, 1, 19, 0)
        event = _event(start_datetime=stored)
        sent = {"start_datetime": stored.replace(tzinfo=timezone.utc)}
        assert changed_attendance_fields(event, sent) == set()

    def test_sub_second_noise_is_not_a_change(self):
        # MySQL DATETIME keeps whole seconds; the payload may carry more.
        stored = datetime(2026, 6, 1, 19, 0, tzinfo=timezone.utc)
        event = _event(start_datetime=stored)
        sent = {"start_datetime": stored.replace(microsecond=500)}
        assert changed_attendance_fields(event, sent) == set()

    def test_an_enum_column_equals_its_string(self):
        event = _event(check_in_window_type=CheckInWindowType.FLEXIBLE)
        sent = {"check_in_window_type": CheckInWindowType.FLEXIBLE.value}
        assert changed_attendance_fields(event, sent) == set()

    def test_a_null_check_in_rule_equals_the_default_the_form_fills_in(self):
        # Older events store NULL; the edit form shows and re-sends the
        # default the check-in window already applies for it.
        event = _event(
            check_in_window_type=None,
            check_in_minutes_before=None,
            check_in_minutes_after=None,
            require_checkout=None,
        )
        sent = {
            "check_in_window_type": "flexible",
            "check_in_minutes_before": 60,
            "check_in_minutes_after": 15,
            "require_checkout": False,
        }
        assert changed_attendance_fields(event, sent) == set()

    def test_switching_a_null_window_to_a_timed_one_is_a_change(self):
        event = _event(check_in_window_type=None, check_in_minutes_before=None)
        assert changed_attendance_fields(event, {"check_in_window_type": "window"}) == {
            "check_in_window_type"
        }

    def test_a_real_change_is_still_reported(self):
        event = _event()
        sent = {
            "check_in_minutes_before": 30,
            "check_in_minutes_after": event.check_in_minutes_after,
            "end_datetime": event.end_datetime + timedelta(minutes=15),
        }
        assert changed_attendance_fields(event, sent) == {
            "check_in_minutes_before",
            "end_datetime",
        }

    async def test_a_title_fix_from_the_edit_form_saves(self):
        event = _event(
            title="Old title",
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        form = {
            "title": "Monthly Drill (corrected)",
            "start_datetime": event.start_datetime,
            "end_datetime": event.end_datetime,
            "event_type": event.event_type,
            "custom_category": event.custom_category,
            "check_in_window_type": event.check_in_window_type,
            "check_in_minutes_before": event.check_in_minutes_before,
            "check_in_minutes_after": event.check_in_minutes_after,
        }
        svc = EventService(_mock_db(_one(event)))
        payload = SimpleNamespace(model_dump=lambda **_: dict(form))

        result = await svc.update_event("event-1", "org-1", payload)

        assert result is event
        assert event.title == "Monthly Drill (corrected)"

    def _series(self, occurrence):
        anchor = _event(recurrence_parent_id=None, is_cancelled=False)
        svc = EventService(_mock_db(_one(anchor), _all([occurrence])))
        svc.event_credits_training = MagicMock(return_value=False)
        svc._follow_training_changes = AsyncMock(return_value=None)
        return svc

    async def test_a_series_description_edit_reaching_a_closed_occurrence_saves(
        self,
    ):
        occurrence = _event(description="old", updated_by=None)
        svc = self._series(occurrence)
        payload = SimpleNamespace(
            model_dump=lambda **_: {
                "description": "new",
                "check_in_minutes_before": occurrence.check_in_minutes_before,
                "check_in_window_type": occurrence.check_in_window_type,
            }
        )

        assert await svc.update_future_events("event-1", "org-1", payload) == 1
        assert occurrence.description == "new"

    async def test_a_series_change_to_a_closed_occurrence_s_rules_is_refused(self):
        occurrence = _event(description="old", updated_by=None)
        svc = self._series(occurrence)
        payload = SimpleNamespace(
            model_dump=lambda **_: {"description": "new", "check_in_minutes_before": 5}
        )

        with pytest.raises(ValueError, match="check_in_minutes_before"):
            await svc.update_future_events("event-1", "org-1", payload)
        assert occurrence.description == "old"


class TestDeferredCommit:
    """A caller moving several events as one change commits once itself."""

    async def test_update_flushes_and_holds_the_reversal_for_after_commit(self):
        event = _event(
            finalized=False,
            title="Drill",
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        svc = EventService(db)
        svc._follow_training_changes = AsyncMock(return_value=("training", "ref"))
        svc._reverse_pipeline_after_commit = AsyncMock()
        payload = SimpleNamespace(model_dump=lambda **_: {"title": "Drill 2"})

        await svc.update_event("event-1", "org-1", payload, defer_commit=True)

        db.commit.assert_not_awaited()
        db.flush.assert_awaited()
        svc._reverse_pipeline_after_commit.assert_not_awaited()

        await svc.complete_deferred_writes("org-1")
        svc._reverse_pipeline_after_commit.assert_awaited_once_with(
            [("training", "ref")], "org-1"
        )

    async def test_cancel_flushes_and_holds_the_reversals(self):
        event = _event(finalized=False, rsvps=[], cancellation_reason=None)
        db = _mock_db(_one(event))
        svc = EventService(db)
        svc._revoke_event_attendance_credit = AsyncMock(return_value=["reversal"])
        svc._reverse_pipeline_after_commit = AsyncMock()

        await svc.cancel_event("event-1", "org-1", "weather", defer_commit=True)

        assert event.is_cancelled is True
        db.commit.assert_not_awaited()
        await svc.complete_deferred_writes("org-1")
        svc._reverse_pipeline_after_commit.assert_awaited_once_with(
            ["reversal"], "org-1"
        )

    async def test_a_deferred_cancel_cannot_promise_notifications(self):
        svc = EventService(_mock_db())
        with pytest.raises(ValueError, match="notifications"):
            await svc.cancel_event(
                "event-1",
                "org-1",
                "weather",
                send_notifications=True,
                defer_commit=True,
            )


class TestReopen:
    async def test_reopen_undoes_end_event_s_bulk_check_out(self):
        """End Event stamps its own instant as every open attendee's check-out
        and measures a duration to it. Left in place, that measured duration
        outranks a corrected end time, so an event ended two hours late could
        never be credited correctly again. A member's own check-out stays."""
        event = _event()
        # MySQL hands DATETIME back naive; the comparison must still match.
        bulk_end = event.actual_end_time.replace(tzinfo=None)
        bulk = SimpleNamespace(checked_out_at=bulk_end, attendance_duration_minutes=240)
        own = SimpleNamespace(
            checked_out_at=event.actual_end_time - timedelta(minutes=30),
            attendance_duration_minutes=90,
        )
        db = _mock_db(_one(event), _all([]), _all([bulk, own]), _one(event))
        svc = EventService(db)

        _, err = await svc.reopen_event_attendance("event-1", "org-1")

        assert err is None
        assert (bulk.checked_out_at, bulk.attendance_duration_minutes) == (None, None)
        assert own.attendance_duration_minutes == 90
        assert own.checked_out_at is not None
        bulk_query = db.execute.await_args_list[2].args[0]
        compiled = str(bulk_query.compile(compile_kwargs={"literal_binds": True}))
        # A manual override is the manager's number, never a bulk stamp.
        assert "event_rsvps.override_duration_minutes IS NULL" in compiled
        assert "event_rsvps.organization_id = 'org-1'" in compiled

    async def test_reopen_clears_the_lock_and_the_derived_durations(self):
        event = _event()
        derived = SimpleNamespace(attendance_duration_minutes=120)
        db = _mock_db(_one(event), _all([derived]), _all([]), _one(event))
        svc = EventService(db)

        result, err = await svc.reopen_event_attendance("event-1", "org-1")

        assert err is None
        assert result is event
        assert event.attendance_finalized_at is None
        assert event.attendance_finalized_by is None
        assert "attendance_finalized" not in event.custom_fields
        # Cleared so a corrected end time actually reflows: finalize only fills
        # a NULL duration.
        assert derived.attendance_duration_minutes is None
        db.commit.assert_awaited_once()

    async def test_reopen_clears_the_reminder_marker_too(self):
        """Otherwise the post-event validation task considers itself done and
        never prompts again for an event that is open once more."""
        event = _event(
            custom_fields={
                "attendance_finalized": True,
                "validation_notification_sent": True,
                "room_setup": "hall",
            }
        )
        db = _mock_db(_one(event), _all([]), _all([]), _one(event))
        svc = EventService(db)

        await svc.reopen_event_attendance("event-1", "org-1")

        assert "validation_notification_sent" not in event.custom_fields
        # Organizer configuration in the same column is left alone.
        assert event.custom_fields["room_setup"] == "hall"

    async def test_reopen_reassigns_a_deep_copy(self):
        """Pitfall #12: a shallow copy shares nested references with the
        committed state, and the write can be a silent no-op."""
        committed = {"attendance_finalized": True, "registration": {"limit": 5}}
        event = _event(custom_fields=committed)
        db = _mock_db(_one(event), _all([]), _all([]), _one(event))

        await EventService(db).reopen_event_attendance("event-1", "org-1")

        assert event.custom_fields is not committed
        assert event.custom_fields["registration"] is not committed["registration"]
        assert committed["attendance_finalized"] is True

    async def test_reopen_eager_loads_the_location_for_the_response(self):
        """The endpoint serializes the reopened event through
        _build_event_response, which reads event.location_obj. Loaded lazily
        that is IO outside the greenlet context — MissingGreenlet, surfacing as
        a 500 on every event that has a location, while location-less events
        short-circuit and look fine.

        The eager load sits on the post-commit re-read, not on the locked
        fetch: FOR UPDATE is meant for the event row alone."""
        reopened = _event()
        db = _mock_db(_one(_event()), _all([]), _all([]), _one(reopened))

        result, err = await EventService(db).reopen_event_attendance("event-1", "org-1")

        assert err is None
        assert result is reopened
        statement = db.execute.await_args.args[0]
        loaded = {
            str(element)
            for option in statement._with_options
            for element in option.path
        }
        assert "Event.location_obj" in loaded

    async def test_an_event_deleted_mid_reopen_reports_not_found(self):
        """The reopen itself has committed; there is simply no row left to
        serialize, and a 404 says that better than a lazy-load crash."""
        db = _mock_db(_one(_event()), _all([]), _all([]), _one(None))

        result, err = await EventService(db).reopen_event_attendance("event-1", "org-1")

        assert result is None
        assert err == "Event not found"

    async def test_reopening_an_open_event_is_refused(self):
        svc = EventService(_mock_db(_one(_event(finalized=False))))
        result, err = await svc.reopen_event_attendance("event-1", "org-1")
        assert result is None
        assert err == "Attendance for this event is not finalized"

    async def test_missing_event_reports_not_found(self):
        svc = EventService(_mock_db(_one(None)))
        result, err = await svc.reopen_event_attendance("event-1", "org-1")
        assert result is None
        assert err == "Event not found"


class TestAdminHoursResync:
    """The bug the lock exists to prevent: a correction that never reaches the
    ledger because credit is idempotent per (RSVP, category)."""

    def _service_with_entry(self, entry):
        # A resync first sweeps entries under categories the event no longer
        # maps to, then looks up the entry for each current mapping.
        db = _mock_db(_all([]), _one(entry))
        svc = AdminHoursService(db)
        svc.get_mappings_for_event = AsyncMock(
            return_value=[("cat-1", 100, SimpleNamespace())]
        )
        return svc, db

    def _entry(self, method=AdminHoursEntryMethod.EVENT_ATTENDANCE):
        return SimpleNamespace(
            id="entry-1",
            duration_minutes=120,
            clock_in_at=None,
            clock_out_at=None,
            description="Event attendance: Monthly Drill",
            entry_method=method,
            # Approved, so the shrinking correction below also shows the
            # officer's decision surviving one that needs no second review.
            status=AdminHoursEntryStatus.APPROVED,
        )

    async def _credit(self, svc, duration, resync):
        now = datetime.now(timezone.utc)
        return await svc.credit_event_attendance(
            organization_id="org-1",
            user_id="user-1",
            event_id="event-1",
            rsvp_id="rsvp-1",
            event_title="Monthly Drill",
            check_in_at=now - timedelta(minutes=duration),
            check_out_at=now,
            duration_minutes=duration,
            # Not training: training events no longer credit admin hours.
            event_type="business_meeting",
            custom_category=None,
            resync=resync,
        )

    async def test_without_resync_an_existing_entry_is_left_alone(self):
        entry = self._entry()
        svc, _ = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=False)

        assert count == 0
        assert entry.duration_minutes == 120

    async def test_resync_moves_the_credited_minutes(self):
        entry = self._entry()
        svc, db = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=True)

        assert count == 1
        assert entry.duration_minutes == 45
        assert entry.status == AdminHoursEntryStatus.APPROVED
        assert entry.clock_out_at is not None
        # Updated in place: the id, and with it the approval and audit trail,
        # survive the correction.
        db.add.assert_not_called()
        db.delete.assert_not_called()

    async def test_resync_leaves_a_hand_edited_entry_alone(self):
        """An entry a member or officer took over by hand is theirs, not a
        derivative of the RSVP."""
        entry = self._entry(method=AdminHoursEntryMethod.MANUAL)
        svc, _ = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=True)

        assert count == 0
        assert entry.duration_minutes == 120


class TestRemovingAnAttendeeTakesTheHoursWithIt:
    async def test_entries_are_deleted_with_the_rsvp(self):
        """source_rsvp_id is ondelete=SET NULL, so without this the entry
        outlives the attendance that justified it."""
        event = _event(finalized=False)
        rsvp = SimpleNamespace(id="rsvp-1", status=None)
        db = _mock_db(_one(event), _one(rsvp))
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls:
            delete_entries = AsyncMock(return_value=1)
            ahs_cls.return_value.delete_event_attendance_entries = delete_entries
            err = await svc.remove_attendee("event-1", "user-1", "org-1")

        assert err is None
        delete_entries.assert_awaited_once_with("rsvp-1", "org-1")


class TestBackfillMigration:
    """The columns arrive with history already in the JSON marker."""

    REVISION = "c3f8a29d54e1"

    def _source(self):
        from pathlib import Path

        versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        matches = [p for p in versions.glob("*.py") if self.REVISION in p.name]
        assert matches, f"no migration file for {self.REVISION}"
        return matches[0].read_text(encoding="utf-8")

    def test_add_column_is_guarded_so_a_re_run_changes_nothing(self):
        source = self._source()
        assert 'if "attendance_finalized_at" not in columns' in source
        assert 'if "attendance_finalized_by" not in columns' in source

    def test_existing_markers_are_backfilled(self):
        """Without this every historically finalized event comes back unlocked
        on deploy, and the whole fleet's past attendance reopens at once."""
        source = self._source()
        assert "attendance_finalized" in source
        assert "COALESCE(actual_end_time, end_datetime)" in source
        assert "attendance_finalized_at IS NULL" in source

    def test_backfill_is_skipped_on_a_dialect_without_json_extract(self):
        source = self._source()
        assert 'bind.dialect.name != "mysql"' in source

    def test_downgrade_drops_what_it_added(self):
        source = self._source()
        downgrade = source.split("def downgrade()", 1)[1]
        assert 'op.drop_column("events", "attendance_finalized_at")' in downgrade
        assert 'op.drop_column("events", "attendance_finalized_by")' in downgrade
        # The FK has to go first or MySQL refuses to drop the column.
        assert downgrade.index("drop_constraint") < downgrade.index(
            'op.drop_column("events", "attendance_finalized_by")'
        )


class TestEveryAttendeeReachesTheLedger:
    """PR #1791 review, P1: the credit loop iterated only the rows finalize
    itself derived a duration for, so anyone who had checked out — normally, or
    via End Event's bulk checkout, which stamps checked_out_at on the whole
    crew before finalize runs — was skipped and never credited at all."""

    async def test_a_checked_out_attendee_is_still_credited(self):
        event = _event(finalized=False, event_type=None)
        checked_out = SimpleNamespace(
            id="rsvp-1",
            user_id="user-1",
            checked_in=True,
            checked_in_at=event.start_datetime,
            checked_out_at=event.end_datetime,
            override_duration_minutes=None,
            override_check_in_at=None,
            override_check_out_at=None,
            attendance_duration_minutes=90,
            early_check_in_minutes=None,
        )
        # One roster read: it has a check-out, so nothing is derived for it,
        # but it is on the roster that reaches the ledger.
        db = _mock_db(_one(event), _all([checked_out]))
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls, patch(
            "app.services.event_service.NotificationsService"
        ) as notif_cls:
            credit = AsyncMock(return_value=1)
            ahs_cls.return_value.credit_event_attendance = credit
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        credit.assert_awaited_once()
        assert credit.await_args.kwargs["rsvp_id"] == "rsvp-1"
        assert credit.await_args.kwargs["duration_minutes"] == 90

    async def test_the_roster_is_a_current_locking_read(self):
        """Pitfall #27. The event lock serializes the attendance writers, but a
        plain SELECT under REPEATABLE READ answers from the snapshot this
        request took before it waited for that lock — so an Edit Times save or
        a check-in it queued behind would be credited from the stale row."""
        event = _event(finalized=False, event_type=None)
        db = _mock_db(_one(event), _all([]))
        svc = EventService(db)

        with patch("app.services.event_service.NotificationsService") as notif_cls:
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            svc._advance_prospects_after_finalize = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        event_read, roster_read = (c.args[0] for c in db.execute.await_args_list[:2])
        for statement in (event_read, roster_read):
            assert statement._for_update_arg is not None
            # Sessions keep objects across a commit; without this the lock is
            # taken but End Event's already-loaded rows are handed back as-is.
            assert statement.get_execution_options().get("populate_existing")
        compiled = str(roster_read.compile(compile_kwargs={"literal_binds": True}))
        assert "event_rsvps.organization_id = 'org-1'" in compiled

    async def test_end_event_records_a_duration_on_bulk_checkout(self):
        """Otherwise the rows it just checked out have no duration for the
        finalize that immediately follows to credit."""
        event = _event(finalized=False, actual_end_time=None)
        rsvp = SimpleNamespace(
            id="rsvp-1",
            user_id="user-1",
            checked_in=True,
            checked_in_at=event.start_datetime,
            checked_out_at=None,
            attendance_duration_minutes=None,
            override_duration_minutes=None,
            override_check_in_at=None,
            override_check_out_at=None,
            early_check_in_minutes=None,
            status=None,
        )
        db = _mock_db(_one(event), _all([rsvp]))
        svc = EventService(db)
        svc.finalize_event_attendance = AsyncMock(return_value=(1, None))

        result, count, err = await svc.end_event("event-1", "org-1")

        assert err is None
        assert count == 1
        assert rsvp.checked_out_at is not None
        assert rsvp.attendance_duration_minutes is not None
        assert rsvp.attendance_duration_minutes > 0
        # Whole seconds: MySQL DATETIME(0) rounds a fraction up, which stored
        # an end a second in the future and made the finalize that follows
        # refuse a Training event as "not ended yet".
        assert event.actual_end_time.microsecond == 0
        assert rsvp.checked_out_at == event.actual_end_time


class TestSeriesPathsHonourTheLock:
    """PR #1791 review, P1: the single-event guards left the series endpoints
    as an open door to the same rows."""

    async def test_series_delete_is_refused_when_any_occurrence_is_closed(self):
        db = _mock_db(_all([_event(finalized=False), _event()]))
        svc = EventService(db)

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX):
            await svc.delete_event_series("parent-1", "org-1")

        db.delete.assert_not_called()

    async def test_series_delete_proceeds_when_all_are_open(self):
        events = [_event(finalized=False), _event(finalized=False)]
        db = _mock_db(_all(events))
        svc = EventService(db)

        deleted = await svc.delete_event_series("parent-1", "org-1")

        assert deleted == 2


class TestCustomFieldsCannotDropTheMarker:
    """PR #1791 review, P2: custom_fields is a whole-column replacement, so a
    payload without the lifecycle keys would strip the marker the post-event
    reminder reads while the column kept the event locked."""

    async def test_lifecycle_keys_survive_a_replacement(self):
        event = _event(
            custom_fields={"attendance_finalized": True, "room": "hall"},
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        payload = SimpleNamespace(
            model_dump=lambda **_: {"custom_fields": {"room": "bay"}}
        )

        await EventService(db).update_event("event-1", "org-1", payload)

        assert event.custom_fields["attendance_finalized"] is True
        assert event.custom_fields["room"] == "bay"

    async def test_a_replacement_cannot_lock_an_open_event(self):
        """The markers are the server's. One arriving in a replacement — an
        echo of another occurrence, or a hand-built payload — would lock the
        event through the legacy marker with no Reopen on offer."""
        event = _event(
            finalized=False,
            custom_fields={"room": "hall"},
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        payload = SimpleNamespace(
            model_dump=lambda **_: {
                "custom_fields": {"attendance_finalized": True, "room": "bay"}
            }
        )

        await EventService(db).update_event("event-1", "org-1", payload)

        assert event.custom_fields == {"room": "bay"}
        assert attendance_is_finalized(event) is False


class TestLockIsAnAtomicTransition:
    """PR #1791 review, P1: the guard was check-then-act. Finalize read the
    event without a row lock and so did every writer, so a check-in could
    commit between finalize's roster snapshot and the close — leaving that
    member checked in, uncredited, and behind a lock with no way to see why."""

    def _locked(self, statement) -> bool:
        return (
            "for update"
            in str(statement.compile(compile_kwargs={"literal_binds": True})).lower()
        )

    async def test_finalize_takes_the_row_lock(self):
        db = _mock_db(_one(None))
        await EventService(db).finalize_event_attendance("event-1", "org-1")
        assert self._locked(db.execute.await_args.args[0])

    async def test_reopen_takes_the_row_lock(self):
        db = _mock_db(_one(None))
        await EventService(db).reopen_event_attendance("event-1", "org-1")
        assert self._locked(db.execute.await_args.args[0])

    async def test_every_attendance_writer_takes_it_too(self):
        """A writer that reads the lock and then writes has to hold the row, or
        it can act on a decision another transaction has already invalidated."""
        svc_calls = [
            ("check_in_attendee", lambda s: s.check_in_attendee("e", "u", "o")),
            (
                "manager_add_attendee",
                lambda s: s.manager_add_attendee(
                    event_id="e", user_id="u", organization_id="o", manager_id="m"
                ),
            ),
            (
                "override_rsvp_attendance",
                lambda s: s.override_rsvp_attendance(
                    event_id="e",
                    user_id="u",
                    organization_id="o",
                    manager_id="m",
                    override_data=SimpleNamespace(model_dump=lambda **_: {}),
                ),
            ),
            ("remove_attendee", lambda s: s.remove_attendee("e", "u", "o")),
            (
                "record_actual_times",
                lambda s: s.record_actual_times(
                    event_id="e",
                    organization_id="o",
                    actual_start_time=None,
                    actual_end_time=None,
                ),
            ),
            ("end_event", lambda s: s.end_event("e", "o")),
            ("self_check_in", lambda s: s.self_check_in("e", "u", "o")),
            ("delete_event", lambda s: s.delete_event("e", "o")),
        ]
        for name, call in svc_calls:
            db = _mock_db(_one(None))
            await call(EventService(db))
            assert self._locked(
                db.execute.await_args.args[0]
            ), f"{name} does not lock the event row"


class TestBulkPathsHoldTheRowsToo:
    """PR #1798 review, P1: the single-event fetches took the lock and the
    series paths did not, so a bulk delete/cancel/retime could still pass its
    finalized check and then act after finalization committed."""

    def _locked(self, statement) -> bool:
        return (
            "for update"
            in str(statement.compile(compile_kwargs={"literal_binds": True})).lower()
        )

    async def test_series_delete_locks_every_occurrence(self):
        db = _mock_db(_all([]))
        await EventService(db).delete_event_series("parent-1", "org-1")
        assert self._locked(db.execute.await_args.args[0])

    async def test_series_cancel_locks_every_occurrence(self):
        db = _mock_db(_all([]))
        await EventService(db).cancel_series("parent-1", "org-1", "weather")
        assert self._locked(db.execute.await_args.args[0])


class TestCreditRunsInsideTheLock:
    """PR #1798 review, P1: committing the close before crediting released the
    row lock while the credit loop was still running off a captured roster, so
    a reopen could land mid-loop and the stale writes would overwrite the
    correction. One commit now covers both."""

    async def test_finalize_commits_once_after_crediting(self):
        event = _event(finalized=False, event_type=None)
        rsvp = SimpleNamespace(
            id="rsvp-1",
            user_id="user-1",
            checked_in=True,
            checked_in_at=event.start_datetime,
            checked_out_at=event.end_datetime,
            override_duration_minutes=None,
            override_check_in_at=None,
            override_check_out_at=None,
            attendance_duration_minutes=60,
            early_check_in_minutes=None,
        )
        db = _mock_db(_one(event), _all([rsvp]))
        svc = EventService(db)

        commits_when_credited = []
        with patch("app.services.event_service.AdminHoursService") as ahs_cls, patch(
            "app.services.event_service.NotificationsService"
        ) as notif_cls:

            async def _credit(**_kwargs):
                # The close must already be staged, and nothing committed yet:
                # that is what keeps the row lock held across the credit.
                commits_when_credited.append(db.commit.await_count)
                return 1

            ahs_cls.return_value.credit_event_attendance = AsyncMock(
                side_effect=_credit
            )
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        assert commits_when_credited == [0], (
            "crediting ran after a commit, so the event row lock was already "
            "released while stale credit writes were still landing"
        )
        assert event.attendance_finalized_at is not None


class TestNewQueriesAreOrgScoped:
    """Pitfall #14: every by-id read filters organization_id, including the
    ones whose id came from a row that was already scoped."""

    def _compiled(self, statement):
        return str(statement.compile(compile_kwargs={"literal_binds": True})).lower()

    async def test_the_lock_precheck_scopes_its_event_fetch(self):
        db = _mock_db(_one(None))
        await EventService(db).attendance_lock_error_for(
            "event-1", "org-1", "adding attendees"
        )
        assert "organization_id" in self._compiled(db.execute.await_args.args[0])

    async def test_reopen_scopes_its_event_fetch(self):
        db = _mock_db(_one(None))
        await EventService(db).reopen_event_attendance("event-1", "org-1")
        assert "organization_id" in self._compiled(db.execute.await_args.args[0])

    async def test_the_name_lookup_is_org_scoped(self):
        """The id is not client-supplied, but a bare by-id read on users is the
        exact shape the 2026-07 audit kept finding.

        Asserted against the helper rather than a window of characters after the
        call site: the finalizer's name and the organizer's are resolved
        together now, and a source slice would only ever cover one of them.
        """
        db = AsyncMock()
        db.execute.return_value = _all([])

        await _resolve_display_names(db, {"user-1", "user-2"}, "org-1")

        compiled = str(
            db.execute.await_args.args[0].compile(
                compile_kwargs={"literal_binds": True}
            )
        )
        assert "organization_id" in compiled
        # One round trip for both ids, which is the reason the helper batches.
        assert db.execute.await_count == 1

    async def test_an_empty_id_set_queries_nothing(self):
        """An event with no finalizer and no organizer to resolve must not cost
        a query for the privilege of resolving nothing."""
        db = AsyncMock()

        assert await _resolve_display_names(db, set(), "org-1") == {}
        db.execute.assert_not_awaited()


class TestReopenPermissionIsSeparate:
    def test_permission_exists_in_the_catalog(self):
        names = {p.name for p in ALL_PERMISSIONS}
        assert "events.reopen_attendance" in names

    def test_leadership_ranks_get_it_and_the_rest_do_not(self):
        """The point of the split: nine default roles hold events.manage, and
        the organizer who closed the event must not be able to reopen it."""
        for rank in ("fire_chief", "deputy_chief", "assistant_chief"):
            granted = OPERATIONAL_RANKS[rank]["default_permissions"]
            assert "events.reopen_attendance" in granted
            assert "events.manage" in granted

    def test_event_managing_officers_do_not_get_it(self):
        from app.core.permissions import DEFAULT_ROLES

        for role in ("public_outreach", "communications_officer", "secretary"):
            granted = DEFAULT_ROLES[role]["permissions"]
            assert "events.manage" in granted, role
            assert "events.reopen_attendance" not in granted, role
