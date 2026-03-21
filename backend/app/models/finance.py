"""
Finance Module Models

Handles fiscal years, budgets, purchase requests, expense reports,
check requests, dues/assessments, configurable approval chains,
and QuickBooks export mappings.
"""

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.utils import generate_uuid

# ============================================
# Enums
# ============================================


class FiscalYearStatus(str, enum.Enum):
    """Status of a fiscal year"""

    DRAFT = "draft"
    ACTIVE = "active"
    CLOSED = "closed"


class PurchaseRequestStatus(str, enum.Enum):
    """Status of a purchase request"""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DENIED = "denied"
    ORDERED = "ordered"
    RECEIVED = "received"
    PAID = "paid"
    CANCELLED = "cancelled"


class ExpenseReportStatus(str, enum.Enum):
    """Status of an expense report"""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DENIED = "denied"
    PAID = "paid"
    CANCELLED = "cancelled"


class CheckRequestStatus(str, enum.Enum):
    """Status of a check request"""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DENIED = "denied"
    ISSUED = "issued"
    VOIDED = "voided"
    CANCELLED = "cancelled"


class DuesFrequency(str, enum.Enum):
    """Frequency of dues collection"""

    ANNUAL = "annual"
    SEMI_ANNUAL = "semi_annual"
    QUARTERLY = "quarterly"
    MONTHLY = "monthly"


class DuesStatus(str, enum.Enum):
    """Status of a member's dues payment"""

    PENDING = "pending"
    PAID = "paid"
    PARTIAL = "partial"
    OVERDUE = "overdue"
    WAIVED = "waived"
    EXEMPT = "exempt"


class PurchaseRequestPriority(str, enum.Enum):
    """Priority of a purchase request"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class ExpenseType(str, enum.Enum):
    """Type of expense line item"""

    GENERAL = "general"
    UNIFORM_REIMBURSEMENT = "uniform_reimbursement"
    PPE_REPLACEMENT = "ppe_replacement"
    BOOT_ALLOWANCE = "boot_allowance"
    TRAINING_REIMBURSEMENT = "training_reimbursement"
    CERTIFICATION_FEE = "certification_fee"
    CONFERENCE = "conference"
    TRAVEL = "travel"
    MEALS = "meals"
    MILEAGE = "mileage"
    EQUIPMENT_PURCHASE = "equipment_purchase"
    OTHER = "other"


class ApprovalEntityType(str, enum.Enum):
    """Type of entity being approved"""

    PURCHASE_REQUEST = "purchase_request"
    EXPENSE_REPORT = "expense_report"
    CHECK_REQUEST = "check_request"


class ApprovalStepType(str, enum.Enum):
    """Type of approval chain step"""

    APPROVAL = "approval"
    NOTIFICATION = "notification"


class ApproverType(str, enum.Enum):
    """How the approver is determined"""

    POSITION = "position"
    PERMISSION = "permission"
    SPECIFIC_USER = "specific_user"
    EMAIL = "email"


class ApprovalStepStatus(str, enum.Enum):
    """Status of a single approval step record"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    SKIPPED = "skipped"
    AUTO_APPROVED = "auto_approved"
    SENT = "sent"


class ExportFormat(str, enum.Enum):
    """Format for QuickBooks export"""

    CSV = "csv"
    IIF = "iif"


class ExportMappingType(str, enum.Enum):
    """Type of QB account mapping"""

    EXPENSE = "expense"
    INCOME = "income"
    ASSET = "asset"


# ============================================
# Phase 1: Fiscal Years, Budget Categories, Budgets
# ============================================


class FiscalYear(Base):
    """Fiscal year definition for the organization"""

    __tablename__ = "fiscal_years"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)
    status = Column(
        SQLEnum(
            FiscalYearStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=FiscalYearStatus.DRAFT,
    )
    is_locked = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    creator = relationship("User", foreign_keys=[created_by])
    budgets = relationship(
        "Budget", back_populates="fiscal_year", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_fiscal_years_org_id", "organization_id"),
        Index("ix_fiscal_years_org_status", "organization_id", "status"),
    )


class BudgetCategory(Base):
    """Budget category (hierarchical)"""

    __tablename__ = "budget_categories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    parent_category_id = Column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    qb_account_name = Column(String(200), nullable=True)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    parent = relationship(
        "BudgetCategory",
        remote_side=[id],
        foreign_keys=[parent_category_id],
        back_populates="children",
    )
    children = relationship(
        "BudgetCategory",
        foreign_keys=[parent_category_id],
        back_populates="parent",
    )

    __table_args__ = (Index("ix_budget_categories_org_id", "organization_id"),)


class Budget(Base):
    """Budget line for a category within a fiscal year"""

    __tablename__ = "budgets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    fiscal_year_id = Column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id = Column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount_budgeted = Column(Numeric(12, 2), nullable=False, default=0)
    amount_spent = Column(Numeric(12, 2), nullable=False, default=0)
    amount_encumbered = Column(Numeric(12, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)
    station_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    fiscal_year = relationship("FiscalYear", back_populates="budgets")
    category = relationship("BudgetCategory", foreign_keys=[category_id])
    station = relationship("Facility", foreign_keys=[station_id])
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_budgets_org_fy", "organization_id", "fiscal_year_id"),
        Index(
            "ix_budgets_org_fy_cat",
            "organization_id",
            "fiscal_year_id",
            "category_id",
        ),
    )


# ============================================
# Phase 1B: Approval Chains
# ============================================


class ApprovalChain(Base):
    """Configurable approval chain template"""

    __tablename__ = "approval_chains"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    applies_to = Column(
        SQLEnum(
            ApprovalEntityType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    min_amount = Column(Numeric(12, 2), nullable=True)
    max_amount = Column(Numeric(12, 2), nullable=True)
    budget_category_id = Column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    budget_category = relationship("BudgetCategory", foreign_keys=[budget_category_id])
    creator = relationship("User", foreign_keys=[created_by])
    steps = relationship(
        "ApprovalChainStep",
        back_populates="chain",
        cascade="all, delete-orphan",
        order_by="ApprovalChainStep.step_order",
    )

    __table_args__ = (
        Index("ix_approval_chains_org_id", "organization_id"),
        Index(
            "ix_approval_chains_org_applies",
            "organization_id",
            "applies_to",
        ),
    )


class ApprovalChainStep(Base):
    """A single step in an approval chain"""

    __tablename__ = "approval_chain_steps"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    chain_id = Column(
        String(36),
        ForeignKey("approval_chains.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_order = Column(Integer, nullable=False)
    name = Column(String(200), nullable=False)
    step_type = Column(
        SQLEnum(
            ApprovalStepType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ApprovalStepType.APPROVAL,
    )
    approver_type = Column(
        SQLEnum(
            ApproverType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    approver_value = Column(String(500), nullable=True)
    notification_emails = Column(JSON, nullable=True)
    email_template_id = Column(
        String(36),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    allow_self_approval = Column(Boolean, nullable=False, default=False)
    auto_approve_under = Column(Numeric(12, 2), nullable=True)
    required = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    chain = relationship("ApprovalChain", back_populates="steps")
    email_template = relationship("EmailTemplate", foreign_keys=[email_template_id])

    __table_args__ = (Index("ix_approval_chain_steps_chain", "chain_id", "step_order"),)


class ApprovalStepRecord(Base):
    """Tracks actual approval step progression for a specific entity"""

    __tablename__ = "approval_step_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    chain_id = Column(
        String(36),
        ForeignKey("approval_chains.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id = Column(
        String(36),
        ForeignKey("approval_chain_steps.id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type = Column(
        SQLEnum(
            ApprovalEntityType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    entity_id = Column(String(36), nullable=False)
    status = Column(
        SQLEnum(
            ApprovalStepStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ApprovalStepStatus.PENDING,
    )
    assigned_to = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    approval_token = Column(String(255), nullable=True, unique=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    chain = relationship("ApprovalChain", foreign_keys=[chain_id])
    step = relationship("ApprovalChainStep", foreign_keys=[step_id])
    assignee = relationship("User", foreign_keys=[assigned_to])
    actor = relationship("User", foreign_keys=[acted_by])

    __table_args__ = (
        Index(
            "ix_approval_step_records_entity",
            "entity_type",
            "entity_id",
        ),
        Index("ix_approval_step_records_assigned", "assigned_to", "status"),
        Index("ix_approval_step_records_token", "approval_token"),
    )


# ============================================
# Phase 2: Purchase Requests
# ============================================


class PurchaseRequest(Base):
    """Purchase request submitted by a member"""

    __tablename__ = "purchase_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_number = Column(String(20), nullable=False, unique=True)
    fiscal_year_id = Column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id = Column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    requested_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    vendor = Column(String(300), nullable=True)
    estimated_amount = Column(Numeric(12, 2), nullable=False)
    actual_amount = Column(Numeric(12, 2), nullable=True)
    status = Column(
        SQLEnum(
            PurchaseRequestStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=PurchaseRequestStatus.DRAFT,
    )
    priority = Column(
        SQLEnum(
            PurchaseRequestPriority,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=PurchaseRequestPriority.MEDIUM,
    )
    approved_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)
    denial_reason = Column(Text, nullable=True)
    ordered_at = Column(DateTime(timezone=True), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    receipt_url = Column(String(500), nullable=True)
    apparatus_id = Column(
        String(36),
        ForeignKey("apparatus.id", ondelete="SET NULL"),
        nullable=True,
    )
    facility_id = Column(
        String(36),
        ForeignKey("facilities.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    fiscal_year = relationship("FiscalYear", foreign_keys=[fiscal_year_id])
    budget = relationship("Budget", foreign_keys=[budget_id])
    requester = relationship("User", foreign_keys=[requested_by])
    approver = relationship("User", foreign_keys=[approved_by])
    apparatus = relationship("Apparatus", foreign_keys=[apparatus_id])
    facility = relationship("Facility", foreign_keys=[facility_id])

    __table_args__ = (
        Index("ix_purchase_requests_org_id", "organization_id"),
        Index(
            "ix_purchase_requests_org_status",
            "organization_id",
            "status",
        ),
        Index(
            "ix_purchase_requests_org_fy",
            "organization_id",
            "fiscal_year_id",
        ),
    )


# ============================================
# Phase 3: Expense Reports & Check Requests
# ============================================


class ExpenseReport(Base):
    """Expense report submitted by a member for reimbursement"""

    __tablename__ = "expense_reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_number = Column(String(20), nullable=False, unique=True)
    submitted_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    fiscal_year_id = Column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    status = Column(
        SQLEnum(
            ExpenseReportStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExpenseReportStatus.DRAFT,
    )
    approved_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)
    denial_reason = Column(Text, nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payment_method = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    submitter = relationship("User", foreign_keys=[submitted_by])
    fiscal_year = relationship("FiscalYear", foreign_keys=[fiscal_year_id])
    approver = relationship("User", foreign_keys=[approved_by])
    line_items = relationship(
        "ExpenseLineItem",
        back_populates="expense_report",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_expense_reports_org_id", "organization_id"),
        Index(
            "ix_expense_reports_org_status",
            "organization_id",
            "status",
        ),
    )


class ExpenseLineItem(Base):
    """Individual line item within an expense report"""

    __tablename__ = "expense_line_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    expense_report_id = Column(
        String(36),
        ForeignKey("expense_reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id = Column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    description = Column(String(500), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    date_incurred = Column(DateTime(timezone=True), nullable=False)
    expense_type = Column(
        SQLEnum(
            ExpenseType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExpenseType.GENERAL,
    )
    receipt_url = Column(String(500), nullable=True)
    merchant = Column(String(300), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    expense_report = relationship("ExpenseReport", back_populates="line_items")
    budget = relationship("Budget", foreign_keys=[budget_id])

    __table_args__ = (Index("ix_expense_line_items_report", "expense_report_id"),)


class CheckRequest(Base):
    """Request to cut a check for payment"""

    __tablename__ = "check_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_number = Column(String(20), nullable=False, unique=True)
    requested_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    fiscal_year_id = Column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id = Column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    payee_name = Column(String(300), nullable=False)
    payee_address = Column(Text, nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    memo = Column(String(500), nullable=True)
    purpose = Column(Text, nullable=True)
    status = Column(
        SQLEnum(
            CheckRequestStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=CheckRequestStatus.DRAFT,
    )
    approved_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)
    denial_reason = Column(Text, nullable=True)
    check_number = Column(String(50), nullable=True)
    check_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    requester = relationship("User", foreign_keys=[requested_by])
    fiscal_year = relationship("FiscalYear", foreign_keys=[fiscal_year_id])
    budget = relationship("Budget", foreign_keys=[budget_id])
    approver = relationship("User", foreign_keys=[approved_by])

    __table_args__ = (
        Index("ix_check_requests_org_id", "organization_id"),
        Index(
            "ix_check_requests_org_status",
            "organization_id",
            "status",
        ),
    )


# ============================================
# Phase 4: Dues & Assessments
# ============================================


class DuesSchedule(Base):
    """Schedule for dues collection"""

    __tablename__ = "dues_schedules"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    frequency = Column(
        SQLEnum(
            DuesFrequency,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    due_date = Column(DateTime(timezone=True), nullable=False)
    grace_period_days = Column(Integer, nullable=False, default=30)
    late_fee_amount = Column(Numeric(12, 2), nullable=True)
    fiscal_year_id = Column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="SET NULL"),
        nullable=True,
    )
    applies_to_membership_types = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    fiscal_year = relationship("FiscalYear", foreign_keys=[fiscal_year_id])
    creator = relationship("User", foreign_keys=[created_by])
    member_dues = relationship(
        "MemberDues",
        back_populates="dues_schedule",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_dues_schedules_org_id", "organization_id"),)


class MemberDues(Base):
    """Individual member dues payment record"""

    __tablename__ = "member_dues"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    dues_schedule_id = Column(
        String(36),
        ForeignKey("dues_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount_due = Column(Numeric(12, 2), nullable=False)
    amount_paid = Column(Numeric(12, 2), nullable=False, default=0)
    status = Column(
        SQLEnum(
            DuesStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=DuesStatus.PENDING,
    )
    due_date = Column(DateTime(timezone=True), nullable=False)
    paid_date = Column(DateTime(timezone=True), nullable=True)
    payment_method = Column(String(50), nullable=True)
    transaction_reference = Column(String(200), nullable=True)
    late_fee_applied = Column(Numeric(12, 2), nullable=True)
    waived_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    waived_at = Column(DateTime(timezone=True), nullable=True)
    waive_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
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
    organization = relationship("Organization", foreign_keys=[organization_id])
    dues_schedule = relationship("DuesSchedule", back_populates="member_dues")
    user = relationship("User", foreign_keys=[user_id])
    waiver_approver = relationship("User", foreign_keys=[waived_by])

    __table_args__ = (
        Index("ix_member_dues_org_id", "organization_id"),
        Index("ix_member_dues_user", "user_id", "status"),
        Index("ix_member_dues_schedule", "dues_schedule_id", "status"),
    )


# ============================================
# Phase 5: Export Mappings & Logs
# ============================================


class ExportMapping(Base):
    """Mapping between internal budget categories and QuickBooks accounts"""

    __tablename__ = "finance_export_mappings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    internal_category = Column(String(200), nullable=False)
    qb_account_name = Column(String(200), nullable=False)
    qb_account_number = Column(String(50), nullable=True)
    mapping_type = Column(
        SQLEnum(
            ExportMappingType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
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
    organization = relationship("Organization", foreign_keys=[organization_id])

    __table_args__ = (Index("ix_export_mappings_org_id", "organization_id"),)


class ExportLog(Base):
    """Log of QuickBooks export operations"""

    __tablename__ = "finance_export_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    export_type = Column(String(50), nullable=False)
    date_range_start = Column(DateTime(timezone=True), nullable=False)
    date_range_end = Column(DateTime(timezone=True), nullable=False)
    record_count = Column(Integer, nullable=False, default=0)
    file_format = Column(
        SQLEnum(
            ExportFormat,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    exported_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    exported_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    organization = relationship("Organization", foreign_keys=[organization_id])
    exporter = relationship("User", foreign_keys=[exported_by])

    __table_args__ = (Index("ix_export_logs_org_id", "organization_id"),)
