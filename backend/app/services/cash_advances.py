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
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    AdvanceReturn,
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExpenseReportStatus,
)

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


@dataclass
class AdvanceBalance:
    advance_id: str
    member_id: str
    amount: Decimal
    issued_at: Optional[datetime]
    accounted: Decimal = ZERO
    returned: Decimal = ZERO
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def outstanding(self) -> Decimal:
        return self.amount - self.accounted - self.returned

    @property
    def due_at(self) -> Optional[datetime]:
        if self.issued_at is None:
            return None
        return _aware(self.issued_at) + timedelta(days=ADVANCE_RETURN_DAYS)

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
            f"Cash advance {shown} is more than {ADVANCE_RETURN_DAYS} days old and "
            "not fully accounted for. Submit an expense report for it or return "
            "what was not spent before requesting another advance."
        )


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
    balances = {
        cr.id: AdvanceBalance(
            advance_id=cr.id,
            member_id=cr.requested_by,
            amount=_money(cr.amount),
            issued_at=cr.check_date,
            now=moment,
        )
        for cr in (await db.execute(query)).scalars()
    }
    if not balances:
        return balances
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
