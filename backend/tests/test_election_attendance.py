"""Elections › Meeting Attendance: each member's attendance over a chosen
period, whether they may vote in the chosen election, and the meetings behind
a member's count -- with where each attendance record came from.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.elections import (
    get_election_attendance,
    get_member_meetings,
)
from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    User,
    UserStatus,
)
from app.services.attendance_dashboard_service import AttendanceDashboardService
from app.services.meetings_service import MeetingsService
from app.utils.org_timezone import org_today

COUNT_2_OF_3 = {"mode": "count", "min_meetings": 2, "of_last_meetings": 3}


async def _org(db):
    org = Organization(
        name="Attendance FD",
        slug=f"attend-{uuid.uuid4().hex[:8]}",
        settings={},
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag, hire_date=date(2010, 1, 1)):
    user = User(
        organization_id=org.id,
        username=f"{tag}-{uuid.uuid4().hex[:8]}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=tag.capitalize(),
        last_name="Member",
        hire_date=hire_date,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    user.member_class = "operational"
    user.member_status = "regular"
    await db.flush()
    return user


async def _meeting(db, org, day, meeting_type=MeetingType.BUSINESS, title=None):
    meeting = Meeting(
        organization_id=org.id,
        title=title or f"Meeting {day}",
        meeting_date=day,
        meeting_type=meeting_type,
    )
    db.add(meeting)
    await db.flush()
    return meeting


async def _attend(db, org, member, meeting, **extra):
    db.add(
        MeetingAttendee(
            organization_id=org.id,
            meeting_id=meeting.id,
            user_id=member.id,
            present=extra.pop("present", True),
            **extra,
        )
    )
    await db.flush()


async def _election(db, org, creator):
    now = datetime.now(timezone.utc)
    election = Election(
        organization_id=org.id,
        title="Officers 2027",
        positions=["Chief"],
        start_date=now + timedelta(days=1),
        end_date=now + timedelta(days=2),
        status=ElectionStatus.DRAFT,
        created_by=creator.id,
        voter_anonymity_salt=uuid.uuid4().hex,
        eligibility_rules={
            "version": 2,
            "types": {
                "regular": {
                    "may_vote": True,
                    "wait": None,
                    "attendance": [COUNT_2_OF_3],
                }
            },
        },
    )
    db.add(election)
    await db.flush()
    return election


@pytest.fixture
async def department(db_session):
    """Three monthly business meetings and a special meeting before today.
    ``steady`` attended every business meeting; ``lapsed`` none."""
    org = await _org(db_session)
    today = org_today(org)
    secretary = await _member(db_session, org, "secretary")
    steady = await _member(db_session, org, "steady")
    lapsed = await _member(db_session, org, "lapsed")
    business = [
        await _meeting(db_session, org, today - relativedelta(months=k))
        for k in (3, 2, 1)
    ]
    special = await _meeting(
        db_session, org, today - relativedelta(days=10), MeetingType.SPECIAL
    )
    for meeting in business:
        await _attend(db_session, org, steady, meeting)
    election = await _election(db_session, org, secretary)
    return {
        "db": db_session,
        "org": org,
        "today": today,
        "secretary": secretary,
        "steady": steady,
        "lapsed": lapsed,
        "business": business,
        "special": special,
        "election": election,
    }


def _row(response, member):
    return next(m for m in response.members if m.user_id == str(member.id))


async def _attendance(d, **params):
    params.setdefault("start", None)
    params.setdefault("end", None)
    params.setdefault("meeting_type", [])
    return await get_election_attendance(
        election_id=d["election"].id,
        db=d["db"],
        current_user=d["secretary"],
        **params,
    )


@pytest.mark.integration
class TestMembersAttendance:
    async def test_counts_and_the_elections_answer(self, department):
        response = await _attendance(department)
        steady = _row(response, department["steady"])
        lapsed = _row(response, department["lapsed"])

        assert response.total_meetings == 4
        assert (steady.attended, steady.absent, steady.meetings_in_period) == (3, 1, 4)
        assert (lapsed.attended, lapsed.absent) == (0, 4)
        # "May vote" is the election's roster answer, under its own rule.
        assert steady.may_vote is True
        assert lapsed.may_vote is False
        assert lapsed.reason.startswith("Attended 0 of the last")
        assert steady.member_type == "Regular"

    async def test_meeting_types_narrow_the_count(self, department):
        response = await _attendance(department, meeting_type=["business"])
        steady = _row(response, department["steady"])
        assert response.total_meetings == 3
        assert (steady.attended, steady.absent) == (3, 0)

    async def test_the_period_narrows_the_count_not_the_rule(self, department):
        # Only the special meeting falls in the last two weeks; the election's
        # rule still looks back over its own last three meetings.
        response = await _attendance(
            department, start=department["today"] - timedelta(days=14)
        )
        steady = _row(response, department["steady"])
        assert response.total_meetings == 1
        assert (steady.attended, steady.absent) == (0, 1)
        assert steady.may_vote is True

    async def test_a_member_is_not_counted_before_they_joined(self, department):
        d = department
        recruit = await _member(
            d["db"], d["org"], "recruit", hire_date=d["today"] - timedelta(days=20)
        )
        response = await _attendance(d)
        row = _row(response, recruit)
        assert row.meetings_in_period == 1  # only the special meeting
        assert row.member_since == d["today"] - timedelta(days=20)


@pytest.mark.integration
class TestMemberMeetings:
    async def test_each_meeting_says_how_it_counts_and_who_recorded_it(
        self, department
    ):
        d = department
        db, org, lapsed = d["db"], d["org"], d["lapsed"]
        oldest, middle, newest = d["business"]
        checked_in = datetime.now(timezone.utc).replace(microsecond=0)
        await _attend(
            db,
            org,
            lapsed,
            newest,
            checked_in_at=checked_in,
            recorded_by=d["secretary"].id,
            recorded_via="event_check_in",
        )
        await _attend(
            db,
            org,
            lapsed,
            middle,
            present=False,
            excused=True,
            waiver_reason="Work shift",
            recorded_via="waiver",
        )
        db.add(
            MemberLeaveOfAbsence(
                organization_id=org.id,
                user_id=lapsed.id,
                leave_type=list(LeaveType)[0],
                start_date=oldest.meeting_date - timedelta(days=1),
                end_date=oldest.meeting_date + timedelta(days=1),
                active=True,
            )
        )
        await db.flush()

        response = await get_member_meetings(
            election_id=d["election"].id,
            user_id=lapsed.id,
            start=None,
            end=None,
            meeting_type=[],
            db=db,
            current_user=d["secretary"],
        )
        by_id = {m.meeting_id: m for m in response.meetings}
        # Newest first.
        assert [m.meeting_id for m in response.meetings][0] == str(d["special"].id)
        assert by_id[str(d["special"].id)].status == "absent"
        assert by_id[str(newest.id)].status == "present"
        assert by_id[str(newest.id)].checked_in_at == checked_in
        assert by_id[str(newest.id)].recorded_by_name == d["secretary"].display_name
        assert by_id[str(newest.id)].recorded_via == "event_check_in"
        assert by_id[str(middle.id)].status == "excused"
        assert by_id[str(middle.id)].waiver_reason == "Work shift"
        assert by_id[str(oldest.id)].status == "on_leave"
        assert by_id[str(oldest.id)].leave_start == oldest.meeting_date - timedelta(
            days=1
        )


@pytest.mark.integration
class TestRefusals:
    async def test_a_backwards_period_is_refused(self, department):
        with pytest.raises(HTTPException) as exc:
            await _attendance(
                department,
                start=department["today"],
                end=department["today"] - timedelta(days=1),
            )
        assert exc.value.status_code == 400

    async def test_an_unknown_meeting_type_is_refused(self, department):
        with pytest.raises(HTTPException) as exc:
            await _attendance(department, meeting_type=["picnic"])
        assert exc.value.status_code == 400

    async def test_another_departments_election_is_not_found(self, department):
        other = await _org(department["db"])
        outsider = await _member(department["db"], other, "outsider")
        with pytest.raises(HTTPException) as exc:
            await get_election_attendance(
                election_id=department["election"].id,
                start=None,
                end=None,
                meeting_type=[],
                db=department["db"],
                current_user=outsider,
            )
        assert exc.value.status_code == 404

    async def test_another_departments_member_is_not_found(self, department):
        other = await _org(department["db"])
        outsider = await _member(department["db"], other, "outsider")
        with pytest.raises(HTTPException) as exc:
            await get_member_meetings(
                election_id=department["election"].id,
                user_id=outsider.id,
                start=None,
                end=None,
                meeting_type=[],
                db=department["db"],
                current_user=department["secretary"],
            )
        assert exc.value.status_code == 404


@pytest.mark.integration
class TestProvenanceIsRecorded:
    async def test_a_secretary_added_attendee_names_the_secretary(self, department):
        d = department
        attendee, error = await MeetingsService(d["db"]).add_attendee(
            uuid.UUID(str(d["special"].id)),
            d["org"].id,
            {"user_id": str(d["lapsed"].id), "present": True},
            recorded_by=d["secretary"].id,
        )
        assert error is None
        assert attendee.recorded_by == str(d["secretary"].id)
        assert attendee.recorded_via == "manual"
        # A secretary's entry is not a check-in and claims no moment for one.
        assert attendee.checked_in_at is None

    async def test_a_granted_waiver_is_recorded_as_one(self, department):
        d = department
        await AttendanceDashboardService(d["db"]).grant_waiver(
            str(d["special"].id),
            str(d["lapsed"].id),
            str(d["org"].id),
            str(d["secretary"].id),
            "Out of town",
        )
        record = (
            await d["db"].execute(
                select(MeetingAttendee).where(
                    MeetingAttendee.meeting_id == str(d["special"].id),
                    MeetingAttendee.user_id == str(d["lapsed"].id),
                )
            )
        ).scalar_one()
        assert record.recorded_via == "waiver"
        assert record.recorded_by == str(d["secretary"].id)
