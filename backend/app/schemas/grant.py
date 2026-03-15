"""
Grant & Fundraising Pydantic Schemas

Request and response schemas for grant management, fundraising campaigns,
donations, donors, pledges, and fundraising events.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from app.schemas.base import stamp_naive_datetimes_utc

_response_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)

_request_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

# ============================================
# Enum Literal Types
# Mirrors the SQLAlchemy enums in app.models.grant so that
# Pydantic rejects invalid values at request-parsing time.
# ============================================

DeadlineTypeLiteral = Literal["fixed", "recurring", "rolling"]

GrantCategoryLiteral = Literal[
    "equipment",
    "staffing",
    "training",
    "prevention",
    "facilities",
    "vehicles",
    "wellness",
    "community",
    "other",
]

ApplicationStatusLiteral = Literal[
    "researching",
    "preparing",
    "internal_review",
    "submitted",
    "under_review",
    "awarded",
    "denied",
    "active",
    "reporting",
    "closed",
]

ReportingFrequencyLiteral = Literal[
    "monthly",
    "quarterly",
    "semi_annual",
    "annual",
]

GrantPriorityLiteral = Literal["low", "medium", "high", "critical"]

BudgetItemCategoryLiteral = Literal[
    "equipment",
    "personnel",
    "training",
    "contractual",
    "supplies",
    "travel",
    "construction",
    "indirect",
    "other",
]

ComplianceTaskTypeLiteral = Literal[
    "performance_report",
    "financial_report",
    "progress_update",
    "site_visit",
    "audit",
    "equipment_inventory",
    "nfirs_submission",
    "closeout_report",
    "other",
]

ComplianceTaskStatusLiteral = Literal[
    "pending",
    "in_progress",
    "completed",
    "overdue",
    "waived",
]

GrantNoteTypeLiteral = Literal[
    "general",
    "status_change",
    "document_added",
    "contact_made",
    "milestone",
    "financial",
    "compliance",
]

CampaignTypeLiteral = Literal[
    "general",
    "equipment",
    "training",
    "community",
    "memorial",
    "event",
    "other",
]

CampaignStatusLiteral = Literal[
    "draft",
    "active",
    "paused",
    "completed",
    "cancelled",
]

DonorTypeLiteral = Literal[
    "individual",
    "business",
    "foundation",
    "government",
    "other",
]

PaymentMethodLiteral = Literal[
    "cash",
    "check",
    "credit_card",
    "bank_transfer",
    "paypal",
    "venmo",
    "other",
]

PaymentStatusLiteral = Literal[
    "pending",
    "completed",
    "failed",
    "refunded",
    "cancelled",
]

RecurringFrequencyLiteral = Literal[
    "weekly",
    "monthly",
    "quarterly",
    "annually",
]

DedicationTypeLiteral = Literal["in_honor", "in_memory"]

PledgeStatusLiteral = Literal[
    "pending",
    "partial",
    "fulfilled",
    "cancelled",
    "overdue",
]

FundraisingEventTypeLiteral = Literal[
    "dinner",
    "gala",
    "auction",
    "raffle",
    "golf_outing",
    "walkathon",
    "other",
]

FundraisingEventStatusLiteral = Literal[
    "planning",
    "open",
    "sold_out",
    "completed",
    "cancelled",
]


# ============================================
# Grant Opportunity Schemas
# ============================================


class GrantOpportunityBase(BaseModel):
    """Base grant opportunity schema"""

    model_config = _request_config

    name: str = Field(..., min_length=1, max_length=255)
    agency: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    eligible_uses: Optional[str] = None
    typical_award_min: Optional[Decimal] = Field(None, ge=0)
    typical_award_max: Optional[Decimal] = Field(None, ge=0)
    eligibility_criteria: Optional[str] = None
    application_url: Optional[str] = Field(None, max_length=500)
    program_url: Optional[str] = Field(None, max_length=500)
    match_required: bool = False
    match_percentage: Optional[Decimal] = Field(None, ge=0, le=100)
    match_description: Optional[str] = Field(None, max_length=500)
    deadline_type: Optional[DeadlineTypeLiteral] = None
    deadline_date: Optional[date] = None
    recurring_schedule: Optional[Dict[str, Any]] = None
    required_documents: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    category: Optional[GrantCategoryLiteral] = None
    federal_program_code: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None


class GrantOpportunityCreate(GrantOpportunityBase):
    """Schema for creating a new grant opportunity"""


class GrantOpportunityUpdate(BaseModel):
    """Schema for updating a grant opportunity"""

    model_config = _request_config

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    agency: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    eligible_uses: Optional[str] = None
    typical_award_min: Optional[Decimal] = Field(None, ge=0)
    typical_award_max: Optional[Decimal] = Field(None, ge=0)
    eligibility_criteria: Optional[str] = None
    application_url: Optional[str] = Field(None, max_length=500)
    program_url: Optional[str] = Field(None, max_length=500)
    match_required: Optional[bool] = None
    match_percentage: Optional[Decimal] = Field(None, ge=0, le=100)
    match_description: Optional[str] = Field(None, max_length=500)
    deadline_type: Optional[DeadlineTypeLiteral] = None
    deadline_date: Optional[date] = None
    recurring_schedule: Optional[Dict[str, Any]] = None
    required_documents: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    category: Optional[GrantCategoryLiteral] = None
    federal_program_code: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class GrantOpportunityResponse(GrantOpportunityBase):
    """Schema for grant opportunity response"""

    id: UUID
    organization_id: UUID
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantOpportunityResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Grant Application Schemas
# ============================================


class GrantApplicationBase(BaseModel):
    """Base grant application schema"""

    model_config = _request_config

    grant_program_name: Optional[str] = Field(None, max_length=255)
    grant_agency: Optional[str] = Field(None, max_length=255)
    application_status: ApplicationStatusLiteral = "researching"
    amount_requested: Optional[Decimal] = Field(None, ge=0)
    amount_awarded: Optional[Decimal] = Field(None, ge=0)
    match_amount: Optional[Decimal] = Field(None, ge=0)
    match_source: Optional[str] = Field(None, max_length=255)
    application_deadline: Optional[date] = None
    submitted_date: Optional[date] = None
    award_date: Optional[date] = None
    grant_start_date: Optional[date] = None
    grant_end_date: Optional[date] = None
    project_description: Optional[str] = None
    narrative_summary: Optional[str] = None
    budget_summary: Optional[Dict[str, Any]] = None
    key_contacts: Optional[List[Dict[str, Any]]] = None
    federal_award_id: Optional[str] = Field(None, max_length=100)
    nfirs_compliant: Optional[bool] = None
    performance_period_months: Optional[int] = Field(None, ge=0)
    reporting_frequency: Optional[ReportingFrequencyLiteral] = None
    next_report_due: Optional[date] = None
    final_report_due: Optional[date] = None
    priority: GrantPriorityLiteral = "medium"
    notes: Optional[str] = None


class GrantApplicationCreate(GrantApplicationBase):
    """Schema for creating a new grant application"""

    opportunity_id: Optional[UUID] = None


class GrantApplicationUpdate(BaseModel):
    """Schema for updating a grant application"""

    model_config = _request_config

    grant_program_name: Optional[str] = Field(None, max_length=255)
    grant_agency: Optional[str] = Field(None, max_length=255)
    application_status: Optional[ApplicationStatusLiteral] = None
    amount_requested: Optional[Decimal] = Field(None, ge=0)
    amount_awarded: Optional[Decimal] = Field(None, ge=0)
    match_amount: Optional[Decimal] = Field(None, ge=0)
    match_source: Optional[str] = Field(None, max_length=255)
    application_deadline: Optional[date] = None
    submitted_date: Optional[date] = None
    award_date: Optional[date] = None
    grant_start_date: Optional[date] = None
    grant_end_date: Optional[date] = None
    project_description: Optional[str] = None
    narrative_summary: Optional[str] = None
    budget_summary: Optional[Dict[str, Any]] = None
    key_contacts: Optional[List[Dict[str, Any]]] = None
    federal_award_id: Optional[str] = Field(None, max_length=100)
    nfirs_compliant: Optional[bool] = None
    performance_period_months: Optional[int] = Field(None, ge=0)
    reporting_frequency: Optional[ReportingFrequencyLiteral] = None
    next_report_due: Optional[date] = None
    final_report_due: Optional[date] = None
    priority: Optional[GrantPriorityLiteral] = None
    assigned_to: Optional[UUID] = None
    linked_campaign_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    notes: Optional[str] = None


class GrantApplicationResponse(GrantApplicationBase):
    """Schema for grant application response with nested relations"""

    id: UUID
    organization_id: UUID
    opportunity_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    linked_campaign_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    # Nested relations (populated via eager loading in get_application)
    budget_items: List["GrantBudgetItemResponse"] = []
    expenditures: List["GrantExpenditureResponse"] = []
    compliance_tasks: List["GrantComplianceTaskResponse"] = []
    grant_notes: List["GrantNoteResponse"] = []

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantApplicationResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class GrantApplicationListResponse(BaseModel):
    """Schema for grant application list item"""

    id: UUID
    grant_program_name: Optional[str] = None
    grant_agency: Optional[str] = None
    application_status: ApplicationStatusLiteral
    amount_requested: Optional[Decimal] = None
    amount_awarded: Optional[Decimal] = None
    application_deadline: Optional[date] = None
    grant_start_date: Optional[date] = None
    grant_end_date: Optional[date] = None
    priority: GrantPriorityLiteral
    assigned_to: Optional[UUID] = None
    created_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantApplicationListResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Grant Budget Item Schemas
# ============================================


class GrantBudgetItemBase(BaseModel):
    """Base grant budget item schema"""

    model_config = _request_config

    category: BudgetItemCategoryLiteral
    description: Optional[str] = Field(None, max_length=500)
    amount_budgeted: Decimal = Field(..., ge=0)
    federal_share: Optional[Decimal] = Field(None, ge=0)
    local_match: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None
    sort_order: int = 0


class GrantBudgetItemCreate(GrantBudgetItemBase):
    """Schema for creating a new grant budget item"""

    application_id: UUID


class GrantBudgetItemUpdate(BaseModel):
    """Schema for updating a grant budget item"""

    model_config = _request_config

    category: Optional[BudgetItemCategoryLiteral] = None
    description: Optional[str] = Field(None, max_length=500)
    amount_budgeted: Optional[Decimal] = Field(None, ge=0)
    federal_share: Optional[Decimal] = Field(None, ge=0)
    local_match: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class GrantBudgetItemResponse(GrantBudgetItemBase):
    """Schema for grant budget item response"""

    id: UUID
    application_id: UUID
    amount_spent: Decimal = Decimal("0")
    amount_remaining: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantBudgetItemResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Grant Expenditure Schemas
# ============================================


class GrantExpenditureBase(BaseModel):
    """Base grant expenditure schema"""

    model_config = _request_config

    description: str = Field(..., min_length=1, max_length=500)
    amount: Decimal = Field(..., ge=0)
    expenditure_date: date
    vendor: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    receipt_url: Optional[str] = Field(None, max_length=500)
    payment_method: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class GrantExpenditureCreate(GrantExpenditureBase):
    """Schema for creating a new grant expenditure"""

    application_id: UUID
    budget_item_id: Optional[UUID] = None


class GrantExpenditureUpdate(BaseModel):
    """Schema for updating a grant expenditure"""

    model_config = _request_config

    description: Optional[str] = Field(None, min_length=1, max_length=500)
    amount: Optional[Decimal] = Field(None, ge=0)
    expenditure_date: Optional[date] = None
    vendor: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    receipt_url: Optional[str] = Field(None, max_length=500)
    payment_method: Optional[str] = Field(None, max_length=100)
    budget_item_id: Optional[UUID] = None
    notes: Optional[str] = None


class GrantExpenditureResponse(GrantExpenditureBase):
    """Schema for grant expenditure response"""

    id: UUID
    application_id: UUID
    budget_item_id: Optional[UUID] = None
    approved_by: Optional[UUID] = None
    approval_date: Optional[date] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantExpenditureResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Grant Compliance Task Schemas
# ============================================


class GrantComplianceTaskBase(BaseModel):
    """Base grant compliance task schema"""

    model_config = _request_config

    task_type: ComplianceTaskTypeLiteral
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    due_date: date
    priority: GrantPriorityLiteral = "medium"
    reminder_days_before: int = Field(default=14, ge=0)
    report_template: Optional[str] = None
    submission_url: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None


class GrantComplianceTaskCreate(GrantComplianceTaskBase):
    """Schema for creating a new grant compliance task"""

    application_id: UUID


class GrantComplianceTaskUpdate(BaseModel):
    """Schema for updating a grant compliance task"""

    model_config = _request_config

    task_type: Optional[ComplianceTaskTypeLiteral] = None
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    status: Optional[ComplianceTaskStatusLiteral] = None
    priority: Optional[GrantPriorityLiteral] = None
    reminder_days_before: Optional[int] = Field(None, ge=0)
    report_template: Optional[str] = None
    submission_url: Optional[str] = Field(None, max_length=500)
    assigned_to: Optional[UUID] = None
    notes: Optional[str] = None


class GrantComplianceTaskResponse(GrantComplianceTaskBase):
    """Schema for grant compliance task response"""

    id: UUID
    application_id: UUID
    completed_date: Optional[date] = None
    status: ComplianceTaskStatusLiteral = "pending"
    assigned_to: Optional[UUID] = None
    last_reminder_sent: Optional[datetime] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantComplianceTaskResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Grant Note Schemas
# ============================================


class GrantNoteCreate(BaseModel):
    """Schema for creating a new grant note"""

    application_id: UUID
    note_type: GrantNoteTypeLiteral = "general"
    content: str = Field(..., min_length=1)
    note_metadata: Optional[Dict[str, Any]] = Field(
        default=None, validation_alias="metadata"
    )

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GrantNoteResponse(BaseModel):
    """Schema for grant note response"""

    id: UUID
    application_id: UUID
    note_type: GrantNoteTypeLiteral
    content: str
    note_metadata: Optional[Dict[str, Any]] = Field(
        default=None, serialization_alias="metadata"
    )
    created_by: Optional[UUID] = None
    created_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "GrantNoteResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Fundraising Campaign Schemas
# ============================================


class CampaignBase(BaseModel):
    """Base fundraising campaign schema"""

    model_config = _request_config

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    campaign_type: CampaignTypeLiteral
    goal_amount: Decimal = Field(..., ge=0)
    start_date: date
    end_date: Optional[date] = None
    public_page_enabled: bool = False
    hero_image_url: Optional[str] = Field(None, max_length=500)
    thank_you_message: Optional[str] = None
    allow_anonymous: bool = True
    minimum_donation: Optional[Decimal] = Field(None, ge=0)
    suggested_amounts: Optional[List[Decimal]] = None


class CampaignCreate(CampaignBase):
    """Schema for creating a new fundraising campaign"""


class CampaignUpdate(BaseModel):
    """Schema for updating a fundraising campaign"""

    model_config = _request_config

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    campaign_type: Optional[CampaignTypeLiteral] = None
    goal_amount: Optional[Decimal] = Field(None, ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[CampaignStatusLiteral] = None
    public_page_enabled: Optional[bool] = None
    hero_image_url: Optional[str] = Field(None, max_length=500)
    thank_you_message: Optional[str] = None
    allow_anonymous: Optional[bool] = None
    minimum_donation: Optional[Decimal] = Field(None, ge=0)
    suggested_amounts: Optional[List[Decimal]] = None


class CampaignResponse(CampaignBase):
    """Schema for fundraising campaign response"""

    id: UUID
    organization_id: UUID
    status: CampaignStatusLiteral = "draft"
    current_amount: Decimal = Decimal("0")
    public_page_url: Optional[str] = None
    active: bool = True
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "CampaignResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Donor Schemas
# ============================================


class DonorBase(BaseModel):
    """Base donor schema"""

    model_config = _request_config

    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    address_line1: Optional[str] = Field(None, max_length=255)
    address_line2: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=50)
    postal_code: Optional[str] = Field(None, max_length=20)
    country: Optional[str] = Field(None, max_length=100)
    donor_type: DonorTypeLiteral = "individual"
    company_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    communication_preferences: Optional[Dict[str, Any]] = None
    is_anonymous: bool = False


class DonorCreate(DonorBase):
    """Schema for creating a new donor"""


class DonorUpdate(BaseModel):
    """Schema for updating a donor"""

    model_config = _request_config

    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    address_line1: Optional[str] = Field(None, max_length=255)
    address_line2: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=50)
    postal_code: Optional[str] = Field(None, max_length=20)
    country: Optional[str] = Field(None, max_length=100)
    donor_type: Optional[DonorTypeLiteral] = None
    company_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    communication_preferences: Optional[Dict[str, Any]] = None
    is_anonymous: Optional[bool] = None


class DonorResponse(DonorBase):
    """Schema for donor response"""

    id: UUID
    organization_id: UUID
    user_id: Optional[UUID] = None
    total_donated: Decimal = Decimal("0")
    donation_count: int = 0
    first_donation_date: Optional[date] = None
    last_donation_date: Optional[date] = None
    active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "DonorResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Donation Schemas
# ============================================


class DonationBase(BaseModel):
    """Base donation schema"""

    model_config = _request_config

    amount: Decimal = Field(..., ge=0)
    donation_date: datetime
    payment_method: PaymentMethodLiteral
    payment_status: PaymentStatusLiteral = "completed"
    is_recurring: bool = False
    recurring_frequency: Optional[RecurringFrequencyLiteral] = None
    is_anonymous: bool = False
    donor_name: Optional[str] = Field(None, max_length=255)
    donor_email: Optional[str] = Field(None, max_length=255)
    dedication_type: Optional[DedicationTypeLiteral] = None
    dedication_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    tax_deductible: bool = True


class DonationCreate(DonationBase):
    """Schema for creating a new donation"""

    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None


class DonationUpdate(BaseModel):
    """Schema for updating a donation"""

    model_config = _request_config

    amount: Optional[Decimal] = Field(None, ge=0)
    donation_date: Optional[datetime] = None
    payment_method: Optional[PaymentMethodLiteral] = None
    payment_status: Optional[PaymentStatusLiteral] = None
    is_recurring: Optional[bool] = None
    recurring_frequency: Optional[RecurringFrequencyLiteral] = None
    is_anonymous: Optional[bool] = None
    donor_name: Optional[str] = Field(None, max_length=255)
    donor_email: Optional[str] = Field(None, max_length=255)
    dedication_type: Optional[DedicationTypeLiteral] = None
    dedication_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    tax_deductible: Optional[bool] = None
    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None


class DonationResponse(DonationBase):
    """Schema for donation response"""

    id: UUID
    organization_id: UUID
    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None
    currency: str = "USD"
    transaction_id: Optional[str] = None
    check_number: Optional[str] = None
    receipt_sent: bool = False
    thank_you_sent: bool = False
    custom_fields: Optional[Dict[str, Any]] = None
    recorded_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "DonationResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Pledge Schemas
# ============================================


class PledgeBase(BaseModel):
    """Base pledge schema"""

    model_config = _request_config

    pledged_amount: Decimal = Field(..., ge=0)
    pledge_date: date
    due_date: Optional[date] = None
    payment_schedule: Optional[Dict[str, Any]] = None
    reminder_enabled: bool = True
    notes: Optional[str] = None


class PledgeCreate(PledgeBase):
    """Schema for creating a new pledge"""

    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None


class PledgeUpdate(BaseModel):
    """Schema for updating a pledge"""

    model_config = _request_config

    pledged_amount: Optional[Decimal] = Field(None, ge=0)
    fulfilled_amount: Optional[Decimal] = Field(None, ge=0)
    pledge_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[PledgeStatusLiteral] = None
    payment_schedule: Optional[Dict[str, Any]] = None
    reminder_enabled: Optional[bool] = None
    notes: Optional[str] = None
    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None


class PledgeResponse(PledgeBase):
    """Schema for pledge response"""

    id: UUID
    organization_id: UUID
    campaign_id: Optional[UUID] = None
    donor_id: Optional[UUID] = None
    fulfilled_amount: Decimal = Decimal("0")
    status: PledgeStatusLiteral = "pending"
    last_reminder_sent: Optional[datetime] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "PledgeResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Fundraising Event Schemas
# ============================================


class FundraisingEventBase(BaseModel):
    """Base fundraising event schema"""

    model_config = _request_config

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    event_type: FundraisingEventTypeLiteral
    event_date: datetime
    location: Optional[str] = Field(None, max_length=300)
    ticket_price: Optional[Decimal] = Field(None, ge=0)
    max_attendees: Optional[int] = Field(None, ge=0)
    revenue_goal: Optional[Decimal] = Field(None, ge=0)
    registration_url: Optional[str] = Field(None, max_length=500)
    sponsors: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None


class FundraisingEventCreate(FundraisingEventBase):
    """Schema for creating a new fundraising event"""

    campaign_id: Optional[UUID] = None
    event_id: Optional[UUID] = None


class FundraisingEventUpdate(BaseModel):
    """Schema for updating a fundraising event"""

    model_config = _request_config

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    event_type: Optional[FundraisingEventTypeLiteral] = None
    event_date: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=300)
    ticket_price: Optional[Decimal] = Field(None, ge=0)
    max_attendees: Optional[int] = Field(None, ge=0)
    revenue_goal: Optional[Decimal] = Field(None, ge=0)
    registration_url: Optional[str] = Field(None, max_length=500)
    sponsors: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    status: Optional[FundraisingEventStatusLiteral] = None
    actual_revenue: Optional[Decimal] = Field(None, ge=0)
    expenses: Optional[Decimal] = Field(None, ge=0)
    current_attendees: Optional[int] = Field(None, ge=0)
    campaign_id: Optional[UUID] = None
    event_id: Optional[UUID] = None


class FundraisingEventResponse(FundraisingEventBase):
    """Schema for fundraising event response"""

    id: UUID
    organization_id: UUID
    campaign_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
    current_attendees: int = 0
    actual_revenue: Decimal = Decimal("0")
    expenses: Decimal = Decimal("0")
    status: FundraisingEventStatusLiteral = "planning"
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "FundraisingEventResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Dashboard & Report Schemas
# ============================================


class GrantsDashboardResponse(BaseModel):
    """Dashboard summary for grants and fundraising"""

    total_raised_ytd: Decimal = Decimal("0")
    total_raised_12mo: Decimal = Decimal("0")
    active_campaigns_count: int = 0
    active_campaigns: List[CampaignResponse] = []
    pending_applications: int = 0
    active_grants: int = 0
    upcoming_deadlines: List[GrantOpportunityResponse] = []
    recent_donations: List[DonationResponse] = []
    compliance_tasks_due: List[GrantComplianceTaskResponse] = []
    total_grant_funding: Decimal = Decimal("0")
    total_donors: int = 0
    outstanding_pledges: Decimal = Decimal("0")
    pipeline_summary: List[Dict[str, Any]] = []

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GrantReportFilters(BaseModel):
    """Filters for grant and fundraising reports"""

    start_date: Optional[date] = None
    end_date: Optional[date] = None
    campaign_id: Optional[UUID] = None
    status: Optional[str] = None


class ComplianceSummary(BaseModel):
    """Compliance summary for grant report"""

    total_tasks: int = 0
    completed: int = 0
    overdue: int = 0
    pending: int = 0

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GrantReportResponse(BaseModel):
    """Grant report summary"""

    total_applications: int = 0
    total_requested: Decimal = Decimal("0")
    total_awarded: Decimal = Decimal("0")
    total_spent: Decimal = Decimal("0")
    success_rate: Decimal = Decimal("0")
    awarded_count: int = 0
    denied_count: int = 0
    compliance_summary: ComplianceSummary = ComplianceSummary()
    spending_by_category: Dict[str, Decimal] = {}

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class FundraisingReportResponse(BaseModel):
    """Fundraising report summary"""

    total_donations: Decimal = Decimal("0")
    donation_count: int = 0
    unique_donors: int = 0
    average_gift: Decimal = Decimal("0")
    donations_by_method: Dict[str, Decimal] = {}
    monthly_totals: List[Dict[str, Any]] = []

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# Rebuild models that use forward references
GrantApplicationResponse.model_rebuild()
