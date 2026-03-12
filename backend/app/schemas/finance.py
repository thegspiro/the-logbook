"""
Finance Module Schemas

Pydantic request/response schemas for fiscal years, budgets,
purchase requests, expense reports, check requests, dues,
approval chains, and export operations.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)


# ============================================
# Fiscal Year Schemas
# ============================================


class FiscalYearCreate(BaseModel):
    """Create a new fiscal year"""

    name: str = Field(..., min_length=1, max_length=100)
    start_date: datetime
    end_date: datetime


class FiscalYearUpdate(BaseModel):
    """Update a fiscal year"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class FiscalYearResponse(BaseModel):
    """Fiscal year response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    start_date: datetime
    end_date: datetime
    status: str
    is_locked: bool
    created_by: str
    created_at: datetime
    updated_at: datetime


# ============================================
# Budget Category Schemas
# ============================================


class BudgetCategoryCreate(BaseModel):
    """Create a budget category"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: int = 0
    qb_account_name: Optional[str] = None


class BudgetCategoryUpdate(BaseModel):
    """Update a budget category"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    parent_category_id: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    qb_account_name: Optional[str] = None


class BudgetCategoryResponse(BaseModel):
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
    created_at: datetime
    updated_at: datetime


# ============================================
# Budget Schemas
# ============================================


class BudgetCreate(BaseModel):
    """Create a budget line"""

    fiscal_year_id: str
    category_id: str
    amount_budgeted: float = Field(..., ge=0)
    notes: Optional[str] = None
    station_id: Optional[str] = None


class BudgetUpdate(BaseModel):
    """Update a budget line"""

    amount_budgeted: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    station_id: Optional[str] = None


class BudgetResponse(BaseModel):
    """Budget response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    fiscal_year_id: str
    category_id: str
    amount_budgeted: float
    amount_spent: float
    amount_encumbered: float
    notes: Optional[str] = None
    station_id: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class BudgetSummaryResponse(BaseModel):
    """Aggregated budget summary"""

    model_config = _RESPONSE_CONFIG

    total_budgeted: float
    total_spent: float
    total_encumbered: float
    total_remaining: float
    percent_used: float
    category_breakdown: list[dict] = []


# ============================================
# Approval Chain Schemas
# ============================================


class ApprovalChainStepCreate(BaseModel):
    """Create a step in an approval chain"""

    step_order: int = Field(..., ge=1)
    name: str = Field(..., min_length=1, max_length=200)
    step_type: str = "approval"
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: bool = False
    auto_approve_under: Optional[float] = None
    required: bool = True


class ApprovalChainStepUpdate(BaseModel):
    """Update a step in an approval chain"""

    step_order: Optional[int] = Field(None, ge=1)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    step_type: Optional[str] = None
    approver_type: Optional[str] = None
    approver_value: Optional[str] = None
    notification_emails: Optional[list[str]] = None
    email_template_id: Optional[str] = None
    allow_self_approval: Optional[bool] = None
    auto_approve_under: Optional[float] = None
    required: Optional[bool] = None


class ApprovalChainStepResponse(BaseModel):
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
    auto_approve_under: Optional[float] = None
    required: bool
    created_at: datetime


class ApprovalChainCreate(BaseModel):
    """Create an approval chain"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: str
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    budget_category_id: Optional[str] = None
    is_default: bool = False
    steps: Optional[list[ApprovalChainStepCreate]] = None


class ApprovalChainUpdate(BaseModel):
    """Update an approval chain"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    applies_to: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    budget_category_id: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class ApprovalChainResponse(BaseModel):
    """Approval chain response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    applies_to: str
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    budget_category_id: Optional[str] = None
    is_default: bool
    is_active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    steps: list[ApprovalChainStepResponse] = []


class ApprovalStepRecordResponse(BaseModel):
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


class ApprovalActionRequest(BaseModel):
    """Request to approve or deny a step"""

    notes: Optional[str] = None


class PendingApprovalResponse(BaseModel):
    """Pending approval for the current user"""

    model_config = _RESPONSE_CONFIG

    step_record_id: str
    entity_type: str
    entity_id: str
    entity_title: str
    entity_amount: float
    requester_name: str
    step_name: str
    step_order: int
    submitted_at: datetime


# ============================================
# Purchase Request Schemas
# ============================================


class PurchaseRequestCreate(BaseModel):
    """Create a purchase request"""

    fiscal_year_id: str
    budget_id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: float = Field(..., gt=0)
    priority: str = "medium"
    notes: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None


class PurchaseRequestUpdate(BaseModel):
    """Update a purchase request"""

    budget_id: Optional[str] = None
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    vendor: Optional[str] = None
    estimated_amount: Optional[float] = Field(None, gt=0)
    actual_amount: Optional[float] = Field(None, gt=0)
    priority: Optional[str] = None
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    apparatus_id: Optional[str] = None
    facility_id: Optional[str] = None


class PurchaseRequestResponse(BaseModel):
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
    estimated_amount: float
    actual_amount: Optional[float] = None
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


class DenialRequest(BaseModel):
    """Request to deny a purchase request, expense, or check request"""

    reason: str = Field(..., min_length=1)


# ============================================
# Expense Report Schemas
# ============================================


class ExpenseLineItemCreate(BaseModel):
    """Create an expense line item"""

    budget_id: Optional[str] = None
    description: str = Field(..., min_length=1, max_length=500)
    amount: float = Field(..., gt=0)
    date_incurred: datetime
    expense_type: str = "general"
    receipt_url: Optional[str] = None
    merchant: Optional[str] = None


class ExpenseLineItemUpdate(BaseModel):
    """Update an expense line item"""

    budget_id: Optional[str] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    amount: Optional[float] = Field(None, gt=0)
    date_incurred: Optional[datetime] = None
    expense_type: Optional[str] = None
    receipt_url: Optional[str] = None
    merchant: Optional[str] = None


class ExpenseLineItemResponse(BaseModel):
    """Expense line item response"""

    model_config = _RESPONSE_CONFIG

    id: str
    expense_report_id: str
    budget_id: Optional[str] = None
    description: str
    amount: float
    date_incurred: datetime
    expense_type: str
    receipt_url: Optional[str] = None
    merchant: Optional[str] = None
    created_at: datetime


class ExpenseReportCreate(BaseModel):
    """Create an expense report"""

    fiscal_year_id: str
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None
    line_items: Optional[list[ExpenseLineItemCreate]] = None


class ExpenseReportUpdate(BaseModel):
    """Update an expense report"""

    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    notes: Optional[str] = None


class ExpenseReportResponse(BaseModel):
    """Expense report response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    report_number: str
    submitted_by: str
    fiscal_year_id: str
    title: str
    description: Optional[str] = None
    total_amount: float
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

    fiscal_year_id: str
    budget_id: Optional[str] = None
    payee_name: str = Field(..., min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: float = Field(..., gt=0)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None


class CheckRequestUpdate(BaseModel):
    """Update a check request"""

    budget_id: Optional[str] = None
    payee_name: Optional[str] = Field(None, min_length=1, max_length=300)
    payee_address: Optional[str] = None
    amount: Optional[float] = Field(None, gt=0)
    memo: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None
    check_number: Optional[str] = None
    check_date: Optional[datetime] = None


class CheckRequestResponse(BaseModel):
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
    amount: float
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

    name: str = Field(..., min_length=1, max_length=200)
    amount: float = Field(..., gt=0)
    frequency: str
    due_date: datetime
    grace_period_days: int = Field(30, ge=0)
    late_fee_amount: Optional[float] = None
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    notes: Optional[str] = None


class DuesScheduleUpdate(BaseModel):
    """Update a dues schedule"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    amount: Optional[float] = Field(None, gt=0)
    frequency: Optional[str] = None
    due_date: Optional[datetime] = None
    grace_period_days: Optional[int] = Field(None, ge=0)
    late_fee_amount: Optional[float] = None
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class DuesScheduleResponse(BaseModel):
    """Dues schedule response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    amount: float
    frequency: str
    due_date: datetime
    grace_period_days: int
    late_fee_amount: Optional[float] = None
    fiscal_year_id: Optional[str] = None
    applies_to_membership_types: Optional[list[str]] = None
    is_active: bool
    notes: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class MemberDuesResponse(BaseModel):
    """Member dues response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    dues_schedule_id: str
    user_id: str
    amount_due: float
    amount_paid: float
    status: str
    due_date: datetime
    paid_date: Optional[datetime] = None
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    late_fee_applied: Optional[float] = None
    waived_by: Optional[str] = None
    waived_at: Optional[datetime] = None
    waive_reason: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MemberDuesPayment(BaseModel):
    """Record a dues payment"""

    amount_paid: float = Field(..., gt=0)
    payment_method: Optional[str] = None
    transaction_reference: Optional[str] = None
    notes: Optional[str] = None


class MemberDuesWaive(BaseModel):
    """Waive a member's dues"""

    reason: str = Field(..., min_length=1)


class DuesSummaryResponse(BaseModel):
    """Aggregated dues collection summary"""

    model_config = _RESPONSE_CONFIG

    total_expected: float
    total_collected: float
    total_outstanding: float
    total_waived: float
    collection_rate: float
    members_paid: int
    members_overdue: int
    members_waived: int


# ============================================
# Export Schemas
# ============================================


class ExportMappingCreate(BaseModel):
    """Create an export mapping"""

    internal_category: str = Field(..., min_length=1, max_length=200)
    qb_account_name: str = Field(..., min_length=1, max_length=200)
    qb_account_number: Optional[str] = None
    mapping_type: str


class ExportMappingUpdate(BaseModel):
    """Update an export mapping"""

    internal_category: Optional[str] = Field(None, min_length=1, max_length=200)
    qb_account_name: Optional[str] = Field(None, min_length=1, max_length=200)
    qb_account_number: Optional[str] = None
    mapping_type: Optional[str] = None


class ExportMappingResponse(BaseModel):
    """Export mapping response"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    internal_category: str
    qb_account_name: str
    qb_account_number: Optional[str] = None
    mapping_type: str
    created_at: datetime
    updated_at: datetime


class ExportRequest(BaseModel):
    """Request to generate an export"""

    date_range_start: datetime
    date_range_end: datetime
    file_format: str = "csv"


class ExportLogResponse(BaseModel):
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
