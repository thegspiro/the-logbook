"""
Scheduling Pydantic Schemas

Request and response schemas for scheduling/shift management endpoints.
"""

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
    shift_officer_id: Optional[UUID] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None


class ShiftUpdate(BaseModel):
    """Schema for updating a shift"""
    shift_date: Optional[date] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[UUID] = None
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
