"""
Schemas for Scheduling Module Configuration (department-wide shift settings)

The wire shape mirrors the frontend's ``ShiftSettings`` interface exactly
(camelCase via ``to_camel``), so the settings that previously round-tripped
through localStorage round-trip through the API unchanged.
"""

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_camel_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


class CustomPositionSchema(BaseModel):
    model_config = _camel_config

    value: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=100)


class ApparatusTypeDefaultsSchema(BaseModel):
    model_config = _camel_config

    positions: List[str] = Field(..., max_length=50)
    min_staffing: int = Field(..., ge=0, le=100)


class ResourceTypeDefaultsSchema(BaseModel):
    model_config = _camel_config

    positions: List[str] = Field(..., max_length=50)
    label: str = Field(..., min_length=1, max_length=100)


class EquipmentCheckSettingsSchema(BaseModel):
    model_config = _camel_config

    enabled: bool
    require_signature: bool
    default_expiration_warning_days: int = Field(..., ge=1, le=365)
    block_shift_start_on_fail: bool


class ShiftSettingsSchema(BaseModel):
    """The full department-wide shift settings object.

    Used both as the PUT body and as the ``settings`` half of the GET
    response. All fields are required on purpose: the settings panel owns
    every field and sends the whole object on each save (see CLAUDE.md
    Pitfall #1 — an omitted field on an update silently keeps its stale
    value), so a partial-update schema would only invite that bug back.
    """

    model_config = _camel_config

    default_duration_hours: float = Field(..., gt=0, le=168)
    default_min_staffing: int = Field(..., ge=0, le=100)
    require_assignment_confirmation: bool
    overtime_threshold_hours_per_week: float = Field(..., ge=0, le=336)
    enabled_positions: List[str] = Field(..., max_length=100)
    custom_positions: List[CustomPositionSchema] = Field(..., max_length=100)
    apparatus_type_defaults: Dict[str, ApparatusTypeDefaultsSchema]
    resource_type_defaults: Dict[str, ResourceTypeDefaultsSchema]
    equipment_check_settings: EquipmentCheckSettingsSchema


class ShiftSettingsResponse(BaseModel):
    """GET response: effective settings plus whether the org has saved any.

    ``stored`` is False until the organization saves settings for the first
    time — the frontend uses it to run its one-time localStorage migration.
    """

    model_config = _camel_config

    settings: ShiftSettingsSchema
    stored: bool
    updated_by: Optional[str] = None
