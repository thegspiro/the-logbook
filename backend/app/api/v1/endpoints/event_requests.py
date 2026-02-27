"""
Event Request API Endpoints

Endpoints for the public outreach event request pipeline.
Includes public submission, admin review, status transitions,
pipeline task completion, assignment, comments, scheduling with
room booking, postponement, public cancellation, and email templates.

The pipeline is intentionally fluid — departments configure their own
checklist tasks via settings and work them in whatever order suits
their workflow.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestEmailTemplate,
    EventRequestStatus,
)
from app.models.user import Organization, User
from app.schemas.event_request import (
    EmailTemplateCreate,
    EmailTemplateResponse,
    EmailTemplateUpdate,
    EventRequestAssign,
    EventRequestComment,
    EventRequestCreate,
    EventRequestListItem,
    EventRequestPostpone,
    EventRequestPublicCancel,
    EventRequestPublicStatus,
    EventRequestResponse,
    EventRequestSchedule,
    EventRequestStatusUpdate,
    SendTemplateEmail,
    TaskCompletionUpdate,
)

router = APIRouter(prefix="/event-requests", tags=["event-requests"])


def _get_outreach_types_from_settings(org: Organization) -> List[Dict[str, str]]:
    """Read outreach event types from organization settings, falling back to defaults."""
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    settings = (org.settings or {}).get("events", {})
    return settings.get(
        "outreach_event_types", EVENT_SETTINGS_DEFAULTS["outreach_event_types"]
    )


def _get_pipeline_settings(org: Organization) -> dict:
    """Read pipeline settings from organization, falling back to defaults."""
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    settings = (org.settings or {}).get("events", {})
    defaults = EVENT_SETTINGS_DEFAULTS["request_pipeline"]
    stored = settings.get("request_pipeline", {})
    return {**defaults, **stored}


async def _get_user_name(db: AsyncSession, user_id: str) -> Optional[str]:
    """Look up a user's display name."""
    result = await db.execute(
        select(User.first_name, User.last_name).where(User.id == user_id)
    )
    row = result.first()
    if row:
        return f"{row[0]} {row[1]}".strip()
    return None


async def _get_location_name(db: AsyncSession, location_id: str) -> Optional[str]:
    """Look up a location name."""
    from app.models.location import Location

    result = await db.execute(select(Location.name).where(Location.id == location_id))
    row = result.first()
    return row[0] if row else None


async def _send_request_notification(
    db: AsyncSession,
    event_request: EventRequest,
    trigger_key: str,
    org: Organization,
    extra_context: Optional[dict] = None,
) -> None:
    """
    Send email notification based on pipeline trigger settings.

    Reads trigger config from org settings, sends to requester and/or assignee
    as configured. Failures are logged but do not block the request.
    """
    try:
        from app.services.email_service import EmailService
        from app.services.notifications_service import NotificationsService

        pipeline = _get_pipeline_settings(org)
        triggers = pipeline.get("email_triggers", {})
        trigger_config = triggers.get(trigger_key, {})

        if not trigger_config.get("enabled", False):
            return

        email_service = EmailService(organization=org)
        notifications_service = NotificationsService(db)

        status_labels = {
            "submitted": "Submitted",
            "in_progress": "In Progress",
            "scheduled": "Scheduled",
            "postponed": "Postponed",
            "completed": "Completed",
            "declined": "Declined",
            "cancelled": "Cancelled",
        }
        status_label = status_labels.get(
            event_request.status.value, event_request.status.value
        )

        # Notify the requester
        if trigger_config.get("notify_requester", False):
            subject = f"Event Request Update — {status_label}"
            body = f"""<p>Hello {event_request.contact_name},</p>
<p>Your event request has been updated to: <strong>{status_label}</strong>.</p>"""
            if event_request.event_date:
                body += f"<p>Scheduled date: <strong>{event_request.event_date.strftime('%B %d, %Y at %I:%M %p')}</strong></p>"
            if event_request.decline_reason:
                body += f"<p>Reason: {event_request.decline_reason}</p>"
            if extra_context and extra_context.get("message"):
                body += f"<p>{extra_context['message']}</p>"
            body += "<p>Thank you for your request.</p>"

            await email_service.send_email(
                to_emails=[event_request.contact_email],
                subject=subject,
                html_body=body,
            )

        # Notify the assigned coordinator
        if trigger_config.get("notify_assignee", False) and event_request.assigned_to:
            assignee_result = await db.execute(
                select(User).where(User.id == event_request.assigned_to)
            )
            assignee = assignee_result.scalar_one_or_none()
            if assignee and assignee.email:
                outreach_label = event_request.outreach_type.replace("_", " ").title()
                subject = f"New Event Request Assigned — {outreach_label}"
                body = f"""<p>Hello {assignee.first_name},</p>
<p>A new event request has been assigned to you:</p>
<ul>
<li><strong>Contact:</strong> {event_request.contact_name}</li>
<li><strong>Type:</strong> {outreach_label}</li>
<li><strong>Organization:</strong> {event_request.organization_name or 'N/A'}</li>
</ul>
<p>Please review and begin processing this request.</p>"""

                await email_service.send_email(
                    to_emails=[assignee.email],
                    subject=subject,
                    html_body=body,
                )

                await notifications_service.log_notification(
                    organization_id=org.id,
                    log_data={
                        "recipient_id": assignee.id,
                        "channel": "email",
                        "category": "events",
                        "trigger": "event_reminder",
                        "subject": subject,
                        "body": f"New event request from {event_request.contact_name}",
                    },
                )
    except Exception:
        # Email failures should not block the request flow
        pass


async def _build_response(
    db: AsyncSession, event_request: EventRequest
) -> EventRequestResponse:
    """Build a full EventRequestResponse from a model instance."""
    assignee_name = None
    if event_request.assigned_to:
        assignee_name = await _get_user_name(db, event_request.assigned_to)

    location_name = None
    if event_request.event_location_id:
        location_name = await _get_location_name(db, event_request.event_location_id)

    activity_items = []
    for entry in event_request.activity_log:
        performer_name = None
        if entry.performed_by:
            performer_name = await _get_user_name(db, entry.performed_by)
        activity_items.append(
            {
                "id": entry.id,
                "action": entry.action,
                "old_status": entry.old_status,
                "new_status": entry.new_status,
                "notes": entry.notes,
                "details": entry.details,
                "performed_by": entry.performed_by,
                "performer_name": performer_name,
                "created_at": entry.created_at,
            }
        )

    return EventRequestResponse(
        id=event_request.id,
        organization_id=event_request.organization_id,
        contact_name=event_request.contact_name,
        contact_email=event_request.contact_email,
        contact_phone=event_request.contact_phone,
        organization_name=event_request.organization_name,
        outreach_type=event_request.outreach_type,
        description=event_request.description,
        date_flexibility=event_request.date_flexibility,
        preferred_date_start=event_request.preferred_date_start,
        preferred_date_end=event_request.preferred_date_end,
        preferred_timeframe=event_request.preferred_timeframe,
        preferred_time_of_day=event_request.preferred_time_of_day,
        audience_size=event_request.audience_size,
        age_group=event_request.age_group,
        venue_preference=event_request.venue_preference,
        venue_address=event_request.venue_address,
        special_requests=event_request.special_requests,
        status=event_request.status.value,
        assigned_to=event_request.assigned_to,
        assignee_name=assignee_name,
        reviewer_notes=event_request.reviewer_notes,
        decline_reason=event_request.decline_reason,
        task_completions=event_request.task_completions,
        event_id=event_request.event_id,
        event_date=event_request.event_date,
        event_end_date=event_request.event_end_date,
        event_location_id=event_request.event_location_id,
        event_location_name=location_name,
        status_token=event_request.status_token,
        created_at=event_request.created_at,
        updated_at=event_request.updated_at,
        activity_log=activity_items,
    )


# Valid status transitions — kept simple; the real workflow detail is in tasks
VALID_TRANSITIONS = {
    EventRequestStatus.SUBMITTED: [
        EventRequestStatus.IN_PROGRESS,
        EventRequestStatus.DECLINED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.IN_PROGRESS: [
        EventRequestStatus.SCHEDULED,
        EventRequestStatus.POSTPONED,
        EventRequestStatus.DECLINED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.SCHEDULED: [
        EventRequestStatus.POSTPONED,
        EventRequestStatus.COMPLETED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.POSTPONED: [
        EventRequestStatus.IN_PROGRESS,
        EventRequestStatus.SCHEDULED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.DECLINED: [],
    EventRequestStatus.CANCELLED: [],
    EventRequestStatus.COMPLETED: [],
}


# ============================================
# Public endpoints (no auth required)
# ============================================


@router.post("/public", status_code=status.HTTP_201_CREATED)
async def submit_public_event_request(
    data: EventRequestCreate,
    request: Request,
    organization_id: str = Query(..., description="Organization ID for the request"),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a public event request.

    No authentication required. Creates an event request that enters
    the review pipeline. Auto-assigns the default coordinator if configured.
    """
    result = await db.execute(
        select(Organization).where(
            Organization.id == organization_id, Organization.active.is_(True)
        )
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check default assignee from pipeline settings
    pipeline = _get_pipeline_settings(org)
    default_assignee = pipeline.get("default_assignee_id")

    event_request = EventRequest(
        organization_id=organization_id,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        organization_name=data.organization_name,
        outreach_type=data.outreach_type,
        description=data.description,
        date_flexibility=data.date_flexibility,
        preferred_date_start=data.preferred_date_start,
        preferred_date_end=data.preferred_date_end,
        preferred_timeframe=data.preferred_timeframe,
        preferred_time_of_day=data.preferred_time_of_day,
        audience_size=data.audience_size,
        age_group=data.age_group,
        venue_preference=data.venue_preference,
        venue_address=data.venue_address,
        special_requests=data.special_requests,
        status=EventRequestStatus.SUBMITTED,
        assigned_to=default_assignee,
        ip_address=request.client.host if request.client else None,
    )
    db.add(event_request)
    await db.flush()

    activity = EventRequestActivity(
        request_id=event_request.id,
        action="submitted",
        new_status=EventRequestStatus.SUBMITTED.value,
        notes="Request submitted via public form",
    )
    db.add(activity)

    if default_assignee:
        assignee_name = await _get_user_name(db, default_assignee)
        assign_activity = EventRequestActivity(
            request_id=event_request.id,
            action="auto_assigned",
            notes=f"Auto-assigned to {assignee_name or 'default coordinator'}",
            details={"assigned_to": default_assignee},
        )
        db.add(assign_activity)

    await db.commit()
    await db.refresh(event_request)

    # Send notification emails (non-blocking)
    await _send_request_notification(db, event_request, "on_submitted", org)

    return {
        "message": "Your event request has been submitted. You will receive updates at the provided email.",
        "status_token": event_request.status_token,
        "request_id": event_request.id,
    }


@router.get("/status/{token}", response_model=EventRequestPublicStatus)
async def check_request_status(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Check event request status using a status token.

    No authentication required. Returns limited public-facing information.
    Pipeline progress is included if the department has enabled public visibility.
    """
    result = await db.execute(
        select(EventRequest).where(EventRequest.status_token == token)
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Request not found")

    # Check if department wants to show progress publicly
    org_result = await db.execute(
        select(Organization).where(Organization.id == event_request.organization_id)
    )
    org = org_result.scalar_one_or_none()
    pipeline = _get_pipeline_settings(org) if org else {}
    show_progress = pipeline.get("public_progress_visible", False)

    task_progress = None
    if show_progress and event_request.task_completions:
        tasks = pipeline.get("tasks", [])
        completed_count = sum(
            1
            for t in tasks
            if event_request.task_completions.get(t["id"], {}).get("completed")
        )
        task_progress = {
            "total": len(tasks),
            "completed": completed_count,
            "tasks": [
                {
                    "label": t["label"],
                    "completed": bool(
                        event_request.task_completions.get(t["id"], {}).get("completed")
                    ),
                }
                for t in tasks
            ],
        }

    # Determine confirmed event date
    event_date = event_request.event_date
    if not event_date and event_request.event_id:
        from app.models.event import Event

        event_result = await db.execute(
            select(Event.start_datetime).where(Event.id == event_request.event_id)
        )
        row = event_result.first()
        if row:
            event_date = row[0]

    # Can cancel if not already in a terminal state
    can_cancel = event_request.status not in (
        EventRequestStatus.CANCELLED,
        EventRequestStatus.DECLINED,
        EventRequestStatus.COMPLETED,
    )

    return EventRequestPublicStatus(
        contact_name=event_request.contact_name,
        outreach_type=event_request.outreach_type,
        status=event_request.status.value,
        date_flexibility=event_request.date_flexibility,
        preferred_date_start=event_request.preferred_date_start,
        preferred_date_end=event_request.preferred_date_end,
        preferred_timeframe=event_request.preferred_timeframe,
        created_at=event_request.created_at,
        updated_at=event_request.updated_at,
        event_date=event_date,
        decline_reason=event_request.decline_reason,
        task_progress=task_progress,
        can_cancel=can_cancel,
    )


@router.post("/status/{token}/cancel")
async def public_cancel_request(
    token: str,
    data: EventRequestPublicCancel,
    db: AsyncSession = Depends(get_db),
):
    """
    Allow a requester to cancel their own request via the status token.

    No authentication required. Only works on requests that are not
    in a terminal state (completed, declined, already cancelled).
    """
    result = await db.execute(
        select(EventRequest).where(EventRequest.status_token == token)
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Request not found")

    if event_request.status in (
        EventRequestStatus.CANCELLED,
        EventRequestStatus.DECLINED,
        EventRequestStatus.COMPLETED,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a {event_request.status.value} request",
        )

    old_status = event_request.status.value
    event_request.status = EventRequestStatus.CANCELLED

    activity = EventRequestActivity(
        request_id=event_request.id,
        action="cancelled_by_requester",
        old_status=old_status,
        new_status=EventRequestStatus.CANCELLED.value,
        notes=data.reason or "Cancelled by requester",
    )
    db.add(activity)
    await db.commit()

    # Notify department
    org_result = await db.execute(
        select(Organization).where(Organization.id == event_request.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if org:
        await _send_request_notification(db, event_request, "on_cancelled", org)

    return {"message": "Your request has been cancelled.", "status": "cancelled"}


# ============================================
# Admin endpoints (auth required)
# ============================================


@router.get("", response_model=List[EventRequestListItem])
async def list_event_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    outreach_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """List event requests for the organization."""
    query = select(EventRequest).where(
        EventRequest.organization_id == current_user.organization_id
    )

    if status_filter:
        query = query.where(EventRequest.status == status_filter)
    if outreach_type:
        query = query.where(EventRequest.outreach_type == outreach_type)

    query = query.order_by(EventRequest.created_at.desc())
    result = await db.execute(query)
    requests = result.scalars().all()

    items = []
    for req in requests:
        assignee_name = None
        if req.assigned_to:
            assignee_name = await _get_user_name(db, req.assigned_to)

        items.append(
            EventRequestListItem(
                id=req.id,
                contact_name=req.contact_name,
                contact_email=req.contact_email,
                organization_name=req.organization_name,
                outreach_type=req.outreach_type,
                status=req.status.value,
                date_flexibility=req.date_flexibility,
                preferred_date_start=req.preferred_date_start,
                preferred_timeframe=req.preferred_timeframe,
                audience_size=req.audience_size,
                assigned_to=req.assigned_to,
                assignee_name=assignee_name,
                task_completions=req.task_completions,
                event_date=req.event_date,
                created_at=req.created_at,
            )
        )

    return items


@router.get("/{request_id}", response_model=EventRequestResponse)
async def get_event_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Get full details of an event request."""
    result = await db.execute(
        select(EventRequest)
        .options(selectinload(EventRequest.activity_log))
        .where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    return await _build_response(db, event_request)


@router.patch("/{request_id}/status")
async def update_event_request_status(
    request_id: str,
    update: EventRequestStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Update the status of an event request."""
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    try:
        new_status = EventRequestStatus(update.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {update.status}")

    allowed = VALID_TRANSITIONS.get(event_request.status, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from {event_request.status.value} to {new_status.value}",
        )

    old_status = event_request.status.value
    event_request.status = new_status

    if update.notes:
        event_request.reviewer_notes = update.notes
    if update.decline_reason:
        event_request.decline_reason = update.decline_reason
    if update.assigned_to:
        event_request.assigned_to = update.assigned_to
    if update.event_id:
        event_request.event_id = update.event_id

    activity = EventRequestActivity(
        request_id=event_request.id,
        action=f"status_changed_to_{new_status.value}",
        old_status=old_status,
        new_status=new_status.value,
        notes=update.notes,
        performed_by=current_user.id,
    )
    db.add(activity)
    await db.commit()

    # Send notification
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if org:
        await _send_request_notification(
            db, event_request, f"on_{new_status.value}", org
        )

    return {
        "message": f"Request status updated to {new_status.value}",
        "status": new_status.value,
    }


@router.patch("/{request_id}/assign")
async def assign_request(
    request_id: str,
    data: EventRequestAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Assign or reassign a coordinator to an event request.

    The assigned coordinator receives an email notification.
    """
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    # Validate the assignee exists and is in the same org
    assignee_result = await db.execute(
        select(User).where(
            User.id == data.assigned_to,
            User.organization_id == current_user.organization_id,
        )
    )
    assignee = assignee_result.scalar_one_or_none()
    if not assignee:
        raise HTTPException(status_code=404, detail="User not found")

    old_assignee = event_request.assigned_to
    event_request.assigned_to = data.assigned_to

    assignee_name = f"{assignee.first_name} {assignee.last_name}".strip()
    activity = EventRequestActivity(
        request_id=event_request.id,
        action="assigned",
        notes=data.notes or f"Assigned to {assignee_name}",
        details={
            "assigned_to": data.assigned_to,
            "assignee_name": assignee_name,
            "previous_assignee": old_assignee,
        },
        performed_by=current_user.id,
    )
    db.add(activity)
    await db.commit()

    # Notify the new assignee
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if org:
        await _send_request_notification(db, event_request, "on_submitted", org)

    return {
        "message": f"Request assigned to {assignee_name}",
        "assigned_to": data.assigned_to,
        "assignee_name": assignee_name,
    }


@router.post("/{request_id}/comments")
async def add_comment(
    request_id: str,
    data: EventRequestComment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Add a comment to the request thread.

    Comments are stored as activity log entries with action='comment'.
    Multiple team members can leave notes over time.
    """
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    activity = EventRequestActivity(
        request_id=event_request.id,
        action="comment",
        notes=data.message,
        performed_by=current_user.id,
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)

    performer_name = await _get_user_name(db, current_user.id)

    return {
        "id": activity.id,
        "action": "comment",
        "notes": activity.notes,
        "performed_by": current_user.id,
        "performer_name": performer_name,
        "created_at": activity.created_at.isoformat(),
    }


@router.patch("/{request_id}/schedule")
async def schedule_request(
    request_id: str,
    data: EventRequestSchedule,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Schedule an event request with a confirmed date and optional room.

    Transitions the request to SCHEDULED status, stores the confirmed date,
    and optionally creates a calendar Event with location/room booking
    (which checks for double-booking via LocationService).
    """
    result = await db.execute(
        select(EventRequest)
        .options(selectinload(EventRequest.activity_log))
        .where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    # Must be in a state that can transition to scheduled
    allowed = VALID_TRANSITIONS.get(event_request.status, [])
    if EventRequestStatus.SCHEDULED not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot schedule a request in {event_request.status.value} status",
        )

    old_status = event_request.status.value
    event_request.status = EventRequestStatus.SCHEDULED
    event_request.event_date = data.event_date
    event_request.event_end_date = data.event_end_date
    if data.location_id:
        event_request.event_location_id = data.location_id

    event_id = None
    location_name = None

    # Optionally create a calendar event
    if data.create_calendar_event:
        from app.services.event_service import EventService

        event_service = EventService(db)

        # Get outreach type label for event title
        org_result = await db.execute(
            select(Organization).where(Organization.id == current_user.organization_id)
        )
        org = org_result.scalar_one_or_none()
        outreach_types = _get_outreach_types_from_settings(org) if org else []
        type_label = event_request.outreach_type.replace("_", " ").title()
        for t in outreach_types:
            if t["value"] == event_request.outreach_type:
                type_label = t["label"]
                break

        title = f"{type_label} — {event_request.contact_name}"
        if event_request.organization_name:
            title = f"{type_label} — {event_request.organization_name}"

        end_datetime = data.event_end_date or data.event_date

        # Check for room double-booking if location specified
        if data.location_id:
            from app.services.location_service import LocationService

            loc_service = LocationService(db)
            overlapping = await loc_service.check_overlapping_events(
                location_id=data.location_id,
                organization_id=str(current_user.organization_id),
                start_datetime=data.event_date,
                end_datetime=end_datetime,
            )
            if overlapping:
                raise HTTPException(
                    status_code=409,
                    detail="This room/location is already booked during this time. Please choose a different time or location.",
                )
            location_name = await _get_location_name(db, data.location_id)

        from app.schemas.event import EventCreate

        event_data = EventCreate(
            title=title,
            description=f"Public outreach event request from {event_request.contact_name}.\n\n{event_request.description}",
            event_type="public_education",
            start_datetime=data.event_date,
            end_datetime=end_datetime,
            location_id=data.location_id,
            location=event_request.venue_address,
            requires_rsvp=False,
            is_mandatory=False,
            send_reminders=True,
        )
        event = await event_service.create_event(
            event_data=event_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
        event_request.event_id = event.id
        event_id = event.id

    activity = EventRequestActivity(
        request_id=event_request.id,
        action="scheduled",
        old_status=old_status,
        new_status=EventRequestStatus.SCHEDULED.value,
        notes=data.notes
        or f"Scheduled for {data.event_date.strftime('%B %d, %Y at %I:%M %p')}",
        details={
            "event_date": data.event_date.isoformat(),
            "location_id": data.location_id,
            "location_name": location_name,
            "event_id": event_id,
        },
        performed_by=current_user.id,
    )
    db.add(activity)
    await db.commit()

    # Send notification
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if org:
        await _send_request_notification(db, event_request, "on_scheduled", org)

    return {
        "message": "Request scheduled successfully",
        "status": "scheduled",
        "event_date": data.event_date.isoformat(),
        "event_id": event_id,
    }


@router.patch("/{request_id}/postpone")
async def postpone_request(
    request_id: str,
    data: EventRequestPostpone,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Postpone an event request, optionally setting a new date or leaving it open.

    Can transition from in_progress or scheduled to postponed.
    """
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    allowed = VALID_TRANSITIONS.get(event_request.status, [])
    if EventRequestStatus.POSTPONED not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot postpone a request in {event_request.status.value} status",
        )

    old_status = event_request.status.value
    event_request.status = EventRequestStatus.POSTPONED

    if data.new_event_date:
        event_request.event_date = data.new_event_date
        event_request.event_end_date = data.new_event_end_date
    else:
        # Clear the date — it's TBD
        event_request.event_date = None
        event_request.event_end_date = None

    notes = data.reason or "Request postponed"
    if data.new_event_date:
        notes += (
            f" — tentatively rescheduled to {data.new_event_date.strftime('%B %d, %Y')}"
        )

    activity = EventRequestActivity(
        request_id=event_request.id,
        action="postponed",
        old_status=old_status,
        new_status=EventRequestStatus.POSTPONED.value,
        notes=notes,
        details={
            "reason": data.reason,
            "new_date": (
                data.new_event_date.isoformat() if data.new_event_date else None
            ),
        },
        performed_by=current_user.id,
    )
    db.add(activity)
    await db.commit()

    # Send notification
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if org:
        await _send_request_notification(
            db,
            event_request,
            "on_postponed",
            org,
            extra_context={"message": notes},
        )

    return {"message": notes, "status": "postponed"}


@router.patch("/{request_id}/tasks")
async def update_task_completion(
    request_id: str,
    update: TaskCompletionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Toggle a pipeline task on an event request."""
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    if event_request.status in (
        EventRequestStatus.DECLINED,
        EventRequestStatus.CANCELLED,
        EventRequestStatus.COMPLETED,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update tasks on a {event_request.status.value} request",
        )

    completions = dict(event_request.task_completions or {})

    if update.completed:
        completions[update.task_id] = {
            "completed": True,
            "completed_by": current_user.id,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "notes": update.notes,
        }
    else:
        completions.pop(update.task_id, None)

    event_request.task_completions = completions

    # Auto-transition to in_progress if first task completed while still submitted
    auto_transitioned = False
    if event_request.status == EventRequestStatus.SUBMITTED and update.completed:
        event_request.status = EventRequestStatus.IN_PROGRESS
        auto_transitioned = True

    action = (
        f"task_{'completed' if update.completed else 'uncompleted'}:{update.task_id}"
    )
    activity = EventRequestActivity(
        request_id=event_request.id,
        action=action,
        notes=update.notes,
        details={"task_id": update.task_id, "completed": update.completed},
        performed_by=current_user.id,
    )
    if auto_transitioned:
        activity.old_status = EventRequestStatus.SUBMITTED.value
        activity.new_status = EventRequestStatus.IN_PROGRESS.value
    db.add(activity)
    await db.commit()

    return {
        "message": f"Task '{update.task_id}' {'completed' if update.completed else 'uncompleted'}",
        "task_completions": completions,
        "status": event_request.status.value,
    }


@router.post("/{request_id}/send-email")
async def send_template_email(
    request_id: str,
    data: SendTemplateEmail,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Manually send a template email to the requester.

    Useful for sending pre-written messages like directions, volunteer
    signup instructions, or other standard communications.
    """
    result = await db.execute(
        select(EventRequest).where(
            EventRequest.id == request_id,
            EventRequest.organization_id == current_user.organization_id,
        )
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Event request not found")

    template_result = await db.execute(
        select(EventRequestEmailTemplate).where(
            EventRequestEmailTemplate.id == data.template_id,
            EventRequestEmailTemplate.organization_id == current_user.organization_id,
        )
    )
    template = template_result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Email template not found")

    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()

    try:
        from app.services.email_service import EmailService

        email_service = EmailService(organization=org)

        # Simple variable substitution in subject and body
        context = {
            "contact_name": event_request.contact_name,
            "outreach_type": event_request.outreach_type.replace("_", " ").title(),
            "organization_name": event_request.organization_name or "",
            "event_date": (
                event_request.event_date.strftime("%B %d, %Y at %I:%M %p")
                if event_request.event_date
                else "TBD"
            ),
        }
        if data.additional_context:
            context.update(data.additional_context)

        subject = template.subject
        body = template.body_html
        for key, value in context.items():
            subject = subject.replace(f"{{{{{key}}}}}", value)
            body = body.replace(f"{{{{{key}}}}}", value)

        await email_service.send_email(
            to_emails=[event_request.contact_email],
            subject=subject,
            html_body=body,
            text_body=template.body_text,
        )

        # Log the email send
        activity = EventRequestActivity(
            request_id=event_request.id,
            action="email_sent",
            notes=f"Sent template: {template.name}",
            details={"template_id": template.id, "template_name": template.name},
            performed_by=current_user.id,
        )
        db.add(activity)
        await db.commit()

        return {
            "message": f"Email '{template.name}' sent to {event_request.contact_email}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


# ============================================
# Email Template CRUD
# ============================================


@router.get("/email-templates", response_model=List[EmailTemplateResponse])
async def list_email_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """List all email templates for the organization."""
    result = await db.execute(
        select(EventRequestEmailTemplate)
        .where(
            EventRequestEmailTemplate.organization_id == current_user.organization_id
        )
        .order_by(EventRequestEmailTemplate.name)
    )
    return result.scalars().all()


@router.post(
    "/email-templates",
    response_model=EmailTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_email_template(
    data: EmailTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Create a new email template."""
    template = EventRequestEmailTemplate(
        organization_id=current_user.organization_id,
        name=data.name,
        subject=data.subject,
        body_html=data.body_html,
        body_text=data.body_text,
        trigger=data.trigger,
        trigger_days_before=data.trigger_days_before,
        created_by=current_user.id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.patch("/email-templates/{template_id}", response_model=EmailTemplateResponse)
async def update_email_template(
    template_id: str,
    data: EmailTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Update an email template."""
    result = await db.execute(
        select(EventRequestEmailTemplate).where(
            EventRequestEmailTemplate.id == template_id,
            EventRequestEmailTemplate.organization_id == current_user.organization_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Email template not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/email-templates/{template_id}")
async def delete_email_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """Delete an email template."""
    result = await db.execute(
        select(EventRequestEmailTemplate).where(
            EventRequestEmailTemplate.id == template_id,
            EventRequestEmailTemplate.organization_id == current_user.organization_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Email template not found")

    await db.delete(template)
    await db.commit()
    return {"message": "Template deleted"}


# ============================================
# Utility endpoints
# ============================================


@router.get("/types/labels")
async def get_outreach_type_labels(
    organization_id: Optional[str] = Query(
        None, description="Organization ID to get types for"
    ),
    db: AsyncSession = Depends(get_db),
):
    """Get labels for outreach event types. No auth required."""
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    if organization_id:
        result = await db.execute(
            select(Organization).where(
                Organization.id == organization_id, Organization.active.is_(True)
            )
        )
        org = result.scalar_one_or_none()
        if org:
            types = _get_outreach_types_from_settings(org)
            return {t["value"]: t["label"] for t in types}

    default_types = EVENT_SETTINGS_DEFAULTS["outreach_event_types"]
    return {t["value"]: t["label"] for t in default_types}


@router.post("/generate-form")
async def generate_event_request_form(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Generate a public event request form in the Forms module.

    Creates a pre-configured form with all fields needed for public
    event requests, including flexible date preference fields.
    """
    from app.models.forms import (
        FieldType,
        Form,
        FormCategory,
        FormField,
        FormIntegration,
        FormStatus,
        IntegrationTarget,
        IntegrationType,
    )

    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    outreach_types = _get_outreach_types_from_settings(org)
    outreach_options = [
        {"value": t["value"], "label": t["label"]} for t in outreach_types
    ]
    venue_options = [
        {"value": "their_location", "label": "Our Location"},
        {"value": "our_station", "label": "Your Station"},
        {"value": "either", "label": "Either"},
    ]
    date_flexibility_options = [
        {"value": "specific_dates", "label": "I have specific dates in mind"},
        {"value": "general_timeframe", "label": "I have a general timeframe"},
        {"value": "flexible", "label": "I'm flexible — you pick the date"},
    ]
    time_of_day_options = [
        {"value": "morning", "label": "Morning"},
        {"value": "afternoon", "label": "Afternoon"},
        {"value": "evening", "label": "Evening"},
        {"value": "flexible", "label": "Flexible"},
    ]

    form = Form(
        organization_id=current_user.organization_id,
        name="Request a Public Event",
        description="Submit a request for our department to host or participate in a public outreach event.",
        category=FormCategory.ADMINISTRATION,
        is_public=True,
        require_authentication=False,
        allow_multiple_submissions=True,
        notify_on_submission=True,
        status=FormStatus.DRAFT,
        created_by=current_user.id,
    )
    db.add(form)
    await db.flush()

    field_defs = [
        {
            "label": "Contact Information",
            "field_type": FieldType.SECTION_HEADER,
            "required": False,
        },
        {
            "label": "Your Name",
            "field_type": FieldType.TEXT,
            "required": True,
            "mapping": "contact_name",
            "placeholder": "Full name",
        },
        {
            "label": "Email Address",
            "field_type": FieldType.EMAIL,
            "required": True,
            "mapping": "contact_email",
            "placeholder": "you@example.com",
        },
        {
            "label": "Phone Number",
            "field_type": FieldType.PHONE,
            "required": False,
            "mapping": "contact_phone",
            "placeholder": "(555) 123-4567",
        },
        {
            "label": "Your Organization",
            "field_type": FieldType.TEXT,
            "required": False,
            "mapping": "organization_name",
            "placeholder": "School, business, or group name",
        },
        {
            "label": "Event Details",
            "field_type": FieldType.SECTION_HEADER,
            "required": False,
        },
        {
            "label": "Type of Event",
            "field_type": FieldType.SELECT,
            "required": True,
            "mapping": "outreach_type",
            "options": outreach_options,
        },
        {
            "label": "Description",
            "field_type": FieldType.TEXTAREA,
            "required": True,
            "mapping": "description",
            "placeholder": "Describe what you're looking for...",
            "min_length": 10,
            "max_length": 2000,
        },
        {
            "label": "Expected Audience Size",
            "field_type": FieldType.TEXT,
            "required": False,
            "mapping": "audience_size",
            "placeholder": "Approximate number of attendees",
        },
        {
            "label": "Age Group",
            "field_type": FieldType.TEXT,
            "required": False,
            "mapping": "age_group",
            "placeholder": "e.g., Elementary school, Adults, All ages",
        },
        {
            "label": "Scheduling Preference",
            "field_type": FieldType.SECTION_HEADER,
            "required": False,
        },
        {
            "label": "Date Flexibility",
            "field_type": FieldType.SELECT,
            "required": True,
            "mapping": "date_flexibility",
            "options": date_flexibility_options,
            "help_text": "How flexible are you on the date? We'll work with you to find the best time.",
        },
        {
            "label": "Preferred Timeframe",
            "field_type": FieldType.TEXT,
            "required": False,
            "mapping": "preferred_timeframe",
            "placeholder": "e.g., A Saturday morning in March, Any weekday after spring break",
            "help_text": "Describe your ideal timing in your own words.",
        },
        {
            "label": "Earliest Date",
            "field_type": FieldType.DATE,
            "required": False,
            "mapping": "preferred_date_start",
            "help_text": "If you have specific dates, what's the earliest?",
        },
        {
            "label": "Latest Date",
            "field_type": FieldType.DATE,
            "required": False,
            "mapping": "preferred_date_end",
            "help_text": "If you have specific dates, what's the latest?",
        },
        {
            "label": "Preferred Time of Day",
            "field_type": FieldType.SELECT,
            "required": False,
            "mapping": "preferred_time_of_day",
            "options": time_of_day_options,
        },
        {
            "label": "Venue & Logistics",
            "field_type": FieldType.SECTION_HEADER,
            "required": False,
        },
        {
            "label": "Venue Preference",
            "field_type": FieldType.SELECT,
            "required": True,
            "mapping": "venue_preference",
            "options": venue_options,
        },
        {
            "label": "Venue Address",
            "field_type": FieldType.TEXTAREA,
            "required": False,
            "mapping": "venue_address",
            "placeholder": "Address if event is at your location",
        },
        {
            "label": "Special Requests",
            "field_type": FieldType.TEXTAREA,
            "required": False,
            "mapping": "special_requests",
            "placeholder": "Any special requirements or requests...",
        },
    ]

    field_mappings = {}
    for i, field_def in enumerate(field_defs):
        mapping = field_def.pop("mapping", None)
        options = field_def.pop("options", None)
        help_text = field_def.pop("help_text", None)

        field = FormField(
            form_id=form.id,
            label=field_def["label"],
            field_type=field_def["field_type"],
            required=field_def["required"],
            sort_order=i,
            placeholder=field_def.get("placeholder"),
            help_text=help_text,
            min_length=field_def.get("min_length"),
            max_length=field_def.get("max_length"),
            options=options,
        )
        db.add(field)
        await db.flush()

        if mapping:
            field_mappings[str(field.id)] = mapping

    integration = FormIntegration(
        form_id=form.id,
        organization_id=current_user.organization_id,
        target_module=IntegrationTarget.EVENTS,
        integration_type=IntegrationType.EVENT_REQUEST,
        field_mappings=field_mappings,
        is_active=True,
    )
    db.add(integration)
    await db.commit()
    await db.refresh(form)

    return {
        "message": "Event request form created successfully",
        "form_id": form.id,
        "public_slug": form.public_slug,
        "public_url": f"/f/{form.public_slug}",
    }
