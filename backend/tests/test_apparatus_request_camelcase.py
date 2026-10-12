"""
Apparatus request bodies are accepted in camelCase as well as snake_case.

The apparatus modals build their request bodies from the camelCase types in
``frontend/src/modules/apparatus/types``, and ``createApiClient`` does no key
transformation. The main apparatus, status-change, archive, EVOC, driver
exception and NFPA schemas always carried ``alias_generator=to_camel``; the
sub-resource schemas did not, so an operator, equipment, maintenance or fuel-log
create came back 422 for "missing" required fields and an operator, equipment
or maintenance update returned 200 having silently dropped every multi-word key.

These tests pin the fix three ways:

* a router-wide guard: every body model the apparatus router accepts, and every
  model nested inside one, takes each multi-word field under its camelCase key;
* per-schema round trips: camelCase and snake_case bodies validate to the same
  model, and dump to the snake_case keys the service layer reads;
* the update semantics of CLAUDE.md #1 survive: an explicit camelCase null is
  kept under ``exclude_unset`` (so it clears), an omitted key is not.

The HTTP-level counterpart is ``test_apparatus_request_camelcase_db.py``.
"""

import types
import typing

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError
from pydantic.alias_generators import to_camel

from app.api.v1.endpoints import apparatus as apparatus_endpoints
from app.schemas import apparatus as apparatus_schemas
from app.schemas.apparatus import (
    ApparatusComponentCreate,
    ApparatusComponentNoteCreate,
    ApparatusComponentNoteUpdate,
    ApparatusComponentUpdate,
    ApparatusCustomFieldCreate,
    ApparatusCustomFieldUpdate,
    ApparatusDocumentCreate,
    ApparatusEquipmentCreate,
    ApparatusEquipmentUpdate,
    ApparatusFuelLogCreate,
    ApparatusMaintenanceCreate,
    ApparatusMaintenanceResponse,
    ApparatusMaintenanceTypeCreate,
    ApparatusMaintenanceTypeUpdate,
    ApparatusMaintenanceUpdate,
    ApparatusOperatorCreate,
    ApparatusOperatorResponse,
    ApparatusOperatorUpdate,
    ApparatusPhotoCreate,
    ApparatusReportConfigCreate,
    ApparatusReportConfigUpdate,
    ApparatusServiceProviderCreate,
    ApparatusServiceProviderUpdate,
    ApparatusStatusCreate,
    ApparatusStatusUpdate,
    ApparatusTypeCreate,
    ApparatusTypeUpdate,
    FileAttachment,
    FileAttachmentInput,
    OperatorRestriction,
    OperatorRestrictionInput,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Router-wide guard
# ---------------------------------------------------------------------------


def _models_in(annotation) -> set[type[BaseModel]]:
    """Every BaseModel reachable from a type annotation (Optional, List, ...)."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return {annotation}
    found: set[type[BaseModel]] = set()
    for arg in typing.get_args(annotation):
        found |= _models_in(arg)
    return found


def _body_models_with_nested() -> set[type[BaseModel]]:
    pending: list[type[BaseModel]] = []
    for route in apparatus_endpoints.router.routes:
        if not isinstance(route, APIRoute):
            continue
        for param in route.dependant.body_params:
            pending.extend(_models_in(param.field_info.annotation))
    seen: set[type[BaseModel]] = set()
    while pending:
        model = pending.pop()
        if model in seen:
            continue
        seen.add(model)
        for field in model.model_fields.values():
            pending.extend(_models_in(field.annotation))
    return seen


BODY_MODELS = sorted(_body_models_with_nested(), key=lambda m: m.__name__)


def _accepts_camel_key(model: type[BaseModel], name: str) -> bool:
    field = model.model_fields[name]
    accepted = {field.alias, name if _accepts_field_name(model) else None}
    validation_alias = field.validation_alias
    if isinstance(validation_alias, str):
        accepted.add(validation_alias)
    elif validation_alias is not None and hasattr(validation_alias, "choices"):
        accepted.update(c for c in validation_alias.choices if isinstance(c, str))
    return to_camel(name) in accepted


def _accepts_field_name(model: type[BaseModel]) -> bool:
    config = model.model_config
    if config.get("validate_by_name") or config.get("populate_by_name"):
        return True
    # With no alias at all, the field name is the only accepted key.
    return all(f.alias is None for f in model.model_fields.values())


class TestEveryApparatusBodyModelTakesCamelCase:
    def test_the_walk_finds_the_models_this_fix_is_about(self):
        # Guards the guard: if the router walk stopped reaching the body
        # models (a FastAPI internals change, say) every check below would
        # pass vacuously.
        assert {
            ApparatusOperatorCreate,
            ApparatusOperatorUpdate,
            OperatorRestrictionInput,
            ApparatusEquipmentCreate,
            ApparatusEquipmentUpdate,
            ApparatusMaintenanceCreate,
            ApparatusMaintenanceUpdate,
            FileAttachmentInput,
            ApparatusFuelLogCreate,
        } <= set(BODY_MODELS)

    @pytest.mark.parametrize("model", BODY_MODELS, ids=lambda m: m.__name__)
    def test_every_multi_word_field_accepts_its_camelcase_key(self, model):
        missing = [
            name
            for name in model.model_fields
            if "_" in name and not _accepts_camel_key(model, name)
        ]
        assert not missing, (
            f"{model.__name__} ignores the camelCase key for {missing}; the "
            "frontend sends camelCase, so a create 422s and an update drops "
            "the field. Give the model _REQUEST_CONFIG."
        )

    @pytest.mark.parametrize("model", BODY_MODELS, ids=lambda m: m.__name__)
    def test_every_body_model_still_accepts_snake_case(self, model):
        assert _accepts_field_name(model), model.__name__


# ---------------------------------------------------------------------------
# Per-schema round trips
# ---------------------------------------------------------------------------

_ATTACHMENT = {
    "file_path": "apparatus/e1/invoice.pdf",
    "file_name": "invoice.pdf",
    "mime_type": "application/pdf",
}
_RESTRICTION = {"type": "weather", "description": "No ice", "is_active": False}

_TYPE = {
    "name": "Tanker",
    "code": "TNK",
    "description": "d",
    "category": "fire",
    "icon": "truck",
    "color": "red",
    "sort_order": 4,
    "is_active": False,
}
_STATUS = {
    "name": "Reserve",
    "code": "RSV",
    "description": "d",
    "is_available": False,
    "is_operational": False,
    "requires_reason": True,
    "is_archived_status": True,
    "color": "grey",
    "icon": "pause",
    "sort_order": 3,
    "is_active": False,
}
_CUSTOM_FIELD = {
    "name": "Pump GPM",
    "field_key": "pump_gpm",
    "description": "d",
    "field_type": "number",
    "is_required": True,
    "default_value": "1500",
    "placeholder": "GPM",
    "options": [{"value": "a", "label": "A"}],
    "min_value": "0",
    "max_value": "3000",
    "min_length": 1,
    "max_length": 5,
    "regex_pattern": "^[0-9]+$",
    "applies_to_types": ["engine"],
    "sort_order": 2,
    "show_in_list": True,
    "show_in_detail": False,
    "is_active": False,
}
_MAINTENANCE_TYPE = {
    "name": "Pump test",
    "code": "PT",
    "description": "d",
    "category": "inspection",
    "default_interval_value": 1,
    "default_interval_unit": "years",
    "default_interval_miles": 10000,
    "default_interval_hours": 500,
    "is_nfpa_required": True,
    "nfpa_reference": "NFPA 1911",
    "applies_to_types": ["engine"],
    "sort_order": 1,
    "is_active": False,
}
_MAINTENANCE_FIELDS = {
    "maintenance_type_id": "mt-1",
    "component_id": "comp-1",
    "service_provider_id": "sp-1",
    "scheduled_date": "2026-03-01",
    "due_date": "2026-03-05",
    "completed_date": "2026-03-04",
    "performed_by": "County Fleet",
    "description": "d",
    "work_performed": "w",
    "findings": "f",
    "mileage_at_service": 41200,
    "hours_at_service": "1820.5",
    "cost": "650.00",
    "vendor": "v",
    "invoice_number": "INV-77",
    "next_due_date": "2027-03-04",
    "next_due_mileage": 46000,
    "next_due_hours": "2000",
    "notes": "n",
    "attachments": [dict(_ATTACHMENT)],
    "occurred_date": "2026-03-04",
    "historic_source": "Paper logbook",
}
_OPERATOR_FIELDS = {
    "evoc_level_id": "evoc-1",
    "is_certified": False,
    "certification_date": "2026-01-15",
    "certification_expiration": "2028-01-15",
    "license_type_required": "CDL-B",
    "license_verified": True,
    "license_verified_date": "2026-01-20",
    "has_restrictions": True,
    "restrictions": [dict(_RESTRICTION)],
    "restriction_notes": "Daylight only",
    "is_active": False,
    "notes": "n",
}
_EQUIPMENT_FIELDS = {
    "inventory_item_id": "inv-1",
    "name": "TIC",
    "description": "d",
    "quantity": 2,
    "location_on_apparatus": "Cab",
    "is_mounted": True,
    "is_required": True,
    "serial_number": "SN-1",
    "asset_tag": "A-1",
    "is_present": False,
    "notes": "n",
}
_FILE_FIELDS = {
    "apparatus_id": "app-1",
    "description": "d",
    "file_path": "apparatus/e1/x",
    "file_name": "x",
    "file_size": 1024,
    "mime_type": "image/jpeg",
}
_REPORT_CONFIG = {
    "name": "Monthly fleet",
    "description": "d",
    "report_type": "fleet_status",
    "is_scheduled": True,
    "schedule_frequency": "monthly",
    "schedule_day": 1,
    "data_range_type": "last_n_days",
    "data_range_days": 30,
    "include_apparatus_ids": ["app-1"],
    "include_type_ids": ["type-1"],
    "include_status_ids": ["status-1"],
    "include_archived": True,
    "fields_to_include": ["unit_number"],
    "group_by": "type",
    "sort_by": "unit_number",
    "sort_direction": "desc",
    "output_format": "csv",
    "email_recipients": ["chief@example.com"],
    "is_active": False,
}
_PROVIDER = {
    "name": "County Fleet",
    "company_name": "County Fleet LLC",
    "contact_name": "Pat",
    "phone": "555-0100",
    "email": "pat@example.com",
    "address": "1 Depot Rd",
    "city": "Town",
    "state": "NY",
    "zip_code": "12345",
    "website": "https://example.com",
    "specialties": ["engine"],
    "certifications": ["EVT"],
    "is_emergency_service": True,
    "license_number": "L-1",
    "insurance_info": "i",
    "tax_id": "T-1",
    "is_preferred": True,
    "rating": 4,
    "notes": "n",
    "contract_info": "c",
    "is_active": False,
}
_COMPONENT_FIELDS = {
    "name": "Main pump",
    "component_type": "pump",
    "description": "d",
    "manufacturer": "Hale",
    "model_number": "QMAX",
    "serial_number": "SN-2",
    "install_date": "2020-01-01",
    "warranty_expiration": "2027-01-01",
    "expected_life_years": 20,
    "condition": "fair",
    "last_serviced_date": "2026-01-01",
    "last_inspected_date": "2026-02-01",
    "notes": "n",
    "sort_order": 1,
    "is_active": False,
}
_NOTE_FIELDS = {
    "title": "Seal weeping",
    "description": "Drip at the packing",
    "note_type": "issue",
    "severity": "medium",
    "status": "in_progress",
    "service_provider_id": "sp-1",
    "estimated_cost": "120.00",
    "actual_cost": "110.00",
    "resolution_notes": "r",
    "attachments": [dict(_ATTACHMENT)],
    "tags": ["pump"],
}

# One snake_case body per changed request schema, every multi-word field given
# a non-default value — a dropped camelCase key then shows up as a difference
# in the dump rather than hiding behind the field's default.
SNAKE_BODIES: dict[type[BaseModel], dict] = {
    ApparatusTypeCreate: dict(_TYPE),
    ApparatusTypeUpdate: dict(_TYPE),
    ApparatusStatusCreate: dict(_STATUS),
    ApparatusStatusUpdate: dict(_STATUS),
    ApparatusCustomFieldCreate: dict(_CUSTOM_FIELD),
    ApparatusCustomFieldUpdate: dict(_CUSTOM_FIELD),
    ApparatusMaintenanceTypeCreate: dict(_MAINTENANCE_TYPE),
    ApparatusMaintenanceTypeUpdate: dict(_MAINTENANCE_TYPE),
    ApparatusMaintenanceCreate: {
        **_MAINTENANCE_FIELDS,
        "apparatus_id": "app-1",
        "is_completed": True,
        "is_historic": True,
    },
    ApparatusMaintenanceUpdate: {**_MAINTENANCE_FIELDS, "is_completed": True},
    ApparatusFuelLogCreate: {
        "apparatus_id": "app-1",
        "fuel_date": "2026-04-02T14:30:00Z",
        "fuel_type": "diesel",
        "gallons": "42.5",
        "price_per_gallon": "4.10",
        "total_cost": "174.25",
        "mileage_at_fill": 41300,
        "hours_at_fill": "1825",
        "is_full_tank": False,
        "station_name": "County Depot",
        "station_address": "1 Depot Rd",
        "notes": "n",
    },
    ApparatusOperatorCreate: {
        **_OPERATOR_FIELDS,
        "apparatus_id": "app-1",
        "user_id": "user-1",
    },
    ApparatusOperatorUpdate: dict(_OPERATOR_FIELDS),
    ApparatusEquipmentCreate: {**_EQUIPMENT_FIELDS, "apparatus_id": "app-1"},
    ApparatusEquipmentUpdate: dict(_EQUIPMENT_FIELDS),
    ApparatusPhotoCreate: {
        **_FILE_FIELDS,
        "title": "Officer side",
        "taken_at": "2026-04-02T14:30:00Z",
        "photo_type": "exterior",
        "is_primary": True,
    },
    ApparatusDocumentCreate: {
        **_FILE_FIELDS,
        "title": "Registration",
        "document_type": "registration",
        "expiration_date": "2027-04-01",
        "document_date": "2026-04-01",
    },
    ApparatusReportConfigCreate: dict(_REPORT_CONFIG),
    ApparatusReportConfigUpdate: dict(_REPORT_CONFIG),
    ApparatusServiceProviderCreate: dict(_PROVIDER),
    ApparatusServiceProviderUpdate: dict(_PROVIDER),
    ApparatusComponentCreate: {**_COMPONENT_FIELDS, "apparatus_id": "app-1"},
    ApparatusComponentUpdate: dict(_COMPONENT_FIELDS),
    ApparatusComponentNoteCreate: {
        **_NOTE_FIELDS,
        "component_id": "comp-1",
        "apparatus_id": "app-1",
    },
    ApparatusComponentNoteUpdate: dict(_NOTE_FIELDS),
    FileAttachmentInput: dict(_ATTACHMENT),
    OperatorRestrictionInput: dict(_RESTRICTION),
}

REQUEST_SCHEMAS = list(SNAKE_BODIES)


def _camelize(value):
    if isinstance(value, dict):
        return {to_camel(k): _camelize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_camelize(v) for v in value]
    return value


class TestEveryChangedSchemaRoundTrips:
    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_camel_and_snake_bodies_validate_identically(self, schema):
        snake = SNAKE_BODIES[schema]
        from_snake = schema.model_validate(snake)
        from_camel = schema.model_validate(_camelize(snake))

        assert from_camel.model_dump() == from_snake.model_dump()
        assert from_camel.model_fields_set == from_snake.model_fields_set
        # Every key in the body landed on a field; none was ignored as extra.
        assert from_snake.model_fields_set == set(snake)

    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_dump_keys_stay_snake_case_for_the_service_layer(self, schema):
        dumped = schema.model_validate(_camelize(SNAKE_BODIES[schema])).model_dump()
        assert set(dumped) == set(schema.model_fields)

    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_validation_errors_still_name_the_snake_case_field(self, schema):
        # loc_by_alias=False: 422 field names are what they were before the
        # alias was added, so nothing reading them changes.
        assert schema.model_config.get("loc_by_alias") is False

    def test_every_create_and_update_schema_in_the_module_takes_camelcase(self):
        # A request schema added later without the config reintroduces the bug
        # for its own endpoint, even before any route uses it.
        unaliased = sorted(
            obj.__name__
            for obj in vars(apparatus_schemas).values()
            if isinstance(obj, type)
            and issubclass(obj, BaseModel)
            and obj.__module__ == apparatus_schemas.__name__
            and obj.__name__.endswith(("Create", "Update"))
            and obj.model_config.get("alias_generator") is not to_camel
        )
        assert unaliased == []


class TestTheExactModalBodies:
    """The keys each modal sends, which each schema used to ignore."""

    def test_operator_modal_create_body(self):
        op = ApparatusOperatorCreate.model_validate(
            {
                "apparatusId": "app-1",
                "userId": "user-1",
                "evocLevelId": "evoc-1",
                "isCertified": True,
                "licenseVerified": True,
                "hasRestrictions": True,
                "isActive": True,
                "certificationDate": "2026-01-15",
                "certificationExpiration": "2028-01-15",
                "licenseTypeRequired": "CDL-B",
                "licenseVerifiedDate": "2026-01-20",
                "restrictionNotes": "Daylight only",
                "notes": "n",
            }
        )
        assert op.apparatus_id == "app-1"
        assert op.user_id == "user-1"
        assert op.license_type_required == "CDL-B"
        assert op.restriction_notes == "Daylight only"

    def test_fuel_log_modal_body(self):
        log = ApparatusFuelLogCreate.model_validate(
            {
                "apparatusId": "app-1",
                "fuelDate": "2026-04-02T14:30",
                "fuelType": "diesel",
                "gallons": 42.5,
                "mileageAtFill": 41300,
                "isFullTank": False,
                "stationName": "County Depot",
            }
        )
        assert log.apparatus_id == "app-1"
        assert log.mileage_at_fill == 41300
        assert log.is_full_tank is False
        assert log.station_name == "County Depot"

    def test_maintenance_modal_update_body_ignores_apparatus_id(self):
        # The modal sends its create-shaped payload to the update endpoint too.
        upd = ApparatusMaintenanceUpdate.model_validate(
            {"apparatusId": "app-1", "workPerformed": "w", "isCompleted": True}
        )
        assert upd.model_dump(exclude_unset=True) == {
            "work_performed": "w",
            "is_completed": True,
        }


class TestUpdateSemanticsSurviveTheAlias:
    """Omitted means leave alone; explicit null means clear (CLAUDE.md #1)."""

    @pytest.mark.parametrize(
        ("schema", "camel_key", "field"),
        [
            (ApparatusOperatorUpdate, "restrictionNotes", "restriction_notes"),
            (ApparatusOperatorUpdate, "evocLevelId", "evoc_level_id"),
            (ApparatusEquipmentUpdate, "serialNumber", "serial_number"),
            (ApparatusEquipmentUpdate, "locationOnApparatus", "location_on_apparatus"),
            (ApparatusMaintenanceUpdate, "invoiceNumber", "invoice_number"),
            (ApparatusMaintenanceUpdate, "nextDueDate", "next_due_date"),
            (ApparatusComponentUpdate, "warrantyExpiration", "warranty_expiration"),
            (ApparatusServiceProviderUpdate, "zipCode", "zip_code"),
        ],
    )
    def test_camelcase_explicit_null_is_kept_under_exclude_unset(
        self, schema, camel_key, field
    ):
        dumped = schema.model_validate({camel_key: None}).model_dump(exclude_unset=True)
        assert dumped == {field: None}

    def test_omitted_key_is_absent_under_exclude_unset(self):
        dumped = ApparatusEquipmentUpdate.model_validate({"name": "TIC"}).model_dump(
            exclude_unset=True
        )
        assert dumped == {"name": "TIC"}


class TestValidationStillRuns:
    def test_a_required_camelcase_field_missing_is_named_snake_case(self):
        with pytest.raises(ValidationError) as exc:
            ApparatusFuelLogCreate.model_validate(
                {"apparatusId": "app-1", "fuelType": "diesel", "gallons": 1}
            )
        assert [e["loc"] for e in exc.value.errors()] == [("fuel_date",)]

    def test_a_constraint_on_a_camelcase_field_still_applies(self):
        with pytest.raises(ValidationError) as exc:
            ApparatusEquipmentUpdate.model_validate({"locationOnApparatus": "x" * 201})
        assert exc.value.errors()[0]["loc"] == ("location_on_apparatus",)


class TestResponsesAreUnchanged:
    """The nested request models are subclasses so the response shape is not
    touched: stored attachments and restrictions still serialize as they did."""

    def test_response_models_still_embed_the_unaliased_nested_models(self):
        assert _models_in(
            ApparatusMaintenanceResponse.model_fields["attachments"].annotation
        ) == {FileAttachment}
        assert _models_in(
            ApparatusOperatorResponse.model_fields["restrictions"].annotation
        ) == {OperatorRestriction}

    def test_stored_attachment_serializes_snake_case_by_alias(self):
        dumped = FileAttachment.model_validate(_ATTACHMENT).model_dump(by_alias=True)
        assert dumped == _ATTACHMENT

    def test_the_response_config_is_not_the_request_config(self):
        # The request config sits on Create/Update, not on the *Base classes
        # the responses inherit, so loc_by_alias did not leak into responses.
        for response in (ApparatusMaintenanceResponse, ApparatusOperatorResponse):
            assert "loc_by_alias" not in response.model_config


def test_union_annotations_are_walked():
    # _models_in must see through `X | None` as well as Optional[X], or a body
    # declared with PEP 604 syntax would escape the router guard.
    assert _models_in(FileAttachmentInput | None) == {FileAttachmentInput}
    assert _models_in(typing.Optional[list[FileAttachmentInput]]) == {
        FileAttachmentInput
    }
    assert isinstance(FileAttachmentInput | None, types.UnionType)
