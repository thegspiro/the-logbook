"""
Department Messaging Service

Business logic for internal department messages/announcements.
Handles creation, targeting, delivery, and read tracking.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_uuid, safe_error_detail
from app.models.notification import (
    DepartmentMessage,
    DepartmentMessageRecipient,
    MessagePriority,
    MessageTargetType,
    NotificationChannel,
    NotificationLog,
)
from app.models.user import Role, User, UserStatus
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Return a timezone-aware UTC datetime, treating naive values as UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _validate_expiry(
    expires_at: Optional[datetime], scheduled_at: Optional[datetime], now: datetime
) -> None:
    """Validate an expiry against the message's effective publication time."""
    if expires_at is None:
        return
    if scheduled_at is not None:
        if expires_at <= scheduled_at:
            raise ValueError("expires_at must be later than scheduled_at")
    elif expires_at <= now:
        raise ValueError("expires_at must be in the future for a published message")


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
        is_persistent: bool = False,
        requires_acknowledgment: bool = False,
        expires_at: Optional[datetime] = None,
        scheduled_at: Optional[datetime] = None,
    ) -> Tuple[Optional[DepartmentMessage], Optional[str]]:
        """Create a new department message.

        Only a *future* scheduled_at defers the message; a missing or past value
        means "publish now" and is stored as NULL, so callers can treat
        scheduled_at is None as "live immediately".
        """
        try:
            await self._validate_targeting(
                organization_id,
                target_type,
                target_member_ids,
                target_roles,
                target_statuses,
            )
            target_roles, target_statuses, target_member_ids = self._audience_for_type(
                target_type, target_roles, target_statuses, target_member_ids
            )
            now = datetime.now(timezone.utc)
            scheduled_at = _as_utc(scheduled_at)
            expires_at = _as_utc(expires_at)
            effective_scheduled = (
                scheduled_at if (scheduled_at and scheduled_at > now) else None
            )
            _validate_expiry(expires_at, effective_scheduled, now)
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
                is_persistent=is_persistent,
                requires_acknowledgment=requires_acknowledgment,
                posted_by=posted_by,
                expires_at=expires_at,
                scheduled_at=effective_scheduled,
            )
            self.db.add(message)
            if effective_scheduled is None:
                await self.materialize_recipients(message)
            await self.db.commit()
            await self.db.refresh(message)
            return message, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    async def get_messages(
        self,
        organization_id: str,
        include_inactive: bool = False,
        include_deleted: bool = False,
        search: Optional[str] = None,
        priority: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[DepartmentMessage], int]:
        """Get all messages for admin management.

        Soft-deleted messages (deleted_at set) are hidden by default so a
        "deleted" message does not reappear in the admin list, while its
        read/acknowledgment records are preserved in the database. Supports a
        title/body search and a priority filter, applied to both the page and
        its total count.
        """

        def _apply_filters(q):
            if not include_inactive:
                q = q.where(DepartmentMessage.is_active.is_(True))
            if not include_deleted:
                q = q.where(DepartmentMessage.deleted_at.is_(None))
            if search and search.strip():
                pattern = like_pattern(search.strip())
                q = q.where(
                    or_(
                        DepartmentMessage.title.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                        DepartmentMessage.body.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    )
                )
            if priority:
                q = q.where(DepartmentMessage.priority == MessagePriority(priority))
            return q

        query = _apply_filters(
            select(DepartmentMessage).where(
                DepartmentMessage.organization_id == organization_id
            )
        )
        count_q = _apply_filters(
            select(func.count(DepartmentMessage.id)).where(
                DepartmentMessage.organization_id == organization_id
            )
        )

        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        query = (
            query.order_by(
                desc(DepartmentMessage.is_pinned),
                desc(DepartmentMessage.created_at),
                desc(DepartmentMessage.id),
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
        """Update a message.

        Rescheduling is only allowed for a message that is still pending
        (scheduled_at in the future). A message whose scheduled_at is NULL has
        already been published/escalated, and moving it back to a future time
        would make the publish task escalate it a second time, so that is
        rejected.
        """
        try:
            message = await self.get_message_by_id(message_id, organization_id)
            if not message:
                return None, "Message not found"

            now = datetime.now(timezone.utc)
            was_pending = _as_utc(message.scheduled_at) is not None
            if "scheduled_at" in updates:
                updates["scheduled_at"] = _as_utc(updates["scheduled_at"])
            if "expires_at" in updates:
                updates["expires_at"] = _as_utc(updates["expires_at"])

            new_sched = updates.get("scheduled_at")
            if new_sched is not None and message.scheduled_at is None:
                if new_sched > now:
                    return (
                        None,
                        "Cannot reschedule a message that has already been "
                        "published",
                    )
                # A past/current value here would leave scheduled_at non-null
                # on an already-published message, making the next publish
                # sweep (run_publish_scheduled_messages) treat it as newly
                # due and deliver it a second time. Collapse it the same way
                # create_message does, so this is a no-op rather than a
                # re-trigger.
                updates["scheduled_at"] = None

            effective_schedule = (
                updates.get("scheduled_at")
                if "scheduled_at" in updates
                else _as_utc(message.scheduled_at)
            )
            effective_expiry = (
                updates.get("expires_at")
                if "expires_at" in updates
                else _as_utc(getattr(message, "expires_at", None))
            )
            if {"expires_at", "scheduled_at"}.intersection(updates):
                _validate_expiry(effective_expiry, effective_schedule, now)

            audience_fields = {
                "target_type",
                "target_member_ids",
                "target_roles",
                "target_statuses",
            }
            if audience_fields.intersection(updates):
                effective_target_type = updates.get("target_type", message.target_type)
                effective_member_ids = updates.get(
                    "target_member_ids", message.target_member_ids
                )
                effective_roles = updates.get("target_roles", message.target_roles)
                effective_statuses = updates.get(
                    "target_statuses", message.target_statuses
                )
                await self._validate_targeting(
                    organization_id,
                    effective_target_type,
                    effective_member_ids,
                    effective_roles,
                    effective_statuses,
                )
                roles, statuses, member_ids = self._audience_for_type(
                    effective_target_type,
                    effective_roles,
                    effective_statuses,
                    effective_member_ids,
                )
                updates.update(
                    target_roles=roles,
                    target_statuses=statuses,
                    target_member_ids=member_ids,
                )

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
                "is_persistent",
                "requires_acknowledgment",
                "expires_at",
                "scheduled_at",
            }
            for key, value in updates.items():
                if key in allowed_fields:
                    if key == "priority":
                        value = MessagePriority(value)
                    elif key == "target_type":
                        value = MessageTargetType(value)
                    setattr(message, key, value)

            audience_changed = bool(audience_fields.intersection(updates))
            published_by_update = was_pending and message.scheduled_at is None
            if published_by_update:
                await self.materialize_recipients(message)
            elif audience_changed and message.scheduled_at is None:
                await self.reconcile_recipients(message)

            # The endpoint uses this transient flag to enqueue the same channel
            # fan-out as a scheduler publication without persisting extra state.
            message._published_by_update = published_by_update

            await self.db.commit()
            await self.db.refresh(message)
            return message, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    async def delete_message(
        self, message_id: str, organization_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Soft-delete a message.

        Sets deleted_at and deactivates the message instead of issuing a hard
        DELETE. A hard delete would cascade-remove the DepartmentMessageRead
        rows, destroying the record of who acknowledged the message — which is
        treated as compliance evidence. Soft delete keeps that history intact.
        """
        try:
            message = await self.get_message_by_id(message_id, organization_id)
            if not message or message.deleted_at is not None:
                return False, "Message not found"
            message.deleted_at = datetime.now(timezone.utc)
            message.is_active = False
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, safe_error_detail(e)

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

        query = (
            select(DepartmentMessage, DepartmentMessageRecipient)
            .join(
                DepartmentMessageRecipient,
                DepartmentMessageRecipient.message_id == DepartmentMessage.id,
            )
            .where(
                DepartmentMessageRecipient.organization_id == organization_id,
                DepartmentMessageRecipient.user_id == user_id,
                DepartmentMessage.organization_id == organization_id,
                DepartmentMessage.is_active.is_(True),
                DepartmentMessage.deleted_at.is_(None),
            )
        )
        # Exclude expired
        query = query.where(
            or_(
                DepartmentMessage.expires_at.is_(None),
                DepartmentMessage.expires_at > now,
            )
        )
        # Exclude messages scheduled to publish in the future
        query = query.where(
            or_(
                DepartmentMessage.scheduled_at.is_(None),
                DepartmentMessage.scheduled_at <= now,
            )
        )
        if not include_read:
            query = query.where(
                or_(
                    DepartmentMessage.is_persistent.is_(True),
                    and_(
                        DepartmentMessage.requires_acknowledgment.is_(True),
                        DepartmentMessageRecipient.acknowledged_at.is_(None),
                    ),
                    and_(
                        DepartmentMessage.requires_acknowledgment.is_(False),
                        DepartmentMessageRecipient.read_at.is_(None),
                    ),
                )
            )
        query = (
            query.order_by(
                desc(DepartmentMessage.is_pinned),
                desc(DepartmentMessage.is_persistent),
                desc(DepartmentMessage.created_at),
                desc(DepartmentMessage.id),
            )
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        enriched = [
            self._inbox_entry(msg, recipient) for msg, recipient in result.all()
        ]

        await self._attach_author_names(enriched, organization_id)

        return enriched

    async def get_inbox_message(
        self, organization_id: str, user_id: str, message_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a single inbox message, or None when it is not the caller's.

        Backs the member-facing message detail screen. Visibility runs through
        the same fail-closed gate as read/acknowledge, so a member cannot open
        a message by id that the inbox list would not have shown them.
        """
        message = await self._visible_message_or_none(
            message_id, user_id, organization_id
        )
        if not message:
            return None

        read_result = await self.db.execute(
            select(DepartmentMessageRecipient).where(
                DepartmentMessageRecipient.message_id == message.id,
                DepartmentMessageRecipient.user_id == user_id,
                DepartmentMessageRecipient.organization_id == organization_id,
            )
        )
        entry = self._inbox_entry(message, read_result.scalar_one_or_none())
        await self._attach_author_names([entry], organization_id)
        return entry

    @staticmethod
    def _inbox_entry(
        msg: DepartmentMessage, read_record: Optional[DepartmentMessageRecipient]
    ) -> Dict[str, Any]:
        """Shape one message + the caller's read record into an inbox entry.

        author_name is left None for _attach_author_names to fill, so callers
        resolve author names in one query rather than per message.
        """
        return {
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
            "is_persistent": msg.is_persistent,
            "requires_acknowledgment": msg.requires_acknowledgment,
            "posted_by": msg.posted_by,
            "author_name": None,
            "created_at": (msg.created_at.isoformat() if msg.created_at else None),
            "expires_at": (msg.expires_at.isoformat() if msg.expires_at else None),
            "is_read": bool(read_record and read_record.read_at is not None),
            "read_at": (
                read_record.read_at.isoformat()
                if read_record and read_record.read_at
                else None
            ),
            "is_acknowledged": (
                read_record.acknowledged_at is not None if read_record else False
            ),
            "acknowledged_at": (
                read_record.acknowledged_at.isoformat()
                if read_record and read_record.acknowledged_at
                else None
            ),
        }

    async def _attach_author_names(
        self, entries: List[Dict[str, Any]], organization_id: str
    ) -> None:
        """Fill author_name on inbox entries in place, in a single query."""
        author_ids = list({m["posted_by"] for m in entries if m["posted_by"]})
        if not author_ids:
            return
        authors_result = await self.db.execute(
            select(User.id, User.first_name, User.last_name).where(
                User.id.in_(author_ids),
                User.organization_id == organization_id,
            )
        )
        author_map = {
            row.id: (
                f"{row.first_name or ''} {row.last_name or ''}".strip() or "Unknown"
            )
            for row in authors_result.all()
        }
        for m in entries:
            if m["posted_by"]:
                m["author_name"] = author_map.get(m["posted_by"], "Unknown")

    async def get_unread_count(self, organization_id: str, user_id: str) -> int:
        """Get count of unresolved (pending) messages for a user.

        Loads only the id + targeting/flag columns needed to evaluate
        visibility — never the message body — so the dashboard badge stays
        cheap. A message counts as pending until it is acknowledged (when it
        requires acknowledgment) or otherwise read, so a message that requires
        acknowledgment is not cleared from the count merely by being opened.
        """
        now = datetime.now(timezone.utc)
        query = (
            select(func.count(DepartmentMessageRecipient.id))
            .join(
                DepartmentMessage,
                DepartmentMessage.id == DepartmentMessageRecipient.message_id,
            )
            .where(
                DepartmentMessageRecipient.organization_id == organization_id,
                DepartmentMessageRecipient.user_id == user_id,
                DepartmentMessage.organization_id == organization_id,
                DepartmentMessage.is_active.is_(True),
                DepartmentMessage.deleted_at.is_(None),
            )
            .where(
                or_(
                    DepartmentMessage.expires_at.is_(None),
                    DepartmentMessage.expires_at > now,
                )
            )
            .where(
                or_(
                    DepartmentMessage.scheduled_at.is_(None),
                    DepartmentMessage.scheduled_at <= now,
                )
            )
            .where(
                or_(
                    and_(
                        DepartmentMessage.requires_acknowledgment.is_(True),
                        DepartmentMessageRecipient.acknowledged_at.is_(None),
                    ),
                    and_(
                        DepartmentMessage.requires_acknowledgment.is_(False),
                        DepartmentMessageRecipient.read_at.is_(None),
                    ),
                )
            )
        )
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def materialize_recipients(self, message: DepartmentMessage) -> int:
        """Persist the audience at publish time so inbox reads are pure SQL."""
        users = await self._targeted_users(message, str(message.organization_id))
        for user in users:
            self.db.add(
                DepartmentMessageRecipient(
                    id=generate_uuid(),
                    message_id=message.id,
                    user_id=str(user.id),
                    organization_id=str(message.organization_id),
                )
            )
        return len(users)

    async def reconcile_recipients(self, message: DepartmentMessage) -> int:
        """Rebuild a live audience while retaining resolution for members kept."""
        users = await self._targeted_users(message, str(message.organization_id))
        targeted = {str(user.id) for user in users}
        result = await self.db.execute(
            select(DepartmentMessageRecipient).where(
                DepartmentMessageRecipient.message_id == message.id,
                DepartmentMessageRecipient.organization_id
                == str(message.organization_id),
            )
        )
        existing = {str(row.user_id): row for row in result.scalars().all()}
        for user_id in targeted - existing.keys():
            self.db.add(
                DepartmentMessageRecipient(
                    id=generate_uuid(),
                    message_id=message.id,
                    user_id=user_id,
                    organization_id=str(message.organization_id),
                )
            )
        for user_id in existing.keys() - targeted:
            row = existing[user_id]
            # A receipt is evidence. read_at/acknowledged_at live on this row
            # and nowhere else, so deleting it destroys the only record that a
            # member read — and possibly formally acknowledged — this message.
            # That record is exactly what a department needs to produce later,
            # and it is lost without anyone acting on the message at all:
            # _targeted_users filters on User.is_active, so a member simply
            # going on leave drops out of the audience and takes their
            # acknowledgment with them. Prune only rows that carry nothing.
            if row.read_at is None and row.acknowledged_at is None:
                await self.db.delete(row)
        return len(targeted)

    @staticmethod
    def _user_targeting_context(user) -> Tuple[List[str], List[str], str]:
        """Extract the (role_ids, role_names, status) a user is matched on."""
        role_ids = [str(r.id) for r in user.roles]
        role_names = [r.name for r in user.roles]
        status = (
            user.status.value if hasattr(user.status, "value") else str(user.status)
        )
        return role_ids, role_names, status

    async def _get_targeting_user(
        self, organization_id: str, user_id: str
    ) -> Optional[User]:
        """Load the member context used by every visibility calculation."""
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.roles))
            .where(
                User.id == user_id,
                User.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    def _is_targeted(
        self,
        message: DepartmentMessage,
        user_id: str,
        user_role_ids: List[str],
        user_role_names: List[str],
        user_status: str,
    ) -> bool:
        """Check if a message targets the given user.

        Role targeting matches on role *id* (rename-safe). A role-name fallback
        is retained so messages authored before role-id targeting — or entries
        that could not be backfilled because the role was since deleted — still
        reach the right members.
        """
        tt = (
            message.target_type.value
            if hasattr(message.target_type, "value")
            else str(message.target_type)
        )

        if tt == "all":
            return True
        elif tt == "roles":
            target_roles = message.target_roles or []
            return any(rid in target_roles for rid in user_role_ids) or any(
                rname in target_roles for rname in user_role_names
            )
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

    async def _mark_message_notification_read(
        self, message_id: str, user_id: str, organization_id: str
    ) -> bool:
        """Apply the department-message receipt to its in-app notification.

        ``metadata.message_id`` is the delivery service's existing link between
        the two records.  Keep all recipient and tenant predicates here so a
        receipt can never affect another member's notification.
        """
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            update(NotificationLog)
            .where(
                NotificationLog.organization_id == organization_id,
                NotificationLog.recipient_id == user_id,
                NotificationLog.channel == NotificationChannel.IN_APP,
                NotificationLog.category == "department_message",
                NotificationLog.read.is_(False),
                NotificationLog.notification_metadata["message_id"].as_string()
                == message_id,
            )
            .values(read=True, read_at=now)
        )
        return bool(result.rowcount)

    async def _visible_message_or_none(
        self, message_id: str, user_id: str, organization_id: str
    ) -> Optional[DepartmentMessage]:
        """Return a currently live message only when targeted to the caller.

        Read/acknowledge records are compliance evidence, so inactive, expired,
        scheduled, deleted, cross-org, and untargeted messages all fail closed.
        """
        now = datetime.now(timezone.utc)
        message_result = await self.db.execute(
            select(DepartmentMessage)
            .join(
                DepartmentMessageRecipient,
                DepartmentMessageRecipient.message_id == DepartmentMessage.id,
            )
            .where(
                DepartmentMessageRecipient.organization_id == organization_id,
                DepartmentMessageRecipient.user_id == user_id,
                DepartmentMessage.id == message_id,
                DepartmentMessage.organization_id == organization_id,
                DepartmentMessage.is_active.is_(True),
                DepartmentMessage.deleted_at.is_(None),
                or_(
                    DepartmentMessage.expires_at.is_(None),
                    DepartmentMessage.expires_at > now,
                ),
                or_(
                    DepartmentMessage.scheduled_at.is_(None),
                    DepartmentMessage.scheduled_at <= now,
                ),
            )
        )
        message = message_result.scalar_one_or_none()
        if not message:
            return None
        return message

    async def mark_as_read(
        self, message_id: str, user_id: str, organization_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Mark a message as read by the current user"""
        try:
            if not await self._visible_message_or_none(
                message_id, user_id, organization_id
            ):
                return False, "Message not found"

            existing = await self.db.execute(
                select(DepartmentMessageRecipient).where(
                    DepartmentMessageRecipient.message_id == message_id,
                    DepartmentMessageRecipient.user_id == user_id,
                    DepartmentMessageRecipient.organization_id == organization_id,
                )
            )
            record = existing.scalar_one_or_none()
            if not record:
                return False, "Message not found"
            already_read = record.read_at is not None
            if not already_read:
                record.read_at = datetime.now(timezone.utc)
            notification_changed = await self._mark_message_notification_read(
                message_id, user_id, organization_id
            )
            if already_read and not notification_changed:
                return True, None
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, safe_error_detail(e)

    async def acknowledge_message(
        self, message_id: str, user_id: str, organization_id: str
    ) -> Tuple[bool, Optional[str], bool]:
        """Acknowledge a message (also marks as read)"""
        try:
            message = await self._visible_message_or_none(
                message_id, user_id, organization_id
            )
            if not message:
                return False, "Message not found", False
            if not message.requires_acknowledgment:
                return False, "Message does not require acknowledgment", False

            now = datetime.now(timezone.utc)
            claimed = await self.db.execute(
                update(DepartmentMessageRecipient)
                .where(
                    DepartmentMessageRecipient.message_id == message_id,
                    DepartmentMessageRecipient.user_id == user_id,
                    DepartmentMessageRecipient.organization_id == organization_id,
                    DepartmentMessageRecipient.acknowledged_at.is_(None),
                )
                .values(
                    read_at=func.coalesce(DepartmentMessageRecipient.read_at, now),
                    acknowledged_at=now,
                )
            )
            newly_acknowledged = bool(claimed.rowcount)
            notification_changed = await self._mark_message_notification_read(
                message_id, user_id, organization_id
            )
            if not newly_acknowledged and not notification_changed:
                return True, None, False
            await self.db.commit()

            return True, None, newly_acknowledged
        except Exception as e:
            await self.db.rollback()
            return False, safe_error_detail(e), False

    async def _validate_targeting(
        self,
        organization_id: str,
        target_type: str,
        target_member_ids: Optional[List[str]],
        target_roles: Optional[List[str]],
        target_statuses: Optional[List[str]],
    ) -> None:
        """Reject invalid or empty audiences before persisting a message.

        Delivery is already org-safe — ``_targeted_users`` only ever matches
        same-org users, so a foreign id reaches nobody — so this is data hygiene
        / defense-in-depth: it stops a raw API caller from persisting an empty
        audience, foreign/garbage member or role ids, or invalid member statuses.
        Role entries may be a role id or (rename-safe) role name, matching
        ``_is_targeted``. Updates call this only when an audience field changes,
        so an unrelated edit does not reject a retained legacy role name.
        """
        target = (
            target_type.value if hasattr(target_type, "value") else str(target_type)
        )
        if target == "all":
            return
        if target == "members":
            if not target_member_ids:
                raise ValueError("At least one target member is required")
            result = await self.db.execute(
                select(User.id).where(
                    User.organization_id == organization_id,
                    User.id.in_([str(m) for m in target_member_ids]),
                )
            )
            valid_members = {str(r) for r in result.scalars().all()}
            if any(str(m) not in valid_members for m in target_member_ids):
                raise ValueError(
                    "One or more target members are not in your organization"
                )
            return
        if target == "roles":
            if not target_roles:
                raise ValueError("At least one target role is required")
            result = await self.db.execute(
                select(Role.id, Role.name).where(
                    Role.organization_id == organization_id
                )
            )
            valid_roles: set = set()
            for row in result.all():
                valid_roles.add(str(row.id))
                if row.name:
                    valid_roles.add(row.name)
            if any(str(r) not in valid_roles for r in target_roles):
                raise ValueError(
                    "One or more target roles are not in your organization"
                )
            return
        if target == "statuses":
            if not target_statuses:
                raise ValueError("At least one target status is required")
            valid_statuses = {status.value for status in UserStatus}
            if any(str(status) not in valid_statuses for status in target_statuses):
                raise ValueError("One or more target statuses are invalid")
            return
        raise ValueError("Invalid message target type")

    @staticmethod
    def _audience_for_type(
        target_type: str,
        target_roles: Optional[List[str]],
        target_statuses: Optional[List[str]],
        target_member_ids: Optional[List[str]],
    ) -> Tuple[Optional[List[str]], Optional[List[str]], Optional[List[str]]]:
        """Clear audience lists that do not apply to the selected target type."""
        target = (
            target_type.value if hasattr(target_type, "value") else str(target_type)
        )
        return (
            target_roles if target == "roles" else None,
            target_statuses if target == "statuses" else None,
            target_member_ids if target == "members" else None,
        )

    async def _targeted_users(
        self, message: DepartmentMessage, organization_id: str
    ) -> List[User]:
        """Resolve the concrete set of users a message is targeted at.

        Loads the org's active users (with roles) once and reuses _is_targeted
        so delivery, reports, and the stats denominator agree exactly with what
        the inbox delivers. Deleted or inactive accounts must not receive
        external message delivery. Bounded by org size, so an in-Python filter
        is acceptable for this admin-only, low-frequency path.
        """
        users_result = await self.db.execute(
            select(User)
            .options(selectinload(User.roles))
            .where(
                User.organization_id == organization_id,
                User.is_active,
            )
        )
        users = users_result.scalars().all()
        targeted = []
        for u in users:
            role_ids, role_names, status = self._user_targeting_context(u)
            if self._is_targeted(message, str(u.id), role_ids, role_names, status):
                targeted.append(u)
        return targeted

    async def get_message_stats(
        self, message_id: str, organization_id: str
    ) -> Dict[str, Any]:
        """Get read/acknowledge stats for a message (admin view).

        Includes total_targeted (the audience denominator) so read/ack counts
        can be read as a completion rate rather than a bare number.
        """
        message = await self.get_message_by_id(message_id, organization_id)
        if not message:
            return {"error": "Message not found"}

        read_count = await self.db.execute(
            select(func.count(DepartmentMessageRecipient.id)).where(
                DepartmentMessageRecipient.message_id == message_id,
                DepartmentMessageRecipient.read_at.isnot(None),
            )
        )
        ack_count = await self.db.execute(
            select(func.count(DepartmentMessageRecipient.id)).where(
                DepartmentMessageRecipient.message_id == message_id,
                DepartmentMessageRecipient.acknowledged_at.isnot(None),
            )
        )
        targeted_count = await self.db.execute(
            select(func.count(DepartmentMessageRecipient.id)).where(
                DepartmentMessageRecipient.message_id == message_id,
                DepartmentMessageRecipient.organization_id == organization_id,
            )
        )

        return {
            "message_id": message_id,
            "total_targeted": targeted_count.scalar() or 0,
            "total_reads": read_count.scalar() or 0,
            "total_acknowledged": ack_count.scalar() or 0,
        }

    async def get_acknowledgment_report(
        self, message_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """Per-recipient read/acknowledgment breakdown for a message.

        Answers "who has (not) acknowledged this?" — the report leadership
        needs for acknowledgment-required notices (e.g. an SOP change). Returns
        None when the message does not exist in the org.
        """
        message = await self.get_message_by_id(message_id, organization_id)
        if not message:
            return None

        recipient_result = await self.db.execute(
            select(User, DepartmentMessageRecipient)
            .join(
                DepartmentMessageRecipient,
                DepartmentMessageRecipient.user_id == User.id,
            )
            .where(
                DepartmentMessageRecipient.message_id == message_id,
                DepartmentMessageRecipient.organization_id == organization_id,
            )
        )
        targeted_rows = recipient_result.all()

        recipients = []
        total_read = 0
        total_acknowledged = 0
        for u, record in targeted_rows:
            is_read = record.read_at is not None
            is_acknowledged = bool(record and record.acknowledged_at is not None)
            if is_read:
                total_read += 1
            if is_acknowledged:
                total_acknowledged += 1
            recipients.append(
                {
                    "user_id": str(u.id),
                    "name": f"{u.first_name or ''} {u.last_name or ''}".strip()
                    or (u.username or "Unknown"),
                    "status": (
                        u.status.value if hasattr(u.status, "value") else str(u.status)
                    ),
                    "is_read": is_read,
                    "read_at": (
                        record.read_at.isoformat()
                        if record and record.read_at
                        else None
                    ),
                    "is_acknowledged": is_acknowledged,
                    "acknowledged_at": (
                        record.acknowledged_at.isoformat()
                        if record and record.acknowledged_at
                        else None
                    ),
                }
            )

        # Surface the members who still owe an acknowledgment/read first.
        recipients.sort(key=lambda r: (r["is_acknowledged"], r["is_read"], r["name"]))

        return {
            "message_id": message_id,
            "requires_acknowledgment": message.requires_acknowledgment,
            "total_targeted": len(targeted_rows),
            "total_read": total_read,
            "total_acknowledged": total_acknowledged,
            "recipients": recipients,
        }

    async def get_available_roles(self, organization_id: str) -> List[Dict[str, str]]:
        """Get list of roles for targeting dropdown.

        Includes the role id, which is what role-targeted messages store (the
        id is stable across renames, unlike the name).
        """
        result = await self.db.execute(
            select(Role.id, Role.name, Role.slug)
            .where(Role.organization_id == organization_id)
            .order_by(Role.priority.desc())
        )
        return [{"id": r.id, "name": r.name, "slug": r.slug} for r in result.all()]
