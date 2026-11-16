"""Undoing one committed step of a historical import.

Pins the owner's decisions of 2026-11-16:

* each step is undone on its own, and a step a later one builds on waits for
  that one (training waits for the drills);
* a record changed since the import wrote it is kept, with its ledger entry,
  and listed;
* a former member the import created goes only when nothing refers to them;
* undoing leaves the step as though never committed: committing again writes
  what was removed, and nothing that was kept.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

from app.api.v1.endpoints.historical_import import undo_step
from app.models.admin_hours import AdminHoursEntry
from app.models.event import Event
from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.qualification import MemberQualification
from app.models.training import TrainingRecord, TrainingSession, TrainingStatus
from app.models.user import User
from app.services.historical_import_undo import (
    EDIT_TOLERANCE,
    HistoricalImportUndoService,
    UndoNotAllowed,
    changed_since,
)
from tests.test_historical_import import _admin_world, _training_world
from tests.test_historical_import_drills import _drill_world

pytestmark = pytest.mark.integration


async def _count(db, model, org):
    return await db.scalar(
        select(func.count()).select_from(model).where(model.organization_id == org)
    )


async def _ledger(db, org, kind):
    return await db.scalar(
        select(func.count())
        .select_from(ImportedSourceRecord)
        .where(
            ImportedSourceRecord.organization_id == org,
            ImportedSourceRecord.record_kind == kind.value,
        )
    )


async def _former_member(db, org):
    return (
        await db.execute(
            select(User).where(
                User.organization_id == org, User.membership_number == "6178"
            )
        )
    ).scalar_one_or_none()


async def _admin_committed(db_session):
    org, admin, categories, record = await _admin_world(db_session)
    from app.services.historical_import_service import HistoricalImportService

    service = HistoricalImportService(db_session)
    await service.update_member_mappings(
        await service.get(org, record.id), {"number:6178": {"action": "create"}}
    )
    await service.commit_admin(org, record.id, admin)
    return service, org, admin, record


async def _undo(db, service, org, record_id, step, by):
    record = await service.get(org, record_id, for_update=True)
    counts = await HistoricalImportUndoService(db).undo(record, step, by)
    await db.commit()
    return counts


@pytest.mark.unit
class TestTheEditRule:
    def test_a_record_stamped_with_its_commit_is_unchanged(self):
        at = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
        assert changed_since(at + timedelta(seconds=30), at) is False
        assert changed_since(at + EDIT_TOLERANCE + timedelta(seconds=1), at) is True
        # A naive database time is UTC.
        assert changed_since(at.replace(tzinfo=None), at) is False


class TestAdminHours:
    async def test_undo_removes_the_entries_and_the_member_it_created(self, db_session):
        service, org, admin, record = await _admin_committed(db_session)
        assert await _former_member(db_session, org) is not None

        counts = await _undo(db_session, service, org, record.id, "admin", admin)

        assert counts == {
            "removed": 4,
            "kept": 0,
            "members_removed": 1,
            "members_kept": 0,
        }
        assert await _count(db_session, AdminHoursEntry, org) == 0
        assert await _ledger(db_session, org, ImportedRecordKind.ADMIN_HOURS_ENTRY) == 0
        assert await _former_member(db_session, org) is None
        stored = await service.get(org, record.id)
        assert "admin" not in stored.results
        assert [u["step"] for u in stored.results["undone"]] == ["admin"]
        assert stored.member_mappings["number:6178"] == {"action": "create"}

    async def test_the_step_can_be_committed_again_after_undo(self, db_session):
        service, org, admin, record = await _admin_committed(db_session)
        await _undo(db_session, service, org, record.id, "admin", admin)

        counts = await service.commit_admin(org, record.id, admin)

        assert counts == {"entries_created": 4, "members_created": 1}
        assert await _count(db_session, AdminHoursEntry, org) == 4

    async def test_an_edited_entry_is_kept_and_not_written_again(self, db_session):
        service, org, admin, record = await _admin_committed(db_session)
        # The former member's own entry, so the member it names stays too.
        member = await _former_member(db_session, org)
        edited = (
            await db_session.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.organization_id == org,
                    AdminHoursEntry.user_id == member.id,
                )
            )
        ).scalar_one()
        await db_session.execute(
            update(AdminHoursEntry)
            .where(AdminHoursEntry.id == edited.id)
            .values(updated_at=datetime.now(timezone.utc) + timedelta(hours=1))
        )
        await db_session.commit()

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, record.id)
        )
        counts = await _undo(db_session, service, org, record.id, "admin", admin)
        recommitted = await service.commit_admin(org, record.id, admin)

        assert preview["steps"]["admin"]["removable"] == 3
        assert preview["steps"]["admin"]["kept_total"] == 1
        assert preview["steps"]["admin"]["kept"][0]["record_id"] == edited.id
        assert (counts["removed"], counts["kept"]) == (3, 1)
        assert (counts["members_removed"], counts["members_kept"]) == (0, 1)
        assert recommitted["entries_created"] == 3
        assert await _count(db_session, AdminHoursEntry, org) == 4

    async def test_an_entry_deleted_by_hand_comes_back_on_recommit(self, db_session):
        service, org, admin, record = await _admin_committed(db_session)
        gone = (
            await db_session.execute(
                select(AdminHoursEntry.id)
                .where(AdminHoursEntry.organization_id == org)
                .limit(1)
            )
        ).scalar_one()
        await db_session.execute(
            AdminHoursEntry.__table__.delete().where(AdminHoursEntry.id == gone)
        )
        await db_session.commit()

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, record.id)
        )
        await _undo(db_session, service, org, record.id, "admin", admin)

        assert preview["steps"]["admin"]["already_gone"] == 1
        assert (await service.commit_admin(org, record.id, admin))[
            "entries_created"
        ] == 4

    async def test_a_member_something_else_refers_to_is_kept(self, db_session):
        service, org, admin, record = await _admin_committed(db_session)
        member = await _former_member(db_session, org)
        db_session.add(
            TrainingRecord(
                organization_id=org,
                user_id=member.id,
                course_name="Entered by hand",
                training_type="continuing_education",
                hours_completed=1,
                status=TrainingStatus.COMPLETED,
            )
        )
        await db_session.commit()

        counts = await _undo(db_session, service, org, record.id, "admin", admin)

        assert (counts["members_removed"], counts["members_kept"]) == (0, 1)
        assert await _former_member(db_session, org) is not None

    async def test_an_uncommitted_step_cannot_be_undone(self, db_session):
        org, admin, _, record = await _admin_world(db_session)
        from app.services.historical_import_service import HistoricalImportService

        service = HistoricalImportService(db_session)
        with pytest.raises(UndoNotAllowed, match="has not been committed"):
            await HistoricalImportUndoService(db_session).undo(
                await service.get(org, record.id), "admin", admin
            )


class TestTrainingAndDrills:
    async def _committed(self, db_session):
        service, org, admin, record, active, _ = await _drill_world(db_session)
        await service.commit_training(org, record.id, admin)
        await service.update_training_settings(
            await service.get(org, record.id), {"drill_requirement_ids": [active.id]}
        )
        await service.commit_drills(org, record.id, admin)
        return service, org, admin, record

    async def test_training_waits_for_the_drills(self, db_session):
        service, org, admin, record = await self._committed(db_session)

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, record.id)
        )
        with pytest.raises(UndoNotAllowed, match="company drills step first"):
            await _undo(db_session, service, org, record.id, "training", admin)

        assert preview["steps"]["training"]["blocked_by"] == ["company drills"]
        assert preview["steps"]["drills"]["blocked_by"] == []

    async def test_undoing_the_drills_then_training_removes_everything(
        self, db_session
    ):
        service, org, admin, record = await self._committed(db_session)
        records_before = await _count(db_session, TrainingRecord, org)

        drills = await _undo(db_session, service, org, record.id, "drills", admin)

        assert drills["removed"] == 1
        assert await _count(db_session, TrainingSession, org) == 0
        assert await _count(db_session, Event, org) == 0
        attached = await db_session.scalar(
            select(func.count())
            .select_from(TrainingRecord)
            .where(
                TrainingRecord.organization_id == org,
                TrainingRecord.source_event_id.is_not(None),
            )
        )
        assert attached == 0
        assert await _count(db_session, TrainingRecord, org) == records_before

        training = await _undo(db_session, service, org, record.id, "training", admin)

        # The drill step's attach was not an officer's edit.
        assert (training["removed"], training["kept"]) == (records_before, 0)
        assert await _count(db_session, TrainingRecord, org) == 0
        assert await _ledger(db_session, org, ImportedRecordKind.TRAINING_RECORD) == 0
        assert await _ledger(db_session, org, ImportedRecordKind.TRAINING_SESSION) == 0

    async def test_training_commits_again_after_both_are_undone(self, db_session):
        service, org, admin, record = await self._committed(db_session)
        before = await _count(db_session, TrainingRecord, org)
        await _undo(db_session, service, org, record.id, "drills", admin)
        await _undo(db_session, service, org, record.id, "training", admin)

        counts = await service.commit_training(org, record.id, admin)

        assert counts["records_created"] == before


class TestEndpoint:
    async def test_an_unknown_step_is_not_found(self, db_session):
        org, admin, _, record = await _admin_world(db_session)
        user = await db_session.get(User, admin)

        with pytest.raises(HTTPException) as refused:
            await undo_step(
                import_id=record.id, step="everything", db=db_session, current_user=user
            )

        assert refused.value.status_code == 404

    async def test_a_blocked_undo_is_a_conflict_message(self, db_session):
        org, admin, _, record = await _admin_world(db_session)
        user = await db_session.get(User, admin)

        with pytest.raises(HTTPException) as refused:
            await undo_step(
                import_id=record.id, step="admin", db=db_session, current_user=user
            )

        assert refused.value.status_code == 400
        assert "has not been committed" in refused.value.detail


class TestTrainingQualifications:
    async def test_undo_takes_back_a_qualification_an_imported_record_granted(
        self, db_session
    ):
        from app.models.training import TrainingCourse
        from app.services.historical_import_service import HistoricalImportService
        from app.services.qualification_service import QualificationService

        org, admin, course, _, record = await _training_world(db_session)
        await db_session.execute(
            update(TrainingCourse)
            .where(TrainingCourse.id == course.id)
            .values(grants_qualification="emt")
        )
        service = HistoricalImportService(db_session)
        await service.accept_suggested_courses(await service.get(org, record.id))
        await service.update_training_settings(
            await service.get(org, record.id), {"unmatched_provider_action": "skip"}
        )
        await service.commit_training(org, record.id, admin)
        emt = (
            await db_session.execute(
                select(TrainingRecord).where(
                    TrainingRecord.organization_id == org,
                    TrainingRecord.course_id == course.id,
                )
            )
        ).scalars()
        qualifications = QualificationService(db_session)
        for imported in emt:
            await qualifications.sync_from_training_record(imported)
        await db_session.commit()
        assert await _count(db_session, MemberQualification, org) > 0

        await _undo(db_session, service, org, record.id, "training", admin)

        assert await _count(db_session, MemberQualification, org) == 0
