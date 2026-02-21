"""
Event API Endpoints

Endpoints for event management including events, RSVPs, and attendance tracking.
"""

import os
import uuid as uuid_lib
from loguru import logger
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime, timezone as dt_timezone

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.user import User
from app.schemas.event import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventListItem,
    EventCancel,
    RSVPCreate,
    RSVPResponse,
    CheckInRequest,
    SelfCheckInRequest,
    EventStats,
    RecordActualTimes,
    QRCheckInData,
    CheckInMonitoringStats,
    ManagerAddAttendee,
    RSVPOverride,
    EventTemplateCreate,
    EventTemplateUpdate,
    EventTemplateResponse,
    RecurringEventCreate,
)
from app.services.event_service import EventService
from app.services.documents_service import DocumentsService
from app.schemas.documents import DocumentFolderResponse
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


def _build_event_response(event: Event, **extra_fields) -> EventResponse:
    """Build an EventResponse from an Event model, including location and allowed_rsvp_statuses."""
    location_name = None
    if event.location_obj:
        location_name = event.location_obj.name

    return EventResponse(
        id=event.id,
        organization_id=event.organization_id,
        title=event.title,
        description=event.description,
        event_type=event.event_type.value,
        location_id=event.location_id,
        location=event.location,
        location_name=location_name,
        location_details=event.location_details,
        start_datetime=event.start_datetime,
        end_datetime=event.end_datetime,
        actual_start_time=event.actual_start_time,
        actual_end_time=event.actual_end_time,
        requires_rsvp=event.requires_rsvp,
        rsvp_deadline=event.rsvp_deadline,
        max_attendees=event.max_attendees,
        allowed_rsvp_statuses=event.allowed_rsvp_statuses,
        is_mandatory=event.is_mandatory,
        allow_guests=event.allow_guests,
        send_reminders=event.send_reminders,
        reminder_schedule=event.reminder_schedule or [24],
        check_in_window_type=event.check_in_window_type.value if event.check_in_window_type else "flexible",
        check_in_minutes_before=event.check_in_minutes_before,
        check_in_minutes_after=event.check_in_minutes_after,
        require_checkout=event.require_checkout,
        custom_fields=event.custom_fields,
        attachments=event.attachments,
        is_cancelled=event.is_cancelled,
        cancellation_reason=event.cancellation_reason,
        cancelled_at=event.cancelled_at,
        created_by=event.created_by,
        updated_by=event.updated_by,
        created_at=event.created_at,
        updated_at=event.updated_at,
        **extra_fields,
    )


# ============================================
# Event Endpoints
# ============================================

@router.get("", response_model=List[EventListItem])
async def list_events(
    event_type: Optional[str] = None,
    exclude_event_types: Optional[str] = None,
    start_after: Optional[datetime] = None,
    start_before: Optional[datetime] = None,
    include_cancelled: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all events with optional filtering

    Use `exclude_event_types` (comma-separated) to hide certain event types.
    Hall coordinators can use `exclude_event_types=training` to see only
    non-training events while double-booking prevention still applies.

    **Authentication required**
    """
    # Parse comma-separated exclude list
    exclude_list = None
    if exclude_event_types:
        exclude_list = [t.strip() for t in exclude_event_types.split(",") if t.strip()]

    service = EventService(db)
    events = await service.list_events(
        organization_id=current_user.organization_id,
        event_type=event_type,
        exclude_event_types=exclude_list,
        start_after=start_after,
        start_before=start_before,
        include_cancelled=include_cancelled,
        skip=skip,
        limit=limit,
    )

    # Convert to list items with basic info
    event_list = []
    for event in events:
        rsvp_count = len(event.rsvps) if event.rsvps else 0
        going_count = sum(1 for rsvp in event.rsvps if rsvp.status == RSVPStatus.GOING) if event.rsvps else 0

        location_name = None
        if event.location_obj:
            location_name = event.location_obj.name

        event_list.append(
            EventListItem(
                id=event.id,
                title=event.title,
                event_type=event.event_type.value,
                start_datetime=event.start_datetime,
                end_datetime=event.end_datetime,
                location_id=event.location_id,
                location=event.location,
                location_name=location_name,
                requires_rsvp=event.requires_rsvp,
                is_mandatory=event.is_mandatory,
                is_cancelled=event.is_cancelled,
                rsvp_count=rsvp_count,
                going_count=going_count,
            )
        )

    return event_list


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_data: EventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create a new event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)

    try:
        event = await service.create_event(
            event_data=event_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )

        await log_audit_event(
            db=db,
            event_type="event_created",
            event_category="events",
            severity="info",
            event_data={
                "event_id": str(event.id),
                "title": event.title,
                "event_type": event.event_type.value,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return _build_event_response(event)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific event

    **Authentication required**
    """
    service = EventService(db)
    event, user_rsvp = await service.get_event(
        event_id=event_id,
        organization_id=current_user.organization_id,
        user_id=current_user.id,
    )

    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    # Count RSVPs
    rsvp_count = len(event.rsvps) if event.rsvps else 0
    going_count = sum(1 for rsvp in event.rsvps if rsvp.status == RSVPStatus.GOING) if event.rsvps else 0
    not_going_count = sum(1 for rsvp in event.rsvps if rsvp.status == RSVPStatus.NOT_GOING) if event.rsvps else 0
    maybe_count = sum(1 for rsvp in event.rsvps if rsvp.status == RSVPStatus.MAYBE) if event.rsvps else 0

    return _build_event_response(
        event,
        rsvp_count=rsvp_count,
        going_count=going_count,
        not_going_count=not_going_count,
        maybe_count=maybe_count,
        user_rsvp_status=user_rsvp.status.value if user_rsvp else None,
    )


@router.patch("/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: UUID,
    event_data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Update an event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)

    try:
        event = await service.update_event(
            event_id=event_id,
            organization_id=current_user.organization_id,
            event_data=event_data,
            updated_by=current_user.id,
        )

        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found"
            )

        await log_audit_event(
            db=db,
            event_type="event_updated",
            event_category="events",
            severity="info",
            event_data={
                "event_id": str(event_id),
                "title": event.title,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return _build_event_response(event)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/{event_id}/duplicate", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Duplicate an event

    Creates a copy of the event with all settings but without RSVPs or attendance data.
    The new event title is prefixed with "Copy of ".

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    new_event = await service.duplicate_event(
        event_id=event_id,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if not new_event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    await log_audit_event(
        db=db,
        event_type="event_duplicated",
        event_category="events",
        severity="info",
        event_data={
            "source_event_id": str(event_id),
            "new_event_id": str(new_event.id),
            "title": new_event.title,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _build_event_response(new_event)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Delete an event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    success = await service.delete_event(
        event_id=event_id,
        organization_id=current_user.organization_id,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    await log_audit_event(
        db=db,
        event_type="event_deleted",
        event_category="events",
        severity="info",
        event_data={"event_id": str(event_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post("/{event_id}/cancel", response_model=EventResponse)
async def cancel_event(
    event_id: UUID,
    cancel_data: EventCancel,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Cancel an event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)

    try:
        event = await service.cancel_event(
            event_id=event_id,
            organization_id=current_user.organization_id,
            reason=cancel_data.cancellation_reason,
            send_notifications=cancel_data.send_notifications,
        )

        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found"
            )

        return _build_event_response(event)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ============================================
# RSVP Endpoints
# ============================================

@router.post("/{event_id}/rsvp", response_model=RSVPResponse)
async def create_or_update_rsvp(
    event_id: UUID,
    rsvp_data: RSVPCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create or update an RSVP for an event

    **Authentication required**
    """
    service = EventService(db)
    rsvp, error = await service.create_or_update_rsvp(
        event_id=event_id,
        user_id=current_user.id,
        rsvp_data=rsvp_data,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return RSVPResponse(
        id=rsvp.id,
        event_id=rsvp.event_id,
        user_id=rsvp.user_id,
        status=rsvp.status.value,
        guest_count=rsvp.guest_count,
        notes=rsvp.notes,
        responded_at=rsvp.responded_at,
        updated_at=rsvp.updated_at,
        checked_in=rsvp.checked_in,
        checked_in_at=rsvp.checked_in_at,
        user_name=f"{current_user.first_name} {current_user.last_name}",
        user_email=current_user.email,
    )


@router.get("/{event_id}/rsvps", response_model=List[RSVPResponse])
async def list_event_rsvps(
    event_id: UUID,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    List all RSVPs for an event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    rsvps = await service.list_event_rsvps(
        event_id=event_id,
        organization_id=current_user.organization_id,
        status_filter=status_filter,
        skip=skip,
        limit=limit,
    )

    # Build response using eager-loaded user data
    rsvp_responses = []
    for rsvp in rsvps:
        # User is already loaded via selectinload in the service layer
        user = rsvp.user

        rsvp_responses.append(
            RSVPResponse(
                id=rsvp.id,
                event_id=rsvp.event_id,
                user_id=rsvp.user_id,
                status=rsvp.status.value,
                guest_count=rsvp.guest_count,
                notes=rsvp.notes,
                responded_at=rsvp.responded_at,
                updated_at=rsvp.updated_at,
                checked_in=rsvp.checked_in,
                checked_in_at=rsvp.checked_in_at,
                user_name=f"{user.first_name} {user.last_name}" if user else None,
                user_email=user.email if user else None,
            )
        )

    return rsvp_responses


@router.post("/{event_id}/check-in", response_model=RSVPResponse)
async def check_in_attendee(
    event_id: UUID,
    check_in_data: CheckInRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Check in an attendee at the event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    rsvp, error = await service.check_in_attendee(
        event_id=event_id,
        user_id=check_in_data.user_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == rsvp.user_id)
    )
    user = user_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="event_checkin",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "checked_in_user_id": str(check_in_data.user_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return RSVPResponse(
        id=rsvp.id,
        event_id=rsvp.event_id,
        user_id=rsvp.user_id,
        status=rsvp.status.value,
        guest_count=rsvp.guest_count,
        notes=rsvp.notes,
        responded_at=rsvp.responded_at,
        updated_at=rsvp.updated_at,
        checked_in=rsvp.checked_in,
        checked_in_at=rsvp.checked_in_at,
        user_name=f"{user.first_name} {user.last_name}" if user else None,
        user_email=user.email if user else None,
    )


@router.post("/{event_id}/add-attendee", response_model=RSVPResponse)
async def manager_add_attendee(
    event_id: UUID,
    attendee_data: ManagerAddAttendee,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Add an attendee to an event (manager action)

    Allows managers to add someone to an event and optionally mark them checked in.
    Useful for members who had trouble logging in or scanning the QR code.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    rsvp, error = await service.manager_add_attendee(
        event_id=event_id,
        user_id=attendee_data.user_id,
        organization_id=current_user.organization_id,
        manager_id=current_user.id,
        status=attendee_data.status,
        checked_in=attendee_data.checked_in,
        notes=attendee_data.notes,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == rsvp.user_id)
    )
    user = user_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="event_attendee_added",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "added_user_id": str(attendee_data.user_id),
            "checked_in": attendee_data.checked_in,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return RSVPResponse(
        id=rsvp.id,
        event_id=rsvp.event_id,
        user_id=rsvp.user_id,
        status=rsvp.status.value,
        guest_count=rsvp.guest_count,
        notes=rsvp.notes,
        responded_at=rsvp.responded_at,
        updated_at=rsvp.updated_at,
        checked_in=rsvp.checked_in,
        checked_in_at=rsvp.checked_in_at,
        checked_out_at=rsvp.checked_out_at,
        attendance_duration_minutes=rsvp.attendance_duration_minutes,
        override_check_in_at=rsvp.override_check_in_at,
        override_check_out_at=rsvp.override_check_out_at,
        override_duration_minutes=rsvp.override_duration_minutes,
        user_name=f"{user.first_name} {user.last_name}" if user else None,
        user_email=user.email if user else None,
    )


@router.patch("/{event_id}/rsvps/{user_id}/override", response_model=RSVPResponse)
async def override_rsvp_attendance(
    event_id: UUID,
    user_id: UUID,
    override_data: RSVPOverride,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Override attendance details for an RSVP (manager action)

    Allows managers to correct check-in/check-out times and credit hours
    for attendees who had issues with the automated system.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    rsvp, error = await service.override_rsvp_attendance(
        event_id=event_id,
        user_id=user_id,
        organization_id=current_user.organization_id,
        manager_id=current_user.id,
        override_data=override_data,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == rsvp.user_id)
    )
    user = user_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="event_attendance_override",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "overridden_user_id": str(user_id),
            "override_fields": list(override_data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return RSVPResponse(
        id=rsvp.id,
        event_id=rsvp.event_id,
        user_id=rsvp.user_id,
        status=rsvp.status.value,
        guest_count=rsvp.guest_count,
        notes=rsvp.notes,
        responded_at=rsvp.responded_at,
        updated_at=rsvp.updated_at,
        checked_in=rsvp.checked_in,
        checked_in_at=rsvp.checked_in_at,
        checked_out_at=rsvp.checked_out_at,
        attendance_duration_minutes=rsvp.attendance_duration_minutes,
        override_check_in_at=rsvp.override_check_in_at,
        override_check_out_at=rsvp.override_check_out_at,
        override_duration_minutes=rsvp.override_duration_minutes,
        user_name=f"{user.first_name} {user.last_name}" if user else None,
        user_email=user.email if user else None,
    )


@router.get("/{event_id}/stats", response_model=EventStats)
async def get_event_stats(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Get statistics for an event

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    stats = await service.get_event_stats(
        event_id=event_id,
        organization_id=current_user.organization_id,
    )

    if not stats:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    return stats


@router.post("/{event_id}/record-times", response_model=EventResponse)
async def record_actual_times(
    event_id: UUID,
    times_data: RecordActualTimes,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Record actual start and end times for an event

    This allows the secretary to record when the event actually started and ended,
    so attendance duration can be accurately calculated for all checked-in members.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    event, error = await service.record_actual_times(
        event_id=event_id,
        organization_id=current_user.organization_id,
        actual_start_time=times_data.actual_start_time,
        actual_end_time=times_data.actual_end_time,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return _build_event_response(event)


# ============================================
# QR Code Self Check-In Endpoints
# ============================================

@router.get("/{event_id}/qr-check-in-data", response_model=QRCheckInData)
async def get_qr_check_in_data(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get QR code check-in data for an event

    Returns the check-in URL and validates that the event is within the valid time window
    (1 hour before start until actual_end_time or scheduled end_datetime).

    This endpoint is accessible to all authenticated members.

    **Authentication required**
    """
    service = EventService(db)
    data, error = await service.get_qr_check_in_data(
        event_id=event_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return QRCheckInData(**data)


@router.post("/{event_id}/self-check-in", response_model=RSVPResponse)
async def self_check_in(
    event_id: UUID,
    check_in_data: Optional[SelfCheckInRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Allow a user to check themselves in or out of an event via QR code

    This endpoint validates the time window and checks in/out the authenticated user.
    If the user doesn't have an RSVP, one will be created automatically on check-in.

    Set `is_checkout: true` in the request body to check out.

    **Authentication required**
    """
    service = EventService(db)
    is_checkout = check_in_data.is_checkout if check_in_data else False

    rsvp, error = await service.self_check_in(
        event_id=event_id,
        user_id=current_user.id,
        organization_id=current_user.organization_id,
        is_checkout=is_checkout,
    )

    if error:
        # Special case: already checked in - return success with message
        if error == "ALREADY_CHECKED_IN":
            # Get user details
            user_result = await db.execute(
                select(User).where(User.id == rsvp.user_id)
            )
            user = user_result.scalar_one_or_none()

            response = RSVPResponse(
                id=rsvp.id,
                event_id=rsvp.event_id,
                user_id=rsvp.user_id,
                status=rsvp.status.value,
                guest_count=rsvp.guest_count,
                notes=rsvp.notes,
                responded_at=rsvp.responded_at,
                updated_at=rsvp.updated_at,
                checked_in=rsvp.checked_in,
                checked_in_at=rsvp.checked_in_at,
                checked_out_at=rsvp.checked_out_at,
                attendance_duration_minutes=rsvp.attendance_duration_minutes,
                user_name=f"{user.first_name} {user.last_name}" if user else None,
                user_email=user.email if user else None,
            )
            # Add custom header to indicate already checked in
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=response.model_dump(mode='json'),
                headers={"X-Already-Checked-In": "true"}
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == rsvp.user_id)
    )
    user = user_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="event_checkout" if is_checkout else "event_checkin",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "action": "self_checkout" if is_checkout else "self_checkin",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return RSVPResponse(
        id=rsvp.id,
        event_id=rsvp.event_id,
        user_id=rsvp.user_id,
        status=rsvp.status.value,
        guest_count=rsvp.guest_count,
        notes=rsvp.notes,
        responded_at=rsvp.responded_at,
        updated_at=rsvp.updated_at,
        checked_in=rsvp.checked_in,
        checked_in_at=rsvp.checked_in_at,
        checked_out_at=rsvp.checked_out_at,
        attendance_duration_minutes=rsvp.attendance_duration_minutes,
        user_name=f"{user.first_name} {user.last_name}" if user else None,
        user_email=user.email if user else None,
    )


@router.get("/{event_id}/check-in-monitoring", response_model=CheckInMonitoringStats)
async def get_check_in_monitoring(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Get real-time check-in monitoring statistics for an event.

    Provides event managers with real-time visibility into check-in activity.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)

    stats, error = await service.get_check_in_monitoring_stats(
        event_id=event_id,
        organization_id=current_user.organization_id
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return stats


# ============================================
# Event Template Endpoints
# ============================================

@router.post("/templates", response_model=EventTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_event_template(
    template_data: EventTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create an event template

    Templates allow departments to save reusable event configurations.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    data = template_data.model_dump(exclude_unset=True)
    template = await service.create_template(
        template_data=data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )
    return EventTemplateResponse.model_validate(template)


@router.get("/templates", response_model=List[EventTemplateResponse])
async def list_event_templates(
    include_inactive: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    List all event templates

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    templates = await service.list_templates(
        organization_id=current_user.organization_id,
        include_inactive=include_inactive,
        skip=skip,
        limit=limit,
    )
    return [EventTemplateResponse.model_validate(t) for t in templates]


@router.get("/templates/{template_id}", response_model=EventTemplateResponse)
async def get_event_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Get a specific event template

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    template = await service.get_template(
        template_id=template_id,
        organization_id=current_user.organization_id,
    )
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )
    return EventTemplateResponse.model_validate(template)


@router.patch("/templates/{template_id}", response_model=EventTemplateResponse)
async def update_event_template(
    template_id: UUID,
    update_data: EventTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Update an event template

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    data = update_data.model_dump(exclude_unset=True)
    template = await service.update_template(
        template_id=template_id,
        organization_id=current_user.organization_id,
        update_data=data,
        updated_by=current_user.id,
    )
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )
    return EventTemplateResponse.model_validate(template)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Deactivate an event template

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    success = await service.delete_template(
        template_id=template_id,
        organization_id=current_user.organization_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found"
        )


# ============================================
# Recurring Event Endpoints
# ============================================

@router.post("/recurring", response_model=List[EventResponse], status_code=status.HTTP_201_CREATED)
async def create_recurring_event(
    recurring_data: RecurringEventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create a recurring event series

    Generates individual event instances based on the recurrence pattern.
    Each instance can be independently managed (edited, cancelled, etc.).

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = EventService(db)
    data = recurring_data.model_dump(exclude_unset=True)

    events, error = await service.create_recurring_event(
        event_data=data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return [_build_event_response(event) for event in events]


# ============================================
# Event Attachment Endpoints
# ============================================

ATTACHMENT_UPLOAD_DIR = "/app/uploads/event-attachments"
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".gif"}
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25MB


@router.post("/{event_id}/attachments")
async def upload_event_attachment(
    event_id: UUID,
    file: UploadFile = File(...),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Upload an attachment to an event (e.g., readahead materials)

    **Authentication required**
    **Requires permission: events.manage**
    """
    # Verify event exists
    service = EventService(db)
    result = await db.execute(
        select(Event)
        .where(Event.id == str(event_id))
        .where(Event.organization_id == str(current_user.organization_id))
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Validate file extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 25MB.")

    # Save file
    org_dir = os.path.join(ATTACHMENT_UPLOAD_DIR, str(current_user.organization_id), str(event_id))
    os.makedirs(org_dir, exist_ok=True)

    unique_name = f"{uuid_lib.uuid4().hex}{ext}"
    file_path = os.path.join(org_dir, unique_name)

    with open(file_path, "wb") as f:
        f.write(content)

    # Update event attachments list
    attachments = event.attachments or []
    attachments.append({
        "id": uuid_lib.uuid4().hex,
        "file_name": file.filename or unique_name,
        "file_path": file_path,
        "file_size": len(content),
        "file_type": file.content_type,
        "description": description,
        "uploaded_by": str(current_user.id),
        "uploaded_at": datetime.utcnow().isoformat(),
    })
    event.attachments = attachments
    event.updated_at = datetime.utcnow()

    await db.commit()

    return {
        "message": "Attachment uploaded successfully",
        "attachment": attachments[-1],
        "total_attachments": len(attachments),
    }


@router.get("/{event_id}/attachments")
async def list_event_attachments(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all attachments for an event

    **Authentication required**
    """
    result = await db.execute(
        select(Event)
        .where(Event.id == str(event_id))
        .where(Event.organization_id == str(current_user.organization_id))
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return event.attachments or []


@router.get("/{event_id}/attachments/{attachment_id}/download")
async def download_event_attachment(
    event_id: UUID,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Download a specific event attachment

    **Authentication required**
    """
    result = await db.execute(
        select(Event)
        .where(Event.id == str(event_id))
        .where(Event.organization_id == str(current_user.organization_id))
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    attachments = event.attachments or []
    attachment = next((a for a in attachments if a.get("id") == attachment_id), None)

    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = attachment["file_path"]

    # Security: Validate file_path is within the expected upload directory
    # to prevent path traversal attacks if database data is compromised
    resolved_path = os.path.realpath(file_path)
    allowed_base = os.path.realpath(ATTACHMENT_UPLOAD_DIR)
    if not resolved_path.startswith(allowed_base + os.sep) and resolved_path != allowed_base:
        logger.warning(f"Path traversal attempt blocked: {file_path} resolved to {resolved_path}")
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="Attachment file not found on disk")

    return FileResponse(
        path=resolved_path,
        filename=attachment.get("file_name", "download"),
        media_type=attachment.get("file_type", "application/octet-stream"),
    )


@router.delete("/{event_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_attachment(
    event_id: UUID,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Delete an event attachment

    **Authentication required**
    **Requires permission: events.manage**
    """
    result = await db.execute(
        select(Event)
        .where(Event.id == str(event_id))
        .where(Event.organization_id == str(current_user.organization_id))
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    attachments = event.attachments or []
    attachment = next((a for a in attachments if a.get("id") == attachment_id), None)

    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Remove file from disk
    file_path = attachment["file_path"]
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError as e:
        logger.warning(f"Failed to remove attachment file {file_path}: {e}")

    # Remove from attachments list
    event.attachments = [a for a in attachments if a.get("id") != attachment_id]
    event.updated_at = datetime.utcnow()

    await db.commit()


# ============================================================================
# Event Folder Endpoint (Document Management Integration)
# ============================================================================

@router.get("/{event_id}/folder", response_model=DocumentFolderResponse)
async def get_event_folder(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    """
    Get (or auto-create) the document folder for an event.

    Returns the folder under 'Event Attachments' where documents
    for this event can be stored.

    **Permissions required:** events.view
    """
    service = EventService(db)
    event, _ = await service.get_event(event_id, current_user.organization_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    docs_service = DocumentsService(db)
    folder = await docs_service.ensure_event_folder(
        organization_id=current_user.organization_id,
        event_id=str(event_id),
        event_title=event.title,
    )
    await db.commit()

    from sqlalchemy import func as sa_func
    from app.models.document import Document, DocumentStatus
    count_result = await db.execute(
        select(sa_func.count(Document.id))
        .where(Document.folder_id == folder.id)
        .where(Document.status == DocumentStatus.ACTIVE)
    )
    folder.document_count = count_result.scalar() or 0

    return {
        **{c.key: getattr(folder, c.key) for c in folder.__table__.columns},
        "document_count": folder.document_count,
    }


# ============================================
# External Attendees (for public outreach events)
# ============================================

from pydantic import BaseModel, EmailStr
from app.models.event import EventExternalAttendee
from app.core.utils import generate_uuid


class ExternalAttendeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    notes: Optional[str] = None


class ExternalAttendeeResponse(BaseModel):
    id: str
    event_id: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    checked_in: bool = False
    checked_in_at: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    created_at: str


@router.get("/{event_id}/external-attendees", response_model=List[ExternalAttendeeResponse])
async def list_external_attendees(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """List all external (non-member) attendees for an event."""
    result = await db.execute(
        select(EventExternalAttendee)
        .where(
            EventExternalAttendee.event_id == str(event_id),
            EventExternalAttendee.organization_id == current_user.organization_id,
        )
        .order_by(EventExternalAttendee.name)
    )
    attendees = result.scalars().all()
    return [
        ExternalAttendeeResponse(
            id=a.id,
            event_id=a.event_id,
            name=a.name,
            email=a.email,
            phone=a.phone,
            organization_name=a.organization_name,
            checked_in=a.checked_in,
            checked_in_at=a.checked_in_at.isoformat() if a.checked_in_at else None,
            source=a.source,
            notes=a.notes,
            created_at=a.created_at.isoformat() if a.created_at else "",
        )
        for a in attendees
    ]


@router.post("/{event_id}/external-attendees", response_model=ExternalAttendeeResponse, status_code=status.HTTP_201_CREATED)
async def add_external_attendee(
    event_id: UUID,
    data: ExternalAttendeeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Add an external (non-member) attendee to an event."""
    # Verify event exists
    event = await db.execute(
        select(Event).where(
            Event.id == str(event_id),
            Event.organization_id == current_user.organization_id,
        )
    )
    if not event.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Event not found")

    attendee = EventExternalAttendee(
        id=generate_uuid(),
        organization_id=current_user.organization_id,
        event_id=str(event_id),
        name=data.name,
        email=data.email,
        phone=data.phone,
        organization_name=data.organization_name,
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(attendee)
    await db.commit()
    await db.refresh(attendee)

    return ExternalAttendeeResponse(
        id=attendee.id,
        event_id=attendee.event_id,
        name=attendee.name,
        email=attendee.email,
        phone=attendee.phone,
        organization_name=attendee.organization_name,
        checked_in=attendee.checked_in,
        checked_in_at=None,
        source=attendee.source,
        notes=attendee.notes,
        created_at=attendee.created_at.isoformat() if attendee.created_at else "",
    )


class ExternalAttendeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    organization_name: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{event_id}/external-attendees/{attendee_id}", response_model=ExternalAttendeeResponse)
async def update_external_attendee(
    event_id: UUID,
    attendee_id: UUID,
    data: ExternalAttendeeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Update an external attendee's information."""
    result = await db.execute(
        select(EventExternalAttendee).where(
            EventExternalAttendee.id == str(attendee_id),
            EventExternalAttendee.event_id == str(event_id),
            EventExternalAttendee.organization_id == current_user.organization_id,
        )
    )
    attendee = result.scalar_one_or_none()
    if not attendee:
        raise HTTPException(status_code=404, detail="External attendee not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(attendee, field, value)

    await db.commit()
    await db.refresh(attendee)

    return ExternalAttendeeResponse(
        id=attendee.id,
        event_id=attendee.event_id,
        name=attendee.name,
        email=attendee.email,
        phone=attendee.phone,
        organization_name=attendee.organization_name,
        checked_in=attendee.checked_in,
        checked_in_at=attendee.checked_in_at.isoformat() if attendee.checked_in_at else None,
        source=attendee.source,
        notes=attendee.notes,
        created_at=attendee.created_at.isoformat() if attendee.created_at else "",
    )


@router.patch("/{event_id}/external-attendees/{attendee_id}/check-in")
async def check_in_external_attendee(
    event_id: UUID,
    attendee_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Check in an external attendee at an event."""
    result = await db.execute(
        select(EventExternalAttendee).where(
            EventExternalAttendee.id == str(attendee_id),
            EventExternalAttendee.event_id == str(event_id),
            EventExternalAttendee.organization_id == current_user.organization_id,
        )
    )
    attendee = result.scalar_one_or_none()
    if not attendee:
        raise HTTPException(status_code=404, detail="External attendee not found")

    attendee.checked_in = True
    attendee.checked_in_at = datetime.now(dt_timezone.utc)
    await db.commit()
    return {"status": "checked_in", "attendee_id": attendee.id}


@router.delete("/{event_id}/external-attendees/{attendee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_external_attendee(
    event_id: UUID,
    attendee_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Remove an external attendee from an event."""
    result = await db.execute(
        select(EventExternalAttendee).where(
            EventExternalAttendee.id == str(attendee_id),
            EventExternalAttendee.event_id == str(event_id),
            EventExternalAttendee.organization_id == current_user.organization_id,
        )
    )
    attendee = result.scalar_one_or_none()
    if not attendee:
        raise HTTPException(status_code=404, detail="External attendee not found")

    await db.delete(attendee)
    await db.commit()


# ============================================
# Event Module Settings
# ============================================

from app.models.user import Organization

EVENT_SETTINGS_DEFAULTS = {
    "enabled_event_types": [
        "business_meeting", "public_education", "training",
        "social", "fundraiser", "ceremony", "other",
    ],
    "event_type_labels": {},
    "defaults": {
        "event_type": "other",
        "check_in_window_type": "flexible",
        "check_in_minutes_before": 30,
        "check_in_minutes_after": 15,
        "require_checkout": False,
        "requires_rsvp": False,
        "allowed_rsvp_statuses": ["going", "not_going"],
        "allow_guests": False,
        "is_mandatory": False,
        "send_reminders": True,
        "reminder_schedule": [24],
        "default_duration_minutes": 60,
    },
    "qr_code": {
        "show_event_description": True,
        "show_location_details": True,
        "custom_instructions": "",
    },
    "cancellation": {
        "require_reason": True,
        "notify_attendees": True,
    },
}


@router.get("/settings")
async def get_event_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Get event module settings for the organization.

    **Authentication required**
    **Requires permission: events.manage**
    """
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    settings = (org.settings or {}).get("events", {})
    # Merge with defaults so frontend always gets a complete object
    merged = {**EVENT_SETTINGS_DEFAULTS}
    for key, default_val in EVENT_SETTINGS_DEFAULTS.items():
        if key in settings:
            if isinstance(default_val, dict):
                merged[key] = {**default_val, **settings[key]}
            else:
                merged[key] = settings[key]

    return merged


@router.patch("/settings")
async def update_event_settings(
    updates: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Update event module settings for the organization.

    **Authentication required**
    **Requires permission: events.manage**
    """
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    current_settings = dict(org.settings or {})
    current_events = current_settings.get("events", {})

    # Deep merge the updates into existing event settings
    for key, value in updates.items():
        if key in EVENT_SETTINGS_DEFAULTS:
            if isinstance(value, dict) and isinstance(current_events.get(key), dict):
                current_events[key] = {**current_events.get(key, {}), **value}
            else:
                current_events[key] = value

    current_settings["events"] = current_events
    org.settings = current_settings
    await db.commit()
    await db.refresh(org)

    # Return merged result
    merged = {**EVENT_SETTINGS_DEFAULTS}
    for key, default_val in EVENT_SETTINGS_DEFAULTS.items():
        if key in current_events:
            if isinstance(default_val, dict):
                merged[key] = {**default_val, **current_events[key]}
            else:
                merged[key] = current_events[key]

    return merged


# ============================================
# Public Calendar (no auth required)
# ============================================

class PublicEventItem(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    event_type: str
    start_datetime: str
    end_datetime: str
    location: Optional[str] = None
    location_details: Optional[str] = None


@router.get("/public-calendar", response_model=List[PublicEventItem])
async def get_public_calendar(
    organization_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Public-facing event calendar. Returns upcoming public events.
    No authentication required — intended for community-facing portals.
    """
    public_types = [
        EventType.PUBLIC_EDUCATION.value,
        EventType.FUNDRAISER.value,
        EventType.CEREMONY.value,
        EventType.SOCIAL.value,
    ]

    result = await db.execute(
        select(Event)
        .where(
            Event.organization_id == organization_id,
            Event.event_type.in_(public_types),
            Event.start_datetime >= datetime.utcnow(),
            Event.is_cancelled == False,  # noqa: E712
        )
        .order_by(Event.start_datetime.asc())
        .limit(50)
    )
    events = result.scalars().all()

    return [
        PublicEventItem(
            id=e.id,
            title=e.title,
            description=e.description,
            event_type=e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
            start_datetime=e.start_datetime.isoformat(),
            end_datetime=e.end_datetime.isoformat(),
            location=e.location,
            location_details=e.location_details,
        )
        for e in events
    ]
