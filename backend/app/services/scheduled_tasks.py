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
-----------------------------------------------------
"""

from datetime import datetime
from typing import Dict, Any
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import Organization


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

    logger.info(f"Cert expiration alerts complete: {total_sent} alerts sent across {len(organizations)} orgs")
    return {"task": "cert_expiration_alerts", "total_alerts_sent": total_sent, "organizations": results}


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
    return {"task": "struggling_member_check", "total_flagged": total_flagged, "organizations": results}


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

    return {"task": "enrollment_deadline_warnings", "total_warned": total_warned, "organizations": results}


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
    return {"task": "membership_tier_advance", "total_advanced": total_advanced, "organizations": results}


async def run_action_item_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send reminders for action items approaching or past their due dates.
    Checks both meeting_action_items and minutes_action_items tables.
    Sends notifications at 3 days before, 1 day before, and on overdue.
    """
    from app.models.meeting import MeetingActionItem, ActionItemStatus
    from app.models.minute import ActionItem as MinutesActionItem, MinutesActionItemStatus
    from app.models.user import User
    from datetime import date, timedelta

    today = date.today()
    three_days = today + timedelta(days=3)
    one_day = today + timedelta(days=1)

    total_reminders = 0

    # ── Meeting action items ──
    meeting_items = await db.execute(
        select(MeetingActionItem).where(
            MeetingActionItem.status.in_([ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]),
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
                    from app.models.notification import NotificationLog
                    from app.core.utils import generate_uuid
                    urgency = "overdue" if days_until < 0 else f"due in {days_until} day(s)"
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
            MinutesActionItem.status.in_([
                MinutesActionItemStatus.PENDING.value,
                MinutesActionItemStatus.IN_PROGRESS.value,
            ]),
            MinutesActionItem.due_date.isnot(None),
            MinutesActionItem.due_date <= datetime.combine(three_days, datetime.min.time()),
        )
    )
    for item in minutes_items.scalars().all():
        if item.assignee_id:
            due_d = item.due_date.date() if hasattr(item.due_date, 'date') else item.due_date
            days_until = (due_d - today).days if due_d else None
            if days_until is not None and days_until in (3, 1, 0, -1):
                try:
                    from app.models.notification import NotificationLog
                    from app.core.utils import generate_uuid
                    urgency = "overdue" if days_until < 0 else f"due in {days_until} day(s)"
                    log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=item.minutes.organization_id if item.minutes else None,
                        user_id=item.assignee_id,
                        channel="in_app",
                        category="action_items",
                        subject=f"Action item {urgency}: {item.description[:80]}",
                        body=f"Your action item is {urgency}. Description: {item.description}",
                    )
                    db.add(log)
                    total_reminders += 1
                except Exception as e:
                    logger.error(f"Failed to create minutes action item notification: {e}")

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

    Tracks which intervals have been sent in custom_fields.reminders_sent (list
    of hours already notified, e.g. [168]).
    """
    from datetime import timedelta, timezone as dt_timezone
    from sqlalchemy.orm import selectinload
    from app.models.event import Event, EventRSVP, RSVPStatus
    from app.models.user import User
    from app.models.notification import NotificationLog, NotificationChannel
    from app.services.email_service import EmailService
    from app.core.utils import generate_uuid
    from app.core.config import settings

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
            # Look ahead up to 168 hours (max reminder window)
            max_lookahead = now + timedelta(hours=168)

            events_result = await db.execute(
                select(Event)
                .options(
                    selectinload(Event.rsvps),
                    selectinload(Event.location_obj),
                )
                .where(Event.organization_id == str(org.id))
                .where(Event.send_reminders == True)
                .where(Event.is_cancelled == False)
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
                    threshold = event.start_datetime - timedelta(hours=hours)
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
                        .where(User.is_active == True)
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
                    if event.event_type else "Event"
                )
                event_url = f"{settings.FRONTEND_URL}/events/{event.id}"
                email_service = EmailService(organization=org)

                # Send one notification per due interval
                for hours in due_intervals:
                    for user in recipients:
                        prefs = user.notification_preferences or {}
                        wants_reminders = prefs.get("event_reminders", True)
                        user_name = f"{user.first_name} {user.last_name}"

                        # In-app notification
                        try:
                            in_app_log = NotificationLog(
                                id=generate_uuid(),
                                organization_id=str(org.id),
                                recipient_id=str(user.id),
                                channel=NotificationChannel.IN_APP,
                                subject=f"Reminder: {event.title}",
                                message=(
                                    f"Your event \"{event.title}\" starts "
                                    f"{_format_relative_time(event.start_datetime, now)}."
                                ),
                            )
                            db.add(in_app_log)
                            org_reminders += 1
                        except Exception as e:
                            logger.error(f"Failed to create in-app reminder for user {user.id}: {e}")

                        # Email notification
                        wants_email = prefs.get("email_notifications", True)
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
                                )
                                if sent:
                                    org_emails += 1
                            except Exception as e:
                                logger.error(f"Failed to send reminder email to {user.email}: {e}")

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
            results.append({
                "org_id": str(org.id),
                "in_app_reminders": org_reminders,
                "emails_sent": org_emails,
            })

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


# Task runner map
TASK_RUNNERS = {
    "cert_expiration_alerts": run_cert_expiration_alerts,
    "struggling_member_check": run_struggling_member_check,
    "enrollment_deadline_warnings": run_enrollment_deadline_warnings,
    "membership_tier_advance": run_membership_tier_advance,
    "action_item_reminders": run_action_item_reminders,
    "inventory_notifications": run_inventory_notifications,
    "event_reminders": run_event_reminders,
}
