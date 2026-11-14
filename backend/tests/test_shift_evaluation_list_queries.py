"""Reading a member's evaluations costs the same few queries however many
there are.

``/mine`` and ``/members/{id}`` decided each evaluation's visibility and built
each detail one evaluation at a time, two to five queries apiece, so the
pages slowed as a member's history grew. Visibility and detail are now worked
out for the whole list at once.
"""

import uuid
from datetime import timedelta

import pytest

from app.models.training import AssignmentStatus, Shift, ShiftAssignment
from app.services.shift_evaluation_service import ShiftEvaluationService
from tests.test_shift_evaluations import _complete, _scene

pytestmark = pytest.mark.integration


async def _evaluated_shifts(db, scene, count: int) -> None:
    """``count`` ended shifts, each with a submitted evaluation of the trainee."""
    service = ShiftEvaluationService(db)
    for days_back in range(count):
        start = scene.shift.start_time - timedelta(days=days_back + 1)
        shift = Shift(
            id=str(uuid.uuid4()),
            organization_id=scene.org_id,
            shift_date=start.date(),
            start_time=start,
            end_time=start + timedelta(hours=12),
            shift_officer_id=scene.officer.id,
            created_by=scene.officer.id,
        )
        db.add(shift)
        db.add(
            ShiftAssignment(
                id=str(uuid.uuid4()),
                organization_id=scene.org_id,
                shift_id=shift.id,
                user_id=scene.trainee.id,
                position="ems",
                assignment_status=AssignmentStatus.CONFIRMED,
            )
        )
        await db.flush()
        await service.save(
            shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(),
            scene.officer,
        )


async def _queries_to_read(db, scene) -> int:
    service = ShiftEvaluationService(db)
    count = 0
    real_execute = db.execute

    async def counting(statement, *args, **kwargs):
        nonlocal count
        count += 1
        return await real_execute(statement, *args, **kwargs)

    db.execute = counting
    try:
        evaluations = await service.list_for_member(
            scene.trainee.id, scene.org_id, member_view=True
        )
        await service.details(evaluations, scene.org_id)
    finally:
        del db.execute
    return count


async def test_the_query_count_does_not_grow_with_the_list(db_session):
    one = await _scene(db_session)
    await _evaluated_shifts(db_session, one, 1)
    four = await _scene(db_session)
    await _evaluated_shifts(db_session, four, 4)

    assert await _queries_to_read(db_session, one) == await _queries_to_read(
        db_session, four
    )


async def test_the_batch_agrees_with_the_one_at_a_time_rule(db_session):
    scene = await _scene(db_session)
    await _evaluated_shifts(db_session, scene, 3)
    service = ShiftEvaluationService(db_session)
    evaluations = await service.list_for_member(scene.trainee.id, scene.org_id)

    batch = await service.visible_ids(evaluations, scene.org_id)

    for evaluation in evaluations:
        assert (evaluation.id in batch) is await service.visible_to_member(
            evaluation, scene.org_id
        )
