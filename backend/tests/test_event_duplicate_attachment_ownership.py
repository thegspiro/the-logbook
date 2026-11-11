"""A duplicated event's attachment delete leaves the original's file alone.

``EventService.duplicate_event`` copies the source's attachment metadata, so
both events name the same stored file. The rolling-series job avoids copying
attachments for fear that one event's delete would remove a file the other
still references. ``delete_event_attachment`` guards against exactly that:
it removes the file only when no other event in the organization still
names it. This proves the guard against a real database, through the real
JSON containment query, on a real duplicate.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

import app.api.v1.endpoints.events as events_endpoint
from app.api.v1.endpoints.events import delete_event_attachment
from app.models.event import Event, EventType
from app.models.user import Organization, User, UserStatus
from app.services import file_storage_service
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


@pytest.fixture
def removed_paths(monkeypatch):
    removed = []

    async def record(ref):
        if ref:
            removed.append(ref)

    monkeypatch.setattr(events_endpoint.file_storage, "delete_quietly", record)
    return removed


async def test_deleting_from_the_copy_keeps_the_originals_file(
    db_session, removed_paths
):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Duplicate Attachment FD",
        slug=f"dup-att-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    officer = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"dup-att-{uuid.uuid4().hex[:6]}",
        email=f"dup-{uuid.uuid4().hex[:6]}@att.test",
        first_name="Olive",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(officer)
    await db_session.flush()
    file_path = os.path.join(
        file_storage_service.UPLOADS_ROOT,
        str(org.id),
        "event-attachments",
        str(uuid.uuid4()),
        "readahead.pdf",
    )
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
    source = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Ladder Drill",
        event_type=EventType.TRAINING,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        created_by=officer.id,
        attachments=[
            {"id": "att-1", "file_name": "readahead.pdf", "file_path": file_path}
        ],
    )
    db_session.add(source)
    await db_session.flush()

    copy = await EventService(db_session).duplicate_event(source.id, org.id, officer.id)
    assert copy is not None
    assert [a["file_path"] for a in copy.attachments] == [file_path]
    actor = SimpleNamespace(id=officer.id, organization_id=org.id)

    await delete_event_attachment(uuid.UUID(copy.id), "att-1", db_session, actor)

    assert removed_paths == []
    original = (
        await db_session.execute(
            select(Event)
            .where(Event.id == source.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert [a["file_path"] for a in original.attachments] == [file_path]

    # The last reference going does remove it, so the check above could fail.
    await delete_event_attachment(uuid.UUID(source.id), "att-1", db_session, actor)

    assert len(removed_paths) == 1
