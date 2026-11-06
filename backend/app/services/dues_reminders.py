"""Email a member before their dues fall due, and once when they are overdue.

Owner decision 2026-11-01 ("My dues view + email reminders"). Two notices,
**email only** — dues are a business-hours matter and neither is in
``SmsAlert`` (CLAUDE.md pitfall #18):

=================  ==========================================================
Notice             Sent for a dues record that still owes money and …
=================  ==========================================================
Coming due         falls due within ``DUE_SOON_DAYS``
Overdue            fell due within the last ``OVERDUE_WINDOW_DAYS``
=================  ==========================================================

Both are the optional ``DUES_REMINDERS`` email kind: on by default, and a
member may turn them off (or the department may make them required) on the
usual email-preferences screens. Finance › My Dues shows the same figures, so
turning the email off costs the member nothing they cannot look up.

The overdue window is what keeps the first run after an upgrade from emailing
every member about dues that went unpaid years ago and that the Treasurer has
long since dealt with by hand: only dues that became overdue recently are
announced.

**Once per record and kind** (pitfall #36). ``due_reminder_sent_at`` and
``overdue_reminder_sent_at`` are the markers; a record whose marker is set is
never selected again. The order is send, then stamp and commit — at least
once: a crash between the two resends that one reminder on the next run, which
for a reminder is a nuisance rather than harm. A send that fails leaves the
marker empty so the next daily run retries it while the record is still in its
window. A member who does not receive the kind is stamped without an email, so
turning the kind back on does not deliver a backlog.

Recipients are the member the dues belong to, while their account is current
(``ACTIVE_ACCOUNT_STATUSES``, pitfall #32) — a member who has left the
department is not chased by email from here.
"""

from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.finance import DuesSchedule, MemberDues
from app.models.user import Organization, User
from app.services.dues_terms import (
    OWING_STATUSES,
    late_fee_deadline,
    terms_apply,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import ACCENT_AMBER, ACCENT_RED, action, fact, facts
from app.utils.org_timezone import format_in_org_timezone

DUE_SOON_DAYS = 7
OVERDUE_WINDOW_DAYS = 30
DUE_SOON = "due_soon"
OVERDUE = "overdue"
MY_DUES_PATH = "/finance/my-dues"
_DATE = "%B %d, %Y"


def _money(value) -> str:
    return f"${Decimal(value or 0).quantize(Decimal('0.01')):,.2f}"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a schedule name would end it.
    return " ".join((text or "").split())


def reminder_kind(dues: MemberDues, now: datetime) -> Optional[str]:
    """Which reminder ``dues`` is due, if any, at ``now``.

    The rule the query below narrows to, stated once in Python so a test can
    pin it and the loop can re-check a row it already loaded.
    """
    if dues.status not in OWING_STATUSES or dues.amount_paid >= dues.amount_due:
        return None
    due = _aware(dues.due_date)
    if due >= now:
        if due <= now + timedelta(days=DUE_SOON_DAYS) and not dues.due_reminder_sent_at:
            return DUE_SOON
        return None
    if (
        due >= now - timedelta(days=OVERDUE_WINDOW_DAYS)
        and not dues.overdue_reminder_sent_at
    ):
        return OVERDUE
    return None


def _late_fee_line(
    dues: MemberDues, schedule: DuesSchedule, org: Optional[Organization]
) -> Optional[str]:
    """What the member will be charged if they do not pay, and from when."""
    if dues.late_fee_applied:
        return f"A late fee of {_money(dues.late_fee_applied)} has been added."
    if not terms_apply(schedule) or not schedule.late_fee_amount:
        return None
    if Decimal(schedule.late_fee_amount) <= 0:
        return None
    deadline = late_fee_deadline(dues.due_date, schedule.grace_period_days)
    return (
        f"A late fee of {_money(schedule.late_fee_amount)} is added if the "
        f"balance is still unpaid after "
        f"{format_in_org_timezone(deadline, org, _DATE)}."
    )


async def _send(
    db: AsyncSession,
    org: Optional[Organization],
    member: User,
    dues: MemberDues,
    schedule: DuesSchedule,
    kind: str,
) -> bool:
    from app.services.email_service import EmailService, wrap_email_body

    balance = max(dues.amount_due - dues.amount_paid, Decimal("0"))
    due_text = format_in_org_timezone(dues.due_date, org, _DATE)
    link = f"{settings.FRONTEND_URL.rstrip('/')}{MY_DUES_PATH}"
    fee_line = _late_fee_line(dues, schedule, org)
    name = schedule.name or "Dues"
    if kind == DUE_SOON:
        lead = f"Your {name} are due on {due_text}."
        title, chip, accent = "Dues coming due", "Dues", ACCENT_AMBER
        subject = f"Dues due {due_text}: {name} ({_money(balance)})"
    else:
        lead = f"Your {name} were due on {due_text} and are now overdue."
        title, chip, accent = "Dues overdue", "Dues overdue", ACCENT_RED
        subject = f"Dues overdue: {name} ({_money(balance)})"

    rows = [
        [fact("Dues", html.escape(name))],
        [
            fact("Balance", html.escape(_money(balance))),
            fact("Due", html.escape(due_text)),
        ],
    ]
    body = f"<p>{html.escape(lead)}</p>" + facts(rows) + (
        f"<p>{html.escape(fee_line)}</p>" if fee_line else ""
    ) + "<p>If you have already paid, the Treasurer may not have recorded it " "yet; there is nothing more you need to do.</p>" + action(
        html.escape(link), "See my dues"
    )
    text = (
        f"{lead}\n\nDues: {name}\nBalance: {_money(balance)}\nDue: {due_text}\n"
        + (f"\n{fee_line}\n" if fee_line else "")
        + "\nIf you have already paid, the Treasurer may not have recorded it "
        "yet; there is nothing more you need to do.\n" + f"\nSee my dues: {link}\n"
    )
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[member.email],
        subject=_subject_safe(subject),
        html_body=wrap_email_body(org, title, body, header_color=accent, chip=chip),
        text_body=text,
        db=db,
        template_type=f"dues_reminder_{kind}",
    )
    return bool(sent)


async def send_dues_reminders(
    db: AsyncSession, org: Organization, now: Optional[datetime] = None
) -> int:
    """Send this department's due dues reminders. Returns how many went out."""
    now = now or datetime.now(timezone.utc)
    org_id = str(org.id)
    result = await db.execute(
        select(MemberDues, DuesSchedule, User)
        .join(DuesSchedule, DuesSchedule.id == MemberDues.dues_schedule_id)
        .join(User, User.id == MemberDues.user_id)
        .where(
            MemberDues.organization_id == org_id,
            DuesSchedule.organization_id == org_id,
            User.organization_id == org_id,
            User.is_active,
            MemberDues.status.in_(OWING_STATUSES),
            MemberDues.amount_paid < MemberDues.amount_due,
            or_(
                # Coming due within the window, not yet reminded.
                (MemberDues.due_date >= now)
                & (MemberDues.due_date <= now + timedelta(days=DUE_SOON_DAYS))
                & MemberDues.due_reminder_sent_at.is_(None),
                # Overdue within the window, not yet reminded.
                (MemberDues.due_date < now)
                & (MemberDues.due_date >= now - timedelta(days=OVERDUE_WINDOW_DAYS))
                & MemberDues.overdue_reminder_sent_at.is_(None),
            ),
        )
        .order_by(MemberDues.due_date, MemberDues.id)
        .limit(500)
    )
    rows = list(result.all())
    if not rows:
        return 0

    required = department_required_kinds(org)
    sent_count = 0
    for dues, schedule, member in rows:
        kind = reminder_kind(dues, now)
        if kind is None:
            continue
        receives = bool(member.email) and member_receives_email(
            member.notification_preferences, EmailKind.DUES_REMINDERS, required
        )
        if receives:
            try:
                delivered = await _send(db, org, member, dues, schedule, kind)
            except Exception as exc:
                logger.warning(
                    "Dues reminder {} for dues {} failed: {}", kind, dues.id, exc
                )
                delivered = False
            if not delivered:
                # Left unstamped: the next run retries while it is in window.
                continue
            sent_count += 1
        stamp = datetime.now(timezone.utc)
        if kind == DUE_SOON:
            dues.due_reminder_sent_at = stamp
        else:
            dues.overdue_reminder_sent_at = stamp
        await db.commit()
    if sent_count:
        logger.info("Sent {} dues reminder(s) for org {}", sent_count, org_id)
    return sent_count
