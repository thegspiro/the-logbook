"""
Event Service

Business logic for event management.
"""

import calendar
import csv
import io
import logging
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event import (
    CheckInWindowType,
    Event,
    EventRSVP,
    EventTemplate,
    EventType,
    RecurrencePattern,
    RSVPHistory,
    RSVPStatus,
)
from app.models.notification import NotificationCategory, NotificationChannel
from app.models.training import TrainingRecord, TrainingSession, TrainingStatus
from app.models.user import Organization, User
from app.schemas.event import (
    EventCreate,
    EventStats,
    EventUpdate,
    RSVPCreate,
    RSVPOverride,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.location_service import LocationService
from app.services.notifications_service import NotificationsService

logger = logging.getLogger(__name__)


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
            organization_id=organization_id, created_by=created_by, **event_dict
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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
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
                .where(EventRSVP.event_id == str(event_id))
                .where(EventRSVP.user_id == str(user_id))
            )
            user_rsvp = rsvp_result.scalar_one_or_none()

        return event, user_rsvp

    async def list_events(
        self,
        organization_id: UUID,
        event_type: Optional[str] = None,
        custom_category: Optional[str] = None,
        exclude_event_types: Optional[List[str]] = None,
        start_after: Optional[datetime] = None,
        start_before: Optional[datetime] = None,
        end_after: Optional[datetime] = None,
        end_before: Optional[datetime] = None,
        include_cancelled: bool = False,
        include_drafts: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Event]:
        """List events with filtering"""
        query = (
            select(Event)
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.rsvps), selectinload(Event.location_obj))
        )

        if not include_drafts:
            query = query.where(
                or_(Event.is_draft == False, Event.is_draft.is_(None))  # noqa: E712
            )

        if event_type:
            query = query.where(Event.event_type == event_type)

        if custom_category:
            query = query.where(Event.custom_category == custom_category)

        if exclude_event_types:
            query = query.where(Event.event_type.notin_(exclude_event_types))

        if not include_cancelled:
            query = query.where(Event.is_cancelled == False)  # noqa: E712

        if start_after:
            query = query.where(Event.start_datetime >= start_after)

        if start_before:
            query = query.where(Event.start_datetime <= start_before)

        if end_after:
            query = query.where(Event.end_datetime >= end_after)

        if end_before:
            query = query.where(Event.end_datetime <= end_before)

        query = query.order_by(Event.start_datetime).offset(skip).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        event_data: EventUpdate,
        updated_by: Optional[UUID] = None,
    ) -> Optional[Event]:
        """Update an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
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

        if updated_by:
            event.updated_by = str(updated_by)
        event.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def publish_event(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[Event]:
        """Publish a draft event by setting is_draft to False"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        if not event.is_draft:
            raise ValueError("Event is already published")

        event.is_draft = False
        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def update_future_events(
        self,
        event_id: UUID,
        organization_id: UUID,
        event_data: EventUpdate,
        updated_by: Optional[UUID] = None,
    ) -> int:
        """Update this event and all future events in the same recurring series.

        Returns the count of updated events.
        """
        # Fetch the anchor event
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        anchor = result.scalar_one_or_none()

        if not anchor:
            raise ValueError("Event not found")

        if anchor.is_cancelled:
            raise ValueError("Cannot update cancelled event")

        # Determine the series parent id
        parent_id = anchor.recurrence_parent_id or anchor.id

        # Query all events in the series with start_datetime >= anchor's start
        result = await self.db.execute(
            select(Event).where(
                Event.organization_id == str(organization_id),
                Event.is_cancelled == False,  # noqa: E712
                or_(
                    Event.id == str(parent_id),
                    Event.recurrence_parent_id == str(parent_id),
                ),
                Event.start_datetime >= anchor.start_datetime,
            )
        )
        future_events = result.scalars().all()

        update_data = event_data.model_dump(exclude_unset=True)
        now = datetime.now(dt_timezone.utc)
        updated_count = 0

        for event in future_events:
            for field, value in update_data.items():
                setattr(event, field, value)
            if updated_by:
                event.updated_by = str(updated_by)
            event.updated_at = now
            updated_count += 1

        if updated_count > 0:
            await self.db.commit()

        return updated_count

    async def cancel_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        reason: str,
        send_notifications: bool = False,
    ) -> Optional[Event]:
        """Cancel an event and optionally notify RSVPs"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj), selectinload(Event.rsvps))
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        if event.is_cancelled:
            raise ValueError("Event is already cancelled")

        event.is_cancelled = True
        event.cancellation_reason = reason
        event.cancelled_at = datetime.now(dt_timezone.utc)
        event.updated_at = datetime.now(dt_timezone.utc)

        # Capture rsvps before commit expires the relationship
        rsvps_to_notify = list(event.rsvps)

        await self.db.commit()
        await self.db.refresh(event)

        # Send cancellation notifications if requested
        if send_notifications and rsvps_to_notify:
            notifications_service = NotificationsService(self.db)
            for rsvp in rsvps_to_notify:
                if rsvp.status == RSVPStatus.GOING or rsvp.status == RSVPStatus.MAYBE:
                    await notifications_service.log_notification(
                        organization_id=organization_id,
                        log_data={
                            "channel": NotificationChannel.IN_APP,
                            "recipient_id": str(rsvp.user_id),
                            "subject": f"Event Cancelled: {event.title}",
                            "message": f'The event "{event.title}" has been cancelled. Reason: {reason}',
                        },
                    )

        return event

    async def cancel_series(
        self,
        parent_event_id: UUID,
        organization_id: UUID,
        reason: str,
        cancel_future_only: bool = False,
    ) -> int:
        """Cancel all events in a recurring series.

        Returns the number of events cancelled.
        """
        # Build query for all events in the series (parent + children)
        conditions = [
            Event.organization_id == str(organization_id),
            Event.is_cancelled == False,  # noqa: E712
        ]

        if cancel_future_only:
            conditions.append(Event.start_datetime >= datetime.now(dt_timezone.utc))

        conditions.append(
            or_(
                Event.id == str(parent_event_id),
                Event.recurrence_parent_id == str(parent_event_id),
            )
        )

        result = await self.db.execute(select(Event).where(*conditions))
        events = result.scalars().all()

        now = datetime.now(dt_timezone.utc)
        cancelled_count = 0
        for event in events:
            event.is_cancelled = True
            event.cancellation_reason = reason
            event.cancelled_at = now
            event.updated_at = now
            cancelled_count += 1

        if cancelled_count > 0:
            await self.db.commit()

        return cancelled_count

    async def duplicate_event(
        self, event_id: UUID, organization_id: UUID, created_by: UUID
    ) -> Optional[Event]:
        """
        Duplicate an event, copying all configuration but not RSVPs or attendance data.

        Resets RSVP/attendance/cancellation state.
        """
        # Get the source event
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        source_event = result.scalar_one_or_none()

        if not source_event:
            return None

        # Fields to copy from the source event
        new_event = Event(
            organization_id=organization_id,
            created_by=created_by,
            title=source_event.title,
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
            allow_guests=source_event.allow_guests,
            send_reminders=source_event.send_reminders,
            reminder_schedule=source_event.reminder_schedule,
            check_in_window_type=source_event.check_in_window_type,
            check_in_minutes_before=source_event.check_in_minutes_before,
            check_in_minutes_after=source_event.check_in_minutes_after,
            require_checkout=source_event.require_checkout,
            custom_category=source_event.custom_category,
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

    async def delete_event(self, event_id: UUID, organization_id: UUID) -> bool:
        """Delete an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = result.scalar_one_or_none()

        if not event:
            return False

        await self.db.delete(event)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise ValueError(
                "Cannot delete event because it has linked records "
                "(e.g. meeting minutes). Remove or unlink them first."
            )

        return True

    async def delete_event_series(
        self,
        parent_event_id: UUID,
        organization_id: UUID,
        delete_future_only: bool = False,
    ) -> int:
        """Delete all events in a recurring series.

        Returns the number of events deleted.
        """
        conditions = [
            Event.organization_id == str(organization_id),
            or_(
                Event.id == str(parent_event_id),
                Event.recurrence_parent_id == str(parent_event_id),
            ),
        ]

        if delete_future_only:
            conditions.append(Event.start_datetime >= datetime.now(dt_timezone.utc))

        result = await self.db.execute(select(Event).where(*conditions))
        events = result.scalars().all()

        if not events:
            return 0

        for event in events:
            await self.db.delete(event)

        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise ValueError(
                "Cannot delete series because some events have linked records "
                "(e.g. meeting minutes). Remove or unlink them first."
            )

        return len(events)

    # RSVP Methods

    async def create_or_update_rsvp(
        self,
        event_id: UUID,
        user_id: UUID,
        rsvp_data: RSVPCreate,
        organization_id: UUID,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """Create or update an RSVP"""
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Cannot RSVP to cancelled event"

        if not event.requires_rsvp:
            return None, "Event does not require RSVP"

        # Check RSVP deadline — ensure deadline is timezone-aware before comparing
        rsvp_deadline = event.rsvp_deadline
        if rsvp_deadline and rsvp_deadline.tzinfo is None:
            rsvp_deadline = rsvp_deadline.replace(tzinfo=dt_timezone.utc)
        if rsvp_deadline and datetime.now(dt_timezone.utc) > rsvp_deadline:
            return None, "RSVP deadline has passed"

        # Validate RSVP status against allowed statuses
        allowed_statuses = event.allowed_rsvp_statuses or ["going", "not_going"]
        if rsvp_data.status not in allowed_statuses:
            return (
                None,
                f"RSVP status '{rsvp_data.status}' is not allowed. "
                f"Allowed statuses: {', '.join(allowed_statuses)}",
            )

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        old_status = None
        if existing_rsvp:
            # Capture old status before updating
            old_status = existing_rsvp.status
            if isinstance(old_status, RSVPStatus):
                old_status = old_status.value
            # Update existing RSVP
            for field, value in rsvp_data.model_dump().items():
                setattr(existing_rsvp, field, value)
            existing_rsvp.updated_at = datetime.now(dt_timezone.utc)
            rsvp = existing_rsvp
        else:
            # Create new RSVP
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                **rsvp_data.model_dump(),
            )
            self.db.add(rsvp)

        # Check capacity if user is going
        old_status_was_going = (
            existing_rsvp
            and existing_rsvp.status == RSVPStatus.GOING
        )
        if rsvp_data.status == RSVPStatus.GOING.value and event.max_attendees:
            # Count current "going" RSVPs, excluding this user's RSVP if updating
            capacity_query = (
                select(func.count(EventRSVP.id))
                .where(EventRSVP.event_id == str(event_id))
                .where(EventRSVP.status == RSVPStatus.GOING)
            )
            if existing_rsvp:
                capacity_query = capacity_query.where(EventRSVP.id != existing_rsvp.id)

            going_count_result = await self.db.execute(capacity_query)
            going_count = going_count_result.scalar() or 0

            if going_count >= event.max_attendees:
                # Auto-waitlist instead of rejecting
                rsvp.status = RSVPStatus.WAITLISTED

        # Flush to ensure rsvp.id is available for history record
        await self.db.flush()

        # Record RSVP history if status changed or this is a new RSVP
        new_status = rsvp.status
        if isinstance(new_status, RSVPStatus):
            new_status = new_status.value
        if old_status != new_status:
            history_entry = RSVPHistory(
                rsvp_id=rsvp.id,
                event_id=str(event_id),
                user_id=str(user_id),
                old_status=old_status,
                new_status=new_status,
                changed_at=datetime.now(dt_timezone.utc),
            )
            self.db.add(history_entry)

        await self.db.commit()
        await self.db.refresh(rsvp)

        # Auto-promote from waitlist if someone changed from going to not_going
        if (
            old_status_was_going
            and rsvp_data.status != RSVPStatus.GOING.value
            and event.max_attendees
        ):
            await self.promote_from_waitlist(event_id, organization_id)

        return rsvp, None

    async def get_rsvp_history(
        self,
        event_id: UUID,
        organization_id: UUID,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Get RSVP change history for an event"""
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        # Fetch history with user names
        result = await self.db.execute(
            select(RSVPHistory)
            .where(RSVPHistory.event_id == str(event_id))
            .order_by(RSVPHistory.changed_at.desc())
            .limit(limit)
        )
        history_entries = result.scalars().all()

        # Collect user IDs for name lookup
        user_ids = set()
        for entry in history_entries:
            user_ids.add(entry.user_id)
            if entry.changed_by:
                user_ids.add(entry.changed_by)

        # Fetch user names
        user_names: Dict[str, str] = {}
        if user_ids:
            users_result = await self.db.execute(
                select(User).where(User.id.in_(list(user_ids)))
            )
            for u in users_result.scalars().all():
                name = f"{u.first_name} {u.last_name}".strip()
                user_names[u.id] = name or u.email

        # Build response
        items = []
        for entry in history_entries:
            items.append({
                "id": entry.id,
                "rsvp_id": entry.rsvp_id,
                "event_id": entry.event_id,
                "user_id": entry.user_id,
                "old_status": entry.old_status,
                "new_status": entry.new_status,
                "changed_at": entry.changed_at,
                "changed_by": entry.changed_by,
                "user_name": user_names.get(entry.user_id, "Unknown"),
                "changer_name": (
                    user_names.get(entry.changed_by, "Unknown")
                    if entry.changed_by
                    else None
                ),
            })
        return items

    async def promote_from_waitlist(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[EventRSVP]:
        """
        Promote the earliest waitlisted RSVP for an event to 'going'.

        Returns the promoted RSVP or None if no waitlisted users exist.
        """
        # Find the earliest waitlisted RSVP by responded_at
        result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.organization_id == str(organization_id))
            .where(EventRSVP.status == RSVPStatus.WAITLISTED)
            .order_by(EventRSVP.responded_at.asc())
            .limit(1)
        )
        waitlisted_rsvp = result.scalar_one_or_none()

        if not waitlisted_rsvp:
            return None

        waitlisted_rsvp.status = RSVPStatus.GOING
        waitlisted_rsvp.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(waitlisted_rsvp)

        return waitlisted_rsvp

    async def rsvp_to_series(
        self,
        parent_event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        rsvp_data: RSVPCreate,
    ) -> int:
        """
        RSVP to all future, non-cancelled events in a recurring series.

        Returns the count of RSVPs created/updated.
        """
        now = datetime.now(dt_timezone.utc)

        # Find all future events in the series (parent + children)
        result = await self.db.execute(
            select(Event)
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled.is_(False))
            .where(Event.start_datetime > now)
            .where(
                or_(
                    Event.id == str(parent_event_id),
                    Event.recurrence_parent_id == str(parent_event_id),
                )
            )
        )
        series_events = result.scalars().all()

        rsvp_count = 0
        for event in series_events:
            if not event.requires_rsvp:
                continue

            # Check for existing RSVP
            existing_result = await self.db.execute(
                select(EventRSVP)
                .where(EventRSVP.event_id == event.id)
                .where(EventRSVP.user_id == str(user_id))
            )
            existing_rsvp = existing_result.scalar_one_or_none()

            if existing_rsvp:
                for field, value in rsvp_data.model_dump().items():
                    setattr(existing_rsvp, field, value)
                existing_rsvp.updated_at = now
            else:
                new_rsvp = EventRSVP(
                    organization_id=organization_id,
                    event_id=event.id,
                    user_id=user_id,
                    **rsvp_data.model_dump(),
                )
                self.db.add(new_rsvp)

            rsvp_count += 1

        await self.db.commit()
        return rsvp_count

    async def get_rsvp(self, event_id: UUID, user_id: UUID) -> Optional[EventRSVP]:
        """Get a user's RSVP for an event"""
        result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        return result.scalar_one_or_none()

    async def list_event_rsvps(
        self,
        event_id: UUID,
        organization_id: UUID,
        status_filter: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[EventRSVP]:
        """List all RSVPs for an event"""
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return []

        query = (
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .options(selectinload(EventRSVP.user))
        )

        if status_filter:
            query = query.where(EventRSVP.status == status_filter)

        query = query.order_by(EventRSVP.responded_at.desc()).offset(skip).limit(limit)

        result = await self.db.execute(query)
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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Cannot add attendees to a cancelled event"

        # Verify target user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        now = datetime.now(dt_timezone.utc)

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
                organization_id=organization_id,
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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        # Get the RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            return None, "RSVP not found for this user"

        now = datetime.now(dt_timezone.utc)
        override_fields = override_data.model_dump(exclude_unset=True)

        # Validate override times if both provided
        check_in = override_fields.get(
            "override_check_in_at", rsvp.override_check_in_at
        )
        check_out = override_fields.get(
            "override_check_out_at", rsvp.override_check_out_at
        )
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
        if (
            rsvp.override_check_in_at
            and rsvp.override_check_out_at
            and "override_duration_minutes" not in override_fields
        ):
            duration = (
                rsvp.override_check_out_at - rsvp.override_check_in_at
            ).total_seconds() / 60
            rsvp.override_duration_minutes = int(duration)

        rsvp.overridden_by = manager_id
        rsvp.overridden_at = now
        rsvp.updated_at = now

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def remove_attendee(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Optional[str]:
        """
        Remove an attendee's RSVP from an event (manager action).

        Returns an error string on failure, or None on success.
        """
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return "Event not found"

        # Get the RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            return "RSVP not found for this user"

        was_going = rsvp.status == RSVPStatus.GOING
        await self.db.delete(rsvp)
        await self.db.commit()

        # Auto-promote from waitlist if a "going" attendee was removed
        if was_going and event.max_attendees:
            await self.promote_from_waitlist(event_id, organization_id)

        return None

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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Get organization timezone for user-facing messages
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        # Validate check-in window
        now = datetime.now(dt_timezone.utc)
        is_valid, error_msg = self._validate_check_in_window(event, now, tz_name)
        if not is_valid:
            return None, error_msg

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.now(dt_timezone.utc),
            )
            self.db.add(rsvp)

        if rsvp.checked_in:
            return None, "Already checked in"

        rsvp.checked_in = True
        rsvp.checked_in_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def get_event_stats(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[EventStats]:
        """Get statistics for an event"""
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
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
                func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)),
            )
            .where(EventRSVP.event_id == str(event_id))
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
            capacity_percentage = round((going_count / event.max_attendees) * 100, 2)

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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
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

        event.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(event)

        # Auto-finalize attendance when actual end time is recorded
        if actual_end_time is not None:
            await self.finalize_event_attendance(event_id, organization_id)

        return event, None

    async def finalize_event_attendance(
        self,
        event_id: UUID,
        organization_id: UUID,
    ) -> Tuple[int, Optional[str]]:
        """
        Finalize attendance duration for all checked-in members who didn't check out.

        When require_checkout is false (the default), members check in but never
        check out, leaving attendance_duration_minutes as NULL. This method
        calculates duration using: actual_end_time (if recorded) > end_datetime,
        minus the member's check-in time.

        Also updates any linked training records that have hours_completed == 0.

        Returns:
            Tuple of (number_of_rsvps_updated, error_message)
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return 0, "Event not found"

        # Determine effective end time: actual_end_time takes priority
        effective_end = event.actual_end_time or event.end_datetime
        if not effective_end:
            return 0, "Event has no end time"

        # Get all RSVPs that are checked in but have no checkout and no duration set
        rsvp_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_out_at.is_(None),
                EventRSVP.override_duration_minutes.is_(None),
                EventRSVP.attendance_duration_minutes.is_(None),
            )
        )
        rsvps = list(rsvp_result.scalars().all())

        if not rsvps:
            return 0, None

        # Get linked training session if this is a training event
        training_session = None
        if event.event_type == EventType.TRAINING:
            session_result = await self.db.execute(
                select(TrainingSession).where(TrainingSession.event_id == event.id)
            )
            training_session = session_result.scalar_one_or_none()

        updated_count = 0
        for rsvp in rsvps:
            check_in_time = rsvp.override_check_in_at or rsvp.checked_in_at
            if not check_in_time:
                continue

            duration_minutes = (effective_end - check_in_time).total_seconds() / 60
            duration_minutes = max(0, int(duration_minutes))
            rsvp.attendance_duration_minutes = duration_minutes
            updated_count += 1

            # Update linked training record if hours are still 0
            if training_session:
                record_result = await self.db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.user_id == str(rsvp.user_id),
                        TrainingRecord.course_name == training_session.course_name,
                        TrainingRecord.scheduled_date == event.start_datetime.date(),
                    )
                )
                training_record = record_result.scalar_one_or_none()
                if training_record and (
                    training_record.hours_completed is None
                    or training_record.hours_completed == 0
                ):
                    training_record.hours_completed = round(duration_minutes / 60.0, 2)

        await self.db.commit()

        # Auto-credit event hours to admin hours categories via mappings
        admin_hours_service = AdminHoursService(self.db)
        event_type_val = (
            event.event_type.value if event.event_type else None
        )
        for rsvp in rsvps:
            check_in_time = rsvp.override_check_in_at or rsvp.checked_in_at
            duration = (
                rsvp.override_duration_minutes
                or rsvp.attendance_duration_minutes
            )
            if not check_in_time or not duration or duration <= 0:
                continue
            check_out_time = rsvp.checked_out_at or effective_end
            try:
                await admin_hours_service.credit_event_attendance(
                    organization_id=str(event.organization_id),
                    user_id=str(rsvp.user_id),
                    event_id=str(event.id),
                    rsvp_id=str(rsvp.id),
                    event_title=event.title or "Event",
                    check_in_at=check_in_time,
                    check_out_at=check_out_time,
                    duration_minutes=duration,
                    event_type=event_type_val,
                    custom_category=event.custom_category,
                )
            except Exception:
                logger.exception(
                    "Failed to credit admin hours for RSVP %s", rsvp.id
                )
        await self.db.commit()

        return updated_count, None

    async def end_event(
        self,
        event_id: UUID,
        organization_id: UUID,
    ) -> Tuple[Optional[Event], int, Optional[str]]:
        """
        End an in-progress event: record actual_end_time as now,
        bulk-checkout all checked-in members, and finalize attendance.

        Returns:
            Tuple of (event, checked_out_count, error_message)
        """
        now = datetime.now(dt_timezone.utc)

        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, 0, "Event not found"

        if event.is_cancelled:
            return None, 0, "Cannot end a cancelled event"

        if event.actual_end_time:
            return None, 0, "Event has already ended"

        # Record actual start time if not already set
        if not event.actual_start_time:
            event.actual_start_time = event.start_datetime

        event.actual_end_time = now
        event.updated_at = now

        # Bulk-checkout all checked-in members who haven't checked out
        rsvp_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_out_at.is_(None),
            )
        )
        rsvps = list(rsvp_result.scalars().all())

        for rsvp in rsvps:
            rsvp.checked_out_at = now

        await self.db.commit()
        await self.db.refresh(event)

        # Finalize attendance durations
        updated_count, _ = await self.finalize_event_attendance(
            event_id, organization_id
        )

        return event, len(rsvps), None

    async def get_qr_check_in_data(
        self, event_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get QR code check-in data for an event

        Returns check-in URL and validates that the event is within the valid
        check-in window based on the event's check_in_window_type settings
        (same logic as self_check_in).

        Returns: (data_dict, error_message)
        """
        # Get event with location and organization (for timezone)
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Fetch organization timezone for display
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        org_timezone = org.timezone if org else None

        # Check time window using the same logic as self_check_in
        now = datetime.now(dt_timezone.utc)
        check_in_start, check_in_end = self._get_check_in_window(event)
        is_valid = check_in_start <= now <= check_in_end

        location_name = None
        if event.location_obj:
            location_name = event.location_obj.name

        return {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value if event.event_type else None,
            "event_description": event.description,
            "start_datetime": event.start_datetime.replace(tzinfo=None).isoformat()
            + "Z",
            "end_datetime": event.end_datetime.replace(tzinfo=None).isoformat() + "Z",
            "actual_end_time": (
                (event.actual_end_time.replace(tzinfo=None).isoformat() + "Z")
                if event.actual_end_time
                else None
            ),
            "check_in_start": check_in_start.replace(tzinfo=None).isoformat() + "Z",
            "check_in_end": check_in_end.replace(tzinfo=None).isoformat() + "Z",
            "is_valid": is_valid,
            "location": event.location,
            "location_id": str(event.location_id) if event.location_id else None,
            "location_name": location_name,
            "require_checkout": event.require_checkout or False,
            "timezone": org_timezone,
        }, None

    @staticmethod
    def _get_check_in_window(
        event: Event,
    ) -> Tuple[datetime, datetime]:
        """
        Calculate the check-in window boundaries based on event settings.

        Returns: (check_in_start, check_in_end) — both UTC-aware datetimes.
        """
        check_in_window_type = event.check_in_window_type or CheckInWindowType.FLEXIBLE

        def _ensure_utc(dt: datetime) -> datetime:
            """Attach UTC tzinfo to naive datetimes from the database."""
            return dt.replace(tzinfo=dt_timezone.utc) if dt.tzinfo is None else dt

        if check_in_window_type == CheckInWindowType.FLEXIBLE:
            minutes_before = (
                event.check_in_minutes_before
                if event.check_in_minutes_before is not None
                else 30
            )
            check_in_start = _ensure_utc(event.start_datetime) - timedelta(
                minutes=minutes_before
            )
            check_in_end = _ensure_utc(
                event.actual_end_time if event.actual_end_time else event.end_datetime
            )

        elif check_in_window_type == CheckInWindowType.STRICT:
            check_in_start = _ensure_utc(
                event.actual_start_time
                if event.actual_start_time
                else event.start_datetime
            )
            check_in_end = _ensure_utc(
                event.actual_end_time if event.actual_end_time else event.end_datetime
            )

        else:  # WINDOW type
            minutes_before = (
                event.check_in_minutes_before
                if event.check_in_minutes_before is not None
                else 15
            )
            minutes_after = (
                event.check_in_minutes_after
                if event.check_in_minutes_after is not None
                else 15
            )
            check_in_start = _ensure_utc(event.start_datetime) - timedelta(
                minutes=minutes_before
            )
            check_in_end = _ensure_utc(event.end_datetime) + timedelta(
                minutes=minutes_after
            )

        return check_in_start, check_in_end

    def _validate_check_in_window(
        self, event: Event, now: datetime, tz_name: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Validate if check-in is allowed based on event's check-in window settings

        Returns: (is_valid, error_message)
        """
        check_in_start, check_in_end = self._get_check_in_window(event)

        if now < check_in_start:
            # Always convert UTC to local time for user-facing messages
            utc_start = check_in_start.replace(tzinfo=dt_timezone.utc)
            if tz_name:
                local_start = utc_start.astimezone(ZoneInfo(tz_name))
                tz_label = local_start.strftime("%Z")
            else:
                local_start = utc_start
                tz_label = "UTC"
            return (
                False,
                f"Check-in is not available yet. Opens at {local_start.strftime('%I:%M %p')} {tz_label}.",
            )

        if now > check_in_end:
            return False, "Check-in is no longer available. The event has ended."

        return True, None

    async def self_check_in(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        is_checkout: bool = False,
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
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Get organization timezone for user-facing messages
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        now = datetime.now(dt_timezone.utc)

        # Validate check-in window
        is_valid, error_msg = self._validate_check_in_window(event, now, tz_name)
        if not is_valid:
            return None, error_msg

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            if is_checkout:
                return None, "Cannot check out without checking in first"

            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.now(dt_timezone.utc),
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
            select(TrainingSession).where(TrainingSession.event_id == event.id)
        )
        training_session = session_result.scalar_one_or_none()

        if not training_session:
            return

        if not training_session.auto_create_records:
            return

        # Check if training record already exists
        existing_record_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == str(user_id))
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
            issuing_agency=(
                training_session.issuing_agency
                if training_session.issues_certification
                else None
            ),
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
        result = await self.db.execute(select(Event).where(Event.id == str(event_id)))
        event = result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.organization_id != organization_id:
            return None, "Event not found in your organization"

        # Use the same check-in window logic as the QR self-check-in page
        now = datetime.now(dt_timezone.utc)
        check_in_start, check_in_end = self._get_check_in_window(event)
        is_check_in_active = check_in_start <= now <= check_in_end

        # Get all RSVPs with user details
        rsvp_result = await self.db.execute(
            select(EventRSVP, User)
            .join(User, EventRSVP.user_id == User.id)
            .where(EventRSVP.event_id == str(event_id))
            .order_by(EventRSVP.checked_in_at.desc())
        )
        rsvps_with_users = rsvp_result.all()

        # Get total eligible members in organization
        eligible_members_result = await self.db.execute(
            select(func.count(User.id))
            .where(User.organization_id == str(organization_id))
            .where(User.is_active == True)  # noqa: E712
        )
        total_eligible_members = eligible_members_result.scalar() or 0

        # Calculate stats
        total_rsvps = len(rsvps_with_users)
        checked_in_rsvps = [r for r, u in rsvps_with_users if r.checked_in]
        total_checked_in = len(checked_in_rsvps)
        check_in_rate = (
            (total_checked_in / total_eligible_members * 100)
            if total_eligible_members > 0
            else 0
        )

        # Get recent check-ins (last 10)
        recent_check_ins = []
        for rsvp, user in rsvps_with_users:
            if rsvp.checked_in and rsvp.checked_in_at:
                recent_check_ins.append(
                    {
                        "user_id": str(user.id),
                        "user_name": f"{user.first_name} {user.last_name}",
                        "user_email": user.email,
                        "checked_in_at": rsvp.checked_in_at,
                        "rsvp_status": rsvp.status.value,
                        "guest_count": rsvp.guest_count or 0,
                    }
                )
                if len(recent_check_ins) >= 10:
                    break

        # Calculate average check-in time (minutes before event start)
        avg_check_in_time = None
        last_check_in_at = None
        if checked_in_rsvps:
            check_in_times = []
            for rsvp in checked_in_rsvps:
                if rsvp.checked_in_at:
                    time_diff = (
                        event.start_datetime - rsvp.checked_in_at
                    ).total_seconds() / 60
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
            "avg_check_in_time_minutes": (
                round(avg_check_in_time, 2) if avg_check_in_time else None
            ),
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
        self,
        organization_id: UUID,
        include_inactive: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[EventTemplate]:
        """List all event templates for an organization"""
        query = select(EventTemplate).where(
            EventTemplate.organization_id == str(organization_id)
        )
        if not include_inactive:
            query = query.where(EventTemplate.is_active == True)  # noqa: E712
        query = query.order_by(EventTemplate.name).offset(skip).limit(limit)
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
        self,
        template_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
        updated_by: Optional[UUID] = None,
    ) -> Optional[EventTemplate]:
        """Update an event template"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return None

        for field, value in update_data.items():
            setattr(template, field, value)

        if updated_by:
            template.updated_by = str(updated_by)
        template.updated_at = datetime.now(dt_timezone.utc)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def delete_template(self, template_id: UUID, organization_id: UUID) -> bool:
        """Soft-delete a template by deactivating it"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return False

        template.is_active = False
        template.updated_at = datetime.now(dt_timezone.utc)
        await self.db.commit()
        return True

    # ============================================================
    # Recurring Events
    # ============================================================

    @staticmethod
    def _nth_weekday_of_month(
        year: int,
        month: int,
        weekday: int,
        ordinal: int,
        reference: datetime,
    ) -> Optional[datetime]:
        """
        Find the Nth weekday of a given month/year.

        weekday: 0=Mon … 6=Sun
        ordinal: 1-5 for 1st-5th, -1 for last
        Returns a datetime with the same time as *reference*, or None if
        the ordinal doesn't exist (e.g. 5th Monday in February).
        """
        if ordinal == -1:
            # Last occurrence: start from month's last day and walk back
            last_day = calendar.monthrange(year, month)[1]
            d = last_day
            while d >= 1:
                candidate = reference.replace(year=year, month=month, day=d)
                if candidate.weekday() == weekday:
                    return candidate
                d -= 1
            return None

        # Nth occurrence: walk from day 1
        count = 0
        for d in range(1, calendar.monthrange(year, month)[1] + 1):
            candidate = reference.replace(year=year, month=month, day=d)
            if candidate.weekday() == weekday:
                count += 1
                if count == ordinal:
                    return candidate
        return None

    def _generate_recurrence_dates(
        self,
        start_datetime: datetime,
        end_datetime: datetime,
        pattern: str,
        recurrence_end_date: datetime,
        custom_days: Optional[List[int]] = None,
        weekday: Optional[int] = None,
        week_ordinal: Optional[int] = None,
        month: Optional[int] = None,
        exceptions: Optional[List[str]] = None,
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
                m = current.month + 1
                y = current.year
                if m > 12:
                    m = 1
                    y += 1
                try:
                    current = current.replace(year=y, month=m)
                except ValueError:
                    last_day = calendar.monthrange(y, m)[1]
                    current = current.replace(
                        year=y, month=m, day=min(current.day, last_day)
                    )
            elif (
                pattern == RecurrencePattern.MONTHLY_WEEKDAY.value
                and weekday is not None
                and week_ordinal is not None
            ):
                # e.g., 2nd Monday of every month
                m = current.month + 1
                y = current.year
                if m > 12:
                    m = 1
                    y += 1
                candidate = self._nth_weekday_of_month(
                    y, m, weekday, week_ordinal, current
                )
                if candidate is None:
                    # Skip months where the ordinal doesn't exist
                    # Try next month
                    m += 1
                    if m > 12:
                        m = 1
                        y += 1
                    candidate = self._nth_weekday_of_month(
                        y, m, weekday, week_ordinal, current
                    )
                if candidate is None:
                    break
                current = candidate
            elif pattern == RecurrencePattern.ANNUALLY.value:
                # Same date next year
                try:
                    current = current.replace(year=current.year + 1)
                except ValueError:
                    # Feb 29 in a non-leap year → Feb 28
                    current = current.replace(year=current.year + 1, day=28)
            elif (
                pattern == RecurrencePattern.ANNUALLY_WEEKDAY.value
                and weekday is not None
                and week_ordinal is not None
                and month is not None
            ):
                # e.g., 4th Monday of July every year
                y = current.year + 1
                candidate = self._nth_weekday_of_month(
                    y, month, weekday, week_ordinal, current
                )
                if candidate is None:
                    break
                current = candidate
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

        # Filter out exception dates (compare date parts only)
        if exceptions:
            exception_dates = set(exceptions)
            occurrences = [
                (s, e) for s, e in occurrences
                if s.strftime("%Y-%m-%d") not in exception_dates
            ]

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
        recurrence_end_date = event_data.pop("recurrence_end_date", None)
        rolling_recurrence = event_data.pop("rolling_recurrence", False)
        recurrence_custom_days = event_data.pop("recurrence_custom_days", None)
        recurrence_weekday = event_data.pop("recurrence_weekday", None)
        recurrence_week_ordinal = event_data.pop("recurrence_week_ordinal", None)
        recurrence_month = event_data.pop("recurrence_month", None)
        recurrence_exceptions = event_data.pop("recurrence_exceptions", None)

        # Rolling recurrence: auto-set end date to 12 months from start
        if rolling_recurrence and not recurrence_end_date:
            start = event_data["start_datetime"]
            recurrence_end_date = start.replace(year=start.year + 1)

        # Generate occurrence dates
        occurrences = self._generate_recurrence_dates(
            start_datetime=event_data["start_datetime"],
            end_datetime=event_data["end_datetime"],
            pattern=recurrence_pattern,
            recurrence_end_date=recurrence_end_date,
            custom_days=recurrence_custom_days,
            weekday=recurrence_weekday,
            week_ordinal=recurrence_week_ordinal,
            month=recurrence_month,
            exceptions=recurrence_exceptions,
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
            rolling_recurrence=rolling_recurrence,
            recurrence_custom_days=recurrence_custom_days,
            recurrence_weekday=recurrence_weekday,
            recurrence_week_ordinal=recurrence_week_ordinal,
            recurrence_month=recurrence_month,
            recurrence_exceptions=recurrence_exceptions,
            start_datetime=occurrences[0][0],
            end_datetime=occurrences[0][1],
            **{
                k: v
                for k, v in event_data.items()
                if k not in ("start_datetime", "end_datetime")
            },
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
                **{
                    k: v
                    for k, v in event_data.items()
                    if k not in ("start_datetime", "end_datetime")
                },
            )
            self.db.add(child_event)
            created_events.append(child_event)

        await self.db.commit()

        # Re-query with eager loading so server-computed columns
        # (created_at, updated_at) and relationships (location_obj) are
        # available without lazy-loading, which would raise MissingGreenlet
        # in async mode when Pydantic serializes the response.
        event_ids = [e.id for e in created_events]
        result = await self.db.execute(
            select(Event)
            .where(Event.id.in_(event_ids))
            .options(selectinload(Event.location_obj))
            .order_by(Event.start_datetime)
        )
        created_events = list(result.scalars().all())

        return created_events, None

    async def import_events_from_csv(
        self,
        rows: List[Dict[str, str]],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """
        Import events from parsed CSV rows.

        Args:
            rows: List of dicts with keys matching CSV columns.
            organization_id: The org to create events for.
            created_by: The user performing the import.

        Returns:
            (imported_count, errors) where errors is a list of
            {"row": int, "error": str}.
        """
        valid_event_types = {et.value for et in EventType}
        imported_count = 0
        errors: List[Dict[str, Any]] = []

        date_formats = [
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%m/%d/%Y %H:%M:%S",
            "%m/%d/%Y %H:%M",
            "%m/%d/%Y %I:%M %p",
        ]

        def _parse_datetime(value: str) -> Optional[datetime]:
            """Try multiple datetime formats, return UTC datetime or None."""
            stripped = value.strip()
            for fmt in date_formats:
                try:
                    dt = datetime.strptime(stripped, fmt)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dt_timezone.utc)
                    return dt
                except ValueError:
                    continue
            return None

        for idx, row in enumerate(rows, start=2):
            # Row numbering starts at 2 (1 = header row)
            title = row.get("title", "").strip()
            if not title:
                errors.append({"row": idx, "error": "Missing required field: title"})
                continue

            raw_event_type = row.get("event_type", "").strip().lower()
            if not raw_event_type:
                errors.append(
                    {"row": idx, "error": "Missing required field: event_type"}
                )
                continue
            # Allow underscore or space-separated values
            event_type_value = raw_event_type.replace(" ", "_")
            if event_type_value not in valid_event_types:
                errors.append(
                    {
                        "row": idx,
                        "error": (
                            f"Invalid event_type '{raw_event_type}'. "
                            f"Valid types: {', '.join(sorted(valid_event_types))}"
                        ),
                    }
                )
                continue

            raw_start = row.get("start_datetime", "").strip()
            if not raw_start:
                errors.append(
                    {"row": idx, "error": "Missing required field: start_datetime"}
                )
                continue
            start_dt = _parse_datetime(raw_start)
            if start_dt is None:
                errors.append(
                    {
                        "row": idx,
                        "error": f"Invalid start_datetime format: '{raw_start}'",
                    }
                )
                continue

            raw_end = row.get("end_datetime", "").strip()
            if not raw_end:
                errors.append(
                    {"row": idx, "error": "Missing required field: end_datetime"}
                )
                continue
            end_dt = _parse_datetime(raw_end)
            if end_dt is None:
                errors.append(
                    {
                        "row": idx,
                        "error": f"Invalid end_datetime format: '{raw_end}'",
                    }
                )
                continue

            if end_dt <= start_dt:
                errors.append(
                    {"row": idx, "error": "end_datetime must be after start_datetime"}
                )
                continue

            location = row.get("location", "").strip() or None
            description = row.get("description", "").strip() or None

            raw_mandatory = row.get("is_mandatory", "").strip().lower()
            is_mandatory = raw_mandatory in ("true", "yes", "1")

            try:
                event = Event(
                    organization_id=str(organization_id),
                    created_by=str(created_by),
                    title=title,
                    event_type=EventType(event_type_value),
                    start_datetime=start_dt,
                    end_datetime=end_dt,
                    location=location,
                    description=description,
                    is_mandatory=is_mandatory,
                )
                self.db.add(event)
                await self.db.flush()
                imported_count += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})

        if imported_count > 0:
            await self.db.commit()

        return imported_count, errors

    @staticmethod
    def parse_csv_file(file_content: bytes) -> List[Dict[str, str]]:
        """
        Parse CSV bytes into a list of dicts.

        Normalizes header names to lowercase with underscores.
        """
        text = file_content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows: List[Dict[str, str]] = []
        for raw_row in reader:
            normalized: Dict[str, str] = {}
            for key, value in raw_row.items():
                if key is None:
                    continue
                norm_key = key.strip().lower().replace(" ", "_")
                normalized[norm_key] = (value or "").strip()
            rows.append(normalized)
        return rows

    async def send_event_reminders(
        self,
        event_id: UUID,
        organization_id: UUID,
        reminder_type: str = "non_respondents",
    ) -> Tuple[List[str], Optional[str]]:
        """
        Identify members who need reminders for an event.

        Args:
            event_id: The event to send reminders for.
            organization_id: The organization scope.
            reminder_type: "non_respondents" (only those without RSVPs)
                           or "all" (every active member).

        Returns:
            Tuple of (list of user IDs to remind, error message or None).
        """
        from loguru import logger as _logger

        # Verify the event exists and belongs to the organization
        result = await self.db.execute(
            select(Event)
            .where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            return [], "Event not found"

        if event.is_cancelled:
            return [], "Cannot send reminders for a cancelled event"

        # Get all active members in the organization
        members_result = await self.db.execute(
            select(User.id)
            .where(
                User.organization_id == str(organization_id),
                User.is_active == True,  # noqa: E712
            )
        )
        all_member_ids = [str(row[0]) for row in members_result.all()]

        if reminder_type == "all":
            _logger.info(
                "Sending reminders to all {} members for event {}",
                len(all_member_ids),
                event_id,
            )
            return all_member_ids, None

        # For non_respondents: exclude members who already have an RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP.user_id)
            .where(EventRSVP.event_id == str(event_id))
        )
        rsvp_user_ids = {str(row[0]) for row in rsvp_result.all()}

        non_respondents = [
            uid for uid in all_member_ids if uid not in rsvp_user_ids
        ]

        _logger.info(
            "Sending reminders to {} non-respondents (out of {} total) "
            "for event {}",
            len(non_respondents),
            len(all_member_ids),
            event_id,
        )

        return non_respondents, None

    # ------------------------------------------------------------------
    # Analytics (#44, #46, #47)
    # ------------------------------------------------------------------

    async def get_analytics_summary(
        self,
        organization_id: UUID,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Return aggregated analytics for the attendance trends dashboard.

        Includes total events, average attendance rate, event type
        distribution, monthly trend counts, average check-in lead time,
        and top events by attendance.
        """
        from sqlalchemy import extract

        # Base filter: org, not cancelled, not draft
        base_filter = [
            Event.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
        ]
        if start_date:
            base_filter.append(Event.start_datetime >= start_date)
        if end_date:
            base_filter.append(Event.start_datetime <= end_date)

        # 1) Total events
        total_q = select(func.count(Event.id)).where(*base_filter)
        total_events = (await self.db.execute(total_q)).scalar() or 0

        # 2) RSVP / check-in aggregates
        rsvp_filter = [
            EventRSVP.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
        ]
        if start_date:
            rsvp_filter.append(Event.start_datetime >= start_date)
        if end_date:
            rsvp_filter.append(Event.start_datetime <= end_date)

        agg_q = (
            select(
                func.count(EventRSVP.id).label("total_rsvps"),
                func.sum(
                    case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)
                ).label("going_count"),
                func.sum(
                    case((EventRSVP.checked_in.is_(True), 1), else_=0)
                ).label("checked_in_count"),
            )
            .join(Event, Event.id == EventRSVP.event_id)
            .where(*rsvp_filter)
        )
        row = (await self.db.execute(agg_q)).one()
        total_rsvps = row.total_rsvps or 0
        going_count = row.going_count or 0
        checked_in_count = row.checked_in_count or 0

        avg_attendance_rate = (
            checked_in_count / going_count if going_count > 0 else 0.0
        )
        check_in_rate = (
            checked_in_count / total_rsvps if total_rsvps > 0 else 0.0
        )

        # 3) Average check-in time before event start (minutes)
        #    Uses raw SQL text for MySQL TIMESTAMPDIFF.
        from sqlalchemy import literal_column

        avg_seconds_expr = func.avg(
            func.timestampdiff(
                literal_column("SECOND"),
                EventRSVP.checked_in_at,
                Event.start_datetime,
            )
        ).label("avg_seconds_before")
        checkin_time_q = (
            select(avg_seconds_expr)
            .join(Event, Event.id == EventRSVP.event_id)
            .where(
                *rsvp_filter,
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_in_at.isnot(None),
            )
        )
        avg_seconds = (await self.db.execute(checkin_time_q)).scalar()
        avg_checkin_minutes_before: Optional[float] = None
        if avg_seconds is not None:
            avg_checkin_minutes_before = round(float(avg_seconds) / 60.0, 1)

        # 4) Event type distribution
        type_q = (
            select(
                Event.event_type,
                func.count(Event.id).label("cnt"),
            )
            .where(*base_filter)
            .group_by(Event.event_type)
            .order_by(func.count(Event.id).desc())
        )
        type_rows = (await self.db.execute(type_q)).all()
        event_type_distribution = [
            {
                "event_type": (
                    r.event_type.value
                    if hasattr(r.event_type, "value")
                    else str(r.event_type)
                ),
                "count": r.cnt,
            }
            for r in type_rows
        ]

        # 5) Monthly event counts
        month_q = (
            select(
                extract("year", Event.start_datetime).label("yr"),
                extract("month", Event.start_datetime).label("mo"),
                func.count(Event.id).label("cnt"),
            )
            .where(*base_filter)
            .group_by("yr", "mo")
            .order_by("yr", "mo")
        )
        month_rows = (await self.db.execute(month_q)).all()
        monthly_event_counts = [
            {
                "month": f"{int(r.yr)}-{int(r.mo):02d}",
                "count": r.cnt,
            }
            for r in month_rows
        ]

        # 6) Top events by attendance (top 10)
        top_q = (
            select(
                Event.id.label("event_id"),
                Event.title,
                Event.event_type,
                Event.start_datetime,
                func.sum(
                    case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)
                ).label("going_count"),
                func.sum(
                    case((EventRSVP.checked_in.is_(True), 1), else_=0)
                ).label("checked_in_count"),
            )
            .join(EventRSVP, EventRSVP.event_id == Event.id)
            .where(*base_filter)
            .group_by(Event.id, Event.title, Event.event_type, Event.start_datetime)
            .having(
                func.sum(
                    case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)
                ) > 0
            )
            .order_by(
                func.sum(
                    case((EventRSVP.checked_in.is_(True), 1), else_=0)
                ).desc()
            )
            .limit(10)
        )
        top_rows = (await self.db.execute(top_q)).all()
        top_events = []
        for r in top_rows:
            g = r.going_count or 0
            c = r.checked_in_count or 0
            top_events.append(
                {
                    "event_id": r.event_id,
                    "title": r.title,
                    "event_type": (
                        r.event_type.value
                        if hasattr(r.event_type, "value")
                        else str(r.event_type)
                    ),
                    "start_datetime": r.start_datetime,
                    "going_count": g,
                    "checked_in_count": c,
                    "attendance_rate": round(c / g, 4) if g > 0 else 0.0,
                }
            )

        return {
            "total_events": total_events,
            "total_rsvps": total_rsvps,
            "total_checked_in": checked_in_count,
            "avg_attendance_rate": round(avg_attendance_rate, 4),
            "check_in_rate": round(check_in_rate, 4),
            "avg_checkin_minutes_before": avg_checkin_minutes_before,
            "event_type_distribution": event_type_distribution,
            "monthly_event_counts": monthly_event_counts,
            "top_events": top_events,
        }

    async def send_event_notification(
        self,
        event_id: UUID,
        organization_id: UUID,
        notification_type: str,
        target: str = "all",
        message: Optional[str] = None,
    ) -> Tuple[int, str]:
        """
        Build a recipient list for an event notification and log it.

        Args:
            event_id: The event to notify about.
            organization_id: The organization scope.
            notification_type: One of announcement, reminder, follow_up,
                               missed_event, check_in_confirmation.
            target: Target audience — all, going, not_responded,
                    checked_in, not_checked_in.
            message: Optional custom message body.

        Returns:
            Tuple of (recipients_count, human-readable summary message).

        Raises:
            ValueError: If the event is not found or is cancelled.
        """
        from loguru import logger as _logger

        # Verify the event exists and belongs to the organization
        result = await self.db.execute(
            select(Event)
            .where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        if event.is_cancelled:
            raise ValueError("Cannot send notifications for a cancelled event")

        # Fetch all active members
        members_result = await self.db.execute(
            select(User.id)
            .where(
                User.organization_id == str(organization_id),
                User.is_active == True,  # noqa: E712
            )
        )
        all_member_ids = {str(row[0]) for row in members_result.all()}

        # Fetch RSVPs for filtering
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
        )
        rsvps = rsvp_result.scalars().all()

        rsvp_by_user: Dict[str, Any] = {}
        for rsvp in rsvps:
            rsvp_by_user[str(rsvp.user_id)] = rsvp

        # Build recipient list based on target
        recipient_ids: List[str] = []

        if target == "all":
            recipient_ids = list(all_member_ids)
        elif target == "going":
            recipient_ids = [
                uid for uid, r in rsvp_by_user.items()
                if r.status == RSVPStatus.GOING and uid in all_member_ids
            ]
        elif target == "not_responded":
            responded_ids = set(rsvp_by_user.keys())
            recipient_ids = [
                uid for uid in all_member_ids
                if uid not in responded_ids
            ]
        elif target == "checked_in":
            recipient_ids = [
                uid for uid, r in rsvp_by_user.items()
                if r.checked_in and uid in all_member_ids
            ]
        elif target == "not_checked_in":
            checked_in_ids = {
                uid for uid, r in rsvp_by_user.items()
                if r.checked_in
            }
            # Members who RSVP'd going but did not check in
            recipient_ids = [
                uid for uid, r in rsvp_by_user.items()
                if r.status == RSVPStatus.GOING
                and uid not in checked_in_ids
                and uid in all_member_ids
            ]

        type_labels = {
            "announcement": "Announcement",
            "reminder": "Reminder",
            "follow_up": "Follow-up",
            "missed_event": "Missed event notice",
            "check_in_confirmation": "Check-in confirmation",
        }
        label = type_labels.get(notification_type, notification_type)

        _logger.info(
            "Event notification: type={}, target={}, event={}, "
            "recipients={}, custom_message={}",
            notification_type,
            target,
            event_id,
            len(recipient_ids),
            bool(message),
        )

        # Build notification subject and body
        subject = f"{label}: {event.title}"
        default_messages = {
            "announcement": (
                f'New announcement for "{event.title}". '
                f"Check the event page for details."
            ),
            "reminder": (
                f'Reminder: "{event.title}" is coming up. '
                f"Please check the event details."
            ),
            "follow_up": (
                f'Follow-up regarding "{event.title}". '
                f"Please review the event page."
            ),
            "missed_event": (
                f'You missed "{event.title}". '
                f"Please review the event details."
            ),
            "check_in_confirmation": (
                f'Your check-in for "{event.title}" has been confirmed.'
            ),
        }
        body = message or default_messages.get(
            notification_type,
            f'Notification regarding "{event.title}".',
        )
        action_url = f"/events/{event_id}"
        now = datetime.now(dt_timezone.utc)

        # Create in-app notifications for each recipient
        notif_service = NotificationsService(self.db)
        delivered_count = 0
        for uid in recipient_ids:
            entry, error = await notif_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "recipient_id": uid,
                    "channel": NotificationChannel.IN_APP,
                    "subject": subject,
                    "message": body,
                    "category": NotificationCategory.EVENTS,
                    "action_url": action_url,
                    "delivered": True,
                    "sent_at": now,
                },
            )
            if entry:
                delivered_count += 1
            else:
                _logger.warning(
                    "Failed to deliver notification to user {}: {}",
                    uid,
                    error,
                )

        summary = (
            f"{label} notification sent to "
            f"{delivered_count} recipient(s)"
        )

        return delivered_count, summary
