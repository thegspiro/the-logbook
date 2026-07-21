"""
Public Location Display API Endpoint

Public endpoint for location kiosk/tablet displays. No authentication required.
The display code is a short, non-guessable string assigned to each location,
making the URL suitable for bookmarking on a tablet left in a room.

Only exposes minimal, non-sensitive data: location name, event name,
event time, and the check-in URL. The actual check-in requires authentication
on the scanning user's device.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.schemas.event import QRCheckInData
from app.schemas.location import LocationDisplayInfo
from app.services.event_service import EventService
from app.services.location_service import LocationService

router = APIRouter(prefix="/public/v1/display", tags=["public-display"])


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
    # Validate display code format (alphanumeric, 6-12 chars)
    if not display_code.isalnum() or len(display_code) < 6 or len(display_code) > 12:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Display not found",
        )

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
            ).model_dump()
        )

    return LocationDisplayInfo(
        location_id=UUID(location.id),
        location_name=location.name,
        current_events=current_events,
        has_overlap=len(current_events) > 1,
    )
