"""Draft events are visible to organizers only, enforced on the server.

``GET /events`` passed the client's ``include_drafts`` straight to the query,
and ``GET /events/{id}`` had no draft check at all, so any signed-in member
could read unannounced events with ``?include_drafts=true``. The page only
asks for drafts when the caller can manage events; the server now decides the
same thing itself.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints import events as ep

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def department(db_session):
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Draft FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"draft-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Jo', 'Smith', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "em": f"{user_id[:8]}@test.com",
        },
    )
    events = {}
    start = datetime.now(timezone.utc) + timedelta(days=7)
    for title, is_draft in (("Published drill", 0), ("Unannounced drill", 1)):
        event_id = _uid()
        await db_session.execute(
            text(
                # reminder_schedule is NOT NULL with only a Python-side default.
                "INSERT INTO events (id, organization_id, title, event_type, "
                "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
                "is_cancelled, is_draft, reminder_schedule) "
                "VALUES (:id, :org, :title, 'training', :start, :end, 1, 0, "
                "0, :draft, '[24]')"
            ),
            {
                "id": event_id,
                "org": org_id,
                "title": title,
                "start": start,
                "end": start + timedelta(hours=2),
                "draft": is_draft,
            },
        )
        events[title] = event_id
    await db_session.flush()
    return org_id, user_id, events


def _caller(org_id, user_id, permissions):
    return SimpleNamespace(
        id=user_id,
        username="caller",
        organization_id=org_id,
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
        roles=[],
    )


async def _titles(db_session, caller):
    items = await ep.list_events(
        event_type=None,
        custom_category=None,
        exclude_event_types=None,
        start_after=None,
        start_before=None,
        end_after=None,
        end_before=None,
        include_cancelled=False,
        include_drafts=True,
        mandatory_only=False,
        skip=0,
        limit=100,
        db=db_session,
        current_user=caller,
    )
    return sorted(i.title for i in items)


class TestMemberAskingForDrafts:
    async def test_the_list_ignores_include_drafts(self, db_session, department):
        org_id, user_id, _ = department
        member = _caller(org_id, user_id, ["events.view"])

        assert await _titles(db_session, member) == ["Published drill"]

    async def test_a_draft_by_id_answers_not_found(self, db_session, department):
        org_id, user_id, events = department
        member = _caller(org_id, user_id, ["events.view"])

        with pytest.raises(HTTPException) as exc:
            await ep.get_event(
                uuid.UUID(events["Unannounced drill"]),
                db=db_session,
                current_user=member,
            )

        assert exc.value.status_code == 404


class TestOrganizer:
    async def test_events_manage_sees_drafts(self, db_session, department):
        org_id, user_id, events = department
        organizer = _caller(org_id, user_id, ["events.manage"])

        assert await _titles(db_session, organizer) == [
            "Published drill",
            "Unannounced drill",
        ]
        draft = await ep.get_event(
            uuid.UUID(events["Unannounced drill"]),
            db=db_session,
            current_user=organizer,
        )
        assert draft.title == "Unannounced drill"
