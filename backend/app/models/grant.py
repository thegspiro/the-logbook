"""
Grant & Fundraising Models

Database models for grant management, fundraising campaigns, donations,
donors, and pledges. Grant models track grant opportunities, applications,
budgets, expenditures, compliance tasks, and activity notes. Fundraising
models map to existing migration tables for campaigns, donors, donations,
pledges, and fundraising events.
"""

from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# ---------------------------------------------------------------------------
# Grant Enums
# ---------------------------------------------------------------------------


class DeadlineType(str, Enum):
    """Deadline type for grant opportunities"""

    FIXED = "fixed"
    RECURRING = "recurring"
    ROLLING = "rolling"


class GrantCategory(str, Enum):
    """Category of grant opportunity"""

    EQUIPMENT = "equipment"
    STAFFING = "staffing"
    TRAINING = "training"
    PREVENTION = "prevention"
    FACILITIES = "facilities"
    VEHICLES = "vehicles"
    WELLNESS = "wellness"
    COMMUNITY = "community"
    OTHER = "other"


class ApplicationStatus(str, Enum):
    """Status of a grant application through the pipeline"""

    RESEARCHING = "researching"
    PREPARING = "preparing"
    INTERNAL_REVIEW = "internal_review"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    AWARDED = "awarded"
    DENIED = "denied"
    ACTIVE = "active"
    REPORTING = "reporting"
    CLOSED = "closed"


class ReportingFrequency(str, Enum):
    """Frequency of grant reporting requirements"""

    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMI_ANNUAL = "semi_annual"
    ANNUAL = "annual"


class GrantPriority(str, Enum):
    """Priority level for grant applications and compliance tasks"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class BudgetItemCategory(str, Enum):
    """Category of a grant budget line item"""

    EQUIPMENT = "equipment"
    PERSONNEL = "personnel"
    TRAINING = "training"
    CONTRACTUAL = "contractual"
    SUPPLIES = "supplies"
    TRAVEL = "travel"
    CONSTRUCTION = "construction"
    INDIRECT = "indirect"
    OTHER = "other"


class ComplianceTaskType(str, Enum):
    """Type of grant compliance task"""

    PERFORMANCE_REPORT = "performance_report"
    FINANCIAL_REPORT = "financial_report"
    PROGRESS_UPDATE = "progress_update"
    SITE_VISIT = "site_visit"
    AUDIT = "audit"
    EQUIPMENT_INVENTORY = "equipment_inventory"
    NFIRS_SUBMISSION = "nfirs_submission"
    CLOSEOUT_REPORT = "closeout_report"
    OTHER = "other"


class ComplianceTaskStatus(str, Enum):
    """Status of a grant compliance task"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    WAIVED = "waived"


class GrantNoteType(str, Enum):
    """Type of grant activity note"""

    GENERAL = "general"
    STATUS_CHANGE = "status_change"
    DOCUMENT_ADDED = "document_added"
    CONTACT_MADE = "contact_made"
    MILESTONE = "milestone"
    FINANCIAL = "financial"
    COMPLIANCE = "compliance"


# ---------------------------------------------------------------------------
# Fundraising Enums (matching existing migration enum values)
# ---------------------------------------------------------------------------


class CampaignType(str, Enum):
    """Type of fundraising campaign"""

    GENERAL = "general"
    EQUIPMENT = "equipment"
    TRAINING = "training"
    COMMUNITY = "community"
    MEMORIAL = "memorial"
    EVENT = "event"
    OTHER = "other"


class CampaignStatus(str, Enum):
    """Status of a fundraising campaign"""

    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class DonorType(str, Enum):
    """Type of donor"""

    INDIVIDUAL = "individual"
    BUSINESS = "business"
    FOUNDATION = "foundation"
    GOVERNMENT = "government"
    OTHER = "other"


class PaymentMethod(str, Enum):
    """Payment method for donations"""

    CASH = "cash"
    CHECK = "check"
    CREDIT_CARD = "credit_card"
    BANK_TRANSFER = "bank_transfer"
    PAYPAL = "paypal"
    VENMO = "venmo"
    OTHER = "other"


class PaymentStatus(str, Enum):
    """Payment status for donations"""

    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"


class RecurringFrequency(str, Enum):
    """Recurring donation frequency"""

    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class DedicationType(str, Enum):
    """Dedication type for donations"""

    IN_HONOR = "in_honor"
    IN_MEMORY = "in_memory"


class PledgeStatus(str, Enum):
    """Status of a donation pledge"""

    PENDING = "pending"
    PARTIAL = "partial"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    OVERDUE = "overdue"


class FundraisingEventType(str, Enum):
    """Type of fundraising event"""

    DINNER = "dinner"
    GALA = "gala"
    AUCTION = "auction"
    RAFFLE = "raffle"
    GOLF_OUTING = "golf_outing"
    WALKATHON = "walkathon"
    OTHER = "other"


class FundraisingEventStatus(str, Enum):
    """Status of a fundraising event"""

    PLANNING = "planning"
    OPEN = "open"
    SOLD_OUT = "sold_out"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Grant Models
# ---------------------------------------------------------------------------


class GrantOpportunity(Base):
    """
    Library of available grant programs.

    Tracks grant opportunities from federal, state, and local agencies that
    the organization may be eligible to apply for.
    """

    __tablename__ = "grant_opportunities"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Grant program details
    name = Column(String(255), nullable=False)
    agency = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    eligible_uses = Column(Text, nullable=True)

    # Award range
    typical_award_min = Column(Numeric(12, 2), nullable=True)
    typical_award_max = Column(Numeric(12, 2), nullable=True)

    # Eligibility
    eligibility_criteria = Column(Text, nullable=True)

    # Links
    application_url = Column(String(500), nullable=True)
    program_url = Column(String(500), nullable=True)

    # Match requirements
    match_required = Column(Boolean, nullable=False, default=False)
    match_percentage = Column(Numeric(5, 2), nullable=True)
    match_description = Column(String(500), nullable=True)

    # Deadline info
    deadline_type = Column(
        SQLEnum(DeadlineType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    deadline_date = Column(Date, nullable=True)
    recurring_schedule = Column(JSON, nullable=True)  # month/day patterns

    # Requirements and metadata
    required_documents = Column(JSON, nullable=True)  # list of strings
    tags = Column(JSON, nullable=True)

    # Classification
    category = Column(
        SQLEnum(GrantCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    federal_program_code = Column(String(50), nullable=True)  # e.g. "AFG", "SAFER"

    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    applications = relationship(
        "GrantApplication", back_populates="opportunity", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_grant_opportunities_organization_id", "organization_id"),
        Index("ix_grant_opportunities_category", "category"),
        Index("ix_grant_opportunities_is_active", "is_active"),
        Index("ix_grant_opportunities_deadline_date", "deadline_date"),
        Index("ix_grant_opportunities_federal_program_code", "federal_program_code"),
    )


class GrantApplication(Base):
    """
    Individual grant application tracked through the pipeline.

    Represents a specific application to a grant program, including
    financial details, timeline, compliance requirements, and status.
    """

    __tablename__ = "grant_applications"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link to opportunity (optional - may be a custom/manual entry)
    opportunity_id = Column(
        String(36),
        ForeignKey("grant_opportunities.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Grant program info (for when no opportunity is linked)
    grant_program_name = Column(String(255), nullable=True)
    grant_agency = Column(String(255), nullable=True)

    # Pipeline status
    application_status = Column(
        SQLEnum(ApplicationStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ApplicationStatus.RESEARCHING,
    )

    # Financial
    amount_requested = Column(Numeric(12, 2), nullable=True)
    amount_awarded = Column(Numeric(12, 2), nullable=True)
    match_amount = Column(Numeric(12, 2), nullable=True)
    match_source = Column(String(255), nullable=True)

    # Timeline
    application_deadline = Column(Date, nullable=True)
    submitted_date = Column(Date, nullable=True)
    award_date = Column(Date, nullable=True)
    grant_start_date = Column(Date, nullable=True)
    grant_end_date = Column(Date, nullable=True)

    # Description
    project_description = Column(Text, nullable=True)
    narrative_summary = Column(Text, nullable=True)

    # Structured data
    budget_summary = Column(JSON, nullable=True)
    key_contacts = Column(JSON, nullable=True)

    # Federal tracking
    federal_award_id = Column(String(100), nullable=True)
    nfirs_compliant = Column(Boolean, nullable=True)

    # Performance and reporting
    performance_period_months = Column(Integer, nullable=True)
    reporting_frequency = Column(
        SQLEnum(ReportingFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    next_report_due = Column(Date, nullable=True)
    final_report_due = Column(Date, nullable=True)

    # Assignment
    assigned_to = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Priority
    priority = Column(
        SQLEnum(GrantPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantPriority.MEDIUM,
    )

    # Link to fundraising campaign (for match campaigns)
    linked_campaign_id = Column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Notes
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    opportunity = relationship("GrantOpportunity", back_populates="applications")
    budget_items = relationship(
        "GrantBudgetItem", back_populates="application", cascade="all, delete-orphan"
    )
    expenditures = relationship(
        "GrantExpenditure", back_populates="application", cascade="all, delete-orphan"
    )
    compliance_tasks = relationship(
        "GrantComplianceTask",
        back_populates="application",
        cascade="all, delete-orphan",
    )
    grant_notes = relationship(
        "GrantNote", back_populates="application", cascade="all, delete-orphan"
    )
    linked_campaign = relationship(
        "FundraisingCampaign", foreign_keys=[linked_campaign_id]
    )

    __table_args__ = (
        Index("ix_grant_applications_organization_id", "organization_id"),
        Index("ix_grant_applications_opportunity_id", "opportunity_id"),
        Index("ix_grant_applications_status", "application_status"),
        Index("ix_grant_applications_assigned_to", "assigned_to"),
        Index("ix_grant_applications_priority", "priority"),
        Index("ix_grant_applications_deadline", "application_deadline"),
        Index("ix_grant_applications_linked_campaign_id", "linked_campaign_id"),
    )


class GrantBudgetItem(Base):
    """
    Budget line item for a grant application.

    Tracks budgeted amounts, spending, and the split between
    federal share and local match for each budget category.
    """

    __tablename__ = "grant_budget_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Budget item details
    category = Column(
        SQLEnum(BudgetItemCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    description = Column(String(500), nullable=True)

    # Financial
    amount_budgeted = Column(Numeric(12, 2), nullable=False)
    amount_spent = Column(Numeric(12, 2), nullable=False, default=0)
    amount_remaining = Column(Numeric(12, 2), nullable=True)
    federal_share = Column(Numeric(12, 2), nullable=True)
    local_match = Column(Numeric(12, 2), nullable=True)

    # Notes and ordering
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)

    # Metadata
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application = relationship("GrantApplication", back_populates="budget_items")
    expenditures = relationship("GrantExpenditure", back_populates="budget_item")

    __table_args__ = (
        Index("ix_grant_budget_items_application_id", "application_id"),
        Index("ix_grant_budget_items_category", "category"),
    )


class GrantExpenditure(Base):
    """
    Individual spending record against a grant budget.

    Tracks actual expenditures including vendor, invoice details,
    and approval workflow.
    """

    __tablename__ = "grant_expenditures"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_item_id = Column(
        String(36),
        ForeignKey("grant_budget_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Expenditure details
    description = Column(String(500), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    expenditure_date = Column(Date, nullable=False)

    # Vendor / payment info
    vendor = Column(String(255), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    receipt_url = Column(String(500), nullable=True)
    payment_method = Column(String(100), nullable=True)

    # Approval
    approved_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approval_date = Column(Date, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application = relationship("GrantApplication", back_populates="expenditures")
    budget_item = relationship("GrantBudgetItem", back_populates="expenditures")

    __table_args__ = (
        Index("ix_grant_expenditures_application_id", "application_id"),
        Index("ix_grant_expenditures_budget_item_id", "budget_item_id"),
        Index("ix_grant_expenditures_expenditure_date", "expenditure_date"),
    )


class GrantComplianceTask(Base):
    """
    Follow-up task, report, or compliance obligation for a grant.

    Tracks required reports, audits, site visits, and other
    compliance activities with due dates and reminders.
    """

    __tablename__ = "grant_compliance_tasks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Task details
    task_type = Column(
        SQLEnum(ComplianceTaskType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # Dates
    due_date = Column(Date, nullable=False)
    completed_date = Column(Date, nullable=True)

    # Status
    status = Column(
        SQLEnum(ComplianceTaskStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ComplianceTaskStatus.PENDING,
    )

    # Priority
    priority = Column(
        SQLEnum(GrantPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantPriority.MEDIUM,
    )

    # Assignment
    assigned_to = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Reminders
    reminder_days_before = Column(Integer, nullable=False, default=14)
    last_reminder_sent = Column(DateTime(timezone=True), nullable=True)

    # Report guidance
    report_template = Column(Text, nullable=True)

    # Submission
    submission_url = Column(String(500), nullable=True)

    # Attachments and notes
    attachments = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application = relationship("GrantApplication", back_populates="compliance_tasks")

    __table_args__ = (
        Index("ix_grant_compliance_tasks_application_id", "application_id"),
        Index("ix_grant_compliance_tasks_status", "status"),
        Index("ix_grant_compliance_tasks_due_date", "due_date"),
        Index("ix_grant_compliance_tasks_assigned_to", "assigned_to"),
    )


class GrantNote(Base):
    """
    Activity log / note for a grant application.

    Records status changes, documents added, contacts made,
    milestones, and other activity on a grant application.
    """

    __tablename__ = "grant_notes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    application_id = Column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Note details
    note_type = Column(
        SQLEnum(GrantNoteType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantNoteType.GENERAL,
    )
    content = Column(Text, nullable=False)

    # Structured metadata (e.g. old_status, new_status for status changes)
    # "metadata" is reserved by SQLAlchemy Declarative; map via Column("metadata")
    note_metadata = Column("metadata", JSON, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    application = relationship("GrantApplication", back_populates="grant_notes")

    __table_args__ = (
        Index("ix_grant_notes_application_id", "application_id"),
        Index("ix_grant_notes_note_type", "note_type"),
        Index("ix_grant_notes_created_at", "created_at"),
    )


# ---------------------------------------------------------------------------
# Fundraising Models (mapping to existing migration tables)
# ---------------------------------------------------------------------------


class FundraisingCampaign(Base):
    """
    Fundraising campaign model mapping to the existing fundraising_campaigns table.

    Represents a fundraising initiative with a goal amount, date range,
    and optional public donation page.
    """

    __tablename__ = "fundraising_campaigns"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Campaign details
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    campaign_type = Column(
        SQLEnum(CampaignType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Financial
    goal_amount = Column(Numeric(12, 2), nullable=False)
    current_amount = Column(Numeric(12, 2), nullable=False, server_default="0.00")

    # Timeline
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)

    # Status
    status = Column(
        SQLEnum(CampaignStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="draft",
    )

    # Public page
    public_page_enabled = Column(Boolean, nullable=False, server_default="0")
    public_page_url = Column(String(255), nullable=True)
    hero_image_url = Column(String(500), nullable=True)
    thank_you_message = Column(Text, nullable=True)

    # Donation settings
    allow_anonymous = Column(Boolean, nullable=False, server_default="1")
    minimum_donation = Column(Numeric(10, 2), nullable=True)
    suggested_amounts = Column(JSON, nullable=True)
    custom_fields = Column(JSON, nullable=True)

    # Active flag
    active = Column(Boolean, nullable=False, server_default="1")

    # Metadata
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Relationships
    donations = relationship("Donation", back_populates="campaign")
    pledges = relationship("Pledge", back_populates="campaign")
    fundraising_events = relationship("FundraisingEvent", back_populates="campaign")

    __table_args__ = (
        Index("idx_fundraising_campaigns_org", "organization_id"),
        Index("idx_fundraising_campaigns_status", "organization_id", "status"),
        Index("idx_fundraising_campaigns_type", "organization_id", "campaign_type"),
        Index("idx_fundraising_campaigns_dates", "start_date", "end_date"),
    )


class Donor(Base):
    """
    Donor model mapping to the existing donors table.

    Tracks donor contact information, donation history summaries,
    and communication preferences.
    """

    __tablename__ = "donors"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Contact info
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)

    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(50), nullable=True)
    postal_code = Column(String(20), nullable=True)
    country = Column(String(100), server_default="USA", nullable=True)

    # Donor classification
    donor_type = Column(
        SQLEnum(DonorType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="individual",
    )
    company_name = Column(String(255), nullable=True)

    # Donation summary
    total_donated = Column(Numeric(12, 2), nullable=False, server_default="0.00")
    donation_count = Column(Integer, nullable=False, server_default="0")
    first_donation_date = Column(Date, nullable=True)
    last_donation_date = Column(Date, nullable=True)

    # Notes and preferences
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    communication_preferences = Column(JSON, nullable=True)

    # Flags
    is_anonymous = Column(Boolean, nullable=False, server_default="0")
    active = Column(Boolean, nullable=False, server_default="1")

    # Metadata
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    donations = relationship("Donation", back_populates="donor")
    pledges = relationship("Pledge", back_populates="donor")

    __table_args__ = (
        Index("idx_donors_org", "organization_id"),
        Index("idx_donors_user", "user_id"),
        Index("idx_donors_email", "organization_id", "email"),
        Index("idx_donors_type", "organization_id", "donor_type"),
        Index("idx_donors_name", "organization_id", "last_name", "first_name"),
    )


class Donation(Base):
    """
    Donation model mapping to the existing donations table.

    Records individual donations including payment details,
    receipt/thank-you tracking, and dedications.
    """

    __tablename__ = "donations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id = Column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    donor_id = Column(
        String(36),
        ForeignKey("donors.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Financial
    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), nullable=False, server_default="USD")
    donation_date = Column(DateTime, nullable=False)

    # Payment
    payment_method = Column(
        SQLEnum(PaymentMethod, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    payment_status = Column(
        SQLEnum(PaymentStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="completed",
    )
    transaction_id = Column(String(255), nullable=True)
    check_number = Column(String(50), nullable=True)

    # Recurring
    is_recurring = Column(Boolean, nullable=False, server_default="0")
    recurring_frequency = Column(
        SQLEnum(RecurringFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # Anonymous / display
    is_anonymous = Column(Boolean, nullable=False, server_default="0")
    donor_name = Column(String(255), nullable=True)
    donor_email = Column(String(255), nullable=True)

    # Dedication
    dedication_type = Column(
        SQLEnum(DedicationType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    dedication_name = Column(String(255), nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Receipt and thank you tracking
    receipt_sent = Column(Boolean, nullable=False, server_default="0")
    receipt_sent_at = Column(DateTime, nullable=True)
    thank_you_sent = Column(Boolean, nullable=False, server_default="0")
    thank_you_sent_at = Column(DateTime, nullable=True)

    # Tax
    tax_deductible = Column(Boolean, nullable=False, server_default="1")

    # Custom fields
    custom_fields = Column(JSON, nullable=True)

    # Recorded by
    recorded_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Metadata
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    campaign = relationship("FundraisingCampaign", back_populates="donations")
    donor = relationship("Donor", back_populates="donations")

    __table_args__ = (
        Index("idx_donations_org", "organization_id"),
        Index("idx_donations_campaign", "campaign_id"),
        Index("idx_donations_donor", "donor_id"),
        Index("idx_donations_date", "donation_date"),
        Index("idx_donations_status", "organization_id", "payment_status"),
        Index("idx_donations_method", "organization_id", "payment_method"),
    )


class Pledge(Base):
    """
    Pledge model mapping to the existing pledges table.

    Tracks donation pledges/commitments with fulfillment tracking
    and payment schedules.
    """

    __tablename__ = "pledges"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id = Column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    donor_id = Column(
        String(36),
        ForeignKey("donors.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Financial
    pledged_amount = Column(Numeric(10, 2), nullable=False)
    fulfilled_amount = Column(Numeric(10, 2), nullable=False, server_default="0.00")

    # Dates
    pledge_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)

    # Status
    status = Column(
        SQLEnum(PledgeStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="pending",
    )

    # Schedule and reminders
    payment_schedule = Column(JSON, nullable=True)
    reminder_enabled = Column(Boolean, nullable=False, server_default="1")
    last_reminder_sent = Column(DateTime, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    campaign = relationship("FundraisingCampaign", back_populates="pledges")
    donor = relationship("Donor", back_populates="pledges")

    __table_args__ = (
        Index("idx_pledges_org", "organization_id"),
        Index("idx_pledges_campaign", "campaign_id"),
        Index("idx_pledges_donor", "donor_id"),
        Index("idx_pledges_status", "organization_id", "status"),
        Index("idx_pledges_due_date", "due_date"),
    )


class FundraisingEvent(Base):
    """
    Fundraising event model mapping to the existing fundraising_events table.

    Represents events tied to fundraising campaigns such as dinners,
    galas, auctions, and other fundraising activities.
    """

    __tablename__ = "fundraising_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id = Column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="CASCADE"),
        nullable=True,
    )
    event_id = Column(
        String(36),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Event details
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    event_type = Column(
        SQLEnum(FundraisingEventType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    event_date = Column(DateTime, nullable=False)
    location = Column(String(300), nullable=True)

    # Ticketing
    ticket_price = Column(Numeric(10, 2), nullable=True)
    max_attendees = Column(Integer, nullable=True)
    current_attendees = Column(Integer, nullable=False, server_default="0")

    # Financial
    revenue_goal = Column(Numeric(12, 2), nullable=True)
    actual_revenue = Column(Numeric(12, 2), nullable=False, server_default="0.00")
    expenses = Column(Numeric(12, 2), nullable=False, server_default="0.00")

    # Status
    status = Column(
        SQLEnum(FundraisingEventStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="planning",
    )

    # Registration
    registration_url = Column(String(500), nullable=True)

    # Sponsors and notes
    sponsors = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)

    # Metadata
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    campaign = relationship("FundraisingCampaign", back_populates="fundraising_events")

    __table_args__ = (
        Index("idx_fundraising_events_org", "organization_id"),
        Index("idx_fundraising_events_campaign", "campaign_id"),
        Index("idx_fundraising_events_date", "event_date"),
        Index("idx_fundraising_events_status", "organization_id", "status"),
    )
