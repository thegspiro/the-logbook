"""
Event Request API Endpoints

Endpoints for the public outreach event request pipeline.
Includes public submission, admin review, status transitions,
public status checking, and form template generation.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.user import Organization, User
from app.schemas.event_request import (
    EventRequestCreate,
    EventRequestListItem,
    EventRequestPublicStatus,
    EventRequestResponse,
    EventRequestStatusUpdate,
)

router = APIRouter(prefix="/event-requests", tags=["event-requests"])


def _get_outreach_types_from_settings(org: Organization) -> List[Dict[str, str]]:
    """Read outreach event types from organization settings, falling back to defaults."""
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    settings = (org.settings or {}).get("events", {})
    return settings.get("outreach_event_types", EVENT_SETTINGS_DEFAULTS["outreach_event_types"])

# Valid status transitions
VALID_TRANSITIONS = {
    EventRequestStatus.SUBMITTED: [
        EventRequestStatus.UNDER_REVIEW,
        EventRequestStatus.DECLINED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.UNDER_REVIEW: [
        EventRequestStatus.APPROVED,
        EventRequestStatus.DECLINED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.APPROVED: [
        EventRequestStatus.SCHEDULED,
        EventRequestStatus.CANCELLED,
    ],
    EventRequestStatus.SCHEDULED: [
        EventRequestStatus.COMPLETED,
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
    the review pipeline for the specified organization.
    """
    from app.models.user import Organization

    result = await db.execute(
        select(Organization).where(
            Organization.id == organization_id, Organization.active.is_(True)
        )
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    event_request = EventRequest(
        organization_id=organization_id,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        organization_name=data.organization_name,
        outreach_type=data.outreach_type,
        description=data.description,
        preferred_date_start=data.preferred_date_start,
        preferred_date_end=data.preferred_date_end,
        audience_size=data.audience_size,
        age_group=data.age_group,
        venue_preference=data.venue_preference,
        venue_address=data.venue_address,
        special_requests=data.special_requests,
        status=EventRequestStatus.SUBMITTED,
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
    await db.commit()
    await db.refresh(event_request)

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
    """
    result = await db.execute(
        select(EventRequest).where(EventRequest.status_token == token)
    )
    event_request = result.scalar_one_or_none()
    if not event_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event_date = None
    if event_request.event_id:
        from app.models.event import Event

        event_result = await db.execute(
            select(Event.start_datetime).where(Event.id == event_request.event_id)
        )
        row = event_result.first()
        if row:
            event_date = row[0]

    return EventRequestPublicStatus(
        contact_name=event_request.contact_name,
        outreach_type=event_request.outreach_type,
        status=event_request.status.value,
        preferred_date_start=event_request.preferred_date_start,
        preferred_date_end=event_request.preferred_date_end,
        created_at=event_request.created_at,
        updated_at=event_request.updated_at,
        event_date=event_date,
        decline_reason=event_request.decline_reason,
    )


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
    """
    List event requests for the organization.

    **Authentication required**
    **Requires permission: events.manage**
    """
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
            user_result = await db.execute(
                select(User.first_name, User.last_name).where(User.id == req.assigned_to)
            )
            user_row = user_result.first()
            if user_row:
                assignee_name = f"{user_row[0]} {user_row[1]}".strip()

        items.append(
            EventRequestListItem(
                id=req.id,
                contact_name=req.contact_name,
                contact_email=req.contact_email,
                organization_name=req.organization_name,
                outreach_type=req.outreach_type,
                status=req.status.value,
                preferred_date_start=req.preferred_date_start,
                audience_size=req.audience_size,
                assigned_to=req.assigned_to,
                assignee_name=assignee_name,
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
    """
    Get full details of an event request.

    **Authentication required**
    **Requires permission: events.manage**
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

    assignee_name = None
    if event_request.assigned_to:
        user_result = await db.execute(
            select(User.first_name, User.last_name).where(User.id == event_request.assigned_to)
        )
        user_row = user_result.first()
        if user_row:
            assignee_name = f"{user_row[0]} {user_row[1]}".strip()

    # Build activity log with performer names
    activity_items = []
    for entry in event_request.activity_log:
        performer_name = None
        if entry.performed_by:
            performer_result = await db.execute(
                select(User.first_name, User.last_name).where(User.id == entry.performed_by)
            )
            performer_row = performer_result.first()
            if performer_row:
                performer_name = f"{performer_row[0]} {performer_row[1]}".strip()
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
        preferred_date_start=event_request.preferred_date_start,
        preferred_date_end=event_request.preferred_date_end,
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
        event_id=event_request.event_id,
        status_token=event_request.status_token,
        created_at=event_request.created_at,
        updated_at=event_request.updated_at,
        activity_log=activity_items,
    )


@router.patch("/{request_id}/status")
async def update_event_request_status(
    request_id: str,
    update: EventRequestStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Update the status of an event request (approve, decline, schedule, etc.).

    **Authentication required**
    **Requires permission: events.manage**
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

    try:
        new_status = EventRequestStatus(update.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {update.status}")

    # Validate transition
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

    # Log the activity
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

    return {"message": f"Request status updated to {new_status.value}", "status": new_status.value}


@router.get("/types/labels")
async def get_outreach_type_labels(
    organization_id: Optional[str] = Query(None, description="Organization ID to get types for"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get labels for outreach event types.

    No auth required. Reads from organization settings if organization_id is provided,
    otherwise returns defaults.
    """
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    if organization_id:
        result = await db.execute(
            select(Organization).where(Organization.id == organization_id, Organization.active.is_(True))
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

    Creates a pre-configured form with all the fields needed for public
    event requests, sets it as public, and adds an EVENT_REQUEST integration
    with proper field mappings.

    **Authentication required**
    **Requires permission: events.manage**
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

    # Get department's configured outreach types
    outreach_types = _get_outreach_types_from_settings(org)
    outreach_options = [{"value": t["value"], "label": t["label"]} for t in outreach_types]
    venue_options = [
        {"value": "their_location", "label": "Our Location"},
        {"value": "our_station", "label": "Your Station"},
        {"value": "either", "label": "Either"},
    ]

    # Create the form
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

    # Define the form fields with their mappings
    field_defs = [
        {"label": "Contact Information", "field_type": FieldType.SECTION_HEADER, "required": False},
        {"label": "Your Name", "field_type": FieldType.TEXT, "required": True, "mapping": "contact_name", "placeholder": "Full name"},
        {"label": "Email Address", "field_type": FieldType.EMAIL, "required": True, "mapping": "contact_email", "placeholder": "you@example.com"},
        {"label": "Phone Number", "field_type": FieldType.PHONE, "required": False, "mapping": "contact_phone", "placeholder": "(555) 123-4567"},
        {"label": "Your Organization", "field_type": FieldType.TEXT, "required": False, "mapping": "organization_name", "placeholder": "School, business, or group name"},
        {"label": "Event Details", "field_type": FieldType.SECTION_HEADER, "required": False},
        {"label": "Type of Event", "field_type": FieldType.SELECT, "required": True, "mapping": "outreach_type", "options": outreach_options},
        {"label": "Description", "field_type": FieldType.TEXTAREA, "required": True, "mapping": "description", "placeholder": "Describe what you're looking for...", "min_length": 10, "max_length": 2000},
        {"label": "Preferred Start Date", "field_type": FieldType.DATE, "required": False, "mapping": "preferred_date_start"},
        {"label": "Preferred End Date", "field_type": FieldType.DATE, "required": False, "mapping": "preferred_date_end"},
        {"label": "Expected Audience Size", "field_type": FieldType.TEXT, "required": False, "mapping": "audience_size", "placeholder": "Approximate number of attendees"},
        {"label": "Age Group", "field_type": FieldType.TEXT, "required": False, "mapping": "age_group", "placeholder": "e.g., Elementary school, Adults, All ages"},
        {"label": "Venue & Logistics", "field_type": FieldType.SECTION_HEADER, "required": False},
        {"label": "Venue Preference", "field_type": FieldType.SELECT, "required": True, "mapping": "venue_preference", "options": venue_options},
        {"label": "Venue Address", "field_type": FieldType.TEXTAREA, "required": False, "mapping": "venue_address", "placeholder": "Address if event is at your location"},
        {"label": "Special Requests", "field_type": FieldType.TEXTAREA, "required": False, "mapping": "special_requests", "placeholder": "Any special requirements or requests..."},
    ]

    field_mappings = {}
    for i, field_def in enumerate(field_defs):
        mapping = field_def.pop("mapping", None)
        options = field_def.pop("options", None)

        field = FormField(
            form_id=form.id,
            label=field_def["label"],
            field_type=field_def["field_type"],
            required=field_def["required"],
            sort_order=i,
            placeholder=field_def.get("placeholder"),
            min_length=field_def.get("min_length"),
            max_length=field_def.get("max_length"),
            options=options,
        )
        db.add(field)
        await db.flush()

        if mapping:
            field_mappings[str(field.id)] = mapping

    # Add EVENT_REQUEST integration
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
