"""Who is told what when check-in has closed (workflow review W80-8).

The shared refusal tells a member to ask an event organizer to record a late
check-in. Said to the organizer, on the officer's Check In dialog, it sent them
in a circle; the officer's path now names the control that records a late
arrival. A member's own check-in keeps the original wording.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.event import EventCreate
from app.services.event_service import CHECK_IN_CLOSED_PREFIX, EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def past_event(db_session: AsyncSession):
    org, officer, member = _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org, "slug": f"org-{org[:8]}"},
    )
    for user_id, first in ((officer, "Officer"), (member, "Pat")):
        await db_session.execute(
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
    await db_session.flush()
    start = (datetime.now(timezone.utc) - timedelta(hours=8)).replace(
        second=0, microsecond=0
    )
    event = await EventService(db_session).create_event(
        EventCreate(
            title="Hose Drill",
            event_type="training",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            requires_rsvp=False,
        ),
        organization_id=org,
        created_by=officer,
    )
    return org, str(event.id), member


async def test_the_officer_is_pointed_to_add_a_member(db_session, past_event):
    org, event_id, member = past_event

    rsvp, error = await EventService(db_session).check_in_attendee(
        uuid.UUID(event_id), uuid.UUID(member), org
    )

    assert rsvp is None
    assert error == (
        "Check-in has closed for this event. To record a member who was there, "
        "use Add a member and enter when they arrived and left."
    )
    assert "Ask an event organizer" not in error


async def test_a_member_is_still_told_to_ask_an_organizer(db_session, past_event):
    org, event_id, member = past_event

    _, error, _ = await EventService(db_session).self_check_in(event_id, member, org)

    assert error is not None
    assert error.startswith(CHECK_IN_CLOSED_PREFIX)
    assert "Ask an event organizer to record a late check-in." in error
