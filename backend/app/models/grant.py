"""
Grant & Fundraising Models

Database models for grant management, fundraising campaigns, donations,
donors, and pledges. Grant models track grant opportunities, applications,
budgets, expenditures, compliance tasks, and activity notes. Fundraising
models map to existing migration tables for campaigns, donors, donations,
pledges, and fundraising events.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, Date, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Grant program details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    agency: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    eligible_uses: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Award range
    typical_award_min: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    typical_award_max: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    # Eligibility
    eligibility_criteria: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Links
    application_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    program_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Match requirements
    match_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    match_percentage: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    match_description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Deadline info
    deadline_type: Mapped[Optional[DeadlineType]] = mapped_column(
        SQLEnum(DeadlineType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    deadline_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    recurring_schedule: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )  # month/day patterns

    # Requirements and metadata
    required_documents: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # list of strings
    tags: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)

    # Classification
    category: Mapped[Optional[GrantCategory]] = mapped_column(
        SQLEnum(GrantCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    federal_program_code: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # e.g. "AFG", "SAFER"

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships. No cascade, and passive_deletes=True:
    # GrantApplication.opportunity_id is ondelete="SET NULL" (an
    # application is deliberately allowed to outlive the opportunity it
    # was linked from — "may be a custom/manual entry"). Without
    # passive_deletes, SQLAlchemy's unit-of-work would try to null out (or,
    # with the cascade this line used to carry, delete-orphan and actually
    # delete) every linked application in Python before issuing the
    # DELETE — an implicit lazy-load of `applications` in an async session
    # (MissingGreenlet) at best, or, under the old cascade, silently erasing
    # every linked application's full financial history (budget items,
    # expenditures, compliance tasks, notes) at worst — the opposite of
    # what the FK's own ondelete says. passive_deletes=True leaves this
    # entirely to the DB's own ON DELETE SET NULL.
    applications: Mapped[list["GrantApplication"]] = relationship(
        "GrantApplication", back_populates="opportunity", passive_deletes=True
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link to opportunity (optional - may be a custom/manual entry)
    opportunity_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("grant_opportunities.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Grant program info (for when no opportunity is linked)
    grant_program_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    grant_agency: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Pipeline status
    application_status: Mapped[ApplicationStatus] = mapped_column(
        SQLEnum(ApplicationStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ApplicationStatus.RESEARCHING,
        server_default="researching",
    )

    # Financial
    amount_requested: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    amount_awarded: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    match_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    match_source: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Timeline
    application_deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    submitted_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    award_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    grant_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    grant_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Description
    project_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    narrative_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Structured data
    budget_summary: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    key_contacts: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )

    # Federal tracking
    federal_award_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    nfirs_compliant: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Performance and reporting
    performance_period_months: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    reporting_frequency: Mapped[Optional[ReportingFrequency]] = mapped_column(
        SQLEnum(ReportingFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    next_report_due: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    final_report_due: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Set once `_generate_compliance_tasks` has generated the standard
    # report/closeout/inventory task set for this application (GF-14) — not
    # inferable from the tasks table's own contents, since `task_type` on a
    # manually-created task is fully client-chosen and can collide with the
    # auto-generated set's types.
    compliance_tasks_generated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    # Assignment
    assigned_to: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Priority
    priority: Mapped[GrantPriority] = mapped_column(
        SQLEnum(GrantPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantPriority.MEDIUM,
        server_default="medium",
    )

    # Link to fundraising campaign (for match campaigns)
    linked_campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    opportunity: Mapped[Optional["GrantOpportunity"]] = relationship(
        "GrantOpportunity", back_populates="applications"
    )
    budget_items: Mapped[list["GrantBudgetItem"]] = relationship(
        "GrantBudgetItem", back_populates="application", cascade="all, delete-orphan"
    )
    expenditures: Mapped[list["GrantExpenditure"]] = relationship(
        "GrantExpenditure", back_populates="application", cascade="all, delete-orphan"
    )
    compliance_tasks: Mapped[list["GrantComplianceTask"]] = relationship(
        "GrantComplianceTask",
        back_populates="application",
        cascade="all, delete-orphan",
    )
    grant_notes: Mapped[list["GrantNote"]] = relationship(
        "GrantNote",
        back_populates="application",
        cascade="all, delete-orphan",
        # Newest first. The activity log renders this collection directly, and
        # an unordered relationship comes back in whatever order the rows land
        # in, which reads as a shuffled history rather than a timeline.
        order_by="desc(GrantNote.created_at)",
    )
    linked_campaign: Mapped[Optional["FundraisingCampaign"]] = relationship(
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    application_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Budget item details
    category: Mapped[BudgetItemCategory] = mapped_column(
        SQLEnum(BudgetItemCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Financial
    amount_budgeted: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount_spent: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )
    amount_remaining: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    federal_share: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    local_match: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    # Notes and ordering
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application: Mapped["GrantApplication"] = relationship(
        "GrantApplication", back_populates="budget_items"
    )
    expenditures: Mapped[list["GrantExpenditure"]] = relationship(
        "GrantExpenditure", back_populates="budget_item"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    application_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_item_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("grant_budget_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Expenditure details
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    expenditure_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Vendor / payment info
    vendor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    invoice_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Approval
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application: Mapped["GrantApplication"] = relationship(
        "GrantApplication", back_populates="expenditures"
    )
    budget_item: Mapped[Optional["GrantBudgetItem"]] = relationship(
        "GrantBudgetItem", back_populates="expenditures"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    application_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Task details
    task_type: Mapped[ComplianceTaskType] = mapped_column(
        SQLEnum(ComplianceTaskType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Dates
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    completed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[ComplianceTaskStatus] = mapped_column(
        SQLEnum(ComplianceTaskStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ComplianceTaskStatus.PENDING,
        server_default="pending",
    )

    # Priority
    priority: Mapped[GrantPriority] = mapped_column(
        SQLEnum(GrantPriority, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantPriority.MEDIUM,
        server_default="medium",
    )

    # Assignment
    assigned_to: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Reminders
    reminder_days_before: Mapped[int] = mapped_column(
        Integer, nullable=False, default=14, server_default="14"
    )
    last_reminder_sent: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Report guidance
    report_template: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Submission
    submission_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Attachments and notes
    attachments: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    application: Mapped["GrantApplication"] = relationship(
        "GrantApplication", back_populates="compliance_tasks"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    application_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("grant_applications.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Note details
    note_type: Mapped[GrantNoteType] = mapped_column(
        SQLEnum(GrantNoteType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=GrantNoteType.GENERAL,
        server_default="general",
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Structured metadata (e.g. old_status, new_status for status changes)
    # "metadata" is reserved by SQLAlchemy Declarative; map via Column("metadata")
    note_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(
        "metadata", JSON, nullable=True
    )

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    application: Mapped["GrantApplication"] = relationship(
        "GrantApplication", back_populates="grant_notes"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Campaign details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    campaign_type: Mapped[CampaignType] = mapped_column(
        SQLEnum(CampaignType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Financial
    goal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    current_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )

    # Timeline
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[CampaignStatus] = mapped_column(
        SQLEnum(CampaignStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="draft",
    )

    # Public page
    public_page_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    public_page_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    hero_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    thank_you_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Donation settings
    allow_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="1"
    )
    minimum_donation: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    suggested_amounts: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    custom_fields: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Active flag
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1")

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    # Relationships
    donations: Mapped[list["Donation"]] = relationship(
        "Donation", back_populates="campaign"
    )
    pledges: Mapped[list["Pledge"]] = relationship("Pledge", back_populates="campaign")
    fundraising_events: Mapped[list["FundraisingEvent"]] = relationship(
        "FundraisingEvent", back_populates="campaign"
    )

    __table_args__ = (
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Contact info
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Address
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(
        String(100), server_default="USA", nullable=True
    )

    # Donor classification
    donor_type: Mapped[DonorType] = mapped_column(
        SQLEnum(DonorType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="individual",
    )
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Donation summary
    total_donated: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )
    donation_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    first_donation_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_donation_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Notes and preferences
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    communication_preferences: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Flags
    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1")

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    donations: Mapped[list["Donation"]] = relationship(
        "Donation", back_populates="donor"
    )
    pledges: Mapped[list["Pledge"]] = relationship("Pledge", back_populates="donor")

    __table_args__ = (
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    donor_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("donors.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Financial
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default="USD"
    )
    donation_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Payment
    payment_method: Mapped[PaymentMethod] = mapped_column(
        SQLEnum(PaymentMethod, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        SQLEnum(PaymentStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="completed",
    )
    transaction_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    check_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Recurring
    is_recurring: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    recurring_frequency: Mapped[Optional[RecurringFrequency]] = mapped_column(
        SQLEnum(RecurringFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )

    # Anonymous / display
    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    donor_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    donor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Dedication
    dedication_type: Mapped[Optional[DedicationType]] = mapped_column(
        SQLEnum(DedicationType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    dedication_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Receipt and thank you tracking
    receipt_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )
    thank_you_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )

    # Tax
    tax_deductible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="1"
    )

    # Custom fields
    custom_fields: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Recorded by
    recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    campaign: Mapped[Optional["FundraisingCampaign"]] = relationship(
        "FundraisingCampaign", back_populates="donations"
    )
    donor: Mapped[Optional["Donor"]] = relationship("Donor", back_populates="donations")

    __table_args__ = (
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    donor_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("donors.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Financial
    pledged_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fulfilled_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0.00"
    )

    # Dates
    pledge_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[PledgeStatus] = mapped_column(
        SQLEnum(PledgeStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="pending",
    )

    # Schedule and reminders
    payment_schedule: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    reminder_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="1"
    )
    last_reminder_sent: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    campaign: Mapped[Optional["FundraisingCampaign"]] = relationship(
        "FundraisingCampaign", back_populates="pledges"
    )
    donor: Mapped[Optional["Donor"]] = relationship("Donor", back_populates="pledges")

    __table_args__ = (
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="CASCADE"),
        nullable=True,
    )
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("events.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Event details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_type: Mapped[FundraisingEventType] = mapped_column(
        SQLEnum(FundraisingEventType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    event_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    # Ticketing
    ticket_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    max_attendees: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_attendees: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Financial
    revenue_goal: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    actual_revenue: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )
    expenses: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )

    # Status
    status: Mapped[FundraisingEventStatus] = mapped_column(
        SQLEnum(FundraisingEventStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        server_default="planning",
    )

    # Registration
    registration_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Sponsors and notes
    sponsors: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    campaign: Mapped[Optional["FundraisingCampaign"]] = relationship(
        "FundraisingCampaign", back_populates="fundraising_events"
    )

    __table_args__ = (
        Index("idx_fundraising_events_campaign", "campaign_id"),
        Index("idx_fundraising_events_date", "event_date"),
        Index("idx_fundraising_events_status", "organization_id", "status"),
    )
