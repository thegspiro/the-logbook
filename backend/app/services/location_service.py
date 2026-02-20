"""
Location Service

Business logic for location management.
"""

from typing import List, Optional, Tuple
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload

from app.models.location import Location
from app.models.event import Event
from app.models.user import User
from app.schemas.location import LocationCreate, LocationUpdate
from app.core.utils import generate_display_code


class LocationService:
    """Service for location management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_location(
        self, location_data: LocationCreate, organization_id: str, created_by: str
    ) -> Location:
        """Create a new location"""
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
            raise ValueError(f"Location with name '{location_data.name}' already exists")

        # Generate a unique display code for public kiosk URLs
        display_code = await self._generate_unique_display_code()

        # Create location
        location = Location(
            organization_id=organization_id,
            created_by=created_by,
            display_code=display_code,
            **location_data.model_dump()
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
        skip: int = 0,
        limit: int = 100,
    ) -> List[Location]:
        """List all locations with optional filtering"""
        query = select(Location).where(Location.organization_id == str(organization_id))

        if is_active is not None:
            query = query.where(Location.is_active == is_active)

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

        # Check if name is being changed and already exists within the same
        # building/station scope
        if location_data.name and location_data.name != location.name:
            building = location_data.building if location_data.building is not None else location.building
            dup_query = (
                select(Location)
                .where(Location.organization_id == str(organization_id))
                .where(Location.name == location_data.name)
                .where(Location.id != str(location_id))
            )
            if building:
                dup_query = dup_query.where(Location.building == building)
            else:
                dup_query = dup_query.where(Location.building.is_(None))
            result = await self.db.execute(dup_query)
            existing = result.scalar_one_or_none()
            if existing:
                raise ValueError(f"Location with name '{location_data.name}' already exists")

        # Update fields
        update_data = location_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(location, field, value)

        location.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def delete_location(
        self, location_id: UUID, organization_id: str
    ) -> bool:
        """
        Delete a location

        Returns True if deleted, False if not found
        Raises ValueError if location has associated events
        """
        location = await self.get_location(location_id, organization_id)
        if not location:
            return False

        # Check if location has any events
        result = await self.db.execute(
            select(func.count(Event.id))
            .where(Event.location_id == str(location_id))
        )
        event_count = result.scalar()
        if event_count > 0:
            raise ValueError(
                f"Cannot delete location. {event_count} event(s) are associated with this location. "
                "Please update or delete those events first, or deactivate the location instead."
            )

        await self.db.delete(location)
        await self.db.commit()

        return True

    async def get_location_events(
        self,
        location_id: UUID,
        organization_id: str,
        start_after: Optional[datetime] = None,
        start_before: Optional[datetime] = None,
        include_cancelled: bool = False,
    ) -> List[Event]:
        """Get all events for a location"""
        query = (
            select(Event)
            .where(Event.location_id == str(location_id))
            .where(Event.organization_id == str(organization_id))
        )

        if not include_cancelled:
            query = query.where(Event.is_cancelled == False)

        if start_after:
            query = query.where(Event.start_datetime >= start_after)

        if start_before:
            query = query.where(Event.start_datetime <= start_before)

        query = query.order_by(Event.start_datetime)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_current_events_in_check_in_window(
        self,
        location_id: UUID,
        organization_id: str,
    ) -> List[Event]:
        """
        Get events at this location that are currently in their check-in window
        (1 hour before start to end time, respecting actual_end_time if set)
        """
        now = datetime.utcnow()
        check_in_start_threshold = now + timedelta(hours=1)  # Can check in up to 1 hour before

        query = (
            select(Event)
            .where(Event.location_id == str(location_id))
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled == False)
            .where(Event.start_datetime <= check_in_start_threshold)
            .where(
                or_(
                    and_(Event.actual_end_time.is_(None), Event.end_datetime >= now),
                    Event.actual_end_time >= now
                )
            )
            .options(selectinload(Event.rsvps))
            .order_by(Event.start_datetime)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

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
            .where(Event.is_cancelled == False)
            .where(
                or_(
                    # New event starts during existing event
                    and_(
                        Event.start_datetime <= start_datetime,
                        Event.end_datetime > start_datetime
                    ),
                    # New event ends during existing event
                    and_(
                        Event.start_datetime < end_datetime,
                        Event.end_datetime >= end_datetime
                    ),
                    # New event completely contains existing event
                    and_(
                        Event.start_datetime >= start_datetime,
                        Event.end_datetime <= end_datetime
                    ),
                )
            )
        )

        if exclude_event_id:
            query = query.where(Event.id != str(exclude_event_id))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_location_by_display_code(self, display_code: str) -> Optional[Location]:
        """Look up a location by its public display code (for kiosk URLs)"""
        result = await self.db.execute(
            select(Location)
            .where(Location.display_code == display_code)
            .where(Location.is_active == True)
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
