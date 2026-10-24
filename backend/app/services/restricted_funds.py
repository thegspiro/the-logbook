"""
Restricted funds: what a restricted fundraising campaign has received, what is
charged to it, and what it has left.

A donor who gives to a campaign for a stated purpose — new turnout gear, a
specific apparatus — restricts that gift to it, and spending it on anything
else breaches the donor's terms. A campaign marked ``is_restricted`` is such a
fund. Its money in is its **completed** donations, the same figure as the
campaign's raised total (``FundraisingService._update_campaign_total``); a
pledge not yet paid has not been received and cannot be spent. Its money out is
every payment charged to it through ``fund_campaign_id``:

* **spent** — a purchase request paid (its actual amount, else its estimate), a
  check issued and not voided, an expense line on a paid report;
* **committed** — approved and not yet paid: a purchase request approved,
  ordered or received (its estimate), a check request approved, an expense line
  on an approved report;
* **awaiting approval** — submitted and not yet decided. Not subtracted: it has
  not been agreed to, and an approver deciding it needs to see what is left
  before it.

A purchase claimed back through an expense report
(app/services/finance_reimbursement.py) is counted once: its estimate is
committed until the report is approved, the report's lines from then on.

``available = received - spent - committed``. These are the same stages that
move a budget line's spent and encumbered totals (``FinanceService``), counted
here from the records rather than kept as running totals, so a fund's balance
can never drift from the payments that make it up.

The department's ``fund_overspend_mode`` (``app/utils/finance_settings.py``)
decides what a shortfall does; ``FinanceService`` asks ``shortfalls`` when an
approval would commit a charge, and when a purchase is paid for more than its
estimate.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.grant import Donation, FundraisingCampaign, PaymentStatus

ZERO = Decimal("0.00")

KIND_PURCHASE = "purchase_request"
KIND_CHECK = "check_request"
KIND_EXPENSE = "expense_report"

_PR_COMMITTED = (
    PurchaseRequestStatus.APPROVED,
    PurchaseRequestStatus.ORDERED,
    PurchaseRequestStatus.RECEIVED,
)
_AWAITING = ("submitted", "pending_approval")


@dataclass
class FundBalance:
    campaign_id: str
    name: str
    purpose: Optional[str]
    active: bool
    received: Decimal = ZERO
    spent: Decimal = ZERO
    committed: Decimal = ZERO
    awaiting_approval: Decimal = ZERO

    @property
    def available(self) -> Decimal:
        return self.received - self.spent - self.committed


class FundNotChargeableError(ValueError):
    """The chosen fund is not one of this department's restricted funds."""

    def __init__(self) -> None:
        super().__init__(
            "That fund is not one of this department's active restricted funds."
        )


async def assert_chargeable(db: AsyncSession, org_id: str, campaign_id: str) -> None:
    """A payment may be charged only to an active restricted fund of its own
    department (Pitfall #14c: a client-supplied FK is checked in-org)."""
    found = await db.execute(
        select(FundraisingCampaign.id).where(
            FundraisingCampaign.id == campaign_id,
            FundraisingCampaign.organization_id == org_id,
            FundraisingCampaign.is_restricted.is_(True),
            FundraisingCampaign.active.is_(True),
        )
    )
    if found.scalar_one_or_none() is None:
        raise FundNotChargeableError()


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


async def fund_balances(
    db: AsyncSession,
    org_id: str,
    campaign_ids: Optional[Iterable[str]] = None,
    *,
    exclude: Optional[tuple[str, str]] = None,
    lock: bool = False,
) -> dict[str, FundBalance]:
    """Each restricted fund's balance, keyed by campaign id.

    ``campaign_ids`` limits it to those funds (an id that is not a restricted
    fund of this department is left out); ``None`` is every restricted fund,
    active or not. ``exclude`` is a ``(kind, id)`` pair whose charges are left
    out — the payment being decided, so its own amount is compared against
    what the others leave rather than counted twice.

    ``lock`` serializes a decision on these funds (Pitfall #27): the campaign
    rows are locked first, and every sum is a locking read, since under
    REPEATABLE READ a plain read would answer from a snapshot older than the
    lock and miss a charge another approval has just committed.
    """
    query = select(FundraisingCampaign).where(
        FundraisingCampaign.organization_id == org_id,
        FundraisingCampaign.is_restricted.is_(True),
    )
    if campaign_ids is not None:
        ids = sorted(set(campaign_ids))
        if not ids:
            return {}
        query = query.where(FundraisingCampaign.id.in_(ids))
    query = query.order_by(FundraisingCampaign.id)
    if lock:
        query = query.with_for_update()
    funds = {
        c.id: FundBalance(
            campaign_id=c.id,
            name=c.name,
            purpose=c.restriction_purpose,
            active=bool(c.active),
        )
        for c in (await db.execute(query)).scalars()
    }
    if not funds:
        return funds
    ids = list(funds)
    exclude_kind, exclude_id = exclude or (None, None)

    async def totals(statement) -> dict[str, Decimal]:
        if lock:
            statement = statement.with_for_update()
        return {
            fund_id: _money(total)
            for fund_id, total in (await db.execute(statement)).all()
            if fund_id is not None
        }

    received = await totals(
        select(Donation.campaign_id, func.sum(Donation.amount))
        .where(
            Donation.organization_id == org_id,
            Donation.campaign_id.in_(ids),
            Donation.payment_status == PaymentStatus.COMPLETED.value,
        )
        .group_by(Donation.campaign_id)
    )

    def purchases(statuses, amount, *, unless_report_approved: bool = False):
        statement = (
            select(PurchaseRequest.fund_campaign_id, func.sum(amount))
            .where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.fund_campaign_id.in_(ids),
                PurchaseRequest.status.in_(statuses),
            )
            .group_by(PurchaseRequest.fund_campaign_id)
        )
        if exclude_kind == KIND_PURCHASE:
            statement = statement.where(PurchaseRequest.id != exclude_id)
        if exclude_kind == KIND_EXPENSE:
            # A report being decided is compared against what is left without
            # the purchase it claims back, which it replaces.
            claimed = (
                select(ExpenseReport.purchase_request_id)
                .where(
                    ExpenseReport.id == exclude_id,
                    ExpenseReport.organization_id == org_id,
                    ExpenseReport.purchase_request_id.is_not(None),
                )
                .scalar_subquery()
            )
            statement = statement.where(PurchaseRequest.id.is_distinct_from(claimed))
        if unless_report_approved:
            statement = statement.where(
                ~exists().where(
                    and_(
                        ExpenseReport.organization_id == org_id,
                        ExpenseReport.purchase_request_id == PurchaseRequest.id,
                        ExpenseReport.status == ExpenseReportStatus.APPROVED,
                    )
                )
            )
        return statement

    def checks(statuses):
        statement = (
            select(CheckRequest.fund_campaign_id, func.sum(CheckRequest.amount))
            .where(
                CheckRequest.organization_id == org_id,
                CheckRequest.fund_campaign_id.in_(ids),
                CheckRequest.status.in_(statuses),
            )
            .group_by(CheckRequest.fund_campaign_id)
        )
        if exclude_kind == KIND_CHECK:
            statement = statement.where(CheckRequest.id != exclude_id)
        return statement

    def lines(statuses):
        statement = (
            select(ExpenseLineItem.fund_campaign_id, func.sum(ExpenseLineItem.amount))
            .join(ExpenseReport, ExpenseReport.id == ExpenseLineItem.expense_report_id)
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseLineItem.fund_campaign_id.in_(ids),
                ExpenseReport.status.in_(statuses),
            )
            .group_by(ExpenseLineItem.fund_campaign_id)
        )
        if exclude_kind == KIND_EXPENSE:
            statement = statement.where(ExpenseReport.id != exclude_id)
        return statement

    paid_amount = func.coalesce(
        PurchaseRequest.actual_amount, PurchaseRequest.estimated_amount
    )
    spent = [
        await totals(purchases([PurchaseRequestStatus.PAID], paid_amount)),
        await totals(checks([CheckRequestStatus.ISSUED])),
        await totals(lines([ExpenseReportStatus.PAID])),
    ]
    committed = [
        await totals(
            purchases(
                _PR_COMMITTED,
                PurchaseRequest.estimated_amount,
                unless_report_approved=True,
            )
        ),
        await totals(checks([CheckRequestStatus.APPROVED])),
        await totals(lines([ExpenseReportStatus.APPROVED])),
    ]
    awaiting = [
        await totals(purchases(_AWAITING, PurchaseRequest.estimated_amount)),
        await totals(checks(_AWAITING)),
        await totals(lines(_AWAITING)),
    ]

    for fund_id, fund in funds.items():
        fund.received = received.get(fund_id, ZERO)
        fund.spent = sum((t.get(fund_id, ZERO) for t in spent), ZERO)
        fund.committed = sum((t.get(fund_id, ZERO) for t in committed), ZERO)
        fund.awaiting_approval = sum((t.get(fund_id, ZERO) for t in awaiting), ZERO)
    return funds


async def shortfalls(
    db: AsyncSession,
    org_id: str,
    charges: dict[str, Decimal],
    *,
    exclude: tuple[str, str],
    lock: bool = False,
) -> dict[str, Decimal]:
    """By how much each charged fund would be overspent, for the funds that
    would be; empty when every charge fits.

    ``charges`` is this payment's amount per fund. A fund that is no longer a
    restricted fund of this department (since unmarked, which is refused while
    anything is charged to it, or a campaign of another department, which is
    refused on write) is not checked.
    """
    if not charges:
        return {}
    balances = await fund_balances(
        db, org_id, charges.keys(), exclude=exclude, lock=lock
    )
    over: dict[str, Decimal] = {}
    for fund_id, amount in charges.items():
        fund = balances.get(fund_id)
        if fund is None:
            continue
        short = _money(amount) - fund.available
        if short > 0:
            over[fund_id] = short
    return over


def charges_of(kind: str, entity) -> dict[str, Decimal]:
    """A payment's amount per fund. A purchase request is charged its
    estimate until it is paid, and its actual amount after."""
    if kind == KIND_EXPENSE:
        out: dict[str, Decimal] = {}
        for item in entity.line_items:
            if item.fund_campaign_id:
                out[item.fund_campaign_id] = out.get(
                    item.fund_campaign_id, ZERO
                ) + _money(item.amount)
        return out
    if not entity.fund_campaign_id:
        return {}
    if kind == KIND_PURCHASE:
        amount = (
            entity.actual_amount
            if entity.status == PurchaseRequestStatus.PAID and entity.actual_amount
            else entity.estimated_amount
        )
    else:
        amount = entity.amount
    return {entity.fund_campaign_id: _money(amount)}


async def fund_names(
    db: AsyncSession, org_id: str, ids: Iterable[str]
) -> dict[str, str]:
    """Campaign names for the given ids, in this department."""
    wanted = sorted({i for i in ids if i})
    if not wanted:
        return {}
    rows = await db.execute(
        select(FundraisingCampaign.id, FundraisingCampaign.name).where(
            FundraisingCampaign.organization_id == org_id,
            FundraisingCampaign.id.in_(wanted),
        )
    )
    return {cid: name for cid, name in rows.all()}


async def is_charged(db: AsyncSession, org_id: str, campaign_id: str) -> bool:
    """Whether any payment is charged to this campaign."""
    for statement in (
        select(PurchaseRequest.id).where(
            PurchaseRequest.organization_id == org_id,
            PurchaseRequest.fund_campaign_id == campaign_id,
        ),
        select(CheckRequest.id).where(
            CheckRequest.organization_id == org_id,
            CheckRequest.fund_campaign_id == campaign_id,
        ),
        select(ExpenseLineItem.id)
        .join(ExpenseReport, ExpenseReport.id == ExpenseLineItem.expense_report_id)
        .where(
            ExpenseReport.organization_id == org_id,
            ExpenseLineItem.fund_campaign_id == campaign_id,
        ),
    ):
        if (await db.execute(statement.limit(1))).first() is not None:
            return True
    return False
