"""
Attendance petitions: a member asks to be marked present at an event that is
over, and the event's organizer (or an event manager) approves or rejects it.

Mounted under ``/events`` alongside the events router. See
``app/services/event_attendance_petition_service.py`` for the rules.
"""

from typing import Dict, List, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.attendance_lock import attendance_lock_http_error
from app.api.dependencies import get_current_user
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.event import EventAttendancePetition
from app.models.user import User
from app.schemas.event import (
    AttendancePetitionApprove,
    AttendancePetitionCreate,
    AttendancePetitionReject,
    AttendancePetitionResponse,
    MyAttendancePetitionResponse,
    PendingAttendancePetitionResponse,
)
from app.services.event_attendance_petition_service import (
    EventAttendancePetitionService,
    PetitionNotFound,
    reviewer_ids,
)
from app.services.event_service import attendance_is_finalized

router = APIRouter()


def _to_response(
    petition: EventAttendancePetition, names: Dict[str, str]
) -> AttendancePetitionResponse:
    status_value = getattr(petition.status, "value", petition.status)
    return AttendancePetitionResponse(
        id=petition.id,
        event_id=petition.event_id,
        user_id=petition.user_id,
        user_name=names.get(str(petition.user_id)),
        status=status_value,
        reason=petition.reason,
        requested_check_in_at=petition.requested_check_in_at,
        requested_check_out_at=petition.requested_check_out_at,
        reviewed_by=petition.reviewed_by,
        reviewed_by_name=(
            names.get(str(petition.reviewed_by)) if petition.reviewed_by else None
        ),
        reviewed_at=petition.reviewed_at,
        review_note=petition.review_note,
        created_at=petition.created_at,
    )


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PetitionNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=safe_error_detail(exc)
        )
    return attendance_lock_http_error(exc) or HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
    )


async def _respond(
    service: EventAttendancePetitionService,
    petition: EventAttendancePetition,
    organization_id,
) -> AttendancePetitionResponse:
    names = await service.display_names(reviewer_ids([petition]), organization_id)
    return _to_response(petition, names)


@router.get(
    "/attendance-petitions/pending",
    response_model=List[PendingAttendancePetitionResponse],
)
async def list_pending_attendance_petitions(
    scope: Literal["mine", "all"] = Query(
        "mine",
        description=(
            "mine: events you organize or are alternate for; all: every event "
            "in the department (events.manage only)"
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pending attendance requests across events, oldest first.

    `scope=mine` (the default) lists requests on events you organize or are
    alternate for. `scope=all` lists every pending request in the department
    and needs events.manage, checked in the handler because the default scope
    is open to any organizer. Your own requests are never listed: nobody
    decides their own.

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        rows = await service.list_pending_for_reviewer(
            current_user, include_all=scope == "all"
        )
    except PermissionError as exc:
        raise _http_error(exc)
    names = await service.display_names(
        reviewer_ids(petition for petition, _ in rows), current_user.organization_id
    )
    return [
        PendingAttendancePetitionResponse(
            **_to_response(petition, names).model_dump(),
            event_title=event.title,
            event_start_datetime=event.start_datetime,
            event_end_datetime=event.end_datetime,
            event_actual_start_time=event.actual_start_time,
            event_actual_end_time=event.actual_end_time,
            attendance_finalized=attendance_is_finalized(event),
        )
        for petition, event in rows
    ]


@router.post(
    "/{event_id}/attendance-petitions",
    response_model=AttendancePetitionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_attendance_petition(
    event_id: UUID,
    data: AttendancePetitionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ask to be marked present at an event you have no check-in for.

    Accepted once the event's check-in window has closed and for 30 days after
    the event ends. One request per member per event. The event's organizer is
    notified (or, failing one, every event manager).

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petition = await service.submit(str(event_id), current_user, data)
    except (PetitionNotFound, PermissionError, ValueError) as exc:
        raise _http_error(exc)

    await log_audit_event(
        db=db,
        event_type="event_attendance_petition_submitted",
        event_category="events",
        severity="info",
        event_data={"event_id": str(event_id), "petition_id": str(petition.id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _respond(service, petition, current_user.organization_id)


@router.get(
    "/{event_id}/attendance-petitions/mine",
    response_model=MyAttendancePetitionResponse,
)
async def get_my_attendance_petition(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Your own attendance request for this event, and whether you may make one.

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petition, unavailable_reason = await service.get_own(
            str(event_id), current_user
        )
    except PetitionNotFound as exc:
        raise _http_error(exc)
    return MyAttendancePetitionResponse(
        petition=(
            await _respond(service, petition, current_user.organization_id)
            if petition is not None
            else None
        ),
        can_request=unavailable_reason is None,
        unavailable_reason=unavailable_reason,
    )


@router.delete(
    "/{event_id}/attendance-petitions/mine",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def withdraw_my_attendance_petition(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Withdraw your own attendance request while it is still pending.

    The request is removed, so you may ask again (within the same rules). A
    request already approved or declined cannot be withdrawn (400).

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petition_id = await service.withdraw(str(event_id), current_user)
    except (PetitionNotFound, ValueError) as exc:
        raise _http_error(exc)

    await log_audit_event(
        db=db,
        event_type="event_attendance_petition_withdrawn",
        event_category="events",
        severity="info",
        event_data={"event_id": str(event_id), "petition_id": petition_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.get(
    "/{event_id}/attendance-petitions",
    response_model=List[AttendancePetitionResponse],
)
async def list_attendance_petitions(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Every attendance request for this event, pending first.

    Limited to the event's organizer and to holders of events.manage — the
    organizer need not hold events.manage, so this is checked in the handler
    rather than by a permission dependency.

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petitions = await service.list_for_event(str(event_id), current_user)
    except (PetitionNotFound, PermissionError) as exc:
        raise _http_error(exc)
    names = await service.display_names(
        reviewer_ids(petitions), current_user.organization_id
    )
    return [_to_response(petition, names) for petition in petitions]


@router.post(
    "/{event_id}/attendance-petitions/{petition_id}/approve",
    response_model=AttendancePetitionResponse,
)
async def approve_attendance_petition(
    event_id: UUID,
    petition_id: UUID,
    data: AttendancePetitionApprove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve an attendance request, recording the confirmed check-in and
    check-out times on the member's RSVP.

    The times are credited when attendance is finalized, as any manager
    correction is. Refused (409) while attendance is finalized: reopen it first.
    Limited to the event's organizer and to holders of events.manage, and never
    the requester themselves.

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petition = await service.approve(
            str(event_id), str(petition_id), current_user, data
        )
    except (PetitionNotFound, PermissionError, ValueError) as exc:
        raise _http_error(exc)

    await log_audit_event(
        db=db,
        event_type="event_attendance_petition_approved",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "petition_id": str(petition_id),
            "member_user_id": str(petition.user_id),
            "check_in_at": data.check_in_at.isoformat(),
            "check_out_at": data.check_out_at.isoformat(),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _respond(service, petition, current_user.organization_id)


@router.post(
    "/{event_id}/attendance-petitions/{petition_id}/reject",
    response_model=AttendancePetitionResponse,
)
async def reject_attendance_petition(
    event_id: UUID,
    petition_id: UUID,
    data: AttendancePetitionReject,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reject an attendance request. The reason is sent to the member.

    Limited to the event's organizer and to holders of events.manage, and never
    the requester themselves.

    **Authentication required**
    """
    service = EventAttendancePetitionService(db)
    try:
        petition = await service.reject(
            str(event_id), str(petition_id), current_user, data
        )
    except (PetitionNotFound, PermissionError, ValueError) as exc:
        raise _http_error(exc)

    await log_audit_event(
        db=db,
        event_type="event_attendance_petition_rejected",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event_id),
            "petition_id": str(petition_id),
            "member_user_id": str(petition.user_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _respond(service, petition, current_user.organization_id)
