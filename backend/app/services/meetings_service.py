"""
Meeting Minutes Service

Business logic for meeting minutes including meetings,
attendees, action items, and approval workflows.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.models.meeting import (
    Meeting,
    MeetingAttendee,
    MeetingActionItem,
    MeetingType,
    MeetingStatus,
    ActionItemStatus,
)
from app.models.user import User


class MeetingsService:
    """Service for meeting minutes management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Meeting Management
    # ============================================

    async def create_meeting(
        self, organization_id: UUID, meeting_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[Meeting], Optional[str]]:
        """Create a new meeting with optional attendees and action items"""
        try:
            attendees_data = meeting_data.pop("attendees", None) or []
            action_items_data = meeting_data.pop("action_items", None) or []

            meeting = Meeting(
                organization_id=organization_id,
                created_by=created_by,
                **meeting_data
            )
            self.db.add(meeting)
            await self.db.flush()

            # Add attendees
            for att_data in attendees_data:
                if isinstance(att_data, dict):
                    attendee = MeetingAttendee(
                        organization_id=organization_id,
                        meeting_id=meeting.id,
                        **att_data,
                    )
                    self.db.add(attendee)

            # Add action items
            for item_data in action_items_data:
                if isinstance(item_data, dict):
                    action_item = MeetingActionItem(
                        meeting_id=meeting.id,
                        organization_id=organization_id,
                        **item_data
                    )
                    self.db.add(action_item)

            await self.db.commit()
            await self.db.refresh(meeting)

            # Reload with relationships
            result = await self.db.execute(
                select(Meeting)
                .where(Meeting.id == meeting.id)
                .options(
                    selectinload(Meeting.attendees),
                    selectinload(Meeting.action_items),
                )
            )
            return result.scalar_one(), None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_meetings(
        self,
        organization_id: UUID,
        meeting_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[Meeting], int]:
        """Get meetings with filtering and pagination"""
        query = (
            select(Meeting)
            .where(Meeting.organization_id == str(organization_id))
        )

        if meeting_type:
            try:
                type_enum = MeetingType(meeting_type)
                query = query.where(Meeting.meeting_type == type_enum)
            except ValueError:
                pass

        if status:
            try:
                status_enum = MeetingStatus(status)
                query = query.where(Meeting.status == status_enum)
            except ValueError:
                pass

        if search:
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            search_term = f"%{safe_search}%"
            query = query.where(
                or_(
                    Meeting.title.ilike(search_term),
                    Meeting.notes.ilike(search_term),
                    Meeting.agenda.ilike(search_term),
                )
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(Meeting.meeting_date.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        meetings = result.scalars().all()

        return meetings, total

    async def get_meeting_by_id(
        self, meeting_id: UUID, organization_id: UUID
    ) -> Optional[Meeting]:
        """Get a meeting by ID with attendees and action items"""
        result = await self.db.execute(
            select(Meeting)
            .where(Meeting.id == str(meeting_id))
            .where(Meeting.organization_id == str(organization_id))
            .options(
                selectinload(Meeting.attendees),
                selectinload(Meeting.action_items),
            )
        )
        return result.scalar_one_or_none()

    async def update_meeting(
        self, meeting_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[Meeting], Optional[str]]:
        """Update a meeting"""
        try:
            meeting = await self.get_meeting_by_id(meeting_id, organization_id)
            if not meeting:
                return None, "Meeting not found"

            for key, value in update_data.items():
                setattr(meeting, key, value)

            await self.db.commit()
            await self.db.refresh(meeting)
            return meeting, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_meeting(
        self, meeting_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a meeting and all its attendees/action items"""
        try:
            meeting = await self.get_meeting_by_id(meeting_id, organization_id)
            if not meeting:
                return False, "Meeting not found"

            await self.db.delete(meeting)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def approve_meeting(
        self, meeting_id: UUID, organization_id: UUID, approved_by: UUID
    ) -> Tuple[Optional[Meeting], Optional[str]]:
        """Approve meeting minutes"""
        try:
            meeting = await self.get_meeting_by_id(meeting_id, organization_id)
            if not meeting:
                return None, "Meeting not found"

            meeting.status = MeetingStatus.APPROVED
            meeting.approved_by = approved_by
            meeting.approved_at = datetime.now(timezone.utc)

            await self.db.commit()
            await self.db.refresh(meeting)
            return meeting, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Attendee Management
    # ============================================

    async def add_attendee(
        self, meeting_id: UUID, organization_id: UUID, attendee_data: Dict[str, Any]
    ) -> Tuple[Optional[MeetingAttendee], Optional[str]]:
        """Add an attendee to a meeting"""
        try:
            meeting = await self.get_meeting_by_id(meeting_id, organization_id)
            if not meeting:
                return None, "Meeting not found"

            attendee = MeetingAttendee(
                organization_id=organization_id,
                meeting_id=meeting_id,
                **attendee_data,
            )
            self.db.add(attendee)
            await self.db.commit()
            await self.db.refresh(attendee)
            return attendee, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def remove_attendee(
        self, meeting_id: UUID, attendee_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Remove an attendee from a meeting"""
        try:
            result = await self.db.execute(
                select(MeetingAttendee)
                .where(MeetingAttendee.id == str(attendee_id))
                .where(MeetingAttendee.meeting_id == str(meeting_id))
                .where(MeetingAttendee.organization_id == str(organization_id))
            )
            attendee = result.scalar_one_or_none()
            if not attendee:
                return False, "Attendee not found"

            await self.db.delete(attendee)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Action Item Management
    # ============================================

    async def create_action_item(
        self, meeting_id: UUID, organization_id: UUID, item_data: Dict[str, Any]
    ) -> Tuple[Optional[MeetingActionItem], Optional[str]]:
        """Create an action item for a meeting"""
        try:
            meeting = await self.get_meeting_by_id(meeting_id, organization_id)
            if not meeting:
                return None, "Meeting not found"

            action_item = MeetingActionItem(
                meeting_id=meeting_id,
                organization_id=organization_id,
                **item_data
            )
            self.db.add(action_item)
            await self.db.commit()
            await self.db.refresh(action_item)
            return action_item, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def update_action_item(
        self, item_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[MeetingActionItem], Optional[str]]:
        """Update an action item"""
        try:
            result = await self.db.execute(
                select(MeetingActionItem)
                .where(MeetingActionItem.id == str(item_id))
                .where(MeetingActionItem.organization_id == str(organization_id))
            )
            item = result.scalar_one_or_none()
            if not item:
                return None, "Action item not found"

            # Handle status changes
            if "status" in update_data:
                new_status = update_data["status"]
                if new_status == ActionItemStatus.COMPLETED.value and item.status != ActionItemStatus.COMPLETED:
                    item.completed_at = datetime.now(timezone.utc)

            for key, value in update_data.items():
                setattr(item, key, value)

            await self.db.commit()
            await self.db.refresh(item)
            return item, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_action_item(
        self, item_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete an action item"""
        try:
            result = await self.db.execute(
                select(MeetingActionItem)
                .where(MeetingActionItem.id == str(item_id))
                .where(MeetingActionItem.organization_id == str(organization_id))
            )
            item = result.scalar_one_or_none()
            if not item:
                return False, "Action item not found"

            await self.db.delete(item)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_open_action_items(
        self, organization_id: UUID, assigned_to: Optional[UUID] = None
    ) -> List[MeetingActionItem]:
        """Get all open action items for the organization"""
        query = (
            select(MeetingActionItem)
            .where(MeetingActionItem.organization_id == str(organization_id))
            .where(MeetingActionItem.status.in_([ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS]))
        )

        if assigned_to:
            query = query.where(MeetingActionItem.assigned_to == assigned_to)

        query = query.order_by(MeetingActionItem.due_date.asc())
        result = await self.db.execute(query)
        return result.scalars().all()

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get meetings summary statistics"""
        # Total meetings
        total_result = await self.db.execute(
            select(func.count(Meeting.id))
            .where(Meeting.organization_id == str(organization_id))
        )
        total_meetings = total_result.scalar() or 0

        # Meetings this month
        first_of_month = date.today().replace(day=1)
        month_result = await self.db.execute(
            select(func.count(Meeting.id))
            .where(Meeting.organization_id == str(organization_id))
            .where(Meeting.meeting_date >= first_of_month)
        )
        meetings_this_month = month_result.scalar() or 0

        # Open action items
        open_result = await self.db.execute(
            select(func.count(MeetingActionItem.id))
            .where(MeetingActionItem.organization_id == str(organization_id))
            .where(MeetingActionItem.status.in_([ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS]))
        )
        open_action_items = open_result.scalar() or 0

        # Pending approval
        pending_result = await self.db.execute(
            select(func.count(Meeting.id))
            .where(Meeting.organization_id == str(organization_id))
            .where(Meeting.status == MeetingStatus.PENDING_APPROVAL)
        )
        pending_approval = pending_result.scalar() or 0

        return {
            "total_meetings": total_meetings,
            "meetings_this_month": meetings_this_month,
            "open_action_items": open_action_items,
            "pending_approval": pending_approval,
        }

    # ============================================
    # Cross-module Bridges
    # ============================================

    async def create_from_event(
        self, event_id: UUID, organization_id: UUID, created_by: UUID
    ) -> Tuple[Optional[Meeting], Optional[str]]:
        """
        Create a Meeting record from a completed Event (type: business_meeting).
        Bridges Event check-in attendance → Meeting attendance.
        Pre-populates attendees from EventRSVP check-in data.
        """
        from app.models.event import Event, EventRSVP, RSVPStatus
        from app.core.utils import generate_uuid

        # Get the event
        result = await self.db.execute(
            select(Event).where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            return None, "Event not found"

        # Check if meeting already exists for this event
        existing = await self.db.execute(
            select(Meeting).where(
                Meeting.event_id == str(event_id),
                Meeting.organization_id == str(organization_id),
            )
        )
        if existing.scalar_one_or_none():
            return None, "Meeting already exists for this event"

        try:
            meeting = Meeting(
                id=generate_uuid(),
                organization_id=str(organization_id),
                title=event.title,
                meeting_type=MeetingType.BUSINESS,
                meeting_date=event.start_datetime.date() if event.start_datetime else date.today(),
                start_time=event.actual_start_time.time() if event.actual_start_time else (event.start_datetime.time() if event.start_datetime else None),
                end_time=event.actual_end_time.time() if event.actual_end_time else (event.end_datetime.time() if event.end_datetime else None),
                location=event.location,
                location_id=event.location_id,
                event_id=str(event_id),
                status=MeetingStatus.DRAFT,
                created_by=str(created_by),
            )
            self.db.add(meeting)
            await self.db.flush()

            # Import attendees from EventRSVP check-ins
            rsvps_result = await self.db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == str(event_id),
                    EventRSVP.organization_id == str(organization_id),
                )
            )
            for rsvp in rsvps_result.scalars().all():
                attendee = MeetingAttendee(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    meeting_id=meeting.id,
                    user_id=rsvp.user_id,
                    present=rsvp.checked_in,
                    excused=not rsvp.checked_in and rsvp.status == RSVPStatus.NOT_GOING if hasattr(rsvp.status, 'value') else False,
                )
                self.db.add(attendee)

            await self.db.commit()
            await self.db.refresh(meeting)
            return meeting, None

        except Exception as e:
            await self.db.rollback()
            return None, str(e)
