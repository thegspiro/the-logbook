"""The recipients of an event email are loaded inside the event's department.

``EventService._event_email_recipients`` turns a list of member ids into the
members who are emailed, in one query. Only a real database proves the query
half: that a member of another department, or a deleted member, is never
emailed even when their id is in the list, and that an opt-out stored in the
JSON preferences column is honoured.
"""

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.email_policy import EmailKind
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    return org_id


async def _user(db: AsyncSession, org_id: str, *, prefs=None, deleted=False) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences, "
            "deleted_at) "
            "VALUES (:id, :org, :un, 'Jo', 'Smith', :em, 'hashed', 'active', "
            ":prefs, :deleted)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "em": f"{user_id[:8]}@test.com",
            "prefs": json.dumps(prefs) if prefs is not None else None,
            "deleted": "2026-01-01 00:00:00" if deleted else None,
        },
    )
    return user_id


async def test_only_this_departments_members_who_want_it_are_returned(
    db_session: AsyncSession,
):
    org_id = await _org(db_session)
    other_org = await _org(db_session)
    wants_it = await _user(db_session, org_id)
    opted_out = await _user(
        db_session, org_id, prefs={"email_kinds": {"event_changes": False}}
    )
    deleted = await _user(db_session, org_id, deleted=True)
    outsider = await _user(db_session, other_org)
    await db_session.flush()

    org, recipients = await EventService(db_session)._event_email_recipients(
        [wants_it, opted_out, deleted, outsider], org_id, EmailKind.EVENT_CHANGES
    )

    assert org is not None
    assert str(org.id) == org_id
    assert [str(u.id) for u in recipients] == [wants_it]


async def test_a_required_kind_reaches_a_member_who_opted_out(
    db_session: AsyncSession,
):
    org_id = await _org(db_session)
    opted_out = await _user(db_session, org_id, prefs={"email_notifications": False})
    await db_session.flush()

    _, recipients = await EventService(db_session)._event_email_recipients(
        [opted_out], org_id, EmailKind.DEPARTMENT_MESSAGES
    )

    assert [str(u.id) for u in recipients] == [opted_out]
