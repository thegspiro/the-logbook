"""The Community Engagement report counts what outreach actually reached.

The tab it feeds used to count scheduled events as held, add the department's
own members to "people reached", score every school assembly that never
passed round a sign-in sheet as zero, and offer no period but all time. These
tests pin the rules that replaced those, against real rows.
"""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.api.v1.endpoints.dashboard import get_community_engagement
from app.models.event import (
    Event,
    EventExternalAttendee,
    EventRSVP,
    EventType,
    RSVPStatus,
)
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.user import Organization, User, UserStatus
from app.services.community_engagement_service import report_bounds
from app.services.dashboard_widget_service import DashboardWidgetService

TZ = "America/New_York"


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone=TZ,
        settings={
            "events": {
                "outreach_event_types": [
                    {"value": "school_visit", "label": "School Visit"},
                    {"value": "station_tour", "label": "Station Tour"},
                ]
            }
        },
    )
    db_session.add(org)
    await db_session.flush()
    members = []
    for i in range(3):
        user = User(
            organization_id=org.id,
            username=f"{label.lower()}{i}-{org.id[:8]}",
            email=f"{label.lower()}{i}-{org.id[:8]}@example.test",
            first_name="Member",
            last_name=str(i),
            status=UserStatus.ACTIVE,
        )
        db_session.add(user)
        members.append(user)
    await db_session.flush()
    return org, members


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Reach")


async def _event(db_session, org, title, start, **kwargs):
    event = Event(
        organization_id=org.id,
        title=title,
        event_type=kwargs.pop("event_type", EventType.PUBLIC_EDUCATION),
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        **kwargs,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _guests(db_session, org, event, count, checked_in=True):
    for i in range(count):
        db_session.add(
            EventExternalAttendee(
                organization_id=org.id,
                event_id=event.id,
                name=f"Guest {i}",
                checked_in=checked_in,
            )
        )
    await db_session.flush()


async def _crew(db_session, org, event, user, **kwargs):
    db_session.add(
        EventRSVP(
            organization_id=org.id,
            event_id=event.id,
            user_id=user.id,
            status=RSVPStatus.GOING,
            checked_in=kwargs.pop("checked_in", True),
            **kwargs,
        )
    )
    await db_session.flush()


async def _request(db_session, org, event, **kwargs):
    req = EventRequest(
        organization_id=org.id,
        contact_name=kwargs.pop("contact_name", "Pat Requester"),
        contact_email="pat@example.test",
        description="Outreach",
        status=kwargs.pop("status", EventRequestStatus.SCHEDULED),
        event_id=event.id if event is not None else None,
        **kwargs,
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _report(db_session, viewer, period="all"):
    return await get_community_engagement(
        period=period, db=db_session, current_user=viewer
    )


def _ago(**kwargs):
    return datetime.now(timezone.utc).replace(microsecond=0) - timedelta(**kwargs)


pytestmark = pytest.mark.integration


class TestEventsHeld:
    async def test_a_scheduled_event_is_upcoming_not_held(self, db_session, dept):
        org, members = dept
        await _event(db_session, org, "Held", _ago(days=3))
        await _event(db_session, org, "Next week", _ago(days=-7))

        report = await _report(db_session, members[0])

        assert report.current.events_held == 1
        assert [e.title for e in report.recent_events] == ["Held"]
        assert report.upcoming_events == 1

    async def test_cancelled_and_other_departments_events_are_out(
        self, db_session, dept
    ):
        org, members = dept
        other, _ = await _org(db_session, "Elsewhere")
        await _event(db_session, org, "Called off", _ago(days=3), is_cancelled=True)
        await _event(db_session, other, "Theirs", _ago(days=3))
        await _event(
            db_session, org, "Drill", _ago(days=3), event_type=EventType.TRAINING
        )

        report = await _report(db_session, members[0])

        assert report.current.events_held == 0

    async def test_a_request_linked_event_counts_whatever_its_type(
        self, db_session, dept
    ):
        org, members = dept
        drill = await _event(
            db_session,
            org,
            "Demo at drill night",
            _ago(days=3),
            event_type=EventType.TRAINING,
        )
        await _request(
            db_session,
            org,
            drill,
            outreach_type="station_tour",
            organization_name="Scout Troop 12",
        )

        report = await _report(db_session, members[0])

        assert report.current.events_held == 1
        row = report.recent_events[0]
        assert row.type_label == "Station Tour"
        assert row.organization_name == "Scout Troop 12"


class TestPeopleReached:
    async def test_sign_ins_are_actual_and_an_audience_size_is_an_estimate(
        self, db_session, dept
    ):
        org, members = dept
        assembly = await _event(db_session, org, "Assembly", _ago(days=5))
        await _request(db_session, org, assembly, audience_size=120)
        cpr = await _event(db_session, org, "CPR class", _ago(days=4))
        await _request(db_session, org, cpr, audience_size=30)
        await _guests(db_session, org, cpr, 25)
        await _guests(db_session, org, cpr, 4, checked_in=False)

        report = await _report(db_session, members[0])
        rows = {e.title: e for e in report.recent_events}

        assert rows["Assembly"].people_reached == 120
        assert rows["Assembly"].reach_is_estimate is True
        # The sign-ins are what happened: the estimate is not added on top.
        assert rows["CPR class"].people_reached == 25
        assert rows["CPR class"].reach_is_estimate is False
        assert rows["CPR class"].expected == 30
        assert report.current.people_reached == 145
        assert report.current.signed_in == 25
        assert report.current.estimated == 120
        # Turnout compares only events that recorded both.
        assert (report.turnout.events, report.turnout.signed_in) == (1, 25)
        assert report.turnout.expected == 30

    async def test_members_on_duty_are_not_people_reached(self, db_session, dept):
        org, members = dept
        event = await _event(db_session, org, "Open house", _ago(days=2))
        await _crew(db_session, org, event, members[0])
        await _crew(db_session, org, event, members[1])

        report = await _report(db_session, members[0])

        assert report.current.people_reached == 0
        assert report.recent_events[0].crew == 2


class TestMemberHours:
    async def test_hours_follow_the_credited_minutes_rule(self, db_session, dept):
        org, members = dept
        event = await _event(db_session, org, "Fair", _ago(days=2))
        await _crew(db_session, org, event, members[0], attendance_duration_minutes=90)
        # An officer's explicit zero means no credit, not "use the measured time".
        await _crew(
            db_session,
            org,
            event,
            members[1],
            attendance_duration_minutes=120,
            override_duration_minutes=0,
        )
        # Signed up but never checked in: not crew.
        await _crew(db_session, org, event, members[2], checked_in=False)

        report = await _report(db_session, members[0])

        assert report.recent_events[0].member_hours == 1.5
        assert report.current.member_hours == 1.5
        assert report.current.members_involved == 2


class TestPeriods:
    async def test_the_period_bounds_what_is_counted_and_compared(
        self, db_session, dept
    ):
        org, members = dept
        now = datetime.now(timezone.utc)
        start, _, previous = report_bounds("quarter", now, ZoneInfo(TZ))
        assert start is not None
        assert previous is not None
        await _event(db_session, org, "This quarter", start + (now - start) / 2)
        await _event(
            db_session,
            org,
            "Last quarter",
            previous[0] + (previous[1] - previous[0]) / 2,
        )
        await _event(db_session, org, "Long ago", now - timedelta(days=800))

        quarter = await _report(db_session, members[0], "quarter")
        everything = await _report(db_session, members[0], "all")

        assert [e.title for e in quarter.recent_events] == ["This quarter"]
        assert quarter.previous is not None
        assert quarter.previous.events_held == 1
        assert everything.current.events_held == 3
        assert everything.previous is None

    async def test_requests_received_and_completed_in_the_period(
        self, db_session, dept
    ):
        org, members = dept
        await _request(db_session, org, None, status=EventRequestStatus.COMPLETED)
        await _request(db_session, org, None, status=EventRequestStatus.SUBMITTED)

        report = await _report(db_session, members[0], "month")

        assert report.current.requests_received == 2
        assert report.current.requests_completed == 1

    async def test_buckets_cover_the_whole_span_in_the_departments_months(
        self, db_session, dept
    ):
        org, members = dept
        await _event(db_session, org, "Recent", _ago(days=1))

        report = await _report(db_session, members[0], "rolling_12")

        assert report.granularity == "month"
        assert len(report.by_period) == 12
        local = (datetime.now(timezone.utc) - timedelta(days=1)).astimezone(
            ZoneInfo(TZ)
        )
        filled = [b for b in report.by_period if b.events]
        assert [b.period for b in filled] == [f"{local.year:04d}-{local.month:02d}"]


class TestReportBounds:
    def test_the_comparison_is_the_same_elapsed_span_one_period_back(self):
        tz = ZoneInfo(TZ)
        now = datetime(2026, 11, 10, 17, 0, tzinfo=timezone.utc)

        start, end, previous = report_bounds("quarter", now, tz)

        assert start == datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
        assert end == now
        assert previous == (
            datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc),
            # Noon in New York both times: the span is measured on the
            # department's clock, so August's daylight time moves it an hour
            # in UTC.
            datetime(2026, 8, 10, 16, 0, tzinfo=timezone.utc),
        )

    def test_last_twelve_months_starts_on_a_whole_month(self):
        now = datetime(2026, 11, 10, 17, 0, tzinfo=timezone.utc)

        start, _, _ = report_bounds("rolling_12", now, ZoneInfo(TZ))

        assert start == datetime(2025, 12, 1, 5, 0, tzinfo=timezone.utc)


class TestDashboardCardAgrees:
    async def test_the_pulse_card_counts_the_same_events(self, db_session, dept):
        org, members = dept
        now = datetime.now(timezone.utc)
        start, _, _ = report_bounds("month", now, ZoneInfo(TZ))
        assert start is not None
        # Midway through the month so far, so the first hour of a month
        # cannot push the rows into the previous one.
        within = start + (now - start) / 2
        drill = await _event(
            db_session, org, "Linked drill", within, event_type=EventType.TRAINING
        )
        await _request(db_session, org, drill)
        await _event(db_session, org, "Public", within)

        pulse = await DashboardWidgetService(db_session).community(org.id, "month")
        report = await _report(db_session, members[0], "month")

        assert pulse["public_events"] == report.current.events_held == 2
