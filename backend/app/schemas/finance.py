"""
Finance Module Schemas

Pydantic request/response schemas for fiscal years, budgets,
purchase requests, expense reports, check requests, dues,
approval chains, and export operations.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepType,
    ApproverType,
    ChargeAccess,
    DuesFrequency,
    ExpenseType,
    ExportMappingType,
    FunctionalClass,
    PurchaseRequestPriority,
)
from app.schemas.base import UTCDateTime, UTCResponseBase
from app.schemas.column_bounds import INT32_MAX, INT32_MIN
from app.utils.external_url import safe_external_url, validate_external_http_url

# applies_to / step_type / approver_type / frequency / expense_type / mapping_type /
# priority map to strict MySQL ENUM columns, but were typed as free str and stored
# raw — an out-of-set value passed Pydantic, reached MySQL, and 500'd (FIN2-1, the B1
# latent-500 class). Validating the enum INPUT (→ 422) is safe hardening and does not
# touch any money math.
_APPLIES_TO = {e.value for e in ApprovalEntityType}
_STEP_TYPES = {e.value for e in ApprovalStepType}
_APPROVER_TYPES = {e.value for e in ApproverType}
_DUES_FREQUENCIES = {e.value for e in DuesFrequency}
_EXPENSE_TYPES = {e.value for e in ExpenseType}
_MAPPING_TYPES = {e.value for e in ExportMappingType}
_PRIORITIES = {e.value for e in PurchaseRequestPriority}


def _enum_check(valid: set, field: str):
    def _check(value):
        if value is None:
            return value
        normalized = value.lower() if isinstance(value, str) else value
        if normalized not in valid:
            raise ValueError(
                f"Invalid {field} '{value}'. Must be one of: {', '.join(sorted(valid))}"
            )
        return normalized

    return _check


_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)

# The Finance pages build request bodies from the camelCase response types, so
# every request schema takes a camelCase alias alongside the field name — without
# it a create 422'd on "missing" required fields and an update silently dropped
# every multi-word key (a cleared budgetId acknowledged the save and changed
# nothing). populate_by_name keeps snake_case callers working (the approval-chain
# page, the public token-approval page). loc_by_alias=False keeps 422 field names
# snake_case, exactly as they were before the alias. Dumps stay by field name, so
# services receive snake_case keys; do not dump these with by_alias=True.
_REQUEST_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    loc_by_alias=False,
)


# ============================================
# Fiscal Year Schemas
# ============================================


class FiscalYearCreate(BaseModel):
    """Create a new fiscal year"""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=100)
    start_date: datetime
    end_date: datetime


class FiscalYearUpdate(BaseModel):
    """Update a fiscal year"""

    model_config = _REQUEST_CONFIG

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    # The last day line owners may make budget requests, on the department's
    # calendar. Settable only on a draft year; an explicit null clears it.
    request_deadline: Optional[date] = None


class FiscalYearResponse(UTCResponseBase):
    """Fiscal year response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    start_date: datetime
    end_date: datetime
    status: str
    is_locked: bool
    request_deadline: Optional[date] = None
    # A draft year in the requests stage whose deadline (if any) has not
    # passed in the org's timezone — requests_open decides it.
    requests_open: bool = False
    # requests, leadership_review, board_review or adopted; null unless a
    # draft.
    planning_stage: Optional[str] = None
    # The board's adoption, recorded from board review.
    adopted_on: Optional[date] = None
    adoption_reference: Optional[str] = None
    adoption_notes: Optional[str] = None
    adoption_recorded_by: Optional[str] = None
    adoption_recorded_at: Optional[datetime] = None
    # Set when the year-end close began; a closed year without the lock is in
    # its closing period.
    closing_started_at: Optional[datetime] = None
    # The active year's end date has passed on the department's calendar and
    # its close has not been begun.
    close_due: bool = False
    # The Treasurer's reconciliation sign-off that locked the year.
    locked_by: Optional[str] = None
    locked_at: Optional[datetime] = None
    lock_notes: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class FiscalYearStageChange(BaseModel):
    """Move a draft year one planning stage forward or back."""

    model_config = _REQUEST_CONFIG

    stage: str

    _check_stage = field_validator("stage")(
        _enum_check({"requests", "leadership_review", "board_review"}, "stage")
    )


class FiscalYearAdoption(BaseModel):
    """The board's adoption of a draft year's budget."""

    model_config = _REQUEST_CONFIG

    adopted_on: date
    adoption_reference: str = Field(..., max_length=500)
    adoption_notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("adoption_reference")
    @classmethod
    def _reference_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter the motion or minutes reference.")
        return value

    @field_validator("adoption_notes")
    @classmethod
    def _blank_is_none(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class FiscalYearLock(BaseModel):
    """The Treasurer's reconciliation sign-off that locks a closing year."""

    model_config = _REQUEST_CONFIG

    notes: str = Field(..., max_length=4000)

    @field_validator("notes")
    @classmethod
    def _notes_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Add the reconciliation notes for the sign-off.")
        return value


class FiscalYearOpenItemResponse(UTCResponseBase):
    """A request still in flight that stops a closing year from locking."""

    model_config = _RESPONSE_CONFIG

    # purchase_request, expense_report or check_request
    kind: str
    entity_id: str
    number: str
    description: str
    status: str
    amount: Optional[Decimal] = None


class StartFromLastYearResponse(BaseModel):
    """What "Start from last year" did: lines copied, lines already there, and
    lines left behind because their category is retired."""

    model_config = _RESPONSE_CONFIG

    created: int
    skipped: int
    retired: int = 0


# ============================================
# Budget Category Schemas
# ============================================


class BudgetCategoryCreate(BaseModel):
    """Create a budget category"""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: int = Field(0, ge=INT32_MIN, le=INT32_MAX)
    qb_account_name: Optional[str] = Field(None, max_length=200)
    owner_position_id: Optional[str] = None
    # Null inherits the parent category's (app/services/functional_expenses.py).
    functional_class: Optional[FunctionalClass] = None
    # Null inherits the parent's rule (app/services/finance_budget_access.py).
    charge_access: Optional[ChargeAccess] = None
    # Positions beyond the answerable owners that may charge a restricted
    # category's lines. Omitted names none.
    charge_position_ids: Optional[list[str]] = None


class BudgetCategoryUpdate(BaseModel):
    """Update a budget category"""

    model_config = _REQUEST_CONFIG

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: Optional[int] = Field(None, ge=INT32_MIN, le=INT32_MAX)
    is_active: Optional[bool] = None
    qb_account_name: Optional[str] = Field(None, max_length=200)
    # Omitted leaves the owner alone; an explicit null clears it.
    owner_position_id: Optional[str] = None
    # Omitted leaves it alone; an explicit null inherits the parent's again.
    functional_class: Optional[FunctionalClass] = None
    # Omitted leaves it alone; an explicit null inherits the parent's rule.
    charge_access: Optional[ChargeAccess] = None
    # Omitted leaves the named positions alone; a list replaces them.
    charge_position_ids: Optional[list[str]] = None


class BudgetCategoryResponse(UTCResponseBase):
    """Budget category response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: int
    is_active: bool
    qb_account_name: Optional[str] = None
    owner_position_id: Optional[str] = None
    owner_position_name: Optional[str] = None
    functional_class: Optional[str] = None
    # The category's own setting; null inherits.
    charge_access: Optional[str] = None
    # The rule its lines are actually under, and the ancestor it came from
    # when it is inherited (null when the category set it, or nothing did).
    effective_charge_access: str = "open"
    charge_access_inherited_from: Optional[str] = None
    charge_position_ids: list[str] = Field(default_factory=list)
    # Names from the top-level category down to this one.
    path: list[str] = Field(default_factory=list)
    # The inactive ancestor that closes this category to new charges, lines
    # and proposals while it is itself active; null otherwise.
    inactive_through: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BudgetCategoryChargeAccessUpdate(BaseModel):
    """Who may charge a category's lines, as its owner or the Treasurer sets it.

    The whole setting at once: ``charge_access`` null inherits the parent's
    rule, and ``charge_position_ids`` replaces the named positions.
    """

    model_config = _REQUEST_CONFIG

    charge_access: Optional[ChargeAccess] = None
    charge_position_ids: list[str] = Field(default_factory=list, max_length=200)


# ============================================
# Budget Schemas
# ============================================


class BudgetCreate(BaseModel):
    """Create a budget line"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    category_id: str
    amount_budgeted: Decimal = Field(..., ge=0, max_digits=12, decimal_places=2)
    notes: Optional[str] = None
    station_id: Optional[str] = None
    # None: the line inherits its category's owner.
    owner_position_id: Optional[str] = None


class BudgetUpdate(BaseModel):
    """Update a budget line.

    Dumped with ``exclude_unset``: an omitted key leaves the field alone and
    an explicit null clears it (a cleared owner falls back to the category's).
    """

    model_config = _REQUEST_CONFIG

    amount_budgeted: Optional[Decimal] = Field(
        None, ge=0, max_digits=12, decimal_places=2
    )
    notes: Optional[str] = None
    station_id: Optional[str] = None
    owner_position_id: Optional[str] = None


class BudgetResponse(UTCResponseBase):
    """Budget response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    fiscal_year_id: str
    category_id: str
    amount_budgeted: Decimal
    amount_spent: Decimal
    amount_encumbered: Decimal
    notes: Optional[str] = None
    # Names of the line's category and fiscal year, so a reader who cannot
    # list either (an owner without finance.view) can still label the line.
    category_name: Optional[str] = None
    fiscal_year_name: Optional[str] = None
    fiscal_year_status: Optional[str] = None
    station_id: Optional[str] = None
    station_name: Optional[str] = None
    # The line's own owner; None when it has none (and may inherit).
    owner_position_id: Optional[str] = None
    owner_position_name: Optional[str] = None
    # Who actually owns the line: its own owner, else its category's.
    effective_owner_position_id: Optional[str] = None
    effective_owner_position_name: Optional[str] = None
    owner_inherited: bool = False
    # amount_budgeted is the current budget, amendments included; the
    # original is derived from it (FinanceService._budget_row), never stored.
    original_amount: Decimal
    # Confirmed amendments only; pending ones have moved nothing yet.
    amendments_total: Decimal = Decimal("0")
    amendment_count: int = 0
    pending_amendment_count: int = 0
    # False once the budget is before the board, adopted, active, closing or
    # locked: the amount then changes only through a confirmed amendment.
    amount_editable: bool = True
    created_by: str
    created_at: datetime
    updated_at: datetime


class MyBudgetResponse(BudgetResponse):
    """A line the caller owns, as "My budgets" shows it.

    The budget detail row plus the two figures the owner's page reports
    rather than works out: what is left, and the share used (spent plus
    committed — the encumbered amount — over the current budget).
    """

    amount_remaining: Decimal
    percent_used: float


class MyBudgetsSummaryResponse(BaseModel):
    """Whether the caller owns any budget line, for the navigation.

    ``plans_next_year`` is the "Next year's budget" entry's signal: the caller
    owns a line in a draft fiscal year, or has a budget request for one.
    """

    model_config = _RESPONSE_CONFIG

    owns_any: bool
    plans_next_year: bool = False


class BudgetTransactionResponse(UTCResponseBase):
    """One record that moved a budget line's spent or encumbered total.

    ``effect`` is ``spent``, ``encumbered`` or ``none`` (a voided check, listed
    because it was once spent and was reversed). ``entity_id`` is the purchase
    request, check request or expense report the row came from; ``id`` is the
    row itself (an expense report contributes one row per line item).
    """

    model_config = _RESPONSE_CONFIG

    id: str
    kind: str
    entity_id: str
    number: str
    description: Optional[str] = None
    counterparty: Optional[str] = None
    requester_name: Optional[str] = None
    status: str
    amount: Decimal
    effect: str
    occurred_at: Optional[datetime] = None


class BudgetTransactionPageResponse(BaseModel):
    """A page of a line's transactions, newest first."""

    model_config = _RESPONSE_CONFIG

    items: list[BudgetTransactionResponse]
    total: int
    limit: int
    offset: int


class BudgetAmendmentCreate(BaseModel):
    """Record extra money leadership approved for a budget line.

    The approval date's "not in the future" check needs the department's
    calendar, so the service makes it rather than this schema.
    """

    model_config = _REQUEST_CONFIG

    # max_digits=12 with two places is the Numeric(12, 2) column's own limit.
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    reason: str = Field(..., max_length=2000)
    approved_by: str = Field(..., max_length=200)
    approved_on: date

    @field_validator("reason", "approved_by")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class BudgetAmendmentReverse(BaseModel):
    """Reverse a mistaken amendment with an entry of its own.

    The amount is not sent: a reversal cancels the whole amendment, so the
    service takes it from the row being reversed. The approval date's "not in
    the future" check needs the department's calendar, so the service makes it.
    """

    model_config = _REQUEST_CONFIG

    reason: str = Field(..., max_length=2000)
    approved_by: str = Field(..., max_length=200)
    approved_on: date

    @field_validator("reason", "approved_by")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class BudgetAmendmentReject(BaseModel):
    """Reject a pending amendment (or withdraw one's own), saying why."""

    model_config = _REQUEST_CONFIG

    note: str = Field(..., max_length=2000)

    @field_validator("note")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class BudgetAmendmentResponse(UTCResponseBase):
    """One recorded amendment to a budget line.

    A reversing entry has a negative ``amount`` and names the amendment it
    cancels in ``reverses_amendment_id``; ``is_reversal`` says which kind a
    row is. On a reversed amendment, ``reversed_by_amendment_id``,
    ``reversed_at`` (when the reversal was entered), ``reversed_by_name`` (who
    entered it) and ``reversal_status`` are filled from that reversal.
    ``status`` is ``pending`` until a second officer confirms it (applied) or
    rejects it; ``decided_by_name``, ``decided_at`` and ``decision_note``
    record that decision.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    budget_id: str
    amount: Decimal
    reason: str
    approved_by: str
    approved_on: date
    created_by: Optional[str] = None
    entered_by_name: Optional[str] = None
    created_at: datetime
    reverses_amendment_id: Optional[str] = None
    is_reversal: bool = False
    reversed_by_amendment_id: Optional[str] = None
    reversed_at: Optional[datetime] = None
    reversed_by_name: Optional[str] = None
    reversal_status: Optional[str] = None
    status: str = "confirmed"
    decided_by: Optional[str] = None
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None


class BudgetAmendmentCreatedResponse(BaseModel):
    """The amendment (or reversal) and the line as it now stands."""

    model_config = _RESPONSE_CONFIG

    amendment: BudgetAmendmentResponse
    budget: BudgetResponse


class FinanceNamedOptionResponse(BaseModel):
    """An id and a name, for the budget form's position and station pickers."""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str


class ChargeAccessSettingsResponse(BaseModel):
    """The categories whose charge rule the caller may set, and the positions
    they may name — an id and a name each, as the owner may hold no
    position-administration grant."""

    model_config = _RESPONSE_CONFIG

    categories: list[BudgetCategoryResponse]
    positions: list[FinanceNamedOptionResponse]


class BudgetRequestProposalOptionsResponse(BaseModel):
    """What the owner's "Propose a new line" form may offer.

    ``positions`` are only the positions the caller holds — a proposal is
    made for one of them. ``categories`` and ``stations`` are ids and names
    and are empty for a caller who holds no position, who could not propose
    anything.
    """

    model_config = _RESPONSE_CONFIG

    positions: list[FinanceNamedOptionResponse]
    categories: list[FinanceNamedOptionResponse]
    stations: list[FinanceNamedOptionResponse]


class BudgetOptionResponse(BaseModel):
    """A budget line as a request form offers it: a name, and what is left
    only for a caller allowed to see it.

    Deliberately not ``BudgetResponse``. ``finance.request`` holders see this
    and nothing more of the budget — the budgeted, spent and encumbered
    figures stay behind ``finance.view``, and so does ``amount_remaining``
    unless the caller owns the line (it is None otherwise).
    """

    model_config = _RESPONSE_CONFIG

    id: str
    label: str
    amount_remaining: Optional[Decimal] = None
    # False when the line's category is inactive: still listed so a request
    # already on the line can show it, never offered as a new choice.
    category_active: bool = True


class FiscalYearOptionResponse(BaseModel):
    """A fiscal year a request can be raised against."""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    status: str
    request_deadline: Optional[date] = None
    requests_open: bool = False
    planning_stage: Optional[str] = None


class BudgetSummaryResponse(BaseModel):
    """Aggregated budget summary"""

    model_config = _RESPONSE_CONFIG

    total_budgeted: Decimal
    total_spent: Decimal
    total_encumbered: Decimal
    total_remaining: Decimal
    percent_used: float
    category_breakdown: list[dict] = []


# ============================================
# Budget Request Schemas
# ============================================

_BUDGET_REQUEST_DECISIONS = {"approve", "adjust", "decline"}


def _strip_or_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


class BudgetRequestCreate(BaseModel):
    """Propose next year's amount for a budget line.

    Either ``budget_id`` names a line in the draft year, or ``category_id``
    (with an optional ``station_id``) describes a line that does not exist
    yet, owned by ``owner_position_id``. The service decides which, and who
    may make it.
    """

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    budget_id: Optional[str] = None
    category_id: Optional[str] = None
    station_id: Optional[str] = None
    owner_position_id: Optional[str] = None
    # max_digits=12 with two places is the Numeric(12, 2) column's own limit.
    requested_amount: Decimal = Field(..., ge=0, max_digits=12, decimal_places=2)
    justification: str = Field(..., max_length=4000)

    @field_validator("justification")
    @classmethod
    def _justification_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class BudgetRequestUpdate(BaseModel):
    """Change a draft or submitted request's amount or justification.

    Dumped with ``exclude_unset``: an omitted key leaves the field alone.
    """

    model_config = _REQUEST_CONFIG

    requested_amount: Optional[Decimal] = Field(
        None, ge=0, max_digits=12, decimal_places=2
    )
    justification: Optional[str] = Field(None, max_length=4000)

    @field_validator("justification")
    @classmethod
    def _justification_not_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class BudgetRequestDecision(BaseModel):
    """The Treasurer's decision: approve as asked, adjust with a note, decline.

    ``adjust`` needs the amount approved and a note saying why; ``decline``
    needs a note. A blank note counts as none.
    """

    model_config = _REQUEST_CONFIG

    decision: str
    approved_amount: Optional[Decimal] = Field(
        None, ge=0, max_digits=12, decimal_places=2
    )
    decision_note: Optional[str] = Field(None, max_length=4000)

    _check_decision = field_validator("decision")(
        _enum_check(_BUDGET_REQUEST_DECISIONS, "decision")
    )

    @field_validator("decision_note")
    @classmethod
    def _blank_note_is_none(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)

    @model_validator(mode="after")
    def _decision_needs_what_it_needs(self):
        if self.decision == "adjust":
            if self.approved_amount is None:
                raise ValueError("An adjusted request needs the amount approved.")
            if not self.decision_note:
                raise ValueError("Say why the amount was adjusted.")
        if self.decision == "decline" and not self.decision_note:
            raise ValueError("Say why the request was declined.")
        return self


class BudgetRequestReview(BaseModel):
    """Senior leadership's change to a decided request's amount, with why."""

    model_config = _REQUEST_CONFIG

    amount: Decimal = Field(..., ge=0, max_digits=12, decimal_places=2)
    note: str = Field(..., max_length=4000)

    @field_validator("note")
    @classmethod
    def _note_required(cls, value: str) -> str:
        stripped = _strip_or_none(value)
        if not stripped:
            raise ValueError("Say why the amount was changed.")
        return stripped


class BudgetRequestResponse(UTCResponseBase):
    """One budget request, as the owner's and the Treasurer's screens show it.

    ``line_label`` is "Category · Station" (or the category alone).
    ``owner_position_*`` is the line's effective owner when the request is
    for an existing line, else the position named on the proposal.
    ``last_year_*`` are the ACTIVE year's figures for the same category and
    station — "this year" seen from the draft year being planned — and are
    null when there is no such line.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    fiscal_year_id: str
    fiscal_year_name: Optional[str] = None
    budget_id: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    station_id: Optional[str] = None
    station_name: Optional[str] = None
    line_label: str
    is_proposed_line: bool
    owner_position_id: Optional[str] = None
    owner_position_name: Optional[str] = None
    requested_amount: Decimal
    approved_amount: Optional[Decimal] = None
    status: str
    justification: str
    decision_note: Optional[str] = None
    submitted_by: Optional[str] = None
    submitted_by_name: Optional[str] = None
    submitted_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    # Senior leadership's change during leadership review, if any; the line
    # holds this amount when it is set.
    review_amount: Optional[Decimal] = None
    review_note: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    last_year_fiscal_year_name: Optional[str] = None
    last_year_budgeted: Optional[Decimal] = None
    last_year_spent: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime


class MyBudgetRequestLineResponse(BaseModel):
    """A draft-year line the caller owns, with its request if there is one.

    ``request`` is the line's current (not declined) request, else its most
    recent declined one, else null.
    """

    model_config = _RESPONSE_CONFIG

    budget: BudgetResponse
    request: Optional[BudgetRequestResponse] = None
    last_year_fiscal_year_name: Optional[str] = None
    last_year_budgeted: Optional[Decimal] = None
    last_year_spent: Optional[Decimal] = None


class MyBudgetRequestLinesResponse(BaseModel):
    """Everything the owner's request screen needs for one draft year."""

    model_config = _RESPONSE_CONFIG

    fiscal_year: FiscalYearOptionResponse
    lines: list[MyBudgetRequestLineResponse]


# ============================================
# Approval Chain Schemas
# ============================================


class ApprovalChainStepCreate(BaseModel):
    """Create a step in an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_step_type = field_validator("step_type")(
        _enum_check(_STEP_TYPES, "step_type")
    )
    _check_approver_type = field_validator("approver_type")(
        _enum_check(_APPROVER_TYPES, "approver_type")
    )

    step_order: int = Field(..., ge=1, le=INT32_MAX)
    name: str = Field(..., min_length=1, max_length=200)
    step_type: str = "approval"
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: bool = False
    auto_approve_under: Optional[Decimal] = Field(
        None, ge=0, max_digits=12, decimal_places=2
    )
    required: bool = True


class ApprovalChainStepUpdate(BaseModel):
    """Update a step in an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_step_type = field_validator("step_type")(
        _enum_check(_STEP_TYPES, "step_type")
    )
    _check_approver_type = field_validator("approver_type")(
        _enum_check(_APPROVER_TYPES, "approver_type")
    )

    step_order: Optional[int] = Field(None, ge=1, le=INT32_MAX)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    step_type: Optional[str] = None
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: Optional[bool] = None
    auto_approve_under: Optional[Decimal] = Field(
        None, ge=0, max_digits=12, decimal_places=2
    )
    required: Optional[bool] = None


class ApprovalChainStepResponse(UTCResponseBase):
    """Approval chain step response"""

    model_config = _RESPONSE_CONFIG

    id: str
    chain_id: str
    step_order: int
    name: str
    step_type: str
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: bool
    auto_approve_under: Optional[Decimal] = Field(None, decimal_places=2)
    required: bool
    created_at: datetime


def _require_ordered_range(
    min_amount: Optional[Decimal], max_amount: Optional[Decimal]
) -> None:
    """A chain's minimum cannot be above its maximum: no amount could fit it."""
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise ValueError("The minimum amount cannot be above the maximum amount")


class ApprovalChainCreate(BaseModel):
    """Create an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_applies_to = field_validator("applies_to")(
        _enum_check(_APPLIES_TO, "applies_to")
    )

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: str
    min_amount: Optional[Decimal] = Field(None, ge=0, max_digits=12, decimal_places=2)
    max_amount: Optional[Decimal] = Field(None, ge=0, max_digits=12, decimal_places=2)
    budget_category_id: Optional[str] = None
    is_default: bool = False
    steps: Optional[list[ApprovalChainStepCreate]] = None

    @model_validator(mode="after")
    def _check_range(self) -> "ApprovalChainCreate":
        _require_ordered_range(self.min_amount, self.max_amount)
        return self


class ApprovalChainUpdate(BaseModel):
    """Update an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_applies_to = field_validator("applies_to")(
        _enum_check(_APPLIES_TO, "applies_to")
    )

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: Optional[str] = None
    min_amount: Optional[Decimal] = Field(None, ge=0, max_digits=12, decimal_places=2)
    max_amount: Optional[Decimal] = Field(None, ge=0, max_digits=12, decimal_places=2)
    budget_category_id: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def _check_range(self) -> "ApprovalChainUpdate":
        _require_ordered_range(self.min_amount, self.max_amount)
        return self


class ApprovalRouteStepResponse(BaseModel):
    """One step a request would wait on, as its timeline would describe it."""

    model_config = _RESPONSE_CONFIG

    name: str
    step_order: int
    step_type: str
    # Who the step waits on; null on a notification step, which waits on
    # nobody.
    assignee_label: Optional[str] = None
    # The amount falls under the step's auto-approve limit.
    auto_approved: bool = False


class ApprovalRoutePreviewResponse(BaseModel):
    """Who a request would wait on if it were submitted now."""

    model_config = _RESPONSE_CONFIG

    chain_name: Optional[str] = None
    # No chain applies: a finance approver decides by hand.
    manual: bool
    steps: list[ApprovalRouteStepResponse] = []
    # At or over the department's dual-approval threshold.
    second_approver_required: bool = False


class ApprovalChainResponse(UTCResponseBase):
    """Approval chain response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    applies_to: str
    min_amount: Optional[Decimal] = Field(None, decimal_places=2)
    max_amount: Optional[Decimal] = Field(None, decimal_places=2)
    budget_category_id: Optional[str] = None
    is_default: bool
    is_active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    steps: list[ApprovalChainStepResponse] = []


class ApprovalStepRecordResponse(UTCResponseBase):
    """Approval step record response"""

    model_config = _RESPONSE_CONFIG

    id: str
    chain_id: str
    step_id: str
    entity_type: str
    entity_id: str
    status: str
    assigned_to: Optional[str] = None
    acted_by: Optional[str] = None
    acted_at: Optional[datetime] = None
    notes: Optional[str] = None
    step_name: Optional[str] = None
    step_order: Optional[int] = None
    created_at: datetime
    # Filled by the request detail endpoints for the viewer, from
    # finance_approver_matching — the same rule approve/deny enforce — so a
    # detail page shows who a step waits on without re-deriving it.
    assignee_label: Optional[str] = None
    can_act: bool = False
    requires_override: bool = False


class ApprovalActionRequest(BaseModel):
    """Request to approve or deny a step"""

    model_config = _REQUEST_CONFIG

    notes: Optional[str] = None
    # Only an approvals admin (finance.configure_approvals) who is not the
    # step's named approver needs this; it is recorded in the audit log.
    override_reason: Optional[str] = Field(None, max_length=2000)
    # Approving an expense report with lines submitted after the department's
    # substantiation deadline needs this set: the approver has reviewed them.
    acknowledge_late_substantiation: bool = False

    @field_validator("override_reason")
    @classmethod
    def _blank_reason_is_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None


class PendingApprovalResponse(UTCResponseBase):
    """Pending approval for the current user"""

    model_config = _RESPONSE_CONFIG

    step_record_id: str
    entity_type: str
    entity_id: str
    entity_title: str
    entity_amount: Decimal
    requester_name: str
    step_name: str
    step_order: int
    submitted_at: datetime
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    assignee_label: str = "any finance approver"
    # True when the caller is the step's named approver. An approvals admin
    # also sees steps they are not named on, with requires_override=True: they
    # may act only by giving an override reason.
    can_act: bool = False
    requires_override: bool = False
    # Expense reports: lines submitted after the substantiation deadline. An
    # approval must acknowledge them (acknowledgeLateSubstantiation).
    late_line_count: int = 0
    # How far it would take its restricted funds past what they have left;
    # null when it fits or charges no fund.
    fund_shortfall: Optional[Decimal] = None
    # An "email" approver step's link: "sent" | "failed" | "expired" |
    # "not_sent" | "unknown" (emailed before send status was recorded); null
    # for every other step. The link itself is never returned.
    email_delivery: Optional[str] = None
    # When the last send was attempted; null when none was recorded.
    email_status_at: Optional[datetime] = None
    # Named back by a re-send, so a repeated one sends nothing.
    email_link_version: int = 0
    # The caller may re-send the link (an approvals admin, on an email step).
    can_resend_email: bool = False


class ApprovalEmailResendRequest(BaseModel):
    """Re-send an email approver's link"""

    model_config = _REQUEST_CONFIG

    # The emailLinkVersion the queue showed. A re-send naming a version the
    # step has already moved past sends nothing.
    link_version: int = Field(..., ge=0, le=1_000_000)


class ApprovalEmailResendResponse(UTCResponseBase):
    """The link's state after a re-send; never the link itself"""

    model_config = _RESPONSE_CONFIG

    step_record_id: str
    # False when the step had already moved past the named link version.
    resent: bool
    email_delivery: Optional[str] = None
    email_status_at: Optional[datetime] = None
    email_link_version: int


class ApproverCoverageResponse(UTCResponseBase):
    """One approval step, and whether anybody can act on it"""

    model_config = _RESPONSE_CONFIG

    chain_id: str
    chain_name: str
    chain_is_active: bool
    step_id: str
    step_name: str
    step_order: int
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    assignee_label: str
    eligible_active_count: int
    # null | "no_value" | "not_found" | "no_active_members" | "invalid_email"
    problem: Optional[str] = None
    pending_request_count: int


class UnroutedApprovalResponse(UTCResponseBase):
    """A request waiting for approval that no approval chain applies to"""

    model_config = _RESPONSE_CONFIG

    entity_type: str
    entity_id: str
    entity_title: str
    entity_amount: Decimal
    requester_name: str
    submitted_at: datetime
    # Held for a second, different approver by the dual-approval threshold.
    awaiting_second_approval: bool = False
    first_approved_by: Optional[str] = None
    # Expense reports: lines submitted after the substantiation deadline, and
    # whether the report waits for an approver to acknowledge them.
    late_line_count: int = 0
    awaiting_late_acknowledgement: bool = False
    # How far it would take its restricted funds past what they have left;
    # null when it fits or charges no fund.
    fund_shortfall: Optional[Decimal] = None


# ============================================
# Board Reports
# ============================================


class BudgetVsActualRowResponse(BaseModel):
    """One budget line, through the report's date."""

    model_config = _RESPONSE_CONFIG

    budget_id: str
    category_name: str
    station_name: Optional[str] = None
    original_budget: Decimal
    # Confirmed amendments that had taken effect by the report's date.
    amendments: Decimal
    budget: Decimal
    # Payments dated through the report's date.
    spent: Decimal
    # Open commitments; reported only for a report run through today.
    committed: Optional[Decimal] = None
    remaining: Decimal
    percent_used: Optional[float] = None
    # Today's report only: the line's running total, and whether it disagrees
    # with the payments summed for ``spent``.
    running_spent: Optional[Decimal] = None
    running_spent_differs: bool = False


class BudgetVsActualTotalsResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    original_budget: Decimal
    amendments: Decimal
    budget: Decimal
    spent: Decimal
    committed: Optional[Decimal] = None
    remaining: Decimal


class BudgetVsActualReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    fiscal_year_id: str
    fiscal_year_name: str
    as_of: date
    includes_committed: bool
    rows: list[BudgetVsActualRowResponse]
    totals: BudgetVsActualTotalsResponse


class AmendmentLogRowResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    amendment_id: str
    budget_id: str
    category_name: str
    station_name: Optional[str] = None
    amount: Decimal
    is_reversal: bool
    reason: str
    approved_by: str
    approved_on: date
    entered_by_name: Optional[str] = None
    entered_at: datetime
    status: str
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None


class AmendmentLogReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    fiscal_year_id: str
    fiscal_year_name: str
    rows: list[AmendmentLogRowResponse]
    # Net of the confirmed rows: what the amendments moved the year's budget by.
    confirmed_net: Decimal


class PaymentsRegisterRowResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    # The department's calendar day the money moved.
    paid_on: date
    # purchase_request, check_request, check_void, expense_report,
    # cash_advance or advance_return
    kind: str
    entity_id: str
    number: str
    payee: str
    description: str
    budget_line: Optional[str] = None
    check_number: Optional[str] = None
    # A void, and cash returned against an advance, are negative: they put
    # back what a check took out. A report accounting for a cash advance shows
    # only what was paid to the member beyond it.
    amount: Decimal


class PaymentsRegisterReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    start: date
    end: date
    rows: list[PaymentsRegisterRowResponse]
    total: Decimal


class FunctionalClassUpdate(BaseModel):
    """Set or clear one payment's functional classification (finance.manage)."""

    model_config = _REQUEST_CONFIG

    # Null clears the override, so the payment takes its category's again.
    functional_class: Optional[FunctionalClass]


class FunctionalExpenseCategoryResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    # Null: payments with no budget line.
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    amount: Decimal


class FunctionalExpenseClassResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    # program, management_general or fundraising; null is unclassified.
    functional_class: Optional[str] = None
    categories: list[FunctionalExpenseCategoryResponse]
    total: Decimal


class FunctionalExpensesReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    start: date
    end: date
    classes: list[FunctionalExpenseClassResponse]
    total: Decimal


class FundBalanceResponse(BaseModel):
    """One restricted fund: what it has received, what is charged to it, and
    what it has left (app/services/restricted_funds.py)."""

    model_config = _RESPONSE_CONFIG

    campaign_id: str
    name: str
    purpose: Optional[str] = None
    # False once the campaign is deleted; its charges still count.
    active: bool = True
    received: Decimal
    spent: Decimal
    committed: Decimal
    # Submitted and not yet decided; not subtracted from available.
    awaiting_approval: Decimal
    available: Decimal


class FundBalancesReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    funds: list[FundBalanceResponse]
    received: Decimal
    spent: Decimal
    committed: Decimal
    awaiting_approval: Decimal
    available: Decimal


class FundOptionResponse(BaseModel):
    """A restricted fund a payment may be charged to, for the request forms."""

    model_config = _RESPONSE_CONFIG

    campaign_id: str
    name: str
    purpose: Optional[str] = None
    available: Decimal


class LateSubstantiationRowResponse(BaseModel):
    """One expense line reimbursed outside the accountable plan."""

    model_config = _RESPONSE_CONFIG

    # The department's calendar day the report was paid.
    paid_on: date
    report_id: str
    report_number: str
    member_name: str
    description: str
    budget_line: Optional[str] = None
    incurred_on: date
    # Null for a report submitted before submission was recorded.
    submitted_on: Optional[date] = None
    days_to_submit: Optional[int] = None
    amount: Decimal
    acknowledged_by_name: Optional[str] = None


class LateSubstantiationReportResponse(BaseModel):
    model_config = _RESPONSE_CONFIG

    start: date
    end: date
    rows: list[LateSubstantiationRowResponse]
    total: Decimal


class FinanceSettingsResponse(BaseModel):
    """The finance rules the server applies (app/utils/finance_settings.py)."""

    model_config = _RESPONSE_CONFIG

    # None: off. Otherwise requests of this amount or more need two different
    # approvers.
    dual_approval_threshold: Optional[Decimal] = None
    # The accountable-plan deadline for expense reports: "off", "warn" or
    # "block", and the days allowed between incurring and submitting.
    substantiation_mode: str = "off"
    substantiation_days: int = 60
    # A payment charged to a restricted fund for more than it has left:
    # "off", "warn" or "block".
    fund_overspend_mode: str = "warn"


class ManualDenyRequest(BaseModel):
    """Deny a request that has no approval steps. A reason is required."""

    model_config = _REQUEST_CONFIG

    reason: str = Field(..., min_length=1, max_length=5000)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A reason is required to deny a request")
        return value


# ============================================
# Purchase Request Schemas
# ============================================


class PurchaseRequestCreate(BaseModel):
    """Create a purchase request"""

    model_config = _REQUEST_CONFIG

    _check_priority = field_validator("priority")(_enum_check(_PRIORITIES, "priority"))

    fiscal_year_id: str
    budget_id: Optional[str] = None
    # A restricted fund (a fundraising campaign marked restricted) this
    # payment spends; app/services/restricted_funds.py.
    fund_campaign_id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    priority: str = "medium"
    notes: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None


class PurchaseRequestUpdate(BaseModel):
    """Update a purchase request"""

    model_config = _REQUEST_CONFIG

    _check_priority = field_validator("priority")(_enum_check(_PRIORITIES, "priority"))

    budget_id: Optional[str] = None
    # A restricted fund (a fundraising campaign marked restricted) this
    # payment spends; app/services/restricted_funds.py.
    fund_campaign_id: Optional[str] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Optional[Decimal] = Field(
        None, gt=0, max_digits=12, decimal_places=2
    )
    actual_amount: Optional[Decimal] = Field(
        None, gt=0, max_digits=12, decimal_places=2
    )
    priority: Optional[str] = None
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None

    # The link is rendered as an anchor; only an HTTP(S) one may be stored.
    _check_receipt_url = field_validator("receipt_url", mode="before")(
        validate_external_http_url
    )


class PurchaseRequestResponse(UTCResponseBase):
    """Purchase request response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    request_number: str
    fiscal_year_id: str
    budget_id: Optional[str] = None
    # This payment's own classification, and the one it takes once its budget
    # category's is applied (detail responses; app/services/functional_expenses.py).
    functional_class: Optional[str] = None
    effective_functional_class: Optional[str] = None
    # The restricted fund this payment spends, and its name (detail
    # responses; app/services/restricted_funds.py).
    fund_campaign_id: Optional[str] = None
    fund_name: Optional[str] = None
    # How far this payment would take its restricted funds past what they
    # have left, while it is not yet approved; null when it fits or charges
    # no fund (detail responses).
    fund_shortfall: Optional[Decimal] = None
    requested_by: str
    title: str
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Decimal
    actual_amount: Optional[Decimal] = None
    status: str
    priority: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    # A first approval held for a second approver by the dual-approval
    # threshold, and whether the request is waiting on that second approval
    # (set on detail responses, from FinanceService.is_awaiting_second_approval).
    first_approved_by: Optional[str] = None
    first_approved_at: Optional[datetime] = None
    awaiting_second_approval: bool = False
    denial_reason: Optional[str] = None
    ordered_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    qb_exported_at: Optional[datetime] = None
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    receipt_document_id: Optional[str] = None
    receipt_file_url: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None
    # The expense report claiming this purchase back for the requester, while
    # one does (app/services/finance_reimbursement.py; detail responses).
    reimbursement_report_id: Optional[str] = None
    reimbursement_report_number: Optional[str] = None
    reimbursement_report_status: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approval_steps: list[ApprovalStepRecordResponse] = []

    # A link stored before input validation existed is withheld unless it is
    # HTTP(S), rather than handed to an href.
    _safe_receipt_url = field_validator("receipt_url", mode="before")(safe_external_url)

    @model_validator(mode="after")
    def _set_receipt_file_url(self):
        if self.receipt_document_id:
            self.receipt_file_url = (
                f"/api/v1/finance/purchase-requests/{self.id}/receipt"
            )
        return self


# ============================================
# Expense Report Schemas
# ============================================


class ExpenseLineItemCreate(BaseModel):
    """Create an expense line item"""

    model_config = _REQUEST_CONFIG

    # mode="before": the field is typed as the enum, so an after-validator
    # received an ExpenseType and handed back a plain lowercased str, which
    # the serializer then warned about on every dump. Normalizing first lets
    # the enum type coerce the result.
    _check_expense_type = field_validator("expense_type", mode="before")(
        _enum_check(_EXPENSE_TYPES, "expense_type")
    )

    budget_id: Optional[str] = None
    # A restricted fund (a fundraising campaign marked restricted) this
    # payment spends; app/services/restricted_funds.py.
    fund_campaign_id: Optional[str] = None
    description: str = Field(..., min_length=1, max_length=500)
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    date_incurred: datetime
    # Typed as the enum so an unknown value is rejected with a 422 here rather
    # than reaching MySQL, where the column is an ENUM and the insert fails with
    # "Data truncated for column 'expense_type'" — surfaced to the client as a
    # bare 500 with nothing pointing at the offending field.
    expense_type: ExpenseType = ExpenseType.GENERAL
    receipt_url: Optional[str] = None
    merchant: Optional[str] = None

    _check_receipt_url = field_validator("receipt_url", mode="before")(
        validate_external_http_url
    )


class ExpenseLineItemUpdate(BaseModel):
    """Edit a line on a draft expense report. Omitted fields are left alone;
    null clears an optional one (description, amount, date and type cannot be
    cleared)."""

    model_config = _REQUEST_CONFIG

    _check_expense_type = field_validator("expense_type", mode="before")(
        _enum_check(_EXPENSE_TYPES, "expense_type")
    )

    budget_id: Optional[str] = None
    fund_campaign_id: Optional[str] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    amount: Optional[Decimal] = Field(None, gt=0, max_digits=12, decimal_places=2)
    date_incurred: Optional[datetime] = None
    expense_type: Optional[ExpenseType] = None
    merchant: Optional[str] = Field(None, max_length=300)


class ExpenseLineItemResponse(UTCResponseBase):
    """Expense line item response"""

    model_config = _RESPONSE_CONFIG

    id: str
    expense_report_id: str
    budget_id: Optional[str] = None
    description: str
    amount: Decimal
    date_incurred: datetime
    expense_type: str
    receipt_url: Optional[str] = None
    receipt_document_id: Optional[str] = None
    receipt_file_url: Optional[str] = None
    merchant: Optional[str] = None
    # Submitted after the department's substantiation deadline; decided at
    # submission.
    substantiated_late: bool = False
    # This payment's own classification, and the one it takes once its budget
    # category's is applied (detail responses; app/services/functional_expenses.py).
    functional_class: Optional[str] = None
    effective_functional_class: Optional[str] = None
    # The restricted fund this payment spends, and its name (detail
    # responses; app/services/restricted_funds.py).
    fund_campaign_id: Optional[str] = None
    fund_name: Optional[str] = None
    created_at: datetime

    _safe_receipt_url = field_validator("receipt_url", mode="before")(safe_external_url)

    @model_validator(mode="after")
    def _set_receipt_file_url(self):
        if self.receipt_document_id:
            self.receipt_file_url = (
                f"/api/v1/finance/expense-reports/{self.expense_report_id}"
                f"/items/{self.id}/receipt"
            )
        return self


class ExpenseReportCreate(BaseModel):
    """Create an expense report"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None
    # The member's own issued cash advance this report accounts for
    # (app/services/cash_advances.py).
    advance_id: Optional[str] = None
    line_items: Optional[list[ExpenseLineItemCreate]] = None


class ExpenseReportUpdate(BaseModel):
    """Update an expense report"""

    model_config = _REQUEST_CONFIG

    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None
    # Null clears it; only while the report is a draft.
    advance_id: Optional[str] = None


class ExpenseReportResponse(UTCResponseBase):
    """Expense report response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    report_number: str
    submitted_by: str
    fiscal_year_id: str
    title: str
    description: Optional[str] = None
    total_amount: Decimal
    status: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    # A first approval held for a second approver by the dual-approval
    # threshold, and whether the request is waiting on that second approval
    # (set on detail responses, from FinanceService.is_awaiting_second_approval).
    first_approved_by: Optional[str] = None
    first_approved_at: Optional[datetime] = None
    awaiting_second_approval: bool = False
    denial_reason: Optional[str] = None
    paid_at: Optional[datetime] = None
    payment_method: Optional[str] = None
    qb_exported_at: Optional[datetime] = None
    notes: Optional[str] = None
    # The cash advance this report accounts for, and how much of the report
    # it covers (set on submission); the rest is reimbursed.
    advance_id: Optional[str] = None
    advance_applied: Optional[Decimal] = None
    # When the member submitted it; null on reports submitted before this was
    # recorded.
    submitted_at: Optional[datetime] = None
    # The substantiation deadline: how many lines were submitted after it, who
    # first acknowledged them on approval, and whether the report is waiting
    # for that acknowledgement (set on detail responses).
    late_line_count: int = 0
    late_acknowledged_by: Optional[str] = None
    late_acknowledged_at: Optional[datetime] = None
    awaiting_late_acknowledgement: bool = False
    # How far this payment would take its restricted funds past what they
    # have left, while it is not yet approved; null when it fits or charges
    # no fund (detail responses).
    fund_shortfall: Optional[Decimal] = None
    # The purchase request this report claims back, and the check paying the
    # member, while one does (app/services/finance_reimbursement.py; detail
    # responses). ``amount_owed`` is what a check would pay: the total less
    # what a cash advance already covered.
    purchase_request_id: Optional[str] = None
    purchase_request_number: Optional[str] = None
    reimbursement_check_id: Optional[str] = None
    reimbursement_check_number: Optional[str] = None
    reimbursement_check_status: Optional[str] = None
    amount_owed: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime
    line_items: list[ExpenseLineItemResponse] = []
    approval_steps: list[ApprovalStepRecordResponse] = []

    @model_validator(mode="after")
    def _count_late_lines(self):
        self.late_line_count = sum(
            1 for item in self.line_items if item.substantiated_late
        )
        return self


# ============================================
# Check Request Schemas
# ============================================


class CheckRequestCreate(BaseModel):
    """Create a check request"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    budget_id: Optional[str] = None
    # A restricted fund (a fundraising campaign marked restricted) this
    # payment spends; app/services/restricted_funds.py.
    fund_campaign_id: Optional[str] = None
    # Cash advanced to the requester ahead of an expense; charges no budget
    # line or fund (app/services/cash_advances.py). Fixed at creation.
    is_advance: bool = False
    payee_name: str = Field(..., min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None


class CheckRequestUpdate(BaseModel):
    """Update a check request"""

    model_config = _REQUEST_CONFIG

    budget_id: Optional[str] = None
    # A restricted fund (a fundraising campaign marked restricted) this
    # payment spends; app/services/restricted_funds.py.
    fund_campaign_id: Optional[str] = None
    payee_name: Optional[str] = Field(None, min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: Optional[Decimal] = Field(None, gt=0, max_digits=12, decimal_places=2)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[UTCDateTime] = None


class CheckRequestResponse(UTCResponseBase):
    """Check request response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    request_number: str
    requested_by: str
    fiscal_year_id: str
    budget_id: Optional[str] = None
    # This payment's own classification, and the one it takes once its budget
    # category's is applied (detail responses; app/services/functional_expenses.py).
    functional_class: Optional[str] = None
    effective_functional_class: Optional[str] = None
    # The restricted fund this payment spends, and its name (detail
    # responses; app/services/restricted_funds.py).
    fund_campaign_id: Optional[str] = None
    fund_name: Optional[str] = None
    # How far this payment would take its restricted funds past what they
    # have left, while it is not yet approved; null when it fits or charges
    # no fund (detail responses).
    fund_shortfall: Optional[Decimal] = None
    is_advance: bool = False
    payee_name: str
    payee_address: Optional[str] = None
    amount: Decimal
    memo: Optional[str] = None
    purpose: Optional[str] = None
    status: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    # A first approval held for a second approver by the dual-approval
    # threshold, and whether the request is waiting on that second approval
    # (set on detail responses, from FinanceService.is_awaiting_second_approval).
    first_approved_by: Optional[str] = None
    first_approved_at: Optional[datetime] = None
    awaiting_second_approval: bool = False
    denial_reason: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    qb_exported_at: Optional[datetime] = None
    # When the reversing entry for a void went to QuickBooks.
    qb_void_exported_at: Optional[datetime] = None
    # The expense report this check reimburses the member for; the number is
    # set on detail responses (app/services/finance_reimbursement.py).
    expense_report_id: Optional[str] = None
    expense_report_number: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approval_steps: list[ApprovalStepRecordResponse] = []


class ReimbursementReportCreate(BaseModel):
    """Claim back an approved purchase the requester paid for themselves.

    Each field defaults to the purchase request's own: its actual amount
    (else its estimate), the day it was received or ordered, its vendor.
    """

    model_config = _REQUEST_CONFIG

    amount: Optional[Decimal] = Field(None, gt=0, max_digits=12, decimal_places=2)
    date_incurred: Optional[UTCDateTime] = None
    merchant: Optional[str] = Field(None, max_length=300)


class ReimbursementCheckCreate(BaseModel):
    """Pay an approved expense report by check, to the member who filed it."""

    model_config = _REQUEST_CONFIG

    payee_address: Optional[str] = Field(None, max_length=1000)
    memo: Optional[str] = Field(None, max_length=500)


# ============================================
# Dues Schemas
# ============================================


class DuesScheduleCreate(BaseModel):
    """Create a dues schedule"""

    model_config = _REQUEST_CONFIG

    _check_frequency = field_validator("frequency")(
        _enum_check(_DUES_FREQUENCIES, "frequency")
    )

    name: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    frequency: str
    due_date: UTCDateTime
    grace_period_days: int = Field(30, ge=0, le=INT32_MAX)
    late_fee_amount: Optional[Decimal] = Field(None, max_digits=12, decimal_places=2)
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    notes: Optional[str] = None
    # QuickBooks accounts for this schedule's payments; blank takes the
    # department's default.
    qb_income_account: Optional[str] = Field(None, max_length=200)
    qb_deposit_account: Optional[str] = Field(None, max_length=200)

    _blank_accounts = field_validator(
        "qb_income_account", "qb_deposit_account", mode="before"
    )(_strip_or_none)


class DuesScheduleUpdate(BaseModel):
    """Update a dues schedule"""

    model_config = _REQUEST_CONFIG

    _check_frequency = field_validator("frequency")(
        _enum_check(_DUES_FREQUENCIES, "frequency")
    )

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    amount: Optional[Decimal] = Field(None, gt=0, max_digits=12, decimal_places=2)
    frequency: Optional[str] = None
    due_date: Optional[UTCDateTime] = None
    grace_period_days: Optional[int] = Field(None, ge=0, le=INT32_MAX)
    late_fee_amount: Optional[Decimal] = Field(None, max_digits=12, decimal_places=2)
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    # QuickBooks accounts for this schedule's payments; blank takes the
    # department's default.
    qb_income_account: Optional[str] = Field(None, max_length=200)
    qb_deposit_account: Optional[str] = Field(None, max_length=200)

    _blank_accounts = field_validator(
        "qb_income_account", "qb_deposit_account", mode="before"
    )(_strip_or_none)


class DuesScheduleResponse(UTCResponseBase):
    """Dues schedule response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    amount: Decimal
    frequency: str
    due_date: datetime
    grace_period_days: int
    late_fee_amount: Optional[Decimal] = Field(None, decimal_places=2)
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    is_active: bool
    notes: Optional[str] = None
    qb_income_account: Optional[str] = None
    qb_deposit_account: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class MemberDuesResponse(UTCResponseBase):
    """Member dues response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    dues_schedule_id: str
    user_id: str
    amount_due: Decimal
    amount_paid: Decimal
    status: str
    due_date: datetime
    paid_date: Optional[datetime] = None
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    late_fee_applied: Optional[Decimal] = None
    waived_by: Optional[str] = None
    waived_at: Optional[datetime] = None
    waive_reason: Optional[str] = None
    notes: Optional[str] = None
    # Set by the list endpoint only; a single-record write response omits it.
    member_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DuesPaymentResponse(UTCResponseBase):
    """One payment in a member's dues ledger"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    member_dues_id: str
    amount: Decimal
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    notes: Optional[str] = None
    # When a complete QuickBooks export carried this payment.
    qb_exported_at: Optional[datetime] = None
    received_at: datetime
    recorded_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MemberDuesPayment(BaseModel):
    """Record a dues payment"""

    model_config = _REQUEST_CONFIG

    amount_paid: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    notes: Optional[str] = None
    # W66-3: the officer confirmed that what exceeds the balance is a donation.
    # Without it an overpayment is refused.
    excess_as_donation: bool = False


class MemberDuesWaive(BaseModel):
    """Waive a member's dues"""

    model_config = _REQUEST_CONFIG

    reason: str = Field(..., min_length=1)


class MemberDuesUnwaive(BaseModel):
    """Reverse a waiver on a member's dues"""

    model_config = _REQUEST_CONFIG

    # Keep an explicit explanation in the request so reversals are deliberate.
    # It is handled transiently and must not be copied into the immutable audit
    # log because free text may contain sensitive personal information.
    reason: str = Field(..., min_length=1)


class DuesSummaryResponse(BaseModel):
    """Aggregated dues collection summary"""

    model_config = _RESPONSE_CONFIG

    total_expected: Decimal
    total_collected: Decimal
    total_outstanding: Decimal
    total_waived: Decimal
    collection_rate: float
    members_paid: int
    members_overdue: int
    members_waived: int


# ============================================
# Export Schemas
# ============================================


class ExportMappingCreate(BaseModel):
    """Create an export mapping"""

    model_config = _REQUEST_CONFIG

    _check_mapping_type = field_validator("mapping_type")(
        _enum_check(_MAPPING_TYPES, "mapping_type")
    )

    internal_category: str = Field(..., min_length=1, max_length=200)
    qb_account_name: str = Field(..., min_length=1, max_length=200)
    qb_account_number: Optional[str] = None
    qb_offset_account_name: Optional[str] = Field(None, max_length=200)
    mapping_type: str


class ExportMappingUpdate(BaseModel):
    """Update an export mapping"""

    model_config = _REQUEST_CONFIG

    _check_mapping_type = field_validator("mapping_type")(
        _enum_check(_MAPPING_TYPES, "mapping_type")
    )

    internal_category: Optional[str] = Field(None, min_length=1, max_length=200)
    qb_account_name: Optional[str] = Field(None, min_length=1, max_length=200)
    qb_account_number: Optional[str] = None
    qb_offset_account_name: Optional[str] = Field(None, max_length=200)
    mapping_type: Optional[str] = None


class ExportMappingResponse(UTCResponseBase):
    """Export mapping response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    internal_category: str
    qb_account_name: str
    qb_account_number: Optional[str] = None
    qb_offset_account_name: Optional[str] = None
    mapping_type: str
    created_at: datetime
    updated_at: datetime


class ExportReadinessCategoryResponse(UTCResponseBase):
    """What an export would post one budget category to."""

    model_config = _RESPONSE_CONFIG

    category_id: str
    category_name: str
    is_active: bool
    # ready, no_account, no_offset, duplicate_mappings, payable_receivable,
    # unsafe_account_name (starts with =, +, - or @) or not_in_chart
    status: str
    account_name: Optional[str] = None
    # category (its own qb_account_name), mapping, or parent (inherited)
    account_source: Optional[str] = None
    offset_account_name: Optional[str] = None
    # The ancestor category each account came from, when this one has none of
    # its own.
    account_inherited_from: Optional[str] = None
    offset_inherited_from: Optional[str] = None
    # With not_in_chart: which of the two the uploaded chart lacks.
    accounts_not_in_chart: list[str] = []
    mapping_ids: list[str]


class DuesScheduleExportResponse(UTCResponseBase):
    """What an export would post one dues schedule's payments to."""

    model_config = _RESPONSE_CONFIG

    schedule_id: str
    name: str
    is_active: bool
    # ready, no_income, no_deposit, payable_receivable, unsafe_account_name
    # or not_in_chart
    status: str
    income_account: Optional[str] = None
    # schedule (its own) or default (the department's)
    income_source: Optional[str] = None
    deposit_account: Optional[str] = None
    deposit_source: Optional[str] = None
    accounts_not_in_chart: list[str] = []


class DuesExportReadinessResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    # False until the department names a dues account anywhere; until then
    # dues payments are left out of the export.
    enabled: bool = False
    default_income_account: Optional[str] = None
    default_deposit_account: Optional[str] = None
    schedules: list[DuesScheduleExportResponse] = []


class AdvanceExportReadinessResponse(UTCResponseBase):
    """Where cash advances post, and whether they can be exported."""

    model_config = _RESPONSE_CONFIG

    # ready, no_advances_account, no_cash_account, payable_receivable,
    # unsafe_account_name or not_in_chart
    status: str = "no_advances_account"
    # The asset account an advance is owed on, and the bank account it is
    # paid from and returned to.
    advances_account: Optional[str] = None
    cash_account: Optional[str] = None
    accounts_not_in_chart: list[str] = []


class ExportReadinessResponse(UTCResponseBase):
    """Export readiness for every budget category in the organization."""

    model_config = _RESPONSE_CONFIG

    categories: list[ExportReadinessCategoryResponse]
    unmatched_mapping_ids: list[str]
    dues: DuesExportReadinessResponse = DuesExportReadinessResponse()
    advances: AdvanceExportReadinessResponse = AdvanceExportReadinessResponse()
    # Whether account names are being checked against an uploaded chart.
    chart_uploaded: bool = False


class QuickBooksChartAccountResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    name: str
    account_type: Optional[str] = None


class QuickBooksChartResponse(UTCResponseBase):
    """The QuickBooks chart of accounts the export checks names against."""

    model_config = _RESPONSE_CONFIG

    # None while no chart is on file, when names are not checked.
    uploaded_at: Optional[datetime] = None
    uploaded_by_name: Optional[str] = None
    accounts: list[QuickBooksChartAccountResponse] = []


class DuesDefaultAccountsUpdate(BaseModel):
    """The department's default QuickBooks accounts for dues payments; null or
    blank clears one."""

    model_config = _REQUEST_CONFIG

    income_account: Optional[str] = Field(..., max_length=200)
    deposit_account: Optional[str] = Field(..., max_length=200)


class AdvanceAccountsUpdate(BaseModel):
    """The QuickBooks accounts cash advances post to; null or blank clears
    one."""

    model_config = _REQUEST_CONFIG

    advances_account: Optional[str] = Field(..., max_length=200)
    cash_account: Optional[str] = Field(..., max_length=200)


# ============================================
# Cash Advance Schemas
# ============================================


class AdvanceSummaryResponse(UTCResponseBase):
    """An issued cash advance and what is left of it."""

    model_config = _RESPONSE_CONFIG

    id: str
    request_number: str
    member_id: str
    member_name: str
    amount: Decimal
    purpose: Optional[str] = None
    check_number: Optional[str] = None
    issued_at: Optional[datetime] = None
    # 120 days after the check: the IRS safe harbor for returning what was
    # not accounted for.
    due_at: Optional[datetime] = None
    # Covered by the member's submitted expense reports, and handed back.
    accounted: Decimal
    returned: Decimal
    outstanding: Decimal
    overdue: bool


class AdvancesReportResponse(UTCResponseBase):
    """Every cash advance not yet fully accounted for, oldest first."""

    model_config = _RESPONSE_CONFIG

    advances: list[AdvanceSummaryResponse]
    outstanding: Decimal
    overdue_outstanding: Decimal


class AdvanceReportResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    report_number: str
    title: str
    status: str
    total_amount: Decimal
    # How much of the report the advance covers; null until submitted.
    advance_applied: Optional[Decimal] = None
    submitted_at: Optional[datetime] = None


class AdvanceReturnResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    amount: Decimal
    returned_at: datetime
    payment_method: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    recorded_by: Optional[str] = None
    qb_exported_at: Optional[datetime] = None
    created_at: datetime


class AdvanceDetailResponse(AdvanceSummaryResponse):
    reports: list[AdvanceReportResponse] = []
    returns: list[AdvanceReturnResponse] = []


class AdvanceReturnCreate(BaseModel):
    """Unspent cash a member handed back against an advance."""

    model_config = _REQUEST_CONFIG

    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    # Defaults to now.
    returned_at: Optional[UTCDateTime] = None
    payment_method: Optional[str] = Field(None, max_length=50)
    reference: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=5000)

    @field_validator("payment_method", "reference", "notes")
    @classmethod
    def _blank_is_none(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


MAX_SYNCHRONOUS_EXPORT_DAYS = 366
MAX_SYNCHRONOUS_EXPORT_RECORDS = 10_000


class ExportRequest(BaseModel):
    """Request to generate an export"""

    model_config = _REQUEST_CONFIG

    date_range_start: datetime
    date_range_end: datetime
    file_format: str = "csv"
    # Send again payments an earlier export already carried. Off, the export
    # leaves them out so overlapping periods do not import twice.
    include_exported: bool = False
    # Send them even where their file was confirmed as imported into
    # QuickBooks; without it such a resend is refused (409).
    confirm_reimport: bool = False

    @field_validator("date_range_start", "date_range_end")
    @classmethod
    def _normalize_datetime(cls, v: datetime) -> datetime:
        # Pydantic v2 accepts both naive and timezone-aware ISO datetimes, but
        # comparing/subtracting the two forms raises TypeError -- a bare
        # Python exception the model validator below does not turn into a
        # 422 -- so a payload mixing them 500'd. Treat naive as UTC (the
        # project-wide wire convention), matching schemas/election.py's
        # _as_utc.
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.date_range_end < self.date_range_start:
            raise ValueError("date_range_end must be on or after date_range_start")
        if (self.date_range_end - self.date_range_start).total_seconds() > (
            MAX_SYNCHRONOUS_EXPORT_DAYS * 24 * 60 * 60
        ):
            raise ValueError(
                "Synchronous exports support a maximum date span of "
                f"{MAX_SYNCHRONOUS_EXPORT_DAYS} days; narrow the date range"
            )
        if self.file_format != "csv":
            raise ValueError("Only csv synchronous exports are supported")
        return self


class ExportLogResponse(UTCResponseBase):
    """Export log response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    export_type: str
    date_range_start: datetime
    date_range_end: datetime
    record_count: int
    file_format: str
    exported_by: str
    exported_at: datetime
    exported_by_name: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    completed_at: Optional[datetime] = None
    # When the Treasurer confirmed the file was imported into QuickBooks.
    imported_at: Optional[datetime] = None
    imported_by: Optional[str] = None
    imported_by_name: Optional[str] = None


# ============================================
# Dashboard Schemas
# ============================================


class FinanceDashboardResponse(BaseModel):
    """Finance dashboard overview"""

    model_config = _RESPONSE_CONFIG

    budget_health: BudgetSummaryResponse
    pending_approvals_count: int
    pending_purchase_requests: int
    pending_expense_reports: int
    pending_check_requests: int
    dues_collection_rate: float
    recent_transactions: list[dict] = []
