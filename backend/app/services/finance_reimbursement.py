"""
Reimbursing a member for a purchase they made themselves.

The path is purchase request -> expense report -> reimbursement check:

1. **Purchase request.** Approved as usual, which encumbers its estimate on
   its budget line. The requester then buys it with their own money and asks
   for it back (``FinanceService.create_reimbursement_report``), which raises
   a draft expense report linked to the request
   (``ExpenseReport.purchase_request_id``) with one line copied from it.
2. **Expense report.** Submitted, with its receipt, and approved through the
   expense-report chain like any other.
3. **Reimbursement check.** The finance office chooses **Pay by check** on the
   approved report (``FinanceService.request_reimbursement_check``), which
   raises a check request payable to the member
   (``CheckRequest.expense_report_id``) for what the report still owes them
   and submits it through the check-request chain (owner decision,
   2026-10-23). Issuing the check pays the report.

**Counted once.** Each of the three records counts its own money when it
settles on its own, so a link must decide which one carries it:

* The **report's lines** are the spend, as for any report: on the budget
  lines, in the funds, in the reports.
* The **check** is how the report was paid. Like a cash advance it charges no
  budget line or fund, and the payments register, functional expenses and the
  QuickBooks export show the report through it -- dated by the check, with its
  number, and reversed when it is voided.
* The **purchase request** is the authorization. Its estimate stays
  encumbered until the report is paid, then the request closes as
  ``reimbursed``, its encumbrance released and counted as neither spent nor
  committed. Once the report is approved its lines are the better figure for
  what the purchase will cost, so a restricted fund stops counting the
  request's estimate as committed from then.

**Voiding the check** returns the report to approved, reverses its lines'
spend and reopens the request with its encumbrance, so another check can be
cut. A report QuickBooks already received is reversed there by the voided
check's entry (``CheckRequest.qb_export_entry``).

Only one report may claim a purchase, and only one check may pay a report, at
a time: a denied or cancelled one stops counting and another may follow.
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExpenseReportStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)

# A purchase the requester may still claim back: approved and not yet paid.
CLAIMABLE_PURCHASE_STATUSES = (
    PurchaseRequestStatus.APPROVED,
    PurchaseRequestStatus.ORDERED,
    PurchaseRequestStatus.RECEIVED,
)
# A report still claiming its purchase. Denied and cancelled ones have let it
# go, so the requester may raise another.
LIVE_REPORT_STATUSES = (
    ExpenseReportStatus.DRAFT,
    ExpenseReportStatus.SUBMITTED,
    ExpenseReportStatus.PENDING_APPROVAL,
    ExpenseReportStatus.APPROVED,
    ExpenseReportStatus.PAID,
)
# A check still paying its report. A denied, cancelled or voided one has not
# paid it and will not.
LIVE_CHECK_STATUSES = (
    CheckRequestStatus.DRAFT,
    CheckRequestStatus.SUBMITTED,
    CheckRequestStatus.PENDING_APPROVAL,
    CheckRequestStatus.APPROVED,
    CheckRequestStatus.ISSUED,
)


class ReimbursementLinkError(ValueError):
    """A link the reimbursement path refuses (-> 400)."""


async def live_report_for_purchase(
    db: AsyncSession, org_id: str, pr_id: str
) -> Optional[ExpenseReport]:
    """The report currently claiming this purchase back, if any.

    The caller holds the purchase request's row lock, which is what serializes
    two claims; this is a locking read so it sees a report another transaction
    committed while the caller waited for that lock (CLAUDE.md pitfall #27).
    """
    result = await db.execute(
        select(ExpenseReport)
        .where(
            ExpenseReport.organization_id == org_id,
            ExpenseReport.purchase_request_id == pr_id,
            ExpenseReport.status.in_(LIVE_REPORT_STATUSES),
        )
        .order_by(ExpenseReport.created_at.desc(), ExpenseReport.id)
        .limit(1)
        .with_for_update()
    )
    return result.scalars().first()


async def live_check_for_report(
    db: AsyncSession, org_id: str, er_id: str
) -> Optional[CheckRequest]:
    """The check currently paying this report, if any. A locking read, for
    the reason given in ``live_report_for_purchase``; the caller holds the
    report's row lock."""
    result = await db.execute(
        select(CheckRequest)
        .where(
            CheckRequest.organization_id == org_id,
            CheckRequest.expense_report_id == er_id,
            CheckRequest.status.in_(LIVE_CHECK_STATUSES),
        )
        .order_by(CheckRequest.created_at.desc(), CheckRequest.id)
        .limit(1)
        .with_for_update()
    )
    return result.scalars().first()


async def lock_purchase(
    db: AsyncSession, org_id: str, pr_id: str
) -> Optional[PurchaseRequest]:
    """The purchase request, locked and refreshed, in this department."""
    result = await db.execute(
        select(PurchaseRequest)
        .where(
            PurchaseRequest.id == pr_id,
            PurchaseRequest.organization_id == org_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def reopened_status(pr: PurchaseRequest) -> PurchaseRequestStatus:
    """Where a reimbursed request goes back to when the check that paid for
    it is voided: the furthest step its own timestamps say it reached."""
    if pr.received_at is not None:
        return PurchaseRequestStatus.RECEIVED
    if pr.ordered_at is not None:
        return PurchaseRequestStatus.ORDERED
    return PurchaseRequestStatus.APPROVED


def amount_owed(er: ExpenseReport) -> Decimal:
    """What the member is still owed on the report: its total less what a
    cash advance already paid them (fixed on submission)."""
    return Decimal(str(er.total_amount)) - Decimal(str(er.advance_applied or 0))
