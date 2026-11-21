"""A duplicate is a draft, and keeps an organizer.

``duplicate_event`` built the copy field by field and left out ``is_draft``
(model default False) and the organizer pair. Duplicating a hidden draft
therefore published a copy at once, on every member's calendar, with no
organizer to hold its attendance. The copy is now a draft — the officer is
sent straight to its edit form and publishes from there — and carries the
source's organizers, rechecked, with the duplicating officer standing in for
one who can no longer run an event.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.event import Event, EventType
from app.models.user import Organization, User, UserStatus
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


async def _user(db, org, name, status=UserStatus.ACTIVE):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"{name}-{uuid.uuid4().hex[:6]}",
        email=f"{name}-{uuid.uuid4().hex[:6]}@dup.test",
        first_name=name.title(),
        last_name="Tester",
        password_hash="x",
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


async def _source(db, *, is_draft, organizer=None, alternate=None):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Duplicate Draft FD",
        slug=f"dup-draft-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    officer = await _user(db, org, "officer")
    start = datetime.now(timezone.utc) + timedelta(days=30)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        created_by=officer.id,
        title="Quarterly Drill",
        event_type=EventType.BUSINESS_MEETING,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        is_draft=is_draft,
    )
    db.add(event)
    await db.flush()
    return org, officer, event


class TestDuplicateIsADraft:
    async def test_a_draft_copy_stays_a_draft_with_its_organizer(self, db_session):
        org, officer, source = await _source(db_session, is_draft=True)
        organizer = await _user(db_session, org, "olive")
        alternate = await _user(db_session, org, "alex")
        source.organizer_id = organizer.id
        source.alternate_organizer_id = alternate.id
        await db_session.flush()

        copy = await EventService(db_session).duplicate_event(
            source.id, org.id, officer.id
        )

        assert copy.is_draft is True
        assert copy.organizer_id == organizer.id
        assert copy.alternate_organizer_id == alternate.id

    async def test_a_published_source_is_copied_as_a_draft(self, db_session):
        org, officer, source = await _source(db_session, is_draft=False)

        copy = await EventService(db_session).duplicate_event(
            source.id, org.id, officer.id
        )

        assert copy.is_draft is True
        assert copy.organizer_id == officer.id

    async def test_an_organizer_who_left_is_replaced_by_the_duplicating_officer(
        self, db_session
    ):
        org, officer, source = await _source(db_session, is_draft=False)
        departed = await _user(db_session, org, "dana", UserStatus.INACTIVE)
        source.organizer_id = departed.id
        await db_session.flush()

        copy = await EventService(db_session).duplicate_event(
            source.id, org.id, officer.id
        )

        assert copy.organizer_id == officer.id
