"""Deleting an in-use requirement, pipeline or form keeps its history.

The department's rule, following ``LocationService.remove_location``: when a
record is in use, delete deactivates (or, for a form, archives) it rather than
destroying what points at it; when nothing uses it, delete still deletes.

DB-backed throughout, so marked ``integration`` (pitfall #30b).
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text

from app.api.v1.endpoints import training as training_endpoints
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.forms import Form, FormStatus, FormSubmission
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.schemas.training_program import TrainingProgramCreate
from app.services.forms_service import FormsService
from app.services.training_program_service import (
    PROGRAM_DEACTIVATED_WITHDRAWAL_REASON,
    TrainingProgramService,
)

pytestmark = pytest.mark.integration


async def _member(db_session, org_id: str) -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return user_id


async def _requirement(db_session, org_id: str, name: str) -> TrainingRequirement:
    requirement = TrainingRequirement(
        organization_id=org_id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=4.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=True,
        active=True,
    )
    db_session.add(requirement)
    await db_session.flush()
    return requirement


async def _program(db_session, org_id: str, admin_id: str, name: str):
    program, error = await TrainingProgramService(db_session).create_training_program(
        TrainingProgramCreate(name=name), org_id, admin_id
    )
    assert error is None, error
    return program


async def _enroll(db_session, org_id, user_id, program_id, status):
    enrollment = ProgramEnrollment(
        organization_id=org_id,
        user_id=user_id,
        program_id=program_id,
        status=status,
    )
    db_session.add(enrollment)
    await db_session.flush()
    return enrollment


async def _reload(db_session, model, row_id):
    result = await db_session.execute(
        select(model)
        .where(model.id == str(row_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def _officer(org_id: str, user_id: str):
    return SimpleNamespace(
        id=user_id, username="training-officer", organization_id=org_id
    )


class TestTrainingRequirementDelete:
    async def test_requirement_with_member_progress_is_deactivated(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        audit = AsyncMock()
        monkeypatch.setattr(training_endpoints, "log_audit_event", audit)
        requirement = await _requirement(db_session, org_id, "Annual SCBA")
        program = await _program(db_session, org_id, admin_id, "Recruit School")
        enrollment = await _enroll(
            db_session, org_id, admin_id, program.id, EnrollmentStatus.COMPLETED
        )
        progress = RequirementProgress(
            enrollment_id=enrollment.id,
            requirement_id=requirement.id,
            status=RequirementProgressStatus.COMPLETED,
            progress_value=4.0,
        )
        db_session.add(progress)
        await db_session.flush()

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        kept = await _reload(db_session, TrainingRequirement, requirement.id)
        assert kept is not None
        assert kept.active is False
        # The cascade would have taken the member's progress with it.
        assert await _reload(db_session, RequirementProgress, progress.id) is not None
        assert audit.await_args.kwargs["event_type"] == (
            "training_requirement_deactivated"
        )

    async def test_requirement_named_only_by_a_compliance_profile_is_deactivated(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        requirement = await _requirement(db_session, org_id, "EVOC")
        config = ComplianceConfig(organization_id=org_id)
        db_session.add(config)
        await db_session.flush()
        profile = ComplianceProfile(
            config_id=config.id,
            name="Drivers",
            required_requirement_ids=[requirement.id],
        )
        db_session.add(profile)
        await db_session.flush()

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        kept = await _reload(db_session, TrainingRequirement, requirement.id)
        assert kept is not None
        assert kept.active is False

    async def test_unused_requirement_is_deleted(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        audit = AsyncMock()
        monkeypatch.setattr(training_endpoints, "log_audit_event", audit)
        requirement = await _requirement(db_session, org_id, "Typo requirement")

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        assert await _reload(db_session, TrainingRequirement, requirement.id) is None
        assert audit.await_args.kwargs["event_type"] == "training_requirement_deleted"


class TestTrainingProgramDelete:
    async def test_program_with_a_graduate_is_deactivated_and_keeps_history(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        trainee_id = await _member(db_session, org_id)
        requirement = await _requirement(db_session, org_id, "Live burn")
        program = await _program(db_session, org_id, admin_id, "Recruit School")
        graduate = await _enroll(
            db_session, org_id, admin_id, program.id, EnrollmentStatus.COMPLETED
        )
        in_progress = await _enroll(
            db_session, org_id, trainee_id, program.id, EnrollmentStatus.ACTIVE
        )
        progress = RequirementProgress(
            enrollment_id=graduate.id,
            requirement_id=requirement.id,
            status=RequirementProgressStatus.COMPLETED,
        )
        db_session.add(progress)
        await db_session.flush()

        outcome, error = await TrainingProgramService(
            db_session
        ).delete_training_program(uuid.UUID(program.id), org_id)

        assert (outcome, error) == ("deactivated", None)
        kept = await _reload(db_session, TrainingProgram, program.id)
        assert kept is not None
        assert kept.active is False
        graduate_row = await _reload(db_session, ProgramEnrollment, graduate.id)
        assert graduate_row.status == EnrollmentStatus.COMPLETED
        assert await _reload(db_session, RequirementProgress, progress.id) is not None
        withdrawn = await _reload(db_session, ProgramEnrollment, in_progress.id)
        assert withdrawn.status == EnrollmentStatus.WITHDRAWN
        assert withdrawn.withdrawn_at is not None
        assert withdrawn.withdrawal_reason == PROGRAM_DEACTIVATED_WITHDRAWAL_REASON

    async def test_program_without_graduates_is_deleted(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        program = await _program(db_session, org_id, admin_id, "Abandoned draft")
        enrollment = await _enroll(
            db_session, org_id, admin_id, program.id, EnrollmentStatus.ACTIVE
        )

        outcome, error = await TrainingProgramService(
            db_session
        ).delete_training_program(uuid.UUID(program.id), org_id)

        assert (outcome, error) == ("deleted", None)
        assert await _reload(db_session, TrainingProgram, program.id) is None
        assert await _reload(db_session, ProgramEnrollment, enrollment.id) is None


class TestFormDelete:
    async def test_form_with_submissions_is_archived_and_keeps_them(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        form = Form(
            organization_id=org_id,
            name="Equipment Request",
            status=FormStatus.PUBLISHED,
        )
        db_session.add(form)
        await db_session.flush()
        submission = FormSubmission(
            organization_id=org_id,
            form_id=form.id,
            data={"item": "gloves"},
            submitted_at=datetime.now(timezone.utc),
        )
        db_session.add(submission)
        await db_session.flush()

        outcome, error = await FormsService(db_session).delete_form(
            uuid.UUID(form.id), org_id
        )

        assert (outcome, error) == ("archived", None)
        kept = await _reload(db_session, Form, form.id)
        assert kept is not None
        assert kept.status == FormStatus.ARCHIVED
        assert await _reload(db_session, FormSubmission, submission.id) is not None

    async def test_form_without_submissions_is_deleted(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        form = Form(organization_id=org_id, name="Draft", status=FormStatus.DRAFT)
        db_session.add(form)
        await db_session.flush()

        outcome, error = await FormsService(db_session).delete_form(
            uuid.UUID(form.id), org_id
        )

        assert (outcome, error) == ("deleted", None)
        assert await _reload(db_session, Form, form.id) is None
