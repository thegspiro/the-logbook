"""
Schemas for shift hours a member worked outside the department's schedule.

Snake_case on the wire, matching the rest of ``/api/v1/scheduling``.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.external_shift_hours import MAX_EXTERNAL_SHIFT_MINUTES

_MAX_HOURS = MAX_EXTERNAL_SHIFT_MINUTES / 60


def _strip_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class ExternalShiftHoursCreate(BaseModel):
    shift_date: date
    hours: float = Field(..., gt=0, le=_MAX_HOURS)
    # A unit from the officer-maintained list; the agency is the unit's.
    external_apparatus_id: UUID
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("role", "notes")
    @classmethod
    def _blank_is_absent(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class ExternalShiftHoursUpdate(BaseModel):
    """Partial update. An explicit null clears an optional field; a null for
    the date, hours or apparatus is refused as a 400."""

    shift_date: Optional[date] = None
    hours: Optional[float] = Field(None, gt=0, le=_MAX_HOURS)
    external_apparatus_id: Optional[UUID] = None
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("role", "notes")
    @classmethod
    def _blank_is_absent(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class ExternalShiftHoursReject(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("A reason is required")
        return stripped


class ExternalShiftHoursResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    member_name: Optional[str] = None
    shift_date: date
    hours: float
    external_apparatus_id: Optional[str] = None
    agency_name: str
    apparatus_name: str
    role: Optional[str] = None
    notes: Optional[str] = None
    status: str
    reviewed_by: Optional[str] = None
    reviewer_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ExternalShiftHoursListResponse(BaseModel):
    items: List[ExternalShiftHoursResponse]
    total: int


# ---------------------------------------------------------------------------
# The officer-maintained list of outside agencies and apparatus
# ---------------------------------------------------------------------------


def _required_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        raise ValueError("A name is required")
    return stripped


class ExternalAgencyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _required_name(value) or ""


class ExternalAgencyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: Optional[str]) -> Optional[str]:
        return _required_name(value)


class ExternalApparatusCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    apparatus_type: Optional[str] = Field(None, max_length=50)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _required_name(value) or ""

    @field_validator("apparatus_type")
    @classmethod
    def _type(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class ExternalApparatusUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    apparatus_type: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: Optional[str]) -> Optional[str]:
        return _required_name(value)

    @field_validator("apparatus_type")
    @classmethod
    def _type(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class ExternalApparatusResponse(BaseModel):
    id: str
    agency_id: str
    name: str
    apparatus_type: Optional[str] = None
    is_active: bool


class ExternalAgencyResponse(BaseModel):
    id: str
    name: str
    is_active: bool
    apparatus: List[ExternalApparatusResponse] = []


class ExternalAgencyListResponse(BaseModel):
    agencies: List[ExternalAgencyResponse]


class ExternalApparatusSummaryRow(BaseModel):
    external_apparatus_id: Optional[str] = None
    agency_name: str
    apparatus_name: str
    apparatus_type: Optional[str] = None
    shifts: int
    minutes: int
    hours: float
    members: int


class ExternalApparatusSummaryResponse(BaseModel):
    rows: List[ExternalApparatusSummaryRow]
    period_start: str
    period_end: str
