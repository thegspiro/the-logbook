"""The "is this file still referenced?" check on attachment delete is not
org-scoped (EV-30).

``delete_event_attachment`` decides whether to remove the file from disk by
counting *any other event in the database* whose ``attachments`` JSON
contains the same ``file_path`` string
(``cast(Event.attachments, String).contains(file_path, autoescape=True)``),
with no ``organization_id`` filter. The function already fetches the event
being edited org-scoped, so this cannot leak another tenant's data back to
the caller — but it can be used to keep a victim org's own file on disk
forever: an attacker-controlled event in a different org (``events.manage``
in their own org is all that takes) that merely holds an attachment entry
naming the victim's exact stored path makes the "others" count positive, so
the victim's own delete never removes the file from storage.

Against a real database: two organizations, two events, the same
``file_path`` string recorded on both. Deleting the victim's own attachment
must remove the file regardless of what a different organization's event
happens to reference.
"""

import os
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import events
from app.models.event import Event
from app.models.user import User
from app.services import file_storage_service

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org_id, "slug": f"o-{org_id[:8]}"},
    )
    return org_id


async def _manager(db, org_id: str) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, "
            "permissions, is_system) VALUES (:id, :org, 'Manager', 'manager', "
            "'[\"events.manage\"]', 0)"
        ),
        {"id": position_id, "org": org_id},
    )
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Manager', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"pat-{user_id[:8]}",
            "em": f"pat-{user_id[:8]}@test.example",
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    return user_id


async def _event_with_attachment(db, org_id: str, file_path: str, attachment_id: str):
    event_id = _uid()
    from datetime import datetime, timedelta, timezone

    start = datetime.now(timezone.utc) - timedelta(hours=1)
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "is_recurring, attachments) "
            "VALUES (:id, :org, 'Drill', 'training', :start, :end, 0, 0, 0, "
            "0, '[24]', 'flexible', 0, :attachments)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "start": start,
            "end": start + timedelta(hours=2),
            "attachments": (
                '[{"id": "%s", "file_name": "f.pdf", "file_path": "%s"}]'
                % (attachment_id, file_path)
            ),
        },
    )
    return event_id


async def _load(db, user_id: str) -> User:
    result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _get_event(db, event_id: str) -> Event:
    result = await db.execute(
        select(Event)
        .where(Event.id == event_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def test_a_different_orgs_event_cannot_keep_the_victims_file_on_disk(
    db_session, monkeypatch
):
    victim_org = await _org(db_session)
    attacker_org = await _org(db_session)
    victim_manager = await _manager(db_session, victim_org)

    file_path = os.path.join(
        file_storage_service.UPLOADS_ROOT,
        "event-attachments",
        victim_org,
        _uid(),
        "report.pdf",
    )

    victim_event = await _event_with_attachment(
        db_session, victim_org, file_path, "att-victim"
    )
    # Attacker's own event, in the attacker's own org, merely records the
    # victim's exact file_path string — no file of the attacker's own.
    await _event_with_attachment(db_session, attacker_org, file_path, "att-attacker")
    await db_session.flush()

    removed = []

    async def record(ref):
        if ref:
            removed.append(ref)

    monkeypatch.setattr(events.file_storage, "delete_quietly", record)

    await events.delete_event_attachment(
        event_id=uuid.UUID(victim_event),
        attachment_id="att-victim",
        db=db_session,
        current_user=await _load(db_session, victim_manager),
    )

    assert removed == [file_path], (
        "the attacker org's unrelated event kept the victim's own file "
        "on disk because the 'still referenced elsewhere' count was not "
        "scoped to the caller's organization"
    )
    event = await _get_event(db_session, victim_event)
    assert event.attachments == []
