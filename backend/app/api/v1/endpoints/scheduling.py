"""
Scheduling API Endpoints

Endpoints for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

from datetime import date, timedelta
from typing import Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.models.training import BasicApparatus, ShiftAssignment
from app.models.user import User
from app.schemas.scheduling import (
    BasicApparatusCreate,
    BasicApparatusResponse,
    BasicApparatusUpdate,
    GenerateShiftsRequest,
    SchedulingSummary,
    ShiftAssignmentCreate,
    ShiftAssignmentResponse,
    ShiftAssignmentUpdate,
    ShiftAttendanceCreate,
    ShiftAttendanceResponse,
    ShiftAttendanceUpdate,
    ShiftCallCreate,
    ShiftCallResponse,
    ShiftCallUpdate,
    ShiftComplianceResponse,
    ShiftCreate,
    ShiftDetailResponse,
    ShiftPatternCreate,
    ShiftPatternResponse,
    ShiftPatternUpdate,
    ShiftResponse,
    ShiftSignupRequest,
    ShiftsListResponse,
    ShiftSwapRequestCreate,
    ShiftSwapRequestResponse,
    ShiftSwapReview,
    ShiftTemplateCreate,
    ShiftTemplateResponse,
    ShiftTemplateUpdate,
    ShiftTimeOffCreate,
    ShiftTimeOffResponse,
    ShiftTimeOffReview,
    ShiftUpdate,
    SwapRequestStatus,
    TimeOffStatus,
)
from app.services.scheduling_service import SchedulingService

router = APIRouter()


# ============================================
# Apparatus enrichment helper
# ============================================


async def _enrich_shifts(
    service: SchedulingService,
    organization_id,
    shifts: list,
) -> list[dict]:
    """Convert Shift ORM objects to dicts enriched with apparatus details,
    shift officer names, and attendee counts."""
    if not shifts:
        return []

    apparatus_ids = list({s.apparatus_id for s in shifts if s.apparatus_id})
    apparatus_map = await service._get_apparatus_map(organization_id, apparatus_ids)

    # Resolve shift officer names
    officer_ids = list({s.shift_officer_id for s in shifts if s.shift_officer_id})
    user_name_map = await service._get_user_name_map(officer_ids)

    # Compute attendee_count per shift (count of non-declined assignments)
    shift_ids = [s.id for s in shifts]
    attendee_counts: Dict[str, int] = {}
    if shift_ids:
        count_result = await service.db.execute(
            select(ShiftAssignment.shift_id, func.count(ShiftAssignment.id))
            .where(ShiftAssignment.shift_id.in_(shift_ids))
            .where(ShiftAssignment.organization_id == str(organization_id))
            .where(ShiftAssignment.assignment_status != "declined")
            .group_by(ShiftAssignment.shift_id)
        )
        for row in count_result.all():
            attendee_counts[str(row[0])] = row[1]

    enriched = []
    for s in shifts:
        d = {c.key: getattr(s, c.key) for c in s.__table__.columns}
        service._enrich_shift_dict(d, apparatus_map, user_name_map)
        d["attendee_count"] = attendee_counts.get(str(s.id), 0)
        enriched.append(d)
    return enriched


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

    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )

    shifts, total = await service.get_shifts(
        current_user.organization_id,
        start_date=start,
        end_date=end,
        skip=skip,
        limit=limit,
    )

    enriched = await _enrich_shifts(service, current_user.organization_id, shifts)
    return {
        "shifts": enriched,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post(
    "/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED
)
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
    if error or result is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to create shift. {error or 'Unknown error'}",
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, [result])
    return enriched[0]


@router.get("/shifts/open", response_model=list[ShiftResponse])
async def get_open_shifts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    apparatus_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get upcoming shifts (optionally filtered by date range and apparatus).
    Returns shifts that still have open positions.
    Must be registered before /shifts/{shift_id} to avoid route shadowing.
    """
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else date.today()
        end = date.fromisoformat(end_date) if end_date else start + timedelta(days=30)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )

    shifts_list, total = await service.get_shifts(
        current_user.organization_id,
        start_date=start,
        end_date=end,
        skip=0,
        limit=50,
    )
    # Optionally filter by apparatus_id
    if apparatus_id:
        shifts_list = [s for s in shifts_list if s.apparatus_id == apparatus_id]
    return await _enrich_shifts(service, current_user.organization_id, shifts_list)


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

    attendance = await service.get_shift_attendance(
        shift_id, current_user.organization_id
    )
    apparatus_ids = [shift.apparatus_id] if shift.apparatus_id else []
    apparatus_map = await service._get_apparatus_map(
        current_user.organization_id, apparatus_ids
    )
    officer_ids = [shift.shift_officer_id] if shift.shift_officer_id else []
    user_name_map = await service._get_user_name_map(officer_ids)
    d = {c.key: getattr(shift, c.key) for c in shift.__table__.columns}
    service._enrich_shift_dict(d, apparatus_map, user_name_map)
    return {
        **d,
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
    update_data = shift.model_dump(exclude_unset=True)
    result, error = await service.update_shift(
        shift_id, current_user.organization_id, update_data
    )
    if error or result is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to update shift. {error or 'Unknown error'}",
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, [result])
    return enriched[0]


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


@router.post(
    "/shifts/{shift_id}/attendance",
    response_model=ShiftAttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
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
        raise HTTPException(
            status_code=400, detail=f"Unable to add attendance. {error}"
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.get(
    "/shifts/{shift_id}/attendance", response_model=list[ShiftAttendanceResponse]
)
async def get_attendance(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get all attendance records for a shift"""
    service = SchedulingService(db)
    attendance = await service.get_shift_attendance(
        shift_id, current_user.organization_id
    )
    return await service.enrich_attendance_records(attendance)


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
        attendance_id,
        current_user.organization_id,
        attendance.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to update attendance. {error}"
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.delete("/attendance/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_attendance(
    attendance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Remove an attendance record"""
    service = SchedulingService(db)
    success, error = await service.remove_attendance(
        attendance_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=f"Unable to remove attendance. {error}"
        )


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
    try:
        start = (
            date.fromisoformat(week_start)
            if week_start
            else (date.today() - timedelta(days=date.today().weekday()))
        )
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    shifts = await service.get_week_shifts(current_user.organization_id, start)
    return await _enrich_shifts(service, current_user.organization_id, shifts)


@router.get("/calendar/month", response_model=list[ShiftResponse])
async def get_month_calendar(
    year: Optional[int] = None,
    month: Optional[int] = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get shifts for a specific month"""
    service = SchedulingService(db)
    today = date.today()
    y = year or today.year
    m = month or today.month
    shifts = await service.get_month_shifts(current_user.organization_id, y, m)
    return await _enrich_shifts(service, current_user.organization_id, shifts)


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


# ============================================
# Shift Call Endpoints
# ============================================


@router.post(
    "/shifts/{shift_id}/calls",
    response_model=ShiftCallResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_call(
    shift_id: UUID,
    call: ShiftCallCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a call record for a shift"""
    service = SchedulingService(db)
    call_data = call.model_dump(exclude_none=True)
    call_data.pop("shift_id", None)
    result, error = await service.create_shift_call(
        current_user.organization_id, shift_id, call_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to create call. {error}")
    return result


@router.get("/shifts/{shift_id}/calls", response_model=list[ShiftCallResponse])
async def list_shift_calls(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List all calls for a shift"""
    service = SchedulingService(db)
    calls = await service.get_shift_calls(shift_id, current_user.organization_id)
    return calls


@router.get("/calls/{call_id}", response_model=ShiftCallResponse)
async def get_call(
    call_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a specific call by ID"""
    service = SchedulingService(db)
    call = await service.get_shift_call_by_id(call_id, current_user.organization_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


@router.patch("/calls/{call_id}", response_model=ShiftCallResponse)
async def update_call(
    call_id: UUID,
    call: ShiftCallUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a call record"""
    service = SchedulingService(db)
    update_data = call.model_dump(exclude_unset=True)
    result, error = await service.update_shift_call(
        call_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update call. {error}")
    return result


@router.delete("/calls/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_call(
    call_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a call record"""
    service = SchedulingService(db)
    success, error = await service.delete_shift_call(
        call_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete call. {error}")


# ============================================
# Shift Template Endpoints
# ============================================


@router.get("/templates", response_model=list[ShiftTemplateResponse])
async def list_templates(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shift templates"""
    service = SchedulingService(db)
    templates = await service.get_templates(
        current_user.organization_id, active_only=active_only
    )
    return templates


@router.post(
    "/templates",
    response_model=ShiftTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    template: ShiftTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a shift template"""
    service = SchedulingService(db)
    template_data = template.model_dump(exclude_none=True)
    result, error = await service.create_template(
        current_user.organization_id, template_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create template. {error}"
        )
    return result


@router.get("/templates/{template_id}", response_model=ShiftTemplateResponse)
async def get_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift template by ID"""
    service = SchedulingService(db)
    template = await service.get_template_by_id(
        template_id, current_user.organization_id
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.patch("/templates/{template_id}", response_model=ShiftTemplateResponse)
async def update_template(
    template_id: UUID,
    template: ShiftTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift template"""
    service = SchedulingService(db)
    update_data = template.model_dump(exclude_unset=True)
    result, error = await service.update_template(
        template_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to update template. {error}"
        )
    return result


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift template"""
    service = SchedulingService(db)
    success, error = await service.delete_template(
        template_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=f"Unable to delete template. {error}"
        )


# ============================================
# Shift Pattern Endpoints
# ============================================


@router.get("/patterns", response_model=list[ShiftPatternResponse])
async def list_patterns(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shift patterns"""
    service = SchedulingService(db)
    patterns = await service.get_patterns(
        current_user.organization_id, active_only=active_only
    )
    return patterns


@router.post(
    "/patterns",
    response_model=ShiftPatternResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pattern(
    pattern: ShiftPatternCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a shift pattern"""
    service = SchedulingService(db)
    pattern_data = pattern.model_dump(exclude_none=True)
    result, error = await service.create_pattern(
        current_user.organization_id, pattern_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create pattern. {error}"
        )
    return result


@router.get("/patterns/{pattern_id}", response_model=ShiftPatternResponse)
async def get_pattern(
    pattern_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift pattern by ID"""
    service = SchedulingService(db)
    pattern = await service.get_pattern_by_id(pattern_id, current_user.organization_id)
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern not found")
    return pattern


@router.patch("/patterns/{pattern_id}", response_model=ShiftPatternResponse)
async def update_pattern(
    pattern_id: UUID,
    pattern: ShiftPatternUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift pattern"""
    service = SchedulingService(db)
    update_data = pattern.model_dump(exclude_unset=True)
    result, error = await service.update_pattern(
        pattern_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to update pattern. {error}"
        )
    return result


@router.delete("/patterns/{pattern_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pattern(
    pattern_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift pattern"""
    service = SchedulingService(db)
    success, error = await service.delete_pattern(
        pattern_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=f"Unable to delete pattern. {error}"
        )


@router.post("/patterns/{pattern_id}/generate")
async def generate_shifts_from_pattern(
    pattern_id: UUID,
    request: GenerateShiftsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Generate shifts from a pattern for a date range"""
    service = SchedulingService(db)
    result, error = await service.generate_shifts_from_pattern(
        pattern_id,
        current_user.organization_id,
        request.start_date,
        request.end_date,
        current_user.id,
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to generate shifts. {error}"
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, result)
    return {"shifts_created": len(result), "shifts": enriched}


# ============================================
# Shift Assignment Endpoints
# ============================================


@router.get(
    "/shifts/{shift_id}/assignments", response_model=list[ShiftAssignmentResponse]
)
async def list_shift_assignments(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List all assignments for a shift"""
    service = SchedulingService(db)
    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    return await service.enrich_assignments(assignments)


@router.post(
    "/shifts/{shift_id}/assignments",
    response_model=ShiftAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment(
    shift_id: UUID,
    assignment: ShiftAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Create a shift assignment"""
    service = SchedulingService(db)
    assignment_data = assignment.model_dump(exclude_none=True)
    result, error = await service.create_assignment(
        current_user.organization_id, shift_id, assignment_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create assignment. {error}"
        )
    enriched = await service.enrich_assignments([result])
    return enriched[0]


@router.patch("/assignments/{assignment_id}", response_model=ShiftAssignmentResponse)
async def update_assignment(
    assignment_id: UUID,
    assignment: ShiftAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Update a shift assignment"""
    service = SchedulingService(db)
    update_data = assignment.model_dump(exclude_unset=True)
    result, error = await service.update_assignment(
        assignment_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to update assignment. {error}"
        )
    enriched = await service.enrich_assignments([result])
    return enriched[0]


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Delete a shift assignment"""
    service = SchedulingService(db)
    success, error = await service.delete_assignment(
        assignment_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=f"Unable to delete assignment. {error}"
        )


@router.post(
    "/assignments/{assignment_id}/confirm", response_model=ShiftAssignmentResponse
)
async def confirm_assignment(
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Confirm own shift assignment"""
    service = SchedulingService(db)
    result, error = await service.confirm_assignment(
        assignment_id, current_user.id, current_user.organization_id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to confirm assignment. {error}"
        )
    enriched = await service.enrich_assignments([result])
    return enriched[0]


# ============================================
# Shift Swap Request Endpoints
# ============================================


@router.get("/swap-requests", response_model=list[ShiftSwapRequestResponse])
async def list_swap_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """List shift swap requests"""
    service = SchedulingService(db)
    swap_status = None
    if status_filter:
        try:
            swap_status = SwapRequestStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {status_filter}"
            )
    requests, total = await service.get_swap_requests(
        current_user.organization_id,
        status=swap_status,
        skip=skip,
        limit=limit,
    )
    return await service.enrich_swap_requests(requests)


@router.post(
    "/swap-requests",
    response_model=ShiftSwapRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_swap_request(
    swap_request: ShiftSwapRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Create a shift swap request"""
    service = SchedulingService(db)
    request_data = swap_request.model_dump(exclude_none=True)
    result, error = await service.create_swap_request(
        current_user.organization_id, current_user.id, request_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create swap request. {error}"
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


@router.get("/swap-requests/{request_id}", response_model=ShiftSwapRequestResponse)
async def get_swap_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Get a specific swap request"""
    service = SchedulingService(db)
    swap_request = await service.get_swap_request_by_id(
        request_id, current_user.organization_id
    )
    if not swap_request:
        raise HTTPException(status_code=404, detail="Swap request not found")
    enriched = await service.enrich_swap_requests([swap_request])
    return enriched[0]


@router.post(
    "/swap-requests/{request_id}/review", response_model=ShiftSwapRequestResponse
)
async def review_swap_request(
    request_id: UUID,
    review: ShiftSwapReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Review (approve/deny) a shift swap request"""
    service = SchedulingService(db)
    result, error = await service.review_swap_request(
        request_id,
        current_user.organization_id,
        current_user.id,
        review.status,
        review.reviewer_notes,
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to review swap request. {error}"
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


@router.post(
    "/swap-requests/{request_id}/cancel", response_model=ShiftSwapRequestResponse
)
async def cancel_swap_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Cancel own shift swap request"""
    service = SchedulingService(db)
    result, error = await service.cancel_swap_request(
        request_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to cancel swap request. {error}"
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


# ============================================
# Time-Off Endpoints
# ============================================


@router.get("/time-off", response_model=list[ShiftTimeOffResponse])
async def list_time_off_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id: Optional[UUID] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List time-off requests"""
    service = SchedulingService(db)
    time_off_status = None
    if status_filter:
        try:
            time_off_status = TimeOffStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {status_filter}"
            )
    requests, total = await service.get_time_off_requests(
        current_user.organization_id,
        status=time_off_status,
        user_id=user_id,
        skip=skip,
        limit=limit,
    )
    return await service.enrich_time_off_requests(requests)


@router.post(
    "/time-off",
    response_model=ShiftTimeOffResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_time_off_request(
    time_off: ShiftTimeOffCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Create a time-off request"""
    service = SchedulingService(db)
    time_off_data = time_off.model_dump(exclude_none=True)
    result, error = await service.create_time_off(
        current_user.organization_id, current_user.id, time_off_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create time-off request. {error}"
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.get("/time-off/{time_off_id}", response_model=ShiftTimeOffResponse)
async def get_time_off_request(
    time_off_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a specific time-off request"""
    service = SchedulingService(db)
    time_off = await service.get_time_off_by_id(
        time_off_id, current_user.organization_id
    )
    if not time_off:
        raise HTTPException(status_code=404, detail="Time-off request not found")
    enriched = await service.enrich_time_off_requests([time_off])
    return enriched[0]


@router.post("/time-off/{time_off_id}/review", response_model=ShiftTimeOffResponse)
async def review_time_off_request(
    time_off_id: UUID,
    review: ShiftTimeOffReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Review (approve/deny) a time-off request"""
    service = SchedulingService(db)
    result, error = await service.review_time_off(
        time_off_id,
        current_user.organization_id,
        current_user.id,
        review.status,
        review.reviewer_notes,
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to review time-off request. {error}"
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.post("/time-off/{time_off_id}/cancel", response_model=ShiftTimeOffResponse)
async def cancel_time_off_request(
    time_off_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Cancel own time-off request"""
    service = SchedulingService(db)
    result, error = await service.cancel_time_off(
        time_off_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to cancel time-off request. {error}"
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.get("/availability")
async def get_member_availability(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Get member availability for a date range"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    availability = await service.get_availability(
        current_user.organization_id, start, end
    )
    return availability


# ============================================
# Personal Shift Endpoints
# ============================================


@router.get("/my-shifts")
async def get_my_shifts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's shifts"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    shift_dicts, total = await service.get_my_shifts(
        current_user.id,
        current_user.organization_id,
        start_date=start,
        end_date=end,
        skip=skip,
        limit=limit,
    )
    # get_my_shifts returns plain dicts (not ORM objects), so skip _enrich_shifts
    return {"shifts": shift_dicts, "total": total, "skip": skip, "limit": limit}


@router.get("/my-assignments", response_model=list[ShiftAssignmentResponse])
async def get_my_assignments(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's shift assignments with shift details"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    assignments = await service.get_user_assignments(
        current_user.id,
        current_user.organization_id,
        start_date=start,
        end_date=end,
    )
    return await service.enrich_assignments_with_shifts(
        assignments, current_user.organization_id
    )


# ============================================
# Report Endpoints
# ============================================

MAX_REPORT_DAYS = 366  # Maximum date range for report endpoints (1 year)


def _parse_and_validate_report_dates(start_date: str, end_date: str):
    """Parse and validate report date range. Raises HTTPException on failure."""
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    if end < start:
        raise HTTPException(
            status_code=400, detail="end_date must not be before start_date."
        )
    if (end - start).days > MAX_REPORT_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Date range must not exceed {MAX_REPORT_DAYS} days.",
        )
    return start, end


@router.get("/reports/member-hours")
async def get_member_hours_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get member hours report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    report = await service.get_member_hours_report(
        current_user.organization_id, start, end
    )
    return report


@router.get("/reports/coverage")
async def get_coverage_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get shift coverage report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    report = await service.get_shift_coverage_report(
        current_user.organization_id, start, end
    )
    return report


@router.get("/reports/call-volume")
async def get_call_volume_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    group_by: str = Query("day", pattern="^(day|week|month)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get call volume report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    report = await service.get_call_volume_report(
        current_user.organization_id, start, end, group_by=group_by
    )
    return report


@router.get("/reports/compliance", response_model=ShiftComplianceResponse)
async def get_shift_compliance_report(
    reference_date: Optional[str] = Query(
        None,
        description="Reference date for compliance calculation (YYYY-MM-DD). Defaults to today.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """
    Get shift/hours compliance report.

    Checks all active training requirements of type SHIFTS or HOURS
    against actual shift attendance records. Returns per-member
    compliance status for each requirement, respecting role/position
    applicability filters.
    """
    service = SchedulingService(db)
    ref_date = None
    if reference_date:
        try:
            ref_date = date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
            )

    compliance = await service.get_shift_compliance(
        current_user.organization_id, reference_date=ref_date
    )
    actual_ref = ref_date or date.today()
    return {
        "requirements": compliance,
        "reference_date": actual_ref.isoformat(),
        "total_requirements": len(compliance),
    }


# ============================================
# Shift Signup (Member Self-Service)
# ============================================


@router.post(
    "/shifts/{shift_id}/signup",
    response_model=ShiftAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def signup_for_shift(
    shift_id: UUID,
    signup: ShiftSignupRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Member signs up for an open position on a shift.
    Does not require scheduling.assign permission — any member can sign up.
    """
    service = SchedulingService(db)
    assignment_data = {
        "user_id": str(current_user.id),
        "position": signup.position.value,
    }
    result, error = await service.create_assignment(
        current_user.organization_id, shift_id, assignment_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to sign up for shift. {error}"
        )
    enriched = await service.enrich_assignments([result])
    return enriched[0]


@router.delete("/shifts/{shift_id}/signup", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_from_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Member withdraws their signup from a shift.
    Finds and deletes the current user's assignment for the specified shift.
    """
    service = SchedulingService(db)
    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    user_assignment = next(
        (a for a in assignments if str(a.user_id) == str(current_user.id)), None
    )
    if not user_assignment:
        raise HTTPException(
            status_code=404, detail="You are not assigned to this shift."
        )
    success, error = await service.delete_assignment(
        UUID(user_assignment.id), current_user.organization_id
    )
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to withdraw. {error}")


# ============================================
# Basic Apparatus (Lightweight)
# ============================================


@router.get("/apparatus", response_model=list[BasicApparatusResponse])
async def list_basic_apparatus(
    is_active: Optional[bool] = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all basic apparatus for the organization"""
    query = select(BasicApparatus).where(
        BasicApparatus.organization_id == str(current_user.organization_id)
    )
    if is_active is not None:
        query = query.where(BasicApparatus.is_active == is_active)
    query = query.order_by(BasicApparatus.unit_number)
    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/apparatus",
    response_model=BasicApparatusResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_basic_apparatus(
    apparatus: BasicApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a new basic apparatus entry"""
    new_apparatus = BasicApparatus(
        organization_id=str(current_user.organization_id),
        unit_number=apparatus.unit_number,
        name=apparatus.name,
        apparatus_type=apparatus.apparatus_type,
        min_staffing=apparatus.min_staffing,
        positions=apparatus.positions,
    )
    db.add(new_apparatus)
    await db.commit()
    await db.refresh(new_apparatus)
    return new_apparatus


@router.patch("/apparatus/{apparatus_id}", response_model=BasicApparatusResponse)
async def update_basic_apparatus(
    apparatus_id: UUID,
    apparatus: BasicApparatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a basic apparatus entry"""
    result = await db.execute(
        select(BasicApparatus).where(
            BasicApparatus.id == str(apparatus_id),
            BasicApparatus.organization_id == str(current_user.organization_id),
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Apparatus not found")
    update_data = apparatus.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(existing, key, value)
    await db.commit()
    await db.refresh(existing)
    return existing


@router.delete("/apparatus/{apparatus_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_basic_apparatus(
    apparatus_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a basic apparatus entry"""
    result = await db.execute(
        select(BasicApparatus).where(
            BasicApparatus.id == str(apparatus_id),
            BasicApparatus.organization_id == str(current_user.organization_id),
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Apparatus not found")
    await db.delete(existing)
    await db.commit()
