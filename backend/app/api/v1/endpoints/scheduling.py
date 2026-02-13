"""
Scheduling API Endpoints

Endpoints for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

from typing import Optional
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.models.user import User
from app.schemas.scheduling import (
    ShiftCreate,
    ShiftUpdate,
    ShiftResponse,
    ShiftDetailResponse,
    ShiftsListResponse,
    ShiftAttendanceCreate,
    ShiftAttendanceUpdate,
    ShiftAttendanceResponse,
    SchedulingSummary,
)
from app.services.scheduling_service import SchedulingService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Shift Endpoints
# ============================================

@router.get("/shifts", response_model=ShiftsListResponse)
async def list_shifts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shifts with optional date filtering"""
    service = SchedulingService(db)

    start = date.fromisoformat(start_date) if start_date else None
    end = date.fromisoformat(end_date) if end_date else None

    shifts, total = await service.get_shifts(
        current_user.organization_id,
        start_date=start,
        end_date=end,
        skip=skip,
        limit=limit,
    )

    return {
        "shifts": shifts,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift(
    shift: ShiftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a new shift"""
    service = SchedulingService(db)
    shift_data = shift.model_dump(exclude_none=True)
    result, error = await service.create_shift(
        current_user.organization_id, shift_data, current_user.id
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to create shift. {error}")
    return result


@router.get("/shifts/{shift_id}", response_model=ShiftDetailResponse)
async def get_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift by ID with attendance"""
    service = SchedulingService(db)
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    attendance = await service.get_shift_attendance(shift_id, current_user.organization_id)
    return {
        **{c.key: getattr(shift, c.key) for c in shift.__table__.columns},
        "attendees": attendance,
        "attendee_count": len(attendance),
    }


@router.patch("/shifts/{shift_id}", response_model=ShiftResponse)
async def update_shift(
    shift_id: UUID,
    shift: ShiftUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift"""
    service = SchedulingService(db)
    update_data = shift.model_dump(exclude_none=True)
    result, error = await service.update_shift(
        shift_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update shift. {error}")
    return result


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift"""
    service = SchedulingService(db)
    success, error = await service.delete_shift(shift_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete shift. {error}")


# ============================================
# Attendance Endpoints
# ============================================

@router.post("/shifts/{shift_id}/attendance", response_model=ShiftAttendanceResponse, status_code=status.HTTP_201_CREATED)
async def add_attendance(
    shift_id: UUID,
    attendance: ShiftAttendanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Add an attendance record to a shift"""
    service = SchedulingService(db)
    result, error = await service.add_attendance(
        shift_id, current_user.organization_id, attendance.model_dump(exclude_none=True)
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to add attendance. {error}")
    return result


@router.get("/shifts/{shift_id}/attendance", response_model=list[ShiftAttendanceResponse])
async def get_attendance(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get all attendance records for a shift"""
    service = SchedulingService(db)
    attendance = await service.get_shift_attendance(shift_id, current_user.organization_id)
    return attendance


@router.patch("/attendance/{attendance_id}", response_model=ShiftAttendanceResponse)
async def update_attendance(
    attendance_id: UUID,
    attendance: ShiftAttendanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update an attendance record"""
    service = SchedulingService(db)
    result, error = await service.update_attendance(
        attendance_id, attendance.model_dump(exclude_none=True)
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update attendance. {error}")
    return result


@router.delete("/attendance/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_attendance(
    attendance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Remove an attendance record"""
    service = SchedulingService(db)
    success, error = await service.remove_attendance(attendance_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to remove attendance. {error}")


# ============================================
# Calendar View Endpoints
# ============================================

@router.get("/calendar/week", response_model=list[ShiftResponse])
async def get_week_calendar(
    week_start: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get shifts for a specific week"""
    service = SchedulingService(db)
    start = date.fromisoformat(week_start) if week_start else (date.today() - timedelta(days=date.today().weekday()))
    shifts = await service.get_week_shifts(current_user.organization_id, start)
    return shifts


@router.get("/calendar/month", response_model=list[ShiftResponse])
async def get_month_calendar(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get shifts for a specific month"""
    service = SchedulingService(db)
    today = date.today()
    y = year or today.year
    m = month or today.month
    shifts = await service.get_month_shifts(current_user.organization_id, y, m)
    return shifts


# ============================================
# Summary Endpoint
# ============================================

@router.get("/summary", response_model=SchedulingSummary)
async def get_scheduling_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get scheduling module summary statistics"""
    service = SchedulingService(db)
    return await service.get_summary(current_user.organization_id)
