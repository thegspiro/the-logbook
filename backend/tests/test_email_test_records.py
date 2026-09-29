"""A test email uses the department's own next event or shift.

Each builder mirrors the sender that sends the notice for real; these check
the record chosen, the values and their formats, and that another
department's records are never used.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.models.event import Event, RecurrencePattern
from app.models.training import BasicApparatus, Shift, ShiftStatus
from app.models.user import Organization
from app.services.email_test_records import (
    REAL_RECORD_TEMPLATE_TYPES,
    real_record_context,
)

pytestmark = pytest.mark.integration

LIVE = "https://logbook.station12.org"
# 18:00 UTC on 28 September 2026: 11:00 in California.
NOW = datetime(2026, 9, 28, 18, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _live_frontend():
    with patch("app.services.email_test_records.settings.FRONTEND_URL", LIVE):
        yield


async def _org(db, **overrides):
    org = Organization(
        name=overrides.pop("name", "Station 12"),
        slug=f"station-{uuid.uuid4().hex[:10]}",
        organization_type="fire_department",
        timezone=overrides.pop("timezone", "America/Los_Angeles"),
        **overrides,
    )
    db.add(org)
    await db.flush()
    return org


def _event(org, start, **overrides):
    values = dict(
        organization_id=org.id,
        title="Pump Ops Drill",
        event_type="training",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        location="Station 12 Apparatus Bay",
        location_details="Enter by the side door",
        is_cancelled=False,
        is_draft=False,
    )
    values.update(overrides)
    return Event(**values)


def _shift(org, start, **overrides):
    values = dict(
        organization_id=org.id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=12),
    )
    values.update(overrides)
    return Shift(**values)


class TestEventReminder:
    async def test_uses_the_next_upcoming_event_as_the_real_sender_formats_it(
        self, db_session
    ):
        org = await _org(db_session)
        later = _event(org, NOW + timedelta(days=5), title="Later Meeting")
        # 02:00 UTC on the 1st is still the 30th in California.
        soonest = _event(org, datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc))
        db_session.add_all([later, soonest])
        await db_session.flush()

        context = await real_record_context(db_session, "event_reminder", org, NOW)

        assert context["event_title"] == "Pump Ops Drill"
        assert context["event_type"] == "Training"
        assert context["event_start"] == "September 30, 2026 at 07:00 PM"
        assert context["event_end"] == "09:00 PM"
        assert (context["event_month"], context["event_day"]) == ("Sep", "30")
        assert context["location_name"] == "Station 12 Apparatus Bay"
        assert context["location_details"] == "Enter by the side door"
        assert context["event_url"] == f"{LIVE}/events/{soonest.id}"

    async def test_skips_past_cancelled_and_draft_events(self, db_session):
        org = await _org(db_session)
        db_session.add_all(
            [
                _event(org, NOW - timedelta(days=1), title="Past"),
                _event(
                    org, NOW + timedelta(days=1), title="Cancelled", is_cancelled=True
                ),
                _event(org, NOW + timedelta(days=2), title="Draft", is_draft=True),
                _event(org, NOW + timedelta(days=3), title="The one"),
            ]
        )
        await db_session.flush()

        context = await real_record_context(db_session, "event_reminder", org, NOW)
        assert context["event_title"] == "The one"

    async def test_never_uses_another_departments_event(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session, name="Another Department")
        db_session.add(_event(other, NOW + timedelta(days=1), title="Not ours"))
        await db_session.flush()

        assert await real_record_context(db_session, "event_reminder", org, NOW) == {}

    async def test_nothing_upcoming_leaves_the_samples(self, db_session):
        org = await _org(db_session)
        assert await real_record_context(db_session, "event_reminder", org, NOW) == {}


class TestSeriesEndReminder:
    async def test_uses_the_next_series_to_end_and_counts_what_is_left(
        self, db_session
    ):
        org = await _org(db_session)
        series = _event(
            org,
            NOW - timedelta(days=30),
            title="Weekly Officers Meeting",
            is_recurring=True,
            recurrence_pattern=RecurrencePattern.WEEKLY,
            recurrence_end_date=datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc),
        )
        db_session.add(series)
        await db_session.flush()
        db_session.add_all(
            [
                _event(org, NOW + timedelta(days=7), recurrence_parent_id=series.id),
                _event(org, NOW + timedelta(days=14), recurrence_parent_id=series.id),
                _event(
                    org,
                    NOW + timedelta(days=21),
                    recurrence_parent_id=series.id,
                    is_cancelled=True,
                ),
                _event(org, NOW - timedelta(days=7), recurrence_parent_id=series.id),
            ]
        )
        await db_session.flush()

        context = await real_record_context(db_session, "series_end_reminder", org, NOW)

        assert context["event_title"] == "Weekly Officers Meeting"
        assert context["recurrence_pattern"] == "Weekly"
        assert context["series_end_date"] == "October 20, 2026"
        # Two upcoming, not cancelled; the parent itself is in the past.
        assert context["remaining_occurrences"] == "2"
        assert context["event_url"] == f"{LIVE}/events/{series.id}"


class TestShiftNotices:
    async def _setup(self, db_session):
        org = await _org(db_session)
        apparatus = BasicApparatus(
            organization_id=org.id, unit_number="E12", name="Engine 12"
        )
        db_session.add(apparatus)
        await db_session.flush()
        # 14:00 UTC on 1 October: 07:00 in California.
        start = datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc)
        cancelled = _shift(org, NOW + timedelta(hours=3), status=ShiftStatus.CANCELLED)
        shift = _shift(org, start, apparatus_id=apparatus.id)
        db_session.add_all([cancelled, shift])
        await db_session.flush()
        return org, shift

    async def test_a_shift_reminder_uses_the_next_scheduled_shift(self, db_session):
        org, shift = await self._setup(db_session)

        context = await real_record_context(db_session, "shift_reminder", org, NOW)

        assert context["shift_date"] == "Oct 01, 2026"
        assert context["shift_start"] == "07:00"
        assert context["time_range"] == "07:00 – 19:00"
        assert context["apparatus_name"] == "E12 — Engine 12"
        assert context["apparatus_html"] == (
            "<p><strong>Apparatus:</strong> E12 — Engine 12</p>"
        )
        assert context["apparatus_text"] == "Apparatus: E12 — Engine 12"
        assert context["arrival_url"] == f"{LIVE}/scheduling/checkin?shift={shift.id}"

    async def test_an_assignment_prints_the_iso_date_like_the_real_one(
        self, db_session
    ):
        org, shift = await self._setup(db_session)

        context = await real_record_context(db_session, "shift_assignment", org, NOW)

        assert context["shift_date"] == "2026-10-01"
        assert context["shift_start"] == "07:00"
        assert context["shift_url"] == f"{LIVE}/scheduling?shift={shift.id}"

    async def test_a_decline_uses_the_same_shift(self, db_session):
        org, shift = await self._setup(db_session)

        context = await real_record_context(db_session, "shift_decline", org, NOW)

        assert context == {
            "shift_date": "2026-10-01",
            "shift_url": f"{LIVE}/scheduling?shift={shift.id}",
        }

    async def test_another_departments_apparatus_is_not_named(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session, name="Another Department")
        theirs = BasicApparatus(
            organization_id=other.id, unit_number="T1", name="Truck"
        )
        db_session.add(theirs)
        await db_session.flush()
        db_session.add(_shift(org, NOW + timedelta(days=1), apparatus_id=theirs.id))
        await db_session.flush()

        context = await real_record_context(db_session, "shift_reminder", org, NOW)
        assert context["apparatus_name"] == ""
        assert context["apparatus_html"] == ""


async def test_a_type_without_a_real_record_builder_is_left_alone(db_session):
    org = await _org(db_session)
    assert "welcome" not in REAL_RECORD_TEMPLATE_TYPES
    assert await real_record_context(db_session, "welcome", org, NOW) == {}
    assert await real_record_context(db_session, "event_reminder", None, NOW) == {}
