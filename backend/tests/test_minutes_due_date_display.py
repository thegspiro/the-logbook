"""A minutes action item's due date is shown as the calendar day stored.

The screen sends a date (``<input type="date">``) and the column keeps it at
UTC midnight. Converting that midnight to the department's zone put it on the
evening before west of Greenwich, so a department in New York saw an item due
on 5 November printed and emailed as due on 4 November, while the screen
(``formatCalendarDate``) showed the 5th. Real instants (meeting times) are
still converted; only the due date is read as stored.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import minutes_notifications, minutes_print_data
from app.services.document_service import DocumentService
from app.utils.org_timezone import stored_calendar_day

pytestmark = [pytest.mark.unit]

NEW_YORK = "America/New_York"
DUE = datetime(2026, 11, 5)  # how MySQL hands back the stored UTC midnight


def _item(**kw):
    return SimpleNamespace(
        description="Order hose",
        assignee_id="user-1",
        assignee_name="Pat",
        due_date=kw.get("due_date", DUE),
        priority="medium",
        status="pending",
    )


def _org():
    return SimpleNamespace(timezone=NEW_YORK, settings=None)


def _minutes(items):
    return SimpleNamespace(
        id="min-1",
        organization_id="org-1",
        title="November business meeting",
        meeting_type="business",
        meeting_date=datetime(2026, 11, 4, 23, 0, tzinfo=timezone.utc),
        location=None,
        called_by=None,
        called_to_order_at=None,
        adjourned_at=None,
        attendees=[],
        attendance_listing=None,
        quorum_met=None,
        quorum_count=None,
        motions=[],
        action_items=items,
        approved_at=None,
        submitted_by=None,
        approved_by=None,
        status="draft",
        published_document_id=None,
        get_sections=lambda: [],
        get_effective_header=lambda: {"org_name": "Falls Church FD"},
        get_effective_footer=lambda: {},
    )


class TestStoredCalendarDay:
    @pytest.mark.parametrize(
        "value",
        [
            datetime(2026, 11, 5),
            datetime(2026, 11, 5, tzinfo=timezone.utc),
            datetime(2026, 11, 4, 19, 0, tzinfo=timezone(timedelta(hours=-5))),
        ],
    )
    def test_is_the_utc_day(self, value):
        assert stored_calendar_day(value) == datetime(2026, 11, 5).date()

    def test_none_is_none(self):
        assert stored_calendar_day(None) is None


class TestPublishedDocument:
    def test_due_date_is_the_stored_day(self):
        html = DocumentService(MagicMock())._generate_minutes_html(
            _minutes([_item()]), tz_name=NEW_YORK
        )

        assert "2026-11-05" in html
        assert "2026-11-04" not in html


class TestPrintedCopy:
    async def test_due_date_is_the_stored_day(self, monkeypatch):
        records = MagicMock()
        for name in (
            "list_election_results",
            "list_closed_sessions",
            "list_attachments",
            "list_revisions",
        ):
            setattr(records, name, AsyncMock(return_value=[]))
        monkeypatch.setattr(
            minutes_print_data, "MinutesRecordService", lambda db: records
        )
        result = MagicMock()
        result.scalar_one_or_none.return_value = _org()
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)

        printed = await minutes_print_data.build_print_data(
            db, _minutes([_item()]), "org-1", restricted=False
        )

        assert printed.data["action_items"][0]["due"] == "2026-11-05"
        # A real instant is still shown in the department's zone.
        assert printed.data["meeting_date_display"] == "November 04, 2026 at 06:00 PM"


class TestAssigneeEmail:
    async def test_due_date_is_the_stored_day(self, monkeypatch):
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = _org()
        member = SimpleNamespace(id="user-1", email="pat@example.org")
        member_result = MagicMock()
        member_result.scalars.return_value.all.return_value = [member]
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[org_result, member_result])

        monkeypatch.setattr(
            minutes_notifications, "recipients_for", lambda members, *a: members
        )
        monkeypatch.setattr(
            minutes_notifications, "department_required_kinds", lambda org: set()
        )
        monkeypatch.setattr(
            minutes_notifications,
            "wrap_email_body",
            lambda org, title, body, **kw: body,
        )
        send = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            minutes_notifications,
            "EmailService",
            lambda: SimpleNamespace(send_email=send),
        )

        sent = await minutes_notifications.notify_action_item_assignees(
            db, _minutes([]), [_item(due_date=DUE.replace(tzinfo=timezone.utc))]
        )

        assert sent == 1
        body = send.await_args.kwargs["html_body"]
        assert "due Nov 05, 2026" in body
        assert "Nov 04" not in body
