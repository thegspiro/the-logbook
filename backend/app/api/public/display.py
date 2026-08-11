"""
Public Location Display API Endpoint

Public endpoint for location kiosk/tablet displays. No authentication required.
The display code is a short, non-guessable string assigned to each location,
making the URL suitable for bookmarking on a tablet left in a room.

Only exposes minimal, non-sensitive data: location name, event name,
event time, and the check-in URL. Member check-in requires authentication on
the scanning user's device.

Events that opt in via ``allow_guest_check_in`` additionally expose a guest
sign-in path here, so a visitor at an interest night can record their own
attendance without an account. That path is an unauthenticated *write*, so it
carries the same defences as the public forms API — per-IP rate limiting, a
per-event daily ceiling, and a honeypot field — and resolves the organization
from the display code rather than trusting anything in the request body.
"""

import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import (
    daily_cap_exceeded,
    get_client_ip,
    public_rate_limit,
)
from app.core.utils import safe_error_detail
from app.models.event import Event
from app.models.location import Location
from app.models.user import Organization
from app.schemas.event import (
    GuestCheckInEventInfo,
    GuestCheckInRequest,
    GuestCheckInResponse,
    QRCheckInData,
)
from app.schemas.location import LocationDisplayInfo
from app.services.event_service import EventService
from app.services.guest_check_in_service import GuestCheckInService
from app.services.location_service import LocationService

router = APIRouter(prefix="/public/v1/display", tags=["public-display"])

# Same shape the display codes are actually issued in. An explicit ASCII regex
# rather than str.isalnum(), which also accepts Unicode letters/digits.
DISPLAY_CODE_PATTERN = re.compile(r"[A-Za-z0-9]{6,12}")


async def _rate_limit_display(request: Request) -> None:
    """Rate limit public display lookups: 60/minute per IP (DoS guard)."""
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_display:{client_ip}", max_requests=60, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _rate_limit_guest_check_in(request: Request) -> None:
    """Rate limit guest sign-ins: 10/minute per IP, then a 10-minute lockout.

    Everyone in one room shares an IP on the venue's wi-fi, so this is sized to
    absorb a genuine rush at the door while still stopping a script.
    """
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_guest_checkin:{client_ip}",
        max_requests=10,
        window_seconds=60,
        lockout_seconds=600,
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Please try again in a few minutes.",
        )


def _validate_display_code(display_code: str) -> None:
    """Reject malformed display codes before they reach the database."""
    if not DISPLAY_CODE_PATTERN.fullmatch(display_code):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Display not found",
        )


async def _resolve_guest_event(
    db: AsyncSession, display_code: str, event_id: UUID
) -> tuple[Location, Event, Organization | None]:
    """Resolve a guest-check-in target from the room's display code.

    The display code is the only credential in play, so it — not the request —
    determines the organization, and the event must actually be held in that
    room. Without the location check, one leaked code would open guest check-in
    on every event in the department that has the flag set.

    Every failure answers the same 404 so the endpoint cannot be used to probe
    which event ids exist or which have guest check-in enabled.
    """
    not_found = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Sign-in is not available for this event.",
    )

    _validate_display_code(display_code)

    location = await LocationService(db).get_location_by_display_code(display_code)
    if not location:
        raise not_found

    result = await db.execute(
        select(Event)
        .where(
            Event.id == str(event_id),
            Event.organization_id == location.organization_id,
            Event.location_id == location.id,
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
        )
        .options(selectinload(Event.location_obj))
    )
    event = result.scalar_one_or_none()
    if not event or not event.allow_guest_check_in:
        raise not_found

    org = (
        await db.execute(
            select(Organization).where(Organization.id == location.organization_id)
        )
    ).scalar_one_or_none()

    return location, event, org


@router.get(
    "/{display_code}",
    response_model=LocationDisplayInfo,
    dependencies=[Depends(_rate_limit_display)],
)
async def get_public_location_display(
    display_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get display information for a location kiosk (public, no auth required).

    Returns the location name and any events currently in their check-in window,
    with QR code data for each event. Designed for tablets/iPads left in rooms.

    The display_code is a short, non-guessable string assigned to each location.
    """
    _validate_display_code(display_code)

    service = LocationService(db)

    # Look up location by display code
    location = await service.get_location_by_display_code(display_code)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Display not found",
        )

    # Get events currently in check-in window
    events = await service.get_current_events_in_check_in_window(
        location_id=UUID(location.id),
        organization_id=location.organization_id,
    )

    # Build event data for display — only non-sensitive fields. Report the
    # authoritative check-in window (the same EventService logic the check-in
    # endpoint enforces) rather than a hardcoded 1-hour guess, so the kiosk
    # doesn't show a STRICT event as "ready" before its window actually opens.
    now = datetime.now(timezone.utc)
    event_service = EventService(db)
    current_events = []
    for event in events:
        check_in_start, check_in_end = EventService._get_check_in_window(event)
        is_valid, _error, _notice = event_service._validate_check_in_window(event, now)

        current_events.append(
            QRCheckInData(
                event_id=str(event.id),
                event_name=event.title,
                event_type=event.event_type.value if event.event_type else None,
                event_description=None,  # Don't expose description publicly
                start_datetime=event.start_datetime.isoformat(),
                end_datetime=event.end_datetime.isoformat(),
                actual_end_time=(
                    event.actual_end_time.isoformat() if event.actual_end_time else None
                ),
                check_in_start=check_in_start.isoformat(),
                check_in_end=check_in_end.isoformat(),
                is_valid=is_valid,
                location=event.location,
                location_id=str(event.location_id) if event.location_id else None,
                location_name=location.name,
                require_checkout=event.require_checkout or False,
                allow_guest_check_in=event.allow_guest_check_in or False,
            ).model_dump()
        )

    # Ship the department's timezone so the kiosk renders these UTC times in
    # department-local time. Without it an unauthenticated tablet has no
    # profile to read and falls back to whatever zone the device is set to —
    # commonly UTC out of the box, which shifts every displayed time.
    org_tz = (
        await db.execute(
            select(Organization.timezone).where(
                Organization.id == location.organization_id
            )
        )
    ).scalar_one_or_none()

    return LocationDisplayInfo(
        location_id=UUID(location.id),
        location_name=location.name,
        current_events=current_events,
        has_overlap=len(current_events) > 1,
        timezone=org_tz,
    )


@router.get(
    "/{display_code}/events/{event_id}/guest",
    response_model=GuestCheckInEventInfo,
    dependencies=[Depends(_rate_limit_display)],
)
async def get_guest_check_in_info(
    display_code: str,
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the event detail shown on the guest sign-in page (public, no auth).

    Exposes only what a visitor standing in the room can already see — the
    event's name, type, time and room — plus whether sign-in is currently open.
    The description is withheld, matching the kiosk display.
    """
    location, event, org = await _resolve_guest_event(db, display_code, event_id)

    is_open, closed_reason = GuestCheckInService.check_in_window_state(
        event, datetime.now(timezone.utc)
    )

    return GuestCheckInEventInfo(
        event_id=str(event.id),
        event_name=event.title,
        event_type=event.event_type.value if event.event_type else None,
        start_datetime=event.start_datetime.isoformat(),
        end_datetime=event.end_datetime.isoformat(),
        location_name=location.name,
        organization_name=org.name if org else None,
        is_open=is_open,
        closed_reason=closed_reason,
        collects_prospect_details=bool(event.guest_check_in_creates_prospect),
        timezone=org.timezone if org else None,
    )


@router.post(
    "/{display_code}/events/{event_id}/guest-check-in",
    response_model=GuestCheckInResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rate_limit_guest_check_in)],
)
async def guest_check_in(
    display_code: str,
    event_id: UUID,
    payload: GuestCheckInRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Record a non-member's attendance at an event (public, no auth required).

    Reached by scanning the guest QR code on a room display. Creates an
    external-attendee record and, when the event opts in, a prospective-member
    record in the recruitment pipeline.
    """
    location, event, org = await _resolve_guest_event(db, display_code, event_id)

    # Honeypot: a hidden field only an automated form-filler populates. Answer
    # with a plausible success so the bot has no signal to adapt to, exactly as
    # the public forms endpoint does.
    if payload.hp_website:
        now = datetime.now(timezone.utc)
        return GuestCheckInResponse(
            status="checked_in",
            attendee_id=str(UUID(int=0)),
            event_name=event.title,
            checked_in_at=now.isoformat(),
            message="Thanks for signing in!",
        )

    # Per-event/day ceiling. Per-IP limiting alone cannot stop a distributed
    # flood, and each sign-in can create a pipeline record — a far more
    # expensive side effect than a page view.
    if await daily_cap_exceeded(
        f"guest_checkin:{event.id}", settings.GUEST_CHECK_IN_DAILY_LIMIT
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This event is not accepting further sign-ins today.",
        )

    is_open, closed_reason = GuestCheckInService.check_in_window_state(
        event, datetime.now(timezone.utc)
    )
    if not is_open:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=closed_reason or "Check-in is not available for this event.",
        )

    service = GuestCheckInService(db)
    try:
        attendee, error, prospect_created = await service.check_in_guest(
            event=event,
            organization_id=location.organization_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            email=str(payload.email) if payload.email else None,
            phone=payload.phone,
            organization_name=payload.organization_name,
            interest_reason=payload.interest_reason,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(exc),
        )

    if error or attendee is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Unable to record sign-in.",
        )

    await log_audit_event(
        db=db,
        event_type="event_guest_checkin",
        event_category="events",
        severity="info",
        event_data={
            "event_id": str(event.id),
            "attendee_id": attendee.id,
            "location_id": location.id,
            "prospect_created": prospect_created,
            "source": GuestCheckInService.SOURCE_KIOSK_QR,
        },
        organization_id=location.organization_id,
        ip_address=get_client_ip(request),
    )

    message = f"You're signed in to {event.title}."

    return GuestCheckInResponse(
        status="checked_in",
        attendee_id=attendee.id,
        event_name=event.title,
        checked_in_at=(
            attendee.checked_in_at.isoformat() if attendee.checked_in_at else ""
        ),
        message=message,
    )
