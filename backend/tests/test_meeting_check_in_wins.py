"""Check-in wins over a meeting waiver (owner decision, 2026-11-10).

A member who was present at a meeting counts as having attended it even when
they also hold a waiver for it; a waiver excuses only a meeting they missed.
Pinned on every reader of meeting attendance that used to let the waiver win:

  * ``tally_attendance`` itself, the one place the two are reconciled;
  * the voting check's percentage (``MembershipTierService``);
  * the Secretary's attendance dashboard;
  * the annual evaluation's business-meeting figure;
  * the election's attendee import (defect D12), which copied a present but
    waived member while the voting tally said they had not attended: the two
    now agree that such a member attended.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.v1.endpoints.elections import import_meeting_attendees
from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingStatus, MeetingType
from app.services.attendance_dashboard_service import AttendanceDashboardService
from app.services.evaluation_data_service import Coverage, EvaluationDataService
from app.services.membership_tier_service import (
    MembershipTierService,
    tally_attendance,
)
from tests.waiver_request_support import load, make_member, make_org, uid


class TestTheTally:
    pytestmark = pytest.mark.unit

    WINDOW = (date(2026, 1, 1), date(2026, 12, 31))
    MEETINGS = [
        ("present-waived", date(2026, 3, 1)),
        ("absent", date(2026, 4, 1)),
        ("absent-waived", date(2026, 5, 1)),
    ]

    def test_present_and_waived_is_attended(self):
        tally = tally_attendance(
            self.MEETINGS,
            self.WINDOW,
            waived_ids={"present-waived", "absent-waived"},
            present_ids={"present-waived"},
            leaves=[],
        )
        assert tally.attended == {"present-waived"}
        assert tally.waived == {"absent-waived"}
        assert tally.eligible == {"present-waived", "absent"}
        assert tally.pct == 50.0

    def test_present_during_leave_still_does_not_count(self):
        """Unchanged: a leave takes the meeting out of the count whatever
        happened at it."""

        class _Leave:
            start_date = date(2026, 2, 15)
            end_date = date(2026, 3, 15)

        tally = tally_attendance(
            self.MEETINGS,
            self.WINDOW,
            waived_ids={"present-waived"},
            present_ids={"present-waived"},
            leaves=[_Leave()],
        )
        assert "present-waived" not in tally.eligible
        assert tally.attended == frozenset()


async def _meeting(db, org_id, creator, day):
    meeting = Meeting(
        id=uid(),
        organization_id=org_id,
        title="Business Meeting",
        meeting_type=MeetingType.BUSINESS,
        meeting_date=day,
        status=MeetingStatus.APPROVED,
        created_by=creator,
    )
    db.add(meeting)
    await db.flush()
    return meeting


@pytest.fixture
async def history(db_session):
    """A member present-and-waived at one meeting, absent at a second and
    absent-but-waived at a third, all inside the last year."""
    org_id = await make_org(db_session)
    member_id = await make_member(db_session, org_id, "Pat")
    secretary_id = await make_member(db_session, org_id, "Sec")
    today = date.today()
    present_waived = await _meeting(
        db_session, org_id, secretary_id, today - timedelta(days=30)
    )
    absent = await _meeting(
        db_session, org_id, secretary_id, today - timedelta(days=20)
    )
    absent_waived = await _meeting(
        db_session, org_id, secretary_id, today - timedelta(days=10)
    )
    db_session.add_all(
        [
            MeetingAttendee(
                organization_id=org_id,
                meeting_id=present_waived.id,
                user_id=member_id,
                present=True,
                excused=True,
                waiver_reason="Excused: approved request",
                waiver_granted_by=secretary_id,
            ),
            MeetingAttendee(
                organization_id=org_id,
                meeting_id=absent_waived.id,
                user_id=member_id,
                present=False,
                excused=True,
                waiver_reason="Out of town",
                waiver_granted_by=secretary_id,
            ),
        ]
    )
    await db_session.flush()
    return {
        "org": org_id,
        "member": member_id,
        "secretary": secretary_id,
        "present_waived": present_waived,
        "absent": absent,
        "absent_waived": absent_waived,
        "today": today,
    }


@pytest.mark.integration
class TestTheReaders:
    async def test_the_voting_percentage(self, db_session, history):
        pct = await MembershipTierService(db_session).get_meeting_attendance_pct(
            history["member"], history["org"]
        )
        # Attended one of the two meetings that count; the waived absence is
        # excused.
        assert pct == 50.0

    async def test_the_recent_meetings_count(self, db_session, history):
        recent = await MembershipTierService(db_session).get_recent_meeting_attendance(
            history["member"], history["org"], 4
        )
        assert (recent.attended, recent.considered) == (1, 2)

    async def test_the_secretarys_dashboard(self, db_session, history):
        dashboard = await AttendanceDashboardService(db_session).get_dashboard(
            history["org"]
        )
        row = next(r for r in dashboard["members"] if r["user_id"] == history["member"])
        assert row["meetings_attended"] == 1
        assert row["meetings_waived"] == 1
        assert row["meetings_absent"] == 1
        assert row["attendance_pct"] == 50.0

    async def test_the_annual_evaluation(self, db_session, history):
        member = await load(db_session, history["member"])
        result = await EvaluationDataService(db_session)._meeting_attendance(
            history["org"],
            member,
            Coverage(
                start=history["today"] - timedelta(days=60),
                end=history["today"],
                excluded=(),
            ),
        )
        assert result["available"] is True
        assert result["attended"] == 1
        assert result["held"] == 2
        assert result["value"] == 50.0


@pytest.mark.integration
class TestElectionImportAgreesWithTheTally:
    """D12: the import copies members present at the linked meeting, a
    present-but-waived member included, and that is exactly the member the
    voting tally now counts as having attended."""

    async def test_present_and_waived_is_imported_and_counted(
        self, db_session, history
    ):
        secretary = await load(db_session, history["secretary"])
        now = datetime.now(timezone.utc)
        election = Election(
            organization_id=history["org"],
            title="Officers",
            positions=["Chief"],
            start_date=now - timedelta(days=1),
            end_date=now + timedelta(days=1),
            status=ElectionStatus.OPEN,
            created_by=secretary.id,
            voter_anonymity_salt=uuid.uuid4().hex,
            meeting_id=history["present_waived"].id,
        )
        db_session.add(election)
        await db_session.flush()

        response = await import_meeting_attendees(
            election.id, db=db_session, current_user=secretary
        )

        assert response.imported == 1
        imported = {a["user_id"] for a in election.attendees}
        assert imported == {history["member"]}
        tally_pct = await MembershipTierService(db_session).get_meeting_attendance_pct(
            history["member"], history["org"]
        )
        # The tally agrees the imported member attended that meeting: it is in
        # their numerator, not excused out of their denominator.
        assert tally_pct == 50.0
