"""
Meeting Minutes API Endpoints

Endpoints for meeting minutes including meetings, attendees,
action items, and approval workflows.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.models.user import User
from app.schemas.meetings import (
    MeetingCreate,
    MeetingUpdate,
    MeetingResponse,
    MeetingDetailResponse,
    MeetingsListResponse,
    MeetingAttendeeCreate,
    MeetingAttendeeResponse,
    ActionItemCreate,
    ActionItemUpdate,
    ActionItemResponse,
    MeetingsSummary,
)
from app.services.meetings_service import MeetingsService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Meeting Endpoints
# ============================================

@router.get("", response_model=MeetingsListResponse)
async def list_meetings(
    meeting_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """List all meetings for the organization"""
    service = MeetingsService(db)
    meetings, total = await service.get_meetings(
        current_user.organization_id,
        meeting_type=meeting_type,
        status=status,
        search=search,
        skip=skip,
        limit=limit,
    )

    return {
        "meetings": meetings,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("", response_model=MeetingDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    meeting: MeetingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Create a new meeting with optional attendees and action items"""
    service = MeetingsService(db)
    meeting_data = meeting.model_dump(exclude_none=True)
    result, error = await service.create_meeting(
        current_user.organization_id, meeting_data, current_user.id
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to create meeting. {error}")
    return result


@router.get("/{meeting_id}", response_model=MeetingDetailResponse)
async def get_meeting(
    meeting_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """Get a meeting by ID with attendees and action items"""
    service = MeetingsService(db)
    meeting = await service.get_meeting_by_id(meeting_id, current_user.organization_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.patch("/{meeting_id}", response_model=MeetingResponse)
async def update_meeting(
    meeting_id: UUID,
    meeting: MeetingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Update a meeting"""
    service = MeetingsService(db)
    update_data = meeting.model_dump(exclude_none=True)
    result, error = await service.update_meeting(
        meeting_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update meeting. {error}")
    return result


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Delete a meeting and all its attendees/action items"""
    service = MeetingsService(db)
    success, error = await service.delete_meeting(meeting_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete meeting. {error}")


@router.post("/{meeting_id}/approve", response_model=MeetingResponse)
async def approve_meeting(
    meeting_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Approve meeting minutes"""
    service = MeetingsService(db)
    result, error = await service.approve_meeting(
        meeting_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to approve meeting. {error}")
    return result


# ============================================
# Attendee Endpoints
# ============================================

@router.post("/{meeting_id}/attendees", response_model=MeetingAttendeeResponse, status_code=status.HTTP_201_CREATED)
async def add_attendee(
    meeting_id: UUID,
    attendee: MeetingAttendeeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Add an attendee to a meeting"""
    service = MeetingsService(db)
    result, error = await service.add_attendee(
        meeting_id, current_user.organization_id, attendee.model_dump()
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to add attendee. {error}")
    return result


@router.delete("/{meeting_id}/attendees/{attendee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_attendee(
    meeting_id: UUID,
    attendee_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Remove an attendee from a meeting"""
    service = MeetingsService(db)
    success, error = await service.remove_attendee(meeting_id, attendee_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to remove attendee. {error}")


# ============================================
# Action Item Endpoints
# ============================================

@router.post("/{meeting_id}/action-items", response_model=ActionItemResponse, status_code=status.HTTP_201_CREATED)
async def create_action_item(
    meeting_id: UUID,
    item: ActionItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Create an action item for a meeting"""
    service = MeetingsService(db)
    result, error = await service.create_action_item(
        meeting_id, current_user.organization_id, item.model_dump(exclude_none=True)
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to create action item. {error}")
    return result


@router.patch("/action-items/{item_id}", response_model=ActionItemResponse)
async def update_action_item(
    item_id: UUID,
    item: ActionItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Update an action item"""
    service = MeetingsService(db)
    result, error = await service.update_action_item(
        item_id, current_user.organization_id, item.model_dump(exclude_none=True)
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update action item. {error}")
    return result


@router.delete("/action-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_action_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Delete an action item"""
    service = MeetingsService(db)
    success, error = await service.delete_action_item(item_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete action item. {error}")


@router.get("/action-items/open", response_model=list[ActionItemResponse])
async def get_open_action_items(
    assigned_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """Get all open action items"""
    service = MeetingsService(db)
    assigned_uuid = UUID(assigned_to) if assigned_to else None
    items = await service.get_open_action_items(current_user.organization_id, assigned_uuid)
    return items


# ============================================
# Summary Endpoint
# ============================================

@router.get("/stats/summary", response_model=MeetingsSummary)
async def get_meetings_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """Get meetings module summary statistics"""
    service = MeetingsService(db)
    return await service.get_summary(current_user.organization_id)


# ============================================
# Attendance Dashboard & Waivers
# ============================================

@router.get("/attendance/dashboard")
async def get_attendance_dashboard(
    period_months: int = Query(default=12, ge=1, le=60, description="Look-back period in months"),
    meeting_type: Optional[str] = Query(None, description="Filter by meeting type (e.g. 'business')"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    Secretary attendance dashboard.

    Shows every active member's meeting attendance percentage, meetings attended,
    waived, absent counts, membership tier, and voting eligibility status.
    This data point feeds into annual membership requirements.

    **Requires permission: meetings.manage**
    """
    from app.services.attendance_dashboard_service import AttendanceDashboardService
    service = AttendanceDashboardService(db)
    return await service.get_dashboard(
        organization_id=current_user.organization_id,
        period_months=period_months,
        meeting_type=meeting_type,
    )


@router.post("/{meeting_id}/attendance-waiver")
async def grant_attendance_waiver(
    meeting_id: UUID,
    user_id: UUID = Query(..., description="Member to grant the waiver to"),
    reason: str = Query(..., min_length=5, max_length=500, description="Reason for the waiver"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    Grant a meeting attendance waiver to a member.

    The member will not be able to vote in this meeting, but their attendance
    percentage will not be penalized. Only secretary, president, and chief
    (via meetings.manage) can grant waivers.

    **Requires permission: meetings.manage**
    """
    from app.services.attendance_dashboard_service import AttendanceDashboardService
    from app.core.audit import log_audit_event

    # Verify the meeting belongs to this org
    from app.models.meeting import Meeting
    from sqlalchemy import select
    result = await db.execute(
        select(Meeting)
        .where(Meeting.id == str(meeting_id))
        .where(Meeting.organization_id == str(current_user.organization_id))
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    service = AttendanceDashboardService(db)
    waiver = await service.grant_waiver(
        meeting_id=str(meeting_id),
        user_id=str(user_id),
        organization_id=str(current_user.organization_id),
        granted_by=str(current_user.id),
        reason=reason,
    )

    await log_audit_event(
        db=db,
        event_type="meeting_attendance_waiver_granted",
        event_category="meetings",
        severity="warning",
        event_data={
            "meeting_id": str(meeting_id),
            "meeting_title": meeting.title,
            "user_id": str(user_id),
            "reason": reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return waiver


@router.get("/{meeting_id}/attendance-waivers")
async def list_attendance_waivers(
    meeting_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """
    List all attendance waivers for a meeting.

    **Requires permission: meetings.manage**
    """
    from app.services.attendance_dashboard_service import AttendanceDashboardService
    service = AttendanceDashboardService(db)
    return await service.list_waivers(
        meeting_id=str(meeting_id),
        organization_id=str(current_user.organization_id),
    )
