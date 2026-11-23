"""
A permanent member delete removes that member — not other members' records —
and the preview says truthfully what goes.

Three defects, each pinned against a real database because every one of them
lives in an ``ON DELETE`` rule or a stock count no mock can see:

* ``skill_tests.examiner_id`` and ``shift_completion_reports.officer_id`` were
  ``CASCADE``: deleting an examiner or a field training officer deleted the
  trainees' evaluations and reports along with them. They are SET NULL now.
* The deletion preview named training records, inventory and documents while
  the delete also took RSVPs, attendance, shift assignments, dues, service
  history, consent records and more. It now counts every CASCADE reference,
  read from the models.
* Deleting a member who still held gear left individual items ``assigned`` to
  nobody, checked-out items ``checked_out`` forever, and pool counts short.
  The gear is now returned through the inventory service first.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import users as users_endpoint
from app.core.audit import log_audit_event as real_log_audit_event
from app.core.database import Base
from app.models.attendance_waiver import (
    AttendanceWaiverAttachment,
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.audit import AuditLog
from app.models.forms import Form, FormSubmission
from app.models.inventory import (
    InventoryItem,
    ItemCondition,
    ItemStatus,
    TrackingType,
)
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    PipelineStepType,
    ProspectActivityLog,
    ProspectDocument,
    ProspectFormRequest,
    ProspectiveMember,
    ProspectStatus,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import (
    Shift,
    ShiftAssignment,
    ShiftCompletionReport,
    StandingShiftClaim,
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.schemas.shift_completion import ShiftCompletionReportResponse
from app.services import file_storage_service, member_files
from app.services.inventory_service import InventoryService
from app.services.pending_file_deletions import PendingFileDeletionSweep
from app.services.scheduled_tasks import run_pending_file_deletions
from app.services.user_deletion_service import _cascading_references
from tests.fake_request import fake_request

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Hard Delete FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"hd-{org_id[:8]}"},
    )
    return org_id


async def _add_member(db, org_id: str, last_name: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"hd_{user_id[:8]}",
            "ln": last_name,
            "em": f"hd_{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


@pytest.fixture
async def department(db_session):
    org_id = await _add_org(db_session)
    return SimpleNamespace(
        org=org_id,
        admin=await _add_member(db_session, org_id, "Admin"),
        examiner=await _add_member(db_session, org_id, "Examiner"),
        trainee=await _add_member(db_session, org_id, "Trainee"),
    )


@pytest.fixture(autouse=True)
def _quiet_guards(monkeypatch):
    """The privilege ceiling and administrator continuity have their own
    tests; the audit log is not what these assert on."""
    monkeypatch.setattr(users_endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(users_endpoint, "_enforce_account_reset_ceiling", AsyncMock())
    monkeypatch.setattr(users_endpoint, "assert_not_last_administrator", AsyncMock())


def _admin(dept) -> SimpleNamespace:
    return SimpleNamespace(id=dept.admin, organization_id=dept.org, username="admin")


async def _hard_delete(db, dept, user_id: str) -> None:
    await users_endpoint.delete_user(
        user_id=UUID(user_id),
        hard=True,
        db=db,
        current_user=_admin(dept),
        request=fake_request(),
    )


def _audit_events() -> dict[str, dict]:
    """The event data of each audit event the patched helper received, by type."""
    return {
        call.kwargs["event_type"]: call.kwargs["event_data"]
        for call in users_endpoint.log_audit_event.await_args_list
    }


async def _fresh(db, model, row_id: str):
    """The row as the database now holds it, not the identity map's copy."""
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _skill_test(db, dept, *, candidate: str, examiner: str) -> SkillTest:
    template = SkillTemplate(
        organization_id=dept.org,
        name=f"SCBA {uuid.uuid4().hex[:6]}",
        sections=[{"title": "Donning", "criteria": []}],
        status="published",
    )
    db.add(template)
    await db.flush()
    test = SkillTest(
        organization_id=dept.org,
        template_id=template.id,
        candidate_id=candidate,
        examiner_id=examiner,
        status="completed",
        result="pass",
    )
    db.add(test)
    await db.flush()
    return test


async def _report(db, dept, *, trainee: str, officer: str) -> ShiftCompletionReport:
    report = ShiftCompletionReport(
        organization_id=dept.org,
        trainee_id=trainee,
        officer_id=officer,
        shift_date=date.today(),
        hours_on_shift=12.0,
        review_status="approved",
    )
    db.add(report)
    await db.flush()
    return report


class TestAnotherMembersRecordsSurvive:
    async def test_trainees_skill_test_survives_examiners_delete(
        self, db_session, department
    ):
        test = await _skill_test(
            db_session,
            department,
            candidate=department.trainee,
            examiner=department.examiner,
        )

        await _hard_delete(db_session, department, department.examiner)

        kept = await _fresh(db_session, SkillTest, test.id)
        assert kept is not None, "the examiner's delete took the trainee's test"
        assert kept.examiner_id is None
        assert kept.candidate_id == department.trainee
        assert kept.result == "pass"

    async def test_trainees_shift_report_survives_officers_delete(
        self, db_session, department
    ):
        report = await _report(
            db_session,
            department,
            trainee=department.trainee,
            officer=department.examiner,
        )

        await _hard_delete(db_session, department, department.examiner)

        kept = await _fresh(db_session, ShiftCompletionReport, report.id)
        assert kept is not None, "the officer's delete took the trainee's report"
        assert kept.officer_id is None
        assert kept.officer_name is None
        # The response a reader gets back must accept the missing officer.
        response = ShiftCompletionReportResponse.model_validate(kept)
        assert response.officer_id is None
        assert response.trainee_id == department.trainee

    async def test_the_deleted_members_own_records_still_go(
        self, db_session, department
    ):
        """SET NULL is for attribution only: the candidate's own test and the
        trainee's own report still CASCADE with them."""
        test = await _skill_test(
            db_session,
            department,
            candidate=department.trainee,
            examiner=department.examiner,
        )
        report = await _report(
            db_session,
            department,
            trainee=department.trainee,
            officer=department.examiner,
        )

        await _hard_delete(db_session, department, department.trainee)

        assert await _fresh(db_session, SkillTest, test.id) is None
        gone = await db_session.scalar(
            select(func.count())
            .select_from(ShiftCompletionReport)
            .where(ShiftCompletionReport.id == report.id)
        )
        assert gone == 0


class TestDeletionImpact:
    async def _seed_member_records(self, db, dept, member: str) -> None:
        now = datetime.now(timezone.utc)
        for days in (2, 9):
            shift = Shift(
                organization_id=dept.org,
                shift_date=(now + timedelta(days=days)).date(),
                start_time=now + timedelta(days=days),
            )
            db.add(shift)
            await db.flush()
            db.add(
                ShiftAssignment(
                    organization_id=dept.org,
                    shift_id=shift.id,
                    user_id=member,
                    position="firefighter",
                )
            )
        db.add(
            StandingShiftClaim(
                organization_id=dept.org,
                user_id=member,
                weekday=2,
                start_date=date.today(),
                end_date=date.today() + timedelta(days=60),
            )
        )
        await db.flush()
        # The member as candidate (theirs) and as examiner (someone else's).
        colleague = await _add_member(db, dept.org, "Colleague")
        await _skill_test(db, dept, candidate=member, examiner=colleague)
        await _skill_test(db, dept, candidate=colleague, examiner=member)

    async def _impact(self, db, dept, member: str):
        return await users_endpoint.get_deletion_impact(
            user_id=UUID(member), db=db, current_user=_admin(dept)
        )

    async def test_counts_every_table_the_delete_removes(self, db_session, department):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)

        impact = await self._impact(db_session, department, member)

        by_table = {r.table: r for r in impact.removed_records}
        assert by_table["shift_assignments"].count == 2
        assert by_table["shift_assignments"].label == "Shift assignments"
        assert by_table["standing_shift_claims"].count == 1
        # Only the test the member sat; the one they examined is kept.
        assert by_table["skill_tests"].count == 1
        assert impact.total_records == sum(r.count for r in impact.removed_records)
        counts = [r.count for r in impact.removed_records]
        assert counts == sorted(counts, reverse=True)
        assert all(r.count > 0 for r in impact.removed_records)

    async def test_preview_matches_what_the_delete_actually_removes(
        self, db_session, department
    ):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)
        impact = await self._impact(db_session, department, member)
        predicted = {r.table: r.count for r in impact.removed_records}

        before = await self._direct_counts(db_session, member)
        await _hard_delete(db_session, department, member)
        after = await self._direct_counts(db_session, member)

        removed = {t: before[t] - after[t] for t in before if before[t] - after[t]}
        assert removed == predicted

    async def _direct_counts(self, db, member: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for table_name, column_name in _cascading_references():
            table = Base.metadata.tables[table_name]
            counts[table_name] = counts.get(table_name, 0) + int(
                await db.scalar(
                    select(func.count())
                    .select_from(table)
                    .where(table.c[column_name] == member)
                )
                or 0
            )
        return counts

    async def test_rows_in_another_organization_are_not_counted(
        self, db_session, department
    ):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)
        other_org = await _add_org(db_session)
        stray = Shift(
            organization_id=other_org,
            shift_date=date.today(),
            start_time=datetime.now(timezone.utc),
        )
        db_session.add(stray)
        await db_session.flush()
        db_session.add(
            ShiftAssignment(
                organization_id=other_org, shift_id=stray.id, user_id=member
            )
        )
        await db_session.flush()

        impact = await self._impact(db_session, department, member)

        by_table = {r.table: r.count for r in impact.removed_records}
        assert by_table["shift_assignments"] == 2

    async def test_attribution_references_are_not_listed_as_removed(self):
        """Tables where the member is only the attribution must stay out of the
        CASCADE set the preview counts from."""
        cascading = set(_cascading_references())
        assert ("skill_tests", "examiner_id") not in cascading
        assert ("shift_completion_reports", "officer_id") not in cascading
        assert ("skill_tests", "candidate_id") in cascading
        assert ("shift_completion_reports", "trainee_id") in cascading


class TestInventoryReturnedToStock:
    async def _item(self, db, dept, **fields) -> InventoryItem:
        item = InventoryItem(
            organization_id=dept.org,
            name=f"Item {uuid.uuid4().hex[:6]}",
            status=ItemStatus.AVAILABLE,
            condition=ItemCondition.GOOD,
            **fields,
        )
        db.add(item)
        await db.flush()
        return item

    async def test_held_gear_goes_back_to_stock(self, db_session, department):
        svc = InventoryService(db_session)
        member = department.trainee
        coat = await self._item(
            db_session, department, tracking_type=TrackingType.INDIVIDUAL
        )
        radio = await self._item(
            db_session, department, tracking_type=TrackingType.INDIVIDUAL
        )
        gloves = await self._item(
            db_session,
            department,
            tracking_type=TrackingType.POOL,
            quantity=10,
            quantity_issued=0,
        )

        _, err = await svc.assign_item_to_user(
            UUID(coat.id), UUID(member), department.org, department.admin
        )
        assert err is None, err
        _, err = await svc.checkout_item(
            radio.id, member, department.org, department.admin
        )
        assert err is None, err
        _, err = await svc.issue_from_pool(
            UUID(gloves.id), UUID(member), department.org, department.admin, 3
        )
        assert err is None, err

        impact = await users_endpoint.get_deletion_impact(
            user_id=UUID(member), db=db_session, current_user=_admin(department)
        )
        assert impact.inventory_items == 2
        assert impact.checked_out_items == 1

        await _hard_delete(db_session, department, member)

        coat = await _fresh(db_session, InventoryItem, coat.id)
        radio = await _fresh(db_session, InventoryItem, radio.id)
        gloves = await _fresh(db_session, InventoryItem, gloves.id)
        assert coat.assigned_to_user_id is None
        assert coat.status == ItemStatus.AVAILABLE
        assert radio.status == ItemStatus.AVAILABLE
        assert gloves.quantity_issued == 0
        assert gloves.quantity == 10


class TestStoredFilesGoWithTheMember:
    """D11: the rows a permanent delete cascades away named stored files. The
    files go too, after the commit, and only the ones no other row names."""

    @pytest.fixture
    def root(self, tmp_path, monkeypatch):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
        return uploads

    @staticmethod
    def _file(root, org_id: str, area: str):
        directory = root / org_id / area / uuid.uuid4().hex
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid.uuid4().hex}.pdf"
        path.write_bytes(b"%PDF-1.4")
        return path

    @staticmethod
    def _entry(path, name="cert.pdf") -> dict:
        return {"file_name": name, "file_path": str(path), "file_type": "x"}

    @staticmethod
    async def _submission(db, dept, member: str, attachments) -> TrainingSubmission:
        submission = TrainingSubmission(
            organization_id=dept.org,
            submitted_by=member,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2024, 1, 1),
            hours_completed=4.0,
            status=SubmissionStatus.APPROVED,
            attachments=attachments,
        )
        db.add(submission)
        await db.flush()
        return submission

    @staticmethod
    async def _record(db, dept, member: str, attachments) -> TrainingRecord:
        record = TrainingRecord(
            organization_id=dept.org,
            user_id=member,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2024, 1, 1),
            hours_completed=4.0,
            status=TrainingStatus.COMPLETED,
            attachments=attachments,
        )
        db.add(record)
        await db.flush()
        return record

    @staticmethod
    async def _waiver_document(db, dept, member: str, root):
        request = AttendanceWaiverRequest(
            organization_id=dept.org,
            workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
            user_id=member,
            event_title_snapshot="Company Drill",
            event_start_snapshot=datetime(2026, 3, 4, 23, tzinfo=timezone.utc),
            session_date=date(2026, 3, 4),
            status=AttendanceWaiverStatus.DENIED,
            category="Medical",
            submitted_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
        )
        db.add(request)
        await db.flush()
        directory = root / dept.org / "attendance-waivers" / str(request.id)
        directory.mkdir(parents=True)
        path = directory / f"{uuid.uuid4().hex}.pdf"
        path.write_bytes(b"%PDF-1.4 doctor's note")
        db.add(
            AttendanceWaiverAttachment(
                organization_id=dept.org,
                request_id=request.id,
                ordinal=1,
                file_path=str(path),
                mime_type="application/pdf",
                file_size=10,
                sha256="0" * 64,
            )
        )
        await db.flush()
        return path

    @staticmethod
    def _audit_counts() -> dict:
        """The file outcome of the delete just run.

        Since owner decision 2026-11-21 (e), user_hard_deleted is written in
        the delete's transaction and says how many files were queued; the
        outcome follows in pending_file_deletions_completed, which names
        the files left queued ``files_still_pending``. Read back here under
        the names these tests have always asserted.
        """
        events = _audit_events()
        queued = events["user_hard_deleted"]["files_queued"]
        outcome = events["pending_file_deletions_completed"]
        counts = {
            "files_deleted": outcome["files_deleted"],
            "files_not_deleted": outcome["files_still_pending"],
            "files_shared_kept": outcome["files_shared_kept"],
        }
        assert sum(counts.values()) == queued
        return counts

    async def test_removes_the_files_of_every_cascaded_row(
        self, db_session, department, root
    ):
        certificate = self._file(root, department.org, "self-reports")
        evidence = self._file(root, department.org, "training-records")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(evidence)]
        )
        note = await self._waiver_document(
            db_session, department, department.trainee, root
        )

        await _hard_delete(db_session, department, department.trainee)

        assert not certificate.exists()
        assert not evidence.exists()
        assert not note.exists()
        assert self._audit_counts() == {
            "files_deleted": 3,
            "files_not_deleted": 0,
            "files_shared_kept": 0,
        }

    async def test_keeps_a_file_another_row_still_names(
        self, db_session, department, root
    ):
        shared = self._file(root, department.org, "self-reports")
        own = self._file(root, department.org, "self-reports")
        await self._submission(
            db_session,
            department,
            department.trainee,
            [self._entry(shared), self._entry(own)],
        )
        await self._record(
            db_session, department, department.examiner, [self._entry(shared)]
        )

        await _hard_delete(db_session, department, department.trainee)

        assert shared.exists()
        assert not own.exists()
        assert self._audit_counts() == {
            "files_deleted": 1,
            "files_not_deleted": 0,
            "files_shared_kept": 1,
        }

    async def test_never_deletes_outside_the_organizations_storage(
        self, db_session, department, root, tmp_path
    ):
        own = self._file(root, department.org, "self-reports")
        foreign = self._file(root, str(uuid.uuid4()), "self-reports")
        foreign_record = self._file(root, str(uuid.uuid4()), "training-records")
        outside = tmp_path / "outside.pdf"
        outside.write_bytes(b"not in the uploads volume")
        await self._submission(
            db_session,
            department,
            department.trainee,
            [self._entry(own), self._entry(foreign), self._entry(outside)],
        )
        await self._record(
            db_session,
            department,
            department.trainee,
            [self._entry(foreign_record), self._entry(outside), "bare string"],
        )

        await _hard_delete(db_session, department, department.trainee)

        assert not own.exists()
        assert foreign.exists()
        assert foreign_record.exists()
        assert outside.exists()
        assert self._audit_counts()["files_deleted"] == 1

    async def test_an_approved_certificate_is_deleted_once(
        self, db_session, department, root
    ):
        certificate = self._file(root, department.org, "self-reports")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(certificate)]
        )

        await _hard_delete(db_session, department, department.trainee)

        assert not certificate.exists()
        assert self._audit_counts() == {
            "files_deleted": 1,
            "files_not_deleted": 0,
            "files_shared_kept": 0,
        }

    async def test_a_refused_delete_touches_no_file(
        self, db_session, department, root, monkeypatch
    ):
        certificate = self._file(root, department.org, "self-reports")
        evidence = self._file(root, department.org, "training-records")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(evidence)]
        )
        note = await self._waiver_document(
            db_session, department, department.trainee, root
        )
        commit = db_session.commit
        refused = AsyncMock(
            side_effect=[IntegrityError("DELETE FROM users", {}, Exception("1451"))]
        )
        monkeypatch.setattr(db_session, "commit", refused)

        with pytest.raises(HTTPException) as exc:
            await _hard_delete(db_session, department, department.trainee)

        monkeypatch.setattr(db_session, "commit", commit)
        assert exc.value.status_code == 409
        assert certificate.exists()
        assert evidence.exists()
        assert note.exists()

    async def test_an_unanswerable_reference_check_keeps_every_file(
        self, db_session, department, root, monkeypatch
    ):
        certificate = self._file(root, department.org, "self-reports")
        evidence = self._file(root, department.org, "training-records")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(evidence)]
        )
        check = member_files.referenced_elsewhere
        monkeypatch.setattr(
            member_files,
            "referenced_elsewhere",
            AsyncMock(side_effect=RuntimeError("database went away")),
        )

        await _hard_delete(db_session, department, department.trainee)

        gone = await db_session.scalar(
            text("SELECT COUNT(*) FROM users WHERE id = :id"),
            {"id": department.trainee},
        )
        assert gone == 0
        assert certificate.exists()
        assert evidence.exists()
        assert self._audit_counts() == {
            "files_deleted": 0,
            "files_not_deleted": 2,
            "files_shared_kept": 0,
        }
        # Kept, and still queued untouched: the sweep can finish them.
        assert (
            await self._pending(db_session, department.org)
            == [
                ("attendance-waivers", 0),
                ("self-reports", 0),
                ("training-records", 0),
            ][1:]
        )
        monkeypatch.setattr(member_files, "referenced_elsewhere", check)
        await self._backdate(db_session, department.org)

        await PendingFileDeletionSweep(db_session).run()

        assert not certificate.exists()
        assert not evidence.exists()
        assert await self._pending(db_session, department.org) == []

    @staticmethod
    async def _pending(db, org_id: str) -> list[tuple[str, int]]:
        rows = await db.execute(
            text(
                "SELECT area, attempts FROM pending_file_deletions "
                "WHERE organization_id = :org ORDER BY area"
            ),
            {"org": org_id},
        )
        return [(row.area, row.attempts) for row in rows]

    @staticmethod
    async def _backdate(db, org_id: str) -> None:
        """Past the sweep's grace period, measured by the database's clock."""
        await db.execute(
            text(
                "UPDATE pending_file_deletions "
                "SET created_at = created_at - INTERVAL 1 HOUR "
                "WHERE organization_id = :org"
            ),
            {"org": org_id},
        )

    async def test_a_crash_after_the_commit_leaves_rows_the_sweep_finishes(
        self, db_session, department, root, monkeypatch
    ):
        """The delete commits and the process dies before removing a file:
        the queue, written in the delete's own transaction, is what lets the
        hourly sweep finish the job."""
        certificate = self._file(root, department.org, "self-reports")
        evidence = self._file(root, department.org, "training-records")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(evidence)]
        )
        note = await self._waiver_document(
            db_session, department, department.trainee, root
        )
        await db_session.commit()
        monkeypatch.setattr(
            users_endpoint,
            "process_pending_file_deletions",
            AsyncMock(side_effect=_Killed()),
        )

        with pytest.raises(_Killed):
            await _hard_delete(db_session, department, department.trainee)

        gone = await db_session.scalar(
            text("SELECT COUNT(*) FROM users WHERE id = :id"),
            {"id": department.trainee},
        )
        assert gone == 0
        assert certificate.exists()
        assert evidence.exists()
        assert note.exists()
        assert await self._pending(db_session, department.org) == [
            ("attendance-waivers", 0),
            ("self-reports", 0),
            ("training-records", 0),
        ]
        await self._backdate(db_session, department.org)

        result = await run_pending_file_deletions(db_session)

        assert not certificate.exists()
        assert not evidence.exists()
        assert not note.exists()
        assert await self._pending(db_session, department.org) == []
        assert result["deleted"] == 3

    async def test_a_crash_after_the_commit_keeps_the_audit_row(
        self, db_session, department, root, monkeypatch
    ):
        """Owner decision 2026-11-21 (e): user_hard_deleted is written in the
        delete's transaction, with the real audit helper here, so a process
        killed right after the commit keeps it. Before, it was written after
        the commit and lost with the process."""
        monkeypatch.setattr(users_endpoint, "log_audit_event", real_log_audit_event)
        certificate = self._file(root, department.org, "self-reports")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await db_session.commit()
        monkeypatch.setattr(
            users_endpoint,
            "process_pending_file_deletions",
            AsyncMock(side_effect=_Killed()),
        )

        with pytest.raises(_Killed):
            await _hard_delete(db_session, department, department.trainee)

        rows = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "user_hard_deleted",
                        AuditLog.organization_id == department.org,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].event_data["deleted_user_id"] == department.trainee
        assert rows[0].event_data["files_queued"] == 1

    async def test_an_unwritable_audit_row_refuses_the_delete(
        self, db_session, department, root, monkeypatch
    ):
        """Owner decision 2026-11-21 (e): the audit helper reports a failed
        write by returning None; the delete then rolls back, the member and
        their files stay, and nothing is queued."""
        monkeypatch.setattr(
            users_endpoint, "log_audit_event", AsyncMock(return_value=None)
        )
        certificate = self._file(root, department.org, "self-reports")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await _hard_delete(db_session, department, department.trainee)

        assert exc.value.status_code == 500
        still_there = await db_session.scalar(
            text("SELECT COUNT(*) FROM users WHERE id = :id"),
            {"id": department.trainee},
        )
        assert still_there == 1
        assert certificate.exists()
        assert await self._pending(db_session, department.org) == []

    async def test_a_refused_delete_queues_nothing(
        self, db_session, department, root, monkeypatch
    ):
        """The queue rows ride the delete's transaction: a delete refused at
        its commit leaves none behind."""
        certificate = self._file(root, department.org, "self-reports")
        evidence = self._file(root, department.org, "training-records")
        await self._submission(
            db_session, department, department.trainee, [self._entry(certificate)]
        )
        await self._record(
            db_session, department, department.trainee, [self._entry(evidence)]
        )
        # Committed, so the endpoint's rollback discards only the delete.
        await db_session.commit()
        real_flush = db_session.flush

        async def refused():
            # The INSERTs and the DELETE reach the database, then the commit
            # is refused, as an unexpected foreign key would refuse it.
            await real_flush()
            raise IntegrityError("DELETE FROM users", {}, Exception("1451"))

        commit = db_session.commit
        monkeypatch.setattr(db_session, "commit", refused)

        with pytest.raises(HTTPException) as exc:
            await _hard_delete(db_session, department, department.trainee)

        monkeypatch.setattr(db_session, "commit", commit)
        assert exc.value.status_code == 409
        kept = await db_session.scalar(
            text("SELECT COUNT(*) FROM users WHERE id = :id"),
            {"id": department.trainee},
        )
        assert kept == 1
        assert await self._pending(db_session, department.org) == []
        assert certificate.exists()
        assert evidence.exists()


class TestTheApplicantRecordGoesWithTheMember:
    """A member converted from an applicant keeps a prospective_members row
    linked by ``transferred_user_id``, which is SET NULL: deleting the member
    only detached it. The applicant's details, ID documents and form answers
    survived with nothing left linking them to anybody, and Purge takes only
    inactive applications, so nothing could ever remove them (2026-11-21
    member-files review, high)."""

    @pytest.fixture
    def root(self, tmp_path, monkeypatch):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
        return uploads

    @staticmethod
    async def _application(db, dept, member: str, root, label: str):
        form = Form(organization_id=dept.org, name=f"Application {label}")
        db.add(form)
        await db.flush()
        answers = [
            FormSubmission(
                organization_id=dept.org,
                form_id=form.id,
                data={"full_name": f"Applicant {label}"},
                submitter_name=f"Applicant {label}",
            )
            for _ in range(3)
        ]
        db.add_all(answers)
        await db.flush()
        original, duplicate, follow_up = answers
        prospect = ProspectiveMember(
            organization_id=dept.org,
            first_name="Applicant",
            last_name=label,
            email=f"applicant-{label}-{uuid.uuid4().hex[:6]}@example.org",
            status=ProspectStatus.TRANSFERRED,
            transferred_user_id=member,
            form_submission_id=original.id,
        )
        db.add(prospect)
        pipeline = MembershipPipeline(organization_id=dept.org, name=f"P {label}")
        db.add(pipeline)
        await db.flush()
        step = MembershipPipelineStep(
            pipeline_id=pipeline.id,
            name="Apply",
            step_type=PipelineStepType.FORM_SUBMISSION,
        )
        db.add(step)
        await db.flush()
        path = root / dept.org / "applicants" / str(prospect.id) / "licence.pdf"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"%PDF-1.4 driver's licence")
        db.add_all(
            [
                ProspectDocument(
                    prospect_id=prospect.id,
                    document_type="id",
                    file_name="licence.pdf",
                    file_path=str(path),
                ),
                ProspectStepProgress(
                    prospect_id=prospect.id,
                    step_id=step.id,
                    status=StepProgressStatus.COMPLETED,
                    action_result={"form_submission_id": str(duplicate.id)},
                ),
                ProspectFormRequest(
                    organization_id=dept.org,
                    prospect_id=prospect.id,
                    form_id=form.id,
                    token="follow-up-" + uuid.uuid4().hex,
                    submission_id=follow_up.id,
                ),
                ProspectActivityLog(
                    prospect_id=prospect.id,
                    action="prospect_updated",
                    details={"changes": {"phone": {"from": "1", "to": "2"}}},
                ),
            ]
        )
        await db.flush()
        return SimpleNamespace(
            prospect=str(prospect.id),
            file=path,
            submissions=[str(a.id) for a in answers],
        )

    async def test_the_application_its_answers_and_its_documents_go(
        self, db_session, department, root
    ):
        theirs = await self._application(
            db_session, department, department.trainee, root, "deleted"
        )
        kept = await self._application(
            db_session, department, department.examiner, root, "kept"
        )
        # The preview names what the delete is about to remove.
        impact = await users_endpoint.get_deletion_impact(
            user_id=UUID(department.trainee),
            db=db_session,
            current_user=_admin(department),
        )
        by_table = {r.table: r for r in impact.removed_records}
        assert by_table["prospective_members"].count == 1

        await _hard_delete(db_session, department, department.trainee)

        remaining = set(
            (
                await db_session.execute(
                    select(ProspectiveMember.id).where(
                        ProspectiveMember.organization_id == department.org
                    )
                )
            )
            .scalars()
            .all()
        )
        assert remaining == {kept.prospect}
        answers = set(
            (
                await db_session.execute(
                    select(FormSubmission.id).where(
                        FormSubmission.id.in_(theirs.submissions + kept.submissions)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert answers == set(kept.submissions)
        documents = (
            await db_session.execute(
                select(func.count())
                .select_from(ProspectDocument)
                .where(ProspectDocument.prospect_id == theirs.prospect)
            )
        ).scalar_one()
        assert documents == 0
        assert not theirs.file.exists()
        assert kept.file.exists()
        events = _audit_events()
        assert events["pending_file_deletions_completed"]["files_deleted"] == 1
        assert events["user_hard_deleted"]["applicant_records_deleted"] == 1


class _Killed(BaseException):
    """A worker killed mid-request: not an Exception, so no handler swallows it."""
