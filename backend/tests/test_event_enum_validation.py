"""
EV2-1 (app-review B17 pass 3): event_type / check_in_window_type /
recurrence_pattern / RSVP status on the event request schemas map to strict
MySQL ENUM columns but were typed as free str and inserted raw (create_event's
Event(**dict), update setattr loops, RSVP/template creates) — an out-of-set
value 500'd at MySQL. Request schemas now validate them (the B1 latent-500
class). DB-free.
"""

from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.event import (
    EventCreate,
    EventTemplateCreate,
    EventUpdate,
    ManagerAddAttendee,
    RecurringEventCreate,
    RSVPCreate,
)

_START = datetime(2026, 8, 9, 10)
_END = datetime(2026, 8, 9, 12)


def _event(**kw):
    base = dict(
        title="T", event_type="training", start_datetime=_START, end_datetime=_END
    )
    base.update(kw)
    return EventCreate(**base)


class TestEventEnumValidation:
    def test_create_accepts_valid_and_normalizes_case(self):
        assert _event(event_type="TRAINING").event_type == "training"

    def test_create_rejects_bad_event_type(self):
        with pytest.raises(ValidationError):
            _event(event_type="not_a_type")

    def test_create_rejects_bad_checkin_window(self):
        with pytest.raises(ValidationError):
            _event(check_in_window_type="whenever")

    def test_update_rejects_bad_event_type(self):
        with pytest.raises(ValidationError):
            EventUpdate(event_type="nope")

    def test_update_allows_omitted(self):
        assert EventUpdate(title="x").event_type is None

    @pytest.mark.parametrize(
        "field", ["check_in_minutes_before", "check_in_minutes_after"]
    )
    def test_event_rejects_negative_check_in_windows(self, field):
        with pytest.raises(ValidationError):
            _event(**{field: -1})

    @pytest.mark.parametrize(
        "field", ["check_in_minutes_before", "check_in_minutes_after"]
    )
    def test_update_rejects_negative_check_in_windows(self, field):
        with pytest.raises(ValidationError):
            EventUpdate(**{field: -1})

    def test_template_rejects_bad_type(self):
        with pytest.raises(ValidationError):
            EventTemplateCreate(name="X", event_type="bogus")

    def test_recurring_rejects_bad_pattern(self):
        with pytest.raises(ValidationError):
            RecurringEventCreate(
                title="T",
                event_type="training",
                recurrence_pattern="fortnightly",
                start_datetime=_START,
                end_datetime=_END,
            )

    def test_recurring_preserves_reminder_and_guest_check_in_options(self):
        event = RecurringEventCreate(
            title="T",
            event_type="training",
            recurrence_pattern="weekly",
            rolling_recurrence=True,
            start_datetime=_START,
            end_datetime=_END,
            reminder_target="all",
            allow_guest_check_in=True,
            guest_check_in_creates_prospect=True,
        )

        assert event.reminder_target == "all"
        assert event.allow_guest_check_in is True
        assert event.guest_check_in_creates_prospect is True


class TestRsvpStatusValidation:
    def test_rsvp_accepts_valid_incl_waitlisted(self):
        assert RSVPCreate(status="waitlisted").status == "waitlisted"

    def test_rsvp_rejects_unknown(self):
        with pytest.raises(ValidationError):
            RSVPCreate(status="perhaps")

    def test_manager_add_attendee_rejects_bad_status(self):
        with pytest.raises(ValidationError):
            ManagerAddAttendee(user_id="u1", status="weird")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
