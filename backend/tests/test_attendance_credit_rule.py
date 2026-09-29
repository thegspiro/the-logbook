"""The credited-minutes rule shared by training credit and the hours ledger.

A member's credited time for an event is decided in one place,
``EventService.credited_minutes``, so the training record and anything else
reporting the same attendance cannot disagree. The precedence is the one the
department set: a manager's override, then the measured duration (a real
check-out or End Event), then the time derived from the credited check-in to
the event's end.

Also covers the admin-hours window fix: an entry credited with an override's
minutes must carry the override's check-out, not the original tap.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.event import EventType
from app.services.event_service import EventService

pytestmark = pytest.mark.unit

START = datetime(2026, 9, 20, 13, 0, tzinfo=timezone.utc)
END = START + timedelta(hours=4)


def _event(**overrides):
    fields = {
        "id": "event-1",
        "organization_id": "org-1",
        "title": "Hose Ops",
        "event_type": EventType.TRAINING,
        "start_datetime": START,
        "end_datetime": END,
        "actual_end_time": None,
        "custom_fields": {},
        "attendance_finalized_at": None,
        "attendance_finalized_by": None,
        "custom_category": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _rsvp(**overrides):
    fields = {
        "id": "rsvp-1",
        "user_id": "user-1",
        "checked_in": True,
        "checked_in_at": START,
        "checked_out_at": None,
        "override_check_in_at": None,
        "override_check_out_at": None,
        "override_duration_minutes": None,
        "attendance_duration_minutes": None,
        "early_check_in_minutes": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestPrecedence:
    def test_override_wins_over_everything(self):
        rsvp = _rsvp(override_duration_minutes=240, attendance_duration_minutes=30)
        assert EventService.credited_minutes(_event(), rsvp, END) == 240

    def test_an_explicit_zero_override_is_honoured(self):
        """A 0 means "no credit". Read as falsy it would fall through to the
        member's measured time and credit what a manager just took away."""
        rsvp = _rsvp(override_duration_minutes=0, attendance_duration_minutes=90)
        assert EventService.credited_minutes(_event(), rsvp, END) == 0

    def test_measured_duration_used_without_an_override(self):
        rsvp = _rsvp(attendance_duration_minutes=95)
        assert EventService.credited_minutes(_event(), rsvp, END) == 95

    def test_derived_from_check_in_to_the_effective_end(self):
        rsvp = _rsvp(checked_in_at=START + timedelta(minutes=30))
        assert EventService.credited_minutes(_event(), rsvp, END) == 210

    def test_an_actual_end_moves_the_derived_end(self):
        event = _event(actual_end_time=START + timedelta(hours=2))
        rsvp = _rsvp()
        effective_end = EventService.effective_end(event)
        assert EventService.credited_minutes(event, rsvp, effective_end) == 120

    def test_early_tap_is_clamped_to_the_scheduled_start(self):
        rsvp = _rsvp(checked_in_at=START - timedelta(minutes=40))
        assert EventService.credited_minutes(_event(), rsvp, END) == 240

    def test_override_check_in_is_honoured_verbatim(self):
        rsvp = _rsvp(override_check_in_at=START - timedelta(minutes=60))
        assert EventService.credited_minutes(_event(), rsvp, END) == 300

    def test_no_credited_check_in_means_nothing_to_credit(self):
        rsvp = _rsvp(checked_in_at=None)
        assert EventService.credited_minutes(_event(), rsvp, END) is None

    def test_naive_datetimes_from_mysql_are_treated_as_utc(self):
        naive_start = START.replace(tzinfo=None)
        rsvp = _rsvp(checked_in_at=naive_start)
        event = _event(start_datetime=naive_start)
        assert EventService.credited_minutes(event, rsvp, END.replace(tzinfo=None)) == (
            240
        )

    def test_a_derived_negative_span_credits_zero(self):
        rsvp = _rsvp(checked_in_at=END + timedelta(minutes=5))
        assert EventService.credited_minutes(_event(), rsvp, END) == 0


class TestEventHelpers:
    def test_only_training_events_credit_training(self):
        assert EventService.event_credits_training(_event()) is True
        assert (
            EventService.event_credits_training(
                _event(event_type=EventType.BUSINESS_MEETING)
            )
            is False
        )
        assert EventService.event_credits_training(_event(event_type=None)) is False

    def test_effective_end_prefers_the_recorded_actual_end(self):
        actual = START + timedelta(hours=1)
        assert EventService.effective_end(_event(actual_end_time=actual)) == actual
        assert EventService.effective_end(_event()) == END

    def test_effective_end_is_utc_aware(self):
        event = _event(end_datetime=END.replace(tzinfo=None))
        assert EventService.effective_end(event).tzinfo is not None


class TestAdminHoursWindow:
    """The entry's check-out has to agree with the minutes it credits."""

    def test_override_check_out_bounds_the_window(self):
        override_out = START + timedelta(hours=4)
        rsvp = _rsvp(
            checked_out_at=START + timedelta(hours=1),
            override_check_out_at=override_out,
        )
        assert EventService._credited_check_out_time(rsvp, START, END) == override_out

    def test_an_override_before_the_check_in_is_not_used(self):
        rsvp = _rsvp(
            checked_out_at=START + timedelta(hours=2),
            override_check_out_at=START - timedelta(hours=1),
        )
        assert EventService._credited_check_out_time(rsvp, START, END) == (
            START + timedelta(hours=2)
        )

    def test_falls_back_to_the_event_end(self):
        assert EventService._credited_check_out_time(_rsvp(), START, END) == END

    async def test_finalize_credits_the_override_window(self):
        """End to end through finalize, on an event that still credits admin
        hours: the override check-out reaches credit_event_attendance."""
        event = _event(
            event_type=EventType.BUSINESS_MEETING,
            actual_end_time=END,
            is_cancelled=False,
        )
        override_out = START + timedelta(hours=3)
        rsvp = _rsvp(
            checked_out_at=START + timedelta(hours=1),
            override_check_out_at=override_out,
            override_duration_minutes=180,
        )

        def _one(value):
            result = MagicMock()
            result.scalar_one_or_none.return_value = value
            return result

        def _all(items):
            result = MagicMock()
            result.scalars.return_value.all.return_value = items
            return result

        db = MagicMock()
        # The event lock, then the one locking roster read.
        db.execute = AsyncMock(side_effect=[_one(event), _all([rsvp])])
        db.commit = AsyncMock()
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls, patch(
            "app.services.event_service.NotificationsService"
        ) as notif_cls:
            credit = AsyncMock(return_value=1)
            ahs_cls.return_value.credit_event_attendance = credit
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            svc._advance_prospects_after_finalize = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        credit.assert_awaited_once()
        kwargs = credit.await_args.kwargs
        assert kwargs["check_out_at"] == override_out
        assert kwargs["duration_minutes"] == 180

    async def test_an_explicit_zero_override_credits_no_admin_hours(self):
        """The same rule as training credit: 0 is "no credit", not a missing
        value to fall through to the measured minutes."""
        event = _event(
            event_type=EventType.BUSINESS_MEETING,
            actual_end_time=END,
            is_cancelled=False,
        )
        rsvp = _rsvp(
            checked_out_at=START + timedelta(minutes=90),
            override_duration_minutes=0,
            attendance_duration_minutes=90,
        )

        def _one(value):
            result = MagicMock()
            result.scalar_one_or_none.return_value = value
            return result

        def _all(items):
            result = MagicMock()
            result.scalars.return_value.all.return_value = items
            return result

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(event), _all([rsvp])])
        db.commit = AsyncMock()
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls, patch(
            "app.services.event_service.NotificationsService"
        ) as notif_cls:
            credit = AsyncMock(return_value=1)
            ahs_cls.return_value.credit_event_attendance = credit
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            svc._advance_prospects_after_finalize = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        credit.assert_not_awaited()
