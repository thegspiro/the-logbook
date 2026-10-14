"""Cohort roster sync honours a pipeline's prerequisite programs.

Adding members to a cohort enrolls them in the cohort's pipeline. That path
called ``enroll_member`` directly, which does not check prerequisites, so a
member who had not finished a prerequisite was enrolled anyway — while the
enroll picker and bulk enrollment refused the same member. Now such a member
is still added to the roster (the officer's call) but not to the pipeline, and
the reason comes back as a warning.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    CohortStatus,
    CourseCohort,
    CourseCohortMember,
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramStructureType,
    TrainingCourse,
    TrainingProgram,
    TrainingType,
)
from app.schemas.course_cohort import CohortMemberAdd
from app.schemas.training_program import ProgramEnrollmentCreate
from app.services.course_cohort_service import CourseCohortService
from app.services.training_program_service import TrainingProgramService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    users = {}
    for name in ("officer", "finished", "unfinished", "already"):
        uid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :un, 'Member', :em, 'x', 'active')"
            ),
            {"id": uid, "org": org_id, "un": f"{name}{uid[:6]}", "em": f"{uid}@t.io"},
        )
        users[name] = uid

    recruit = TrainingProgram(
        id=_uid(),
        organization_id=org_id,
        name="Recruit School",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    driver = TrainingProgram(
        id=_uid(),
        organization_id=org_id,
        name="Driver Operator",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    db_session.add_all([recruit, driver])
    await db_session.flush()

    programs = TrainingProgramService(db_session)

    async def enroll(user_key, program):
        enrollment, error = await programs.enroll_member(
            ProgramEnrollmentCreate(
                user_id=uuid.UUID(users[user_key]), program_id=uuid.UUID(program.id)
            ),
            org_id,
        )
        assert error is None
        return enrollment

    finished = await enroll("finished", recruit)
    finished.status = EnrollmentStatus.COMPLETED
    # Enrolled before the prerequisite was added: an existing enrollment is
    # kept, not torn up by a roster change.
    await enroll("already", driver)
    driver.prerequisite_program_ids = [recruit.id]
    await db_session.flush()

    course = TrainingCourse(
        organization_id=org_id,
        name="Driver Operator Course",
        training_type=TrainingType.CERTIFICATION,
        credit_hours=3.0,
    )
    db_session.add(course)
    await db_session.flush()
    cohort = CourseCohort(
        organization_id=org_id,
        course_id=course.id,
        name="Spring Driver Class",
        start_date=date.today(),
        status=CohortStatus.IN_PROGRESS,
        date_roll_policy="none",
        program_id=driver.id,
    )
    db_session.add(cohort)
    await db_session.flush()
    return {
        "db": db_session,
        "org": org_id,
        "users": users,
        "cohort": cohort,
        "driver": driver,
    }


async def _driver_enrollment(db, user_id, program_id):
    result = await db.execute(
        select(ProgramEnrollment).where(
            ProgramEnrollment.user_id == user_id,
            ProgramEnrollment.program_id == program_id,
        )
    )
    return result.scalars().first()


async def _roster_row(db, cohort_id, user_id):
    result = await db.execute(
        select(CourseCohortMember).where(
            CourseCohortMember.cohort_id == cohort_id,
            CourseCohortMember.user_id == user_id,
        )
    )
    return result.scalars().first()


class TestRosterSyncHonoursPrerequisites:
    async def test_only_members_who_finished_the_prerequisite_are_enrolled(self, setup):
        db, users, cohort, driver = (
            setup["db"],
            setup["users"],
            setup["cohort"],
            setup["driver"],
        )

        added, warnings = await CourseCohortService(db).add_members(
            cohort_id=uuid.UUID(cohort.id),
            data=CohortMemberAdd(
                user_ids=[
                    uuid.UUID(users["finished"]),
                    uuid.UUID(users["unfinished"]),
                    uuid.UUID(users["already"]),
                ],
                invite_to_events=False,
            ),
            organization_id=setup["org"],
            actor_id=users["officer"],
        )

        # Everyone is on the roster: the officer's selection stands.
        assert added == 3
        for key in ("finished", "unfinished", "already"):
            assert await _roster_row(db, cohort.id, users[key]) is not None

        # The member who finished Recruit School is enrolled and linked.
        finished = await _driver_enrollment(db, users["finished"], driver.id)
        assert finished is not None
        row = await _roster_row(db, cohort.id, users["finished"])
        assert row.enrollment_id == finished.id

        # The one who did not is on the roster but not in the pipeline.
        assert await _driver_enrollment(db, users["unfinished"], driver.id) is None
        row = await _roster_row(db, cohort.id, users["unfinished"])
        assert row.enrollment_id is None

        # An enrollment that already existed is kept and linked.
        already = await _driver_enrollment(db, users["already"], driver.id)
        row = await _roster_row(db, cohort.id, users["already"])
        assert row.enrollment_id == already.id

        assert len(warnings) == 1
        assert warnings[0].startswith("unfinished")
        assert warnings[0].endswith(
            "added to the roster but not enrolled in the pipeline — must first "
            "complete: Recruit School"
        )

    async def test_roster_only_additions_skip_the_prerequisite_check(self, setup):
        db, users, cohort, driver = (
            setup["db"],
            setup["users"],
            setup["cohort"],
            setup["driver"],
        )

        _, warnings = await CourseCohortService(db).add_members(
            cohort_id=uuid.UUID(cohort.id),
            data=CohortMemberAdd(
                user_ids=[uuid.UUID(users["unfinished"])],
                enroll_in_program=False,
                invite_to_events=False,
            ),
            organization_id=setup["org"],
            actor_id=users["officer"],
        )

        assert warnings == []
        assert await _roster_row(db, cohort.id, users["unfinished"]) is not None
        assert await _driver_enrollment(db, users["unfinished"], driver.id) is None


class TestOneDefinitionOfMissingPrerequisites:
    async def test_names_each_unfinished_program_and_omits_finished_members(
        self, setup
    ):
        db, users, driver = setup["db"], setup["users"], setup["driver"]
        stale_id = _uid()

        missing = await TrainingProgramService(db).missing_prerequisites(
            [*driver.prerequisite_program_ids, stale_id],
            [users["finished"], users["unfinished"]],
            setup["org"],
        )

        # An id naming no program here can never be completed.
        assert missing == {
            users["finished"]: ["a prerequisite program"],
            users["unfinished"]: ["Recruit School", "a prerequisite program"],
        }

    async def test_no_prerequisites_means_nobody_is_missing_any(self, setup):
        missing = await TrainingProgramService(setup["db"]).missing_prerequisites(
            None, [setup["users"]["unfinished"]], setup["org"]
        )
        assert missing == {}
