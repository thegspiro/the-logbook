"""
Scheduling Pydantic Schemas

Request and response schemas for scheduling/shift management endpoints.
"""

from enum import Enum as PyEnum

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any
from datetime import datetime, date
from uuid import UUID


# ============================================
# Shift Schemas
# ============================================

class ShiftCreate(BaseModel):
    """Schema for creating a shift"""
    shift_date: date
    start_time: datetime
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[str] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None


class ShiftUpdate(BaseModel):
    """Schema for updating a shift"""
    shift_date: Optional[date] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[str] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None


class ShiftResponse(BaseModel):
    """Schema for shift response"""
    id: UUID
    organization_id: UUID
    shift_date: date
    start_time: datetime
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    apparatus_name: Optional[str] = None
    apparatus_unit_number: Optional[str] = None
    apparatus_positions: Optional[List[str]] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[UUID] = None
    shift_officer_name: Optional[str] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None
    attendee_count: Optional[int] = 0
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Shift Attendance Schemas
# ============================================

class ShiftAttendanceCreate(BaseModel):
    """Schema for recording shift attendance"""
    user_id: UUID
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None


class ShiftAttendanceUpdate(BaseModel):
    """Schema for updating shift attendance"""
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


class ShiftAttendanceResponse(BaseModel):
    """Schema for shift attendance response"""
    id: UUID
    shift_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Shift Detail & List Schemas
# ============================================

class ShiftDetailResponse(ShiftResponse):
    """Extended shift response with attendees"""
    attendees: List[ShiftAttendanceResponse] = []

    model_config = ConfigDict(from_attributes=True)


class ShiftsListResponse(BaseModel):
    """Schema for paginated shifts list"""
    shifts: List[ShiftResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Summary Schemas
# ============================================

class SchedulingSummary(BaseModel):
    """Schema for scheduling module summary"""
    total_shifts: int
    shifts_this_week: int
    shifts_this_month: int
    total_hours_this_month: float


# ============================================
# Shift Call Schemas
# ============================================

class ShiftCallCreate(BaseModel):
    """Schema for creating a shift call"""
    incident_number: Optional[str] = None
    incident_type: str
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: bool = False
    medical_refusal: bool = False
    responding_members: Optional[List[str]] = None
    notes: Optional[str] = None


class ShiftCallUpdate(BaseModel):
    """Schema for updating a shift call"""
    incident_number: Optional[str] = None
    incident_type: Optional[str] = None
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: Optional[bool] = None
    medical_refusal: Optional[bool] = None
    responding_members: Optional[List[str]] = None
    notes: Optional[str] = None


class ShiftCallResponse(BaseModel):
    """Schema for shift call response"""
    id: UUID
    organization_id: UUID
    shift_id: UUID
    incident_number: Optional[str] = None
    incident_type: str
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: bool = False
    medical_refusal: bool = False
    responding_members: Optional[List[str]] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Enums
# ============================================

class ShiftPosition(str, PyEnum):
    """Enum for shift positions"""
    OFFICER = "officer"
    DRIVER = "driver"
    FIREFIGHTER = "firefighter"
    EMS = "ems"
    CAPTAIN = "captain"
    LIEUTENANT = "lieutenant"
    PROBATIONARY = "probationary"
    VOLUNTEER = "volunteer"
    OTHER = "other"


class AssignmentStatus(str, PyEnum):
    """Enum for shift assignment statuses"""
    ASSIGNED = "assigned"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    NO_SHOW = "no_show"


class SwapRequestStatus(str, PyEnum):
    """Enum for shift swap request statuses"""
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class TimeOffStatus(str, PyEnum):
    """Enum for time off request statuses"""
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class PatternType(str, PyEnum):
    """Enum for shift pattern types"""
    DAILY = "daily"
    WEEKLY = "weekly"
    PLATOON = "platoon"
    CUSTOM = "custom"


# ============================================
# Shift Template Schemas
# ============================================

class ShiftTemplateCreate(BaseModel):
    """Schema for creating a shift template"""
    name: str
    description: Optional[str] = None
    start_time_of_day: str
    end_time_of_day: str
    duration_hours: float
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: int = 1
    is_default: bool = False


class ShiftTemplateUpdate(BaseModel):
    """Schema for updating a shift template"""
    name: Optional[str] = None
    description: Optional[str] = None
    start_time_of_day: Optional[str] = None
    end_time_of_day: Optional[str] = None
    duration_hours: Optional[float] = None
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: Optional[int] = None
    is_default: Optional[bool] = None


class ShiftTemplateResponse(BaseModel):
    """Schema for shift template response"""
    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    start_time_of_day: str
    end_time_of_day: str
    duration_hours: float
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: int = 1
    is_default: bool = False
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Shift Pattern Schemas
# ============================================

class ShiftPatternCreate(BaseModel):
    """Schema for creating a shift pattern"""
    name: str
    description: Optional[str] = None
    pattern_type: PatternType
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: date
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None


class ShiftPatternUpdate(BaseModel):
    """Schema for updating a shift pattern"""
    name: Optional[str] = None
    description: Optional[str] = None
    pattern_type: Optional[PatternType] = None
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None


class ShiftPatternResponse(BaseModel):
    """Schema for shift pattern response"""
    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    pattern_type: PatternType
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: date
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class GenerateShiftsRequest(BaseModel):
    """Schema for requesting shift generation from a pattern"""
    pattern_id: UUID
    start_date: date
    end_date: date


class GenerateShiftsResponse(BaseModel):
    """Schema for shift generation response"""
    shifts_created: int
    shifts: List[ShiftResponse]


# ============================================
# Shift Assignment Schemas
# ============================================

class ShiftAssignmentCreate(BaseModel):
    """Schema for creating a shift assignment"""
    user_id: UUID
    position: ShiftPosition = ShiftPosition.FIREFIGHTER
    notes: Optional[str] = None


class ShiftAssignmentUpdate(BaseModel):
    """Schema for updating a shift assignment"""
    position: Optional[ShiftPosition] = None
    assignment_status: Optional[AssignmentStatus] = None
    notes: Optional[str] = None


class ShiftAssignmentResponse(BaseModel):
    """Schema for shift assignment response"""
    id: UUID
    organization_id: UUID
    shift_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    position: ShiftPosition
    assignment_status: AssignmentStatus
    assigned_by: Optional[UUID] = None
    confirmed_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Shift Swap Request Schemas
# ============================================

class ShiftSwapRequestCreate(BaseModel):
    """Schema for creating a shift swap request"""
    offering_shift_id: UUID
    requesting_shift_id: Optional[UUID] = None
    target_user_id: Optional[UUID] = None
    reason: Optional[str] = None


class ShiftSwapReview(BaseModel):
    """Schema for reviewing a shift swap request"""
    status: SwapRequestStatus
    reviewer_notes: Optional[str] = None


class ShiftSwapRequestResponse(BaseModel):
    """Schema for shift swap request response"""
    id: UUID
    organization_id: UUID
    requesting_user_id: UUID
    requesting_user_name: Optional[str] = None
    target_user_id: Optional[UUID] = None
    target_user_name: Optional[str] = None
    offering_shift_id: UUID
    offering_shift_date: Optional[date] = None
    requesting_shift_id: Optional[UUID] = None
    requesting_shift_date: Optional[date] = None
    status: SwapRequestStatus
    reason: Optional[str] = None
    reviewed_by: Optional[UUID] = None
    reviewer_notes: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Shift Time Off Schemas
# ============================================

class ShiftTimeOffCreate(BaseModel):
    """Schema for creating a time off request"""
    start_date: date
    end_date: date
    reason: Optional[str] = None


class ShiftTimeOffUpdate(BaseModel):
    """Schema for updating a time off request"""
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    reason: Optional[str] = None


class ShiftTimeOffReview(BaseModel):
    """Schema for reviewing a time off request"""
    status: TimeOffStatus
    reviewer_notes: Optional[str] = None


class ShiftTimeOffResponse(BaseModel):
    """Schema for time off request response"""
    id: UUID
    organization_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    start_date: date
    end_date: date
    status: TimeOffStatus
    reason: Optional[str] = None
    reviewer_notes: Optional[str] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Reporting Schemas
# ============================================

class MemberHoursReport(BaseModel):
    """Schema for member hours report"""
    user_id: UUID
    email: str
    shift_count: int
    total_minutes: int
    total_hours: float


class ShiftCoverageReport(BaseModel):
    """Schema for shift coverage report"""
    date: str
    total_shifts: int
    total_assigned: int
    total_confirmed: int
    understaffed_shifts: int


class CallVolumeReport(BaseModel):
    """Schema for call volume report"""
    period: str
    total_calls: int
    by_type: dict
    avg_response_seconds: Optional[float] = None


class MemberHoursListResponse(BaseModel):
    """Schema for member hours list response"""
    members: List[MemberHoursReport]
    period_start: date
    period_end: date
    total_members: int


# ============================================
# Shift Signup (Member Self-Service)
# ============================================

class ShiftSignupRequest(BaseModel):
    """Schema for a member signing up for an open shift position"""
    position: ShiftPosition = ShiftPosition.FIREFIGHTER


# ============================================
# Basic Apparatus (Lightweight, for non-module departments)
# ============================================

class BasicApparatusCreate(BaseModel):
    """Schema for creating a basic apparatus entry"""
    unit_number: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    apparatus_type: str = Field(default="engine", max_length=50)
    min_staffing: Optional[int] = Field(default=1, ge=1, le=50)
    positions: Optional[List[str]] = None


class BasicApparatusUpdate(BaseModel):
    """Schema for updating a basic apparatus entry"""
    unit_number: Optional[str] = Field(None, min_length=1, max_length=20)
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    apparatus_type: Optional[str] = Field(None, max_length=50)
    min_staffing: Optional[int] = Field(None, ge=1, le=50)
    positions: Optional[List[str]] = None


class BasicApparatusResponse(BaseModel):
    """Schema for basic apparatus response"""
    id: UUID
    organization_id: UUID
    unit_number: str
    name: str
    apparatus_type: str
    min_staffing: Optional[int] = None
    positions: Optional[List[str]] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
