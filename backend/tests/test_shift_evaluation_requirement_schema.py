"""The shift-evaluation requirement types at the request boundary."""

import pytest
from pydantic import ValidationError

from app.models.training import RequirementType as ModelRequirementType
from app.schemas.training import (
    RequirementType,
    TrainingRequirementCreate,
    TrainingRequirementUpdate,
    requirement_config_warning,
)

pytestmark = pytest.mark.unit


def _create(**fields) -> TrainingRequirementCreate:
    return TrainingRequirementCreate.model_validate(
        {"name": "Field internship", "frequency": "one_time", **fields}
    )


class TestTargets:
    @pytest.mark.parametrize(
        ("requirement_type", "target"),
        [
            ("evaluated_shifts", "required_shifts"),
            ("transports", "required_transports"),
            ("refusals", "required_refusals"),
        ],
    )
    def test_each_type_needs_its_own_count(self, requirement_type, target):
        with pytest.raises(ValidationError, match=target):
            _create(requirement_type=requirement_type)

        created = _create(requirement_type=requirement_type, **{target: 10})

        assert getattr(created, target) == 10
        assert requirement_config_warning(created) is None

    def test_a_negative_count_is_refused(self):
        with pytest.raises(ValidationError):
            _create(requirement_type="transports", required_transports=-1)

    def test_the_lowest_rating_rule_defaults_off(self):
        created = _create(requirement_type="evaluated_shifts", required_shifts=10)

        assert created.evaluation_excludes_lowest_rating is False

    def test_the_lowest_rating_rule_cannot_be_cleared_to_null(self):
        with pytest.raises(ValidationError):
            TrainingRequirementUpdate.model_validate(
                {"evaluation_excludes_lowest_rating": None}
            )


def test_the_schema_and_model_enums_agree():
    assert {t.value for t in RequirementType} == {t.value for t in ModelRequirementType}
