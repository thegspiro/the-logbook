"""Two follow-ups from the W80 training-event review.

W80-14: a member's self check-in to a training session starts an in-progress
training record; an officer checking the same member in (Check In, or adding
them as checked in) started none, so the member's training page disagreed
with their attendance until finalize.

W80-15: credit an event took back (the event deleted or cancelled, or the
member removed from it) left the record reading "Cancelled" with no reason.
It now carries one for the member, and loses it again if the member is put
back and credited.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.event import EventCreate, RSVPOverride
from app.schemas.training_session import TrainingSessionCreate
from app.services.event_service import EventService
from app.services.training_session_service import TrainingSessionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _user(db: AsyncSession, org: str, first: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org, "slug": f"org-{org[:8]}"},
    )
    officer = await _user(db_session, org, "Officer")
    member = await _user(db_session, org, "Pat")
    await db_session.flush()
    return org, officer, member


def _minute(value: datetime) -> datetime:
    return value.replace(second=0, microsecond=0)


async def _live_session(db, org, officer) -> str:
    """A training session under way, which starts records on check-in."""
    start = _minute(datetime.now(timezone.utc) - timedelta(minutes=30))
    session, error = await TrainingSessionService(db).create_training_session(
        TrainingSessionCreate(
            title="Ladder Drill",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            requires_rsvp=False,
            training_type="skills_practice",
            credit_hours=2,
            course_name="Ladder Operations",
            auto_create_records=True,
        ),
        organization_id=org,
        created_by=officer,
    )
    assert error is None
    return str(session.event_id)


async def _records(db, user_id: str) -> list:
    rows = await db.execute(
        text(
            "SELECT status, hours_completed, void_reason, voided_at "
            "FROM training_records WHERE user_id = :u"
        ),
        {"u": user_id},
    )
    return [dict(r._mapping) for r in rows]


class TestAnOfficersCheckInStartsTheRecord:
    async def test_check_in(self, db_session, dept):
        org, officer, member = dept
        event_id = await _live_session(db_session, org, officer)

        _, error = await EventService(db_session).check_in_attendee(
            uuid.UUID(event_id), uuid.UUID(member), org
        )

        assert error is None
        assert [r["status"] for r in await _records(db_session, member)] == [
            "in_progress"
        ]

    async def test_adding_them_as_checked_in(self, db_session, dept):
        org, officer, member = dept
        event_id = await _live_session(db_session, org, officer)

        _, error = await EventService(db_session).manager_add_attendee(
            event_id, member, org, officer, checked_in=True
        )

        assert error is None
        assert [r["status"] for r in await _records(db_session, member)] == [
            "in_progress"
        ]

    async def test_adding_them_without_a_check_in_starts_nothing(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id = await _live_session(db_session, org, officer)

        await EventService(db_session).manager_add_attendee(
            event_id, member, org, officer, checked_in=False
        )

        assert await _records(db_session, member) == []


class TestWithdrawnCreditSaysWhy:
    async def _credited(self, db, org, officer, member):
        """A past training event, the member credited and attendance
        reopened, as an officer correcting it would leave it."""
        start = _minute(datetime.now(timezone.utc) - timedelta(hours=8))
        end = start + timedelta(hours=2)
        service = EventService(db)
        event = await service.create_event(
            EventCreate(
                title="Hose Drill",
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            organization_id=org,
            created_by=officer,
        )
        event_id = str(event.id)
        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=False
        )
        await service.override_rsvp_attendance(
            event_id,
            member,
            org,
            officer,
            RSVPOverride(override_check_in_at=start, override_check_out_at=end),
        )
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        return event_id, start, end

    async def test_removing_the_member_records_why(self, db_session, dept):
        org, officer, member = dept
        event_id, _, _ = await self._credited(db_session, org, officer, member)

        error = await EventService(db_session).remove_attendee(
            uuid.UUID(event_id), uuid.UUID(member), org
        )

        assert error is None
        [record] = await _records(db_session, member)
        assert record["status"] == "cancelled"
        assert record["hours_completed"] == 0
        assert (
            record["void_reason"]
            == "Credit withdrawn: removed from 'Hose Drill' attendance."
        )
        # Not an officer's void: that would lock the record against edits.
        assert record["voided_at"] is None

    async def test_crediting_them_again_clears_it(self, db_session, dept):
        org, officer, member = dept
        event_id, start, end = await self._credited(db_session, org, officer, member)
        service = EventService(db_session)
        await service.remove_attendee(uuid.UUID(event_id), uuid.UUID(member), org)

        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=False
        )
        await service.override_rsvp_attendance(
            event_id,
            member,
            org,
            officer,
            RSVPOverride(override_check_in_at=start, override_check_out_at=end),
        )
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        [record] = await _records(db_session, member)
        assert (record["status"], record["hours_completed"]) == ("completed", 2.0)
        assert record["void_reason"] is None
