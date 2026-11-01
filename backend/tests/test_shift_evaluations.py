"""Shift evaluations against real tables.

Pins the rules agreed for evaluations on department shifts:

  * a member enrolled in a program whose program names a form is evaluated
    on it, one evaluation per program, or one for all of them when the
    department allows it;
  * a member in no such program, sitting in one of the general form's seats,
    gets the general form when it is optional or required;
  * a draft may be incomplete; a submission answers every item, writes every
    required comment, and keeps transports and refusals within the calls;
  * the stored answers are the form's and nothing else, a second save lands
    on the same row, and nobody evaluates themselves;
  * close-out waits for every required evaluation whatever the report setting
    says, and the audited admin override still closes it;
  * the member sees a submitted evaluation on the shift report's terms.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text

from app.models.shift_evaluation import (
    COMBINED_SCOPE,
    GENERAL_SCOPE,
    ShiftEvaluation,
)
from app.models.training import (
    AssignmentStatus,
    EnrollmentStatus,
    ProgramEnrollment,
    Shift,
    ShiftAssignment,
    ShiftCompletionReport,
    TrainingModuleConfig,
    TrainingProgram,
)
from app.models.user import User
from app.schemas.shift_evaluation import (
    ShiftEvaluationSave,
    ShiftEvaluationTemplateWrite,
)
from app.services.sample_evaluation_templates import emt_shift_evaluation_example
from app.services.scheduling_service import SchedulingService
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.services.shift_evaluation_template_service import (
    ShiftEvaluationTemplateService,
)

pytestmark = pytest.mark.integration


async def _member(db, org_id: str, first: str) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            ":fn, 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@fd.test",
        },
    )
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    return user


class Scene:
    """An ended shift with an officer, a trainee in a program, and a crew member."""

    org_id: str
    officer: User
    trainee: User
    crew: User
    shift: Shift
    template_id: str
    program: TrainingProgram
    enrollment: ProgramEnrollment


async def _org(db, settings=None) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) VALUES (:id, 'FD', 'fire_department', :slug, "
            "'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"fd-{org_id[:8]}",
            "settings": json.dumps(settings or {}),
        },
    )
    return org_id


async def _template(db, org_id: str, user_id: str, name="EMT Shift Evaluation"):
    body = emt_shift_evaluation_example().model_dump()
    body["name"] = name
    return await ShiftEvaluationTemplateService(db).create_template(
        org_id, ShiftEvaluationTemplateWrite.model_validate(body), user_id
    )


async def _program(db, org_id, name, template_id=None) -> TrainingProgram:
    program = TrainingProgram(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        shift_evaluation_template_id=template_id,
    )
    db.add(program)
    await db.flush()
    return program


async def _enroll(db, org_id, user, program, status=EnrollmentStatus.ACTIVE):
    enrollment = ProgramEnrollment(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user.id,
        program_id=program.id,
        status=status,
    )
    db.add(enrollment)
    await db.flush()
    return enrollment


def _seat(org_id, shift, user, position, status=AssignmentStatus.CONFIRMED):
    return ShiftAssignment(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        shift_id=shift.id,
        user_id=user.id,
        position=position,
        assignment_status=status,
    )


async def _scene(db, settings=None) -> Scene:
    scene = Scene()
    scene.org_id = await _org(db, settings)
    scene.officer = await _member(db, scene.org_id, "Olive")
    scene.trainee = await _member(db, scene.org_id, "Terry")
    scene.crew = await _member(db, scene.org_id, "Casey")
    start = datetime.now(timezone.utc) - timedelta(hours=14)
    scene.shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=12),
        shift_officer_id=scene.officer.id,
        created_by=scene.officer.id,
        platoon="B",
    )
    db.add(scene.shift)
    db.add_all(
        [
            _seat(scene.org_id, scene.shift, scene.officer, "officer"),
            _seat(scene.org_id, scene.shift, scene.trainee, "ems"),
            _seat(scene.org_id, scene.shift, scene.crew, "driver"),
        ]
    )
    await db.flush()
    template = await _template(db, scene.org_id, scene.officer.id)
    scene.template_id = template.id
    scene.program = await _program(
        db, scene.org_id, "EMT Field Internship", template.id
    )
    scene.enrollment = await _enroll(db, scene.org_id, scene.trainee, scene.program)
    return scene


def _complete(**overrides) -> ShiftEvaluationSave:
    """A full answer to the example form: everything 3, ALS commented."""
    example = emt_shift_evaluation_example()
    responses = {
        item.key: {"rating": 3}
        for section in example.sections
        for item in section.items
    }
    responses["als_assist"] = {"rating": 3, "comment": "12-lead on a chest pain call"}
    body = {
        "header_values": {"platoon": "B"},
        "statistics": {"calls": 7, "transports": 4, "refusals": 2},
        "responses": responses,
        "closing_comments": "Solid shift.",
        "submit": True,
    }
    body.update(overrides)
    return ShiftEvaluationSave.model_validate(body)


async def _requirements(db, scene):
    return await ShiftEvaluationService(db).requirements(scene.shift, scene.org_id)


class TestWhoIsEvaluated:
    async def test_a_member_in_a_program_with_a_form(self, db_session):
        scene = await _scene(db_session)

        reqs = await _requirements(db_session, scene)

        assert len(reqs) == 1
        req = reqs[0]
        assert req.member.id == scene.trainee.id
        assert req.scope_key == scene.enrollment.id
        assert req.required is True
        assert req.program_names == ["EMT Field Internship"]
        assert [t.id for t in req.templates] == [scene.template_id]

    async def test_a_program_without_a_form_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        scene.program.shift_evaluation_template_id = None
        await db_session.flush()

        assert await _requirements(db_session, scene) == []

    async def test_a_finished_enrollment_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        scene.enrollment.status = EnrollmentStatus.COMPLETED
        await db_session.flush()

        assert await _requirements(db_session, scene) == []

    async def test_a_declined_seat_is_not_crew(self, db_session):
        scene = await _scene(db_session)
        seat = (
            await db_session.execute(
                select(ShiftAssignment).where(
                    ShiftAssignment.shift_id == scene.shift.id,
                    ShiftAssignment.user_id == scene.trainee.id,
                )
            )
        ).scalar_one()
        seat.assignment_status = AssignmentStatus.DECLINED
        await db_session.flush()

        assert await _requirements(db_session, scene) == []

    async def test_two_programs_get_one_evaluation_each(self, db_session):
        scene = await _scene(db_session)
        driver_form = await _template(
            db_session, scene.org_id, scene.officer.id, "Driver Evaluation"
        )
        driver = await _program(
            db_session, scene.org_id, "Driver Candidate", driver_form.id
        )
        driver_enrollment = await _enroll(
            db_session, scene.org_id, scene.trainee, driver
        )

        reqs = await _requirements(db_session, scene)

        assert sorted(r.scope_key for r in reqs) == sorted(
            [scene.enrollment.id, driver_enrollment.id]
        )
        assert all(r.required for r in reqs)

    async def test_one_evaluation_can_count_for_both(self, db_session):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id,
                one_shift_evaluation_for_multiple_programs=True,
            )
        )
        driver_form = await _template(
            db_session, scene.org_id, scene.officer.id, "Driver Evaluation"
        )
        driver = await _program(
            db_session, scene.org_id, "Driver Candidate", driver_form.id
        )
        driver_enrollment = await _enroll(
            db_session, scene.org_id, scene.trainee, driver
        )

        reqs = await _requirements(db_session, scene)

        assert len(reqs) == 1
        req = reqs[0]
        assert req.scope_key == COMBINED_SCOPE
        assert sorted(req.enrollment_ids) == sorted(
            [scene.enrollment.id, driver_enrollment.id]
        )
        # Ordered by program name, so the officer's first choice is stable.
        assert [t.name for t in req.templates] == [
            "Driver Evaluation",
            "EMT Shift Evaluation",
        ]

    @pytest.mark.parametrize(
        ("mode", "required"), [("required", True), ("optional", False)]
    )
    async def test_the_general_form_by_seat(self, db_session, mode, required):
        scene = await _scene(db_session)
        general = await _template(
            db_session, scene.org_id, scene.officer.id, "General Evaluation"
        )
        general.evaluated_seats = ["driver"]
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id,
                general_shift_evaluation_template_id=general.id,
                general_shift_evaluation_mode=mode,
            )
        )
        await db_session.flush()

        reqs = {r.member.id: r for r in await _requirements(db_session, scene)}

        # The driver gets the general form; the trainee keeps the program's;
        # the officer's seat is not one the form evaluates.
        assert reqs[scene.crew.id].scope_key == GENERAL_SCOPE
        assert reqs[scene.crew.id].required is required
        assert reqs[scene.trainee.id].scope_key == scene.enrollment.id
        assert scene.officer.id not in reqs

    async def test_the_general_form_off_asks_for_nothing(self, db_session):
        scene = await _scene(db_session)
        general = await _template(
            db_session, scene.org_id, scene.officer.id, "General Evaluation"
        )
        general.evaluated_seats = ["driver"]
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id,
                general_shift_evaluation_template_id=general.id,
                general_shift_evaluation_mode="off",
            )
        )
        await db_session.flush()

        reqs = await _requirements(db_session, scene)

        assert [r.member.id for r in reqs] == [scene.trainee.id]


class TestSaving:
    async def _save(self, db, scene, body, evaluator=None):
        return await ShiftEvaluationService(db).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            body,
            evaluator or scene.officer,
        )

    async def test_a_draft_may_be_incomplete(self, db_session):
        scene = await _scene(db_session)

        evaluation = await self._save(
            db_session,
            scene,
            ShiftEvaluationSave(responses={"vital_signs": {"rating": 4}}),
        )

        assert evaluation.status == "draft"
        assert evaluation.submitted_at is None
        assert evaluation.responses == {
            "vital_signs": {"rating": 4, "not_applicable": False, "comment": None}
        }

    async def test_a_submission_must_be_complete(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(ValueError, match="Finish the evaluation first"):
            await self._save(
                db_session,
                scene,
                ShiftEvaluationSave(
                    responses={"vital_signs": {"rating": 4}}, submit=True
                ),
            )

    async def test_a_complete_submission_is_scored(self, db_session):
        scene = await _scene(db_session)
        body = _complete()
        body.responses["radio_report"].rating = 2
        body.responses["radio_report"].comment = "Practice MIST"
        body.responses["cpr_aed"].rating = None
        body.responses["cpr_aed"].not_applicable = True

        evaluation = await self._save(db_session, scene, body)

        assert evaluation.status == "submitted"
        assert evaluation.submitted_at is not None
        # 15 rated (one N/A): fourteen 3s and one 2.
        assert evaluation.rated_count == 15
        assert evaluation.average_rating == round((14 * 3 + 2) / 15, 2)
        assert evaluation.low_rating_count == 1
        assert evaluation.statistics == {"calls": 7, "transports": 4, "refusals": 2}
        assert evaluation.header_values == {"platoon": "B"}
        assert evaluation.unit_label is None
        assert evaluation.shift_date == scene.shift.shift_date

    async def test_a_low_rating_needs_a_comment(self, db_session):
        scene = await _scene(db_session)
        body = _complete()
        body.responses["uniform"].rating = 1

        with pytest.raises(ValueError, match="Add a comment for 'Uniform Appearance'"):
            await self._save(db_session, scene, body)

    async def test_an_always_commented_item_needs_its_comment(self, db_session):
        scene = await _scene(db_session)
        body = _complete()
        body.responses["als_assist"].comment = None

        with pytest.raises(ValueError, match="Add a comment for 'Assist with ALS"):
            await self._save(db_session, scene, body)

    async def test_transports_and_refusals_stay_within_the_calls(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(ValueError, match="cannot exceed the number of calls"):
            await self._save(
                db_session,
                scene,
                _complete(statistics={"calls": 3, "transports": 3, "refusals": 1}),
            )

    async def test_answers_the_form_does_not_ask_are_not_stored(self, db_session):
        scene = await _scene(db_session)
        body = _complete(
            header_values={"platoon": "B", "invented": "x"},
            statistics={"calls": 7, "transports": 4, "refusals": 2},
        )
        body.responses["invented_item"] = body.responses["crew"].model_copy()

        evaluation = await self._save(db_session, scene, body)

        assert "invented" not in evaluation.header_values
        assert "invented_item" not in evaluation.responses

    async def test_a_rating_off_the_scale_is_refused(self, db_session):
        scene = await _scene(db_session)
        body = _complete()
        body.responses["crew"].rating = 5

        with pytest.raises(ValueError, match="not a rating on this form"):
            await self._save(db_session, scene, body)

    async def test_a_choice_must_be_one_of_its_options(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(ValueError, match="not one of the choices"):
            await self._save(
                db_session, scene, _complete(header_values={"platoon": "D"})
            )

    async def test_nobody_evaluates_themselves(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(ValueError, match="cannot evaluate yourself"):
            await self._save(db_session, scene, _complete(), evaluator=scene.trainee)

    async def test_a_member_nobody_asked_about_is_refused(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(LookupError):
            await ShiftEvaluationService(db_session).save(
                scene.shift,
                scene.crew.id,
                GENERAL_SCOPE,
                scene.org_id,
                _complete(),
                scene.officer,
            )

    async def test_saving_twice_keeps_one_evaluation(self, db_session):
        scene = await _scene(db_session)

        first = await self._save(
            db_session, scene, ShiftEvaluationSave(responses={"crew": {"rating": 3}})
        )
        second = await self._save(db_session, scene, _complete())

        assert second.id == first.id
        count = (
            await db_session.execute(
                select(func.count(ShiftEvaluation.id)).where(
                    ShiftEvaluation.shift_id == scene.shift.id
                )
            )
        ).scalar_one()
        assert count == 1

    async def test_editing_the_form_later_leaves_the_evaluation_alone(self, db_session):
        scene = await _scene(db_session)
        evaluation = await self._save(db_session, scene, _complete())

        body = emt_shift_evaluation_example().model_dump()
        body["sections"][0]["items"][1]["label"] = "Vitals (renamed)"
        await ShiftEvaluationTemplateService(db_session).update_template(
            scene.template_id,
            scene.org_id,
            ShiftEvaluationTemplateWrite.model_validate(body),
            scene.officer.id,
        )
        await db_session.refresh(evaluation)

        labels = [
            i["label"] for i in evaluation.template_snapshot["sections"][0]["items"]
        ]
        assert "Vital Signs" in labels
        assert evaluation.template_version == 1


class TestCloseOut:
    async def test_a_missing_evaluation_blocks_close_out(self, db_session):
        # The report setting is off: the form on the program is the opt-in.
        scene = await _scene(db_session)

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )

        assert result is None
        assert error.startswith(
            "A shift evaluation is still needed for: "
            "Terry Member (EMT Field Internship)."
        )

    async def test_a_draft_does_not_count(self, db_session):
        scene = await _scene(db_session)
        await ShiftEvaluationService(db_session).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            ShiftEvaluationSave(responses={"crew": {"rating": 3}}),
            scene.officer,
        )

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )

        assert result is None
        assert "A shift evaluation is still needed" in error

    async def test_a_submitted_evaluation_lets_it_close(self, db_session):
        scene = await _scene(db_session)
        await ShiftEvaluationService(db_session).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(),
            scene.officer,
        )

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )

        assert error is None
        assert result is not None
        assert result.is_finalized is True

    async def test_the_admin_override_closes_it_anyway(self, db_session):
        scene = await _scene(db_session)

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id,
            scene.org_id,
            finalized_by_user_id=scene.officer.id,
            override_missing_reports=True,
        )

        assert error is None
        assert result is not None

    async def test_a_department_with_no_form_closes_as_before(self, db_session):
        scene = await _scene(db_session)
        scene.program.shift_evaluation_template_id = None
        await db_session.flush()

        result, error = await SchedulingService(db_session).finalize_shift(
            scene.shift.id, scene.org_id, finalized_by_user_id=scene.officer.id
        )

        assert error is None
        assert result is not None


class TestMemberVisibility:
    async def _submitted(self, db, scene):
        return await ShiftEvaluationService(db).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(),
            scene.officer,
        )

    async def test_seen_at_once_without_report_review(self, db_session):
        scene = await _scene(db_session)
        evaluation = await self._submitted(db_session, scene)
        service = ShiftEvaluationService(db_session)

        assert await service.visible_to_member(evaluation, scene.org_id) is True
        mine = await service.list_for_member(
            scene.trainee.id, scene.org_id, member_view=True
        )
        assert [e.id for e in mine] == [evaluation.id]

    async def test_a_draft_is_never_seen(self, db_session):
        scene = await _scene(db_session)
        draft = await ShiftEvaluationService(db_session).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            ShiftEvaluationSave(responses={"crew": {"rating": 3}}),
            scene.officer,
        )

        service = ShiftEvaluationService(db_session)
        assert await service.visible_to_member(draft, scene.org_id) is False
        assert (
            await service.list_for_member(
                scene.trainee.id, scene.org_id, member_view=True
            )
            == []
        )

    async def test_with_report_review_it_waits_for_the_approved_report(
        self, db_session
    ):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, report_review_required=True
            )
        )
        await db_session.flush()
        evaluation = await self._submitted(db_session, scene)
        service = ShiftEvaluationService(db_session)

        assert await service.visible_to_member(evaluation, scene.org_id) is False

        report = ShiftCompletionReport(
            id=str(uuid.uuid4()),
            organization_id=scene.org_id,
            shift_id=scene.shift.id,
            trainee_id=scene.trainee.id,
            officer_id=scene.officer.id,
            shift_date=scene.shift.shift_date,
            hours_on_shift=12.0,
            review_status="pending_review",
        )
        db_session.add(report)
        await db_session.flush()
        assert await service.visible_to_member(evaluation, scene.org_id) is False

        report.review_status = "approved"
        await db_session.flush()
        assert await service.visible_to_member(evaluation, scene.org_id) is True


class TestTenancy:
    async def test_another_departments_shift_is_not_found(self, db_session):
        scene = await _scene(db_session)
        other_org = await _org(db_session)

        assert (
            await ShiftEvaluationService(db_session).get_shift(
                scene.shift.id, other_org
            )
            is None
        )

    async def test_another_departments_evaluation_is_not_found(self, db_session):
        scene = await _scene(db_session)
        evaluation = await ShiftEvaluationService(db_session).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(),
            scene.officer,
        )
        other_org = await _org(db_session)
        service = ShiftEvaluationService(db_session)

        assert await service.get(evaluation.id, other_org) is None
        assert await service.list_for_member(scene.trainee.id, other_org) == []
