"""
Location Service

Business logic for location management.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_display_code
from app.models.event import Event
from app.models.facilities import Facility, FacilityRoom
from app.models.location import Location
from app.models.user import Organization
from app.schemas.location import LocationCreate, LocationUpdate
from app.utils.org_locks import ROOM_BOOKING, lock_organization_scope
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
        # `.limit(1)` is load-bearing, not an optimization. This rule has no
        # unique constraint behind it (only a plain `ix_locations_name`) and it
        # is a read-then-write, so two concurrent creates can both pass it and
        # leave a duplicate pair behind. Unbounded, `scalar_one_or_none()` then
        # raises MultipleResultsFound on every later create or update of that
        # name — not a ValueError, so `handle_service_errors` renders it as a
        # 500 with a generic message, and the one name nobody can save again is
        # diagnosable only from the logs. Capped at one row, multiplicity is
        # unrepresentable and the duplicate still reports as a clean 400.
        result = await self.db.execute(dup_query.limit(1))
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
        location: Optional[Location] = result.scalar_one_or_none()
        return location

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
        # moved into the same one undetected. `building` is nullable, so an
        # explicit `PATCH {"building": null}` (clearing it) and an omitted
        # `building` both read as `location_data.building is None` — only
        # `model_fields_set` tells them apart. `name` cannot be explicitly
        # null (LocationUpdate rejects it), so the same check is safe for it
        # too and keeps both fields on one rule.
        provided = location_data.model_fields_set
        effective_name = location_data.name if "name" in provided else location.name
        effective_building = (
            location_data.building if "building" in provided else location.building
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
            # Capped for the same reason as `create_location`'s — see there.
            result = await self.db.execute(dup_query.limit(1))
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

        The window is per-event — FLEXIBLE opens ``check_in_minutes_before``
        minutes before start (the column defaults to 60), STRICT opens at
        ``actual_start_time``, WINDOW opens N minutes either side — so the exact
        boundaries are resolved via the canonical
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
            # No `selectinload(Event.rsvps)` here. It was eager-loading every
            # RSVP row of every event in the window, and no caller reads the
            # collection: the two display endpoints project scalar columns
            # only, and `NfcTagService._only_event_checked_into` runs its own
            # query narrowed to one member's open check-ins. The kiosk polls
            # this every 30 seconds, so a drill with 150 RSVPs was loading 150
            # unread rows a poll, per open event, on a public endpoint.
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

    async def lock_room_bookings(self, organization_id: str) -> None:
        """Serialize room booking decisions for this organization (EV-26).

        Held until the caller's transaction ends. A caller that will also
        lock an event row must take this first; see
        ``EventService.update_event``.
        """
        await lock_organization_scope(self.db, organization_id, ROOM_BOOKING)

    async def check_overlapping_events(
        self,
        location_id: UUID,
        organization_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
        exclude_event_id: Optional[UUID] = None,
        for_booking: bool = True,
    ) -> List[Event]:
        """
        Check for events that overlap with the given time range at this location

        Returns list of overlapping events

        ``for_booking`` is for a caller about to book the room on the strength
        of this answer. It takes the organization's booking lock and reads
        with a locking read: a plain SELECT answers from the snapshot taken at
        the request's first read, which predates a booking another
        coordinator committed while this one waited for the lock (pitfall
        #27). Only a read-only preview may pass False.
        """
        if for_booking:
            await self.lock_room_bookings(organization_id)
        query = (
            select(Event)
            .where(Event.location_id == str(location_id))
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled.is_(False))
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
        if for_booking:
            query = query.with_for_update()

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def set_badge_check_in(
        self, location_id: UUID, organization_id: str, enabled: bool
    ) -> Optional[Location]:
        """Turn member ID card taps on or off for one room's kiosk."""
        location = await self.get_location(location_id, organization_id)
        if not location:
            return None
        location.nfc_badge_check_in_enabled = enabled
        await self.db.commit()
        await self.db.refresh(location)
        return location

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
            .where(Location.is_active.is_(True))
            .where(Organization.active.is_(True))
        )
        location: Optional[Location] = result.scalar_one_or_none()
        return location

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
