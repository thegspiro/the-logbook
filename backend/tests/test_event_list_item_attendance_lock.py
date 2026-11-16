"""The event list reports each event's attendance lock.

A series edit says which earlier occurrence has finalized attendance (the
approved Review step: "<date>, before it, has finalized attendance."), and
reads that from the list rather than fetching every occurrence. The list
item left the lock out, so the sentence could never be drawn.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.v1.endpoints.events import _to_list_item

pytestmark = [pytest.mark.unit]


def _row(finalized_at):
    start = datetime(2026, 11, 5, 19, 0, tzinfo=timezone.utc)
    event = SimpleNamespace(
        id=uuid4(),
        title="Company Drill",
        description=None,
        event_type="training",
        custom_category=None,
        start_datetime=start,
        end_datetime=start.replace(hour=21),
        location_id=None,
        location=None,
        location_obj=None,
        requires_rsvp=False,
        is_mandatory=False,
        mandatory_membership_types=None,
        is_draft=False,
        is_cancelled=False,
        postponed_from_start=None,
        is_recurring=False,
        recurrence_parent_id=uuid4(),
        attendance_finalized_at=finalized_at,
        allowed_rsvp_statuses=None,
        rsvp_deadline=None,
        max_attendees=None,
    )
    return {
        "event": event,
        "rsvp_count": 0,
        "going_count": 0,
        "user_rsvp_status": None,
        "check_in_opens_at": None,
        "check_in_closes_at": None,
        "user_attended": False,
        "credited_hours": None,
        "hour_category_label": None,
    }


def test_a_finalized_event_reports_when():
    finalized = datetime(2026, 11, 5, 22, 0, tzinfo=timezone.utc)

    item = _to_list_item(_row(finalized))

    assert item.attendance_finalized_at == finalized


def test_an_open_event_reports_none():
    assert _to_list_item(_row(None)).attendance_finalized_at is None
