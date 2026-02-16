"""
Meeting Minutes Service

Business logic for meeting minutes management.
"""

import logging
from typing import List, Optional, Tuple
from uuid import UUID
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload

from app.models.minute import (
    MeetingMinutes, MinutesTemplate, Motion, ActionItem,
    MinutesMeetingType, MinutesStatus, MotionStatus,
    MinutesActionItemStatus, ActionItemPriority,
    DEFAULT_BUSINESS_SECTIONS, DEFAULT_SPECIAL_SECTIONS, DEFAULT_COMMITTEE_SECTIONS,
    DEFAULT_TRUSTEE_SECTIONS, DEFAULT_EXECUTIVE_SECTIONS, DEFAULT_ANNUAL_SECTIONS,
)
from app.models.user import User
from app.schemas.minute import (
    MinutesCreate, MinutesUpdate,
    MotionCreate, MotionUpdate,
    ActionItemCreate, ActionItemUpdate,
)

logger = logging.getLogger(__name__)


class MinuteService:
    """Service for meeting minutes management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Meeting Minutes CRUD
    # ============================================

    async def create_minutes(
        self, data: MinutesCreate, organization_id: UUID, created_by: UUID
    ) -> MeetingMinutes:
        """Create new meeting minutes with optional motions and action items"""
        minutes_dict = data.model_dump(exclude={"motions", "action_items"})

        # Serialize attendees to dicts for JSON storage
        if minutes_dict.get("attendees"):
            minutes_dict["attendees"] = [
                a.model_dump() if hasattr(a, "model_dump") else a
                for a in data.attendees
            ]

        # Serialize sections to dicts
        if minutes_dict.get("sections"):
            minutes_dict["sections"] = [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in data.sections
            ]

        # Serialize header/footer configs
        if minutes_dict.get("header_config") and hasattr(data.header_config, "model_dump"):
            minutes_dict["header_config"] = data.header_config.model_dump()
        if minutes_dict.get("footer_config") and hasattr(data.footer_config, "model_dump"):
            minutes_dict["footer_config"] = data.footer_config.model_dump()

        # If a template_id is provided but no sections, populate from template
        if minutes_dict.get("template_id") and not minutes_dict.get("sections"):
            template = await self._get_template(minutes_dict["template_id"], organization_id)
            if template and template.sections:
                minutes_dict["sections"] = [
                    {"order": s["order"], "key": s["key"], "title": s["title"], "content": s.get("default_content", "")}
                    for s in template.sections
                ]
                # Inherit header/footer from template if not explicitly set
                if not minutes_dict.get("header_config") and template.header_config:
                    minutes_dict["header_config"] = template.header_config
                if not minutes_dict.get("footer_config") and template.footer_config:
                    minutes_dict["footer_config"] = template.footer_config

        # If no template and no sections, generate default sections for the meeting type
        if not minutes_dict.get("sections"):
            mt = minutes_dict.get("meeting_type", "business")
            defaults_map = {
                "special": DEFAULT_SPECIAL_SECTIONS,
                "committee": DEFAULT_COMMITTEE_SECTIONS,
                "trustee": DEFAULT_TRUSTEE_SECTIONS,
                "executive": DEFAULT_EXECUTIVE_SECTIONS,
                "annual": DEFAULT_ANNUAL_SECTIONS,
            }
            default = defaults_map.get(mt, DEFAULT_BUSINESS_SECTIONS)
            minutes_dict["sections"] = [
                {"order": s["order"], "key": s["key"], "title": s["title"], "content": s.get("default_content", "")}
                for s in default
            ]

        minutes = MeetingMinutes(
            **minutes_dict,
            organization_id=str(organization_id),
            created_by=str(created_by),
            status=MinutesStatus.DRAFT,
        )
        self.db.add(minutes)
        await self.db.flush()

        # Create inline motions
        if data.motions:
            for i, motion_data in enumerate(data.motions):
                motion = Motion(
                    minutes_id=minutes.id,
                    order=motion_data.order if motion_data.order else i,
                    motion_text=motion_data.motion_text,
                    moved_by=motion_data.moved_by,
                    seconded_by=motion_data.seconded_by,
                    discussion_notes=motion_data.discussion_notes,
                    status=MotionStatus(motion_data.status),
                    votes_for=motion_data.votes_for,
                    votes_against=motion_data.votes_against,
                    votes_abstain=motion_data.votes_abstain,
                )
                self.db.add(motion)

        # Create inline action items
        if data.action_items:
            for item_data in data.action_items:
                item = ActionItem(
                    minutes_id=minutes.id,
                    description=item_data.description,
                    assignee_id=item_data.assignee_id,
                    assignee_name=item_data.assignee_name,
                    due_date=item_data.due_date,
                    priority=ActionItemPriority(item_data.priority),
                    status=MinutesActionItemStatus.PENDING,
                )
                self.db.add(item)

        await self.db.commit()
        await self.db.refresh(minutes)

        # Reload with relationships
        return await self.get_minutes(minutes.id, organization_id)

    async def _get_template(
        self, template_id: str, organization_id: UUID
    ) -> Optional[MinutesTemplate]:
        """Get a template by ID"""
        result = await self.db.execute(
            select(MinutesTemplate)
            .where(MinutesTemplate.id == str(template_id))
            .where(MinutesTemplate.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def get_minutes(
        self, minutes_id: str, organization_id: UUID
    ) -> Optional[MeetingMinutes]:
        """Get a single meeting minutes record with all relationships"""
        result = await self.db.execute(
            select(MeetingMinutes)
            .where(MeetingMinutes.id == minutes_id)
            .where(MeetingMinutes.organization_id == str(organization_id))
            .options(
                selectinload(MeetingMinutes.motions),
                selectinload(MeetingMinutes.action_items),
                selectinload(MeetingMinutes.template),
            )
        )
        return result.scalar_one_or_none()

    async def list_minutes(
        self,
        organization_id: UUID,
        meeting_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[MeetingMinutes]:
        """List meeting minutes with filtering"""
        query = (
            select(MeetingMinutes)
            .where(MeetingMinutes.organization_id == str(organization_id))
            .options(
                selectinload(MeetingMinutes.motions),
                selectinload(MeetingMinutes.action_items),
            )
        )

        if meeting_type:
            query = query.where(MeetingMinutes.meeting_type == meeting_type)

        if status:
            query = query.where(MeetingMinutes.status == status)

        if search:
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            search_term = f"%{safe_search}%"
            query = query.where(
                or_(
                    MeetingMinutes.title.ilike(search_term),
                    MeetingMinutes.notes.ilike(search_term),
                    MeetingMinutes.old_business.ilike(search_term),
                    MeetingMinutes.new_business.ilike(search_term),
                    MeetingMinutes.agenda.ilike(search_term),
                    MeetingMinutes.announcements.ilike(search_term),
                )
            )

        query = query.order_by(MeetingMinutes.meeting_date.desc()).offset(skip).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_minutes(
        self, minutes_id: str, organization_id: UUID, data: MinutesUpdate
    ) -> Optional[MeetingMinutes]:
        """Update meeting minutes (only if in draft or rejected status)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only edit minutes in draft or rejected status")

        update_data = data.model_dump(exclude_unset=True)

        # Clear event_id if empty string
        if "event_id" in update_data and not update_data["event_id"]:
            update_data["event_id"] = None

        # Serialize attendees
        if "attendees" in update_data and update_data["attendees"]:
            update_data["attendees"] = [
                a.model_dump() if hasattr(a, "model_dump") else a
                for a in data.attendees
            ]

        # Serialize sections
        if "sections" in update_data and update_data["sections"]:
            update_data["sections"] = [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in data.sections
            ]

        # Serialize header/footer configs
        if "header_config" in update_data and data.header_config and hasattr(data.header_config, "model_dump"):
            update_data["header_config"] = data.header_config.model_dump()
        if "footer_config" in update_data and data.footer_config and hasattr(data.footer_config, "model_dump"):
            update_data["footer_config"] = data.footer_config.model_dump()

        for field, value in update_data.items():
            setattr(minutes, field, value)

        # Reset to draft if was rejected
        if minutes.status == MinutesStatus.REJECTED.value:
            minutes.status = MinutesStatus.DRAFT
            minutes.rejected_at = None
            minutes.rejected_by = None
            minutes.rejection_reason = None

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def delete_minutes(
        self, minutes_id: str, organization_id: UUID
    ) -> bool:
        """Delete meeting minutes (only if in draft status)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (MinutesStatus.DRAFT.value,):
            raise ValueError("Can only delete draft minutes")

        await self.db.delete(minutes)
        await self.db.commit()
        return True

    # ============================================
    # Approval Workflow
    # ============================================

    async def submit_for_approval(
        self, minutes_id: str, organization_id: UUID, submitted_by: UUID
    ) -> Optional[MeetingMinutes]:
        """Submit draft minutes for approval"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only submit draft or rejected minutes")

        minutes.status = MinutesStatus.SUBMITTED
        minutes.submitted_at = datetime.utcnow()
        minutes.submitted_by = str(submitted_by)
        minutes.rejected_at = None
        minutes.rejected_by = None
        minutes.rejection_reason = None

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def approve_minutes(
        self, minutes_id: str, organization_id: UUID, approved_by: UUID
    ) -> Optional[MeetingMinutes]:
        """Approve submitted minutes"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status != MinutesStatus.SUBMITTED.value:
            raise ValueError("Can only approve submitted minutes")

        minutes.status = MinutesStatus.APPROVED
        minutes.approved_at = datetime.utcnow()
        minutes.approved_by = str(approved_by)

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def reject_minutes(
        self, minutes_id: str, organization_id: UUID, rejected_by: UUID, reason: str
    ) -> Optional[MeetingMinutes]:
        """Reject submitted minutes with a reason"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status != MinutesStatus.SUBMITTED.value:
            raise ValueError("Can only reject submitted minutes")

        minutes.status = MinutesStatus.REJECTED
        minutes.rejected_at = datetime.utcnow()
        minutes.rejected_by = str(rejected_by)
        minutes.rejection_reason = reason

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    # ============================================
    # Motion CRUD
    # ============================================

    async def add_motion(
        self, minutes_id: str, organization_id: UUID, data: MotionCreate
    ) -> Optional[Motion]:
        """Add a motion to meeting minutes"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only add motions to draft or rejected minutes")

        motion = Motion(
            minutes_id=minutes_id,
            order=data.order,
            motion_text=data.motion_text,
            moved_by=data.moved_by,
            seconded_by=data.seconded_by,
            discussion_notes=data.discussion_notes,
            status=MotionStatus(data.status),
            votes_for=data.votes_for,
            votes_against=data.votes_against,
            votes_abstain=data.votes_abstain,
        )
        self.db.add(motion)
        await self.db.commit()
        await self.db.refresh(motion)
        return motion

    async def update_motion(
        self, motion_id: str, minutes_id: str, organization_id: UUID, data: MotionUpdate
    ) -> Optional[Motion]:
        """Update a motion"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only edit motions on draft or rejected minutes")

        result = await self.db.execute(
            select(Motion)
            .where(Motion.id == motion_id)
            .where(Motion.minutes_id == minutes_id)
        )
        motion = result.scalar_one_or_none()
        if not motion:
            return None

        update_data = data.model_dump(exclude_unset=True)
        if "status" in update_data:
            update_data["status"] = MotionStatus(update_data["status"])

        for field, value in update_data.items():
            setattr(motion, field, value)

        await self.db.commit()
        await self.db.refresh(motion)
        return motion

    async def delete_motion(
        self, motion_id: str, minutes_id: str, organization_id: UUID
    ) -> bool:
        """Delete a motion"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only delete motions on draft or rejected minutes")

        result = await self.db.execute(
            select(Motion)
            .where(Motion.id == motion_id)
            .where(Motion.minutes_id == minutes_id)
        )
        motion = result.scalar_one_or_none()
        if not motion:
            return False

        await self.db.delete(motion)
        await self.db.commit()
        return True

    # ============================================
    # Action Item CRUD
    # ============================================

    async def add_action_item(
        self, minutes_id: str, organization_id: UUID, data: ActionItemCreate
    ) -> Optional[ActionItem]:
        """Add an action item to meeting minutes"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        item = ActionItem(
            minutes_id=minutes_id,
            description=data.description,
            assignee_id=data.assignee_id,
            assignee_name=data.assignee_name,
            due_date=data.due_date,
            priority=ActionItemPriority(data.priority),
            status=MinutesActionItemStatus.PENDING,
        )
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def update_action_item(
        self, item_id: str, minutes_id: str, organization_id: UUID, data: ActionItemUpdate
    ) -> Optional[ActionItem]:
        """Update an action item (status can be updated even on approved minutes)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        result = await self.db.execute(
            select(ActionItem)
            .where(ActionItem.id == str(item_id))
            .where(ActionItem.minutes_id == minutes_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # For approved minutes, only allow status and completion updates
        if minutes.status == MinutesStatus.APPROVED.value:
            allowed = {"status", "completion_notes"}
            update_data = {k: v for k, v in update_data.items() if k in allowed}

        if "status" in update_data:
            update_data["status"] = MinutesActionItemStatus(update_data["status"])
            if update_data["status"] == MinutesActionItemStatus.COMPLETED:
                update_data["completed_at"] = datetime.utcnow()

        if "priority" in update_data:
            update_data["priority"] = ActionItemPriority(update_data["priority"])

        for field, value in update_data.items():
            setattr(item, field, value)

        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete_action_item(
        self, item_id: str, minutes_id: str, organization_id: UUID
    ) -> bool:
        """Delete an action item (only on draft/rejected minutes)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value):
            raise ValueError("Can only delete action items on draft or rejected minutes")

        result = await self.db.execute(
            select(ActionItem)
            .where(ActionItem.id == str(item_id))
            .where(ActionItem.minutes_id == minutes_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            return False

        await self.db.delete(item)
        await self.db.commit()
        return True

    # ============================================
    # Stats & Search
    # ============================================

    async def get_stats(self, organization_id: UUID) -> dict:
        """Get aggregate stats for the minutes dashboard"""
        base = select(func.count(MeetingMinutes.id)).where(
            MeetingMinutes.organization_id == str(organization_id)
        )

        total_result = await self.db.execute(base)
        total = total_result.scalar() or 0

        # This month
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        this_month_result = await self.db.execute(
            base.where(MeetingMinutes.meeting_date >= month_start)
        )
        this_month = this_month_result.scalar() or 0

        # Open action items
        open_items_result = await self.db.execute(
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(MeetingMinutes.organization_id == str(organization_id))
            .where(ActionItem.status.in_([
                MinutesActionItemStatus.PENDING.value,
                MinutesActionItemStatus.IN_PROGRESS.value,
                MinutesActionItemStatus.OVERDUE.value,
            ]))
        )
        open_items = open_items_result.scalar() or 0

        # Pending approval
        pending_result = await self.db.execute(
            base.where(MeetingMinutes.status == MinutesStatus.SUBMITTED.value)
        )
        pending_approval = pending_result.scalar() or 0

        return {
            "total": total,
            "this_month": this_month,
            "open_action_items": open_items,
            "pending_approval": pending_approval,
        }

    async def search_minutes(
        self, organization_id: UUID, query: str, limit: int = 20
    ) -> List[dict]:
        """Full-text search across meeting minutes content"""
        safe_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_term = f"%{safe_query}%"

        # Search across all text fields
        search_fields = [
            ("title", MeetingMinutes.title),
            ("notes", MeetingMinutes.notes),
            ("agenda", MeetingMinutes.agenda),
            ("old_business", MeetingMinutes.old_business),
            ("new_business", MeetingMinutes.new_business),
            ("announcements", MeetingMinutes.announcements),
            ("treasurer_report", MeetingMinutes.treasurer_report),
            ("chief_report", MeetingMinutes.chief_report),
            ("committee_reports", MeetingMinutes.committee_reports),
        ]

        results = []
        seen_ids = set()

        for field_name, field in search_fields:
            if len(results) >= limit:
                break

            stmt = (
                select(MeetingMinutes)
                .where(MeetingMinutes.organization_id == str(organization_id))
                .where(field.ilike(search_term))
                .order_by(MeetingMinutes.meeting_date.desc())
                .limit(limit - len(results))
            )

            res = await self.db.execute(stmt)
            for row in res.scalars().all():
                if row.id not in seen_ids:
                    seen_ids.add(row.id)
                    field_value = getattr(row, field_name) or ""
                    # Extract a snippet around the match
                    lower_val = field_value.lower()
                    idx = lower_val.find(query.lower())
                    start = max(0, idx - 50)
                    end = min(len(field_value), idx + len(query) + 50)
                    snippet = ("..." if start > 0 else "") + field_value[start:end] + ("..." if end < len(field_value) else "")

                    results.append({
                        "id": row.id,
                        "title": row.title,
                        "meeting_type": row.meeting_type if isinstance(row.meeting_type, str) else row.meeting_type.value,
                        "meeting_date": row.meeting_date,
                        "status": row.status if isinstance(row.status, str) else row.status.value,
                        "snippet": snippet,
                        "match_field": field_name,
                    })

        return results
