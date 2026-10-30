"""
Property Return Reminder Service

Checks for dropped members who still have outstanding inventory items
past the 30-day and 90-day marks, and sends reminder notifications.

Runs daily as the ``property_return_reminders`` scheduled task, and on demand
through ``POST /users/property-return-reminders/process``. Each run sends a
member at most one reminder: the latest threshold they have passed, if it has
not been sent already.

The 30 and 90 days count from the drop's effective date -- the day the member
left, which an officer may have entered weeks after the fact -- not from when
the drop was recorded (``effective_separation_at``).
"""

from datetime import datetime, timezone
from decimal import Decimal
from html import escape
from typing import Any, Dict, List, Optional, Sequence
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.models.inventory import CheckOutRecord, ItemAssignment, PropertyReturnReminder
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User, UserStatus
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    effective_separation_at,
)
from app.utils.org_timezone import scheduling_timezone

# Reminder thresholds in days
REMINDER_THRESHOLDS: List[Dict[str, Any]] = [
    {"days": 30, "type": "30_day", "label": "30-Day"},
    {"days": 90, "type": "90_day", "label": "90-Day"},
]


def latest_due_threshold(days_since_drop: int) -> Optional[Dict[str, Any]]:
    """The last reminder threshold a member ``days_since_drop`` days out has
    reached, or None before the first one."""
    due = [t for t in REMINDER_THRESHOLDS if days_since_drop >= t["days"]]
    return max(due, key=lambda t: t["days"]) if due else None


def dropped_at(member: User) -> datetime:
    """When ``member`` was dropped, as an aware UTC datetime.

    Both queries that feed this select only members whose
    ``status_changed_at`` is set, so a None here means the query changed, not
    that the data is odd -- fail loudly rather than date a drop to some default.
    """
    changed_at = member.status_changed_at
    if changed_at is None:
        raise ValueError(f"Dropped member {member.id} has no status_changed_at")
    if changed_at.tzinfo is None:
        changed_at = changed_at.replace(tzinfo=timezone.utc)
    return changed_at


class PropertyReturnReminderService:
    """Finds dropped members with overdue property and sends reminders."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _effective_drops(
        self,
        organization_id: str,
        members: Sequence[User],
        org: Optional[Organization],
    ) -> Dict[str, datetime]:
        """Each dropped member's effective drop moment, keyed by member id.

        One query for every member's stints rather than one per member: the
        daily run walks the organization's whole dropped roster.
        """
        stints = await MemberServiceHistoryService(self.db).periods_by_user(
            organization_id, [str(m.id) for m in members]
        )
        tz = scheduling_timezone(org)
        return {
            str(m.id): effective_separation_at(
                dropped_at(m),
                stints.get(str(m.id), []),
                UserStatus(m.status),
                tz,
            )
            for m in members
        }

    @staticmethod
    def _to_local(dt: datetime, tz_name: str) -> datetime:
        """Convert a UTC datetime to the organization's local timezone."""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        # A malformed stored org.timezone must not abort the whole reminder run
        # (process_reminders has no surrounding guard) — fall back like the
        # scheduled runners do.
        try:
            tz = ZoneInfo(tz_name or "America/New_York")
        except Exception:
            tz = ZoneInfo("America/New_York")
        return dt.astimezone(tz)

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
        drops = await self._effective_drops(organization_id, dropped_members, org)

        for member in dropped_members:
            dropped_on = drops[str(member.id)]
            days_since_drop = (now - dropped_on).days

            # Only the latest threshold the member has passed is considered. A
            # threshold the member has already gone past is superseded, never
            # sent late: this runs daily, and a member dropped 200 days ago
            # (the backlog when the schedule was first switched on) must get
            # one 90-day reminder, not a 30-day and a 90-day on the same
            # morning. Nothing needs recording for the superseded one -- once a
            # later threshold is due, an earlier one is never looked at again.
            threshold = latest_due_threshold(days_since_drop)
            if threshold is None:
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
                dropped_on=dropped_on,
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
        drops = await self._effective_drops(organization_id, dropped_members, org)

        overdue_list = []
        # Oldest effective drop first. The query's status_changed_at order is
        # the recording order, which a back-dated drop does not follow.
        for member in sorted(dropped_members, key=lambda m: drops[str(m.id)]):
            items_info = await self._get_outstanding_items(
                str(member.id), organization_id
            )
            if items_info["count"] == 0:
                continue

            dropped_on = drops[str(member.id)]
            days_since_drop = (now - dropped_on).days

            # Check which reminders have been sent
            reminder_result = await self.db.execute(
                select(PropertyReturnReminder).where(
                    PropertyReturnReminder.user_id == str(member.id),
                    PropertyReturnReminder.organization_id == organization_id,
                )
            )
            sent_reminders = [r.reminder_type for r in reminder_result.scalars().all()]

            local_drop_date = self._to_local(dropped_on, org_tz)
            overdue_list.append(
                {
                    "user_id": str(member.id),
                    "member_name": member.display_name,
                    "email": member.email,
                    "status": member.status.value if member.status else None,
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
        # Accumulate as Decimal — this total is persisted to the Numeric
        # total_value_outstanding column and shown to the member as the value of
        # overdue property, so float accumulation drift must not reach it (the
        # FIN-7 / LIFE-1 money class). Per-item output values stay float for the
        # existing JSON shape.
        total_value = Decimal("0")

        for a in assignments:
            val = Decimal(str(a.item.current_value or a.item.purchase_price or 0))
            total_value += val
            items.append(
                {
                    "name": a.item.name,
                    "serial_number": a.item.serial_number or "-",
                    "asset_tag": a.item.asset_tag or "-",
                    "value": float(val),
                    "type": "assigned",
                }
            )

        for c in checkouts:
            val = Decimal(str(c.item.current_value or c.item.purchase_price or 0))
            total_value += val
            items.append(
                {
                    "name": c.item.name,
                    "serial_number": c.item.serial_number or "-",
                    "asset_tag": c.item.asset_tag or "-",
                    "value": float(val),
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
        dropped_on: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Generate a reminder email and record it.

        ``dropped_on`` is the effective drop moment the caller counted
        ``days_since_drop`` from; without it the recording is used.
        """
        from app.services.email_template_service import (
            build_items_list_html,
            build_items_list_text,
        )

        reminder_label = threshold["label"]
        reminder_type = threshold["type"]

        local_drop_date = self._to_local(dropped_on or dropped_at(member), org_tz)
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
            "member_name": member.display_name,
            "organization_name": org_name,
            "item_count": str(items_info["count"]),
            "total_value": f"{total_val:,.2f}",
            "items_list_html": items_html,
            "items_list_text": items_text,
            "days_since_drop": str(days_since_drop),
            "return_deadline": return_deadline_display,
        }

        subject: Optional[str] = None
        html_body: Optional[str] = None
        text_body: Optional[str] = None

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

        # Fall back to the shipped default, rendered the same way a stored
        # template is — which also escapes the member's name, as the
        # template path always did.
        if not subject or html_body is None:
            from app.models.email_template import EmailTemplateType
            from app.services.email_template_service import EmailTemplateService

            subject, html_body, text_body = EmailTemplateService.render_default(
                EmailTemplateType.PROPERTY_RETURN_REMINDER, context, organization=org
            )

        # Send email to member, unless the department switched the template
        # off. The quartermaster's summary below still goes out and says the
        # member was not emailed, and the reminder is still recorded so the
        # next run does not try again.
        member_sent = False
        member_email_off = await EmailTemplateService(self.db).is_switched_off(
            organization_id, EmailTemplateType.PROPERTY_RETURN_REMINDER
        )
        if member.email and not member_email_off:
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
            f"{reminder_label} Overdue Property: {member.display_name} — "
            f"{items_info['count']} items (${items_info['total_value']:,.2f})"
        )
        admin_html = (
            f"<p><strong>{reminder_label} property return reminder</strong> was sent to "
            f"<strong>{escape(member.display_name)}</strong> ({escape(member.email or 'no email')}).</p>"
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
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
        )
        admins = admin_result.scalars().all()
        notified = [
            u
            for u in admins
            if any(r.slug in ADMIN_NOTIFY_ROLE_SLUGS for r in (u.roles or []))
        ]
        admin_emails = [
            u.email
            for u in notified
            if u.email
            and member_receives_email(
                u.notification_preferences,
                EmailKind.MEMBERSHIP_ADMIN,
                department_required_kinds(org),
            )
        ]

        # A bell entry for every officer above, emailed or not; committed with
        # the reminder record below, which is also what stops a rerun.
        from app.services.officer_alert_copies import add_in_app_copies

        await add_in_app_copies(
            self.db,
            organization_id=str(organization_id),
            recipient_ids=[str(u.id) for u in notified],
            category="property_return",
            subject=admin_subject[:500],
            message=(
                f"{reminder_label} property return reminder for "
                f"{member.display_name}: {items_info['count']} item(s) "
                f"outstanding (${items_info['total_value']:,.2f})."
            ),
            action_url=f"/members/{member.id}",
            metadata={"user_id": str(member.id), "reminder_type": reminder_type},
        )

        if admin_emails:
            try:
                from app.services.email_service import EmailService

                email_svc = EmailService(org)
                success, _ = await email_svc.send_email(
                    to_emails=admin_emails,
                    subject=admin_subject,
                    html_body=admin_html,
                    text_body=f"{reminder_label} overdue property: {member.display_name} - {items_info['count']} items (${items_info['total_value']:,.2f})",
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
            "member_name": member.display_name,
            "reminder_type": reminder_type,
            "days_since_drop": days_since_drop,
            "items_outstanding": items_info["count"],
            "total_value": float(items_info["total_value"]),
            "member_email_sent": member_sent,
            "admin_email_sent": admin_sent,
        }
        logger.info(f"Sent {reminder_type} property return reminder: {result}")
        return result
