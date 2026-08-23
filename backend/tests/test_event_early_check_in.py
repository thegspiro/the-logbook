"""
Early check-in: what it records, and what it must not credit.

A member can tap their ID card (or scan the QR) inside the check-in window but
well before the event itself starts — most departments open check-in an hour
ahead of a 19:00 drill. Two separate things follow from that, and they are
deliberately independent:

* the tap time stays the honest record of when the member arrived, and how far
  ahead of the start it landed is recorded so the event's manager can see it;
* the *credited* time starts at the scheduled start regardless, because the
  member was not being trained in the parking lot, and crediting them there
  inflates training hours, admin hours and every compliance report built on
  them.

Pure logic; no DB.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.event_service import EventService

START = datetime(2026, 6, 1, 19, 0, tzinfo=tz.utc)
END = datetime(2026, 6, 1, 21, 0, tzinfo=tz.utc)


def _event(start=START, end=END):
    return SimpleNamespace(start_datetime=start, end_datetime=end)


def _rsvp(checked_in_at=None, override_check_in_at=None):
    return SimpleNamespace(
        checked_in_at=checked_in_at,
        override_check_in_at=override_check_in_at,
    )


def _svc():
    return EventService(MagicMock())


class TestMinutesBeforeStart:
    def test_a_tap_inside_the_window_but_before_the_start_is_recorded(self):
        """Check-in opens an hour early; the drill still starts at 19:00."""
        tapped = START - timedelta(minutes=42)
        assert EventService._minutes_before_start(_event(), tapped) == 42

    def test_a_tap_at_the_start_is_not_early(self):
        assert EventService._minutes_before_start(_event(), START) is None

    def test_a_late_tap_is_not_early(self):
        assert (
            EventService._minutes_before_start(_event(), START + timedelta(minutes=15))
            is None
        )

    def test_the_boundary_minute_is_not_reported_as_zero(self):
        """A stored 0 and an absent value would be indistinguishable in every
        query that filters on the column."""
        just_before = START - timedelta(seconds=30)
        assert EventService._minutes_before_start(_event(), just_before) is None

    def test_a_naive_start_time_is_read_as_utc(self):
        """MySQL DATETIME comes back naive; subtracting it would raise."""
        event = _event(start=START.replace(tzinfo=None))
        assert (
            EventService._minutes_before_start(event, START - timedelta(minutes=30))
            == 30
        )

    def test_an_event_with_no_start_records_nothing(self):
        assert EventService._minutes_before_start(_event(start=None), START) is None


class TestCreditedCheckInTime:
    def test_an_early_tap_is_credited_from_the_scheduled_start(self):
        """The whole point: forty minutes in the parking lot is not training."""
        rsvp = _rsvp(checked_in_at=START - timedelta(minutes=40))
        assert EventService._credited_check_in_time(_event(), rsvp) == START

    def test_an_on_time_arrival_is_unchanged(self):
        rsvp = _rsvp(checked_in_at=START)
        assert EventService._credited_check_in_time(_event(), rsvp) == START

    def test_a_late_arrival_is_not_clamped_backwards(self):
        """Arriving late really does mean less time — that must survive."""
        late = START + timedelta(minutes=25)
        rsvp = _rsvp(checked_in_at=late)
        assert EventService._credited_check_in_time(_event(), rsvp) == late

    def test_a_manager_override_is_honoured_verbatim(self):
        """The escape hatch for the case the clamp gets wrong.

        Volunteers who genuinely were setting up an hour before the doors
        opened get credited for it, because an officer said so — a deliberate
        act by somebody accountable for it, which a tap is not.
        """
        early = START - timedelta(minutes=60)
        rsvp = _rsvp(
            checked_in_at=START - timedelta(minutes=5), override_check_in_at=early
        )
        assert EventService._credited_check_in_time(_event(), rsvp) == early

    def test_an_override_wins_even_when_it_is_earlier_than_the_tap(self):
        override = START - timedelta(hours=2)
        rsvp = _rsvp(checked_in_at=START, override_check_in_at=override)
        assert EventService._credited_check_in_time(_event(), rsvp) == override

    def test_naive_stored_timestamps_are_read_as_utc(self):
        rsvp = _rsvp(checked_in_at=(START - timedelta(minutes=40)).replace(tzinfo=None))
        event = _event(start=START.replace(tzinfo=None))
        assert EventService._credited_check_in_time(event, rsvp) == START

    def test_a_member_who_never_checked_in_has_no_credited_time(self):
        assert EventService._credited_check_in_time(_event(), _rsvp()) is None

    def test_an_event_with_no_start_falls_back_to_the_tap(self):
        """Nothing to clamp against; refusing to credit at all would be worse."""
        tapped = START - timedelta(minutes=40)
        rsvp = _rsvp(checked_in_at=tapped)
        assert EventService._credited_check_in_time(_event(start=None), rsvp) == tapped


class TestCreditedDurationEffect:
    """The arithmetic the clamp exists to protect, stated end to end."""

    def test_an_early_tapper_is_credited_the_events_length_not_their_own(self):
        rsvp = _rsvp(checked_in_at=START - timedelta(minutes=45))
        credited = EventService._credited_check_in_time(_event(), rsvp)
        minutes = (END - credited).total_seconds() / 60
        # Two hours, not two hours forty-five.
        assert minutes == 120

    def test_a_late_arrival_still_loses_the_time_they_missed(self):
        rsvp = _rsvp(checked_in_at=START + timedelta(minutes=30))
        credited = EventService._credited_check_in_time(_event(), rsvp)
        minutes = (END - credited).total_seconds() / 60
        assert minutes == 90


class TestWarningThreshold:
    def test_the_threshold_is_above_zero(self):
        """Warning on every tap that beats the start by a minute would bury the
        one that matters under a page of "2 minutes early"."""
        assert EventService.EARLY_CHECK_IN_WARNING_MINUTES > 0
