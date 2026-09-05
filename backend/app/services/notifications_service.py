"""
Notifications Service

Business logic for notification management including rules,
sending, logging, and preferences.
"""

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import safe_error_detail
from app.models.notification import (
    NotificationCategory,
    NotificationChannel,
    NotificationLog,
    NotificationRule,
)
from app.utils.cursor_pagination import keyset_before, trim_to_page
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

logger = logging.getLogger(__name__)


class NotificationsService:
    """Service for notification management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Rule Management
    # ============================================

    async def create_rule(
        self, organization_id: UUID, rule_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[NotificationRule], Optional[str]]:
        """Create a new notification rule"""
        try:
            rule = NotificationRule(
                organization_id=organization_id, created_by=created_by, **rule_data
            )
            self.db.add(rule)
            await self.db.commit()
            await self.db.refresh(rule)
            return rule, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    async def get_rules(
        self,
        organization_id: UUID,
        category: Optional[str] = None,
        enabled: Optional[bool] = None,
        search: Optional[str] = None,
    ) -> List[NotificationRule]:
        """Get notification rules with optional filtering"""
        query = select(NotificationRule).where(
            NotificationRule.organization_id == str(organization_id)
        )

        if category:
            try:
                cat_enum = NotificationCategory(category)
                query = query.where(NotificationRule.category == cat_enum)
            except ValueError:
                pass

        if enabled is not None:
            query = query.where(NotificationRule.enabled == enabled)

        if search:
            search_term = like_pattern(search)
            query = query.where(
                or_(
                    NotificationRule.name.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    NotificationRule.description.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                )
            )

        query = query.order_by(NotificationRule.name)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_rule_by_id(
        self, rule_id: UUID, organization_id: UUID
    ) -> Optional[NotificationRule]:
        """Get a notification rule by ID"""
        result = await self.db.execute(
            select(NotificationRule)
            .where(NotificationRule.id == str(rule_id))
            .where(NotificationRule.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_rule(
        self, rule_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[NotificationRule], Optional[str]]:
        """Update a notification rule"""
        try:
            rule = await self.get_rule_by_id(rule_id, organization_id)
            if not rule:
                return None, "Notification rule not found"

            apply_updates(rule, update_data, skip={"id", "organization_id"})

            await self.db.commit()
            await self.db.refresh(rule)
            return rule, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    async def delete_rule(
        self, rule_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a notification rule"""
        try:
            rule = await self.get_rule_by_id(rule_id, organization_id)
            if not rule:
                return False, "Notification rule not found"

            await self.db.delete(rule)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, safe_error_detail(e)

    async def toggle_rule(
        self, rule_id: UUID, organization_id: UUID, enabled: bool
    ) -> Tuple[Optional[NotificationRule], Optional[str]]:
        """Toggle a notification rule on/off"""
        return await self.update_rule(rule_id, organization_id, {"enabled": enabled})

    # ============================================
    # Notification Log
    # ============================================

    async def log_notification(
        self, organization_id: UUID, log_data: Dict[str, Any]
    ) -> Tuple[Optional[NotificationLog], Optional[str]]:
        """Log a sent notification.

        In-app notifications are additionally pushed to the recipient's
        registered devices. Hooking in here rather than at each of the dozen
        call sites means every existing notification source (events, training,
        maintenance, elections, ...) reaches a phone with no further changes.
        """
        try:
            log = NotificationLog(organization_id=organization_id, **log_data)
            self.db.add(log)
            await self.db.commit()
            await self.db.refresh(log)
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

        await self._maybe_push(organization_id, log)
        return log, None

    async def _maybe_push(self, organization_id: UUID, log: NotificationLog) -> None:
        """Best-effort web push for an in-app notification.

        Deliberately runs after the log row is committed and swallows all
        errors: the notification is already durably recorded, and a push
        service outage must not fail the action that produced it.
        """
        if log.channel != NotificationChannel.IN_APP or not log.recipient_id:
            return
        try:
            from app.services.push_service import PushService

            push = PushService(self.db)
            if not push.is_configured():
                return
            await push.send_to_user(
                organization_id=organization_id,
                user_id=log.recipient_id,
                title=log.subject or "The Logbook",
                body=log.message or "",
                tag=log.category or "logbook",
            )
        except Exception:
            logger.exception("Web push dispatch failed for notification %s", log.id)

    async def get_logs(
        self,
        organization_id: UUID,
        channel: Optional[str] = None,
        recipient_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
        cursor: Optional[str] = None,
    ) -> Tuple[List[NotificationLog], int, Optional[str]]:
        """Get notification logs, by cursor when given and by offset otherwise.

        ``recipient_id`` narrows the result to one member's own deliveries.
        Every writer on this path sets ``recipient_id`` (``recipient_email``
        is only ever a copy of that user's address), so the id alone is the
        complete filter — matching on the email as well would widen the query
        without reaching a row the id misses.

        A ``cursor`` supersedes ``skip``: the two answer different questions
        ("rows after this one" against "rows 50-99 of the current answer") and
        honouring both at once would apply the offset within the keyset page.
        ``skip`` stays supported because it is the published contract, and
        because the caller of a first page has no cursor to pass.

        Raises :class:`~app.utils.cursor_pagination.InvalidCursor` for a cursor
        this application did not issue.
        """
        query = select(NotificationLog).where(
            NotificationLog.organization_id == str(organization_id)
        )

        if recipient_id is not None:
            query = query.where(NotificationLog.recipient_id == str(recipient_id))

        if channel:
            try:
                channel_enum = NotificationChannel(channel)
                query = query.where(NotificationLog.channel == channel_enum)
            except ValueError:
                pass

        # Counted before the keyset predicate narrows the query: the total
        # describes the whole filtered list, not the tail after the cursor.
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # `is not None`, not truthiness: `?cursor=` arrives as an empty string,
        # which the codec classifies as invalid. Falling through to the offset
        # branch would answer 200 with the first page to a caller that believed
        # it was continuing, quietly duplicating rows.
        if cursor is not None:
            query = query.where(
                keyset_before(NotificationLog.sent_at, NotificationLog.id, cursor)
            )
        else:
            query = query.offset(skip)

        # One row beyond the page: its presence is what proves another page
        # exists. A page that is merely full proves nothing.
        query = query.order_by(
            NotificationLog.sent_at.desc(), NotificationLog.id.desc()
        ).limit(limit + 1)
        result = await self.db.execute(query)
        logs, next_cursor = trim_to_page(list(result.scalars().all()), limit)

        return logs, total, next_cursor

    async def get_user_notifications(
        self,
        organization_id: UUID,
        user_id: UUID,
        include_expired: bool = False,
        include_read: bool = True,
        skip: int = 0,
        limit: int = 50,
        cursor: Optional[str] = None,
    ) -> Tuple[List[NotificationLog], int, Optional[str]]:
        """Get in-app notifications for a specific user.

        Active view (include_expired=False): hides notifications past their
        expires_at timestamp. History view (include_expired=True): returns all.

        Paginates by cursor when one is given and by offset otherwise, on the
        same terms as :meth:`get_logs` — the inbox grows at the front for the
        same reason the send log does, so its Load more had the same skipped-row
        problem.
        """
        query = (
            select(NotificationLog)
            .where(NotificationLog.organization_id == str(organization_id))
            .where(NotificationLog.recipient_id == str(user_id))
            .where(NotificationLog.channel == NotificationChannel.IN_APP)
        )

        if not include_expired:
            now = datetime.now(timezone.utc)
            query = query.where(
                or_(
                    NotificationLog.expires_at.is_(None),
                    NotificationLog.expires_at > now,
                )
            )

        if not include_read:
            query = query.where(NotificationLog.read.is_(False))

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # `is not None`, not truthiness: `?cursor=` arrives as an empty string,
        # which the codec classifies as invalid. Falling through to the offset
        # branch would answer 200 with the first page to a caller that believed
        # it was continuing, quietly duplicating rows.
        if cursor is not None:
            query = query.where(
                keyset_before(NotificationLog.sent_at, NotificationLog.id, cursor)
            )
        else:
            query = query.offset(skip)

        # One row beyond the page: its presence is what proves another page
        # exists. A page that is merely full proves nothing.
        query = query.order_by(
            NotificationLog.sent_at.desc(), NotificationLog.id.desc()
        ).limit(limit + 1)
        result = await self.db.execute(query)
        logs, next_cursor = trim_to_page(list(result.scalars().all()), limit)

        return logs, total, next_cursor

    async def get_user_unread_count(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> int:
        """Get count of unread, non-expired in-app notifications for a user."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(func.count(NotificationLog.id))
            .where(NotificationLog.organization_id == str(organization_id))
            .where(NotificationLog.recipient_id == str(user_id))
            .where(NotificationLog.channel == NotificationChannel.IN_APP)
            .where(NotificationLog.read.is_(False))
            .where(
                or_(
                    NotificationLog.expires_at.is_(None),
                    NotificationLog.expires_at > now,
                )
            )
        )
        return result.scalar() or 0

    async def archive_related_notifications(
        self,
        organization_id: UUID | str,
        category: str,
        resource_key: str,
        resource_id: UUID | str,
    ) -> int:
        """Archive in-app prompts whose related action has been completed.

        Action-producing notifications already carry resource identifiers in
        their metadata.  Keeping the lookup here gives completion endpoints a
        common, idempotent way to remove stale prompts without coupling the
        notification table to every resource table in the application.
        """
        now = datetime.now(timezone.utc)
        try:
            # The session is shared with the caller, which may hold staged but
            # uncommitted work (e.g. a just-flushed audit record). Run the
            # archival inside a SAVEPOINT so a failure rolls back only the
            # archival — a session-level rollback() here would silently
            # discard the caller's staged work as well.
            async with self.db.begin_nested():
                result = await self.db.execute(
                    update(NotificationLog)
                    .where(NotificationLog.organization_id == str(organization_id))
                    .where(NotificationLog.channel == NotificationChannel.IN_APP)
                    .where(NotificationLog.category == category)
                    .where(
                        or_(
                            NotificationLog.expires_at.is_(None),
                            NotificationLog.expires_at > now,
                        )
                    )
                    .where(
                        NotificationLog.notification_metadata[resource_key].as_string()
                        == str(resource_id)
                    )
                    .values(
                        expires_at=now,
                        read=True,
                        read_at=func.coalesce(NotificationLog.read_at, now),
                    )
                )
                matched = result.rowcount or 0
        except Exception:
            logger.exception(
                "Failed to archive %s notification for %s=%s",
                category,
                resource_key,
                resource_id,
            )
            return 0
        if matched > 0:
            try:
                await self.db.commit()
            except Exception:
                logger.exception(
                    "Failed to commit archival of %s notification for %s=%s",
                    category,
                    resource_key,
                    resource_id,
                )
                # A failed commit has already lost the transaction; rollback
                # only resets the session so the caller can keep using it.
                await self.db.rollback()
                return 0
        return matched

    async def mark_all_user_notifications_read(
        self, organization_id: UUID, user_id: UUID
    ) -> int:
        """Mark all unread in-app notifications as read for a user.

        Returns the number of notifications marked as read.
        """
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(NotificationLog)
            .where(NotificationLog.organization_id == str(organization_id))
            .where(NotificationLog.recipient_id == str(user_id))
            .where(NotificationLog.channel == NotificationChannel.IN_APP)
            .where(NotificationLog.read.is_(False))
        )
        logs = list(result.scalars().all())
        for log in logs:
            log.read = True
            log.read_at = now
        await self.db.commit()
        return len(logs)

    async def mark_all_logs_read(
        self, organization_id: UUID, recipient_id: Optional[UUID] = None
    ) -> int:
        """Mark unread notification logs as read.

        ``recipient_id`` restricts the write to that member's own logs, which
        is what the Send Log's "Mark all as read" does — it must clear exactly
        the rows the tab showed. Omitting it keeps the org-wide sweep, gated
        on ``notifications.manage``.

        Unlike :meth:`mark_all_user_notifications_read` this covers every
        channel, not just in-app: an email row carries a ``read`` flag too and
        would otherwise stay unread behind a button that claimed to clear it.

        Returns the number of logs marked as read.
        """
        now = datetime.now(timezone.utc)
        query = (
            select(NotificationLog)
            .where(NotificationLog.organization_id == str(organization_id))
            .where(NotificationLog.read.is_(False))
        )
        if recipient_id is not None:
            query = query.where(NotificationLog.recipient_id == str(recipient_id))
        result = await self.db.execute(query)
        logs = list(result.scalars().all())
        for log in logs:
            log.read = True
            log.read_at = now
        await self.db.commit()
        return len(logs)

    async def mark_as_read(
        self,
        log_id: UUID,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Tuple[Optional[NotificationLog], Optional[str]]:
        """Mark a notification as read.

        When ``user_id`` is provided the lookup is additionally scoped to the
        owning recipient. The self-service ``/my/`` route passes it to prevent
        an IDOR where any authenticated member could mark another member's
        notification as read by guessing its log_id. The privileged
        org-management route omits it (org-wide scope).
        """
        try:
            query = (
                select(NotificationLog)
                .where(NotificationLog.id == str(log_id))
                .where(NotificationLog.organization_id == str(organization_id))
            )
            if user_id is not None:
                query = query.where(NotificationLog.recipient_id == str(user_id))
            result = await self.db.execute(query)
            log = result.scalar_one_or_none()
            if not log:
                return None, "Notification not found"

            log.read = True
            log.read_at = datetime.now(timezone.utc)

            await self.db.commit()
            await self.db.refresh(log)
            return log, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    async def toggle_pin(
        self,
        log_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        pinned: bool,
    ) -> Tuple[Optional[NotificationLog], Optional[str]]:
        """Pin or unpin a notification for the current user."""
        try:
            result = await self.db.execute(
                select(NotificationLog)
                .where(NotificationLog.id == str(log_id))
                .where(NotificationLog.organization_id == str(organization_id))
                .where(NotificationLog.recipient_id == str(user_id))
                .where(NotificationLog.channel == NotificationChannel.IN_APP)
            )
            log = result.scalar_one_or_none()
            if not log:
                return None, "Notification not found"

            log.pinned = pinned
            await self.db.commit()
            await self.db.refresh(log)
            return log, None
        except Exception as e:
            await self.db.rollback()
            return None, safe_error_detail(e)

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get notifications summary statistics"""
        # Total rules
        total_result = await self.db.execute(
            select(func.count(NotificationRule.id)).where(
                NotificationRule.organization_id == str(organization_id)
            )
        )
        total_rules = total_result.scalar() or 0

        # Active rules
        active_result = await self.db.execute(
            select(func.count(NotificationRule.id))
            .where(NotificationRule.organization_id == str(organization_id))
            .where(NotificationRule.enabled.is_(True))
        )
        active_rules = active_result.scalar() or 0

        # Emails sent this month
        first_of_month = date.today().replace(day=1)
        email_result = await self.db.execute(
            select(func.count(NotificationLog.id))
            .where(NotificationLog.organization_id == str(organization_id))
            .where(NotificationLog.channel == NotificationChannel.EMAIL)
            .where(
                NotificationLog.sent_at
                >= datetime.combine(
                    first_of_month, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        )
        emails_this_month = email_result.scalar() or 0

        # Total notifications this month
        total_notif_result = await self.db.execute(
            select(func.count(NotificationLog.id))
            .where(NotificationLog.organization_id == str(organization_id))
            .where(
                NotificationLog.sent_at
                >= datetime.combine(
                    first_of_month, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        )
        notifications_this_month = total_notif_result.scalar() or 0

        return {
            "total_rules": total_rules,
            "active_rules": active_rules,
            "emails_sent_this_month": emails_this_month,
            "notifications_sent_this_month": notifications_this_month,
        }
