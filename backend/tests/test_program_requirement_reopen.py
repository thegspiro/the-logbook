"""A correction that lowers credit below a completed requirement reopens it.

Owner decision 2026-11-23 ("Lowered hours reopen a completed program
requirement"). When a shift report is corrected or a session re-finalized
(both restate their credit) or a credited record is voided (its credit
reversed), and the member falls below a requirement they had completed:

* the requirement goes back to in progress and ``completed_at`` is cleared;
* the training officers are told, by email and bell, once;
* certificates, the enrollment's completion and phase advancement are not
  touched.

A drop that stays at or above the target changes nothing, and a later restore
completes the requirement again.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramRequirement,
    ProgramStructureType,
    ProgressCreditSource,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus
from app.services.email_service import EmailService
from app.services.training_program_service import TrainingProgramService
from tests.waiver_request_support import assign, make_position

pytestmark = pytest.mark.integration

FEEDS = [ProgressCreditSource.SHIFT_REPORT, ProgressCreditSource.TRAINING_SESSION]


def _uid():
    return str(uuid.uuid4())


@pytest.fixture
async def setup(db_session):
    db = db_session
    org = Organization(
        id=_uid(),
        name="Reopen Department",
        slug=f"reopen-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    member = User(
        id=_uid(),
        organization_id=org.id,
        username=f"recruit-{handle}",
        email=f"{handle}@reopen.test",
        first_name="Riley",
        last_name="Recruit",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"officer-{handle}@reopen.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add_all([member, officer])
    await db.flush()
    position = await make_position(
        db,
        org.id,
        "Training Officer",
        slug="training_officer",
        permissions=["training.manage"],
    )
    await assign(db, officer.id, position)
    program = TrainingProgram(
        id=_uid(),
        organization_id=org.id,
        name="Probationary Firefighter",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="Live Fire Hours",
        requirement_type=RequirementType.HOURS,
        required_hours=10.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=False,
        active=True,
    )
    db.add_all([program, requirement])
    await db.flush()
    db.add(
        ProgramRequirement(
            id=_uid(),
            program_id=program.id,
            requirement_id=requirement.id,
            is_required=True,
            sort_order=0,
        )
    )
    enrollment = ProgramEnrollment(
        id=_uid(),
        organization_id=org.id,
        user_id=member.id,
        program_id=program.id,
        status=EnrollmentStatus.ACTIVE,
    )
    db.add(enrollment)
    await db.flush()
    progress = RequirementProgress(
        id=_uid(),
        enrollment_id=enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0.0,
        progress_percentage=0.0,
    )
    db.add(progress)
    await db.flush()
    return {
        "org": org.id,
        "officer": officer.id,
        "enrollment": enrollment.id,
        "progress": progress.id,
    }


async def _credit(db, ids, source_type, units, *, restate=True):
    progress, error = await TrainingProgramService(db).apply_requirement_credit(
        progress_id=ids["progress"],
        organization_id=ids["org"],
        source_type=source_type,
        source_id="source-1",
        units=units,
        verified_by=ids["officer"],
        restate=restate,
    )
    assert error is None
    return progress


async def _row(db, ids) -> dict:
    db.expire_all()
    row = (
        await db.execute(
            text(
                "SELECT status, progress_value, progress_percentage, completed_at "
                "FROM requirement_progress WHERE id = :id"
            ),
            {"id": ids["progress"]},
        )
    ).one()
    return dict(row._mapping)


async def _enrollment(db, ids) -> dict:
    row = (
        await db.execute(
            text("SELECT status, completed_at FROM program_enrollments WHERE id = :id"),
            {"id": ids["enrollment"]},
        )
    ).one()
    return dict(row._mapping)


async def _bells(db, ids) -> list:
    rows = await db.execute(
        text(
            "SELECT subject FROM notification_logs "
            "WHERE recipient_id = :r AND subject LIKE 'Requirement reopened%'"
        ),
        {"r": ids["officer"]},
    )
    return [r[0] for r in rows]


@pytest.fixture
def sent_emails():
    with patch.object(
        EmailService, "send_email", AsyncMock(return_value=(1, 0))
    ) as send:
        yield send


async def _complete(db, ids, source_type):
    await _credit(db, ids, source_type, 12.0, restate=False)
    row = await _row(db, ids)
    assert row["status"] == "completed"
    assert row["completed_at"] is not None
    enrollment = await _enrollment(db, ids)
    assert enrollment["status"] == "completed"
    return row


class TestTheDrop:
    @pytest.mark.parametrize("source_type", FEEDS)
    async def test_a_correction_below_the_target_reopens_it(
        self, db_session, setup, sent_emails, source_type
    ):
        await _complete(db_session, setup, source_type)
        enrollment_before = await _enrollment(db_session, setup)

        await _credit(db_session, setup, source_type, 6.0)

        row = await _row(db_session, setup)
        assert row["status"] == "in_progress"
        assert row["completed_at"] is None
        assert row["progress_value"] == 6.0
        assert row["progress_percentage"] == 60.0
        # The enrollment's completion is not touched.
        assert await _enrollment(db_session, setup) == enrollment_before
        assert await _bells(db_session, setup) == [
            "Requirement reopened: Riley Recruit - Probationary Firefighter"
        ]
        assert sent_emails.await_count == 1
        call = sent_emails.await_args.kwargs
        assert call["template_type"] == "program_requirement_reopened"
        assert "Live Fire Hours" in call["subject"]
        assert "6 (60%)" in call["text_body"]

    async def test_a_voided_credit_reopens_it(self, db_session, setup, sent_emails):
        await _complete(db_session, setup, ProgressCreditSource.TRAINING_SESSION)

        reversed_count = await TrainingProgramService(
            db_session
        ).reverse_credits_for_source(organization_id=setup["org"], source_id="source-1")

        assert reversed_count == 1
        row = await _row(db_session, setup)
        assert row["status"] == "in_progress"
        assert row["completed_at"] is None
        assert (await _enrollment(db_session, setup))["status"] == "completed"
        assert len(await _bells(db_session, setup)) == 1

    async def test_the_same_correction_twice_tells_the_officers_once(
        self, db_session, setup, sent_emails
    ):
        source = ProgressCreditSource.SHIFT_REPORT
        await _complete(db_session, setup, source)

        await _credit(db_session, setup, source, 6.0)
        await _credit(db_session, setup, source, 6.0)

        assert (await _row(db_session, setup))["status"] == "in_progress"
        assert len(await _bells(db_session, setup)) == 1
        assert sent_emails.await_count == 1


class TestADropThatStaysAbove:
    @pytest.mark.parametrize("source_type", FEEDS)
    async def test_nothing_changes(self, db_session, setup, sent_emails, source_type):
        before = await _complete(db_session, setup, source_type)

        await _credit(db_session, setup, source_type, 10.0)

        row = await _row(db_session, setup)
        assert row["status"] == "completed"
        assert row["completed_at"] == before["completed_at"]
        assert row["progress_value"] == 10.0
        assert await _bells(db_session, setup) == []
        sent_emails.assert_not_awaited()


class TestALaterRestore:
    async def test_restoring_the_hours_completes_it_again(
        self, db_session, setup, sent_emails
    ):
        source = ProgressCreditSource.TRAINING_SESSION
        await _complete(db_session, setup, source)
        await _credit(db_session, setup, source, 6.0)
        assert (await _row(db_session, setup))["status"] == "in_progress"

        await _credit(db_session, setup, source, 12.0)

        row = await _row(db_session, setup)
        assert row["status"] == "completed"
        assert row["completed_at"] is not None
        assert row["progress_percentage"] == 100.0
        # One reopening, one notice; the restore sends none.
        assert len(await _bells(db_session, setup)) == 1


class TestOfficerDecisionsStand:
    async def test_a_verified_requirement_is_not_reopened(
        self, db_session, setup, sent_emails
    ):
        source = ProgressCreditSource.SHIFT_REPORT
        await _complete(db_session, setup, source)
        await db_session.execute(
            text("UPDATE requirement_progress SET status = 'verified' WHERE id = :id"),
            {"id": setup["progress"]},
        )

        await _credit(db_session, setup, source, 6.0)

        assert (await _row(db_session, setup))["status"] == "verified"
        assert await _bells(db_session, setup) == []

    async def test_the_enrollment_s_completion_is_kept(
        self, db_session, setup, sent_emails
    ):
        source = ProgressCreditSource.SHIFT_REPORT
        await _complete(db_session, setup, source)
        stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await db_session.execute(
            text(
                "UPDATE program_enrollments SET completed_at = :t, "
                "progress_percentage = 100 WHERE id = :id"
            ),
            {"t": stamp, "id": setup["enrollment"]},
        )

        await _credit(db_session, setup, source, 6.0)

        enrollment = (
            await db_session.execute(
                select(ProgramEnrollment).where(
                    ProgramEnrollment.id == setup["enrollment"]
                )
            )
        ).scalar_one()
        assert enrollment.status == EnrollmentStatus.COMPLETED
        assert enrollment.completed_at == stamp
