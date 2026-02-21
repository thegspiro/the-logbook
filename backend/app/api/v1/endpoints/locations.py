"""
Location API Endpoints

Endpoints for location management including CRUD operations and event queries.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.user import User
from app.schemas.location import (
    LocationCreate,
    LocationUpdate,
    LocationResponse,
    LocationListItem,
    LocationDisplayInfo,
)
from app.schemas.event import QRCheckInData
from app.services.location_service import LocationService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Location Endpoints
# ============================================

@router.get("", response_model=List[LocationListItem])
async def list_locations(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all locations

    **Authentication required**
    """
    service = LocationService(db)
    locations = await service.list_locations(
        organization_id=current_user.organization_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )

    return [
        LocationListItem(
            id=UUID(loc.id),
            organization_id=UUID(loc.organization_id),
            name=loc.name,
            description=loc.description,
            address=loc.address,
            city=loc.city,
            state=loc.state,
            zip=loc.zip,
            building=loc.building,
            floor=loc.floor,
            room_number=loc.room_number,
            capacity=loc.capacity,
            is_active=loc.is_active,
            facility_id=UUID(loc.facility_id) if loc.facility_id else None,
            display_code=loc.display_code,
            created_at=loc.created_at,
            updated_at=loc.updated_at,
        )
        for loc in locations
    ]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    location_data: LocationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("locations.create", "locations.manage")),
):
    """
    Create a new location

    **Authentication required**
    **Permissions required:** locations.create or locations.manage
    """
    service = LocationService(db)

    try:
        location = await service.create_location(
            location_data=location_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return LocationResponse(
        id=UUID(location.id),
        organization_id=UUID(location.organization_id),
        name=location.name,
        description=location.description,
        address=location.address,
        city=location.city,
        state=location.state,
        zip=location.zip,
        latitude=location.latitude,
        longitude=location.longitude,
        building=location.building,
        floor=location.floor,
        room_number=location.room_number,
        capacity=location.capacity,
        is_active=location.is_active,
        facility_id=UUID(location.facility_id) if location.facility_id else None,
        display_code=location.display_code,
        created_by=UUID(location.created_by) if location.created_by else None,
        created_at=location.created_at,
        updated_at=location.updated_at,
    )


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific location by ID

    **Authentication required**
    """
    service = LocationService(db)
    location = await service.get_location(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    return LocationResponse(
        id=UUID(location.id),
        organization_id=UUID(location.organization_id),
        name=location.name,
        description=location.description,
        address=location.address,
        city=location.city,
        state=location.state,
        zip=location.zip,
        latitude=location.latitude,
        longitude=location.longitude,
        building=location.building,
        floor=location.floor,
        room_number=location.room_number,
        capacity=location.capacity,
        is_active=location.is_active,
        facility_id=UUID(location.facility_id) if location.facility_id else None,
        display_code=location.display_code,
        created_by=UUID(location.created_by) if location.created_by else None,
        created_at=location.created_at,
        updated_at=location.updated_at,
    )


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: UUID,
    location_data: LocationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("locations.edit", "locations.manage")),
):
    """
    Update a location

    **Authentication required**
    **Permissions required:** locations.edit or locations.manage
    """
    service = LocationService(db)

    try:
        location = await service.update_location(
            location_id=location_id,
            location_data=location_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    return LocationResponse(
        id=UUID(location.id),
        organization_id=UUID(location.organization_id),
        name=location.name,
        description=location.description,
        address=location.address,
        city=location.city,
        state=location.state,
        zip=location.zip,
        latitude=location.latitude,
        longitude=location.longitude,
        building=location.building,
        floor=location.floor,
        room_number=location.room_number,
        capacity=location.capacity,
        is_active=location.is_active,
        facility_id=UUID(location.facility_id) if location.facility_id else None,
        display_code=location.display_code,
        created_by=UUID(location.created_by) if location.created_by else None,
        created_at=location.created_at,
        updated_at=location.updated_at,
    )


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location(
    location_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("locations.delete", "locations.manage")),
):
    """
    Delete a location

    **Authentication required**
    **Permissions required:** locations.delete or locations.manage

    **Note:** Cannot delete locations that have associated events.
    Consider deactivating instead.
    """
    service = LocationService(db)

    try:
        deleted = await service.delete_location(
            location_id=location_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )


# ============================================
# Location Display Endpoints (for QR code displays)
# ============================================

@router.get("/{location_id}/display", response_model=LocationDisplayInfo)
async def get_location_display_info(
    location_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get display information for a location (for digital displays/iPads)

    Returns the location details and any events currently in their check-in window.
    This endpoint is designed for use by digital displays showing QR codes.

    **Authentication required**
    """
    service = LocationService(db)

    # Get location
    location = await service.get_location(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    # Get events currently in check-in window
    events = await service.get_current_events_in_check_in_window(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    # Build event data for display
    current_events = []
    for event in events:
        # Calculate check-in window
        check_in_start = event.start_datetime - timedelta(hours=1)
        check_in_end = event.actual_end_time or event.end_datetime

        current_events.append(
            QRCheckInData(
                event_id=str(event.id),
                event_name=event.title,
                event_type=event.event_type.value if event.event_type else None,
                event_description=event.description,
                start_datetime=event.start_datetime.isoformat(),
                end_datetime=event.end_datetime.isoformat(),
                actual_end_time=event.actual_end_time.isoformat() if event.actual_end_time else None,
                check_in_start=check_in_start.isoformat(),
                check_in_end=check_in_end.isoformat(),
                is_valid=True,  # Already filtered by check-in window
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
