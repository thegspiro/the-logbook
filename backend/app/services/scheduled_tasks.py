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

# Every 30 minutes — start-of-shift reminders with equipment checklists
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=shift_reminders

# Every 30 minutes — end-of-shift checklist reminders
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=end_of_shift_checklist_reminders

# Every 30 minutes — per-member end-of-shift summary email + in-app notification
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=end_of_shift_summary

# Daily at 8:00 AM — escalate unacknowledged trainee shift reports
0 8 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=trainee_report_escalation

# Weekly on Sundays at 2:00 AM — audit log archival and integrity checkpoint
0 2 * * 0 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=audit_log_archival

# Daily at 7:00 AM — inventory low stock alerts
0 7 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=inventory_low_stock_alerts

# Daily at 7:30 AM — overdue equipment checkout reminders
30 7 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=inventory_overdue_alerts

# Weekly on Mondays at 8:00 AM — NFPA PPE retirement alerts
0 8 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=nfpa_retirement_alerts

# Daily at 6:30 AM — compliance auto-report generation (monthly on configured day, yearly on Jan 1)
30 6 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=compliance_auto_reports

# Daily at 3:00 AM — message history cleanup (delete records older than 90 days)
0 3 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=message_history_cleanup

# Daily at 7:00 AM — recurring event series end reminders (6 months prior)
0 7 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=series_end_reminders

# Daily at 2:30 AM — extend rolling recurring event series (12-month horizon)
30 2 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=rolling_recurrence_extend

# Every 30 minutes — auto-sync external training providers (Vector Solutions, etc.)
*/30 * * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=external_training_auto_sync
-----------------------------------------------------
"""

import html as _html
from datetime import datetime
from typing import Any, Dict

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.services.email_service import _redact_email

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
    "shift_reminders": {
        "description": "Send start-of-shift reminders with equipment checklists to assigned members",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
    "end_of_shift_checklist_reminders": {
        "description": "Remind assigned members to complete end-of-shift equipment checklists before their shift ends",
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
        "frequency": "every 1 minute",
        "recommended_time": "* * * * *",
        "cron": "* * * * *",
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
    "compliance_auto_reports": {
        "description": "Generate and email scheduled compliance reports (monthly on configured day, yearly on Jan 1)",
        "frequency": "daily",
        "recommended_time": "06:30",
        "cron": "30 6 * * *",
    },
    "message_history_cleanup": {
        "description": "Delete message history records older than 90 days to prevent unbounded table growth",
        "frequency": "daily",
        "recommended_time": "03:00",
        "cron": "0 3 * * *",
    },
    "series_end_reminders": {
        "description": "Send email reminders 6 months before recurring event series end dates",
        "frequency": "daily",
        "recommended_time": "07:00",
        "cron": "0 7 * * *",
    },
    "rolling_recurrence_extend": {
        "description": "Extend rolling recurring event series to maintain a 12-month horizon",
        "frequency": "daily",
        "recommended_time": "02:30",
        "cron": "30 2 * * *",
    },
    "shift_auto_checkout": {
        "description": "Send checkout reminders when shifts end, then auto-checkout members 30 minutes after shift end if still checked in",
        "frequency": "every 15 minutes",
        "recommended_time": "*/15 * * * *",
        "cron": "*/15 * * * *",
    },
    "end_of_shift_summary": {
        "description": "Send each member who attended a shift an end-of-shift summary (email + in-app) with hours, calls, and a link to their completion report",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
    "trainee_report_escalation": {
        "description": "Escalate shift completion reports awaiting trainee acknowledgment beyond the configured window (default 7 days)",
        "frequency": "daily",
        "recommended_time": "08:00",
        "cron": "0 8 * * *",
    },
    "external_training_auto_sync": {
        "description": "Sync training records from external providers (Vector Solutions, etc.) that have auto-sync enabled and are due",
        "frequency": "every 30 minutes",
        "recommended_time": "*/30 * * * *",
        "cron": "*/30 * * * *",
    },
}


async def _for_each_org(
    db: AsyncSession,
    task_name: str,
    callback,
) -> Dict[str, Any]:
    """Run callback(db, org) for each org, collecting results and errors.

    The callback must return an int (count of items processed).
    """
    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())
    results = []
    total = 0
    for org in organizations:
        try:
            count = await callback(db, org)
            total += count
        except Exception as e:
            logger.error(f"{task_name} failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})
    return {"task": task_name, "total": total, "errors": results}


async def resolve_check_templates(
    db: AsyncSession,
    organization_id: str,
    apparatus_id: str,
    check_timing: str,
) -> list:
    """Resolve equipment check templates for an apparatus with type fallback.

    First looks for templates assigned directly to the apparatus. If none
    are found, falls back to templates matching the apparatus's type code
    that have no specific apparatus assigned.
    """
    from app.models.apparatus import Apparatus, ApparatusType, EquipmentCheckTemplate

    tmpl_result = await db.execute(
        select(EquipmentCheckTemplate)
        .where(EquipmentCheckTemplate.organization_id == str(organization_id))
        .where(EquipmentCheckTemplate.apparatus_id == str(apparatus_id))
        .where(EquipmentCheckTemplate.check_timing == check_timing)
        .where(EquipmentCheckTemplate.is_active == True)  # noqa: E712
        .order_by(EquipmentCheckTemplate.sort_order)
    )
    templates = list(tmpl_result.scalars().all())

    if templates:
        return templates

    # Fall back to apparatus-type templates
    app_result = await db.execute(
        select(Apparatus.apparatus_type_id).where(Apparatus.id == str(apparatus_id))
    )
    app_type_id = app_result.scalar_one_or_none()

    type_query = (
        select(EquipmentCheckTemplate)
        .where(EquipmentCheckTemplate.organization_id == str(organization_id))
        .where(EquipmentCheckTemplate.apparatus_id.is_(None))
        .where(EquipmentCheckTemplate.check_timing == check_timing)
        .where(EquipmentCheckTemplate.is_active == True)  # noqa: E712
    )
    if app_type_id:
        at_result = await db.execute(
            select(ApparatusType.code).where(ApparatusType.id == str(app_type_id))
        )
        at_code = at_result.scalar_one_or_none()
        if at_code:
            type_query = type_query.where(
                EquipmentCheckTemplate.apparatus_type == at_code
            )

    type_result = await db.execute(
        type_query.order_by(EquipmentCheckTemplate.sort_order)
    )
    return list(type_result.scalars().all())


async def run_cert_expiration_alerts(db: AsyncSession) -> Dict[str, Any]:
    """Run certification expiration alerts for all organizations."""
    from app.services.cert_alert_service import CertAlertService

    async def _process(db_session, org):
        service = CertAlertService(db_session)
        result = await service.process_alerts(org.id)
        return result.get("alerts_sent", 0)

    return await _for_each_org(db, "cert_expiration_alerts", _process)


async def run_struggling_member_check(db: AsyncSession) -> Dict[str, Any]:
    """Detect members falling behind and send notifications."""
    from app.services.struggling_member_service import StrugglingMemberService

    async def _process(db_session, org):
        service = StrugglingMemberService(db_session)
        result = await service.detect_and_notify(str(org.id))
        return result.get("members_flagged", 0)

    return await _for_each_org(db, "struggling_member_check", _process)


async def run_enrollment_deadline_warnings(db: AsyncSession) -> Dict[str, Any]:
    """Send deadline warnings for approaching enrollment deadlines."""
    from app.services.struggling_member_service import StrugglingMemberService

    async def _process(db_session, org):
        service = StrugglingMemberService(db_session)
        result = await service.send_deadline_warnings(str(org.id))
        return result.get("warnings_sent", 0)

    return await _for_each_org(db, "enrollment_deadline_warnings", _process)


async def run_membership_tier_advance(db: AsyncSession) -> Dict[str, Any]:
    """Auto-advance all eligible members to higher tiers."""
    from app.services.membership_tier_service import MembershipTierService

    async def _process(db_session, org):
        service = MembershipTierService(db_session)
        result = await service.advance_all(
            organization_id=str(org.id),
            performed_by="system",
        )
        return result.get("advanced", 0)

    return await _for_each_org(db, "membership_tier_advance", _process)


async def run_action_item_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send reminders for action items approaching or past their due dates.
    Checks both meeting_action_items and minutes_action_items tables.
    Sends notifications at 3 days before, 1 day before, and on overdue.
    """
    from datetime import date, timedelta
    from datetime import timezone as _tz_reminders

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
                        recipient_id=item.assigned_to,
                        channel="in_app",
                        category="action_items",
                        subject=f"Action item {urgency}: {item.description[:80]}",
                        message=f"Your action item is {urgency}. Description: {item.description}",
                        delivered=True,
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
            <= datetime.combine(
                three_days, datetime.min.time(), tzinfo=_tz_reminders.utc
            ),
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
                        recipient_id=item.assignee_id,
                        channel="in_app",
                        category="action_items",
                        subject=f"Action item {urgency}: {item.description[:80]}",
                        message=f"Your action item is {urgency}. Description: {item.description}",
                        delivered=True,
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

                raw_event_type = (
                    (
                        event.event_type.value
                        if hasattr(event.event_type, "value")
                        else event.event_type
                    )
                    if event.event_type
                    else None
                )
                event_type_label = (
                    raw_event_type.replace("_", " ").title()
                    if raw_event_type
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
                                delivered=True,
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
                                    "Failed to send reminder email to %s: %s",
                                    _redact_email(user.email),
                                    e,
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
    from app.services.email_service import EmailService

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
                        delivered=True,
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
                        from app.services.email_service import wrap_email_body

                        full_event_url = f"{settings.FRONTEND_URL}/events/{event.id}"
                        e_first = _html.escape(creator.first_name or "")
                        e_title = _html.escape(event.title or "")
                        email_service = EmailService(organization=org)
                        sent_count, _ = await email_service.send_email(
                            to_emails=[creator.email],
                            subject=subject,
                            html_body=wrap_email_body(
                                org,
                                "Please Validate Attendance",
                                f"<p>Hello {e_first},</p>"
                                f'<p>Your event "<strong>{e_title}</strong>" has ended. '
                                f"{checked_in_count} of {rsvp_count} attendees checked in.</p>"
                                f"<p>Please review and confirm the attendance records and "
                                f"event timing before finalizing.</p>"
                                f'<p style="text-align: center;">'
                                f'<a href="{_html.escape(full_event_url)}" class="button" role="link">'
                                f"Review Event</a></p>",
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
                            "Failed to send post-event validation email to %s: %s",
                            _redact_email(creator.email),
                            e,
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
    from app.models.training import (
        Shift,
        ShiftAssignment,
        ShiftAttendance,
        ShiftCompletionReport,
        ShiftEquipmentCheck,
    )
    from app.models.user import User
    from app.services.email_service import EmailService

    now = datetime.now(dt_timezone.utc)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_notifications = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_notifications = 0
        org_emails = 0

        try:
            sr_cfg = (org.settings or {}).get("shift_reports", {})
            psv_cfg = sr_cfg.get("post_shift_validation", {})
            if not psv_cfg.get("enabled", True):
                continue

            window_hours = psv_cfg.get("validation_window_hours", 2)
            lookback = now - timedelta(hours=window_hours)

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

                # Check for outstanding end-of-shift checklists
                pending_checklists: list[str] = []
                if shift.apparatus_id:
                    eos_templates = await resolve_check_templates(
                        db,
                        str(org.id),
                        str(shift.apparatus_id),
                        "end_of_shift",
                    )

                    if eos_templates:
                        eos_tmpl_ids = [str(t.id) for t in eos_templates]
                        done_result = await db.execute(
                            select(ShiftEquipmentCheck.template_id)
                            .where(ShiftEquipmentCheck.shift_id == str(shift.id))
                            .where(ShiftEquipmentCheck.template_id.in_(eos_tmpl_ids))
                        )
                        done_ids = {r[0] for r in done_result.all()}
                        pending_checklists = [
                            t.name for t in eos_templates if str(t.id) not in done_ids
                        ]

                # Check if any trainees on the shift still need
                # a completion report from this officer
                assign_result = await db.execute(
                    select(ShiftAssignment.user_id)
                    .where(ShiftAssignment.shift_id == str(shift.id))
                    .where(
                        ShiftAssignment.assignment_status.notin_(
                            ["declined", "cancelled"]
                        )
                    )
                )
                assigned_ids = [str(r[0]) for r in assign_result.all()]
                report_result = await db.execute(
                    select(ShiftCompletionReport.trainee_id).where(
                        ShiftCompletionReport.shift_id == str(shift.id),
                        ShiftCompletionReport.officer_id == str(shift.shift_officer_id),
                    )
                )
                reported_ids = {str(r[0]) for r in report_result.all()}
                missing_reports = len(
                    [
                        uid
                        for uid in assigned_ids
                        if uid not in reported_ids
                        and uid != str(shift.shift_officer_id)
                    ]
                )

                shift_date_str = (
                    shift.shift_date.strftime("%b %d, %Y")
                    if shift.shift_date
                    else "Unknown"
                )
                subject = (
                    f"Action Required: Validate attendance for "
                    f"shift on {shift_date_str}"
                )
                message = (
                    f"Your shift on {shift_date_str} has ended. "
                    f"{att_count} member{'s' if att_count != 1 else ''} "
                    f"recorded. "
                    f"Please review and confirm the attendance records "
                    f"and shift timing before finalizing."
                )
                if pending_checklists:
                    message += (
                        f" Outstanding end-of-shift checklists: "
                        f"{', '.join(pending_checklists)}."
                    )
                if missing_reports > 0:
                    message += (
                        f" {missing_reports} shift completion "
                        f"report{'s' if missing_reports != 1 else ''} "
                        f"still needed."
                    )
                if psv_cfg.get("require_officer_report", False):
                    message += (
                        " A shift completion report is required "
                        "before this shift can be finalized."
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
                        action_url=(f"/scheduling?shift={shift.id}"),
                        notification_metadata={
                            "shift_id": str(shift.id),
                            "shift_start_time": (
                                shift.start_time.isoformat()
                                if shift.start_time
                                else None
                            ),
                            "shift_end_time": (
                                shift.end_time.isoformat() if shift.end_time else None
                            ),
                        },
                        delivered=True,
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
                        from app.services.email_service import wrap_email_body

                        full_url = (
                            f"{settings.FRONTEND_URL}/scheduling?shift={shift.id}"
                        )
                        e_first = _html.escape(officer.first_name or "")
                        e_shift_date = _html.escape(shift_date_str)
                        email_service = EmailService(organization=org)

                        extra_html = ""
                        extra_text = ""
                        if pending_checklists:
                            cl_items = "".join(
                                f"<li>{_html.escape(n)}</li>"
                                for n in pending_checklists
                            )
                            extra_html += (
                                "<p><strong>Outstanding end-of-shift "
                                "checklists:</strong></p>"
                                f"<ul>{cl_items}</ul>"
                            )
                            extra_text += (
                                "Outstanding end-of-shift checklists: "
                                f"{', '.join(pending_checklists)}\n\n"
                            )
                        if missing_reports > 0:
                            extra_html += (
                                f"<p>{missing_reports} shift completion "
                                f"report{'s' if missing_reports != 1 else ''}"
                                " still needed.</p>"
                            )
                            extra_text += (
                                f"{missing_reports} shift completion "
                                f"report{'s' if missing_reports != 1 else ''}"
                                " still needed.\n\n"
                            )

                        sent_count, _ = await email_service.send_email(
                            to_emails=[officer.email],
                            subject=subject,
                            html_body=wrap_email_body(
                                org,
                                "Shift Attendance Validation",
                                f"<p>Hello {e_first},</p>"
                                f"<p>Your shift on "
                                f"<strong>{e_shift_date}</strong> "
                                f"has ended. "
                                f"{att_count} member"
                                f"{'s' if att_count != 1 else ''}"
                                " recorded.</p>"
                                "<p>Please review and confirm the "
                                "attendance records and shift timing "
                                "before finalizing.</p>"
                                f"{extra_html}"
                                f'<p style="text-align: center;">'
                                f'<a href="{_html.escape(full_url)}" '
                                f'class="button" role="link">'
                                "Review Shift</a></p>",
                            ),
                            text_body=(
                                f"Hi {officer.first_name},\n\n"
                                f"Your shift on {shift_date_str} "
                                "has ended. "
                                f"{att_count} member"
                                f"{'s' if att_count != 1 else ''}"
                                " recorded.\n\n"
                                "Please review and confirm the "
                                "attendance records and shift timing "
                                "before finalizing.\n\n"
                                f"{extra_text}"
                                f"Review Shift: {full_url}"
                            ),
                        )
                        if sent_count > 0:
                            org_emails += 1
                    except Exception as e:
                        logger.error(
                            "Failed to send post-shift validation email to %s: %s",
                            _redact_email(officer.email),
                            e,
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


async def run_shift_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send start-of-shift reminder notifications to assigned members.

    Runs every 30 minutes. Finds shifts starting within a configurable
    lookahead window (default 2 hours) that haven't already had a
    reminder sent. Each reminder includes the list of equipment check
    templates (checklists) assigned to the shift's apparatus so members
    know what inspections to complete.

    Controlled by org.settings["shift_reminders"]:
      - enabled (bool, default True)
      - lookahead_hours (int, default 2)
      - send_email (bool, default False)
      - cc_emails (list[str], default [])
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import (
        BasicApparatus,
        Shift,
        ShiftAssignment,
        ShiftPosition,
    )
    from app.services.email_service import EmailService

    now = datetime.now(dt_timezone.utc)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_notifications = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_notifications = 0
        org_emails = 0

        try:
            reminder_cfg = (org.settings or {}).get("shift_reminders", {})
            if not reminder_cfg.get("enabled", True):
                continue

            sr_cfg = (org.settings or {}).get("shift_reports", {})
            ct_cfg = sr_cfg.get("checklist_timing", {})
            start_checklists_enabled = ct_cfg.get("start_of_shift_enabled", True)

            lookahead_hours = reminder_cfg.get("lookahead_hours", 2)
            lookahead_end = now + timedelta(hours=lookahead_hours)

            org_tz = ZoneInfo(org.timezone if org.timezone else "America/New_York")

            shifts_result = await db.execute(
                select(Shift)
                .where(Shift.organization_id == str(org.id))
                .where(Shift.start_time.isnot(None))
                .where(Shift.start_time >= now)
                .where(Shift.start_time <= lookahead_end)
            )
            shifts = list(shifts_result.scalars().all())

            for shift in shifts:
                activities = shift.activities or {}
                if activities.get("start_reminder_sent"):
                    continue

                # Fetch assignments for this shift
                assign_result = await db.execute(
                    select(ShiftAssignment)
                    .where(ShiftAssignment.shift_id == str(shift.id))
                    .where(
                        ShiftAssignment.assignment_status.notin_(
                            ["declined", "cancelled"]
                        )
                    )
                )
                assignments = list(assign_result.scalars().all())
                if not assignments:
                    shift.activities = {
                        **activities,
                        "start_reminder_sent": True,
                    }
                    continue

                # Resolve apparatus name
                apparatus_name = None
                if shift.apparatus_id:
                    app_result = await db.execute(
                        select(BasicApparatus.unit_number, BasicApparatus.name).where(
                            BasicApparatus.id == str(shift.apparatus_id)
                        )
                    )
                    row = app_result.one_or_none()
                    if row:
                        unit_number, name = row
                        apparatus_name = (
                            f"{unit_number} \u2014 {name}" if unit_number else name
                        )

                # Resolve roster (member name + position).
                # Exclude inactive users — a member who was assigned to
                # the shift before being deactivated should not receive
                # reminders or appear in the roster sent to others.
                member_ids = [str(a.user_id) for a in assignments if a.user_id]
                roster: list[dict] = []
                user_map: dict = {}
                if member_ids:
                    user_rows = await db.execute(
                        select(User)
                        .where(User.id.in_(member_ids))
                        .where(User.is_active == True)  # noqa: E712
                    )
                    user_map = {str(u.id): u for u in user_rows.scalars().all()}
                for assignment in assignments:
                    user = user_map.get(str(assignment.user_id))
                    if not user:
                        continue
                    pos = assignment.position
                    pos_value = (
                        pos.value if isinstance(pos, ShiftPosition) else str(pos or "")
                    )
                    roster.append(
                        {
                            "user_id": str(assignment.user_id),
                            "name": user.full_name or user.email or "Member",
                            "first_name": user.first_name,
                            "email": user.email,
                            "position": pos_value,
                            "position_label": pos_value.replace("_", " ").title(),
                        }
                    )

                # Fetch equipment check templates for the apparatus
                checklist_names: list[str] = []
                if shift.apparatus_id and start_checklists_enabled:
                    templates = await resolve_check_templates(
                        db,
                        str(org.id),
                        str(shift.apparatus_id),
                        "start_of_shift",
                    )
                    checklist_names = [t.name for t in templates]

                shift_date_str = (
                    shift.shift_date.strftime("%b %d, %Y")
                    if shift.shift_date
                    else "Unknown"
                )
                start_str = (
                    shift.start_time.astimezone(org_tz).strftime("%H:%M")
                    if shift.start_time
                    else ""
                )
                end_str = (
                    shift.end_time.astimezone(org_tz).strftime("%H:%M")
                    if shift.end_time
                    else ""
                )
                time_range = (
                    f"{start_str} \u2013 {end_str}" if start_str and end_str else start_str
                )

                # Build structured in-app message
                msg_lines: list[str] = [
                    f"Your shift on {shift_date_str} starts at {start_str}.",
                ]
                if apparatus_name:
                    msg_lines.append(f"Apparatus: {apparatus_name}")
                if roster:
                    roster_summary = "; ".join(
                        f"{r['name']} ({r['position_label']})" for r in roster[:8]
                    )
                    if len(roster) > 8:
                        roster_summary += f"; +{len(roster) - 8} more"
                    msg_lines.append(f"Crew: {roster_summary}")
                if checklist_names:
                    msg_lines.append(
                        f"Start-of-shift checklists: {', '.join(checklist_names)}"
                    )
                else:
                    msg_lines.append(
                        "No equipment checklists are assigned for this shift."
                    )
                message = "\n".join(msg_lines)

                subject = f"Shift Report \u2014 {shift_date_str} at {start_str}"

                # In-app notification for each assigned member
                check_in_url = f"/scheduling/checkin?shift={shift.id}"
                shift_start_iso = (
                    shift.start_time.isoformat() if shift.start_time else None
                )
                shift_end_iso = shift.end_time.isoformat() if shift.end_time else None
                shift_metadata: dict = {
                    "shift_id": str(shift.id),
                    "apparatus_name": apparatus_name,
                    "time_range": time_range,
                    "checklists": checklist_names,
                    "roster": [
                        {"name": r["name"], "position": r["position_label"]}
                        for r in roster
                    ],
                }
                if shift_start_iso:
                    shift_metadata["shift_start_time"] = shift_start_iso
                if shift_end_iso:
                    shift_metadata["shift_end_time"] = shift_end_iso

                for r in roster:
                    try:
                        notif = NotificationLog(
                            id=generate_uuid(),
                            organization_id=str(org.id),
                            recipient_id=r["user_id"],
                            channel=NotificationChannel.IN_APP,
                            category="shift_reminder",
                            subject=subject,
                            message=message,
                            action_url=check_in_url,
                            notification_metadata=shift_metadata,
                            delivered=True,
                        )
                        db.add(notif)
                        org_notifications += 1
                    except Exception as e:
                        logger.error(
                            f"Failed to create shift reminder notification "
                            f"for user {r['user_id']}, shift {shift.id}: {e}"
                        )

                # Email \u2014 sent by default. Set send_email=False in
                # org.settings["shift_reminders"] to suppress.
                if reminder_cfg.get("send_email", True) and roster:
                    try:
                        from app.services.email_service import wrap_email_body

                        cc_emails = reminder_cfg.get("cc_emails", [])
                        email_svc = EmailService(organization=org)

                        checklist_html = ""
                        if checklist_names:
                            items = "".join(
                                f"<li>{_html.escape(n)}</li>" for n in checklist_names
                            )
                            checklist_html = (
                                "<p><strong>Start-of-shift checklists "
                                "to complete:</strong></p>"
                                f"<ul>{items}</ul>"
                            )
                        else:
                            checklist_html = (
                                "<p><em>No equipment checklists "
                                "are assigned for this shift.</em></p>"
                            )

                        roster_html = ""
                        if roster:
                            roster_rows = "".join(
                                f"<tr><td style='padding:4px 8px'>"
                                f"{_html.escape(r['name'])}</td>"
                                f"<td style='padding:4px 8px;color:#555'>"
                                f"{_html.escape(r['position_label'])}</td></tr>"
                                for r in roster
                            )
                            roster_html = (
                                "<p><strong>Crew roster:</strong></p>"
                                "<table style='border-collapse:collapse;"
                                "margin:0 0 12px 0' role='presentation'>"
                                f"{roster_rows}</table>"
                            )

                        details_rows = []
                        if apparatus_name:
                            details_rows.append(
                                "<tr><td style='padding:2px 8px;color:#555'>"
                                "Apparatus</td>"
                                "<td style='padding:2px 8px'>"
                                f"<strong>{_html.escape(apparatus_name)}"
                                "</strong></td></tr>"
                            )
                        details_rows.append(
                            "<tr><td style='padding:2px 8px;color:#555'>"
                            "Date</td>"
                            f"<td style='padding:2px 8px'><strong>"
                            f"{_html.escape(shift_date_str)}"
                            "</strong></td></tr>"
                        )
                        details_rows.append(
                            "<tr><td style='padding:2px 8px;color:#555'>"
                            "Time</td>"
                            f"<td style='padding:2px 8px'><strong>"
                            f"{_html.escape(time_range)}"
                            "</strong></td></tr>"
                        )
                        details_html = (
                            "<table style='border-collapse:collapse;"
                            "margin:0 0 12px 0' role='presentation'>"
                            + "".join(details_rows)
                            + "</table>"
                        )

                        for r in roster:
                            email = r["email"]
                            if not email:
                                continue
                            e_first = _html.escape(r["first_name"] or "")
                            e_pos = _html.escape(r["position_label"])
                            arrival_url = (
                                f"{settings.FRONTEND_URL}/scheduling/"
                                f"checkin?shift={shift.id}"
                            )
                            try:
                                sent, _ = await email_svc.send_email(
                                    to_emails=[email],
                                    subject=subject,
                                    html_body=wrap_email_body(
                                        org,
                                        "Start-of-Shift Report",
                                        f"<p>Hello {e_first},</p>"
                                        "<p>Your upcoming shift report is "
                                        "below. Please arrive on time and "
                                        "mark your arrival when you get "
                                        "to the station.</p>"
                                        f"{details_html}"
                                        f"<p><strong>Your position:</strong> "
                                        f"{e_pos}</p>"
                                        f"{roster_html}"
                                        f"{checklist_html}"
                                        "<p style='text-align: center;'>"
                                        f"<a href='{_html.escape(arrival_url)}' "
                                        "class='button' role='link'>"
                                        "Mark Arrival</a></p>",
                                    ),
                                    text_body=(
                                        f"Hi {r['first_name'] or ''},\n\n"
                                        f"Start-of-Shift Report\n"
                                        f"Date: {shift_date_str}\n"
                                        f"Time: {time_range}\n"
                                        + (
                                            f"Apparatus: {apparatus_name}\n"
                                            if apparatus_name
                                            else ""
                                        )
                                        + f"Your position: {r['position_label']}\n"
                                        + (
                                            "Crew: "
                                            + ", ".join(
                                                f"{m['name']} "
                                                f"({m['position_label']})"
                                                for m in roster
                                            )
                                            + "\n"
                                            if roster
                                            else ""
                                        )
                                        + (
                                            "Start-of-shift checklists: "
                                            + ", ".join(checklist_names)
                                            + "\n"
                                            if checklist_names
                                            else ""
                                        )
                                        + f"\nMark Arrival: {arrival_url}"
                                    ),
                                    cc_emails=cc_emails or None,
                                    db=db,
                                    template_type="shift_reminder",
                                )
                                if sent > 0:
                                    org_emails += 1
                            except Exception as email_err:
                                logger.error(
                                    "Shift reminder email failed for %s: %s",
                                    _redact_email(email),
                                    email_err,
                                )
                    except Exception as e:
                        logger.error(
                            "Failed to send shift reminder emails for shift %s: %s",
                            shift.id,
                            e,
                        )

                # Mark as sent
                shift.activities = {
                    **activities,
                    "start_reminder_sent": True,
                }

            await db.commit()

        except Exception as e:
            logger.error(f"Shift reminders failed for org {org.id}: {e}")
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
        f"Shift reminders complete: {total_notifications} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "shift_reminders",
        "total_notifications": total_notifications,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


async def run_end_of_shift_checklist_reminders(
    db: AsyncSession,
) -> Dict[str, Any]:
    """
    Remind assigned members about end-of-shift equipment checklists.

    Runs every 30 minutes. Finds shifts ending within a configurable
    lookahead window (default 1 hour) that haven't already had an
    end-of-shift checklist reminder sent. For each shift, determines
    which end-of-shift checklists have NOT yet been submitted and
    notifies assigned members about the outstanding ones.

    Controlled by org.settings["shift_reminders"]:
      - enabled (bool, default True)
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import Shift, ShiftAssignment, ShiftEquipmentCheck

    now = datetime.now(dt_timezone.utc)

    async def process(db_session: AsyncSession, org: Organization) -> int:
        reminder_cfg = (org.settings or {}).get("shift_reminders", {})
        if not reminder_cfg.get("enabled", True):
            return 0

        sr_cfg = (org.settings or {}).get("shift_reports", {})
        ct_cfg = sr_cfg.get("checklist_timing", {})
        if not ct_cfg.get("end_of_shift_enabled", True):
            return 0

        lookahead_end = now + timedelta(hours=1)

        org_tz = ZoneInfo(org.timezone if org.timezone else "America/New_York")

        shifts_result = await db_session.execute(
            select(Shift)
            .where(Shift.organization_id == str(org.id))
            .where(Shift.end_time.isnot(None))
            .where(Shift.end_time >= now)
            .where(Shift.end_time <= lookahead_end)
        )
        shifts = list(shifts_result.scalars().all())

        org_notifications = 0

        for shift in shifts:
            activities = shift.activities or {}
            if activities.get("eos_checklist_reminder_sent"):
                continue

            if not shift.apparatus_id:
                shift.activities = {
                    **activities,
                    "eos_checklist_reminder_sent": True,
                }
                continue

            eos_templates = await resolve_check_templates(
                db_session,
                str(org.id),
                str(shift.apparatus_id),
                "end_of_shift",
            )

            if not eos_templates:
                shift.activities = {
                    **activities,
                    "eos_checklist_reminder_sent": True,
                }
                continue

            tmpl_ids = [str(t.id) for t in eos_templates]
            done_result = await db_session.execute(
                select(ShiftEquipmentCheck.template_id)
                .where(ShiftEquipmentCheck.shift_id == str(shift.id))
                .where(ShiftEquipmentCheck.template_id.in_(tmpl_ids))
            )
            done_ids = {r[0] for r in done_result.all()}
            pending = [t for t in eos_templates if str(t.id) not in done_ids]

            if not pending:
                shift.activities = {
                    **activities,
                    "eos_checklist_reminder_sent": True,
                }
                continue

            pending_names = [t.name for t in pending]
            shift_date_str = (
                shift.shift_date.strftime("%b %d, %Y")
                if shift.shift_date
                else "Unknown"
            )
            end_str = (
                shift.end_time.astimezone(org_tz).strftime("%H:%M")
                if shift.end_time
                else ""
            )

            subject = f"End-of-Shift Checklists Due \u2014 {shift_date_str}"
            checklist_list = ", ".join(pending_names)
            message = (
                f"Your shift on {shift_date_str} ends at "
                f"{end_str}. Please complete the following "
                f"end-of-shift checklists before you leave: "
                f"{checklist_list}."
            )

            assign_result = await db_session.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.shift_id == str(shift.id))
                .where(
                    ShiftAssignment.assignment_status.notin_(["declined", "cancelled"])
                )
            )
            assignments = list(assign_result.scalars().all())
            member_ids = [str(a.user_id) for a in assignments if a.user_id]

            shift_action_url = f"/scheduling?shift={shift.id}&tab=equipment-checks"
            shift_metadata = {
                "shift_id": str(shift.id),
                "reminder_type": "end_of_shift_checklist",
                "shift_start_time": (
                    shift.start_time.isoformat() if shift.start_time else None
                ),
                "shift_end_time": (
                    shift.end_time.isoformat() if shift.end_time else None
                ),
            }

            for mid in member_ids:
                try:
                    notif = NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(org.id),
                        recipient_id=mid,
                        channel=NotificationChannel.IN_APP,
                        category="shift_reminder",
                        subject=subject,
                        message=message,
                        action_url=shift_action_url,
                        notification_metadata=shift_metadata,
                        delivered=True,
                    )
                    db_session.add(notif)
                    org_notifications += 1
                except Exception as e:
                    logger.error(
                        "Failed to create EOS checklist "
                        "reminder for user %s, shift %s: %s",
                        mid,
                        shift.id,
                        e,
                    )

            shift.activities = {
                **activities,
                "eos_checklist_reminder_sent": True,
            }

        await db_session.commit()
        return org_notifications

    return await _for_each_org(db, "end_of_shift_checklist_reminders", process)


async def run_end_of_shift_summary(db: AsyncSession) -> Dict[str, Any]:
    """
    Send each member who attended a shift a personalized end-of-shift
    summary via email AND in-app notification.

    Runs every 30 minutes. Looks for shifts that ended within the last
    configurable window (default 4 hours) and, for each ShiftAttendance
    record on the shift, sends one email + one in-app notification with:
      - shift date, time range, and apparatus
      - hours recorded for the member
      - calls the member responded to
      - link to view their completion report (if filed)

    Per-member dispatch is idempotent: each member's summary is recorded
    in shift.activities["member_summaries_sent"] (a list of user IDs)
    so a member is only emailed once even if the job re-runs.

    Controlled by org.settings["shift_reports"]["member_summary"]:
      - enabled (bool, default True)
      - lookback_hours (int, default 4)
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import (
        BasicApparatus,
        Shift,
        ShiftAttendance,
        ShiftCall,
        ShiftCompletionReport,
    )
    from app.services.email_service import EmailService

    now = datetime.now(dt_timezone.utc)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_notifications = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_notifications = 0
        org_emails = 0

        try:
            sr_cfg = (org.settings or {}).get("shift_reports", {})
            ms_cfg = sr_cfg.get("member_summary", {})
            if not ms_cfg.get("enabled", True):
                continue

            # By default, wait for the officer to finalize the shift
            # before sending the summary — duration_minutes is computed
            # at check-out / finalization, so an unfinalized shift can
            # report 0 hours for members who haven't been checked out
            # yet. Orgs that want preliminary numbers can opt in.
            require_finalized = ms_cfg.get("require_finalized", True)

            lookback_hours = ms_cfg.get("lookback_hours", 4)
            lookback = now - timedelta(hours=lookback_hours)
            org_tz = ZoneInfo(org.timezone if org.timezone else "America/New_York")

            shifts_query = (
                select(Shift)
                .where(Shift.organization_id == str(org.id))
                .where(Shift.end_time.isnot(None))
                .where(Shift.end_time <= now)
                .where(Shift.end_time >= lookback)
            )
            if require_finalized:
                shifts_query = shifts_query.where(
                    Shift.is_finalized == True  # noqa: E712
                )
            shifts_result = await db.execute(shifts_query)
            shifts = list(shifts_result.scalars().all())

            for shift in shifts:
                activities = shift.activities or {}
                already_sent = set(activities.get("member_summaries_sent") or [])

                # Resolve apparatus once per shift
                apparatus_name = None
                if shift.apparatus_id:
                    app_result = await db.execute(
                        select(BasicApparatus.unit_number, BasicApparatus.name).where(
                            BasicApparatus.id == str(shift.apparatus_id)
                        )
                    )
                    row = app_result.one_or_none()
                    if row:
                        unit_number, name = row
                        apparatus_name = (
                            f"{unit_number} — {name}" if unit_number else name
                        )

                # All attendance records for the shift
                att_result = await db.execute(
                    select(ShiftAttendance).where(
                        ShiftAttendance.shift_id == str(shift.id)
                    )
                )
                attendance_records = list(att_result.scalars().all())
                if not attendance_records:
                    continue

                # Pre-load all calls for the shift so we can attribute
                # responses to each member without a per-member query.
                calls_result = await db.execute(
                    select(
                        ShiftCall.responding_members,
                        ShiftCall.incident_type,
                    ).where(ShiftCall.shift_id == str(shift.id))
                )
                shift_calls = list(calls_result.all())

                # Map user_id -> { count, types }
                per_member_calls: dict = {}
                for members, incident_type in shift_calls:
                    if not members:
                        continue
                    for mid in members:
                        bucket = per_member_calls.setdefault(
                            str(mid), {"count": 0, "types": []}
                        )
                        bucket["count"] += 1
                        if incident_type:
                            bucket["types"].append(incident_type)

                # Pre-load completion reports keyed by trainee
                rep_result = await db.execute(
                    select(
                        ShiftCompletionReport.id,
                        ShiftCompletionReport.trainee_id,
                    ).where(ShiftCompletionReport.shift_id == str(shift.id))
                )
                report_by_trainee = {str(r[1]): str(r[0]) for r in rep_result.all()}

                shift_date_str = (
                    shift.shift_date.strftime("%b %d, %Y")
                    if shift.shift_date
                    else "Unknown"
                )
                start_str = (
                    shift.start_time.astimezone(org_tz).strftime("%H:%M")
                    if shift.start_time
                    else ""
                )
                end_str = (
                    shift.end_time.astimezone(org_tz).strftime("%H:%M")
                    if shift.end_time
                    else ""
                )
                time_range = (
                    f"{start_str} – {end_str}" if start_str and end_str else start_str
                )

                # Resolve member users in one query
                user_ids = [str(att.user_id) for att in attendance_records if att.user_id]
                user_rows = await db.execute(
                    select(User).where(User.id.in_(user_ids))
                )
                user_map = {str(u.id): u for u in user_rows.scalars().all()}

                newly_sent: list[str] = []

                for att in attendance_records:
                    uid = str(att.user_id)
                    if uid in already_sent:
                        continue
                    user = user_map.get(uid)
                    if not user or not user.is_active:
                        continue

                    hours = (
                        round((att.duration_minutes or 0) / 60.0, 2)
                        if att.duration_minutes
                        else 0.0
                    )
                    call_info = per_member_calls.get(uid, {"count": 0, "types": []})
                    call_count = call_info["count"]
                    call_types = call_info["types"]
                    report_id = report_by_trainee.get(uid)

                    is_preliminary = not bool(shift.is_finalized)
                    subject_prefix = (
                        "Preliminary Shift Summary"
                        if is_preliminary
                        else "Shift Summary"
                    )
                    subject = f"{subject_prefix} — {shift_date_str}"
                    summary_lines = [
                        f"Your shift on {shift_date_str} ({time_range}) "
                        f"has ended.",
                        f"Hours recorded: {hours}",
                        f"Calls responded: {call_count}",
                    ]
                    if apparatus_name:
                        summary_lines.insert(1, f"Apparatus: {apparatus_name}")
                    if call_types:
                        summary_lines.append(
                            "Call types: " + ", ".join(call_types[:5])
                        )
                    if is_preliminary:
                        summary_lines.append(
                            "These figures are preliminary — your hours "
                            "and call count may change once the shift "
                            "officer finalizes the shift."
                        )
                    if report_id:
                        summary_lines.append(
                            "A shift completion report has been filed for "
                            "you — please review and acknowledge it."
                        )
                    message = "\n".join(summary_lines)

                    action_url = (
                        f"/scheduling?tab=shift-reports&report={report_id}"
                        if report_id
                        else f"/scheduling?shift={shift.id}"
                    )

                    metadata = {
                        "shift_id": str(shift.id),
                        "hours_recorded": hours,
                        "calls_responded": call_count,
                        "call_types": call_types,
                        "apparatus_name": apparatus_name,
                        "report_id": report_id,
                        "is_preliminary": is_preliminary,
                        "shift_start_time": (
                            shift.start_time.isoformat() if shift.start_time else None
                        ),
                        "shift_end_time": (
                            shift.end_time.isoformat() if shift.end_time else None
                        ),
                    }

                    # In-app notification
                    try:
                        notif = NotificationLog(
                            id=generate_uuid(),
                            organization_id=str(org.id),
                            recipient_id=uid,
                            channel=NotificationChannel.IN_APP,
                            category="shift_summary",
                            subject=subject,
                            message=message,
                            action_url=action_url,
                            notification_metadata=metadata,
                            delivered=True,
                        )
                        db.add(notif)
                        org_notifications += 1
                    except Exception as e:
                        logger.error(
                            "Failed end-of-shift in-app summary for user "
                            "%s, shift %s: %s",
                            uid,
                            shift.id,
                            e,
                        )

                    # Email
                    prefs = user.notification_preferences or {}
                    wants_email = prefs.get("email_notifications", True)
                    if wants_email and user.email:
                        try:
                            from app.services.email_service import wrap_email_body

                            full_url = f"{settings.FRONTEND_URL}{action_url}"
                            email_svc = EmailService(organization=org)

                            details_rows = [
                                "<tr><td style='padding:2px 8px;color:#555'>"
                                "Date</td>"
                                f"<td style='padding:2px 8px'><strong>"
                                f"{_html.escape(shift_date_str)}"
                                "</strong></td></tr>",
                                "<tr><td style='padding:2px 8px;color:#555'>"
                                "Time</td>"
                                f"<td style='padding:2px 8px'><strong>"
                                f"{_html.escape(time_range)}"
                                "</strong></td></tr>",
                                "<tr><td style='padding:2px 8px;color:#555'>"
                                "Hours</td>"
                                f"<td style='padding:2px 8px'><strong>"
                                f"{hours}"
                                "</strong></td></tr>",
                                "<tr><td style='padding:2px 8px;color:#555'>"
                                "Calls</td>"
                                f"<td style='padding:2px 8px'><strong>"
                                f"{call_count}"
                                "</strong></td></tr>",
                            ]
                            if apparatus_name:
                                details_rows.insert(
                                    0,
                                    "<tr><td style='padding:2px 8px;color:#555'>"
                                    "Apparatus</td>"
                                    "<td style='padding:2px 8px'><strong>"
                                    f"{_html.escape(apparatus_name)}"
                                    "</strong></td></tr>",
                                )
                            details_html = (
                                "<table style='border-collapse:collapse;"
                                "margin:0 0 12px 0' role='presentation'>"
                                + "".join(details_rows)
                                + "</table>"
                            )

                            call_types_html = ""
                            if call_types:
                                items = "".join(
                                    f"<li>{_html.escape(t)}</li>"
                                    for t in call_types[:10]
                                )
                                call_types_html = (
                                    "<p><strong>Call types:</strong></p>"
                                    f"<ul>{items}</ul>"
                                )

                            report_html = ""
                            if report_id:
                                report_html = (
                                    "<p>A shift completion report has been "
                                    "filed for you. Please review the "
                                    "officer's notes and acknowledge it.</p>"
                                )

                            preliminary_html = ""
                            if is_preliminary:
                                preliminary_html = (
                                    "<p style='background:#fff7ed;"
                                    "border-left:4px solid #f97316;"
                                    "padding:8px 12px;color:#7c2d12'>"
                                    "<strong>Preliminary:</strong> these "
                                    "figures may change once the shift "
                                    "officer finalizes the shift.</p>"
                                )

                            email_title = (
                                "Preliminary End-of-Shift Summary"
                                if is_preliminary
                                else "End-of-Shift Summary"
                            )

                            e_first = _html.escape(user.first_name or "")
                            sent, _ = await email_svc.send_email(
                                to_emails=[user.email],
                                subject=subject,
                                html_body=wrap_email_body(
                                    org,
                                    email_title,
                                    f"<p>Hello {e_first},</p>"
                                    "<p>Your shift has ended. Below is a "
                                    "summary of what was recorded:</p>"
                                    f"{preliminary_html}"
                                    f"{details_html}"
                                    f"{call_types_html}"
                                    f"{report_html}"
                                    "<p style='text-align: center;'>"
                                    f"<a href='{_html.escape(full_url)}' "
                                    "class='button' role='link'>"
                                    "View Shift Details</a></p>",
                                ),
                                text_body=(
                                    f"Hi {user.first_name or ''},\n\n"
                                    f"End-of-Shift Summary\n"
                                    f"Date: {shift_date_str}\n"
                                    f"Time: {time_range}\n"
                                    + (
                                        f"Apparatus: {apparatus_name}\n"
                                        if apparatus_name
                                        else ""
                                    )
                                    + f"Hours recorded: {hours}\n"
                                    f"Calls responded: {call_count}\n"
                                    + (
                                        "Call types: "
                                        + ", ".join(call_types)
                                        + "\n"
                                        if call_types
                                        else ""
                                    )
                                    + (
                                        "\nA shift completion report has been "
                                        "filed for you — please review and "
                                        "acknowledge it.\n"
                                        if report_id
                                        else ""
                                    )
                                    + f"\nView Shift Details: {full_url}"
                                ),
                                db=db,
                                template_type="post_shift_validation",
                            )
                            if sent > 0:
                                org_emails += 1
                        except Exception as email_err:
                            logger.error(
                                "End-of-shift summary email failed for %s: %s",
                                _redact_email(user.email),
                                email_err,
                            )

                    newly_sent.append(uid)

                if newly_sent:
                    shift.activities = {
                        **activities,
                        "member_summaries_sent": list(already_sent | set(newly_sent)),
                    }

            await db.commit()

        except Exception as e:
            logger.error(f"End-of-shift summary failed for org {org.id}: {e}")
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
        f"End-of-shift summary complete: {total_notifications} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "end_of_shift_summary",
        "total_notifications": total_notifications,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


async def run_trainee_report_escalation(db: AsyncSession) -> Dict[str, Any]:
    """
    Escalate shift completion reports awaiting trainee acknowledgment.

    Runs daily. For each approved ShiftCompletionReport that has not been
    acknowledged by the trainee within N days (default 7), send an
    escalation reminder to the trainee AND notify the filing officer plus
    training officers that the trainee is overdue.

    Controlled by org.settings["shift_reports"]["follow_up"]:
      - enabled (bool, default True)
      - acknowledgment_days (int, default 7)
      - max_reminders (int, default 3) — stop reminding after N reminders
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone

    from app.core.config import settings
    from app.core.constants import ROLE_TRAINING_OFFICER
    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import ShiftCompletionReport
    from app.models.user import Role, user_roles
    from app.services.email_service import EmailService, wrap_email_body

    now = datetime.now(dt_timezone.utc)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_escalations = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_escalations = 0
        org_emails = 0

        try:
            sr_cfg = (org.settings or {}).get("shift_reports", {})
            fu_cfg = sr_cfg.get("follow_up", {})
            if not fu_cfg.get("enabled", True):
                continue

            ack_days = int(fu_cfg.get("acknowledgment_days", 7))
            max_reminders = int(fu_cfg.get("max_reminders", 3))
            cutoff = now - timedelta(days=ack_days)

            # Find unacknowledged approved reports created before cutoff
            rep_result = await db.execute(
                select(ShiftCompletionReport)
                .where(ShiftCompletionReport.organization_id == str(org.id))
                .where(ShiftCompletionReport.review_status == "approved")
                .where(ShiftCompletionReport.trainee_acknowledged == False)  # noqa: E712
                .where(ShiftCompletionReport.created_at <= cutoff)
            )
            reports = list(rep_result.scalars().all())
            if not reports:
                continue

            # Resolve training officers for the org once
            t_role_result = await db.execute(
                select(Role)
                .where(Role.slug == ROLE_TRAINING_OFFICER)
                .where(Role.organization_id == str(org.id))
            )
            t_role = t_role_result.scalar_one_or_none()
            training_officers: list = []
            if t_role:
                t_users = await db.execute(
                    select(User)
                    .join(user_roles, User.id == user_roles.c.user_id)
                    .where(user_roles.c.position_id == t_role.id)
                    .where(User.organization_id == str(org.id))
                    .where(User.is_active == True)  # noqa: E712
                )
                training_officers = list(t_users.scalars().all())

            email_svc = EmailService(organization=org)

            for report in reports:
                # Track reminder count via review_history JSON
                history = list(report.review_history or [])
                reminders_sent = sum(
                    1 for entry in history if entry.get("status") == "ack_reminder"
                )
                if reminders_sent >= max_reminders:
                    continue

                trainee = report.trainee
                officer = report.officer
                if not trainee:
                    continue

                shift_date_str = (
                    report.shift_date.strftime("%b %d, %Y")
                    if report.shift_date
                    else "Unknown"
                )
                report_url = (
                    f"/scheduling?tab=shift-reports&report={report.id}"
                )
                full_url = f"{settings.FRONTEND_URL}{report_url}"
                trainee_subject = (
                    f"Reminder: Acknowledge your shift report from {shift_date_str}"
                )
                trainee_message = (
                    f"You have a shift completion report from "
                    f"{shift_date_str} that needs your acknowledgment. "
                    f"Please review and confirm so your training "
                    f"progress can be finalized."
                )

                # Reminder to trainee — in-app + email
                try:
                    db.add(
                        NotificationLog(
                            id=generate_uuid(),
                            organization_id=str(org.id),
                            recipient_id=str(trainee.id),
                            channel=NotificationChannel.IN_APP,
                            category="shift_report_followup",
                            subject=trainee_subject,
                            message=trainee_message,
                            action_url=report_url,
                            notification_metadata={
                                "report_id": str(report.id),
                                "reminder_number": reminders_sent + 1,
                            },
                            delivered=True,
                        )
                    )
                    org_escalations += 1
                except Exception as e:
                    logger.error(
                        "Failed in-app trainee escalation for report %s: %s",
                        report.id,
                        e,
                    )

                if trainee.email:
                    try:
                        e_first = _html.escape(trainee.first_name or "")
                        e_date = _html.escape(shift_date_str)
                        sent, _ = await email_svc.send_email(
                            to_emails=[trainee.email],
                            subject=trainee_subject,
                            html_body=wrap_email_body(
                                org,
                                "Action Required: Acknowledge Shift Report",
                                f"<p>Hello {e_first},</p>"
                                f"<p>You have a shift completion report "
                                f"from <strong>{e_date}</strong> awaiting "
                                "your acknowledgment.</p>"
                                "<p>Reviewing and acknowledging the report "
                                "lets your training progress be finalized.</p>"
                                "<p style='text-align: center;'>"
                                f"<a href='{_html.escape(full_url)}' "
                                "class='button' role='link'>"
                                "Review Report</a></p>",
                            ),
                            text_body=(
                                f"Hi {trainee.first_name or ''},\n\n"
                                f"{trainee_message}\n\n"
                                f"Review Report: {full_url}"
                            ),
                            db=db,
                            template_type="post_shift_validation",
                        )
                        if sent > 0:
                            org_emails += 1
                    except Exception as e:
                        logger.error(
                            "Failed trainee escalation email for %s: %s",
                            _redact_email(trainee.email),
                            e,
                        )

                # Notify officer + training officers (in-app only, to avoid
                # spamming them with one email per overdue report)
                officer_subject = (
                    f"Trainee report unacknowledged — {shift_date_str}"
                )
                officer_message = (
                    f"{trainee.full_name or trainee.email or 'Trainee'} "
                    f"has not acknowledged the shift report you filed for "
                    f"{shift_date_str} ({ack_days}+ days overdue)."
                )
                officer_recipients = set()
                if officer:
                    officer_recipients.add(str(officer.id))
                for to_user in training_officers:
                    officer_recipients.add(str(to_user.id))
                officer_recipients.discard(str(trainee.id))

                for rid in officer_recipients:
                    try:
                        db.add(
                            NotificationLog(
                                id=generate_uuid(),
                                organization_id=str(org.id),
                                recipient_id=rid,
                                channel=NotificationChannel.IN_APP,
                                category="shift_report_followup",
                                subject=officer_subject,
                                message=officer_message,
                                action_url=report_url,
                                notification_metadata={
                                    "report_id": str(report.id),
                                    "trainee_id": str(trainee.id),
                                    "days_overdue": ack_days,
                                },
                                delivered=True,
                            )
                        )
                    except Exception as e:
                        logger.error(
                            "Failed officer escalation notification "
                            "for report %s, recipient %s: %s",
                            report.id,
                            rid,
                            e,
                        )

                # Append to review_history so we can rate-limit
                history.append(
                    {
                        "status": "ack_reminder",
                        "timestamp": now.isoformat(),
                        "reminder_number": reminders_sent + 1,
                    }
                )
                report.review_history = history

            await db.commit()

        except Exception as e:
            logger.error(f"Trainee report escalation failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})
            continue

        total_escalations += org_escalations
        total_emails += org_emails
        if org_escalations > 0:
            results.append(
                {
                    "org_id": str(org.id),
                    "escalations": org_escalations,
                    "emails_sent": org_emails,
                }
            )

    logger.info(
        f"Trainee report escalation complete: {total_escalations} reports, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "trainee_report_escalation",
        "total_escalations": total_escalations,
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

    from app.core.audit import audit_logger, log_audit_event, verify_audit_log_integrity
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
    """Process pending scheduled emails that are due to be sent.

    Uses a Redis lock to prevent concurrent execution when overlapping
    cron triggers fire (e.g. two workers processing the same batch).
    """
    from app.core.cache import cache_manager

    # Acquire a Redis lock to prevent concurrent execution
    lock_key = "lock:run_scheduled_emails"
    lock_ttl = 120  # 2 minutes max (loop runs every 60s)
    if cache_manager.is_connected and cache_manager.redis_client:
        acquired = await cache_manager.redis_client.set(
            lock_key, "1", nx=True, ex=lock_ttl
        )
        if not acquired:
            logger.info("Scheduled emails: skipped (another instance is running)")
            return {"sent": 0, "failed": 0, "total_processed": 0, "skipped": True}
    else:
        logger.warning("Scheduled emails: Redis unavailable, running without lock")

    try:
        return await _run_scheduled_emails_inner(db)
    finally:
        # Release the lock
        if cache_manager.is_connected and cache_manager.redis_client:
            try:
                await cache_manager.redis_client.delete(lock_key)
            except Exception:
                pass


async def _run_scheduled_emails_inner(db: AsyncSession) -> Dict[str, Any]:
    """Inner implementation for run_scheduled_emails (after lock acquired)."""
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    from sqlalchemy.orm import selectinload

    from app.models.email_template import ScheduledEmail, ScheduledEmailStatus
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
            if not org:
                logger.warning(
                    "Scheduled email %s skipped: org %s not found",
                    item.id,
                    item.organization_id,
                )
                item.status = ScheduledEmailStatus.FAILED
                item.error_message = "Organization no longer exists"
                failed += 1
                continue
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
                logger.warning(
                    "Scheduled email %s skipped: no template for type %s in org %s",
                    item.id,
                    item.template_type,
                    item.organization_id,
                )
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

            # Check if email is actually enabled before attempting send
            from app.core.config import settings as _settings

            org_email_enabled = org and (org.settings or {}).get(
                "email_service", {}
            ).get("enabled")
            if not _settings.EMAIL_ENABLED and not org_email_enabled:
                logger.warning(
                    "Scheduled email %s skipped: email sending "
                    "is disabled (EMAIL_ENABLED=false and no org override)",
                    item.id,
                )
                item.status = ScheduledEmailStatus.FAILED
                item.error_message = (
                    "Email sending is disabled. Enable EMAIL_ENABLED or "
                    "configure organization email settings."
                )
                failed += 1
                continue

            success_count, _ = await email_svc.send_email(
                to_emails=item.to_emails,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                cc_emails=cc,
                bcc_emails=bcc,
                db=db,
                template_type=(
                    item.template_type.value if item.template_type else "scheduled"
                ),
            )

            if success_count > 0:
                item.status = ScheduledEmailStatus.SENT
                item.sent_at = now
                sent += 1
            else:
                item.status = ScheduledEmailStatus.FAILED
                item.error_message = "Email delivery failed for all recipients"
                failed += 1

        except Exception as e:
            logger.error("Failed to send scheduled email {}: {}", item.id, e)
            item.status = ScheduledEmailStatus.FAILED
            item.error_message = str(e)[:500]
            failed += 1

    if pending:
        await db.commit()

    logger.info(
        "Scheduled emails processed: {} sent, {} failed, {} total",
        sent,
        failed,
        len(pending),
    )
    return {"sent": sent, "failed": failed, "total_processed": len(pending)}


async def run_message_history_cleanup(db: AsyncSession) -> Dict[str, Any]:
    """
    Delete message history records older than 90 days.

    Prevents unbounded growth of the message_history table. Runs daily at 03:00.
    Deletes in batches to avoid long-running transactions.
    """
    from datetime import timedelta, timezone

    from sqlalchemy import delete, func

    from app.models.email_template import MessageHistory

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)

    # Count before deleting (for reporting)
    count_result = await db.execute(
        select(func.count())
        .select_from(MessageHistory)
        .where(MessageHistory.sent_at < cutoff)
    )
    total_expired = count_result.scalar() or 0

    if total_expired == 0:
        logger.info("Message history cleanup: no expired records to delete")
        return {
            "task": "message_history_cleanup",
            "deleted": 0,
            "cutoff_date": cutoff.isoformat(),
        }

    # Delete in batches of 1000 to avoid locking the table for too long
    deleted = 0
    batch_size = 1000
    while True:
        # Find IDs to delete in this batch
        batch_ids_result = await db.execute(
            select(MessageHistory.id)
            .where(MessageHistory.sent_at < cutoff)
            .limit(batch_size)
        )
        batch_ids = [row[0] for row in batch_ids_result.all()]
        if not batch_ids:
            break

        await db.execute(delete(MessageHistory).where(MessageHistory.id.in_(batch_ids)))
        await db.commit()
        deleted += len(batch_ids)

        if len(batch_ids) < batch_size:
            break

    logger.info(
        f"Message history cleanup: deleted {deleted} records older than {cutoff.date()}"
    )
    return {
        "task": "message_history_cleanup",
        "deleted": deleted,
        "cutoff_date": cutoff.isoformat(),
    }


async def run_inventory_low_stock_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts to admins when inventory items drop below reorder point.
    Daily at 07:00.
    """
    from app.services.email_service import EmailService
    from app.services.inventory_service import InventoryService

    async def process(db_session: AsyncSession, org: Organization) -> int:
        service = InventoryService(db_session)
        low_stock = await service.get_low_stock_items_for_alerts(org.id)
        if not low_stock:
            return 0

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

        from app.services.email_service import wrap_email_body

        table_html = (
            '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
            "<thead>"
            '<tr style="background:#f3f4f6;">'
            '<th style="padding:8px 12px;text-align:left;">Item</th>'
            '<th style="padding:8px 12px;text-align:left;">Category</th>'
            '<th style="padding:8px 12px;text-align:center;">Current Qty</th>'
            '<th style="padding:8px 12px;text-align:center;">Reorder Point</th>'
            "</tr></thead>"
            f"<tbody>{items_html}</tbody></table>"
        )
        html_body = wrap_email_body(
            org,
            "Low Stock Alert",
            "<p>The following inventory items are at or below their reorder point:</p>"
            f"{table_html}"
            "<p>Please review and reorder as needed.</p>",
            header_color="#dc2626",
        )

        admin_result = await db_session.execute(
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

        alerts_sent = 0
        if admin_emails:
            email_svc = EmailService(organization=org)
            success_count, _ = await email_svc.send_email(
                to_emails=admin_emails,
                subject=f"Low Stock Alert — {len(low_stock)} item(s) below reorder point",
                html_body=html_body,
                text_body=(
                    f"{len(low_stock)} inventory items are below their "
                    f"reorder point. Please check the inventory dashboard."
                ),
            )
            if success_count > 0:
                alerts_sent += 1

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
                    logger.info(
                        f"Low stock SMS sent to {sms_sent}/"
                        f"{len(admin_phones)} admins for org {org.id}"
                    )
        except Exception as sms_err:
            logger.warning(f"SMS low stock alerts failed for org {org.id}: {sms_err}")

        return alerts_sent

    return await _for_each_org(db, "inventory_low_stock_alerts", process)


async def run_inventory_overdue_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts for overdue checkouts. Daily at 07:30.
    Notifies both the member who has the overdue item and admins.
    """
    from zoneinfo import ZoneInfo

    from app.services.email_service import EmailService
    from app.services.inventory_service import InventoryService

    async def process(db_session: AsyncSession, org: Organization) -> int:
        service = InventoryService(db_session)
        overdue = await service.get_overdue_checkouts_for_alerts(org.id)
        if not overdue:
            return 0

        org_tz = ZoneInfo(org.timezone if org.timezone else "America/New_York")

        by_user: Dict[str, list] = {}
        for co in overdue:
            uid = str(co.user_id)
            if uid not in by_user:
                by_user[uid] = []
            by_user[uid].append(co)

        from app.services.email_service import wrap_email_body

        email_svc = EmailService(organization=org)
        alerts_sent = 0

        for uid, user_checkouts in by_user.items():
            user_obj = user_checkouts[0].user if user_checkouts[0].user else None
            if not user_obj or not user_obj.email:
                continue

            items_list = ""
            for co in user_checkouts:
                item_name = co.item.name if co.item else "Unknown"
                due_date = (
                    co.expected_return_at.astimezone(org_tz).strftime("%B %d, %Y")
                    if co.expected_return_at
                    else "N/A"
                )
                items_list += (
                    f"<li><strong>{_html.escape(item_name)}</strong>"
                    f" — due {due_date}</li>"
                )

            html_body = wrap_email_body(
                org,
                "Overdue Equipment",
                f"<p>Hello {_html.escape(user_obj.first_name or 'Member')},</p>"
                f"<p>The following items are overdue for return:</p>"
                f'<ul style="margin:16px 0;">{items_list}</ul>'
                f"<p>Please return these items as soon as possible.</p>",
                header_color="#dc2626",
            )

            success_count, _ = await email_svc.send_email(
                to_emails=[user_obj.email],
                subject=(
                    f"Overdue Equipment Reminder" f" — {len(user_checkouts)} item(s)"
                ),
                html_body=html_body,
                text_body=(
                    f"You have {len(user_checkouts)} overdue equipment"
                    f" item(s). Please return them as soon as possible."
                ),
            )
            if success_count > 0:
                alerts_sent += 1

        return alerts_sent

    return await _for_each_org(db, "inventory_overdue_alerts", process)


async def run_nfpa_retirement_alerts(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email alerts for PPE approaching NFPA 10-year retirement.
    Weekly on Mondays at 08:00.
    Tiers: 180 days, 90 days, 30 days, past due.
    """
    from app.services.email_service import EmailService
    from app.services.inventory_service import InventoryService

    async def process(db_session: AsyncSession, org: Organization) -> int:
        service = InventoryService(db_session)
        items_due = await service.get_nfpa_retirement_due_items(
            organization_id=org.id,
            days_ahead=180,
        )
        if not items_due:
            return 0

        past_due = [i for i in items_due if i["days_until_retirement"] <= 0]
        within_30 = [i for i in items_due if 0 < i["days_until_retirement"] <= 30]
        within_90 = [i for i in items_due if 30 < i["days_until_retirement"] <= 90]
        within_180 = [i for i in items_due if 90 < i["days_until_retirement"] <= 180]

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

        from app.services.email_service import wrap_email_body

        html_body = wrap_email_body(
            org,
            "NFPA 1851 Retirement Alert",
            f"<p>{len(items_due)} PPE item(s) are approaching or past their retirement date:</p>"
            f'{_build_section("Past Due — Retire Immediately", past_due, "#dc2626")}'
            f'{_build_section("Within 30 Days", within_30, "#ea580c")}'
            f'{_build_section("Within 90 Days", within_90, "#ca8a04")}'
            f'{_build_section("Within 180 Days", within_180, "#2563eb")}'
            f'<p style="color:#6b7280;font-size:14px;margin-top:16px;">'
            f"Per NFPA 1851, structural firefighting PPE must be retired "
            f"10 years from manufacture date."
            f"</p>",
            header_color="#dc2626",
        )

        admin_result = await db_session.execute(
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
                subject=(f"NFPA Retirement Alert" f" — {len(items_due)} PPE item(s)"),
                html_body=html_body,
                text_body=(
                    f"{len(items_due)} PPE items are approaching NFPA"
                    f" retirement. Please check the inventory dashboard."
                ),
            )
            if success_count > 0:
                return 1

        return 0

    return await _for_each_org(db, "nfpa_retirement_alerts", process)


async def run_compliance_auto_reports(db: AsyncSession) -> Dict[str, Any]:
    """Generate and email scheduled compliance reports for all organizations.

    Checks each organization's compliance config for auto_report_frequency.
    On the configured report_day_of_month, generates monthly reports.
    On January 1st, generates yearly reports.
    """
    from datetime import timezone as _tz_compliance

    from app.models.compliance_config import ComplianceConfig
    from app.services.compliance_config_service import ComplianceReportService

    today = datetime.now(_tz_compliance.utc)
    results = []
    total_generated = 0

    configs = await db.execute(
        select(ComplianceConfig).where(ComplianceConfig.auto_report_frequency != "none")
    )
    all_configs = list(configs.scalars().all())

    for config in all_configs:
        try:
            freq = config.auto_report_frequency
            report_day = config.report_day_of_month or 1
            org_id = str(config.organization_id)

            should_generate_monthly = (
                freq in ("monthly", "quarterly") and today.day == report_day
            )
            # For quarterly, only generate on quarter months
            if freq == "quarterly" and today.month not in (1, 4, 7, 10):
                should_generate_monthly = False

            should_generate_yearly = (
                freq == "yearly" and today.month == 1 and today.day == report_day
            )

            service = ComplianceReportService(db)

            if should_generate_monthly:
                # Generate for the previous month
                prev_month = today.month - 1 if today.month > 1 else 12
                prev_year = today.year if today.month > 1 else today.year - 1
                await service.generate_report(
                    organization_id=org_id,
                    report_type="monthly",
                    year=prev_year,
                    month=prev_month,
                    send_email=True,
                )
                total_generated += 1
                results.append(
                    {
                        "org_id": org_id,
                        "type": "monthly",
                        "period": f"{prev_year}-{prev_month:02d}",
                    }
                )

            if should_generate_yearly:
                prev_year = today.year - 1
                await service.generate_report(
                    organization_id=org_id,
                    report_type="yearly",
                    year=prev_year,
                    send_email=True,
                )
                total_generated += 1
                results.append(
                    {
                        "org_id": org_id,
                        "type": "yearly",
                        "period": str(prev_year),
                    }
                )

        except Exception as e:
            logger.error(
                f"Compliance auto-report failed for org {config.organization_id}: {e}"
            )
            results.append(
                {
                    "org_id": str(config.organization_id),
                    "error": str(e),
                }
            )

    await db.commit()

    logger.info(f"Compliance auto-reports: {total_generated} reports generated")
    return {
        "task": "compliance_auto_reports",
        "total_generated": total_generated,
        "details": results,
    }


async def run_series_end_reminders(db: AsyncSession) -> Dict[str, Any]:
    """
    Send email reminders 6 months before a recurring event series ends.

    Queries all parent recurring events whose recurrence_end_date falls
    within the next 6 months (180 days). For each, sends an email to
    users with events.manage permission so they can extend or modify the
    series before it expires.

    Tracks sent reminders in custom_fields.series_end_reminder_sent to
    ensure each series only triggers one notification.
    """
    import copy
    from datetime import timedelta
    from datetime import timezone as dt_timezone
    from zoneinfo import ZoneInfo

    from sqlalchemy.orm import selectinload

    from app.core.config import settings
    from app.core.utils import generate_uuid
    from app.models.email_template import EmailTemplateType
    from app.models.event import Event
    from app.models.notification import NotificationChannel, NotificationLog
    from app.services.email_service import EmailService
    from app.services.email_template_service import EmailTemplateService

    now = datetime.now(dt_timezone.utc)
    six_months_from_now = now + timedelta(days=180)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_reminders = 0
    total_emails = 0
    results = []

    for org in organizations:
        org_reminders = 0
        org_emails = 0

        try:
            org_tz_name = org.timezone or "America/New_York"
            try:
                org_tz = ZoneInfo(org_tz_name)
            except Exception:
                org_tz = ZoneInfo("America/New_York")

            # Find parent recurring events whose series ends within 6 months
            events_result = await db.execute(
                select(Event)
                .options(selectinload(Event.recurrence_children))
                .where(Event.organization_id == str(org.id))
                .where(Event.is_recurring == True)  # noqa: E712
                .where(Event.is_cancelled == False)  # noqa: E712
                .where(Event.recurrence_parent_id.is_(None))
                .where(Event.recurrence_end_date.isnot(None))
                .where(Event.recurrence_end_date > now)
                .where(Event.recurrence_end_date <= six_months_from_now)
                .where(Event.created_by.isnot(None))
            )
            events = list(events_result.scalars().all())

            if not events:
                continue

            email_service = EmailService(organization=org)
            template_service = EmailTemplateService(db)

            for event in events:
                custom = event.custom_fields or {}
                if custom.get("series_end_reminder_sent"):
                    continue

                # Notify the event creator
                creator_result = await db.execute(
                    select(User).where(
                        User.id == event.created_by,
                        User.is_active == True,  # noqa: E712
                    )
                )
                creator = creator_result.scalar_one_or_none()
                if not creator:
                    continue

                # Count remaining future occurrences
                remaining = sum(
                    1
                    for child in (event.recurrence_children or [])
                    if not child.is_cancelled
                    and child.start_datetime
                    and child.start_datetime > now
                )
                # Include parent if it's in the future
                if (
                    not event.is_cancelled
                    and event.start_datetime
                    and event.start_datetime > now
                ):
                    remaining += 1

                recurrence_pattern_val = (
                    (
                        event.recurrence_pattern.value
                        if hasattr(event.recurrence_pattern, "value")
                        else event.recurrence_pattern
                    )
                    if event.recurrence_pattern
                    else "unknown"
                )
                pattern_label = recurrence_pattern_val.replace("_", " ").title()

                end_date_local = event.recurrence_end_date.astimezone(org_tz)
                series_end_str = end_date_local.strftime("%B %d, %Y")

                event_url = f"{settings.FRONTEND_URL}/events/{event.id}"

                # Try to load custom template
                template = await template_service.get_template(
                    str(org.id),
                    EmailTemplateType.SERIES_END_REMINDER,
                )

                prefs = creator.notification_preferences or {}
                user_name = f"{creator.first_name} {creator.last_name}"

                # In-app notification
                try:
                    in_app_log = NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(org.id),
                        recipient_id=str(creator.id),
                        channel=NotificationChannel.IN_APP,
                        category="series_end_reminder",
                        subject=(f"Recurring series ending soon: {event.title}"),
                        message=(
                            f'The recurring event series "{event.title}" '
                            f"({pattern_label}) ends on {series_end_str} "
                            f"with {remaining} occurrence(s) remaining."
                        ),
                        delivered=True,
                    )
                    db.add(in_app_log)
                    org_reminders += 1
                except Exception as e:
                    logger.error(
                        f"Failed to create series-end in-app notification "
                        f"for user {creator.id}: {e}"
                    )

                # Email notification
                wants_email = prefs.get("email_notifications", True)
                wants_reminders = prefs.get("event_reminders", True)
                if wants_reminders and wants_email and creator.email:
                    try:
                        context = {
                            "recipient_name": user_name,
                            "event_title": event.title,
                            "recurrence_pattern": pattern_label,
                            "series_end_date": series_end_str,
                            "remaining_occurrences": str(remaining),
                            "event_url": event_url,
                        }

                        if template:
                            subject, html_body, text_body = template_service.render(
                                template, context, org
                            )
                        else:
                            from app.services.email_template_service import (
                                DEFAULT_SERIES_END_REMINDER_HTML,
                                DEFAULT_SERIES_END_REMINDER_SUBJECT,
                                DEFAULT_SERIES_END_REMINDER_TEXT,
                            )

                            subject = DEFAULT_SERIES_END_REMINDER_SUBJECT
                            html_body = DEFAULT_SERIES_END_REMINDER_HTML
                            text_body = DEFAULT_SERIES_END_REMINDER_TEXT
                            for key, val in context.items():
                                placeholder = "{{" + key + "}}"
                                subject = subject.replace(placeholder, val)
                                html_body = html_body.replace(placeholder, val)
                                text_body = text_body.replace(placeholder, val)

                        success, _ = await email_service.send_email(
                            to_emails=[creator.email],
                            subject=subject,
                            html_body=html_body,
                            text_body=text_body,
                            db=db,
                            template_type="series_end_reminder",
                        )
                        if success > 0:
                            org_emails += 1
                    except Exception as e:
                        logger.error(
                            "Failed to send series-end email to %s: %s",
                            _redact_email(creator.email),
                            e,
                        )

                # Mark reminder as sent using deep copy to avoid
                # SQLAlchemy shallow-copy pitfall with JSON columns
                updated_custom = copy.deepcopy(custom)
                updated_custom["series_end_reminder_sent"] = True
                event.custom_fields = updated_custom

            await db.commit()

        except Exception as e:
            logger.error(f"Series end reminders failed for org {org.id}: {e}")
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
        f"Series end reminders complete: {total_reminders} in-app, "
        f"{total_emails} emails across {len(organizations)} orgs"
    )
    return {
        "task": "series_end_reminders",
        "total_in_app_reminders": total_reminders,
        "total_emails_sent": total_emails,
        "organizations": results,
    }


async def run_rolling_recurrence_extend(db: AsyncSession) -> Dict[str, Any]:
    """
    Extend rolling recurring event series to maintain a 12-month horizon.

    For each parent event with rolling_recurrence=True, check the latest
    child occurrence. If the horizon is less than 12 months away, generate
    new occurrences to fill the gap.
    """
    from app.models.event import Event, RecurrencePattern
    from app.services.event_service import EventService

    now = datetime.now()
    twelve_months = now.replace(year=now.year + 1)

    # Find all rolling parent events (not cancelled)
    result = await db.execute(
        select(Event).where(
            Event.rolling_recurrence.is_(True),
            Event.is_recurring.is_(True),
            Event.recurrence_parent_id.is_(None),
            Event.is_cancelled.is_(False),
        )
    )
    parents = list(result.scalars().all())

    total_created = 0
    series_extended = 0
    errors = []

    service = EventService(db)

    for parent in parents:
        try:
            # Find the latest occurrence in this series
            latest_result = await db.execute(
                select(Event.start_datetime, Event.end_datetime)
                .where(
                    (Event.id == parent.id) | (Event.recurrence_parent_id == parent.id),
                    Event.is_cancelled.is_(False),
                )
                .order_by(Event.start_datetime.desc())
                .limit(1)
            )
            latest = latest_result.first()
            if not latest:
                continue

            latest_start = latest[0]
            latest_end = latest[1]

            # If the latest occurrence is already 12+ months out, skip
            if latest_start >= twelve_months:
                continue

            # Generate new occurrences from the day after the latest
            # through 12 months from now
            pattern = (
                parent.recurrence_pattern.value if parent.recurrence_pattern else None
            )
            if not pattern:
                continue

            # Calculate next occurrence after the latest one
            new_occurrences = service._generate_recurrence_dates(
                start_datetime=latest_start,
                end_datetime=latest_end,
                pattern=pattern,
                recurrence_end_date=twelve_months,
                custom_days=parent.recurrence_custom_days,
                weekday=parent.recurrence_weekday,
                week_ordinal=parent.recurrence_week_ordinal,
                month=parent.recurrence_month,
                exceptions=parent.recurrence_exceptions,
            )

            # Filter out the first one (it's the latest existing occurrence)
            # and any that already exist
            new_occurrences = [(s, e) for s, e in new_occurrences if s > latest_start]

            if not new_occurrences:
                continue

            # Build a set of field values from the parent for child events
            child_fields = {}
            for field in (
                "title",
                "description",
                "event_type",
                "custom_category",
                "location_id",
                "location",
                "location_details",
                "requires_rsvp",
                "max_attendees",
                "is_mandatory",
                "allow_guests",
                "send_reminders",
                "reminder_schedule",
                "check_in_window_type",
                "check_in_minutes_before",
                "check_in_minutes_after",
                "require_checkout",
                "allowed_rsvp_statuses",
                "is_draft",
            ):
                val = getattr(parent, field, None)
                if val is not None:
                    child_fields[field] = val

            for start, end in new_occurrences:
                child = Event(
                    organization_id=parent.organization_id,
                    created_by=parent.created_by,
                    is_recurring=True,
                    recurrence_parent_id=parent.id,
                    recurrence_pattern=RecurrencePattern(pattern),
                    start_datetime=start,
                    end_datetime=end,
                    **child_fields,
                )
                db.add(child)
                total_created += 1

            # Update the parent's recurrence_end_date to the new horizon
            parent.recurrence_end_date = twelve_months

            series_extended += 1

        except Exception as e:
            logger.error(f"Failed to extend rolling series {parent.id}: {e}")
            errors.append({"event_id": parent.id, "error": str(e)})

    if total_created > 0:
        await db.commit()

    logger.info(
        f"Rolling recurrence extend: {series_extended} series extended, "
        f"{total_created} new occurrences created"
    )

    return {
        "task": "rolling_recurrence_extend",
        "series_extended": series_extended,
        "total_created": total_created,
        "errors": errors,
    }


async def run_shift_auto_checkout(db: AsyncSession) -> Dict[str, Any]:
    """
    Two-phase end-of-shift checkout automation:
    1. When a shift ends, send a checkout reminder to members still
       checked in (but not yet checked out).
    2. 30 minutes after shift end, auto-checkout any members who
       still haven't checked out manually.

    Tracks state via the shift's activities JSON to avoid duplicate
    reminders.  Runs every 15 minutes.
    """
    from datetime import timedelta
    from datetime import timezone as dt_timezone

    from app.core.utils import generate_uuid
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import Shift, ShiftAttendance

    now = datetime.now(dt_timezone.utc)
    lookback = now - timedelta(hours=2)
    grace_cutoff = now - timedelta(minutes=30)

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_reminders = 0
    total_auto_checkouts = 0
    results = []

    for org in organizations:
        org_reminders = 0
        org_checkouts = 0

        try:
            shifts_result = await db.execute(
                select(Shift)
                .where(Shift.organization_id == str(org.id))
                .where(Shift.end_time.isnot(None))
                .where(Shift.end_time <= now)
                .where(Shift.end_time >= lookback)
            )
            shifts = list(shifts_result.scalars().all())

            for shift in shifts:
                activities = shift.activities or {}

                # Find members still checked in (no checkout time)
                att_result = await db.execute(
                    select(ShiftAttendance).where(
                        ShiftAttendance.shift_id == str(shift.id),
                        ShiftAttendance.checked_in_at.isnot(None),
                        ShiftAttendance.checked_out_at.is_(None),
                    )
                )
                open_attendances = list(att_result.scalars().all())

                if not open_attendances:
                    continue

                # Phase 1: Send checkout reminder at shift end
                if not activities.get("checkout_reminder_sent"):
                    for att in open_attendances:
                        try:
                            shift_date_str = (
                                shift.shift_date.strftime("%b %d")
                                if shift.shift_date
                                else "today"
                            )
                            notif = NotificationLog(
                                id=generate_uuid(),
                                organization_id=str(org.id),
                                recipient_id=str(att.user_id),
                                channel=NotificationChannel.IN_APP,
                                category="shift_checkout_reminder",
                                subject="Reminder: Check out of your shift",
                                message=(
                                    f"Your shift on {shift_date_str} has "
                                    f"ended. Please check out to record "
                                    f"your hours accurately."
                                ),
                                action_url=(f"/scheduling?shift={shift.id}"),
                                notification_metadata={
                                    "shift_id": str(shift.id),
                                },
                                delivered=True,
                            )
                            db.add(notif)
                            org_reminders += 1
                        except Exception as e:
                            logger.error(
                                "Failed to send checkout reminder "
                                "for user %s shift %s: %s",
                                att.user_id,
                                shift.id,
                                e,
                            )

                    shift.activities = {
                        **activities,
                        "checkout_reminder_sent": True,
                    }

                # Phase 2: Auto-checkout after 30-min grace period
                if (
                    shift.end_time
                    and shift.end_time <= grace_cutoff
                    and not activities.get("auto_checkout_completed")
                ):
                    for att in open_attendances:
                        try:
                            att.checked_out_at = shift.end_time
                            checked_in = att.checked_in_at
                            if checked_in and shift.end_time:
                                delta = (shift.end_time - checked_in).total_seconds()
                                att.duration_minutes = max(round(delta / 60.0, 1), 0)
                            org_checkouts += 1
                        except Exception as e:
                            logger.error(
                                "Failed to auto-checkout user %s " "shift %s: %s",
                                att.user_id,
                                shift.id,
                                e,
                            )

                    shift.activities = {
                        **(shift.activities or {}),
                        "auto_checkout_completed": True,
                    }

        except Exception as e:
            logger.error(
                "shift_auto_checkout error for org %s: %s",
                org.id,
                e,
            )

        if org_reminders > 0 or org_checkouts > 0:
            results.append(
                {
                    "org_id": str(org.id),
                    "reminders": org_reminders,
                    "auto_checkouts": org_checkouts,
                }
            )
        total_reminders += org_reminders
        total_auto_checkouts += org_checkouts

    if total_reminders > 0 or total_auto_checkouts > 0:
        await db.commit()

    logger.info(
        "Shift auto-checkout: %d reminders, %d auto-checkouts " "across %d orgs",
        total_reminders,
        total_auto_checkouts,
        len(results),
    )

    return {
        "task": "shift_auto_checkout",
        "total_reminders": total_reminders,
        "total_auto_checkouts": total_auto_checkouts,
        "organizations": results,
    }


async def run_external_training_auto_sync(db: AsyncSession) -> dict:
    """Sync training records from external providers that are due.

    Checks all providers with auto_sync_enabled=True and a next_sync_at
    that has passed (or is null), then triggers an incremental sync for
    each one.  Called every 30 minutes by the scheduler.
    """
    from datetime import timezone as dt_timezone

    from app.models.training import ExternalTrainingProvider
    from app.services.external_training_service import ExternalTrainingSyncService

    now = datetime.now(dt_timezone.utc)
    result = await db.execute(
        select(ExternalTrainingProvider).where(
            ExternalTrainingProvider.auto_sync_enabled.is_(True),
            ExternalTrainingProvider.active.is_(True),
            ExternalTrainingProvider.connection_verified.is_(True),
            or_(
                ExternalTrainingProvider.next_sync_at.is_(None),
                ExternalTrainingProvider.next_sync_at <= now,
            ),
        )
    )
    providers = result.scalars().all()

    synced = 0
    failed = 0
    for provider in providers:
        sync_service = ExternalTrainingSyncService(db)
        try:
            await sync_service.sync_training_records(provider, sync_type="incremental")
            synced += 1
        except Exception:
            logger.warning(
                "Auto-sync failed for provider %s (%s)",
                provider.name,
                provider.id,
                exc_info=True,
            )
            failed += 1
        finally:
            await sync_service.close()

    return {
        "task": "external_training_auto_sync",
        "providers_checked": len(providers),
        "synced": synced,
        "failed": failed,
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
    "shift_reminders": run_shift_reminders,
    "end_of_shift_checklist_reminders": run_end_of_shift_checklist_reminders,
    "end_of_shift_summary": run_end_of_shift_summary,
    "trainee_report_escalation": run_trainee_report_escalation,
    "audit_log_archival": run_audit_log_archival,
    "scheduled_emails": run_scheduled_emails,
    "inventory_low_stock_alerts": run_inventory_low_stock_alerts,
    "inventory_overdue_alerts": run_inventory_overdue_alerts,
    "nfpa_retirement_alerts": run_nfpa_retirement_alerts,
    "compliance_auto_reports": run_compliance_auto_reports,
    "message_history_cleanup": run_message_history_cleanup,
    "series_end_reminders": run_series_end_reminders,
    "rolling_recurrence_extend": run_rolling_recurrence_extend,
    "shift_auto_checkout": run_shift_auto_checkout,
    "external_training_auto_sync": run_external_training_auto_sync,
}
