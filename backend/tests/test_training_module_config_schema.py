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
