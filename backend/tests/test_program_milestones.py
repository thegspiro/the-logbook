"""Training program milestones: triggers, recipients, once-only delivery.

Covers app/services/program_milestones.py against the real schema:

* a percentage and completion items are joined by AND; items combine by the
  milestone's "all"/"any";
* what counts as a completed course, skills test and knowledge test;
* completions before the current cycle count only when the milestone says so;
* each (milestone, enrollment) is reached once, however often it is evaluated;
* creating or re-triggering a milestone records members who already meet it
  as skipped, and tells nobody;
* a cycle reset lets the new cycle earn its milestones again;
* the member and the chosen officers are each told the right thing, by email
  where they take it and in the bell otherwise;
* the migration's backfill skips enrollments already past an old milestone.
"""

import importlib.util
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text

from app.models.knowledge_test import KnowledgeTest, KnowledgeTestAttempt
from app.models.notification import NotificationLog
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import (
    EnrollmentStatus,
    MilestoneAchievementOutcome,
    ProgramEnrollment,
    ProgramMilestone,
    ProgramMilestoneAchievement,
    ProgramStructureType,
    TrainingCourse,
    TrainingProgram,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.schemas.training_program import (
    ProgramMilestoneCreate,
    ProgramMilestoneItemInput,
    ProgramMilestoneUpdate,
)
from app.services import program_milestones
from app.services.training_program_service import TrainingProgramService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class _Department:
    """One department, one flexible program, one enrolled member."""

    def __init__(self, db):
        self.db = db

    async def build(self, member_prefs=None):
        db = self.db
        self.org = Organization(
            id=_uid(),
            name="Milestone Department",
            slug=f"milestones-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db.add(self.org)
        await db.flush()
        self.member = await self.user("Riley", prefs=member_prefs)
        self.program = TrainingProgram(
            id=_uid(),
            organization_id=self.org.id,
            name="Recruit Program",
            structure_type=ProgramStructureType.FLEXIBLE,
        )
        db.add(self.program)
        self.course = TrainingCourse(
            id=_uid(),
            organization_id=self.org.id,
            name="Pump Operations",
            training_type=TrainingType.CERTIFICATION,
        )
        self.skill = SkillTemplate(
            id=_uid(), organization_id=self.org.id, name="Hose Deployment", sections=[]
        )
        self.knowledge = KnowledgeTest(
            id=_uid(), organization_id=self.org.id, name="Hydraulics Exam"
        )
        db.add_all([self.course, self.skill, self.knowledge])
        await db.flush()
        self.enrolled_at = datetime.now(timezone.utc) - timedelta(days=30)
        self.enrollment = ProgramEnrollment(
            id=_uid(),
            organization_id=self.org.id,
            user_id=self.member.id,
            program_id=self.program.id,
            enrolled_at=self.enrolled_at,
            cycle_started_at=self.enrolled_at,
            status=EnrollmentStatus.ACTIVE,
            progress_percentage=0.0,
        )
        db.add(self.enrollment)
        await db.flush()
        return self

    async def user(self, name, prefs=None) -> User:
        handle = uuid.uuid4().hex[:10]
        user = User(
            id=_uid(),
            organization_id=self.org.id,
            username=f"{name}-{handle}",
            email=f"{handle}@milestones.test",
            first_name=name,
            last_name="Tester",
            password_hash="x",
            status=UserStatus.ACTIVE,
            notification_preferences=prefs,
        )
        self.db.add(user)
        await self.db.flush()
        return user

    async def officer(self, name, slug, prefs=None):
        user = await self.user(name, prefs=prefs)
        position = Position(
            id=_uid(), organization_id=self.org.id, name=name + " Post", slug=slug
        )
        self.db.add(position)
        await self.db.flush()
        await self.db.execute(
            user_positions.insert().values(user_id=user.id, position_id=position.id)
        )
        return user, position

    async def milestone(self, **fields) -> ProgramMilestone:
        items = fields.pop("items", [])
        milestone, error = await TrainingProgramService(
            self.db
        ).create_program_milestone(
            ProgramMilestoneCreate(
                program_id=uuid.UUID(self.program.id),
                name=fields.pop("name", "Halfway"),
                items=[
                    ProgramMilestoneItemInput(item_type=t, item_id=uuid.UUID(i))
                    for t, i in items
                ],
                **fields,
            ),
            self.org.id,
        )
        assert error is None, error
        return milestone

    async def set_progress(self, pct: float):
        self.enrollment.progress_percentage = pct
        await self.db.flush()

    async def course_record(self, on: date, **fields):
        self.db.add(
            TrainingRecord(
                id=_uid(),
                organization_id=self.org.id,
                user_id=self.member.id,
                course_id=self.course.id,
                course_name=self.course.name,
                training_type=TrainingType.CERTIFICATION,
                status=fields.pop("status", TrainingStatus.COMPLETED),
                completion_date=on,
                hours_completed=4,
                **fields,
            )
        )
        await self.db.flush()

    async def skill_test(self, when: datetime, **fields):
        values = dict(
            status="completed",
            result="pass",
            is_practice=False,
            completed_at=when,
            validated_at=when,
        )
        values.update(fields)
        self.db.add(
            SkillTest(
                id=_uid(),
                organization_id=self.org.id,
                template_id=self.skill.id,
                candidate_id=self.member.id,
                **values,
            )
        )
        await self.db.flush()

    async def knowledge_attempt(self, when: datetime, passed: bool):
        self.db.add(
            KnowledgeTestAttempt(
                id=_uid(),
                organization_id=self.org.id,
                test_id=self.knowledge.id,
                user_id=self.member.id,
                status="submitted",
                started_at=when,
                submitted_at=when,
                questions_snapshot=[],
                passing_score=70,
                score=90 if passed else 10,
                passed=passed,
            )
        )
        await self.db.flush()

    async def process(self) -> int:
        return await program_milestones.process_enrollments(
            self.db, [self.enrollment.id]
        )

    async def achievements(self):
        return list(
            (
                await self.db.execute(
                    select(ProgramMilestoneAchievement).where(
                        ProgramMilestoneAchievement.enrollment_id == self.enrollment.id
                    )
                )
            )
            .scalars()
            .all()
        )

    async def bells(self, user):
        return list(
            (
                await self.db.execute(
                    select(NotificationLog).where(
                        NotificationLog.recipient_id == user.id
                    )
                )
            )
            .scalars()
            .all()
        )


@pytest.fixture
def emails(monkeypatch):
    sent = AsyncMock(return_value=(1, 0))
    monkeypatch.setattr("app.services.email_service.EmailService.send_email", sent)
    return sent


def _recipients(sent):
    return [call.kwargs["to_emails"][0] for call in sent.await_args_list]


class TestTriggers:
    async def test_percentage_milestone_fires_once(self, db_session, emails):
        dept = await _Department(db_session).build()
        await dept.milestone(completion_percentage_threshold=50)
        await dept.set_progress(40)
        assert await dept.process() == 0
        await dept.set_progress(60)
        assert await dept.process() == 1
        # Evaluated again — by the next progress write or the sweep — nothing.
        assert await dept.process() == 0
        rows = await dept.achievements()
        assert [r.outcome for r in rows] == [MilestoneAchievementOutcome.NOTIFIED.value]
        assert _recipients(emails) == [dept.member.email]
        assert len(await dept.bells(dept.member)) == 1

    async def test_items_all_needs_every_item(self, db_session, emails):
        dept = await _Department(db_session).build()
        await dept.milestone(
            items=[("course", dept.course.id), ("knowledge_test", dept.knowledge.id)]
        )
        today = date.today()
        await dept.course_record(today)
        assert await dept.process() == 0
        await dept.knowledge_attempt(datetime.now(timezone.utc), passed=False)
        assert await dept.process() == 0
        await dept.knowledge_attempt(datetime.now(timezone.utc), passed=True)
        assert await dept.process() == 1

    async def test_items_any_needs_one(self, db_session, emails):
        dept = await _Department(db_session).build()
        await dept.milestone(
            items=[("course", dept.course.id), ("skill_test", dept.skill.id)],
            item_match_mode="any",
        )
        await dept.skill_test(datetime.now(timezone.utc))
        assert await dept.process() == 1

    async def test_percentage_and_items_are_joined_by_and(self, db_session, emails):
        dept = await _Department(db_session).build()
        await dept.milestone(
            completion_percentage_threshold=50, items=[("course", dept.course.id)]
        )
        await dept.course_record(date.today())
        assert await dept.process() == 0
        await dept.set_progress(50)
        assert await dept.process() == 1

    async def test_unvalidated_practice_or_failed_skill_tests_do_not_count(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.milestone(items=[("skill_test", dept.skill.id)])
        now = datetime.now(timezone.utc)
        await dept.skill_test(now, validated_at=None)
        await dept.skill_test(now, is_practice=True)
        await dept.skill_test(now, result="fail")
        assert await dept.process() == 0
        await dept.skill_test(now)
        assert await dept.process() == 1

    async def test_voided_or_failed_course_records_do_not_count(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.milestone(items=[("course", dept.course.id)])
        today = date.today()
        await dept.course_record(today, voided_at=datetime.now(timezone.utc))
        await dept.course_record(today, passed=False)
        await dept.course_record(today, status=TrainingStatus.SCHEDULED)
        assert await dept.process() == 0
        await dept.course_record(today)
        assert await dept.process() == 1


class TestPriorCompletions:
    async def test_completion_before_the_cycle_does_not_count_by_default(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.course_record(dept.enrolled_at.date() - timedelta(days=10))
        await dept.milestone(items=[("course", dept.course.id)])
        assert await dept.process() == 0

    async def test_it_counts_when_the_milestone_accepts_prior_completions(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.milestone(
            items=[("course", dept.course.id)], counts_prior_completions=True
        )
        # Recorded after the milestone exists, but dated before enrollment.
        await dept.course_record(dept.enrolled_at.date() - timedelta(days=10))
        assert await dept.process() == 1


class TestBaseline:
    async def test_members_already_past_a_new_milestone_are_not_told(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.set_progress(80)
        await dept.milestone(completion_percentage_threshold=50)
        rows = await dept.achievements()
        assert [r.outcome for r in rows] == [MilestoneAchievementOutcome.SKIPPED.value]
        assert await dept.process() == 0
        emails.assert_not_awaited()
        assert await dept.bells(dept.member) == []

    async def test_an_edit_that_changes_a_trigger_skips_members_who_now_meet_it(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.set_progress(60)
        milestone = await dept.milestone(completion_percentage_threshold=90)
        assert await dept.achievements() == []
        _, error = await TrainingProgramService(db_session).update_program_milestone(
            uuid.UUID(milestone.id),
            uuid.UUID(dept.program.id),
            dept.org.id,
            ProgramMilestoneUpdate(completion_percentage_threshold=50),
        )
        assert error is None
        rows = await dept.achievements()
        assert [r.outcome for r in rows] == [MilestoneAchievementOutcome.SKIPPED.value]
        assert await dept.process() == 0
        emails.assert_not_awaited()

    async def test_a_cycle_reset_lets_the_new_cycle_earn_it_again(
        self, db_session, emails
    ):
        dept = await _Department(db_session).build()
        await dept.milestone(completion_percentage_threshold=50)
        await dept.set_progress(60)
        assert await dept.process() == 1
        service = TrainingProgramService(db_session)
        await service._perform_enrollment_reset(dept.enrollment, dept.program)
        await db_session.commit()
        assert await dept.achievements() == []
        await dept.set_progress(60)
        assert await dept.process() == 1


class TestRecipients:
    async def test_member_and_officers_get_their_own_notices(self, db_session, emails):
        dept = await _Department(db_session).build()
        chief, chief_post = await dept.officer("Morgan", "chief")
        # The quartermaster turned training-duty emails off: bell instead.
        quartermaster, qm_post = await dept.officer(
            "Avery",
            "quartermaster",
            prefs={"email_kinds": {"training_duties": False}},
        )
        named = await dept.user("Casey")
        await dept.milestone(
            completion_percentage_threshold=50,
            notification_message="Great work, keep going!",
            notify_position_ids=[uuid.UUID(chief_post.id), uuid.UUID(qm_post.id)],
            notify_user_ids=[uuid.UUID(named.id)],
            officer_message="Uniform issue may be due.",
        )
        await dept.set_progress(55)
        assert await dept.process() == 1

        by_recipient = {
            call.kwargs["to_emails"][0]: call.kwargs for call in emails.await_args_list
        }
        assert set(by_recipient) == {dept.member.email, chief.email, named.email}
        member_mail = by_recipient[dept.member.email]
        assert "Great work, keep going!" in member_mail["text_body"]
        assert "Uniform issue" not in member_mail["text_body"]
        chief_mail = by_recipient[chief.email]
        assert (
            "Riley Tester has reached the Halfway milestone" in chief_mail["text_body"]
        )
        assert "Uniform issue may be due." in chief_mail["text_body"]

        assert len(await dept.bells(dept.member)) == 1
        assert len(await dept.bells(chief)) == 0
        qm_bells = await dept.bells(quartermaster)
        assert len(qm_bells) == 1
        assert "Uniform issue may be due." in qm_bells[0].message

    async def test_member_can_be_left_off(self, db_session, emails):
        dept = await _Department(db_session).build()
        chief, chief_post = await dept.officer("Morgan", "chief")
        await dept.milestone(
            completion_percentage_threshold=50,
            notify_member=False,
            notify_position_ids=[uuid.UUID(chief_post.id)],
        )
        await dept.set_progress(55)
        assert await dept.process() == 1
        assert _recipients(emails) == [chief.email]
        assert await dept.bells(dept.member) == []

    async def test_ids_from_another_department_are_refused(self, db_session):
        dept = await _Department(db_session).build()
        other = await _Department(db_session).build()
        service = TrainingProgramService(db_session)
        for bad in (
            {
                "items": [
                    ProgramMilestoneItemInput(
                        item_type="course", item_id=uuid.UUID(other.course.id)
                    )
                ]
            },
            {"notify_user_ids": [uuid.UUID(other.member.id)]},
        ):
            milestone, error = await service.create_program_milestone(
                ProgramMilestoneCreate(
                    program_id=uuid.UUID(dept.program.id),
                    name="Cross",
                    completion_percentage_threshold=50,
                    **bad,
                ),
                dept.org.id,
            )
            assert milestone is None
            assert "not found" in error


class TestMemberStandings:
    async def test_progress_page_reports_items_and_reached(self, db_session, emails):
        dept = await _Department(db_session).build()
        await dept.milestone(
            name="Engine ready",
            items=[("course", dept.course.id), ("knowledge_test", dept.knowledge.id)],
        )
        await dept.course_record(date.today())
        standings = await program_milestones.member_standings(
            db_session, dept.enrollment
        )
        assert len(standings) == 1
        entry = standings[0]
        assert entry["reached"] is False
        assert [(i["name"], i["completed"]) for i in entry["items"]] == [
            ("Pump Operations", True),
            ("Hydraulics Exam", False),
        ]
        await dept.knowledge_attempt(datetime.now(timezone.utc), passed=True)
        await dept.process()
        entry = (
            await program_milestones.member_standings(db_session, dept.enrollment)
        )[0]
        assert entry["reached"] is True
        assert entry["reached_at"] is not None


def _migration():
    path = next(
        Path(__file__)
        .resolve()
        .parents[1]
        .glob("alembic/versions/*_55e20c02dea7_milestone_triggers_and_recipients.py")
    )
    spec = importlib.util.spec_from_file_location("milestone_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TestMigrationBackfill:
    async def test_enrollments_already_past_an_old_milestone_are_skipped(
        self, db_session
    ):
        dept = await _Department(db_session).build()
        behind = ProgramEnrollment(
            id=_uid(),
            organization_id=dept.org.id,
            user_id=(await dept.user("Behind")).id,
            program_id=dept.program.id,
            status=EnrollmentStatus.ACTIVE,
            progress_percentage=40.0,
        )
        unknown = ProgramEnrollment(
            id=_uid(),
            organization_id=dept.org.id,
            user_id=(await dept.user("Unknown")).id,
            program_id=dept.program.id,
            status=EnrollmentStatus.ACTIVE,
            progress_percentage=None,
        )
        db_session.add_all([behind, unknown])
        await dept.set_progress(60)
        # Written the way a milestone existed before this migration: straight
        # into the table, no baseline.
        legacy = ProgramMilestone(
            id=_uid(),
            program_id=dept.program.id,
            name="Legacy halfway",
            completion_percentage_threshold=50.0,
        )
        db_session.add(legacy)
        await db_session.flush()

        backfill = text(_migration().BACKFILL_SQL)
        await db_session.execute(backfill)
        # Safe to run twice.
        await db_session.execute(backfill)

        rows = (
            await db_session.execute(
                select(
                    ProgramMilestoneAchievement.enrollment_id,
                    ProgramMilestoneAchievement.outcome,
                ).where(ProgramMilestoneAchievement.milestone_id == legacy.id)
            )
        ).all()
        assert rows == [(dept.enrollment.id, "skipped")]


class TestCopyAndExport:
    async def _rich_milestone(self, dept):
        chief, chief_post = await dept.officer("Morgan", "chief")
        await dept.milestone(
            name="Engine ready",
            completion_percentage_threshold=40,
            items=[("course", dept.course.id), ("skill_test", dept.skill.id)],
            item_match_mode="any",
            counts_prior_completions=True,
            notify_member=False,
            notify_position_ids=[uuid.UUID(chief_post.id)],
            notify_user_ids=[uuid.UUID(dept.member.id)],
            officer_message="Assign to an engine company.",
        )
        return chief_post

    async def test_a_duplicate_keeps_items_and_recipients(self, db_session):
        dept = await _Department(db_session).build()
        chief_post = await self._rich_milestone(dept)
        service = TrainingProgramService(db_session)
        copy_, error = await service.duplicate_program(
            uuid.UUID(dept.program.id),
            "Recruit Program II",
            dept.org.id,
            dept.member.id,
        )
        assert error is None
        [copied] = await program_milestones.load_milestones(db_session, copy_.id)
        assert copied.item_match_mode == "any"
        assert copied.counts_prior_completions is True
        assert copied.notify_member is False
        assert copied.notify_position_ids == [chief_post.id]
        assert copied.notify_user_ids == [dept.member.id]
        assert copied.officer_message == "Assign to an engine company."
        assert sorted(
            (i.item_type, program_milestones.item_target_id(i)) for i in copied.items
        ) == sorted([("course", dept.course.id), ("skill_test", dept.skill.id)])

    async def test_export_and_import_match_items_by_name(self, db_session):
        dept = await _Department(db_session).build()
        await self._rich_milestone(dept)
        service = TrainingProgramService(db_session)
        data = await service.export_program_to_json(dept.program.id, dept.org.id)
        [exported] = data["program_milestones"]
        assert exported["items"] == [
            {"item_type": "course", "name": "Pump Operations"},
            {"item_type": "skill_test", "name": "Hose Deployment"},
        ]
        assert exported["notify_position_slugs"] == ["chief"]
        assert "notify_user_ids" not in exported

        # Another department with the course and the chief, but not the skill.
        other = await _Department(db_session).build()
        await db_session.delete(other.skill)
        _, other_chief = await other.officer("Jamie", "chief")
        await db_session.flush()
        result = await service.import_program_from_json(
            data, other.org.id, other.member.id
        )
        assert result.summary["unmatched_milestone_items"] == [
            "Engine ready: Hose Deployment"
        ]
        [imported] = await program_milestones.load_milestones(
            db_session, result.program.id
        )
        assert [
            (i.item_type, program_milestones.item_target_id(i)) for i in imported.items
        ] == [("course", other.course.id)]
        assert imported.notify_position_ids == [other_chief.id]
        assert imported.notify_user_ids is None
