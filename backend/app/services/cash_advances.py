"""
Cash advances: money handed to a member before an expense, under the
department's accountable plan.

An advance is a check request marked ``is_advance``, paid to the member who
requested it through the same approval chain, dual-approval rule and issue
step as any check. It charges no budget line or restricted fund: nothing has
been spent yet. The member accounts for it with expense reports linked to it
(``ExpenseReport.advance_id``), whose lines charge the budget as any report's
do, and hands back what was not spent (``AdvanceReturn``).

``outstanding = amount - accounted - returned``, where ``accounted`` is the
part of each linked report the advance covers (``advance_applied``, fixed when
the report is submitted) over the reports that are submitted, awaiting
approval, approved or paid. Submitting is what substantiates the expense under
Treas. Reg. 1.62-2(g)(2), so a report waiting on an approver counts; a denied
or cancelled one no longer does, and its share is owed again.

The IRS's fixed-date safe harbor allows 120 days after the advance to return
any amount not accounted for; past that the excess is the member's wages. An
advance still outstanding 120 days after its check is overdue, and while one
is the member cannot submit another (``assert_no_overdue``). The deadline is
fixed at the safe harbor rather than configurable: unlike the substantiation
days, a department has no reason to be stricter about a return the member
could make at any time.

**The periodic statement method** (Treas. Reg. 1.62-2(g)(2)(ii); owner
decision 2026-11-01) is the IRS's other safe harbor: the department gives the
member a statement at least quarterly of what is still outstanding, and the
member has 120 days from the statement to account for it or return it. Here
a statement falls on the last day of each calendar quarter, on the
department's calendar, after the check -- never on the day of the check
itself -- and is emailed to the member (``cash_advance_statements``). What
the first statement lists is everything not yet accounted for, so once 120
days have passed since it, anything still outstanding was on it: the
advance's deadline is the 120th day after its first statement, through the
end of that day. Later statements remind; they do not move the deadline.

The department chooses the method (``advance_return_method`` in
``app/utils/finance_settings.py``, fixed-date by default). An advance takes
the method in force when its check is issued (``CheckRequest.
advance_return_method``) and keeps it, so a change of setting moves no
deadline already running. ``AdvanceBalance.due_at`` is the one place either
deadline is worked out; overdue, the block on another advance, the advance
page and the advances report all read it (CLAUDE.md pitfall #29).

**On a member's behalf** (owner decision 2026-11-01): a ``finance.manage``
holder may raise an advance for another member. The member is still
``requested_by`` -- the holder, who owes it, is emailed its statements and is
blocked while it is overdue -- and the officer is ``raised_by``. Separation of
duties then binds both: neither may approve it or issue its check
(``assert_not_raiser`` beside the existing requester rule).
"""

from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    AdvanceReturn,
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExpenseReportStatus,
)
from app.models.user import Organization, User
from app.services.separation_of_duties import SeparationOfDutiesError
from app.utils.finance_settings import (
    ADVANCE_FIXED_DATE,
    ADVANCE_PERIODIC_STATEMENT,
    ADVANCE_RETURN_METHODS,
)
from app.utils.org_timezone import local_date, local_day_start_utc, scheduling_timezone

ZERO = Decimal("0.00")

# Treas. Reg. 1.62-2(g)(2)(i): return within 120 days after the advance.
ADVANCE_RETURN_DAYS = 120

# The report statuses that account for an advance (see the module docstring).
ACCOUNTING_STATUSES = (
    ExpenseReportStatus.SUBMITTED,
    ExpenseReportStatus.PENDING_APPROVAL,
    ExpenseReportStatus.APPROVED,
    ExpenseReportStatus.PAID,
)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def advance_method(stored: Optional[str]) -> str:
    """An advance's method; null (every advance issued before the setting
    existed) and anything unrecognised read as fixed-date."""
    return stored if stored in ADVANCE_RETURN_METHODS else ADVANCE_FIXED_DATE


def _quarter_end(year: int, quarter: int) -> date:
    month = quarter * 3
    return date(year, month, monthrange(year, month)[1])


def first_statement_date(issued_on: date) -> date:
    """The first calendar-quarter end after the day the check was issued."""
    quarter = (issued_on.month - 1) // 3 + 1
    end = _quarter_end(issued_on.year, quarter)
    if end > issued_on:
        return end
    return (
        _quarter_end(issued_on.year + 1, 1)
        if quarter == 4
        else _quarter_end(issued_on.year, quarter + 1)
    )


def statement_dates(issued_on: date, through: date) -> list[date]:
    """Every statement date from the first through ``through`` inclusive."""
    dates: list[date] = []
    current = first_statement_date(issued_on)
    while current <= through:
        dates.append(current)
        current = first_statement_date(current)
    return dates


def statement_due_date(statement_date: date) -> date:
    """The last day to account for or return what a statement lists."""
    return statement_date + timedelta(days=ADVANCE_RETURN_DAYS)


@dataclass
class AdvanceBalance:
    advance_id: str
    member_id: str
    amount: Decimal
    issued_at: Optional[datetime]
    accounted: Decimal = ZERO
    returned: Decimal = ZERO
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    method: str = ADVANCE_FIXED_DATE
    # The department's calendar, for the periodic method's quarter ends.
    tz: ZoneInfo = field(default_factory=lambda: ZoneInfo("UTC"))

    @property
    def outstanding(self) -> Decimal:
        return self.amount - self.accounted - self.returned

    @property
    def first_statement(self) -> Optional[date]:
        """The periodic method's first statement date; None on fixed-date."""
        if self.issued_at is None or self.method != ADVANCE_PERIODIC_STATEMENT:
            return None
        return first_statement_date(local_date(self.issued_at, self.tz))

    @property
    def due_at(self) -> Optional[datetime]:
        if self.issued_at is None:
            return None
        first = self.first_statement
        if first is not None:
            # Through the end of the 120th day after the first statement, on
            # the department's calendar: the last second of that day, so the
            # date shown and the moment it turns overdue are the same day.
            return local_day_start_utc(
                statement_due_date(first) + timedelta(days=1), self.tz
            ) - timedelta(seconds=1)
        return _aware(self.issued_at) + timedelta(days=ADVANCE_RETURN_DAYS)

    def statement_dates(self) -> list[date]:
        """The periodic method's statements due so far, and the next one."""
        first = self.first_statement
        if first is None or self.issued_at is None:
            return []
        today = local_date(self.now, self.tz)
        dates = statement_dates(local_date(self.issued_at, self.tz), today)
        upcoming = first_statement_date(dates[-1]) if dates else first
        return dates + [upcoming]

    @property
    def overdue(self) -> bool:
        due = self.due_at
        return self.outstanding > 0 and due is not None and self.now >= due


class AdvanceNotSettleableError(ValueError):
    """The chosen advance is not one this member can account for."""

    def __init__(self) -> None:
        super().__init__("That is not one of your issued cash advances.")


class OverdueAdvanceError(ValueError):
    def __init__(self, numbers: list[str]) -> None:
        shown = ", ".join(numbers[:3]) + (" and others" if len(numbers) > 3 else "")
        super().__init__(
            f"Cash advance {shown} is past its return deadline and not fully "
            "accounted for. Submit an expense report for it or return what was "
            "not spent before requesting another advance."
        )


class AdvanceHolderError(ValueError):
    """The member an advance is raised for cannot hold one."""

    def __init__(self) -> None:
        super().__init__(
            "A cash advance can be raised only for a current member of this "
            "department."
        )


def assert_not_raiser(
    actor_id: Optional[str], raised_by: Optional[str], *, action: str
) -> None:
    """Refuse the officer who raised an advance for a member the approval or
    issue of it: raising and approving one's own disbursement is the conflict
    the requester rule exists to stop, and raising it for somebody else does
    not remove it. Unattributed either way is no known conflict, as in
    ``assert_different_person``."""
    if not actor_id or not raised_by or str(actor_id) != str(raised_by):
        return
    raise SeparationOfDutiesError(
        f"You raised this cash advance for the member, so you cannot {action} "
        "it. Separation of duties requires someone else to."
    )


async def assert_holder_eligible(db: AsyncSession, org_id: str, holder_id: str) -> None:
    """The member an advance is raised for is a current member of this
    department (CLAUDE.md pitfalls #14c and #32)."""
    found = await db.execute(
        select(User.id).where(
            User.id == holder_id,
            User.organization_id == org_id,
            User.is_active,
        )
    )
    if found.scalar_one_or_none() is None:
        raise AdvanceHolderError()


async def advance_calendar(db: AsyncSession, org_id: str) -> ZoneInfo:
    """The department's calendar, which the periodic method's quarters
    follow; the same zone ``org_today`` answers in."""
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    return scheduling_timezone(org)


async def advance_balances(
    db: AsyncSession,
    org_id: str,
    *,
    advance_ids: Optional[Iterable[str]] = None,
    member_id: Optional[str] = None,
    lock: bool = False,
    now: Optional[datetime] = None,
) -> dict[str, AdvanceBalance]:
    """Every issued advance's balance, keyed by id, oldest first.

    ``lock`` makes the sums locking reads, for a caller that already holds the
    advance's row lock and is about to decide on its balance (CLAUDE.md
    pitfall #27: a plain read would answer from a snapshot older than that
    lock).
    """
    query = select(CheckRequest).where(
        CheckRequest.organization_id == org_id,
        CheckRequest.is_advance.is_(True),
        CheckRequest.status == CheckRequestStatus.ISSUED,
    )
    if advance_ids is not None:
        ids = sorted(set(advance_ids))
        if not ids:
            return {}
        query = query.where(CheckRequest.id.in_(ids))
    if member_id is not None:
        query = query.where(CheckRequest.requested_by == member_id)
    query = query.order_by(CheckRequest.check_date, CheckRequest.id)
    moment = now or datetime.now(timezone.utc)
    advances = list((await db.execute(query)).scalars())
    if not advances:
        return {}
    tz = await advance_calendar(db, org_id)
    balances = {
        cr.id: AdvanceBalance(
            advance_id=cr.id,
            member_id=cr.requested_by,
            amount=_money(cr.amount),
            issued_at=cr.check_date,
            now=moment,
            method=advance_method(cr.advance_return_method),
            tz=tz,
        )
        for cr in advances
    }
    ids = list(balances)

    accounted = (
        select(ExpenseReport.advance_id, func.sum(ExpenseReport.advance_applied))
        .where(
            ExpenseReport.organization_id == org_id,
            ExpenseReport.advance_id.in_(ids),
            ExpenseReport.status.in_(ACCOUNTING_STATUSES),
        )
        .group_by(ExpenseReport.advance_id)
    )
    returned = (
        select(AdvanceReturn.advance_id, func.sum(AdvanceReturn.amount))
        .where(
            AdvanceReturn.organization_id == org_id,
            AdvanceReturn.advance_id.in_(ids),
        )
        .group_by(AdvanceReturn.advance_id)
    )
    if lock:
        accounted = accounted.with_for_update()
        returned = returned.with_for_update()
    for advance_id, total in (await db.execute(accounted)).all():
        # The query is filtered to these ids, so none is null.
        if advance_id is not None:
            balances[advance_id].accounted = _money(total)
    for advance_id, total in (await db.execute(returned)).all():
        balances[advance_id].returned = _money(total)
    return balances


async def lock_advance(
    db: AsyncSession, org_id: str, advance_id: str
) -> Optional[CheckRequest]:
    """The advance's row, locked for this transaction and refreshed."""
    result = await db.execute(
        select(CheckRequest)
        .where(
            CheckRequest.id == advance_id,
            CheckRequest.organization_id == org_id,
            CheckRequest.is_advance.is_(True),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    advance: Optional[CheckRequest] = result.scalar_one_or_none()
    return advance


async def assert_settleable(
    db: AsyncSession, org_id: str, advance_id: str, member_id: str
) -> None:
    """A report may account only for its own member's issued advance, in this
    department (CLAUDE.md pitfall #14c)."""
    found = await db.execute(
        select(CheckRequest.id).where(
            CheckRequest.id == advance_id,
            CheckRequest.organization_id == org_id,
            CheckRequest.is_advance.is_(True),
            CheckRequest.status == CheckRequestStatus.ISSUED,
            CheckRequest.requested_by == member_id,
        )
    )
    if found.scalar_one_or_none() is None:
        raise AdvanceNotSettleableError()


async def assert_no_overdue(db: AsyncSession, org_id: str, member_id: str) -> None:
    """Refuse a new advance while the member has an overdue one."""
    balances = await advance_balances(db, org_id, member_id=member_id)
    overdue = [b.advance_id for b in balances.values() if b.overdue]
    if not overdue:
        return
    numbers = (
        await db.execute(
            select(CheckRequest.request_number)
            .where(CheckRequest.id.in_(overdue))
            .order_by(CheckRequest.check_date, CheckRequest.id)
        )
    ).scalars()
    raise OverdueAdvanceError(list(numbers))


async def is_accounted_for(db: AsyncSession, org_id: str, advance_id: str) -> bool:
    """Whether a report accounts for the advance or a return has been recorded
    against it: voiding it would leave them pointing at money never paid."""
    for statement in (
        select(ExpenseReport.id).where(
            ExpenseReport.organization_id == org_id,
            ExpenseReport.advance_id == advance_id,
            ExpenseReport.status.in_(ACCOUNTING_STATUSES),
        ),
        select(AdvanceReturn.id).where(
            AdvanceReturn.organization_id == org_id,
            AdvanceReturn.advance_id == advance_id,
        ),
    ):
        if (await db.execute(statement.limit(1))).first() is not None:
            return True
    return False
