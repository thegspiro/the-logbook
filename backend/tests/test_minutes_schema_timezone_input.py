"""Minutes and interview request times reach the model in UTC.

These times live in MySQL DATETIME columns (or, for closed-session
participants, in a JSON column), and the driver formats an aware datetime by
its wall clock, dropping the offset: a call to order sent as ``19:00-04:00``
was written as 19:00, read back as 19:00 UTC and shown four hours early. A
naive value meeting an aware one in a schema comparison raised ``TypeError``,
which Pydantic does not turn into a 422, so a mixed pair was a 500.

Action-item ``due_date`` is deliberately not converted: the screen sends a
calendar date (``<input type="date">``) and shows it with
``formatCalendarDate``, so it is a date carried in a DATETIME column, and
converting an offset would move it to another day.
"""

from datetime import datetime, timedelta, timezone

import pymysql.converters
import pytest
from pydantic import ValidationError

from app.schemas.membership_pipeline import InterviewCreate, InterviewUpdate
from app.schemas.minute import (
    ActionItemCreate,
    ClosedSessionCreate,
    ClosedSessionParticipant,
    ClosedSessionUpdate,
    MinutesAdopt,
    MinutesCreate,
    MinutesUpdate,
)

pytestmark = [pytest.mark.unit]

EDT = timezone(timedelta(hours=-4))


def _stored(value: datetime | None) -> str:
    """What pymysql actually writes into the DATETIME column."""
    assert value is not None
    return pymysql.converters.escape_item(value, "utf8")


class TestMinutes:
    def test_create_offset_times_are_stored_as_the_utc_instant(self):
        data = MinutesCreate(
            title="October business meeting",
            meeting_date="2026-10-07T19:00:00-04:00",
            called_to_order_at="2026-10-07T19:02:00-04:00",
            adjourned_at="2026-10-07T21:15:00-04:00",
        )

        assert data.meeting_date.utcoffset() == timedelta(0)
        assert _stored(data.meeting_date) == "'2026-10-07 23:00:00'"
        assert _stored(data.called_to_order_at) == "'2026-10-07 23:02:00'"
        assert _stored(data.adjourned_at) == "'2026-10-08 01:15:00'"

    def test_update_offset_times_are_stored_as_the_utc_instant(self):
        data = MinutesUpdate(
            meeting_date="2026-10-07T19:00:00-04:00",
            called_to_order_at="2026-10-07T19:02:00-04:00",
            adjourned_at="2026-10-07T21:15:00-04:00",
        )

        assert _stored(data.meeting_date) == "'2026-10-07 23:00:00'"
        assert _stored(data.called_to_order_at) == "'2026-10-07 23:02:00'"
        assert _stored(data.adjourned_at) == "'2026-10-08 01:15:00'"

    def test_utc_and_naive_input_is_unchanged(self):
        data = MinutesUpdate(
            called_to_order_at="2026-10-07T23:02:00Z",
            adjourned_at="2026-10-08T01:15:00",
        )

        assert data.adjourned_at is not None
        assert data.adjourned_at.tzinfo is not None
        assert _stored(data.called_to_order_at) == "'2026-10-07 23:02:00'"
        assert _stored(data.adjourned_at) == "'2026-10-08 01:15:00'"

    def test_adopted_on_offset_is_stored_as_the_utc_instant(self):
        data = MinutesAdopt(adopted_on="2026-11-04T19:30:00-04:00")

        assert _stored(data.adopted_on) == "'2026-11-04 23:30:00'"


class TestActionItemDueDate:
    def test_calendar_date_is_kept_as_the_date_sent(self):
        data = ActionItemCreate(description="Order hose", due_date="2026-10-20")

        assert _stored(data.due_date) == "'2026-10-20 00:00:00'"


class TestClosedSession:
    def test_create_offset_times_are_stored_as_the_utc_instant(self):
        data = ClosedSessionCreate(
            reason="Personnel",
            started_at="2026-10-07T20:00:00-04:00",
            ended_at="2026-10-07T20:30:00-04:00",
            participants=[
                {
                    "name": "A. Member",
                    "joined_at": "2026-10-07T20:00:00-04:00",
                    "left_at": "2026-10-07T20:20:00-04:00",
                }
            ],
        )

        assert _stored(data.started_at) == "'2026-10-08 00:00:00'"
        assert _stored(data.ended_at) == "'2026-10-08 00:30:00'"
        assert data.participants is not None
        # Participants are stored as JSON, rendered from model_dump(mode="json").
        person = data.participants[0].model_dump(mode="json")
        assert person["joined_at"] == "2026-10-08T00:00:00Z"
        assert person["left_at"] == "2026-10-08T00:20:00Z"

    def test_update_offset_times_are_stored_as_the_utc_instant(self):
        data = ClosedSessionUpdate(
            started_at="2026-10-07T20:00:00-04:00",
            ended_at="2026-10-07T20:30:00-04:00",
        )

        assert _stored(data.started_at) == "'2026-10-08 00:00:00'"
        assert _stored(data.ended_at) == "'2026-10-08 00:30:00'"

    def test_mixed_pair_in_order_is_accepted(self):
        # 00:00 UTC naive vs 20:30-04:00 (00:30 UTC): ends after it starts.
        data = ClosedSessionCreate(
            reason="Personnel",
            started_at="2026-10-08T00:00:00",
            ended_at=datetime(2026, 10, 7, 20, 30, tzinfo=EDT),
        )

        assert _stored(data.ended_at) == "'2026-10-08 00:30:00'"

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        # 00:30 UTC naive vs 20:00-04:00 (00:00 UTC): ends before it starts.
        with pytest.raises(ValidationError, match="cannot end before it starts"):
            ClosedSessionCreate(
                reason="Personnel",
                started_at="2026-10-08T00:30:00",
                ended_at="2026-10-07T20:00:00-04:00",
            )

    def test_participant_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="left before they joined"):
            ClosedSessionParticipant(
                name="A. Member",
                joined_at="2026-10-08T00:30:00",
                left_at="2026-10-07T20:00:00-04:00",
            )


class TestInterview:
    def test_create_offset_is_stored_as_the_utc_instant(self):
        data = InterviewCreate(interview_date="2026-10-07T18:00:00-04:00")

        assert _stored(data.interview_date) == "'2026-10-07 22:00:00'"

    def test_update_offset_is_stored_as_the_utc_instant(self):
        data = InterviewUpdate(interview_date="2026-10-07T18:00:00-04:00")

        assert _stored(data.interview_date) == "'2026-10-07 22:00:00'"
