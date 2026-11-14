"""A department shift's evaluations are fixed when the shift ends.

Owner decision, 2026-11-14: which evaluations a shift calls for is settled by
the department's settings and the members' programs as they stood when the
shift ended, not as they stand on the day somebody opens the shift. Turning on
"one evaluation for several programs", or enrolling a member in another
program, after the shift is over must neither orphan evaluations already
submitted nor re-block a close-out that was ready.

Who is on the crew stays live: a member taken off the crew is not asked for,
and one added later is worked out by today's rules and joins the stored set.
Before the shift ends nothing is stored and a setting change applies at once.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.shift_evaluation import COMBINED_SCOPE, ShiftEvaluationTemplate
from app.models.training import (
    AssignmentStatus,
    ShiftAssignment,
    TrainingModuleConfig,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_evaluation_service import ShiftEvaluationService
from tests.test_shift_evaluations import (
    _complete,
    _enroll,
    _member,
    _program,
    _requirements,
    _scene,
    _seat,
    _template,
)

pytestmark = pytest.mark.integration


async def _second_program(db, scene, name="Driver Candidate"):
    """A second program with its own form, joined before the shift."""
    form = await _template(db, scene.org_id, scene.officer.id, f"{name} Evaluation")
    program = await _program(db, scene.org_id, name, form.id)
    enrollment = await _enroll(db, scene.org_id, scene.trainee, program)
    # Joined when the scene's own enrollment was: one made "now" can fall
    # after the shift's date, and the enrollment cutoff rightly drops it.
    enrollment.enrolled_at = scene.enrollment.enrolled_at
    await db.flush()
    return form, program, enrollment


async def _combine(db, scene, on=True):
    config = (
        await db.execute(
            select(TrainingModuleConfig).where(
                TrainingModuleConfig.organization_id == scene.org_id
            )
        )
    ).scalar_one_or_none()
    if config is None:
        config = TrainingModuleConfig(organization_id=scene.org_id)
        db.add(config)
    config.one_shift_evaluation_for_multiple_programs = on
    await db.flush()


async def _seat_of(db, scene, user):
    return (
        await db.execute(
            select(ShiftAssignment).where(
                ShiftAssignment.shift_id == scene.shift.id,
                ShiftAssignment.user_id == user.id,
            )
        )
    ).scalar_one()


def _keys(reqs):
    return sorted((r.member.id, r.scope_key, r.required) for r in reqs)


class TestASettingChangedAfterTheShiftLeavesItAlone:
    async def test_combining_programs_does_not_orphan_or_reblock(self, db_session):
        scene = await _scene(db_session)
        _, _, driver_enrollment = await _second_program(db_session, scene)
        service = ShiftEvaluationService(db_session)

        before = await _requirements(db_session, scene)
        assert sorted(r.scope_key for r in before) == sorted(
            [scene.enrollment.id, driver_enrollment.id]
        )
        for scope_key in (scene.enrollment.id, driver_enrollment.id):
            await service.save(
                scene.shift,
                scene.trainee.id,
                scope_key,
                scene.org_id,
                _complete(),
                scene.officer,
            )

        await _combine(db_session, scene)
        after = await _requirements(db_session, scene)

        assert _keys(after) == sorted(
            [
                (scene.trainee.id, scene.enrollment.id, True),
                (scene.trainee.id, driver_enrollment.id, True),
            ]
        )
        assert all(r.evaluation is not None for r in after)
        assert not any(r.scope_key == COMBINED_SCOPE for r in after)

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )
        assert error is None
        assert result is not None
        assert result.is_finalized is True

    async def test_a_second_program_joined_later_adds_nothing(self, db_session):
        scene = await _scene(db_session)
        await _requirements(db_session, scene)

        await _second_program(db_session, scene)
        reqs = await _requirements(db_session, scene)

        assert _keys(reqs) == [(scene.trainee.id, scene.enrollment.id, True)]

    async def test_a_form_attached_after_close_out_asks_for_nothing(self, db_session):
        # Close-out is a first read too: it stores what it checked, so a form
        # attached to the program afterwards does not reach back to the shift.
        scene = await _scene(db_session)
        template_id = scene.program.shift_evaluation_template_id
        scene.program.shift_evaluation_template_id = None
        await db_session.flush()

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )
        assert error is None
        assert result is not None
        assert scene.shift.evaluation_requirements == {
            scene.officer.id: [],
            scene.trainee.id: [],
            scene.crew.id: [],
        }

        scene.program.shift_evaluation_template_id = template_id
        await db_session.flush()

        assert await _requirements(db_session, scene) == []

    async def test_a_deleted_form_drops_out_of_the_options(self, db_session):
        scene = await _scene(db_session)
        await _requirements(db_session, scene)

        template = (
            await db_session.execute(
                select(ShiftEvaluationTemplate).where(
                    ShiftEvaluationTemplate.id == scene.template_id
                )
            )
        ).scalar_one()
        await db_session.delete(template)
        await db_session.flush()

        [req] = await _requirements(db_session, scene)
        assert req.scope_key == scene.enrollment.id
        assert req.templates == []
        with pytest.raises(LookupError, match="form no longer exists"):
            await ShiftEvaluationService(db_session).form(
                scene.shift,
                scene.trainee.id,
                scene.enrollment.id,
                scene.org_id,
            )


class TestTheCrewStaysLive:
    async def test_a_member_taken_off_the_crew_is_not_asked_for(self, db_session):
        scene = await _scene(db_session)
        await _requirements(db_session, scene)
        # Frozen: a program joined now would add nothing ...
        await _second_program(db_session, scene)
        # ... and a member who is no longer crew is not asked for at all.
        seat = await _seat_of(db_session, scene, scene.trainee)
        seat.assignment_status = AssignmentStatus.DECLINED
        await db_session.flush()

        assert await _requirements(db_session, scene) == []

        # Put back on the crew, they are asked for what was stored.
        seat.assignment_status = AssignmentStatus.CONFIRMED
        await db_session.flush()
        reqs = await _requirements(db_session, scene)
        assert _keys(reqs) == [(scene.trainee.id, scene.enrollment.id, True)]

    async def test_a_member_added_afterwards_is_asked_for_by_todays_rules(
        self, db_session
    ):
        scene = await _scene(db_session)
        await _requirements(db_session, scene)
        stored_before = dict(scene.shift.evaluation_requirements)

        newcomer = await _member(db_session, scene.org_id, "Nora")
        emt = await _enroll(db_session, scene.org_id, newcomer, scene.program)
        emt.enrolled_at = scene.enrollment.enrolled_at
        driver_form = await _template(
            db_session, scene.org_id, scene.officer.id, "Driver Evaluation"
        )
        driver = await _program(
            db_session, scene.org_id, "Driver Candidate", driver_form.id
        )
        second = await _enroll(db_session, scene.org_id, newcomer, driver)
        second.enrolled_at = scene.enrollment.enrolled_at
        await _combine(db_session, scene)
        db_session.add(_seat(scene.org_id, scene.shift, newcomer, "firefighter"))
        await db_session.flush()

        reqs = await _requirements(db_session, scene)

        # The newcomer gets one combined evaluation (today's setting); the
        # trainee stored before keeps their single per-program one.
        assert _keys(reqs) == sorted(
            [
                (scene.trainee.id, scene.enrollment.id, True),
                (newcomer.id, COMBINED_SCOPE, True),
            ]
        )
        stored = scene.shift.evaluation_requirements
        assert newcomer.id in stored
        assert {k: stored[k] for k in stored_before} == stored_before


class TestBeforeTheShiftEndsItIsLive:
    async def test_a_setting_change_applies(self, db_session):
        scene = await _scene(db_session)
        start = datetime.now(timezone.utc) - timedelta(hours=2)
        scene.shift.start_time = start
        scene.shift.end_time = start + timedelta(hours=12)
        await db_session.flush()
        _, _, driver_enrollment = await _second_program(db_session, scene)

        before = await _requirements(db_session, scene)
        assert sorted(r.scope_key for r in before) == sorted(
            [scene.enrollment.id, driver_enrollment.id]
        )
        assert scene.shift.evaluation_requirements is None

        await _combine(db_session, scene)
        after = await _requirements(db_session, scene)

        assert _keys(after) == [(scene.trainee.id, COMBINED_SCOPE, True)]
        assert scene.shift.evaluation_requirements is None
