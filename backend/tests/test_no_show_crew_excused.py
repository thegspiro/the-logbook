"""A member who did not take the shift is not asked to be reported on.

Owner decision (2026-11-14): crew marked No-show, or still Pending, need no
trainee report and no shift evaluation before close-out, and close-out writes
them no draft report. Only Assigned and Confirmed crew count, the rule the
close-out wizard already used to credit attendance and calls
(``SchedulingService.WORKING_ASSIGNMENT_STATUSES``).
"""

import uuid

import pytest
from sqlalchemy import func, select, update

from app.models.training import (
    AssignmentStatus,
    ShiftAssignment,
    ShiftCompletionReport,
)
from app.services.scheduling_service import SchedulingService
from tests.test_shift_evaluations import _requirements
from tests.test_shift_evaluations import _scene as _evaluation_scene
from tests.test_shift_trainee_report_requirement import REQUIRED
from tests.test_shift_trainee_report_requirement import _scene as _report_scene

pytestmark = pytest.mark.integration

NOT_WORKED = [AssignmentStatus.NO_SHOW, AssignmentStatus.PENDING]


async def _set_status(db, shift_id, user_id, status, *, is_training=None):
    values = {"assignment_status": status}
    if is_training is not None:
        values["is_training"] = is_training
    await db.execute(
        update(ShiftAssignment)
        .where(ShiftAssignment.shift_id == shift_id, ShiftAssignment.user_id == user_id)
        .values(**values)
    )
    await db.flush()


@pytest.mark.parametrize("status", NOT_WORKED)
async def test_no_trainee_report_is_needed(db_session, status):
    org_id, officer, trainee, shift = await _report_scene(db_session, REQUIRED)
    await _set_status(db_session, shift.id, trainee, status)

    missing = await SchedulingService(db_session).missing_trainee_reports(
        shift.id, org_id
    )

    assert missing == []


@pytest.mark.parametrize("status", NOT_WORKED)
async def test_no_evaluation_is_needed(db_session, status):
    scene = await _evaluation_scene(db_session)
    await _set_status(db_session, scene.shift.id, scene.trainee.id, status)

    reqs = await _requirements(db_session, scene)

    assert scene.trainee.id not in {r.member.id for r in reqs}


@pytest.mark.parametrize("status", NOT_WORKED)
async def test_close_out_writes_them_no_draft_report(db_session, status):
    scene = await _evaluation_scene(db_session)
    await _set_status(
        db_session, scene.shift.id, scene.trainee.id, status, is_training=True
    )

    _, error = await SchedulingService(db_session).finalize_shift(
        uuid.UUID(scene.shift.id), scene.org_id, str(scene.officer.id)
    )

    assert error is None
    drafts = (
        await db_session.execute(
            select(func.count(ShiftCompletionReport.id)).where(
                ShiftCompletionReport.shift_id == scene.shift.id,
                ShiftCompletionReport.trainee_id == scene.trainee.id,
            )
        )
    ).scalar_one()
    assert drafts == 0


async def test_a_confirmed_trainee_is_still_asked_for(db_session):
    org_id, officer, trainee, shift = await _report_scene(db_session, REQUIRED)

    missing = await SchedulingService(db_session).missing_trainee_reports(
        shift.id, org_id
    )

    assert [user_id for user_id, _ in missing] == [trainee]
