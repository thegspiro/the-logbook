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
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

from app.api.v1.endpoints.historical_import import undo_step
from app.models.admin_hours import AdminHoursEntry
from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.event import Event, EventRSVP
from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.qualification import MemberQualification
from app.models.training import (
    Shift,
    ShiftAssignment,
    TrainingRecord,
    TrainingSession,
    TrainingStatus,
)
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


class TestAPendingWaiverOnAnUndoneDrill:
    """Undoing the drills deletes their events, which voids any pending
    waiver request on them; the member is emailed, as for any other deleted
    session (CLAUDE.md pitfall #18), once the undo has committed."""

    @pytest.fixture
    def outbox(self, monkeypatch):
        sent = []

        class FakeEmailService:
            def __init__(self, organization=None):
                self.organization = organization

            async def send_email(self, **kwargs):
                sent.append(SimpleNamespace(**kwargs))
                return True

        import app.services.email_service as email_service

        monkeypatch.setattr(email_service, "EmailService", FakeEmailService)
        return sent

    async def test_the_member_is_emailed_once(self, db_session, outbox):
        service, org, admin, record = await TestTrainingAndDrills()._committed(
            db_session
        )
        event = (
            await db_session.execute(select(Event).where(Event.organization_id == org))
        ).scalar_one()
        member = await db_session.get(User, admin)
        request = AttendanceWaiverRequest(
            organization_id=org,
            workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
            user_id=admin,
            event_id=str(event.id),
            event_title_snapshot="Company Drill",
            event_start_snapshot=event.start_datetime,
            session_date=event.start_datetime.date(),
            status=AttendanceWaiverStatus.PENDING,
        )
        db_session.add(request)
        await db_session.commit()

        await undo_step(
            import_id=record.id, step="drills", db=db_session, current_user=member
        )

        closed = await db_session.get(
            AttendanceWaiverRequest, request.id, populate_existing=True
        )
        assert closed.status == AttendanceWaiverStatus.VOIDED
        (mail,) = outbox
        assert mail.to_emails == [member.email]
        assert mail.subject == "Waiver request closed — Company Drill"


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


class TestStaffingRoster:
    """The roster fills the hours import's shift for LA106 on 2 May 2016 and
    re-seats Alice on it; everything else it makes."""

    async def _committed(self, db_session):
        from app.models.training import Shift as ShiftModel
        from app.services.historical_staffing_commit import (
            HistoricalStaffingCommitService,
        )
        from tests.test_historical_staffing_commit import (
            _hours_shift,
            _setup,
            _user,
        )

        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        hours_shift = await _hours_shift(db_session, org, alice)
        # Made by an earlier step, as it would have been: a day before.
        earlier = datetime.now(timezone.utc) - timedelta(days=1)
        await db_session.execute(
            update(ShiftModel)
            .where(ShiftModel.id == hours_shift.id)
            .values(created_at=earlier, updated_at=earlier)
        )
        await db_session.execute(
            update(ShiftAssignment)
            .where(ShiftAssignment.shift_id == hours_shift.id)
            .values(created_at=earlier, updated_at=earlier)
        )
        await db_session.commit()
        await HistoricalStaffingCommitService(db_session).commit(org, import_id, admin)
        from app.services.historical_import_service import HistoricalImportService

        return HistoricalImportService(db_session), org, admin, import_id, hours_shift

    async def test_undo_removes_what_the_roster_made_and_keeps_what_it_used(
        self, db_session
    ):
        service, org, admin, import_id, hours_shift = await self._committed(db_session)
        alice_seat = (
            (
                await db_session.execute(
                    select(ShiftAssignment).where(
                        ShiftAssignment.shift_id == hours_shift.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(alice_seat) == 2  # Alice re-seated, Bob added

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, import_id)
        )
        counts = await _undo(db_session, service, org, import_id, "staffing", admin)

        # The hours shift and Alice's seat on it were used, not made.
        assert preview["steps"]["staffing"]["reused"] == 2
        assert preview["steps"]["staffing"]["positions_restored"] == 1
        assert counts["kept"] == 0
        assert counts["positions_restored"] == 1
        remaining = (
            (
                await db_session.execute(
                    select(ShiftAssignment.position).where(
                        ShiftAssignment.organization_id == org
                    )
                )
            )
            .scalars()
            .all()
        )
        # Alice goes back to the seat the hours import gave her: the commit
        # recorded it when the roster re-seated her as driver.
        assert remaining == ["firefighter"]
        assert await db_session.get(Shift, hours_shift.id) is not None
        assert await _count(db_session, Shift, org) == 1
        assert await _count(db_session, Event, org) == 0
        assert await _count(db_session, EventRSVP, org) == 0
        for kind in (
            ImportedRecordKind.SHIFT,
            ImportedRecordKind.SHIFT_ASSIGNMENT,
            ImportedRecordKind.EVENT,
            ImportedRecordKind.EVENT_RSVP,
        ):
            assert await _ledger(db_session, org, kind) == 0
        assert "staffing" not in (await service.get(org, import_id)).results

    async def test_a_roster_event_someone_was_added_to_is_kept(self, db_session):
        service, org, admin, import_id, _ = await self._committed(db_session)
        party = (
            await db_session.execute(
                select(Event).where(
                    Event.organization_id == org, Event.title == "Birthday Party"
                )
            )
        ).scalar_one()
        db_session.add(
            EventRSVP(
                organization_id=org,
                event_id=party.id,
                user_id=admin,
                status="going",
            )
        )
        await db_session.commit()

        counts = await _undo(db_session, service, org, import_id, "staffing", admin)

        assert counts["kept"] == 1
        kept = await db_session.get(Event, party.id)
        assert kept is not None
        # Its ledger entry stays, so committing again uses it, not a copy.
        assert await _ledger(db_session, org, ImportedRecordKind.EVENT) == 1

    async def test_the_roster_commits_again_after_undo(self, db_session):
        from app.services.historical_staffing_commit import (
            HistoricalStaffingCommitService,
        )

        service, org, admin, import_id, _ = await self._committed(db_session)
        await _undo(db_session, service, org, import_id, "staffing", admin)

        counts = await HistoricalStaffingCommitService(db_session).commit(
            org, import_id, admin
        )

        assert counts["events_created"] == 3
        assert counts["shifts_created"] == 1
        assert counts["shifts_filled"] == 1

    async def test_an_hours_shift_made_minutes_before_still_counts_as_used(
        self, db_session
    ):
        """The two commits ran close together, so the timestamps cannot tell;
        the hours import's attendance on the shift does."""
        from app.models.training import ShiftAttendance
        from app.services.historical_import_service import HistoricalImportService
        from app.services.historical_staffing_commit import (
            HistoricalStaffingCommitService,
        )
        from tests.test_historical_staffing_commit import (
            _hours_shift,
            _setup,
            _user,
        )

        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        hours_shift = await _hours_shift(db_session, org, alice)
        db_session.add(
            ShiftAttendance(
                shift_id=hours_shift.id, user_id=alice, duration_minutes=600
            )
        )
        await db_session.commit()
        await HistoricalStaffingCommitService(db_session).commit(org, import_id, admin)
        service = HistoricalImportService(db_session)

        await _undo(db_session, service, org, import_id, "staffing", admin)

        assert await db_session.get(Shift, hours_shift.id) is not None
        seats = (
            (
                await db_session.execute(
                    select(ShiftAssignment.user_id).where(
                        ShiftAssignment.shift_id == hours_shift.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert seats == [alice]


class TestShiftHours:
    """The shift and on-call rows, sent as shift history batches and
    committed: in-station and on-call shifts on LA106 with their calls, and
    outside-agency hours on E116."""

    async def _committed(self, db_session):
        from app.services.historical_import_service import HistoricalImportService
        from tests.test_historical_import import _commit_all_batches, _upload, _world

        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, record.id)
        return HistoricalImportService(db_session), org, admin, record.id

    async def test_undo_removes_the_shifts_crew_hours_and_calls(self, db_session):
        from app.models.call_tracking import OrgCall
        from app.models.external_shift_hours import ExternalShiftHours
        from app.models.shift_history_import import ShiftHistoryImport
        from app.models.training import ShiftAttendance

        service, org, admin, import_id = await self._committed(db_session)
        assert await _count(db_session, Shift, org) > 0
        assert await _count(db_session, OrgCall, org) > 0

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, import_id)
        )
        counts = await _undo(db_session, service, org, import_id, "shifts", admin)

        assert preview["steps"]["shifts"]["committed"] is True
        assert counts["removed"] == preview["steps"]["shifts"]["removable"]
        assert await _count(db_session, Shift, org) == 0
        assert await _count(db_session, ShiftAssignment, org) == 0
        assert await _count(db_session, ExternalShiftHours, org) == 0
        assert await _count(db_session, OrgCall, org) == 0
        attendance = await db_session.scalar(
            select(func.count()).select_from(ShiftAttendance)
        )
        assert attendance == 0
        for kind in (
            ImportedRecordKind.SHIFT_ATTENDANCE,
            ImportedRecordKind.EXTERNAL_SHIFT_HOURS,
        ):
            assert await _ledger(db_session, org, kind) == 0
        assert await _count(db_session, ShiftHistoryImport, org) == 0

    async def test_the_rows_can_be_sent_and_committed_again(self, db_session):
        from tests.test_historical_import import _commit_all_batches

        service, org, admin, import_id = await self._committed(db_session)
        before = await _count(db_session, Shift, org)
        await _undo(db_session, service, org, import_id, "shifts", admin)

        await _commit_all_batches(db_session, org, admin, import_id)

        assert await _count(db_session, Shift, org) == before

    async def test_a_shift_someone_else_was_put_on_is_kept(self, db_session):
        service, org, admin, import_id = await self._committed(db_session)
        shift = (
            await db_session.execute(
                select(Shift).where(Shift.organization_id == org).limit(1)
            )
        ).scalar_one()
        db_session.add(
            ShiftAssignment(
                organization_id=org,
                shift_id=shift.id,
                user_id=admin,
                position="officer",
            )
        )
        await db_session.commit()

        counts = await _undo(db_session, service, org, import_id, "shifts", admin)

        assert counts["kept"] == 1
        assert await db_session.get(Shift, shift.id) is not None
        seats = (
            (
                await db_session.execute(
                    select(ShiftAssignment.user_id).where(
                        ShiftAssignment.shift_id == shift.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert seats == [admin]  # the batch's crew went; the added officer stays

    async def test_edited_outside_hours_are_kept(self, db_session):
        from app.models.external_shift_hours import ExternalShiftHours

        service, org, admin, import_id = await self._committed(db_session)
        await db_session.execute(
            update(ExternalShiftHours)
            .where(ExternalShiftHours.organization_id == org)
            .values(updated_at=datetime.now(timezone.utc) + timedelta(hours=1))
        )
        await db_session.commit()

        counts = await _undo(db_session, service, org, import_id, "shifts", admin)

        assert counts["kept"] == 1
        assert await _count(db_session, ExternalShiftHours, org) == 1
        assert (
            await _ledger(db_session, org, ImportedRecordKind.EXTERNAL_SHIFT_HOURS) == 1
        )

    async def test_a_batch_still_in_review_blocks_it(self, db_session):
        from app.services.historical_import_service import HistoricalImportService
        from tests.test_historical_import import _upload, _world

        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        service = HistoricalImportService(db_session)
        await service.create_shift_batches(org, record.id, admin)

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, record.id)
        )

        # Nothing committed yet, so there is nothing to undo either.
        assert preview["steps"]["shifts"]["committed"] is False

    async def test_the_roster_must_be_undone_first(self, db_session):
        service, org, admin, import_id = await self._committed(db_session)
        record = await service.get(org, import_id, for_update=True)
        record.results = {**(record.results or {}), "staffing": {"committed_at": "x"}}
        await db_session.commit()

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, import_id)
        )
        with pytest.raises(UndoNotAllowed, match="staffing roster step first"):
            await _undo(db_session, service, org, import_id, "shifts", admin)

        assert preview["steps"]["shifts"]["blocked_by"] == ["staffing roster"]

    async def test_a_shift_that_already_existed_loses_only_the_batch_crew(
        self, db_session
    ):
        """The in-station crew of 14 Nov 2015 lands on a shift already on the
        schedule for LA106; undoing takes the crew and the calls it filed off
        that shift and leaves the shift."""
        from app.models.call_tracking import OrgCall
        from app.models.training import BasicApparatus, ShiftAttendance
        from app.services.historical_import_service import HistoricalImportService
        from tests.test_historical_import import _commit_all_batches, _upload, _world

        org, admin = await _world(db_session)
        ladder = (
            await db_session.execute(
                select(BasicApparatus).where(BasicApparatus.organization_id == org)
            )
        ).scalar_one()
        earlier = datetime.now(timezone.utc) - timedelta(days=30)
        existing = Shift(
            organization_id=org,
            shift_date=datetime(2015, 11, 14).date(),
            start_time=datetime(2015, 11, 14, 11, 45, tzinfo=timezone.utc),
            end_time=datetime(2015, 11, 14, 23, 45, tzinfo=timezone.utc),
            apparatus_id=ladder.id,
            is_finalized=True,
        )
        db_session.add(existing)
        await db_session.flush()
        await db_session.execute(
            update(Shift)
            .where(Shift.id == existing.id)
            .values(created_at=earlier, updated_at=earlier)
        )
        await db_session.commit()
        record = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, record.id)
        crew_before = await db_session.scalar(
            select(func.count())
            .select_from(ShiftAttendance)
            .where(ShiftAttendance.shift_id == existing.id)
        )
        assert crew_before == 2  # the batch attached to it
        service = HistoricalImportService(db_session)

        preview = await HistoricalImportUndoService(db_session).preview(
            await service.get(org, record.id)
        )
        await _undo(db_session, service, org, record.id, "shifts", admin)

        assert preview["steps"]["shifts"]["reused"] == 1
        kept = await db_session.get(Shift, existing.id)
        await db_session.refresh(kept)
        assert kept is not None
        assert kept.call_count is None
        assert not kept.total_hours
        crew_after = await db_session.scalar(
            select(func.count())
            .select_from(ShiftAttendance)
            .where(ShiftAttendance.shift_id == existing.id)
        )
        assert crew_after == 0
        assert await _count(db_session, ShiftAssignment, org) == 0
        assert await _count(db_session, OrgCall, org) == 0
