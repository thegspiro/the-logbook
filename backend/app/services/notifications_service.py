"""
Notifications Service

Business logic for notification management including rules,
sending, logging, and preferences.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from uuid import UUID

from app.models.notification import (
    NotificationRule,
    NotificationLog,
    NotificationTrigger,
    NotificationCategory,
    NotificationChannel,
)
from app.models.user import User


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
                organization_id=organization_id,
                created_by=created_by,
                **rule_data
            )
            self.db.add(rule)
            await self.db.commit()
            await self.db.refresh(rule)
            return rule, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_rules(
        self,
        organization_id: UUID,
        category: Optional[str] = None,
        enabled: Optional[bool] = None,
        search: Optional[str] = None,
    ) -> List[NotificationRule]:
        """Get notification rules with optional filtering"""
        query = (
            select(NotificationRule)
            .where(NotificationRule.organization_id == organization_id)
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
            search_term = f"%{search}%"
            query = query.where(
                or_(
                    NotificationRule.name.ilike(search_term),
                    NotificationRule.description.ilike(search_term),
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
            .where(NotificationRule.id == rule_id)
            .where(NotificationRule.organization_id == organization_id)
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

            for key, value in update_data.items():
                setattr(rule, key, value)

            await self.db.commit()
            await self.db.refresh(rule)
            return rule, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

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
            return False, str(e)

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
        """Log a sent notification"""
        try:
            log = NotificationLog(
                organization_id=organization_id,
                **log_data
            )
            self.db.add(log)
            await self.db.commit()
            await self.db.refresh(log)
            return log, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_logs(
        self,
        organization_id: UUID,
        channel: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[NotificationLog], int]:
        """Get notification logs with pagination"""
        query = (
            select(NotificationLog)
            .where(NotificationLog.organization_id == organization_id)
        )

        if channel:
            try:
                channel_enum = NotificationChannel(channel)
                query = query.where(NotificationLog.channel == channel_enum)
            except ValueError:
                pass

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(NotificationLog.sent_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        logs = result.scalars().all()

        return logs, total

    async def mark_as_read(
        self, log_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[NotificationLog], Optional[str]]:
        """Mark a notification as read"""
        try:
            result = await self.db.execute(
                select(NotificationLog)
                .where(NotificationLog.id == log_id)
                .where(NotificationLog.organization_id == organization_id)
            )
            log = result.scalar_one_or_none()
            if not log:
                return None, "Notification not found"

            log.read = True
            log.read_at = datetime.now()

            await self.db.commit()
            await self.db.refresh(log)
            return log, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get notifications summary statistics"""
        # Total rules
        total_result = await self.db.execute(
            select(func.count(NotificationRule.id))
            .where(NotificationRule.organization_id == organization_id)
        )
        total_rules = total_result.scalar() or 0

        # Active rules
        active_result = await self.db.execute(
            select(func.count(NotificationRule.id))
            .where(NotificationRule.organization_id == organization_id)
            .where(NotificationRule.enabled == True)
        )
        active_rules = active_result.scalar() or 0

        # Emails sent this month
        first_of_month = date.today().replace(day=1)
        email_result = await self.db.execute(
            select(func.count(NotificationLog.id))
            .where(NotificationLog.organization_id == organization_id)
            .where(NotificationLog.channel == NotificationChannel.EMAIL)
            .where(NotificationLog.sent_at >= datetime.combine(first_of_month, datetime.min.time()))
        )
        emails_this_month = email_result.scalar() or 0

        # Total notifications this month
        total_notif_result = await self.db.execute(
            select(func.count(NotificationLog.id))
            .where(NotificationLog.organization_id == organization_id)
            .where(NotificationLog.sent_at >= datetime.combine(first_of_month, datetime.min.time()))
        )
        notifications_this_month = total_notif_result.scalar() or 0

        return {
            "total_rules": total_rules,
            "active_rules": active_rules,
            "emails_sent_this_month": emails_this_month,
            "notifications_sent_this_month": notifications_this_month,
        }
