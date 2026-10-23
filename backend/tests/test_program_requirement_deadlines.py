"""Per-requirement program settings are read, not merely stored (pitfall #19).

``program_requirements.custom_deadline_days``, ``program_specific_description``
and ``notification_message`` were written by clone/import and read by nothing;
create, build and update did not even accept them. Owner decisions
(2026-10-12), pinned here:

* the due date is the member's cycle start plus the link's *current* N, on
  the department's calendar, derived on every read — so editing N moves every
  enrolled member's date — and a satisfied requirement is never overdue;
* reminders follow the program's ramp once per step, then one overdue notice
  per due date; a moved due date starts them again; a completed requirement
  gets none; a member already overdue gets one notice, not a replay;
* the completion message is emailed once per completion, not per edit, and
  again after a reset and a fresh completion;
* the API accepts, returns and clears all three; and a department's officer
  cannot touch another department's link.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training_programs as program_endpoints
from app.models.notification import NotificationLog
from app.models.training import (
    ProgramRequirement,
    ProgramStructureType,
    RequirementFrequency,
    RequirementProgress,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training_program import (
    ProgramBuildRequirementInput,
    ProgramEnrollmentCreate,
    ProgramRequirementCreate,
    ProgramRequirementUpdate,
    RequirementProgressUpdate,
)
from app.services import email_service as email_service_module
from app.services import program_requirement_deadlines as deadlines
from app.services import scheduled_tasks
from app.services.training_program_service import TrainingProgramService
from app.utils.reminder_conditions import (
    due_warning_offset,
    normalize_reminder_conditions,
)

# ============================================
# No database
# ============================================


@pytest.mark.unit
class TestRampStep:
    CONDITIONS = normalize_reminder_conditions(None, 30)  # 30, 14, 7

    @pytest.mark.parametrize(
        ("days_left", "expected"),
        [(40, None), (30, 30), (20, 30), (14, 14), (8, 14), (7, 7), (0, 7), (-1, None)],
    )
    def test_the_most_urgent_step_that_has_begun(self, days_left, expected):
        assert due_warning_offset(days_left, 0.0, self.CONDITIONS) == expected

    def test_a_member_on_track_is_left_alone(self):
        conditions = normalize_reminder_conditions({"send_if_below_percentage": 50}, 30)
        assert due_warning_offset(5, 60.0, conditions) is None
        assert due_warning_offset(5, 40.0, conditions) == 7


@pytest.mark.unit
class TestDerivation:
    def test_counts_from_the_cycle_start_on_the_departments_calendar(self):
        # 03:00 UTC on the 10th is still the 9th in Chicago.
        enrollment = SimpleNamespace(
            cycle_started_at=datetime(2026, 3, 10, 3, 0, tzinfo=timezone.utc),
            enrolled_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        assert deadlines.requirement_due_date(
            enrollment, 30, ZoneInfo("America/Chicago")
        ) == date(2026, 4, 8)

    def test_falls_back_to_the_enrollment_date(self):
        enrollment = SimpleNamespace(
            cycle_started_at=None,
            enrolled_at=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
        )
        assert deadlines.requirement_due_date(enrollment, 10, ZoneInfo("UTC")) == date(
            2026, 1, 11
        )

    @pytest.mark.parametrize("days", [None, 0, -5])
    def test_no_positive_deadline_is_no_due_date(self, days):
        enrollment = SimpleNamespace(
            cycle_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            enrolled_at=None,
        )
        assert deadlines.requirement_due_date(enrollment, days, ZoneInfo("UTC")) is None

    def test_the_due_day_itself_is_not_late_and_done_is_never_late(self):
        due = date(2026, 5, 1)
        assert not deadlines.is_overdue(due, "not_started", due)
        assert deadlines.is_overdue(due, "in_progress", due + timedelta(days=1))
        for status in ("completed", "verified", "waived"):
            assert not deadlines.is_overdue(due, status, due + timedelta(days=9))


@pytest.mark.unit
class TestSchemas:
    @pytest.mark.parametrize("days", [0, -1, 3651])
    def test_deadline_days_are_bounded(self, days):
        with pytest.raises(ValidationError):
            ProgramRequirementUpdate(custom_deadline_days=days)
        with pytest.raises(ValidationError):
            ProgramBuildRequirementInput(name="CPR", custom_deadline_days=days)

    def test_update_omitted_is_untouched_and_null_clears(self):
        assert ProgramRequirementUpdate().model_dump(exclude_unset=True) == {}
        cleared = ProgramRequirementUpdate.model_validate(
            {
                "custom_deadline_days": None,
                "program_specific_description": None,
                "notification_message": "   ",
            }
        ).model_dump(exclude_unset=True)
        assert cleared == {
            "custom_deadline_days": None,
            "program_specific_description": None,
            "notification_message": None,
        }

    def test_create_and_build_carry_the_settings(self):
        create = ProgramRequirementCreate(
            program_id=uuid.uuid4(),
            requirement_id=uuid.uuid4(),
            custom_deadline_days=30,
            program_specific_description="Within your first month",
            notification_message="Nice work",
        )
        assert create.custom_deadline_days == 30
        build = ProgramBuildRequirementInput(
            name="CPR", custom_deadline_days=14, notification_message=""
        )
        assert build.custom_deadline_days == 14
        assert build.notification_message is None

    def test_the_task_is_registered_daily(self):
        name = "program_requirement_deadlines"
        assert (
            scheduled_tasks.TASK_RUNNERS[name]
            is scheduled_tasks.run_program_requirement_deadlines
        )
        assert name in scheduled_tasks.SCHEDULE
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[name] == 86400


# ============================================
# A fake mailer
# ============================================


class _Mailer:
    def __init__(self):
        self.sends: list[dict] = []

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
                        "html": html_body,
                        "text": kwargs.get("text_body") or "",
                    }
                )
                return len(to_emails), 0

        return _Service()

    def to(self, email):
        return [s for s in self.sends if email in s["to"]]


@pytest.fixture
def mailer(monkeypatch):
    fake = _Mailer()
    monkeypatch.setattr(email_service_module, "EmailService", fake.factory)
    return fake


# ============================================
# A department with one program
# ============================================


def _uid() -> str:
    return str(uuid.uuid4())


class _Dept:
    def __init__(self, db):
        self.db = db

    async def build(self, *, deadline_days=30, enrolled_days_ago=0, message=None):
        db = self.db
        self.org = Organization(
            id=_uid(),
            name="Deadline Department",
            slug=f"deadline-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db.add(self.org)
        await db.flush()
        self.member = await self._user("Riley", "member")
        self.officer = await self._user("Casey", "training_officer")
        self.cpr = await self._requirement("CPR Certification")
        self.ladder = await self._requirement("Ladder Drills")
        self.program = TrainingProgram(
            id=_uid(),
            organization_id=self.org.id,
            name="Recruit Academy",
            structure_type=ProgramStructureType.FLEXIBLE,
            active=True,
            warning_days_before=14,
            reminder_conditions={"days_before_deadline": [14, 3]},
        )
        db.add(self.program)
        await db.flush()
        self.link = ProgramRequirement(
            id=_uid(),
            program_id=self.program.id,
            requirement_id=self.cpr.id,
            is_required=True,
            custom_deadline_days=deadline_days,
            program_specific_description="Book through the county class list.",
            notification_message=message,
        )
        db.add(self.link)
        db.add(
            ProgramRequirement(
                id=_uid(),
                program_id=self.program.id,
                requirement_id=self.ladder.id,
                is_required=True,
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
        await self.enrolled_days_ago(enrolled_days_ago)
        return self

    async def _user(self, name, rank):
        handle = uuid.uuid4().hex[:10]
        user = User(
            id=_uid(),
            organization_id=self.org.id,
            username=f"{name}-{handle}",
            email=f"{handle}@deadline.test",
            first_name=name,
            last_name="Member",
            password_hash="x",
            status=UserStatus.ACTIVE,
            rank=rank,
        )
        self.db.add(user)
        await self.db.flush()
        # The endpoints read permissions off these; load them up front, since
        # a lazy load inside an async session raises.
        await self.db.execute(
            select(User)
            .options(selectinload(User.positions), selectinload(User.roles))
            .where(User.id == user.id)
            .execution_options(populate_existing=True)
        )
        return user

    async def _requirement(self, name):
        req = TrainingRequirement(
            id=_uid(),
            organization_id=self.org.id,
            name=name,
            description=f"The department's own {name} description.",
            requirement_type=RequirementType.HOURS,
            required_hours=4.0,
            frequency=RequirementFrequency.ONE_TIME,
            applies_to_all=False,
            active=True,
        )
        self.db.add(req)
        await self.db.flush()
        return req

    async def enrolled_days_ago(self, days):
        start = datetime.now(timezone.utc) - timedelta(days=days)
        self.enrollment.enrolled_at = start
        self.enrollment.cycle_started_at = start
        await self.db.flush()
        self.start_day = start.date()

    async def row(self, requirement=None):
        requirement = requirement or self.cpr
        result = await self.db.execute(
            select(RequirementProgress)
            .where(
                RequirementProgress.enrollment_id == self.enrollment.id,
                RequirementProgress.requirement_id == requirement.id,
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

    async def progress(self, viewer=None):
        return await program_endpoints.get_enrollment_progress(
            enrollment_id=uuid.UUID(self.enrollment.id),
            db=self.db,
            current_user=viewer or self.member,
        )

    async def sweep(self):
        return await deadlines.send_requirement_deadline_notices(self.db, self.org.id)

    async def set_progress(self, status, value=None):
        row = await self.row()
        updates = {"status": status}
        if value is not None:
            updates["progress_value"] = value
        _, error = await TrainingProgramService(self.db).update_requirement_progress(
            progress_id=row.id,
            organization_id=self.org.id,
            updates=RequirementProgressUpdate(**updates),
            verified_by=self.officer.id,
            can_manage=True,
        )
        assert error is None

    async def bell(self, subject_prefix):
        result = await self.db.execute(
            select(NotificationLog).where(
                NotificationLog.recipient_id == self.member.id,
                NotificationLog.subject.like(f"{subject_prefix}%"),
            )
        )
        return result.scalars().all()


def _cpr_row(progress, dept):
    [row] = [
        r for r in progress.requirement_progress if str(r.requirement_id) == dept.cpr.id
    ]
    return row


@pytest.mark.integration
class TestTheProgressPageShowsTheDueDate:
    async def test_derived_from_enrollment_and_overdue_once_past(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=31)

        row = _cpr_row(await dept.progress(), dept)
        assert row.due_date == dept.start_day + timedelta(days=30)
        assert row.is_overdue is True
        assert row.program_specific_description == (
            "Book through the county class list."
        )
        # The requirement with no deadline has neither.
        [ladder] = [
            r
            for r in (await dept.progress()).requirement_progress
            if str(r.requirement_id) == dept.ladder.id
        ]
        assert ladder.due_date is None
        assert ladder.is_overdue is False
        assert ladder.program_specific_description is None

    async def test_an_officer_edit_moves_every_members_date(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=31)
        await program_endpoints.update_program_requirement(
            program_id=uuid.UUID(dept.program.id),
            program_requirement_id=uuid.UUID(dept.link.id),
            updates=ProgramRequirementUpdate(custom_deadline_days=60),
            db=db_session,
            current_user=dept.officer,
        )

        row = _cpr_row(await dept.progress(), dept)
        assert row.due_date == dept.start_day + timedelta(days=60)
        assert row.is_overdue is False

    async def test_a_completed_requirement_is_never_overdue(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=31)
        await dept.set_progress("completed")

        row = _cpr_row(await dept.progress(), dept)
        assert row.due_date is not None
        assert row.is_overdue is False

    async def test_an_inactive_requirement_has_no_due_or_overdue_date(
        self, db_session
    ):
        # Not currently required, so not late either: the page shows only the
        # "Inactive — not currently required" badge. The officer's view of the
        # same enrollment reads this same response.
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=31)
        dept.cpr.active = False
        await db_session.flush()

        row = _cpr_row(await dept.progress(), dept)
        assert row.due_date is None
        assert row.is_overdue is False
        assert row.requirement.active is False
        # The program's own wording for it is still shown.
        assert row.program_specific_description == (
            "Book through the county class list."
        )

        # Reactivated, the date is back, derived as before.
        dept.cpr.active = True
        await db_session.flush()
        row = _cpr_row(await dept.progress(), dept)
        assert row.due_date == dept.start_day + timedelta(days=30)
        assert row.is_overdue is True


@pytest.mark.integration
class TestReminders:
    async def test_each_ramp_step_goes_out_once(self, db_session, mailer):
        # Due in 10 days: the 14-day step has begun, the 3-day one has not.
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=20)

        assert await dept.sweep() == {"warnings_sent": 1, "overdue_sent": 0}
        assert await dept.sweep() == {"warnings_sent": 0, "overdue_sent": 0}
        [sent] = mailer.to(dept.member.email)
        assert "CPR Certification" in sent["subject"]
        assert "in 10 days" in sent["text"]
        row = await dept.row()
        assert row.due_warning_sent_for == dept.start_day + timedelta(days=30)
        assert row.due_warning_days_before == 14
        assert len(await dept.bell("Training requirement due")) == 1

        # Seven days later the 3-day step begins: one more, then quiet again.
        await dept.enrolled_days_ago(28)
        assert (await dept.sweep())["warnings_sent"] == 1
        assert (await dept.sweep())["warnings_sent"] == 0
        assert len(mailer.to(dept.member.email)) == 2

    async def test_a_moved_due_date_starts_the_reminders_again(
        self, db_session, mailer
    ):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=20)
        await dept.sweep()
        assert len(mailer.to(dept.member.email)) == 1

        dept.link.custom_deadline_days = 31
        await db_session.flush()

        assert (await dept.sweep())["warnings_sent"] == 1
        assert len(mailer.to(dept.member.email)) == 2
        assert (await dept.row()).due_warning_sent_for == dept.start_day + timedelta(
            days=31
        )

    async def test_a_completed_requirement_is_not_reminded(self, db_session, mailer):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=40)
        await dept.set_progress("completed")

        assert await dept.sweep() == {"warnings_sent": 0, "overdue_sent": 0}
        assert mailer.to(dept.member.email) == []

    async def test_a_deactivated_requirement_is_not_reminded(self, db_session, mailer):
        # Not required while inactive, so nothing about it is owed either.
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=45)
        dept.cpr.active = False
        await db_session.flush()

        assert await dept.sweep() == {"warnings_sent": 0, "overdue_sent": 0}
        assert mailer.to(dept.member.email) == []

        dept.cpr.active = True
        await db_session.flush()
        assert (await dept.sweep())["overdue_sent"] == 1

    async def test_already_overdue_gets_one_notice_not_the_ramp(
        self, db_session, mailer
    ):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=45)

        assert await dept.sweep() == {"warnings_sent": 0, "overdue_sent": 1}
        assert await dept.sweep() == {"warnings_sent": 0, "overdue_sent": 0}
        [sent] = mailer.to(dept.member.email)
        assert sent["subject"] == "Training requirement overdue: CPR Certification"
        assert (await dept.row()).overdue_notice_sent_for == (
            dept.start_day + timedelta(days=30)
        )

    async def test_a_member_who_turned_reminders_off_still_gets_the_bell(
        self, db_session, mailer
    ):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=45)
        dept.member.notification_preferences = {"email_notifications": False}
        await db_session.flush()

        assert (await dept.sweep())["overdue_sent"] == 1
        assert mailer.to(dept.member.email) == []
        assert len(await dept.bell("Training requirement overdue")) == 1

    async def test_the_marker_does_not_count_as_progress(self, db_session, mailer):
        # The struggling-member sweep reads updated_at as "last progress".
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=45)
        before = (await dept.row()).updated_at
        await dept.sweep()
        assert (await dept.row()).updated_at == before

    async def test_another_departments_sweep_does_not_touch_this_one(
        self, db_session, mailer
    ):
        dept = await _Dept(db_session).build(deadline_days=30, enrolled_days_ago=45)
        other = await _Dept(db_session).build(deadline_days=None)

        assert await other.sweep() == {"warnings_sent": 0, "overdue_sent": 0}
        assert (await dept.row()).overdue_notice_sent_for is None
        assert mailer.sends == []


@pytest.mark.integration
class TestCompletionMessage:
    async def test_sent_once_per_completion(self, db_session, mailer):
        dept = await _Dept(db_session).build(
            deadline_days=None, message="Great work — bring your card to Station 2."
        )

        await dept.set_progress("in_progress", value=2)
        assert mailer.sends == []

        await dept.set_progress("completed")
        [sent] = mailer.to(dept.member.email)
        assert sent["subject"] == "Requirement complete: CPR Certification"
        assert "bring your card to Station 2" in sent["text"]

        # Another edit to the completed row is not a second completion.
        await dept.set_progress("verified")
        assert len(mailer.to(dept.member.email)) == 1

        # A reset and a fresh completion is.
        row = await dept.row()
        await TrainingProgramService(db_session).reset_requirement_progress(
            row.id, dept.org.id
        )
        assert (await dept.row()).completion_notice_sent_at is None
        await dept.set_progress("completed")
        assert len(mailer.to(dept.member.email)) == 2

    async def test_a_requirement_without_a_message_sends_nothing(
        self, db_session, mailer
    ):
        dept = await _Dept(db_session).build(deadline_days=None, message=None)
        await dept.set_progress("completed")
        assert mailer.sends == []
        # Stamped all the same, so a message added later never announces it.
        assert (await dept.row()).completion_notice_sent_at is not None

    async def test_the_member_does_not_see_it_ahead_of_time(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=None, message="Secret")
        member_view = await program_endpoints.get_program_requirements(
            program_id=uuid.UUID(dept.program.id),
            phase_id=None,
            db=db_session,
            current_user=dept.member,
        )
        assert len(member_view) == 2
        assert {pr.notification_message for pr in member_view} == {None}


@pytest.mark.integration
class TestTheApi:
    async def test_create_accepts_and_returns_the_settings(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=None)
        extra = await dept._requirement("SCBA Fit Test")
        created = await program_endpoints.add_requirement_to_program(
            program_id=uuid.UUID(dept.program.id),
            requirement_link=ProgramRequirementCreate(
                program_id=uuid.UUID(dept.program.id),
                requirement_id=uuid.UUID(extra.id),
                custom_deadline_days=21,
                program_specific_description="Before your first live burn.",
                notification_message="Cleared for SCBA.",
            ),
            db=db_session,
            current_user=dept.officer,
        )
        response = program_endpoints.ProgramRequirementResponse.model_validate(created)
        assert response.custom_deadline_days == 21
        assert response.program_specific_description == "Before your first live burn."
        assert response.notification_message == "Cleared for SCBA."

    async def test_update_leaves_omitted_fields_and_clears_nulls(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=30, message="Done!")
        await program_endpoints.update_program_requirement(
            program_id=uuid.UUID(dept.program.id),
            program_requirement_id=uuid.UUID(dept.link.id),
            updates=ProgramRequirementUpdate.model_validate(
                {"custom_deadline_days": None, "is_required": True}
            ),
            db=db_session,
            current_user=dept.officer,
        )
        link = await db_session.get(ProgramRequirement, dept.link.id)
        await db_session.refresh(link)
        assert link.custom_deadline_days is None
        assert link.notification_message == "Done!"
        assert link.program_specific_description == (
            "Book through the county class list."
        )

    async def test_build_stores_the_settings(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=None)
        from app.schemas.training_program import (
            ProgramBuildRequest,
            TrainingProgramCreate,
        )

        program, error = await TrainingProgramService(db_session).build_program(
            payload=ProgramBuildRequest(
                program=TrainingProgramCreate(name="Driver Program"),
                requirements=[
                    ProgramBuildRequirementInput(
                        name="EVOC Course",
                        custom_deadline_days=45,
                        program_specific_description="Classroom first.",
                        notification_message="You may now drive.",
                    ),
                    ProgramBuildRequirementInput(
                        requirement_id=uuid.UUID(dept.ladder.id),
                        custom_deadline_days=10,
                    ),
                ],
            ),
            organization_id=dept.org.id,
            created_by=dept.officer.id,
        )
        assert error is None
        links = (
            (
                await db_session.execute(
                    select(ProgramRequirement).where(
                        ProgramRequirement.program_id == program.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(link.custom_deadline_days for link in links) == [10, 45]
        assert {link.notification_message for link in links} == {
            "You may now drive.",
            None,
        }

    async def test_another_departments_officer_cannot_edit_the_link(self, db_session):
        dept = await _Dept(db_session).build(deadline_days=30)
        other = await _Dept(db_session).build(deadline_days=None)

        with pytest.raises(HTTPException) as caught:
            await program_endpoints.update_program_requirement(
                program_id=uuid.UUID(dept.program.id),
                program_requirement_id=uuid.UUID(dept.link.id),
                updates=ProgramRequirementUpdate(custom_deadline_days=1),
                db=db_session,
                current_user=other.officer,
            )
        assert caught.value.status_code == 404
        link = await db_session.get(ProgramRequirement, dept.link.id)
        await db_session.refresh(link)
        assert link.custom_deadline_days == 30
