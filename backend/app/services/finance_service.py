"""
Finance Service

Business logic for fiscal years, budgets, purchase requests,
expense reports, check requests, dues, approval chains,
and QuickBooks export.
"""

import html
import io
import secrets
from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import NoReturn, Optional

from loguru import logger
from sqlalchemy import (
    Integer,
    String,
    and_,
    case,
    cast,
    exists,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, contains_eager, selectinload

from app.api.dependencies import PaginationParams, user_has_permission
from app.core.config import settings
from app.models.apparatus import Apparatus
from app.models.email_template import EmailTemplate
from app.models.facilities import Facility
from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetAmendment,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    DuesPayment,
    DuesSchedule,
    DuesStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    ExportLog,
    ExportMapping,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import Position, User
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
from app.services.finance_budget_ownership import owned_budgets_query, resolve_owner
from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)
from app.utils.csv_export import SafeCsvWriter
from app.utils.member_names import format_display_name
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org
from app.utils.org_timezone import resolve_org_today, resolve_scheduling_timezone
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


class ApprovalTokenNotValidError(ValueError):
    """The token exists but no longer authorizes its step (→ 404).

    Answered exactly like an unknown token: a link minted while a step was an
    email step must stop working once the step is reassigned to a member, and
    telling the holder anything more would describe the chain to someone who
    is no longer part of it.
    """


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
        dues.status = DuesStatus.PENDING


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


def _qb_amount(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def _short_label(name: str, limit: int = 40) -> str:
    name = name.strip()
    return name if len(name) <= limit else name[: limit - 3] + "..."


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
        return result.scalar_one_or_none()

    async def create_fiscal_year(
        self, org_id: str, created_by: str, **kwargs
    ) -> FiscalYear:
        fy = FiscalYear(organization_id=org_id, created_by=created_by, **kwargs)
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

    async def activate_fiscal_year(self, fy_id: str, org_id: str) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")

        # Deactivate any currently active fiscal year
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.ACTIVE,
                FiscalYear.id != fy_id,
            )
        )
        for active_fy in result.scalars().all():
            active_fy.status = FiscalYearStatus.CLOSED

        fy.status = FiscalYearStatus.ACTIVE
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Activated fiscal year {} for org {}", fy_id, org_id)
        return fy

    async def lock_fiscal_year(self, fy_id: str, org_id: str) -> FiscalYear:
        fy = await self.get_fiscal_year(fy_id, org_id)
        if not fy:
            raise ValueError("Fiscal year not found")
        fy.is_locked = True
        fy.status = FiscalYearStatus.CLOSED
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        logger.info("Locked fiscal year {}", fy_id)
        return fy

    async def get_active_fiscal_year(self, org_id: str) -> Optional[FiscalYear]:
        result = await self.db.execute(
            select(FiscalYear).where(
                FiscalYear.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.ACTIVE,
            )
        )
        return result.scalar_one_or_none()

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
    def _category_row(category: BudgetCategory, owner_position_name) -> dict:
        row = {
            column.key: getattr(category, column.key)
            for column in BudgetCategory.__table__.columns
        }
        row["owner_position_name"] = owner_position_name
        return row

    async def list_budget_category_details(
        self, org_id: str, pagination: PaginationParams
    ) -> list[dict]:
        """``list_budget_categories`` plus each category's owner position name."""
        result = await self.db.execute(
            self._category_detail_query(org_id)
            .order_by(BudgetCategory.sort_order, BudgetCategory.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return [self._category_row(cat, name) for cat, name in result.all()]

    async def get_budget_category_detail(
        self, cat_id: str, org_id: str
    ) -> Optional[dict]:
        result = await self.db.execute(
            self._category_detail_query(org_id).where(BudgetCategory.id == cat_id)
        )
        row = result.first()
        return self._category_row(row[0], row[1]) if row else None

    async def get_budget_category(
        self, cat_id: str, org_id: str
    ) -> Optional[BudgetCategory]:
        result = await self.db.execute(
            select(BudgetCategory).where(
                BudgetCategory.id == cat_id,
                BudgetCategory.organization_id == org_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_budget_category(self, org_id: str, **kwargs) -> BudgetCategory:
        await self._validate_budget_category_fks(org_id, kwargs)
        cat = BudgetCategory(organization_id=org_id, **kwargs)
        self.db.add(cat)
        await self.db.flush()
        await self.db.refresh(cat, ["created_at", "updated_at"])
        return cat

    async def update_budget_category(
        self, cat_id: str, org_id: str, **kwargs
    ) -> BudgetCategory:
        await self._validate_budget_category_fks(org_id, kwargs)
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        apply_updates(cat, kwargs)
        await self.db.flush()
        await self.db.refresh(cat, ["updated_at"])
        return cat

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

    async def delete_budget_category(self, cat_id: str, org_id: str) -> None:
        cat = await self.get_budget_category(cat_id, org_id)
        if not cat:
            raise ValueError("Budget category not found")
        await self.db.delete(cat)
        await self.db.flush()

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
        # list stays a single query however many lines it holds.
        amendments = (
            select(
                BudgetAmendment.budget_id.label("budget_id"),
                func.sum(BudgetAmendment.amount).label("total"),
                func.count(BudgetAmendment.id).label("n"),
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
                FiscalYear.start_date.label("fiscal_year_start_date"),
                Facility.name.label("station_name"),
                line_owner.name.label("line_owner_name"),
                category_owner.name.label("category_owner_name"),
                func.coalesce(amendments.c.total, 0).label("amendments_total"),
                func.coalesce(amendments.c.n, 0).label("amendment_count"),
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

        ``amount_budgeted`` is the current budget, amendments included. The
        original budget is derived, not stored: the current amount less the
        sum of the line's amendments. A direct edit of ``amount_budgeted``
        therefore moves the original by the same amount, which is what the
        edit means.
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
            original_amount=Decimal(budget.amount_budgeted or 0) - amendments_total,
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
        return result.scalar_one_or_none()

    async def create_budget(self, org_id: str, created_by: str, **kwargs) -> Budget:
        await self._validate_finance_fks(org_id, kwargs)
        await self._validate_owner_position(org_id, kwargs)
        fiscal_year = await self.get_fiscal_year(kwargs.get("fiscal_year_id"), org_id)
        if fiscal_year is not None and fiscal_year.status == FiscalYearStatus.CLOSED:
            # Draft and Active years take budgets; a closed year is settled
            # history (docs/training/11-finance.md, "Creating a Budget").
            raise ValueError(
                "This fiscal year is closed. Budget lines can only be added to "
                "a draft or active fiscal year."
            )
        budget = Budget(organization_id=org_id, created_by=created_by, **kwargs)
        self.db.add(budget)
        await self.db.flush()
        await self.db.refresh(budget, ["created_at", "updated_at"])
        return budget

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
        budget = result.scalar_one_or_none()
        if not budget:
            raise ValueError("Budget not found")
        if "amount_budgeted" in kwargs and kwargs["amount_budgeted"] is not None:
            new_amount = Decimal(kwargs["amount_budgeted"])
            # A locked year's amounts are final. Notes, owner and station stay
            # editable: they describe the line, they do not move money. An
            # unchanged amount is not a change, so a form that sends every
            # field it owns still saves.
            if new_amount != budget.amount_budgeted and await self._year_is_locked(
                budget.fiscal_year_id, org_id
            ):
                raise ValueError(_LOCKED_YEAR_AMOUNT_MESSAGE)
            if new_amount < budget.amount_spent + budget.amount_encumbered:
                raise BudgetLimitExceededError()
        apply_updates(budget, kwargs)
        await self.db.flush()
        await self.db.refresh(budget, ["updated_at"])
        return budget

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
        """Record extra money approved for a line and raise its budget by it.

        One transaction: lock the line (the same locking read ``update_budget``
        and the spend checks use, CLAUDE.md pitfall #27), refuse a locked
        year, insert the amendment, and raise ``amount_budgeted``. Raises
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
        )
        self.db.add(amendment)
        budget.amount_budgeted = new_amount
        await self.db.flush()
        await self.db.refresh(amendment, ["created_at"])
        await self.db.refresh(budget, ["updated_at"])
        logger.info("Budget {} amended by {} in org {}", budget.id, amount, org_id)
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
        """Cancel a mistaken amendment with a reversing entry.

        A mistaken amendment is never edited or deleted (owner decision,
        2026-10-09). The reversal is a new row for the whole amount, negated,
        carrying its own reason and approval, and ``amount_budgeted`` drops by
        the amount. The original budget is unchanged, because it is the current
        amount less the sum of every row and both moved by the same amount.

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
        result = await self.db.execute(
            select(BudgetAmendment)
            .where(
                BudgetAmendment.id == amendment_id,
                BudgetAmendment.budget_id == budget.id,
                BudgetAmendment.organization_id == org_id,
            )
            .with_for_update()
        )
        target = result.scalar_one_or_none()
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
        )
        try:
            async with self.db.begin_nested():
                self.db.add(reversal)
                await self.db.flush()
        except IntegrityError:
            # Unreachable behind the locks above; the unique key answers if
            # some other writer ever skips them.
            raise AmendmentAlreadyReversedError()
        budget.amount_budgeted = new_amount
        await self.db.flush()
        await self.db.refresh(reversal, ["created_at"])
        await self.db.refresh(budget, ["updated_at"])
        logger.info(
            "Budget {} amendment {} reversed by {} in org {}",
            budget.id,
            target.id,
            reversal.id,
            org_id,
        )
        return reversal

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
        result = await self.db.execute(
            select(
                BudgetAmendment,
                User.first_name,
                User.last_name,
                User.preferred_name,
                User.username,
                reversal.id.label("reversal_id"),
                reversal.created_at.label("reversal_created_at"),
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
            if row.reversal_id is not None:
                name = format_display_name(
                    row.reverser_first_name,
                    row.reverser_last_name,
                    row.reverser_preferred_name,
                )
                data.update(
                    reversed_by_amendment_id=row.reversal_id,
                    reversed_at=row.reversal_created_at,
                    reversed_by_name=name or row.reverser_username or None,
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

    async def list_budget_options(self, org_id: str, fiscal_year_id: str) -> list[dict]:
        """The budget lines a requester may charge, as a label and what is left.

        The narrow read behind the request forms' budget picker. A member who
        holds only ``finance.request`` chooses a line by name and sees the
        remaining amount, nothing else: the budgeted, spent and encumbered
        figures, notes and the summary stay behind ``finance.view``.

        The label is the category name, plus the station when the line has
        one. Two lines that would still read the same are numbered, so a
        member never has to pick between identical entries.
        """
        result = await self.db.execute(
            select(
                Budget.id,
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
        options = []
        seen: dict[str, int] = {}
        for row in result.all():
            label = row.category_name
            if row.station_name:
                label = f"{label} ({row.station_name})"
            seen[label] = seen.get(label, 0) + 1
            if seen[label] > 1:
                label = f"{label} #{seen[label]}"
            options.append(
                {
                    "id": row.id,
                    "label": label,
                    "amount_remaining": row.amount_budgeted
                    - row.amount_spent
                    - row.amount_encumbered,
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
        return result.scalar_one_or_none()

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
        return await self.get_approval_chain(chain.id, org_id)

    async def update_approval_chain(
        self, chain_id: str, org_id: str, **kwargs
    ) -> ApprovalChain:
        await self._validate_approval_chain_fks(org_id, kwargs)
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
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

    async def delete_approval_chain(self, chain_id: str, org_id: str) -> None:
        chain = await self.get_approval_chain(chain_id, org_id)
        if not chain:
            raise ValueError("Approval chain not found")
        await self.db.delete(chain)
        await self.db.flush()

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
        step = result.scalar_one_or_none()
        if not step:
            raise ValueError("Approval chain step not found")
        await self._validate_step_approver(org_id, kwargs, existing=step)
        apply_updates(step, kwargs)
        await self.db.flush()
        return step

    async def delete_chain_step(self, step_id: str, chain_id: str, org_id: str) -> None:
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
        await self.db.delete(step)
        await self.db.flush()

    async def resolve_approval_chain(
        self,
        org_id: str,
        entity_type: ApprovalEntityType,
        amount: Decimal,
        budget_category_id: Optional[str] = None,
    ) -> Optional[ApprovalChain]:
        """Find the most specific matching approval chain"""
        query = (
            select(ApprovalChain)
            .options(selectinload(ApprovalChain.steps))
            .where(
                ApprovalChain.organization_id == org_id,
                ApprovalChain.is_active.is_(True),
                or_(
                    ApprovalChain.applies_to == entity_type,
                    ApprovalChain.applies_to == ApprovalEntityType.PURCHASE_REQUEST,
                ),
            )
        )
        result = await self.db.execute(query)
        chains = list(result.scalars().unique().all())

        if not chains:
            return None

        # Score chains by specificity
        best_chain = None
        best_score = -1

        for chain in chains:
            score = 0
            # Must match entity type
            if (
                chain.applies_to != entity_type
                and chain.applies_to != ApprovalEntityType.PURCHASE_REQUEST
            ):
                continue

            # Check amount range
            if chain.min_amount is not None and amount < chain.min_amount:
                continue
            if chain.max_amount is not None and amount > chain.max_amount:
                continue

            # Score by specificity
            if (
                chain.budget_category_id
                and chain.budget_category_id == budget_category_id
            ):
                score += 4
            elif (
                chain.budget_category_id
                and chain.budget_category_id != budget_category_id
            ):
                continue  # Category mismatch

            if chain.min_amount is not None or chain.max_amount is not None:
                score += 2

            if chain.is_default:
                score += 1

            if score > best_score:
                best_score = score
                best_chain = chain

        return best_chain

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

    async def send_approval_request_email(
        self, record: ApprovalStepRecord, step: ApprovalChainStep
    ) -> bool:
        """Email an external ("email" approver-type) approver a token link.

        The link points at the frontend approval page, which reads the token and
        calls the public approve/deny endpoints. Best-effort: returns False and
        logs on any problem rather than raising into the caller's transaction.
        Sends nothing when email delivery is disabled platform-wide.
        """
        approver_email = (step.approver_value or "").strip()
        token = record.approval_token
        if not approver_email or not token:
            return False

        link = f"{settings.FRONTEND_URL.rstrip('/')}/finance/approvals/{token}"
        safe_step = html.escape(step.name or "Approval")
        try:
            from app.services.email_service import EmailService, wrap_email_body
            from app.services.email_theme import ACCENT_AMBER, action

            # No organization: this goes to someone outside the department,
            # and the send itself is made without one (see below).
            html_body = wrap_email_body(
                None,
                "Approval requested",
                "<p>An approval is awaiting your response in The Logbook.</p>"
                f"<p><strong>Step:</strong> {safe_step}</p>"
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
                "Approval request email to {} failed: {}", approver_email, exc
            )
            return False

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
        records = await self.get_approval_records(
            record.entity_type, record.entity_id, org_id
        )
        terminated = 0
        for other in records:
            if other.id == record.id:
                continue
            if other.status != ApprovalStepStatus.PENDING:
                continue
            other.status = ApprovalStepStatus.SKIPPED
            other.approval_token = None
            other.token_expires_at = None
            terminated += 1
        return terminated

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
        record = result.scalar_one_or_none()
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
        record = result.scalar_one_or_none()
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
        self, token: str, notes: Optional[str] = None
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
        record = result.scalar_one_or_none()
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
        record = result.scalar_one_or_none()
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
        entities = union_all(
            select(
                PurchaseRequest.id.label("entity_id"),
                literal(ApprovalEntityType.PURCHASE_REQUEST.value).label("entity_type"),
                PurchaseRequest.title.label("title"),
                PurchaseRequest.estimated_amount.label("amount"),
                PurchaseRequest.requested_by.label("requester_id"),
                PurchaseRequest.created_at.label("submitted_at"),
            ).where(PurchaseRequest.organization_id == org_id),
            select(
                ExpenseReport.id,
                literal(ApprovalEntityType.EXPENSE_REPORT.value),
                ExpenseReport.title,
                ExpenseReport.total_amount,
                ExpenseReport.submitted_by,
                ExpenseReport.created_at,
            ).where(ExpenseReport.organization_id == org_id),
            select(
                CheckRequest.id,
                literal(ApprovalEntityType.CHECK_REQUEST.value),
                literal("Check to ") + CheckRequest.payee_name,
                CheckRequest.amount,
                CheckRequest.requested_by,
                CheckRequest.created_at,
            ).where(CheckRequest.organization_id == org_id),
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
                ApprovalChainStep.name.label("step_name"),
                ApprovalChainStep.step_order,
                ApprovalChainStep.step_type,
                ApprovalChainStep.approver_type,
                ApprovalChainStep.approver_value,
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
        for row in result.all():
            approver_type = normalize_approver_type(row.approver_type)
            step = SimpleNamespace(
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
                }
            )
        if not admin:
            approvals = approvals[skip : skip + limit]
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
                eligible = 0
                for member in members:
                    if await user_matches_step(self.db, member, step, org_id):
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
                            approver_type, value, eligible, directory
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
        return None if eligible else "no_active_members"

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
        has_steps = await self.db.execute(
            select(self._has_step_records(entity_type, entity_id))
        )
        if has_steps.scalar():
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
        # Shared with the chain path so status, approved_by/approved_at and
        # budget encumbrance are handled identically.
        await self._finalize_approval(entity_type, entity_id, approver_id, org_id)
        logger.info(
            "{} {} manually approved by {}", entity_type.value, entity_id, approver_id
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
        """Requests waiting for approval that have no approval steps.

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
            ).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PENDING_APPROVAL,
                ~self._has_step_records(
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
            ).where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PENDING_APPROVAL,
                ~self._has_step_records(
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
            ).where(
                CheckRequest.organization_id == org_id,
                CheckRequest.status == CheckRequestStatus.PENDING_APPROVAL,
                ~self._has_step_records(
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
                }
            )
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
                record.approval_token = secrets.token_urlsafe(32)
                record.token_expires_at = datetime.now(timezone.utc) + timedelta(days=7)
                await self.send_approval_request_email(record, record.step)

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
        mapping = {
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
        }.get(entity_type)
        if mapping is None:
            return None

        model, requester_column = mapping
        result = await self.db.execute(
            select(requester_column).where(
                model.id == entity_id, model.organization_id == org_id
            )
        )
        return result.scalar_one_or_none()

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
        return result.scalar_one_or_none()

    async def _finalize_approval(
        self,
        entity_type: ApprovalEntityType,
        entity_id: str,
        approver_id: Optional[str],
        org_id: str,
    ) -> None:
        """Set the entity status to APPROVED and update denormalized fields"""
        now = datetime.now(timezone.utc)
        if entity_type == ApprovalEntityType.PURCHASE_REQUEST:
            result = await self.db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.id == entity_id,
                    PurchaseRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = PurchaseRequestStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now
                # Encumber budget
                if entity.budget_id:
                    await self._encumber_budget(
                        entity.budget_id,
                        entity.estimated_amount,
                        entity.organization_id,
                    )
        elif entity_type == ApprovalEntityType.EXPENSE_REPORT:
            result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = ExpenseReportStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = CheckRequestStatus.APPROVED
                entity.approved_by = approver_id
                entity.approved_at = now

        await self.db.flush()

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
            result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = ExpenseReportStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                entity.status = CheckRequestStatus.DENIED
                entity.approved_by = denier_id
                entity.denial_reason = reason

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
            result = await self.db.execute(
                select(ExpenseReport).where(
                    ExpenseReport.id == entity_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": entity.title,
                    "amount": entity.total_amount,
                    "requester_name": "",
                    "submitted_at": entity.created_at,
                }
        elif entity_type == ApprovalEntityType.CHECK_REQUEST:
            result = await self.db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == entity_id,
                    CheckRequest.organization_id == org_id,
                )
            )
            entity = result.scalar_one_or_none()
            if entity:
                return {
                    "title": f"Check to {entity.payee_name}",
                    "amount": entity.amount,
                    "requester_name": "",
                    "submitted_at": entity.created_at,
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

        table_map = {
            "PR": PurchaseRequest,
            "ER": ExpenseReport,
            "CK": CheckRequest,
        }
        model = table_map.get(prefix)
        if not model:
            raise ValueError(f"Unknown prefix: {prefix}")

        number_col = (
            model.request_number
            if hasattr(model, "request_number")
            else model.report_number
        )
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
        return result.scalar_one_or_none()

    async def create_purchase_request(
        self, org_id: str, requested_by: str, **kwargs
    ) -> PurchaseRequest:
        await self._validate_finance_fks(org_id, kwargs)
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
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
        if pr.status not in (
            PurchaseRequestStatus.DRAFT,
            PurchaseRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a purchase request in this status")
        await self._validate_finance_fks(org_id, kwargs)
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
        if pr.status != PurchaseRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")

        pr.status = PurchaseRequestStatus.SUBMITTED

        # Resolve and create approval chain
        budget_category_id = None
        if pr.budget_id:
            budget = await self.get_budget(pr.budget_id, org_id)
            if budget:
                budget_category_id = budget.category_id

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.PURCHASE_REQUEST,
            pr.estimated_amount,
            budget_category_id,
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
        pr = result.scalar_one_or_none()
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
        pr = result.scalar_one_or_none()
        if not pr:
            _raise_not_found("Purchase request", requester_id)
        if pr.status in (PurchaseRequestStatus.PAID,):
            raise ValueError("Paid requests cannot be cancelled")
        if requester_id is not None and pr.status != PurchaseRequestStatus.DRAFT:
            raise ValueError(
                "You can withdraw your own request only while it is a draft; "
                "ask the finance office to cancel a submitted request"
            )

        # Release encumbrance if approved
        if pr.budget_id and pr.status in (
            PurchaseRequestStatus.APPROVED,
            PurchaseRequestStatus.ORDERED,
            PurchaseRequestStatus.RECEIVED,
        ):
            await self._release_encumbrance(pr.budget_id, pr.estimated_amount, org_id)

        pr.status = PurchaseRequestStatus.CANCELLED
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
        return result.scalar_one_or_none()

    async def create_expense_report(
        self,
        org_id: str,
        submitted_by: str,
        line_items: Optional[list] = None,
        **kwargs,
    ) -> ExpenseReport:
        await self._validate_finance_fks(org_id, kwargs)
        for item_data in line_items or []:
            await self._validate_finance_fks(org_id, item_data)
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
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
        if er.status not in (
            ExpenseReportStatus.DRAFT,
            ExpenseReportStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit an expense report in this status")
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
        if er.status not in (ExpenseReportStatus.DRAFT,):
            raise ValueError("Can only add items to draft reports")
        await self._validate_finance_fks(org_id, kwargs)
        item = ExpenseLineItem(expense_report_id=er_id, **kwargs)
        self.db.add(item)
        await self.db.flush()

        # Recalculate the total from a fresh aggregate over the persisted line
        # items rather than the loaded `er.line_items` collection. That
        # collection may or may not already include the row just added (depending
        # on whether it was loaded before the flush), so `sum(...) + item.amount`
        # could double-count or drift. The DB sum is authoritative (FIN-7).
        total_result = await self.db.execute(
            select(func.coalesce(func.sum(ExpenseLineItem.amount), 0)).where(
                ExpenseLineItem.expense_report_id == er_id
            )
        )
        er.total_amount = total_result.scalar_one()
        await self.db.flush()
        await self.db.refresh(item, ["created_at"])
        return item

    async def submit_expense_report(
        self, er_id: str, org_id: str, requester_id: Optional[str] = None
    ) -> ExpenseReport:
        er = await self.get_expense_report(
            er_id, org_id, restrict_to_user=requester_id, for_update=True
        )
        if not er:
            _raise_not_found("Expense report", requester_id)
        if er.status != ExpenseReportStatus.DRAFT:
            raise ValueError("Only draft reports can be submitted")
        if er.total_amount <= 0:
            raise ValueError("Expense report must have line items")

        er.status = ExpenseReportStatus.SUBMITTED

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.EXPENSE_REPORT,
            er.total_amount,
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
        er = result.scalar_one_or_none()
        if not er:
            raise ValueError("Expense report not found")
        # SoD (FIN-4): the person who disburses must not be the submitter.
        assert_different_person(
            acted_by, er.submitted_by, action="mark paid", record="expense report"
        )
        if er.status != ExpenseReportStatus.APPROVED:
            raise ValueError("Only approved reports can be marked as paid")

        er.status = ExpenseReportStatus.PAID
        er.paid_at = datetime.now(timezone.utc)
        er.payment_method = payment_method

        # Add to spent for each line item's budget
        for item in er.line_items:
            if item.budget_id:
                await self._add_to_spent(item.budget_id, item.amount, org_id)

        await self.db.flush()
        await self.db.refresh(er, ["updated_at"])
        return er

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
        return result.scalar_one_or_none()

    async def create_check_request(
        self, org_id: str, requested_by: str, **kwargs
    ) -> CheckRequest:
        await self._validate_finance_fks(org_id, kwargs)
        fiscal_year_id = kwargs.get("fiscal_year_id", "")
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
        if cr.status not in (
            CheckRequestStatus.DRAFT,
            CheckRequestStatus.SUBMITTED,
        ):
            raise ValueError("Cannot edit a check request in this status")
        await self._validate_finance_fks(org_id, kwargs)
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
        if cr.status != CheckRequestStatus.DRAFT:
            raise ValueError("Only draft requests can be submitted")

        cr.status = CheckRequestStatus.SUBMITTED

        budget_category_id = None
        if cr.budget_id:
            budget = await self.get_budget(cr.budget_id, org_id)
            if budget:
                budget_category_id = budget.category_id

        chain = await self.resolve_approval_chain(
            org_id,
            ApprovalEntityType.CHECK_REQUEST,
            cr.amount,
            budget_category_id,
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
        cr = result.scalar_one_or_none()
        if not cr:
            raise ValueError("Check request not found")
        # SoD (FIN-4): the person who issues the check must not be the requester.
        assert_different_person(
            acted_by, cr.requested_by, action="issue check", record="check request"
        )
        if cr.status != CheckRequestStatus.APPROVED:
            raise ValueError("Only approved requests can have checks issued")

        cr.status = CheckRequestStatus.ISSUED
        cr.check_number = check_number
        cr.check_date = check_date or datetime.now(timezone.utc)

        if cr.budget_id:
            await self._add_to_spent(cr.budget_id, cr.amount, org_id)

        await self.db.flush()
        await self.db.refresh(cr, ["updated_at"])
        return cr

    async def void_check(self, cr_id: str, org_id: str) -> CheckRequest:
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
        cr = result.scalar_one_or_none()
        if not cr:
            raise ValueError("Check request not found")
        if cr.status != CheckRequestStatus.ISSUED:
            raise ValueError("Only issued checks can be voided")

        cr.status = CheckRequestStatus.VOIDED

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
        return result.scalar_one_or_none()

    async def create_dues_schedule(
        self, org_id: str, created_by: str, **kwargs
    ) -> DuesSchedule:
        await self._validate_finance_fks(org_id, kwargs)
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
            User.is_active.is_(True),
        )
        result = await self.db.execute(query)
        users = list(result.scalars().all())

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
    ) -> list[MemberDues]:
        query = select(MemberDues).where(MemberDues.organization_id == org_id)
        if schedule_id:
            query = query.where(MemberDues.dues_schedule_id == schedule_id)
        if user_id:
            query = query.where(MemberDues.user_id == user_id)
        if status:
            query = query.where(MemberDues.status == status)
        query = (
            query.order_by(MemberDues.due_date.desc(), MemberDues.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

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
        dues = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")

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

        reference = kwargs.get("transaction_reference")
        if reference and any(
            payment.transaction_reference == reference for payment in dues.payments
        ):
            # Already recorded. Returning the current state — rather than
            # raising — is what makes a retried or double-clicked submission
            # safe, which is the entire point of capturing the reference.
            logger.info(
                f"Dues payment {reference!r} already recorded against {dues_id}; "
                "ignoring duplicate submission"
            )
            return dues

        payment = DuesPayment(
            organization_id=dues.organization_id,
            member_dues_id=dues.id,
            amount=Decimal(str(kwargs.get("amount_paid", 0))),
            payment_method=kwargs.get("payment_method"),
            transaction_reference=reference,
            notes=kwargs.get("notes"),
            received_at=datetime.now(timezone.utc),
            recorded_by=recorded_by,
        )
        dues.payments.append(payment)

        _apply_payment_totals(dues)

        await self.db.flush()
        await self.db.refresh(dues, ["updated_at"])
        return dues

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
        result = await self.db.execute(
            select(MemberDues).where(
                MemberDues.id == dues_id,
                MemberDues.organization_id == org_id,
            )
        )
        dues = result.scalar_one_or_none()
        if not dues:
            raise ValueError("Member dues record not found")
        # SoD (FIN-4): a member must not waive their own dues.
        assert_different_person(waived_by, dues.user_id, action="waive", record="dues")

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
        dues = result.scalar_one_or_none()
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
                1 for d in all_dues if d.status == DuesStatus.OVERDUE
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
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Export mapping not found")
        apply_updates(mapping, kwargs)
        await self.db.flush()
        await self.db.refresh(mapping, ["updated_at"])
        return mapping

    async def _resolve_export_accounts(
        self, org_id: str, sources: list
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
        if not rows:
            return {}

        budget_ids = {budget_id for _, budget_id in rows if budget_id is not None}
        categories: dict[str, tuple[str, Optional[str]]] = {}
        if budget_ids:
            result = await self.db.execute(
                select(Budget.id, BudgetCategory.name, BudgetCategory.qb_account_name)
                .join(BudgetCategory, Budget.category_id == BudgetCategory.id)
                .where(
                    Budget.id.in_(budget_ids),
                    Budget.organization_id == org_id,
                    BudgetCategory.organization_id == org_id,
                )
            )
            categories = {row[0]: (row[1], row[2]) for row in result.all()}
        unbudgeted = sorted(
            {number for number, budget_id in rows if budget_id not in categories}
        )

        mapping_result = await self.db.execute(
            select(ExportMapping).where(ExportMapping.organization_id == org_id)
        )
        mappings: dict[str, list[ExportMapping]] = {}
        for mapping in mapping_result.scalars():
            key = mapping.internal_category.strip().casefold()
            mappings.setdefault(key, []).append(mapping)

        resolved: dict[str, tuple[str, str]] = {}
        problems: dict[str, str] = {}
        for budget_id, (name, category_account) in categories.items():
            label = _short_label(name)
            matches = mappings.get(name.strip().casefold(), [])
            if len(matches) > 1:
                problems[name] = f"'{label}' has {len(matches)} mappings"
                continue
            mapping = matches[0] if matches else None
            account = (category_account or "").strip() or (
                mapping.qb_account_name.strip() if mapping else ""
            )
            offset = (mapping.qb_offset_account_name or "").strip() if mapping else ""
            if not account:
                problems[name] = f"'{label}' has no account"
            elif not offset:
                problems[name] = f"'{label}' has no offset account"
            else:
                resolved[budget_id] = (account, offset)

        issues = [problems[name] for name in sorted(problems)]
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
                    f"budget categories and {len(unbudgeted)} transactions "
                    "without a budget line need accounts"
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
        max_records: int = 10_000,
    ) -> AsyncIterator[str]:
        """Prepare a bounded export and return its incremental CSV stream."""
        filters = (
            PurchaseRequest.organization_id == org_id,
            PurchaseRequest.status == PurchaseRequestStatus.PAID,
            PurchaseRequest.paid_at >= date_start,
            PurchaseRequest.paid_at <= date_end,
        )
        pr_count = await self.db.scalar(
            select(func.count()).select_from(PurchaseRequest).where(*filters)
        )
        cr_filters = (
            CheckRequest.organization_id == org_id,
            CheckRequest.status == CheckRequestStatus.ISSUED,
            CheckRequest.check_date >= date_start,
            CheckRequest.check_date <= date_end,
        )
        cr_count = await self.db.scalar(
            select(func.count()).select_from(CheckRequest).where(*cr_filters)
        )
        er_filters = (
            ExpenseReport.organization_id == org_id,
            ExpenseReport.status == ExpenseReportStatus.PAID,
            ExpenseReport.paid_at >= date_start,
            ExpenseReport.paid_at <= date_end,
        )
        line_count = await self.db.scalar(
            select(func.count())
            .select_from(ExpenseLineItem)
            .join(ExpenseReport)
            .where(*er_filters)
        )
        total = int(pr_count or 0) + int(cr_count or 0) + int(line_count or 0)
        if total > max_records:
            raise ValueError(
                f"Synchronous exports support at most {max_records} rows; "
                f"this request contains {total}. Narrow the date range"
            )
        # Resolved before the log row so a refusal leaves no pending export.
        accounts = await self._resolve_export_accounts(
            org_id,
            [
                select(PurchaseRequest.request_number, PurchaseRequest.budget_id).where(
                    *filters
                ),
                select(CheckRequest.request_number, CheckRequest.budget_id).where(
                    *cr_filters
                ),
                select(ExpenseReport.report_number, ExpenseLineItem.budget_id)
                .select_from(ExpenseLineItem)
                .join(ExpenseReport)
                .where(*er_filters),
            ],
        )

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

        def journal_lines(
            number: str,
            day: str,
            memo: str,
            budget_id: str,
            amount: Decimal,
            description: str,
        ) -> list[list]:
            # Money leaves the offset account and lands in the category's
            # account; QuickBooks groups consecutive lines sharing a Journal
            # No into one entry and rejects it unless the two sides balance.
            account, offset = accounts[budget_id]
            value = _qb_amount(amount)
            return [
                [number, day, memo, account, value, "", description],
                [number, day, memo, offset, "", value, description],
            ]

        async def stream() -> AsyncIterator[str]:
            output = io.StringIO()
            writer = SafeCsvWriter(output)
            delivered = 0

            def csv_chunk(rows: list[list]) -> str:
                output.seek(0)
                output.truncate(0)
                writer.writerows(rows)
                return output.getvalue()

            try:
                yield csv_chunk([QB_JOURNAL_HEADER])
                # Payment dates are UTC timestamps; the ledger wants the
                # department's calendar day, or an evening payment books on
                # the next one. Resolved inside the try so a failed lookup is
                # recorded on the export log like any other interruption.
                org_tz = await resolve_scheduling_timezone(self.db, org_id)

                def local_day(value: datetime) -> str:
                    aware = (
                        value if value.tzinfo else value.replace(tzinfo=timezone.utc)
                    )
                    return aware.astimezone(org_tz).strftime("%m/%d/%Y")

                for model, where, ordering, render in (
                    (
                        PurchaseRequest,
                        filters,
                        (PurchaseRequest.paid_at, PurchaseRequest.id),
                        lambda pr: journal_lines(
                            pr.request_number,
                            local_day(pr.paid_at),
                            pr.title,
                            pr.budget_id,
                            pr.actual_amount or pr.estimated_amount,
                            pr.vendor or "",
                        ),
                    ),
                    (
                        CheckRequest,
                        cr_filters,
                        (CheckRequest.check_date, CheckRequest.id),
                        # The request number, not the check number, is the
                        # Journal No: it is unique across every exported type,
                        # so two entries can never merge into one.
                        lambda cr: journal_lines(
                            cr.request_number,
                            local_day(cr.check_date),
                            cr.memo or cr.purpose or "",
                            cr.budget_id,
                            cr.amount,
                            (
                                f"{cr.payee_name} (check {cr.check_number})"
                                if cr.check_number
                                else cr.payee_name
                            ),
                        ),
                    ),
                ):
                    for offset in range(0, total, batch_size):
                        result = await self.db.execute(
                            select(model)
                            .where(*where)
                            .order_by(*ordering)
                            .offset(offset)
                            .limit(batch_size)
                        )
                        records = list(result.scalars())
                        if not records:
                            break
                        delivered += len(records)
                        yield csv_chunk(
                            [line for record in records for line in render(record)]
                        )

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
                    delivered += len(records)
                    yield csv_chunk(
                        [
                            line
                            for item, er in records
                            for line in journal_lines(
                                er.report_number,
                                local_day(er.paid_at),
                                er.title,
                                item.budget_id,
                                item.amount,
                                (
                                    f"{item.merchant}: {item.description}"
                                    if item.merchant
                                    else item.description
                                ),
                            )
                        ]
                    )

                log.status = "successful"
                log.record_count = delivered
                log.completed_at = datetime.now(timezone.utc)
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

    async def list_export_logs(
        self, org_id: str, pagination: PaginationParams
    ) -> list[ExportLog]:
        result = await self.db.execute(
            select(ExportLog)
            .where(ExportLog.organization_id == org_id)
            .order_by(ExportLog.exported_at.desc(), ExportLog.id)
            .offset(pagination.skip)
            .limit(pagination.limit)
        )
        return list(result.scalars().all())

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
