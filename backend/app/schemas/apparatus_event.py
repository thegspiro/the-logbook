"""
Apparatus event schemas.

Snake_case on the wire, like the rest of the events module (no
``alias_generator``), so ``frontend/src/types/apparatusEvent.ts`` mirrors the
attribute names exactly.
"""

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.apparatus_event import (
    ApparatusEventEvocMode,
    ApparatusEventSeatMethod,
    ApparatusEventSeatType,
)
from app.models.event import EventType
from app.schemas.base import UTCResponseBase

# A night is one evening out; a run longer than this is a data-entry slip.
MAX_NIGHT_MINUTES = 24 * 60
MAX_UNITS = 10
MAX_SEATS_PER_SEAT_ROW = 20
# The whole crew on one night. Generous for a parade, and small enough that a
# typo in a count cannot create hundreds of seats.
MAX_TOTAL_SEATS = 60
MAX_NIGHTS = 60

_HHMM = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


class TemplateSeatSpec(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    seat_type: ApparatusEventSeatType = ApparatusEventSeatType.GENERAL
    count: int = Field(1, ge=1, le=MAX_SEATS_PER_SEAT_ROW)
    note: Optional[str] = Field(None, max_length=300)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Seat name is required")
        return stripped

    @field_validator("note")
    @classmethod
    def _note(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)


class TemplateUnitSpec(BaseModel):
    apparatus_id: str = Field(..., min_length=1, max_length=36)
    seats: List[TemplateSeatSpec] = Field(..., min_length=1, max_length=30)


class ApparatusEventTemplateBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    event_type: EventType = EventType.PUBLIC_EDUCATION
    default_start_time: Optional[str] = None
    duration_minutes: int = Field(180, ge=15, le=MAX_NIGHT_MINUTES)
    location: Optional[str] = Field(None, max_length=300)
    admin_hours_category_id: Optional[str] = Field(None, max_length=36)
    evoc_mode: ApparatusEventEvocMode = ApparatusEventEvocMode.ENFORCE
    allow_self_signup: bool = True
    show_on_schedule: bool = True
    units: List[TemplateUnitSpec] = Field(..., min_length=1, max_length=MAX_UNITS)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Template name is required")
        return stripped

    @field_validator("description", "location", "admin_hours_category_id")
    @classmethod
    def _optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)

    @field_validator("default_start_time")
    @classmethod
    def _start_time(cls, value: Optional[str]) -> Optional[str]:
        value = _blank_to_none(value)
        if value is not None and not _HHMM.match(value):
            raise ValueError("Default start must be a time of day, HH:MM")
        return value

    @field_validator("event_type")
    @classmethod
    def _not_training(cls, value: EventType) -> EventType:
        # A Training event credits training records, not Admin Hours, and the
        # whole point of an apparatus event is the Admin Hours credit.
        if value == EventType.TRAINING:
            raise ValueError(
                "An apparatus event cannot be a Training event: its crew's hours "
                "go to Admin Hours"
            )
        return value

    @model_validator(mode="after")
    def _shape(self) -> "ApparatusEventTemplateBase":
        apparatus_ids = [unit.apparatus_id for unit in self.units]
        if len(apparatus_ids) != len(set(apparatus_ids)):
            raise ValueError("Each apparatus can appear on a template only once")
        total = sum(seat.count for unit in self.units for seat in unit.seats)
        if total > MAX_TOTAL_SEATS:
            raise ValueError(
                f"A template can have at most {MAX_TOTAL_SEATS} seats in total"
            )
        return self


class ApparatusEventTemplateCreate(ApparatusEventTemplateBase):
    duplicated_from_id: Optional[str] = Field(None, max_length=36)

    @field_validator("duplicated_from_id")
    @classmethod
    def _source(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)


class ApparatusEventTemplateUpdate(ApparatusEventTemplateBase):
    """A full replacement: the editor always sends the whole template."""


class TemplateSeatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    seat_type: ApparatusEventSeatType
    count: int
    note: Optional[str] = None


class TemplateUnitResponse(BaseModel):
    id: str
    apparatus_id: str
    unit_number: str
    apparatus_name: Optional[str] = None
    required_evoc_level_name: Optional[str] = None
    seats: List[TemplateSeatResponse]


class ApparatusEventTemplateResponse(UTCResponseBase):
    id: str
    name: str
    description: Optional[str] = None
    event_type: EventType
    default_start_time: Optional[str] = None
    duration_minutes: int
    location: Optional[str] = None
    admin_hours_category_id: Optional[str] = None
    admin_hours_category_name: Optional[str] = None
    evoc_mode: ApparatusEventEvocMode
    allow_self_signup: bool
    show_on_schedule: bool
    duplicated_from_id: Optional[str] = None
    duplicated_from_name: Optional[str] = None
    total_seats: int
    nights_scheduled: int
    last_scheduled_at: Optional[datetime] = None
    units: List[TemplateUnitResponse]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Scheduling nights
# ---------------------------------------------------------------------------


class NightSpec(BaseModel):
    start_datetime: datetime
    end_datetime: datetime
    location: Optional[str] = Field(None, max_length=300)

    @field_validator("location")
    @classmethod
    def _location(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)

    @field_validator("start_datetime", "end_datetime")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Times must include a UTC offset")
        return value

    @model_validator(mode="after")
    def _ordered(self) -> "NightSpec":
        if self.end_datetime <= self.start_datetime:
            raise ValueError("A night must end after it starts")
        minutes = (self.end_datetime - self.start_datetime).total_seconds() / 60
        if minutes > MAX_NIGHT_MINUTES:
            raise ValueError("A night cannot be longer than 24 hours")
        return self


class ConflictCheckRequest(BaseModel):
    nights: List[NightSpec] = Field(..., min_length=1, max_length=MAX_NIGHTS)


class ScheduleNightsRequest(ConflictCheckRequest):
    title: str = Field(..., min_length=1, max_length=200)
    # Server-enforced: a conflict found at submit time refuses the request
    # unless the coordinator has seen the conflicts and chosen to proceed.
    acknowledge_conflicts: bool = False

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Title is required")
        return stripped


class ApparatusConflict(BaseModel):
    night_index: int
    apparatus_id: str
    unit_number: str
    reason: str
    conflicting_event_id: Optional[str] = None
    conflicting_title: Optional[str] = None


class ConflictCheckResponse(BaseModel):
    conflicts: List[ApparatusConflict]


class ScheduleNightsResponse(BaseModel):
    series_id: str
    event_ids: List[str]


# ---------------------------------------------------------------------------
# A night's crew board
# ---------------------------------------------------------------------------


class DriverWarning(BaseModel):
    type: str
    message: str
    severity: str = "warning"


class CrewSeatResponse(BaseModel):
    id: str
    name: str
    seat_type: ApparatusEventSeatType
    note: Optional[str] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    assignment_method: Optional[ApparatusEventSeatMethod] = None
    is_me: bool = False
    checked_in: bool = False


class CrewUnitResponse(BaseModel):
    id: str
    apparatus_id: str
    unit_number: str
    apparatus_name: Optional[str] = None
    required_evoc_level_name: Optional[str] = None
    seats: List[CrewSeatResponse]


class SeriesNight(UTCResponseBase):
    event_id: str
    start_datetime: datetime
    filled: int
    total: int


class CrewBoardResponse(UTCResponseBase):
    event_id: str
    title: str
    event_type: EventType
    start_datetime: datetime
    end_datetime: datetime
    location: Optional[str] = None
    is_cancelled: bool
    attendance_finalized: bool
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    evoc_mode: ApparatusEventEvocMode
    allow_self_signup: bool
    show_on_schedule: bool
    admin_hours_category_id: Optional[str] = None
    admin_hours_category_name: Optional[str] = None
    night_number: int
    night_count: int
    series: List[SeriesNight]
    units: List[CrewUnitResponse]
    my_seat_id: Optional[str] = None
    can_manage: bool
    can_sign_up: bool
    warnings: List[DriverWarning] = Field(default_factory=list)


class SeatAssignmentRequest(BaseModel):
    """``user_id`` null clears the seat."""

    user_id: Optional[str] = Field(None, max_length=36)

    @field_validator("user_id")
    @classmethod
    def _user(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)


class DriverCandidate(BaseModel):
    user_id: str
    name: str
    allowed: bool
    blocked_reason: Optional[str] = None
    warnings: List[DriverWarning] = Field(default_factory=list)
    exception_valid_until: Optional[str] = None


class DriverCandidatesResponse(BaseModel):
    unit_id: str
    required_evoc_level_name: Optional[str] = None
    evoc_mode: ApparatusEventEvocMode
    candidates: List[DriverCandidate]


class NightSeatSpec(BaseModel):
    """A seat on one night's plan. ``id`` names an existing seat to keep —
    and keep its occupant — while a seat without one is added open."""

    id: Optional[str] = Field(None, max_length=36)
    name: str = Field(..., min_length=1, max_length=100)
    seat_type: ApparatusEventSeatType = ApparatusEventSeatType.GENERAL
    note: Optional[str] = Field(None, max_length=300)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Seat name is required")
        return stripped

    @field_validator("id", "note")
    @classmethod
    def _optional(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)


class NightUnitSpec(BaseModel):
    id: Optional[str] = Field(None, max_length=36)
    apparatus_id: str = Field(..., min_length=1, max_length=36)
    seats: List[NightSeatSpec] = Field(..., min_length=1, max_length=MAX_TOTAL_SEATS)

    @field_validator("id")
    @classmethod
    def _optional(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)


class NightPlanUpdate(BaseModel):
    """Adjust one night without touching its template or its siblings."""

    evoc_mode: ApparatusEventEvocMode
    allow_self_signup: bool
    show_on_schedule: bool
    admin_hours_category_id: Optional[str] = Field(None, max_length=36)
    units: List[NightUnitSpec] = Field(..., min_length=1, max_length=MAX_UNITS)

    @field_validator("admin_hours_category_id")
    @classmethod
    def _category(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)

    @model_validator(mode="after")
    def _shape(self) -> "NightPlanUpdate":
        apparatus_ids = [unit.apparatus_id for unit in self.units]
        if len(apparatus_ids) != len(set(apparatus_ids)):
            raise ValueError("Each apparatus can appear on a night only once")
        if sum(len(unit.seats) for unit in self.units) > MAX_TOTAL_SEATS:
            raise ValueError(f"A night can have at most {MAX_TOTAL_SEATS} seats")
        return self


# ---------------------------------------------------------------------------
# Lists: the coordinator's nights and the scheduling overlay
# ---------------------------------------------------------------------------


class NightSummary(UTCResponseBase):
    event_id: str
    title: str
    start_datetime: datetime
    end_datetime: datetime
    template_name: Optional[str] = None
    unit_numbers: List[str]
    filled: int
    total: int
    is_cancelled: bool
    attendance_finalized: bool
    checked_in: int


class CalendarOutreachItem(UTCResponseBase):
    event_id: str
    title: str
    start_datetime: datetime
    end_datetime: datetime
    unit_numbers: List[str]
    filled: int
    total: int
    is_mine: bool
