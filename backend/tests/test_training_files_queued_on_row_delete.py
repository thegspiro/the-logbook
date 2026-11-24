"""Workflows that delete a training row queue the files it named.

An event void deleting a never-credited record, and a historical import undo
deleting imported records or a drill's event, removed the row and left every
file it named in the uploads volume with nothing recording it (owner decision
2026-11-23, batch A item 4). The rows go on ``pending_file_deletions`` in the
same transaction; the hourly sweep removes each file once it commits, keeping
any another row still names.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from app.models.event import Event, EventType
from app.models.pending_file_deletion import PendingFileDeletion
from app.models.training import TrainingRecord, TrainingSession, TrainingStatus
from app.models.user import Organization, User, UserStatus
from app.services import file_storage_service
from app.services.historical_import_undo import HistoricalImportUndoService
from app.services.training_session_service import TrainingSessionService
from tests.test_historical_import_drills import _drill_world

pytestmark = pytest.mark.integration


@pytest.fixture
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return uploads


def _stored(root, org_id, area):
    directory = root / str(org_id) / area / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(b"%PDF-1.4")
    return path


def _entry(path):
    return {"id": uuid.uuid4().hex, "file_name": "a.pdf", "file_path": str(path)}


async def _queued(db, org_id):
    return sorted(
        (
            await db.execute(
                select(
                    PendingFileDeletion.path,
                    PendingFileDeletion.area,
                    PendingFileDeletion.reason,
                ).where(PendingFileDeletion.organization_id == str(org_id))
            )
        ).all()
    )


class TestVoidingAnEventsRecords:
    async def _world(self, db):
        org = Organization(name="Void FD", slug=f"void-{uuid.uuid4().hex[:8]}")
        db.add(org)
        await db.flush()
        suffix = uuid.uuid4().hex[:8]
        member = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"m-{suffix}",
            email=f"m-{suffix}@example.org",
            first_name="Pat",
            last_name="Member",
            status=UserStatus.ACTIVE,
        )
        start = datetime(2026, 3, 1, 9, tzinfo=UTC)
        event = Event(
            organization_id=org.id,
            title="Ladder drill",
            event_type=EventType.TRAINING,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
        )
        db.add_all([member, event])
        await db.flush()
        return org, member, event

    def _record(self, org, member, event, attachments, **overrides):
        fields = dict(
            organization_id=org.id,
            user_id=member.id,
            course_name="Ladder drill",
            training_type="certification",
            status=TrainingStatus.IN_PROGRESS,
            hours_completed=0.0,
            source_event_id=event.id,
            attachments=attachments,
        )
        fields.update(overrides)
        return TrainingRecord(**fields)

    async def test_a_deleted_placeholders_files_are_queued(self, db_session, root):
        org, member, event = await self._world(db_session)
        own = _stored(root, org.id, "training-records")
        certificate = _stored(root, org.id, "self-reports")
        db_session.add(
            self._record(org, member, event, [_entry(own), _entry(certificate)])
        )
        await db_session.flush()

        changed = await TrainingSessionService(db_session).void_event_records(
            event.id, org.id
        )
        await db_session.flush()

        assert changed == 1
        assert await _queued(db_session, org.id) == sorted(
            [
                (str(own.resolve()), "training-records", "event_records_voided"),
                (str(certificate.resolve()), "self-reports", "event_records_voided"),
            ]
        )

    async def test_a_cancelled_record_keeps_its_files_unqueued(self, db_session, root):
        org, member, event = await self._world(db_session)
        own = _stored(root, org.id, "training-records")
        db_session.add(
            self._record(
                org,
                member,
                event,
                [_entry(own)],
                status=TrainingStatus.COMPLETED,
                completion_date=date(2026, 3, 1),
                hours_completed=2.0,
            )
        )
        await db_session.flush()

        await TrainingSessionService(db_session).void_event_records(event.id, org.id)
        await db_session.flush()

        assert await _queued(db_session, org.id) == []


class TestUndoingAHistoricalImport:
    async def _committed(self, db):
        service, org, admin, record, active, _ = await _drill_world(db)
        await service.commit_training(org, record.id, admin)
        await service.update_training_settings(
            await service.get(org, record.id), {"drill_requirement_ids": [active.id]}
        )
        await service.commit_drills(org, record.id, admin)
        return service, org, admin, record

    async def _undo(self, db, service, org, record_id, step, by):
        record = await service.get(org, record_id, for_update=True)
        counts = await HistoricalImportUndoService(db).undo(record, step, by)
        await db.commit()
        return counts

    async def test_the_drill_events_and_imported_records_files_are_queued(
        self, db_session, root
    ):
        service, org, admin, record = await self._committed(db_session)
        event_id = await db_session.scalar(
            select(TrainingSession.event_id).where(
                TrainingSession.organization_id == org
            )
        )
        record_id = await db_session.scalar(
            select(TrainingRecord.id)
            .where(TrainingRecord.organization_id == org)
            .order_by(TrainingRecord.id)
            .limit(1)
        )
        flyer = _stored(root, org, "event-attachments")
        sheet = _stored(root, org, "training-records")
        # Written without moving updated_at, as an attachment added within
        # the edit tolerance would be: otherwise the undo keeps the row as
        # an officer's edit, and its files with it.
        await db_session.execute(
            update(Event)
            .where(Event.id == event_id)
            .values(attachments=[_entry(flyer)], updated_at=Event.updated_at)
        )
        await db_session.execute(
            update(TrainingRecord)
            .where(TrainingRecord.id == record_id)
            .values(attachments=[_entry(sheet)], updated_at=TrainingRecord.updated_at)
        )
        await db_session.commit()

        await self._undo(db_session, service, org, record.id, "drills", admin)
        await self._undo(db_session, service, org, record.id, "training", admin)

        assert await _queued(db_session, org) == sorted(
            [
                (str(flyer.resolve()), "event-attachments", "historical_import_undone"),
                (str(sheet.resolve()), "training-records", "historical_import_undone"),
            ]
        )
        assert flyer.exists()
        assert sheet.exists()
