"""
Prerequisite programs and concurrent enrollment, set through the program
create / build / update paths.

Both columns were enforced at enrollment long before anything but clone and
import could write them. These tests pin the write side: what is persisted,
how an update clears or leaves the values, which ids are refused, and that a
prerequisite set this way blocks enrollment through the existing gates.

DB-backed throughout, so marked ``integration`` (pitfall #30b).
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.models.training import EnrollmentStatus, ProgramEnrollment, TrainingProgram
from app.schemas.training_program import (
    ProgramBuildRequest,
    ProgramEnrollmentCreate,
    TrainingProgramCreate,
    TrainingProgramResponse,
    TrainingProgramUpdate,
)
from app.services.training_program_service import TrainingProgramService

pytestmark = pytest.mark.integration


async def _other_org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Other Dept", "slug": f"other-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _program(svc, org_id, admin_id, name, **fields):
    program, error = await svc.create_training_program(
        TrainingProgramCreate(name=name, **fields), org_id, admin_id
    )
    assert error is None, error
    return program


async def _reload(db_session, program_id) -> TrainingProgram:
    result = await db_session.execute(
        select(TrainingProgram)
        .where(TrainingProgram.id == str(program_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


class TestCreateAndBuildPersist:
    async def test_create_persists_both_and_reports_names(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")

        program = await _program(
            svc,
            org_id,
            admin_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id, recruit.id],
            allows_concurrent_enrollment=False,
        )

        stored = await _reload(db_session, program.id)
        assert stored.prerequisite_program_ids == [recruit.id]  # de-duplicated
        assert stored.allows_concurrent_enrollment is False

        body = TrainingProgramResponse.model_validate(program).model_dump()
        assert body["prerequisite_program_ids"] == [recruit.id]
        assert body["allows_concurrent_enrollment"] is False
        assert body["prerequisite_programs"] == [
            {"id": recruit.id, "name": "Recruit School", "active": True}
        ]

    async def test_create_defaults_concurrency_to_allowed(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)

        program = await _program(svc, org_id, admin_id, "Orientation")

        stored = await _reload(db_session, program.id)
        assert stored.allows_concurrent_enrollment is True
        assert stored.prerequisite_program_ids is None

    async def test_build_persists_both(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")

        program, error = await svc.build_program(
            ProgramBuildRequest(
                program=TrainingProgramCreate(
                    name="Officer Development",
                    structure_type="flexible",
                    prerequisite_program_ids=[recruit.id],
                    allows_concurrent_enrollment=False,
                )
            ),
            org_id,
            admin_id,
        )

        assert error is None, error
        stored = await _reload(db_session, program.id)
        assert stored.prerequisite_program_ids == [recruit.id]
        assert stored.allows_concurrent_enrollment is False
        assert program.prerequisite_programs == [
            {"id": recruit.id, "name": "Recruit School", "active": True}
        ]

    async def test_build_rejects_another_orgs_program(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        other_org = await _other_org(db_session)
        svc = TrainingProgramService(db_session)
        foreign = await _program(svc, other_org, admin_id, "Their Program")

        program, error = await svc.build_program(
            ProgramBuildRequest(
                program=TrainingProgramCreate(
                    name="Ours", prerequisite_program_ids=[foreign.id]
                )
            ),
            org_id,
            admin_id,
        )

        assert program is None
        assert error == "Invalid prerequisite program"

    async def test_create_rejects_an_unknown_id(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)

        program, error = await svc.create_training_program(
            TrainingProgramCreate(name="Ours", prerequisite_program_ids=[uuid.uuid4()]),
            org_id,
            admin_id,
        )

        assert program is None
        assert error == "Invalid prerequisite program"


class TestUpdate:
    async def test_sets_both(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        driver = await _program(svc, org_id, admin_id, "Driver Operator")

        program, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(
                prerequisite_program_ids=[recruit.id],
                allows_concurrent_enrollment=False,
            ),
        )

        assert error is None, error
        stored = await _reload(db_session, driver.id)
        assert stored.prerequisite_program_ids == [recruit.id]
        assert stored.allows_concurrent_enrollment is False
        assert program.prerequisite_programs == [
            {"id": recruit.id, "name": "Recruit School", "active": True}
        ]

    async def test_omitted_leaves_both_alone(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            admin_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
            allows_concurrent_enrollment=False,
        )

        _, error = await svc.update_training_program(
            uuid.UUID(driver.id), org_id, TrainingProgramUpdate(name="Driver/Op")
        )

        assert error is None, error
        stored = await _reload(db_session, driver.id)
        assert stored.name == "Driver/Op"
        assert stored.prerequisite_program_ids == [recruit.id]
        assert stored.allows_concurrent_enrollment is False

    @pytest.mark.parametrize("cleared", [[], None])
    async def test_empty_or_null_clears(self, db_session, setup_org_and_admin, cleared):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            admin_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )

        program, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=cleared),
        )

        assert error is None, error
        stored = await _reload(db_session, driver.id)
        assert not stored.prerequisite_program_ids
        assert program.prerequisite_programs == []

    async def test_null_concurrency_is_refused(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        driver = await _program(svc, org_id, admin_id, "Driver Operator")

        program, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(allows_concurrent_enrollment=None),
        )

        assert program is None
        assert error is not None
        assert "same time" in error

    async def test_rejects_itself(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        driver = await _program(svc, org_id, admin_id, "Driver Operator")

        program, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=[driver.id]),
        )

        assert program is None
        assert error == "A program cannot be its own prerequisite"

    async def test_rejects_another_orgs_program(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        other_org = await _other_org(db_session)
        svc = TrainingProgramService(db_session)
        driver = await _program(svc, org_id, admin_id, "Driver Operator")
        foreign = await _program(svc, other_org, admin_id, "Their Program")

        program, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=[foreign.id]),
        )

        assert program is None
        assert error == "Invalid prerequisite program"
        stored = await _reload(db_session, driver.id)
        assert stored.prerequisite_program_ids is None

    async def test_rejects_a_direct_cycle(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            admin_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )

        program, error = await svc.update_training_program(
            uuid.UUID(recruit.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=[driver.id]),
        )

        assert program is None
        assert error is not None
        assert error.startswith("Driver Operator already requires this program")

    async def test_rejects_an_indirect_cycle(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        driver = await _program(
            svc, org_id, admin_id, "Driver", prerequisite_program_ids=[recruit.id]
        )
        officer = await _program(
            svc, org_id, admin_id, "Officer", prerequisite_program_ids=[driver.id]
        )

        program, error = await svc.update_training_program(
            uuid.UUID(recruit.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=[officer.id]),
        )

        assert program is None
        assert error is not None
        assert error.startswith("Officer already requires")


class TestDeleteDropsDanglingPrerequisite:
    async def test_deleting_a_prerequisite_removes_it_from_dependents(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        hazmat = await _program(svc, org_id, admin_id, "Hazmat Ops")
        driver = await _program(
            svc,
            org_id,
            admin_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id, hazmat.id],
        )

        ok, error = await svc.delete_training_program(uuid.UUID(recruit.id), org_id)

        assert ok
        assert error is None
        stored = await _reload(db_session, driver.id)
        assert stored.prerequisite_program_ids == [hazmat.id]


class TestEnforcementOfAPrerequisiteSetThroughTheApi:
    async def test_member_without_the_prerequisite_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(svc, org_id, member_id, "Driver Operator")
        _, error = await svc.update_training_program(
            uuid.UUID(driver.id),
            org_id,
            TrainingProgramUpdate(prerequisite_program_ids=[recruit.id]),
        )
        assert error is None, error

        eligibility = await svc.get_enrollment_eligibility(uuid.UUID(driver.id), org_id)
        row = next(r for r in eligibility if str(r["user_id"]) == member_id)
        assert row["status"] == "prerequisite"
        assert row["eligible"] is False
        assert row["reason"] == "Must first complete: Recruit School"

        enrollments, errors = await svc.bulk_enroll_members(
            uuid.UUID(driver.id), [uuid.UUID(member_id)], org_id
        )
        assert enrollments == []
        assert errors == ["Admin User has not completed prerequisite program"]

        # Completing the prerequisite lifts the gate.
        db_session.add(
            ProgramEnrollment(
                organization_id=org_id,
                user_id=member_id,
                program_id=recruit.id,
                status=EnrollmentStatus.COMPLETED,
            )
        )
        await db_session.flush()
        enrollments, errors = await svc.bulk_enroll_members(
            uuid.UUID(driver.id), [uuid.UUID(member_id)], org_id
        )
        assert errors == []
        assert len(enrollments) == 1


class TestSingleMemberEnrollmentEndpoint:
    """POST /training/programs/enrollments enrolled anyone, prerequisites or
    not; the gate now sits in enroll_member, which every path goes through."""

    async def test_refuses_a_member_who_has_not_finished_a_prerequisite(
        self, db_session, setup_org_and_admin
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints.training_programs import enroll_member_in_program
        from app.models.user import User

        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            member_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )
        officer = (
            await db_session.execute(
                select(User)
                .where(User.id == member_id)
                .options(selectinload(User.positions))
            )
        ).scalar_one()

        def request():
            return enroll_member_in_program(
                enrollment_data=ProgramEnrollmentCreate(
                    user_id=uuid.UUID(member_id), program_id=uuid.UUID(driver.id)
                ),
                db=db_session,
                current_user=officer,
            )

        with pytest.raises(HTTPException) as caught:
            await request()
        assert caught.value.status_code == 400
        assert caught.value.detail == "Must first complete: Recruit School"
        stored = await db_session.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == member_id,
                ProgramEnrollment.program_id == driver.id,
            )
        )
        assert stored.scalars().first() is None

        # Completing the prerequisite lifts the gate.
        db_session.add(
            ProgramEnrollment(
                organization_id=org_id,
                user_id=member_id,
                program_id=recruit.id,
                status=EnrollmentStatus.COMPLETED,
            )
        )
        await db_session.flush()
        enrollment = await request()
        assert str(enrollment.program_id) == driver.id
        assert enrollment.status == EnrollmentStatus.ACTIVE


class TestDetailEndpointReportsTheProgramsOwnSettings:
    async def test_detail_carries_prerequisites_concurrency_and_recert(
        self, db_session, setup_org_and_admin
    ):
        """The edit form is seeded from this response; anything it leaves out
        is saved back as the schema default the next time someone edits."""
        from app.api.v1.endpoints.training_programs import get_training_program
        from app.models.user import User

        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, admin_id, "Recruit School")
        nremt = await _program(
            svc,
            org_id,
            admin_id,
            "NREMT Recert",
            prerequisite_program_ids=[recruit.id],
            allows_concurrent_enrollment=False,
            recert_enabled=True,
            recert_interval_months=24,
            recert_anchor_month=3,
            recert_anchor_day=30,
        )
        user = (
            await db_session.execute(
                select(User)
                .where(User.id == admin_id)
                .options(selectinload(User.positions))
            )
        ).scalar_one()

        body = await get_training_program(
            program_id=uuid.UUID(nremt.id), db=db_session, current_user=user
        )

        assert body.prerequisite_program_ids == [recruit.id]
        assert [p.name for p in body.prerequisite_programs] == ["Recruit School"]
        assert body.allows_concurrent_enrollment is False
        assert body.recert_enabled is True
        assert body.recert_interval_months == 24
        assert (body.recert_anchor_month, body.recert_anchor_day) == (3, 30)


class TestTheOriginalEnrollmentEndpoint:
    """POST /training/enrollments (training.py) predates enroll_member and
    enrolled without any prerequisite check. It now applies the same gate,
    with the same refusal, and skips an inactive prerequisite the same way."""

    async def _call(self, db_session, org_id, member_id, program_id, monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock

        from app.api.v1.endpoints import training as training_endpoints

        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        return await training_endpoints.enroll_member_in_program(
            user_id=uuid.UUID(member_id),
            program_id=uuid.UUID(program_id),
            db=db_session,
            current_user=SimpleNamespace(
                id=member_id, username="chief", organization_id=org_id
            ),
        )

    async def _stored(self, db_session, member_id, program_id):
        result = await db_session.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == member_id,
                ProgramEnrollment.program_id == program_id,
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )
        return result.scalars().all()

    async def test_refuses_a_missing_prerequisite_and_allows_a_met_one(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        from fastapi import HTTPException

        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            member_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )

        with pytest.raises(HTTPException) as caught:
            await self._call(db_session, org_id, member_id, driver.id, monkeypatch)
        assert caught.value.status_code == 400
        assert caught.value.detail == "Must first complete: Recruit School"
        assert await self._stored(db_session, member_id, driver.id) == []

        db_session.add(
            ProgramEnrollment(
                organization_id=org_id,
                user_id=member_id,
                program_id=recruit.id,
                status=EnrollmentStatus.COMPLETED,
            )
        )
        await db_session.flush()
        response = await self._call(
            db_session, org_id, member_id, driver.id, monkeypatch
        )
        assert response["status"] == "active"
        assert response["program_name"] == "Driver Operator"
        assert len(await self._stored(db_session, member_id, driver.id)) == 1

    async def test_an_inactive_prerequisite_blocks_nobody(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            member_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )
        _, error = await svc.update_training_program(
            uuid.UUID(recruit.id), org_id, TrainingProgramUpdate(active=False)
        )
        assert error is None, error

        response = await self._call(
            db_session, org_id, member_id, driver.id, monkeypatch
        )
        assert response["status"] == "active"
        assert len(await self._stored(db_session, member_id, driver.id)) == 1


class TestProbationaryAutoEnrollment:
    """Converting a prospect auto-enrolls them in the department's
    probationary pipeline. That enrollment now passes the shared prerequisite
    check: a member missing one is left out of that pipeline only, the
    conversion completes, and the training officers are emailed after the
    commit naming the member, the pipeline and what is missing."""

    async def _department(self, db_session, org_id, **program_fields):
        from app.models.user import Organization, Position, User, UserStatus

        svc = TrainingProgramService(db_session)
        org = (
            await db_session.execute(
                select(Organization).where(Organization.id == org_id)
            )
        ).scalar_one()
        recruit = await _program(svc, org_id, None, "Recruit School")
        probation = await _program(
            svc, org_id, None, "Probationary Firefighter", **program_fields
        )
        org.settings = {"training": {"auto_enroll_program_id": probation.id}}
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name="Training Officer",
            slug=f"to-{uuid.uuid4().hex[:6]}",
            permissions=["training.manage"],
        )
        db_session.add(position)
        await db_session.flush()
        officer = User(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            username=f"to{uuid.uuid4().hex[:8]}",
            email=f"to-{uuid.uuid4().hex[:6]}@dept.test",
            first_name="Terry",
            last_name="Officer",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        officer.positions = [position]
        db_session.add(officer)
        await db_session.flush()
        return recruit, probation, officer

    async def _convert(self, db_session, org_id):
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        pipeline_svc = MembershipPipelineService(db_session)
        pipeline = await pipeline_svc.create_pipeline(
            organization_id=org_id, name="Applicants"
        )
        prospect = await pipeline_svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Jordan",
                "last_name": f"Hale{uuid.uuid4().hex[:4]}",
                "email": f"j-{uuid.uuid4().hex[:8]}@example.com",
                "pipeline_id": str(pipeline.id),
            },
        )
        result = await pipeline_svc.transfer_to_membership(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            transferred_by=None,
        )
        assert result["success"] is True, result
        return prospect, result

    async def _enrollments(self, db_session, user_id):
        result = await db_session.execute(
            select(ProgramEnrollment).where(ProgramEnrollment.user_id == user_id)
        )
        return result.scalars().all()

    async def test_a_missing_prerequisite_skips_the_pipeline_and_emails_officers(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        from unittest.mock import AsyncMock, MagicMock

        from app.models.user import User
        from app.services import email_service as email_service_module

        org_id, _ = setup_org_and_admin
        recruit, probation, officer = await self._department(
            db_session, org_id, prerequisite_program_ids=[]
        )
        probation.prerequisite_program_ids = [recruit.id]
        await db_session.flush()

        prospect, result = await self._convert(db_session, org_id)

        # Converted, but not enrolled in the pipeline they are not cleared for.
        user_id = str(result["user_id"])
        assert await self._enrollments(db_session, user_id) == []
        assert "Not enrolled in training program Probationary Firefighter" in (
            result["message"]
        )
        assert "Recruit School" in result["message"]

        # The officers' email waits for the caller's commit.
        notify = result.pop("_notify_enrollment_skipped")
        send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            email_service_module,
            "EmailService",
            MagicMock(return_value=MagicMock(send_email=send_email)),
        )
        await db_session.flush()
        await notify()

        send_email.assert_awaited_once()
        sent = send_email.await_args.kwargs
        assert sent["to_emails"] == [officer.email]
        member = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        for text_part in (sent["subject"], sent["text_body"], sent["html_body"]):
            assert member.display_name in text_part
            assert "Probationary Firefighter" in text_part
        assert "Recruit School" in sent["text_body"]
        assert "Recruit School" in sent["html_body"]

    async def test_a_met_prerequisite_enrolls_as_before(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        recruit, probation, _ = await self._department(db_session, org_id)
        # An inactive prerequisite is skipped, as on every other path.
        probation.prerequisite_program_ids = [recruit.id]
        recruit.active = False
        await db_session.flush()

        _, result = await self._convert(db_session, org_id)

        assert "_notify_enrollment_skipped" not in result
        assert "Auto-enrolled in training program: Probationary Firefighter" in (
            result["message"]
        )
        enrollments = await self._enrollments(db_session, str(result["user_id"]))
        assert [str(e.program_id) for e in enrollments] == [probation.id]

    async def test_an_email_failure_does_not_break_the_conversion(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        from unittest.mock import AsyncMock, MagicMock

        from app.models.membership_pipeline import ProspectStatus
        from app.services import email_service as email_service_module

        org_id, _ = setup_org_and_admin
        recruit, probation, _ = await self._department(db_session, org_id)
        probation.prerequisite_program_ids = [recruit.id]
        await db_session.flush()

        prospect, result = await self._convert(db_session, org_id)
        monkeypatch.setattr(
            email_service_module,
            "EmailService",
            MagicMock(
                return_value=MagicMock(
                    send_email=AsyncMock(side_effect=RuntimeError("SMTP down"))
                )
            ),
        )

        # Never raises; nothing was sent.
        await result.pop("_notify_enrollment_skipped")()

        assert prospect.status == ProspectStatus.TRANSFERRED
        assert str(prospect.transferred_user_id) == str(result["user_id"])

    async def test_the_endpoint_sends_after_commit_and_survives_a_failure(
        self, monkeypatch
    ):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.api.v1.endpoints import membership_pipeline as pipeline_ep
        from app.models.membership_pipeline import ProspectStatus
        from app.schemas.membership_pipeline import TransferProspectRequest

        service = "app.services.membership_pipeline_service.MembershipPipelineService"
        calls = []
        db = MagicMock()
        db.commit = AsyncMock(side_effect=lambda: calls.append("commit"))
        db.rollback = AsyncMock()

        async def failing_notice():
            calls.append("notice")
            raise RuntimeError("mail relay down")

        transfer = AsyncMock(
            return_value={
                "success": True,
                "user_id": "u-new",
                "message": "ok",
                "_notify_enrollment_skipped": failing_notice,
            }
        )
        prospect = SimpleNamespace(status=ProspectStatus.ACTIVE, target_role_id=None)
        with patch(
            f"{service}.get_prospect", new=AsyncMock(return_value=prospect)
        ), patch(f"{service}.transfer_to_membership", new=transfer), patch.object(
            pipeline_ep, "_canonical_rank_or_400", new=AsyncMock(return_value=None)
        ), patch.object(
            pipeline_ep, "_enforce_rank_grant_ceiling", new=AsyncMock()
        ), patch.object(
            pipeline_ep, "log_audit_event", new=AsyncMock()
        ):
            response = await pipeline_ep.transfer_prospect(
                prospect_id=uuid.uuid4(),
                data=TransferProspectRequest(),
                request=MagicMock(),
                db=db,
                current_user=SimpleNamespace(
                    id="admin-1", organization_id="org-a", username="admin"
                ),
            )

        assert calls == ["commit", "notice"]
        assert response["success"] is True
        assert "_notify_enrollment_skipped" not in response
