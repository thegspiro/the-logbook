"""Tests for the compartment storage container_type field.

Pure Pydantic-schema tests (no database) covering the default value and the
backward-compatibility coercion for rows created before the column existed.
"""

from app.schemas.equipment_check import (
    CheckTemplateCompartmentCreate,
    CheckTemplateCompartmentResponse,
    CheckTemplateCompartmentUpdate,
)


class TestContainerTypeSchemas:
    def test_create_defaults_to_compartment(self):
        payload = CheckTemplateCompartmentCreate(name="Cab")
        assert payload.container_type == "compartment"

    def test_create_accepts_preset(self):
        payload = CheckTemplateCompartmentCreate(name="Trauma", container_type="bag")
        assert payload.container_type == "bag"

    def test_create_accepts_custom_label(self):
        payload = CheckTemplateCompartmentCreate(
            name="Red Kit", container_type="Trauma Kit"
        )
        assert payload.container_type == "Trauma Kit"

    def test_update_container_type_optional(self):
        update = CheckTemplateCompartmentUpdate()
        assert update.container_type is None
        # Only explicitly-set fields are emitted, so an untouched
        # container_type is never sent to the service.
        assert "container_type" not in update.model_dump(exclude_unset=True)

    def test_response_coerces_null_container_type(self):
        # Rows created before the column existed read back as NULL.
        response = CheckTemplateCompartmentResponse.model_validate(
            {
                "id": "c1",
                "template_id": "t1",
                "name": "Legacy",
                "sort_order": 0,
                "container_type": None,
            }
        )
        assert response.container_type == "compartment"

    def test_response_preserves_container_type(self):
        response = CheckTemplateCompartmentResponse.model_validate(
            {
                "id": "c1",
                "template_id": "t1",
                "name": "Airway Bag",
                "sort_order": 0,
                "container_type": "bag",
            }
        )
        assert response.container_type == "bag"
