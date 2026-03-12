"""
Scheduled Tasks / Cron Configuration

Defines recurring tasks that should be triggered by an external scheduler
(e.g. cron, Celery Beat, APScheduler, or a simple crontab on the host).

Each task is exposed as an async function that can be called from a
management command or API endpoint. The recommended cron schedule is
documented in the SCHEDULE dict below.

Recommended crontab (add to host or container cron):
-----------------------------------------------------
# Daily at 6:00 AM — certification expiration alerts
0 6 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=cert_expiration_alerts

# Weekly on Mondays at 7:00 AM — struggling member detection
0 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=struggling_member_check

# Weekly on Mondays at 7:30 AM — enrollment deadline warnings
30 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=enrollment_deadline_warnings

# Monthly on the 1st at 8:00 AM — membership tier auto-advancement
0 8 1 * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=membership_tier_advance

# Every 15 minutes — process delayed inventory change notifications
*/15 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=inventory_notifications

# Every 30 minutes — send event reminders
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=event_reminders

# Every 30 minutes — post-event validation notifications
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=post_event_validation

# Every 30 minutes — post-shift validation notifications
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=post_shift_validation

# Weekly on Sundays at 2:00 AM — audit log archival and integrity checkpoint
0 2 * * 0 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=audit_log_archival

# Daily at 7:00 AM — inventory low stock alerts
0 7 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=inventory_low_stock_alerts

# Daily at 7:30 AM — overdue equipment checkout reminders
30 7 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=inventory_overdue_alerts

# Weekly on Mondays at 8:00 AM — NFPA PPE retirement alerts
0 8 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=nfpa_retirement_alerts
-----------------------------------------------------
"""

import html as _html
from datetime import datetime
from typing import Any, Dict

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User

# Schedule definitions (for documentation and frontend display)
SCHEDULE = {
    "cert_expiration_alerts": {
        "description": "Send tiered certification expiration alerts (90/60/30/7-day + expired escalation)",
        "frequency": "daily",
        "recommended_time": "06:00",
        "cron": "0 6 * * *",
    },
    "struggling_member_check": {
        "description": "Detect members falling behind on training programs and send notifications",
        "frequency": "weekly",
        "recommended_time": "Monday 07:00",
        "cron": "0 7 * * 1",
    },
    "enrollment_deadline_warnings": {
        "description": "Warn members approaching enrollment completion deadlines",
        "frequency": "weekly",
        "recommended_time": "Monday 07:30",
        "cron": "30 7 * * 1",
    },
    "membership_tier_advance": {
        "description": "Auto-advance members to higher membership tiers based on years of service",
        "frequency": "monthly",
        "recommended_time": "1st of month 08:00",
        "cron": "0 8 1 * *",
    },
    "action_item_reminders": {
        "description": "Send reminders for action items due within 3 days, 1 day, or overdue (from meetings and minutes)",
        "frequency": "daily",
        "recommended_time": "07:00",
        "cron": "0 7 * * *",
    },
    "inventory_notifications": {
        "description": "Process delayed inventory change notifications — consolidate and send one email per member for changes older than 1 hour",
        "frequency": "every 15 minutes",
        "recommended_time": "*/15 * * * *",
        "cron": "*/15 * * * *",
    },
    "event_reminders": {
        "description": "Send email and in-app reminders for upcoming events based on each event's reminder_schedule setting",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
    "post_event_validation": {
        "description": "Notify event organizers to validate attendance and timing after their event ends",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
    "post_shift_validation": {
        "description": "Notify shift officers to validate attendance and timing after their shift ends",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
    "audit_log_archival": {
        "description": "Archive old audit logs: create integrity checkpoint, verify chain, and export summary. Logs older than 90 days are checkpointed for long-term HIPAA compliance retention.",
        "frequency": "weekly",
        "recommended_time": "Sunday 02:00",
        "cron": "0 2 * * 0",
    },
    "scheduled_emails": {
        "description": "Process pending scheduled emails that are due to be sent",
        "frequency": "every 5 minutes",
        "recommended_time": "*/5 * * * *",
        "cron": "*/5 * * * *",
    },
    "inventory_low_stock_alerts": {
        "description": "Send email alerts to admins when inventory items fall below their reorder point",
        "frequency": "daily",
        "recommended_time": "07:00",
        "cron": "0 7 * * *",
    },
    "inventory_overdue_alerts": {
        "description": "Send email reminders to members and admins about overdue equipment checkouts",
        "frequency": "daily",
        "recommended_time": "07:30",
        "cron": "30 7 * * *",
    },
    "nfpa_retirement_alerts": {
        "description": "Send weekly alerts for PPE approaching NFPA 1851 10-year retirement date (180/90/30-day tiers)",
        "frequency": "weekly",
        "recommended_time": "Monday 08:00",
        "cron": "0 8 * * 1",
    },
}


async def run_cert_expiration_alerts(db: AsyncSession) -> Dict[str, Any]:
    """Run certification expiration alerts for all organizations."""
    from app.services.cert_alert_service import CertAlertService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_sent = 0
    results = []

    for org in organizations:
        try:
            service = CertAlertService(db)
            result = await service.process_alerts(org.id)
            sent = result.get("alerts_sent", 0)
            total_sent += sent
            results.append({"org_id": str(org.id), "alerts_sent": sent})
        except Exception as e:
            logger.error(f"Cert alert failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(
        f"Cert expiration alerts complete: {total_sent} alerts sent across {len(organizations)} orgs"
    )
    return {
        "task": "cert_expiration_alerts",
        "total_alerts_sent": total_sent,
        "organizations": results,
    }


async def run_struggling_member_check(db: AsyncSession) -> Dict[str, Any]:
    """Detect members falling behind and send notifications."""
    from app.services.struggling_member_service import StrugglingMemberService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_flagged = 0
    results = []

    for org in organizations:
        try:
            service = StrugglingMemberService(db)
            result = await service.detect_and_notify(str(org.id))
            flagged = result.get("members_flagged", 0)
            total_flagged += flagged
            results.append({"org_id": str(org.id), "members_flagged": flagged})
        except Exception as e:
            logger.error(f"Struggling member check failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Struggling member check complete: {total_flagged} members flagged")
    return {
        "task": "struggling_member_check",
        "total_flagged": total_flagged,
        "organizations": results,
    }


async def run_enrollment_deadline_warnings(db: AsyncSession) -> Dict[str, Any]:
    """Send deadline warnings for approaching enrollment deadlines."""
    from app.services.struggling_member_service import StrugglingMemberService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_warned = 0
    results = []

    for org in organizations:
        try:
            service = StrugglingMemberService(db)
            result = await service.send_deadline_warnings(str(org.id))
            warned = result.get("warnings_sent", 0)
            total_warned += warned
            results.append({"org_id": str(org.id), "warnings_sent": warned})
        except Exception as e:
            logger.error(f"Enrollment deadline warnings failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    return {
        "task": "enrollment_deadline_warnings",
        "total_warned": total_warned,
        "organizations": results,
    }


async def run_membership_tier_advance(db: AsyncSession) -> Dict[str, Any]:
    """Auto-advance all eligible members to higher tiers."""
    from app.services.membership_tier_service import MembershipTierService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_advanced = 0
    results = []

    for org in organizations:
        try:
            service = MembershipTierService(db)
            result = await service.advance_all(
                organization_id=str(org.id),
                performed_by="system",
            )
            advanced = result.get("advanced", 0)
            total_advanced += advanced
            results.append({"org_id": str(org.id), "advanced": advanced})
        except Exception as e:
            logger.error(f"Tier advance failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Membership tier advance complete: {total_advanced} members advanced")
    return {
        "task": "membership_tier_advance",
        "total_advanced": total_advanced,
        "organizations": results,
    }


async def run_action_item_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send reminders for action items approaching or past their due dates.
    Checks both meeting_action_items and minutes_action_items tables.
    Sends notifications at 3 days before, 1 day before, and on overdue.
    """
    from datetime import date, timedelta

    from app.models.meeting import ActionItemStatus, MeetingActionItem
    from app.models.minute import ActionItem as MinutesActionItem
    from app.models.minute import MinutesActionItemStatus

    today = date.today()
    three_days = today + timedelta(days=3)
    total_reminders = 0

    # ── Meeting action items ──
    meeting_items = await db.execute(
        select(MeetingActionItem).where(
            MeetingActionItem.status.in_(
                [ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]
            ),
            MeetingActionItem.due_date.isnot(None),
            MeetingActionItem.due_date <= three_days,
        )
    )
    for item in meeting_items.scalars().all():
        if item.assigned_to:
            days_until = (item.due_date - today).days if item.due_date else None
            if days_until is not None and days_until in (3, 1, 0, -1):
                # Log notification for the assignee
                try:
                    from app.core.utils import generate_uuid
                    from app.models.notification import NotificationLog

                    urgency = (
                        "overdue" if days_until < 0 else f"due in {days_until} day(s)"
                    )
                    log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=item.organization_id,
                        user_id=item.assigned_to,
                        channel="in_app",
                        category="action_items",
                        subject=f"Action item {urgency}: {item.description[:80]}",
                        body=f"Your action item is {urgency}. Description: {item.description}",
                    )
                    db.add(log)
                    total_reminders += 1
                except Exception as e:
                    logger.error(f"Failed to create action item notification: {e}")

    # ── Minutes action items ──
    minutes_items = await db.execute(
        select(MinutesActionItem).where(
            MinutesActionItem.status.in_(
                [
                    MinutesActionItemStatus.PENDING.value,
                    MinutesActionItemStatus.IN_PROGRESS.value,
                ]
            ),
            MinutesActionItem.due_date.isnot(None),
            MinutesActionItem.due_date
            <= datetime.combine(three_days, datetime.min.time()),
        )
    )
    for item in minutes_items.scalars().all():
        if item.assignee_id:
            due_d = (
                item.due_date.date()
                if hasattr(item.due_date, "date")
                else item.due_date
            )
            days_until = (due_d - today).days if due_d else None
            if days_until is not None and days_until in (3, 1, 0, -1):
                try:
                    from app.core.utils import generate_uuid
                    from app.models.notification import NotificationLog

                    urgency = (
                        "overdue" if days_until < 0 else f"due in {days_until} day(s)"
                    )
                    log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=(
                            item.minutes.organization_id if item.minutes else None
                        ),
                        user_id=item.assignee_id,
                        channel="in_app",
                        category="action_items",
                        subject=f"Action item {urgency}: {item.description[:80]}",
                        body=f"Your action item is {urgency}. Description: {item.description}",
                    )
                    db.add(log)
                    total_reminders += 1
                except Exception as e:
                    logger.error(
                        f"Failed to create minutes action item notification: {e}"
                    )

    await db.commit()
    logger.info(f"Action item reminders complete: {total_reminders} notifications sent")
    return {"task": "action_item_reminders", "total_reminders": total_reminders}


async def run_inventory_notifications(db: AsyncSession) -> Dict[str, Any]:
    """
    Process delayed inventory change notifications.

    Finds queue records older than 1 hour, groups by member,
    nets out offsetting actions, and sends consolidated emails.
    """
    from app.services.inventory_notification_service import InventoryNotificationService

    try:
        service = InventoryNotificationService(db)
        result = await service.process_pending_notifications(delay_minutes=60)
        return result
    except Exception as e:
        logger.error(f"Inventory notification processing failed: {e}")
        return {"task": "inventory_notifications", "error": str(e)}


async def run_event_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send event reminders for upcoming events.

    Each event has a reminder_schedule (e.g. [168, 24] = 1 week + 1 day before).
    For each scheduled interval, if the current time has passed the threshold
    and we haven't already sent that interval's reminder, we send it.

    Reminder timing:
    - For intervals >= 24 hours (day-level): the reminder fires at the org's
      default_reminder_time (e.g. noon) on the appropriate day. This is set
      in the org's event module settings.
    - For intervals < 24 hours: the reminder fires at exactly X hours before
      the event start.

    Notifications always create an in-app entry. Email is only sent if the
    user has not opted out (email_notifications preference). In-app
    notifications expire 24 hours after the event ends but remain in history.

    Tracks which intervals have been sent in custom_fields.reminders_sent.
    """
    from datetime import time as dt_time
    from datetime import timedelta
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    from sqlalchemy.orm import selectinload

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.event import Event, RSVPStatus
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.user import User
    from app.services.email_service import EmailService

    now = datetime.now(dt_timezone.utc)
    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_reminders = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_reminders = 0
        org_emails = 0

        try:
            # Load org event settings to get default_reminder_time
            org_settings = (org.settings or {}).get("events", {}).get("defaults", {})
            default_reminder_time_str = org_settings.get(
                "default_reminder_time", "12:00"
            )
            try:
                parts = default_reminder_time_str.split(":")
                default_reminder_time = dt_time(int(parts[0]), int(parts[1]))
            except (ValueError, IndexError):
                default_reminder_time = dt_time(12, 0)

            # Org timezone for day-level reminders
            org_tz_name = org.timezone or "America/New_York"
            try:
                org_tz = ZoneInfo(org_tz_name)
            except Exception:
                org_tz = ZoneInfo("America/New_York")

            # Look ahead up to 168 hours (max reminder window)
            max_lookahead = now + timedelta(hours=168)

            events_result = await db.execute(
                select(Event)
                .options(
                    selectinload(Event.rsvps),
                    selectinload(Event.location_obj),
                )
                .where(Event.organization_id == str(org.id))
                .where(Event.send_reminders == True)  # noqa: E712
                .where(Event.is_cancelled == False)  # noqa: E712
                .where(Event.start_datetime > now)
                .where(Event.start_datetime <= max_lookahead)
            )
            events = list(events_result.scalars().all())

            for event in events:
                schedule = event.reminder_schedule or [24]
                custom = event.custom_fields or {}
                already_sent = set(custom.get("reminders_sent", []))

                # Find which intervals are due now but not yet sent
                due_intervals = []
                for hours in schedule:
                    if hours in already_sent:
                        continue

                    if hours >= 24:
                        # Day-level reminder: fire at default_reminder_time on the
                        # appropriate day in the org's timezone.
                        days_before = hours // 24
                        event_local = event.start_datetime.astimezone(org_tz)
                        reminder_date = (
                            event_local - timedelta(days=days_before)
                        ).date()
                        reminder_local = datetime.combine(
                            reminder_date, default_reminder_time, tzinfo=org_tz
                        )
                        threshold = reminder_local.astimezone(dt_timezone.utc)
                    else:
                        # Sub-day reminder: fire at exactly X hours before
                        start_dt = event.start_datetime
                        if start_dt and start_dt.tzinfo is None:
                            start_dt = start_dt.replace(tzinfo=dt_timezone.utc)
                        threshold = start_dt - timedelta(hours=hours)

                    if now >= threshold:
                        due_intervals.append(hours)

                if not due_intervals:
                    continue

                # Determine recipients once for all due intervals
                recipients = []
                if event.is_mandatory:
                    users_result = await db.execute(
                        select(User)
                        .where(User.organization_id == str(org.id))
                        .where(User.is_active == True)  # noqa: E712
                    )
                    recipients = list(users_result.scalars().all())
                else:
                    going_user_ids = [
                        str(rsvp.user_id)
                        for rsvp in event.rsvps
                        if rsvp.status in (RSVPStatus.GOING, RSVPStatus.MAYBE)
                    ]
                    if going_user_ids:
                        users_result = await db.execute(
                            select(User).where(User.id.in_(going_user_ids))
                        )
                        recipients = list(users_result.scalars().all())

                if not recipients:
                    # Mark all due intervals as sent to avoid re-processing
                    event.custom_fields = {
                        **custom,
                        "reminders_sent": sorted(already_sent | set(due_intervals)),
                    }
                    continue

                # Build shared event info
                location_name = None
                if event.location_obj:
                    location_name = event.location_obj.name
                elif event.location:
                    location_name = event.location

                event_type_label = (
                    event.event_type.value.replace("_", " ").title()
                    if event.event_type
                    else "Event"
                )
                event_url = f"{settings.FRONTEND_URL}/events/{event.id}"
                email_service = EmailService(organization=org)

                # Notifications expire 24 hours after the event ends
                expires_at = event.end_datetime + timedelta(hours=24)

                # Send one notification per due interval
                for hours in due_intervals:
                    for user in recipients:
                        prefs = user.notification_preferences or {}
                        user_name = f"{user.first_name} {user.last_name}"

                        # In-app notification — always created regardless of
                        # email preference so users who opt out of email still
                        # see reminders in the notification inbox.
                        try:
                            in_app_log = NotificationLog(
                                id=generate_uuid(),
                                organization_id=str(org.id),
                                recipient_id=str(user.id),
                                channel=NotificationChannel.IN_APP,
                                category="event_reminder",
                                subject=f"Reminder: {event.title}",
                                message=(
                                    f'Your event "{event.title}" starts '
                                    f"{_format_relative_time(event.start_datetime, now)}."
                                ),
                                expires_at=expires_at,
                            )
                            db.add(in_app_log)
                            org_reminders += 1
                        except Exception as e:
                            logger.error(
                                f"Failed to create in-app reminder for user {user.id}: {e}"
                            )

                        # Email notification — only if user hasn't opted out
                        wants_email = prefs.get("email_notifications", True)
                        wants_reminders = prefs.get("event_reminders", True)
                        if wants_reminders and wants_email and user.email:
                            try:
                                sent = await email_service.send_event_reminder(
                                    to_email=user.email,
                                    recipient_name=user_name,
                                    event_title=event.title,
                                    event_start=event.start_datetime,
                                    event_end=event.end_datetime,
                                    event_type=event_type_label,
                                    location_name=location_name,
                                    location_details=event.location_details,
                                    event_url=event_url,
                                    db=db,
                                    organization_id=str(org.id),
                                )
                                if sent:
                                    org_emails += 1
                            except Exception as e:
                                logger.error(
                                    f"Failed to send reminder email to {user.email}: {e}"
                                )

                # Mark all due intervals as sent
                event.custom_fields = {
                    **custom,
                    "reminders_sent": sorted(already_sent | set(due_intervals)),
                }

            await db.commit()

        except Exception as e:
            logger.error(f"Event reminders failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})
            continue

        total_reminders += org_reminders
        total_emails += org_emails
        if org_reminders > 0 or org_emails > 0:
            results.append(
                {
                    "org_id": str(org.id),
                    "in_app_reminders": org_reminders,
                    "emails_sent": org_emails,
                }
            )

    logger.info(
        f"Event reminders complete: {total_reminders} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "event_reminders",
        "total_in_app_reminders": total_reminders,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


async def run_post_event_validation(db: AsyncSession) -> Dict[str, Any]:
    """
    Send a notification to event organizers after their event ends,
    asking them to validate attendance records and event timing.

    Runs every 30 minutes. Looks for events that ended within the last
    2 hours and haven't already had a validation notification sent.
    Sends an in-app notification (and optionally email) to the event
    creator with a link to the event detail page.

    Tracks sent status in custom_fields.validation_notification_sent.
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone

    from sqlalchemy.orm import selectinload

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.event import Event
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.user import User
    from app.services.email_service import EmailService, build_email_logo_html

    now = datetime.now(dt_timezone.utc)
    # Look back 2 hours for recently ended events
    lookback = now - timedelta(hours=2)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_notifications = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_notifications = 0
        org_emails = 0

        try:
            events_result = await db.execute(
                select(Event)
                .options(selectinload(Event.rsvps))
                .where(Event.organization_id == str(org.id))
                .where(Event.is_cancelled == False)  # noqa: E712
                .where(Event.end_datetime <= now)
                .where(Event.end_datetime >= lookback)
                .where(Event.created_by.isnot(None))
            )
            events = list(events_result.scalars().all())

            for event in events:
                custom = event.custom_fields or {}
                if custom.get("validation_notification_sent"):
                    continue

                # Find the event creator
                creator_result = await db.execute(
                    select(User).where(
                        User.id == event.created_by,
                        User.is_active == True,  # noqa: E712
                    )
                )
                creator = creator_result.scalar_one_or_none()
                if not creator:
                    # Mark as sent to avoid retrying for deleted/inactive users
                    event.custom_fields = {
                        **custom,
                        "validation_notification_sent": True,
                    }
                    continue

                event_url = f"/events/{event.id}"
                rsvp_count = len(event.rsvps) if event.rsvps else 0
                checked_in_count = sum(1 for r in (event.rsvps or []) if r.checked_in)

                subject = f"Action Required: Validate attendance for {event.title}"
                message = (
                    f'Your event "{event.title}" has ended. '
                    f"{checked_in_count} of {rsvp_count} attendees checked in. "
                    f"Please review and confirm the attendance records and "
                    f"event timing before finalizing."
                )

                # In-app notification
                try:
                    in_app_log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(org.id),
                        recipient_id=str(creator.id),
                        channel=NotificationChannel.IN_APP,
                        category="event_validation",
                        subject=subject,
                        message=message,
                        action_url=event_url,
                    )
                    db.add(in_app_log)
                    org_notifications += 1
                except Exception as e:
                    logger.error(
                        f"Failed to create post-event validation notification "
                        f"for user {creator.id}, event {event.id}: {e}"
                    )

                # Email notification (if user has email prefs enabled)
                prefs = creator.notification_preferences or {}
                wants_email = prefs.get("email_notifications", True)
                if wants_email and creator.email:
                    try:
                        full_event_url = f"{settings.FRONTEND_URL}/events/{event.id}"
                        e_first = _html.escape(creator.first_name or "")
                        e_title = _html.escape(event.title or "")
                        _logo = build_email_logo_html(org)
                        email_service = EmailService(organization=org)
                        sent_count, _ = await email_service.send_email(
                            to_emails=[creator.email],
                            subject=subject,
                            html_body=(
                                f'<div style="font-family:Arial,sans-serif;max-width:600px;">'
                                f"{_logo}"
                                f"<p>Hi {e_first},</p>"
                                f'<p>Your event "<strong>{e_title}</strong>" has ended. '
                                f"{checked_in_count} of {rsvp_count} attendees checked in.</p>"
                                f"<p>Please review and confirm the attendance records and "
                                f"event timing before finalizing.</p>"
                                f'<p><a href="{_html.escape(full_event_url)}">Review Event</a></p>'
                                f"</div>"
                            ),
                            text_body=(
                                f"Hi {creator.first_name},\n\n"
                                f'Your event "{event.title}" has ended. '
                                f"{checked_in_count} of {rsvp_count} attendees checked in.\n\n"
                                f"Please review and confirm the attendance records and "
                                f"event timing before finalizing.\n\n"
                                f"Review Event: {full_event_url}"
                            ),
                        )
                        if sent_count > 0:
                            org_emails += 1
                    except Exception as e:
                        logger.error(
                            f"Failed to send post-event validation email "
                            f"to {creator.email}: {e}"
                        )

                # Mark as sent
                event.custom_fields = {**custom, "validation_notification_sent": True}

            await db.commit()

        except Exception as e:
            logger.error(f"Post-event validation failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})
            continue

        total_notifications += org_notifications
        total_emails += org_emails
        if org_notifications > 0 or org_emails > 0:
            results.append(
                {
                    "org_id": str(org.id),
                    "notifications": org_notifications,
                    "emails_sent": org_emails,
                }
            )

    logger.info(
        f"Post-event validation complete: {total_notifications} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "post_event_validation",
        "total_notifications": total_notifications,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


async def run_post_shift_validation(db: AsyncSession) -> Dict[str, Any]:
    """
    Send a notification to shift officers after their shift ends,
    asking them to validate attendance records and timing.

    Runs every 30 minutes. Looks for shifts that ended within the last
    2 hours and haven't already had a validation notification sent.
    Sends an in-app notification (and optionally email) to the shift
    officer with a link to the scheduling page.

    Tracks sent status via a custom JSON field on the Shift model (activities).
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import Shift, ShiftAttendance
    from app.models.user import User
    from app.services.email_service import EmailService, build_email_logo_html

    now = datetime.now(dt_timezone.utc)
    lookback = now - timedelta(hours=2)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_notifications = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_notifications = 0
        org_emails = 0

        try:
            shifts_result = await db.execute(
                select(Shift)
                .where(Shift.organization_id == str(org.id))
                .where(Shift.end_time.isnot(None))
                .where(Shift.end_time <= now)
                .where(Shift.end_time >= lookback)
                .where(Shift.shift_officer_id.isnot(None))
            )
            shifts = list(shifts_result.scalars().all())

            for shift in shifts:
                activities = shift.activities or {}
                if activities.get("validation_notification_sent"):
                    continue

                # Find the shift officer
                officer_result = await db.execute(
                    select(User).where(
                        User.id == shift.shift_officer_id,
                        User.is_active == True,  # noqa: E712
                    )
                )
                officer = officer_result.scalar_one_or_none()
                if not officer:
                    shift.activities = {
                        **activities,
                        "validation_notification_sent": True,
                    }
                    continue

                # Count attendance
                att_result = await db.execute(
                    select(ShiftAttendance).where(
                        ShiftAttendance.shift_id == str(shift.id)
                    )
                )
                attendance_records = list(att_result.scalars().all())
                att_count = len(attendance_records)

                shift_date_str = (
                    shift.shift_date.strftime("%b %d, %Y")
                    if shift.shift_date
                    else "Unknown"
                )
                subject = f"Action Required: Validate attendance for shift on {shift_date_str}"
                message = (
                    f"Your shift on {shift_date_str} has ended. "
                    f"{att_count} member{'s' if att_count != 1 else ''} recorded. "
                    f"Please review and confirm the attendance records and "
                    f"shift timing before finalizing."
                )

                # In-app notification
                try:
                    in_app_log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(org.id),
                        recipient_id=str(officer.id),
                        channel=NotificationChannel.IN_APP,
                        category="shift_validation",
                        subject=subject,
                        message=message,
                        action_url="/scheduling",
                    )
                    db.add(in_app_log)
                    org_notifications += 1
                except Exception as e:
                    logger.error(
                        f"Failed to create post-shift validation notification "
                        f"for officer {officer.id}, shift {shift.id}: {e}"
                    )

                # Email notification
                prefs = officer.notification_preferences or {}
                wants_email = prefs.get("email_notifications", True)
                if wants_email and officer.email:
                    try:
                        full_url = f"{settings.FRONTEND_URL}/scheduling"
                        e_first = _html.escape(officer.first_name or "")
                        e_shift_date = _html.escape(shift_date_str)
                        _logo = build_email_logo_html(org)
                        email_service = EmailService(organization=org)
                        sent_count, _ = await email_service.send_email(
                            to_emails=[officer.email],
                            subject=subject,
                            html_body=(
                                f'<div style="font-family:Arial,sans-serif;max-width:600px;">'
                                f"{_logo}"
                                f"<p>Hi {e_first},</p>"
                                f"<p>Your shift on <strong>{e_shift_date}</strong> has ended. "
                                f"{att_count} member{'s' if att_count != 1 else ''} recorded.</p>"
                                f"<p>Please review and confirm the attendance records and "
                                f"shift timing before finalizing.</p>"
                                f'<p><a href="{_html.escape(full_url)}">Review Shift</a></p>'
                                f"</div>"
                            ),
                            text_body=(
                                f"Hi {officer.first_name},\n\n"
                                f"Your shift on {shift_date_str} has ended. "
                                f"{att_count} member{'s' if att_count != 1 else ''} recorded.\n\n"
                                f"Please review and confirm the attendance records and "
                                f"shift timing before finalizing.\n\n"
                                f"Review Shift: {full_url}"
                            ),
                        )
                        if sent_count > 0:
                            org_emails += 1
                    except Exception as e:
                        logger.error(
                            f"Failed to send post-shift validation email "
                            f"to {officer.email}: {e}"
                        )

                # Mark as sent
                shift.activities = {**activities, "validation_notification_sent": True}

            await db.commit()

        except Exception as e:
            logger.error(f"Post-shift validation failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})
            continue

        total_notifications += org_notifications
        total_emails += org_emails
        if org_notifications > 0 or org_emails > 0:
            results.append(
                {
                    "org_id": str(org.id),
                    "notifications": org_notifications,
                    "emails_sent": org_emails,
                }
            )

    logger.info(
        f"Post-shift validation complete: {total_notifications} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "post_shift_validation",
        "total_notifications": total_notifications,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


def _format_relative_time(event_time: datetime, now: datetime) -> str:
    """Format a future time as a relative description."""
    delta = event_time - now
    hours = delta.total_seconds() / 3600
    if hours < 1:
        minutes = int(delta.total_seconds() / 60)
        return f"in {minutes} minutes"
    elif hours < 24:
        return f"in {int(hours)} hour{'s' if int(hours) != 1 else ''}"
    else:
        days = int(hours / 24)
        return f"in {days} day{'s' if days != 1 else ''}"


async def run_audit_log_archival(db: AsyncSession) -> Dict[str, Any]:
    """
    Archive old audit logs for HIPAA compliance and long-term retention.

    This task:
    1. Identifies audit log entries older than 90 days without a checkpoint
    2. Creates integrity checkpoints covering those entries
    3. Verifies the hash chain integrity of the archived range
    4. Logs the archival operation itself

    Designed to run weekly so that all audit data eventually gets
    checkpointed, enabling confident long-term integrity verification.
    """
    from datetime import timedelta, timezone

    from sqlalchemy import func

    from app.core.audit import (
        audit_logger,
        log_audit_event,
        verify_audit_log_integrity,
    )
    from app.models.audit import AuditLog, AuditLogCheckpoint

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    results: Dict[str, Any] = {
        "task": "audit_log_archival",
        "checkpoints_created": 0,
        "entries_checkpointed": 0,
        "integrity_verified": False,
        "errors": [],
    }

    try:
        # Find the latest checkpoint's last_log_id
        latest_cp = await db.execute(
            select(AuditLogCheckpoint)
            .order_by(AuditLogCheckpoint.last_log_id.desc())
            .limit(1)
        )
        latest_checkpoint = latest_cp.scalar_one_or_none()
        last_checkpointed_id = latest_checkpoint.last_log_id if latest_checkpoint else 0

        # Find audit log entries older than 90 days that haven't been checkpointed
        old_logs_query = (
            select(func.min(AuditLog.id), func.max(AuditLog.id), func.count())
            .where(AuditLog.id > last_checkpointed_id)
            .where(AuditLog.timestamp < cutoff)
        )
        old_result = await db.execute(old_logs_query)
        row = old_result.one_or_none()

        if row and row[2] and row[2] > 0:
            min_id, max_id = row[0], row[1]

            # Create checkpoint for the range (in batches of 10000)
            batch_start = min_id
            while batch_start <= max_id:
                batch_end = min(batch_start + 9999, max_id)

                # Verify batch count
                batch_count_result = await db.execute(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.id >= batch_start)
                    .where(AuditLog.id <= batch_end)
                )
                batch_count = batch_count_result.scalar() or 0

                if batch_count > 0:
                    try:
                        checkpoint = await audit_logger.create_checkpoint(
                            db, batch_start, batch_end
                        )
                        results["checkpoints_created"] += 1
                        results["entries_checkpointed"] += checkpoint.total_entries
                        logger.info(
                            f"Audit archival: created checkpoint for logs "
                            f"{batch_start}-{batch_end} ({checkpoint.total_entries} entries)"
                        )
                    except ValueError as e:
                        results["errors"].append(
                            f"Checkpoint {batch_start}-{batch_end}: {e}"
                        )

                batch_start = batch_end + 1

            await db.flush()

        # Verify overall integrity
        integrity_result = await verify_audit_log_integrity(db)
        results["integrity_verified"] = integrity_result["verified"]
        if not integrity_result["verified"]:
            results["errors"].extend(
                [
                    f"Integrity error at log {e['log_id']}: {e['error']}"
                    for e in integrity_result.get("errors", [])[:5]
                ]
            )

        # Log the archival operation
        await log_audit_event(
            db=db,
            event_type="audit_log_archival",
            event_category="security",
            severity="info",
            event_data={
                "checkpoints_created": results["checkpoints_created"],
                "entries_checkpointed": results["entries_checkpointed"],
                "integrity_verified": results["integrity_verified"],
                "errors_count": len(results["errors"]),
            },
        )

        await db.commit()

        logger.info(
            f"Audit log archival complete: {results['checkpoints_created']} checkpoints, "
            f"{results['entries_checkpointed']} entries, "
            f"integrity={'OK' if results['integrity_verified'] else 'FAILED'}"
        )

    except Exception as e:
        logger.error(f"Audit log archival failed: {e}")
        results["errors"].append(str(e))

    return results


async def run_scheduled_emails(db: AsyncSession) -> Dict[str, Any]:
    """Process pending scheduled emails that are due to be sent."""
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    from sqlalchemy.orm import selectinload

    from app.models.email_template import (
        ScheduledEmail,
        ScheduledEmailStatus,
    )
    from app.services.email_service import EmailService
    from app.services.email_template_service import EmailTemplateService

    now = _dt.now(_tz.utc)
    result = await db.execute(
        select(ScheduledEmail)
        .where(
            ScheduledEmail.status == ScheduledEmailStatus.PENDING,
            ScheduledEmail.scheduled_at <= now,
        )
        .options(selectinload(ScheduledEmail.organization))
        .limit(100)
    )
    pending = list(result.scalars().all())

    sent = 0
    failed = 0
    for item in pending:
        try:
            org = item.organization
            email_svc = EmailService(org)
            template_svc = EmailTemplateService(db)

            template = None
            if item.template_id:
                from app.models.email_template import EmailTemplate

                t_result = await db.execute(
                    select(EmailTemplate)
                    .where(EmailTemplate.id == item.template_id)
                    .options(selectinload(EmailTemplate.attachments))
                )
                template = t_result.scalar_one_or_none()

            if not template:
                template = await template_svc.get_template(
                    item.organization_id, item.template_type
                )

            if not template:
                item.status = ScheduledEmailStatus.FAILED
                item.error_message = (
                    f"No template found for type {item.template_type.value}"
                )
                failed += 1
                continue

            subject, html_body, text_body = template_svc.render(
                template, item.context or {}, organization=org
            )

            # Merge template default CC/BCC with per-email overrides
            cc = list(set((template.default_cc or []) + (item.cc_emails or []))) or None
            bcc = (
                list(set((template.default_bcc or []) + (item.bcc_emails or [])))
                or None
            )

            success_count, _ = await email_svc.send_email(
                to_emails=item.to_emails,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                cc_emails=cc,
                bcc_emails=bcc,
            )

            if success_count > 0:
                item.status = ScheduledEmailStatus.SENT
                item.sent_at = now
                sent += 1
            else:
                item.status = ScheduledEmailStatus.FAILED
                item.error_message = "Email delivery failed"
                failed += 1

        except Exception as e:
            logger.error(f"Failed to send scheduled email {item.id}: {e}")
            item.status = ScheduledEmailStatus.FAILED
            item.error_message = str(e)[:500]
            failed += 1

    if pending:
        await db.commit()

    logger.info(f"Scheduled emails processed: {sent} sent, {failed} failed")
    return {"sent": sent, "failed": failed, "total_processed": len(pending)}


async def run_inventory_low_stock_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts to admins when inventory items drop below reorder point.
    Daily at 07:00.
    """
    from app.services.email_service import EmailService, build_email_logo_html
    from app.services.inventory_service import InventoryService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_alerts = 0
    results = []

    for org in organizations:
        try:
            service = InventoryService(db)
            low_stock = await service.get_low_stock_items_for_alerts(org.id)
            if not low_stock:
                results.append({"org_id": str(org.id), "alerts": 0})
                continue

            # Build email content
            items_html = ""
            for item in low_stock:
                cat_name = item.category.name if item.category else "Uncategorized"
                items_html += (
                    f"<tr><td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
                    f"{_html.escape(item.name)}</td>"
                    f"<td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
                    f"{_html.escape(cat_name)}</td>"
                    f"<td style='padding:6px 12px;border-bottom:1px solid #eee;text-align:center;'>"
                    f"<strong style='color:#dc2626;'>{item.quantity}</strong></td>"
                    f"<td style='padding:6px 12px;border-bottom:1px solid #eee;text-align:center;'>"
                    f"{item.reorder_point}</td></tr>"
                )

            _logo_img = build_email_logo_html(org)

            html_body = f"""
            <div style="font-family:Arial,sans-serif;max-width:600px;">
                {_logo_img}
                <h2 style="color:#dc2626;">Low Stock Alert</h2>
                <p>The following inventory items are at or below their reorder point:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px 12px;text-align:left;">Item</th>
                            <th style="padding:8px 12px;text-align:left;">Category</th>
                            <th style="padding:8px 12px;text-align:center;">Current Qty</th>
                            <th style="padding:8px 12px;text-align:center;">Reorder Point</th>
                        </tr>
                    </thead>
                    <tbody>{items_html}</tbody>
                </table>
                <p style="color:#6b7280;font-size:14px;">
                    Please review and reorder as needed.
                </p>
            </div>
            """

            # Send to admins with inventory.manage permission
            admin_result = await db.execute(
                select(User)
                .where(User.organization_id == str(org.id))
                .where(User.is_active == True)  # noqa: E712
                .where(User.email.isnot(None))
            )
            admins = [
                u
                for u in admin_result.scalars().all()
                if u.role in ("admin", "owner", "quartermaster")
            ]
            admin_emails = [a.email for a in admins if a.email]

            if admin_emails:
                email_svc = EmailService(organization=org)
                success_count, _ = await email_svc.send_email(
                    to_emails=admin_emails,
                    subject=f"Low Stock Alert — {len(low_stock)} item(s) below reorder point",
                    html_body=html_body,
                    text_body=f"{len(low_stock)} inventory items are below their reorder point. Please check the inventory dashboard.",
                )
                if success_count > 0:
                    total_alerts += 1

            # SMS alerts to admins with phone numbers
            try:
                from app.services.sms_service import SMSService

                sms_svc = SMSService()
                if sms_svc.enabled:
                    admin_phones = [a.phone for a in admins if getattr(a, "phone", None)]
                    if admin_phones:
                        sms_body = (
                            f"Low Stock Alert: {len(low_stock)} inventory item(s) "
                            f"below reorder point. Check the inventory dashboard."
                        )
                        sms_sent = await sms_svc.send_bulk_sms(admin_phones, sms_body)
                        logger.info(f"Low stock SMS sent to {sms_sent}/{len(admin_phones)} admins for org {org.id}")
            except Exception as sms_err:
                logger.warning(f"SMS low stock alerts failed for org {org.id}: {sms_err}")

            results.append({"org_id": str(org.id), "alerts": len(low_stock)})

        except Exception as e:
            logger.error(f"Low stock alerts failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Low stock alerts: {total_alerts} emails sent")
    return {
        "task": "inventory_low_stock_alerts",
        "total_alerts_sent": total_alerts,
        "organizations": results,
    }


async def run_inventory_overdue_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts for overdue checkouts. Daily at 07:30.
    Notifies both the member who has the overdue item and admins.
    """
    from app.services.email_service import EmailService, build_email_logo_html
    from app.services.inventory_service import InventoryService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_alerts = 0
    results = []

    for org in organizations:
        try:
            service = InventoryService(db)
            overdue = await service.get_overdue_checkouts_for_alerts(org.id)
            if not overdue:
                results.append({"org_id": str(org.id), "overdue": 0})
                continue

            # Group by member for individual notifications
            by_user: Dict[str, list] = {}
            for co in overdue:
                uid = str(co.user_id)
                if uid not in by_user:
                    by_user[uid] = []
                by_user[uid].append(co)

            email_svc = EmailService(organization=org)
            _logo_img = build_email_logo_html(org)

            for uid, user_checkouts in by_user.items():
                user_obj = user_checkouts[0].user if user_checkouts[0].user else None
                if not user_obj or not user_obj.email:
                    continue

                items_list = ""
                for co in user_checkouts:
                    item_name = co.item.name if co.item else "Unknown"
                    due_date = (
                        co.expected_return_at.strftime("%B %d, %Y")
                        if co.expected_return_at
                        else "N/A"
                    )
                    items_list += f"<li><strong>{_html.escape(item_name)}</strong> — due {due_date}</li>"

                html_body = f"""
                <div style="font-family:Arial,sans-serif;max-width:600px;">
                    {_logo_img}
                    <h2 style="color:#dc2626;">Overdue Equipment</h2>
                    <p>Hi {_html.escape(user_obj.first_name or 'Member')},</p>
                    <p>The following items are overdue for return:</p>
                    <ul style="margin:16px 0;">{items_list}</ul>
                    <p>Please return these items as soon as possible.</p>
                </div>
                """

                success_count, _ = await email_svc.send_email(
                    to_emails=[user_obj.email],
                    subject=f"Overdue Equipment Reminder — {len(user_checkouts)} item(s)",
                    html_body=html_body,
                    text_body=f"You have {len(user_checkouts)} overdue equipment item(s). Please return them as soon as possible.",
                )
                if success_count > 0:
                    total_alerts += 1

            results.append(
                {
                    "org_id": str(org.id),
                    "overdue": len(overdue),
                    "members_notified": len(by_user),
                }
            )

        except Exception as e:
            logger.error(f"Overdue alerts failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Overdue alerts: {total_alerts} emails sent")
    return {
        "task": "inventory_overdue_alerts",
        "total_alerts_sent": total_alerts,
        "organizations": results,
    }


async def run_nfpa_retirement_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts for PPE approaching NFPA 10-year retirement.
    Weekly on Mondays at 08:00.
    Tiers: 180 days, 90 days, 30 days, past due.
    """
    from app.services.email_service import EmailService, build_email_logo_html
    from app.services.inventory_service import InventoryService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_alerts = 0
    results = []

    for org in organizations:
        try:
            service = InventoryService(db)
            items_due = await service.get_nfpa_retirement_due_items(
                organization_id=org.id,
                days_ahead=180,
            )
            if not items_due:
                results.append({"org_id": str(org.id), "items_due": 0})
                continue

            # Categorize by urgency
            past_due = [i for i in items_due if i["days_until_retirement"] <= 0]
            within_30 = [i for i in items_due if 0 < i["days_until_retirement"] <= 30]
            within_90 = [i for i in items_due if 30 < i["days_until_retirement"] <= 90]
            within_180 = [
                i for i in items_due if 90 < i["days_until_retirement"] <= 180
            ]

            def _build_section(title: str, items: list, color: str) -> str:
                if not items:
                    return ""
                rows = ""
                for it in items:
                    rows += (
                        f"<tr><td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
                        f"{_html.escape(it['item_name'])}</td>"
                        f"<td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
                        f"{_html.escape(it.get('serial_number') or it.get('asset_tag') or 'N/A')}</td>"
                        f"<td style='padding:6px 12px;border-bottom:1px solid #eee;'>"
                        f"{it['retirement_date']}</td>"
                        f"<td style='padding:6px 12px;border-bottom:1px solid #eee;text-align:center;'>"
                        f"<strong style='color:{color};'>{it['days_until_retirement']}d</strong></td></tr>"
                    )
                return f"""
                <h3 style="color:{color};margin-top:16px;">{title} ({len(items)})</h3>
                <table style="width:100%;border-collapse:collapse;margin:8px 0;">
                    <thead><tr style="background:#f3f4f6;">
                        <th style="padding:8px 12px;text-align:left;">Item</th>
                        <th style="padding:8px 12px;text-align:left;">ID</th>
                        <th style="padding:8px 12px;text-align:left;">Retirement Date</th>
                        <th style="padding:8px 12px;text-align:center;">Days</th>
                    </tr></thead>
                    <tbody>{rows}</tbody>
                </table>
                """

            _logo_img = build_email_logo_html(org)

            html_body = f"""
            <div style="font-family:Arial,sans-serif;max-width:700px;">
                {_logo_img}
                <h2>NFPA 1851 Retirement Alert</h2>
                <p>{len(items_due)} PPE item(s) are approaching or past their retirement date:</p>
                {_build_section("Past Due — Retire Immediately", past_due, "#dc2626")}
                {_build_section("Within 30 Days", within_30, "#ea580c")}
                {_build_section("Within 90 Days", within_90, "#ca8a04")}
                {_build_section("Within 180 Days", within_180, "#2563eb")}
                <p style="color:#6b7280;font-size:14px;margin-top:16px;">
                    Per NFPA 1851, structural firefighting PPE must be retired 10 years from manufacture date.
                </p>
            </div>
            """

            # Send to admins
            admin_result = await db.execute(
                select(User)
                .where(User.organization_id == str(org.id))
                .where(User.is_active == True)  # noqa: E712
                .where(User.email.isnot(None))
            )
            admins = [
                u
                for u in admin_result.scalars().all()
                if u.role in ("admin", "owner", "quartermaster")
            ]
            admin_emails = [a.email for a in admins if a.email]

            if admin_emails:
                email_svc = EmailService(organization=org)
                success_count, _ = await email_svc.send_email(
                    to_emails=admin_emails,
                    subject=f"NFPA Retirement Alert — {len(items_due)} PPE item(s)",
                    html_body=html_body,
                    text_body=f"{len(items_due)} PPE items are approaching NFPA retirement. Please check the inventory dashboard.",
                )
                if success_count > 0:
                    total_alerts += 1

            results.append({"org_id": str(org.id), "items_due": len(items_due)})

        except Exception as e:
            logger.error(f"NFPA retirement alerts failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"NFPA retirement alerts: {total_alerts} emails sent")
    return {
        "task": "nfpa_retirement_alerts",
        "total_alerts_sent": total_alerts,
        "organizations": results,
    }


# Task runner map
TASK_RUNNERS = {
    "cert_expiration_alerts": run_cert_expiration_alerts,
    "struggling_member_check": run_struggling_member_check,
    "enrollment_deadline_warnings": run_enrollment_deadline_warnings,
    "membership_tier_advance": run_membership_tier_advance,
    "action_item_reminders": run_action_item_reminders,
    "inventory_notifications": run_inventory_notifications,
    "event_reminders": run_event_reminders,
    "post_event_validation": run_post_event_validation,
    "post_shift_validation": run_post_shift_validation,
    "audit_log_archival": run_audit_log_archival,
    "scheduled_emails": run_scheduled_emails,
    "inventory_low_stock_alerts": run_inventory_low_stock_alerts,
    "inventory_overdue_alerts": run_inventory_overdue_alerts,
    "nfpa_retirement_alerts": run_nfpa_retirement_alerts,
}
