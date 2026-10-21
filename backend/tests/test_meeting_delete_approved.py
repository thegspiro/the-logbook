"""An approved meeting cannot be deleted; a draft one still can.

Deleting a meeting cascades its attendees away, and meeting attendance counts
toward membership tier eligibility. Once the minutes are approved that
attendance is the department's settled record, and meetings have no
active/archived flag to fall back on — so the delete is refused with 409
rather than turned into a deactivation.
"""

import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import meetings as meetings_endpoint
from app.models.meeting import Meeting, MeetingAttendee, MeetingStatus
from app.models.user import Organization, User
from app.services.meetings_service import (
    MeetingDeleteRefusedError,
    MeetingsService,
)

pytestmark = pytest.mark.integration


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Meeting Delete VFD",
        slug=f"mtg-del-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"clerk-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Cora",
        last_name="Lee",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    return {"db": db_session, "org_id": org.id, "user": user}


async def _meeting(dept, status: MeetingStatus) -> Meeting:
    db = dept["db"]
    meeting = Meeting(
        organization_id=dept["org_id"],
        title="October Business Meeting",
        meeting_date=date(2026, 10, 1),
        status=status,
    )
    db.add(meeting)
    await db.flush()
    db.add(
        MeetingAttendee(
            organization_id=dept["org_id"],
            meeting_id=meeting.id,
            user_id=dept["user"].id,
            present=True,
        )
    )
    await db.flush()
    return meeting


async def _attendance(db: AsyncSession, meeting_id: str) -> int:
    rows = await db.execute(
        select(MeetingAttendee.id).where(MeetingAttendee.meeting_id == meeting_id)
    )
    return len(rows.all())


class TestApprovedMeeting:
    async def test_service_refuses_and_keeps_attendance(self, dept):
        db = dept["db"]
        meeting = await _meeting(dept, MeetingStatus.APPROVED)

        with pytest.raises(MeetingDeleteRefusedError, match="approved meeting"):
            await MeetingsService(db).delete_meeting(meeting.id, dept["org_id"])

        assert await db.get(Meeting, meeting.id) is not None
        assert await _attendance(db, meeting.id) == 1

    async def test_endpoint_answers_409_with_the_reason(self, dept):
        meeting = await _meeting(dept, MeetingStatus.APPROVED)

        with pytest.raises(HTTPException) as refused:
            await meetings_endpoint.delete_meeting(
                meeting.id, db=dept["db"], current_user=dept["user"]
            )

        assert refused.value.status_code == 409
        assert "attendance" in refused.value.detail


class TestUnapprovedMeeting:
    @pytest.mark.parametrize(
        "status", [MeetingStatus.DRAFT, MeetingStatus.PENDING_APPROVAL]
    )
    async def test_is_deleted_with_its_attendance(self, dept, status):
        db = dept["db"]
        meeting = await _meeting(dept, status)
        meeting_id = meeting.id

        deleted, error = await MeetingsService(db).delete_meeting(
            meeting_id, dept["org_id"]
        )

        assert (deleted, error) == (True, None)
        found = await db.execute(select(Meeting.id).where(Meeting.id == meeting_id))
        assert found.scalar_one_or_none() is None
        assert await _attendance(db, meeting_id) == 0
