"""Email the Treasurer when a fiscal year's start or year-end close is due.

Owner decision, 2026-11-01 ("Finance — The Year-End Close: What It Does Not
Cover"): nothing starts or closes a year on its own — each is an officer's
decision on the record — but the Treasurer is emailed when one is due, not
only shown a banner on the Fiscal Years screen.

=============  ===============================================================
Event          Due when
=============  ===============================================================
Start          a draft year the board adopted, not locked, whose start date
               has arrived on the department's calendar (what
               ``FinanceService.activate_fiscal_year`` itself allows)
Close          the active year, not locked, the day after its end date (the
               screen's ``closeDue`` banner reads :func:`close_due` too)
=============  ===============================================================

**Who.** The Treasurers: the department's active ``finance.manage`` holders,
the same rule every other Treasurer notice uses
(``finance_budget_request_notifications.treasurers``). The email kind is
``FINANCE_DUTIES``, so a member who turned Treasurer duty emails off is left
out unless the department made them required. Email only, never SMS
(CLAUDE.md pitfall #18).

**Once per event.** The task runs daily and again after a restart, so each
email sent is recorded as an email-channel ``NotificationLog`` row whose
metadata names the year, the event and the date it fell due on; a Treasurer
already recorded for that key is not emailed again (pitfall #36). The date is
part of the key, so moving a year's end date and passing it again is a new
close. A Treasurer appointed after the email went out is emailed on the next
run, since the year is still waiting on them. Sent first, recorded after, and
committed once per department: a crash in between sends again (at least
once), which for a reminder is a nuisance, not harm.
"""

from __future__ import annotations

import html
from datetime import date
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import BudgetPlanningStage, FiscalYear, FiscalYearStatus
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.services.email_policy import EmailKind
from app.services.email_theme import ACCENT_BLUE, action, fact, facts
from app.services.finance_budget_request_notifications import (
    _link,
    _send,
    _subject_safe,
    _who_receive,
    long_date,
    treasurers,
)
from app.utils.org_timezone import org_today

FISCAL_YEARS_PATH = "/finance/settings"

START_DUE_CATEGORY = "fiscal_year_start_due"
CLOSE_DUE_CATEGORY = "fiscal_year_close_due"


# ============================================
# When an event is due — the one definition (pitfall #29)
# ============================================


def close_due(fy: Any, today: date) -> bool:
    """The active, unlocked year whose end date has passed.

    An end date entered as a calendar day is that day's midnight UTC, so its
    UTC date is the last day of the year. Also read by
    ``FinanceBudgetRequestService.fiscal_year_rows`` for the screen's banner.
    """
    return (
        fy.status == FiscalYearStatus.ACTIVE
        and not fy.is_locked
        and today > fy.end_date.date()
    )


def start_due(fy: Any, today: date) -> bool:
    """An adopted, unlocked draft whose start date has arrived."""
    return (
        fy.status == FiscalYearStatus.DRAFT
        and fy.planning_stage == BudgetPlanningStage.ADOPTED
        and not fy.is_locked
        and today >= fy.start_date.date()
    )


# ============================================
# Sending
# ============================================


async def _already_told(
    db: AsyncSession, org_id: str, users: list[User], category: str, key: dict
) -> set[str]:
    if not users:
        return set()
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.organization_id == org_id,
            NotificationLog.channel == NotificationChannel.EMAIL,
            NotificationLog.category == category,
            NotificationLog.recipient_id.in_([str(u.id) for u in users]),
        )
    )
    told: set[str] = set()
    for log in result.scalars().all():
        meta = log.notification_metadata or {}
        if isinstance(meta, dict) and all(meta.get(k) == v for k, v in key.items()):
            told.add(str(log.recipient_id))
    return told


def _record(
    db: AsyncSession,
    org_id: str,
    users: list[User],
    *,
    category: str,
    subject: str,
    metadata: dict,
) -> None:
    for user in users:
        db.add(
            NotificationLog(
                organization_id=org_id,
                recipient_id=str(user.id),
                recipient_email=user.email,
                channel=NotificationChannel.EMAIL,
                category=category,
                subject=_subject_safe(subject)[:500],
                action_url=FISCAL_YEARS_PATH,
                delivered=True,
                notification_metadata=dict(metadata),
            )
        )


def _close_notice(fy: FiscalYear) -> tuple[str, str, str]:
    ended = long_date(fy.end_date.date())
    subject = f"{fy.name} has ended: begin its year-end close"
    lead = (
        f"{fy.name} ended on {ended} and is still the active fiscal year. "
        "Begin its year-end close to stop new requests against it and start "
        "reconciling; nothing closes it on its own."
    )
    return subject, lead, ended


def _start_notice(fy: FiscalYear, still_active: Optional[str]) -> tuple[str, str, str]:
    starts = long_date(fy.start_date.date())
    subject = f"{fy.name} can be started"
    lead = (
        f"The board adopted {fy.name}'s budget and the year began on {starts}. "
        "Start the year to make it the active one; nothing starts it on its "
        "own."
    )
    if still_active:
        lead += (
            f" {still_active} is still the active fiscal year: begin its "
            "year-end close first."
        )
    return subject, lead, starts


async def _notify(
    db: AsyncSession,
    org: Organization,
    people: list[User],
    fy: FiscalYear,
    *,
    category: str,
    due_on: date,
    notice: tuple[str, str, str],
    fact_label: str,
) -> int:
    org_id = str(org.id)
    key = {
        "fiscal_year_id": str(fy.id),
        "due_on": due_on.isoformat(),
    }
    told = await _already_told(db, org_id, people, category, key)
    recipients = _who_receive(
        [u for u in people if str(u.id) not in told], EmailKind.FINANCE_DUTIES, org
    )
    if not recipients:
        return 0
    subject, lead, when = notice
    link = _link(FISCAL_YEARS_PATH)
    body = (
        f"<p>{html.escape(lead)}</p>"
        + facts([[fact(fact_label, html.escape(when))]])
        + action(html.escape(link), "Open Fiscal Years")
    )
    sent = await _send(
        db,
        org,
        recipients,
        subject=subject,
        title=subject,
        body_html=body,
        text_body=f"{lead}\n\nOpen Fiscal Years: {link}\n",
        chip="Fiscal year",
        accent=ACCENT_BLUE,
        template_type=category,
    )
    _record(db, org_id, sent, category=category, subject=subject, metadata=key)
    return len(sent)


async def send_year_due_reminders(db: AsyncSession, org: Organization) -> int:
    """One department's start and close emails for today. Returns the number
    of emails sent. Commits once, after the department is done."""
    org_id = str(org.id)
    today = org_today(org)
    result = await db.execute(
        select(FiscalYear)
        .where(
            FiscalYear.organization_id == org_id,
            FiscalYear.is_locked.is_(False),
            FiscalYear.status.in_([FiscalYearStatus.DRAFT, FiscalYearStatus.ACTIVE]),
        )
        .order_by(FiscalYear.start_date, FiscalYear.id)
    )
    years = list(result.scalars().all())
    closing = [fy for fy in years if close_due(fy, today)]
    starting = [fy for fy in years if start_due(fy, today)]
    if not closing and not starting:
        return 0
    people = await treasurers(db, org_id)
    if not people:
        return 0
    active = next(
        (fy.name for fy in years if fy.status == FiscalYearStatus.ACTIVE), None
    )
    total = 0
    for fy in closing:
        total += await _notify(
            db,
            org,
            people,
            fy,
            category=CLOSE_DUE_CATEGORY,
            due_on=fy.end_date.date(),
            notice=_close_notice(fy),
            fact_label="Year ended",
        )
    for fy in starting:
        total += await _notify(
            db,
            org,
            people,
            fy,
            category=START_DUE_CATEGORY,
            due_on=fy.start_date.date(),
            notice=_start_notice(fy, active),
            fact_label="Year began",
        )
    await db.commit()
    return total
