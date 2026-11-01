"""
Finance Service

Business logic for fiscal years, budgets, purchase requests,
expense reports, check requests, dues, approval chains,
and QuickBooks export.
"""

import copy
import html
import io
import secrets
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, NoReturn, Optional

from loguru import logger
from sqlalchemy import (
    ColumnElement,
    Integer,
    String,
    and_,
    case,
    cast,
    delete,
    exists,
    func,
    literal,
    or_,
    select,
    union_all,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, contains_eager, selectinload

from app.api.dependencies import PaginationParams, user_has_permission
from app.core.config import settings
from app.core.utils import list_within_detail_limit
from app.models.apparatus import Apparatus
from app.models.email_template import EmailTemplate
from app.models.facilities import Facility
from app.models.finance import (
    AdvanceReturn,
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEmailStatus,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    BudgetCategoryChargePosition,
    BudgetPlanningStage,
    BudgetRequest,
    ChargeAccess,
    CheckRequest,
    CheckRequestStatus,
    DuesPayment,
    DuesSchedule,
    DuesStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    ExpenseType,
    ExportLog,
    ExportMapping,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
    PurchaseRequest,
    PurchaseRequestStatus,
    QuickBooksChartAccount,
)
from app.models.user import Organization, Position, User
from app.services.cash_advances import (
    AdvanceNotSettleableError,
    advance_balances,
    assert_no_overdue,
    assert_settleable,
    is_accounted_for,
    lock_advance,
)
from app.services.expense_substantiation import describe_late, late_items
from app.services.finance_approver_matching import (
    FINANCE_APPROVE,
    ApproverDecision,
    ApproverDirectory,
    authorize_step_actor,
    describe_assignee,
    is_approvals_admin,
    is_known_permission,
    is_valid_single_email,
    normalize_approver_type,
    user_matches_step,
)
from app.services.finance_budget_access import (
    CategoryTree,
    assert_may_charge,
    held_position_ids,
    load_category_tree,
)
from app.services.finance_budget_ownership import owned_budgets_query, resolve_owner
from app.services.finance_reimbursement import (
    CLAIMABLE_PURCHASE_STATUSES,
    LIVE_CHECK_STATUSES,
    LIVE_REPORT_STATUSES,
    ReimbursementLinkError,
    amount_owed,
    live_check_for_report,
    live_report_for_purchase,
    lock_purchase,
    reopened_status,
)
from app.services.restricted_funds import (
    KIND_CHECK,
    KIND_EXPENSE,
    KIND_PURCHASE,
    assert_chargeable,
    charges_of,
    shortfalls,
)
from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)
from app.utils.csv_export import SafeCsvWriter, csv_safe_cell
from app.utils.finance_settings import (
    FINANCE_SETTINGS_KEY,
    FUND_OVERSPEND_BLOCK,
    QB_ADVANCES_CASH_KEY,
    QB_ADVANCES_KEY,
    QB_DUES_DEPOSIT_KEY,
    QB_DUES_INCOME_KEY,
    SUBSTANTIATION_BLOCK,
    SUBSTANTIATION_OFF,
    advance_accounts,
    dues_default_accounts,
    load_finance_settings,
)
from app.utils.member_names import format_display_name, format_legal_name
from app.utils.model_updates import apply_updates
from app.utils.org_locks import QUICKBOOKS_EXPORT, lock_organization_scope
from app.utils.org_scoping import assert_in_org
from app.utils.org_timezone import resolve_org_today, resolve_scheduling_timezone
from app.utils.quickbooks_chart import ChartAccount
from app.utils.sql_search import LIKE_ESCAPE_CHAR

# The statuses that genuinely resolve a step, so a later step may become
# reachable. Deliberately an allowlist: DENIED and SKIPPED are terminal states
# that mean the chain stopped, not that it advanced, and a blocklist of "not
# PENDING" silently read both of them as progress.
_PRIOR_STEP_SATISFIED = frozenset(
    {
        ApprovalStepStatus.APPROVED,
        ApprovalStepStatus.AUTO_APPROVED,
        ApprovalStepStatus.SENT,
    }
)


# The three payment documents, where a helper picks one by kind.
_FinanceDocument = type[PurchaseRequest] | type[ExpenseReport] | type[CheckRequest]


class BudgetLimitExceededError(Exception):
    """A proposed finance transaction would exceed its organization's budget.

    This is a stable domain error (rather than a persistence error) so API
    adapters can consistently report a conflict.  Overspending is deliberately
    fail-closed: purchase requests, check requests, and individual expense
    report lines have no override path, including for finance administrators.
    """

    code = "budget_limit_exceeded"

    def __init__(self) -> None:
        super().__init__("Insufficient available budget")


class FundBalanceExceededError(BudgetLimitExceededError):
    """A payment charged to a restricted fund is more than the fund has left,
    and the department's rule is ``block`` (app/services/restricted_funds.py).

    A ``BudgetLimitExceededError`` so every path that can complete an approval
    already reports it as a conflict, with this message rather than the
    budget's.
    """

    code = "fund_balance_exceeded"

    def __init__(self, over: Decimal) -> None:
        Exception.__init__(
            self,
            f"This is ${over:,.2f} more than its restricted fund has left, and "
            "the department does not allow a fund to be overspent.",
        )


class ExportInProgressError(Exception):
    """Another QuickBooks export of the department is still running (→ 409)."""

    def __init__(self) -> None:
        super().__init__(
            "Another QuickBooks export is still being prepared. Wait for it to "
            "finish, then export again."
        )


class ReimportConfirmationRequired(Exception):
    """Sending a period again would resend payments whose file the Treasurer
    confirmed was imported into QuickBooks (→ 409 until confirmed)."""

    def __init__(self, count: int) -> None:
        self.count = count
        noun = "payment" if count == 1 else "payments"
        super().__init__(
            f"{count:,} {noun} in this period went out in a file already "
            "confirmed as imported into QuickBooks. Importing them again posts "
            "them twice unless you delete those entries in QuickBooks first."
        )


class AmendmentDecidedError(Exception):
    """The amendment was already confirmed or rejected (→ 409)."""

    def __init__(self) -> None:
        super().__init__(
            "That amendment has already been confirmed or rejected. Refresh to "
            "see where it stands."
        )


class AmendmentAlreadyReversedError(Exception):
    """The amendment already has a reversing entry (→ 409).

    Its own class rather than a ``ValueError`` so the endpoint can tell a
    conflict with the line's current state from a malformed request.
    """

    def __init__(self) -> None:
        super().__init__("This amendment has already been reversed.")


# The largest value a Numeric(12, 2) column holds. A budget line's amount may
# not be raised past it: MySQL would refuse the write with an opaque error.
_MAX_BUDGET_AMOUNT = Decimal("9999999999.99")

_LOCKED_YEAR_AMOUNT_MESSAGE = (
    "This fiscal year is locked. Budget amounts can no longer be changed or amended."
)
_AMOUNT_BY_AMENDMENT_MESSAGE = (
    "Once a budget goes before the board, a line's amount changes only through "
    "an amendment, which another officer confirms."
)
# Kept under safe_error_detail's 300 characters so the reason reaches the screen.
_NEW_LINE_AT_ZERO_MESSAGE = (
    "This budget has gone before the board, so a new line starts at zero. Add it, "
    "then record an amendment for its amount, which another officer confirms."
)


def _amount_by_amendment(status, stage, is_locked) -> bool:
    """Whether a line's amount now changes only through a confirmed amendment.

    From board review on, the budget is what the board considered or adopted,
    so a change is an amendment a second officer confirms -- not an edit one
    person makes. Before that (taking requests, leadership review) the
    Treasurer still shapes the draft directly. A locked year takes neither.
    """
    status = getattr(status, "value", status)
    stage = getattr(stage, "value", stage)
    if is_locked:
        return True
    if status in (FiscalYearStatus.ACTIVE.value, FiscalYearStatus.CLOSED.value):
        return True
    return stage in (
        BudgetPlanningStage.BOARD_REVIEW.value,
        BudgetPlanningStage.ADOPTED.value,
    )


class FinanceEntityNotFoundError(ValueError):
    """The request does not exist in the caller's organization (→ 404)."""


def _raise_not_found(label: str, requester_id: Optional[str]) -> NoReturn:
    """Refuse a missing request, the same way the detail read does for its caller.

    A requester-scoped write (``requester_id`` set) answers 404 for another
    member's request exactly as for one that does not exist, matching what
    the detail endpoint shows them — a 400 here would confirm the id is real.
    An org-wide caller keeps the plain ``ValueError`` (400) these writes have
    always raised.
    """
    if requester_id is not None:
        raise FinanceEntityNotFoundError(f"{label} not found")
    raise ValueError(f"{label} not found")


class ManualApprovalConflictError(ValueError):
    """The request cannot take a manual decision in its current state (→ 409)."""


class LateSubstantiationNotAcknowledgedError(ValueError):
    """Approving a report with late lines without confirming them (→ 400)."""


# How long an emailed approval link works. The email and the public page both
# tell the approver "7 days"; change them together.
APPROVAL_LINK_TTL = timedelta(days=7)


class ApprovalEmailDelivery:
    """What the approvals queue says about an EMAIL step's link.

    ``UNKNOWN`` is a live link minted before send status was recorded
    (20261101_1210_b2d4f6a8c0e3); ``NOT_SENT`` is a reachable EMAIL step that
    holds no link at all.
    """

    SENT = "sent"
    FAILED = "failed"
    EXPIRED = "expired"
    NOT_SENT = "not_sent"
    UNKNOWN = "unknown"


def approval_email_delivery(
    *,
    step_type: Any,
    approver_type: Optional[ApproverType],
    has_link: bool,
    expires_at: Optional[datetime],
    email_status: Optional[str],
    now: Optional[datetime] = None,
) -> Optional[str]:
    """The state of an EMAIL step's link, or None for any other step.

    A failed send outranks expiry: a link that never arrived is the fact the
    department needs, and both are answered by a re-send. Expiry is read from
    ``token_expires_at`` rather than stored, so it cannot lag the clock.
    """
    if step_type != ApprovalStepType.APPROVAL or approver_type != ApproverType.EMAIL:
        return None
    if email_status == ApprovalEmailStatus.FAILED.value:
        return ApprovalEmailDelivery.FAILED
    if not has_link:
        return ApprovalEmailDelivery.NOT_SENT
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < (now or datetime.now(timezone.utc)):
            return ApprovalEmailDelivery.EXPIRED
    if email_status == ApprovalEmailStatus.SENT.value:
        return ApprovalEmailDelivery.SENT
    return ApprovalEmailDelivery.UNKNOWN


class ApprovalTokenNotValidError(ValueError):
    """The token exists but no longer authorizes its step (→ 404).

    Answered exactly like an unknown token: a link minted while a step was an
    email step must stop working once the step is reassigned to a member, and
    telling the holder anything more would describe the chain to someone who
    is no longer part of it.
    """


# One definition of "overdue" for a dues record: nothing paid toward it and its
# due date has passed. The stored status reaches OVERDUE only when the daily
# mark_overdue_dues task persists it, so between runs a record can still be
# stored as PENDING after its date. Every read that reports or filters on
# status goes through these instead of the bare column, so the dues screen,
# its summary and the task cannot disagree about the same record. A partially
# paid record stays PARTIAL by design: its payment information is not lost.
def dues_past_due_unpaid_clause(now: datetime) -> ColumnElement[bool]:
    """SQL form: a stored-PENDING record that is in fact overdue at ``now``."""
    return and_(
        MemberDues.status == DuesStatus.PENDING,
        MemberDues.due_date < now,
        MemberDues.amount_paid < MemberDues.amount_due,
    )


def dues_overdue_clause(now: datetime) -> ColumnElement[bool]:
    """SQL form: every record whose effective status is OVERDUE at ``now``."""
    return or_(
        MemberDues.status == DuesStatus.OVERDUE,
        dues_past_due_unpaid_clause(now),
    )


def effective_dues_status(
    status: DuesStatus | str,
    due_date: Optional[datetime],
    amount_paid: Decimal,
    amount_due: Decimal,
    now: datetime,
) -> DuesStatus:
    """Python form of the same rule, for a row already loaded."""
    stored = DuesStatus(status)
    if (
        stored == DuesStatus.PENDING
        and due_date is not None
        # MySQL DATETIME comes back naive; the column is written as UTC.
        and (due_date if due_date.tzinfo else due_date.replace(tzinfo=timezone.utc))
        < now
        and amount_paid < amount_due
    ):
        return DuesStatus.OVERDUE
    return stored


def _apply_payment_totals(dues: MemberDues) -> None:
    """Re-derive the aggregate columns on ``dues`` from its payment ledger.

    The columns on ``MemberDues`` are a cache of the ledger, not an independent
    record. Recomputing the total from the rows — rather than adding to a
    running figure — is what makes FIN-6's class of bug unrepresentable: a
    double-credit would need a duplicate ledger row, which the uniqueness
    constraint on ``(member_dues_id, transaction_reference)`` refuses.

    ``payment_method`` / ``transaction_reference`` / ``notes`` continue to
    describe the most recent payment. They are retained because
    ``MemberDuesResponse`` exposes them, but they are now projections of the
    newest row instead of whatever the last write happened to leave behind, so
    they can no longer contradict the ledger or be blanked by an omitted field.

    Deliberately does not touch WAIVED or EXEMPT: callers refuse payments
    against those before reaching here, and a waiver is not a function of what
    has been paid.
    """
    payments = sorted(dues.payments, key=lambda p: p.received_at)

    dues.amount_paid = sum((p.amount for p in payments), Decimal("0.00"))

    latest = payments[-1] if payments else None
    dues.paid_date = latest.received_at if latest else None
    dues.payment_method = latest.payment_method if latest else None
    dues.transaction_reference = latest.transaction_reference if latest else None
    dues.notes = latest.notes if latest else None

    if dues.amount_paid >= dues.amount_due:
        dues.status = DuesStatus.PAID
    elif dues.amount_paid > 0:
        dues.status = DuesStatus.PARTIAL
    else:
        # A past-due record with nothing paid (a waiver reversed after the
        # date) is OVERDUE, not PENDING awaiting the next daily task run.
        dues.status = effective_dues_status(
            DuesStatus.PENDING,
            dues.due_date,
            dues.amount_paid,
            dues.amount_due,
            datetime.now(timezone.utc),
        )


# The column names of QuickBooks Online's journal-entry import, which maps a
# file's headers onto its fields by name. A file with no Account Name, or whose
# debits and credits differ per Journal No, is rejected on import.
QB_JOURNAL_HEADER = [
    "Journal No",
    "Journal Date",
    "Memo",
    "Account Name",
    "Debits",
    "Credits",
    "Description",
]


# QuickBooks Online imports a spreadsheet only if it has fewer than 1,000 rows,
# the header included (Intuit, "Import journal entries"); each exported
# transaction is two rows.
QB_IMPORT_MAX_ROWS = 999

# A pending export younger than this holds off a second one. An export the
# process died in the middle of stays pending; past this it no longer blocks.
QB_EXPORT_IN_PROGRESS_WINDOW = timedelta(minutes=15)

# Appended to a voided check's request number to make its reversing entry's
# Journal No: distinct from the original's, and recognisably tied to it.
QB_VOID_SUFFIX = "-V"

# QuickBooks requires a customer or vendor in the Name column of any journal
# line posting to Accounts Receivable or Accounts Payable, and the export has
# no Name to give. These are the standard names QuickBooks Online creates the
# two accounts with ("Accounts Payable (A/P)"); a department that renamed them
# is not caught here, which the mapping screen's checklist covers.
_QB_NAME_REQUIRED_PREFIXES = ("accounts payable", "accounts receivable")


def _needs_qb_name(account: Optional[str]) -> bool:
    top_level = (account or "").split(":", 1)[0].strip().casefold()
    return top_level.startswith(_QB_NAME_REQUIRED_PREFIXES)


def _refuse_name_required(*accounts: Optional[str]) -> None:
    """Refuse an account the journal-entry import cannot post to."""
    for account in accounts:
        if _needs_qb_name(account):
            # Kept under safe_error_detail's 300 characters so the reason
            # reaches the screen.
            raise ValueError(
                "Accounts Payable and Accounts Receivable can't be used: "
                "QuickBooks needs a customer or vendor on those journal lines, "
                "which the export doesn't carry. Use the bank or card account "
                "the money is paid from, and an expense account for the category."
            )


def _unsafe_account_name(account: Optional[str]) -> bool:
    """True for a name the export's formula-injection escaping would alter.

    SafeCsvWriter puts an apostrophe before a cell starting with =, +, -, @
    (or a tab or carriage return), and QuickBooks then reads that apostrophe
    as part of the account name, which matches no account.
    """
    name = (account or "").strip()
    return bool(name) and csv_safe_cell(name) != name


def _refuse_unsafe_account_name(*accounts: Optional[str]) -> None:
    for account in accounts:
        if _unsafe_account_name(account):
            raise ValueError(
                "An account name can't start with =, +, - or @: the export "
                "escapes those so spreadsheets don't run them as formulas, and "
                "QuickBooks would then not recognize the account. Rename it in "
                "QuickBooks and here."
            )


def _refuse_unusable_accounts(*accounts: Optional[str]) -> None:
    """Refuse an account no journal-entry import can post to."""
    _refuse_name_required(*accounts)
    _refuse_unsafe_account_name(*accounts)


@dataclass(frozen=True)
class _Chart:
    """The QuickBooks chart of accounts the Treasurer last uploaded."""

    names: frozenset[str]

    def missing(self, *accounts: str) -> tuple[str, ...]:
        """The accounts the chart does not hold, in the order given.

        Matched exactly, case included: the import matches by name, and a
        name that differs only in case or spacing is not one this check can
        promise QuickBooks will accept.
        """
        out: list[str] = []
        for account in accounts:
            if account and account not in self.names and account not in out:
                out.append(account)
        return tuple(out)


def _account_issue(
    chart: Optional[_Chart], *accounts: str
) -> tuple[Optional[str], tuple[str, ...]]:
    """The problem with a set of resolved accounts the import would reject,
    beyond a missing one or Accounts Payable/Receivable, and which accounts
    the uploaded chart lacks."""
    if any(_unsafe_account_name(a) for a in accounts):
        return "unsafe_account_name", ()
    missing = chart.missing(*accounts) if chart is not None else ()
    if missing:
        return "not_in_chart", missing
    return None, ()


def _quoted(accounts: Iterable[str]) -> str:
    return " and ".join(f"'{_short_label(a)}'" for a in accounts)


def _qb_amount(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def _mapping_key(name: str) -> str:
    return name.strip().casefold()


# A category tree deeper than this is a cycle written by hand, not a real
# hierarchy; resolution stops rather than looping.
_MAX_CATEGORY_DEPTH = 20


@dataclass(frozen=True)
class _CategoryAccounts:
    """What an export posts one budget category to, after inheritance."""

    account: str
    offset: str
    problem: Optional[str]
    # category (its own qb_account_name), mapping, or parent; None without one.
    account_source: Optional[str]
    # The ancestor each piece came from, when the category had none of its own.
    account_inherited_from: Optional[str] = None
    offset_inherited_from: Optional[str] = None
    # The accounts an uploaded chart of accounts does not hold.
    not_in_chart: tuple[str, ...] = ()


def _resolve_category_accounts(
    categories: list[BudgetCategory],
    mappings: dict[str, list[ExportMapping]],
    chart: Optional[_Chart] = None,
) -> dict[str, _CategoryAccounts]:
    """Resolve every category's QuickBooks accounts, inheriting from ancestors.

    The one definition of how a category reaches QuickBooks: the export posts
    with it and the readiness report shows it, so the two cannot disagree. A
    category takes its own account (its ``qb_account_name``, else its mapping's)
    and its own mapping's offset; whichever it lacks comes from its nearest
    ancestor that has one, so a subcategory such as Turnout gear under
    Operations posts where Operations does unless it says otherwise. A
    category with several mappings inherits nothing: which of them it meant
    is a question for the treasurer, not a default.
    """
    by_id = {c.id: c for c in categories}
    resolved: dict[str, _CategoryAccounts] = {}

    def resolve(category_id: str, depth: int) -> Optional[_CategoryAccounts]:
        if category_id in resolved:
            return resolved[category_id]
        category = by_id.get(category_id)
        if category is None or depth > _MAX_CATEGORY_DEPTH:
            return None
        matches = mappings.get(_mapping_key(category.name), [])
        if len(matches) > 1:
            result = _CategoryAccounts("", "", "duplicate_mappings", None)
            resolved[category_id] = result
            return result
        mapping = matches[0] if matches else None
        own_account = (category.qb_account_name or "").strip()
        source: Optional[str] = "category" if own_account else None
        if not own_account and mapping:
            own_account = mapping.qb_account_name.strip()
            source = "mapping" if own_account else None
        account = own_account
        offset = (mapping.qb_offset_account_name or "").strip() if mapping else ""
        account_from: Optional[str] = None
        offset_from: Optional[str] = None
        if (not account or not offset) and category.parent_category_id:
            parent = resolve(category.parent_category_id, depth + 1)
            parent_cat = by_id.get(category.parent_category_id)
            if parent is not None and parent_cat is not None:
                if not account and parent.account:
                    account = parent.account
                    source = "parent"
                    account_from = parent.account_inherited_from or parent_cat.name
                if not offset and parent.offset:
                    offset = parent.offset
                    offset_from = parent.offset_inherited_from or parent_cat.name
        not_in_chart: tuple[str, ...] = ()
        if not account:
            problem: Optional[str] = "no_account"
        elif not offset:
            problem = "no_offset"
        elif _needs_qb_name(account) or _needs_qb_name(offset):
            problem = "payable_receivable"
        else:
            problem, not_in_chart = _account_issue(chart, account, offset)
        result = _CategoryAccounts(
            account,
            offset,
            problem,
            source,
            account_from,
            offset_from,
            not_in_chart,
        )
        resolved[category_id] = result
        return result

    for category in categories:
        resolve(category.id, 0)
    return resolved


def _refuse_advance_charges(data: dict) -> None:
    """A cash advance charges no budget line or restricted fund: the expense
    report that accounts for it does (app/services/cash_advances.py)."""
    if data.get("budget_id") or data.get("fund_campaign_id"):
        raise ValueError(
            "A cash advance is not charged to a budget line or fund; the "
            "expense report that accounts for it is"
        )


def _refuse_reimbursement_changes(cr: CheckRequest, data: dict) -> None:
    """A reimbursement check pays what its report owes the member and charges
    nothing itself (app/services/finance_reimbursement.py). A form that sends
    every field back unchanged is fine; a different value is refused."""
    if (data.get("budget_id") or data.get("fund_campaign_id")) or (
        "amount" in data and Decimal(str(data["amount"])) != Decimal(str(cr.amount))
    ):
        raise ValueError(
            "A reimbursement check pays what its expense report owes the "
            "member; its amount, budget line and fund cannot be changed"
        )


def _enum_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _aware_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _user_label(
    first_name: Optional[str],
    last_name: Optional[str],
    preferred_name: Optional[str],
    username: Optional[str],
) -> Optional[str]:
    return (
        format_display_name(first_name, last_name, preferred_name) or username or None
    )


def _short_label(name: str, limit: int = 40) -> str:
    name = name.strip()
    return name if len(name) <= limit else name[: limit - 3] + "..."


def pick_approval_chain(
    chains: Sequence[ApprovalChain],
    amount: Decimal,
    budget_category_id: Optional[str] = None,
) -> Optional[ApprovalChain]:
    """Choose the most specific chain whose range and category fit ``amount``.

    A chain's minimum and maximum are both inclusive. So an amount exactly on
    the edge between two chains ("up to $500" and "$500 and over") fits both;
    the one with the higher minimum takes it, so the amount gets the approvals
    meant for the larger purchases. A chain that is the only one to fit an
    amount keeps it, which is why the maximum is not made exclusive: a lone
    "up to $500" chain would otherwise stop covering exactly $500.00.

    Chains the same in every respect are told apart by id, so the answer does
    not depend on the order the database returned them in.
    """
    best_chain: Optional[ApprovalChain] = None
    best_key: tuple[int, Decimal] = (-1, Decimal(0))

    for chain in sorted(chains, key=lambda c: str(c.id)):
        score = 0

        if chain.min_amount is not None and amount < chain.min_amount:
            continue
        if chain.max_amount is not None and amount > chain.max_amount:
            continue

        if chain.budget_category_id and chain.budget_category_id == budget_category_id:
            score += 4
        elif (
            chain.budget_category_id and chain.budget_category_id != budget_category_id
        ):
            continue  # Category mismatch

        if chain.min_amount is not None or chain.max_amount is not None:
            score += 2

        if chain.is_default:
            score += 1

        key = (
            score,
            Decimal(chain.min_amount) if chain.min_amount is not None else Decimal(0),
        )
        if key > best_key:
            best_key = key
            best_chain = chain

    return best_chain


class FinanceService:
    """Core finance business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db
        # Set by approve_step / deny_step to how the caller was allowed to act
        # (named approver, or an approvals-admin override), so the endpoint
        # can audit it without re-running the match after the mutation. The
        # service is built per request, so this never crosses requests.
        self.last_approver_decision: Optional[ApproverDecision] = None

    # ========================================
    # Fiscal Years
    # ========================================

    async def list_fiscal_years(
        self, org_id: str, pagination: PaginationParams
    ) -> list[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear)
            .where(FiscalYear.organization_id == org_id)
            .order_by(FiscalYear.start_date.desc(), FiscalYear.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().all())

    async def get_fiscal_year(self, fy_id: str, org_id: str) -> Optional[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.id == fy_id,
                FiscalYear.organization_id == org_id,
            )
        )
        fiscal_year: Optional[FiscalYear] = result.scalar_one_or_none()
        return fiscal_year

    async def create_fiscal_year(
        self, org_id: str, created_by: str, **kwargs
    ) -> FiscalYear:
        fy = FiscalYear(
            organization_id=org_id,
            created_by=created_by,
            status=FiscalYearStatus.DRAFT,
            planning_stage=BudgetPlanningStage.REQUESTS,
            **kwargs,
        )
        self.db.add(fy)
        await self.db.flush()
        await self.db.refresh(fy, ["created_at", "updated_at"])
        logger.info("Created fiscal year {} for org {}", fy.id, org_id)
        return fy

    async def update_fiscal_year(self, fy_id: str, org_id: str, **kwargs) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")
        if fy.is_locked:
            raise ValueError("Fiscal year is locked and cannot be modified")
        if (
            "request_deadline" in kwargs
            and kwargs["request_deadline"] != fy.request_deadline
            and fy.status != FiscalYearStatus.DRAFT
        ):
            # Requests are made only for a draft year, so a deadline on any
            # other is a switch nothing reads (CLAUDE.md pitfall #19). An
            # unchanged value is not a change, so a form that sends every
            # field it owns still saves.
            raise ValueError(
                "The request deadline can only be set while the fiscal year "
                "is a draft."
            )
        apply_updates(fy, kwargs)
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        return fy

    async def adopt_fiscal_year(
        self,
        fy_id: str,
        org_id: str,
        *,
        recorded_by: str,
        adopted_on: date,
        adoption_reference: str,
        adoption_notes: Optional[str] = None,
    ) -> FiscalYear:
        """Record the board's adoption of a draft year's budget.

        Only from board review. The year stays a draft — the board usually
        adopts before the year begins — and becomes spendable when the
        Treasurer starts it (``activate_fiscal_year``). The record is final:
        an adopted year's stage no longer moves.
        """
        fy = await self._fiscal_year_for_update(fy_id, org_id)
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(f"{fy.name} is not a draft fiscal year.")
        if fy.planning_stage != BudgetPlanningStage.BOARD_REVIEW:
            raise ValueError(
                f"{fy.name} is adopted from board review. Move it to board "
                "review first."
            )
        reference = (adoption_reference or "").strip()
        if not reference:
            raise ValueError(
                "Record the board's adoption: the meeting date and the motion "
                "or minutes reference."
            )
        if adopted_on > await resolve_org_today(self.db, org_id):
            raise ValueError("The adoption date cannot be in the future.")
        fy.adopted_on = adopted_on
        fy.adoption_reference = reference
        fy.adoption_notes = (adoption_notes or "").strip() or None
        fy.adoption_recorded_by = recorded_by
        fy.adoption_recorded_at = datetime.now(timezone.utc)
        fy.planning_stage = BudgetPlanningStage.ADOPTED
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        return fy

    async def activate_fiscal_year(self, fy_id: str, org_id: str) -> FiscalYear:
        """Start a year: make it the active one.

        A draft must have been adopted by the board and have reached its start
        date on the department's calendar. A year in its year-end close may be
        reopened. Either way no other year may be active: the current year's
        close is begun deliberately (``begin_year_end_close``), never as a side
        effect of starting the next one.
        """
        fy = await self._fiscal_year_for_update(fy_id, org_id)
        if fy.is_locked:
            raise ValueError(f"{fy.name} is locked and cannot be reopened.")
        if fy.status == FiscalYearStatus.ACTIVE:
            raise ValueError(f"{fy.name} is already the active fiscal year.")
        if fy.status == FiscalYearStatus.DRAFT:
            if fy.planning_stage != BudgetPlanningStage.ADOPTED:
                raise ValueError(
                    f"{fy.name} has not been adopted by the board. Record the "
                    "adoption before starting the year."
                )
            # A start date entered as a calendar day is stored as that day's
            # midnight UTC, so its UTC date is the day the Treasurer chose.
            starts = fy.start_date.date()
            if await resolve_org_today(self.db, org_id) < starts:
                raise ValueError(
                    f"{fy.name} starts on {starts:%B} {starts.day}, {starts.year}; "
                    "it can be started on or after that day."
                )
        other = (
            await self.db.execute(
                select(FiscalYear.name)
                .where(
                    FiscalYear.organization_id == org_id,
                    FiscalYear.status == FiscalYearStatus.ACTIVE,
                    FiscalYear.id != fy.id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if other is not None:
            raise ValueError(
                f"{other} is still the active fiscal year. Begin its year-end "
                "close first."
            )
        fy.status = FiscalYearStatus.ACTIVE
        fy.planning_stage = None
        fy.closing_started_at = None
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Activated fiscal year {} for org {}", fy_id, org_id)
        return fy

    async def begin_year_end_close(self, fy_id: str, org_id: str) -> FiscalYear:
        """Move the active year into its closing period.

        Nothing new is raised or submitted against it from here; what was
        already submitted can still be approved, paid, issued or cancelled
        (``require_year_accepts``). Locking ends the period.
        """
        fy = await self._fiscal_year_for_update(fy_id, org_id)
        if fy.status != FiscalYearStatus.ACTIVE:
            raise ValueError(
                f"{fy.name} is not the active fiscal year, so it has no "
                "year-end close to begin."
            )
        fy.status = FiscalYearStatus.CLOSED
        fy.closing_started_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Began year-end close of fiscal year {}", fy_id)
        return fy

    async def list_open_items(self, fy_id: str, org_id: str) -> list[dict]:
        """What still has to be paid, issued, cancelled or denied before lock.

        Submitted items still in approval, approved purchases not yet paid,
        approved expense reports not yet paid and approved checks not yet
        issued. Drafts are not open items: they moved no money, and nothing
        submits them once the year is closing.
        """
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise FinanceEntityNotFoundError("Fiscal year not found")
        sources = (
            (
                "purchase_request",
                PurchaseRequest,
                PurchaseRequest.request_number,
                PurchaseRequest.title,
                func.coalesce(
                    PurchaseRequest.actual_amount, PurchaseRequest.estimated_amount
                ),
                (
                    PurchaseRequestStatus.SUBMITTED,
                    PurchaseRequestStatus.PENDING_APPROVAL,
                    PurchaseRequestStatus.APPROVED,
                    PurchaseRequestStatus.ORDERED,
                    PurchaseRequestStatus.RECEIVED,
                ),
            ),
            (
                "expense_report",
                ExpenseReport,
                ExpenseReport.report_number,
                ExpenseReport.title,
                ExpenseReport.total_amount,
                (
                    ExpenseReportStatus.SUBMITTED,
                    ExpenseReportStatus.PENDING_APPROVAL,
                    ExpenseReportStatus.APPROVED,
                ),
            ),
            (
                "check_request",
                CheckRequest,
                CheckRequest.request_number,
                CheckRequest.payee_name,
                CheckRequest.amount,
                (
                    CheckRequestStatus.SUBMITTED,
                    CheckRequestStatus.PENDING_APPROVAL,
                    CheckRequestStatus.APPROVED,
                ),
            ),
        )
        items: list[dict] = []
        for kind, model, number, label, amount, statuses in sources:
            result = await self.db.execute(
                select(model.id, number, label, model.status, amount)
                .where(
                    model.organization_id == org_id,
                    model.fiscal_year_id == fy.id,
                    model.status.in_(statuses),
                )
                .order_by(number)
            )
            for row in result.all():
                items.append(
                    {
                        "kind": kind,
                        "entity_id": row[0],
                        "number": row[1],
                        "description": row[2],
                        "status": getattr(row[3], "value", row[3]),
                        "amount": row[4],
                    }
                )
        # An amendment awaiting its second officer is open too: locking would
        # freeze the line with the decision still owed. entity_id is the line,
        # which is where it is confirmed or rejected.
        pending = await self.db.execute(
            select(
                BudgetAmendment.budget_id,
                BudgetCategory.name,
                BudgetAmendment.reason,
                BudgetAmendment.amount,
            )
            .join(
                Budget,
                and_(
                    Budget.id == BudgetAmendment.budget_id,
                    Budget.organization_id == org_id,
                ),
            )
            .outerjoin(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .where(
                BudgetAmendment.organization_id == org_id,
                Budget.fiscal_year_id == fy.id,
                BudgetAmendment.status == BudgetAmendmentStatus.PENDING,
            )
            .order_by(BudgetAmendment.created_at, BudgetAmendment.id)
        )
        for budget_id, category, reason, amendment_amount in pending.all():
            items.append(
                {
                    "kind": "budget_amendment",
                    "entity_id": budget_id,
                    "number": f"Amendment to {category or 'a budget line'}",
                    "description": reason,
                    "status": BudgetAmendmentStatus.PENDING.value,
                    "amount": amendment_amount,
                }
            )
        return items

    async def lock_fiscal_year(
        self,
        fy_id: str,
        org_id: str,
        *,
        locked_by: str,
        notes: str,
    ) -> FiscalYear:
        """Lock a reconciled year for good, with the Treasurer's sign-off.

        Only from the closing period, and only once nothing is open: every
        item must be paid, issued, cancelled or denied first. The year's row
        is locked for the check, and the guards that admit new activity read
        it under a share lock, so nothing can be submitted or paid beside a
        lock that is landing.
        """
        reconciliation = (notes or "").strip()
        if not reconciliation:
            raise ValueError("Add the reconciliation notes for the sign-off.")
        fy = await self._fiscal_year_for_update(fy_id, org_id)
        if fy.is_locked:
            raise ValueError(f"{fy.name} is already locked.")
        if fy.status != FiscalYearStatus.CLOSED:
            raise ValueError(
                f"{fy.name} can be locked only after its year-end close has " "begun."
            )
        open_items = await self.list_open_items(fy.id, org_id)
        if open_items:
            shown = ", ".join(item["number"] for item in open_items[:5])
            more = f" and {len(open_items) - 5} more" if len(open_items) > 5 else ""
            raise ValueError(
                f"{fy.name} still has {len(open_items)} open "
                f"{'item' if len(open_items) == 1 else 'items'}: {shown}{more}. "
                "Pay, issue, cancel or deny each request, and confirm or reject "
                "each amendment, before locking."
            )
        fy.is_locked = True
        fy.locked_by = locked_by
        fy.locked_at = datetime.now(timezone.utc)
        fy.lock_notes = reconciliation
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Locked fiscal year {}", fy_id)
        return fy

    async def _fiscal_year_for_update(self, fy_id: str, org_id: str) -> FiscalYear:
        fy: FiscalYear | None = (
            await self.db.execute(
                select(FiscalYear)
                .where(FiscalYear.id == fy_id, FiscalYear.organization_id == org_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if fy is None:
            raise FinanceEntityNotFoundError("Fiscal year not found")
        return fy

    async def require_year_accepts(
        self, fiscal_year_id: Optional[str], org_id: str, *, action: str
    ) -> None:
        """Refuse finance activity a fiscal year no longer accepts.

        ``new`` — raising, editing or submitting a request — needs an active
        or draft year. ``finish`` — paying, issuing, voiding or cancelling
        what is already in flight — needs only a year that is not locked, so a
        closing year can settle its last bills. Read under a share lock so it
        waits out a ``lock_fiscal_year`` that is landing.
        """
        if not fiscal_year_id:
            return
        row = (
            await self.db.execute(
                select(FiscalYear.name, FiscalYear.status, FiscalYear.is_locked)
                .where(
                    FiscalYear.id == fiscal_year_id,
                    FiscalYear.organization_id == org_id,
                )
                .with_for_update(read=True)
            )
        ).one_or_none()
        if row is None:
            return
        name, status, is_locked = row
        if is_locked:
            raise ValueError(f"{name} is locked; its records can no longer change.")
        if action == "new" and status == FiscalYearStatus.CLOSED:
            raise ValueError(
                f"{name} is closing for year-end: new requests can no longer be "
                "raised or submitted against it."
            )

    async def get_active_fiscal_year(self, org_id: str) -> Optional[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.ACTIVE,
            )
        )
        fiscal_year: Optional[FiscalYear] = result.scalar_one_or_none()
        return fiscal_year

    # ========================================
    # Budget Categories
    # ========================================

    async def list_budget_categories(
        self, org_id: str, pagination: PaginationParams
    ) -> list[BudgetCategory]:
        result = await self.db.execute(
            select(BudgetCategory)
            .where(BudgetCategory.organization_id == org_id)
            .order_by(BudgetCategory.sort_order, BudgetCategory.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().all())

    def _category_detail_query(self, org_id: str):
        """Categories with their owner position's name, in one query.

        The position join is org-scoped as well as the category, so a stored
        id that somehow names another org's position never surfaces its name.
        """
        return (
            select(BudgetCategory, Position.name.label("owner_position_name"))
            .outerjoin(
                Position,
                and_(
                    Position.id == BudgetCategory.owner_position_id,
                    Position.organization_id == org_id,
                ),
            )
            .where(BudgetCategory.organization_id == org_id)
        )

    @staticmethod
    def _category_row(
        category: BudgetCategory, owner_position_name, tree: CategoryTree
    ) -> dict:
        row = {
            column.key: getattr(category, column.key)
            for column in BudgetCategory.__table__.columns
        }
        row["owner_position_name"] = owner_position_name
        # What the category's lines are actually subject to, so a screen
        # reports the inherited rule rather than re-deriving it (pitfall #29).
        rule = tree.rule(str(category.id))
        row["effective_charge_access"] = rule.access.value
        row["charge_access_inherited_from"] = (
            tree.by_id[rule.source_category_id].name
            if rule.source_category_id and rule.source_category_id != str(category.id)
            else None
        )
        row["charge_position_ids"] = sorted(
            tree.named_positions.get(str(category.id), set())
        )
        row["path"] = tree.path(str(category.id))
        # Active itself but closed by an inactive category above it: the
        # settings screen says so rather than badging it open (pitfall #29).
        source = tree.inactive_source(str(category.id))
        row["inactive_through"] = (
            source.name
            if source is not None and source.id != str(category.id)
            else None
        )
        return row

    async def list_budget_category_details(
        self, org_id: str, pagination: PaginationParams
    ) -> list[dict]:
        """``list_budget_categories`` plus each category's owner and charge rule."""
        result = await self.db.execute(
            self._category_detail_query(org_id)
            .order_by(BudgetCategory.sort_order, BudgetCategory.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        rows = result.all()
        tree = await load_category_tree(self.db, org_id)
        return [self._category_row(cat, name, tree) for cat, name in rows]

    async def get_budget_category_detail(
        self, cat_id: str, org_id: str
    ) -> Optional[dict]:
        result = await self.db.execute(
            self._category_detail_query(org_id).where(BudgetCategory.id == cat_id)
        )
        row = result.first()
        if not row:
            return None
        tree = await load_category_tree(self.db, org_id)
        return self._category_row(row[0], row[1], tree)

    async def get_budget_category(
        self, cat_id: str, org_id: str
    ) -> Optional[BudgetCategory]:
        result = await self.db.execute(
            select(BudgetCategory).where(
                BudgetCategory.id == cat_id,
                BudgetCategory.organization_id == org_id,
            )
        )
        budget_category: Optional[BudgetCategory] = result.scalar_one_or_none()
        return budget_category

    async def create_budget_category(self, org_id: str, **kwargs) -> BudgetCategory:
        charge_position_ids = kwargs.pop("charge_position_ids", None)
        await self._validate_budget_category_fks(org_id, kwargs)
        await self._validate_charge_positions(org_id, charge_position_ids)
        _refuse_unusable_accounts(kwargs.get("qb_account_name"))
        cat = BudgetCategory(organization_id=org_id, **kwargs)
        self.db.add(cat)
        await self.db.flush()
        if charge_position_ids is not None:
            await self._replace_charge_positions(org_id, cat.id, charge_position_ids)
        await self.db.refresh(cat, ["created_at", "updated_at"])
        return cat

    async def update_budget_category(
        self, cat_id: str, org_id: str, **kwargs
    ) -> BudgetCategory:
        charge_position_ids = kwargs.pop("charge_position_ids", None)
        await self._validate_budget_category_fks(org_id, kwargs)
        await self._validate_charge_positions(org_id, charge_position_ids)
        _refuse_unusable_accounts(kwargs.get("qb_account_name"))
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        if kwargs.get("parent_category_id"):
            await self._refuse_category_cycle(
                org_id, cat.id, kwargs["parent_category_id"]
            )
        apply_updates(cat, kwargs)
        await self.db.flush()
        if charge_position_ids is not None:
            await self._replace_charge_positions(org_id, cat.id, charge_position_ids)
        await self.db.refresh(cat, ["updated_at"])
        return cat

    async def set_category_charge_access(
        self,
        cat_id: str,
        org_id: str,
        manager_id: Optional[str],
        charge_access: Optional[ChargeAccess],
        charge_position_ids: list[str],
    ) -> BudgetCategory:
        """Set who may charge a category's lines.

        ``manager_id`` None is ``finance.manage``; otherwise the caller must
        hold an owner position on the category or one above it
        (``CategoryTree.manageable_by``). A category the caller may not manage
        reads as not found, so the endpoint does not confirm it exists.
        """
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise FinanceEntityNotFoundError("Budget category not found")
        if manager_id is not None:
            tree = await load_category_tree(self.db, org_id)
            held = await held_position_ids(self.db, org_id, manager_id)
            if not tree.manageable_by(str(cat.id), held):
                raise FinanceEntityNotFoundError("Budget category not found")
        await self._validate_charge_positions(org_id, charge_position_ids)
        cat.charge_access = charge_access
        await self.db.flush()
        await self._replace_charge_positions(org_id, cat.id, charge_position_ids)
        await self.db.refresh(cat, ["updated_at"])
        return cat

    async def list_charge_access_categories(
        self, org_id: str, user_id: str
    ) -> list[dict]:
        """The open categories ``user_id`` owns or that sit beneath one they
        own, with the charge rule each is under — the owner's own settings.

        Open means neither the category nor one above it is inactive
        (``CategoryTree.inactive_source``).

        Ordered as a tree, parents before their children.
        """
        tree = await load_category_tree(self.db, org_id)
        held = await held_position_ids(self.db, org_id, user_id)
        if not held:
            return []
        result = await self.db.execute(self._category_detail_query(org_id))
        rows = [
            self._category_row(cat, name, tree)
            for cat, name in result.all()
            if tree.is_effectively_active(str(cat.id))
            and tree.manageable_by(str(cat.id), held)
        ]
        rows.sort(key=lambda row: [part.casefold() for part in row["path"]])
        return rows

    async def _refuse_category_cycle(
        self, org_id: str, cat_id: str, parent_id: str
    ) -> None:
        """Refuse a parent that is the category itself or one of its children.

        Every walk up the tree (QuickBooks account, functional class, charge
        rule) would otherwise loop, and the category would vanish from the
        tree the settings screen draws.
        """
        if str(parent_id) == str(cat_id):
            raise ValueError("A category cannot be its own parent")
        tree = await load_category_tree(self.db, org_id)
        if str(parent_id) in tree.descendant_ids(str(cat_id)):
            raise ValueError(
                "A category cannot be placed under one of its own sub-categories"
            )

    async def _validate_charge_positions(
        self, org_id: str, position_ids: Optional[list[str]]
    ) -> None:
        """Pitfall 14c: every named position must be one of the org's."""
        for position_id in position_ids or []:
            await assert_in_org(
                self.db, Position, position_id, org_id, label="Position"
            )

    async def _replace_charge_positions(
        self, org_id: str, cat_id: str, position_ids: list[str]
    ) -> None:
        existing = await self.db.execute(
            select(BudgetCategoryChargePosition).where(
                BudgetCategoryChargePosition.organization_id == org_id,
                BudgetCategoryChargePosition.category_id == cat_id,
            )
        )
        wanted = {str(p) for p in position_ids}
        for row in existing.scalars().all():
            if row.position_id in wanted:
                wanted.discard(row.position_id)
            else:
                await self.db.delete(row)
        for position_id in sorted(wanted):
            self.db.add(
                BudgetCategoryChargePosition(
                    organization_id=org_id,
                    category_id=cat_id,
                    position_id=position_id,
                )
            )
        await self.db.flush()

    async def _validate_budget_category_fks(self, org_id: str, data: dict) -> None:
        """Reject a client-supplied ``parent_category_id`` outside the org.

        Self-referential, ``ondelete="SET NULL"`` (Pitfall 14c). Same shape
        as ``_validate_finance_fks``, kept separate because a budget category
        create/update never carries the fields that helper checks.
        """
        parent_category_id = data.get("parent_category_id")
        if parent_category_id:
            await assert_in_org(
                self.db,
                BudgetCategory,
                parent_category_id,
                org_id,
                label="Parent category",
            )
        await self._validate_owner_position(org_id, data)

    async def _validate_owner_position(self, org_id: str, data: dict) -> None:
        """Reject an ``owner_position_id`` that is not a position in the org.

        Pitfall 14c: the key is ``ondelete="SET NULL"``, so a foreign position
        would both leak its name back through the response join (were that
        join not org-scoped) and let the other org's deletion silently unown
        this org's line. Absent or null is fine — null clears the owner.
        """
        owner_position_id = data.get("owner_position_id")
        if owner_position_id:
            await assert_in_org(
                self.db, Position, owner_position_id, org_id, label="Owner position"
            )

    async def budget_category_in_use(self, cat_id: str, org_id: str) -> bool:
        """True when deleting the category would destroy or rewrite history.

        A budget line in any fiscal year cascades away with its category, and
        with it the budget link on every purchase request, expense line, check
        request and budget request charged to it — so a line is enough on its
        own; the requests behind it need no separate look. An approval chain
        naming the category would fall to NULL, which ``pick_approval_chain``
        reads as "any category": a category-specific chain would silently
        start routing every request in the department. A proposal for a new
        line would lose the category it asked for.
        """
        references = (
            select(Budget.id).where(
                Budget.category_id == cat_id, Budget.organization_id == org_id
            ),
            select(ApprovalChain.id).where(
                ApprovalChain.budget_category_id == cat_id,
                ApprovalChain.organization_id == org_id,
            ),
            select(BudgetRequest.id).where(
                BudgetRequest.category_id == cat_id,
                BudgetRequest.organization_id == org_id,
            ),
        )
        for query in references:
            if await self.db.scalar(query.limit(1)) is not None:
                return True
        return False

    async def delete_budget_category(self, cat_id: str, org_id: str) -> bool:
        """Delete an unused category; deactivate one that is in use.

        Returns True when the row was deleted and False when it was
        deactivated instead (``budget_category_in_use``). A deactivated
        category keeps every line, request and chain that names it, and drops
        out of the pickers that start new budget lines and proposals.
        """
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        if await self.budget_category_in_use(cat.id, org_id):
            cat.is_active = False
            await self.db.flush()
            return False
        await self.db.delete(cat)
        await self.db.flush()
        return True

    # ========================================
    # Budgets
    # ========================================

    async def list_budgets(
        self,
        org_id: str,
        pagination: PaginationParams,
        fiscal_year_id: Optional[str] = None,
        category_id: Optional[str] = None,
        station_id: Optional[str] = None,
    ) -> list[Budget]:
        query = select(Budget).where(Budget.organization_id == org_id)
        if fiscal_year_id:
            query = query.where(Budget.fiscal_year_id == fiscal_year_id)
        if category_id:
            query = query.where(Budget.category_id == category_id)
        if station_id:
            query = query.where(Budget.station_id == station_id)
        query = (
            query.order_by(Budget.id).offset(pagination.skip).limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    def _budget_detail_query(self, org_id: str):
        """Budget lines with their station and owner names, in one query.

        Every joined table is constrained to the org, so a stored id that
        names another org's row resolves to no name rather than to theirs.
        The station name is the facility name ``list_budget_options`` labels
        the line with, so the two never disagree.
        """
        line_owner = aliased(Position)
        category_owner = aliased(Position)
        # One grouped read of every line's amendments, joined once, so the
        # list stays a single query however many lines it holds. Only a
        # confirmed amendment has moved the line; pending ones are counted
        # apart so the page can say some are waiting.
        confirmed = BudgetAmendment.status == BudgetAmendmentStatus.CONFIRMED
        pending = BudgetAmendment.status == BudgetAmendmentStatus.PENDING
        amendments = (
            select(
                BudgetAmendment.budget_id.label("budget_id"),
                func.sum(case((confirmed, BudgetAmendment.amount), else_=0)).label(
                    "total"
                ),
                func.sum(case((confirmed, 1), else_=0)).label("n"),
                func.sum(case((pending, 1), else_=0)).label("pending"),
            )
            .where(BudgetAmendment.organization_id == org_id)
            .group_by(BudgetAmendment.budget_id)
            .subquery()
        )
        return (
            select(
                Budget,
                BudgetCategory.owner_position_id.label("category_owner_id"),
                BudgetCategory.name.label("category_name"),
                FiscalYear.name.label("fiscal_year_name"),
                FiscalYear.status.label("fiscal_year_status"),
                FiscalYear.planning_stage.label("fiscal_year_stage"),
                FiscalYear.is_locked.label("fiscal_year_locked"),
                FiscalYear.start_date.label("fiscal_year_start_date"),
                Facility.name.label("station_name"),
                line_owner.name.label("line_owner_name"),
                category_owner.name.label("category_owner_name"),
                func.coalesce(amendments.c.total, 0).label("amendments_total"),
                func.coalesce(amendments.c.n, 0).label("amendment_count"),
                func.coalesce(amendments.c.pending, 0).label("pending_amendments"),
            )
            .outerjoin(amendments, amendments.c.budget_id == Budget.id)
            .outerjoin(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .outerjoin(
                FiscalYear,
                and_(
                    FiscalYear.id == Budget.fiscal_year_id,
                    FiscalYear.organization_id == org_id,
                ),
            )
            .outerjoin(
                Facility,
                and_(
                    Facility.id == Budget.station_id,
                    Facility.organization_id == org_id,
                ),
            )
            .outerjoin(
                line_owner,
                and_(
                    line_owner.id == Budget.owner_position_id,
                    line_owner.organization_id == org_id,
                ),
            )
            .outerjoin(
                category_owner,
                and_(
                    category_owner.id == BudgetCategory.owner_position_id,
                    category_owner.organization_id == org_id,
                ),
            )
            .where(Budget.organization_id == org_id)
        )

    @staticmethod
    def _budget_row(row) -> dict:
        """One budget line as the budget pages show it.

        ``amount_budgeted`` is the current budget, confirmed amendments
        included. The original budget is derived, not stored: the current
        amount less the sum of the line's confirmed amendments. A direct edit
        of ``amount_budgeted`` therefore moves the original by the same amount,
        which is what the edit means. ``amount_editable`` says whether that
        edit is still allowed (``_amount_by_amendment``).
        """
        budget = row[0]
        data = {
            column.key: getattr(budget, column.key)
            for column in Budget.__table__.columns
        }
        amendments_total = Decimal(row.amendments_total or 0)
        data.update(
            amendments_total=amendments_total,
            amendment_count=int(row.amendment_count or 0),
            pending_amendment_count=int(row.pending_amendments or 0),
            original_amount=Decimal(budget.amount_budgeted or 0) - amendments_total,
            amount_editable=not _amount_by_amendment(
                row.fiscal_year_status,
                row.fiscal_year_stage,
                bool(row.fiscal_year_locked),
            ),
        )
        effective_id, inherited = resolve_owner(
            budget.owner_position_id, row.category_owner_id
        )
        fiscal_year_status = row.fiscal_year_status
        data.update(
            # Named here so a reader without the category and fiscal-year
            # lists (a line's owner, who holds no finance.view) can label it.
            category_name=row.category_name,
            fiscal_year_name=row.fiscal_year_name,
            fiscal_year_status=(
                fiscal_year_status.value
                if isinstance(fiscal_year_status, FiscalYearStatus)
                else fiscal_year_status
            ),
            station_name=row.station_name,
            owner_position_name=row.line_owner_name,
            effective_owner_position_id=effective_id,
            effective_owner_position_name=(
                row.category_owner_name if inherited else row.line_owner_name
            ),
            owner_inherited=inherited,
        )
        return data

    async def list_budget_details(
        self,
        org_id: str,
        pagination: PaginationParams,
        fiscal_year_id: Optional[str] = None,
        category_id: Optional[str] = None,
        station_id: Optional[str] = None,
    ) -> list[dict]:
        """``list_budgets`` with station and owner names, for the budget pages."""
        query = self._budget_detail_query(org_id)
        if fiscal_year_id:
            query = query.where(Budget.fiscal_year_id == fiscal_year_id)
        if category_id:
            query = query.where(Budget.category_id == category_id)
        if station_id:
            query = query.where(Budget.station_id == station_id)
        query = (
            query.order_by(Budget.id).offset(pagination.skip).limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return [self._budget_row(row) for row in result.all()]

    async def get_budget_detail(self, budget_id: str, org_id: str) -> Optional[dict]:
        result = await self.db.execute(
            self._budget_detail_query(org_id).where(Budget.id == budget_id)
        )
        row = result.first()
        return self._budget_row(row) if row else None

    async def list_my_budgets(
        self, org_id: str, user_id: str, fiscal_year_id: Optional[str] = None
    ) -> list[dict]:
        """The lines ``user_id`` owns, every fiscal year, newest year first.

        Which lines those are is ``owned_budgets_query``'s answer, not a second
        rule (CLAUDE.md pitfall #29). Each row is the budget pages' detail row
        plus what is left and how much is used, so the owner's page reports
        the figures rather than working them out.
        """
        owned_ids = owned_budgets_query(org_id, user_id).with_only_columns(Budget.id)
        query = self._budget_detail_query(org_id).where(Budget.id.in_(owned_ids))
        if fiscal_year_id:
            query = query.where(Budget.fiscal_year_id == fiscal_year_id)
        query = query.order_by(
            FiscalYear.start_date.desc(),
            BudgetCategory.name,
            Facility.name,
            Budget.id,
        )
        result = await self.db.execute(query)
        rows = []
        for row in result.all():
            data = self._budget_row(row)
            budgeted = Decimal(data["amount_budgeted"] or 0)
            used = Decimal(data["amount_spent"] or 0) + Decimal(
                data["amount_encumbered"] or 0
            )
            data["amount_remaining"] = budgeted - used
            data["percent_used"] = (
                round(float(used / budgeted * 100), 1) if budgeted > 0 else 0.0
            )
            rows.append(data)
        return rows

    async def list_budget_transactions(
        self, budget_id: str, org_id: str, limit: int, offset: int
    ) -> dict:
        """What moved a line's spent and encumbered totals, newest first.

        One row per record that ``_mutate_budget`` counted against this line,
        taken from the same ``budget_id`` its callers pass it, so the listed
        figures add up to the line's totals:

        * a purchase request **approved / ordered / received** encumbers its
          estimate (``_finalize_approval``); once **paid** the estimate is
          released and the actual amount (else the estimate) is spent
          (``mark_pr_paid``);
        * a check request **issued** is spent (``issue_check``); a **voided**
          one is listed with effect ``none`` because ``void_check`` reversed it;
        * an expense report's line items charged to this line are spent once
          the report is **paid** (``mark_expense_paid``) — the line item's own
          ``budget_id``, not the report's.

        Excluded because they never touched the totals: drafts, submitted,
        pending, denied, and cancelled records (a request cancelled after
        approval had its encumbrance released). The one way the sum can differ
        from the stored totals is ``_mutate_budget``'s floor at zero, which a
        release larger than the balance would have clipped.

        Only the requester's name is joined — no payee address, check number
        or payment method.

        Raises ``FinanceEntityNotFoundError`` for a line that is not the org's.
        """
        if await self.get_budget(budget_id, org_id) is None:
            raise FinanceEntityNotFoundError("Budget not found")

        def requester_join(column):
            return and_(User.id == column, User.organization_id == org_id)

        pr_paid = PurchaseRequest.status == PurchaseRequestStatus.PAID
        purchases = (
            select(
                PurchaseRequest.id.label("row_id"),
                literal("purchase_request").label("kind"),
                PurchaseRequest.id.label("entity_id"),
                PurchaseRequest.request_number.label("number"),
                PurchaseRequest.title.label("description"),
                PurchaseRequest.vendor.label("counterparty"),
                PurchaseRequest.requested_by.label("requester_id"),
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                cast(PurchaseRequest.status, String(30)).label("status"),
                case(
                    (
                        pr_paid,
                        func.coalesce(
                            PurchaseRequest.actual_amount,
                            PurchaseRequest.estimated_amount,
                        ),
                    ),
                    else_=PurchaseRequest.estimated_amount,
                ).label("amount"),
                case((pr_paid, literal("spent")), else_=literal("encumbered")).label(
                    "effect"
                ),
                case(
                    (pr_paid, PurchaseRequest.paid_at),
                    else_=func.coalesce(
                        PurchaseRequest.approved_at, PurchaseRequest.created_at
                    ),
                ).label("occurred_at"),
            )
            .outerjoin(User, requester_join(PurchaseRequest.requested_by))
            .where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.budget_id == budget_id,
                PurchaseRequest.status.in_(
                    [
                        PurchaseRequestStatus.APPROVED,
                        PurchaseRequestStatus.ORDERED,
                        PurchaseRequestStatus.RECEIVED,
                        PurchaseRequestStatus.PAID,
                    ]
                ),
            )
        )
        checks = (
            select(
                CheckRequest.id.label("row_id"),
                literal("check_request").label("kind"),
                CheckRequest.id.label("entity_id"),
                CheckRequest.request_number.label("number"),
                func.coalesce(CheckRequest.memo, CheckRequest.purpose).label(
                    "description"
                ),
                CheckRequest.payee_name.label("counterparty"),
                CheckRequest.requested_by.label("requester_id"),
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                cast(CheckRequest.status, String(30)).label("status"),
                CheckRequest.amount.label("amount"),
                case(
                    (
                        CheckRequest.status == CheckRequestStatus.ISSUED,
                        literal("spent"),
                    ),
                    else_=literal("none"),
                ).label("effect"),
                func.coalesce(CheckRequest.check_date, CheckRequest.updated_at).label(
                    "occurred_at"
                ),
            )
            .outerjoin(User, requester_join(CheckRequest.requested_by))
            .where(
                CheckRequest.organization_id == org_id,
                CheckRequest.budget_id == budget_id,
                CheckRequest.status.in_(
                    [CheckRequestStatus.ISSUED, CheckRequestStatus.VOIDED]
                ),
            )
        )
        expenses = (
            select(
                ExpenseLineItem.id.label("row_id"),
                literal("expense_report").label("kind"),
                ExpenseReport.id.label("entity_id"),
                ExpenseReport.report_number.label("number"),
                ExpenseLineItem.description.label("description"),
                ExpenseLineItem.merchant.label("counterparty"),
                ExpenseReport.submitted_by.label("requester_id"),
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                cast(ExpenseReport.status, String(30)).label("status"),
                ExpenseLineItem.amount.label("amount"),
                literal("spent").label("effect"),
                func.coalesce(ExpenseReport.paid_at, ExpenseReport.updated_at).label(
                    "occurred_at"
                ),
            )
            .join(
                ExpenseReport,
                and_(
                    ExpenseReport.id == ExpenseLineItem.expense_report_id,
                    ExpenseReport.organization_id == org_id,
                ),
            )
            .outerjoin(User, requester_join(ExpenseReport.submitted_by))
            .where(
                ExpenseLineItem.budget_id == budget_id,
                ExpenseReport.status == ExpenseReportStatus.PAID,
            )
        )
        movements = union_all(purchases, checks, expenses).subquery()

        total = (
            await self.db.execute(select(func.count()).select_from(movements))
        ).scalar_one()
        result = await self.db.execute(
            select(movements)
            .order_by(movements.c.occurred_at.desc(), movements.c.row_id.desc())
            .offset(offset)
            .limit(limit)
        )
        items = []
        for row in result.all():
            name = format_display_name(
                row.first_name, row.last_name, row.preferred_name
            )
            items.append(
                {
                    "id": row.row_id,
                    "kind": row.kind,
                    "entity_id": row.entity_id,
                    "number": row.number,
                    "description": row.description,
                    "counterparty": row.counterparty,
                    "requester_name": name or row.username or None,
                    "status": row.status,
                    "amount": row.amount,
                    "effect": row.effect,
                    "occurred_at": row.occurred_at,
                }
            )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    async def get_budget(self, budget_id: str, org_id: str) -> Optional[Budget]:
        result = await self.db.execute(
            select(Budget).where(
                Budget.id == budget_id,
                Budget.organization_id == org_id,
            )
        )
        budget: Optional[Budget] = result.scalar_one_or_none()
        return budget

    async def create_budget(self, org_id: str, created_by: str, **kwargs) -> Budget:
        await self._validate_finance_fks(org_id, kwargs)
        await self._validate_owner_position(org_id, kwargs)
        fiscal_year_id = kwargs.get("fiscal_year_id")
        fiscal_year = (
            await self.get_fiscal_year(fiscal_year_id, org_id)
            if fiscal_year_id
            else None
        )
        if fiscal_year is not None and fiscal_year.status == FiscalYearStatus.CLOSED:
            # Draft and Active years take budgets; a closed year is settled
            # history (docs/training/11-finance.md, "Creating a Budget").
            raise ValueError(
                "This fiscal year is closed. Budget lines can only be added to "
                "a draft or active fiscal year."
            )
        if (
            fiscal_year is not None
            and _amount_by_amendment(
                fiscal_year.status, fiscal_year.planning_stage, fiscal_year.is_locked
            )
            and Decimal(kwargs.get("amount_budgeted") or 0) != 0
        ):
            raise ValueError(_NEW_LINE_AT_ZERO_MESSAGE)
        await self.assert_category_takes_new_lines(org_id, kwargs.get("category_id"))
        budget = Budget(organization_id=org_id, created_by=created_by, **kwargs)
        self.db.add(budget)
        await self.db.flush()
        await self.db.refresh(budget, ["created_at", "updated_at"])
        return budget

    async def assert_category_takes_new_lines(
        self, org_id: str, category_id: Optional[str]
    ) -> None:
        """Refuse a new budget line or proposal in a closed category.

        A category in use is deactivated rather than deleted
        (``delete_budget_category``) and is not offered for new lines. Closed
        means it or any category above it is inactive
        (``CategoryTree.inactive_source``); when a parent is the cause, the
        refusal names the parent, since that is what would be reactivated.
        A category id that is not the org's is left to the FK validation.
        """
        if not category_id:
            return
        tree = await load_category_tree(self.db, org_id)
        source = tree.inactive_source(str(category_id))
        if source is None:
            return
        if source.id == str(category_id):
            raise ValueError(
                "This budget category is inactive. Choose an active category."
            )
        raise ValueError(
            f'The budget category "{source.name}" is inactive, so no new budget '
            "lines can be added under it. Choose an active category."
        )

    async def update_budget(self, budget_id: str, org_id: str, **kwargs) -> Budget:
        await self._validate_finance_fks(org_id, kwargs)
        await self._validate_owner_position(org_id, kwargs)
        # amount_budgeted changes the ceiling _mutate_budget enforces, so this
        # read must be the same locking read that ceiling check uses -- a
        # plain read here would let a reduction race a concurrent spend/
        # encumbrance past it (CLAUDE.md pitfall #27).
        result = await self.db.execute(
            select(Budget)
            .where(Budget.id == budget_id, Budget.organization_id == org_id)
            .with_for_update()
        )
        budget: Budget | None = result.scalar_one_or_none()
        if not budget:
            raise ValueError("Budget not found")
        if "amount_budgeted" in kwargs and kwargs["amount_budgeted"] is not None:
            new_amount = Decimal(kwargs["amount_budgeted"])
            # A locked year's amounts are final. Notes, owner and station stay
            # editable: they describe the line, they do not move money. An
            # unchanged amount is not a change, so a form that sends every
            # field it owns still saves.
            if new_amount != budget.amount_budgeted:
                year = await self._year_state(budget.fiscal_year_id, org_id)
                if year is not None and year.is_locked:
                    raise ValueError(_LOCKED_YEAR_AMOUNT_MESSAGE)
                if year is not None and _amount_by_amendment(
                    year.status, year.planning_stage, year.is_locked
                ):
                    raise ValueError(_AMOUNT_BY_AMENDMENT_MESSAGE)
            if new_amount < budget.amount_spent + budget.amount_encumbered:
                raise BudgetLimitExceededError()
        apply_updates(budget, kwargs)
        await self.db.flush()
        await self.db.refresh(budget, ["updated_at"])
        return budget

    async def _year_state(self, fiscal_year_id: str, org_id: str):
        """A line's fiscal year's status, stage and lock, read under a share lock.

        The same share lock as ``_year_is_locked``, so a direct amount edit
        waits out a stage move or a lock that is landing.
        """
        result = await self.db.execute(
            select(FiscalYear.status, FiscalYear.planning_stage, FiscalYear.is_locked)
            .where(
                FiscalYear.id == fiscal_year_id,
                FiscalYear.organization_id == org_id,
            )
            .with_for_update(read=True)
        )
        return result.one_or_none()

    async def _year_is_locked(self, fiscal_year_id: str, org_id: str) -> bool:
        """Whether a budget line's fiscal year is locked, read under a share lock.

        The share lock waits out a ``lock_fiscal_year`` in flight and then
        reads the committed flag, so an amount change cannot slip in beside a
        lock that is landing; concurrent amendments in one year share it and
        do not queue behind each other.
        """
        result = await self.db.execute(
            select(FiscalYear.is_locked)
            .where(
                FiscalYear.id == fiscal_year_id,
                FiscalYear.organization_id == org_id,
            )
            .with_for_update(read=True)
        )
        return bool(result.scalar_one_or_none())

    # ========================================
    # Budget Amendments
    # ========================================

    async def add_budget_amendment(
        self,
        budget_id: str,
        org_id: str,
        created_by: str,
        *,
        amount: Decimal,
        reason: str,
        approved_by: str,
        approved_on: date,
    ) -> BudgetAmendment:
        """Record extra money approved for a line, pending a second officer.

        Nothing moves yet: ``confirm_budget_amendment`` raises the line when
        another officer confirms it. Locks the line (the same locking read
        ``update_budget`` and the spend checks use, CLAUDE.md pitfall #27) and
        refuses a locked year or a total past the column's limit now, so a
        doomed amendment is refused to the person entering it. Raises
        ``FinanceEntityNotFoundError`` for a line that is not the org's.

        A request refused earlier for lack of funds is not reprocessed: the
        member resubmits (owner decision, 2026-10-08).
        """
        amount = Decimal(amount).quantize(Decimal("0.01"))
        if amount <= 0:
            raise ValueError("The amount added must be greater than zero.")
        reason = (reason or "").strip()
        approved_by = (approved_by or "").strip()
        if not reason:
            raise ValueError("Give a reason for the amendment.")
        if not approved_by:
            raise ValueError("Say who approved the amendment.")
        # The department's calendar, not the server's: a container runs in
        # UTC, which is already tomorrow for a US department every evening.
        if approved_on > await resolve_org_today(self.db, org_id):
            raise ValueError("The approval date cannot be in the future.")

        result = await self.db.execute(
            select(Budget)
            .where(Budget.id == budget_id, Budget.organization_id == org_id)
            .with_for_update()
        )
        budget = result.scalar_one_or_none()
        if not budget:
            raise FinanceEntityNotFoundError("Budget not found")
        if await self._year_is_locked(budget.fiscal_year_id, org_id):
            raise ValueError(_LOCKED_YEAR_AMOUNT_MESSAGE)
        new_amount = Decimal(budget.amount_budgeted or 0) + amount
        if new_amount > _MAX_BUDGET_AMOUNT:
            raise ValueError("That amendment would take the budget past its limit.")

        amendment = BudgetAmendment(
            organization_id=org_id,
            budget_id=budget.id,
            amount=amount,
            reason=reason,
            approved_by=approved_by,
            approved_on=approved_on,
            created_by=created_by,
            status=BudgetAmendmentStatus.PENDING,
        )
        self.db.add(amendment)
        await self.db.flush()
        await self.db.refresh(amendment, ["created_at"])
        logger.info(
            "Budget {} amendment of {} entered, pending, in org {}",
            budget.id,
            amount,
            org_id,
        )
        return amendment

    async def reverse_budget_amendment(
        self,
        budget_id: str,
        amendment_id: str,
        org_id: str,
        created_by: str,
        *,
        reason: str,
        approved_by: str,
        approved_on: date,
    ) -> BudgetAmendment:
        """Enter a reversing entry for a mistaken amendment, pending confirmation.

        A mistaken amendment is never edited or deleted (owner decision,
        2026-10-09). The reversal is a new row for the whole amount, negated,
        carrying its own reason and approval. Like an amendment it is entered
        pending; ``amount_budgeted`` drops by the amount only when another
        officer confirms it. The original budget is then unchanged, because it
        is the current amount less the sum of every confirmed row and both
        moved by the same amount. Only a confirmed amendment can be reversed: a
        pending one is rejected instead.

        One transaction, locks taken in ``add_budget_amendment``'s order: the
        line first (the locking read the spend checks use, CLAUDE.md pitfall
        #27), then the amendment, then a *locking* read for an existing
        reversal -- a plain read would answer from the snapshot taken before
        the line's lock was granted, and let two reversals of one amendment
        both see none. The UNIQUE key on ``reverses_amendment_id`` stands
        behind that check.

        Raises ``FinanceEntityNotFoundError`` for a line that is not the org's
        or an amendment that is not on that line; ``AmendmentAlreadyReversedError``
        for an amendment reversed before; ``BudgetLimitExceededError`` when the
        lower budget would no longer cover what is spent and committed; and
        ``ValueError`` for a reversal of a reversal, a locked year, a blank
        reason or approver, or a future approval date.
        """
        reason = (reason or "").strip()
        approved_by = (approved_by or "").strip()
        if not reason:
            raise ValueError("Give a reason for the reversal.")
        if not approved_by:
            raise ValueError("Say who approved the reversal.")
        # The department's calendar, as for an amendment.
        if approved_on > await resolve_org_today(self.db, org_id):
            raise ValueError("The approval date cannot be in the future.")

        result = await self.db.execute(
            select(Budget)
            .where(Budget.id == budget_id, Budget.organization_id == org_id)
            .with_for_update()
        )
        budget = result.scalar_one_or_none()
        if not budget:
            raise FinanceEntityNotFoundError("Budget not found")
        amendment_result = await self.db.execute(
            select(BudgetAmendment)
            .where(
                BudgetAmendment.id == amendment_id,
                BudgetAmendment.budget_id == budget.id,
                BudgetAmendment.organization_id == org_id,
            )
            .with_for_update()
        )
        target = amendment_result.scalar_one_or_none()
        if not target:
            raise FinanceEntityNotFoundError("Amendment not found")
        # A reversal is final: money it took back is restored by recording a
        # new amendment, with its own approval. A negative amount marks a
        # reversal even if its link was lost to a downgrade.
        if target.reverses_amendment_id is not None or target.amount <= 0:
            raise ValueError(
                "A reversal cannot itself be reversed. Record a new amendment "
                "instead."
            )
        if target.status != BudgetAmendmentStatus.CONFIRMED:
            raise ValueError(
                "Only a confirmed amendment can be reversed; a pending one is "
                "rejected instead."
            )
        existing = await self.db.execute(
            select(BudgetAmendment.id)
            .where(
                BudgetAmendment.reverses_amendment_id == target.id,
                BudgetAmendment.organization_id == org_id,
            )
            .with_for_update()
        )
        if existing.first() is not None:
            raise AmendmentAlreadyReversedError()
        if await self._year_is_locked(budget.fiscal_year_id, org_id):
            raise ValueError(_LOCKED_YEAR_AMOUNT_MESSAGE)
        new_amount = Decimal(budget.amount_budgeted or 0) - target.amount
        if new_amount < budget.amount_spent + budget.amount_encumbered:
            raise BudgetLimitExceededError()

        reversal = BudgetAmendment(
            organization_id=org_id,
            budget_id=budget.id,
            amount=-target.amount,
            reason=reason,
            approved_by=approved_by,
            approved_on=approved_on,
            created_by=created_by,
            reverses_amendment_id=target.id,
            status=BudgetAmendmentStatus.PENDING,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(reversal)
                await self.db.flush()
        except IntegrityError:
            # Unreachable behind the locks above; the unique key answers if
            # some other writer ever skips them.
            raise AmendmentAlreadyReversedError()
        await self.db.refresh(reversal, ["created_at"])
        logger.info(
            "Budget {} amendment {} reversal {} entered, pending, in org {}",
            budget.id,
            target.id,
            reversal.id,
            org_id,
        )
        return reversal

    async def _pending_amendment(
        self, budget_id: str, amendment_id: str, org_id: str
    ) -> tuple[Budget, BudgetAmendment]:
        """The line and its pending amendment, both row-locked, in that order.

        The order ``add_budget_amendment`` and ``reverse_budget_amendment`` take
        them in, so two decisions on one amendment queue rather than both
        seeing it pending.
        """
        budget = (
            await self.db.execute(
                select(Budget)
                .where(Budget.id == budget_id, Budget.organization_id == org_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not budget:
            raise FinanceEntityNotFoundError("Budget not found")
        amendment = (
            await self.db.execute(
                select(BudgetAmendment)
                .where(
                    BudgetAmendment.id == amendment_id,
                    BudgetAmendment.budget_id == budget.id,
                    BudgetAmendment.organization_id == org_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not amendment:
            raise FinanceEntityNotFoundError("Amendment not found")
        if amendment.status != BudgetAmendmentStatus.PENDING:
            raise AmendmentDecidedError()
        return budget, amendment

    async def confirm_budget_amendment(
        self, budget_id: str, amendment_id: str, org_id: str, confirmed_by: str
    ) -> BudgetAmendment:
        """A second officer confirms a pending amendment, which applies it.

        The confirmer is not the member who entered it (the caller's
        permission -- ``finance.budget_review`` or ``finance.manage`` -- is the
        endpoint's). The checks that matter for money are made again here, on
        the line as it stands now: the year is not locked, the total stays in
        the column's range, and a reversal leaves the line covering what is
        spent and committed and still names a confirmed amendment.
        """
        budget, amendment = await self._pending_amendment(
            budget_id, amendment_id, org_id
        )
        assert_different_person(
            confirmed_by,
            amendment.created_by,
            action="confirm",
            record="budget amendment",
        )
        if await self._year_is_locked(budget.fiscal_year_id, org_id):
            raise ValueError(_LOCKED_YEAR_AMOUNT_MESSAGE)
        new_amount = Decimal(budget.amount_budgeted or 0) + Decimal(amendment.amount)
        if new_amount > _MAX_BUDGET_AMOUNT:
            raise ValueError("That amendment would take the budget past its limit.")
        if amendment.amount < 0 and (
            new_amount < budget.amount_spent + budget.amount_encumbered
        ):
            raise BudgetLimitExceededError()
        budget.amount_budgeted = new_amount
        amendment.status = BudgetAmendmentStatus.CONFIRMED
        amendment.decided_by = confirmed_by
        amendment.decided_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(budget, ["updated_at"])
        logger.info(
            "Budget {} amendment {} confirmed, {} applied, in org {}",
            budget.id,
            amendment.id,
            amendment.amount,
            org_id,
        )
        return amendment

    async def reject_budget_amendment(
        self,
        budget_id: str,
        amendment_id: str,
        org_id: str,
        rejected_by: str,
        *,
        note: str,
    ) -> BudgetAmendment:
        """Reject a pending amendment, or withdraw one's own; nothing moves.

        The note is required: the row stays on record with why it was not
        applied. A rejected reversal gives up its link to the amendment it
        named, so that amendment can be reversed again; the link would
        otherwise hold the unique key, and the audit log keeps which it was.
        """
        note = (note or "").strip()
        if not note:
            raise ValueError("Say why the amendment is rejected.")
        budget, amendment = await self._pending_amendment(
            budget_id, amendment_id, org_id
        )
        amendment.status = BudgetAmendmentStatus.REJECTED
        amendment.decided_by = rejected_by
        amendment.decided_at = datetime.now(timezone.utc)
        amendment.decision_note = note
        amendment.reverses_amendment_id = None
        await self.db.flush()
        logger.info(
            "Budget {} amendment {} rejected in org {}", budget.id, amendment.id, org_id
        )
        return amendment

    async def list_budget_amendments(self, budget_id: str, org_id: str) -> list[dict]:
        """A line's amendments, newest first, with who entered each.

        Raises ``FinanceEntityNotFoundError`` for a line that is not the org's.
        The entering member is joined in-org, so a stray id names nobody. A
        reversed amendment carries its reversal's id, when it was entered and
        by whom, from one more in-org join of the same table.
        """
        if await self.get_budget(budget_id, org_id) is None:
            raise FinanceEntityNotFoundError("Budget not found")
        reversal = aliased(BudgetAmendment)
        reverser = aliased(User)
        decider = aliased(User)
        result = await self.db.execute(
            select(
                BudgetAmendment,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                decider.first_name.label("decider_first_name"),
                decider.last_name.label("decider_last_name"),
                decider.preferred_name.label("decider_preferred_name"),
                decider.username.label("decider_username"),
                reversal.id.label("reversal_id"),
                reversal.created_at.label("reversal_created_at"),
                reversal.status.label("reversal_status"),
                reverser.first_name.label("reverser_first_name"),
                reverser.last_name.label("reverser_last_name"),
                reverser.preferred_name.label("reverser_preferred_name"),
                reverser.username.label("reverser_username"),
            )
            .outerjoin(
                User,
                and_(
                    User.id == BudgetAmendment.created_by,
                    User.organization_id == org_id,
                ),
            )
            .outerjoin(
                decider,
                and_(
                    decider.id == BudgetAmendment.decided_by,
                    decider.organization_id == org_id,
                ),
            )
            .outerjoin(
                reversal,
                and_(
                    reversal.reverses_amendment_id == BudgetAmendment.id,
                    reversal.organization_id == org_id,
                ),
            )
            .outerjoin(
                reverser,
                and_(
                    reverser.id == reversal.created_by,
                    reverser.organization_id == org_id,
                ),
            )
            .where(
                BudgetAmendment.budget_id == budget_id,
                BudgetAmendment.organization_id == org_id,
            )
            .order_by(BudgetAmendment.created_at.desc(), BudgetAmendment.id.desc())
        )
        rows = []
        for row in result.all():
            data = self._amendment_row(*row[:5])
            decider_name = format_display_name(
                row.decider_first_name,
                row.decider_last_name,
                row.decider_preferred_name,
            )
            data["decided_by_name"] = decider_name or row.decider_username or None
            if row.reversal_id is not None:
                name = format_display_name(
                    row.reverser_first_name,
                    row.reverser_last_name,
                    row.reverser_preferred_name,
                )
                reversal_status = row.reversal_status
                data.update(
                    reversed_by_amendment_id=row.reversal_id,
                    reversed_at=row.reversal_created_at,
                    reversed_by_name=name or row.reverser_username or None,
                    reversal_status=getattr(reversal_status, "value", reversal_status),
                )
            rows.append(data)
        return rows

    @staticmethod
    def _amendment_row(
        amendment: BudgetAmendment,
        first_name=None,
        last_name=None,
        preferred_name=None,
        username=None,
    ) -> dict:
        data = {
            column.key: getattr(amendment, column.key)
            for column in BudgetAmendment.__table__.columns
        }
        name = format_display_name(first_name, last_name, preferred_name)
        data["entered_by_name"] = name or username or None
        # A negative amount is a reversal even where a downgrade dropped the
        # link; only the reverse endpoint writes one.
        data["is_reversal"] = (
            amendment.reverses_amendment_id is not None or Decimal(amendment.amount) < 0
        )
        return data

    @classmethod
    def amendment_detail(cls, amendment: BudgetAmendment, user: User) -> dict:
        """A just-created amendment in the list's shape, entered by ``user``."""
        return cls._amendment_row(
            amendment,
            user.first_name,
            user.last_name,
            user.preferred_name,
            user.username,
        )

    async def get_budget_summary(self, org_id: str, fiscal_year_id: str) -> dict:
        result = await self.db.execute(
            select(
                func.coalesce(func.sum(Budget.amount_budgeted), 0).label(
                    "total_budgeted"
                ),
                func.coalesce(func.sum(Budget.amount_spent), 0).label("total_spent"),
                func.coalesce(func.sum(Budget.amount_encumbered), 0).label(
                    "total_encumbered"
                ),
            ).where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == fiscal_year_id,
            )
        )
        row = result.one()
        total_budgeted = row.total_budgeted
        total_spent = row.total_spent
        total_encumbered = row.total_encumbered
        total_remaining = total_budgeted - total_spent - total_encumbered
        percent_used = (total_spent / total_budgeted * 100) if total_budgeted > 0 else 0
        return {
            "total_budgeted": total_budgeted,
            "total_spent": total_spent,
            "total_encumbered": total_encumbered,
            "total_remaining": total_remaining,
            "percent_used": round(float(percent_used), 2),
            "category_breakdown": [],
        }

    async def list_budget_options(
        self,
        org_id: str,
        fiscal_year_id: str,
        charger_id: Optional[str] = None,
        amounts_for: Optional[str] = None,
        sees_all_amounts: bool = True,
    ) -> list[dict]:
        """The budget lines a requester may charge, as a label and what is left.

        The narrow read behind the request forms' budget picker. A member who
        holds only ``finance.request`` chooses a line by name and nothing
        else: the budgeted, spent and encumbered figures, notes and the
        summary stay behind ``finance.view``, and so does the amount left.

        ``amount_remaining`` is filled only for a caller who ``sees_all_amounts``
        (``finance.view`` / ``finance.manage``) or who owns that line
        (``amounts_for`` is the caller's id; ownership is
        ``owned_budgets_query``, the one definition of the rule). For anyone
        else it is None, so the figure never leaves the server.

        ``charger_id`` leaves out the restricted lines that member may not
        charge (app/services/finance_budget_access.py); None, for
        ``finance.manage``, lists every line. The request writes enforce the
        same rule, so a line hidden here is also refused there.

        A line whose category, or any category above it, is inactive is
        listed with ``category_active`` False (``CategoryTree.inactive_source``): the forms offer it only as a request's existing selection, and
        the request writes refuse it as a new charge
        (``_assert_budget_open_for_new_charges``).

        The label is the category's path — ``Quartermaster › Officer brass``
        for a sub-category — plus the station when the line has one. Two lines
        that would still read the same are numbered, so a member never has to
        pick between identical entries.
        """
        tree = await load_category_tree(self.db, org_id)
        held = (
            await held_position_ids(self.db, org_id, charger_id)
            if charger_id
            else set()
        )
        owned_ids: set[str] = set()
        if not sees_all_amounts and amounts_for:
            owned_result = await self.db.execute(
                owned_budgets_query(org_id, amounts_for).with_only_columns(Budget.id)
            )
            owned_ids = {str(budget_id) for budget_id in owned_result.scalars()}
        result = await self.db.execute(
            select(
                Budget.id,
                Budget.category_id,
                Budget.owner_position_id,
                Budget.amount_budgeted,
                Budget.amount_spent,
                Budget.amount_encumbered,
                BudgetCategory.name.label("category_name"),
                Facility.name.label("station_name"),
            )
            .join(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .outerjoin(
                Facility,
                and_(
                    Facility.id == Budget.station_id,
                    Facility.organization_id == org_id,
                ),
            )
            .where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == fiscal_year_id,
            )
            .order_by(BudgetCategory.name, Facility.name, Budget.id)
        )
        rows = [
            row
            for row in result.all()
            if not charger_id
            or tree.rule(str(row.category_id)).allows(held, row.owner_position_id)
        ]
        rows.sort(
            key=lambda row: (
                [part.casefold() for part in tree.path(str(row.category_id))],
                (row.station_name or "").casefold(),
                row.id,
            )
        )
        options = []
        seen: dict[str, int] = {}
        for row in rows:
            label = " › ".join(tree.path(str(row.category_id))) or row.category_name
            if row.station_name:
                label = f"{label} ({row.station_name})"
            seen[label] = seen.get(label, 0) + 1
            if seen[label] > 1:
                label = f"{label} #{seen[label]}"
            options.append(
                {
                    "id": row.id,
                    "label": label,
                    "amount_remaining": (
                        row.amount_budgeted - row.amount_spent - row.amount_encumbered
                        if sees_all_amounts or str(row.id) in owned_ids
                        else None
                    ),
                    "category_active": tree.is_effectively_active(str(row.category_id)),
                }
            )
        return options

    async def list_position_options(self, org_id: str) -> list[dict]:
        """Every position in the org as id + name, for the owner pickers."""
        result = await self.db.execute(
            select(Position.id, Position.name)
            .where(Position.organization_id == org_id)
            .order_by(Position.name, Position.id)
        )
        return [{"id": row.id, "name": row.name} for row in result.all()]

    async def list_station_options(self, org_id: str) -> list[dict]:
        """The org's facilities that are not archived, as id + name.

        The name is the one ``list_budget_options`` puts in a line's label.
        """
        result = await self.db.execute(
            select(Facility.id, Facility.name)
            .where(
                Facility.organization_id == org_id,
                Facility.is_archived.is_(False),
            )
            .order_by(Facility.name, Facility.id)
        )
        return [{"id": row.id, "name": row.name} for row in result.all()]

    async def list_fiscal_year_options(self, org_id: str) -> list[FiscalYear]:
        """Fiscal years a request can still be raised against: active and draft.

        Closed years are left out — nothing new should be charged to them —
        and so is every field the settings page shows but a requester has no
        use for.
        """
        result = await self.db.execute(
            select(FiscalYear)
            .where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status.in_(
                    [FiscalYearStatus.ACTIVE, FiscalYearStatus.DRAFT]
                ),
            )
            .order_by(FiscalYear.start_date.desc(), FiscalYear.id)
        )
        return list(result.scalars().all())

    # ========================================
    # Approval Chains
    # ========================================

    async def list_approval_chains(
        self, org_id: str, pagination: PaginationParams
    ) -> list[ApprovalChain]:
        result = await self.db.execute(
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(ApprovalChain.organization_id == org_id)
            .order_by(ApprovalChain.name, ApprovalChain.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().unique().all())

    async def get_approval_chain(
        self, chain_id: str, org_id: str
    ) -> Optional[ApprovalChain]:
        result = await self.db.execute(
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(
                ApprovalChain.id == chain_id,
                ApprovalChain.organization_id == org_id,
            )
        )
        approval_chain: Optional[ApprovalChain] = result.scalar_one_or_none()
        return approval_chain

    async def create_approval_chain(
        self, org_id: str, created_by: str, steps: Optional[list] = None, **kwargs
    ) -> ApprovalChain:
        await self._validate_approval_chain_fks(org_id, kwargs)
        # Every nested step is validated before the chain row exists, so one
        # bad approver cannot leave a half-built chain behind in the session.
        for index, step_data in enumerate(steps or [], start=1):
            await self._validate_chain_step_fks(org_id, step_data)
            await self._validate_step_approver(
                org_id, step_data, label=f"Step {index}: "
            )
        chain = ApprovalChain(organization_id=org_id, created_by=created_by, **kwargs)
        self.db.add(chain)
        await self.db.flush()

        if steps:
            for step_data in steps:
                step = ApprovalChainStep(chain_id=chain.id, **step_data)
                self.db.add(step)
            await self.db.flush()

        await self.db.refresh(chain, ["created_at", "updated_at"])
        # Reload with steps
        created = await self.get_approval_chain(chain.id, org_id)
        if created is None:
            raise RuntimeError("Approval chain not found after it was created")
        return created

    async def update_approval_chain(
        self, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChain:
        await self._validate_approval_chain_fks(org_id, kwargs)
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        # A change to only one end is checked against the other end as stored.
        new_min = kwargs["min_amount"] if "min_amount" in kwargs else chain.min_amount
        new_max = kwargs["max_amount"] if "max_amount" in kwargs else chain.max_amount
        if new_min is not None and new_max is not None and new_min > new_max:
            raise ValueError("The minimum amount cannot be above the maximum amount")
        apply_updates(chain, kwargs)
        await self.db.flush()
        await self.db.refresh(chain, ["updated_at"])
        return chain

    async def _validate_approval_chain_fks(self, org_id: str, data: dict) -> None:
        """Reject a client-supplied ``budget_category_id`` outside the org.

        ``ondelete="SET NULL"`` (Pitfall 14c) — see ``_validate_finance_fks``.
        """
        budget_category_id = data.get("budget_category_id")
        if budget_category_id:
            await assert_in_org(
                self.db,
                BudgetCategory,
                budget_category_id,
                org_id,
                label="Budget category",
            )

    async def _validate_chain_step_fks(self, org_id: str, data: dict) -> None:
        """Reject a client-supplied ``email_template_id`` outside the org.

        ``ondelete="SET NULL"`` (Pitfall 14c) — see ``_validate_finance_fks``.
        """
        email_template_id = data.get("email_template_id")
        if email_template_id:
            await assert_in_org(
                self.db,
                EmailTemplate,
                email_template_id,
                org_id,
                label="Email template",
            )

    async def _validate_step_approver(
        self,
        org_id: str,
        data: dict,
        existing: Optional[ApprovalChainStep] = None,
        label: str = "",
    ) -> None:
        """Refuse an approval step whose named approver cannot be resolved.

        Enforcement made a step's ``approver_value`` load-bearing: a typo in a
        position slug is no longer cosmetic, it is a step nobody can approve.
        So the pair is checked where it is written. On update, only a write
        that touches the approver (or turns the step into an approval step) is
        checked — renaming a step that was already broken before this rule
        existed stays possible, and the coverage report is where that step
        shows up. Normalizes ``approver_value`` in ``data`` (trimmed).
        """
        # The schemas hand over plain strings; store the enum, so a step read
        # back from the identity map in the same session looks like one read
        # from the database (``_advance_reachable_steps`` reads ``.value``).
        if "approver_type" in data:
            data["approver_type"] = normalize_approver_type(data["approver_type"])
        touched = {"approver_type", "approver_value", "step_type"} & set(data)
        if existing is not None and not touched:
            return

        def current(field, default=None):
            if field in data:
                return data[field]
            return getattr(existing, field) if existing is not None else default

        step_type = current("step_type", ApprovalStepType.APPROVAL)
        step_type_value = getattr(step_type, "value", step_type)
        if step_type_value == ApprovalStepType.NOTIFICATION.value:
            return
        approver_type = normalize_approver_type(current("approver_type"))
        if approver_type is None:
            return

        value = (current("approver_value") or "").strip()
        if "approver_value" in data:
            data["approver_value"] = value or None
        noun = {
            ApproverType.POSITION: "a position",
            ApproverType.PERMISSION: "a permission",
            ApproverType.SPECIFIC_USER: "a member",
            ApproverType.EMAIL: "an email address",
        }[approver_type]
        if not value:
            raise ValueError(
                f"{label}Approver value is required: choose {noun} for this "
                "approval step."
            )

        if approver_type == ApproverType.POSITION:
            if await ApproverDirectory(self.db, org_id).position(value) is None:
                raise ValueError(
                    f"{label}Approver value: no position '{value}' exists in "
                    "this department."
                )
        elif approver_type == ApproverType.SPECIFIC_USER:
            user = await ApproverDirectory(self.db, org_id).user(value)
            if user is None or not user.is_active:
                raise ValueError(
                    f"{label}Approver value: that member is not an active "
                    "member of this department."
                )
        elif approver_type == ApproverType.PERMISSION:
            if not is_known_permission(value):
                raise ValueError(
                    f"{label}Approver value: '{value}' is not a known "
                    "permission. Name a single permission such as "
                    "finance.approve."
                )
        elif approver_type == ApproverType.EMAIL:
            if not is_valid_single_email(value):
                raise ValueError(
                    f"{label}Approver value: '{value}' is not a single valid "
                    "email address."
                )

    async def _requests_routed_through(
        self, chain_id: str, step_id: Optional[str] = None
    ) -> int:
        """How many requests hold approval records on this chain (or step).

        ``ApprovalStepRecord`` carries no ``organization_id``; callers resolve
        the chain through the org-scoped ``get_approval_chain`` first and this
        constrains the records by that chain (Pitfall 14, parent resolution).
        """
        query = select(func.count(func.distinct(ApprovalStepRecord.entity_id))).where(
            ApprovalStepRecord.chain_id == chain_id
        )
        if step_id is not None:
            query = query.where(ApprovalStepRecord.step_id == step_id)
        return int((await self.db.execute(query)).scalar_one())

    async def delete_approval_chain(self, chain_id: str, org_id: str) -> str:
        """Delete a chain no request has used; returns its name for the audit."""
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        # A request's approval history (who approved or denied each step, and
        # their notes) lives in ApprovalStepRecord rows that cascade with the
        # chain, so deleting a chain any request has used would erase that
        # history. Turning the chain off keeps it and stops new routing.
        used_by = await self._requests_routed_through(chain_id)
        if used_by:
            noun = "request has" if used_by == 1 else "requests have"
            raise ValueError(
                f"This approval chain can't be deleted: {used_by} {noun} been "
                "routed through it, and deleting it would erase their approval "
                "history. Turn the chain off instead (edit it and clear "
                "Active) so nothing new is routed through it."
            )
        name = chain.name
        await self.db.delete(chain)
        await self.db.flush()
        return name

    async def add_chain_step(
        self, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChainStep:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        await self._validate_chain_step_fks(org_id, kwargs)
        await self._validate_step_approver(org_id, kwargs)
        step = ApprovalChainStep(chain_id=chain_id, **kwargs)
        self.db.add(step)
        await self.db.flush()
        await self.db.refresh(step, ["created_at"])
        return step

    async def update_chain_step(
        self, step_id: str, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChainStep:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        await self._validate_chain_step_fks(org_id, kwargs)
        result = await self.db.execute(
            select(ApprovalChainStep).where(
                ApprovalChainStep.id == step_id,
                ApprovalChainStep.chain_id == chain_id,
            )
        )
        step: ApprovalChainStep | None = result.scalar_one_or_none()
        if not step:
            raise ValueError("Approval chain step not found")
        await self._validate_step_approver(org_id, kwargs, existing=step)
        apply_updates(step, kwargs)
        await self.db.flush()
        return step

    async def delete_chain_step(self, step_id: str, chain_id: str, org_id: str) -> str:
        """Delete a step no request has used; returns its name for the audit."""
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        result = await self.db.execute(
            select(ApprovalChainStep).where(
                ApprovalChainStep.id == step_id,
                ApprovalChainStep.chain_id == chain_id,
            )
        )
        step = result.scalar_one_or_none()
        if not step:
            raise ValueError("Approval chain step not found")
        # Same reason as delete_approval_chain: the step's records cascade
        # with it, and nothing re-evaluates a request left waiting on it.
        used_by = await self._requests_routed_through(chain_id, step_id)
        if used_by:
            noun = "request has" if used_by == 1 else "requests have"
            raise ValueError(
                f"This step can't be deleted: {used_by} {noun} been routed "
                "through it, and deleting it would erase who approved or "
                "denied it. To change who approves future requests, edit the "
                "step, or set up a new chain and turn this one off."
            )
        name = step.name
        await self.db.delete(step)
        await self.db.flush()
        return name

    async def resolve_approval_chain(
        self,
        org_id: str,
        entity_type: ApprovalEntityType,
        amount: Decimal,
        budget_category_id: Optional[str] = None,
    ) -> Optional[ApprovalChain]:
        """Find the most specific matching approval chain.

        Only chains configured for ``entity_type`` are candidates. A purchase
        request chain names the approvers for buying something; it is not a
        fallback for an expense report or a check request, and borrowing it
        sent reimbursements and payouts to approvers nobody had assigned to
        them. With no chain for the type, this returns None and the caller
        leaves the request to be decided by hand.
        """
        query = (
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(
                ApprovalChain.organization_id == org_id,
                ApprovalChain.is_active.is_(True),
                ApprovalChain.applies_to == entity_type,
            )
        )
        result = await self.db.execute(query)
        chains = list(result.scalars().unique().all())

        if not chains:
            return None

        return pick_approval_chain(chains, amount, budget_category_id)

    async def create_approval_records(
        self,
        chain: ApprovalChain,
        entity_type: ApprovalEntityType,
        entity_id: str,
        amount: Decimal,
        requester_id: str,
    ) -> list[ApprovalStepRecord]:
        """Create step records for an entity going through an approval chain"""
        records = []
        for step in chain.steps:
            status = ApprovalStepStatus.PENDING

            # Auto-approve if amount is under threshold
            if (
                step.step_type == ApprovalStepType.APPROVAL
                and step.auto_approve_under is not None
                and amount < step.auto_approve_under
            ):
                status = ApprovalStepStatus.AUTO_APPROVED

            # Notification steps are auto-sent (will be processed later)
            if step.step_type == ApprovalStepType.NOTIFICATION:
                status = ApprovalStepStatus.PENDING  # Will be sent when reached

            record = ApprovalStepRecord(
                chain_id=chain.id,
                step_id=step.id,
                entity_type=entity_type,
                entity_id=entity_id,
                status=status,
            )

            # EMAIL-approver tokens are NOT generated here -- see
            # _advance_reachable_steps. Issuing every step's token at once
            # started every step's 7-day expiry at chain creation, so a step
            # whose predecessors took a week or more to resolve could expire
            # before it ever became actionable, with no resend path.

            self.db.add(record)
            records.append(record)

        await self.db.flush()

        # Send the invite (and start the expiry clock) for whichever steps
        # are reachable right now -- a chain can start with a NOTIFICATION
        # step, or an EMAIL approval step following only auto-approved
        # steps, so this is not always just "step 1".
        await self._advance_reachable_steps(
            entity_type, entity_id, chain.organization_id
        )

        return records

    async def approval_subject(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> Optional[dict]:
        """The title, amount and requester an external approver is shown.

        Owner decision 2026-11-01: the emailed approval page and the email
        carry these three and nothing else -- the description, vendor and
        line items stay behind the login, because the link is a bearer token
        and may be forwarded. Check requests are titled as the approvals queue
        titles them ("Check to <payee>"). None for a request no longer in
        ``org_id``.
        """
        mappings: dict[ApprovalEntityType, tuple[_FinanceDocument, Any, Any, Any]] = {
            ApprovalEntityType.PURCHASE_REQUEST: (
                PurchaseRequest,
                PurchaseRequest.title,
                PurchaseRequest.estimated_amount,
                PurchaseRequest.requested_by,
            ),
            ApprovalEntityType.EXPENSE_REPORT: (
                ExpenseReport,
                ExpenseReport.title,
                ExpenseReport.total_amount,
                ExpenseReport.submitted_by,
            ),
            ApprovalEntityType.CHECK_REQUEST: (
                CheckRequest,
                literal("Check to ") + CheckRequest.payee_name,
                CheckRequest.amount,
                CheckRequest.requested_by,
            ),
        }
        mapping = mappings.get(entity_type)
        if mapping is None:
            return None
        model, title_col, amount_col, requester_col = mapping
        result = await self.db.execute(
            select(
                title_col.label("title"),
                amount_col.label("amount"),
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
            )
            .select_from(model)
            .outerjoin(
                User,
                and_(
                    User.id == requester_col,
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                ),
            )
            .where(model.id == entity_id, model.organization_id == org_id)
        )
        row = result.first()
        if row is None:
            return None
        requester_name = (
            format_display_name(row.first_name, row.last_name, row.preferred_name)
            or row.username
            or None
        )
        return {
            "title": row.title,
            "amount": row.amount,
            "requester_name": requester_name,
        }

    @staticmethod
    def _mint_approval_link(record: ApprovalStepRecord) -> None:
        """Give an EMAIL step a fresh link, which also kills any earlier one.

        The token column is unique and is what the public routes look a step
        up by, so overwriting it is the invalidation: the old link answers
        "not found" from this point on.
        """
        record.approval_token = secrets.token_urlsafe(32)
        record.token_expires_at = datetime.now(timezone.utc) + APPROVAL_LINK_TTL
        record.email_link_version = (record.email_link_version or 0) + 1

    async def send_approval_request_email(
        self, record: ApprovalStepRecord, step: ApprovalChainStep, org_id: str
    ) -> bool:
        """Email an external ("email" approver-type) approver a token link.

        The link points at the frontend approval page, which reads the token and
        calls the public approve/deny endpoints. Best-effort: returns False and
        logs on any problem rather than raising into the caller's transaction.
        Sends nothing when email delivery is disabled platform-wide.

        The outcome is recorded on the record (``email_status`` /
        ``email_status_at``) so the approvals queue can say a link never went
        out instead of reading "waiting on <address>" either way. A step with
        no link has nothing to send and records nothing.
        """
        token = record.approval_token
        if not token:
            return False
        approver_email = (step.approver_value or "").strip()
        sent = False
        if approver_email:
            sent = await self._deliver_approval_email(
                record, step, org_id, approver_email, token
            )
        record.email_status = (
            ApprovalEmailStatus.SENT if sent else ApprovalEmailStatus.FAILED
        ).value
        record.email_status_at = datetime.now(timezone.utc)
        return sent

    async def _deliver_approval_email(
        self,
        record: ApprovalStepRecord,
        step: ApprovalChainStep,
        org_id: str,
        approver_email: str,
        token: str,
    ) -> bool:
        link = f"{settings.FRONTEND_URL.rstrip('/')}/finance/approvals/{token}"
        try:
            from app.services.email_service import EmailService, wrap_email_body
            from app.services.email_theme import ACCENT_AMBER, action

            subject = await self.approval_subject(
                record.entity_type, record.entity_id, org_id
            )
            # Every interpolated value is escaped: the title and the
            # requester's name are typed by members, and this HTML goes to
            # someone outside the department.
            details = ""
            if subject is not None:
                details += (
                    "<p><strong>Request:</strong> "
                    f"{html.escape(str(subject['title'] or ''))}</p>"
                )
                if subject["amount"] is not None:
                    amount = html.escape(f"${Decimal(subject['amount']):,.2f}")
                    details += f"<p><strong>Amount:</strong> {amount}</p>"
                if subject["requester_name"]:
                    details += (
                        "<p><strong>Requested by:</strong> "
                        f"{html.escape(subject['requester_name'])}</p>"
                    )
            details += (
                f"<p><strong>Step:</strong> {html.escape(step.name or 'Approval')}</p>"
            )

            # No organization: this goes to someone outside the department,
            # and the send itself is made without one (see below).
            html_body = wrap_email_body(
                None,
                "Approval requested",
                "<p>An approval is awaiting your response in The Logbook.</p>"
                + details
                + action(html.escape(link), "Review and respond")
                + '<p class="fineprint">This link expires in 7 days and can be used once.</p>',
                header_color=ACCENT_AMBER,
                chip="Approval needed",
            )

            sent, _failed = await EmailService().send_email(
                to_emails=[approver_email],
                subject="Approval requested — The Logbook",
                html_body=html_body,
                template_type="finance_approval_request",
            )
            return sent > 0
        except Exception as exc:
            logger.warning(
                "Approval request email for step record {} failed: {}",
                record.id,
                exc,
            )
            return False

    async def resend_approval_email(
        self, step_record_id: str, org_id: str, link_version: int
    ) -> tuple[ApprovalStepRecord, bool]:
        """Mint a fresh link for an EMAIL step, kill the old one, and email it.

        Returns the record and whether anything was sent. ``link_version`` is
        the ``email_link_version`` the caller saw: when the row has moved past
        it, another re-send (a double click, a retried request) already
        replaced the link, and this one sends nothing rather than minting a
        third link and killing the second (CLAUDE.md pitfall #36). The row
        lock serializes two requests racing on the same version.

        Order: the link is minted, emailed, and committed by the caller in one
        transaction. A crash after the send but before the commit leaves the
        approver a dead link and the queue showing the old status, which a
        second re-send repairs; the alternative order (commit, then send) can
        leave a "sent" status for an email that never went out.
        """
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .options(selectinload(ApprovalStepRecord.step))
            .where(
                ApprovalStepRecord.id == step_record_id,
                ApprovalChain.organization_id == org_id,
            )
            .with_for_update()
        )
        record: ApprovalStepRecord | None = result.scalar_one_or_none()
        if record is None:
            raise FinanceEntityNotFoundError("Approval step not found")
        step = record.step
        if (
            step is None
            or step.step_type != ApprovalStepType.APPROVAL
            or normalize_approver_type(step.approver_type) != ApproverType.EMAIL
        ):
            raise ValueError("This step does not email its approver")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step is no longer waiting on an approver")
        await self._ensure_current_step(record, org_id)

        if (record.email_link_version or 0) != link_version:
            return record, False

        self._mint_approval_link(record)
        await self.db.flush()
        await self.send_approval_request_email(record, step, org_id)
        await self.db.flush()
        return record, True

    async def get_approval_records(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> list[ApprovalStepRecord]:
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .options(selectinload(ApprovalStepRecord.step))
            .join(
                ApprovalChainStep,
                ApprovalChainStep.id == ApprovalStepRecord.step_id,
            )
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .where(
                ApprovalStepRecord.entity_type == entity_type,
                ApprovalStepRecord.entity_id == entity_id,
                ApprovalChain.organization_id == org_id,
            )
            # Chain position, not created_at alone: records for one entity are
            # created in the same instant, so DATETIME ties are common, and
            # step_order itself isn't unique (no DB/schema constraint stops
            # two steps sharing one order). The id tiebreaker matches
            # get_pending_approvals' has_earlier_pending_step subquery, which
            # a caller may already be reading to decide what's actionable --
            # a different tiebreak here would let this method reject exactly
            # the step that query presented as current.
            .order_by(
                ApprovalChainStep.step_order,
                ApprovalStepRecord.created_at,
                ApprovalStepRecord.id,
            )
        )
        return list(result.scalars().all())

    async def get_current_pending_step(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> Optional[ApprovalStepRecord]:
        """Get the first non-completed step for an entity"""
        records = await self.get_approval_records(entity_type, entity_id, org_id)
        for record in records:
            if record.status == ApprovalStepStatus.PENDING:
                return record
        return None

    async def _ensure_current_step(
        self, record: ApprovalStepRecord, org_id: str
    ) -> None:
        """Reject acting on a step out of chain order.

        Every step is created PENDING up front (create_approval_records), and
        an EMAIL-type step's token is emailed immediately regardless of its
        position -- so without this, a later-step approver (or anyone who
        knows/is emailed a later record's id/token) can approve or deny
        before an earlier step has been acted on. Denying finalizes the
        whole entity immediately, so an out-of-order deny doesn't just
        skip ahead -- it kills the request while earlier reviewers never
        weighed in, defeating the point of a multi-step chain. Called with
        `record` already status==PENDING and already locked by the caller.
        """
        # A denial is terminal for the whole entity, and this is the guard that
        # makes that true for the chains already in a department's database.
        # ``_terminate_pending_steps`` closes the rest of a chain from the
        # moment it shipped, but an installation can already hold a DENIED step
        # followed by PENDING ones — and approving the last of those made
        # ``_check_all_steps_complete()`` true, reversing the denial and
        # encumbering budget against a request the department refused.
        # Enforced here as well as backfilled (20260901_1300_d5e1f6a8b037) so
        # it holds whether or not that migration has run.
        if await self._chain_is_denied(record, org_id):
            raise ValueError("This request has already been denied")
        await self._lock_entity_awaiting_approval(
            record.entity_type, record.entity_id, org_id
        )

        current = await self.get_current_pending_step(
            record.entity_type, record.entity_id, org_id
        )
        if current is None or current.id != record.id:
            raise ValueError("An earlier approval step is still pending")

    async def _chain_is_denied(self, record: ApprovalStepRecord, org_id: str) -> bool:
        """Whether any step on this entity has already denied it."""
        result = await self.db.execute(
            select(ApprovalStepRecord.id)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .where(
                ApprovalStepRecord.entity_type == record.entity_type,
                ApprovalStepRecord.entity_id == record.entity_id,
                ApprovalStepRecord.status == ApprovalStepStatus.DENIED,
                ApprovalChain.organization_id == org_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def _lock_entity_awaiting_approval(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> None:
        """Lock the request a step belongs to and refuse unless it still waits.

        A step record's own PENDING status is not enough: a request cancelled
        before cancellation closed its chain still carries PENDING records, and
        approving the last of them finalized a cancelled request as APPROVED
        and encumbered budget against it. The entity row is locked because
        ``cancel_purchase_request`` writes the same status under the same lock;
        without it an approval read before the cancel commits would finalize
        over it.
        """
        model, pending_status, label = self._unrouted_mapping(entity_type)
        result = await self.db.execute(
            select(model)
            .where(model.id == entity_id, model.organization_id == org_id)
            .with_for_update()
        )
        entity = result.scalar_one_or_none()
        # A record whose entity row is gone has nothing left to approve or
        # encumber; _finalize_approval already treats it as a no-op.
        if entity is not None and entity.status != pending_status:
            raise ValueError(f"This {label.lower()} is no longer awaiting approval")

    async def _terminate_entity_pending_steps(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
        *,
        keep_record_id: Optional[str] = None,
    ) -> int:
        """Skip every PENDING step on an entity and revoke its email tokens."""
        records = await self.get_approval_records(entity_type, entity_id, org_id)
        terminated = 0
        for other in records:
            if other.id == keep_record_id:
                continue
            if other.status != ApprovalStepStatus.PENDING:
                continue
            other.status = ApprovalStepStatus.SKIPPED
            other.approval_token = None
            other.token_expires_at = None
            terminated += 1
        return terminated

    async def _terminate_pending_steps(
        self, record: ApprovalStepRecord, org_id: str
    ) -> int:
        """Close the rest of the chain once one step denies the entity.

        A denial finalizes the whole entity, so no later step is actionable —
        but leaving those records PENDING meant the opposite in practice. The
        next PENDING record became the "current" step, so the denied request
        was still listed as awaiting approval, and approving the remaining
        steps walked it to APPROVED and encumbered budget against it.

        Tokens are cleared alongside: an email approver holding a live link for
        a later step must not be able to act on a request the department has
        already refused.
        """
        return await self._terminate_entity_pending_steps(
            record.entity_type, record.entity_id, org_id, keep_record_id=record.id
        )

    async def _authorize_step_actor(
        self,
        record: ApprovalStepRecord,
        actor: User,
        override_reason: Optional[str],
        org_id: str,
    ) -> ApproverDecision:
        """The named-approver check, run on the locked, current record.

        ``require_permission("finance.approve")`` on the endpoint only says the
        caller may approve *something*; this says they may approve *this* step
        — or are an approvals admin overriding it with a stated reason.
        Raises ``ApproverMismatchError`` before anything is written.
        """
        if record.step is None:
            raise ValueError("Approval chain step not found")
        decision = await authorize_step_actor(
            self.db, actor, record.step, org_id, override_reason
        )
        self.last_approver_decision = decision
        return decision

    async def approve_step(
        self,
        step_record_id: str,
        approver: User,
        notes: Optional[str] = None,
        *,
        org_id: str,
        override_reason: Optional[str] = None,
        acknowledge_late: bool = False,
    ) -> ApprovalStepRecord:
        # Scope the lookup to the caller's org via the owning chain. The endpoint
        # only proves the caller holds finance.approve in their OWN org, so
        # without this join a user could approve an approval step belonging to
        # another organization's purchase request (cross-tenant IDOR).
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .options(selectinload(ApprovalStepRecord.step))
            .where(
                ApprovalStepRecord.id == step_record_id,
                ApprovalChain.organization_id == org_id,
            )
            .with_for_update()
        )
        record: ApprovalStepRecord | None = result.scalar_one_or_none()
        if not record:
            raise ValueError("Approval step record not found")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step is not pending approval")
        await self._ensure_current_step(record, org_id)
        await self._authorize_step_actor(record, approver, override_reason, org_id)
        approver_id = str(approver.id)

        # SEC (FIN-4): holding finance.approve says nothing about *whose*
        # request this is. Without this, a treasurer could raise a check
        # request and walk it through its own approval chain — the one control
        # every set of department bylaws puts on disbursements. Denial is left
        # unguarded: withdrawing your own request is not a conflict. An
        # approvals-admin override does not lift this: the override answers
        # "who is named on the step", never "may you sign your own request".
        assert_different_person(
            approver_id,
            await self._entity_creator_id(record.entity_type, record.entity_id, org_id),
            action="approve",
            record=record.entity_type.value.replace("_", " "),
        )

        await self._take_late_acknowledgement(
            record.entity_type, record.entity_id, org_id, approver_id, acknowledge_late
        )

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.APPROVED
        record.acted_by = approver_id
        record.acted_at = now
        record.notes = notes

        await self.db.flush()

        # Process next steps (advance whatever just became reachable)
        await self._advance_reachable_steps(
            record.entity_type, record.entity_id, org_id
        )

        # Check if all steps are complete
        all_complete = await self._check_all_steps_complete(
            record.entity_type, record.entity_id, org_id
        )
        if all_complete:
            await self._finalize_approval(
                record.entity_type, record.entity_id, approver_id, org_id
            )

        logger.info("Approval step {} approved by {}", step_record_id, approver_id)
        return record

    async def deny_step(
        self,
        step_record_id: str,
        denier: User,
        notes: Optional[str] = None,
        *,
        org_id: str,
        override_reason: Optional[str] = None,
    ) -> ApprovalStepRecord:
        # Org-scoped via the owning chain — see approve_step for the IDOR this
        # join closes.
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .options(selectinload(ApprovalStepRecord.step))
            .where(
                ApprovalStepRecord.id == step_record_id,
                ApprovalChain.organization_id == org_id,
            )
            .with_for_update()
        )
        record: ApprovalStepRecord | None = result.scalar_one_or_none()
        if not record:
            raise ValueError("Approval step record not found")
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step is not pending approval")
        await self._ensure_current_step(record, org_id)
        await self._authorize_step_actor(record, denier, override_reason, org_id)
        denier_id = str(denier.id)

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.DENIED
        record.acted_by = denier_id
        record.acted_at = now
        record.notes = notes

        # Terminate the rest of the chain first: _finalize_denial only writes
        # the entity's own status and never touches the step records.
        await self._terminate_pending_steps(record, org_id)

        # Deny the entire entity
        await self._finalize_denial(
            record.entity_type, record.entity_id, denier_id, notes, org_id
        )

        await self.db.flush()
        logger.info("Approval step {} denied by {}", step_record_id, denier_id)
        return record

    @staticmethod
    def _ensure_token_step_is_email(record: ApprovalStepRecord) -> None:
        """A token authorizes only a step that is still an EMAIL approval step.

        The token is minted when an email step becomes reachable and lives for
        7 days. If an admin reassigns the step to a position or a member in the
        meantime, the emailed address is no longer the approver — the step's
        CURRENT definition decides, not the one in force when the link went out.
        """
        step = record.step
        if (
            step is None
            or step.step_type != ApprovalStepType.APPROVAL
            or normalize_approver_type(step.approver_type) != ApproverType.EMAIL
        ):
            raise ApprovalTokenNotValidError("Approval not found")

    async def approve_by_token(
        self, token: str, notes: Optional[str] = None, acknowledge_late: bool = False
    ) -> ApprovalStepRecord:
        """Approve a step via email token (for external approvers).

        Does not call assert_different_person() the way approve_step() does
        -- the token path's approver has no Logbook account/id to compare
        against a requester id. But an EMAIL-type approver's identity IS
        knowable by address: if the step's approver_value is itself the
        requester's own email, the requester received this approval token
        and could approve their own request -- exactly the conflict
        allow_self_approval exists to gate (see FINANCE_MODULE.md). Enforced
        here unless the step explicitly opts in.
        """
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .options(
                selectinload(ApprovalStepRecord.step),
                contains_eager(ApprovalStepRecord.chain),
            )
            .where(ApprovalStepRecord.approval_token == token)
            .with_for_update()
        )
        record: ApprovalStepRecord | None = result.scalar_one_or_none()
        if not record:
            raise ValueError("Invalid approval token")
        self._ensure_token_step_is_email(record)
        org_id = record.chain.organization_id
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step has already been acted on")
        if record.token_expires_at and record.token_expires_at < datetime.now(
            timezone.utc
        ):
            raise ValueError("Approval token has expired")
        await self._ensure_current_step(record, org_id)

        step = record.step
        if (
            step is not None
            and step.approver_type == ApproverType.EMAIL
            and not step.allow_self_approval
        ):
            approver_email = (step.approver_value or "").strip().lower()
            requester_email = await self._entity_creator_email(
                record.entity_type, record.entity_id, org_id
            )
            if (
                approver_email
                and requester_email
                and approver_email == requester_email.strip().lower()
            ):
                raise SeparationOfDutiesError(
                    "This request's requester and this step's approver are "
                    "the same person; self-approval is not allowed for this "
                    "step."
                )

        await self._take_late_acknowledgement(
            record.entity_type, record.entity_id, org_id, None, acknowledge_late
        )

        now = datetime.now(timezone.utc)
        record.status = ApprovalStepStatus.APPROVED
        record.acted_at = now
        record.notes = notes
        record.approval_token = None

        await self.db.flush()
        await self._advance_reachable_steps(
            record.entity_type, record.entity_id, org_id
        )
        all_complete = await self._check_all_steps_complete(
            record.entity_type, record.entity_id, org_id
        )
        if all_complete:
            await self._finalize_approval(
                record.entity_type, record.entity_id, None, org_id
            )

        return record

    async def deny_by_token(
        self, token: str, notes: Optional[str] = None
    ) -> ApprovalStepRecord:
        """Deny a step via email token (for external approvers)"""
        result = await self.db.execute(
            select(ApprovalStepRecord)
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .options(
                selectinload(ApprovalStepRecord.step),
                contains_eager(ApprovalStepRecord.chain),
            )
            .where(ApprovalStepRecord.approval_token == token)
            .with_for_update()
        )
        record: ApprovalStepRecord | None = result.scalar_one_or_none()
        if not record:
            raise ValueError("Invalid approval token")
        self._ensure_token_step_is_email(record)
        org_id = record.chain.organization_id
        if record.status != ApprovalStepStatus.PENDING:
            raise ValueError("This step has already been acted on")
        if record.token_expires_at and record.token_expires_at < datetime.now(
            timezone.utc
        ):
            raise ValueError("Approval token has expired")
        await self._ensure_current_step(record, org_id)

        record.status = ApprovalStepStatus.DENIED
        record.acted_at = datetime.now(timezone.utc)
        record.notes = notes
        record.approval_token = None

        await self._terminate_pending_steps(record, org_id)

        await self._finalize_denial(
            record.entity_type, record.entity_id, None, notes, org_id
        )
        await self.db.flush()
        return record

    @staticmethod
    def _has_earlier_pending_step():
        """EXISTS: a PENDING record on the same entity sits ahead of this one.

        Correlated against the unaliased ``ApprovalStepRecord`` /
        ``ApprovalChainStep`` of the enclosing query. Its negation is what
        "the step this request is currently waiting on" means in SQL, and the
        ordering (step_order, created_at, id) matches
        ``get_approval_records`` so the list and the approve guard agree.
        """
        prior_record = aliased(ApprovalStepRecord)
        prior_step = aliased(ApprovalChainStep)
        return exists(
            select(1)
            .select_from(prior_record)
            .join(prior_step, prior_step.id == prior_record.step_id)
            .where(
                prior_record.entity_type == ApprovalStepRecord.entity_type,
                prior_record.entity_id == ApprovalStepRecord.entity_id,
                prior_record.status == ApprovalStepStatus.PENDING,
                or_(
                    prior_step.step_order < ApprovalChainStep.step_order,
                    and_(
                        prior_step.step_order == ApprovalChainStep.step_order,
                        or_(
                            prior_record.created_at < ApprovalStepRecord.created_at,
                            and_(
                                prior_record.created_at
                                == ApprovalStepRecord.created_at,
                                prior_record.id < ApprovalStepRecord.id,
                            ),
                        ),
                    ),
                ),
            )
        )

    async def get_pending_approvals(
        self, user: User, org_id: str, *, skip: int = 0, limit: int = 100
    ) -> list[dict]:
        """The steps requests are currently waiting on that ``user`` can act on.

        One row per request, from one query: organization scope is applied
        inside every arm of the entity union and again to requesters. Each
        row is then matched against ``user`` (finance_approver_matching), with
        lookups cached per distinct approver, so the cost is per *assignee*,
        not per row.

        A named approver sees only their own steps. An approvals admin
        (``finance.configure_approvals``) sees every step, the ones they are
        not named on flagged ``requires_override`` — they can act on those,
        but only by giving a reason.
        """
        admin = is_approvals_admin(user)
        # Each arm keeps only requests still awaiting approval: a request
        # cancelled before cancellation closed its chain still has PENDING
        # step records, and listing them invites an approval that is refused.
        entities = union_all(
            select(
                PurchaseRequest.id.label("entity_id"),
                literal(ApprovalEntityType.PURCHASE_REQUEST.value).label("entity_type"),
                PurchaseRequest.title.label("title"),
                PurchaseRequest.estimated_amount.label("amount"),
                PurchaseRequest.requested_by.label("requester_id"),
                PurchaseRequest.created_at.label("submitted_at"),
                # Whether it charges a restricted fund, so only those are
                # loaded to work out a shortfall.
                PurchaseRequest.fund_campaign_id.is_not(None).label("charges_fund"),
            ).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PENDING_APPROVAL,
            ),
            select(
                ExpenseReport.id,
                literal(ApprovalEntityType.EXPENSE_REPORT.value),
                ExpenseReport.title,
                ExpenseReport.total_amount,
                ExpenseReport.submitted_by,
                ExpenseReport.created_at,
                exists().where(
                    ExpenseLineItem.expense_report_id == ExpenseReport.id,
                    ExpenseLineItem.fund_campaign_id.is_not(None),
                ),
            ).where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PENDING_APPROVAL,
            ),
            select(
                CheckRequest.id,
                literal(ApprovalEntityType.CHECK_REQUEST.value),
                literal("Check to ") + CheckRequest.payee_name,
                CheckRequest.amount,
                CheckRequest.requested_by,
                CheckRequest.created_at,
                CheckRequest.fund_campaign_id.is_not(None),
            ).where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.PENDING_APPROVAL,
            ),
        ).subquery("pending_entities")

        has_earlier_pending_step = self._has_earlier_pending_step()

        query = (
            select(
                ApprovalStepRecord.id.label("step_record_id"),
                ApprovalStepRecord.entity_type,
                entities.c.entity_id,
                entities.c.title,
                entities.c.amount,
                entities.c.submitted_at,
                entities.c.charges_fund,
                ApprovalChainStep.name.label("step_name"),
                ApprovalChainStep.step_order,
                ApprovalChainStep.step_type,
                ApprovalChainStep.approver_type,
                ApprovalChainStep.approver_value,
                # Whether a link exists, never the link: it is a bearer token
                # for someone else's approval, and nothing staff-facing reads it.
                ApprovalStepRecord.approval_token.is_not(None).label("has_link"),
                ApprovalStepRecord.token_expires_at,
                ApprovalStepRecord.email_status,
                ApprovalStepRecord.email_status_at,
                ApprovalStepRecord.email_link_version,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
            )
            .join(
                entities,
                and_(
                    entities.c.entity_id == ApprovalStepRecord.entity_id,
                    entities.c.entity_type == ApprovalStepRecord.entity_type,
                ),
            )
            .join(ApprovalChainStep, ApprovalChainStep.id == ApprovalStepRecord.step_id)
            .outerjoin(
                User,
                and_(
                    User.id == entities.c.requester_id,
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                ),
            )
            .where(
                ApprovalStepRecord.status == ApprovalStepStatus.PENDING,
                ~has_earlier_pending_step,
            )
            .order_by(
                entities.c.submitted_at.desc(),
                entities.c.entity_type,
                entities.c.entity_id,
                ApprovalStepRecord.id,
            )
        )
        # An admin sees every row, so the page can be cut in SQL. Anyone else
        # sees a subset only matching can decide, so the page is cut after
        # matching — an org's pending approvals are a short list.
        if admin:
            query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)

        directory = ApproverDirectory(self.db, org_id)
        verdicts: dict[tuple, tuple[bool, str]] = {}
        approvals = []
        now = datetime.now(timezone.utc)
        for row in result.all():
            approver_type = normalize_approver_type(row.approver_type)
            # Transient and never added to the session: the matchers read only
            # these three fields, so the row stands in for the joined step.
            step = ApprovalChainStep(
                step_type=row.step_type,
                approver_type=approver_type,
                approver_value=row.approver_value,
            )
            key = (row.step_type, approver_type, row.approver_value)
            if key not in verdicts:
                verdicts[key] = (
                    await user_matches_step(self.db, user, step, org_id),
                    await describe_assignee(step, directory),
                )
            can_act, assignee_label = verdicts[key]
            if not can_act and not admin:
                continue
            requester_name = format_display_name(
                row.first_name, row.last_name, row.preferred_name
            )
            requester_name = requester_name or row.username or "Unknown"
            email_delivery = approval_email_delivery(
                step_type=row.step_type,
                approver_type=approver_type,
                has_link=bool(row.has_link),
                expires_at=row.token_expires_at,
                email_status=row.email_status,
                now=now,
            )
            approvals.append(
                {
                    "step_record_id": row.step_record_id,
                    "entity_type": row.entity_type.value,
                    "entity_id": row.entity_id,
                    "entity_title": row.title,
                    # Decimal straight through -- PendingApprovalResponse
                    # types this Decimal; a float round-trip here would be a
                    # needless precision hazard for no benefit.
                    "entity_amount": row.amount,
                    "requester_name": requester_name,
                    "step_name": row.step_name,
                    "step_order": row.step_order,
                    "submitted_at": row.submitted_at,
                    "approver_type": approver_type.value if approver_type else None,
                    "approver_value": row.approver_value,
                    "assignee_label": assignee_label,
                    "can_act": can_act,
                    "requires_override": not can_act,
                    "charges_fund": bool(row.charges_fund),
                    "email_delivery": email_delivery,
                    "email_status_at": row.email_status_at,
                    "email_link_version": row.email_link_version or 0,
                    # Re-sending is the approvals admin's, the same holder who
                    # may already approve over the external approver's head.
                    "can_resend_email": admin and email_delivery is not None,
                }
            )
        if not admin:
            approvals = approvals[skip : skip + limit]
        late = await self._late_line_state(
            [
                a["entity_id"]
                for a in approvals
                if a["entity_type"] == ApprovalEntityType.EXPENSE_REPORT.value
            ]
        )
        over = await self._fund_shortfalls(
            org_id,
            [
                (a["entity_type"], a["entity_id"])
                for a in approvals
                if a.pop("charges_fund")
            ],
        )
        for a in approvals:
            a["late_line_count"] = late.get(a["entity_id"], (0, None))[0]
            a["fund_shortfall"] = over.get(a["entity_id"])
        return approvals

    async def step_actor_flags(
        self, user: User, records: list[ApprovalStepRecord], org_id: str
    ) -> dict[str, dict]:
        """Per record: who it waits on, and whether ``user`` may act on it now.

        For the request detail pages, so they show the same answer approve /
        deny will give rather than re-deriving it. Only the step the request
        is currently waiting on (the first PENDING record, as in
        ``get_current_pending_step``) can be acted on, and only through the
        ``finance.approve``-gated endpoints, so both flags require that too.
        Separation of duties is not folded in: it depends on the request, and
        the approve endpoint still refuses the requester with its own message.
        """
        directory = ApproverDirectory(self.db, org_id)
        current = next(
            (r for r in records if r.status == ApprovalStepStatus.PENDING), None
        )
        may_approve = user_has_permission(user, FINANCE_APPROVE)
        admin = is_approvals_admin(user)
        flags: dict[str, dict] = {}
        for record in records:
            step = record.step
            if step is None:
                continue
            entry = {
                "assignee_label": await describe_assignee(step, directory),
                "can_act": False,
                "requires_override": False,
            }
            if (
                record is current
                and may_approve
                and step.step_type == ApprovalStepType.APPROVAL
            ):
                matched = await user_matches_step(self.db, user, step, org_id)
                entry["can_act"] = matched
                entry["requires_override"] = not matched and admin
            flags[str(record.id)] = entry
        return flags

    async def get_approver_coverage(self, org_id: str) -> list[dict]:
        """Every approval step in the org's chains, and who can act on it.

        Enforcement turned a mistyped slug or a departed member into a step
        nobody can approve — the request just waits. This is how an admin
        finds those steps before a requester does. Eligibility is counted by
        running every active member through ``user_matches_step``, the same
        function that gates approve/deny, so the report cannot disagree with
        the enforcement it describes.
        """
        chains_result = await self.db.execute(
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(ApprovalChain.organization_id == org_id)
            .order_by(ApprovalChain.name, ApprovalChain.id)
            # Steps can be added to a chain already in the identity map; the
            # report must read what is stored, not a stale collection.
            .execution_options(populate_existing=True)
        )
        chains = list(chains_result.scalars().unique().all())

        pending_result = await self.db.execute(
            select(ApprovalStepRecord.step_id, func.count(ApprovalStepRecord.id))
            .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
            .join(ApprovalChainStep, ApprovalChainStep.id == ApprovalStepRecord.step_id)
            .where(
                ApprovalChain.organization_id == org_id,
                ApprovalStepRecord.status == ApprovalStepStatus.PENDING,
                ~self._has_earlier_pending_step(),
            )
            .group_by(ApprovalStepRecord.step_id)
        )
        pending_by_step = {step_id: count for step_id, count in pending_result}

        directory = ApproverDirectory(self.db, org_id)
        members = await directory.active_members()
        rows = []
        for chain in chains:
            for step in sorted(chain.steps, key=lambda s: (s.step_order, s.id)):
                if step.step_type != ApprovalStepType.APPROVAL:
                    continue
                approver_type = normalize_approver_type(step.approver_type)
                value = (step.approver_value or "").strip()
                # Approve and deny need finance.approve as well as a match
                # (step_actor_flags, and the endpoints' gate). Counting the
                # match alone reported a Chief step as covered while the Chief,
                # holding no finance.approve, got 403 on the queue and 404 on
                # the request. An email approver acts from the emailed link, so
                # the grant does not apply to them.
                needs_grant = approver_type != ApproverType.EMAIL
                matched = 0
                eligible = 0
                for member in members:
                    if await user_matches_step(self.db, member, step, org_id):
                        matched += 1
                        if not needs_grant or user_has_permission(
                            member, FINANCE_APPROVE
                        ):
                            eligible += 1
                rows.append(
                    {
                        "chain_id": chain.id,
                        "chain_name": chain.name,
                        "chain_is_active": bool(chain.is_active),
                        "step_id": step.id,
                        "step_name": step.name,
                        "step_order": step.step_order,
                        "approver_type": (
                            approver_type.value if approver_type else None
                        ),
                        "approver_value": step.approver_value,
                        "assignee_label": await describe_assignee(step, directory),
                        "eligible_active_count": eligible,
                        "problem": await self._coverage_problem(
                            approver_type, value, eligible, directory, matched
                        ),
                        "pending_request_count": pending_by_step.get(step.id, 0),
                    }
                )
        return rows

    @staticmethod
    async def _coverage_problem(
        approver_type: Optional[ApproverType],
        value: str,
        eligible: int,
        directory: ApproverDirectory,
        matched: int = 0,
    ) -> Optional[str]:
        if approver_type is None:
            return None if eligible else "no_active_members"
        if not value:
            return "no_value"
        if approver_type == ApproverType.EMAIL:
            # An email approver is usually outside the department and acts
            # from the emailed link, so no matching member is normal.
            return None if is_valid_single_email(value) else "invalid_email"
        if approver_type == ApproverType.POSITION:
            if await directory.position(value) is None:
                return "not_found"
        elif approver_type == ApproverType.SPECIFIC_USER:
            if await directory.user(value) is None:
                return "not_found"
        elif approver_type == ApproverType.PERMISSION:
            if not is_known_permission(value):
                return "not_found"
        if eligible:
            return None
        # Somebody fills the step, but none of them may approve: distinct from
        # an empty position, because the fix is a grant, not a person.
        return "no_approve_permission" if matched else "no_active_members"

    # ========================================
    # Manual approval (no approval chain applies)
    # ========================================

    def _unrouted_mapping(self, entity_type: ApprovalEntityType):
        """(model, pending status, label) for an approvable entity type."""
        mapping = {
            ApprovalEntityType.PURCHASE_REQUEST: (
                PurchaseRequest,
                PurchaseRequestStatus.PENDING_APPROVAL,
                "Purchase request",
            ),
            ApprovalEntityType.EXPENSE_REPORT: (
                ExpenseReport,
                ExpenseReportStatus.PENDING_APPROVAL,
                "Expense report",
            ),
            ApprovalEntityType.CHECK_REQUEST: (
                CheckRequest,
                CheckRequestStatus.PENDING_APPROVAL,
                "Check request",
            ),
        }.get(entity_type)
        if mapping is None:
            raise ValueError(f"Invalid entity type: {entity_type}")
        return mapping

    @staticmethod
    def _has_step_records(entity_type_value, entity_id_column):
        """EXISTS any approval step record for this entity.

        One predicate shared by the unrouted listing and the manual actions, so
        the list can never offer a request the action would then refuse. It is
        deliberately not joined to the chain: every record counts, whatever its
        status, because a request that was routed through a chain is decided by
        that chain — including one it denied — and never by the manual path.
        """
        return exists(
            select(1).where(
                ApprovalStepRecord.entity_type == entity_type_value,
                ApprovalStepRecord.entity_id == entity_id_column,
            )
        )

    @staticmethod
    def _has_pending_step_records(entity_type_value, entity_id_column):
        """EXISTS an approval step still waiting on someone for this entity.

        A request whose chain has run to the end but is still waiting for
        approval is held for a second approver by the dual-approval threshold
        (``_held_for_second_approver``); with nothing left in its chain, the
        manual path is how that approver acts. One predicate shared by the
        listing and the manual actions, for the reason ``_has_step_records``
        gives.
        """
        return exists(
            select(1).where(
                ApprovalStepRecord.entity_type == entity_type_value,
                ApprovalStepRecord.entity_id == entity_id_column,
                ApprovalStepRecord.status == ApprovalStepStatus.PENDING,
            )
        )

    async def _lock_unrouted_entity(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ):
        """Fetch and lock a PENDING_APPROVAL entity that has no approval steps.

        submit_* leaves a request in PENDING_APPROVAL with no step records when
        no chain matches or the matching chain has no steps (and deleting a
        chain or its steps cascades its records away, stranding a request the
        same way). Nothing else can move such a request, so this is the only
        way out of that state.
        """
        model, pending_status, label = self._unrouted_mapping(entity_type)
        # Lock the entity row, as approve_step locks its record: two approvers
        # acting at once would otherwise both pass the status check and the
        # second approval would encumber the budget a second time.
        result = await self.db.execute(
            select(model)
            .where(model.id == entity_id, model.organization_id == org_id)
            .with_for_update()
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            raise FinanceEntityNotFoundError(f"{label} not found")
        if entity.status != pending_status:
            raise ManualApprovalConflictError(
                f"This {label.lower()} is not waiting for approval"
            )
        has_pending_steps = await self.db.execute(
            select(self._has_pending_step_records(entity_type, entity_id))
        )
        if has_pending_steps.scalar():
            raise ManualApprovalConflictError(
                "This request has approval steps; approve it through those steps"
            )
        return entity

    async def manual_approve(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        approver_id: str,
        *,
        org_id: str,
        acknowledge_late: bool = False,
    ):
        """Approve a request that no approval chain applies to.

        Any finance.approve holder may act — the same rule approve_step applies
        to chain steps. Approval notes have no column on the entity (its own
        ``notes`` belong to the requester), so the endpoint records them in the
        audit log instead.
        """
        entity = await self._lock_unrouted_entity(entity_type, entity_id, org_id)
        # Same separation-of-duties control as approve_step (FIN-4): holding
        # finance.approve does not let a treasurer approve their own request.
        assert_different_person(
            approver_id,
            await self._entity_creator_id(entity_type, entity_id, org_id),
            action="approve",
            record=entity_type.value.replace("_", " "),
        )
        # A request held for a second approver cannot be completed by someone
        # who has already approved it, through its chain or here.
        if str(approver_id) in await self._approvers_so_far(
            entity_type, entity, org_id
        ):
            raise SeparationOfDutiesError(
                "You have already approved this request. It needs a second "
                "approval from someone else."
            )
        await self._take_late_acknowledgement(
            entity_type, entity_id, org_id, approver_id, acknowledge_late
        )
        # Shared with the chain path so status, approved_by/approved_at and
        # budget encumbrance are handled identically.
        completed = await self._finalize_approval(
            entity_type, entity_id, approver_id, org_id
        )
        logger.info(
            "{} {} manually {} by {}",
            entity_type.value,
            entity_id,
            "approved" if completed else "given its first approval",
            approver_id,
        )
        return entity

    async def manual_deny(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        denier_id: str,
        reason: str,
        *,
        org_id: str,
    ):
        """Deny a request that no approval chain applies to.

        A reason is required: the step path can carry a denial in the step
        record's notes, but here ``denial_reason`` is the only record the
        requester sees of why. Self-denial is allowed, as in deny_step —
        withdrawing your own request is not a conflict.
        """
        reason = (reason or "").strip()
        if not reason:
            raise ValueError("A reason is required to deny a request")
        entity = await self._lock_unrouted_entity(entity_type, entity_id, org_id)
        await self._finalize_denial(entity_type, entity_id, denier_id, reason, org_id)
        logger.info(
            "{} {} manually denied by {}", entity_type.value, entity_id, denier_id
        )
        return entity

    async def get_unrouted_approvals(
        self, org_id: str, *, skip: int = 0, limit: int = 100
    ) -> list[dict]:
        """Requests waiting for a manual approval decision.

        Those no approval chain applies to, and those held for a second
        approver by the dual-approval threshold — a chain that has run to its
        end, or a first manual approval (``awaiting_second_approval``).

        The same row shape as get_pending_approvals, minus the step fields.
        """
        entities = union_all(
            select(
                PurchaseRequest.id.label("entity_id"),
                literal(ApprovalEntityType.PURCHASE_REQUEST.value).label("entity_type"),
                PurchaseRequest.title.label("title"),
                PurchaseRequest.estimated_amount.label("amount"),
                PurchaseRequest.requested_by.label("requester_id"),
                PurchaseRequest.created_at.label("submitted_at"),
                PurchaseRequest.first_approved_by.label("first_approved_by"),
                self._has_step_records(
                    ApprovalEntityType.PURCHASE_REQUEST, PurchaseRequest.id
                ).label("has_steps"),
            ).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PENDING_APPROVAL,
                ~self._has_pending_step_records(
                    ApprovalEntityType.PURCHASE_REQUEST, PurchaseRequest.id
                ),
            ),
            select(
                ExpenseReport.id,
                literal(ApprovalEntityType.EXPENSE_REPORT.value),
                ExpenseReport.title,
                ExpenseReport.total_amount,
                ExpenseReport.submitted_by,
                ExpenseReport.created_at,
                ExpenseReport.first_approved_by,
                self._has_step_records(
                    ApprovalEntityType.EXPENSE_REPORT, ExpenseReport.id
                ),
            ).where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PENDING_APPROVAL,
                ~self._has_pending_step_records(
                    ApprovalEntityType.EXPENSE_REPORT, ExpenseReport.id
                ),
            ),
            select(
                CheckRequest.id,
                literal(ApprovalEntityType.CHECK_REQUEST.value),
                literal("Check to ") + CheckRequest.payee_name,
                CheckRequest.amount,
                CheckRequest.requested_by,
                CheckRequest.created_at,
                CheckRequest.first_approved_by,
                self._has_step_records(
                    ApprovalEntityType.CHECK_REQUEST, CheckRequest.id
                ),
            ).where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.PENDING_APPROVAL,
                ~self._has_pending_step_records(
                    ApprovalEntityType.CHECK_REQUEST, CheckRequest.id
                ),
            ),
        ).subquery("unrouted_entities")

        result = await self.db.execute(
            select(
                entities.c.entity_type,
                entities.c.entity_id,
                entities.c.title,
                entities.c.amount,
                entities.c.submitted_at,
                entities.c.first_approved_by,
                entities.c.has_steps,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
            )
            .outerjoin(
                User,
                and_(
                    User.id == entities.c.requester_id,
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                ),
            )
            .order_by(
                entities.c.submitted_at.desc(),
                entities.c.entity_type,
                entities.c.entity_id,
            )
            .offset(skip)
            .limit(limit)
        )

        rows = []
        for row in result:
            requester_name = format_display_name(
                row.first_name, row.last_name, row.preferred_name
            )
            requester_name = requester_name or row.username or "Unknown"
            rows.append(
                {
                    "entity_type": row.entity_type,
                    "entity_id": row.entity_id,
                    "entity_title": row.title,
                    "entity_amount": row.amount,
                    "requester_name": requester_name,
                    "submitted_at": row.submitted_at,
                    # Its chain has run, or one approval is already recorded:
                    # what it waits for is a second, different approver.
                    "awaiting_second_approval": bool(row.has_steps)
                    or bool(row.first_approved_by),
                    "first_approved_by": row.first_approved_by,
                }
            )
        late = await self._late_line_state(
            [
                r["entity_id"]
                for r in rows
                if r["entity_type"] == ApprovalEntityType.EXPENSE_REPORT.value
            ]
        )
        over = await self._fund_shortfalls(
            org_id, [(r["entity_type"], r["entity_id"]) for r in rows]
        )
        for r in rows:
            r["fund_shortfall"] = over.get(r["entity_id"])
            count, acknowledged_at = late.get(r["entity_id"], (0, None))
            r["late_line_count"] = count
            r["awaiting_late_acknowledgement"] = count > 0 and acknowledged_at is None
            # The acknowledgement is the first thing a held report waits for.
            if r["awaiting_late_acknowledgement"]:
                r["awaiting_second_approval"] = False
        return rows

    async def preview_approval_chain(
        self,
        org_id: str,
        entity_type: str,
        amount: Decimal,
        category_id: Optional[str] = None,
    ) -> Optional[ApprovalChain]:
        """Preview which chain would be selected for given parameters"""
        try:
            et = ApprovalEntityType(entity_type)
        except ValueError:
            raise ValueError(f"Invalid entity type: {entity_type}")
        return await self.resolve_approval_chain(org_id, et, amount, category_id)

    async def _request_chain(
        self,
        org_id: str,
        entity_type: ApprovalEntityType,
        amount: Decimal,
        budget_id: Optional[str],
    ) -> Optional[ApprovalChain]:
        """The chain a request of this type, amount and budget line goes to.

        Submission and the route preview both ask this, so the preview cannot
        promise a route that submitting would not take (CLAUDE.md pitfall
        #29). A purchase or check request is matched on its budget line's
        category; an expense report on its total alone, since its lines can
        charge several lines.
        """
        category_id = None
        if budget_id and entity_type != ApprovalEntityType.EXPENSE_REPORT:
            budget = await self.get_budget(budget_id, org_id)
            if budget:
                category_id = budget.category_id
        return await self.resolve_approval_chain(
            org_id, entity_type, amount, category_id
        )

    async def preview_request_route(
        self,
        org_id: str,
        entity_type: str,
        amount: Decimal,
        budget_id: Optional[str] = None,
    ) -> dict:
        """Who a request would wait on if submitted now, for the member
        raising it.

        Steps are described as the request's own timeline describes them
        (``describe_assignee``), never by the chain's raw approver values, so
        the member learns nothing a submitted request would not show them.
        A step the amount falls under auto-approves; with no chain, or one
        with no steps, a finance approver decides by hand. Requests at or over
        the dual-approval threshold also need a second, different approver.
        """
        try:
            et = ApprovalEntityType(entity_type)
        except ValueError:
            raise ValueError(f"Invalid entity type: {entity_type}")
        chain = await self._request_chain(org_id, et, amount, budget_id)
        threshold = (
            await load_finance_settings(self.db, org_id)
        ).dual_approval_threshold
        route: dict[str, Any] = {
            "chain_name": None,
            "manual": True,
            "steps": [],
            "second_approver_required": threshold is not None and amount >= threshold,
        }
        if chain is None or not chain.steps:
            return route
        directory = ApproverDirectory(self.db, org_id)
        steps = []
        for step in sorted(chain.steps, key=lambda s: (s.step_order, s.id)):
            approval = step.step_type == ApprovalStepType.APPROVAL
            steps.append(
                {
                    "name": step.name,
                    "step_order": step.step_order,
                    "step_type": step.step_type.value,
                    # A notification step waits on nobody.
                    "assignee_label": (
                        await describe_assignee(step, directory) if approval else None
                    ),
                    "auto_approved": approval
                    and step.auto_approve_under is not None
                    and amount < step.auto_approve_under,
                }
            )
        route.update(chain_name=chain.name, manual=False, steps=steps)
        return route

    async def _advance_reachable_steps(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
    ) -> None:
        """Activate every step whose prior steps are all resolved.

        A NOTIFICATION step is marked SENT once reachable. An EMAIL-type
        APPROVAL step's token/expiry is generated -- and the invite emailed
        -- only once the step is reachable, not at chain creation: issuing
        every step's token up front started every step's 7-day expiry
        immediately, so a step whose predecessors took a week or more to
        resolve could already be expired by the time _ensure_current_step
        would finally let it be acted on, with no resend path. Called after
        creating the chain's records and after any action that could make a
        new step reachable (an approval, never a denial -- denial finalizes
        the whole entity, so there is no "next" step to reach).
        """
        records = await self.get_approval_records(entity_type, entity_id, org_id)

        # A denial anywhere in the chain is terminal for the entity, so nothing
        # downstream is reachable. This paragraph's docstring has always said
        # so, but the reachability test below only rejected a PENDING prior —
        # a DENIED one read as "resolved", which minted a fresh 7-day token and
        # emailed an external approver a live link for a refused request.
        if any(r.status == ApprovalStepStatus.DENIED for r in records):
            return

        for record in records:
            if record.status != ApprovalStepStatus.PENDING:
                continue
            if not record.step:
                continue

            prior_complete = True
            for prior in records:
                if prior.step and prior.step.step_order < record.step.step_order:
                    # Name what counts as satisfied rather than what does not:
                    # the statuses that block are open-ended, the ones that
                    # genuinely resolve a step are these four.
                    if prior.status not in _PRIOR_STEP_SATISFIED:
                        prior_complete = False
                        break
            if not prior_complete:
                continue

            if record.step.step_type == ApprovalStepType.NOTIFICATION:
                record.status = ApprovalStepStatus.SENT
                record.acted_at = datetime.now(timezone.utc)
                # In production, trigger email sending here
                logger.info(
                    "Notification step {} auto-sent for {} {}",
                    record.id,
                    entity_type.value,
                    entity_id,
                )
            elif (
                record.step.step_type == ApprovalStepType.APPROVAL
                and record.step.approver_type
                and record.step.approver_type.value == "email"
                and not record.approval_token
            ):
                self._mint_approval_link(record)
                await self.send_approval_request_email(record, record.step, org_id)

    async def _check_all_steps_complete(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
    ) -> bool:
        records = await self.get_approval_records(entity_type, entity_id, org_id)
        for record in records:
            if record.status == ApprovalStepStatus.PENDING:
                return False
        return True

    async def _entity_creator_id(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> Optional[str]:
        """Who raised the request an approval step belongs to.

        Returns None for an entity that no longer exists; the caller treats a
        missing id as "cannot prove a conflict" rather than blocking.
        """
        # The three models name the requester differently — `requested_by` on
        # purchases and checks, `submitted_by` on expense reports — so the
        # column is part of the mapping, not assumed.
        mappings: dict[ApprovalEntityType, tuple[_FinanceDocument, Any]] = {
            ApprovalEntityType.PURCHASE_REQUEST: (
                PurchaseRequest,
                PurchaseRequest.requested_by,
            ),
            ApprovalEntityType.EXPENSE_REPORT: (
                ExpenseReport,
                ExpenseReport.submitted_by,
            ),
            ApprovalEntityType.CHECK_REQUEST: (
                CheckRequest,
                CheckRequest.requested_by,
            ),
        }
        mapping = mappings.get(entity_type)
        if mapping is None:
            return None

        model, requester_column = mapping
        result = await self.db.execute(
            select(requester_column).where(
                model.id == entity_id, model.organization_id == org_id
            )
        )
        requester_id: Optional[str] = result.scalar_one_or_none()
        return requester_id

    async def _entity_creator_email(
        self, entity_type: ApprovalEntityType, entity_id: str, org_id: str
    ) -> Optional[str]:
        """Email of whoever raised the request, for the token-approval path.

        Only the email is checkable there (no Logbook actor id) — see
        approve_by_token(). Returns None if the requester id can't be
        resolved or that user no longer exists.
        """
        requester_id = await self._entity_creator_id(entity_type, entity_id, org_id)
        if not requester_id:
            return None
        result = await self.db.execute(
            select(User.email).where(User.id == requester_id)
        )
        email: Optional[str] = result.scalar_one_or_none()
        return email

    @staticmethod
    def _approval_amount(entity_type: ApprovalEntityType, entity) -> Decimal:
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            return Decimal(entity.estimated_amount or 0)
        if entity_type == ApprovalEntityType.EXPENSE_REPORT:
            return Decimal(entity.total_amount or 0)
        return Decimal(entity.amount or 0)

    async def _approvers_so_far(
        self, entity_type: ApprovalEntityType, entity, org_id: str
    ) -> set[str]:
        """Everyone who has approved the request, once each.

        A chain step approved in the app counts as the member who approved it;
        one approved from an emailed link (``acted_by`` is empty) as the
        address the step names, a different person from any member. An
        auto-approved step counts as nobody. A first approval given outside
        the chain is on the request.
        """
        people: set[str] = set()
        records = await self.get_approval_records(entity_type, entity.id, org_id)
        for record in records:
            if record.status != ApprovalStepStatus.APPROVED:
                continue
            if record.acted_by:
                people.add(str(record.acted_by))
            elif record.step is not None and record.step.approver_value:
                people.add("email:" + record.step.approver_value.strip().lower())
        if entity.first_approved_by:
            people.add(str(entity.first_approved_by))
        return people

    async def _late_line_state(
        self, er_ids: list[str]
    ) -> dict[str, tuple[int, Optional[datetime]]]:
        """Per expense report: late lines, and when they were acknowledged."""
        if not er_ids:
            return {}
        result = await self.db.execute(
            select(
                ExpenseReport.id,
                func.count(ExpenseLineItem.id),
                ExpenseReport.late_acknowledged_at,
            )
            .join(
                ExpenseLineItem,
                and_(
                    ExpenseLineItem.expense_report_id == ExpenseReport.id,
                    ExpenseLineItem.substantiated_late.is_(True),
                ),
            )
            .where(ExpenseReport.id.in_(er_ids))
            .group_by(ExpenseReport.id, ExpenseReport.late_acknowledged_at)
        )
        return {row[0]: (row[1], row[2]) for row in result.all()}

    def is_awaiting_late_acknowledgement(self, report, records) -> bool:
        """A report held until an approver acknowledges its late lines.

        Waiting for approval, nothing left in its chain, lines submitted after
        the substantiation deadline, and nobody has acknowledged them —
        _finalize_approval's hold, read for the screen (CLAUDE.md pitfall #29).
        """
        if report.status != ExpenseReportStatus.PENDING_APPROVAL.value:
            return False
        if any(r.status == ApprovalStepStatus.PENDING for r in records):
            return False
        return report.late_line_count > 0 and report.late_acknowledged_at is None

    async def late_line_count(self, er_id: str) -> int:
        return (
            await self.db.execute(
                select(func.count())
                .select_from(ExpenseLineItem)
                .where(
                    ExpenseLineItem.expense_report_id == er_id,
                    ExpenseLineItem.substantiated_late.is_(True),
                )
            )
        ).scalar_one()

    async def _take_late_acknowledgement(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
        approver_id: Optional[str],
        acknowledged: bool,
    ) -> None:
        """Require an approver of a report with late lines to confirm them.

        Under the department's "warn" substantiation rule a report with lines
        submitted past the deadline still goes through, but every approval of
        it must say the approver has reviewed them: a late line is reimbursed
        outside the accountable plan, which the department may treat as wages.
        The first confirmation is recorded on the report; an emailed-token
        approval records the time with no user.
        """
        if entity_type != ApprovalEntityType.EXPENSE_REPORT:
            return
        late = await self.late_line_count(entity_id)
        if late == 0:
            return
        if not acknowledged:
            raise LateSubstantiationNotAcknowledgedError(
                f"This report has {late} line{'s' if late != 1 else ''} "
                "submitted after the department's substantiation deadline. "
                "Confirm you have reviewed them to approve it."
            )
        er = (
            await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if er is not None and er.late_acknowledged_at is None:
            er.late_acknowledged_by = approver_id
            er.late_acknowledged_at = datetime.now(timezone.utc)
            await self.db.flush()

    async def _held_for_second_approver(
        self,
        entity_type: ApprovalEntityType,
        entity,
        approver_id: Optional[str],
        org_id: str,
    ) -> bool:
        """Whether this approval leaves the request waiting for another person.

        The department's dual-approval threshold: at or above it, a request is
        approved only once two different people have approved it. This is the
        one place both paths reach — the end of an approval chain and a manual
        approval — so a single-step chain, or one person approving every step,
        cannot complete a request above the threshold either. The first
        approval given outside a chain is recorded on the request.
        """
        threshold = (
            await load_finance_settings(self.db, org_id)
        ).dual_approval_threshold
        if threshold is None or self._approval_amount(entity_type, entity) < threshold:
            return False
        people = await self._approvers_so_far(entity_type, entity, org_id)
        if approver_id:
            people.add(str(approver_id))
        if len(people) >= 2:
            return False
        if approver_id and not entity.first_approved_by:
            entity.first_approved_by = approver_id
            entity.first_approved_at = datetime.now(timezone.utc)
            await self.db.flush()
        logger.info("{} {} held for a second approver", entity_type.value, entity.id)
        return True

    def is_awaiting_second_approval(
        self, entity_type: ApprovalEntityType, entity, records
    ) -> bool:
        """A request waiting for approval with nothing left in its chain.

        Reported on the request so the screen offers the manual decision
        rather than working out the hold itself (CLAUDE.md pitfall #29). It
        follows the predicate the manual actions accept: no step still
        pending, and either a chain that has run or a first approval recorded.
        """
        _model, pending_status, _label = self._unrouted_mapping(entity_type)
        if entity.status != pending_status:
            return False
        if any(r.status == ApprovalStepStatus.PENDING for r in records):
            return False
        return bool(records) or bool(entity.first_approved_by)

    async def _finalize_approval(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        approver_id: Optional[str],
        org_id: str,
    ) -> bool:
        """Set the entity status to APPROVED and update denormalized fields.

        Returns False, changing only the first-approval record, when the
        dual-approval threshold holds the request for a second approver.
        """
        model, pending_status, label = self._unrouted_mapping(entity_type)
        result = await self.db.execute(
            select(model).where(model.id == entity_id, model.organization_id == org_id)
        )
        entity = result.scalar_one_or_none()
        if entity is None:
            return False
        # Every caller has already checked this under the entity lock; held
        # here as well so no path can turn a cancelled or denied request into
        # an approved one and encumber budget against it.
        if entity.status != pending_status:
            raise ValueError(f"This {label.lower()} is no longer awaiting approval")
        if await self._held_for_second_approver(
            entity_type, entity, approver_id, org_id
        ):
            return False
        # A chain that completes with nobody confirming the late lines — an
        # auto-approve chain, or one whose last approval came from someone else
        # — leaves the report for a manual decision, where an approver must.
        if (
            entity_type == ApprovalEntityType.EXPENSE_REPORT
            and entity.late_acknowledged_at is None
            and await self.late_line_count(entity.id) > 0
        ):
            logger.info(
                "expense_report {} held for late-line acknowledgement", entity.id
            )
            return False

        await self._enforce_fund_balance(entity_type.value, entity, org_id)

        now = datetime.now(timezone.utc)
        entity.approved_by = approver_id
        entity.approved_at = now
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            entity.status = PurchaseRequestStatus.APPROVED
            # Encumber budget
            if entity.budget_id:
                await self._encumber_budget(
                    entity.budget_id,
                    entity.estimated_amount,
                    entity.organization_id,
                )
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            entity.status = ExpenseReportStatus.APPROVED
        else:
            entity.status = CheckRequestStatus.APPROVED

        await self.db.flush()
        return True

    async def _finalize_denial(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        denier_id: Optional[str],
        reason: Optional[str],
        org_id: str,
    ) -> None:
        """Set the entity status to DENIED"""
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.id == entity_id,
                    PurchaseRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = PurchaseRequestStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason
                # No encumbrance to release here: budget is encumbered only in
                # _finalize_approval, which runs once every step is non-pending.
                # A denial requires a PENDING step, so it can only occur before
                # approval — i.e. before any encumbrance exists. Releasing one
                # anyway subtracted from the budget's shared amount_encumbered
                # and silently corrupted other PRs' encumbrances on that budget.
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            report_result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            report = report_result.scalar_one_or_none()
            if report:
                report.status = ExpenseReportStatus.DENIED
                report.approved_by = denier_id
                report.denial_reason = reason
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            check_result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            check = check_result.scalar_one_or_none()
            if check:
                check.status = CheckRequestStatus.DENIED
                check.approved_by = denier_id
                check.denial_reason = reason

        await self.db.flush()

    async def _get_entity_info(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
    ) -> Optional[dict]:
        """Get basic info about an approval entity for display"""
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.id == entity_id,
                    PurchaseRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": entity.title,
                    "amount": entity.estimated_amount,
                    "requester_name": "",
                    "submitted_at": entity.created_at,
                }
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            report_result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            report = report_result.scalar_one_or_none()
            if report:
                return {
                    "title": report.title,
                    "amount": report.total_amount,
                    "requester_name": "",
                    "submitted_at": report.created_at,
                }
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            check_result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            check = check_result.scalar_one_or_none()
            if check:
                return {
                    "title": f"Check to {check.payee_name}",
                    "amount": check.amount,
                    "requester_name": "",
                    "submitted_at": check.created_at,
                }
        return None

    # ========================================
    # Purchase Requests
    # ========================================

    async def _generate_request_number(
        self, org_id: str, prefix: str, fiscal_year_id: str, offset: int = 0
    ) -> str:
        """Generate auto-incrementing request number like PR-2026-0001.

        Uses MAX of the numeric suffix (not count()+1, which repeats numbers
        after a deletion). ``offset`` lets the retry allocator step past a
        number a concurrent transaction just took — REPEATABLE READ means a
        re-run of this query cannot see that row, so retrying without an
        offset would regenerate the same colliding number.
        """
        fy = await self.get_fiscal_year(fiscal_year_id, org_id)
        if fy and fy.start_date:
            year = str(fy.start_date.year)
        else:
            # The department's year, not the server's: UTC is already next
            # year on a US department's New Year's Eve.
            year = str((await resolve_org_today(self.db, org_id)).year)

        # Expense reports name the column report_number; the others,
        # request_number.
        table_map: dict[str, tuple[_FinanceDocument, Any]] = {
            "PR": (PurchaseRequest, PurchaseRequest.request_number),
            "ER": (ExpenseReport, ExpenseReport.report_number),
            "CK": (CheckRequest, CheckRequest.request_number),
        }
        entry = table_map.get(prefix)
        if not entry:
            raise ValueError(f"Unknown prefix: {prefix}")
        model, number_col = entry
        # System-generated prefix, so the trailing % is a deliberate wildcard.
        # Renamed off `like_pattern` so it cannot shadow the shared helper.
        number_prefix = f"{prefix}-{year}-%"
        result = await self.db.execute(
            select(
                func.max(cast(func.substring_index(number_col, "-", -1), Integer))
            ).where(
                model.organization_id == org_id,
                number_col.like(number_prefix, escape=LIKE_ESCAPE_CHAR),
            )
        )
        highest = result.scalar() or 0
        return f"{prefix}-{year}-{(highest + 1 + offset):04d}"

    _NUMBER_ALLOC_ATTEMPTS = 5

    async def _flush_with_unique_number(
        self, obj, number_attr: str, org_id: str, prefix: str, fiscal_year_id: str
    ) -> None:
        """Assign a request/report number and flush, retrying on collision.

        The per-org unique constraint (uq_*_org_number) is the arbiter; each
        retry regenerates with a +1 offset inside a SAVEPOINT so a collision
        never poisons the caller's outer transaction.
        """
        for attempt in range(self._NUMBER_ALLOC_ATTEMPTS):
            setattr(
                obj,
                number_attr,
                await self._generate_request_number(
                    org_id, prefix, fiscal_year_id, offset=attempt
                ),
            )
            nested = await self.db.begin_nested()
            try:
                self.db.add(obj)
                await self.db.flush()
                await nested.commit()
                return
            except IntegrityError as e:
                await nested.rollback()
                # Only a number collision is retryable; FK or other
                # constraint violations must surface to the caller.
                if "org_number" not in str(e.orig):
                    raise
                logger.warning(
                    "Request number collision on {} (attempt {}), retrying",
                    getattr(obj, number_attr),
                    attempt + 1,
                )
        raise ValueError(
            "Could not allocate a unique request number after "
            f"{self._NUMBER_ALLOC_ATTEMPTS} attempts; please retry"
        )

    async def list_purchase_requests(
        self,
        org_id: str,
        pagination: PaginationParams,
        status: Optional[str] = None,
        fiscal_year_id: Optional[str] = None,
        restrict_to_user: Optional[str] = None,
    ) -> list[PurchaseRequest]:
        query = select(PurchaseRequest).where(PurchaseRequest.organization_id == org_id)
        # A requester without finance.view sees only what they raised.
        if restrict_to_user is not None:
            query = query.where(PurchaseRequest.requested_by == restrict_to_user)
        if status:
            query = query.where(PurchaseRequest.status == status)
        if fiscal_year_id:
            query = query.where(PurchaseRequest.fiscal_year_id == fiscal_year_id)
        query = (
            query.order_by(PurchaseRequest.created_at.desc(), PurchaseRequest.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_purchase_request(
        self,
        pr_id: str,
        org_id: str,
        for_update: bool = False,
        restrict_to_user: Optional[str] = None,
    ) -> Optional[PurchaseRequest]:
        """A purchase request by id, org-scoped.

        ``for_update`` locks the row for the caller's transaction and refreshes
        an instance already in the session (``populate_existing``): a status
        check made off a stale identity-map copy would pass for a request a
        concurrent transaction has just moved on (CLAUDE.md Pitfall #27).

        ``restrict_to_user`` confines the lookup to that member's own request,
        so somebody else's reads exactly like one that does not exist.
        """
        query = select(PurchaseRequest).where(
            PurchaseRequest.id == pr_id,
            PurchaseRequest.organization_id == org_id,
        )
        if restrict_to_user is not None:
            query = query.where(PurchaseRequest.requested_by == restrict_to_user)
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(query)
        purchase_request: Optional[PurchaseRequest] = result.scalar_one_or_none()
        return purchase_request

    async def create_purchase_request(
        self,
        org_id: str,
        requested_by: str,
        *,
        charger_id: Optional[str] = None,
        **kwargs,
    ) -> PurchaseRequest:
        await self._validate_finance_fks(org_id, kwargs)
        await assert_may_charge(self.db, org_id, charger_id, kwargs.get("budget_id"))
        await self._assert_budget_open_for_new_charges(
            org_id, [kwargs.get("budget_id")]
        )
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        await self.require_year_accepts(fiscal_year_id, org_id, action="new")
        pr = PurchaseRequest(
            organization_id=org_id,
            requested_by=requested_by,
            **kwargs,
        )
        await self._flush_with_unique_number(
            pr, "request_number", org_id, "PR", fiscal_year_id
        )
        await self.db.refresh(pr, ["created_at", "updated_at"])
        logger.info("Created purchase request {}", pr.request_number)
        return pr

    async def update_purchase_request(
        self, pr_id: str, org_id: str, requester_id: Optional[str] = None, **kwargs
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(
            pr_id, org_id, for_update=True, restrict_to_user=requester_id
        )
        if not pr:
            _raise_not_found("Purchase request", requester_id)
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="new")
        if kwargs.get("fiscal_year_id"):
            await self.require_year_accepts(
                kwargs["fiscal_year_id"], org_id, action="new"
            )
        if pr.status not in (
            PurchaseRequestStatus.DRAFT,
            PurchaseRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a purchase request in this status")
        await self._validate_finance_fks(org_id, kwargs)
        # The requester scope doubles as the charger: None is finance.manage.
        # Only a change of line is checked, so a request filed before its line
        # was restricted can still be edited.
        if kwargs.get("budget_id") != pr.budget_id:
            await assert_may_charge(
                self.db, org_id, requester_id, kwargs.get("budget_id")
            )
            # Same rule for an inactive category: refused only when the line
            # is newly chosen, so a draft already on it can still be edited
            # (submitting it is what is refused).
            await self._assert_budget_open_for_new_charges(
                org_id, [kwargs.get("budget_id")]
            )
        apply_updates(pr, kwargs)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def submit_purchase_request(
        self, pr_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> PurchaseRequest:
        pr = await self.get_purchase_request(
            pr_id, org_id, for_update=True, restrict_to_user=requester_id
        )
        if not pr:
            _raise_not_found("Purchase request", requester_id)
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="new")
        if pr.status != PurchaseRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")
        await self._assert_budget_open_for_new_charges(org_id, [pr.budget_id])

        pr.status = PurchaseRequestStatus.SUBMITTED

        chain = await self._request_chain(
            org_id,
            ApprovalEntityType.PURCHASE_REQUEST,
            pr.estimated_amount,
            pr.budget_id,
        )

        if chain and chain.steps:
            pr.status = PurchaseRequestStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.PURCHASE_REQUEST,
                pr.id,
                pr.estimated_amount,
                pr.requested_by,
            )
            # Check if all steps were auto-approved
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.PURCHASE_REQUEST, pr.id, org_id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.PURCHASE_REQUEST, pr.id, None, org_id
                )
        else:
            # No chain — needs manual approval
            pr.status = PurchaseRequestStatus.PENDING_APPROVAL

        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        logger.info("Submitted purchase request {}", pr.request_number)
        return pr

    async def mark_pr_ordered(self, pr_id: str, org_id: str) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id, for_update=True)
        if not pr:
            raise ValueError("Purchase request not found")
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="finish")
        if pr.status != PurchaseRequestStatus.APPROVED:
            raise ValueError("Only approved requests can be marked as ordered")
        pr.status = PurchaseRequestStatus.ORDERED
        pr.ordered_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def mark_pr_received(self, pr_id: str, org_id: str) -> PurchaseRequest:
        pr = await self.get_purchase_request(pr_id, org_id, for_update=True)
        if not pr:
            raise ValueError("Purchase request not found")
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="finish")
        if pr.status != PurchaseRequestStatus.ORDERED:
            raise ValueError("Only ordered requests can be marked as received")
        pr.status = PurchaseRequestStatus.RECEIVED
        pr.received_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def mark_pr_paid(
        self,
        pr_id: str,
        org_id: str,
        actual_amount: Optional[Decimal] = None,
        acted_by: Optional[str] = None,
    ) -> PurchaseRequest:
        # Locked read (CLAUDE.md Pitfall #27): two concurrent "mark paid" calls
        # on the same request must not both pass the not-yet-paid check off a
        # plain SELECT and both move budget from encumbered to spent -- the
        # same shape FIN-10 already fixed for approve_step/deny_step, here on
        # the disbursement transition instead of the approval one. Racing with
        # cancel_purchase_request (also locked, below) matters too: an
        # unlocked cancel reading a stale pre-payment snapshot would otherwise
        # flush a status=CANCELLED write that silently overwrites this
        # request's already-committed PAID status.
        result = await self.db.execute(
            select(PurchaseRequest)
            .where(
                PurchaseRequest.id == pr_id,
                PurchaseRequest.organization_id == org_id,
            )
            .with_for_update()
        )
        pr: PurchaseRequest | None = result.scalar_one_or_none()
        if not pr:
            raise ValueError("Purchase request not found")
        # SoD (FIN-4): the person who disburses must not be the requester.
        assert_different_person(
            acted_by, pr.requested_by, action="mark paid", record="purchase request"
        )
        if pr.status not in (
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.ORDERED,
            PurchaseRequestStatus.RECEIVED,
        ):
            raise ValueError("Request cannot be marked as paid in this status")
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="finish")
        # Paying the vendor as well as the member would pay for it twice.
        await self._refuse_while_claimed(pr, org_id, "marked as paid")

        # The approval committed the estimate; paying more than it spends the
        # difference, which the fund must still have.
        if actual_amount is not None and actual_amount > pr.estimated_amount:
            await self._enforce_fund_balance(
                KIND_PURCHASE,
                pr,
                org_id,
                charges=(
                    {pr.fund_campaign_id: Decimal(str(actual_amount))}
                    if pr.fund_campaign_id
                    else {}
                ),
            )

        pr.status = PurchaseRequestStatus.PAID
        pr.paid_at = datetime.now(timezone.utc)
        if actual_amount is not None:
            pr.actual_amount = actual_amount

        # Move from encumbered to spent
        if pr.budget_id:
            amount = pr.actual_amount or pr.estimated_amount
            # One locked mutation avoids briefly counting both the existing
            # encumbrance and the resulting spend.  It also permits an actual
            # amount up to the remaining budget after releasing the estimate.
            await self._mutate_budget(
                pr.budget_id,
                org_id,
                encumbered_delta=-pr.estimated_amount,
                spent_delta=amount,
            )

        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    async def cancel_purchase_request(
        self, pr_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> PurchaseRequest:
        """Cancel a purchase request.

        ``requester_id`` is set when the caller is withdrawing their own
        request rather than acting as a finance manager. A requester may only
        withdraw a draft: once submitted the request has approval steps
        waiting on other people and, past approval, an encumbrance against a
        budget line — unwinding either is the finance office's call.
        """
        # Locked read -- see mark_pr_paid: this is the request's other terminal
        # transition off the same status field, and the two must not race each
        # other (an unlocked cancel here reading a stale pre-payment snapshot
        # would flush a status=CANCELLED write over an already-committed PAID
        # request once its own lock clears).
        query = select(PurchaseRequest).where(
            PurchaseRequest.id == pr_id,
            PurchaseRequest.organization_id == org_id,
        )
        if requester_id is not None:
            query = query.where(PurchaseRequest.requested_by == requester_id)
        result = await self.db.execute(query.with_for_update())
        pr: PurchaseRequest | None = result.scalar_one_or_none()
        if not pr:
            _raise_not_found("Purchase request", requester_id)
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="finish")
        if pr.status in (PurchaseRequestStatus.PAID,):
            raise ValueError("Paid requests cannot be cancelled")
        if pr.status == PurchaseRequestStatus.REIMBURSED:
            raise ValueError("Reimbursed requests cannot be cancelled")
        if requester_id is not None and pr.status != PurchaseRequestStatus.DRAFT:
            raise ValueError(
                "You can withdraw your own request only while it is a draft; "
                "ask the finance office to cancel a submitted request"
            )
        # Its encumbrance is released when the report claiming it is paid;
        # releasing it now as well would release it twice.
        await self._refuse_while_claimed(pr, org_id, "cancelled")

        # Release encumbrance if approved
        if pr.budget_id and pr.status in (
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.ORDERED,
            PurchaseRequestStatus.RECEIVED,
        ):
            await self._release_encumbrance(pr.budget_id, pr.estimated_amount, org_id)

        pr.status = PurchaseRequestStatus.CANCELLED
        # Close the chain the way a denial does. Left PENDING, the steps kept
        # the request in every approver's queue and their emailed links live,
        # and approving the last one finalized it as APPROVED.
        await self._terminate_entity_pending_steps(
            ApprovalEntityType.PURCHASE_REQUEST, pr.id, org_id
        )
        await self.db.flush()
        await self.db.refresh(pr, ["updated_at"])
        return pr

    # ========================================
    # Expense Reports
    # ========================================

    async def list_expense_reports(
        self,
        org_id: str,
        pagination: PaginationParams,
        status: Optional[str] = None,
        restrict_to_user: Optional[str] = None,
    ) -> list[ExpenseReport]:
        # Expense reports are personal reimbursement records (payee, amounts owed).
        # A plain finance.view holder is confined to their own submissions;
        # restrict_to_user=None (finance managers/treasurers) sees the whole org
        # queue (FIN-5, owner decision 2026-08-09).
        query = (
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(ExpenseReport.organization_id == org_id)
        )
        if restrict_to_user is not None:
            query = query.where(ExpenseReport.submitted_by == restrict_to_user)
        if status:
            query = query.where(ExpenseReport.status == status)
        query = (
            query.order_by(ExpenseReport.created_at.desc(), ExpenseReport.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().unique().all())

    async def get_expense_report(
        self,
        er_id: str,
        org_id: str,
        restrict_to_user: Optional[str] = None,
        for_update: bool = False,
    ) -> Optional[ExpenseReport]:
        """An expense report by id, org-scoped.

        ``for_update`` locks the row for the caller's transaction and refreshes
        an instance already in the session (``populate_existing``): a status
        check made off a stale identity-map copy would pass for a request a
        concurrent transaction has just moved on (CLAUDE.md Pitfall #27).
        """
        query = (
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(
                ExpenseReport.id == er_id,
                ExpenseReport.organization_id == org_id,
            )
        )
        if restrict_to_user is not None:
            query = query.where(ExpenseReport.submitted_by == restrict_to_user)
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(query)
        expense_report: Optional[ExpenseReport] = result.scalar_one_or_none()
        return expense_report

    async def create_expense_report(
        self,
        org_id: str,
        submitted_by: str,
        line_items: Optional[list] = None,
        *,
        charger_id: Optional[str] = None,
        **kwargs,
    ) -> ExpenseReport:
        await self._validate_finance_fks(org_id, kwargs)
        for item_data in line_items or []:
            await self._validate_finance_fks(org_id, item_data)
            await assert_may_charge(
                self.db, org_id, charger_id, item_data.get("budget_id")
            )
        await self._assert_budget_open_for_new_charges(
            org_id, [item_data.get("budget_id") for item_data in line_items or []]
        )
        if kwargs.get("advance_id"):
            await assert_settleable(self.db, org_id, kwargs["advance_id"], submitted_by)
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        await self.require_year_accepts(fiscal_year_id, org_id, action="new")
        er = ExpenseReport(
            organization_id=org_id,
            submitted_by=submitted_by,
            **kwargs,
        )
        await self._flush_with_unique_number(
            er, "report_number", org_id, "ER", fiscal_year_id
        )

        total = Decimal("0")
        if line_items:
            for item_data in line_items:
                item = ExpenseLineItem(expense_report_id=er.id, **item_data)
                self.db.add(item)
                total += Decimal(str(item_data.get("amount", 0)))
            await self.db.flush()

        er.total_amount = total
        await self.db.flush()
        # `line_items` too, not just the timestamps: the response model includes
        # the collection, and serializing an unloaded relationship outside the
        # async context raises MissingGreenlet — the report is written and the
        # caller still gets a 500.
        await self.db.refresh(er, ["created_at", "updated_at", "line_items"])
        return er

    async def update_expense_report(
        self, er_id: str, org_id: str, requester_id: Optional[str] = None, **kwargs
    ) -> ExpenseReport:
        er = await self.get_expense_report(
            er_id, org_id, restrict_to_user=requester_id, for_update=True
        )
        if not er:
            _raise_not_found("Expense report", requester_id)
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="new")
        if kwargs.get("fiscal_year_id"):
            await self.require_year_accepts(
                kwargs["fiscal_year_id"], org_id, action="new"
            )
        if er.status not in (
            ExpenseReportStatus.DRAFT,
            ExpenseReportStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit an expense report in this status")
        if "advance_id" in kwargs:
            # How much of the report the advance covers is fixed on submit.
            if er.status != ExpenseReportStatus.DRAFT:
                raise ValueError(
                    "The cash advance a report accounts for can only be "
                    "changed while it is a draft"
                )
            if kwargs["advance_id"]:
                await assert_settleable(
                    self.db, org_id, kwargs["advance_id"], er.submitted_by
                )
        await self._validate_finance_fks(org_id, kwargs)
        apply_updates(er, kwargs)
        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    async def add_expense_line_item(
        self, er_id: str, org_id: str, requester_id: Optional[str] = None, **kwargs
    ) -> ExpenseLineItem:
        er = await self.get_expense_report(er_id, org_id, restrict_to_user=requester_id)
        if not er:
            _raise_not_found("Expense report", requester_id)
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="new")
        if er.status not in (ExpenseReportStatus.DRAFT,):
            raise ValueError("Can only add items to draft reports")
        await self._validate_finance_fks(org_id, kwargs)
        await assert_may_charge(self.db, org_id, requester_id, kwargs.get("budget_id"))
        await self._assert_budget_open_for_new_charges(
            org_id, [kwargs.get("budget_id")]
        )
        item = ExpenseLineItem(expense_report_id=er_id, **kwargs)
        self.db.add(item)
        await self.db.flush()
        await self._recalculate_report_total(er)
        await self.db.refresh(item, ["created_at"])
        return item

    async def _recalculate_report_total(self, er: ExpenseReport) -> None:
        """Set the report's total from a fresh aggregate over its persisted
        lines, rather than the loaded ``er.line_items`` collection. That
        collection may or may not reflect a line just added or removed
        (depending on when it was loaded), so summing it could double-count or
        drift. The DB sum is authoritative (FIN-7)."""
        total_result = await self.db.execute(
            select(func.coalesce(func.sum(ExpenseLineItem.amount), 0)).where(
                ExpenseLineItem.expense_report_id == er.id
            )
        )
        er.total_amount = total_result.scalar_one()
        await self.db.flush()

    async def _draft_line(
        self,
        er_id: str,
        item_id: str,
        org_id: str,
        requester_id: Optional[str],
    ) -> tuple[ExpenseReport, ExpenseLineItem]:
        """A line on a draft report, the report locked so a change cannot
        land beside a concurrent submission that is grading the lines."""
        er = await self.get_expense_report(
            er_id, org_id, restrict_to_user=requester_id, for_update=True
        )
        if not er:
            _raise_not_found("Expense report", requester_id)
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="new")
        if er.status != ExpenseReportStatus.DRAFT:
            raise ValueError("Lines can only be changed while the report is a draft")
        item = next((i for i in er.line_items if i.id == item_id), None)
        if item is None:
            raise FinanceEntityNotFoundError("Expense line not found")
        return er, item

    async def update_expense_line_item(
        self,
        er_id: str,
        item_id: str,
        org_id: str,
        requester_id: Optional[str] = None,
        **kwargs,
    ) -> ExpenseLineItem:
        """Edit a line while its report is a draft.

        Only the fields sent change; an explicit null clears an optional one
        (``apply_updates``). As ``update_purchase_request``, only a change of
        budget line is checked against who may charge it, so a line copied
        from a request (finance_reimbursement.py) can still be edited.
        """
        er, item = await self._draft_line(er_id, item_id, org_id, requester_id)
        await self._validate_finance_fks(org_id, kwargs)
        if "budget_id" in kwargs and kwargs["budget_id"] != item.budget_id:
            await assert_may_charge(
                self.db, org_id, requester_id, kwargs.get("budget_id")
            )
        apply_updates(item, kwargs)
        await self.db.flush()
        await self._recalculate_report_total(er)
        await self.db.refresh(item, ["created_at"])
        return item

    async def delete_expense_line_item(
        self,
        er_id: str,
        item_id: str,
        org_id: str,
        requester_id: Optional[str] = None,
    ) -> ExpenseReport:
        """Remove a line while its report is a draft. Its receipt document is
        kept, as replacing a receipt keeps the earlier one. A report left with
        no lines stays a draft; submitting it is refused until one is added."""
        er, item = await self._draft_line(er_id, item_id, org_id, requester_id)
        await self.db.delete(item)
        await self.db.flush()
        await self._recalculate_report_total(er)
        # The loaded collection still holds the deleted line until reloaded.
        await self.db.refresh(er, ["line_items", "updated_at"])
        return er

    async def cancel_expense_report(
        self, er_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> ExpenseReport:
        """Withdraw or cancel an expense report.

        ``requester_id`` is set when the caller is withdrawing their own
        report rather than acting as a finance manager: as with a purchase
        request, a member may withdraw only a draft, and the finance office
        cancels one that is further along. A paid report is settled and a
        denied one already closed. While a check is paying the report it is
        refused: the check is cancelled or voided first.

        Nothing has been spent or encumbered for an unpaid report, so no
        budget line moves; a cancelled report stops counting against its cash
        advance and its restricted funds, and frees the purchase it claimed
        back (finance_reimbursement.py) for another claim.
        """
        er = await self.get_expense_report(
            er_id, org_id, restrict_to_user=requester_id, for_update=True
        )
        if not er:
            _raise_not_found("Expense report", requester_id)
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="finish")
        if er.status == ExpenseReportStatus.PAID:
            raise ValueError("Paid reports cannot be cancelled")
        if er.status in (ExpenseReportStatus.DENIED, ExpenseReportStatus.CANCELLED):
            raise ValueError("This report is already closed")
        if requester_id is not None and er.status != ExpenseReportStatus.DRAFT:
            raise ValueError(
                "You can withdraw your own report only while it is a draft; "
                "ask the finance office to cancel a submitted report"
            )
        check = await live_check_for_report(self.db, org_id, er.id)
        if check is not None:
            raise ReimbursementLinkError(
                f"Check request {check.request_number} is paying this report. "
                "Cancel or void that check first."
            )
        er.status = ExpenseReportStatus.CANCELLED
        # Close the chain as cancel_purchase_request does, so it leaves every
        # approver's queue and its emailed links stop working.
        await self._terminate_entity_pending_steps(
            ApprovalEntityType.EXPENSE_REPORT, er.id, org_id
        )
        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    async def reviews_entity(
        self,
        user: User,
        entity_type: ApprovalEntityType,
        entity_id: str,
        org_id: str,
        *,
        submitted: bool,
    ) -> bool:
        """Whether ``user`` is one of this document's approvers.

        Someone a step names (the rule approve/deny enforce), someone who has
        already acted on a step, or an approvals administrator, who may act on
        any step with an override reason. A submitted document no chain
        applies to is approved by hand by any ``finance.approve`` holder
        (``manual_approve``), so they are its approvers. They read the document
        they are asked to decide on, its receipts included, without the
        org-wide grant. A draft has no approvers.
        """
        if not submitted:
            return False
        if is_approvals_admin(user):
            return True
        records = await self.get_approval_records(entity_type, entity_id, org_id)
        if not records:
            return user_has_permission(user, FINANCE_APPROVE)
        for record in records:
            if record.acted_by and str(record.acted_by) == str(user.id):
                return True
            if record.step is not None and await user_matches_step(
                self.db, user, record.step, org_id
            ):
                return True
        return False

    async def submit_expense_report(
        self, er_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> ExpenseReport:
        er = await self.get_expense_report(
            er_id, org_id, restrict_to_user=requester_id, for_update=True
        )
        if not er:
            _raise_not_found("Expense report", requester_id)
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="new")
        if er.status != ExpenseReportStatus.DRAFT:
            raise ValueError("Only draft reports can be submitted")
        if er.total_amount <= 0:
            raise ValueError("Expense report must have line items")
        await self._assert_budget_open_for_new_charges(
            org_id, [item.budget_id for item in er.line_items]
        )
        missing = [item for item in er.line_items if not item.receipt_document_id]
        if missing:
            named = ", ".join(f'"{item.description}"' for item in missing[:3])
            more = f" and {len(missing) - 3} more" if len(missing) > 3 else ""
            raise ValueError(
                "Attach a receipt to every line before submitting. Missing: "
                f"{named}{more}."
            )

        rules = await load_finance_settings(self.db, org_id)
        now = datetime.now(timezone.utc)
        late = []
        if rules.substantiation_mode != SUBSTANTIATION_OFF:
            submitted_day = now.astimezone(
                await resolve_scheduling_timezone(self.db, org_id)
            ).date()
            late = late_items(er.line_items, submitted_day, rules.substantiation_days)
            if late and rules.substantiation_mode == SUBSTANTIATION_BLOCK:
                raise ValueError(
                    "Expenses must be submitted within "
                    f"{rules.substantiation_days} days of being incurred. "
                    f"{describe_late(late, rules.substantiation_days)}. "
                    "Ask the Treasurer how to claim them."
                )
        late_ids = {item.id for item in late}
        for item in er.line_items:
            item.substantiated_late = item.id in late_ids
        if er.advance_id:
            er.advance_applied = await self._apply_advance(er, org_id)
        if er.purchase_request_id:
            await self._assert_purchase_claimable(er, org_id)
        er.submitted_at = now

        er.status = ExpenseReportStatus.SUBMITTED

        chain = await self._request_chain(
            org_id, ApprovalEntityType.EXPENSE_REPORT, er.total_amount, None
        )

        if chain and chain.steps:
            er.status = ExpenseReportStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.EXPENSE_REPORT,
                er.id,
                er.total_amount,
                er.submitted_by,
            )
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.EXPENSE_REPORT, er.id, org_id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.EXPENSE_REPORT, er.id, None, org_id
                )
        else:
            er.status = ExpenseReportStatus.PENDING_APPROVAL

        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    async def _apply_advance(self, er: ExpenseReport, org_id: str) -> Decimal:
        """How much of this report its cash advance covers: the report's
        total, up to what the advance still has outstanding.

        The advance's row is locked first and the balance read through locking
        reads, so two reports submitted against one advance at once cannot
        both claim its last dollars (CLAUDE.md pitfall #27).
        """
        advance_id = er.advance_id or ""
        advance = await lock_advance(self.db, org_id, advance_id)
        if (
            advance is None
            or advance.status != CheckRequestStatus.ISSUED
            or advance.requested_by != er.submitted_by
        ):
            raise AdvanceNotSettleableError()
        balance = (
            await advance_balances(self.db, org_id, advance_ids=[advance_id], lock=True)
        )[advance_id]
        if balance.outstanding <= 0:
            raise ValueError(
                f"Cash advance {advance.request_number} is already fully "
                "accounted for. Remove it from this report to claim these "
                "expenses as a reimbursement."
            )
        return min(_qb_amount(er.total_amount), balance.outstanding)

    async def mark_expense_paid(
        self,
        er_id: str,
        org_id: str,
        payment_method: Optional[str] = None,
        acted_by: Optional[str] = None,
    ) -> ExpenseReport:
        # Locked read -- see mark_pr_paid. Two concurrent "mark paid" calls on
        # the same report must not both pass the APPROVED check off a plain
        # SELECT and both add every line item's amount to spent.
        result = await self.db.execute(
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(
                ExpenseReport.id == er_id,
                ExpenseReport.organization_id == org_id,
            )
            .with_for_update()
        )
        er: ExpenseReport | None = result.scalar_one_or_none()
        if not er:
            raise ValueError("Expense report not found")
        # SoD (FIN-4): the person who disburses must not be the submitter.
        assert_different_person(
            acted_by, er.submitted_by, action="mark paid", record="expense report"
        )
        if er.status != ExpenseReportStatus.APPROVED:
            raise ValueError("Only approved reports can be marked as paid")
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="finish")
        check = await live_check_for_report(self.db, org_id, er.id)
        if check is not None:
            raise ReimbursementLinkError(
                f"Check request {check.request_number} is paying this report. "
                "Issue that check, or wait for it to be denied, rather than "
                "paying the report another way."
            )

        await self._settle_report(
            er, org_id, datetime.now(timezone.utc), payment_method
        )
        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

    # ========================================
    # Reimbursement: purchase -> report -> check
    # (app/services/finance_reimbursement.py)
    # ========================================

    async def _refuse_while_claimed(
        self, pr: PurchaseRequest, org_id: str, action: str
    ) -> None:
        """Refuse paying or cancelling a purchase a submitted report claims.

        A draft does not block: the finance office can settle the purchase
        and the draft is then refused on submission, rather than a member's
        forgotten draft holding the request open for good.
        """
        report = await live_report_for_purchase(self.db, org_id, pr.id)
        if report is not None and report.status != ExpenseReportStatus.DRAFT:
            raise ReimbursementLinkError(
                f"Expense report {report.report_number} claims this purchase "
                f"back for the member, so it cannot be {action}. Deny that "
                "report first."
            )

    async def _assert_purchase_claimable(self, er: ExpenseReport, org_id: str) -> None:
        pr = await lock_purchase(self.db, org_id, er.purchase_request_id or "")
        if pr is None or pr.status not in CLAIMABLE_PURCHASE_STATUSES:
            raise ReimbursementLinkError(
                "The purchase request this report claims back is no longer "
                "approved and unpaid, so it cannot be reimbursed."
            )

    async def create_reimbursement_report(
        self,
        pr_id: str,
        org_id: str,
        caller_id: str,
        *,
        requester_scope: Optional[str],
        amount: Optional[Decimal] = None,
        date_incurred: Optional[datetime] = None,
        merchant: Optional[str] = None,
    ) -> ExpenseReport:
        """Raise a draft expense report claiming back an approved purchase the
        requester paid for themselves, with one line copied from it.

        ``requester_scope`` is the caller's id when they lack the manage
        grant, so another member's request reads as one that does not exist.
        Only the member who raised the request may claim it: the report pays
        whoever submits it.
        """
        pr = await lock_purchase(self.db, org_id, pr_id)
        if pr is None or (
            requester_scope is not None and pr.requested_by != requester_scope
        ):
            _raise_not_found("Purchase request", requester_scope)
        if pr.requested_by != caller_id:
            raise ReimbursementLinkError(
                "Only the member who raised this purchase request can claim it back."
            )
        await self.require_year_accepts(pr.fiscal_year_id, org_id, action="new")
        if pr.status not in CLAIMABLE_PURCHASE_STATUSES:
            raise ReimbursementLinkError(
                "Only an approved purchase that has not been paid can be "
                "claimed back."
            )
        existing = await live_report_for_purchase(self.db, org_id, pr.id)
        if existing is not None:
            raise ReimbursementLinkError(
                f"Expense report {existing.report_number} already claims this "
                "purchase back."
            )

        claimed = Decimal(str(amount or pr.actual_amount or pr.estimated_amount))
        er = ExpenseReport(
            organization_id=org_id,
            submitted_by=pr.requested_by,
            fiscal_year_id=pr.fiscal_year_id,
            title=pr.title,
            description=f"Reimbursement for purchase request {pr.request_number}",
            purchase_request_id=pr.id,
            total_amount=claimed,
        )
        await self._flush_with_unique_number(
            er, "report_number", org_id, "ER", pr.fiscal_year_id
        )
        # The line is the request's own charge, which its approval already
        # authorized, so it is copied rather than re-checked against who may
        # charge the line today. The request's receipt, if any, comes with it.
        self.db.add(
            ExpenseLineItem(
                expense_report_id=er.id,
                budget_id=pr.budget_id,
                fund_campaign_id=pr.fund_campaign_id,
                functional_class=pr.functional_class,
                description=pr.title[:500],
                amount=claimed,
                date_incurred=date_incurred
                or pr.received_at
                or pr.ordered_at
                or datetime.now(timezone.utc),
                expense_type=ExpenseType.GENERAL,
                merchant=merchant or pr.vendor,
                receipt_document_id=pr.receipt_document_id,
            )
        )
        await self.db.flush()
        await self.db.refresh(er, ["created_at", "updated_at", "line_items"])
        logger.info(
            "Expense report {} claims purchase request {}",
            er.report_number,
            pr.request_number,
        )
        return er

    async def request_reimbursement_check(
        self,
        er_id: str,
        org_id: str,
        *,
        payee_address: Optional[str] = None,
        memo: Optional[str] = None,
    ) -> CheckRequest:
        """Raise the check that pays an approved report, and submit it.

        It is payable to the member for what the report still owes them, is
        raised in their name (so the requester rules -- no approving or
        issuing your own check -- protect it as any check), and goes through
        the check-request approval chain (owner decision, 2026-10-23).
        """
        er = await self.get_expense_report(er_id, org_id, for_update=True)
        if er is None:
            raise ValueError("Expense report not found")
        await self.require_year_accepts(er.fiscal_year_id, org_id, action="finish")
        if er.status != ExpenseReportStatus.APPROVED:
            raise ReimbursementLinkError(
                "Only an approved expense report can be paid by check."
            )
        existing = await live_check_for_report(self.db, org_id, er.id)
        if existing is not None:
            raise ReimbursementLinkError(
                f"Check request {existing.request_number} is already paying "
                "this report."
            )
        owed = amount_owed(er)
        if owed <= 0:
            raise ReimbursementLinkError(
                "The cash advance covers this whole report, so there is "
                "nothing to pay by check. Mark it paid instead."
            )
        member = (
            await self.db.execute(
                select(User).where(
                    User.id == er.submitted_by, User.organization_id == org_id
                )
            )
        ).scalar_one_or_none()
        payee = (
            format_legal_name(member.first_name, member.last_name) or member.username
            if member is not None
            else ""
        )
        if not payee:
            raise ReimbursementLinkError(
                "The member who submitted this report is no longer in the "
                "department, so the check cannot be made out to them here."
            )
        cr = CheckRequest(
            organization_id=org_id,
            requested_by=er.submitted_by,
            fiscal_year_id=er.fiscal_year_id,
            expense_report_id=er.id,
            payee_name=payee[:300],
            payee_address=payee_address,
            amount=owed,
            memo=(memo or f"Reimbursement {er.report_number}")[:500],
            purpose=f"Reimbursement for expense report {er.report_number}: {er.title}",
        )
        await self._flush_with_unique_number(
            cr, "request_number", org_id, "CK", er.fiscal_year_id
        )
        await self._route_check_request(cr, org_id)
        await self.db.flush()
        await self.db.refresh(cr, ["created_at", "updated_at"])
        logger.info(
            "Check request {} raised to pay expense report {}",
            cr.request_number,
            er.report_number,
        )
        return cr

    async def reimbursement_links(
        self, kind: str, entity, org_id: str
    ) -> dict[str, Any]:
        """The other records on a payment's reimbursement path, by response
        field (app/services/finance_reimbursement.py). Plain reads, for a
        response; the transitions take their own locks."""
        links: dict[str, Any] = {}
        if kind == KIND_PURCHASE:
            row = (
                await self.db.execute(
                    select(
                        ExpenseReport.id,
                        ExpenseReport.report_number,
                        ExpenseReport.status,
                    )
                    .where(
                        ExpenseReport.organization_id == org_id,
                        ExpenseReport.purchase_request_id == entity.id,
                        ExpenseReport.status.in_(LIVE_REPORT_STATUSES),
                    )
                    .order_by(ExpenseReport.created_at.desc(), ExpenseReport.id)
                    .limit(1)
                )
            ).first()
            if row is not None:
                links["reimbursement_report_id"] = row[0]
                links["reimbursement_report_number"] = row[1]
                links["reimbursement_report_status"] = _enum_value(row[2])
        elif kind == KIND_EXPENSE:
            links["amount_owed"] = amount_owed(entity)
            if entity.purchase_request_id:
                links["purchase_request_number"] = await self.db.scalar(
                    select(PurchaseRequest.request_number).where(
                        PurchaseRequest.organization_id == org_id,
                        PurchaseRequest.id == entity.purchase_request_id,
                    )
                )
            check = (
                await self.db.execute(
                    select(
                        CheckRequest.id,
                        CheckRequest.request_number,
                        CheckRequest.status,
                    )
                    .where(
                        CheckRequest.organization_id == org_id,
                        CheckRequest.expense_report_id == entity.id,
                        CheckRequest.status.in_(LIVE_CHECK_STATUSES),
                    )
                    .order_by(CheckRequest.created_at.desc(), CheckRequest.id)
                    .limit(1)
                )
            ).first()
            if check is not None:
                links["reimbursement_check_id"] = check[0]
                links["reimbursement_check_number"] = check[1]
                links["reimbursement_check_status"] = _enum_value(check[2])
        elif kind == KIND_CHECK and entity.expense_report_id:
            links["expense_report_number"] = await self.db.scalar(
                select(ExpenseReport.report_number).where(
                    ExpenseReport.organization_id == org_id,
                    ExpenseReport.id == entity.expense_report_id,
                )
            )
        return links

    async def _settle_report(
        self,
        er: ExpenseReport,
        org_id: str,
        paid_at: datetime,
        payment_method: Optional[str],
    ) -> None:
        """Pay an approved report: its lines are spent on their budget lines,
        and the purchase it claims back, if any, closes as reimbursed.

        The purchase's encumbrance is released in the same budget mutation as
        the spend on that line, as ``mark_pr_paid`` does, so a line that is
        nearly full is not refused for briefly counting both.
        """
        deltas: dict[str, list[Decimal]] = {}
        for item in er.line_items:
            if item.budget_id:
                deltas.setdefault(item.budget_id, [Decimal("0"), Decimal("0")])
                deltas[item.budget_id][0] += Decimal(str(item.amount))
        if er.purchase_request_id:
            pr = await lock_purchase(self.db, org_id, er.purchase_request_id)
            if pr is None or pr.status not in CLAIMABLE_PURCHASE_STATUSES:
                raise ReimbursementLinkError(
                    "The purchase request this report claims back is no longer "
                    "approved and unpaid, so the report cannot be paid."
                )
            if pr.budget_id:
                deltas.setdefault(pr.budget_id, [Decimal("0"), Decimal("0")])
                deltas[pr.budget_id][1] -= Decimal(str(pr.estimated_amount))
            pr.status = PurchaseRequestStatus.REIMBURSED
            pr.paid_at = paid_at
        for budget_id in sorted(deltas):
            spent, encumbered = deltas[budget_id]
            await self._mutate_budget(
                budget_id, org_id, spent_delta=spent, encumbered_delta=encumbered
            )
        er.status = ExpenseReportStatus.PAID
        er.paid_at = paid_at
        er.payment_method = payment_method

    async def _unsettle_report(self, er: ExpenseReport, org_id: str) -> None:
        """Undo ``_settle_report`` for a report whose check was voided: back to
        approved, its spend reversed and its purchase reopened with its
        encumbrance, so another check can pay it."""
        deltas: dict[str, list[Decimal]] = {}
        for item in er.line_items:
            if item.budget_id:
                deltas.setdefault(item.budget_id, [Decimal("0"), Decimal("0")])
                deltas[item.budget_id][0] -= Decimal(str(item.amount))
        if er.purchase_request_id:
            pr = await lock_purchase(self.db, org_id, er.purchase_request_id)
            if pr is not None and pr.status == PurchaseRequestStatus.REIMBURSED:
                if pr.budget_id:
                    deltas.setdefault(pr.budget_id, [Decimal("0"), Decimal("0")])
                    deltas[pr.budget_id][1] += Decimal(str(pr.estimated_amount))
                pr.status = reopened_status(pr)
                pr.paid_at = None
        for budget_id in sorted(deltas):
            spent, encumbered = deltas[budget_id]
            await self._mutate_budget(
                budget_id, org_id, spent_delta=spent, encumbered_delta=encumbered
            )
        er.status = ExpenseReportStatus.APPROVED
        er.paid_at = None
        er.payment_method = None
        # QuickBooks holds the report's entry under the voided check, whose
        # reversing entry goes out with the next export; the report itself is
        # unpaid again, and is exported afresh when another check pays it.
        er.qb_exported_at = None
        er.qb_export_log_id = None

    # ========================================
    # Check Requests
    # ========================================

    async def list_check_requests(
        self,
        org_id: str,
        pagination: PaginationParams,
        status: Optional[str] = None,
        restrict_to_user: Optional[str] = None,
    ) -> list[CheckRequest]:
        query = select(CheckRequest).where(CheckRequest.organization_id == org_id)
        # A requester without finance.view sees only what they raised.
        if restrict_to_user is not None:
            query = query.where(CheckRequest.requested_by == restrict_to_user)
        if status:
            query = query.where(CheckRequest.status == status)
        query = (
            query.order_by(CheckRequest.created_at.desc(), CheckRequest.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_check_request(
        self,
        cr_id: str,
        org_id: str,
        for_update: bool = False,
        restrict_to_user: Optional[str] = None,
    ) -> Optional[CheckRequest]:
        """A check request by id, org-scoped.

        ``for_update`` locks the row for the caller's transaction and refreshes
        an instance already in the session (``populate_existing``): a status
        check made off a stale identity-map copy would pass for a request a
        concurrent transaction has just moved on (CLAUDE.md Pitfall #27).

        ``restrict_to_user`` confines the lookup to that member's own request,
        so somebody else's reads exactly like one that does not exist.
        """
        query = select(CheckRequest).where(
            CheckRequest.id == cr_id,
            CheckRequest.organization_id == org_id,
        )
        if restrict_to_user is not None:
            query = query.where(CheckRequest.requested_by == restrict_to_user)
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(query)
        check_request: Optional[CheckRequest] = result.scalar_one_or_none()
        return check_request

    async def create_check_request(
        self,
        org_id: str,
        requested_by: str,
        *,
        charger_id: Optional[str] = None,
        **kwargs,
    ) -> CheckRequest:
        if kwargs.get("is_advance"):
            _refuse_advance_charges(kwargs)
        await self._validate_finance_fks(org_id, kwargs)
        await assert_may_charge(self.db, org_id, charger_id, kwargs.get("budget_id"))
        await self._assert_budget_open_for_new_charges(
            org_id, [kwargs.get("budget_id")]
        )
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
        await self.require_year_accepts(fiscal_year_id, org_id, action="new")
        cr = CheckRequest(
            organization_id=org_id,
            requested_by=requested_by,
            **kwargs,
        )
        await self._flush_with_unique_number(
            cr, "request_number", org_id, "CK", fiscal_year_id
        )
        await self.db.refresh(cr, ["created_at", "updated_at"])
        return cr

    async def update_check_request(
        self, cr_id: str, org_id: str, requester_id: Optional[str] = None, **kwargs
    ) -> CheckRequest:
        cr = await self.get_check_request(
            cr_id, org_id, for_update=True, restrict_to_user=requester_id
        )
        if not cr:
            _raise_not_found("Check request", requester_id)
        await self.require_year_accepts(cr.fiscal_year_id, org_id, action="new")
        if kwargs.get("fiscal_year_id"):
            await self.require_year_accepts(
                kwargs["fiscal_year_id"], org_id, action="new"
            )
        if cr.status not in (
            CheckRequestStatus.DRAFT,
            CheckRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a check request in this status")
        if cr.is_advance:
            _refuse_advance_charges(kwargs)
        if cr.expense_report_id:
            _refuse_reimbursement_changes(cr, kwargs)
        await self._validate_finance_fks(org_id, kwargs)
        # As update_purchase_request: only a change of line is checked.
        if kwargs.get("budget_id") != cr.budget_id:
            await assert_may_charge(
                self.db, org_id, requester_id, kwargs.get("budget_id")
            )
            await self._assert_budget_open_for_new_charges(
                org_id, [kwargs.get("budget_id")]
            )
        apply_updates(cr, kwargs)
        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def submit_check_request(
        self, cr_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> CheckRequest:
        cr = await self.get_check_request(
            cr_id, org_id, for_update=True, restrict_to_user=requester_id
        )
        if not cr:
            _raise_not_found("Check request", requester_id)
        await self.require_year_accepts(cr.fiscal_year_id, org_id, action="new")
        if cr.status != CheckRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")
        await self._assert_budget_open_for_new_charges(org_id, [cr.budget_id])
        if cr.is_advance:
            await assert_no_overdue(self.db, org_id, cr.requested_by)

        await self._route_check_request(cr, org_id)
        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def _route_check_request(self, cr: CheckRequest, org_id: str) -> None:
        """Submit a check request into its approval chain."""
        cr.status = CheckRequestStatus.SUBMITTED

        chain = await self._request_chain(
            org_id, ApprovalEntityType.CHECK_REQUEST, cr.amount, cr.budget_id
        )

        if chain and chain.steps:
            cr.status = CheckRequestStatus.PENDING_APPROVAL
            await self.create_approval_records(
                chain,
                ApprovalEntityType.CHECK_REQUEST,
                cr.id,
                cr.amount,
                cr.requested_by,
            )
            all_complete = await self._check_all_steps_complete(
                ApprovalEntityType.CHECK_REQUEST, cr.id, org_id
            )
            if all_complete:
                await self._finalize_approval(
                    ApprovalEntityType.CHECK_REQUEST, cr.id, None, org_id
                )
        else:
            cr.status = CheckRequestStatus.PENDING_APPROVAL

    async def cancel_check_request(
        self, cr_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> CheckRequest:
        """Withdraw or cancel a check request that has not been issued.

        The same rule as a purchase request: a member withdraws only their own
        draft, and the finance office cancels one further along. An issued
        check is voided instead, which reverses what it moved. An unissued
        check has moved no budget total, so nothing is reversed; a cancelled
        reimbursement check leaves its report approved, to be paid again.
        """
        cr = await self.get_check_request(
            cr_id, org_id, for_update=True, restrict_to_user=requester_id
        )
        if not cr:
            _raise_not_found("Check request", requester_id)
        await self.require_year_accepts(cr.fiscal_year_id, org_id, action="finish")
        if cr.status == CheckRequestStatus.ISSUED:
            raise ValueError("An issued check is voided, not cancelled")
        if cr.status in (
            CheckRequestStatus.DENIED,
            CheckRequestStatus.VOIDED,
            CheckRequestStatus.CANCELLED,
        ):
            raise ValueError("This check request is already closed")
        if requester_id is not None and cr.status != CheckRequestStatus.DRAFT:
            raise ValueError(
                "You can withdraw your own request only while it is a draft; "
                "ask the finance office to cancel a submitted request"
            )
        cr.status = CheckRequestStatus.CANCELLED
        await self._terminate_entity_pending_steps(
            ApprovalEntityType.CHECK_REQUEST, cr.id, org_id
        )
        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def issue_check(
        self,
        cr_id: str,
        org_id: str,
        check_number: str,
        check_date: Optional[datetime] = None,
        acted_by: Optional[str] = None,
    ) -> CheckRequest:
        report = await self._lock_reimbursed_report(cr_id, org_id)
        # Locked read -- see mark_pr_paid. Two concurrent "issue" calls on the
        # same request must not both pass the APPROVED check off a plain
        # SELECT and both add the check's amount to spent.
        result = await self.db.execute(
            select(CheckRequest)
            .where(
                CheckRequest.id == cr_id,
                CheckRequest.organization_id == org_id,
            )
            .with_for_update()
        )
        cr: CheckRequest | None = result.scalar_one_or_none()
        if not cr:
            raise ValueError("Check request not found")
        # SoD (FIN-4): the person who issues the check must not be the requester.
        assert_different_person(
            acted_by, cr.requested_by, action="issue", record="check request"
        )
        if cr.status != CheckRequestStatus.APPROVED:
            raise ValueError("Only approved requests can have checks issued")
        await self.require_year_accepts(cr.fiscal_year_id, org_id, action="finish")

        cr.status = CheckRequestStatus.ISSUED
        cr.check_number = check_number
        cr.check_date = check_date or datetime.now(timezone.utc)
        if cr.expense_report_id:
            # The check is how the report is paid: the report's lines are the
            # spend, and the check (with no budget line) adds none of its own.
            if report is None or report.status != ExpenseReportStatus.APPROVED:
                raise ReimbursementLinkError(
                    "The expense report this check pays is no longer approved "
                    "and unpaid."
                )
            await self.require_year_accepts(
                report.fiscal_year_id, org_id, action="finish"
            )
            await self._settle_report(report, org_id, cr.check_date, "check")

        if cr.budget_id:
            await self._add_to_spent(cr.budget_id, cr.amount, org_id)

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def _lock_reimbursed_report(
        self, cr_id: str, org_id: str
    ) -> Optional[ExpenseReport]:
        """The report a reimbursement check pays, locked before the check is.

        Report, then check, is the order ``mark_expense_paid`` and
        ``request_reimbursement_check`` take the two locks in, so issuing or
        voiding the check cannot deadlock against them. The link itself is
        fixed at creation, so it is read without a lock.
        """
        er_id = await self.db.scalar(
            select(CheckRequest.expense_report_id).where(
                CheckRequest.id == cr_id, CheckRequest.organization_id == org_id
            )
        )
        if not er_id:
            return None
        return await self.get_expense_report(er_id, org_id, for_update=True)

    async def void_check(self, cr_id: str, org_id: str) -> CheckRequest:
        report = await self._lock_reimbursed_report(cr_id, org_id)
        # Locked read -- see mark_pr_paid/issue_check. Two concurrent "void"
        # calls on the same check must not both pass the ISSUED check off a
        # plain SELECT and both subtract the check's amount from spent.
        result = await self.db.execute(
            select(CheckRequest)
            .where(
                CheckRequest.id == cr_id,
                CheckRequest.organization_id == org_id,
            )
            .with_for_update()
        )
        cr: CheckRequest | None = result.scalar_one_or_none()
        if not cr:
            raise ValueError("Check request not found")
        await self.require_year_accepts(cr.fiscal_year_id, org_id, action="finish")
        if cr.status != CheckRequestStatus.ISSUED:
            raise ValueError("Only issued checks can be voided")
        if cr.is_advance and await is_accounted_for(self.db, org_id, cr.id):
            raise ValueError(
                "This cash advance has expense reports or returns recorded "
                "against it and cannot be voided"
            )

        cr.status = CheckRequestStatus.VOIDED
        # The date a check exported to QuickBooks is reversed on.
        cr.voided_at = datetime.now(timezone.utc)
        if report is not None and report.status == ExpenseReportStatus.PAID:
            await self._unsettle_report(report, org_id)

        # Reverse the spent amount through the same locked helper every other
        # budget mutation uses (Pitfall #27), rather than a duplicated inline
        # read-then-write on Budget.amount_spent: that plain read could answer
        # from a stale REPEATABLE READ snapshot taken before a concurrent
        # _mutate_budget writer (issue_check, mark_expense_paid) committed,
        # silently discarding that writer's spend when this write lands.
        if cr.budget_id:
            await self._mutate_budget(cr.budget_id, org_id, spent_delta=-cr.amount)

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    # ========================================
    # Cash Advances
    # ========================================

    async def _advance_rows(
        self, org_id: str, advance_ids: list[str]
    ) -> dict[str, tuple[CheckRequest, str]]:
        """Each advance with its member's display name."""
        if not advance_ids:
            return {}
        result = await self.db.execute(
            select(
                CheckRequest,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
            )
            .outerjoin(
                User,
                and_(
                    User.id == CheckRequest.requested_by,
                    User.organization_id == org_id,
                ),
            )
            .where(
                CheckRequest.organization_id == org_id,
                CheckRequest.id.in_(advance_ids),
            )
        )
        return {
            cr.id: (
                cr,
                format_display_name(first, last, preferred) or username or "",
            )
            for cr, first, last, preferred, username in result.all()
        }

    @staticmethod
    def _advance_summary(cr: CheckRequest, member: str, balance) -> dict:
        return {
            "id": cr.id,
            "request_number": cr.request_number,
            "member_id": cr.requested_by,
            "member_name": member,
            "amount": balance.amount,
            "purpose": cr.purpose or cr.memo,
            "check_number": cr.check_number,
            "issued_at": cr.check_date,
            "due_at": balance.due_at,
            "accounted": balance.accounted,
            "returned": balance.returned,
            "outstanding": balance.outstanding,
            "overdue": balance.overdue,
        }

    async def list_advances(
        self,
        org_id: str,
        restrict_to_user: Optional[str] = None,
        outstanding_only: bool = False,
    ) -> list[dict]:
        """Every issued cash advance with its balance, oldest first."""
        balances = await advance_balances(self.db, org_id, member_id=restrict_to_user)
        if outstanding_only:
            balances = {k: b for k, b in balances.items() if b.outstanding > 0}
        rows = await self._advance_rows(org_id, list(balances))
        return [
            self._advance_summary(*rows[advance_id], balance)
            for advance_id, balance in balances.items()
            if advance_id in rows
        ]

    async def get_advance(
        self, org_id: str, advance_id: str, restrict_to_user: Optional[str] = None
    ) -> dict:
        """An issued advance's balance, the reports that account for it and
        the cash returned against it."""
        balances = await advance_balances(
            self.db, org_id, advance_ids=[advance_id], member_id=restrict_to_user
        )
        balance = balances.get(advance_id)
        if balance is None:
            raise FinanceEntityNotFoundError("Cash advance not found")
        cr, member = (await self._advance_rows(org_id, [advance_id]))[advance_id]
        reports = await self.db.execute(
            select(ExpenseReport)
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.advance_id == advance_id,
            )
            .order_by(ExpenseReport.created_at, ExpenseReport.id)
        )
        returns = await self.db.execute(
            select(AdvanceReturn)
            .where(
                AdvanceReturn.organization_id == org_id,
                AdvanceReturn.advance_id == advance_id,
            )
            .order_by(AdvanceReturn.returned_at, AdvanceReturn.id)
        )
        return {
            **self._advance_summary(cr, member, balance),
            "reports": [
                {
                    "id": er.id,
                    "report_number": er.report_number,
                    "title": er.title,
                    "status": er.status.value,
                    "total_amount": er.total_amount,
                    "advance_applied": er.advance_applied,
                    "submitted_at": er.submitted_at,
                }
                for er in reports.scalars()
            ],
            "returns": list(returns.scalars()),
        }

    async def record_advance_return(
        self,
        org_id: str,
        advance_id: str,
        recorded_by: str,
        amount: Decimal,
        returned_at: Optional[datetime] = None,
        payment_method: Optional[str] = None,
        reference: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AdvanceReturn:
        """Record unspent cash the member handed back.

        The advance's row is locked and its balance read through locking
        reads before the return is checked against it, so two entries of one
        return cannot together take the advance below zero (pitfall #27).
        """
        advance = await lock_advance(self.db, org_id, advance_id)
        if advance is None or advance.status != CheckRequestStatus.ISSUED:
            raise FinanceEntityNotFoundError("Cash advance not found")
        # SoD (FIN-4): the member who owes the money does not record that it
        # came back.
        assert_different_person(
            recorded_by,
            advance.requested_by,
            action="record a return on",
            record="cash advance",
        )
        # No fiscal-year check: a return moves no budget figure, and an advance
        # still owed when its year is locked must still be able to come back.
        now = datetime.now(timezone.utc)
        when = returned_at or now
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when > now:
            raise ValueError("A return cannot be dated in the future")
        if advance.check_date is not None and when < _aware_utc(advance.check_date):
            raise ValueError("A return cannot be dated before the advance was issued")
        balance = (
            await advance_balances(self.db, org_id, advance_ids=[advance_id], lock=True)
        )[advance_id]
        value = _qb_amount(amount)
        if value > balance.outstanding:
            raise ValueError(
                f"Only {balance.outstanding:,.2f} of this advance is outstanding"
            )
        entry = AdvanceReturn(
            organization_id=org_id,
            advance_id=advance_id,
            amount=value,
            returned_at=when,
            payment_method=payment_method,
            reference=reference,
            notes=notes,
            recorded_by=recorded_by,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry, ["created_at"])
        return entry

    async def delete_advance_return(
        self, org_id: str, advance_id: str, return_id: str
    ) -> AdvanceReturn:
        """Remove a return recorded by mistake, until an export carries it."""
        advance = await lock_advance(self.db, org_id, advance_id)
        if advance is None:
            raise FinanceEntityNotFoundError("Cash advance not found")
        result = await self.db.execute(
            select(AdvanceReturn)
            .where(
                AdvanceReturn.id == return_id,
                AdvanceReturn.advance_id == advance_id,
                AdvanceReturn.organization_id == org_id,
            )
            .with_for_update()
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise FinanceEntityNotFoundError("Return not found")
        if entry.qb_exported_at is not None:
            raise ValueError(
                "This return has been exported to QuickBooks and cannot be removed"
            )
        await self.db.delete(entry)
        await self.db.flush()
        return entry

    # ========================================
    # Dues & Assessments
    # ========================================

    async def list_dues_schedules(
        self, org_id: str, pagination: PaginationParams
    ) -> list[DuesSchedule]:
        result = await self.db.execute(
            select(DuesSchedule)
            .where(DuesSchedule.organization_id == org_id)
            .order_by(DuesSchedule.due_date.desc(), DuesSchedule.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().all())

    async def get_dues_schedule(
        self, schedule_id: str, org_id: str
    ) -> Optional[DuesSchedule]:
        result = await self.db.execute(
            select(DuesSchedule)
            .options(selectinload(DuesSchedule.member_dues))
            .where(
                DuesSchedule.id == schedule_id,
                DuesSchedule.organization_id == org_id,
            )
        )
        dues_schedule: Optional[DuesSchedule] = result.scalar_one_or_none()
        return dues_schedule

    async def create_dues_schedule(
        self, org_id: str, created_by: str, **kwargs
    ) -> DuesSchedule:
        await self._validate_finance_fks(org_id, kwargs)
        _refuse_unusable_accounts(
            kwargs.get("qb_income_account"), kwargs.get("qb_deposit_account")
        )
        schedule = DuesSchedule(organization_id=org_id, created_by=created_by, **kwargs)
        self.db.add(schedule)
        await self.db.flush()
        await self.db.refresh(schedule, ["created_at", "updated_at"])
        return schedule

    async def update_dues_schedule(
        self, schedule_id: str, org_id: str, **kwargs
    ) -> DuesSchedule:
        schedule = await self.get_dues_schedule(schedule_id, org_id)
        if not schedule:
            raise ValueError("Dues schedule not found")
        await self._validate_finance_fks(org_id, kwargs)
        _refuse_unusable_accounts(
            kwargs.get("qb_income_account"), kwargs.get("qb_deposit_account")
        )
        apply_updates(schedule, kwargs)
        await self.db.flush()
        await self.db.refresh(schedule, ["updated_at"])
        return schedule

    async def generate_member_dues(self, schedule_id: str, org_id: str) -> int:
        """Bulk-create member_dues records for all eligible members"""
        schedule = await self.get_dues_schedule(schedule_id, org_id)
        if not schedule:
            raise ValueError("Dues schedule not found")

        # Get eligible members
        query = select(User).where(
            User.organization_id == org_id,
            User.is_active,
        )
        result = await self.db.execute(query)
        users = list(result.scalars().all())

        # A schedule entered with a due date already past bills its members as
        # overdue straight away. Left PENDING, they read "Pending" until the
        # daily run_mark_overdue_dues, so a treasurer generating last spring's
        # dues saw nobody behind and the Overdue filter came back empty (W66).
        due = schedule.due_date
        if due is not None and due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        initial_status = (
            DuesStatus.OVERDUE
            if due is not None and due < datetime.now(timezone.utc)
            else DuesStatus.PENDING
        )

        count = 0
        for user in users:
            # Check if dues already exist for this user + schedule
            existing = await self.db.execute(
                select(MemberDues).where(
                    MemberDues.dues_schedule_id == schedule_id,
                    MemberDues.user_id == user.id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            dues = MemberDues(
                organization_id=org_id,
                dues_schedule_id=schedule_id,
                user_id=user.id,
                amount_due=schedule.amount,
                due_date=schedule.due_date,
                status=initial_status,
            )
            self.db.add(dues)
            count += 1

        await self.db.flush()
        logger.info("Generated {} member dues for schedule {}", count, schedule_id)
        return count

    async def list_member_dues(
        self,
        org_id: str,
        pagination: PaginationParams,
        schedule_id: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        """Member dues rows, each with the member's display name.

        The name rides along because the dues screen is read by a Treasurer
        who holds ``finance.manage`` but not necessarily ``users.view``, so it
        cannot look members up itself and would otherwise show a bare id.
        """
        query = (
            select(
                MemberDues,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
            )
            .outerjoin(User, User.id == MemberDues.user_id)
            .where(MemberDues.organization_id == org_id)
        )
        if schedule_id:
            query = query.where(MemberDues.dues_schedule_id == schedule_id)
        if user_id:
            query = query.where(MemberDues.user_id == user_id)
        now = datetime.now(timezone.utc)
        if status == DuesStatus.OVERDUE:
            query = query.where(dues_overdue_clause(now))
        elif status == DuesStatus.PENDING:
            query = query.where(
                MemberDues.status == DuesStatus.PENDING,
                ~dues_past_due_unpaid_clause(now),
            )
        elif status:
            query = query.where(MemberDues.status == status)
        query = (
            query.order_by(MemberDues.due_date.desc(), MemberDues.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        result = await self.db.execute(query)
        rows = []
        for dues, first_name, last_name, preferred_name, username in result.all():
            data = {
                column.key: getattr(dues, column.key)
                for column in MemberDues.__table__.columns
            }
            data["status"] = effective_dues_status(
                dues.status, dues.due_date, dues.amount_paid, dues.amount_due, now
            )
            name = format_display_name(first_name, last_name, preferred_name)
            data["member_name"] = name or username or None
            rows.append(data)
        return rows

    async def record_dues_payment(
        self,
        dues_id: str,
        org_id: str,
        recorded_by: Optional[str] = None,
        **kwargs,
    ) -> MemberDues:
        """Append a payment to the dues ledger and re-derive the totals.

        Idempotent on ``transaction_reference``: re-submitting a payment that
        already exists against these dues returns the record untouched rather
        than crediting it twice. A payment with no reference — cash at a
        meeting — cannot be deduplicated and is always appended, which is why
        the reference is the thing worth capturing.
        """
        # Locked: amount_paid/status are recomputed from dues.payments below
        # (_apply_payment_totals), not accumulated. Two concurrent payments
        # against the same dues row would otherwise both read the ledger
        # before either commits, both append their own row, and the second to
        # flush would overwrite amount_paid with a total that excludes the
        # first payment -- the ledger row itself would still exist, but the
        # cached total silently drops it (CLAUDE.md Pitfall #27, same shape
        # FIN-31 fixed for Budget). The lock serializes this exactly like
        # approve_step/_mutate_budget already do.
        result = await self.db.execute(
            select(MemberDues)
            .where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
            .options(selectinload(MemberDues.payments))
            .with_for_update()
        )
        dues: MemberDues | None = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")

        # SoD (FIN-4 / OPS-8): settling dues is a money movement, so the person
        # recording it must not be the member who owes it -- the same rule
        # waive_dues applies to this record and StorefrontService.record_payment
        # applies to an order. The owner chose this same-person guard over a
        # separate disbursement permission. recorded_by is Optional so an
        # unattributed reconciliation path passes through untouched.
        assert_different_person(
            recorded_by, dues.user_id, action="record a payment on", record="dues"
        )

        # FIN-6: a record that is not owing must not be silently converted into
        # one that was paid. Recording a payment here used to recompute status
        # to PAID/PARTIAL while leaving waived_by / waived_at / waive_reason
        # populated — a self-contradictory row — and because the dues summary
        # derives total_waived from `status == WAIVED`, the waived amount
        # silently moved into collections with nothing recording that it had
        # ever been waived. Refuse instead: reversing a waiver is a deliberate
        # act, not a side effect of entering a payment.
        if dues.status in (DuesStatus.WAIVED, DuesStatus.EXEMPT):
            raise ValueError(
                f"These dues are marked {dues.status.value} and are not owing. "
                "Reverse that first if payment was received in error."
            )

        balance = max(
            dues.amount_due - (dues.amount_paid or Decimal("0")), Decimal("0")
        )
        reference = kwargs.get("transaction_reference")
        if reference and (
            any(payment.transaction_reference == reference for payment in dues.payments)
            # Paid in full already, so a confirmed overpayment wrote no ledger
            # row and only its donation carries the reference.
            or (
                not balance and await self._dues_excess_donation_exists(dues, reference)
            )
        ):
            # Already recorded. Returning the current state — rather than
            # raising — is what makes a retried or double-clicked submission
            # safe, which is the entire point of capturing the reference.
            logger.info(
                f"Dues payment {reference!r} already recorded against {dues_id}; "
                "ignoring duplicate submission"
            )
            return dues

        amount = Decimal(str(kwargs.get("amount_paid", 0)))
        # W66-3, owner decision 2026-10-27: an overpayment is warned about and
        # allowed, and what exceeds the balance is a donation from the member,
        # not dues collected. The screen warns before it sends; this refusal is
        # for any caller that did not.
        excess = max(amount - balance, Decimal("0"))
        if excess and not kwargs.get("excess_as_donation"):
            raise ValueError(
                f"This payment is ${excess:.2f} more than the ${balance:.2f} still "
                "owed. Confirm to record the extra as a donation."
            )
        notes = kwargs.get("notes")
        if excess:
            note = f"Overpaid by ${excess:.2f}; the extra was recorded as a donation."
            notes = f"{notes}\n{note}" if notes else note

        dues_portion = amount - excess
        if dues_portion > 0:
            payment = DuesPayment(
                organization_id=dues.organization_id,
                member_dues_id=dues.id,
                amount=dues_portion,
                payment_method=kwargs.get("payment_method"),
                transaction_reference=reference,
                notes=notes,
                received_at=datetime.now(timezone.utc),
                recorded_by=recorded_by,
            )
            dues.payments.append(payment)

            _apply_payment_totals(dues)

        if excess:
            await self._record_dues_excess_as_donation(
                dues, excess, kwargs.get("payment_method"), reference, recorded_by
            )

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

    async def _member_donor(self, dues: MemberDues) -> Optional[str]:
        """The member's donor record, created from their account if they have none."""
        from app.models.grant import Donor, DonorType
        from app.services.fundraising_service import FundraisingService

        existing = await self.db.scalar(
            select(Donor.id)
            .where(
                Donor.organization_id == dues.organization_id,
                Donor.user_id == dues.user_id,
            )
            .order_by(Donor.created_at)
            .limit(1)
        )
        if existing:
            return str(existing)
        member = await self.db.get(User, dues.user_id)
        if member is None:
            return None
        donor = await FundraisingService(self.db).create_donor(
            dues.organization_id,
            {
                "user_id": member.id,
                "donor_type": DonorType.INDIVIDUAL,
                "first_name": member.first_name,
                "last_name": member.last_name,
                "email": member.email,
            },
        )
        return str(donor.id)

    async def _dues_excess_donation_exists(
        self, dues: MemberDues, reference: str
    ) -> bool:
        """Whether a retried overpayment already recorded its donation.

        Needed besides the ledger check above: when the dues were already paid
        in full, the whole payment is the donation and no ledger row exists.
        """
        from app.models.grant import Donation

        recorded = await self.db.scalars(
            select(Donation.custom_fields).where(
                Donation.organization_id == dues.organization_id,
                Donation.transaction_id == reference,
            )
        )
        return any(
            isinstance(fields, dict) and fields.get("dues_id") == str(dues.id)
            for fields in recorded
        )

    async def _record_dues_excess_as_donation(
        self,
        dues: MemberDues,
        excess: Decimal,
        payment_method: Optional[str],
        reference: Optional[str],
        recorded_by: Optional[str],
    ) -> None:
        """Record what a dues payment paid beyond the balance as a donation.

        No campaign (owner decision): it is a general gift. ``custom_fields``
        names the dues it came from, which is also how a retried submission
        recognises the donation it already recorded.
        """
        from app.models.grant import PaymentMethod, PaymentStatus
        from app.services.fundraising_service import FundraisingService

        method = (
            PaymentMethod(payment_method)
            if payment_method in {m.value for m in PaymentMethod}
            else PaymentMethod.OTHER
        )
        await FundraisingService(self.db).create_donation(
            dues.organization_id,
            {
                "donor_id": await self._member_donor(dues),
                "campaign_id": None,
                "amount": excess,
                "donation_date": datetime.now(timezone.utc),
                "payment_method": method,
                "payment_status": PaymentStatus.COMPLETED,
                "transaction_id": reference,
                "notes": "Overpayment of member dues, recorded as a donation.",
                "custom_fields": {"dues_id": str(dues.id)},
            },
            recorded_by,
        )

    async def list_dues_payments(
        self, dues_id: str, org_id: str, viewer_user_id: Optional[str] = None
    ) -> list[DuesPayment]:
        """Return the payment ledger for one member's dues, oldest first."""
        filters = [
            MemberDues.id == dues_id,
            MemberDues.organization_id == org_id,
        ]
        if viewer_user_id is not None:
            filters.append(MemberDues.user_id == viewer_user_id)
        result = await self.db.execute(
            select(MemberDues)
            .where(*filters)
            .options(selectinload(MemberDues.payments))
        )
        dues = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")
        return list(dues.payments)

    async def waive_dues(
        self,
        dues_id: str,
        org_id: str,
        waived_by: str,
        reason: str,
    ) -> MemberDues:
        # Locked like the payment path it races with, so two officers waiving
        # together serialize and the second sees the first's waiver.
        result = await self.db.execute(
            select(MemberDues)
            .where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
            .with_for_update()
        )
        dues: MemberDues | None = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")
        # SoD (FIN-4): a member must not waive their own dues.
        assert_different_person(waived_by, dues.user_id, action="waive", record="dues")

        # A repeat would replace who granted the waiver, when and why with the
        # second caller's; reversing it first (unwaive_dues) is the way to
        # re-record one.
        if dues.status == DuesStatus.WAIVED:
            raise ValueError("These dues are already waived.")

        dues.status = DuesStatus.WAIVED
        dues.waived_by = waived_by
        dues.waived_at = datetime.now(timezone.utc)
        dues.waive_reason = reason

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

    async def unwaive_dues(
        self,
        dues_id: str,
        org_id: str,
        reason: str,
    ) -> MemberDues:
        """Reverse a waiver, returning the record to what its ledger says.

        Recording a payment against waived dues is refused, so without this
        there is no way out of WAIVED: ``PUT /dues/{id}`` is the payment route
        and the only other dues endpoint is the waive itself. A department that
        waived by mistake and then received the money had no in-app remedy.

        The free-text waive reason is erased rather than retained on an
        un-waived record or copied into the immutable audit log. Waiver reasons
        may contain sensitive personal information and must remain eligible for
        the application's privacy scrubbing guarantees.
        """
        result = await self.db.execute(
            select(MemberDues)
            .where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
            .options(selectinload(MemberDues.payments))
        )
        dues: MemberDues | None = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")

        if dues.status != DuesStatus.WAIVED:
            raise ValueError(
                "These dues are not waived, so there is nothing to reverse."
            )

        dues.waived_by = None
        dues.waived_at = None
        dues.waive_reason = None

        # The ledger decides what the record becomes — PENDING when nothing was
        # ever paid, PARTIAL or PAID when something was. Nothing to guess.
        _apply_payment_totals(dues)

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

    async def get_dues_summary(
        self, org_id: str, schedule_id: Optional[str] = None
    ) -> dict:
        query = select(MemberDues).where(MemberDues.organization_id == org_id)
        if schedule_id:
            query = query.where(MemberDues.dues_schedule_id == schedule_id)
        result = await self.db.execute(query)
        all_dues = list(result.scalars().all())

        now = datetime.now(timezone.utc)
        total_expected = sum((d.amount_due for d in all_dues), Decimal("0.00"))
        total_collected = sum((d.amount_paid for d in all_dues), Decimal("0.00"))
        total_waived = sum(
            (d.amount_due for d in all_dues if d.status == DuesStatus.WAIVED),
            Decimal("0.00"),
        )
        total_outstanding = total_expected - total_collected - total_waived
        collection_rate = (
            (total_collected / total_expected * 100) if total_expected > 0 else 0
        )

        return {
            "total_expected": total_expected,
            "total_collected": total_collected,
            "total_outstanding": total_outstanding,
            "total_waived": total_waived,
            "collection_rate": round(float(collection_rate), 2),
            "members_paid": sum(1 for d in all_dues if d.status == DuesStatus.PAID),
            "members_overdue": sum(
                1
                for d in all_dues
                if effective_dues_status(
                    d.status, d.due_date, d.amount_paid, d.amount_due, now
                )
                == DuesStatus.OVERDUE
            ),
            "members_waived": sum(1 for d in all_dues if d.status == DuesStatus.WAIVED),
        }

    # ========================================
    # Export
    # ========================================

    async def list_export_mappings(
        self, org_id: str, pagination: PaginationParams
    ) -> list[ExportMapping]:
        result = await self.db.execute(
            select(ExportMapping)
            .where(ExportMapping.organization_id == org_id)
            .order_by(ExportMapping.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().all())

    async def create_export_mapping(self, org_id: str, **kwargs) -> ExportMapping:
        _refuse_unusable_accounts(
            kwargs.get("qb_account_name"), kwargs.get("qb_offset_account_name")
        )
        mapping = ExportMapping(organization_id=org_id, **kwargs)
        self.db.add(mapping)
        await self.db.flush()
        await self.db.refresh(mapping, ["created_at", "updated_at"])
        return mapping

    async def update_export_mapping(
        self, mapping_id: str, org_id: str, **kwargs
    ) -> ExportMapping:
        result = await self.db.execute(
            select(ExportMapping).where(
                ExportMapping.id == mapping_id,
                ExportMapping.organization_id == org_id,
            )
        )
        mapping: ExportMapping | None = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Export mapping not found")
        _refuse_unusable_accounts(
            kwargs.get("qb_account_name"), kwargs.get("qb_offset_account_name")
        )
        apply_updates(mapping, kwargs)
        await self.db.flush()
        await self.db.refresh(mapping, ["updated_at"])
        return mapping

    async def delete_export_mapping(self, mapping_id: str, org_id: str) -> None:
        result = await self.db.execute(
            select(ExportMapping).where(
                ExportMapping.id == mapping_id,
                ExportMapping.organization_id == org_id,
            )
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Export mapping not found")
        await self.db.delete(mapping)
        await self.db.flush()

    async def _export_mappings_by_category(
        self, org_id: str
    ) -> dict[str, list[ExportMapping]]:
        result = await self.db.execute(
            select(ExportMapping)
            .where(ExportMapping.organization_id == org_id)
            .order_by(ExportMapping.id)
        )
        mappings: dict[str, list[ExportMapping]] = {}
        for mapping in result.scalars():
            mappings.setdefault(_mapping_key(mapping.internal_category), []).append(
                mapping
            )
        return mappings

    async def get_export_readiness(self, org_id: str) -> dict:
        """Report, per budget category, what an export would post it to.

        Built on the export's own classifier, so a category reported ready is
        one the export accepts. Mappings whose ``internal_category`` names no
        category are listed separately: they are never used.
        """
        result = await self.db.execute(
            select(BudgetCategory)
            .where(BudgetCategory.organization_id == org_id)
            .order_by(BudgetCategory.sort_order, BudgetCategory.name)
        )
        categories = list(result.scalars())
        mappings = await self._export_mappings_by_category(org_id)
        chart = await self._chart(org_id)
        accounts = _resolve_category_accounts(categories, mappings, chart)

        rows = []
        for category in categories:
            resolved = accounts[category.id]
            matches = mappings.get(_mapping_key(category.name), [])
            rows.append(
                {
                    "category_id": category.id,
                    "category_name": category.name,
                    "is_active": category.is_active,
                    "status": resolved.problem or "ready",
                    "account_name": resolved.account or None,
                    "account_source": resolved.account_source,
                    "account_inherited_from": resolved.account_inherited_from,
                    "offset_account_name": resolved.offset or None,
                    "offset_inherited_from": resolved.offset_inherited_from,
                    "accounts_not_in_chart": list(resolved.not_in_chart),
                    "mapping_ids": [m.id for m in matches],
                }
            )

        category_keys = {_mapping_key(c.name) for c in categories}
        unmatched = [
            mapping.id
            for key, group in mappings.items()
            if key not in category_keys
            for mapping in group
        ]
        return {
            "categories": rows,
            "unmatched_mapping_ids": unmatched,
            "dues": await self._dues_accounts(org_id),
            "advances": await self._advance_accounts(org_id),
            "chart_uploaded": chart is not None,
        }

    async def _resolve_export_accounts(
        self, org_id: str, sources: list, extra_issues: Optional[list[str]] = None
    ) -> dict[str, tuple[str, str]]:
        """Map each exported budget line to its (account, offset) QuickBooks pair.

        ``sources`` are selects of ``(document number, budget_id)``. The
        account comes from the category's own ``qb_account_name`` and falls
        back to the export mapping named after the category; the offset only
        exists on the mapping. Any transaction that cannot be given both
        refuses the whole export: an import missing a row is a ledger that
        silently disagrees with this one, which is worse than no import.
        """
        rows: list = []
        for statement in sources:
            rows.extend((await self.db.execute(statement)).all())
        # Problems found elsewhere (dues schedules, cash-advance accounts)
        # refuse the export in the same message, so the treasurer sees
        # everything to fix at once.
        extra_issues = list(extra_issues or [])
        if not rows and not extra_issues:
            return {}

        budget_ids = {budget_id for _, budget_id in rows if budget_id is not None}
        line_categories: dict[str, str] = {}
        if budget_ids:
            result = await self.db.execute(
                select(Budget.id, Budget.category_id)
                .join(BudgetCategory, Budget.category_id == BudgetCategory.id)
                .where(
                    Budget.id.in_(budget_ids),
                    Budget.organization_id == org_id,
                    BudgetCategory.organization_id == org_id,
                )
            )
            line_categories = {row[0]: row[1] for row in result.all()}
        unbudgeted = sorted(
            {number for number, budget_id in rows if budget_id not in line_categories}
        )

        # Every category, not only the exported ones: a subcategory's accounts
        # can come from an ancestor nothing was charged to.
        category_rows = await self.db.execute(
            select(BudgetCategory).where(BudgetCategory.organization_id == org_id)
        )
        all_categories = list(category_rows.scalars())
        names = {c.id: c.name for c in all_categories}
        mappings = await self._export_mappings_by_category(org_id)
        accounts = _resolve_category_accounts(
            all_categories, mappings, await self._chart(org_id)
        )

        resolved: dict[str, tuple[str, str]] = {}
        problems: dict[str, str] = {}
        for budget_id, category_id in line_categories.items():
            name = names[category_id]
            label = _short_label(name)
            matches = mappings.get(_mapping_key(name), [])
            category_accounts = accounts[category_id]
            account, offset, problem = (
                category_accounts.account,
                category_accounts.offset,
                category_accounts.problem,
            )
            if problem == "duplicate_mappings":
                problems[name] = f"'{label}' has {len(matches)} mappings"
            elif problem == "no_account":
                problems[name] = f"'{label}' has no account"
            elif problem == "no_offset":
                problems[name] = f"'{label}' has no offset account"
            elif problem == "payable_receivable":
                problems[name] = f"'{label}' posts to Accounts Payable or Receivable"
            elif problem == "unsafe_account_name":
                problems[name] = f"'{label}' has an account starting with =, +, - or @"
            elif problem == "not_in_chart":
                problems[name] = (
                    f"'{label}' posts to {_quoted(category_accounts.not_in_chart)}, "
                    "not in the uploaded chart of accounts"
                )
            else:
                resolved[budget_id] = (account, offset)

        issues = [problems[name] for name in sorted(problems)] + extra_issues
        if unbudgeted:
            shown = ", ".join(unbudgeted[:3]) + (", ..." if len(unbudgeted) > 3 else "")
            issues.insert(
                0, f"{len(unbudgeted)} transactions with no budget line ({shown})"
            )
        if issues:
            message = "Set QuickBooks accounts before exporting: " + "; ".join(
                issues[:3]
            )
            if len(issues) > 3:
                message += f"; and {len(issues) - 3} more"
            # safe_error_detail replaces anything longer with a generic error,
            # which would hide what needs fixing.
            if len(message) > 300:
                message = (
                    f"Set QuickBooks accounts before exporting: {len(problems)} "
                    f"budget categories, {len(extra_issues)} dues or advance "
                    "settings and "
                    f"{len(unbudgeted)} transactions without a budget line need "
                    "accounts"
                )
            raise ValueError(message)
        return resolved

    async def generate_export(
        self,
        org_id: str,
        exported_by: str,
        date_start: datetime,
        date_end: datetime,
        file_format: str = "csv",
        batch_size: int = 500,
        max_rows: int = QB_IMPORT_MAX_ROWS,
        include_exported: bool = False,
        confirm_reimport: bool = False,
    ) -> AsyncIterator[str]:
        """Prepare a bounded export and return its incremental CSV stream.

        A payment a complete export already carried is left out unless
        ``include_exported``: QuickBooks imports a second copy without
        complaint (the duplicate-number warning has to be off for this
        import), so exporting overlapping periods would double the books. A
        check voided after it was exported gets a reversing entry, dated the
        day it was voided, in the export covering that day.

        Payments are stamped as exported only once the whole file has been
        produced; an interrupted stream stamps nothing, so its payments go out
        again with the next export.

        Sending again payments whose file the Treasurer confirmed was imported
        into QuickBooks is refused (``ReimportConfirmationRequired``) unless
        ``confirm_reimport``: those are the ones a second import doubles.
        """
        pr_filters = [
            PurchaseRequest.organization_id == org_id,
            PurchaseRequest.status == PurchaseRequestStatus.PAID,
            PurchaseRequest.paid_at >= date_start,
            PurchaseRequest.paid_at <= date_end,
        ]
        cr_filters = [
            CheckRequest.organization_id == org_id,
            CheckRequest.check_date >= date_start,
            CheckRequest.check_date <= date_end,
        ]
        er_filters = [
            ExpenseReport.organization_id == org_id,
            ExpenseReport.status == ExpenseReportStatus.PAID,
            ExpenseReport.paid_at >= date_start,
            ExpenseReport.paid_at <= date_end,
            # A report a reimbursement check paid goes out as that check's
            # entry, so a void can reverse it (finance_reimbursement.py).
            ~exists().where(
                CheckRequest.organization_id == org_id,
                CheckRequest.expense_report_id == ExpenseReport.id,
                CheckRequest.status == CheckRequestStatus.ISSUED,
            ),
        ]
        # Dues received in the period: money in, debited to the deposit
        # account and credited to the schedule's income account.
        dues_filters = [
            DuesPayment.organization_id == org_id,
            DuesPayment.received_at >= date_start,
            DuesPayment.received_at <= date_end,
        ]
        # Reversals of checks voided after QuickBooks received them. A check
        # voided before it was ever exported needs nothing: it is in neither
        # file, so the books never saw it.
        void_filters = [
            CheckRequest.organization_id == org_id,
            CheckRequest.status == CheckRequestStatus.VOIDED,
            CheckRequest.qb_exported_at.is_not(None),
            CheckRequest.voided_at >= date_start,
            CheckRequest.voided_at <= date_end,
        ]
        # Unspent cash handed back against a cash advance: debited to the bank
        # and credited to the advances account.
        return_filters = [
            AdvanceReturn.organization_id == org_id,
            AdvanceReturn.returned_at >= date_start,
            AdvanceReturn.returned_at <= date_end,
        ]
        if include_exported:
            # Sending a period again reproduces what was sent for it: a check
            # voided since still had its original entry in that file.
            cr_filters.append(
                or_(
                    CheckRequest.status == CheckRequestStatus.ISSUED,
                    and_(
                        CheckRequest.status == CheckRequestStatus.VOIDED,
                        CheckRequest.qb_exported_at.is_not(None),
                    ),
                )
            )
        else:
            pr_filters.append(PurchaseRequest.qb_exported_at.is_(None))
            cr_filters.extend(
                [
                    CheckRequest.status == CheckRequestStatus.ISSUED,
                    CheckRequest.qb_exported_at.is_(None),
                ]
            )
            er_filters.append(ExpenseReport.qb_exported_at.is_(None))
            void_filters.append(CheckRequest.qb_void_exported_at.is_(None))
            dues_filters.append(DuesPayment.qb_exported_at.is_(None))
            return_filters.append(AdvanceReturn.qb_exported_at.is_(None))

        pr_count = await self.db.scalar(
            select(func.count()).select_from(PurchaseRequest).where(*pr_filters)
        )
        plain_check = CheckRequest.expense_report_id.is_(None)
        cr_count = await self.db.scalar(
            select(func.count())
            .select_from(CheckRequest)
            .where(*cr_filters, plain_check)
        )
        # Few enough to hold at once: each is at least two of the file's rows.
        reimbursements = list(
            (
                await self.db.execute(
                    select(CheckRequest)
                    .where(*cr_filters, CheckRequest.expense_report_id.is_not(None))
                    .order_by(CheckRequest.check_date, CheckRequest.id)
                )
            ).scalars()
        )
        reimbursed_reports = await self._reimbursed_reports(
            org_id,
            [cr.expense_report_id for cr in reimbursements if not cr.qb_export_entry],
        )
        reimbursement_voids = list(
            (
                await self.db.execute(
                    select(CheckRequest).where(
                        *void_filters, CheckRequest.expense_report_id.is_not(None)
                    )
                )
            ).scalars()
        )
        if any(not cr.qb_export_entry for cr in reimbursement_voids):
            # Every export of one records its entry, so this is a row edited
            # by hand; reversing a guess would unbalance the books.
            raise ValueError(
                "A voided reimbursement check has no record of the entry "
                "QuickBooks received, so its reversal cannot be exported"
            )
        line_count = await self.db.scalar(
            select(func.count())
            .select_from(ExpenseLineItem)
            .join(ExpenseReport)
            .where(*er_filters)
        )
        void_count = await self.db.scalar(
            select(func.count())
            .select_from(CheckRequest)
            .where(*void_filters, plain_check)
        )
        dues_setup = await self._dues_accounts(org_id)
        dues_count = (
            await self.db.scalar(
                select(func.count()).select_from(DuesPayment).where(*dues_filters)
            )
            if dues_setup["enabled"]
            else 0
        )
        return_count = await self.db.scalar(
            select(func.count()).select_from(AdvanceReturn).where(*return_filters)
        )
        if include_exported and not confirm_reimport:
            reimported = await self._count_confirmed_imported(
                pr_filters,
                cr_filters,
                er_filters,
                void_filters,
                dues_filters if dues_setup["enabled"] else None,
                return_filters,
                org_id,
            )
            if reimported:
                raise ReimportConfirmationRequired(reimported)
        # Reports that account for a cash advance, and advances not yet given
        # the accounts they were exported to.
        settling_count = int(
            await self.db.scalar(
                select(func.count())
                .select_from(ExpenseReport)
                .where(*er_filters, ExpenseReport.advance_applied > 0)
            )
            or 0
        ) + sum(
            1
            for er in reimbursed_reports.values()
            if er.advance_applied and er.advance_applied > 0
        )
        new_advance_count = await self.db.scalar(
            select(func.count())
            .select_from(CheckRequest)
            .where(
                *cr_filters,
                CheckRequest.is_advance.is_(True),
                CheckRequest.qb_export_account.is_(None),
            )
        )
        total = (
            int(pr_count or 0)
            + int(cr_count or 0)
            + int(line_count or 0)
            + int(void_count or 0)
            + int(dues_count or 0)
            + int(return_count or 0)
        )
        # Two rows per transaction (or expense line) plus the header, and one
        # more per report settling an advance: the line the advance runs out
        # on is paid partly from it and partly from the bank. A file
        # QuickBooks will not import is no use, and splitting one would let an
        # expense report's entry straddle two files, so refuse instead.
        # A reimbursement check carries its report's whole entry: two rows a
        # line (counted with the settling reports above when an advance splits
        # one), or exactly the rows it recorded when it was first sent.
        reimbursement_rows = sum(
            len(cr.qb_export_entry or [])
            for cr in [*reimbursements, *reimbursement_voids]
        ) + sum(2 * len(report.line_items) for report in reimbursed_reports.values())
        rows = 2 * total + int(settling_count or 0) + reimbursement_rows + 1
        if rows > max_rows:
            raise ValueError(
                f"QuickBooks Online imports files of fewer than {max_rows + 1:,} "
                f"rows; this period would produce {rows:,}. Export a shorter "
                "period, then the rest."
            )
        # Resolved before the log row so a refusal leaves no pending export.
        # A check that carries the accounts it was exported to is posted (or
        # reversed) against those, and needs no resolving.
        dues_accounts: dict[str, tuple[str, str]] = {}
        other_issues: list[str] = []
        if dues_count:
            exported_schedules = set(
                (
                    await self.db.execute(
                        select(MemberDues.dues_schedule_id)
                        .join(DuesPayment, DuesPayment.member_dues_id == MemberDues.id)
                        .where(*dues_filters, MemberDues.organization_id == org_id)
                        .distinct()
                    )
                ).scalars()
            )
            for row in dues_setup["schedules"]:
                if row["schedule_id"] not in exported_schedules:
                    continue
                label = _short_label(row["name"])
                if row["status"] == "ready":
                    dues_accounts[row["schedule_id"]] = (
                        row["deposit_account"],
                        row["income_account"],
                    )
                elif row["status"] == "no_income":
                    other_issues.append(f"dues '{label}' has no income account")
                elif row["status"] == "no_deposit":
                    other_issues.append(f"dues '{label}' has no deposit account")
                elif row["status"] == "unsafe_account_name":
                    other_issues.append(
                        f"dues '{label}' has an account starting with =, +, - or @"
                    )
                elif row["status"] == "not_in_chart":
                    other_issues.append(
                        f"dues '{label}' posts to "
                        f"{_quoted(row['accounts_not_in_chart'])}, not in the "
                        "uploaded chart of accounts"
                    )
                else:
                    other_issues.append(
                        f"dues '{label}' posts to Accounts Payable or Receivable"
                    )
        advance_setup = await self._advance_accounts(org_id)
        if (
            int(new_advance_count or 0)
            or int(settling_count or 0)
            or int(return_count or 0)
        ) and advance_setup["status"] != "ready":
            other_issues.append(
                {
                    "no_advances_account": "cash advances have no advances account",
                    "no_cash_account": "cash advances have no bank account",
                    "unsafe_account_name": (
                        "cash advances have an account starting with =, +, - or @"
                    ),
                    "not_in_chart": (
                        "cash advances post to "
                        f"{_quoted(advance_setup['accounts_not_in_chart'])}, not "
                        "in the uploaded chart of accounts"
                    ),
                }.get(
                    advance_setup["status"],
                    "cash advances post to Accounts Payable or Receivable",
                )
            )
        advance_account = advance_setup["advances_account"] or ""
        advance_cash = advance_setup["cash_account"] or ""
        accounts = await self._resolve_export_accounts(
            org_id,
            [
                select(PurchaseRequest.request_number, PurchaseRequest.budget_id).where(
                    *pr_filters
                ),
                select(CheckRequest.request_number, CheckRequest.budget_id).where(
                    *cr_filters,
                    plain_check,
                    CheckRequest.qb_export_account.is_(None),
                    CheckRequest.is_advance.is_(False),
                ),
                select(ExpenseReport.report_number, ExpenseLineItem.budget_id)
                .select_from(ExpenseLineItem)
                .join(ExpenseReport)
                .where(*er_filters),
                # A reimbursement check posts to its report's lines' accounts.
                select(CheckRequest.request_number, ExpenseLineItem.budget_id)
                .select_from(CheckRequest)
                .join(
                    ExpenseLineItem,
                    ExpenseLineItem.expense_report_id == CheckRequest.expense_report_id,
                )
                .where(
                    *cr_filters,
                    CheckRequest.expense_report_id.is_not(None),
                    CheckRequest.qb_export_entry.is_(None),
                ),
                select(CheckRequest.request_number, CheckRequest.budget_id).where(
                    *void_filters,
                    plain_check,
                    CheckRequest.qb_export_account.is_(None),
                    CheckRequest.is_advance.is_(False),
                ),
            ],
            extra_issues=other_issues,
        )

        log = await self._begin_export(
            org_id, exported_by, date_start, date_end, file_format
        )

        def line_accounts(budget_id: Optional[str]) -> tuple[str, str]:
            # _resolve_export_accounts refused the export if any payment had
            # no budget line, or one it could not map, so every id is a key.
            if budget_id is None:
                raise KeyError(budget_id)
            return accounts[budget_id]

        def check_accounts(cr: CheckRequest) -> tuple[str, str]:
            if cr.qb_export_account and cr.qb_export_offset_account:
                return cr.qb_export_account, cr.qb_export_offset_account
            if cr.is_advance:
                # Money owed back to the department until it is accounted for.
                return advance_account, advance_cash
            return line_accounts(cr.budget_id)

        def journal_lines(
            number: str,
            day: str,
            memo: str,
            account: str,
            paid_from: str,
            amount: Decimal,
            description: str,
        ) -> list[list]:
            # Money leaves the offset account and lands in the category's
            # account; QuickBooks groups consecutive lines sharing a Journal
            # No into one entry and rejects it unless the two sides balance.
            # A reversal passes the two accounts the other way round.
            value = _qb_amount(amount)
            return [
                [number, day, memo, account, value, "", description],
                [number, day, memo, paid_from, "", value, description],
            ]

        def line_entry(
            account: str,
            paid_from: str,
            amount: Decimal,
            description: str,
            advance_left: Decimal,
        ) -> tuple[list[list], Decimal]:
            """One expense line as ``[account, debit, credit, description]``
            rows, and what the report's cash advance has left after it.

            The line is paid from the advance until that runs out, and from
            the bank after: the expense clears what the member owed instead.
            """
            value = _qb_amount(amount)
            covered = min(value, advance_left)
            if covered <= 0:
                return (
                    [
                        [account, value, "", description],
                        [paid_from, "", value, description],
                    ],
                    advance_left,
                )
            rows = [
                [account, value, "", description],
                [advance_account, "", covered, description],
            ]
            if value > covered:
                rows.append([paid_from, "", value - covered, description])
            return rows, advance_left - covered

        def line_description(item: ExpenseLineItem) -> str:
            return (
                f"{item.merchant}: {item.description}"
                if item.merchant
                else item.description
            )

        def reimbursement_entry(cr: CheckRequest) -> list[list]:
            """The entry a reimbursement check posts: its report's lines, as
            the report's own entry would be, as first sent if it was."""
            if cr.qb_export_entry:
                return [list(row) for row in cr.qb_export_entry]
            report = reimbursed_reports[cr.expense_report_id or ""]
            left = _qb_amount(report.advance_applied or Decimal("0"))
            entry: list[list] = []
            for item in sorted(report.line_items, key=lambda i: i.id):
                account, paid_from = line_accounts(item.budget_id)
                rows, left = line_entry(
                    account, paid_from, item.amount, line_description(item), left
                )
                entry += rows
            # Stored as text so the record reads back exactly as it was sent.
            return [
                [account, str(debit), str(credit), description]
                for account, debit, credit, description in entry
            ]

        def payee(cr: CheckRequest) -> str:
            return (
                f"{cr.payee_name} (check {cr.check_number})"
                if cr.check_number
                else cr.payee_name
            )

        # What this file carries, stamped only once all of it has been written.
        sent_purchases: list[str] = []
        sent_reports: set[str] = set()
        sent_checks: dict[tuple[str, str], list[str]] = {}
        sent_voids: list[str] = []
        sent_reimbursements: list[tuple[CheckRequest, list[list]]] = []
        sent_dues: list[str] = []
        sent_returns: list[str] = []
        # What each report's cash advance has left to cover, as its lines go
        # out; carried across batch boundaries, which can split a report.
        advance_left: dict[str, Decimal] = {}

        async def stream() -> AsyncIterator[str]:
            output = io.StringIO()
            writer = SafeCsvWriter(output)
            delivered = 0

            def csv_chunk(rows: list[list]) -> str:
                output.seek(0)
                output.truncate(0)
                writer.writerows(rows)
                return output.getvalue()

            async def batches(statement, count: int):
                for offset in range(0, count, batch_size):
                    result = await self.db.execute(
                        statement.offset(offset).limit(batch_size)
                    )
                    records = list(result.scalars())
                    if not records:
                        return
                    yield records

            try:
                yield csv_chunk([QB_JOURNAL_HEADER])
                # Payment dates are UTC timestamps; the ledger wants the
                # department's calendar day, or an evening payment books on
                # the next one. Resolved inside the try so a failed lookup is
                # recorded on the export log like any other interruption.
                org_tz = await resolve_scheduling_timezone(self.db, org_id)

                def local_day(value: Optional[datetime]) -> str:
                    # Every exported payment is selected by its date, so a
                    # missing one is a row that lost it since; refuse rather
                    # than date the entry wrongly.
                    if value is None:
                        raise ValueError("An exported payment has no date")
                    aware = (
                        value if value.tzinfo else value.replace(tzinfo=timezone.utc)
                    )
                    return aware.astimezone(org_tz).strftime("%m/%d/%Y")

                async for purchases in batches(
                    select(PurchaseRequest)
                    .where(*pr_filters)
                    .order_by(PurchaseRequest.paid_at, PurchaseRequest.id),
                    int(pr_count or 0),
                ):
                    lines = []
                    for pr in purchases:
                        account, paid_from = line_accounts(pr.budget_id)
                        lines += journal_lines(
                            pr.request_number,
                            local_day(pr.paid_at),
                            pr.title,
                            account,
                            paid_from,
                            pr.actual_amount or pr.estimated_amount,
                            pr.vendor or "",
                        )
                        sent_purchases.append(pr.id)
                    delivered += len(purchases)
                    yield csv_chunk(lines)

                async for checks in batches(
                    select(CheckRequest)
                    .where(*cr_filters, plain_check)
                    .order_by(CheckRequest.check_date, CheckRequest.id),
                    int(cr_count or 0),
                ):
                    lines = []
                    for cr in checks:
                        account, paid_from = check_accounts(cr)
                        # The request number, not the check number, is the
                        # Journal No: it is unique across every exported type,
                        # so two entries can never merge into one.
                        lines += journal_lines(
                            cr.request_number,
                            local_day(cr.check_date),
                            cr.memo or cr.purpose or "",
                            account,
                            paid_from,
                            cr.amount,
                            payee(cr),
                        )
                        sent_checks.setdefault((account, paid_from), []).append(cr.id)
                    delivered += len(checks)
                    yield csv_chunk(lines)

                # A reimbursement check's entry is its report's, under the
                # check's own number: a report voided and paid again by a new
                # check posts again under a number QuickBooks has not seen.
                lines = []
                for cr in reimbursements:
                    posted = reimbursement_entry(cr)
                    day = local_day(cr.check_date)
                    memo = cr.purpose or cr.memo or cr.request_number
                    lines += [[cr.request_number, day, memo, *row] for row in posted]
                    sent_reimbursements.append((cr, posted))
                if lines:
                    delivered += len(reimbursements)
                    yield csv_chunk(lines)

                # One journal entry per report: its lines are ordered by
                # report, so they stay consecutive across batch boundaries.
                for offset in range(0, int(line_count or 0), batch_size):
                    result = await self.db.execute(
                        select(ExpenseLineItem, ExpenseReport)
                        .join(ExpenseReport)
                        .where(*er_filters)
                        .order_by(
                            ExpenseReport.paid_at, ExpenseReport.id, ExpenseLineItem.id
                        )
                        .offset(offset)
                        .limit(batch_size)
                    )
                    records = list(result.all())
                    if not records:
                        break
                    lines = []
                    for item, er in records:
                        account, paid_from = line_accounts(item.budget_id)
                        if er.id not in advance_left:
                            advance_left[er.id] = _qb_amount(
                                er.advance_applied or Decimal("0")
                            )
                        rows, advance_left[er.id] = line_entry(
                            account,
                            paid_from,
                            item.amount,
                            line_description(item),
                            advance_left[er.id],
                        )
                        day = local_day(er.paid_at)
                        lines += [
                            [er.report_number, day, er.title, *row] for row in rows
                        ]
                        sent_reports.add(er.id)
                    delivered += len(records)
                    yield csv_chunk(lines)

                for offset in range(0, int(dues_count or 0), batch_size):
                    dues_result = await self.db.execute(
                        select(
                            DuesPayment,
                            MemberDues.dues_schedule_id,
                            DuesSchedule.name,
                            User.first_name,
                            User.last_name,
                            User.preferred_name,
                            User.username,
                        )
                        .join(MemberDues, MemberDues.id == DuesPayment.member_dues_id)
                        .join(
                            DuesSchedule,
                            DuesSchedule.id == MemberDues.dues_schedule_id,
                        )
                        .outerjoin(
                            User,
                            and_(
                                User.id == MemberDues.user_id,
                                User.organization_id == org_id,
                            ),
                        )
                        .where(*dues_filters, MemberDues.organization_id == org_id)
                        .order_by(DuesPayment.received_at, DuesPayment.id)
                        .offset(offset)
                        .limit(batch_size)
                    )
                    dues_records = list(dues_result.all())
                    if not dues_records:
                        break
                    lines = []
                    for (
                        payment,
                        schedule_id,
                        schedule_name,
                        first,
                        last,
                        preferred,
                        username,
                    ) in dues_records:
                        deposit, income = dues_accounts[schedule_id]
                        member = (
                            format_display_name(first, last, preferred)
                            or username
                            or "Member"
                        )
                        how = ", ".join(
                            part
                            for part in (
                                payment.payment_method,
                                payment.transaction_reference,
                            )
                            if part
                        )
                        # A dues payment has no request number; its own id
                        # keeps the Journal No unique, and the prefix keeps it
                        # from ever matching a PR-, CR- or ER- number.
                        lines += journal_lines(
                            f"DUES-{payment.id[:8]}",
                            local_day(payment.received_at),
                            f"Dues: {schedule_name}",
                            deposit,
                            income,
                            payment.amount,
                            f"{member} ({how})" if how else member,
                        )
                        sent_dues.append(payment.id)
                    delivered += len(dues_records)
                    yield csv_chunk(lines)

                for offset in range(0, int(return_count or 0), batch_size):
                    return_result = await self.db.execute(
                        select(
                            AdvanceReturn,
                            CheckRequest.request_number,
                            CheckRequest.payee_name,
                        )
                        .join(
                            CheckRequest,
                            and_(
                                CheckRequest.id == AdvanceReturn.advance_id,
                                CheckRequest.organization_id == org_id,
                            ),
                        )
                        .where(*return_filters)
                        .order_by(AdvanceReturn.returned_at, AdvanceReturn.id)
                        .offset(offset)
                        .limit(batch_size)
                    )
                    return_records = list(return_result.all())
                    if not return_records:
                        break
                    lines = []
                    for entry, number, payee_name in return_records:
                        how = ", ".join(
                            part
                            for part in (entry.payment_method, entry.reference)
                            if part
                        )
                        # The prefix keeps the Journal No from ever matching a
                        # request number or another kind of entry.
                        lines += journal_lines(
                            f"ADVR-{entry.id[:8]}",
                            local_day(entry.returned_at),
                            f"Advance returned: {number}",
                            advance_cash,
                            advance_account,
                            entry.amount,
                            f"{payee_name} ({how})" if how else payee_name,
                        )
                        sent_returns.append(entry.id)
                    delivered += len(return_records)
                    yield csv_chunk(lines)

                # Last, so a check exported and voided within one period is
                # posted before it is reversed.
                async for voids in batches(
                    select(CheckRequest)
                    .where(*void_filters, plain_check)
                    .order_by(CheckRequest.voided_at, CheckRequest.id),
                    int(void_count or 0),
                ):
                    lines = []
                    for cr in voids:
                        account, paid_from = check_accounts(cr)
                        # The original's accounts, swapped: the money goes
                        # back to the account the check was drawn on.
                        lines += journal_lines(
                            f"{cr.request_number}{QB_VOID_SUFFIX}",
                            local_day(cr.voided_at),
                            f"Void: {cr.memo or cr.purpose or cr.request_number}",
                            paid_from,
                            account,
                            cr.amount,
                            f"{payee(cr)}, voided",
                        )
                        sent_voids.append(cr.id)
                    delivered += len(voids)
                    yield csv_chunk(lines)

                # A voided reimbursement check reverses exactly the entry it
                # recorded, every row's sides swapped.
                lines = []
                for cr in sorted(
                    reimbursement_voids,
                    key=lambda c: (_aware_utc(c.voided_at or date_end), c.id),
                ):
                    for account, debit, credit, description in cr.qb_export_entry or []:
                        lines.append(
                            [
                                f"{cr.request_number}{QB_VOID_SUFFIX}",
                                local_day(cr.voided_at),
                                f"Void: {cr.purpose or cr.memo or cr.request_number}",
                                account,
                                credit,
                                debit,
                                f"{description}, voided",
                            ]
                        )
                    sent_voids.append(cr.id)
                if lines:
                    delivered += len(reimbursement_voids)
                    yield csv_chunk(lines)

                stamped_at = datetime.now(timezone.utc)
                await self._stamp_exported(
                    org_id,
                    log.id,
                    stamped_at,
                    purchases=sent_purchases,
                    reports=sent_reports,
                    checks=sent_checks,
                    voids=sent_voids,
                    dues=sent_dues,
                    returns=sent_returns,
                    reimbursements=sent_reimbursements,
                )
                log.status = "successful"
                log.record_count = delivered
                log.completed_at = stamped_at
                await self.db.commit()
            except BaseException:
                await self.db.rollback()
                log.status = "partial" if delivered else "failed"
                log.record_count = delivered
                log.error_message = "Export stream interrupted before completion"
                log.completed_at = datetime.now(timezone.utc)
                await self.db.commit()
                raise

        return stream()

    async def _begin_export(
        self,
        org_id: str,
        exported_by: str,
        date_start: datetime,
        date_end: datetime,
        file_format: str,
    ) -> ExportLog:
        """Record the export as pending, unless another is already running.

        Two exports running at once would each choose the payments the other
        has not stamped yet, and both files would carry them. The department's
        export lock serializes the decision, and the read of a running export
        is a locking read so it sees one committed while this request waited
        for the lock (CLAUDE.md pitfall #27).
        """
        await lock_organization_scope(self.db, org_id, QUICKBOOKS_EXPORT)
        running = await self.db.scalar(
            select(ExportLog.id)
            .where(
                ExportLog.organization_id == org_id,
                ExportLog.export_type == "transactions",
                ExportLog.status == "pending",
                ExportLog.exported_at
                >= datetime.now(timezone.utc) - QB_EXPORT_IN_PROGRESS_WINDOW,
            )
            .limit(1)
            .with_for_update()
        )
        if running is not None:
            await self.db.rollback()
            raise ExportInProgressError()
        log = ExportLog(
            organization_id=org_id,
            export_type="transactions",
            date_range_start=date_start,
            date_range_end=date_end,
            record_count=0,
            file_format=file_format,
            exported_by=exported_by,
        )
        self.db.add(log)
        await self.db.commit()  # Persist pending before any bytes reach the client.
        return log

    async def set_dues_default_accounts(
        self, org_id: str, income: Optional[str], deposit: Optional[str]
    ) -> tuple[str, str]:
        """Set the QuickBooks accounts a dues payment posts to when its
        schedule names none. Blank or None clears one."""
        income = (income or "").strip()
        deposit = (deposit or "").strip()
        _refuse_unusable_accounts(income, deposit)
        result = await self.db.execute(
            select(Organization).where(Organization.id == org_id).with_for_update()
        )
        org = result.scalar_one_or_none()
        if org is None:
            raise ValueError("Organization not found")
        # A deep copy: the finance section is a nested dict, and mutating it in
        # place on a shallow copy is never written (CLAUDE.md pitfall #12).
        settings = copy.deepcopy(org.settings or {})
        section = settings.get(FINANCE_SETTINGS_KEY)
        if not isinstance(section, dict):
            section = {}
        for key, value in (
            (QB_DUES_INCOME_KEY, income),
            (QB_DUES_DEPOSIT_KEY, deposit),
        ):
            if value:
                section[key] = value
            else:
                section.pop(key, None)
        settings[FINANCE_SETTINGS_KEY] = section
        org.settings = settings
        await self.db.flush()
        return income, deposit

    async def _dues_accounts(self, org_id: str) -> dict:
        """Every dues schedule's QuickBooks accounts, its own or the
        department's default, and whether its payments can be exported."""
        org_settings = (
            await self.db.execute(
                select(Organization.settings).where(Organization.id == org_id)
            )
        ).scalar_one_or_none()
        default_income, default_deposit = dues_default_accounts(org_settings)
        chart = await self._chart(org_id)
        rows = await self.db.execute(
            select(DuesSchedule)
            .where(DuesSchedule.organization_id == org_id)
            .order_by(DuesSchedule.name, DuesSchedule.id)
        )
        schedules = []
        for schedule in rows.scalars():
            own_income = (schedule.qb_income_account or "").strip()
            own_deposit = (schedule.qb_deposit_account or "").strip()
            income = own_income or default_income
            deposit = own_deposit or default_deposit
            not_in_chart: tuple[str, ...] = ()
            if not income:
                status = "no_income"
            elif not deposit:
                status = "no_deposit"
            elif _needs_qb_name(income) or _needs_qb_name(deposit):
                status = "payable_receivable"
            else:
                issue, not_in_chart = _account_issue(chart, income, deposit)
                status = issue or "ready"
            schedules.append(
                {
                    "schedule_id": schedule.id,
                    "name": schedule.name,
                    "is_active": schedule.is_active,
                    "status": status,
                    "income_account": income or None,
                    "income_source": (
                        "schedule" if own_income else "default" if income else None
                    ),
                    "deposit_account": deposit or None,
                    "deposit_source": (
                        "schedule" if own_deposit else "default" if deposit else None
                    ),
                    "accounts_not_in_chart": list(not_in_chart),
                }
            )
        # Dues go to QuickBooks once the department names an account for
        # them anywhere. Until then they stay out of the export, as they did
        # before dues could be exported, rather than refusing every export of
        # a department that keeps its dues in QuickBooks by other means.
        enabled = bool(
            default_income
            or default_deposit
            or any(
                row["income_source"] == "schedule"
                or row["deposit_source"] == "schedule"
                for row in schedules
            )
        )
        return {
            "enabled": enabled,
            "default_income_account": default_income or None,
            "default_deposit_account": default_deposit or None,
            "schedules": schedules,
        }

    async def set_advance_accounts(
        self, org_id: str, advances: Optional[str], cash: Optional[str]
    ) -> tuple[str, str]:
        """Set the QuickBooks accounts cash advances post to. Blank or None
        clears one."""
        advances = (advances or "").strip()
        cash = (cash or "").strip()
        _refuse_unusable_accounts(advances, cash)
        result = await self.db.execute(
            select(Organization).where(Organization.id == org_id).with_for_update()
        )
        org = result.scalar_one_or_none()
        if org is None:
            raise ValueError("Organization not found")
        # A deep copy, as for the dues accounts (CLAUDE.md pitfall #12).
        settings = copy.deepcopy(org.settings or {})
        section = settings.get(FINANCE_SETTINGS_KEY)
        if not isinstance(section, dict):
            section = {}
        for key, value in ((QB_ADVANCES_KEY, advances), (QB_ADVANCES_CASH_KEY, cash)):
            if value:
                section[key] = value
            else:
                section.pop(key, None)
        settings[FINANCE_SETTINGS_KEY] = section
        org.settings = settings
        await self.db.flush()
        return advances, cash

    async def _advance_accounts(self, org_id: str) -> dict:
        """The department's cash-advance accounts and whether an advance can
        be exported with them."""
        org_settings = (
            await self.db.execute(
                select(Organization.settings).where(Organization.id == org_id)
            )
        ).scalar_one_or_none()
        advances, cash = advance_accounts(org_settings)
        not_in_chart: tuple[str, ...] = ()
        if not advances:
            status = "no_advances_account"
        elif not cash:
            status = "no_cash_account"
        elif _needs_qb_name(advances) or _needs_qb_name(cash):
            status = "payable_receivable"
        else:
            issue, not_in_chart = _account_issue(
                await self._chart(org_id), advances, cash
            )
            status = issue or "ready"
        return {
            "status": status,
            "advances_account": advances or None,
            "cash_account": cash or None,
            "accounts_not_in_chart": list(not_in_chart),
        }

    async def _reimbursed_reports(
        self, org_id: str, report_ids: Sequence[Optional[str]]
    ) -> dict[str, ExpenseReport]:
        """The reports these reimbursement checks pay, with their lines."""
        wanted = sorted({i for i in report_ids if i})
        if not wanted:
            return {}
        result = await self.db.execute(
            select(ExpenseReport)
            .options(selectinload(ExpenseReport.line_items))
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.id.in_(wanted),
            )
        )
        return {er.id: er for er in result.scalars()}

    async def _stamp_exported(
        self,
        org_id: str,
        log_id: str,
        stamped_at: datetime,
        *,
        purchases: list[str],
        reports: set[str],
        checks: dict[tuple[str, str], list[str]],
        voids: list[str],
        dues: Optional[list[str]] = None,
        returns: Optional[list[str]] = None,
        reimbursements: Optional[list[tuple[CheckRequest, list[list]]]] = None,
    ) -> None:
        """Mark what a completed export carried, and the accounts it used."""
        stamp = {"qb_exported_at": stamped_at, "qb_export_log_id": log_id}
        if purchases:
            await self.db.execute(
                update(PurchaseRequest)
                .where(
                    PurchaseRequest.organization_id == org_id,
                    PurchaseRequest.id.in_(purchases),
                )
                .values(**stamp)
            )
        if reports:
            await self.db.execute(
                update(ExpenseReport)
                .where(
                    ExpenseReport.organization_id == org_id,
                    ExpenseReport.id.in_(reports),
                )
                .values(**stamp)
            )
        for (account, offset), ids in checks.items():
            await self.db.execute(
                update(CheckRequest)
                .where(CheckRequest.organization_id == org_id, CheckRequest.id.in_(ids))
                .values(
                    **stamp,
                    qb_export_account=account,
                    qb_export_offset_account=offset,
                )
            )
        for cr, entry in reimbursements or []:
            # The entry is written whole, never edited in place (pitfall #12).
            await self.db.execute(
                update(CheckRequest)
                .where(
                    CheckRequest.organization_id == org_id,
                    CheckRequest.id == cr.id,
                )
                .values(**stamp, qb_export_entry=entry)
            )
            if cr.status == CheckRequestStatus.ISSUED and cr.expense_report_id:
                # So the report's page says QuickBooks has it.
                await self.db.execute(
                    update(ExpenseReport)
                    .where(
                        ExpenseReport.organization_id == org_id,
                        ExpenseReport.id == cr.expense_report_id,
                    )
                    .values(**stamp)
                )
        if voids:
            await self.db.execute(
                update(CheckRequest)
                .where(
                    CheckRequest.organization_id == org_id,
                    CheckRequest.id.in_(voids),
                )
                .values(qb_void_exported_at=stamped_at, qb_void_export_log_id=log_id)
            )
        if dues:
            await self.db.execute(
                update(DuesPayment)
                .where(
                    DuesPayment.organization_id == org_id,
                    DuesPayment.id.in_(dues),
                )
                .values(**stamp)
            )
        if returns:
            await self.db.execute(
                update(AdvanceReturn)
                .where(
                    AdvanceReturn.organization_id == org_id,
                    AdvanceReturn.id.in_(returns),
                )
                .values(**stamp)
            )

    async def list_export_logs(
        self, org_id: str, pagination: PaginationParams
    ) -> list[dict]:
        """Export history, newest first, each with who ran it, and who
        confirmed it imported, by name."""
        return await self._export_log_rows(
            org_id, skip=pagination.skip, limit=pagination.limit
        )

    async def get_export_log_row(self, org_id: str, log_id: str) -> dict:
        """One export as the history lists it."""
        rows = await self._export_log_rows(org_id, log_id=log_id)
        if not rows:
            raise ValueError("Export not found")
        return rows[0]

    async def _export_log_rows(
        self,
        org_id: str,
        *,
        log_id: Optional[str] = None,
        skip: int = 0,
        limit: Optional[int] = None,
    ) -> list[dict]:
        importer = aliased(User)
        filters = [ExportLog.organization_id == org_id]
        if log_id is not None:
            filters.append(ExportLog.id == log_id)
        result = await self.db.execute(
            select(
                ExportLog,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                importer.first_name,
                importer.last_name,
                importer.preferred_name,
                importer.username,
            )
            .outerjoin(User, User.id == ExportLog.exported_by)
            .outerjoin(importer, importer.id == ExportLog.imported_by)
            .where(*filters)
            .order_by(ExportLog.exported_at.desc(), ExportLog.id)
            .offset(skip)
            .limit(limit)
        )
        rows = []
        for log, *names in result.all():
            data = {
                column.key: getattr(log, column.key)
                for column in ExportLog.__table__.columns
            }
            data["exported_by_name"] = _user_label(*names[:4])
            data["imported_by_name"] = (
                _user_label(*names[4:]) if log.imported_by else None
            )
            rows.append(data)
        return rows

    async def _export_log(self, org_id: str, log_id: str) -> ExportLog:
        log = await self.db.scalar(
            select(ExportLog).where(
                ExportLog.id == log_id, ExportLog.organization_id == org_id
            )
        )
        if log is None:
            raise ValueError("Export not found")
        return log

    async def confirm_export_imported(
        self, org_id: str, log_id: str, user_id: str
    ) -> ExportLog:
        """Record that a complete export's file was imported into QuickBooks.

        Only a complete transactions export can be: an interrupted one is a
        file the Treasurer is told not to import. Confirming twice keeps the
        first confirmation.
        """
        log = await self._export_log(org_id, log_id)
        if log.export_type != "transactions" or log.status != "successful":
            raise ValueError(
                "Only a complete export can be confirmed as imported. Run the "
                "period again and import that file instead."
            )
        if log.imported_at is None:
            log.imported_at = datetime.now(timezone.utc)
            log.imported_by = user_id
            await self.db.flush()
        return log

    async def withdraw_export_imported(self, org_id: str, log_id: str) -> ExportLog:
        """Undo a confirmation made by mistake."""
        log = await self._export_log(org_id, log_id)
        log.imported_at = None
        log.imported_by = None
        await self.db.flush()
        return log

    async def _count_confirmed_imported(
        self,
        pr_filters: list,
        cr_filters: list,
        er_filters: list,
        void_filters: list,
        dues_filters: Optional[list],
        return_filters: list,
        org_id: str,
    ) -> int:
        """How many of a resend's payments a confirmed-imported file carried.

        An expense report counts once, as it is stamped whole. A voided
        check's reversal counts by the export that carried the reversal.
        """
        imported_logs = select(ExportLog.id).where(
            ExportLog.organization_id == org_id, ExportLog.imported_at.is_not(None)
        )
        counts = [
            select(func.count())
            .select_from(PurchaseRequest)
            .where(*pr_filters, PurchaseRequest.qb_export_log_id.in_(imported_logs)),
            select(func.count())
            .select_from(CheckRequest)
            .where(*cr_filters, CheckRequest.qb_export_log_id.in_(imported_logs)),
            select(func.count())
            .select_from(ExpenseReport)
            .where(*er_filters, ExpenseReport.qb_export_log_id.in_(imported_logs)),
            select(func.count())
            .select_from(CheckRequest)
            .where(
                *void_filters, CheckRequest.qb_void_export_log_id.in_(imported_logs)
            ),
            select(func.count())
            .select_from(AdvanceReturn)
            .where(*return_filters, AdvanceReturn.qb_export_log_id.in_(imported_logs)),
        ]
        if dues_filters is not None:
            counts.append(
                select(func.count())
                .select_from(DuesPayment)
                .where(*dues_filters, DuesPayment.qb_export_log_id.in_(imported_logs))
            )
        total = 0
        for statement in counts:
            total += int(await self.db.scalar(statement) or 0)
        return total

    # ========================================
    # QuickBooks chart of accounts
    # ========================================

    async def _chart(self, org_id: str) -> Optional[_Chart]:
        """The uploaded chart of accounts, or None when there is none."""
        result = await self.db.execute(
            select(QuickBooksChartAccount.name).where(
                QuickBooksChartAccount.organization_id == org_id
            )
        )
        names = frozenset(result.scalars())
        return _Chart(names) if names else None

    async def get_chart_of_accounts(self, org_id: str) -> dict:
        result = await self.db.execute(
            select(QuickBooksChartAccount)
            .where(QuickBooksChartAccount.organization_id == org_id)
            .order_by(QuickBooksChartAccount.name)
        )
        accounts = list(result.scalars())
        uploaded_by_name: Optional[str] = None
        first = accounts[0] if accounts else None
        if first is not None and first.uploaded_by:
            user = await self.db.scalar(
                select(User).where(
                    User.id == first.uploaded_by, User.organization_id == org_id
                )
            )
            if user is not None:
                uploaded_by_name = _user_label(
                    user.first_name, user.last_name, user.preferred_name, user.username
                )
        return {
            "uploaded_at": first.uploaded_at if first else None,
            "uploaded_by_name": uploaded_by_name,
            "accounts": [
                {"name": a.name, "account_type": a.account_type} for a in accounts
            ],
        }

    async def replace_chart_of_accounts(
        self, org_id: str, user_id: str, accounts: list[ChartAccount]
    ) -> None:
        """Replace the department's chart of accounts with an upload's.

        Under the export lock, so an export running meanwhile checks against
        one chart or the other, never half of each.
        """
        await lock_organization_scope(self.db, org_id, QUICKBOOKS_EXPORT)
        await self.db.execute(
            delete(QuickBooksChartAccount).where(
                QuickBooksChartAccount.organization_id == org_id
            )
        )
        uploaded_at = datetime.now(timezone.utc)
        self.db.add_all(
            QuickBooksChartAccount(
                organization_id=org_id,
                name=account.name,
                account_type=account.account_type,
                uploaded_at=uploaded_at,
                uploaded_by=user_id,
            )
            for account in accounts
        )
        await self.db.flush()

    async def clear_chart_of_accounts(self, org_id: str) -> None:
        """Remove the uploaded chart, which turns the account check off."""
        await lock_organization_scope(self.db, org_id, QUICKBOOKS_EXPORT)
        await self.db.execute(
            delete(QuickBooksChartAccount).where(
                QuickBooksChartAccount.organization_id == org_id
            )
        )
        await self.db.flush()

    # ========================================
    # Dashboard
    # ========================================

    async def get_dashboard(self, org_id: str) -> dict:
        """Get finance dashboard data"""
        active_fy = await self.get_active_fiscal_year(org_id)

        budget_health = {
            "total_budgeted": 0,
            "total_spent": 0,
            "total_encumbered": 0,
            "total_remaining": 0,
            "percent_used": 0,
            "category_breakdown": [],
        }
        if active_fy:
            budget_health = await self.get_budget_summary(org_id, active_fy.id)

        # Count pending items
        pr_count = await self.db.execute(
            select(func.count())
            .select_from(PurchaseRequest)
            .where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PENDING_APPROVAL,
            )
        )
        er_count = await self.db.execute(
            select(func.count())
            .select_from(ExpenseReport)
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PENDING_APPROVAL,
            )
        )
        cr_count = await self.db.execute(
            select(func.count())
            .select_from(CheckRequest)
            .where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.PENDING_APPROVAL,
            )
        )

        pending_pr = pr_count.scalar() or 0
        pending_er = er_count.scalar() or 0
        pending_cr = cr_count.scalar() or 0

        dues_summary = await self.get_dues_summary(org_id)

        return {
            "budget_health": budget_health,
            "pending_approvals_count": pending_pr + pending_er + pending_cr,
            "pending_purchase_requests": pending_pr,
            "pending_expense_reports": pending_er,
            "pending_check_requests": pending_cr,
            "dues_collection_rate": dues_summary.get("collection_rate", 0),
            "recent_transactions": [],
        }

    # ========================================
    # Budget Helpers
    # ========================================

    # Overspend policy: every purchase-request encumbrance, issued check, and
    # expense-report line must fit within amount_budgeted. Equality is allowed;
    # exceeding the limit is not. There is intentionally no administrative or
    # approval-based override: adding one requires an explicit permission,
    # audit trail, and API contract rather than an implicit bypass here.
    #
    # These helpers mutate a Budget's running totals. The budget_id ultimately
    # originates from a client-supplied FK on the referencing PR/CR/expense, so
    # every fetch is org-scoped to the referencing record's organization — a
    # foreign budget_id can never encumber or spend against another tenant's
    # budget (it becomes a no-op instead). Callers pass the referencing record's
    # organization_id, which is always the caller's own org (records are
    # org-stamped on create).
    async def _fund_charges(self, kind: str, entity) -> dict[str, Decimal]:
        """A payment's amount per restricted fund. An expense report's lines
        are read rather than taken from ``entity.line_items``, which the
        approval path does not load."""
        if kind != KIND_EXPENSE:
            return charges_of(kind, entity)
        rows = await self.db.execute(
            select(ExpenseLineItem.fund_campaign_id, ExpenseLineItem.amount).where(
                ExpenseLineItem.expense_report_id == entity.id,
                ExpenseLineItem.fund_campaign_id.is_not(None),
            )
        )
        out: dict[str, Decimal] = {}
        for fund_id, amount in rows.all():
            if fund_id:  # excluded by the query; narrows the type
                out[fund_id] = out.get(fund_id, Decimal("0")) + Decimal(str(amount))
        return out

    async def _enforce_fund_balance(
        self,
        kind: str,
        entity,
        org_id: str,
        charges: Optional[dict[str, Decimal]] = None,
    ) -> None:
        """Refuse a charge its restricted fund cannot cover, when the
        department's rule is ``block``. Under ``warn`` the shortfall is shown
        (``fund_shortfall``) and the approval goes through."""
        rules = await load_finance_settings(self.db, org_id)
        if rules.fund_overspend_mode != FUND_OVERSPEND_BLOCK:
            return
        if charges is None:
            charges = await self._fund_charges(kind, entity)
        over = await shortfalls(
            self.db, org_id, charges, exclude=(kind, entity.id), lock=True
        )
        if over:
            raise FundBalanceExceededError(sum(over.values(), Decimal("0")))

    async def fund_shortfall(self, kind: str, entity) -> Optional[Decimal]:
        """How far this payment would take its funds past what they have left,
        or None when it fits or charges no fund. Reported whatever the rule,
        so a department on ``off`` that later turns the check on is not
        surprised."""
        charges = await self._fund_charges(kind, entity)
        if not charges:
            return None
        over = await shortfalls(
            self.db, entity.organization_id, charges, exclude=(kind, entity.id)
        )
        return sum(over.values(), Decimal("0")) if over else None

    async def _fund_shortfalls(
        self, org_id: str, refs: list[tuple[str, str]]
    ) -> dict[str, Decimal]:
        """``fund_shortfall`` for each listed payment that has one, keyed by
        its id; payments charging no fund are skipped without being loaded."""
        wanted: dict[str, list[str]] = {}
        if not refs:
            return {}
        for kind, entity_id in refs:
            wanted.setdefault(kind, []).append(entity_id)
        entities: list[tuple[str, Any]] = []
        for kind, model in (
            (KIND_PURCHASE, PurchaseRequest),
            (KIND_CHECK, CheckRequest),
        ):
            ids = wanted.get(kind)
            if ids:
                found = await self.db.execute(
                    select(model).where(
                        model.id.in_(ids),
                        model.organization_id == org_id,
                        model.fund_campaign_id.is_not(None),
                    )
                )
                entities += [(kind, e) for e in found.scalars()]
        ids = wanted.get(KIND_EXPENSE)
        if ids:
            found = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id.in_(ids),
                    ExpenseReport.organization_id == org_id,
                    ExpenseReport.id.in_(
                        select(ExpenseLineItem.expense_report_id).where(
                            ExpenseLineItem.fund_campaign_id.is_not(None)
                        )
                    ),
                )
            )
            entities += [(KIND_EXPENSE, e) for e in found.scalars()]
        out: dict[str, Decimal] = {}
        for kind, entity in entities:
            short = await self.fund_shortfall(kind, entity)
            if short is not None:
                out[entity.id] = short
        return out

    async def _encumber_budget(
        self, budget_id: str, amount: Decimal, org_id: str
    ) -> None:
        await self._mutate_budget(
            budget_id, org_id, encumbered_delta=Decimal(str(amount))
        )

    async def _release_encumbrance(
        self, budget_id: str, amount: Decimal, org_id: str
    ) -> None:
        await self._mutate_budget(
            budget_id, org_id, encumbered_delta=-Decimal(str(amount))
        )

    async def _add_to_spent(self, budget_id: str, amount: Decimal, org_id: str) -> None:
        await self._mutate_budget(budget_id, org_id, spent_delta=Decimal(str(amount)))

    async def _mutate_budget(
        self,
        budget_id: str,
        org_id: str,
        *,
        spent_delta: Decimal = Decimal("0"),
        encumbered_delta: Decimal = Decimal("0"),
    ) -> None:
        """Apply budget deltas under a row lock and enforce the hard ceiling."""
        result = await self.db.execute(
            select(Budget)
            .where(
                Budget.id == budget_id,
                Budget.organization_id == org_id,
            )
            .with_for_update()
        )
        budget = result.scalar_one_or_none()
        if budget:
            new_spent = budget.amount_spent + Decimal(spent_delta)
            new_encumbered = budget.amount_encumbered + Decimal(encumbered_delta)
            # Releases are idempotently bounded at zero, preserving the former
            # behavior while ensuring the ceiling check uses the final totals.
            new_spent = max(Decimal("0"), new_spent)
            new_encumbered = max(Decimal("0"), new_encumbered)
            if new_spent + new_encumbered > budget.amount_budgeted:
                raise BudgetLimitExceededError()
            budget.amount_spent = new_spent
            budget.amount_encumbered = new_encumbered
            await self.db.flush()

    async def _validate_finance_fks(self, org_id: str, data: dict) -> None:
        """Reject client-supplied budget/category/fiscal-year FKs that don't
        belong to the caller's org before they are persisted on a
        budget/PR/CR/expense record.

        Two reasons this must fail closed at write time: (1) a foreign
        ``budget_id`` would otherwise be silently ignored by the org-scoped
        budget write-helpers on approval/payment (encumbrance/spend never
        recorded, so the PR looks approved but the budget is untouched), and
        (2) a foreign ``category_id``/``fiscal_year_id``/``station_id``/
        ``apparatus_id``/``facility_id`` would leave a dangling cross-tenant
        reference that skews category, fiscal-year, per-station or per-asset
        rollups. Each of the latter three is worse than a skewed rollup: all
        are ``ondelete="SET NULL"`` FKs, so the *other* org deleting that
        facility/apparatus silently nulls this org's attribution. Only keys
        actually present in ``data`` are checked (update paths pass
        ``exclude_unset`` dumps and a null clears rather than sets), so this
        never rejects an omitted or explicitly-cleared field.
        """
        budget_id = data.get("budget_id")
        if budget_id and not await self.get_budget(budget_id, org_id):
            raise ValueError("Budget not found")
        category_id = data.get("category_id")
        if category_id and not await self.get_budget_category(category_id, org_id):
            raise ValueError("Budget category not found")
        fiscal_year_id = data.get("fiscal_year_id")
        if fiscal_year_id and not await self.get_fiscal_year(fiscal_year_id, org_id):
            raise ValueError("Fiscal year not found")
        station_id = data.get("station_id")
        if station_id:
            await assert_in_org(self.db, Facility, station_id, org_id, label="Station")
        apparatus_id = data.get("apparatus_id")
        if apparatus_id:
            await assert_in_org(
                self.db, Apparatus, apparatus_id, org_id, label="Apparatus"
            )
        facility_id = data.get("facility_id")
        if facility_id:
            await assert_in_org(
                self.db, Facility, facility_id, org_id, label="Facility"
            )
        fund_campaign_id = data.get("fund_campaign_id")
        if fund_campaign_id:
            await assert_chargeable(self.db, org_id, fund_campaign_id)

    async def _assert_budget_open_for_new_charges(
        self, org_id: str, budget_ids: Iterable[Optional[str]]
    ) -> None:
        """Refuse new spending on a line whose budget category is inactive.

        A category in use is deactivated rather than deleted
        (``delete_budget_category``); the owner's rule (2026-10-22) is that
        its lines then take no new charges. "New" means the moment spending
        attaches to the line: creating a request, adding an expense line,
        repointing a request at the line, or submitting a draft into approval.
        Approving, paying, issuing and cancelling are deliberately not
        checked, so a request already in flight finishes on the line it was
        approved against, and the spend still shows in every report.

        A line is closed when its category or any category above it is
        inactive (``CategoryTree.inactive_source``, the one definition
        ``create_budget`` and the request-form picker also use), and the
        refusal names the category that closed it.

        The org's category tree is read once for every line named, so an
        expense report with many lines costs the same few queries as one.
        """
        wanted = {str(budget_id) for budget_id in budget_ids if budget_id}
        if not wanted:
            return
        result = await self.db.execute(
            select(Budget.category_id).where(
                Budget.id.in_(wanted),
                Budget.organization_id == org_id,
            )
        )
        category_ids = {str(cid) for cid in result.scalars().all() if cid}
        if not category_ids:
            return
        tree = await load_category_tree(self.db, org_id)
        # For each closing category: whether it closes its own lines, lines
        # beneath it, or both -- which decides how the refusal words it.
        closed: dict[str, set[bool]] = {}
        for category_id in category_ids:
            source = tree.inactive_source(category_id)
            if source is not None:
                closed.setdefault(source.name, set()).add(source.id == category_id)
        if not closed:
            return
        names = sorted(closed)
        kinds = set().union(*closed.values())
        single = len(names) == 1
        pronoun = "it" if single else "them"
        if kinds == {True}:
            lines = "its budget lines" if single else "their budget lines"
        elif kinds == {False}:
            lines = f"budget lines under {pronoun}"
        else:
            lines = f"budget lines in or under {pronoun}"
        noun, verb = ("category", "is") if single else ("categories", "are")
        raise ValueError(
            list_within_detail_limit(
                f"The budget {noun} ",
                [f'"{name}"' for name in names],
                f" {verb} inactive, so {lines} take no new charges. "
                "Choose another budget line.",
            )
        )
