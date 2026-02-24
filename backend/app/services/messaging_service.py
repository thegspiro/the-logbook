"""
Department Messaging Service

Business logic for internal department messages/announcements.
Handles creation, targeting, delivery, and read tracking.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_uuid
from app.models.notification import (
    DepartmentMessage,
    DepartmentMessageRead,
    MessagePriority,
    MessageTargetType,
)
from app.models.user import Role, User


class MessagingService:
    """Service for department internal messaging"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Message CRUD
    # ============================================

    async def create_message(
        self,
        organization_id: str,
        posted_by: str,
        title: str,
        body: str,
        priority: str = "normal",
        target_type: str = "all",
        target_roles: Optional[List[str]] = None,
        target_statuses: Optional[List[str]] = None,
        target_member_ids: Optional[List[str]] = None,
        is_pinned: bool = False,
        requires_acknowledgment: bool = False,
        expires_at: Optional[datetime] = None,
    ) -> Tuple[Optional[DepartmentMessage], Optional[str]]:
        """Create a new department message"""
        try:
            message = DepartmentMessage(
                id=generate_uuid(),
                organization_id=organization_id,
                title=title,
                body=body,
                priority=MessagePriority(priority),
                target_type=MessageTargetType(target_type),
                target_roles=target_roles,
                target_statuses=target_statuses,
                target_member_ids=target_member_ids,
                is_pinned=is_pinned,
                is_active=True,
                requires_acknowledgment=requires_acknowledgment,
                posted_by=posted_by,
                expires_at=expires_at,
            )
            self.db.add(message)
            await self.db.commit()
            await self.db.refresh(message)
            return message, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_messages(
        self,
        organization_id: str,
        include_inactive: bool = False,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[DepartmentMessage], int]:
        """Get all messages for admin management"""
        query = select(DepartmentMessage).where(
            DepartmentMessage.organization_id == organization_id
        )
        if not include_inactive:
            query = query.where(DepartmentMessage.is_active == True)  # noqa: E712

        count_q = select(func.count(DepartmentMessage.id)).where(
            DepartmentMessage.organization_id == organization_id
        )
        if not include_inactive:
            count_q = count_q.where(DepartmentMessage.is_active == True)  # noqa: E712

        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        query = (
            query.order_by(
                desc(DepartmentMessage.is_pinned), desc(DepartmentMessage.created_at)
            )
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()
        return messages, total

    async def get_message_by_id(
        self, message_id: str, organization_id: str
    ) -> Optional[DepartmentMessage]:
        """Get a single message by ID"""
        result = await self.db.execute(
            select(DepartmentMessage).where(
                DepartmentMessage.id == message_id,
                DepartmentMessage.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_message(
        self, message_id: str, organization_id: str, updates: Dict[str, Any]
    ) -> Tuple[Optional[DepartmentMessage], Optional[str]]:
        """Update a message"""
        try:
            message = await self.get_message_by_id(message_id, organization_id)
            if not message:
                return None, "Message not found"

            allowed_fields = {
                "title",
                "body",
                "priority",
                "target_type",
                "target_roles",
                "target_statuses",
                "target_member_ids",
                "is_pinned",
                "is_active",
                "requires_acknowledgment",
                "expires_at",
            }
            for key, value in updates.items():
                if key in allowed_fields:
                    if key == "priority":
                        value = MessagePriority(value)
                    elif key == "target_type":
                        value = MessageTargetType(value)
                    setattr(message, key, value)

            await self.db.commit()
            await self.db.refresh(message)
            return message, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_message(
        self, message_id: str, organization_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Delete a message (hard delete)"""
        try:
            message = await self.get_message_by_id(message_id, organization_id)
            if not message:
                return False, "Message not found"
            await self.db.delete(message)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Inbox — Messages for the Current User
    # ============================================

    async def get_inbox(
        self,
        organization_id: str,
        user_id: str,
        include_read: bool = True,
        skip: int = 0,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Get messages visible to the current user based on targeting rules.
        Returns messages enriched with read/acknowledged status.
        """
        now = datetime.now(timezone.utc)

        # First get the user's roles and status
        user_result = await self.db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return []

        user_role_names = [r.name for r in user.roles]
        user_status = (
            user.status.value if hasattr(user.status, "value") else str(user.status)
        )

        # Get all active, non-expired messages for this org
        query = select(DepartmentMessage).where(
            DepartmentMessage.organization_id == organization_id,
            DepartmentMessage.is_active == True,  # noqa: E712
        )
        # Exclude expired
        query = query.where(
            or_(
                DepartmentMessage.expires_at.is_(None),
                DepartmentMessage.expires_at > now,
            )
        )
        query = query.order_by(
            desc(DepartmentMessage.is_pinned),
            desc(DepartmentMessage.created_at),
        )

        result = await self.db.execute(query)
        all_messages = result.scalars().all()

        # Filter by targeting
        visible_messages = []
        for msg in all_messages:
            if self._is_targeted(msg, user_id, user_role_names, user_status):
                visible_messages.append(msg)

        # Get read statuses for this user
        msg_ids = [m.id for m in visible_messages]
        if msg_ids:
            reads_result = await self.db.execute(
                select(DepartmentMessageRead).where(
                    DepartmentMessageRead.user_id == user_id,
                    DepartmentMessageRead.message_id.in_(msg_ids),
                )
            )
            reads = {r.message_id: r for r in reads_result.scalars().all()}
        else:
            reads = {}

        # Optionally filter out read messages
        enriched = []
        for msg in visible_messages:
            read_record = reads.get(msg.id)
            is_read = read_record is not None
            if not include_read and is_read:
                continue
            enriched.append(
                {
                    "id": msg.id,
                    "title": msg.title,
                    "body": msg.body,
                    "priority": (
                        msg.priority.value
                        if hasattr(msg.priority, "value")
                        else str(msg.priority)
                    ),
                    "target_type": (
                        msg.target_type.value
                        if hasattr(msg.target_type, "value")
                        else str(msg.target_type)
                    ),
                    "is_pinned": msg.is_pinned,
                    "requires_acknowledgment": msg.requires_acknowledgment,
                    "posted_by": msg.posted_by,
                    "author_name": None,  # Filled below
                    "created_at": (
                        msg.created_at.isoformat() if msg.created_at else None
                    ),
                    "expires_at": (
                        msg.expires_at.isoformat() if msg.expires_at else None
                    ),
                    "is_read": is_read,
                    "read_at": (
                        read_record.read_at.isoformat()
                        if read_record and read_record.read_at
                        else None
                    ),
                    "is_acknowledged": (
                        read_record.acknowledged_at is not None
                        if read_record
                        else False
                    ),
                    "acknowledged_at": (
                        read_record.acknowledged_at.isoformat()
                        if read_record and read_record.acknowledged_at
                        else None
                    ),
                }
            )

        # Resolve author names
        author_ids = list({m["posted_by"] for m in enriched if m["posted_by"]})
        if author_ids:
            authors_result = await self.db.execute(
                select(User.id, User.first_name, User.last_name).where(
                    User.id.in_(author_ids)
                )
            )
            author_map = {
                row.id: f"{row.first_name or ''} {row.last_name or ''}".strip()
                for row in authors_result.all()
            }
            for m in enriched:
                m["author_name"] = author_map.get(m["posted_by"], "Unknown")

        # Paginate
        len(enriched)
        enriched = enriched[skip : skip + limit]

        return enriched

    async def get_unread_count(self, organization_id: str, user_id: str) -> int:
        """Get count of unread messages for a user"""
        inbox = await self.get_inbox(
            organization_id, user_id, include_read=False, limit=1000
        )
        return len(inbox)

    def _is_targeted(
        self,
        message: DepartmentMessage,
        user_id: str,
        user_role_names: List[str],
        user_status: str,
    ) -> bool:
        """Check if a message targets the given user"""
        tt = (
            message.target_type.value
            if hasattr(message.target_type, "value")
            else str(message.target_type)
        )

        if tt == "all":
            return True
        elif tt == "roles":
            target_roles = message.target_roles or []
            return any(r in target_roles for r in user_role_names)
        elif tt == "statuses":
            target_statuses = message.target_statuses or []
            return user_status in target_statuses
        elif tt == "members":
            target_ids = message.target_member_ids or []
            return user_id in target_ids
        return False

    # ============================================
    # Read / Acknowledge Tracking
    # ============================================

    async def mark_as_read(
        self, message_id: str, user_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Mark a message as read by the current user"""
        try:
            existing = await self.db.execute(
                select(DepartmentMessageRead).where(
                    DepartmentMessageRead.message_id == message_id,
                    DepartmentMessageRead.user_id == user_id,
                )
            )
            record = existing.scalar_one_or_none()
            if record:
                return True, None  # Already read

            read_record = DepartmentMessageRead(
                id=generate_uuid(),
                message_id=message_id,
                user_id=user_id,
            )
            self.db.add(read_record)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def acknowledge_message(
        self, message_id: str, user_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Acknowledge a message (also marks as read)"""
        try:
            existing = await self.db.execute(
                select(DepartmentMessageRead).where(
                    DepartmentMessageRead.message_id == message_id,
                    DepartmentMessageRead.user_id == user_id,
                )
            )
            record = existing.scalar_one_or_none()

            if record:
                if not record.acknowledged_at:
                    record.acknowledged_at = datetime.now(timezone.utc)
                    await self.db.commit()
            else:
                read_record = DepartmentMessageRead(
                    id=generate_uuid(),
                    message_id=message_id,
                    user_id=user_id,
                    acknowledged_at=datetime.now(timezone.utc),
                )
                self.db.add(read_record)
                await self.db.commit()

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_message_stats(
        self, message_id: str, organization_id: str
    ) -> Dict[str, Any]:
        """Get read/acknowledge stats for a message (admin view)"""
        message = await self.get_message_by_id(message_id, organization_id)
        if not message:
            return {"error": "Message not found"}

        read_count = await self.db.execute(
            select(func.count(DepartmentMessageRead.id)).where(
                DepartmentMessageRead.message_id == message_id,
            )
        )
        ack_count = await self.db.execute(
            select(func.count(DepartmentMessageRead.id)).where(
                DepartmentMessageRead.message_id == message_id,
                DepartmentMessageRead.acknowledged_at.isnot(None),
            )
        )

        return {
            "message_id": message_id,
            "total_reads": read_count.scalar() or 0,
            "total_acknowledged": ack_count.scalar() or 0,
        }

    async def get_available_roles(self, organization_id: str) -> List[Dict[str, str]]:
        """Get list of roles for targeting dropdown"""
        result = await self.db.execute(
            select(Role.name, Role.slug)
            .where(Role.organization_id == organization_id)
            .order_by(Role.priority.desc())
        )
        return [{"name": r.name, "slug": r.slug} for r in result.all()]
