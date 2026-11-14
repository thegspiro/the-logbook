"""
An approved shift report's training credit follows its edits.

Owner decision 2026-11-01 ("restate credit in place"): where the department
does not require shift-report review, an edit to an approved report stays
approved (EC-17 sends it back only where review is required), so its credit is
recalculated by the same function the approval path uses and restated on the
requirement-progress ledger — one credit per requirement and report, however
many times it is edited, and removed when the edit takes it away. Where review
is required the edit goes back to review as before, and the re-approval
restates it.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    ProgramEnrollment,
    ProgramRequirement,
    ProgressCreditSource,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementProgressStatus,
    RequirementType,
    SkillCheckoff,
    SkillEvaluation,
    TrainingModuleConfig,
    TrainingProgram,
    TrainingRequirement,
)
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_module_config_service import TrainingModuleConfigService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session: AsyncSession):
    """An org, a filing officer and a trainee enrolled in one program."""
    org_id, officer_id, trainee_id = _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test FD', 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    for uid, uname in [(officer_id, "captain"), (trainee_id, "probie")]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'A', 'B', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": f"{uname}-{uid[:6]}", "em": f"{uid}@t.io"},
        )
    program = TrainingProgram(organization_id=org_id, name="Probationary")
    db_session.add(program)
    await db_session.flush()
    enrollment = ProgramEnrollment(
        organization_id=org_id, user_id=trainee_id, program_id=program.id
    )
    db_session.add(enrollment)
    await db_session.flush()
    return SimpleNamespace(
        org_id=org_id,
        officer_id=officer_id,
        trainee_id=trainee_id,
        program=program,
        enrollment=enrollment,
    )


async def _requirement(db_session, org, **fields) -> RequirementProgress:
    requirement = TrainingRequirement(
        organization_id=org.org_id,
        frequency=RequirementFrequency.ONE_TIME,
        **fields,
    )
    db_session.add(requirement)
    await db_session.flush()
    db_session.add(
        ProgramRequirement(program_id=org.program.id, requirement_id=requirement.id)
    )
    progress = RequirementProgress(
        enrollment_id=org.enrollment.id, requirement_id=requirement.id
    )
    db_session.add(progress)
    await db_session.flush()
    return progress


async def _review_required(db_session, org, required: bool) -> None:
    config = await TrainingModuleConfigService(db_session).get_config(org.org_id)
    config.report_review_required = required
    await db_session.flush()


async def _approved_report(db_session, org, **fields):
    svc = ShiftCompletionService(db_session)
    report = await svc.create_report(
        organization_id=uuid.UUID(org.org_id),
        officer_id=uuid.UUID(org.officer_id),
        trainee_id=org.trainee_id,
        shift_date=date.today() - timedelta(days=1),
        review_status="approved",
        **fields,
    )
    assert report.review_status == "approved"
    return svc, report


async def _edit(svc, org, report, updates):
    return await svc.update_report(
        report.id, uuid.UUID(org.org_id), org.officer_id, updates
    )


async def _ledger(db_session, report_id):
    rows = await db_session.execute(
        select(RequirementProgressCredit).where(
            RequirementProgressCredit.source_type == ProgressCreditSource.SHIFT_REPORT,
            RequirementProgressCredit.source_id == str(report_id),
        )
    )
    return {str(row.progress_id): row.units for row in rows.scalars().all()}


class TestReviewOffRestatesCreditInPlace:
    async def test_an_edit_restates_hours_and_removes_call_credit(
        self, db_session, org
    ):
        await _review_required(db_session, org, False)
        hours = await _requirement(
            db_session,
            org,
            name="Shift hours",
            requirement_type=RequirementType.HOURS,
            required_hours=100,
        )
        calls = await _requirement(
            db_session,
            org,
            name="Calls",
            requirement_type=RequirementType.CALLS,
            required_calls=50,
        )
        svc, report = await _approved_report(
            db_session, org, hours_on_shift=12.0, calls_responded=3
        )
        await db_session.refresh(hours)
        await db_session.refresh(calls)
        assert (hours.progress_value, calls.progress_value) == (12, 3)

        updated = await _edit(
            svc, org, report, {"hours_on_shift": 10.0, "calls_responded": 0}
        )

        assert updated.review_status == "approved"
        await db_session.refresh(hours)
        await db_session.refresh(calls)
        assert hours.progress_value == 10
        assert calls.progress_value == 0
        # One credit for hours at the new figure; the call credit is gone.
        assert await _ledger(db_session, report.id) == {str(hours.id): 10.0}
        assert updated.credit_restatement["credits"] == [
            {
                "requirement_progress_id": pid,
                "units_before": before,
                "units_after": after,
            }
            for pid, before, after in sorted(
                [(str(hours.id), 12.0, 10.0), (str(calls.id), 3.0, 0.0)]
            )
        ]

    async def test_editing_twice_leaves_one_credit_at_the_latest_figure(
        self, db_session, org
    ):
        await _review_required(db_session, org, False)
        hours = await _requirement(
            db_session,
            org,
            name="Shift hours",
            requirement_type=RequirementType.HOURS,
            required_hours=100,
        )
        shifts = await _requirement(
            db_session,
            org,
            name="Shifts",
            requirement_type=RequirementType.SHIFTS,
            required_shifts=10,
        )
        svc, report = await _approved_report(db_session, org, hours_on_shift=12.0)

        await _edit(svc, org, report, {"hours_on_shift": 8.0})
        await _edit(svc, org, report, {"hours_on_shift": 9.0})

        await db_session.refresh(hours)
        await db_session.refresh(shifts)
        assert hours.progress_value == 9
        # The shift is still one shift, however often the report is edited.
        assert shifts.progress_value == 1
        assert await _ledger(db_session, report.id) == {
            str(hours.id): 9.0,
            str(shifts.id): 1.0,
        }
        rows = (
            await db_session.execute(
                select(func.count(RequirementProgressCredit.id)).where(
                    RequirementProgressCredit.source_id == str(report.id)
                )
            )
        ).scalar()
        assert rows == 2

    async def test_a_narrative_edit_moves_no_credit(self, db_session, org):
        await _review_required(db_session, org, False)
        hours = await _requirement(
            db_session,
            org,
            name="Shift hours",
            requirement_type=RequirementType.HOURS,
            required_hours=100,
        )
        svc, report = await _approved_report(db_session, org, hours_on_shift=12.0)

        updated = await _edit(svc, org, report, {"officer_narrative": "Good shift."})

        await db_session.refresh(hours)
        assert hours.progress_value == 12
        assert getattr(updated, "credit_restatement", None) is None

    async def test_a_requirement_the_report_completed_is_restated_too(
        self, db_session, org
    ):
        await _review_required(db_session, org, False)
        hours = await _requirement(
            db_session,
            org,
            name="Ride-along hours",
            requirement_type=RequirementType.HOURS,
            required_hours=10,
        )
        svc, report = await _approved_report(db_session, org, hours_on_shift=12.0)
        await db_session.refresh(hours)
        assert hours.status == RequirementProgressStatus.COMPLETED

        await _edit(svc, org, report, {"hours_on_shift": 8.0})

        await db_session.refresh(hours)
        assert hours.progress_value == 8
        assert hours.progress_percentage == 80
        # Status is not asserted: the shared ledger's numeric reversal does not
        # reopen a completed requirement (a residual in KNOWN_LIMITATIONS,
        # common to every feed that restates, not only shift reports).
        assert await _ledger(db_session, report.id) == {str(hours.id): 8.0}

    async def test_call_type_history_counts_the_report_once(self, db_session, org):
        await _review_required(db_session, org, False)
        mva = await _requirement(
            db_session,
            org,
            name="MVA responses",
            requirement_type=RequirementType.CALLS,
            required_calls=10,
            required_call_types=["mva"],
        )
        svc, report = await _approved_report(
            db_session,
            org,
            hours_on_shift=12.0,
            calls_responded=2,
            call_types=["mva", "mva"],
        )

        await _edit(svc, org, report, {"calls_responded": 1, "call_types": ["mva"]})

        await db_session.refresh(mva)
        assert mva.progress_value == 1
        notes = mva.progress_notes or {}
        assert notes["call_type_totals"] == {"mva": 1}
        assert [h["count"] for h in notes["call_type_history"]] == [1]

    async def test_a_skill_removed_from_the_report_loses_its_signoff(
        self, db_session, org
    ):
        await _review_required(db_session, org, False)
        config = (
            await db_session.execute(
                select(TrainingModuleConfig).where(
                    TrainingModuleConfig.organization_id == org.org_id
                )
            )
        ).scalar_one()
        config.practical_skills_method = "shift_signoffs"
        skill = SkillEvaluation(organization_id=org.org_id, name="Hose Deployment")
        db_session.add(skill)
        await db_session.flush()
        svc, report = await _approved_report(
            db_session,
            org,
            hours_on_shift=12.0,
            skills_observed=[{"skill_name": "Hose Deployment", "demonstrated": True}],
        )

        async def signoffs():
            return (
                await db_session.execute(
                    select(func.count(SkillCheckoff.id)).where(
                        SkillCheckoff.user_id == org.trainee_id,
                        SkillCheckoff.skill_evaluation_id == skill.id,
                    )
                )
            ).scalar()

        assert await signoffs() == 1
        updated = await _edit(
            svc,
            org,
            report,
            {
                "skills_observed": [
                    {"skill_name": "Hose Deployment", "demonstrated": False}
                ]
            },
        )
        assert await signoffs() == 0
        assert updated.credit_restatement["skill_signoffs_removed"] == [str(skill.id)]


class TestReviewOnKeepsEc17:
    async def test_an_edit_waits_for_reapproval_which_restates_it(
        self, db_session, org
    ):
        await _review_required(db_session, org, True)
        hours = await _requirement(
            db_session,
            org,
            name="Shift hours",
            requirement_type=RequirementType.HOURS,
            required_hours=100,
        )
        svc = ShiftCompletionService(db_session)
        report = await svc.create_report(
            organization_id=uuid.UUID(org.org_id),
            officer_id=uuid.UUID(org.officer_id),
            trainee_id=org.trainee_id,
            shift_date=date.today() - timedelta(days=1),
            hours_on_shift=12.0,
            review_status="pending_review",
        )
        await svc.review_report(
            report.id, uuid.UUID(org.org_id), org.officer_id, "approved"
        )
        await db_session.refresh(hours)
        assert hours.progress_value == 12

        updated = await _edit(svc, org, report, {"hours_on_shift": 10.0})

        # EC-17: back to review, and the credit waits for the reviewer.
        assert updated.review_status == "pending_review"
        assert getattr(updated, "credit_restatement", None) is None
        await db_session.refresh(hours)
        assert hours.progress_value == 12

        await svc.review_report(
            report.id, uuid.UUID(org.org_id), org.officer_id, "approved"
        )
        await db_session.refresh(hours)
        assert hours.progress_value == 10
        assert await _ledger(db_session, report.id) == {str(hours.id): 10.0}


class TestRestatementIsAudited:
    @pytest.mark.parametrize("restatement", [None, {"credits": [{"x": 1}]}])
    async def test_the_endpoint_audits_a_restatement(self, restatement):
        from app.api.v1.endpoints import shift_completion as endpoints
        from app.schemas.shift_completion import ShiftCompletionReportUpdate

        report = SimpleNamespace(trainee_id="trainee-1", credit_restatement=restatement)
        service = MagicMock()
        service.update_report = AsyncMock(return_value=report)
        user = MagicMock(id="officer-1", organization_id="org-1", username="cap")
        with (
            patch.object(endpoints, "ShiftCompletionService", return_value=service),
            patch.object(endpoints, "_manages_training", return_value=True),
            patch.object(endpoints, "log_audit_event", new=AsyncMock()) as audit,
        ):
            await endpoints.update_shift_report(
                report_id="report-1",
                data=ShiftCompletionReportUpdate(hours_on_shift=10.0),
                db=MagicMock(),
                current_user=user,
            )

        restated = [
            c.kwargs
            for c in audit.await_args_list
            if c.kwargs["event_type"] == "shift_report_credit_restated"
        ]
        if restatement is None:
            assert restated == []
        else:
            assert len(restated) == 1
            assert restated[0]["event_data"] == {
                "report_id": "report-1",
                "trainee_id": "trainee-1",
                "credits": [{"x": 1}],
            }
