"""Crew-recorded training: a shift officer files a drill for everyone present.

Any member who can serve as a shift officer — by rank, qualification or a
completed officer program, whether or not they held the seat that day — may
record. Every entry waits for a training officer, who cannot be the recorder,
and who may approve the whole crew at once or decide each member individually.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints import training_submissions
from app.core.constants import ROLE_TRAINING_OFFICER
from app.models.notification import NotificationLog
from app.models.operational_rank import OperationalRank
from app.models.training import (
    AssignmentStatus,
    SelfReportConfig,
    Shift,
    ShiftAssignment,
    SubmissionStatus,
    TrainingRecord,
)
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.schemas.training_submission import CrewTrainingCreate
from app.services.separation_of_duties import SeparationOfDutiesError
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.services.training_submission_service import (
    REVIEW_PROMPT_CATEGORY,
    TrainingSubmissionService,
)

DRILL = dict(
    course_name="Hose Advancement Drill",
    training_type="skills_practice",
    completion_date=date(2026, 10, 11),
    hours_completed=0.75,
)


# ---------------------------------------------------------------------------
# Schema — no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestCrewTrainingCreateSchema:
    def test_duplicate_members_are_collapsed(self):
        member = uuid.uuid4()
        payload = CrewTrainingCreate(**DRILL, member_ids=[member, member])
        assert payload.member_ids == [member]

    def test_at_least_one_member_is_required(self):
        with pytest.raises(ValidationError):
            CrewTrainingCreate(**DRILL, member_ids=[])

    def test_future_date_is_refused(self):
        with pytest.raises(ValidationError):
            CrewTrainingCreate(
                **{**DRILL, "completion_date": date.today() + timedelta(days=5)},
                member_ids=[uuid.uuid4()],
            )

    def test_zero_hours_is_refused(self):
        with pytest.raises(ValidationError):
            CrewTrainingCreate(
                **{**DRILL, "hours_completed": 0}, member_ids=[uuid.uuid4()]
            )


# ---------------------------------------------------------------------------
# Endpoint gate — mocked collaborators, no database
# ---------------------------------------------------------------------------


def _caller(permissions=()):
    position = SimpleNamespace(permissions=list(permissions))
    return SimpleNamespace(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        username="caller",
        rank=None,
        positions=[position],
    )


@pytest.mark.unit
class TestRecordingGate:
    async def test_member_who_cannot_lead_is_refused(self, monkeypatch):
        eligibility = SimpleNamespace(
            can_serve_as_shift_officer=AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            training_submissions, "ShiftEligibilityService", lambda db: eligibility
        )
        payload = CrewTrainingCreate(**DRILL, member_ids=[uuid.uuid4()])
        with pytest.raises(HTTPException) as exc:
            await training_submissions.record_crew_training(
                data=payload, db=object(), current_user=_caller()
            )
        assert exc.value.status_code == 403

    async def test_context_says_no_without_listing_members(self, monkeypatch):
        eligibility = SimpleNamespace(
            can_serve_as_shift_officer=AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            training_submissions, "ShiftEligibilityService", lambda db: eligibility
        )
        context = await training_submissions.get_crew_recording_context(
            db=object(), current_user=_caller()
        )
        assert context.can_record is False
        assert context.members == []

    async def test_training_manage_does_not_need_officer_capacity(self, monkeypatch):
        eligibility = SimpleNamespace(
            can_serve_as_shift_officer=AsyncMock(return_value=False)
        )
        monkeypatch.setattr(
            training_submissions, "ShiftEligibilityService", lambda db: eligibility
        )
        assert await training_submissions._may_record_crew_training(
            object(), _caller(["training.manage"])
        )
        eligibility.can_serve_as_shift_officer.assert_not_awaited()


# ---------------------------------------------------------------------------
# Database-backed
# ---------------------------------------------------------------------------


async def _org(db, **config):
    org = Organization(name="Crew FD", slug=f"crew-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    db.add(
        SelfReportConfig(
            organization_id=org.id,
            # Auto-approve everything a member reports, so a crew entry
            # staying pending proves it ignores the setting.
            require_approval=config.get("require_approval", False),
            auto_approve_under_hours=None,
            max_hours_per_submission=config.get("max_hours_per_submission"),
        )
    )
    db.add_all(
        [
            OperationalRank(
                organization_id=org.id,
                rank_code="lieutenant",
                display_name="Lieutenant",
                eligible_positions=["officer", "driver", "firefighter"],
            ),
            OperationalRank(
                organization_id=org.id,
                rank_code="engineer",
                display_name="Engineer",
                eligible_positions=["driver", "firefighter"],
            ),
            OperationalRank(
                organization_id=org.id,
                rank_code="acting_engineer",
                display_name="Engineer (Acting Officer)",
                eligible_positions=["driver", "firefighter", "officer"],
            ),
        ]
    )
    await db.flush()
    return org


async def _member(db, org, first, *, rank=None, status=UserStatus.ACTIVE):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Crew",
        rank=rank,
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


async def _training_officer(db, org, first="Terry"):
    position = Position(
        organization_id=org.id,
        name="Training Officer",
        slug=ROLE_TRAINING_OFFICER,
        permissions=["training.manage"],
    )
    db.add(position)
    await db.flush()
    officer = await _member(db, org, first)
    await db.execute(
        user_positions.insert().values(user_id=officer.id, position_id=position.id)
    )
    await db.flush()
    return officer


async def _record(db, org, recorder, members, **overrides):
    return await TrainingSubmissionService(db).create_crew_submissions(
        organization_id=org.id,
        recorded_by=recorder.id,
        member_ids=[m.id for m in members],
        **{**DRILL, **overrides},
    )


@pytest.mark.integration
class TestOfficerCapacity:
    async def test_rank_that_clears_the_officer_seat_qualifies(self, db_session):
        org = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        assert await ShiftEligibilityService(db_session).can_serve_as_shift_officer(
            lieutenant, org.id
        )

    async def test_driver_whose_rank_also_clears_officer_qualifies(self, db_session):
        org = await _org(db_session)
        driver = await _member(db_session, org, "Dana", rank="acting_engineer")
        assert await ShiftEligibilityService(db_session).can_serve_as_shift_officer(
            driver, org.id
        )

    async def test_rank_without_the_officer_seat_does_not(self, db_session):
        org = await _org(db_session)
        engineer = await _member(db_session, org, "Eli", rank="engineer")
        assert not await ShiftEligibilityService(db_session).can_serve_as_shift_officer(
            engineer, org.id
        )

    async def test_org_wide_open_officer_seat_grants_nobody(self, db_session):
        org = await _org(db_session)
        org.settings = {"scheduling": {"open_positions": ["officer"]}}
        await db_session.flush()
        engineer = await _member(db_session, org, "Eli", rank="engineer")
        assert not await ShiftEligibilityService(db_session).can_serve_as_shift_officer(
            engineer, org.id
        )

    async def test_inactive_member_does_not(self, db_session):
        org = await _org(db_session)
        former = await _member(
            db_session, org, "Fran", rank="lieutenant", status=UserStatus.INACTIVE
        )
        assert not await ShiftEligibilityService(db_session).can_serve_as_shift_officer(
            former, org.id
        )


@pytest.mark.integration
class TestRecordingCrewTraining:
    async def test_one_pending_entry_per_member_including_the_recorder(
        self, db_session
    ):
        org = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        crew = [await _member(db_session, org, n) for n in ("Ana", "Ben", "Cal")]

        batch_id, submissions = await _record(
            db_session, org, lieutenant, [lieutenant, *crew]
        )

        assert len(submissions) == 4
        assert {str(s.submitted_by) for s in submissions} == {
            str(m.id) for m in [lieutenant, *crew]
        }
        for submission in submissions:
            # Pending even though this department auto-approves self-reports.
            assert submission.status == SubmissionStatus.PENDING_REVIEW
            assert str(submission.recorded_by) == str(lieutenant.id)
            assert str(submission.crew_batch_id) == str(batch_id)
            assert submission.recorder_name == "Lee Crew"
            assert submission.training_record_id is None

        records = (
            (
                await db_session.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert records == []

    async def test_member_of_another_department_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        outsider = await _member(db_session, other, "Oz")

        with pytest.raises(ValueError, match="not active members"):
            await _record(db_session, org, lieutenant, [lieutenant, outsider])

    async def test_inactive_member_is_refused(self, db_session):
        org = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        gone = await _member(db_session, org, "Gil", status=UserStatus.INACTIVE)

        with pytest.raises(ValueError, match="not active members"):
            await _record(db_session, org, lieutenant, [gone])

    async def test_shift_of_another_department_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        foreign = Shift(
            organization_id=other.id,
            shift_date=DRILL["completion_date"],
            start_time=datetime(2026, 10, 11, 7, tzinfo=timezone.utc),
        )
        db_session.add(foreign)
        await db_session.flush()

        with pytest.raises(ValueError, match="Invalid shift"):
            await _record(
                db_session, org, lieutenant, [lieutenant], shift_id=foreign.id
            )

    async def test_department_hour_cap_still_applies(self, db_session):
        org = await _org(db_session, max_hours_per_submission=2)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")

        with pytest.raises(ValueError, match="Hours exceed"):
            await _record(db_session, org, lieutenant, [lieutenant], hours_completed=3)

    async def test_training_officers_get_one_prompt_for_the_crew(self, db_session):
        org = await _org(db_session)
        officer = await _training_officer(db_session, org)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        crew = [await _member(db_session, org, n) for n in ("Ana", "Ben")]

        batch_id, _ = await _record(db_session, org, lieutenant, crew)

        prompts = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org.id,
                        NotificationLog.category == REVIEW_PROMPT_CATEGORY,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(prompts) == 1
        assert str(prompts[0].recipient_id) == str(officer.id)
        assert prompts[0].notification_metadata["crew_batch_id"] == str(batch_id)
        assert "2 members" in prompts[0].message

    async def test_member_cannot_edit_or_delete_their_crew_entry(self, db_session):
        org = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        ana = await _member(db_session, org, "Ana")
        _, submissions = await _record(db_session, org, lieutenant, [ana])
        service = TrainingSubmissionService(db_session)

        with pytest.raises(PermissionError, match="recorded by your officer"):
            await service.update_submission(
                str(submissions[0].id), ana.id, org.id, hours_completed=8
            )
        with pytest.raises(PermissionError, match="recorded by your officer"):
            await service.delete_submission(str(submissions[0].id), ana.id, org.id)


@pytest.mark.integration
class TestReviewingCrewTraining:
    async def test_approve_all_credits_every_member(self, db_session):
        org = await _org(db_session)
        officer = await _training_officer(db_session, org)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        crew = [await _member(db_session, org, n) for n in ("Ana", "Ben", "Cal")]
        batch_id, _ = await _record(db_session, org, lieutenant, [lieutenant, *crew])

        service = TrainingSubmissionService(db_session)
        approved, skipped = await service.approve_crew_batch(
            str(batch_id), officer.id, org.id
        )

        assert len(approved) == 4
        assert skipped == []
        records = (
            (
                await db_session.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(str(r.user_id) for r in records) == sorted(
            str(m.id) for m in [lieutenant, *crew]
        )
        assert all(r.hours_completed == 0.75 for r in records)

        prompts = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org.id,
                        NotificationLog.category == REVIEW_PROMPT_CATEGORY,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert prompts
        assert all(p.expires_at is not None for p in prompts)

    async def test_individual_adjustment_survives_approve_all(self, db_session):
        org = await _org(db_session)
        officer = await _training_officer(db_session, org)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        ana = await _member(db_session, org, "Ana")
        ben = await _member(db_session, org, "Ben")
        batch_id, submissions = await _record(db_session, org, lieutenant, [ana, ben])
        service = TrainingSubmissionService(db_session)
        anas = next(s for s in submissions if str(s.submitted_by) == str(ana.id))

        # Ana arrived late: credited half the drill.
        await service.review_submission(
            str(anas.id), officer.id, org.id, "approve", override_hours=0.5
        )
        approved, _ = await service.approve_crew_batch(
            str(batch_id), officer.id, org.id
        )

        assert [str(s.submitted_by) for s in approved] == [str(ben.id)]
        hours = {
            str(r.user_id): r.hours_completed
            for r in (
                await db_session.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org.id
                    )
                )
            )
            .scalars()
            .all()
        }
        assert hours == {str(ana.id): 0.5, str(ben.id): 0.75}

    async def test_recorder_cannot_approve_what_they_recorded(self, db_session):
        org = await _org(db_session)
        recorder = await _training_officer(db_session, org)
        ana = await _member(db_session, org, "Ana")
        batch_id, submissions = await _record(db_session, org, recorder, [ana])
        service = TrainingSubmissionService(db_session)

        with pytest.raises(SeparationOfDutiesError):
            await service.approve_crew_batch(str(batch_id), recorder.id, org.id)
        with pytest.raises(SeparationOfDutiesError):
            await service.review_submission(
                str(submissions[0].id), recorder.id, org.id, "approve"
            )

    async def test_reviewer_in_the_crew_is_skipped_not_failed(self, db_session):
        org = await _org(db_session)
        officer = await _training_officer(db_session, org)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        ana = await _member(db_session, org, "Ana")
        batch_id, _ = await _record(db_session, org, lieutenant, [officer, ana])

        approved, skipped = await TrainingSubmissionService(
            db_session
        ).approve_crew_batch(str(batch_id), officer.id, org.id)

        assert [str(s.submitted_by) for s in approved] == [str(ana.id)]
        assert len(skipped) == 1
        assert "another officer" in skipped[0]["reason"]

    async def test_revision_request_is_refused_for_a_crew_entry(self, db_session):
        org = await _org(db_session)
        officer = await _training_officer(db_session, org)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        ana = await _member(db_session, org, "Ana")
        _, submissions = await _record(db_session, org, lieutenant, [ana])

        with pytest.raises(ValueError, match="cannot be sent back"):
            await TrainingSubmissionService(db_session).review_submission(
                str(submissions[0].id), officer.id, org.id, "revision_requested"
            )

    async def test_batch_of_another_department_is_not_found(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        officer = await _training_officer(db_session, other)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        batch_id, _ = await _record(db_session, org, lieutenant, [lieutenant])

        with pytest.raises(ValueError, match="not found"):
            await TrainingSubmissionService(db_session).approve_crew_batch(
                str(batch_id), officer.id, other.id
            )


@pytest.mark.integration
class TestShiftOptions:
    async def test_lists_the_days_shifts_with_who_was_on_them(
        self, db_session, monkeypatch
    ):
        org = await _org(db_session)
        lieutenant = await _member(db_session, org, "Lee", rank="lieutenant")
        ana = await _member(db_session, org, "Ana")
        declined = await _member(db_session, org, "Dee")
        shift = Shift(
            organization_id=org.id,
            shift_date=DRILL["completion_date"],
            start_time=datetime(2026, 10, 11, 11, tzinfo=timezone.utc),
            end_time=datetime(2026, 10, 11, 23, tzinfo=timezone.utc),
            shift_officer_id=lieutenant.id,
        )
        db_session.add(shift)
        await db_session.flush()
        for member, status in (
            (lieutenant, AssignmentStatus.CONFIRMED),
            (ana, AssignmentStatus.ASSIGNED),
            (declined, AssignmentStatus.DECLINED),
        ):
            db_session.add(
                ShiftAssignment(
                    organization_id=org.id,
                    shift_id=shift.id,
                    user_id=member.id,
                    position="firefighter",
                    assignment_status=status,
                )
            )
        await db_session.flush()

        # The gate is covered above; here it is the query under test.
        monkeypatch.setattr(
            training_submissions,
            "_require_crew_recorder",
            AsyncMock(return_value=None),
        )
        caller = SimpleNamespace(id=lieutenant.id, organization_id=org.id)
        options = await training_submissions.get_crew_shift_options(
            shift_date=DRILL["completion_date"], db=db_session, current_user=caller
        )

        assert len(options) == 1
        assert options[0].shift_officer_name == "Lee Crew"
        assert {str(m) for m in options[0].member_ids} == {
            str(lieutenant.id),
            str(ana.id),
        }
