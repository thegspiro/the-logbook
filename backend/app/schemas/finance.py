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
    DuesFrequency,
    ExpenseType,
    ExportMappingType,
    PurchaseRequestPriority,
)
from app.schemas.base import UTCResponseBase

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
    # requests, leadership_review or board_review; null unless a draft.
    planning_stage: Optional[str] = None
    # The board's adoption, recorded when the draft was activated.
    adopted_on: Optional[date] = None
    adoption_reference: Optional[str] = None
    adoption_notes: Optional[str] = None
    adoption_recorded_by: Optional[str] = None
    adoption_recorded_at: Optional[datetime] = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class FiscalYearStageChange(BaseModel):
    """Move a draft year one planning stage forward or back."""

    model_config = _REQUEST_CONFIG

    stage: str

    _check_stage = field_validator("stage")(
        _enum_check(("requests", "leadership_review", "board_review"), "stage")
    )


class FiscalYearActivate(BaseModel):
    """The board's adoption, required to activate a draft year.

    Optional so re-activating a year that is not a draft needs no body; the
    service refuses a draft without the date and reference.
    """

    model_config = _REQUEST_CONFIG

    adopted_on: Optional[date] = None
    adoption_reference: Optional[str] = Field(None, max_length=500)
    adoption_notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("adoption_reference", "adoption_notes")
    @classmethod
    def _blank_is_none(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class StartFromLastYearResponse(BaseModel):
    """What "Start from last year" did: lines copied, and lines already there."""

    model_config = _RESPONSE_CONFIG

    created: int
    skipped: int


# ============================================
# Budget Category Schemas
# ============================================


class BudgetCategoryCreate(BaseModel):
    """Create a budget category"""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: int = 0
    qb_account_name: Optional[str] = Field(None, max_length=200)
    owner_position_id: Optional[str] = None


class BudgetCategoryUpdate(BaseModel):
    """Update a budget category"""

    model_config = _REQUEST_CONFIG

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    qb_account_name: Optional[str] = Field(None, max_length=200)
    # Omitted leaves the owner alone; an explicit null clears it.
    owner_position_id: Optional[str] = None


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
    created_at: datetime
    updated_at: datetime


# ============================================
# Budget Schemas
# ============================================


class BudgetCreate(BaseModel):
    """Create a budget line"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    category_id: str
    amount_budgeted: Decimal = Field(..., ge=0, decimal_places=2)
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

    amount_budgeted: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
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
    amendments_total: Decimal = Decimal("0")
    amendment_count: int = 0
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


class BudgetAmendmentResponse(UTCResponseBase):
    """One recorded amendment to a budget line.

    A reversing entry has a negative ``amount`` and names the amendment it
    cancels in ``reverses_amendment_id``; ``is_reversal`` says which kind a
    row is. On a reversed amendment, ``reversed_by_amendment_id``,
    ``reversed_at`` (when the reversal was entered) and ``reversed_by_name``
    (who entered it) are filled from that reversal.
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


class BudgetAmendmentCreatedResponse(BaseModel):
    """The new amendment (or reversal) and the line as it now stands."""

    model_config = _RESPONSE_CONFIG

    amendment: BudgetAmendmentResponse
    budget: BudgetResponse


class FinanceNamedOptionResponse(BaseModel):
    """An id and a name, for the budget form's position and station pickers."""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str


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
    """A budget line as a request form offers it: a name and what is left.

    Deliberately not ``BudgetResponse``. ``finance.request`` holders see this
    and nothing more of the budget — the budgeted, spent and encumbered
    figures stay behind ``finance.view``.
    """

    model_config = _RESPONSE_CONFIG

    id: str
    label: str
    amount_remaining: Decimal


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

    step_order: int = Field(..., ge=1)
    name: str = Field(..., min_length=1, max_length=200)
    step_type: str = "approval"
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: bool = False
    auto_approve_under: Optional[Decimal] = Field(None, decimal_places=2)
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

    step_order: Optional[int] = Field(None, ge=1)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    step_type: Optional[str] = None
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: Optional[bool] = None
    auto_approve_under: Optional[Decimal] = Field(None, decimal_places=2)
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


class ApprovalChainCreate(BaseModel):
    """Create an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_applies_to = field_validator("applies_to")(
        _enum_check(_APPLIES_TO, "applies_to")
    )

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: str
    min_amount: Optional[Decimal] = Field(None, decimal_places=2)
    max_amount: Optional[Decimal] = Field(None, decimal_places=2)
    budget_category_id: Optional[str] = None
    is_default: bool = False
    steps: Optional[list[ApprovalChainStepCreate]] = None


class ApprovalChainUpdate(BaseModel):
    """Update an approval chain"""

    model_config = _REQUEST_CONFIG

    _check_applies_to = field_validator("applies_to")(
        _enum_check(_APPLIES_TO, "applies_to")
    )

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: Optional[str] = None
    min_amount: Optional[Decimal] = Field(None, decimal_places=2)
    max_amount: Optional[Decimal] = Field(None, decimal_places=2)
    budget_category_id: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


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
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Decimal = Field(..., gt=0, decimal_places=2)
    priority: str = "medium"
    notes: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None


class PurchaseRequestUpdate(BaseModel):
    """Update a purchase request"""

    model_config = _REQUEST_CONFIG

    _check_priority = field_validator("priority")(_enum_check(_PRIORITIES, "priority"))

    budget_id: Optional[str] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    actual_amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    priority: Optional[str] = None
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None


class PurchaseRequestResponse(UTCResponseBase):
    """Purchase request response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    request_number: str
    fiscal_year_id: str
    budget_id: Optional[str] = None
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
    denial_reason: Optional[str] = None
    ordered_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approval_steps: list[ApprovalStepRecordResponse] = []


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
    description: str = Field(..., min_length=1, max_length=500)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    date_incurred: datetime
    # Typed as the enum so an unknown value is rejected with a 422 here rather
    # than reaching MySQL, where the column is an ENUM and the insert fails with
    # "Data truncated for column 'expense_type'" — surfaced to the client as a
    # bare 500 with nothing pointing at the offending field.
    expense_type: ExpenseType = ExpenseType.GENERAL
    receipt_url: Optional[str] = None
    merchant: Optional[str] = None


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
    merchant: Optional[str] = None
    created_at: datetime


class ExpenseReportCreate(BaseModel):
    """Create an expense report"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None
    line_items: Optional[list[ExpenseLineItemCreate]] = None


class ExpenseReportUpdate(BaseModel):
    """Update an expense report"""

    model_config = _REQUEST_CONFIG

    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None


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
    denial_reason: Optional[str] = None
    paid_at: Optional[datetime] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    line_items: list[ExpenseLineItemResponse] = []
    approval_steps: list[ApprovalStepRecordResponse] = []


# ============================================
# Check Request Schemas
# ============================================


class CheckRequestCreate(BaseModel):
    """Create a check request"""

    model_config = _REQUEST_CONFIG

    fiscal_year_id: str
    budget_id: Optional[str] = None
    payee_name: str = Field(..., min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None


class CheckRequestUpdate(BaseModel):
    """Update a check request"""

    model_config = _REQUEST_CONFIG

    budget_id: Optional[str] = None
    payee_name: Optional[str] = Field(None, min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None


class CheckRequestResponse(UTCResponseBase):
    """Check request response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    request_number: str
    requested_by: str
    fiscal_year_id: str
    budget_id: Optional[str] = None
    payee_name: str
    payee_address: Optional[str] = None
    amount: Decimal
    memo: Optional[str] = None
    purpose: Optional[str] = None
    status: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    denial_reason: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    approval_steps: list[ApprovalStepRecordResponse] = []


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
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    frequency: str
    due_date: datetime
    grace_period_days: int = Field(30, ge=0)
    late_fee_amount: Optional[Decimal] = Field(None, decimal_places=2)
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    notes: Optional[str] = None


class DuesScheduleUpdate(BaseModel):
    """Update a dues schedule"""

    model_config = _REQUEST_CONFIG

    _check_frequency = field_validator("frequency")(
        _enum_check(_DUES_FREQUENCIES, "frequency")
    )

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    frequency: Optional[str] = None
    due_date: Optional[datetime] = None
    grace_period_days: Optional[int] = Field(None, ge=0)
    late_fee_amount: Optional[Decimal] = Field(None, decimal_places=2)
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


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
    received_at: datetime
    recorded_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MemberDuesPayment(BaseModel):
    """Record a dues payment"""

    model_config = _REQUEST_CONFIG

    amount_paid: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    notes: Optional[str] = None


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
    # ready, no_account, no_offset or duplicate_mappings
    status: str
    account_name: Optional[str] = None
    # category (its own qb_account_name) or mapping
    account_source: Optional[str] = None
    offset_account_name: Optional[str] = None
    mapping_ids: list[str]


class ExportReadinessResponse(UTCResponseBase):
    """Export readiness for every budget category in the organization."""

    model_config = _RESPONSE_CONFIG

    categories: list[ExportReadinessCategoryResponse]
    unmatched_mapping_ids: list[str]


MAX_SYNCHRONOUS_EXPORT_DAYS = 366
MAX_SYNCHRONOUS_EXPORT_RECORDS = 10_000


class ExportRequest(BaseModel):
    """Request to generate an export"""

    model_config = _REQUEST_CONFIG

    date_range_start: datetime
    date_range_end: datetime
    file_format: str = "csv"

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
    status: str
    error_message: Optional[str] = None
    completed_at: Optional[datetime] = None


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
