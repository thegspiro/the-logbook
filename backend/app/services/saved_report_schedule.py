"""
Scheduled delivery of saved reports (RPT2-29-2).

Owner decision: build the sender and a saved-reports screen, with the PII
gate. ``SavedReport.is_scheduled`` / ``schedule_frequency`` / ``schedule_day``
/ ``email_recipients`` had been stored and returned for months with nothing
reading them (CLAUDE.md pitfall #19); this module is that reader, and the
rules the save endpoints validate against, so the two cannot disagree.

**The PII gate.** Eight report types list people and their personal data
(``PII_REPORT_PERMISSIONS``: the roster, the applicant pipeline, the training
and admin-hours reports). Opening one in the app requires the permission that
guards the same data at its source (RPT-3). A scheduled send must not be a way
around that, so for those types:

- the person who scheduled it must still hold the permission on the day it
  runs -- someone who has since lost it stops the schedule rather than keeps
  feeding it;
- every recipient must be an active member of the department who holds the
  permission. An outside address, or a member without it, is refused when the
  schedule is saved and dropped (and logged) if it slips through to a run.

**What is emailed.** A summary -- the report's top-level counts and figures
-- and a link to the Saved Reports screen, where the report opens with the
viewer's own permissions applied. No member-by-member row is ever put in an
email: mail is not a channel the department can revoke, and the full report
is one sign-in away. That is also why other report types may go to an
outside address (audited as an external send, the way compliance reports
are).

**When.** ``next_run_date`` is the department's calendar date of the next
send. A schedule saved today whose day is today sends on today's run. After
a send the next date is the first occurrence after today, so a second run the
same day sends nothing. A schedule that existed before this sender -- with no
``next_run_date`` -- is given its next occurrence *after* today rather than
sent at once, so upgrading does not flood inboxes.
"""

from __future__ import annotations

import calendar
import html
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.analytics import SavedReport
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User

SCHEDULE_FREQUENCIES = ("daily", "weekly", "monthly", "quarterly")

# Relative reporting periods a saved report may carry in ``filters.period``,
# resolved against the department's date each time it runs. A schedule with
# fixed start/end dates would send the same period forever.
REPORT_PERIODS = (
    "last_30_days",
    "previous_month",
    "previous_quarter",
    "year_to_date",
    "previous_year",
)

# Report types that list people and their personal data, and the permission
# that guards the same data at its source (RPT-3, owner decision 2026-08-09).
# The endpoints import this; it lives here so the scheduled sender, which has
# no request, enforces the identical map.
PII_REPORT_PERMISSIONS: dict[str, str] = {
    "member_roster": "members.view",
    # Lists every applicant, so it needs what sees every applicant: holders of
    # view without view_all see only their assigned ones (prospect_access.py).
    "pipeline_overview": "prospective_members.view_all",
    "training_summary": "training.manage",
    "training_progress": "training.manage",
    "annual_training": "training.manage",
    "certification_expiration": "training.manage",
    "compliance_status": "training.manage",
    "admin_hours": "admin_hours.manage",
}

MAX_RECIPIENTS = 25
SAVED_REPORTS_PATH = "/reports/saved"
_QUARTER_MONTHS = (1, 4, 7, 10)


# ============================================
# Dates
# ============================================


def _clamped(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_run_on_or_after(frequency: str, day: Optional[int], start: date) -> date:
    """The first scheduled date on or after ``start``.

    ``day`` is the ISO weekday (1 = Monday .. 7 = Sunday) for weekly, the day
    of the month for monthly and quarterly (29-31 fall on a shorter month's
    last day), and unused for daily.
    """
    if frequency == "daily":
        return start
    if frequency == "weekly":
        weekday = day or 1
        return start + timedelta(days=(weekday - start.isoweekday()) % 7)
    target = day or 1
    months = range(1, 13) if frequency == "monthly" else _QUARTER_MONTHS
    year, month = start.year, start.month
    for _ in range(25):
        if month in months:
            candidate = _clamped(year, month, target)
            if candidate >= start:
                return candidate
        month += 1
        if month > 12:
            month, year = 1, year + 1
    raise ValueError(f"No run date for frequency {frequency!r}")


def resolve_period(
    period: Optional[str], today: date
) -> tuple[Optional[date], Optional[date]]:
    """A relative period's (start, end) on the department's ``today``."""
    if period == "last_30_days":
        return today - timedelta(days=30), today
    if period == "previous_month":
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if period == "previous_quarter":
        first_month = ((today.month - 1) // 3) * 3 + 1
        end = date(today.year, first_month, 1) - timedelta(days=1)
        start_month = ((end.month - 1) // 3) * 3 + 1
        return date(end.year, start_month, 1), end
    if period == "year_to_date":
        return date(today.year, 1, 1), today
    if period == "previous_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    return None, None


def report_dates(
    filters: Optional[dict], today: date
) -> tuple[Optional[Any], Optional[Any]]:
    """The dates a saved report runs for: its relative period, else the fixed
    ``start_date``/``end_date`` it was saved with."""
    filters = filters if isinstance(filters, dict) else {}
    period = filters.get("period")
    if period in REPORT_PERIODS:
        return resolve_period(period, today)
    return filters.get("start_date"), filters.get("end_date")


# ============================================
# Validation (shared by the save endpoints)
# ============================================


def validate_schedule(
    is_scheduled: bool,
    frequency: Optional[str],
    day: Optional[int],
    recipients: Optional[list[str]],
) -> None:
    """Raise ValueError when a schedule could not be sent as saved."""
    if not is_scheduled:
        return
    if frequency not in SCHEDULE_FREQUENCIES:
        raise ValueError(
            "A scheduled report needs a frequency: "
            + ", ".join(SCHEDULE_FREQUENCIES)
            + "."
        )
    if frequency == "weekly" and day is not None and not 1 <= day <= 7:
        raise ValueError("For a weekly report, the day is 1 (Monday) to 7 (Sunday).")
    if frequency in ("monthly", "quarterly") and day is not None and not 1 <= day <= 31:
        raise ValueError("For a monthly or quarterly report, the day is 1 to 31.")
    if not recipients:
        raise ValueError("A scheduled report needs at least one email recipient.")
    if len(recipients) > MAX_RECIPIENTS:
        raise ValueError(
            f"A scheduled report can go to at most {MAX_RECIPIENTS} recipients."
        )


async def permitted_members(
    db: AsyncSession, organization_id: str, permission: str
) -> dict[str, User]:
    """Active members holding ``permission``, keyed by lower-cased email."""
    from app.api.dependencies import user_has_permission

    result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(
            User.organization_id == organization_id,
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            User.deleted_at.is_(None),
            User.email.isnot(None),
        )
    )
    return {
        u.email.lower(): u
        for u in result.scalars().all()
        if u.email and user_has_permission(u, permission)
    }


async def disallowed_pii_recipients(
    db: AsyncSession,
    organization_id: str,
    report_type: str,
    recipients: Iterable[str],
) -> list[str]:
    """Recipients a PII-bearing report may not be sent to (the PII gate)."""
    permission = PII_REPORT_PERMISSIONS.get(report_type)
    if not permission:
        return []
    allowed = await permitted_members(db, organization_id, permission)
    return [r for r in recipients if r.lower() not in allowed]


# ============================================
# Sending
# ============================================


def _numeric_summary(report: dict[str, Any], limit: int = 8) -> list[tuple[str, str]]:
    """The report's top-level counts and figures, as (label, value) pairs.

    Only numbers at the top level: totals and rates. Every per-member row is
    nested in a list and never reaches the email.
    """
    rows: list[tuple[str, str]] = []
    for key, value in report.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        label = key.replace("_", " ").strip().capitalize()
        rows.append(
            (label, f"{value:,}" if isinstance(value, int) else f"{value:,.1f}")
        )
        if len(rows) >= limit:
            break
    entries = report.get("entries")
    if isinstance(entries, list):
        rows.append(("Rows in the report", f"{len(entries):,}"))
    return rows


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


async def _report_titles(db: AsyncSession) -> dict[str, str]:
    from app.services.reports_service import ReportsService

    catalog = await ReportsService(db).get_available_reports()
    return {
        r["id"]: r["title"]
        for r in catalog.get("available_reports", [])
        if isinstance(r, dict) and "id" in r and "title" in r
    }


async def _email(
    db: AsyncSession,
    org: Organization,
    saved: SavedReport,
    recipients: list[str],
    report: dict[str, Any],
    title: str,
    period: tuple[Optional[Any], Optional[Any]],
    today: date,
) -> int:
    from app.services.email_service import EmailService, wrap_email_body
    from app.services.email_theme import ACCENT_BLUE, action, fact, facts

    start, end = period
    period_text = f"{start} to {end}" if start and end else "Current"
    summary = _numeric_summary(report)
    link = _link(SAVED_REPORTS_PATH)
    name = html.escape(saved.name)
    body = (
        f"<p>Your scheduled report <strong>{name}</strong> ({html.escape(title)}) "
        f"ran on {today.isoformat()}.</p>"
        + facts(
            [[fact("Reporting period", html.escape(period_text))]]
            + [
                [fact(html.escape(label), html.escape(value))]
                for label, value in summary
            ]
        )
        + "<p>The full report opens in The Logbook, where your own access "
        "to member data applies. No member-level detail is included in this "
        "email.</p>" + action(html.escape(link), "Open saved reports")
    )
    text = (
        f"Your scheduled report {saved.name} ({title}) ran on {today.isoformat()}.\n"
        f"Reporting period: {period_text}\n"
        + "".join(f"{label}: {value}\n" for label, value in summary)
        + f"\nOpen saved reports: {link}\n"
    )
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=recipients,
        subject=" ".join(f"Scheduled report: {saved.name}".split()),
        html_body=wrap_email_body(
            org,
            f"Scheduled report: {saved.name}",
            body,
            header_color=ACCENT_BLUE,
            chip="Reports",
        ),
        text_body=text,
        db=db,
        template_type="saved_report_delivery",
    )
    return sent


async def _owner_may_run(db: AsyncSession, saved: SavedReport) -> bool:
    """The PII gate's first half: the schedule's owner still holds the
    permission the report type needs (non-PII types need none beyond
    reports.view, checked here too)."""
    from app.api.dependencies import user_has_permission

    if not saved.created_by:
        return False
    owner = (
        await db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(
                User.id == saved.created_by,
                User.organization_id == saved.organization_id,
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if owner is None or not user_has_permission(owner, "reports.view"):
        return False
    permission = PII_REPORT_PERMISSIONS.get(saved.report_type)
    return permission is None or user_has_permission(owner, permission)


async def _settle_without_sending(
    db: AsyncSession, saved: SavedReport, frequency: str, today: date
) -> None:
    """Move past an occurrence that can never be sent, so it is not retried."""
    saved.next_run_date = next_run_on_or_after(
        frequency, saved.schedule_day, today + timedelta(days=1)
    )
    await db.commit()


async def _send_one(
    db: AsyncSession,
    org: Organization,
    saved: SavedReport,
    titles: dict[str, str],
    today: date,
) -> bool:
    """Send one due saved report; True when an email went out.

    ``next_run_date`` moves only after the email is accepted, so a send that
    fails -- mail down, provider error, a generator that raises -- is tried
    again on the next daily run rather than skipped until the next occurrence.
    A crash between the send and the commit therefore sends a second copy: for
    a summary with a link that is the lesser harm than a report that never
    arrives (CLAUDE.md pitfall #36). An occurrence that can never succeed (the
    owner lost access, no allowed recipient, an unknown report type) is settled
    without a send, because retrying it cannot help.
    """
    from app.services.email_service import EmailService
    from app.services.reports_service import ReportsService
    from app.utils.external_recipients import (
        audit_external_recipients,
        dedupe_addresses,
    )

    org_id = str(org.id)
    frequency = str(saved.schedule_frequency)
    recipients = dedupe_addresses(saved.email_recipients)
    if not await _owner_may_run(db, saved):
        logger.warning(
            "Saved report {}: its owner can no longer run {}; not sent",
            saved.id,
            saved.report_type,
        )
        await _settle_without_sending(db, saved, frequency, today)
        return False
    refused = await disallowed_pii_recipients(db, org_id, saved.report_type, recipients)
    if refused:
        logger.warning(
            "Saved report {}: {} recipient(s) lack the permission {} needs; "
            "not sent to them",
            saved.id,
            len(refused),
            saved.report_type,
        )
        recipients = [r for r in recipients if r not in refused]
    if not recipients:
        await _settle_without_sending(db, saved, frequency, today)
        return False
    if not EmailService(organization=org).can_send:
        # Nothing to retry into: generating the report would only be thrown
        # away every day until mail is configured.
        logger.warning("Saved report {}: email is not enabled; not sent", saved.id)
        return False

    period = report_dates(saved.filters, today)
    report = await ReportsService(db).generate_report(
        UUID(org_id),
        saved.report_type,
        start_date=period[0],
        end_date=period[1],
        filters=saved.filters or {},
        # Only counts reach the email (module docstring), so no
        # recipient's own applicant record is listed to them.
        hidden_prospect_ids=set(),
    )
    if "error" in report:
        logger.warning("Saved report {}: {}; not sent", saved.id, report["error"])
        await _settle_without_sending(db, saved, frequency, today)
        return False

    if not await _email(
        db,
        org,
        saved,
        recipients,
        report,
        titles.get(saved.report_type, saved.report_type),
        period,
        today,
    ):
        logger.warning(
            "Saved report {}: the email was not accepted; retrying on the next run",
            saved.id,
        )
        return False

    # Audited once the email is out: the trail records data that left the
    # department, and a retried failure must not add a row each day.
    await audit_external_recipients(
        db,
        organization_id=org_id,
        recipients=recipients,
        context=f"saved_report:{saved.report_type}",
        user_id=str(saved.created_by) if saved.created_by else None,
    )
    saved.last_run_at = datetime.now(timezone.utc)
    saved.next_run_date = next_run_on_or_after(
        frequency, saved.schedule_day, today + timedelta(days=1)
    )
    await db.commit()
    return True


async def send_due_saved_reports(db: AsyncSession, org: Organization) -> int:
    """Send one department's saved reports that are due today.

    Returns the number of reports sent. Each report commits on its own and is
    isolated from the rest: one that raises is rolled back, logged to the
    error monitor and left due for the next run, and the reports after it in
    the same department are still sent.
    """
    from app.core.error_reporting import persist_task_error_log
    from app.utils.org_timezone import org_today

    org_id = str(org.id)
    today = org_today(org)
    result = await db.execute(
        select(SavedReport.id).where(
            SavedReport.organization_id == org_id,
            SavedReport.is_active.is_(True),
            SavedReport.is_scheduled.is_(True),
        )
    )
    # Ids rather than rows: a rollback after one failure expires every loaded
    # instance, and reading an expired one outside an await raises
    # MissingGreenlet, which would end the loop at the first failing report.
    saved_ids = [str(row) for row in result.scalars().all()]
    if not saved_ids:
        return 0
    titles = await _report_titles(db)
    sent_count = 0

    for saved_id in saved_ids:
        try:
            saved = (
                await db.execute(
                    select(SavedReport).where(
                        SavedReport.id == saved_id,
                        SavedReport.organization_id == org_id,
                    )
                )
            ).scalar_one_or_none()
            if saved is None or not saved.is_scheduled or not saved.is_active:
                continue
            frequency = saved.schedule_frequency
            if frequency not in SCHEDULE_FREQUENCIES:
                logger.warning(
                    "Saved report {}: unknown frequency {!r}; not sent",
                    saved.id,
                    frequency,
                )
                continue
            if saved.next_run_date is None:
                # Scheduled before this sender existed: first send at the next
                # occurrence, not today (module docstring).
                saved.next_run_date = next_run_on_or_after(
                    frequency, saved.schedule_day, today + timedelta(days=1)
                )
                await db.commit()
                continue
            if saved.next_run_date > today:
                continue
            if await _send_one(db, org, saved, titles, today):
                sent_count += 1
        except Exception as e:
            logger.error("Saved report {} failed: {}", saved_id, e)
            await persist_task_error_log(
                org_id, "saved_report_delivery", e, {"saved_report_id": saved_id}
            )
            await db.rollback()
            await db.refresh(org)
    return sent_count
