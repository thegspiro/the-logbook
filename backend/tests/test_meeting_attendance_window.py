"""
Which meetings a member's voting-eligibility attendance is measured over.

The window runs from the later of the look-back cutoff and the start of the
member's current stint, to the department's today. Before that, a member hired
two months ago was charged with ten meetings held before they joined, a
reinstated member with every meeting held while they were dropped, and
everyone with meetings that had not happened yet.

The ballot check and the secretary's dashboard both read this; the dashboard
case asserts they agree (pitfall #29). Run against MySQL because the window is
applied in the queries, not only in Python.
"""

import uuid
from datetime import date

import pytest
from dateutil.relativedelta import relativedelta

from app.models.meeting import Meeting, MeetingAttendee
from app.models.user import MemberServicePeriod, Organization, User, UserStatus
from app.services.attendance_dashboard_service import AttendanceDashboardService
from app.services.membership_tier_service import (
    MembershipTierService,
    attendance_window,
    current_stint_start,
)
from app.utils.org_timezone import org_today


def _stint(start, end=None, counts=True):
    return MemberServicePeriod(
        start_date=start, end_date=end, counts_toward_service=counts
    )


@pytest.mark.unit
class TestWindowArithmetic:
    TODAY = date(2026, 9, 1)

    def test_no_member_is_the_plain_look_back(self):
        assert attendance_window(None, [], 12, self.TODAY) == (
            date(2025, 9, 1),
            self.TODAY,
        )

    def test_recent_hire_starts_at_hire(self):
        member = type("M", (), {"hire_date": date(2026, 7, 1)})()
        assert attendance_window(member, [], 12, self.TODAY)[0] == date(2026, 7, 1)

    def test_long_serving_member_starts_at_cutoff(self):
        member = type("M", (), {"hire_date": date(2010, 1, 1)})()
        assert attendance_window(member, [], 12, self.TODAY)[0] == date(2025, 9, 1)

    def test_current_stint_is_the_latest_even_when_earlier_ones_are_credited(self):
        member = type("M", (), {"hire_date": date(2010, 1, 1)})()
        stints = [
            _stint(None, date(2025, 12, 31)),  # NULL start is the hire date
            _stint(date(2026, 6, 1)),
        ]
        assert current_stint_start(member, stints) == date(2026, 6, 1)


async def _org(db):
    org = Organization(name="Attendance Window FD", slug=f"awf-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, hire_date):
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
        hire_date=hire_date,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


async def _meetings(db, org, dates):
    meetings = [
        Meeting(organization_id=org.id, title=f"Business {d}", meeting_date=d)
        for d in dates
    ]
    db.add_all(meetings)
    await db.flush()
    return meetings


async def _attend(db, org, member, meetings):
    db.add_all(
        MeetingAttendee(
            organization_id=org.id,
            meeting_id=m.id,
            user_id=member.id,
            present=True,
        )
        for m in meetings
    )
    await db.flush()


def _monthly(today, months_ago):
    """One meeting a month, ``months_ago`` down to 1 month before today."""
    return [today - relativedelta(months=k) for k in range(months_ago, 0, -1)]


async def _pct(db, org, member, months=12):
    return await MembershipTierService(db).get_meeting_attendance_pct(
        str(member.id), str(org.id), period_months=months
    )


@pytest.mark.integration
class TestAttendanceWindow:
    async def test_recent_hire_is_judged_only_on_meetings_since_hire(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        member = await _member(db_session, org, today - relativedelta(months=2))
        meetings = await _meetings(db_session, org, _monthly(today, 11))
        # The two meetings held since hire -- one of them on the hire date.
        await _attend(db_session, org, member, meetings[-2:])

        assert await _pct(db_session, org, member) == 100.0

    async def test_future_meetings_are_not_absences(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        member = await _member(db_session, org, date(2010, 1, 1))
        past = await _meetings(db_session, org, _monthly(today, 2))
        await _meetings(
            db_session,
            org,
            [today + relativedelta(days=1), today + relativedelta(months=1)],
        )
        await _attend(db_session, org, member, past)

        assert await _pct(db_session, org, member) == 100.0

    async def test_meeting_held_today_counts(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        member = await _member(db_session, org, date(2010, 1, 1))
        past = await _meetings(db_session, org, _monthly(today, 1))
        await _meetings(db_session, org, [today])
        await _attend(db_session, org, member, past)

        assert await _pct(db_session, org, member) == 50.0

    @pytest.mark.parametrize("earlier_counts", [True, False])
    async def test_reinstated_member_is_not_charged_for_time_away(
        self, db_session, earlier_counts
    ):
        # Whether the department continues or restarts the returning member's
        # service credit, the months they were dropped are not attendance.
        org = await _org(db_session)
        today = org_today(org)
        member = await _member(db_session, org, date(2015, 1, 1))
        db_session.add_all(
            [
                MemberServicePeriod(
                    organization_id=org.id,
                    user_id=member.id,
                    start_date=None,
                    end_date=today - relativedelta(months=9),
                    separation_status="dropped_voluntary",
                    counts_toward_service=earlier_counts,
                ),
                MemberServicePeriod(
                    organization_id=org.id,
                    user_id=member.id,
                    start_date=today - relativedelta(months=3, days=-1),
                    counts_toward_service=True,
                ),
            ]
        )
        meetings = await _meetings(db_session, org, _monthly(today, 11))
        # Present at the meetings before they left and since they returned;
        # absent from the six held while dropped.
        await _attend(db_session, org, member, meetings[:3] + meetings[-2:])

        assert await _pct(db_session, org, member) == 100.0

    async def test_long_standing_member_is_unchanged(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        member = await _member(db_session, org, date(2010, 1, 1))
        # One meeting outside the twelve-month look-back, four inside it.
        await _meetings(db_session, org, [today - relativedelta(months=14)])
        meetings = await _meetings(db_session, org, _monthly(today, 4))
        await _attend(db_session, org, member, meetings[:3])

        assert await _pct(db_session, org, member) == 75.0

    async def test_dashboard_agrees_with_the_ballot_check(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        recent = await _member(db_session, org, today - relativedelta(months=2))
        veteran = await _member(db_session, org, date(2010, 1, 1))
        meetings = await _meetings(db_session, org, _monthly(today, 6))
        await _meetings(db_session, org, [today + relativedelta(days=7)])
        await _attend(db_session, org, recent, meetings[-2:])
        await _attend(db_session, org, veteran, meetings[:3])

        out = await AttendanceDashboardService(db_session).get_dashboard(org.id)
        rows = {r["user_id"]: r for r in out["members"]}

        assert rows[str(recent.id)]["total_meetings"] == 2
        assert rows[str(veteran.id)]["total_meetings"] == 6
        for member in (recent, veteran):
            assert rows[str(member.id)]["attendance_pct"] == await _pct(
                db_session, org, member
            )
        assert rows[str(recent.id)]["attendance_pct"] == 100.0
        assert rows[str(veteran.id)]["attendance_pct"] == 50.0
