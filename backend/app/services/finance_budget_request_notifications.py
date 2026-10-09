"""Email notices for next year's budget requests.

Four notices (owner decisions, 2026-10-08), every one **email only**:

=====================  ============================================  ====================
Notice                 Recipients                                    Email kind
=====================  ============================================  ====================
Request submitted      active ``finance.manage`` holders (the        ``FINANCE_DUTIES``
                       Treasurers), not the member who submitted
Decision made          the submitter and the active holders of the   ``BUDGET_REQUESTS``
                       position that owns the line, not the decider
Requests open /        the active holders of every position that     ``BUDGET_REQUESTS``
deadline changed       owns a line in the draft year, once each
Deadline reminder      those owners who still owe a request for at   ``BUDGET_REQUESTS``
                       least one of their lines (scheduled)
=====================  ============================================  ====================

Never SMS: these are administrative notices with a deadline days away, not
alerts, and none is in ``SmsAlert`` (CLAUDE.md pitfall #18). No bell entry
either — the Finance module has none for anything, and the deadline and the
decision are on the owner's screen. Both kinds are optional and on by
default (``email_policy``), so a member can turn them off and a department
can make them required.

Who owns a line is ``finance_budget_ownership``'s answer — the line's own
owner position, else its category's (pitfall #29). Every query is constrained
to the organization (#14). A notice that fails to send is logged and
dropped: it never fails the action that caused it, the way
``send_approval_request_email`` never does.

**Idempotency of the reminder.** It runs from the in-process scheduler once a
day, and again whenever the scheduler restarts, so "it is N days before the
deadline" alone would send twice after a restart. Each reminder sent is
recorded as an email-channel ``NotificationLog`` row (category
:data:`REMINDER_LOG_CATEGORY`, metadata naming the year, the deadline and the
offset); a member already recorded for that (year, deadline, offset) is not
sent it again. The requests-open notice is recorded the same way
(:data:`WINDOW_LOG_CATEGORY`) so a member told on the day the window began
is not reminded the same week as well. Moving the deadline starts a fresh
set, because the deadline is part of the key.
"""

from __future__ import annotations

import html
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.finance import (
    BudgetRequest,
    BudgetRequestStatus,
    FiscalYear,
    FiscalYearStatus,
)
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import ACCENT_BLUE, ACCENT_GREEN, action, fact, facts
from app.services.finance_budget_ownership import (
    line_owner_members_query,
    position_holders_query,
)
from app.utils.org_timezone import org_today

OWNER_PATH = "/finance/budget-requests"
REVIEW_PATH = "/finance/budget-requests/review"

# Days before the deadline a reminder goes out. Constants rather than a
# department setting: no existing finance setting holds one, and a new
# settings section for two numbers is more surface than the reminder is worth.
REMINDER_OFFSETS_DAYS = (7, 1)

REMINDER_LOG_CATEGORY = "budget_request_reminder"
WINDOW_LOG_CATEGORY = "budget_request_window"

# A line whose request has reached the Treasurer — or been decided — is not
# owed any more; a draft that was never submitted, or no request at all, is.
_HANDED_IN = (
    BudgetRequestStatus.SUBMITTED,
    BudgetRequestStatus.APPROVED,
    BudgetRequestStatus.ADJUSTED,
    BudgetRequestStatus.DECLINED,
)

_DECISION_WORDS = {
    "approved": "approved",
    "adjusted": "approved at a different amount",
    "declined": "declined",
}


# ============================================
# Formatting
# ============================================


def money(value) -> str:
    amount = Decimal(value or 0).quantize(Decimal("0.01"))
    return f"${amount:,.2f}"


def long_date(value: date) -> str:
    """A calendar day as a member reads it: "October 15, 2026"."""
    return f"{value:%B} {value.day}, {value.year}"


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a category name would end it.
    return " ".join((text or "").split())


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _paragraphs(text: str) -> str:
    return f'<p style="white-space:pre-line;">{html.escape(text)}</p>'


# ============================================
# Recipients
# ============================================


async def treasurers(db: AsyncSession, org_id: str) -> list[User]:
    """Active members holding ``finance.manage`` in the org.

    The same recipient rule the approver-coverage report uses
    (``ApproverDirectory.active_members`` + ``user_has_permission``), so a
    module wildcard, ``*``, a rank default or a legacy alias counts here
    exactly as it does at the decide endpoint's gate.
    """
    from app.api.dependencies import user_has_permission
    from app.services.finance_approver_matching import ApproverDirectory

    members = await ApproverDirectory(db, org_id).active_members()
    return [m for m in members if user_has_permission(m, "finance.manage")]


async def _active_member(
    db: AsyncSession, org_id: str, user_id: Optional[str]
) -> Optional[User]:
    if not user_id:
        return None
    result = await db.execute(
        select(User).where(
            User.id == str(user_id),
            User.organization_id == org_id,
            User.is_active,
        )
    )
    return result.scalar_one_or_none()


async def position_holders(
    db: AsyncSession, org_id: str, position_id: Optional[str]
) -> list[User]:
    if not position_id:
        return []
    result = await db.execute(position_holders_query(org_id, position_id))
    return list(result.scalars().unique().all())


async def year_owners(
    db: AsyncSession, org_id: str, fiscal_year_id: str
) -> dict[str, tuple[User, set[str]]]:
    """Every owner of a line in the year: member id -> (member, line ids)."""
    result = await db.execute(line_owner_members_query(org_id, fiscal_year_id))
    owners: dict[str, tuple[User, set[str]]] = {}
    for user, budget_id in result.all():
        entry = owners.setdefault(str(user.id), (user, set()))
        entry[1].add(str(budget_id))
    return owners


def _unique(users: Iterable[User], exclude: Optional[str] = None) -> list[User]:
    seen: set[str] = set()
    out = []
    for user in users:
        key = str(user.id)
        if key in seen or key == (str(exclude) if exclude else None):
            continue
        seen.add(key)
        out.append(user)
    return out


def _who_receive(
    users: Iterable[User], kind: EmailKind, org: Optional[Organization]
) -> list[User]:
    required = department_required_kinds(org)
    return [
        u
        for u in users
        if u.email and member_receives_email(u.notification_preferences, kind, required)
    ]


# ============================================
# Sending
# ============================================


async def _send(
    db: AsyncSession,
    org: Optional[Organization],
    users: list[User],
    *,
    subject: str,
    title: str,
    body_html: str,
    text_body: str,
    chip: str,
    accent: str,
    template_type: str,
) -> list[User]:
    """Email ``users`` one message each; return the ones the mailer accepted."""
    if not users:
        return []
    from app.services.email_service import EmailService, wrap_email_body

    html_body = wrap_email_body(org, title, body_html, header_color=accent, chip=chip)
    results: list[bool] = []
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[u.email for u in users],
        subject=_subject_safe(subject),
        html_body=html_body,
        text_body=text_body,
        db=db,
        template_type=template_type,
        results_out=results,
    )
    if len(results) == len(users):
        return [u for u, ok in zip(users, results) if ok]
    return list(users) if sent == len(users) else []


def _record(
    db: AsyncSession,
    org_id: str,
    users: list[User],
    *,
    category: str,
    subject: str,
    metadata: dict,
) -> None:
    """The sent-log the reminder's idempotency reads (module docstring)."""
    for user in users:
        db.add(
            NotificationLog(
                organization_id=org_id,
                recipient_id=str(user.id),
                recipient_email=user.email,
                channel=NotificationChannel.EMAIL,
                category=category,
                subject=_subject_safe(subject)[:500],
                action_url=OWNER_PATH,
                delivered=True,
                notification_metadata=dict(metadata),
            )
        )


async def _describe(db: AsyncSession, request: BudgetRequest, org_id: str) -> dict:
    from app.services.finance_budget_request_service import (
        FinanceBudgetRequestService,
    )

    return (await FinanceBudgetRequestService(db).describe([request], org_id))[0]


async def _load_request(
    db: AsyncSession, org_id: str, request_id: str
) -> Optional[BudgetRequest]:
    result = await db.execute(
        select(BudgetRequest).where(
            BudgetRequest.id == str(request_id),
            BudgetRequest.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


# ============================================
# 1. Request submitted -> the Treasurers
# ============================================


async def notify_request_submitted(
    db: AsyncSession, org_id: str, request_id: str, submitted_by: str
) -> int:
    """Tell the Treasurers a request is waiting. Never raises; returns sends."""
    try:
        request = await _load_request(db, org_id, request_id)
        if request is None:
            return 0
        row = await _describe(db, request, org_id)
        org = await db.get(Organization, org_id)
        recipients = _who_receive(
            _unique(await treasurers(db, org_id), exclude=submitted_by),
            EmailKind.FINANCE_DUTIES,
            org,
        )
        if not recipients:
            return 0
        line = row["line_label"]
        amount = money(row["requested_amount"])
        submitter = row.get("submitted_by_name") or "A line owner"
        year = row.get("fiscal_year_name") or "next year"
        rows = [
            [fact("Budget line", html.escape(line))],
            [
                fact("Requested", html.escape(amount)),
                fact("Submitted by", html.escape(submitter)),
            ],
        ]
        if row.get("last_year_budgeted") is not None:
            rows.append(
                [
                    fact(
                        "Budgeted this year",
                        html.escape(money(row["last_year_budgeted"])),
                    ),
                    fact(
                        "Spent this year",
                        html.escape(money(row["last_year_spent"])),
                    ),
                ]
            )
        link = _link(REVIEW_PATH)
        body = (
            f"<p>{html.escape(submitter)} submitted a budget request for "
            f"{html.escape(year)}.</p>"
            + facts(rows)
            + "<p><strong>Justification</strong></p>"
            + _paragraphs(row.get("justification") or "")
            + action(html.escape(link), "Review budget requests")
        )
        text = (
            f"{submitter} submitted a budget request for {year}.\n\n"
            f"Budget line: {line}\nRequested: {amount}\n\n"
            f"Justification:\n{row.get('justification') or ''}\n\n"
            f"Review budget requests: {link}\n"
        )
        sent = await _send(
            db,
            org,
            recipients,
            subject=f"Budget request to review: {line} ({amount})",
            title="Budget request to review",
            body_html=body,
            text_body=text,
            chip="Budget request",
            accent=ACCENT_BLUE,
            template_type="finance_budget_request_submitted",
        )
        return len(sent)
    except Exception as exc:
        logger.warning("Budget request submitted email failed: {}", exc)
        return 0


# ============================================
# 2. Decision made -> the submitter and the line's owners
# ============================================


async def notify_request_decided(
    db: AsyncSession, org_id: str, request_id: str, decided_by: str
) -> int:
    """Tell the submitter and the owning position's holders the outcome."""
    try:
        request = await _load_request(db, org_id, request_id)
        if request is None:
            return 0
        row = await _describe(db, request, org_id)
        status = row["status"]
        if status not in _DECISION_WORDS:
            return 0
        org = await db.get(Organization, org_id)
        candidates = []
        submitter = await _active_member(db, org_id, request.submitted_by)
        if submitter is not None:
            candidates.append(submitter)
        candidates.extend(
            await position_holders(db, org_id, row.get("owner_position_id"))
        )
        recipients = _who_receive(
            _unique(candidates, exclude=decided_by), EmailKind.BUDGET_REQUESTS, org
        )
        if not recipients:
            return 0
        line = row["line_label"]
        year = row.get("fiscal_year_name") or "next year"
        words = _DECISION_WORDS[status]
        rows = [
            [fact("Budget line", html.escape(line))],
            [fact("Requested", html.escape(money(row["requested_amount"])))],
        ]
        if status != "declined":
            rows[1].append(fact("Approved", html.escape(money(row["approved_amount"]))))
        note = (row.get("decision_note") or "").strip()
        link = _link(OWNER_PATH)
        body = (
            f"<p>The Treasurer {html.escape(words)} the budget request for "
            f"{html.escape(line)} in {html.escape(year)}.</p>"
            + facts(rows)
            + (
                "<p><strong>Treasurer's note</strong></p>" + _paragraphs(note)
                if note
                else ""
            )
            + action(html.escape(link), "Open next year's budget")
        )
        text = (
            f"The Treasurer {words} the budget request for {line} in {year}.\n\n"
            f"Requested: {money(row['requested_amount'])}\n"
            + (
                f"Approved: {money(row['approved_amount'])}\n"
                if status != "declined"
                else ""
            )
            + (f"\nTreasurer's note:\n{note}\n" if note else "")
            + f"\nOpen next year's budget: {link}\n"
        )
        heading = {
            "approved": "Budget request approved",
            "adjusted": "Budget request adjusted",
            "declined": "Budget request declined",
        }[status]
        sent = await _send(
            db,
            org,
            recipients,
            subject=f"{heading}: {line}",
            title=heading,
            body_html=body,
            text_body=text,
            chip="Budget request",
            accent=ACCENT_GREEN if status != "declined" else ACCENT_BLUE,
            template_type="finance_budget_request_decided",
        )
        return len(sent)
    except Exception as exc:
        logger.warning("Budget request decision email failed: {}", exc)
        return 0


# ============================================
# 3. Requests open / deadline changed -> every owner in the year
# ============================================


async def notify_requests_open(
    db: AsyncSession,
    org_id: str,
    fiscal_year_id: str,
    *,
    changed: bool,
    today: Optional[date] = None,
) -> int:
    """Tell a draft year's line owners requests are open, or the date moved.

    The caller decides whether to call: only when a deadline was set or
    changed (not cleared) and requests are open after the change. Each
    member is sent one email however many lines they own.
    """
    try:
        fy = (
            await db.execute(
                select(FiscalYear).where(
                    FiscalYear.id == str(fiscal_year_id),
                    FiscalYear.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if fy is None or fy.request_deadline is None:
            return 0
        org = await db.get(Organization, org_id)
        today = today or org_today(org)
        owners = await year_owners(db, org_id, fy.id)
        recipients = _who_receive(
            [user for user, _lines in owners.values()],
            EmailKind.BUDGET_REQUESTS,
            org,
        )
        if not recipients:
            return 0
        deadline = long_date(fy.request_deadline)
        link = _link(OWNER_PATH)
        if changed:
            title = "Budget request deadline changed"
            subject = f"Budget request deadline for {fy.name} changed to {deadline}"
            lead = (
                f"The deadline for {fy.name} budget requests is now "
                f"{deadline}. Requests stay open through the end of that day."
            )
        else:
            title = "Budget requests are open"
            subject = f"Budget requests for {fy.name} are open until {deadline}"
            lead = (
                f"The Treasurer is planning {fy.name}. Your position owns at "
                "least one budget line, so you can propose next year's amount "
                f"for it. Requests are open through the end of {deadline}."
            )
        body = (
            f"<p>{html.escape(lead)}</p>"
            + facts([[fact("Requests close", html.escape(deadline))]])
            + action(html.escape(link), "Open next year's budget")
        )
        text = f"{lead}\n\nOpen next year's budget: {link}\n"
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title=title,
            body_html=body,
            text_body=text,
            chip="Budget planning",
            accent=ACCENT_BLUE,
            template_type="finance_budget_requests_open",
        )
        _record(
            db,
            org_id,
            sent,
            category=WINDOW_LOG_CATEGORY,
            subject=subject,
            metadata={
                "fiscal_year_id": str(fy.id),
                "deadline": fy.request_deadline.isoformat(),
                "org_date": today.isoformat(),
            },
        )
        return len(sent)
    except Exception as exc:
        logger.warning("Budget requests open email failed: {}", exc)
        return 0


# ============================================
# 4. Deadline reminder (scheduled)
# ============================================


def due_offset(deadline: date, today: date) -> Optional[int]:
    """The reminder whose window has begun, the most urgent first.

    The 7-day reminder is due from seven days before the deadline, the 1-day
    one from the day before. A reminder missed because the scheduler was
    down still goes out on the next run inside its window; once the next one
    is due, the earlier one is skipped. ``None`` before the first window and
    after the deadline.
    """
    days_left = (deadline - today).days
    if days_left < 0:
        return None
    due = [offset for offset in REMINDER_OFFSETS_DAYS if days_left <= offset]
    return min(due) if due else None


async def _owing(
    db: AsyncSession, org_id: str, fy: FiscalYear, owners: dict
) -> list[User]:
    """Owners with at least one line in the year no request was handed in for."""
    if not owners:
        return []
    handed_in = await db.execute(
        select(BudgetRequest.budget_id).where(
            BudgetRequest.organization_id == org_id,
            BudgetRequest.fiscal_year_id == fy.id,
            BudgetRequest.budget_id.isnot(None),
            BudgetRequest.status.in_(_HANDED_IN),
        )
    )
    done = {str(row) for row in handed_in.scalars().all()}
    return [user for user, lines in owners.values() if lines - done]


async def _already_told(
    db: AsyncSession,
    org_id: str,
    fy: FiscalYear,
    users: list[User],
    offset: int,
) -> set[str]:
    """Members sent this reminder, or the open notice inside its window."""
    if not users:
        return set()
    deadline = fy.request_deadline
    window_start = deadline - timedelta(days=offset)
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.organization_id == org_id,
            NotificationLog.channel == NotificationChannel.EMAIL,
            NotificationLog.category.in_([REMINDER_LOG_CATEGORY, WINDOW_LOG_CATEGORY]),
            NotificationLog.recipient_id.in_([str(u.id) for u in users]),
        )
    )
    told: set[str] = set()
    for log in result.scalars().all():
        meta = log.notification_metadata or {}
        if not isinstance(meta, dict):
            continue
        if meta.get("fiscal_year_id") != str(fy.id):
            continue
        if meta.get("deadline") != deadline.isoformat():
            continue
        if log.category == REMINDER_LOG_CATEGORY:
            if meta.get("offset_days") == offset:
                told.add(str(log.recipient_id))
            continue
        # A requests-open (or deadline-changed) notice sent inside this
        # reminder's window already said everything the reminder would.
        sent_on = meta.get("org_date")
        if isinstance(sent_on, str) and sent_on >= window_start.isoformat():
            told.add(str(log.recipient_id))
    return told


async def send_deadline_reminders(db: AsyncSession, org: Organization) -> int:
    """One department's reminders for today. Returns the number sent.

    For each draft, unlocked year whose deadline is today or later and whose
    reminder window has begun (:func:`due_offset`): the owners who still owe
    a request and have not been told for this (year, deadline, offset).
    Commits once, after the department is done, so the sent-log and the
    sends agree; the scheduler's per-org guard rolls back a failure.
    """
    org_id = str(org.id)
    today = org_today(org)
    years = await db.execute(
        select(FiscalYear).where(
            FiscalYear.organization_id == org_id,
            FiscalYear.status == FiscalYearStatus.DRAFT,
            FiscalYear.is_locked.is_(False),
            FiscalYear.request_deadline.isnot(None),
            FiscalYear.request_deadline >= today,
        )
    )
    total = 0
    for fy in years.scalars().all():
        offset = due_offset(fy.request_deadline, today)
        if offset is None:
            continue
        owners = await year_owners(db, org_id, fy.id)
        owing = await _owing(db, org_id, fy, owners)
        told = await _already_told(db, org_id, fy, owing, offset)
        recipients = _who_receive(
            [u for u in owing if str(u.id) not in told],
            EmailKind.BUDGET_REQUESTS,
            org,
        )
        if not recipients:
            continue
        deadline = long_date(fy.request_deadline)
        days_left = (fy.request_deadline - today).days
        when = {0: "today", 1: "tomorrow"}.get(days_left, f"in {days_left} days")
        subject = f"Reminder: budget requests for {fy.name} close {deadline}"
        lead = (
            f"Budget requests for {fy.name} close {when}, at the end of "
            f"{deadline}. At least one budget line your position owns has no "
            "request submitted yet."
        )
        link = _link(OWNER_PATH)
        body = (
            f"<p>{html.escape(lead)}</p>"
            + facts([[fact("Requests close", html.escape(deadline))]])
            + action(html.escape(link), "Open next year's budget")
        )
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title="Budget requests close soon",
            body_html=body,
            text_body=f"{lead}\n\nOpen next year's budget: {link}\n",
            chip="Budget planning",
            accent=ACCENT_BLUE,
            template_type="finance_budget_request_reminder",
        )
        _record(
            db,
            org_id,
            sent,
            category=REMINDER_LOG_CATEGORY,
            subject=subject,
            metadata={
                "fiscal_year_id": str(fy.id),
                "deadline": fy.request_deadline.isoformat(),
                "offset_days": offset,
                "org_date": today.isoformat(),
            },
        )
        total += len(sent)
    await db.commit()
    return total
