"""
Location API Endpoints

Endpoints for location management including CRUD operations and event queries.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    PaginationParams,
    can_view_kiosk_display_codes,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors, safe_error_detail
from app.models.user import User
from app.schemas.location import (
    LocationBadgeCheckInUpdate,
    LocationCreate,
    LocationDisplayInfo,
    LocationListItem,
    LocationResponse,
    LocationUpdate,
)
from app.services.location_display import build_location_display
from app.services.location_service import LocationInUseError, LocationService
from app.utils.nfc_integration import nfc_id_cards_enabled

router = APIRouter()


def _location_to_list_item(loc, *, include_display_code: bool) -> LocationListItem:
    """Convert a Location model to a LocationListItem response."""
    return LocationListItem(
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
        facility_room_id=(UUID(loc.facility_room_id) if loc.facility_room_id else None),
        display_code=loc.display_code if include_display_code else None,
        nfc_badge_check_in_enabled=bool(loc.nfc_badge_check_in_enabled),
        created_at=loc.created_at,
        updated_at=loc.updated_at,
    )


def _location_to_response(location, *, include_display_code: bool) -> LocationResponse:
    """Convert a Location model to a LocationResponse."""
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
        facility_room_id=(
            UUID(location.facility_room_id) if location.facility_room_id else None
        ),
        display_code=location.display_code if include_display_code else None,
        nfc_badge_check_in_enabled=bool(location.nfc_badge_check_in_enabled),
        created_by=UUID(location.created_by) if location.created_by else None,
        created_at=location.created_at,
        updated_at=location.updated_at,
    )


# ============================================
# Location Endpoints
# ============================================


@router.get("", response_model=list[LocationListItem])
async def list_locations(
    is_active: bool | None = Query(None, description="Filter by active status"),
    exclude_rooms: bool = Query(
        False,
        description="Exclude locations that represent rooms within a facility",
    ),
    pagination: PaginationParams = Depends(),
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
        exclude_rooms=exclude_rooms,
        skip=pagination.skip,
        limit=pagination.limit,
    )

    include_codes = can_view_kiosk_display_codes(current_user)
    return [
        _location_to_list_item(loc, include_display_code=include_codes)
        for loc in locations
    ]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    location_data: LocationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("locations.create", "locations.manage")
    ),
):
    """
    Create a new location

    **Authentication required**
    **Permissions required:** locations.create or locations.manage
    """
    service = LocationService(db)

    async with handle_service_errors("Failed to create location"):
        location = await service.create_location(
            location_data=location_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )

    return _location_to_response(
        location, include_display_code=can_view_kiosk_display_codes(current_user)
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
    location = ensure_found(
        await service.get_location(
            location_id=location_id,
            organization_id=current_user.organization_id,
        ),
        "Location",
    )

    return _location_to_response(
        location, include_display_code=can_view_kiosk_display_codes(current_user)
    )


@router.patch("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: UUID,
    location_data: LocationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("locations.edit", "locations.manage")
    ),
):
    """
    Update a location

    **Authentication required**
    **Permissions required:** locations.edit or locations.manage
    """
    service = LocationService(db)

    async with handle_service_errors("Failed to update location"):
        location = await service.update_location(
            location_id=location_id,
            location_data=location_data,
            organization_id=current_user.organization_id,
        )

    ensure_found(location, "Location")

    return _location_to_response(
        location, include_display_code=can_view_kiosk_display_codes(current_user)
    )


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location(
    location_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("locations.delete", "locations.manage")
    ),
):
    """
    Delete a location

    **Authentication required**
    **Permissions required:** locations.delete or locations.manage

    **Note:** A location that events, event templates or apparatus still
    reference is deactivated rather than deleted, so those records keep it.
    """
    service = LocationService(db)

    async with handle_service_errors("Failed to delete location"):
        try:
            deleted = await service.delete_location(
                location_id=location_id,
                organization_id=current_user.organization_id,
            )
        except LocationInUseError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=safe_error_detail(e)
            )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Location not found"
        )


@router.post("/{location_id}/regenerate-display-code", response_model=LocationResponse)
async def regenerate_display_code(
    location_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("locations.edit", "locations.manage")
    ),
):
    """
    Regenerate a location's public kiosk display code

    Invalidates the current code immediately — posted QR codes and kiosk
    tablets pointing at the old /display/{code} URL stop working. Use when
    a printed code has leaked or gone missing.

    **Authentication required**
    **Permissions required:** locations.edit or locations.manage
    """
    service = LocationService(db)

    async with handle_service_errors("Failed to regenerate display code"):
        location = await service.regenerate_display_code(
            location_id=location_id,
            organization_id=current_user.organization_id,
        )

    location = ensure_found(location, "Location")

    # Rotating the code revokes public access via the old URL — audit it
    await log_audit_event(
        db=db,
        event_type="location_display_code_regenerated",
        event_category="administration",
        severity="warning",
        event_data={"location_id": str(location_id), "location_name": location.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _location_to_response(
        location, include_display_code=can_view_kiosk_display_codes(current_user)
    )


@router.put("/{location_id}/badge-check-in", response_model=LocationResponse)
async def set_badge_check_in(
    location_id: UUID,
    data: LocationBadgeCheckInUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("locations.manage_nfc_tags")),
):
    """
    Turn member ID card taps on or off for one room's public kiosk

    A tap at the kiosk records attendance with nobody signed in, so this is
    its own grant and its own audited act rather than a field on the general
    location form: the officers who decide where the room's NFC tags go decide
    whether its kiosk reads cards. Turning it on needs the NFC ID Cards
    integration, since a kiosk could otherwise be switched on for cards the
    department cannot issue; turning it off is always allowed.

    **Authentication required**
    **Permissions required:** locations.manage_nfc_tags
    """
    service = LocationService(db)

    if data.enabled and not await nfc_id_cards_enabled(
        db, str(current_user.organization_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Turn on NFC ID Cards under Settings → Integrations before "
                "enabling badge check-in for a room."
            ),
        )

    async with handle_service_errors("Failed to update badge check-in"):
        location = await service.set_badge_check_in(
            location_id=location_id,
            organization_id=current_user.organization_id,
            enabled=data.enabled,
        )

    location = ensure_found(location, "Location")

    await log_audit_event(
        db=db,
        event_type=(
            "location_badge_check_in_enabled"
            if data.enabled
            else "location_badge_check_in_disabled"
        ),
        event_category="administration",
        severity="warning" if data.enabled else "info",
        event_data={"location_id": str(location_id), "location_name": location.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _location_to_response(
        location, include_display_code=can_view_kiosk_display_codes(current_user)
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
    location = ensure_found(
        await service.get_location(
            location_id=location_id,
            organization_id=current_user.organization_id,
        ),
        "Location",
    )

    events = await service.get_current_events_in_check_in_window(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    # LOC-40: the same builder as the public kiosk, so both fill every field
    # the same way. `recheck_window=False` is the one deliberate difference:
    # the selection above already applied the strict check-in window, and the
    # permissive rule a tap is held to admits a superset of it, so every event
    # listed here can be checked into.
    return await build_location_display(db, location, events, recheck_window=False)
