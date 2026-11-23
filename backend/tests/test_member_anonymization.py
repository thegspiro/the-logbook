"""Tests for the member anonymization workflow (right to erasure)."""

import copy
import uuid
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select

from app.api.v1.endpoints import users as users_endpoint
from app.models.forms import Form, FormSubmission
from app.models.inventory import MemberSizePreferences
from app.models.medical_screening import ScreeningRecord, ScreeningType
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    PipelineStepType,
    ProspectActivityLog,
    ProspectDocument,
    ProspectElectionPackage,
    ProspectFormRequest,
    ProspectiveMember,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.training import (
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    Position,
    User,
    UserStatus,
    user_positions,
)
from app.services import file_storage_service, member_anonymization_service
from app.services.attendance_waiver_service import MEETING_WAIVER_TEXT
from app.services.member_anonymization_service import MemberAnonymizationService
from tests.fake_request import fake_request

pytestmark = pytest.mark.integration


async def _make_org(db, name="Anon FD"):
    org = Organization(name=name, slug=f"anon-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_departed_member(db, org, **overrides):
    suffix = uuid.uuid4().hex[:8]
    defaults = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name="Firefighter",
        phone="555-0100",
        mobile="555-0101",
        date_of_birth=date(1990, 5, 4),
        address_street="1 Main St",
        photo_url="data:image/webp;base64,abcd",
        emergency_contacts=[{"name": "Casey", "phone": "555-0102"}],
        status_change_reason="Moved out of state",
        voting_wait_from=date(2019, 3, 1),
        voting_wait_waived=True,
        voting_wait_override_reason="Regular since the March 2019 meeting",
        password_hash="bcrypt$fake",
        deleted_at=datetime.now(UTC),
    )
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    await db.flush()
    return user


class TestAnonymizeMember:
    async def test_refuses_active_member(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(
            db_session, org, deleted_at=None, status=UserStatus.ACTIVE
        )
        service = MemberAnonymizationService(db_session)
        with pytest.raises(ValueError, match="Only departed members"):
            await service.anonymize_member(user)

    async def test_scrubs_user_pii_and_related_rows(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        db_session.add(
            MemberSizePreferences(
                id=str(uuid.uuid4()),
                user_id=user.id,
                organization_id=org.id,
                shirt_size="L",
            )
        )
        db_session.add(
            ScreeningRecord(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=user.id,
                screening_type=ScreeningType.PHYSICAL_EXAM,
                result_summary="Cleared with restrictions",
                notes="Provider noted asthma",
                provider_name="Dr. Example",
            )
        )
        db_session.add(
            MemberLeaveOfAbsence(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=user.id,
                leave_type=LeaveType.MEDICAL,
                reason="Surgery recovery",
                start_date=date(2026, 1, 1),
            )
        )
        await db_session.flush()
        original_email = user.email

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert user.anonymized_at is not None
        assert user.first_name == "Former"
        assert user.last_name.startswith("Member-")
        assert user.email != original_email
        assert user.email.endswith("@anonymized.invalid")
        assert user.phone is None
        assert user.date_of_birth is None
        assert user.photo_url is None
        assert user.emergency_contacts is None
        assert user.status_change_reason is None
        assert user.voting_wait_override_reason is None
        # Standing, not personal: kept, as membership_type_changed_at is.
        assert user.voting_wait_waived is True
        assert user.password_hash is None

        assert summary["size_preferences_deleted"] == 1
        sizes = (
            (
                await db_session.execute(
                    select(MemberSizePreferences).where(
                        MemberSizePreferences.user_id == user.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sizes == []

        screening = (
            await db_session.execute(
                select(ScreeningRecord).where(ScreeningRecord.user_id == user.id)
            )
        ).scalar_one()
        assert screening.result_summary is None
        assert screening.notes is None
        assert screening.provider_name is None
        # Compliance proof survives the scrub.
        assert screening.screening_type == ScreeningType.PHYSICAL_EXAM

        leave = (
            await db_session.execute(
                select(MemberLeaveOfAbsence).where(
                    MemberLeaveOfAbsence.user_id == user.id
                )
            )
        ).scalar_one()
        assert leave.reason is None
        assert leave.leave_type == LeaveType.MEDICAL  # operational fact kept
        assert leave.start_date == date(2026, 1, 1)

    async def test_clears_the_preferred_name_the_display_name_prefers(self, db_session):
        """A scrub that leaves `preferred_name` keeps naming the member.

        `format_display_name` prefers it over `first_name`, so every shift
        board, roster and notification would read "Terry Member-1a2b3c4d" —
        the anonymization visibly failing on the surfaces members actually
        see, while the audited `first_name` column looks correctly scrubbed.
        """
        org = await _make_org(db_session)
        user = await _make_departed_member(
            db_session, org, first_name="Patricia", preferred_name="Pat"
        )
        assert user.display_name == "Pat Firefighter"

        await MemberAnonymizationService(db_session).anonymize_member(user)

        assert user.preferred_name is None
        assert "Pat" not in user.display_name
        assert user.display_name.startswith("Former Member-")

    async def test_two_members_anonymize_without_unique_collisions(self, db_session):
        org = await _make_org(db_session)
        user_a = await _make_departed_member(db_session, org)
        user_b = await _make_departed_member(db_session, org)
        service = MemberAnonymizationService(db_session)

        await service.anonymize_member(user_a)
        await service.anonymize_member(user_b)
        await db_session.flush()

        assert user_a.email != user_b.email
        assert user_a.username != user_b.username

    async def test_scrubs_follow_up_forms(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        form = Form(organization_id=org.id, name="Background Questionnaire")
        db_session.add(form)
        await db_session.flush()
        submission = FormSubmission(
            organization_id=org.id,
            form_id=form.id,
            data={"street": "1 Main St"},
            sensitive_data={"history": "Prior conviction"},
        )
        db_session.add(submission)
        await db_session.flush()
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat.follow-up@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        await db_session.flush()
        request = ProspectFormRequest(
            organization_id=org.id,
            prospect_id=prospect.id,
            form_id=form.id,
            token="follow-up-token-" + uuid.uuid4().hex,
            draft_data={"street": "1 Main St"},
            changes=[{"field": "phone", "old": "555-0100", "new": "555-0199"}],
            submission_id=submission.id,
        )
        db_session.add(request)
        await db_session.flush()

        await MemberAnonymizationService(db_session).anonymize_member(user)

        assert request.token is None
        assert request.token_hash is None
        assert request.draft_data is None
        assert request.changes is None
        assert submission.data == {}
        assert submission.sensitive_data is None

    async def test_scrubs_the_election_package_copy(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat.package@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        await db_session.flush()
        stages = [{"stage_name": "Interview", "completed_at": "2026-09-01"}]
        package = ProspectElectionPackage(
            prospect_id=prospect.id,
            status="draft",
            applicant_snapshot={
                "first_name": "Pat",
                "last_name": "Firefighter",
                "email": "pat.package@example.org",
                "address_street": "1 Main St",
                "notes": "Lives with her mother",
                "desired_membership_type": "regular",
                "stage_history": stages,
                "follow_up_forms": [
                    {"answers": [{"label": "Why now?", "answer": "Moved here"}]}
                ],
            },
            coordinator_notes="Pat mentioned a back injury",
            package_config={
                "supporting_statement": "Pat has been a great help",
                "recommended_ballot_item": {"title": "Approve"},
            },
        )
        db_session.add(package)
        await db_session.flush()

        await MemberAnonymizationService(db_session).anonymize_member(user)

        snapshot = package.applicant_snapshot
        assert snapshot["first_name"] == "Former"
        assert snapshot["last_name"].startswith("Member-")
        assert snapshot["desired_membership_type"] == "regular"
        assert snapshot["stage_history"] == stages
        for gone in ("email", "address_street", "notes", "follow_up_forms"):
            assert gone not in snapshot
        assert package.coordinator_notes is None
        assert "supporting_statement" not in package.package_config
        assert package.package_config["recommended_ballot_item"] == {"title": "Approve"}

    async def test_scrubs_applicant_screening_and_source_form(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        form = Form(organization_id=org.id, name="Membership application")
        db_session.add(form)
        await db_session.flush()
        submission = FormSubmission(
            organization_id=org.id,
            form_id=form.id,
            data={"date_of_birth": "1990-05-04", "medical_notes": "Asthma"},
            sensitive_data={"criminal_history": "Prior conviction"},
            submitter_name="Pat Firefighter",
            submitter_email="pat@example.org",
            ip_address="192.0.2.1",
            user_agent="Applicant browser",
            integration_result={"applicant_name": "Pat Firefighter"},
        )
        db_session.add(submission)
        await db_session.flush()
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat@example.org",
            transferred_user_id=user.id,
            form_submission_id=submission.id,
        )
        db_session.add(prospect)
        await db_session.flush()
        screening = ScreeningRecord(
            organization_id=org.id,
            prospect_id=prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            result_summary="Cleared with restrictions",
            result_data={"diagnosis": "asthma"},
            notes="Applicant medical history",
            provider_name="Dr. Example",
        )
        db_session.add(screening)
        await db_session.flush()

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert summary["screening_records_scrubbed"] == 1
        assert summary["form_submissions_scrubbed"] == 1
        assert screening.result_summary is None
        assert screening.result_data is None
        assert screening.notes is None
        assert screening.provider_name is None
        assert prospect.form_submission_id is None
        assert submission.data == {}
        assert submission.sensitive_data is None
        assert submission.submitter_name is None
        assert submission.submitter_email is None
        assert submission.ip_address is None
        assert submission.user_agent is None
        assert submission.integration_result is None

    async def test_removes_only_the_orgs_own_applicant_files(
        self, db_session, tmp_path, monkeypatch
    ):
        """Applicant files are removed, but a stored path pointing outside the
        organization's own applicant storage is never unlinked. A file still
        in the pre-org-first ``prospect-documents/<org>/`` tree is the org's
        own and goes too."""
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        await db_session.flush()

        own = tmp_path / str(org.id) / "applicants" / str(prospect.id) / "licence.jpg"
        own.parent.mkdir(parents=True)
        own.write_bytes(b"licence")
        legacy = tmp_path / "prospect-documents" / str(org.id) / str(prospect.id)
        legacy = legacy / "background.pdf"
        legacy.parent.mkdir(parents=True)
        legacy.write_bytes(b"background check")
        foreign = (
            tmp_path
            / str(uuid.uuid4())
            / "applicants"
            / str(prospect.id)
            / "theirs.pdf"
        )
        foreign.parent.mkdir(parents=True)
        foreign.write_bytes(b"another department's file")
        for path in (own, legacy, foreign):
            db_session.add(
                ProspectDocument(
                    prospect_id=prospect.id,
                    document_type="id",
                    file_name=path.name,
                    file_path=str(path),
                )
            )
        await db_session.flush()

        await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not own.exists()
        assert not legacy.exists()
        assert foreign.exists()
        remaining = await db_session.execute(
            select(ProspectDocument).where(ProspectDocument.prospect_id == prospect.id)
        )
        assert remaining.scalars().all() == []

    async def test_scrubs_step_progress_payloads_and_duplicate_submissions(
        self, db_session
    ):
        """Form-driven pipeline steps copy the mapped applicant data into
        ProspectStepProgress.action_result, and a duplicate application's
        submission is linked ONLY from there — both must be scrubbed or the
        erasure leaves the applicant identifiable (PR #1412 review)."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        form = Form(organization_id=org.id, name="Membership application")
        db_session.add(form)
        await db_session.flush()
        original = FormSubmission(
            organization_id=org.id,
            form_id=form.id,
            data={"full_name": "Pat Firefighter"},
            submitter_name="Pat Firefighter",
        )
        duplicate = FormSubmission(
            organization_id=org.id,
            form_id=form.id,
            data={"full_name": "Pat Firefighter", "email": "pat@example.org"},
            submitter_name="Pat Firefighter",
        )
        db_session.add_all([original, duplicate])
        await db_session.flush()
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat@example.org",
            transferred_user_id=user.id,
            form_submission_id=original.id,
        )
        db_session.add(prospect)
        pipeline = MembershipPipeline(organization_id=org.id, name="Default")
        db_session.add(pipeline)
        await db_session.flush()
        step = MembershipPipelineStep(
            pipeline_id=pipeline.id,
            name="Submit application",
            step_type=PipelineStepType.FORM_SUBMISSION,
        )
        db_session.add(step)
        await db_session.flush()
        mapped_data = {
            "first_name": "Pat",
            "last_name": "Firefighter",
            "email": "pat@example.org",
            "date_of_birth": "1990-05-04",
        }
        progress = ProspectStepProgress(
            prospect_id=prospect.id,
            step_id=step.id,
            status=StepProgressStatus.COMPLETED,
            action_result={
                "form_submission_id": str(duplicate.id),
                "form_id": str(form.id),
                "mapped_data": mapped_data,
            },
        )
        db_session.add(progress)
        await db_session.flush()

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert summary["form_submissions_scrubbed"] == 2
        assert summary["step_progress_scrubbed"] == 1
        assert original.data == {}
        assert duplicate.data == {}
        assert duplicate.submitter_name is None
        assert progress.action_result["mapped_data"] is None
        # Structural keys survive so the pipeline history stays legible.
        assert progress.action_result["form_submission_id"] == str(duplicate.id)

    async def test_scrubs_the_activity_log_and_step_notes(self, db_session):
        """The applicant's activity log keeps every edit as from/to values,
        every uploaded file's name and every coordinator note, and step
        progress keeps its own notes. All of it names the applicant, so the
        erasure redacts it while keeping the history's shape (2026-11-21
        member-files review)."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Jane",
            last_name="Doe",
            email="jane.doe@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        pipeline = MembershipPipeline(organization_id=org.id, name="Default")
        db_session.add(pipeline)
        await db_session.flush()
        step = MembershipPipelineStep(
            pipeline_id=pipeline.id,
            name="Interview",
            step_type=PipelineStepType.ACTION,
        )
        db_session.add(step)
        await db_session.flush()
        progress = ProspectStepProgress(
            prospect_id=prospect.id,
            step_id=step.id,
            status=StepProgressStatus.COMPLETED,
            notes="Jane mentioned her back injury",
        )
        db_session.add(progress)
        # The shapes MembershipPipelineService._log_activity writes.
        logs = [
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="prospect_updated",
                details={
                    "changes": {
                        "phone": {"from": "555-0100", "to": "555-0199"},
                        "email": {
                            "from": "jane.doe@example.org",
                            "to": "jdoe@example.org",
                        },
                        "date_of_birth": {"changed": True},
                    }
                },
            ),
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="document_uploaded",
                details={"document_type": "id", "file_name": "Jane_Doe_DL.pdf"},
            ),
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="step_completed",
                details={"step_id": str(step.id), "notes": "Jane was nervous"},
            ),
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="prospect_status_changed",
                details={
                    "from": "active",
                    "to": "on_hold",
                    "reason": "Jane is recovering from surgery",
                    "bulk": False,
                },
            ),
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="duplicate_application_detected",
                details={
                    "notification_sent_to": "jane.doe@example.org",
                    "department_bcc": True,
                },
            ),
            ProspectActivityLog(
                prospect_id=prospect.id,
                action="transferred_to_membership",
                details={
                    "user_id": str(user.id),
                    "username": "jdoe",
                    "notes": "Welcome aboard, Jane",
                },
            ),
        ]
        db_session.add_all(logs)
        await db_session.flush()

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        stored = (
            (
                await db_session.execute(
                    select(ProspectActivityLog)
                    .where(ProspectActivityLog.prospect_id == prospect.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        by_action = {log.action: log.details for log in stored}
        flat = repr(by_action)
        for leaked in ("555-01", "jane", "Jane", "jdoe", "surgery", "nervous"):
            assert leaked not in flat, leaked
        # The history's shape survives: what changed, which step, which kind
        # of document, which status move.
        assert by_action["prospect_updated"] == {
            "changes": {
                "phone": {"changed": True},
                "email": {"changed": True},
                "date_of_birth": {"changed": True},
            }
        }
        assert by_action["document_uploaded"] == {"document_type": "id"}
        assert by_action["step_completed"] == {"step_id": str(step.id)}
        assert by_action["prospect_status_changed"] == {
            "from": "active",
            "to": "on_hold",
            "bulk": False,
        }
        assert by_action["duplicate_application_detected"] == {"department_bcc": True}
        assert by_action["transferred_to_membership"] == {"user_id": str(user.id)}
        assert progress.notes is None
        assert summary["prospect_activity_scrubbed"] == len(logs)

    async def test_refuses_double_anonymization(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        service = MemberAnonymizationService(db_session)
        await service.anonymize_member(user)
        with pytest.raises(ValueError, match="already anonymized"):
            await service.anonymize_member(user)

    async def test_refuses_a_member_with_privileges_beyond_the_callers(
        self, db_session, monkeypatch
    ):
        """Delete, archive and status change refuse a target holding
        permissions the caller lacks; anonymisation, which cannot be undone,
        refuses it too (2026-11-21 member-files review)."""
        org = await _make_org(db_session)
        manager = await _make_departed_member(db_session, org, deleted_at=None)
        chief = await _make_departed_member(db_session, org)
        admin_position = Position(
            organization_id=org.id, name="Admin", slug="admin", permissions=["*"]
        )
        db_session.add(admin_position)
        await db_session.flush()
        await db_session.execute(
            insert(user_positions).values(
                user_id=chief.id, position_id=admin_position.id
            )
        )
        chief_id = str(chief.id)
        # Drop the cached instance so the endpoint loads the position just
        # inserted, as it would in a fresh request.
        db_session.expunge(chief)
        monkeypatch.setattr(
            users_endpoint, "report_privilege_escalation_attempt", AsyncMock()
        )

        with pytest.raises(HTTPException) as exc:
            await users_endpoint.anonymize_member(
                user_id=chief_id,
                request=fake_request(),
                current_user=SimpleNamespace(
                    id=manager.id,
                    organization_id=org.id,
                    rank=None,
                    positions=[SimpleNamespace(permissions=["members.manage"])],
                ),
                db=db_session,
                _stepup=None,
            )

        assert exc.value.status_code == 403
        stored = await db_session.get(User, chief_id)
        assert stored.anonymized_at is None
        assert stored.first_name == "Pat"

    async def test_org_scoped_lookup_blocks_cross_tenant(self, db_session):
        org_a = await _make_org(db_session, name="Org A")
        org_b = await _make_org(db_session, name="Org B")
        user_b = await _make_departed_member(db_session, org_b)

        service = MemberAnonymizationService(db_session)
        assert (await service.get_user_for_anonymization(user_b.id, org_a.id)) is None
        assert (
            await service.get_user_for_anonymization(user_b.id, org_b.id)
        ) is not None


class TestSelfReportCertificates:
    """D11: the certificates a member uploaded with self-reported training,
    and the copies approval put on their training records, go with the
    member's identity. The submission and record rows stay."""

    @pytest.fixture
    def root(self, tmp_path, monkeypatch):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
        return uploads

    @staticmethod
    def _certificate(root, org_id, *, legacy=False, area="self-reports", name=None):
        if legacy:
            directory = root / "training_attachments" / "self_reported_submissions"
            directory = directory / str(org_id)
        else:
            directory = root / str(org_id) / area / uuid.uuid4().hex
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid.uuid4().hex}.pdf"
        path.write_bytes(b"%PDF-1.4 certificate")
        return path

    @staticmethod
    def _entry(path, name="Pat Firefighter CPR card.pdf"):
        return {"file_name": name, "file_path": str(path), "file_type": "x"}

    @staticmethod
    async def _submission(db, org_id, user_id, attachments, **overrides):
        fields = dict(
            organization_id=str(org_id),
            submitted_by=str(user_id),
            course_name="CPR",
            training_type="certification",
            completion_date=date(2024, 1, 1),
            hours_completed=4.0,
            status=SubmissionStatus.APPROVED,
            attachments=attachments,
        )
        fields.update(overrides)
        submission = TrainingSubmission(**fields)
        db.add(submission)
        await db.flush()
        return submission

    @staticmethod
    async def _record(db, org_id, user_id, attachments, **overrides):
        fields = dict(
            organization_id=str(org_id),
            user_id=str(user_id),
            course_name="CPR",
            training_type="certification",
            completion_date=date(2024, 1, 1),
            hours_completed=4.0,
            status=TrainingStatus.COMPLETED,
            attachments=attachments,
        )
        fields.update(overrides)
        record = TrainingRecord(**fields)
        db.add(record)
        await db.flush()
        return record

    @staticmethod
    async def _fresh(db, model, row_id):
        return (
            await db.execute(
                select(model)
                .where(model.id == row_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()

    async def test_removes_the_members_certificates_and_record_copies(
        self, db_session, root
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        current = self._certificate(root, org.id)
        legacy = self._certificate(root, org.id, legacy=True)
        entries = [self._entry(current), self._entry(legacy)]
        submission = await self._submission(db_session, org.id, user.id, entries)
        record = await self._record(db_session, org.id, user.id, copy.deepcopy(entries))

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not current.exists()
        assert not legacy.exists()
        submission = await self._fresh(db_session, TrainingSubmission, submission.id)
        record = await self._fresh(db_session, TrainingRecord, record.id)
        assert submission is not None
        assert submission.attachments == []
        assert record is not None
        assert record.attachments == []
        # One file each, though both rows named both.
        assert summary["self_report_files_deleted"] == 2
        assert summary["self_report_files_not_deleted"] == 0
        assert summary["self_report_files_shared_kept"] == 0

    async def test_removes_a_certificate_only_a_voided_record_names(
        self, db_session, root
    ):
        """Approval, reversal (voiding the record), then the member removed the
        attachment from the submission: only the voided record still names
        the certificate."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        certificate = self._certificate(root, org.id)
        await self._submission(
            db_session,
            org.id,
            user.id,
            [],
            status=SubmissionStatus.PENDING_REVIEW,
        )
        record = await self._record(
            db_session,
            org.id,
            user.id,
            [self._entry(certificate)],
            status=TrainingStatus.CANCELLED,
            voided_at=datetime.now(UTC),
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not certificate.exists()
        record = await self._fresh(db_session, TrainingRecord, record.id)
        assert record.attachments == []
        assert summary["self_report_files_deleted"] == 1

    async def test_removes_only_the_members_own_files_in_their_org(
        self, db_session, root, tmp_path
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        colleague = await _make_departed_member(db_session, org, deleted_at=None)
        own = self._certificate(root, org.id)
        theirs = self._certificate(root, org.id)
        other_org = self._certificate(root, uuid.uuid4())
        outside = tmp_path / "outside.pdf"
        outside.write_bytes(b"not in the uploads volume")
        await self._submission(db_session, org.id, colleague.id, [self._entry(theirs)])
        submission = await self._submission(
            db_session,
            org.id,
            user.id,
            [
                self._entry(own),
                self._entry(other_org, name="tampered"),
                self._entry(outside, name="outside"),
                "a legacy bare-string entry",
            ],
        )

        await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not own.exists()
        assert theirs.exists()
        assert other_org.exists()
        assert outside.exists()
        submission = await self._fresh(db_session, TrainingSubmission, submission.id)
        assert [
            a if isinstance(a, str) else a["file_name"] for a in submission.attachments
        ] == [
            "tampered",
            "outside",
            "a legacy bare-string entry",
        ]

    async def test_keeps_a_file_another_row_still_names(self, db_session, root):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        colleague = await _make_departed_member(db_session, org, deleted_at=None)
        shared = self._certificate(root, org.id)
        own = self._certificate(root, org.id)
        submission = await self._submission(
            db_session, org.id, user.id, [self._entry(shared), self._entry(own)]
        )
        theirs = await self._record(
            db_session, org.id, colleague.id, [self._entry(shared, name="crew.pdf")]
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert shared.exists()
        assert not own.exists()
        theirs = await self._fresh(db_session, TrainingRecord, theirs.id)
        assert theirs.attachments == [self._entry(shared, name="crew.pdf")]
        submission = await self._fresh(db_session, TrainingSubmission, submission.id)
        assert submission.attachments == []
        assert summary["self_report_files_shared_kept"] == 1
        assert summary["self_report_files_deleted"] == 1

    async def test_a_failed_delete_keeps_the_reference_and_is_counted(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        certificate = self._certificate(root, org.id)
        submission = await self._submission(
            db_session, org.id, user.id, [self._entry(certificate)]
        )
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert summary["self_report_files_not_deleted"] == 1
        assert summary["self_report_files_deleted"] == 0
        submission = await self._fresh(db_session, TrainingSubmission, submission.id)
        [entry] = submission.attachments
        assert entry["file_path"] == str(certificate)
        assert entry["file_name"] == "certificate.pdf"

    async def test_a_rerun_after_a_rollback_completes(self, db_session, root):
        """The files go before the commit. If it fails, the rows still name
        files that are gone, and running anonymisation again finishes."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        certificate = self._certificate(root, org.id)
        submission = await self._submission(
            db_session, org.id, user.id, [self._entry(certificate)]
        )
        user_id, org_id, submission_id = user.id, org.id, submission.id
        await db_session.commit()

        service = MemberAnonymizationService(db_session)
        await service.anonymize_member(user)
        await db_session.rollback()

        assert not certificate.exists()
        submission = await self._fresh(db_session, TrainingSubmission, submission_id)
        assert submission.attachments == [self._entry(certificate)]
        user = await service.get_user_for_anonymization(user_id, org_id)
        assert user.anonymized_at is None

        summary = await service.anonymize_member(user)

        assert user.anonymized_at is not None
        submission = await self._fresh(db_session, TrainingSubmission, submission_id)
        assert submission.attachments == []
        assert summary["self_report_files_deleted"] == 1

    async def test_the_audit_event_carries_counts_and_no_identity(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        admin = await _make_departed_member(db_session, org, deleted_at=None)
        user = await _make_departed_member(db_session, org)
        certificate = self._certificate(root, org.id)
        await self._submission(db_session, org.id, user.id, [self._entry(certificate)])
        audit = AsyncMock()
        monkeypatch.setattr(users_endpoint, "log_audit_event", audit)

        await users_endpoint.anonymize_member(
            user_id=str(user.id),
            request=fake_request(),
            current_user=SimpleNamespace(
                id=admin.id,
                organization_id=org.id,
                rank=None,
                positions=[SimpleNamespace(permissions=["*"])],
            ),
            db=db_session,
            _stepup=None,
        )

        event_data = audit.await_args.kwargs["event_data"]
        assert event_data["self_report_files_deleted"] == 1
        assert event_data["self_report_files_not_deleted"] == 0
        assert event_data["self_report_files_shared_kept"] == 0
        for key in (
            "self_report_files_deleted",
            "self_report_files_not_deleted",
            "self_report_files_shared_kept",
        ):
            assert type(event_data[key]) is int
        for value in event_data.values():
            assert "/" not in str(value)
            assert "Firefighter" not in str(value)
            assert "Pat" not in str(value)


class TestTrainingRecordUploads:
    """Owner decision 2026-11-20: anonymising a member also deletes the files
    uploaded to their own training records (the training-records area), by
    an officer or by the member. The records stay."""

    _helpers = TestSelfReportCertificates

    @pytest.fixture
    def root(self, tmp_path, monkeypatch):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
        return uploads

    def _upload(self, root, org_id):
        return self._helpers._certificate(root, org_id, area="training-records")

    @staticmethod
    def _legacy_upload(root, org_id):
        directory = root / "training_attachments" / str(org_id)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid.uuid4().hex}.pdf"
        path.write_bytes(b"%PDF-1.4 legacy record upload")
        return path

    async def test_removes_training_record_uploads(self, db_session, root):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        evidence = self._upload(root, org.id)
        record = await self._helpers._record(
            db_session, org.id, user.id, [self._helpers._entry(evidence, "roster.pdf")]
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not evidence.exists()
        record = await self._helpers._fresh(db_session, TrainingRecord, record.id)
        assert record is not None
        assert record.attachments == []
        assert summary["training_record_files_deleted"] == 1
        assert summary["training_record_files_not_deleted"] == 0
        assert summary["training_record_files_shared_kept"] == 0
        assert summary["self_report_files_deleted"] == 0

    async def test_keeps_an_upload_another_record_names(self, db_session, root):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        colleague = await _make_departed_member(db_session, org, deleted_at=None)
        roster = self._upload(root, org.id)
        entry = self._helpers._entry(roster, "roster.pdf")
        own = await self._helpers._record(db_session, org.id, user.id, [dict(entry)])
        theirs = await self._helpers._record(
            db_session, org.id, colleague.id, [dict(entry)]
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert roster.exists()
        own = await self._helpers._fresh(db_session, TrainingRecord, own.id)
        theirs = await self._helpers._fresh(db_session, TrainingRecord, theirs.id)
        assert own.attachments == []
        assert theirs.attachments == [entry]
        assert summary["training_record_files_shared_kept"] == 1
        assert summary["training_record_files_deleted"] == 0

    async def test_a_failed_delete_keeps_the_entry_renamed(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        evidence = self._upload(root, org.id)
        record = await self._helpers._record(
            db_session,
            org.id,
            user.id,
            [self._helpers._entry(evidence, "Pat Firefighter roster.pdf")],
        )
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        record = await self._helpers._fresh(db_session, TrainingRecord, record.id)
        [entry] = record.attachments
        assert entry["file_path"] == str(evidence)
        assert entry["file_name"] == "attachment.pdf"
        assert summary["training_record_files_not_deleted"] == 1
        assert summary["training_record_files_deleted"] == 0

    async def test_one_reference_check_covers_both_areas(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        certificate = self._helpers._certificate(root, org.id)
        evidence = self._upload(root, org.id)
        await self._helpers._submission(
            db_session, org.id, user.id, [self._helpers._entry(certificate)]
        )
        await self._helpers._record(
            db_session, org.id, user.id, [self._helpers._entry(evidence)]
        )
        spy = AsyncMock(return_value=set())
        monkeypatch.setattr(member_anonymization_service, "referenced_elsewhere", spy)

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        spy.assert_awaited_once()
        assert spy.await_args.args[2] == {str(certificate), str(evidence)}
        assert summary["self_report_files_deleted"] == 1
        assert summary["training_record_files_deleted"] == 1

    async def test_a_submission_entry_in_the_records_area_is_not_an_upload(
        self, db_session, root
    ):
        """Submissions are confined to the self-reports area only, as the
        collector confines them: an entry pointing into training-records is
        not the member's upload, and is left alone."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        elsewhere = self._upload(root, org.id)
        entry = self._helpers._entry(elsewhere, "odd.pdf")
        submission = await self._helpers._submission(
            db_session, org.id, user.id, [dict(entry)]
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert elsewhere.exists()
        submission = await self._helpers._fresh(
            db_session, TrainingSubmission, submission.id
        )
        assert submission.attachments == [entry]
        assert summary["training_record_files_deleted"] == 0

    async def test_legacy_layouts_count_under_their_own_area(self, db_session, root):
        """The legacy self-reports root sits inside the legacy training-records
        root, so the area comes from the collector's classification."""
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        upload = self._legacy_upload(root, org.id)
        certificate = self._helpers._certificate(root, org.id, legacy=True)
        await self._helpers._record(
            db_session,
            org.id,
            user.id,
            [self._helpers._entry(upload), self._helpers._entry(certificate)],
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not upload.exists()
        assert not certificate.exists()
        assert summary["training_record_files_deleted"] == 1
        assert summary["self_report_files_deleted"] == 1

    async def test_a_rerun_after_a_rollback_completes(self, db_session, root):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        evidence = self._upload(root, org.id)
        record = await self._helpers._record(
            db_session, org.id, user.id, [self._helpers._entry(evidence)]
        )
        user_id, org_id, record_id = user.id, org.id, record.id
        await db_session.commit()

        service = MemberAnonymizationService(db_session)
        await service.anonymize_member(user)
        await db_session.rollback()

        assert not evidence.exists()
        record = await self._helpers._fresh(db_session, TrainingRecord, record_id)
        assert record.attachments == [self._helpers._entry(evidence)]
        user = await service.get_user_for_anonymization(user_id, org_id)

        summary = await service.anonymize_member(user)

        record = await self._helpers._fresh(db_session, TrainingRecord, record_id)
        assert record.attachments == []
        assert summary["training_record_files_deleted"] == 1

    async def test_the_audit_event_carries_integer_counts(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        admin = await _make_departed_member(db_session, org, deleted_at=None)
        user = await _make_departed_member(db_session, org)
        evidence = self._upload(root, org.id)
        await self._helpers._record(
            db_session, org.id, user.id, [self._helpers._entry(evidence)]
        )
        audit = AsyncMock()
        monkeypatch.setattr(users_endpoint, "log_audit_event", audit)

        await users_endpoint.anonymize_member(
            user_id=str(user.id),
            request=fake_request(),
            current_user=SimpleNamespace(
                id=admin.id,
                organization_id=org.id,
                rank=None,
                positions=[SimpleNamespace(permissions=["*"])],
            ),
            db=db_session,
            _stepup=None,
        )

        event_data = audit.await_args.kwargs["event_data"]
        assert event_data["training_record_files_deleted"] == 1
        assert event_data["training_record_files_not_deleted"] == 0
        assert event_data["training_record_files_shared_kept"] == 0
        for key in (
            "training_record_files_deleted",
            "training_record_files_not_deleted",
            "training_record_files_shared_kept",
        ):
            assert type(event_data[key]) is int
        for value in event_data.values():
            assert "/" not in str(value)


class TestFilesThatFailToDeleteAreQueued:
    """Waiver and applicant documents: anonymisation drops the row whatever
    happens to the file, because the member's link to it must not survive.
    A file that then failed to delete was named by nothing at all and could
    never be found again. It is queued on pending_file_deletions in the same
    transaction, so the hourly sweep retries it (owner decision 2026-11-23,
    batch A item 1)."""

    @pytest.fixture
    def root(self, tmp_path, monkeypatch):
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
        monkeypatch.setattr(
            file_storage_service, "_load_settings", AsyncMock(return_value={})
        )
        return tmp_path

    @staticmethod
    async def _queued(db, org_id) -> list[tuple[str, str, str]]:
        from app.models.pending_file_deletion import PendingFileDeletion

        rows = (
            await db.execute(
                select(
                    PendingFileDeletion.path,
                    PendingFileDeletion.area,
                    PendingFileDeletion.reason,
                ).where(PendingFileDeletion.organization_id == org_id)
            )
        ).all()
        return sorted(tuple(r) for r in rows)

    async def test_a_waiver_document_that_will_not_delete_is_queued(
        self, db_session, root, monkeypatch
    ):
        from app.models.attendance_waiver import (
            AttendanceWaiverAttachment,
            AttendanceWaiverRequest,
            AttendanceWaiverStatus,
            AttendanceWaiverWorkflow,
        )

        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        request = AttendanceWaiverRequest(
            organization_id=org.id,
            workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
            user_id=user.id,
            event_title_snapshot="Company Drill",
            event_start_snapshot=datetime(2026, 3, 4, 23, tzinfo=UTC),
            session_date=date(2026, 3, 4),
            status=AttendanceWaiverStatus.DENIED,
            category="Medical",
            submitted_at=datetime(2026, 3, 1, tzinfo=UTC),
        )
        db_session.add(request)
        await db_session.flush()
        note = root / str(org.id) / "attendance-waivers" / str(request.id) / "n.pdf"
        note.parent.mkdir(parents=True)
        note.write_bytes(b"%PDF-1.4 doctor's note")
        db_session.add(
            AttendanceWaiverAttachment(
                organization_id=org.id,
                request_id=request.id,
                ordinal=1,
                file_path=str(note),
                mime_type="application/pdf",
                file_size=10,
                sha256="0" * 64,
            )
        )
        await db_session.flush()
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        remaining = (
            await db_session.execute(
                select(AttendanceWaiverAttachment.id).where(
                    AttendanceWaiverAttachment.request_id == request.id
                )
            )
        ).all()
        assert remaining == []
        assert await self._queued(db_session, str(org.id)) == [
            (str(note), "attendance-waivers", "member_anonymization")
        ]
        assert summary["attendance_waiver_files_queued"] == 1

    async def test_an_applicant_document_that_will_not_delete_is_queued(
        self, db_session, root, monkeypatch
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat-queued@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        await db_session.flush()
        licence = root / str(org.id) / "applicants" / str(prospect.id) / "id.jpg"
        licence.parent.mkdir(parents=True)
        licence.write_bytes(b"licence")
        db_session.add(
            ProspectDocument(
                prospect_id=prospect.id,
                document_type="id",
                file_name="id.jpg",
                file_path=str(licence),
            )
        )
        await db_session.flush()
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        documents = (
            await db_session.execute(
                select(ProspectDocument.id).where(
                    ProspectDocument.prospect_id == prospect.id
                )
            )
        ).all()
        assert documents == []
        assert await self._queued(db_session, str(org.id)) == [
            (str(licence), "applicants", "member_anonymization")
        ]
        assert summary["applicant_files_queued"] == 1

    async def test_a_file_that_deletes_queues_nothing(self, db_session, root):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        prospect = ProspectiveMember(
            organization_id=org.id,
            first_name="Pat",
            last_name="Firefighter",
            email="pat-deleted@example.org",
            transferred_user_id=user.id,
        )
        db_session.add(prospect)
        await db_session.flush()
        licence = root / str(org.id) / "applicants" / str(prospect.id) / "id.jpg"
        licence.parent.mkdir(parents=True)
        licence.write_bytes(b"licence")
        db_session.add(
            ProspectDocument(
                prospect_id=prospect.id,
                document_type="id",
                file_name="id.jpg",
                file_path=str(licence),
            )
        )
        await db_session.flush()

        summary = await MemberAnonymizationService(db_session).anonymize_member(user)

        assert not licence.exists()
        assert await self._queued(db_session, str(org.id)) == []
        assert summary["applicant_files_queued"] == 0


class TestPathLessEntriesAreRelabelled:
    """Old text-only attachments became ``{"file_name": ...}`` entries with
    no stored file (migration 0c22a95b94b8). Their name is the uploader's
    text, often the member's own name, and anonymisation relabelled only
    entries naming a stored file (owner decision 2026-11-23, batch A item 2)."""

    async def test_a_path_less_name_is_replaced_on_submissions_and_records(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        submission = TrainingSubmission(
            organization_id=org.id,
            submitted_by=user.id,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2026, 1, 5),
            hours_completed=1.0,
            status=SubmissionStatus.APPROVED,
            attachments=[{"id": "s-1", "file_name": "Pat_Firefighter_CPR.pdf"}],
        )
        record = TrainingRecord(
            organization_id=org.id,
            user_id=user.id,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2026, 1, 5),
            hours_completed=1.0,
            status=TrainingStatus.COMPLETED,
            attachments=[
                {"id": "r-1", "file_name": "Pat Firefighter card.JPG"},
                {"id": "r-2", "file_name": "notes"},
                "a bare string left over",
            ],
        )
        db_session.add_all([submission, record])
        await db_session.flush()

        await MemberAnonymizationService(db_session).anonymize_member(user)

        await db_session.refresh(submission)
        await db_session.refresh(record)
        assert submission.attachments == [{"id": "s-1", "file_name": "certificate.pdf"}]
        assert record.attachments[:2] == [
            {"id": "r-1", "file_name": "attachment.jpg"},
            {"id": "r-2", "file_name": "attachment"},
        ]


class TestExcusedMeetingsStayExcused:
    """Every attendance reader counts a meeting as excused from a non-blank
    ``waiver_reason``. Anonymisation cleared the column, which turned each
    excused meeting into an absence (owner decision 2026-11-23, batch A
    item 3)."""

    async def _meeting(self, db, org, title):
        meeting = Meeting(
            organization_id=org.id,
            title=title,
            meeting_date=date(2026, 3, 1),
            meeting_type=MeetingType.BUSINESS,
        )
        db.add(meeting)
        await db.flush()
        return meeting

    async def test_a_waiver_keeps_neutral_wording_and_an_absence_stays_blank(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        secretary = await _make_departed_member(db_session, org, deleted_at=None)
        by_hand = await self._meeting(db_session, org, "By hand")
        absent = await self._meeting(db_session, org, "Absent")
        db_session.add_all(
            [
                MeetingAttendee(
                    organization_id=org.id,
                    meeting_id=by_hand.id,
                    user_id=user.id,
                    present=False,
                    excused=True,
                    waiver_reason="Pat's knee surgery recovery",
                    waiver_granted_by=secretary.id,
                    waiver_granted_at=datetime(2026, 3, 2, tzinfo=UTC),
                ),
                MeetingAttendee(
                    organization_id=org.id,
                    meeting_id=absent.id,
                    user_id=user.id,
                    present=False,
                ),
            ]
        )
        await db_session.flush()

        await MemberAnonymizationService(db_session).anonymize_member(user)

        rows = dict(
            (
                await db_session.execute(
                    select(Meeting.title, MeetingAttendee.waiver_reason)
                    .join(Meeting, Meeting.id == MeetingAttendee.meeting_id)
                    .where(MeetingAttendee.user_id == user.id)
                )
            ).all()
        )
        assert rows == {
            "By hand": MEETING_WAIVER_TEXT,
            "Absent": None,
        }
