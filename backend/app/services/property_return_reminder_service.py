"""
Property Return Reminder Service

Checks for dropped members who still have outstanding inventory items
past the 30-day and 90-day marks, and sends reminder notifications.

Designed to be called periodically (e.g., daily via cron, scheduler, or
manual API call).
"""

import logging
from datetime import datetime, timezone
from html import escape
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.models.inventory import CheckOutRecord, ItemAssignment, PropertyReturnReminder
from app.models.user import Organization, User, UserStatus

logger = logging.getLogger(__name__)

# Reminder thresholds in days
REMINDER_THRESHOLDS = [
    {"days": 30, "type": "30_day", "label": "30-Day"},
    {"days": 90, "type": "90_day", "label": "90-Day"},
]


class PropertyReturnReminderService:
    """Finds dropped members with overdue property and sends reminders."""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _to_local(dt: datetime, tz_name: str) -> datetime:
        """Convert a UTC datetime to the organization's local timezone."""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo(tz_name))

    async def process_reminders(
        self,
        organization_id: str,
    ) -> Dict[str, Any]:
        """
        Scan all dropped members in the organization and send any
        due reminders that haven't been sent yet.

        Returns a summary of what was processed.
        """
        now = datetime.now(timezone.utc)
        results: List[Dict[str, Any]] = []

        # Find all dropped members with a recorded drop date
        dropped_result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status.in_(
                    [UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY]
                ),
                User.status_changed_at.isnot(None),
                User.deleted_at.is_(None),
            )
        )
        dropped_members = dropped_result.scalars().all()

        # Load organization for email and timezone
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        org_name = org.name if org else "Department"
        org_tz = org.timezone if org and org.timezone else "America/New_York"

        for member in dropped_members:
            status_changed_utc = member.status_changed_at
            if status_changed_utc.tzinfo is None:
                status_changed_utc = status_changed_utc.replace(tzinfo=timezone.utc)
            days_since_drop = (now - status_changed_utc).days

            # Check each threshold
            for threshold in REMINDER_THRESHOLDS:
                if days_since_drop < threshold["days"]:
                    continue

                # Check if this reminder was already sent
                existing = await self.db.execute(
                    select(PropertyReturnReminder).where(
                        PropertyReturnReminder.user_id == str(member.id),
                        PropertyReturnReminder.organization_id == organization_id,
                        PropertyReturnReminder.reminder_type == threshold["type"],
                    )
                )
                if existing.scalar_one_or_none():
                    continue  # Already sent

                # Check if member still has outstanding items
                items_info = await self._get_outstanding_items(
                    str(member.id), organization_id
                )
                if items_info["count"] == 0:
                    continue  # Nothing to remind about

                # Generate and send the reminder
                reminder_result = await self._send_reminder(
                    member=member,
                    org=org,
                    org_name=org_name,
                    org_tz=org_tz,
                    organization_id=organization_id,
                    threshold=threshold,
                    days_since_drop=days_since_drop,
                    items_info=items_info,
                )
                results.append(reminder_result)

        return {
            "organization_id": organization_id,
            "processed_at": now.isoformat(),
            "dropped_members_checked": len(dropped_members),
            "reminders_sent": len(results),
            "details": results,
        }

    async def get_overdue_returns(
        self,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Get a list of all dropped members who still have outstanding
        inventory items, with days-since-drop and item details.
        """
        now = datetime.now(timezone.utc)

        # Load organization for timezone
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        org_tz = org.timezone if org and org.timezone else "America/New_York"

        dropped_result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == organization_id,
                User.status.in_(
                    [UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY]
                ),
                User.status_changed_at.isnot(None),
                User.deleted_at.is_(None),
            )
            .order_by(User.status_changed_at.asc())
        )
        dropped_members = dropped_result.scalars().all()

        overdue_list = []
        for member in dropped_members:
            items_info = await self._get_outstanding_items(
                str(member.id), organization_id
            )
            if items_info["count"] == 0:
                continue

            status_changed_utc = member.status_changed_at
            if status_changed_utc.tzinfo is None:
                status_changed_utc = status_changed_utc.replace(tzinfo=timezone.utc)
            days_since_drop = (now - status_changed_utc).days

            # Check which reminders have been sent
            reminder_result = await self.db.execute(
                select(PropertyReturnReminder).where(
                    PropertyReturnReminder.user_id == str(member.id),
                    PropertyReturnReminder.organization_id == organization_id,
                )
            )
            sent_reminders = [r.reminder_type for r in reminder_result.scalars().all()]

            local_drop_date = self._to_local(member.status_changed_at, org_tz)
            overdue_list.append(
                {
                    "user_id": str(member.id),
                    "member_name": member.full_name,
                    "email": member.email,
                    "status": member.status.value,
                    "dropped_date": local_drop_date.strftime("%Y-%m-%d"),
                    "days_since_drop": days_since_drop,
                    "items_outstanding": items_info["count"],
                    "total_value": float(items_info["total_value"]),
                    "items": items_info["items"],
                    "reminders_sent": sent_reminders,
                }
            )

        return overdue_list

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _get_outstanding_items(
        self,
        user_id: str,
        organization_id: str,
    ) -> Dict[str, Any]:
        """Get count and value of items still assigned/checked out to a member."""
        # Active assignments
        assign_result = await self.db.execute(
            select(ItemAssignment)
            .where(
                ItemAssignment.organization_id == organization_id,
                ItemAssignment.user_id == user_id,
                ItemAssignment.is_active == True,  # noqa: E712
            )
            .options(selectinload(ItemAssignment.item))
        )
        assignments = assign_result.scalars().all()

        # Active checkouts
        checkout_result = await self.db.execute(
            select(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == organization_id,
                CheckOutRecord.user_id == user_id,
                CheckOutRecord.is_returned == False,  # noqa: E712
            )
            .options(selectinload(CheckOutRecord.item))
        )
        checkouts = checkout_result.scalars().all()

        items = []
        total_value = 0.0

        for a in assignments:
            val = float(a.item.current_value or a.item.purchase_price or 0)
            total_value += val
            items.append(
                {
                    "name": a.item.name,
                    "serial_number": a.item.serial_number or "-",
                    "asset_tag": a.item.asset_tag or "-",
                    "value": val,
                    "type": "assigned",
                }
            )

        for c in checkouts:
            val = float(c.item.current_value or c.item.purchase_price or 0)
            total_value += val
            items.append(
                {
                    "name": c.item.name,
                    "serial_number": c.item.serial_number or "-",
                    "asset_tag": c.item.asset_tag or "-",
                    "value": val,
                    "type": "checked_out",
                }
            )

        return {"count": len(items), "total_value": total_value, "items": items}

    async def _send_reminder(
        self,
        member: User,
        org: Optional[Organization],
        org_name: str,
        org_tz: str,
        organization_id: str,
        threshold: Dict[str, Any],
        days_since_drop: int,
        items_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Generate a reminder email and record it."""
        from app.services.email_template_service import (
            build_items_list_html,
            build_items_list_text,
        )

        reminder_label = threshold["label"]
        reminder_type = threshold["type"]

        local_drop_date = self._to_local(member.status_changed_at, org_tz)
        drop_date_display = local_drop_date.strftime("%B %d, %Y")
        drop_type_display = (
            member.status.value.replace("_", " ").title()
            if member.status
            else "Dropped"
        )

        items = items_info.get("items", [])
        total_val = items_info.get("total_value", 0.0)
        items_html = build_items_list_html(items, total_val)
        items_text = build_items_list_text(items, total_val)

        # Compute a rough return deadline (30 days from drop date by default)
        from datetime import timedelta

        return_deadline = local_drop_date + timedelta(days=30)
        return_deadline_display = return_deadline.strftime("%B %d, %Y")

        context = {
            "member_name": member.full_name,
            "organization_name": org_name,
            "item_count": str(items_info["count"]),
            "total_value": f"{total_val:,.2f}",
            "items_list_html": items_html,
            "items_list_text": items_text,
            "days_since_drop": str(days_since_drop),
            "return_deadline": return_deadline_display,
        }

        subject = None
        html_body = None
        text_body = None

        # Try loading the admin-configured template
        try:
            from app.models.email_template import EmailTemplateType
            from app.services.email_template_service import EmailTemplateService

            tmpl_svc = EmailTemplateService(self.db)
            template = await tmpl_svc.get_template(
                organization_id, EmailTemplateType.PROPERTY_RETURN_REMINDER
            )
            if template:
                subject, html_body, text_body = tmpl_svc.render(
                    template, context, organization=org
                )
        except Exception as tmpl_err:
            logger.warning(
                f"Failed to load property_return_reminder template, using default: {tmpl_err}"
            )

        # Fall back to inline default
        if not subject:
            import re

            from app.services.email_template_service import (
                DEFAULT_CSS,
                DEFAULT_PROPERTY_RETURN_REMINDER_HTML,
                DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT,
                DEFAULT_PROPERTY_RETURN_REMINDER_TEXT,
            )

            import html as _html_mod

            org_logo = getattr(org, "logo", None) or "" if org else ""
            if org_logo:
                context["organization_logo_img"] = (
                    f'<img src="{_html_mod.escape(str(org_logo))}" alt="Logo" '
                    f'style="max-height:80px;max-width:200px;" />'
                )
            else:
                context["organization_logo_img"] = ""

            subject = DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT
            rendered_html = DEFAULT_PROPERTY_RETURN_REMINDER_HTML
            rendered_text = DEFAULT_PROPERTY_RETURN_REMINDER_TEXT
            for key, val in context.items():
                pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                subject = re.sub(pattern, str(val), subject)
                rendered_html = re.sub(pattern, str(val), rendered_html)
                rendered_text = re.sub(pattern, str(val), rendered_text)
            html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
            text_body = rendered_text

        # Send email to member
        member_sent = False
        if member.email:
            try:
                from app.services.email_service import EmailService

                email_svc = EmailService(org)
                success, _ = await email_svc.send_email(
                    to_emails=[member.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                )
                member_sent = success > 0
            except Exception as e:
                logger.error(
                    f"Failed to send {reminder_type} reminder to {member.email}: {e}"
                )

        # Send summary to admin/quartermaster
        admin_sent = False
        admin_subject = (
            f"{reminder_label} Overdue Property: {member.full_name} — "
            f"{items_info['count']} items (${items_info['total_value']:,.2f})"
        )
        admin_html = (
            f"<p><strong>{reminder_label} property return reminder</strong> was sent to "
            f"<strong>{escape(member.full_name)}</strong> ({escape(member.email or 'no email')}).</p>"
            f"<p>Separation: {escape(drop_date_display)} ({escape(drop_type_display)})<br/>"
            f"Days Since Drop: {days_since_drop}<br/>"
            f"Items Outstanding: {items_info['count']}<br/>"
            f"Total Value: ${items_info['total_value']:,.2f}</p>"
            f"<p>Member email sent: {'Yes' if member_sent else 'No'}</p>"
        )
        # Find admin users to notify
        admin_result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
        )
        admins = admin_result.scalars().all()
        admin_emails = []
        for u in admins:
            role_slugs = [r.slug for r in (u.roles or [])]
            if any(r in role_slugs for r in ADMIN_NOTIFY_ROLE_SLUGS):
                if u.email:
                    admin_emails.append(u.email)

        if admin_emails:
            try:
                from app.services.email_service import EmailService

                email_svc = EmailService(org)
                success, _ = await email_svc.send_email(
                    to_emails=admin_emails,
                    subject=admin_subject,
                    html_body=admin_html,
                    text_body=f"{reminder_label} overdue property: {member.full_name} - {items_info['count']} items (${items_info['total_value']:,.2f})",
                )
                admin_sent = success > 0
            except Exception as e:
                logger.error(f"Failed to send {reminder_type} admin notification: {e}")

        # Record the reminder
        from app.core.utils import generate_uuid

        reminder = PropertyReturnReminder(
            id=generate_uuid(),
            organization_id=organization_id,
            user_id=str(member.id),
            reminder_type=reminder_type,
            items_outstanding=items_info["count"],
            total_value_outstanding=items_info["total_value"],
            sent_to_member=member_sent,
            sent_to_admin=admin_sent,
        )
        self.db.add(reminder)
        await self.db.commit()

        result = {
            "user_id": str(member.id),
            "member_name": member.full_name,
            "reminder_type": reminder_type,
            "days_since_drop": days_since_drop,
            "items_outstanding": items_info["count"],
            "total_value": float(items_info["total_value"]),
            "member_email_sent": member_sent,
            "admin_email_sent": admin_sent,
        }
        logger.info(f"Sent {reminder_type} property return reminder: {result}")
        return result
