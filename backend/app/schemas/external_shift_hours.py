"""
Schemas for shift hours a member worked outside the department's schedule.

Snake_case on the wire, matching the rest of ``/api/v1/scheduling``.
"""

from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.external_shift_hours import MAX_EXTERNAL_SHIFT_MINUTES
from app.schemas.base import UTCResponseBase

_MAX_HOURS = MAX_EXTERNAL_SHIFT_MINUTES / 60


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Read an offset-less datetime as UTC and convert an aware one to it.

    Mixing the two in one comparison raises ``TypeError``, which Pydantic does
    not turn into a 422; and the driver stores an aware value by its wall
    clock, dropping the offset, so it must reach the model already in UTC.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _check_span(start_at: Optional[datetime], end_at: Optional[datetime]) -> None:
    if (start_at is None) != (end_at is None):
        raise ValueError("Send both a start and an end time")
    if start_at is None or end_at is None:
        return
    if end_at <= start_at:
        raise ValueError("The shift must end after it starts")
    if (end_at - start_at).total_seconds() > MAX_EXTERNAL_SHIFT_MINUTES * 60:
        raise ValueError(
            f"One entry can cover at most {int(_MAX_HOURS)} hours; "
            "log a longer stretch as the shifts it was"
        )


def _strip_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class ExternalShiftHoursCreate(BaseModel):
    """A shift is given either by its start and end, from which the date and
    hours are derived, or — as clients written before the times existed
    still send — by a date and an hours figure. Never both, so there is no
    question of which one the entry counts by."""

    shift_date: Optional[date] = None
    hours: Optional[float] = Field(None, gt=0, le=_MAX_HOURS)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    # A unit from the officer-maintained list; the agency is the unit's.
    external_apparatus_id: UUID
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("role", "notes")
    @classmethod
    def _blank_is_absent(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)

    @field_validator("start_at", "end_at")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)

    @model_validator(mode="after")
    def _one_way_of_giving_the_shift(self) -> "ExternalShiftHoursCreate":
        _check_span(self.start_at, self.end_at)
        if self.start_at is not None:
            if self.shift_date is not None or self.hours is not None:
                raise ValueError(
                    "Send either start and end times, or a date and hours, not both"
                )
        elif self.shift_date is None or self.hours is None:
            raise ValueError("Send the shift's start and end times")
        return self


class ExternalShiftHoursUpdate(BaseModel):
    """Partial update. An explicit null clears an optional field; a null for
    the date, hours, times or apparatus is refused as a 400.

    The start and end travel together, and not beside a date or hours."""

    shift_date: Optional[date] = None
    hours: Optional[float] = Field(None, gt=0, le=_MAX_HOURS)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    external_apparatus_id: Optional[UUID] = None
    role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("role", "notes")
    @classmethod
    def _blank_is_absent(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)

    @field_validator("start_at", "end_at")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)

    @model_validator(mode="after")
    def _times_are_a_valid_pair(self) -> "ExternalShiftHoursUpdate":
        if self.start_at is not None and self.end_at is not None:
            _check_span(self.start_at, self.end_at)
        return self


class ExternalShiftHoursReject(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("A reason is required")
        return stripped


class ExternalShiftHoursResponse(UTCResponseBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    member_name: Optional[str] = None
    shift_date: date
    hours: float
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
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
