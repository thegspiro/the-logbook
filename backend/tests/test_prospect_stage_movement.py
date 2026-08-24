"""
Prospective Member Stage Movement Tests

Covers the two halves of pipeline movement that the coordinator relies on:
the stage *stops* (a status that pauses or closes an application must stop
every forward path, including the event-driven ones), and the *flexibility*
to move an applicant back as freely as forward.

Each test names the behaviour a department depends on, not the internals.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectStatus, StepProgressStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return uuid.uuid4().hex


async def _pipeline_with_steps(svc, org_id, step_count=3):
    pipeline = await svc.create_pipeline(
        organization_id=org_id, name=f"Movement-{_uid()[:8]}"
    )
    steps = []
    for i in range(step_count):
        steps.append(
            await svc.add_step(
                pipeline.id,
                org_id,
                {
                    "name": f"Stage {i + 1}",
                    "step_type": "manual_approval",
                    "sort_order": i,
                    "required": True,
                },
            )
        )
    return pipeline, steps


async def _prospect(svc, org_id, admin_id, pipeline):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Move",
            "last_name": "Test",
            "email": f"move-{_uid()[:10]}@example.com",
            "pipeline_id": pipeline.id,
        },
        created_by=admin_id,
    )


def _status_of(record):
    return getattr(record.status, "value", record.status)


class TestStatusStopsMovement:
    """A status other than active is a stop, and it has to actually stop."""

    @pytest.mark.parametrize(
        "status",
        [
            ProspectStatus.ON_HOLD,
            ProspectStatus.REJECTED,
            ProspectStatus.WITHDRAWN,
            ProspectStatus.INACTIVE,
        ],
    )
    async def test_a_stopped_applicant_cannot_be_advanced(
        self, db_session: AsyncSession, setup_org_and_admin, status
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        prospect.status = status
        await db_session.commit()

        with pytest.raises(ValueError, match="cannot be advanced"):
            await svc.advance_prospect(
                prospect_id=prospect.id,
                organization_id=org_id,
                advanced_by=admin_id,
            )

        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(steps[0].id)

    async def test_a_stopped_applicant_cannot_be_moved_back(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        await svc.advance_prospect(
            prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
        )
        prospect.status = ProspectStatus.ON_HOLD
        await db_session.commit()

        with pytest.raises(ValueError, match="on hold"):
            await svc.regress_prospect(
                prospect_id=prospect.id,
                organization_id=org_id,
                regressed_by=admin_id,
            )

        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(steps[1].id)

    async def test_a_stopped_applicants_stage_cannot_be_skipped(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """Skip bypasses the stage's own gate; it must not bypass the hold."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        prospect.status = ProspectStatus.REJECTED
        await db_session.commit()

        with pytest.raises(ValueError, match="rejected"):
            await svc.skip_current_step(
                prospect_id=prospect.id,
                organization_id=org_id,
                skipped_by=admin_id,
            )

        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(steps[0].id)

    async def test_an_integration_event_does_not_step_over_a_hold(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The regression: an external event walked a paused applicant forward.

        Screening results and attendance records arrive from other modules
        and auto-advance the current stage when it opts in. Nothing consulted
        the prospect's status, so an applicant a coordinator had deliberately
        put on hold advanced anyway the moment a webhook fired — a stop that
        did not stop, with no coordinator action to explain it.
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name=f"AutoAdvance-{_uid()[:8]}"
        )
        first = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Auto Stage",
                "step_type": "manual_approval",
                "sort_order": 0,
                "config": {"auto_advance": True},
            },
        )
        await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Second", "step_type": "manual_approval", "sort_order": 1},
        )
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        prospect.status = ProspectStatus.ON_HOLD
        await db_session.commit()

        moved = await svc._try_auto_advance_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=first.id,
            completed_by=admin_id,
            trigger="test_event",
        )

        # A no-op, not an exception: the event-driven caller is writing its
        # own record and must not be failed by somebody else's hold.
        assert moved is False
        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(first.id)

    async def test_resuming_restores_movement(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The stop is a pause, not a dead end — coming off hold moves again."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        prospect.status = ProspectStatus.ON_HOLD
        await db_session.commit()
        with pytest.raises(ValueError, match="on hold"):
            await svc.advance_prospect(
                prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
            )

        prospect.status = ProspectStatus.ACTIVE
        await db_session.commit()

        advanced = await svc.advance_prospect(
            prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
        )
        assert advanced is not None
        assert str(advanced.current_step_id) == str(steps[1].id)


class TestBackwardMovement:
    """Moving back has to be as honest about its outcome as moving forward."""

    async def test_regress_at_the_first_stage_is_refused_not_silently_ignored(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The regression: Back at stage one returned the untouched prospect.

        The caller got a 200 and the UI announced "moved back to previous
        stage" for a pointer that never moved — the same defect that was
        already fixed on advance, still live on the way back.
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        with pytest.raises(ValueError, match="already at the first stage"):
            await svc.regress_prospect(
                prospect_id=prospect.id,
                organization_id=org_id,
                regressed_by=admin_id,
            )

        await db_session.refresh(prospect)
        assert str(prospect.current_step_id) == str(steps[0].id)

    async def test_regress_with_no_current_stage_is_refused(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        prospect.current_step_id = None
        await db_session.commit()

        with pytest.raises(ValueError, match="no current stage"):
            await svc.regress_prospect(
                prospect_id=prospect.id,
                organization_id=org_id,
                regressed_by=admin_id,
            )

    async def test_back_all_the_way_and_forward_again_from_the_last_stage(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A department can walk an applicant the full length in both directions.

        Not just one step back: a coordinator who advanced someone three
        stages by mistake has to be able to undo all three, and the progress
        rows must end up exactly as they started.
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 4)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        for _ in range(3):
            await svc.advance_prospect(
                prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
            )
        at_end = await svc.get_prospect(prospect.id, org_id)
        assert str(at_end.current_step_id) == str(steps[3].id)

        for _ in range(3):
            await svc.regress_prospect(
                prospect_id=prospect.id, organization_id=org_id, regressed_by=admin_id
            )

        back_home = await svc.get_prospect(prospect.id, org_id)
        assert str(back_home.current_step_id) == str(steps[0].id)

        by_step = {str(p.step_id): p for p in back_home.step_progress}
        assert _status_of(by_step[str(steps[0].id)]) == "in_progress"
        assert by_step[str(steps[0].id)].completed_at is None
        for step in steps[1:]:
            record = by_step.get(str(step.id))
            if record is not None:
                assert _status_of(record) == "pending"
                assert record.completed_at is None

        # And forward again, so the round trip leaves nothing wedged.
        readvanced = await svc.advance_prospect(
            prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
        )
        assert str(readvanced.current_step_id) == str(steps[1].id)

    async def test_regress_is_recorded_in_the_activity_log(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        await svc.advance_prospect(
            prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
        )
        await svc.regress_prospect(
            prospect_id=prospect.id,
            organization_id=org_id,
            regressed_by=admin_id,
            notes="Wrong applicant",
        )

        log = await svc.get_activity_log(prospect.id, org_id)
        regressions = [e for e in log if e.action == "prospect_regressed"]
        assert len(regressions) == 1
        assert regressions[0].details["to_step_name"] == steps[0].name
        assert regressions[0].details["notes"] == "Wrong applicant"


class TestStageDeletionLeavesAWorkableStage:
    """Deleting a stage moves whoever was on it — and the landing has to read
    as the stage they are working, not one already ticked off."""

    async def test_deleting_a_mid_stage_lands_the_applicant_in_progress(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        await svc.advance_prospect(
            prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
        )

        assert await svc.delete_step(steps[1].id, pipeline.id, org_id) is True

        moved = await svc.get_prospect(prospect.id, org_id)
        assert str(moved.current_step_id) == str(steps[2].id)
        landed = next(
            p for p in moved.step_progress if str(p.step_id) == str(steps[2].id)
        )
        assert _status_of(landed) == "in_progress"

    async def test_deleting_the_last_stage_reopens_the_stage_fallen_back_to(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The regression: the fallback stage kept its completion stamp.

        Falling back to the previous stage put the applicant on a stage still
        marked completed, so the drawer drew a green tick on the stage they
        were sitting in and counted it toward "N of M stages completed".
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id, 3)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        for _ in range(2):
            await svc.advance_prospect(
                prospect_id=prospect.id, organization_id=org_id, advanced_by=admin_id
            )

        assert await svc.delete_step(steps[2].id, pipeline.id, org_id) is True

        moved = await svc.get_prospect(prospect.id, org_id)
        assert str(moved.current_step_id) == str(steps[1].id)
        landed = next(
            p for p in moved.step_progress if str(p.step_id) == str(steps[1].id)
        )
        assert landed.status == StepProgressStatus.IN_PROGRESS
        assert landed.completed_at is None
        assert landed.completed_by is None
