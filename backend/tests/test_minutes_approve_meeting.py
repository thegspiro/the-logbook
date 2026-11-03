"""W51-9: approving minutes approves the meeting they record.

Nothing moved a meeting record's status, so every meeting read "Draft" beside
approved, published minutes and stayed deletable after its attendance became
the settled record that membership tiers count.
"""

import uuid
from datetime import date, datetime, timezone

import pytest

from app.models.meeting import Meeting, MeetingStatus, MeetingType
from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import Organization, User
from app.services.meetings_service import MeetingDeleteRefusedError, MeetingsService
from app.services.minute_service import MinuteService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Badge FD", slug=f"badge-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, first):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _meeting(db, org, **extra):
    meeting = Meeting(
        organization_id=org.id,
        title="October business meeting",
        meeting_type=MeetingType.BUSINESS,
        meeting_date=date(2026, 10, 1),
        **extra,
    )
    db.add(meeting)
    await db.flush()
    return meeting


async def _minutes(db, org, meeting_id=None):
    minutes = MeetingMinutes(
        organization_id=org.id,
        title="October business meeting",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        status=MinutesStatus.DRAFT,
        meeting_id=meeting_id,
    )
    db.add(minutes)
    await db.flush()
    return minutes


async def _submit_and_approve(db, org, minutes, secretary, chief):
    service = MinuteService(db)
    await service.submit_for_approval(minutes.id, org.id, secretary.id)
    return await service.approve_minutes(minutes.id, org.id, chief.id)


async def test_approving_minutes_approves_their_meeting(db_session):
    org = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    chief = await _user(db_session, org, "Pat")
    meeting = await _meeting(db_session, org)
    minutes = await _minutes(db_session, org, meeting.id)

    approved = await _submit_and_approve(db_session, org, minutes, secretary, chief)

    await db_session.refresh(meeting)
    assert meeting.status == MeetingStatus.APPROVED
    assert meeting.approved_by == chief.id
    assert approved is not None
    assert meeting.approved_at is not None
    assert meeting.approved_at.replace(tzinfo=None) == approved.approved_at.replace(
        tzinfo=None
    )

    # The point of the status: the settled attendance cannot be deleted.
    with pytest.raises(MeetingDeleteRefusedError):
        await MeetingsService(db_session).delete_meeting(meeting.id, org.id)


async def test_an_already_approved_meeting_keeps_its_original_stamp(db_session):
    org = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    chief = await _user(db_session, org, "Pat")
    original = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
    meeting = await _meeting(
        db_session,
        org,
        status=MeetingStatus.APPROVED,
        approved_by=secretary.id,
        approved_at=original,
    )
    minutes = await _minutes(db_session, org, meeting.id)

    await _submit_and_approve(db_session, org, minutes, secretary, chief)

    await db_session.refresh(meeting)
    assert meeting.approved_by == secretary.id
    assert meeting.approved_at.replace(tzinfo=None) == original.replace(tzinfo=None)


async def test_minutes_with_no_meeting_still_approve(db_session):
    org = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    chief = await _user(db_session, org, "Pat")
    minutes = await _minutes(db_session, org)

    approved = await _submit_and_approve(db_session, org, minutes, secretary, chief)

    assert approved is not None
    assert approved.status == MinutesStatus.APPROVED


async def test_another_departments_meeting_is_left_alone(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    chief = await _user(db_session, org, "Pat")
    foreign = await _meeting(db_session, other)
    # A link written before the org check existed must not reach across.
    minutes = await _minutes(db_session, org, foreign.id)

    await _submit_and_approve(db_session, org, minutes, secretary, chief)

    await db_session.refresh(foreign)
    assert foreign.status == MeetingStatus.DRAFT
    assert foreign.approved_by is None
