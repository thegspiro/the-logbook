"""Tests for training module configuration request and response schemas."""

from app.schemas.training_module_config import (
    TrainingModuleConfigResponse,
    TrainingModuleConfigUpdate,
)


def test_skills_result_visibility_fields_survive_update_parsing():
    """Confidentiality settings must reach the service instead of being dropped."""
    update = TrainingModuleConfigUpdate(
        skills_result_disclosure="none",
        skills_result_release="on_release",
    )

    assert update.model_dump(exclude_unset=True) == {
        "skills_result_disclosure": "none",
        "skills_result_release": "on_release",
    }


def test_skills_result_visibility_fields_are_in_config_response():
    """The config endpoint must return persisted confidentiality settings."""
    required_fields = {
        name: field
        for name, field in TrainingModuleConfigResponse.model_fields.items()
        if field.is_required()
    }
    response_data = {
        name: "test-id" if name in {"id", "organization_id"} else True
        for name in required_fields
    }
    response_data.update(
        skills_result_disclosure="scores",
        skills_result_release="on_release",
    )

    response = TrainingModuleConfigResponse.model_validate(response_data)

    assert response.skills_result_disclosure == "scores"
    assert response.skills_result_release == "on_release"


def test_null_skills_result_visibility_does_not_500_the_config_endpoint():
    """A row predating 20260807_0009's columns holds NULL for both.

    The response declares them as Literals with no None member, so before the
    coercion covered them a plain GET of the training module config answered
    500 with a ResponseValidationError — and so did every write, because the
    update handler returns the same model.
    """
    required_fields = {
        name: field
        for name, field in TrainingModuleConfigResponse.model_fields.items()
        if field.is_required()
    }
    response_data = {
        name: "test-id" if name in {"id", "organization_id"} else True
        for name in required_fields
    }
    response_data.update(
        skills_result_disclosure=None,
        skills_result_release=None,
    )

    response = TrainingModuleConfigResponse.model_validate(response_data)

    assert response.skills_result_disclosure == "full"
    assert response.skills_result_release == "on_completion"


def test_null_skills_result_visibility_is_coerced_from_an_orm_object():
    """The endpoint hands Pydantic the ORM row, not a dict — cover that path."""

    class Row:
        pass

    row = Row()
    for name, field in TrainingModuleConfigResponse.model_fields.items():
        if field.is_required():
            setattr(row, name, "test-id" if name in {"id", "organization_id"} else True)
    row.skills_result_disclosure = None
    row.skills_result_release = None

    response = TrainingModuleConfigResponse.model_validate(row, from_attributes=True)

    assert response.skills_result_disclosure == "full"
    assert response.skills_result_release == "on_completion"
