"""
Training Session API Endpoints

Endpoints for creating and managing training sessions and approvals.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.event import Event
from app.models.training import TrainingSession
from app.models.user import User
from app.schemas.training_session import (
    RecurringTrainingSessionCreate,
    TrainingApprovalRequest,
    TrainingApprovalResponse,
    TrainingSessionCreate,
    TrainingSessionLinkageUpdate,
    TrainingSessionResponse,
)
from app.services.training_session_service import TrainingSessionService

router = APIRouter()


def _session_response(ts: TrainingSession) -> TrainingSessionResponse:
    """Build the response schema from a TrainingSession row.

    One shared constructor so every endpoint carries the same fields — the
    single-create endpoint predated the linkage columns and was still
    returning a response without them (and with counts_toward_certification
    silently defaulted to True).
    """
    return TrainingSessionResponse(
        id=ts.id,
        organization_id=ts.organization_id,
        event_id=ts.event_id,
        course_id=ts.course_id,
        category_id=ts.category_id,
        program_id=ts.program_id,
        phase_id=ts.phase_id,
        requirement_id=ts.requirement_id,
        course_name=ts.course_name,
        course_code=ts.course_code,
        training_type=ts.training_type.value,
        credit_hours=ts.credit_hours,
        instructor=ts.instructor,
        instructor_id=ts.instructor_id,
        co_instructors=ts.co_instructors,
        apparatus_id=ts.apparatus_id,
        issues_certification=ts.issues_certification,
        certification_number_prefix=ts.certification_number_prefix,
        issuing_agency=ts.issuing_agency,
        expiration_months=ts.expiration_months,
        counts_toward_certification=ts.counts_toward_certification,
        auto_create_records=ts.auto_create_records,
        require_completion_confirmation=ts.require_completion_confirmation,
        approval_deadline_days=ts.approval_deadline_days,
        is_finalized=ts.is_finalized,
        finalized_at=ts.finalized_at,
        finalized_by=ts.finalized_by,
        created_at=ts.created_at,
        updated_at=ts.updated_at,
        created_by=ts.created_by,
    )


@router.post(
    "", response_model=TrainingSessionResponse, status_code=status.HTTP_201_CREATED
)
async def create_training_session(
    session_data: TrainingSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create a new training session

    This creates both an Event and a TrainingSession record.
    The event will have event_type='training' and include training-specific
    metadata in custom_fields.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    training_session, error = await service.create_training_session(
        session_data=session_data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    await log_audit_event(
        db=db,
        event_type="training_session_created",
        event_category="training",
        severity="info",
        event_data={
            "session_id": str(training_session.id),
            "course_name": training_session.course_name,
            "event_id": str(training_session.event_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _session_response(training_session)


@router.post(
    "/recurring",
    response_model=list[TrainingSessionResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_recurring_training_session(
    session_data: RecurringTrainingSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Create a recurring training session series

    Generates individual training session + event instances based on the
    recurrence pattern. Each instance can be independently managed.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    training_sessions, error = await service.create_recurring_training_session(
        session_data=session_data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    await log_audit_event(
        db=db,
        event_type="training_session_recurring_created",
        event_category="training",
        severity="info",
        event_data={
            "session_count": len(training_sessions),
            "recurrence_pattern": session_data.recurrence_pattern,
            "first_session_id": (
                str(training_sessions[0].id) if training_sessions else None
            ),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return [_session_response(ts) for ts in training_sessions]


@router.get("/by-event/{event_id}", response_model=TrainingSessionResponse)
async def get_training_session_by_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the training session attached to an event

    Lets the event detail page resolve an event's training session (and its
    requirement/program links). Read-only, so any authenticated member of the
    organization may call it.

    **Authentication required**
    """
    service = TrainingSessionService(db)
    training_session = await service.get_session_by_event(
        event_id=event_id,
        organization_id=current_user.organization_id,
    )

    if not training_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No training session found for this event",
        )

    return _session_response(training_session)


@router.patch("/{training_session_id}", response_model=TrainingSessionResponse)
async def update_training_session_linkage(
    training_session_id: UUID,
    updates: TrainingSessionLinkageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Update a training session's requirement/program links

    Omitted fields are left untouched; explicit nulls clear a link. Links
    steer how future attendance is credited — records already written at
    finalization are not reflowed.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    training_session, error = await service.update_session_linkage(
        training_session_id=training_session_id,
        updates=updates,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    await log_audit_event(
        db=db,
        event_type="training_session_updated",
        event_category="training",
        severity="info",
        event_data={
            "session_id": str(training_session_id),
            "action": "linkage_updated",
            "fields": sorted(updates.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _session_response(training_session)


@router.post("/{training_session_id}/finalize")
async def finalize_training_session(
    training_session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Finalize a training session after the event ends

    This triggers the approval workflow by creating a TrainingApproval record
    and sending email notifications to training officers.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    approval, error = await service.finalize_training_session(
        training_session_id=training_session_id,
        organization_id=current_user.organization_id,
        finalized_by=current_user.id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    await log_audit_event(
        db=db,
        event_type="training_session_updated",
        event_category="training",
        severity="info",
        event_data={
            "session_id": str(training_session_id),
            "action": "finalized",
            "approval_id": str(approval.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Training session finalized successfully",
        "approval_id": approval.id,
        "approval_deadline": approval.approval_deadline,
    }


@router.get("/approve/{token}", response_model=TrainingApprovalResponse)
async def get_training_approval(
    token: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Get training approval data by token

    Returns the roster (attendee names/emails) for an officer to review
    before approving. Requires an authenticated officer in the approval's
    organization — the token alone is not sufficient. Gated by
    ``events.manage`` to match the POST approval endpoint and the rest of
    the training-session lifecycle (create/finalize).

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    approval_data, error = await service.get_training_approval_by_token(
        token=token,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    return TrainingApprovalResponse(**approval_data)


@router.post("/approve/{token}")
async def submit_training_approval(
    token: str,
    approval_data: TrainingApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Submit training approval with time adjustments

    Training officers can approve attendance times, adjust check-in/check-out times,
    or override durations for individual members.

    **Authentication required**
    **Requires permission: events.manage**
    """
    service = TrainingSessionService(db)

    success, error = await service.submit_training_approval(
        token=token,
        attendees=approval_data.attendees,
        approval_notes=approval_data.approval_notes,
        approved_by=current_user.id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    await log_audit_event(
        db=db,
        event_type="training_session_approved",
        event_category="training",
        severity="info",
        event_data={
            "token": token,
            "attendee_count": len(approval_data.attendees),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Training approval submitted successfully",
        "status": "approved",
    }


@router.get("/calendar")
async def list_training_sessions_calendar(
    start_after: datetime | None = Query(
        None, description="Filter sessions starting after this datetime"
    ),
    start_before: datetime | None = Query(
        None, description="Filter sessions starting before this datetime"
    ),
    training_type: str | None = Query(None, description="Filter by training type"),
    include_finalized: bool = Query(True, description="Include finalized sessions"),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List training sessions with calendar-relevant event data.

    Returns training sessions joined with their linked Events so the calendar
    can display dates, times, locations, and training metadata together.

    Training events show on the organization calendar alongside other events
    but can be filtered by hall coordinators via the events endpoint's
    `exclude_event_types=training` parameter.

    **Authentication required**
    """
    query = (
        select(TrainingSession)
        .join(Event, TrainingSession.event_id == Event.id)
        .where(TrainingSession.organization_id == str(current_user.organization_id))
        .where(Event.is_cancelled == False)  # noqa: E712
        .options(selectinload(TrainingSession.event))
    )

    if start_after:
        query = query.where(Event.start_datetime >= start_after)
    if start_before:
        query = query.where(Event.start_datetime <= start_before)
    if training_type:
        query = query.where(TrainingSession.training_type == training_type)
    if not include_finalized:
        query = query.where(TrainingSession.is_finalized == False)  # noqa: E712

    query = query.order_by(Event.start_datetime)
    query = query.offset(pagination.skip).limit(pagination.limit)

    result = await db.execute(query)
    sessions = list(result.scalars().all())

    calendar_items = []
    for session in sessions:
        event = session.event
        if not event:
            continue

        calendar_items.append(
            {
                "session_id": str(session.id),
                "event_id": str(session.event_id),
                "title": event.title,
                "course_name": session.course_name,
                "course_code": session.course_code,
                "training_type": (
                    session.training_type.value if session.training_type else None
                ),
                "credit_hours": session.credit_hours,
                "instructor": session.instructor,
                "start_datetime": (
                    event.start_datetime.isoformat() if event.start_datetime else None
                ),
                "end_datetime": (
                    event.end_datetime.isoformat() if event.end_datetime else None
                ),
                "location": event.location,
                "location_id": str(event.location_id) if event.location_id else None,
                "is_mandatory": event.is_mandatory,
                "is_finalized": session.is_finalized,
                "issues_certification": session.issues_certification,
                "requires_rsvp": event.requires_rsvp,
                "max_attendees": event.max_attendees,
            }
        )

    return {
        "count": len(calendar_items),
        "sessions": calendar_items,
    }
