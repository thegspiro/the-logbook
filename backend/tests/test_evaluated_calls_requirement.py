"""The ``evaluated_calls`` requirement type (owner decision, 2026-11-14).

An evaluated-calls requirement counts the calls each submitted shift
evaluation records, against ``required_calls``, the way ``transports`` counts
the evaluation's transports. The ``calls`` type stays fed by shift reports,
so an evaluation must not credit it: a call on an evaluated shift would
otherwise count twice, once from the report and once from the evaluation.
"""

import pytest
from pydantic import ValidationError

from app.models.training import RequirementProgressStatus, RequirementType
from app.schemas.training import TrainingRequirementCreate, requirement_config_warning
from tests.test_shift_evaluation_credit import _requirement, _submit, _value
from tests.test_shift_evaluations import _scene

pytestmark = pytest.mark.integration


def _create(**fields) -> TrainingRequirementCreate:
    return TrainingRequirementCreate.model_validate(
        {"name": "Field internship calls", "frequency": "one_time", **fields}
    )


class TestCredit:
    async def test_a_submission_credits_the_calls_it_records(self, db_session):
        scene = await _scene(db_session)
        calls = await _requirement(
            db_session, scene, RequirementType.EVALUATED_CALLS, required_calls=14
        )

        # _complete() records 7 calls, 4 transports and 2 refusals.
        await _submit(db_session, scene)

        assert await _value(db_session, calls) == 7
        assert calls.progress_percentage == 50
        assert calls.status == RequirementProgressStatus.IN_PROGRESS

    async def test_the_target_is_met_by_the_calls_alone(self, db_session):
        scene = await _scene(db_session)
        calls = await _requirement(
            db_session, scene, RequirementType.EVALUATED_CALLS, required_calls=7
        )

        await _submit(db_session, scene)

        assert await _value(db_session, calls) == 7
        assert calls.status == RequirementProgressStatus.COMPLETED

    async def test_a_draft_credits_nothing(self, db_session):
        scene = await _scene(db_session)
        calls = await _requirement(
            db_session, scene, RequirementType.EVALUATED_CALLS, required_calls=14
        )

        await _submit(db_session, scene, submit=False)

        assert await _value(db_session, calls) == 0

    async def test_a_calls_requirement_is_left_to_shift_reports(self, db_session):
        scene = await _scene(db_session)
        reported = await _requirement(
            db_session, scene, RequirementType.CALLS, required_calls=14
        )

        await _submit(db_session, scene)

        assert await _value(db_session, reported) == 0


class TestSchema:
    def test_the_type_takes_its_target_in_required_calls(self):
        created = _create(requirement_type="evaluated_calls", required_calls=25)

        assert created.required_calls == 25
        assert requirement_config_warning(created) is None

    def test_the_type_is_refused_without_a_target(self):
        with pytest.raises(ValidationError, match="required_calls"):
            _create(requirement_type="evaluated_calls")
