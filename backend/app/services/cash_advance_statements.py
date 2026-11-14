"""Quarterly statements for cash advances on the periodic-statement method.

Under Treas. Reg. 1.62-2(g)(2)(ii) the department gives the member a
statement, at least quarterly, of the advance still not accounted for, and
the member has 120 days from it to account for or return it. When each
statement falls and the deadline it sets are worked out in
``app/services/cash_advances.py``; this module only delivers them, from the
``advance_statements`` scheduled task.

**Email only, to the holder** -- the member the advance was paid to, also
when the finance office raised it on their behalf (owner decision
2026-11-01). Never SMS: it is an administrative notice with weeks to act on,
not an alert, and it is not in ``SmsAlert`` (CLAUDE.md pitfall #18). It is not
subject to the member's email preferences: the statement is the notice the
accountable plan's deadline runs from, so a member who turned finance email
off must still be given it. The advance's page shows the same statements to
the member and the finance office.

**Which statement.** On each run, an outstanding advance on the periodic
method is sent the statement for the latest quarter end on or before today
on the department's calendar, if it has not had it. A quarter the scheduler
missed entirely is not sent late: the next quarter's statement lists the
same balance.

**Idempotency** (CLAUDE.md pitfall #36). The id that makes a second run a
no-op is (advance, statement date), unique on ``advance_statements``. A run
first claims the statement by inserting its row, committed before anything is
sent, so a concurrent run's insert fails on the constraint and it moves on.
It then sends every claimed row not yet stamped ``emailed_at`` and stamps
each once the mailer accepts it: send, then stamp. A crash between the two
sends the statement again on the next run -- at least once, because a
duplicate statement is a nuisance and a missing one leaves the member
without the notice their deadline counts from.
"""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.finance import AdvanceStatement, CheckRequest
from app.models.user import Organization, User
from app.services.cash_advances import (
    advance_balances,
    statement_dates,
    statement_due_date,
)
from app.services.email_theme import ACCENT_AMBER, action, fact, facts
from app.utils.finance_settings import ADVANCE_PERIODIC_STATEMENT
from app.utils.org_timezone import local_date, org_today, scheduling_timezone

TEMPLATE_TYPE = "cash_advance_statement"


def latest_statement_date(issued_on: date, today: date) -> Optional[date]:
    """The statement a run on ``today`` sends, if any is due yet."""
    dates = statement_dates(issued_on, today)
    return dates[-1] if dates else None


def _money(value) -> str:
    amount = Decimal(value or 0).quantize(Decimal("0.01"))
    return f"${amount:,.2f}"


def _long_date(value: date) -> str:
    return f"{value:%B} {value.day}, {value.year}"


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


async def _claim(
    db: AsyncSession, org_id: str, advance_id: str, day: date, outstanding: Decimal
) -> None:
    """Insert the statement's row unless another run already has."""
    exists = await db.execute(
        select(AdvanceStatement.id).where(
            AdvanceStatement.advance_id == advance_id,
            AdvanceStatement.statement_date == day,
        )
    )
    if exists.scalar_one_or_none() is not None:
        return
    try:
        async with db.begin_nested():
            db.add(
                AdvanceStatement(
                    organization_id=org_id,
                    advance_id=advance_id,
                    statement_date=day,
                    due_date=statement_due_date(day),
                    outstanding=outstanding,
                )
            )
    except IntegrityError:
        # A concurrent run claimed it between the lookup and the insert.
        logger.info("Advance statement for {} on {} already claimed", advance_id, day)


async def _send_one(
    db: AsyncSession,
    org: Organization,
    statement: AdvanceStatement,
    advance: CheckRequest,
    holder: User,
) -> bool:
    from app.services.email_service import EmailService, wrap_email_body

    due_text = _long_date(statement.due_date)
    amount = _money(statement.outstanding)
    path = f"/finance/check-requests/{advance.id}"
    link = _link(path)
    subject = f"Cash advance statement: {amount} to account for by {due_text}"
    lead = (
        f"This is your statement for the quarter ending "
        f"{_long_date(statement.statement_date)}. Of the cash advance "
        f"{advance.request_number}, {amount} is not yet accounted for."
    )
    ask = (
        f"By {due_text}, submit an expense report against it for what you "
        "spent, and return what you did not spend. Anything not accounted for "
        "by then may have to be reported as your wages."
    )
    body = (
        f"<p>{html.escape(lead)}</p><p>{html.escape(ask)}</p>"
        + facts(
            [
                [
                    fact("Advance", html.escape(advance.request_number)),
                    fact("Advanced", html.escape(_money(advance.amount))),
                ],
                [
                    fact("Outstanding", html.escape(amount)),
                    fact("Account for it by", html.escape(due_text)),
                ],
            ]
        )
        + action(html.escape(link), "Open the advance")
    )
    text = (
        f"{lead}\n\n{ask}\n\nAdvance: {advance.request_number}\n"
        f"Outstanding: {amount}\nAccount for it by: {due_text}\n\n"
        f"Open the advance: {link}\n"
    )
    results: list[bool] = []
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[holder.email],
        subject=subject,
        html_body=wrap_email_body(
            org,
            "Cash advance statement",
            body,
            header_color=ACCENT_AMBER,
            chip="Finance",
        ),
        text_body=text,
        db=db,
        template_type=TEMPLATE_TYPE,
        results_out=results,
    )
    return bool(results[0]) if results else sent == 1


async def send_advance_statements(db: AsyncSession, org: Organization) -> int:
    """One department's statements due today; returns the number emailed."""
    org_id = str(org.id)
    today = org_today(org)
    tz = scheduling_timezone(org)
    balances = await advance_balances(db, org_id)
    for balance in balances.values():
        if (
            balance.method != ADVANCE_PERIODIC_STATEMENT
            or balance.issued_at is None
            or balance.outstanding <= 0
        ):
            continue
        day = latest_statement_date(local_date(balance.issued_at, tz), today)
        if day is not None:
            await _claim(db, org_id, balance.advance_id, day, balance.outstanding)
    await db.commit()

    pending = await db.execute(
        select(AdvanceStatement, CheckRequest, User)
        .join(
            CheckRequest,
            (CheckRequest.id == AdvanceStatement.advance_id)
            & (CheckRequest.organization_id == org_id),
        )
        .join(
            User,
            (User.id == CheckRequest.requested_by) & (User.organization_id == org_id),
        )
        .where(
            AdvanceStatement.organization_id == org_id,
            AdvanceStatement.emailed_at.is_(None),
        )
        .order_by(AdvanceStatement.statement_date, AdvanceStatement.id)
    )
    total = 0
    for statement, advance, holder in pending.all():
        if not holder.email or holder.deleted_at is not None:
            continue
        if await _send_one(db, org, statement, advance, holder):
            statement.emailed_at = datetime.now(timezone.utc)
            await db.commit()
            total += 1
    return total
