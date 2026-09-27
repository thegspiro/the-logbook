"""
Schemas for shift hours a member worked outside the department's schedule.

Snake_case on the wire, matching the rest of ``/api/v1/scheduling``.
"""

from datetime import date, datetime
from typing import List, Optional

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
    agency_name: str = Field(..., min_length=1, max_length=255)
    apparatus: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("agency_name")
    @classmethod
    def _agency_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Agency name is required")
        return stripped

    @field_validator("apparatus", "role", "notes")
    @classmethod
    def _blank_is_absent(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class ExternalShiftHoursUpdate(BaseModel):
    """Partial update. An explicit null clears an optional field; a null for
    the date, hours or agency is refused by ``apply_updates`` as a 400."""

    shift_date: Optional[date] = None
    hours: Optional[float] = Field(None, gt=0, le=_MAX_HOURS)
    agency_name: Optional[str] = Field(None, min_length=1, max_length=255)
    apparatus: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("agency_name")
    @classmethod
    def _agency_not_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Agency name is required")
        return stripped

    @field_validator("apparatus", "role", "notes")
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
    agency_name: str
    apparatus: Optional[str] = None
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
