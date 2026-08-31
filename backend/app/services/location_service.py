"""
Location Service

Business logic for location management.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_display_code
from app.models.event import Event
from app.models.facilities import Facility, FacilityRoom
from app.models.location import Location
from app.models.user import Organization
from app.schemas.location import LocationCreate, LocationUpdate
from app.utils.org_scoping import assert_in_org


class LocationService:
    """Service for location management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_location(
        self, location_data: LocationCreate, organization_id: str, created_by: str
    ) -> Location:
        """Create a new location"""
        await assert_in_org(
            self.db,
            Facility,
            location_data.facility_id,
            organization_id,
            allow_none=True,
            label="facility",
        )
        # Check if location with same name already exists within the same
        # building/station.  Rooms at different stations may share a name
        # (e.g. "Bunk Room" at Station 1 and Station 2).
        dup_query = (
            select(Location)
            .where(Location.organization_id == str(organization_id))
            .where(Location.name == location_data.name)
        )
        if location_data.building:
            dup_query = dup_query.where(Location.building == location_data.building)
        else:
            dup_query = dup_query.where(Location.building.is_(None))
        result = await self.db.execute(dup_query)
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(
                f"Location with name '{location_data.name}' already exists"
            )

        # Generate a unique display code for public kiosk URLs
        display_code = await self._generate_unique_display_code()

        # Create location
        location = Location(
            organization_id=organization_id,
            created_by=created_by,
            display_code=display_code,
            **location_data.model_dump(),
        )

        self.db.add(location)
        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def get_location(
        self, location_id: UUID, organization_id: str
    ) -> Optional[Location]:
        """Get a location by ID"""
        result = await self.db.execute(
            select(Location)
            .where(Location.id == str(location_id))
            .where(Location.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def list_locations(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        exclude_rooms: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Location]:
        """List all locations with optional filtering"""
        query = select(Location).where(Location.organization_id == str(organization_id))

        if is_active is not None:
            query = query.where(Location.is_active == is_active)

        if exclude_rooms:
            query = query.where(Location.facility_room_id.is_(None))

        query = query.order_by(Location.name).offset(skip).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_location(
        self,
        location_id: UUID,
        location_data: LocationUpdate,
        organization_id: str,
    ) -> Optional[Location]:
        """Update a location"""
        # Get existing location
        location = await self.get_location(location_id, organization_id)
        if not location:
            return None

        # The uniqueness scope is (name, building) together, so a PATCH that
        # changes only building must re-check it too — otherwise two
        # same-named locations that were valid in separate buildings can be
        # moved into the same one undetected.
        effective_name = (
            location_data.name if location_data.name is not None else location.name
        )
        effective_building = (
            location_data.building
            if location_data.building is not None
            else location.building
        )
        if effective_name != location.name or effective_building != location.building:
            dup_query = (
                select(Location)
                .where(Location.organization_id == str(organization_id))
                .where(Location.name == effective_name)
                .where(Location.id != str(location_id))
            )
            if effective_building:
                dup_query = dup_query.where(Location.building == effective_building)
            else:
                dup_query = dup_query.where(Location.building.is_(None))
            result = await self.db.execute(dup_query)
            existing = result.scalar_one_or_none()
            if existing:
                raise ValueError(
                    f"Location with name '{effective_name}' already exists"
                )

        # Update fields
        update_data = location_data.model_dump(exclude_unset=True)
        if "facility_id" in update_data:
            await assert_in_org(
                self.db,
                Facility,
                update_data["facility_id"],
                organization_id,
                allow_none=True,
                label="facility",
            )
            # A room-backed location mirrors its FacilityRoom, whose facility
            # is authoritative. Repointing (or clearing) the location's
            # facility link would leave the room and its location referencing
            # different facilities — a persistent inconsistency org membership
            # checks alone do not prevent.
            if location.facility_room_id:
                room_facility_id = await self.db.scalar(
                    select(FacilityRoom.facility_id).where(
                        FacilityRoom.id == location.facility_room_id
                    )
                )
                new_facility_id = update_data["facility_id"]
                # Schema carries a UUID, the column stores a str — normalize
                # before comparing so a same-facility update is not rejected.
                if room_facility_id is not None and (
                    new_facility_id is None
                    or str(new_facility_id) != str(room_facility_id)
                ):
                    raise ValueError(
                        "This location is linked to a facility room; "
                        "it cannot be moved to a different facility"
                    )
        for field, value in update_data.items():
            setattr(location, field, value)

        location.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def delete_location(self, location_id: UUID, organization_id: str) -> bool:
        """
        Delete a location

        Hard-deletes the location if it has no events.  If events
        reference this location, it is deactivated (is_active=False)
        instead so existing events keep a valid FK while the location
        no longer appears in pickers.

        Returns True if deleted or deactivated, False if not found.
        """
        location = await self.get_location(location_id, organization_id)
        if not location:
            return False

        # Check if location has any events
        result = await self.db.execute(
            select(func.count(Event.id)).where(Event.location_id == str(location_id))
        )
        event_count = result.scalar()
        if event_count > 0:
            # Soft-delete: deactivate so existing events keep their FK
            location.is_active = False
            await self.db.commit()
            return True

        await self.db.delete(location)
        await self.db.commit()

        return True

    async def get_current_events_in_check_in_window(
        self,
        location_id: UUID,
        organization_id: str,
    ) -> List[Event]:
        """
        Get events at this location whose check-in window is open right now.

        The window is per-event — FLEXIBLE opens N minutes before start (default
        30), STRICT opens at ``actual_start_time``, WINDOW opens N minutes either
        side — so the exact boundaries are resolved via the canonical
        ``EventService._get_check_in_window`` per candidate rather than assuming a
        fixed 1-hour lead. The old hardcoded "1 hour before start" returned a
        superset, so the kiosk showed an active check-in QR for STRICT and
        early-FLEXIBLE events up to an hour before their window actually opened
        (the scan was then rejected) — the LOC-1 drift, one layer down.
        """
        from app.services.event_service import EventService

        now = datetime.now(timezone.utc)
        # Generous prefilter to bound the rows; the exact window is applied
        # below. The horizon must cover the maximum configurable check-in lead
        # (check_in_minutes_before validates up to 1440 = 24h), otherwise a
        # FLEXIBLE event opening check-in more than an hour early is
        # check-in-open via direct check-in but invisible on the kiosk until
        # T-60 — the same LOC-1 drift again. The wider horizon only enlarges
        # the candidate set (a bounded per-location slice of upcoming events);
        # the canonical per-event window below still filters precisely.
        prefilter_horizon = now + timedelta(hours=24)

        query = (
            select(Event)
            .where(Event.location_id == str(location_id))
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled.is_(False))
            .where(Event.is_draft.is_(False))
            .where(Event.start_datetime <= prefilter_horizon)
            .where(
                or_(
                    and_(Event.actual_end_time.is_(None), Event.end_datetime >= now),
                    Event.actual_end_time >= now,
                )
            )
            .options(selectinload(Event.rsvps))
            .order_by(Event.start_datetime)
        )

        result = await self.db.execute(query)
        candidates = list(result.scalars().all())

        current: List[Event] = []
        for event in candidates:
            check_in_start, check_in_end = EventService._get_check_in_window(event)
            if check_in_start <= now <= check_in_end:
                current.append(event)
        return current

    async def check_overlapping_events(
        self,
        location_id: UUID,
        organization_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
        exclude_event_id: Optional[UUID] = None,
    ) -> List[Event]:
        """
        Check for events that overlap with the given time range at this location

        Returns list of overlapping events
        """
        query = (
            select(Event)
            .where(Event.location_id == str(location_id))
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled == False)  # noqa: E712
            .where(
                or_(
                    # New event starts during existing event
                    and_(
                        Event.start_datetime <= start_datetime,
                        Event.end_datetime > start_datetime,
                    ),
                    # New event ends during existing event
                    and_(
                        Event.start_datetime < end_datetime,
                        Event.end_datetime >= end_datetime,
                    ),
                    # New event completely contains existing event
                    and_(
                        Event.start_datetime >= start_datetime,
                        Event.end_datetime <= end_datetime,
                    ),
                )
            )
        )

        if exclude_event_id:
            query = query.where(Event.id != str(exclude_event_id))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def regenerate_display_code(
        self, location_id: UUID, organization_id: str
    ) -> Optional[Location]:
        """Rotate a location's public display code.

        The display code gates unauthenticated kiosk access at
        /display/{code}, so a leaked or walked-off printed code must be
        invalidatable. The old code stops resolving immediately; any
        posted QR codes and kiosk tablets must be updated to the new URL.
        """
        location = await self.get_location(location_id, organization_id)
        if not location:
            return None

        location.display_code = await self._generate_unique_display_code()
        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def get_location_by_display_code(
        self, display_code: str
    ) -> Optional[Location]:
        """Look up a location by its public display code (for kiosk URLs)

        Also requires the owning organization to be active — a deactivated
        department's location rows are not touched, so an old kiosk URL or
        printed QR code would otherwise keep serving event data and accepting
        guest sign-ins indefinitely. Other public intake surfaces
        (``event_requests.py``, ``auth.py``) enforce the same
        ``Organization.active`` gate; this closes the one that didn't.
        """
        result = await self.db.execute(
            select(Location)
            .join(Organization, Organization.id == Location.organization_id)
            .where(Location.display_code == display_code)
            .where(Location.is_active == True)  # noqa: E712
            .where(Organization.active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def _generate_unique_display_code(self, max_attempts: int = 20) -> str:
        """Generate a display code that doesn't collide with existing ones"""
        for attempt in range(max_attempts):
            length = 8 if attempt < 10 else 12
            code = generate_display_code(length=length)
            result = await self.db.execute(
                select(Location.id).where(Location.display_code == code)
            )
            if result.scalar_one_or_none() is None:
                return code
        raise ValueError("Unable to generate a unique display code. Please try again.")
