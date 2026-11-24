"""Deleting an event deletes the files attached to it (owner decision
2026-11-23).

``EventService.delete_event`` and ``delete_event_series`` removed the event
rows and left every ``events.attachments`` file on the volume with nothing
recording it. They now queue those files on ``pending_file_deletions`` in the
delete's own transaction and remove them right after the commit; a file
another collected row still names is kept.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.pending_file_deletion import PendingFileDeletion
from app.services import file_storage_service
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX, EventService

pytestmark = [pytest.mark.integration]


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return tmp_path


def _stored(root, org_id):
    directory = root / str(org_id) / "event-attachments" / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(b"%PDF-1.4 readahead")
    return path


def _entry(path):
    return {
        "id": uuid.uuid4().hex,
        "file_name": "readahead.pdf",
        "file_path": str(path),
        "file_type": "application/pdf",
    }


async def _event(db, org, user, attachments, **overrides):
    start = datetime.now(timezone.utc) + timedelta(days=3)
    fields = dict(
        organization_id=org,
        title="Pump drill",
        event_type="training",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        created_by=user,
        attachments=attachments,
    )
    fields.update(overrides)
    event = Event(**fields)
    db.add(event)
    await db.flush()
    return event


async def _queued(db, org):
    return (
        await db.execute(
            select(PendingFileDeletion.path).where(
                PendingFileDeletion.organization_id == str(org)
            )
        )
    ).all()


class TestDeletingOneEvent:
    async def test_its_files_are_removed(self, db_session, setup_org_and_admin, root):
        org, admin = setup_org_and_admin
        first, second = _stored(root, org), _stored(root, org)
        event = await _event(db_session, org, admin, [_entry(first), _entry(second)])
        await db_session.commit()

        assert await EventService(db_session).delete_event(event.id, org)

        assert not first.exists()
        assert not second.exists()
        assert await _queued(db_session, org) == []

    async def test_a_file_another_event_names_is_kept(
        self, db_session, setup_org_and_admin, root
    ):
        org, admin = setup_org_and_admin
        shared = _stored(root, org)
        event = await _event(db_session, org, admin, [_entry(shared)])
        await _event(db_session, org, admin, [_entry(shared)], title="Copy")
        await db_session.commit()

        await EventService(db_session).delete_event(event.id, org)

        assert shared.exists()
        assert await _queued(db_session, org) == []

    async def test_a_file_that_will_not_delete_stays_queued(
        self, db_session, setup_org_and_admin, root, monkeypatch
    ):
        org, admin = setup_org_and_admin
        stuck = _stored(root, org)
        event = await _event(db_session, org, admin, [_entry(stuck)])
        await db_session.commit()
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        await EventService(db_session).delete_event(event.id, org)

        assert stuck.exists()
        assert await _queued(db_session, org) == [(str(stuck.resolve()),)]

    async def test_a_refused_delete_queues_nothing(
        self, db_session, setup_org_and_admin, root
    ):
        org, admin = setup_org_and_admin
        kept = _stored(root, org)
        event = await _event(
            db_session,
            org,
            admin,
            [_entry(kept)],
            attendance_finalized_at=datetime.now(timezone.utc),
        )
        await db_session.commit()

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX):
            await EventService(db_session).delete_event(event.id, org)

        assert kept.exists()
        assert await _queued(db_session, org) == []


class TestDeletingASeries:
    async def test_every_occurrence_s_files_are_removed(
        self, db_session, setup_org_and_admin, root
    ):
        org, admin = setup_org_and_admin
        start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(
            second=0, microsecond=0
        )
        events, error = await EventService(db_session).create_recurring_event(
            {
                "title": "Weekly Drill",
                "event_type": "business_meeting",
                "start_datetime": start,
                "end_datetime": start + timedelta(hours=2),
                "requires_rsvp": False,
                "recurrence_pattern": "weekly",
                "rolling_recurrence": False,
                "recurrence_end_date": start + timedelta(weeks=2, hours=1),
            },
            org,
            admin,
        )
        assert error is None
        files = []
        for occurrence in events:
            path = _stored(root, org)
            files.append(path)
            occurrence.attachments = [_entry(path)]
        await db_session.commit()

        deleted = await EventService(db_session).delete_event_series(events[0].id, org)

        assert deleted == len(events)
        assert [p.exists() for p in files] == [False] * len(files)
        assert await _queued(db_session, org) == []
