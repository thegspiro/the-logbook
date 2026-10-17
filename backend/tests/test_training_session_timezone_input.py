"""Training session times reach the model in UTC, whatever offset was sent.

The Event row behind a session stores its times in MySQL DATETIME columns,
and the driver formats an aware datetime by its wall clock, dropping the
offset. A start sent as ``18:00-04:00`` was therefore written as 18:00, read
back as 18:00 UTC, and shown four hours early. The schema converts on the way
in so the service never hands the driver anything but UTC.
"""

from datetime import datetime, timedelta, timezone

import pymysql.converters
import pytest

from app.schemas.training_session import (
    RecurringTrainingSessionCreate,
    TrainingSessionCreate,
)

pytestmark = [pytest.mark.unit]

EDT = timezone(timedelta(hours=-4))

BASE = {
    "title": "Pump ops",
    "course_name": "Pump ops",
    "training_type": "skills_practice",
    "credit_hours": 2,
}


def _stored(value: datetime) -> str:
    """What pymysql actually writes into the DATETIME column."""
    return pymysql.converters.escape_item(value, "utf8")


def test_offset_start_and_end_are_stored_as_the_utc_instant():
    data = TrainingSessionCreate(
        **BASE,
        start_datetime="2026-10-17T18:00:00-04:00",
        end_datetime="2026-10-17T20:00:00-04:00",
        rsvp_deadline="2026-10-16T18:00:00-04:00",
    )

    assert data.start_datetime == datetime(2026, 10, 17, 22, 0, tzinfo=timezone.utc)
    assert data.start_datetime.utcoffset() == timedelta(0)
    assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
    assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"
    assert data.rsvp_deadline is not None
    assert _stored(data.rsvp_deadline) == "'2026-10-16 22:00:00'"


def test_utc_input_is_unchanged():
    data = TrainingSessionCreate(
        **BASE,
        start_datetime="2026-10-17T22:00:00Z",
        end_datetime="2026-10-18T00:00:00Z",
    )

    assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
    assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"


def test_naive_input_is_read_as_utc_and_comparable_with_aware():
    # Mixing naive and aware made the service's end > start check raise
    # TypeError (a 500); both now arrive aware in UTC.
    data = TrainingSessionCreate(
        **BASE,
        start_datetime="2026-10-17T22:00:00",
        end_datetime=datetime(2026, 10, 17, 20, 0, tzinfo=EDT),
    )

    assert data.start_datetime.tzinfo is not None
    assert data.end_datetime > data.start_datetime
    assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
    assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"


def test_recurring_end_date_is_converted():
    data = RecurringTrainingSessionCreate(
        **BASE,
        start_datetime="2026-10-17T18:00:00-04:00",
        end_datetime="2026-10-17T20:00:00-04:00",
        recurrence_pattern="weekly",
        recurrence_end_date="2026-12-31T23:59:00-05:00",
    )

    assert _stored(data.recurrence_end_date) == "'2027-01-01 04:59:00'"
    assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
