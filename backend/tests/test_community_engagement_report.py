"""The Community Engagement report counts what outreach actually reached.

The tab it feeds used to count scheduled events as held, add the department's
own members to "people reached", score every school assembly that never
passed round a sign-in sheet as zero, and offer no period but all time. These
tests pin the rules that replaced those, against real rows.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.dashboard import (
    get_community_engagement,
    get_community_engagement_events,
)
from app.api.v1.endpoints.events import (
    guest_headcount_offered,
    set_guest_headcount,
)
from app.models.event import (
    Event,
    EventExternalAttendee,
    EventRSVP,
    EventType,
    RSVPStatus,
)
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.event import MAX_GUEST_HEADCOUNT, GuestHeadcountUpdate
from app.services.community_engagement_service import (
    RECENT_EVENT_LIMIT,
    report_bounds,
)
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


async def _completed(db_session, req, at):
    """The activity row the status endpoint writes on a move to Completed."""
    db_session.add(
        EventRequestActivity(
            request_id=req.id,
            action="status_changed_to_completed",
            old_status=EventRequestStatus.SCHEDULED.value,
            new_status=EventRequestStatus.COMPLETED.value,
            created_at=at,
        )
    )
    await db_session.flush()


def _now_in_month():
    """Midway through the month so far, so the first hour of a month cannot
    file a row under the previous one."""
    now = datetime.now(timezone.utc)
    start, _, _ = report_bounds("month", now, ZoneInfo(TZ))
    assert start is not None
    return start + (now - start) / 2


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


class TestCrewRecordedByOverride:
    async def test_a_member_an_officer_recorded_counts_as_crew(self, db_session, dept):
        org, members = dept
        event = await _event(db_session, org, "Fair", _ago(days=2))
        # Never tapped in; an officer recorded their time afterwards.
        await _crew(
            db_session,
            org,
            event,
            members[0],
            checked_in=False,
            override_check_in_at=event.start_datetime,
            override_duration_minutes=120,
        )

        report = await _report(db_session, members[0])

        assert report.recent_events[0].crew == 1
        assert report.current.member_hours == 2.0
        assert report.current.members_involved == 1


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
        done = await _request(
            db_session, org, None, status=EventRequestStatus.COMPLETED
        )
        await _completed(db_session, done, at=_now_in_month())
        await _request(db_session, org, None, status=EventRequestStatus.SUBMITTED)

        report = await _report(db_session, members[0], "month")

        assert report.current.requests_received == 2
        assert report.current.requests_completed == 1

    async def test_a_completion_belongs_to_the_period_it_happened_in(
        self, db_session, dept
    ):
        org, members = dept
        now = datetime.now(timezone.utc)
        start, _, previous = report_bounds("month", now, ZoneInfo(TZ))
        assert start is not None
        assert previous is not None
        # Received last month, finished this month: this month's completion,
        # and last month's receipt.
        late = await _request(
            db_session,
            org,
            None,
            status=EventRequestStatus.COMPLETED,
            created_at=previous[0] + (previous[1] - previous[0]) / 2,
        )
        await _completed(db_session, late, at=_now_in_month())
        # Received this month and still open: received, not completed.
        await _request(db_session, org, None, status=EventRequestStatus.IN_PROGRESS)

        report = await _report(db_session, members[0], "month")

        assert report.current.requests_received == 1
        assert report.current.requests_completed == 1
        assert report.previous is not None
        assert report.previous.requests_received == 1
        assert report.previous.requests_completed == 0

    async def test_another_departments_completion_is_not_counted(
        self, db_session, dept
    ):
        org, members = dept
        other, _ = await _org(db_session, "Elsewhere")
        theirs = await _request(
            db_session, other, None, status=EventRequestStatus.COMPLETED
        )
        await _completed(db_session, theirs, at=_now_in_month())

        report = await _report(db_session, members[0], "month")

        assert report.current.requests_completed == 0

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


class TestGuestHeadcount:
    async def test_a_headcount_is_the_actual_figure_in_place_of_sign_ins(
        self, db_session, dept
    ):
        org, members = dept
        assembly = await _event(
            db_session, org, "Assembly", _ago(days=5), guest_headcount=140
        )
        await _request(db_session, org, assembly, audience_size=120)
        # Three people stopped at the sheet; the room held 140.
        await _guests(db_session, org, assembly, 3)

        report = await _report(db_session, members[0])
        row = report.recent_events[0]

        assert row.people_reached == 140
        assert row.reach_is_estimate is False
        assert (row.headcount, row.counted, row.signed_in) == (140, 140, 3)
        assert report.current.counted == 140
        assert report.current.signed_in == 3
        assert report.current.estimated == 0
        assert (report.turnout.counted, report.turnout.expected) == (140, 120)

    async def test_a_headcount_of_zero_is_a_count_not_a_missing_one(
        self, db_session, dept
    ):
        org, members = dept
        rained_out = await _event(
            db_session, org, "Rained out", _ago(days=5), guest_headcount=0
        )
        await _request(db_session, org, rained_out, audience_size=80)

        report = await _report(db_session, members[0])

        assert report.recent_events[0].people_reached == 0
        assert report.recent_events[0].reach_is_estimate is False
        assert report.current.estimated == 0

    async def test_the_endpoint_records_and_clears_a_count(self, db_session, dept):
        org, members = dept
        event = await _event(db_session, org, "Fair", _ago(days=1))

        saved = await set_guest_headcount(
            event_id=uuid.UUID(event.id),
            body=GuestHeadcountUpdate(guest_headcount=75),
            db=db_session,
            current_user=members[0],
        )
        assert saved.guest_headcount == 75
        assert (await _report(db_session, members[0])).current.counted == 75

        cleared = await set_guest_headcount(
            event_id=uuid.UUID(event.id),
            body=GuestHeadcountUpdate(guest_headcount=None),
            db=db_session,
            current_user=members[0],
        )
        assert cleared.guest_headcount is None

    async def test_the_endpoint_refuses_what_a_count_cannot_mean(
        self, db_session, dept
    ):
        org, members = dept
        other, _ = await _org(db_session, "Elsewhere")
        cases = {
            "upcoming": (await _event(db_session, org, "Soon", _ago(days=-3)), 400),
            "cancelled": (
                await _event(db_session, org, "Off", _ago(days=3), is_cancelled=True),
                400,
            ),
            "not outreach": (
                await _event(
                    db_session,
                    org,
                    "Drill",
                    _ago(days=3),
                    event_type=EventType.TRAINING,
                ),
                400,
            ),
            "another department": (
                await _event(db_session, other, "Theirs", _ago(days=3)),
                404,
            ),
        }
        for label, (event, code) in cases.items():
            with pytest.raises(HTTPException) as refused:
                await set_guest_headcount(
                    event_id=uuid.UUID(event.id),
                    body=GuestHeadcountUpdate(guest_headcount=10),
                    db=db_session,
                    current_user=members[0],
                )
            assert refused.value.status_code == code, label
        for event, _ in cases.values():
            await db_session.refresh(event)
            assert event.guest_headcount is None

    def test_an_implausible_count_is_refused_at_the_schema(self):
        with pytest.raises(ValidationError):
            GuestHeadcountUpdate(guest_headcount=-1)
        with pytest.raises(ValidationError):
            GuestHeadcountUpdate(guest_headcount=MAX_GUEST_HEADCOUNT + 1)


class TestTypeGroups:
    async def test_requests_and_department_events_are_grouped_apart(
        self, db_session, dept
    ):
        org, members = dept
        visit = await _event(db_session, org, "Visit", _ago(days=4))
        await _request(
            db_session, org, visit, outreach_type="school_visit", audience_size=60
        )
        await _event(db_session, org, "Open house", _ago(days=3), guest_headcount=200)

        report = await _report(db_session, members[0])
        groups = {(t.group, t.label): t.people_reached for t in report.by_type}

        # Both events are Public Education events; only the request is
        # labelled by what the requester asked for.
        assert groups == {
            ("request", "School Visit"): 60,
            ("department", "Public Education"): 200,
        }


class TestFullEventList:
    async def test_the_export_list_is_every_event_not_the_latest_fifty(
        self, db_session, dept
    ):
        org, members = dept
        for i in range(RECENT_EVENT_LIMIT + 5):
            await _event(db_session, org, f"Talk {i}", _ago(days=2, minutes=i))

        report = await _report(db_session, members[0])
        listed = await get_community_engagement_events(
            period="all", db=db_session, current_user=members[0]
        )

        assert len(report.recent_events) == RECENT_EVENT_LIMIT
        assert len(listed) == RECENT_EVENT_LIMIT + 5 == report.current.events_held
        assert listed[0].title == "Talk 0"


class TestHeadcountIsOfferedWhenASaveWouldBeAccepted:
    async def test_the_detail_flag_follows_the_saves_own_refusals(
        self, db_session, dept
    ):
        org, members = dept
        cases = {
            "held": (await _event(db_session, org, "Held", _ago(days=1)), True),
            "upcoming": (await _event(db_session, org, "Soon", _ago(days=-2)), False),
            "cancelled": (
                await _event(db_session, org, "Off", _ago(days=1), is_cancelled=True),
                False,
            ),
            "not outreach": (
                await _event(
                    db_session,
                    org,
                    "Drill",
                    _ago(days=1),
                    event_type=EventType.TRAINING,
                ),
                False,
            ),
        }

        # events.manage is granted here so the test is about the event-side
        # conditions, which are the ones this flag can get wrong.
        with patch(
            "app.api.v1.endpoints.events.user_has_permission", return_value=True
        ):
            for label, (event, expected) in cases.items():
                offered = await guest_headcount_offered(db_session, event, members[0])
                assert offered is expected, label

    async def test_a_member_without_events_manage_is_not_offered_it(
        self, db_session, dept
    ):
        org, members = dept
        event = await _event(db_session, org, "Held", _ago(days=1))

        with patch(
            "app.api.v1.endpoints.events.user_has_permission", return_value=False
        ):
            assert await guest_headcount_offered(db_session, event, members[0]) is False
