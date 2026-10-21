"""The event detail response answers what the list card already answers.

A member opening an event that is happening now had no way to check in from
it, nothing saying they had checked in, and no credit line, because only the
list response carried those fields. And every visit to an event whose roster
is not shared asked for the attendee list anyway and took a 403. The detail
endpoint now reports the same derived fields, from the same helpers, and
whether the attendee list will answer this caller.

Against a real database, because the attended flag comes from the caller's
own RSVP row and the roster rule from the organization's settings.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import events as events_endpoint
from app.models.user import User
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db, settings=None) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone, "
            "settings) VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :s)"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}", "s": json.dumps(settings or {})},
    )
    return org_id


async def _user(db, org_id: str, first: str, permissions=()) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
        },
    )
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, "
            "permissions, is_system) VALUES (:id, :org, :name, :slug, :perms, 0)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"Pos {position_id[:6]}",
            "slug": f"p-{position_id[:8]}",
            "perms": json.dumps(["events.view", *permissions]),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    return user_id


async def _event(db, org_id, creator, *, visibility=None, event_type="other"):
    """An event that started ten minutes ago and runs for two hours."""
    event_id = _uid()
    start = datetime.now(timezone.utc) - timedelta(minutes=10)
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "check_in_minutes_before, created_by, organizer_id, attendee_visibility) "
            "VALUES (:id, :org, 'Hose testing', :type, :start, :end, 0, 0, 0, 0, "
            "'[24]', 'flexible', 60, :creator, :creator, :vis)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "type": event_type,
            "start": start,
            "end": start + timedelta(hours=2),
            "creator": creator,
            "vis": visibility,
        },
    )
    return event_id


async def _rsvp(db, org_id, event_id, user_id, *, checked_in=False, override=False):
    await db.execute(
        text(
            "INSERT INTO event_rsvps (id, organization_id, event_id, user_id, status, "
            "guest_count, responded_at, checked_in, override_check_in_at) "
            "VALUES (:id, :org, :e, :u, 'going', 0, :now, :ci, :ov)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "e": event_id,
            "u": user_id,
            "now": datetime.now(timezone.utc),
            "ci": 1 if checked_in else 0,
            "ov": datetime.now(timezone.utc) if override else None,
        },
    )


async def _load(db, user_id: str) -> User:
    result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _detail(db, event_id, user_id):
    db.expire_all()
    return await events_endpoint.get_event(
        uuid.UUID(event_id), db=db, current_user=await _load(db, user_id)
    )


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    ids = {
        "org": org_id,
        "member": await _user(db_session, org_id, "Sam"),
        "manager": await _user(
            db_session, org_id, "Mona", permissions=["events.manage"]
        ),
    }
    ids["event"] = await _event(db_session, org_id, ids["manager"])
    await db_session.flush()
    return ids


class TestCheckIn:
    async def test_the_window_matches_the_list_rule(self, db_session, dept):
        response = await _detail(db_session, dept["event"], dept["member"])

        event, _ = await EventService(db_session).get_event(
            dept["event"], dept["org"], dept["member"]
        )
        opens, closes = EventService._get_check_in_window(event)
        assert response.check_in_opens_at == opens
        assert response.check_in_closes_at == closes
        assert response.check_in_opens_at < datetime.now(timezone.utc)

    async def test_a_member_who_has_not_checked_in_is_not_attended(
        self, db_session, dept
    ):
        await _rsvp(db_session, dept["org"], dept["event"], dept["member"])
        response = await _detail(db_session, dept["event"], dept["member"])
        assert response.user_attended is False

    async def test_a_scan_marks_the_member_attended(self, db_session, dept):
        await _rsvp(
            db_session, dept["org"], dept["event"], dept["member"], checked_in=True
        )
        response = await _detail(db_session, dept["event"], dept["member"])
        assert response.user_attended is True

    async def test_an_officer_override_counts_as_attended(self, db_session, dept):
        """The list's rule: an override never sets checked_in."""
        await _rsvp(
            db_session, dept["org"], dept["event"], dept["member"], override=True
        )
        response = await _detail(db_session, dept["event"], dept["member"])
        assert response.user_attended is True


class TestCredit:
    async def test_it_states_what_the_list_card_states(self, db_session, dept):
        mappings = {("event_type", "other"): [(100, "Meetings & Governance")]}
        with patch.object(
            AdminHoursService,
            "get_active_mappings_by_source",
            new=AsyncMock(return_value=mappings),
        ):
            response = await _detail(db_session, dept["event"], dept["member"])

        assert response.credited_hours == 2.0
        assert response.hour_category_label == "Meetings & Governance"

    async def test_no_mapping_states_no_credit(self, db_session, dept):
        with patch.object(
            AdminHoursService,
            "get_active_mappings_by_source",
            new=AsyncMock(return_value={}),
        ):
            response = await _detail(db_session, dept["event"], dept["member"])

        assert response.credited_hours is None
        assert response.hour_category_label is None


class TestAttendeeVisibility:
    async def test_a_member_is_told_the_roster_is_not_shared(self, db_session, dept):
        response = await _detail(db_session, dept["event"], dept["member"])
        assert response.can_view_attendees is False

        # ...which is the answer the attendee endpoint gives.
        with pytest.raises(HTTPException) as caught:
            await events_endpoint.list_event_attendees(
                uuid.UUID(dept["event"]),
                skip=0,
                limit=100,
                db=db_session,
                current_user=await _load(db_session, dept["member"]),
            )
        assert caught.value.status_code == 403

    async def test_a_manager_may_always_see_it(self, db_session, dept):
        response = await _detail(db_session, dept["event"], dept["manager"])
        assert response.can_view_attendees is True

    async def test_an_event_shared_with_members_says_so(self, db_session, dept):
        shared = await _event(
            db_session, dept["org"], dept["manager"], visibility="members"
        )
        await db_session.flush()
        response = await _detail(db_session, shared, dept["member"])
        assert response.can_view_attendees is True

        # ...and the endpoint agrees.
        rows = await events_endpoint.list_event_attendees(
            uuid.UUID(shared),
            skip=0,
            limit=100,
            db=db_session,
            current_user=await _load(db_session, dept["member"]),
        )
        assert rows == []
