"""
Event Service

Business logic for event management.
"""

from typing import List, Optional, Tuple, Dict, Any
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.user import User
from app.models.location import Location
from app.schemas.event import (
    EventCreate,
    EventUpdate,
    RSVPCreate,
    EventStats,
    EventResponse,
    RSVPResponse,
)


class EventService:
    """Service for event management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_event(
        self, event_data: EventCreate, organization_id: UUID, created_by: UUID
    ) -> Event:
        """Create a new event"""
        # Validate dates
        if event_data.end_datetime <= event_data.start_datetime:
            raise ValueError("End date must be after start date")

        if event_data.requires_rsvp and event_data.rsvp_deadline:
            if event_data.rsvp_deadline >= event_data.start_datetime:
                raise ValueError("RSVP deadline must be before event start")

        # Prepare event data
        event_dict = event_data.model_dump()

        # Set default allowed_rsvp_statuses if not provided and RSVP is required
        if event_data.requires_rsvp and not event_dict.get("allowed_rsvp_statuses"):
            event_dict["allowed_rsvp_statuses"] = ["going", "not_going"]

        # Create event
        event = Event(
            organization_id=organization_id,
            created_by=created_by,
            **event_dict
        )

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def get_event(
        self, event_id: UUID, organization_id: UUID, user_id: Optional[UUID] = None
    ) -> Optional[Tuple[Event, Optional[EventRSVP]]]:
        """
        Get an event by ID

        Returns: (Event, user's RSVP if exists)
        """
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
            .options(selectinload(Event.rsvps))
        )
        event = result.scalar_one_or_none()

        if not event:
            return None, None

        # Get user's RSVP if user_id provided
        user_rsvp = None
        if user_id:
            rsvp_result = await self.db.execute(
                select(EventRSVP)
                .where(EventRSVP.event_id == event_id)
                .where(EventRSVP.user_id == user_id)
            )
            user_rsvp = rsvp_result.scalar_one_or_none()

        return event, user_rsvp

    async def list_events(
        self,
        organization_id: UUID,
        event_type: Optional[str] = None,
        start_after: Optional[datetime] = None,
        start_before: Optional[datetime] = None,
        include_cancelled: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Event]:
        """List events with filtering"""
        query = select(Event).where(Event.organization_id == organization_id)

        if event_type:
            query = query.where(Event.event_type == event_type)

        if not include_cancelled:
            query = query.where(Event.is_cancelled == False)

        if start_after:
            query = query.where(Event.start_datetime >= start_after)

        if start_before:
            query = query.where(Event.start_datetime <= start_before)

        query = query.order_by(Event.start_datetime).offset(skip).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_event(
        self, event_id: UUID, organization_id: UUID, event_data: EventUpdate
    ) -> Optional[Event]:
        """Update an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        # Cannot update cancelled events
        if event.is_cancelled:
            raise ValueError("Cannot update cancelled event")

        # Update fields
        update_data = event_data.model_dump(exclude_unset=True)

        # Validate dates if being updated
        start_dt = update_data.get("start_datetime", event.start_datetime)
        end_dt = update_data.get("end_datetime", event.end_datetime)

        if end_dt <= start_dt:
            raise ValueError("End date must be after start date")

        for field, value in update_data.items():
            setattr(event, field, value)

        event.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def cancel_event(
        self, event_id: UUID, organization_id: UUID, reason: str
    ) -> Optional[Event]:
        """Cancel an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        if event.is_cancelled:
            raise ValueError("Event is already cancelled")

        event.is_cancelled = True
        event.cancellation_reason = reason
        event.cancelled_at = datetime.utcnow()
        event.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(event)

        # TODO: Send cancellation notifications to RSVPs

        return event

    async def delete_event(
        self, event_id: UUID, organization_id: UUID
    ) -> bool:
        """Delete an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return False

        await self.db.delete(event)
        await self.db.commit()

        return True

    # RSVP Methods

    async def create_or_update_rsvp(
        self, event_id: UUID, user_id: UUID, rsvp_data: RSVPCreate, organization_id: UUID
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """Create or update an RSVP"""
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Cannot RSVP to cancelled event"

        if not event.requires_rsvp:
            return None, "Event does not require RSVP"

        # Check RSVP deadline
        if event.rsvp_deadline and datetime.utcnow() > event.rsvp_deadline:
            return None, "RSVP deadline has passed"

        # Validate RSVP status against allowed statuses
        allowed_statuses = event.allowed_rsvp_statuses or ["going", "not_going"]
        if rsvp_data.status not in allowed_statuses:
            return None, f"RSVP status '{rsvp_data.status}' is not allowed for this event. Allowed statuses: {', '.join(allowed_statuses)}"

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        if existing_rsvp:
            # Update existing RSVP
            for field, value in rsvp_data.model_dump().items():
                setattr(existing_rsvp, field, value)
            existing_rsvp.updated_at = datetime.utcnow()
            rsvp = existing_rsvp
        else:
            # Create new RSVP
            rsvp = EventRSVP(
                event_id=event_id,
                user_id=user_id,
                **rsvp_data.model_dump()
            )
            self.db.add(rsvp)

        # Check capacity if user is going
        if rsvp_data.status == "going" and event.max_attendees:
            # Count current "going" RSVPs
            going_count_result = await self.db.execute(
                select(func.count(EventRSVP.id))
                .where(EventRSVP.event_id == event_id)
                .where(EventRSVP.status == RSVPStatus.GOING)
                .where(EventRSVP.id != (rsvp.id if existing_rsvp else None))
            )
            going_count = going_count_result.scalar() or 0

            if going_count >= event.max_attendees:
                return None, "Event is at capacity"

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def get_rsvp(
        self, event_id: UUID, user_id: UUID
    ) -> Optional[EventRSVP]:
        """Get a user's RSVP for an event"""
        result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_event_rsvps(
        self, event_id: UUID, organization_id: UUID, status_filter: Optional[str] = None
    ) -> List[EventRSVP]:
        """List all RSVPs for an event"""
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return []

        query = select(EventRSVP).where(EventRSVP.event_id == event_id)

        if status_filter:
            query = query.where(EventRSVP.status == status_filter)

        result = await self.db.execute(query.order_by(EventRSVP.responded_at.desc()))
        return list(result.scalars().all())

    async def check_in_attendee(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Check in an attendee

        If RSVP doesn't exist, creates one automatically with status 'going'.
        This allows check-in to work for events that don't require RSVP.
        """
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .where(User.organization_id == organization_id)
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.utcnow(),
            )
            self.db.add(rsvp)

        if rsvp.checked_in:
            return None, "Already checked in"

        rsvp.checked_in = True
        rsvp.checked_in_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def get_eligible_members(
        self, event_id: UUID, organization_id: UUID
    ) -> List[User]:
        """
        Get all members eligible to attend an event

        If event has eligible_roles specified, only returns members with those roles.
        Otherwise returns all members in the organization.
        """
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return []

        # Base query for users in the organization
        query = select(User).where(User.organization_id == organization_id)

        # Filter by eligible roles if specified
        if event.eligible_roles:
            # This is a simplified version - you may need to join with user_roles
            # based on your actual user-role relationship structure
            pass  # TODO: Add role filtering if needed

        query = query.order_by(User.last_name, User.first_name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_event_stats(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[EventStats]:
        """Get statistics for an event"""
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None

        # Count RSVPs by status
        rsvps_result = await self.db.execute(
            select(
                EventRSVP.status,
                func.count(EventRSVP.id),
                func.sum(EventRSVP.guest_count),
                func.count(EventRSVP.id).filter(EventRSVP.checked_in == True)
            )
            .where(EventRSVP.event_id == event_id)
            .group_by(EventRSVP.status)
        )
        rsvp_counts = rsvps_result.all()

        going_count = 0
        not_going_count = 0
        maybe_count = 0
        total_guests = 0
        checked_in_count = 0

        for status, count, guests, checked_in in rsvp_counts:
            if status == RSVPStatus.GOING:
                going_count = count
                total_guests = guests or 0
            elif status == RSVPStatus.NOT_GOING:
                not_going_count = count
            elif status == RSVPStatus.MAYBE:
                maybe_count = count

            if checked_in:
                checked_in_count += checked_in

        total_rsvps = going_count + not_going_count + maybe_count

        # Calculate capacity percentage
        capacity_percentage = None
        if event.max_attendees and event.max_attendees > 0:
            capacity_percentage = (going_count / event.max_attendees) * 100

        return EventStats(
            event_id=event.id,
            total_rsvps=total_rsvps,
            going_count=going_count,
            not_going_count=not_going_count,
            maybe_count=maybe_count,
            checked_in_count=checked_in_count,
            total_guests=total_guests,
            capacity_percentage=capacity_percentage,
        )

    async def record_actual_times(
        self,
        event_id: UUID,
        organization_id: UUID,
        actual_start_time: Optional[datetime],
        actual_end_time: Optional[datetime],
    ) -> Tuple[Optional[Event], Optional[str]]:
        """
        Record actual start and end times for an event

        This allows tracking the actual duration of the event for attendance purposes.
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        # Validate times if both are provided
        if actual_start_time and actual_end_time:
            if actual_end_time <= actual_start_time:
                return None, "Actual end time must be after actual start time"

        # Update times
        if actual_start_time is not None:
            event.actual_start_time = actual_start_time
        if actual_end_time is not None:
            event.actual_end_time = actual_end_time

        event.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(event)

        return event, None

    async def get_qr_check_in_data(
        self, event_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get QR code check-in data for an event

        Returns check-in URL and validates that the event is within the valid time window
        (1 hour before start until actual_end_time or scheduled end_datetime).

        Returns: (data_dict, error_message)
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Check time window
        now = datetime.utcnow()
        check_in_start = event.start_datetime - timedelta(hours=1)

        # Use actual_end_time if set (early end), otherwise use scheduled end_datetime
        check_in_end = event.actual_end_time if event.actual_end_time else event.end_datetime

        is_valid = check_in_start <= now <= check_in_end

        return {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value if event.event_type else None,
            "start_datetime": event.start_datetime.isoformat(),
            "end_datetime": event.end_datetime.isoformat(),
            "actual_end_time": event.actual_end_time.isoformat() if event.actual_end_time else None,
            "check_in_start": check_in_start.isoformat(),
            "check_in_end": check_in_end.isoformat(),
            "is_valid": is_valid,
            "location": event.location,
        }, None

    async def self_check_in(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Allow a user to check themselves in via QR code

        Similar to check_in_attendee but with additional time window validation
        and duplicate handling.

        Returns: (rsvp, error_message)
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .where(User.organization_id == organization_id)
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Check time window
        now = datetime.utcnow()
        check_in_start = event.start_datetime - timedelta(hours=1)
        check_in_end = event.actual_end_time if event.actual_end_time else event.end_datetime

        if now < check_in_start:
            return None, "Check-in is not available yet. It opens 1 hour before the event."

        if now > check_in_end:
            return None, "Check-in is no longer available. The event has ended."

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.utcnow(),
            )
            self.db.add(rsvp)

        # Check if already checked in
        if rsvp.checked_in:
            return None, "You are already checked in to this event"

        rsvp.checked_in = True
        rsvp.checked_in_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def check_location_overlap(
        self,
        location_id: UUID,
        start_datetime: datetime,
        end_datetime: datetime,
        organization_id: UUID,
        exclude_event_id: Optional[UUID] = None,
    ) -> List[Event]:
        """
        Check for events that overlap with the given time range at a specific location

        Returns list of overlapping events
        """
        if not location_id:
            return []

        query = (
            select(Event)
            .where(Event.location_id == location_id)
            .where(Event.organization_id == organization_id)
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
            query = query.where(Event.id != exclude_event_id)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_event_manager_emails(
        self, event_id: UUID
    ) -> List[str]:
        """
        Get email addresses of the event creator/manager for notification

        Returns list of email addresses
        """
        result = await self.db.execute(
            select(Event, User)
            .join(User, Event.created_by == User.id)
            .where(Event.id == event_id)
        )
        row = result.first()

        if not row:
            return []

        event, creator = row
        return [creator.email] if creator.email else []
