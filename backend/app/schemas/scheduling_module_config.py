"""
Schemas for Scheduling Module Configuration (department-wide shift settings)

The wire shape mirrors the frontend's ``ShiftSettings`` interface exactly
(camelCase via ``to_camel``), so the settings that previously round-tripped
through localStorage round-trip through the API unchanged.
"""

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.services.qualification_service import (
    QUALIFICATIONS,
    known_qualification_codes,
)

_camel_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


class CustomPositionSchema(BaseModel):
    model_config = _camel_config

    value: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=100)
    # A seat that drives the apparatus gets the same EVOC check as the built-in
    # driver seat. Optional so a payload saved before the flag still validates.
    drives_apparatus: bool = False
    # Certifications that clear a member for this seat, as qualification codes
    # (``QUALIFICATIONS``). Optional for the same reason as the flag above; an
    # entry without it is a seat no certification confers.
    qualifications: List[str] = Field(default_factory=list, max_length=50)

    @field_validator("qualifications")
    @classmethod
    def _known_qualifications(cls, codes: List[str]) -> List[str]:
        """Refuse a code nobody defined, then settle the canonical shape.

        The qualification vocabulary is the system's, not per department, so
        "belongs to the organization" for a certification means "is one this
        installation knows" — a code outside it would confer nothing and
        save as a promise that never applies (Pitfall #19).
        """
        unknown = sorted({c.strip() for c in codes} - set(QUALIFICATIONS))
        if unknown:
            raise ValueError(
                f"Unknown qualification: {', '.join(unknown)}. "
                f"Known: {', '.join(sorted(QUALIFICATIONS))}."
            )
        return known_qualification_codes(codes)


class ApparatusTypeDefaultsSchema(BaseModel):
    model_config = _camel_config

    positions: List[str] = Field(..., max_length=50)
    min_staffing: int = Field(..., ge=0, le=100)


class ResourceTypeDefaultsSchema(BaseModel):
    model_config = _camel_config

    positions: List[str] = Field(..., max_length=50)
    label: str = Field(..., min_length=1, max_length=100)


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


class ShiftSettingsResponse(BaseModel):
    """GET response: effective settings plus whether the org has saved any.

    ``stored`` is False until the organization saves settings for the first
    time — the frontend uses it to run its one-time localStorage migration.
    """

    model_config = _camel_config

    settings: ShiftSettingsSchema
    stored: bool
    updated_by: Optional[str] = None
