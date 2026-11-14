"""
Shift notices print a date a member reads, not an ISO string.

The assignment notice told a member they were on "the 2026-09-30 shift"
(workflow review W46-16), and the cancellation, decline, swap, confirmation
and time-off notices built their dates the same way. Each now reads
``Sep 30, 2026``, the form the scheduled reminders already use.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training import TimeOffStatus
from app.services.scheduling_service import SchedulingService, _notice_date

pytestmark = pytest.mark.unit


def _result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _service(*rows) -> SchedulingService:
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_result(r) for r in rows])
    service = SchedulingService(db)
    service._send_notification = AsyncMock()
    service._member_display_name = AsyncMock(return_value="Pat Doe")
    return service


class TestNoticeDate:
    def test_a_date_reads_as_month_day_year(self):
        assert _notice_date(date(2026, 9, 30), "unknown") == "Sep 30, 2026"

    def test_a_missing_date_reads_as_the_fallback(self):
        assert _notice_date(None, "unknown date") == "unknown date"


class TestAssignmentNotice:
    async def test_the_body_and_email_name_the_day_not_an_iso_string(self):
        org = SimpleNamespace(id="org-1", settings={}, timezone="America/Chicago")
        shift = SimpleNamespace(
            id="shift-1",
            shift_date=date(2026, 9, 30),
            start_time=datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc),
            apparatus_id=None,
            template_id=None,
        )
        # The third read is the department's Position Names, which name a
        # custom seat in the body (SCHED-CUSTOM-SEAT); none saved here.
        service = _service(org, shift, None)

        await service._notify_shift_assignment(
            "shift-1", "user-1", "firefighter", "org-1"
        )

        kwargs = service._send_notification.await_args.kwargs
        assert kwargs["message"] == (
            "You have been assigned to the Firefighter position "
            "on the Sep 30, 2026 shift (starts 07:00)."
        )
        assert kwargs["email_context"]["shift_date"] == "Sep 30, 2026"


class TestTimeOffNotice:
    async def test_the_range_names_both_days(self):
        service = _service()
        time_off = SimpleNamespace(
            user_id="user-1",
            start_date=date(2026, 10, 3),
            end_date=date(2026, 10, 5),
        )

        await service._notify_time_off_reviewed(
            time_off, "org-1", TimeOffStatus.APPROVED
        )

        assert service._send_notification.await_args.kwargs["message"] == (
            "Your time-off request for Oct 03, 2026 to Oct 05, 2026 "
            "has been approved."
        )
