"""
Times in outbound emails are the department's wall-clock time, not UTC.

Every timestamp is stored as UTC. The frontend localizes for the viewer, but an
email body is rendered on the server and read as-is, so a meeting at 7 PM
Eastern was arriving as "11:00 PM". These pin each email path that renders a
stored timestamp to the organization's timezone.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.inventory import InventoryActionType, InventoryNotificationQueue
from app.models.storefront import StoreOrderWindow
from app.models.user import Organization
from app.services import inventory_notification_service as inventory_module
from app.services import storefront_notification_service as notify_module
from app.services.email_service import EmailService
from app.services.event_request_service import render_request_template
from app.services.inventory_notification_service import InventoryNotificationService
from app.services.membership_pipeline_service import MembershipPipelineService
from app.services.storefront_notification_service import (
    StorefrontNotificationService,
)
from app.utils.org_timezone import format_in_org_timezone

pytestmark = pytest.mark.unit

# 23:00 UTC on a September evening is 7:00 PM Eastern (EDT, UTC-4) and
# 4:00 PM Pacific (PDT, UTC-7) — the same calendar day in both, so the
# assertions below isolate the clock shift from any date rollover.
MEETING_UTC = datetime(2026, 10, 6, 23, 0, tzinfo=timezone.utc)


def _org(tz: str | None = "America/Chicago") -> SimpleNamespace:
    return SimpleNamespace(id="org-1", name="Oakville FD", timezone=tz, logo=None)


class TestFormatInOrgTimezone:
    def test_an_aware_utc_value_is_shown_in_the_departments_zone(self):
        assert (
            format_in_org_timezone(MEETING_UTC, _org("America/Los_Angeles"))
            == "October 06, 2026 at 04:00 PM"
        )

    def test_a_naive_value_is_read_as_utc(self):
        naive = MEETING_UTC.replace(tzinfo=None)
        assert (
            format_in_org_timezone(naive, _org("America/Los_Angeles"))
            == "October 06, 2026 at 04:00 PM"
        )

    def test_a_value_already_in_another_zone_is_not_relabelled(self):
        # The previous email helper did dt.replace(tzinfo=utc), which silently
        # moved an already-localized value by its own offset.
        from zoneinfo import ZoneInfo

        eastern = MEETING_UTC.astimezone(ZoneInfo("America/New_York"))
        assert (
            format_in_org_timezone(eastern, _org("America/Los_Angeles"))
            == "October 06, 2026 at 04:00 PM"
        )

    def test_an_unset_or_invalid_zone_uses_the_scheduling_default(self):
        expected = "October 06, 2026 at 07:00 PM"
        assert format_in_org_timezone(MEETING_UTC, _org(None)) == expected
        assert format_in_org_timezone(MEETING_UTC, _org("Not/AZone")) == expected
        assert format_in_org_timezone(MEETING_UTC, None) == expected


class TestEmailServiceLocalTimes:
    def test_format_local_dt_uses_the_organizations_zone(self):
        service = EmailService.__new__(EmailService)
        service.organization = _org("America/Los_Angeles")
        assert service._format_local_dt(MEETING_UTC) == "October 06, 2026 at 04:00 PM"


class TestPipelineNextMeeting:
    """The "Next Meeting" block of a membership-pipeline stage email."""

    async def test_the_meeting_time_is_the_departments_local_time(self):
        event = SimpleNamespace(
            title="Business Meeting",
            start_datetime=MEETING_UTC,
            location="Station 1",
        )
        result = MagicMock()
        result.scalar_one_or_none.return_value = event
        service = MembershipPipelineService.__new__(MembershipPipelineService)
        service.db = SimpleNamespace(execute=AsyncMock(return_value=result))

        parts = await service._fetch_meeting_details(
            "org-1",
            event_type="business_meeting",
            html=False,
            organization=_org("America/New_York"),
        )

        assert parts == [
            "Business Meeting",
            "Tuesday, October 06, 2026 at 07:00 PM",
            "Station 1",
        ]


class TestEventRequestTemplate:
    def test_the_event_date_is_the_departments_local_time(self):
        template = SimpleNamespace(
            subject="Reminder", body_html="<p>{{event_date}}</p>", body_text=None
        )
        request = SimpleNamespace(
            contact_name="Dana Reyes",
            outreach_type="fire_safety_demo",
            organization_name="Maple Street Elementary",
            event_date=MEETING_UTC,
        )
        org = _org("America/New_York")
        org.settings = {}

        _subject, body, _text = render_request_template(template, request, org)

        assert "October 06, 2026 at 07:00 PM" in body
        assert "11:00 PM" not in body


class TestStorefrontWindowDeadline:
    async def test_the_closing_time_is_local_and_not_labelled_utc(self, monkeypatch):
        sent: list = []

        class _FakeEmailService:
            def __init__(self, organization=None, **_kwargs):
                self.organization = organization

            async def send_email(self, **kwargs):
                sent.append(kwargs)
                return 1, 0

        monkeypatch.setattr(notify_module, "EmailService", _FakeEmailService)
        org = Organization(
            id="org-1", name="Oakville FD", slug="ofd", timezone="America/New_York"
        )
        window = StoreOrderWindow(
            id="win-1",
            organization_id="org-1",
            name="Fall Order",
            closes_at=MEETING_UTC,
        )

        await StorefrontNotificationService(None).send_window_opened(
            window, None, org, recipients=["member@example.org"]
        )

        body = sent[-1]["html_body"]
        assert "October 06, 2026 at 07:00 PM" in body
        assert "UTC" not in body


# 02:30 UTC on October 7 is 10:30 PM Eastern on October 6: a date-only value
# taken in UTC lands on the wrong day for the evening hours.
LATE_EVENING_UTC = datetime(2026, 10, 7, 2, 30, tzinfo=timezone.utc)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return LATE_EVENING_UTC.replace(tzinfo=None)
        return LATE_EVENING_UTC.astimezone(tz)


class TestDuplicateApplicationDate:
    async def test_the_original_application_date_is_the_departments_day(self):
        org = _org("America/New_York")
        org.email = None
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = org
        service = MembershipPipelineService.__new__(MembershipPipelineService)
        service.db = SimpleNamespace(
            execute=AsyncMock(return_value=org_result), commit=AsyncMock()
        )
        service._log_activity = AsyncMock()
        prospect = SimpleNamespace(
            id="p-1",
            first_name="Dana",
            last_name="Reyes",
            email="dana@example.org",
            created_at=LATE_EVENING_UTC,
        )
        send = AsyncMock(return_value=True)

        email_service = MagicMock(send_duplicate_application_email=send)
        with patch(
            "app.services.email_service.EmailService", return_value=email_service
        ):
            await service._notify_duplicate_application(prospect, "org-1")

        assert send.await_args.kwargs["original_date"] == "October 06, 2026"


class TestInventoryChangeDate:
    async def test_the_change_date_is_the_departments_day(self, monkeypatch):
        monkeypatch.setattr(inventory_module, "datetime", _FrozenDatetime)
        record = InventoryNotificationQueue(
            id="rec-1",
            organization_id="org-1",
            user_id="user-1",
            item_id="item-1",
            item_name="Radio",
            action_type=InventoryActionType.ASSIGNED,
            quantity=1,
            processed=False,
            created_at=LATE_EVENING_UTC,
        )
        result = MagicMock()
        result.scalars.return_value.all.return_value = [record]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        db.commit = AsyncMock()
        service = InventoryNotificationService(db)
        service._get_user = AsyncMock(
            return_value=SimpleNamespace(first_name="Dana", email="d@example.org")
        )
        service._get_organization = AsyncMock(return_value=_org("America/New_York"))
        send = AsyncMock(return_value=True)
        service._send_notification_email = send

        await service.process_pending_notifications()

        context = send.await_args.args[2]
        assert context["change_date"] == "October 06, 2026"
