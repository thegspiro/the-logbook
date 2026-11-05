"""
Location Service

Business logic for location management.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from uuid import UUID

from sqlalchemy import Select, and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_display_code
from app.models.apparatus import Apparatus, ApparatusLocationHistory
from app.models.event import Event, EventTemplate
from app.models.event_request import EventRequest
from app.models.facilities import Facility, FacilityRoom
from app.models.location import Location
from app.models.meeting import Meeting
from app.models.training import (
    CourseClass,
    CourseCohort,
    CourseCohortClass,
    TrainingRecord,
)
from app.models.user import Organization
from app.schemas.location import LocationCreate, LocationUpdate
from app.utils.org_locks import ROOM_BOOKING, lock_organization_scope
from app.utils.org_scoping import assert_in_org

# Every column that points at ``locations.id`` with ON DELETE RESTRICT. A
# location any of these reference cannot be hard-deleted, so removing it
# deactivates it instead. A new RESTRICT reference to ``locations`` belongs
# here, or deleting a location it points at goes back to failing at flush.
#
# Training history, meetings and event requests joined the events here by the
# owner's decisions of 2026-11-01: where a class was held or a meeting met is
# part of the record. Inventory items, storage areas and NFC tap logs stay
# ON DELETE SET NULL — a missing location is an ordinary state for them.
_RESTRICTING_LOCATION_REFERENCES = (
    Event.location_id,
    EventTemplate.default_location_id,
    Apparatus.primary_station_id,
    Apparatus.current_location_id,
    ApparatusLocationHistory.location_id,
    TrainingRecord.location_id,
    CourseClass.location_id,
    CourseCohort.location_id,
    CourseCohortClass.location_id,
    Meeting.location_id,
    EventRequest.event_location_id,
)

# Enforces (organization_id, name, building) — see Location.building_key.
_NAME_CONSTRAINT = "uq_locations_org_name_building"

# Longest a location name may be (``locations.name`` is String(200)).
_NAME_MAX = 200


def _duplicate_name_error(name: str) -> ValueError:
    return ValueError(f"Location with name '{name}' already exists")


def _violates_name_constraint(error: IntegrityError) -> bool:
    return _NAME_CONSTRAINT in str(error.orig)


def _numbered(base: str, number: int) -> str:
    """``base (n)``, with the base cut so the whole fits ``locations.name``.

    Migration 2bb7c963f351 numbered the duplicates it settled the same way,
    so a room renamed there keeps its name on its next sync.
    """
    suffix = f" ({number})"
    return base[: _NAME_MAX - len(suffix)] + suffix


async def _name_taken(
    db: AsyncSession,
    organization_id: str,
    name: str,
    building: Optional[str],
    exclude_id: Optional[str] = None,
    current: bool = False,
) -> bool:
    """Whether another location already holds this name in this building.

    Compares through ``building_key`` so that no building and an empty one are
    the same scope, as the unique key sees them. Equality follows the column
    collation, so case and trailing spaces are judged as the key judges them.
    ``.limit(1)`` is load-bearing: rows stored before the key existed could
    hold a duplicate pair, and uncapped, ``scalar_one_or_none()`` raises
    MultipleResultsFound — not a ValueError, so a 500 on every later write
    of that name.

    ``current`` makes it a locking read. Under InnoDB's REPEATABLE READ a plain
    SELECT answers from the transaction's snapshot, so after losing a race on
    the unique key it would keep missing the row that won; a locking read sees
    the latest committed rows.
    """
    query = (
        select(Location.id)
        .where(Location.organization_id == str(organization_id))
        .where(Location.name == name)
        .where(Location.building_key == (building or ""))
    )
    if exclude_id is not None:
        query = query.where(Location.id != str(exclude_id))
    query = query.limit(1)
    if current:
        query = query.with_for_update(read=True)
    return (await db.execute(query)).scalar_one_or_none() is not None


async def available_location_name(
    db: AsyncSession,
    organization_id: str,
    base: str,
    building: Optional[str],
    location: Optional[Location] = None,
    current: bool = False,
) -> str:
    """A name for a generated location that no other in its building holds.

    For locations the system names itself (a facility room's), where refusing
    the save would be wrong: two rooms called "Storage" in one building are
    ordinary. Returns ``base`` when free, else the first free ``base (n)``.
    An existing ``location`` keeps its current name when that is already one
    of those and still free, so re-saving a room does not renumber it.

    Call before assigning anything to ``location``: the lookup autoflushes,
    and a pending clashing name would hit the unique key first.
    """
    exclude_id = location.id if location is not None else None
    candidates = [base] + [_numbered(base, n) for n in range(2, 1000)]
    if location is not None and location.name in candidates:
        if not await _name_taken(
            db, organization_id, location.name, building, exclude_id, current
        ):
            return location.name
    for candidate in candidates:
        if not await _name_taken(
            db, organization_id, candidate, building, exclude_id, current
        ):
            return candidate
    raise ValueError(f"Too many locations are named '{base}' in this building")


async def save_system_named_location(
    db: AsyncSession,
    organization_id: str,
    base: str,
    building: Optional[str],
    location: Optional[Location],
    values: dict[str, Any],
) -> Location:
    """Create or update a location whose name the system chooses. Flushes.

    For a facility room's or an onboarding station's location: the name is
    ``base``, numbered by ``available_location_name`` when another location
    in the building holds it, and ``values`` are the other columns. Two saves
    racing for one name both pass that lookup, and the loser's flush hits
    ``uq_locations_org_name_building``. The flush runs in a savepoint, so the
    loss rolls back only this location; the name is then looked up again with
    a locking read, which sees the winner, and the save retried once. Losing
    twice in a row answers the same 400 a person naming it would get.
    """
    name = base
    for attempt in range(2):
        name = await available_location_name(
            db, organization_id, base, building, location, current=attempt > 0
        )
        target = location if location is not None else Location(**values)
        for field, value in values.items():
            setattr(target, field, value)
        target.organization_id = organization_id
        target.name = name
        try:
            async with db.begin_nested():
                db.add(target)
                await db.flush()
            return target
        except IntegrityError as error:
            if not _violates_name_constraint(error):
                raise
            if location is not None:
                # The savepoint rollback expired it; reload before reuse,
                # since an async session cannot lazy-load the attributes.
                await db.refresh(location)
    raise _duplicate_name_error(name)


async def release_location_references(db: AsyncSession, location_ids: Select) -> None:
    """Detach every blocking reference to the given locations. No commit.

    Only for erasing a department wholesale (the onboarding reset), where the
    rows that point at a location are about to go with their organization
    and keeping where they happened has no one left to serve. Every other
    removal goes through ``remove_location``, which keeps them. Nullable
    references are cleared; a NOT NULL one (apparatus location history) has
    its rows deleted, since they cannot outlive the location.
    """
    for column in _RESTRICTING_LOCATION_REFERENCES:
        model = column.class_
        if column.property.columns[0].nullable:
            await db.execute(
                update(model)
                .where(column.in_(location_ids))
                .values({column: None})
                .execution_options(synchronize_session=False)
            )
        else:
            await db.execute(
                delete(model)
                .where(column.in_(location_ids))
                .execution_options(synchronize_session=False)
            )


class LocationInUseError(ValueError):
    """A location gained a reference between the check and the delete.

    A ValueError so a caller that does not tell it apart still answers 400;
    the delete routes catch it first to answer 409, because the request was
    well-formed and the conflict is with stored data. Retrying resolves it:
    the next attempt sees the reference and deactivates instead.
    """

    def __init__(self) -> None:
        super().__init__(
            "This location was just put into use by another record, so it "
            "could not be removed. Try again to deactivate it instead."
        )


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
        # A name is unique within its building/station. Rooms at different
        # stations may share a name (e.g. "Bunk Room" at Station 1 and 2).
        # This check gives the friendly answer; the unique key behind it
        # (LOC-41) is what holds when two creates race past it together.
        if await self._name_taken(
            organization_id, location_data.name, location_data.building
        ):
            raise _duplicate_name_error(location_data.name)

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
        await self._commit_named(location_data.name)
        await self.db.refresh(location)

        return location

    async def _name_taken(
        self,
        organization_id: str,
        name: str,
        building: Optional[str],
        exclude_id: Optional[str] = None,
    ) -> bool:
        return await _name_taken(self.db, organization_id, name, building, exclude_id)

    async def _commit_named(self, name: str) -> None:
        """Commit, answering a lost race on the name as the check would have."""
        try:
            await self.db.commit()
        except IntegrityError as error:
            await self.db.rollback()
            if _violates_name_constraint(error):
                raise _duplicate_name_error(name) from error
            raise

    async def get_location(
        self, location_id: UUID | str, organization_id: str
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
        # LocationUpdate refuses an explicit null name, so a provided name is
        # never None; the second test only narrows the type.
        effective_name: str = (
            location_data.name
            if "name" in provided and location_data.name is not None
            else location.name
        )
        effective_building = (
            location_data.building if "building" in provided else location.building
        )
        if effective_name != location.name or effective_building != location.building:
            if await self._name_taken(
                organization_id, effective_name, effective_building, location.id
            ):
                raise _duplicate_name_error(effective_name)

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

        await self._commit_named(effective_name)
        await self.db.refresh(location)

        return location

    async def delete_location(self, location_id: UUID, organization_id: str) -> bool:
        """
        Delete a location

        Hard-deletes the location when nothing references it. When an event,
        an event template, an apparatus (home station or current location), an
        apparatus location-history entry, training history (a record, a class,
        a cohort or a cohort class), a meeting or an event request still points
        at it, the location is deactivated (is_active=False) instead, so those
        records keep a valid reference while the location leaves every picker.

        Returns True if deleted or deactivated, False if not found. Raises
        ``LocationInUseError`` if a reference appeared mid-delete.
        """
        location = await self.get_location(location_id, organization_id)
        if not location:
            return False

        try:
            await self.remove_location(location)
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise LocationInUseError()

        return True

    async def location_reference_count(self, location_id: str) -> int:
        """Rows that reference this location through a RESTRICT foreign key.

        Not org-filtered on purpose: the foreign key does not care which
        organization a referencing row belongs to, and a count that missed one
        would send the location down the hard-delete path into the constraint.
        The location itself has already been resolved in the caller's org.
        """
        total = 0
        for column in _RESTRICTING_LOCATION_REFERENCES:
            total += (
                await self.db.scalar(
                    select(func.count())
                    .select_from(column.class_)
                    .where(column == location_id)
                )
                or 0
            )
        return total

    async def remove_location(self, location: Location) -> bool:
        """Deactivate a referenced location, otherwise delete it. No commit.

        Returns True when the row was deleted, False when it was deactivated.
        A reference created between this count and the caller's flush
        surfaces there as an IntegrityError (``Location.events`` uses
        ``passive_deletes="all"``, so the ORM leaves the constraint to fire
        rather than nulling the events' location).
        """
        if await self.location_reference_count(location.id) > 0:
            location.is_active = False
            location.updated_at = datetime.now(timezone.utc)
            return False

        await self.db.delete(location)
        return True

    async def get_current_events_in_check_in_window(
        self,
        location_id: UUID | str,
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
        location_id: UUID | str,
        organization_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
        exclude_event_id: UUID | str | None = None,
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
