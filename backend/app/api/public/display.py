"""
Public Location Display API Endpoint

Public endpoint for location kiosk/tablet displays. No authentication required.
The display code is a short, non-guessable string assigned to each location,
making the URL suitable for bookmarking on a tablet left in a room.

Only exposes minimal, non-sensitive data: location name, event name,
event time, and the check-in URL. The actual check-in requires authentication
on the scanning user's device.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta
from uuid import UUID

from app.core.database import get_db
from app.services.location_service import LocationService
from app.schemas.location import LocationDisplayInfo
from app.schemas.event import QRCheckInData

router = APIRouter(prefix="/public/v1/display", tags=["public-display"])


@router.get("/{display_code}", response_model=LocationDisplayInfo)
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

    # Build event data for display — only non-sensitive fields
    current_events = []
    for event in events:
        check_in_start = event.start_datetime - timedelta(hours=1)
        check_in_end = event.actual_end_time or event.end_datetime

        current_events.append(
            QRCheckInData(
                event_id=str(event.id),
                event_name=event.title,
                event_type=event.event_type.value if event.event_type else None,
                event_description=None,  # Don't expose description publicly
                start_datetime=event.start_datetime.isoformat(),
                end_datetime=event.end_datetime.isoformat(),
                actual_end_time=event.actual_end_time.isoformat() if event.actual_end_time else None,
                check_in_start=check_in_start.isoformat(),
                check_in_end=check_in_end.isoformat(),
                is_valid=True,
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
