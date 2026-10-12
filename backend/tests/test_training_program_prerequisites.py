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
            {"id": recruit.id, "name": "Recruit School"}
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
            {"id": recruit.id, "name": "Recruit School"}
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
            {"id": recruit.id, "name": "Recruit School"}
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
        assert error is not None and "same time" in error

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
        assert error is not None and error.startswith("Officer already requires")


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

        assert ok and error is None
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
