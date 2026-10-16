"""The weekly security and audit report emailed to the IT manager.

HIPAA 164.308(a)(1)(ii)(D) asks for regular review of system activity, and a
review nobody is prompted to make does not happen. This sends the people who
hold the IT Manager position a once-a-week summary of what the platform
recorded: security alerts, application errors and the health of the audit
log itself.

Counts and a link only. Email is not a protected channel, so no member name,
username, address or event description goes in the message; the detail stays
behind the sign-in on the Security Alerts and Audit Log pages.

A quiet week still sends a short all-clear. A report that only arrives when
something went wrong cannot tell the reader "nothing happened" from "the
scheduler or the mail server is broken", and that is itself a monitoring gap.

Schedule and switch live in ``Organization.settings["security"]["weekly_report"]``.
An organization with nothing stored gets the defaults below: the report is on,
Monday 07:00 on the department's calendar.
"""

import copy
import html
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_logger
from app.core.config import settings as app_settings
from app.models.audit import AuditLog
from app.models.error_log import ErrorLog
from app.models.security_alert import SecurityAlertRecord, ThreatLevel
from app.models.user import Organization, Position, User, user_positions
from app.services.documents_service import DocumentsService
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_theme import ACCENT_AMBER, ACCENT_GREEN, action
from app.utils.org_timezone import reporting_timezone

SECURITY_SETTINGS_KEY = "security"
REPORT_SETTINGS_KEY = "weekly_report"

IT_MANAGER_SLUG = "it_manager"
DEFAULT_ENABLED = True
DEFAULT_WEEKDAY = 0  # Monday, as datetime.weekday() counts
DEFAULT_HOUR = 7
REPORT_WINDOW_DAYS = 7
# A department that has never been sent a report waits for its next scheduled
# time instead of receiving one the moment the feature is deployed. The task
# runs hourly, so two hours covers a late tick without opening the door to a
# Wednesday deploy emailing last Monday's slot.
FIRST_SEND_GRACE = timedelta(hours=2)
TOP_ERROR_TYPES_SHOWN = 5
# A verification pass walks every sealed row in the window; bound it so a very
# large week cannot hold the task open.
INTEGRITY_ROW_LIMIT = 200_000

WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


@dataclass(frozen=True)
class ReportSchedule:
    enabled: bool
    weekday: int
    hour: int
    last_sent_at: Optional[datetime]


@dataclass
class ReportData:
    period_start: datetime
    period_end: datetime
    alerts_total: int = 0
    alerts_by_level: Dict[str, int] = field(default_factory=dict)
    alerts_by_type: Dict[str, int] = field(default_factory=dict)
    unresolved_high_or_critical: int = 0
    includes_platform_alerts: bool = False
    errors_total: int = 0
    errors_by_type: List[tuple] = field(default_factory=list)
    audit_verified: Optional[bool] = None
    audit_rows_checked: int = 0
    audit_integrity_errors: int = 0
    audit_pending_seal: int = 0
    audit_shipping_configured: bool = False

    @property
    def needs_attention(self) -> bool:
        return bool(
            self.unresolved_high_or_critical
            or self.audit_verified is False
            or self.audit_integrity_errors
        )


def _security_section(organization: Organization) -> Dict[str, Any]:
    stored = organization.settings if isinstance(organization.settings, dict) else {}
    section = stored.get(SECURITY_SETTINGS_KEY)
    return section if isinstance(section, dict) else {}


def read_schedule(organization: Organization) -> ReportSchedule:
    """The stored schedule, with every bad or missing value read as its default.

    ``rule.config``-style JSON is unvalidated, and an exception here would stop
    the whole task for every organization after this one, so a value somebody
    typed wrong degrades to the default rather than raising.
    """
    raw = _security_section(organization).get(REPORT_SETTINGS_KEY)
    raw = raw if isinstance(raw, dict) else {}

    enabled = raw.get("enabled")
    weekday = raw.get("weekday")
    hour = raw.get("hour")
    last_sent = raw.get("last_sent_at")

    parsed_last: Optional[datetime] = None
    if isinstance(last_sent, str):
        try:
            parsed_last = datetime.fromisoformat(last_sent)
            if parsed_last.tzinfo is None:
                parsed_last = parsed_last.replace(tzinfo=timezone.utc)
        except ValueError:
            parsed_last = None

    return ReportSchedule(
        enabled=enabled if isinstance(enabled, bool) else DEFAULT_ENABLED,
        weekday=(
            weekday
            if isinstance(weekday, int)
            and not isinstance(weekday, bool)
            and 0 <= weekday <= 6
            else DEFAULT_WEEKDAY
        ),
        hour=(
            hour
            if isinstance(hour, int) and not isinstance(hour, bool) and 0 <= hour <= 23
            else DEFAULT_HOUR
        ),
        last_sent_at=parsed_last,
    )


def write_schedule(
    organization: Organization,
    *,
    enabled: bool,
    weekday: int,
    hour: int,
) -> None:
    """Store the switch and the time, keeping the last-sent stamp.

    A deep copy reassigned whole: a nested mutation of a JSON column is not
    seen by SQLAlchemy (CLAUDE.md pitfall #12).
    """
    current = copy.deepcopy(organization.settings or {})
    security = current.get(SECURITY_SETTINGS_KEY)
    if not isinstance(security, dict):
        security = {}
    report = security.get(REPORT_SETTINGS_KEY)
    if not isinstance(report, dict):
        report = {}
    report.update({"enabled": enabled, "weekday": weekday, "hour": hour})
    security[REPORT_SETTINGS_KEY] = report
    current[SECURITY_SETTINGS_KEY] = security
    organization.settings = current


def _record_sent(organization: Organization, sent_at: datetime) -> None:
    current = copy.deepcopy(organization.settings or {})
    security = current.get(SECURITY_SETTINGS_KEY)
    if not isinstance(security, dict):
        security = {}
    report = security.get(REPORT_SETTINGS_KEY)
    if not isinstance(report, dict):
        report = {}
    report["last_sent_at"] = sent_at.astimezone(timezone.utc).isoformat()
    security[REPORT_SETTINGS_KEY] = report
    current[SECURITY_SETTINGS_KEY] = security
    organization.settings = current


def latest_scheduled_time(now_local: datetime, weekday: int, hour: int) -> datetime:
    """The most recent weekday/hour slot at or before *now_local*."""
    slot = now_local.replace(hour=hour, minute=0, second=0, microsecond=0)
    slot -= timedelta(days=(now_local.weekday() - weekday) % 7)
    if slot > now_local:
        slot -= timedelta(days=7)
    return slot


def is_due(schedule: ReportSchedule, now_local: datetime) -> bool:
    """Whether a report should go out at *now_local* (a tz-aware local time)."""
    if not schedule.enabled:
        return False
    slot = latest_scheduled_time(now_local, schedule.weekday, schedule.hour)
    if schedule.last_sent_at is None:
        return now_local - slot < FIRST_SEND_GRACE
    return schedule.last_sent_at < slot


async def _is_single_organization(db: AsyncSession) -> bool:
    count = (
        await db.execute(
            select(func.count())
            .select_from(Organization)
            .where(Organization.active.isnot(False))
        )
    ).scalar()
    return count == 1


async def gather_report_data(
    db: AsyncSession,
    organization: Organization,
    period_start: datetime,
    period_end: datetime,
) -> ReportData:
    org_id = str(organization.id)
    data = ReportData(period_start=period_start, period_end=period_end)

    # Alerts raised before sign-in (brute force against the login page) carry
    # no organization, so no department's Security Alerts screen shows them. On
    # a single-department install they are that department's, and they are the
    # most important thing IT would otherwise never hear about. With several
    # departments sharing the install they belong to none of them.
    data.includes_platform_alerts = await _is_single_organization(db)
    scope: ColumnElement[bool]
    if data.includes_platform_alerts:
        scope = (SecurityAlertRecord.organization_id == org_id) | (
            SecurityAlertRecord.organization_id.is_(None)
        )
    else:
        scope = SecurityAlertRecord.organization_id == org_id

    in_week = (
        SecurityAlertRecord.timestamp >= period_start,
        SecurityAlertRecord.timestamp < period_end,
    )
    for level, kind, count in (
        await db.execute(
            select(
                SecurityAlertRecord.threat_level,
                SecurityAlertRecord.alert_type,
                func.count(),
            )
            .where(scope, *in_week)
            .group_by(SecurityAlertRecord.threat_level, SecurityAlertRecord.alert_type)
        )
    ).all():
        level_name = getattr(level, "value", str(level))
        kind_name = getattr(kind, "value", str(kind))
        data.alerts_by_level[level_name] = (
            data.alerts_by_level.get(level_name, 0) + count
        )
        data.alerts_by_type[kind_name] = data.alerts_by_type.get(kind_name, 0) + count
        data.alerts_total += count

    data.unresolved_high_or_critical = (
        await db.execute(
            select(func.count())
            .select_from(SecurityAlertRecord)
            .where(
                scope,
                SecurityAlertRecord.resolved.is_(False),
                SecurityAlertRecord.threat_level.in_(
                    [ThreatLevel.HIGH, ThreatLevel.CRITICAL]
                ),
            )
        )
    ).scalar() or 0

    error_rows = (
        await db.execute(
            select(ErrorLog.error_type, func.count())
            .where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= period_start,
                ErrorLog.created_at < period_end,
            )
            .group_by(ErrorLog.error_type)
            .order_by(func.count().desc(), ErrorLog.error_type)
        )
    ).all()
    data.errors_total = sum(count for _type, count in error_rows)
    data.errors_by_type = [
        (error_type, count) for error_type, count in error_rows[:TOP_ERROR_TYPES_SHOWN]
    ]

    # The chain is installation-wide, not per department, so its health is the
    # same fact whichever department asks.
    data.audit_shipping_configured = bool(app_settings.AUDIT_SHIP_WEBHOOK_URL)
    first_id = (
        await db.execute(
            select(func.min(AuditLog.id)).where(AuditLog.timestamp >= period_start)
        )
    ).scalar()
    if first_id is not None:
        rows_in_window = (
            await db.execute(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.id >= first_id)
            )
        ).scalar() or 0
        if rows_in_window <= INTEGRITY_ROW_LIMIT:
            result = await audit_logger.verify_integrity(db, start_id=first_id)
            data.audit_verified = bool(result.get("verified"))
            data.audit_rows_checked = int(result.get("total_checked", 0))
            data.audit_integrity_errors = len(result.get("errors", []))
            data.audit_pending_seal = int(result.get("pending_seal", 0))
        else:
            logger.warning(
                "Security report: {} audit rows in window exceeds {}; "
                "integrity check skipped for this report",
                rows_in_window,
                INTEGRITY_ROW_LIMIT,
            )
    return data


async def resolve_recipients(
    db: AsyncSession, organization: Organization
) -> tuple[List[User], bool]:
    """Active members who hold the IT Manager position, else full administrators.

    The fallback keeps the report from going nowhere when the position is
    vacant, which is when nobody is watching the system at all. The second
    value says the fallback was used, so the settings screen can tell an
    administrator the position is empty.
    """
    org_id = str(organization.id)
    holders = list(
        (
            await db.execute(
                select(User)
                .join(user_positions, user_positions.c.user_id == User.id)
                .join(Position, Position.id == user_positions.c.position_id)
                .where(
                    User.organization_id == org_id,
                    User.is_active,
                    Position.organization_id == org_id,
                    Position.slug == IT_MANAGER_SLUG,
                )
                .order_by(User.id)
            )
        )
        .scalars()
        .unique()
        .all()
    )
    fallback = not holders
    if fallback:
        holders = await DocumentsService(db).active_full_administrators(org_id)
    candidates = [member for member in holders if member.email]
    return (
        recipients_for(
            candidates,
            EmailKind.SECURITY_REPORT,
            department_required_kinds(organization),
        ),
        fallback,
    )


def _row(label: str, value: str) -> str:
    return (
        '<tr><td style="padding:4px 12px 4px 0">'
        f"{html.escape(label)}</td>"
        f'<td style="padding:4px 0;font-weight:600">{html.escape(value)}</td></tr>'
    )


def _pretty(name: str) -> str:
    return name.replace("_", " ").capitalize()


def build_subject(data: ReportData, organization: Organization) -> str:
    name = getattr(organization, "name", None) or "Your department"
    if data.needs_attention:
        return f"Action needed: weekly security report for {name}"
    return f"Weekly security report for {name}"


def build_body(data: ReportData, tz: ZoneInfo) -> str:
    """The report's HTML. Counts only; every dynamic value is escaped."""
    base = app_settings.FRONTEND_URL.rstrip("/")
    start = data.period_start.astimezone(tz)
    end = data.period_end.astimezone(tz)
    parts = [
        "<p>What the platform recorded between "
        f"{html.escape(start.strftime('%b %d, %Y %H:%M'))} and "
        f"{html.escape(end.strftime('%b %d, %Y %H:%M'))}. "
        "This message carries counts only; names and details are in the "
        "application.</p>"
    ]

    if data.unresolved_high_or_critical:
        parts.append(
            "<p><strong>"
            f"{data.unresolved_high_or_critical} high or critical alert(s) "
            "are still unresolved.</strong></p>"
        )

    parts.append("<h3>Security alerts</h3>")
    if data.alerts_total:
        rows = [_row("Raised this week", str(data.alerts_total))]
        for level in ("critical", "high", "medium", "low"):
            if data.alerts_by_level.get(level):
                rows.append(_row(_pretty(level), str(data.alerts_by_level[level])))
        for kind, count in sorted(data.alerts_by_type.items(), key=lambda i: -i[1]):
            rows.append(_row(f"Type: {_pretty(kind)}", str(count)))
        parts.append(f"<table>{''.join(rows)}</table>")
    else:
        parts.append("<p>No security alerts were raised.</p>")
    if data.includes_platform_alerts:
        parts.append(
            "<p><em>Includes alerts raised before sign-in, such as repeated "
            "failed logins.</em></p>"
        )

    parts.append("<h3>Application errors</h3>")
    if data.errors_total:
        rows = [_row("Recorded this week", str(data.errors_total))]
        rows.extend(
            _row(f"Type: {_pretty(error_type)}", str(count))
            for error_type, count in data.errors_by_type
        )
        parts.append(f"<table>{''.join(rows)}</table>")
    else:
        parts.append("<p>No application errors were recorded.</p>")

    parts.append("<h3>Audit log health</h3>")
    if data.audit_verified is None:
        parts.append(
            "<p>The audit chain was not verified for this report "
            "(no entries in the period, or the period was too large to check "
            "here). Run the integrity check from the Audit Log page.</p>"
        )
    elif data.audit_verified:
        parts.append(
            f"<p>The hash chain verified: {data.audit_rows_checked} entries "
            "checked, none altered or missing.</p>"
        )
    else:
        parts.append(
            "<p><strong>The hash chain failed verification: "
            f"{data.audit_integrity_errors} problem(s) found.</strong> Treat "
            "this as an incident and follow the incident response policy.</p>"
        )
    if data.audit_pending_seal:
        parts.append(
            f"<p>{data.audit_pending_seal} entries are waiting to be sealed "
            "onto the chain.</p>"
        )
    if not data.audit_shipping_configured:
        parts.append(
            "<p>Off-host audit shipping is not configured, so a copy of the "
            "log does not exist outside this server.</p>"
        )

    parts.append(action(html.escape(f"{base}/admin/security-alerts"), "Open alerts"))
    parts.append(action(html.escape(f"{base}/admin/audit-log"), "Open audit log"))
    return "".join(parts)


async def send_weekly_security_report(
    db: AsyncSession,
    organization: Organization,
    now: Optional[datetime] = None,
) -> int:
    """Send this department's report if it is due. Returns emails sent.

    Nothing is recorded unless at least one email went out, so a department
    whose mail is failing is tried again on the next hourly tick rather than a
    week on.
    """
    schedule = read_schedule(organization)
    local_tz = reporting_timezone(organization)
    moment = (now or datetime.now(timezone.utc)).astimezone(local_tz)
    if not is_due(schedule, moment):
        return 0

    recipients, _fallback = await resolve_recipients(db, organization)
    if not recipients:
        logger.warning(
            "Weekly security report for organization {} has no recipient with an "
            "email address (no IT Manager, no administrator)",
            organization.id,
        )
        return 0

    period_end = moment.astimezone(timezone.utc)
    period_start = period_end - timedelta(days=REPORT_WINDOW_DAYS)
    data = await gather_report_data(db, organization, period_start, period_end)

    attention = data.needs_attention
    html_body = wrap_email_body(
        organization,
        "Weekly security report",
        build_body(data, local_tz),
        header_color=ACCENT_AMBER if attention else ACCENT_GREEN,
        chip="Security",
    )
    subject = build_subject(data, organization)

    sent_total = 0
    for member in recipients:
        try:
            sent, _failed = await EmailService().send_email(
                to_emails=[member.email],
                subject=subject,
                html_body=html_body,
                db=db,
                template_type="security_weekly_report",
            )
            sent_total += sent
        except Exception as exc:
            logger.warning(
                "Weekly security report to member {} failed: {}", member.id, exc
            )
    if sent_total:
        _record_sent(organization, period_end)
        await db.commit()
    return sent_total
