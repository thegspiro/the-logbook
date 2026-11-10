"""The requests list reports short notice and signup-sheet coverage per row.

The redesigned Requests tab groups requests by what needs doing and shows, on
each row, whether intake flagged it as short notice and how many volunteers a
scheduled request has. Both used to be visible only by opening a request (the
flag as an activity-log line, the coverage as a separate staffing call), so
the list could not show them without a request per row.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1.endpoints.event_requests import list_event_requests
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftStatus,
)
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
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
    return await _org(db_session, "Listing")


async def _request(db_session, org, name, **kwargs):
    req = EventRequest(
        organization_id=org.id,
        contact_name=name,
        contact_email=f"{name.lower()}@example.test",
        description="Station tour",
        status=kwargs.pop("status", EventRequestStatus.SUBMITTED),
        **kwargs,
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _sheet(db_session, org, seats, status=ShiftStatus.SCHEDULED):
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
    shift = Shift(
        organization_id=org.id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=2),
        positions=[{"position": "volunteer", "required": True}] * seats,
        status=status,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


def _seat(org, shift, user, status=AssignmentStatus.ASSIGNED):
    return ShiftAssignment(
        organization_id=org.id,
        shift_id=shift.id,
        user_id=user.id,
        position="volunteer",
        assignment_status=status,
    )


async def _rows(db_session, viewer):
    items = await list_event_requests(
        status_filter=None, outreach_type=None, db=db_session, current_user=viewer
    )
    return {item.contact_name: item for item in items}


class TestShortNotice:
    async def test_only_a_request_intake_flagged_reads_short_notice(
        self, db_session, dept
    ):
        org, members = dept
        flagged = await _request(db_session, org, "Flagged")
        await _request(db_session, org, "Plain")
        db_session.add(
            EventRequestActivity(
                request_id=flagged.id,
                action="lead_time_warning",
                notes="We need at least 21 days notice.",
                details={"min_lead_time_days": 21},
            )
        )
        await db_session.flush()

        rows = await _rows(db_session, members[0])

        assert rows["Flagged"].short_notice is True
        assert rows["Plain"].short_notice is False

    async def test_two_warnings_on_one_request_still_read_once(self, db_session, dept):
        org, members = dept
        req = await _request(db_session, org, "Twice")
        for _ in range(2):
            db_session.add(
                EventRequestActivity(request_id=req.id, action="lead_time_warning")
            )
        await db_session.flush()

        rows = await _rows(db_session, members[0])

        assert rows["Twice"].short_notice is True


class TestStaffingSummary:
    async def test_a_live_sheet_reports_held_seats_of_its_total(self, db_session, dept):
        org, members = dept
        sheet = await _sheet(db_session, org, seats=3)
        await _request(
            db_session,
            org,
            "Covered",
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=sheet.id,
        )
        db_session.add(_seat(org, sheet, members[0]))
        db_session.add(_seat(org, sheet, members[1]))
        # Released seats are not coverage: the same rule the sheet read uses.
        db_session.add(_seat(org, sheet, members[2], AssignmentStatus.CANCELLED))
        await db_session.flush()

        rows = await _rows(db_session, members[0])

        assert rows["Covered"].staffing_slots_filled == 2
        assert rows["Covered"].staffing_slots_total == 3

    async def test_a_sheet_nobody_has_joined_reads_zero_of_its_total(
        self, db_session, dept
    ):
        org, members = dept
        sheet = await _sheet(db_session, org, seats=4)
        await _request(
            db_session,
            org,
            "Empty",
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=sheet.id,
        )

        rows = await _rows(db_session, members[0])

        assert rows["Empty"].staffing_slots_filled == 0
        assert rows["Empty"].staffing_slots_total == 4

    async def test_a_cancelled_sheet_reads_as_no_sheet(self, db_session, dept):
        org, members = dept
        sheet = await _sheet(db_session, org, seats=2, status=ShiftStatus.CANCELLED)
        await _request(
            db_session,
            org,
            "StoodDown",
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=sheet.id,
        )

        rows = await _rows(db_session, members[0])

        assert rows["StoodDown"].staffing_slots_filled is None
        assert rows["StoodDown"].staffing_slots_total is None

    async def test_a_request_with_no_sheet_carries_no_counts(self, db_session, dept):
        org, members = dept
        await _request(db_session, org, "NoSheet")

        rows = await _rows(db_session, members[0])

        assert rows["NoSheet"].staffing_slots_filled is None
        assert rows["NoSheet"].staffing_slots_total is None

    async def test_another_departments_sheet_is_not_counted(self, db_session, dept):
        org, members = dept
        other_org, other_members = await _org(db_session, "Elsewhere")
        foreign = await _sheet(db_session, other_org, seats=5)
        db_session.add(_seat(other_org, foreign, other_members[0]))
        await _request(
            db_session,
            org,
            "Crossed",
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=foreign.id,
        )
        await db_session.flush()

        rows = await _rows(db_session, members[0])

        assert rows["Crossed"].staffing_slots_total is None


class TestAssigneeNames:
    async def test_each_assigned_row_names_its_coordinator(self, db_session, dept):
        org, members = dept
        await _request(db_session, org, "Assigned", assigned_to=members[1].id)
        await _request(db_session, org, "Unassigned")

        rows = await _rows(db_session, members[0])

        assert rows["Assigned"].assignee_name == "Member 1"
        assert rows["Unassigned"].assignee_name is None
