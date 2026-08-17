"""Tests for the member anonymization workflow (right to erasure)."""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from app.models.forms import Form, FormSubmission
from app.models.inventory import MemberSizePreferences
from app.models.medical_screening import ScreeningRecord, ScreeningType
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    PipelineStepType,
    ProspectiveMember,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    User,
    UserStatus,
)
from app.services.member_anonymization_service import MemberAnonymizationService

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
        assert submission.submitter_name is None
        assert submission.submitter_email is None
        assert submission.ip_address is None
        assert submission.user_agent is None
        assert submission.integration_result is None

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

    async def test_refuses_double_anonymization(self, db_session):
        org = await _make_org(db_session)
        user = await _make_departed_member(db_session, org)
        service = MemberAnonymizationService(db_session)
        await service.anonymize_member(user)
        with pytest.raises(ValueError, match="already anonymized"):
            await service.anonymize_member(user)

    async def test_org_scoped_lookup_blocks_cross_tenant(self, db_session):
        org_a = await _make_org(db_session, name="Org A")
        org_b = await _make_org(db_session, name="Org B")
        user_b = await _make_departed_member(db_session, org_b)

        service = MemberAnonymizationService(db_session)
        assert (await service.get_user_for_anonymization(user_b.id, org_a.id)) is None
        assert (
            await service.get_user_for_anonymization(user_b.id, org_b.id)
        ) is not None
