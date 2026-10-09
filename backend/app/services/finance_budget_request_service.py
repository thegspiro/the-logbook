"""Planning next year's budget: start from last year, the deadline, requests.

Three pieces, all about a **draft** fiscal year (owner decisions, 2026-10-08):

* **Start from last year** copies another year's lines into the draft as a
  starting point — category, station, the line's own owner and notes, with
  the source line's current budget carried forward as the amount.
* **The request deadline** (``fiscal_years.request_deadline``) is the last day
  line owners may make or change requests, read on the department's calendar.
  ``requests_open`` is the one place that decides it.
* **Budget requests**: a line's owner proposes an amount for the draft year
  (for an existing draft-year line, or for a line that does not exist yet);
  the Treasurer (``finance.manage``) approves it, adjusts it with a note, or
  declines it, and an approval writes the amount into the draft-year line.

Who owns a line is ``app/services/finance_budget_ownership.py``'s answer and
nobody else's (CLAUDE.md pitfall #29). Every read and write is constrained to
the caller's organization (pitfall #14); client-supplied keys are checked
in-org before they are stored (#14c); a decision and the one-request-per-line
rule take row locks (#27).
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.facilities import Facility
from app.models.finance import (
    Budget,
    BudgetCategory,
    BudgetPlanningStage,
    BudgetRequest,
    BudgetRequestStatus,
    FiscalYear,
    FiscalYearStatus,
)
from app.models.user import Position, User
from app.services.finance_budget_ownership import (
    held_positions_query,
    owned_budgets_query,
    resolve_owner,
    user_holds_position,
    user_owns_budget,
)
from app.services.finance_service import (
    BudgetLimitExceededError,
    FinanceEntityNotFoundError,
    FinanceService,
)
from app.utils.member_names import format_display_name
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org
from app.utils.org_timezone import resolve_org_today

_OWNER_EDITABLE = (BudgetRequestStatus.DRAFT, BudgetRequestStatus.SUBMITTED)
_DECIDED = (
    BudgetRequestStatus.APPROVED,
    BudgetRequestStatus.ADJUSTED,
    BudgetRequestStatus.DECLINED,
)
_DECISION_STATUS = {
    "approve": BudgetRequestStatus.APPROVED,
    "adjust": BudgetRequestStatus.ADJUSTED,
    "decline": BudgetRequestStatus.DECLINED,
}


class BudgetRequestConflictError(ValueError):
    """A second live request for the same line, or a line that already exists."""


class BudgetRequestForbiddenError(PermissionError):
    """The caller may see the request but is not its line's owner."""


# The order a draft year's budget moves through on its way to adoption. A
# move is one step forward or back; adoption itself is activation.
_STAGE_ORDER = (
    BudgetPlanningStage.REQUESTS,
    BudgetPlanningStage.LEADERSHIP_REVIEW,
    BudgetPlanningStage.BOARD_REVIEW,
)
_STAGE_LABELS = {
    BudgetPlanningStage.REQUESTS: "taking requests",
    BudgetPlanningStage.LEADERSHIP_REVIEW: "in leadership review",
    BudgetPlanningStage.BOARD_REVIEW: "before the board",
}


def planning_stage(stage) -> BudgetPlanningStage:
    """A draft year's stage; NULL is REQUESTS, the stage before stages existed."""
    if stage is None:
        return BudgetPlanningStage.REQUESTS
    return BudgetPlanningStage(stage.value if hasattr(stage, "value") else stage)


def takes_requests_clause():
    """SQL for "this draft year's stage takes requests", NULL included."""
    return or_(
        FiscalYear.planning_stage.is_(None),
        FiscalYear.planning_stage == BudgetPlanningStage.REQUESTS,
    )


def requests_open(
    status: FiscalYearStatus | str,
    is_locked: bool,
    deadline: Optional[date],
    today: date,
    stage=None,
) -> bool:
    """Whether owners may still make or change requests for a fiscal year.

    Only a draft, unlocked year in the requests stage takes requests. The
    deadline is a calendar day and is inclusive: requests stay open through
    the end of that day on the department's calendar, so ``today`` must be
    the org's today (``resolve_org_today``), never the server's.
    """
    value = status.value if isinstance(status, FiscalYearStatus) else status
    if value != FiscalYearStatus.DRAFT.value or is_locked:
        return False
    if planning_stage(stage) != BudgetPlanningStage.REQUESTS:
        return False
    return deadline is None or today <= deadline


def _status_value(status) -> str:
    return status.value if hasattr(status, "value") else str(status)


def _eq_or_null(column, value):
    return column.is_(None) if value is None else column == value


def _line_label(category_name: Optional[str], station_name: Optional[str]) -> str:
    label = category_name or "Unknown category"
    return f"{label} · {station_name}" if station_name else label


def _display_name(user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    name = format_display_name(user.first_name, user.last_name, user.preferred_name)
    return name or user.username or None


class FinanceBudgetRequestService:
    """Next-year budget planning for one request; built per request."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.finance = FinanceService(db)

    # ========================================
    # Fiscal-year request state
    # ========================================

    async def fiscal_year_rows(
        self, years: list[FiscalYear], org_id: str
    ) -> list[dict]:
        """Fiscal years as the API returns them, with ``requests_open`` added."""
        if not years:
            return []
        today = await resolve_org_today(self.db, org_id)
        rows = []
        for fy in years:
            row = {column.key: getattr(fy, column.key) for column in fy.__table__.c}
            row["requests_open"] = requests_open(
                fy.status,
                bool(fy.is_locked),
                fy.request_deadline,
                today,
                fy.planning_stage,
            )
            if fy.status == FiscalYearStatus.DRAFT:
                row["planning_stage"] = planning_stage(fy.planning_stage).value
            rows.append(row)
        return rows

    async def fiscal_year_row(self, fy: FiscalYear, org_id: str) -> dict:
        return (await self.fiscal_year_rows([fy], org_id))[0]

    async def _year_or_404(
        self, fy_id: str, org_id: str, *, lock: bool = False
    ) -> FiscalYear:
        query = select(FiscalYear).where(
            FiscalYear.id == fy_id, FiscalYear.organization_id == org_id
        )
        if lock:
            query = query.with_for_update()
        fy: Optional[FiscalYear] = (await self.db.execute(query)).scalar_one_or_none()
        if fy is None:
            raise FinanceEntityNotFoundError("Fiscal year not found")
        return fy

    # ========================================
    # Start from last year
    # ========================================

    async def start_from(
        self, draft_id: str, source_id: str, org_id: str, created_by: str
    ) -> dict:
        """Copy ``source_id``'s lines into the draft year ``draft_id``.

        Each new line takes the source line's category, station, its *own*
        owner (a category's owner reaches the copy through the category, so
        copying it onto the line would freeze it) and notes, and the source
        line's current budget as its amount — a starting point the Treasurer
        edits. Spent and encumbered start at zero; amendments stay with the
        source line. A category and station that already have a line in the
        draft are skipped, so running it twice creates nothing the second
        time. Raises ``FinanceEntityNotFoundError`` for a year that is not the
        org's.
        """
        # The draft year's row lock serializes two runs, so both cannot read
        # "no line yet" for the same category and station.
        draft = await self._year_or_404(draft_id, org_id, lock=True)
        source = await self._year_or_404(source_id, org_id)
        if draft.status != FiscalYearStatus.DRAFT or draft.is_locked:
            raise ValueError(
                "Lines can only be copied into a draft fiscal year that is "
                "not locked."
            )
        if source.id == draft.id:
            raise ValueError("Choose a different fiscal year to copy from.")

        existing = await self.db.execute(
            select(Budget.category_id, Budget.station_id)
            .where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == draft.id,
            )
            .with_for_update()
        )
        taken = {(row.category_id, row.station_id) for row in existing.all()}

        source_lines = await self.db.execute(
            select(Budget)
            .where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == source.id,
            )
            .order_by(Budget.created_at, Budget.id)
        )
        created = skipped = 0
        for line in source_lines.scalars().all():
            key = (line.category_id, line.station_id)
            if key in taken:
                skipped += 1
                continue
            taken.add(key)
            self.db.add(
                Budget(
                    organization_id=org_id,
                    fiscal_year_id=draft.id,
                    category_id=line.category_id,
                    station_id=line.station_id,
                    owner_position_id=line.owner_position_id,
                    notes=line.notes,
                    amount_budgeted=Decimal(line.amount_budgeted or 0),
                    amount_spent=Decimal("0"),
                    amount_encumbered=Decimal("0"),
                    created_by=created_by,
                )
            )
            created += 1
        await self.db.flush()
        logger.info(
            "Copied {} budget lines ({} skipped) from {} into {} for org {}",
            created,
            skipped,
            source.id,
            draft.id,
            org_id,
        )
        return {
            "created": created,
            "skipped": skipped,
            "draft_name": draft.name,
            "source_name": source.name,
        }

    # ========================================
    # Who may do what
    # ========================================

    def _visibility(self, org_id: str, user_id: str):
        """The requests a member without ``finance.manage`` may see.

        Requests for lines they own (the resolver's answer), proposals made
        for a position they hold, and anything they submitted themselves.
        """
        owned = owned_budgets_query(org_id, user_id).with_only_columns(Budget.id)
        held = held_positions_query(org_id, user_id)
        return or_(
            BudgetRequest.budget_id.in_(owned),
            and_(
                BudgetRequest.budget_id.is_(None),
                BudgetRequest.owner_position_id.in_(held),
            ),
            BudgetRequest.submitted_by == str(user_id),
        )

    async def _acts_as_owner(self, request: BudgetRequest, org_id: str, user_id: str):
        if request.budget_id:
            return await user_owns_budget(
                self.db, org_id, user_id, str(request.budget_id)
            )
        if request.owner_position_id:
            return await user_holds_position(
                self.db, org_id, user_id, str(request.owner_position_id)
            )
        return False

    async def _load(
        self,
        request_id: str,
        org_id: str,
        user_id: str,
        is_manager: bool,
        *,
        lock: bool = False,
    ) -> BudgetRequest:
        """The request, if the caller may see it; otherwise 404, as if absent."""
        query = select(BudgetRequest).where(
            BudgetRequest.id == request_id,
            BudgetRequest.organization_id == org_id,
        )
        if not is_manager:
            query = query.where(self._visibility(org_id, user_id))
        if lock:
            query = query.with_for_update()
        request: Optional[BudgetRequest] = (
            await self.db.execute(query)
        ).scalar_one_or_none()
        if request is None:
            raise FinanceEntityNotFoundError("Budget request not found")
        return request

    async def _authorize_owner_change(
        self,
        request: BudgetRequest,
        fy: FiscalYear,
        org_id: str,
        user_id: str,
        is_manager: bool,
    ) -> None:
        """Owners change requests only while their year takes requests."""
        if is_manager:
            if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
                raise ValueError(f"{fy.name} is no longer a draft fiscal year.")
            self._require_requests_stage(fy)
            return
        if not await self._acts_as_owner(request, org_id, user_id):
            raise BudgetRequestForbiddenError(
                "Only the holder of the line's owner position can change this "
                "request."
            )
        await self._require_open(fy, org_id)

    @staticmethod
    def _require_requests_stage(fy: FiscalYear) -> None:
        stage = planning_stage(fy.planning_stage)
        if stage != BudgetPlanningStage.REQUESTS:
            raise ValueError(
                f"{fy.name} is {_STAGE_LABELS[stage]}, so its requests can no "
                "longer change. The Treasurer can move it back to taking "
                "requests."
            )

    async def _require_open(self, fy: FiscalYear, org_id: str) -> None:
        today = await resolve_org_today(self.db, org_id)
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(f"{fy.name} is no longer taking budget requests.")
        self._require_requests_stage(fy)
        if not requests_open(
            fy.status,
            bool(fy.is_locked),
            fy.request_deadline,
            today,
            fy.planning_stage,
        ):
            raise ValueError(f"The request deadline for {fy.name} has passed.")

    async def _assert_no_live_duplicate(
        self,
        org_id: str,
        fy_id: str,
        *,
        budget_id: Optional[str],
        category_id: Optional[str],
        station_id: Optional[str],
        exclude_id: Optional[str] = None,
    ) -> None:
        """One request per line (or proposed line) that is not declined.

        A locking read, taken after the fiscal year's row lock: under
        REPEATABLE READ a plain count answers from a snapshot older than the
        lock and two simultaneous requests would both see none (#27).
        """
        query = select(BudgetRequest.id).where(
            BudgetRequest.organization_id == org_id,
            BudgetRequest.fiscal_year_id == fy_id,
            BudgetRequest.status != BudgetRequestStatus.DECLINED,
        )
        if budget_id:
            query = query.where(BudgetRequest.budget_id == budget_id)
        else:
            query = query.where(
                BudgetRequest.budget_id.is_(None),
                BudgetRequest.category_id == category_id,
                _eq_or_null(BudgetRequest.station_id, station_id),
            )
        if exclude_id:
            query = query.where(BudgetRequest.id != exclude_id)
        query = query.limit(1).with_for_update()
        if (await self.db.execute(query)).first() is not None:
            raise BudgetRequestConflictError(
                "This line already has a request for the year. Edit that one, "
                "or wait for it to be declined."
            )

    async def _existing_line(
        self,
        org_id: str,
        fy_id: str,
        category_id: Optional[str],
        station_id: Optional[str],
    ) -> Optional[Budget]:
        result = await self.db.execute(
            select(Budget)
            .where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == fy_id,
                Budget.category_id == category_id,
                _eq_or_null(Budget.station_id, station_id),
            )
            .limit(1)
            .with_for_update()
        )
        budget: Optional[Budget] = result.scalar_one_or_none()
        return budget

    # ========================================
    # Owner side: create, edit, submit, withdraw, delete
    # ========================================

    async def create_request(
        self, org_id: str, user_id: str, is_manager: bool, **data
    ) -> BudgetRequest:
        fy_id = data.get("fiscal_year_id")
        fy = (
            await self.db.execute(
                select(FiscalYear)
                .where(FiscalYear.id == fy_id, FiscalYear.organization_id == org_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if fy is None:
            raise ValueError("Fiscal year not found")
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(
                "Budget requests can only be made for a draft fiscal year."
            )

        budget_id = data.get("budget_id")
        category_id = data.get("category_id")
        station_id = data.get("station_id")
        owner_position_id = data.get("owner_position_id")

        if budget_id:
            if category_id or station_id:
                raise ValueError(
                    "A request for an existing line names the line, not a "
                    "category or station."
                )
            line = await self.finance.get_budget(budget_id, org_id)
            if line is None or line.fiscal_year_id != fy.id:
                raise ValueError(f"That budget line is not in {fy.name}.")
            category = await self.finance.get_budget_category(line.category_id, org_id)
            effective, _inherited = resolve_owner(
                line.owner_position_id,
                category.owner_position_id if category else None,
            )
            if owner_position_id and owner_position_id != effective:
                raise ValueError(
                    "The owner of a request for an existing line is the line's "
                    "owner; leave ownerPositionId out."
                )
            if not is_manager and not await user_owns_budget(
                self.db, org_id, user_id, budget_id
            ):
                raise BudgetRequestForbiddenError(
                    "Only the holder of the line's owner position can request "
                    "an amount for it."
                )
            owner_position_id = effective
        else:
            if not category_id:
                raise ValueError(
                    "Name the budget line, or the category of the new line "
                    "you are proposing."
                )
            await assert_in_org(
                self.db, BudgetCategory, category_id, org_id, label="Budget category"
            )
            if station_id:
                await assert_in_org(
                    self.db, Facility, station_id, org_id, label="Station"
                )
            if owner_position_id:
                await assert_in_org(
                    self.db,
                    Position,
                    owner_position_id,
                    org_id,
                    label="Owner position",
                )
                if not is_manager and not await user_holds_position(
                    self.db, org_id, user_id, owner_position_id
                ):
                    raise BudgetRequestForbiddenError(
                        "You can only propose a line for a position you hold."
                    )
            elif not is_manager:
                raise ValueError("Name the position you are proposing the line for.")
            if await self._existing_line(org_id, fy.id, category_id, station_id):
                raise BudgetRequestConflictError(
                    f"That category and station already have a line in "
                    f"{fy.name}. Request an amount for that line instead."
                )

        if is_manager:
            self._require_requests_stage(fy)
        else:
            await self._require_open(fy, org_id)
        await self._assert_no_live_duplicate(
            org_id,
            fy.id,
            budget_id=budget_id,
            category_id=category_id,
            station_id=station_id,
        )
        request = BudgetRequest(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            budget_id=budget_id or None,
            category_id=None if budget_id else category_id,
            station_id=None if budget_id else (station_id or None),
            owner_position_id=owner_position_id or None,
            requested_amount=Decimal(data["requested_amount"]),
            justification=data["justification"],
            status=BudgetRequestStatus.DRAFT,
        )
        self.db.add(request)
        await self.db.flush()
        await self.db.refresh(request, ["created_at", "updated_at"])
        return request

    async def _year_of(self, request: BudgetRequest, org_id: str) -> FiscalYear:
        # A plain read: an owner's change holds only the request's row lock,
        # so it never waits on the fiscal year while holding a request — the
        # reverse of the order decide_request and create_request lock in.
        return await self._year_or_404(request.fiscal_year_id, org_id)

    async def update_request(
        self, request_id: str, org_id: str, user_id: str, is_manager: bool, **data
    ) -> BudgetRequest:
        request = await self._load(request_id, org_id, user_id, is_manager, lock=True)
        fy = await self._year_of(request, org_id)
        await self._authorize_owner_change(request, fy, org_id, user_id, is_manager)
        if request.status not in _OWNER_EDITABLE:
            raise ValueError("A decided request can no longer be edited.")
        apply_updates(request, data)
        await self.db.flush()
        await self.db.refresh(request, ["updated_at"])
        return request

    async def submit_request(
        self, request_id: str, org_id: str, user_id: str, is_manager: bool
    ) -> BudgetRequest:
        request = await self._load(request_id, org_id, user_id, is_manager, lock=True)
        fy = await self._year_of(request, org_id)
        await self._authorize_owner_change(request, fy, org_id, user_id, is_manager)
        if request.status != BudgetRequestStatus.DRAFT:
            raise ValueError("Only a draft request can be submitted.")
        request.status = BudgetRequestStatus.SUBMITTED
        request.submitted_by = user_id
        request.submitted_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(request, ["updated_at"])
        return request

    async def withdraw_request(
        self, request_id: str, org_id: str, user_id: str, is_manager: bool
    ) -> BudgetRequest:
        request = await self._load(request_id, org_id, user_id, is_manager, lock=True)
        fy = await self._year_of(request, org_id)
        await self._authorize_owner_change(request, fy, org_id, user_id, is_manager)
        if request.status != BudgetRequestStatus.SUBMITTED:
            raise ValueError("Only a submitted request can be withdrawn.")
        request.status = BudgetRequestStatus.DRAFT
        await self.db.flush()
        await self.db.refresh(request, ["updated_at"])
        return request

    async def delete_request(
        self, request_id: str, org_id: str, user_id: str, is_manager: bool
    ) -> None:
        request = await self._load(request_id, org_id, user_id, is_manager, lock=True)
        fy = await self._year_of(request, org_id)
        await self._authorize_owner_change(request, fy, org_id, user_id, is_manager)
        if request.status != BudgetRequestStatus.DRAFT:
            raise ValueError("Only a draft request can be deleted. Withdraw it first.")
        await self.db.delete(request)
        await self.db.flush()

    # ========================================
    # Treasurer side: decide
    # ========================================

    async def decide_request(
        self,
        request_id: str,
        org_id: str,
        decided_by: str,
        *,
        decision: str,
        approved_amount: Optional[Decimal] = None,
        decision_note: Optional[str] = None,
    ) -> BudgetRequest:
        """Approve, adjust or decline a submitted request (``finance.manage``).

        Approving or adjusting writes the approved amount into the draft-year
        line — creating the line first for a proposal — under the same
        locking read ``update_budget`` uses. A decision may be changed while
        the year is still a draft (the amount is written again); once the
        year is active or locked, decisions are final. Declining a request
        that was approved does not take money back out of the line: the
        Treasurer edits the draft line's amount directly.
        """
        new_status = _DECISION_STATUS.get(decision)
        if new_status is None:
            raise ValueError("Decide approve, adjust or decline.")
        # Lock order: fiscal year, then request, then line — the order
        # create_request takes them in, so the two cannot deadlock.
        unlocked = await self._load(request_id, org_id, decided_by, True)
        fy = await self._year_or_404(unlocked.fiscal_year_id, org_id, lock=True)
        request = await self._load(request_id, org_id, decided_by, True, lock=True)
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(
                f"{fy.name} is no longer a draft, so its requests can no longer "
                "be decided."
            )
        self._require_requests_stage(fy)
        if request.status not in (BudgetRequestStatus.SUBMITTED, *_DECIDED):
            raise ValueError("Only a submitted request can be decided.")
        if (
            request.status == BudgetRequestStatus.DECLINED
            and new_status != BudgetRequestStatus.DECLINED
        ):
            # Reviving a declined request must not make a second live one.
            await self._assert_no_live_duplicate(
                org_id,
                fy.id,
                budget_id=request.budget_id,
                category_id=request.category_id,
                station_id=request.station_id,
                exclude_id=request.id,
            )

        if new_status == BudgetRequestStatus.APPROVED:
            amount = Decimal(request.requested_amount)
        elif new_status == BudgetRequestStatus.ADJUSTED:
            if approved_amount is None:
                raise ValueError("An adjusted request needs the amount approved.")
            if not decision_note:
                raise ValueError("Say why the amount was adjusted.")
            amount = Decimal(approved_amount)
        else:
            if not decision_note:
                raise ValueError("Say why the request was declined.")
            amount = None

        if amount is not None:
            await self._write_amount(request, fy, org_id, decided_by, amount)

        request.status = new_status
        request.approved_amount = amount
        request.decision_note = decision_note
        request.decided_by = decided_by
        request.decided_at = datetime.now(timezone.utc)
        # A new decision replaces any leadership change to the old one, whose
        # amount it has just overwritten in the line; the audit log keeps it.
        request.review_amount = None
        request.review_note = None
        request.reviewed_by = None
        request.reviewed_at = None
        await self.db.flush()
        await self.db.refresh(request, ["updated_at"])
        return request

    async def _write_amount(
        self,
        request: BudgetRequest,
        fy: FiscalYear,
        org_id: str,
        decided_by: str,
        amount: Decimal,
    ) -> None:
        if request.budget_id:
            # The same locking read update_budget and the spend checks use.
            line = (
                await self.db.execute(
                    select(Budget)
                    .where(
                        Budget.id == request.budget_id,
                        Budget.organization_id == org_id,
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if line is None:
                raise ValueError("The budget line for this request no longer exists.")
            if amount < Decimal(line.amount_spent or 0) + Decimal(
                line.amount_encumbered or 0
            ):
                raise BudgetLimitExceededError()
            line.amount_budgeted = amount
            return
        if not request.category_id:
            raise ValueError("The category this line was proposed in no longer exists.")
        if await self._existing_line(
            org_id, fy.id, request.category_id, request.station_id
        ):
            raise BudgetRequestConflictError(
                f"That category and station already have a line in {fy.name}. "
                "Decline this proposal and adjust that line instead."
            )
        line = Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=request.category_id,
            station_id=request.station_id,
            owner_position_id=request.owner_position_id,
            amount_budgeted=amount,
            amount_spent=Decimal("0"),
            amount_encumbered=Decimal("0"),
            created_by=decided_by,
        )
        self.db.add(line)
        await self.db.flush()
        request.budget_id = line.id

    # ========================================
    # Planning stages and leadership review
    # ========================================

    async def set_planning_stage(
        self, fy_id: str, org_id: str, stage: str
    ) -> tuple[FiscalYear, BudgetPlanningStage]:
        """Move a draft year one stage forward or back (``finance.manage``).

        Returns the year and the stage it left. Moving into leadership review
        is what closes the year to owners, whatever its deadline says.
        """
        try:
            target = BudgetPlanningStage(stage)
        except ValueError:
            raise ValueError(
                "Choose requests, leadership_review or board_review."
            ) from None
        fy = await self._year_or_404(fy_id, org_id, lock=True)
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(f"{fy.name} is not a draft fiscal year.")
        current = planning_stage(fy.planning_stage)
        if target == current:
            raise ValueError(f"{fy.name} is already {_STAGE_LABELS[target]}.")
        if abs(_STAGE_ORDER.index(target) - _STAGE_ORDER.index(current)) != 1:
            raise ValueError(
                f"{fy.name} is {_STAGE_LABELS[current]}; it moves one stage at "
                "a time."
            )
        fy.planning_stage = target
        await self.db.flush()
        await self.db.refresh(fy, ["updated_at"])
        return fy, current

    async def review_request(
        self,
        request_id: str,
        org_id: str,
        reviewer_id: str,
        *,
        amount: Decimal,
        note: str,
    ) -> BudgetRequest:
        """Senior leadership sets a decided request's amount (``finance.budget_review``).

        Only while the year is in leadership review, and only on a request
        the Treasurer approved or adjusted: a declined or undecided one goes
        back to the Treasurer by moving the year back to taking requests. The
        amount is written into the line under the same locking read a
        decision uses. A reviewer may not review a request for a line they
        own or a request they submitted.
        """
        if not note or not note.strip():
            raise ValueError("Say why the amount was changed.")
        unlocked = await self._load(request_id, org_id, reviewer_id, True)
        fy = await self._year_or_404(unlocked.fiscal_year_id, org_id, lock=True)
        request = await self._load(request_id, org_id, reviewer_id, True, lock=True)
        if fy.status != FiscalYearStatus.DRAFT or fy.is_locked:
            raise ValueError(f"{fy.name} is no longer a draft fiscal year.")
        if planning_stage(fy.planning_stage) != BudgetPlanningStage.LEADERSHIP_REVIEW:
            raise ValueError(f"{fy.name} is not in leadership review.")
        if request.status not in (
            BudgetRequestStatus.APPROVED,
            BudgetRequestStatus.ADJUSTED,
        ):
            raise ValueError(
                "Only a request the Treasurer approved or adjusted can be "
                "changed in leadership review."
            )
        if str(request.submitted_by or "") == str(reviewer_id) or (
            await self._acts_as_owner(request, org_id, reviewer_id)
        ):
            raise BudgetRequestForbiddenError(
                "You cannot review a request for a line you own or a request "
                "you submitted."
            )
        await self._write_amount(request, fy, org_id, reviewer_id, Decimal(amount))
        request.review_amount = Decimal(amount)
        request.review_note = note.strip()
        request.reviewed_by = reviewer_id
        request.reviewed_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(request, ["updated_at"])
        return request

    # ========================================
    # Reads
    # ========================================

    async def list_requests(
        self,
        org_id: str,
        user_id: str,
        is_manager: bool,
        fiscal_year_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        query = select(BudgetRequest).where(BudgetRequest.organization_id == org_id)
        if not is_manager:
            query = query.where(self._visibility(org_id, user_id))
        if fiscal_year_id:
            query = query.where(BudgetRequest.fiscal_year_id == fiscal_year_id)
        if status:
            valid = {s.value for s in BudgetRequestStatus}
            if status.lower() not in valid:
                raise ValueError(
                    f"Invalid status '{status}'. Must be one of: "
                    f"{', '.join(sorted(valid))}"
                )
            query = query.where(BudgetRequest.status == status.lower())
        query = query.order_by(BudgetRequest.created_at.desc(), BudgetRequest.id)
        requests = list((await self.db.execute(query)).scalars().all())
        return await self.describe(requests, org_id)

    async def get_request(
        self, request_id: str, org_id: str, user_id: str, is_manager: bool
    ) -> dict:
        request = await self._load(request_id, org_id, user_id, is_manager)
        return (await self.describe([request], org_id))[0]

    async def _by_ids(self, model, ids, org_id: str) -> dict:
        ids = {str(i) for i in ids if i}
        if not ids:
            return {}
        result = await self.db.execute(
            select(model).where(model.id.in_(ids), model.organization_id == org_id)
        )
        return {str(row.id): row for row in result.scalars().all()}

    async def _last_year(self, org_id: str) -> tuple[Optional[str], dict]:
        """The ACTIVE year's budgeted and spent, by (category, station).

        Seen from a draft year being planned, the active year is "this
        year" — the figures an owner compares the request against. Lines
        sharing a category and station are summed.
        """
        active = await self.finance.get_active_fiscal_year(org_id)
        if active is None:
            return None, {}
        result = await self.db.execute(
            select(
                Budget.category_id,
                Budget.station_id,
                Budget.amount_budgeted,
                Budget.amount_spent,
            ).where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == active.id,
            )
        )
        figures: dict = {}
        for row in result.all():
            key = (row.category_id, row.station_id)
            budgeted, spent = figures.get(key, (Decimal("0"), Decimal("0")))
            figures[key] = (
                budgeted + Decimal(row.amount_budgeted or 0),
                spent + Decimal(row.amount_spent or 0),
            )
        return active.name, figures

    async def describe(self, requests: list[BudgetRequest], org_id: str) -> list[dict]:
        """Requests as the API returns them, every name resolved in-org."""
        if not requests:
            return []
        lines = await self._by_ids(Budget, (r.budget_id for r in requests), org_id)
        category_ids = {r.category_id for r in requests} | {
            line.category_id for line in lines.values()
        }
        categories = await self._by_ids(BudgetCategory, category_ids, org_id)
        station_ids = {r.station_id for r in requests} | {
            line.station_id for line in lines.values()
        }
        stations = await self._by_ids(Facility, station_ids, org_id)
        position_ids = (
            {r.owner_position_id for r in requests}
            | {line.owner_position_id for line in lines.values()}
            | {c.owner_position_id for c in categories.values()}
        )
        positions = await self._by_ids(Position, position_ids, org_id)
        users = await self._by_ids(
            User,
            {r.submitted_by for r in requests}
            | {r.decided_by for r in requests}
            | {r.reviewed_by for r in requests},
            org_id,
        )
        years = await self._by_ids(
            FiscalYear, (r.fiscal_year_id for r in requests), org_id
        )
        last_year_name, last_year = await self._last_year(org_id)

        rows = []
        for r in requests:
            line = lines.get(str(r.budget_id)) if r.budget_id else None
            category_id = line.category_id if line else r.category_id
            station_id = line.station_id if line else r.station_id
            category = categories.get(str(category_id)) if category_id else None
            station = stations.get(str(station_id)) if station_id else None
            if line is not None:
                owner_id, _inherited = resolve_owner(
                    line.owner_position_id,
                    category.owner_position_id if category else None,
                )
            else:
                owner_id = r.owner_position_id
            owner = positions.get(str(owner_id)) if owner_id else None
            fy = years.get(str(r.fiscal_year_id))
            figures = last_year.get((category_id, station_id))
            category_name = category.name if category else None
            station_name = station.name if station else None
            rows.append(
                {
                    "id": r.id,
                    "organization_id": r.organization_id,
                    "fiscal_year_id": r.fiscal_year_id,
                    "fiscal_year_name": fy.name if fy else None,
                    "budget_id": r.budget_id,
                    "category_id": category_id,
                    "category_name": category_name,
                    "station_id": station_id,
                    "station_name": station_name,
                    "line_label": _line_label(category_name, station_name),
                    "is_proposed_line": r.category_id is not None,
                    "owner_position_id": owner_id,
                    "owner_position_name": owner.name if owner else None,
                    "requested_amount": r.requested_amount,
                    "approved_amount": r.approved_amount,
                    "status": _status_value(r.status),
                    "justification": r.justification,
                    "decision_note": r.decision_note,
                    "submitted_by": r.submitted_by,
                    "submitted_by_name": _display_name(
                        users.get(str(r.submitted_by)) if r.submitted_by else None
                    ),
                    "submitted_at": r.submitted_at,
                    "decided_by": r.decided_by,
                    "decided_by_name": _display_name(
                        users.get(str(r.decided_by)) if r.decided_by else None
                    ),
                    "decided_at": r.decided_at,
                    "review_amount": r.review_amount,
                    "review_note": r.review_note,
                    "reviewed_by": r.reviewed_by,
                    "reviewed_by_name": _display_name(
                        users.get(str(r.reviewed_by)) if r.reviewed_by else None
                    ),
                    "reviewed_at": r.reviewed_at,
                    "last_year_fiscal_year_name": (last_year_name if figures else None),
                    "last_year_budgeted": figures[0] if figures else None,
                    "last_year_spent": figures[1] if figures else None,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                }
            )
        return rows

    async def plans_next_year(self, org_id: str, user_id: str) -> bool:
        """Whether the caller has anything on the owner's request screen.

        True when they own a line in a draft fiscal year, or can see a request
        made for a draft year (their line's, their position's, or one they
        submitted). Two ``LIMIT 1`` probes, for the navigation.
        """
        draft_year = and_(
            FiscalYear.id == Budget.fiscal_year_id,
            FiscalYear.organization_id == org_id,
        )
        owned = (
            owned_budgets_query(org_id, user_id)
            .with_only_columns(Budget.id)
            .join(FiscalYear, draft_year)
            .where(FiscalYear.status == FiscalYearStatus.DRAFT)
            .limit(1)
        )
        if (await self.db.execute(owned)).first() is not None:
            return True
        requested = (
            select(BudgetRequest.id)
            .join(
                FiscalYear,
                and_(
                    FiscalYear.id == BudgetRequest.fiscal_year_id,
                    FiscalYear.organization_id == org_id,
                ),
            )
            .where(
                BudgetRequest.organization_id == org_id,
                FiscalYear.status == FiscalYearStatus.DRAFT,
                self._visibility(org_id, user_id),
            )
            .limit(1)
        )
        return (await self.db.execute(requested)).first() is not None

    async def proposal_options(self, org_id: str, user_id: str) -> dict:
        """The choices for proposing a new line: held positions, categories,
        stations.

        A proposal is made for a position the member holds, so the positions
        are only those; a member who holds none could not propose anything and
        is given no categories or stations either.
        """
        positions = await self.db.execute(
            select(Position.id, Position.name)
            .where(
                Position.organization_id == org_id,
                Position.id.in_(held_positions_query(org_id, user_id)),
            )
            .order_by(Position.name, Position.id)
        )
        held = [{"id": row.id, "name": row.name} for row in positions.all()]
        if not held:
            return {"positions": [], "categories": [], "stations": []}
        categories = await self.db.execute(
            select(BudgetCategory.id, BudgetCategory.name)
            .where(
                BudgetCategory.organization_id == org_id,
                BudgetCategory.is_active.is_(True),
            )
            .order_by(BudgetCategory.sort_order, BudgetCategory.name)
        )
        return {
            "positions": held,
            "categories": [{"id": r.id, "name": r.name} for r in categories.all()],
            "stations": await self.finance.list_station_options(org_id),
        }

    async def my_lines(self, fiscal_year_id: str, org_id: str, user_id: str) -> dict:
        """The caller's lines in one fiscal year, each with its request.

        The lines are ``list_my_budgets``'s (the resolver's answer) for that
        year. A line's request is its live one, else its most recent
        declined one.
        """
        fy = await self._year_or_404(fiscal_year_id, org_id)
        lines = await self.finance.list_my_budgets(org_id, user_id, fy.id)
        line_ids = [line["id"] for line in lines]
        requests: list[BudgetRequest] = []
        if line_ids:
            result = await self.db.execute(
                select(BudgetRequest)
                .where(
                    BudgetRequest.organization_id == org_id,
                    BudgetRequest.fiscal_year_id == fy.id,
                    BudgetRequest.budget_id.in_(line_ids),
                )
                .order_by(BudgetRequest.created_at.desc(), BudgetRequest.id)
            )
            requests = list(result.scalars().all())
        described = {row["id"]: row for row in await self.describe(requests, org_id)}
        chosen: dict = {}
        for r in requests:
            current = chosen.get(r.budget_id)
            live = r.status != BudgetRequestStatus.DECLINED
            if current is None or (
                live and current.status == BudgetRequestStatus.DECLINED
            ):
                chosen[r.budget_id] = r
        last_year_name, last_year = await self._last_year(org_id)
        out = []
        for line in lines:
            figures = last_year.get((line["category_id"], line["station_id"]))
            request = chosen.get(line["id"])
            out.append(
                {
                    "budget": line,
                    "request": described[request.id] if request else None,
                    "last_year_fiscal_year_name": (last_year_name if figures else None),
                    "last_year_budgeted": figures[0] if figures else None,
                    "last_year_spent": figures[1] if figures else None,
                }
            )
        return {"fiscal_year": await self.fiscal_year_row(fy, org_id), "lines": out}
