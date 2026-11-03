"""Evaluations of shifts members log on an outside agency's units.

Pins the rules agreed for outside shifts (e.g. riding an ACFD unit):

  * a shift is evaluated only on an agency the department switched on, only
    while the logged shift counts, and only for a program the member was
    already in on the shift's date;
  * a training officer enters the outside preceptor's evaluation and must
    name the preceptor to submit it;
  * the shift lists say "needed", "draft" or "submitted", and the officer's
    outstanding list holds the first two;
  * the member sees a submitted one at once (there is no report to approve),
    and program credit lands then; rejecting the logged shift, or the member
    deleting it, takes the credit back, and restoring it gives it back.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
)
from app.models.shift_evaluation import EXTERNAL_OCCASION, ShiftEvaluation
from app.models.training import RequirementType, TrainingModuleConfig
from app.services.external_apparatus_service import ExternalApparatusService
from app.services.external_shift_hours_service import ExternalShiftHoursService
from app.services.shift_evaluation_service import ShiftEvaluationService
from tests.test_shift_evaluation_credit import _requirement, _value
from tests.test_shift_evaluations import _complete, _org, _scene

pytestmark = pytest.mark.integration


async def _outside(db, scene, *, evaluate=True, days_ago=3, status="counted"):
    """An ACFD unit and a shift the trainee logged on it."""
    agency = ExternalAgency(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        name=f"ACFD {uuid.uuid4().hex[:6]}",
        evaluate_shifts=evaluate,
    )
    db.add(agency)
    await db.flush()
    unit = ExternalApparatus(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        agency_id=agency.id,
        name="Medic 101",
    )
    db.add(unit)
    # The trainee joined the program a month ago, so a shift a few days old
    # falls inside it.
    scene.enrollment.enrolled_at = datetime.now(timezone.utc) - timedelta(days=30)
    start = datetime.now(timezone.utc) - timedelta(days=days_ago)
    entry = ExternalShiftHours(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        user_id=scene.trainee.id,
        shift_date=start.date(),
        duration_minutes=12 * 60,
        start_at=start,
        end_at=start + timedelta(hours=12),
        external_apparatus_id=unit.id,
        agency_name=agency.name,
        apparatus_name=unit.name,
        status=status,
    )
    db.add(entry)
    await db.flush()
    return agency, entry


async def _submit(db, scene, entry, **overrides):
    body = {"preceptor_name": "Pat Preceptor", **overrides}
    return await ShiftEvaluationService(db).save_for_entry(
        entry, scene.enrollment.id, scene.org_id, _complete(**body), scene.officer
    )


async def _status(db, scene, entry):
    return (await ShiftEvaluationService(db).entry_statuses([entry], scene.org_id))[
        entry.id
    ]


class TestWhichOutsideShiftsAreEvaluated:
    async def test_an_agency_switched_on_asks_for_one(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        reqs = await ShiftEvaluationService(db_session).entry_requirements(
            entry, scene.org_id
        )

        assert [(r.member.id, r.scope_key, r.required) for r in reqs] == [
            (scene.trainee.id, scene.enrollment.id, True)
        ]
        assert await _status(db_session, scene, entry) == "needed"

    async def test_an_agency_left_off_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, evaluate=False)

        assert (
            await ShiftEvaluationService(db_session).entry_requirements(
                entry, scene.org_id
            )
            == []
        )
        assert await _status(db_session, scene, entry) is None

    async def test_a_rejected_shift_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, status="rejected")

        assert await _status(db_session, scene, entry) is None

    async def test_a_shift_before_the_member_joined_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, days_ago=45)

        assert await _status(db_session, scene, entry) is None

    async def test_a_member_in_no_program_with_a_form_asks_for_nothing(
        self, db_session
    ):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        scene.program.shift_evaluation_template_id = None
        await db_session.flush()

        assert await _status(db_session, scene, entry) is None


class TestEnteringTheEvaluation:
    async def test_a_submission_names_the_preceptor(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        with pytest.raises(ValueError, match="name of the preceptor"):
            await _submit(db_session, scene, entry, preceptor_name="")

    async def test_a_draft_needs_no_preceptor_yet(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        await _submit(db_session, scene, entry, preceptor_name=None, submit=False)

        assert await _status(db_session, scene, entry) == "draft"

    async def test_the_submitted_evaluation_describes_the_outside_shift(
        self, db_session
    ):
        scene = await _scene(db_session)
        agency, entry = await _outside(db_session, scene)

        evaluation = await _submit(db_session, scene, entry)

        assert evaluation.occasion == EXTERNAL_OCCASION
        assert evaluation.external_shift_id == entry.id
        assert evaluation.shift_id is None
        assert evaluation.preceptor_name == "Pat Preceptor"
        assert evaluation.evaluator_id == scene.officer.id
        assert evaluation.unit_label == f"{agency.name} Medic 101"
        assert evaluation.shift_date == entry.shift_date
        assert await _status(db_session, scene, entry) == "submitted"

    async def test_saving_again_lands_on_the_same_row(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        first = await _submit(db_session, scene, entry, submit=False)
        second = await _submit(db_session, scene, entry)

        assert second.id == first.id
        count = (
            await db_session.execute(
                select(func.count(ShiftEvaluation.id)).where(
                    ShiftEvaluation.external_shift_id == entry.id
                )
            )
        ).scalar_one()
        assert count == 1

    async def test_the_member_cannot_enter_their_own(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        with pytest.raises(ValueError, match="evaluate yourself"):
            await ShiftEvaluationService(db_session).save_for_entry(
                entry,
                scene.enrollment.id,
                scene.org_id,
                _complete(preceptor_name="Pat Preceptor"),
                scene.trainee,
            )

    async def test_no_calls_are_suggested_for_an_outside_shift(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        form = await ShiftEvaluationService(db_session).entry_form(
            entry, scene.enrollment.id, scene.org_id
        )

        assert form.occasion == EXTERNAL_OCCASION
        assert form.external_shift_id == entry.id
        assert form.shift_id is None
        assert form.prefill_statistics == {}


class TestOutstandingList:
    async def test_lists_needed_and_draft_but_not_submitted(self, db_session):
        scene = await _scene(db_session)
        _, needed = await _outside(db_session, scene, days_ago=2)
        _, drafted = await _outside(db_session, scene, days_ago=3)
        _, done = await _outside(db_session, scene, days_ago=4)
        await _submit(db_session, scene, drafted, submit=False)
        await _submit(db_session, scene, done)

        rows = await ShiftEvaluationService(db_session).outstanding_entries(
            scene.org_id
        )

        assert [(entry.id, state, key) for entry, state, key in rows] == [
            (needed.id, "needed", scene.enrollment.id),
            (drafted.id, "draft", scene.enrollment.id),
        ]

    async def test_the_shift_list_carries_the_status(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        items, _ = await ExternalShiftHoursService(db_session).list_entries(
            scene.org_id, user_id=scene.trainee.id
        )

        assert [(i["id"], i["evaluation_status"]) for i in items] == [
            (entry.id, "needed")
        ]


class TestVisibilityAndCredit:
    async def test_the_member_sees_it_at_once_even_under_report_review(
        self, db_session
    ):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, report_review_required=True
            )
        )
        await db_session.flush()
        _, entry = await _outside(db_session, scene)
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )

        evaluation = await _submit(db_session, scene, entry)

        service = ShiftEvaluationService(db_session)
        assert await service.visible_to_member(evaluation, scene.org_id) is True
        assert await _value(db_session, transports) == 4

    async def test_rejecting_the_shift_takes_credit_back_and_restoring_returns_it(
        self, db_session
    ):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        await _submit(db_session, scene, entry)
        assert await _value(db_session, shifts) == 1

        hours = ExternalShiftHoursService(db_session)
        await hours.reject(scene.org_id, entry.id, scene.officer.id, "Not on duty")
        assert await _value(db_session, shifts) == 0

        await hours.restore(scene.org_id, entry.id, scene.officer.id)
        assert await _value(db_session, shifts) == 1

    async def test_deleting_the_logged_shift_takes_credit_back(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        evaluation = await _submit(db_session, scene, entry)
        evaluation_id = evaluation.id

        await ExternalShiftHoursService(db_session).delete_own(
            scene.org_id, scene.trainee.id, entry.id
        )

        assert await _value(db_session, shifts) == 0
        kept = await ShiftEvaluationService(db_session).get(evaluation_id, scene.org_id)
        # The member's record survives; it just no longer counts.
        assert kept is not None
        await db_session.refresh(kept)
        assert kept.external_shift_id is None


class TestAgencySwitch:
    async def test_an_agency_is_created_off_and_can_be_switched_on(self, db_session):
        scene = await _scene(db_session)
        service = ExternalApparatusService(db_session)

        agency = await service.create_agency(scene.org_id, {"name": "ACFD"})
        assert service.serialize_agency(agency)["evaluate_shifts"] is False

        agency = await service.update_agency(
            scene.org_id, agency.id, {"evaluate_shifts": True}
        )
        assert service.serialize_agency(agency)["evaluate_shifts"] is True


class TestTenancy:
    async def test_another_departments_entry_is_not_found(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        other = await _org(db_session)

        assert (
            await ShiftEvaluationService(db_session).get_entry(entry.id, other) is None
        )
