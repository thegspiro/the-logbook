"""
A program's linked requirement reads the member's compliance result (W26-1).

The wizard promised that a department requirement linked into a program
"reads the same records the department does, so a member who already holds
it starts out credited". It did not: ``enroll_member`` started every row at
zero and program progress was a tally of its own. A member with 4 of 6 annual
Hazmat hours read "4/6 hrs" under Training Requirements and "0%, not started"
under Pipeline Progress on the same page.

The owner chose to read the compliance result live. A linked row is now a
projection of ``evaluate_member_requirement_detail`` — the compliance
matrix's grader — refreshed whenever program progress is shown; a requirement
a program created for itself keeps its own ledger.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints import training_programs as program_endpoints
from app.api.v1.endpoints.training_module_config import get_my_training_summary
from app.models.training import (
    DueDateType,
    EnrollmentStatus,
    ProgramRequirement,
    ProgramStructureType,
    ProgressCreditSource,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementProgressStatus,
    RequirementType,
    TrainingProgram,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training_program import (
    ProgramEnrollmentCreate,
    RequirementProgressUpdate,
)
from app.services.training_program_service import (
    LINKED_PROGRESS_REFUSAL,
    TrainingProgramService,
)
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _member(db, org, name: str) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name}-{handle}",
        email=f"{handle}@linked-req.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        rank="firefighter",
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    return user


async def _hours(db, org, user, hours: float, on: date) -> None:
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org.id,
            user_id=user.id,
            course_name="Hazmat Refresher",
            training_type=TrainingType.CONTINUING_EDUCATION,
            status=TrainingStatus.COMPLETED,
            completion_date=on,
            hours_completed=hours,
        )
    )
    await db.flush()


async def _requirement(db, org, name: str, hours: float, **fields):
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=hours,
        frequency=fields.pop("frequency", RequirementFrequency.ANNUAL),
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        **fields,
    )
    db.add(req)
    await db.flush()
    return req


class _Driver:
    """W26's department: a linked Hazmat requirement, an owned driving one."""

    def __init__(self, db):
        self.db = db

    async def build(self):
        db = self.db
        self.org = Organization(
            id=_uid(),
            name="Linked Requirement Department",
            slug=f"linked-req-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db.add(self.org)
        await db.flush()
        self.today = await resolve_org_today(db, self.org.id)
        self.member = await _member(db, self.org, "Jordan")
        await _hours(db, self.org, self.member, 4.0, self.today)

        self.hazmat = await _requirement(
            db, self.org, "Annual Hazmat Hours", 6.0, applies_to_all=True
        )
        self.driving = await _requirement(
            db,
            self.org,
            "Supervised Driving Hours",
            20.0,
            applies_to_all=False,
            frequency=RequirementFrequency.ONE_TIME,
        )
        self.program = TrainingProgram(
            id=_uid(),
            organization_id=self.org.id,
            name="Driver Candidate Program",
            structure_type=ProgramStructureType.FLEXIBLE,
        )
        db.add(self.program)
        await db.flush()
        db.add(
            ProgramRequirement(
                id=_uid(),
                program_id=self.program.id,
                requirement_id=self.hazmat.id,
                is_required=True,
                owns_requirement=False,
            )
        )
        db.add(
            ProgramRequirement(
                id=_uid(),
                program_id=self.program.id,
                requirement_id=self.driving.id,
                is_required=True,
                owns_requirement=True,
            )
        )
        await db.flush()

        service = TrainingProgramService(db)
        self.enrollment, error = await service.enroll_member(
            ProgramEnrollmentCreate(
                user_id=uuid.UUID(self.member.id),
                program_id=uuid.UUID(self.program.id),
            ),
            uuid.UUID(self.org.id),
        )
        assert error is None
        return self

    async def progress(self):
        return await program_endpoints.get_enrollment_progress(
            enrollment_id=uuid.UUID(self.enrollment.id),
            db=self.db,
            current_user=self.member,
        )

    async def rows(self):
        result = await self.db.execute(
            select(RequirementProgress)
            .where(RequirementProgress.enrollment_id == self.enrollment.id)
            .execution_options(populate_existing=True)
        )
        return {str(r.requirement_id): r for r in result.scalars().all()}


def _row(progress, requirement):
    [row] = [
        r
        for r in progress.requirement_progress
        if str(r.requirement_id) == str(requirement.id)
    ]
    return row


class TestALinkedRequirementReadsTheComplianceResult:
    async def test_a_member_who_already_holds_credit_starts_credited(self, db_session):
        d = await _Driver(db_session).build()
        progress = await d.progress()

        hazmat = _row(progress, d.hazmat)
        assert hazmat.progress_value == 4.0
        assert round(hazmat.progress_percentage, 2) == 66.67
        assert str(getattr(hazmat.status, "value", hazmat.status)) == "in_progress"
        assert hazmat.reads_compliance is True
        # The program's own requirement keeps its ledger.
        driving = _row(progress, d.driving)
        assert driving.progress_value == 0.0
        assert driving.reads_compliance is False

    async def test_my_training_shows_one_figure(self, db_session):
        """The page from W26-1: Training Requirements and Pipeline Progress."""
        d = await _Driver(db_session).build()
        summary = await get_my_training_summary(db=db_session, current_user=d.member)

        [detail] = [r for r in summary["requirements_detail"] if r["id"] == d.hazmat.id]
        [pipeline] = summary["enrollments"]
        [hazmat] = [
            r for r in pipeline["requirements"] if r["requirement_id"] == d.hazmat.id
        ]
        assert detail["completed_hours"] == 4.0
        assert hazmat["progress_value"] == detail["completed_hours"]
        # My Training rounds to one place; the row keeps the full figure.
        assert round(hazmat["progress_percentage"], 1) == detail["progress_percentage"]
        assert hazmat["reads_compliance"] is True

    async def test_agrees_with_the_compliance_matrix(self, db_session):
        d = await _Driver(db_session).build()
        progress = await d.progress()
        caller = User(id=_uid(), organization_id=d.org.id)
        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        [row] = [r for r in matrix["members"] if str(r["user_id"]) == d.member.id]
        [cell] = [
            c for c in row["requirements"] if str(c["requirement_id"]) == d.hazmat.id
        ]
        assert _row(progress, d.hazmat).progress_value == cell["progress_current"]

    async def test_new_credit_completes_it_and_moves_the_enrollment(self, db_session):
        d = await _Driver(db_session).build()
        await d.progress()
        await _hours(db_session, d.org, d.member, 2.0, d.today)

        progress = await d.progress()

        hazmat = _row(progress, d.hazmat)
        assert str(getattr(hazmat.status, "value", hazmat.status)) == "completed"
        assert hazmat.progress_percentage == 100.0
        # Two required items, one met: the rollup is the average.
        assert progress.enrollment.progress_percentage == 50.0
        assert progress.completed_requirements == 1

    async def test_enrollments_list_and_program_view_read_it_too(self, db_session):
        d = await _Driver(db_session).build()
        mine = await program_endpoints.get_my_enrollments(
            status=None, db=db_session, current_user=d.member
        )
        # (4/6 + 0/20) / 2 required requirements.
        assert round(mine[0].progress_percentage, 1) == 33.3


class TestNobodyMarksALinkedRequirementOffInTheProgram:
    async def test_officer_progress_edits_are_refused(self, db_session):
        d = await _Driver(db_session).build()
        await d.progress()
        rows = await d.rows()
        service = TrainingProgramService(db_session)
        officer = uuid.uuid4()

        for updates in (
            RequirementProgressUpdate(status="completed"),
            RequirementProgressUpdate(progress_value=6),
        ):
            result, error = await service.update_requirement_progress(
                uuid.UUID(rows[d.hazmat.id].id),
                uuid.UUID(d.org.id),
                updates,
                verified_by=officer,
                acting_user_id=officer,
                can_manage=True,
            )
            assert result is None
            assert error == LINKED_PROGRESS_REFUSAL
        assert (await d.rows())[d.hazmat.id].progress_value == 4.0

    async def test_it_can_be_waived_and_the_waiver_lifted(self, db_session):
        d = await _Driver(db_session).build()
        await d.progress()
        rows = await d.rows()
        service = TrainingProgramService(db_session)
        officer = uuid.uuid4()
        progress_id = uuid.UUID(rows[d.hazmat.id].id)

        waived, error = await service.update_requirement_progress(
            progress_id,
            uuid.UUID(d.org.id),
            RequirementProgressUpdate(status="waived"),
            acting_user_id=officer,
            can_manage=True,
        )
        assert error is None
        assert waived.status == RequirementProgressStatus.WAIVED
        # A waiver survives the next read.
        assert _row(await d.progress(), d.hazmat).status == (
            RequirementProgressStatus.WAIVED
        )

        lifted, error = await service.update_requirement_progress(
            progress_id,
            uuid.UUID(d.org.id),
            RequirementProgressUpdate(status="not_started"),
            acting_user_id=officer,
            can_manage=True,
        )
        assert error is None
        assert lifted.status == RequirementProgressStatus.IN_PROGRESS
        assert lifted.progress_value == 4.0

    async def test_a_feed_credit_accrues_nothing(self, db_session):
        """A shift report or session credit is already in the compliance
        result; adding it to the row as well would count it twice."""
        d = await _Driver(db_session).build()
        await d.progress()
        rows = await d.rows()
        service = TrainingProgramService(db_session)

        result, error = await service.apply_requirement_credit(
            rows[d.hazmat.id].id,
            uuid.UUID(d.org.id),
            ProgressCreditSource.TRAINING_SESSION,
            _uid(),
            3.0,
        )

        assert error is None
        assert result.progress_value == 4.0
        credits = await db_session.execute(
            select(RequirementProgressCredit).where(
                RequirementProgressCredit.progress_id == rows[d.hazmat.id].id
            )
        )
        assert credits.scalars().all() == []


class TestWhatStaysOnTheLedger:
    async def test_a_finished_enrollment_keeps_the_progress_it_finished_with(
        self, db_session
    ):
        d = await _Driver(db_session).build()
        d.enrollment.status = EnrollmentStatus.COMPLETED
        d.enrollment.completed_at = datetime.now(timezone.utc)
        await db_session.flush()

        progress = await d.progress()

        assert _row(progress, d.hazmat).progress_value == 0.0

    async def test_a_duplicated_programs_shared_requirement_is_not_linked(
        self, db_session
    ):
        """A duplicate shares the source program's own requirement without
        owning it; it is still a program requirement, not a department one."""
        d = await _Driver(db_session).build()
        copy = TrainingProgram(
            id=_uid(),
            organization_id=d.org.id,
            name="Driver Candidate Program (copy)",
            structure_type=ProgramStructureType.FLEXIBLE,
        )
        db_session.add(copy)
        await db_session.flush()
        for req in (d.hazmat, d.driving):
            db_session.add(
                ProgramRequirement(
                    id=_uid(),
                    program_id=copy.id,
                    requirement_id=req.id,
                    is_required=True,
                    owns_requirement=False,
                )
            )
        await db_session.flush()

        linked = await TrainingProgramService(db_session).linked_requirement_ids(
            [copy.id]
        )

        assert linked == {copy.id: {d.hazmat.id}}
