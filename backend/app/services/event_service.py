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

from app.models.event import Event, EventRSVP, EventTemplate, EventType, RSVPStatus, CheckInWindowType, RecurrencePattern
from app.models.user import User, Role, user_roles
from app.models.location import Location
from app.models.training import TrainingSession, TrainingRecord, TrainingStatus
from app.schemas.event import (
    EventCreate,
    EventUpdate,
    RSVPCreate,
    EventStats,
    EventResponse,
    RSVPResponse,
    RSVPOverride,
)
from app.services.location_service import LocationService
from app.services.notifications_service import NotificationsService
from app.models.notification import NotificationChannel, NotificationCategory


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

        # Check for location double-booking
        if event_data.location_id:
            location_service = LocationService(self.db)
            overlapping = await location_service.check_overlapping_events(
                location_id=event_data.location_id,
                organization_id=str(organization_id),
                start_datetime=event_data.start_datetime,
                end_datetime=event_data.end_datetime,
            )
            if overlapping:
                titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                raise ValueError(
                    f"Location is already booked during this time. "
                    f"Conflicting event(s): {titles}"
                )

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

        # Eagerly load location relationship for the response
        if event.location_id:
            result = await self.db.execute(
                select(Event)
                .where(Event.id == event.id)
                .options(selectinload(Event.location_obj))
            )
            event = result.scalar_one()

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
            .options(selectinload(Event.rsvps), selectinload(Event.location_obj))
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
        query = (
            select(Event)
            .where(Event.organization_id == organization_id)
            .options(selectinload(Event.rsvps), selectinload(Event.location_obj))
        )

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
            .options(selectinload(Event.location_obj))
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

        # Check for location double-booking if location or times are changing
        check_location_id = update_data.get("location_id", event.location_id)
        if check_location_id:
            location_service = LocationService(self.db)
            overlapping = await location_service.check_overlapping_events(
                location_id=check_location_id,
                organization_id=str(organization_id),
                start_datetime=start_dt,
                end_datetime=end_dt,
                exclude_event_id=event_id,
            )
            if overlapping:
                titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                raise ValueError(
                    f"Location is already booked during this time. "
                    f"Conflicting event(s): {titles}"
                )

        for field, value in update_data.items():
            setattr(event, field, value)

        event.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def cancel_event(
        self, event_id: UUID, organization_id: UUID, reason: str,
        send_notifications: bool = False,
    ) -> Optional[Event]:
        """Cancel an event and optionally notify RSVPs"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
            .options(selectinload(Event.location_obj), selectinload(Event.rsvps))
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

        # Send cancellation notifications if requested
        if send_notifications and event.rsvps:
            notifications_service = NotificationsService(self.db)
            for rsvp in event.rsvps:
                if rsvp.status == RSVPStatus.GOING or rsvp.status == RSVPStatus.MAYBE:
                    await notifications_service.log_notification(
                        organization_id=organization_id,
                        log_data={
                            "channel": NotificationChannel.IN_APP,
                            "recipient_id": str(rsvp.user_id),
                            "subject": f"Event Cancelled: {event.title}",
                            "message": f"The event \"{event.title}\" has been cancelled. Reason: {reason}",
                        },
                    )

        return event

    async def duplicate_event(
        self, event_id: UUID, organization_id: UUID, created_by: UUID
    ) -> Optional[Event]:
        """
        Duplicate an event, copying all configuration but not RSVPs or attendance data.

        The duplicated event gets a new title with "Copy of " prefix and
        resets all RSVP/attendance/cancellation state.
        """
        # Get the source event
        result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
            .options(selectinload(Event.location_obj))
        )
        source_event = result.scalar_one_or_none()

        if not source_event:
            return None

        # Fields to copy from the source event
        new_event = Event(
            organization_id=organization_id,
            created_by=created_by,
            title=f"Copy of {source_event.title}",
            description=source_event.description,
            event_type=source_event.event_type,
            location_id=source_event.location_id,
            location=source_event.location,
            location_details=source_event.location_details,
            start_datetime=source_event.start_datetime,
            end_datetime=source_event.end_datetime,
            requires_rsvp=source_event.requires_rsvp,
            rsvp_deadline=source_event.rsvp_deadline,
            max_attendees=source_event.max_attendees,
            allowed_rsvp_statuses=source_event.allowed_rsvp_statuses,
            is_mandatory=source_event.is_mandatory,
            eligible_roles=source_event.eligible_roles,
            allow_guests=source_event.allow_guests,
            send_reminders=source_event.send_reminders,
            reminder_hours_before=source_event.reminder_hours_before,
            check_in_window_type=source_event.check_in_window_type,
            check_in_minutes_before=source_event.check_in_minutes_before,
            check_in_minutes_after=source_event.check_in_minutes_after,
            require_checkout=source_event.require_checkout,
            custom_fields=source_event.custom_fields,
            attachments=source_event.attachments,
            template_id=source_event.template_id,
            # Explicitly NOT copying: RSVPs, cancellation state, actual times, recurrence
        )

        self.db.add(new_event)
        await self.db.commit()
        await self.db.refresh(new_event)

        # Eagerly load location relationship for the response
        if new_event.location_id:
            result = await self.db.execute(
                select(Event)
                .where(Event.id == new_event.id)
                .options(selectinload(Event.location_obj))
            )
            new_event = result.scalar_one()

        return new_event

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
            # Count current "going" RSVPs, excluding this user's RSVP if updating
            capacity_query = (
                select(func.count(EventRSVP.id))
                .where(EventRSVP.event_id == event_id)
                .where(EventRSVP.status == RSVPStatus.GOING)
            )
            if existing_rsvp:
                capacity_query = capacity_query.where(EventRSVP.id != existing_rsvp.id)

            going_count_result = await self.db.execute(capacity_query)
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

        query = select(EventRSVP).where(EventRSVP.event_id == event_id).options(selectinload(EventRSVP.user))

        if status_filter:
            query = query.where(EventRSVP.status == status_filter)

        result = await self.db.execute(query.order_by(EventRSVP.responded_at.desc()))
        return list(result.scalars().all())

    async def manager_add_attendee(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        manager_id: UUID,
        status: str = "going",
        checked_in: bool = False,
        notes: Optional[str] = None,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Manager adds an attendee to an event and optionally marks them checked in.

        This allows managers to add someone who had trouble logging in, or
        to retroactively give credit for attendance.
        """
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
            return None, "Cannot add attendees to a cancelled event"

        # Verify target user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .where(User.organization_id == organization_id)
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        now = datetime.utcnow()

        if existing_rsvp:
            # Update existing RSVP
            existing_rsvp.status = RSVPStatus(status)
            if notes is not None:
                existing_rsvp.notes = notes
            existing_rsvp.updated_at = now

            if checked_in and not existing_rsvp.checked_in:
                existing_rsvp.checked_in = True
                existing_rsvp.checked_in_at = now
                existing_rsvp.overridden_by = manager_id
                existing_rsvp.overridden_at = now

            rsvp = existing_rsvp
        else:
            # Create new RSVP
            rsvp = EventRSVP(
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus(status),
                guest_count=0,
                notes=notes,
                responded_at=now,
                checked_in=checked_in,
                checked_in_at=now if checked_in else None,
                overridden_by=manager_id if checked_in else None,
                overridden_at=now if checked_in else None,
            )
            self.db.add(rsvp)

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def override_rsvp_attendance(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        manager_id: UUID,
        override_data: RSVPOverride,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Override attendance details for an RSVP (manager action).

        Allows managers to fix check-in/check-out times and credit hours
        for attendees who had issues scanning in/out.
        """
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        # Get the RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            return None, "RSVP not found for this user"

        now = datetime.utcnow()
        override_fields = override_data.model_dump(exclude_unset=True)

        # Validate override times if both provided
        check_in = override_fields.get("override_check_in_at", rsvp.override_check_in_at)
        check_out = override_fields.get("override_check_out_at", rsvp.override_check_out_at)
        if check_in and check_out and check_out <= check_in:
            return None, "Override check-out time must be after check-in time"

        for field, value in override_fields.items():
            setattr(rsvp, field, value)

        # If overriding check-in time, also mark as checked in
        if override_fields.get("override_check_in_at"):
            rsvp.checked_in = True
            if not rsvp.checked_in_at:
                rsvp.checked_in_at = override_fields["override_check_in_at"]

        # Auto-calculate duration if both override times are set and no explicit duration override
        if (rsvp.override_check_in_at and rsvp.override_check_out_at
                and "override_duration_minutes" not in override_fields):
            duration = (rsvp.override_check_out_at - rsvp.override_check_in_at).total_seconds() / 60
            rsvp.override_duration_minutes = int(duration)

        rsvp.overridden_by = manager_id
        rsvp.overridden_at = now
        rsvp.updated_at = now

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def check_in_attendee(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Check in an attendee (manager action)

        If RSVP doesn't exist, creates one automatically with status 'going'.
        This allows check-in to work for events that don't require RSVP.
        Validates the check-in window to prevent check-ins outside allowed times.
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

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Validate check-in window
        now = datetime.utcnow()
        is_valid, error_msg = self._validate_check_in_window(event, now)
        if not is_valid:
            return None, error_msg

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

        # Filter by eligible roles if specified (list of role slugs)
        if event.eligible_roles:
            query = (
                query
                .join(user_roles, User.id == user_roles.c.user_id)
                .join(Role, Role.id == user_roles.c.role_id)
                .where(Role.slug.in_(event.eligible_roles))
                .distinct()
            )

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
                # Only count checked-in attendees who are still GOING
                checked_in_count = checked_in or 0
            elif status == RSVPStatus.NOT_GOING:
                not_going_count = count
            elif status == RSVPStatus.MAYBE:
                maybe_count = count

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
            .options(selectinload(Event.location_obj))
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
        # Get event with location
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == event_id)
            .where(Event.organization_id == organization_id)
            .options(selectinload(Event.location_obj))
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

        location_name = None
        if event.location_obj:
            location_name = event.location_obj.name

        return {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value if event.event_type else None,
            "event_description": event.description,
            "start_datetime": event.start_datetime.isoformat(),
            "end_datetime": event.end_datetime.isoformat(),
            "actual_end_time": event.actual_end_time.isoformat() if event.actual_end_time else None,
            "check_in_start": check_in_start.isoformat(),
            "check_in_end": check_in_end.isoformat(),
            "is_valid": is_valid,
            "location": event.location,
            "location_id": str(event.location_id) if event.location_id else None,
            "location_name": location_name,
            "require_checkout": event.require_checkout or False,
        }, None

    def _validate_check_in_window(self, event: Event, now: datetime) -> Tuple[bool, Optional[str]]:
        """
        Validate if check-in is allowed based on event's check-in window settings

        Returns: (is_valid, error_message)
        """
        check_in_window_type = event.check_in_window_type or CheckInWindowType.FLEXIBLE

        if check_in_window_type == CheckInWindowType.FLEXIBLE:
            # Allow check-in within configurable window before event starts, until event ends
            minutes_before = event.check_in_minutes_before or 30  # Default 30 minutes before
            check_in_start = event.start_datetime - timedelta(minutes=minutes_before)
            check_in_end = event.actual_end_time if event.actual_end_time else event.end_datetime

        elif check_in_window_type == CheckInWindowType.STRICT:
            # Only between actual start and end times
            check_in_start = event.actual_start_time if event.actual_start_time else event.start_datetime
            check_in_end = event.actual_end_time if event.actual_end_time else event.end_datetime

        else:  # WINDOW type
            # Configurable window before/after start
            minutes_before = event.check_in_minutes_before or 15
            minutes_after = event.check_in_minutes_after or 15
            check_in_start = event.start_datetime - timedelta(minutes=minutes_before)
            check_in_end = event.end_datetime + timedelta(minutes=minutes_after)

        if now < check_in_start:
            return False, f"Check-in is not available yet. Opens at {check_in_start.strftime('%I:%M %p')}."

        if now > check_in_end:
            return False, "Check-in is no longer available. The event has ended."

        return True, None

    async def self_check_in(
        self, event_id: UUID, user_id: UUID, organization_id: UUID, is_checkout: bool = False
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Allow a user to check themselves in or out via QR code

        Args:
            event_id: Event ID
            user_id: User ID
            organization_id: Organization ID
            is_checkout: True if this is a check-out request

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

        now = datetime.utcnow()

        # Validate check-in window
        is_valid, error_msg = self._validate_check_in_window(event, now)
        if not is_valid:
            return None, error_msg

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == event_id)
            .where(EventRSVP.user_id == user_id)
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            if is_checkout:
                return None, "Cannot check out without checking in first"

            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.utcnow(),
            )
            self.db.add(rsvp)

        # Handle check-out
        if is_checkout:
            if not rsvp.checked_in:
                return None, "You are not checked in to this event"

            if rsvp.checked_out_at:
                return None, "You have already checked out of this event"

            rsvp.checked_out_at = now

            # Calculate attendance duration
            check_in_time = rsvp.override_check_in_at or rsvp.checked_in_at
            check_out_time = now
            if check_in_time and check_out_time:
                duration = (check_out_time - check_in_time).total_seconds() / 60
                rsvp.attendance_duration_minutes = int(duration)

            await self.db.commit()
            await self.db.refresh(rsvp)

            return rsvp, None

        # Handle check-in
        if rsvp.checked_in:
            # Already checked in - return special message to prompt for checkout
            return rsvp, "ALREADY_CHECKED_IN"

        rsvp.checked_in = True
        rsvp.checked_in_at = now

        await self.db.commit()
        await self.db.refresh(rsvp)

        # Auto-create TrainingRecord if this is a training event
        await self._auto_create_training_record(event, rsvp, user_id, organization_id)

        return rsvp, None

    async def _auto_create_training_record(
        self, event: Event, rsvp: EventRSVP, user_id: UUID, organization_id: UUID
    ) -> None:
        """
        Auto-create a TrainingRecord if the event is a training session with auto_create_records enabled
        """
        if event.event_type != EventType.TRAINING:
            return

        # Check if this event has a training session
        session_result = await self.db.execute(
            select(TrainingSession)
            .where(TrainingSession.event_id == event.id)
        )
        training_session = session_result.scalar_one_or_none()

        if not training_session:
            return

        if not training_session.auto_create_records:
            return

        # Check if training record already exists
        existing_record_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.course_name == training_session.course_name)
            .where(TrainingRecord.scheduled_date == event.start_datetime.date())
        )
        existing_record = existing_record_result.scalar_one_or_none()

        if existing_record:
            return  # Record already exists

        # Create training record
        training_record = TrainingRecord(
            organization_id=organization_id,
            user_id=user_id,
            course_id=training_session.course_id,
            course_name=training_session.course_name,
            course_code=training_session.course_code,
            training_type=training_session.training_type,
            scheduled_date=event.start_datetime.date(),
            completion_date=None,  # Will be set when event ends or approved
            status=TrainingStatus.IN_PROGRESS,
            hours_completed=0.0,  # Will be calculated from attendance duration
            credit_hours=training_session.credit_hours,
            instructor=training_session.instructor,
            location=event.location,
            certification_number=None,  # Will be generated upon completion if applicable
            issuing_agency=training_session.issuing_agency if training_session.issues_certification else None,
            created_by=user_id,
        )

        self.db.add(training_record)
        await self.db.commit()

    async def get_check_in_monitoring_stats(
        self, event_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get real-time check-in monitoring statistics for an event.

        Returns:
            Tuple of (stats_dict, error_message)
        """
        # Get event
        result = await self.db.execute(
            select(Event).where(Event.id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.organization_id != organization_id:
            return None, "Event not found in your organization"

        # Calculate check-in window
        now = datetime.utcnow()
        check_in_start = event.start_datetime - timedelta(hours=1)
        check_in_end = event.actual_end_time if event.actual_end_time else event.end_datetime
        is_check_in_active = check_in_start <= now <= check_in_end

        # Get all RSVPs with user details
        rsvp_result = await self.db.execute(
            select(EventRSVP, User)
            .join(User, EventRSVP.user_id == User.id)
            .where(EventRSVP.event_id == event_id)
            .order_by(EventRSVP.checked_in_at.desc().nullslast())
        )
        rsvps_with_users = rsvp_result.all()

        # Get total eligible members in organization
        eligible_members_result = await self.db.execute(
            select(func.count(User.id))
            .where(User.organization_id == organization_id)
            .where(User.is_active == True)
        )
        total_eligible_members = eligible_members_result.scalar() or 0

        # Calculate stats
        total_rsvps = len(rsvps_with_users)
        checked_in_rsvps = [r for r, u in rsvps_with_users if r.checked_in]
        total_checked_in = len(checked_in_rsvps)
        check_in_rate = (total_checked_in / total_eligible_members * 100) if total_eligible_members > 0 else 0

        # Get recent check-ins (last 10)
        recent_check_ins = []
        for rsvp, user in rsvps_with_users:
            if rsvp.checked_in and rsvp.checked_in_at:
                recent_check_ins.append({
                    "user_id": str(user.id),
                    "user_name": f"{user.first_name} {user.last_name}",
                    "user_email": user.email,
                    "checked_in_at": rsvp.checked_in_at,
                    "rsvp_status": rsvp.status.value,
                    "guest_count": rsvp.guest_count or 0,
                })
                if len(recent_check_ins) >= 10:
                    break

        # Calculate average check-in time (minutes before event start)
        avg_check_in_time = None
        last_check_in_at = None
        if checked_in_rsvps:
            check_in_times = []
            for rsvp in checked_in_rsvps:
                if rsvp.checked_in_at:
                    time_diff = (event.start_datetime - rsvp.checked_in_at).total_seconds() / 60
                    check_in_times.append(time_diff)
                    if not last_check_in_at or rsvp.checked_in_at > last_check_in_at:
                        last_check_in_at = rsvp.checked_in_at

            if check_in_times:
                avg_check_in_time = sum(check_in_times) / len(check_in_times)

        stats = {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value,
            "start_datetime": event.start_datetime,
            "end_datetime": event.end_datetime,
            "is_check_in_active": is_check_in_active,
            "check_in_window_start": check_in_start,
            "check_in_window_end": check_in_end,
            "total_eligible_members": total_eligible_members,
            "total_rsvps": total_rsvps,
            "total_checked_in": total_checked_in,
            "check_in_rate": round(check_in_rate, 2),
            "recent_check_ins": recent_check_ins,
            "avg_check_in_time_minutes": round(avg_check_in_time, 2) if avg_check_in_time else None,
            "last_check_in_at": last_check_in_at,
        }

        return stats, None

    # ============================================================
    # Event Templates
    # ============================================================

    async def create_template(
        self, template_data: Dict[str, Any], organization_id: UUID, created_by: UUID
    ) -> EventTemplate:
        """Create a new event template"""
        template = EventTemplate(
            organization_id=str(organization_id),
            created_by=str(created_by),
            **template_data,
        )
        self.db.add(template)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def list_templates(
        self, organization_id: UUID, include_inactive: bool = False
    ) -> List[EventTemplate]:
        """List all event templates for an organization"""
        query = (
            select(EventTemplate)
            .where(EventTemplate.organization_id == str(organization_id))
        )
        if not include_inactive:
            query = query.where(EventTemplate.is_active == True)
        query = query.order_by(EventTemplate.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_template(
        self, template_id: UUID, organization_id: UUID
    ) -> Optional[EventTemplate]:
        """Get a specific event template"""
        result = await self.db.execute(
            select(EventTemplate)
            .where(EventTemplate.id == str(template_id))
            .where(EventTemplate.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_template(
        self, template_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[EventTemplate]:
        """Update an event template"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return None

        for field, value in update_data.items():
            setattr(template, field, value)

        template.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def delete_template(
        self, template_id: UUID, organization_id: UUID
    ) -> bool:
        """Soft-delete a template by deactivating it"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return False

        template.is_active = False
        template.updated_at = datetime.utcnow()
        await self.db.commit()
        return True

    # ============================================================
    # Recurring Events
    # ============================================================

    def _generate_recurrence_dates(
        self,
        start_datetime: datetime,
        end_datetime: datetime,
        pattern: str,
        recurrence_end_date: datetime,
        custom_days: Optional[List[int]] = None,
    ) -> List[Tuple[datetime, datetime]]:
        """
        Generate all occurrence dates for a recurring event.

        Returns list of (start, end) datetime tuples.
        """
        duration = end_datetime - start_datetime
        occurrences = []
        current = start_datetime

        while current <= recurrence_end_date:
            occurrences.append((current, current + duration))

            if pattern == RecurrencePattern.DAILY.value:
                current += timedelta(days=1)
            elif pattern == RecurrencePattern.WEEKLY.value:
                current += timedelta(weeks=1)
            elif pattern == RecurrencePattern.BIWEEKLY.value:
                current += timedelta(weeks=2)
            elif pattern == RecurrencePattern.MONTHLY.value:
                # Move to same day next month
                month = current.month + 1
                year = current.year
                if month > 12:
                    month = 1
                    year += 1
                try:
                    current = current.replace(year=year, month=month)
                except ValueError:
                    # Handle months with fewer days (e.g., Jan 31 -> Feb 28)
                    import calendar
                    last_day = calendar.monthrange(year, month)[1]
                    current = current.replace(year=year, month=month, day=min(current.day, last_day))
            elif pattern == RecurrencePattern.CUSTOM.value and custom_days:
                # Find next matching weekday
                found = False
                for i in range(1, 8):
                    next_date = current + timedelta(days=i)
                    if next_date.weekday() in custom_days:
                        current = next_date
                        found = True
                        break
                if not found:
                    break
            else:
                break

        return occurrences

    async def create_recurring_event(
        self,
        event_data: Dict[str, Any],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[List[Event], Optional[str]]:
        """
        Create a series of recurring events.

        Creates a parent event and individual occurrences.
        """
        recurrence_pattern = event_data.pop("recurrence_pattern")
        recurrence_end_date = event_data.pop("recurrence_end_date")
        recurrence_custom_days = event_data.pop("recurrence_custom_days", None)

        # Generate occurrence dates
        occurrences = self._generate_recurrence_dates(
            start_datetime=event_data["start_datetime"],
            end_datetime=event_data["end_datetime"],
            pattern=recurrence_pattern,
            recurrence_end_date=recurrence_end_date,
            custom_days=recurrence_custom_days,
        )

        if len(occurrences) == 0:
            return [], "No valid occurrences generated for the given recurrence pattern"

        if len(occurrences) > 365:
            return [], "Too many occurrences (max 365). Please narrow the date range."

        # Create parent event (first occurrence)
        parent_event = Event(
            organization_id=str(organization_id),
            created_by=str(created_by),
            is_recurring=True,
            recurrence_pattern=RecurrencePattern(recurrence_pattern),
            recurrence_end_date=recurrence_end_date,
            recurrence_custom_days=recurrence_custom_days,
            start_datetime=occurrences[0][0],
            end_datetime=occurrences[0][1],
            **{k: v for k, v in event_data.items() if k not in ("start_datetime", "end_datetime")},
        )
        self.db.add(parent_event)
        await self.db.flush()  # Get the parent ID

        created_events = [parent_event]

        # Create child events for subsequent occurrences
        for start, end in occurrences[1:]:
            child_event = Event(
                organization_id=str(organization_id),
                created_by=str(created_by),
                is_recurring=True,
                recurrence_parent_id=parent_event.id,
                recurrence_pattern=RecurrencePattern(recurrence_pattern),
                start_datetime=start,
                end_datetime=end,
                **{k: v for k, v in event_data.items() if k not in ("start_datetime", "end_datetime")},
            )
            self.db.add(child_event)
            created_events.append(child_event)

        await self.db.commit()
        return created_events, None
