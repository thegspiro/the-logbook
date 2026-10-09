"""
Finance Module Models

Handles fiscal years, budgets, purchase requests, expense reports,
check requests, dues/assessments, configurable approval chains,
and QuickBooks export mappings.
"""

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.apparatus import Apparatus
    from app.models.email_template import EmailTemplate
    from app.models.facilities import Facility
    from app.models.user import Organization, Position, User

# ============================================
# Enums
# ============================================


class FiscalYearStatus(str, enum.Enum):
    """Status of a fiscal year"""

    DRAFT = "draft"
    ACTIVE = "active"
    CLOSED = "closed"


class BudgetRequestStatus(str, enum.Enum):
    """Where a line owner's request for next year's money stands.

    ``draft`` and ``submitted`` belong to the owner (edit, submit, withdraw);
    the other three are the Treasurer's decision. ``adjusted`` is an approval
    for a different amount than was asked, and always carries a note.
    """

    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    ADJUSTED = "adjusted"
    DECLINED = "declined"


class BudgetPlanningStage(str, enum.Enum):
    """Where a draft fiscal year's budget is on its way to adoption.

    Owners request amounts (``requests``), the Treasurer closes the draft to
    them and senior leadership adjusts the decided amounts
    (``leadership_review``), then the budget goes before the board
    (``board_review``). Recording the board's vote moves it to ``adopted``,
    where it waits for the Treasurer to start the year on or after its start
    date. Only a draft year has a stage.
    """

    REQUESTS = "requests"
    LEADERSHIP_REVIEW = "leadership_review"
    BOARD_REVIEW = "board_review"
    ADOPTED = "adopted"


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[FiscalYearStatus] = mapped_column(
        SQLEnum(
            FiscalYearStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=FiscalYearStatus.DRAFT,
    )
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The last day line owners may propose amounts for this (draft) year, on
    # the department's calendar: requests stay open through the end of that
    # day in the org's timezone. NULL means no deadline.
    request_deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # NULL on a draft year reads as REQUESTS, so a year drafted before stages
    # existed keeps taking requests; non-draft years carry NULL.
    planning_stage: Mapped[Optional[BudgetPlanningStage]] = mapped_column(
        SQLEnum(
            BudgetPlanningStage,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    # The board's adoption of the budget, recorded from board review: the
    # vote is what allows the year to be started and its budget spent, so it
    # is kept with the year rather than only in the audit log.
    adopted_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    adoption_reference: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    adoption_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    adoption_recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    adoption_recorded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the Treasurer began the year-end close (status became CLOSED
    # without the lock), and the reconciliation sign-off that locked it.
    closing_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    locked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    locked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lock_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    adoption_recorder: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[adoption_recorded_by]
    )
    budgets: Mapped[list["Budget"]] = relationship(
        "Budget", back_populates="fiscal_year", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_fiscal_years_org_status", "organization_id", "status"),)


class BudgetCategory(Base):
    """Budget category (hierarchical)"""

    __tablename__ = "budget_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parent_category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    qb_account_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # The position answerable for this category's lines. A line with no owner
    # of its own inherits this one (app/services/finance_budget_ownership.py).
    owner_position_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    owner_position: Mapped[Optional["Position"]] = relationship(
        "Position", foreign_keys=[owner_position_id]
    )
    parent: Mapped[Optional["BudgetCategory"]] = relationship(
        "BudgetCategory",
        remote_side=[id],
        foreign_keys=[parent_category_id],
        back_populates="children",
    )
    children: Mapped[list["BudgetCategory"]] = relationship(
        "BudgetCategory",
        foreign_keys=[parent_category_id],
        back_populates="parent",
    )

    __table_args__ = (Index("ix_budget_categories_org_id", "organization_id"),)


class Budget(Base):
    """Budget line for a category within a fiscal year"""

    __tablename__ = "budgets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    fiscal_year_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount_budgeted: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    amount_spent: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    amount_encumbered: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    station_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("facilities.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The line's own owner. NULL means "inherit the category's owner", not
    # "no owner" — app/services/finance_budget_ownership.py resolves which.
    owner_position_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    fiscal_year: Mapped["FiscalYear"] = relationship(
        "FiscalYear", back_populates="budgets"
    )
    category: Mapped["BudgetCategory"] = relationship(
        "BudgetCategory", foreign_keys=[category_id]
    )
    station: Mapped[Optional["Facility"]] = relationship(
        "Facility", foreign_keys=[station_id]
    )
    owner_position: Mapped[Optional["Position"]] = relationship(
        "Position", foreign_keys=[owner_position_id]
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    amendments: Mapped[list["BudgetAmendment"]] = relationship(
        "BudgetAmendment",
        back_populates="budget",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="BudgetAmendment.created_at.desc()",
    )

    __table_args__ = (
        Index(
            "ix_budgets_org_fy_cat",
            "organization_id",
            "fiscal_year_id",
            "category_id",
        ),
    )


class BudgetAmendment(Base):
    """Extra money leadership approved for a budget line, as recorded.

    Each row is an audit record of one increase: how much, why, who approved
    it and when, and which member entered it. Adding one raises the line's
    ``amount_budgeted`` by ``amount`` in the same transaction, so
    ``amount_budgeted`` stays the single live ceiling the spend checks read.
    The line's *original* budget is not stored anywhere; it is
    ``amount_budgeted`` minus the sum of these rows
    (``FinanceService._budget_row``).

    There is no edit or delete path: an amendment is what the department
    approved. A mistaken one is corrected by a **reversing entry** (owner
    decision, 2026-10-09): a new row whose ``amount`` is the original's,
    negated, and whose ``reverses_amendment_id`` names it. The original stays
    on record, ``amount_budgeted`` drops by the amount, and the original
    budget -- current less the sum of every row, reversals included -- is
    unchanged. ``FinanceService.reverse_budget_amendment`` holds the rules.
    """

    __tablename__ = "budget_amendments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    budget_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("budgets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # Free text naming the approval, e.g. "Board vote 10/7".
    approved_by: Mapped[str] = mapped_column(String(200), nullable=False)
    approved_on: Mapped[date] = mapped_column(Date, nullable=False)
    # SET NULL rather than RESTRICT: removing a member must not be blocked by,
    # or delete, the record of money the department approved.
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Set only on a reversing entry: the amendment it cancels. UNIQUE so an
    # amendment is reversed at most once -- InnoDB lets any number of rows
    # hold NULL under a unique key, so ordinary amendments are unaffected,
    # and the unique index also serves the foreign key. SET NULL (hence
    # nullable) because the reversal's negative amount must keep counting
    # even if the link is ever lost; only a line's own cascade removes rows.
    reverses_amendment_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budget_amendments.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    budget: Mapped["Budget"] = relationship("Budget", back_populates="amendments")
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])


class BudgetRequest(Base):
    """A line owner's proposed amount for a budget line in a draft year.

    Either ``budget_id`` names the draft-year line the request is for, or —
    for a line that does not exist yet — ``category_id`` and ``station_id``
    describe the proposed line and ``owner_position_id`` the position that
    will own it. Approving a proposal creates the line and links it here.

    Who may make one is the ownership rule in
    ``app/services/finance_budget_ownership.py``; the lifecycle is
    ``app/services/finance_budget_request_service.py``.
    """

    __tablename__ = "budget_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fiscal_year_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SET NULL throughout: removing a line, category, station, position or
    # member must neither be blocked by nor delete the record of what was
    # asked for and decided.
    budget_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    station_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("facilities.id", ondelete="SET NULL"),
        nullable=True,
    )
    owner_position_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    requested_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[BudgetRequestStatus] = mapped_column(
        SQLEnum(
            BudgetRequestStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=BudgetRequestStatus.DRAFT,
    )
    approved_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Senior leadership's change to a decided amount during leadership
    # review, kept beside the Treasurer's decision rather than over it so the
    # record shows who set which figure.
    review_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
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


# ============================================
# Phase 1B: Approval Chains
# ============================================


class ApprovalChain(Base):
    """Configurable approval chain template"""

    __tablename__ = "approval_chains"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applies_to: Mapped[ApprovalEntityType] = mapped_column(
        SQLEnum(
            ApprovalEntityType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    min_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    max_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    budget_category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    budget_category: Mapped[Optional["BudgetCategory"]] = relationship(
        "BudgetCategory", foreign_keys=[budget_category_id]
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    steps: Mapped[list["ApprovalChainStep"]] = relationship(
        "ApprovalChainStep",
        back_populates="chain",
        cascade="all, delete-orphan",
        order_by="ApprovalChainStep.step_order",
    )

    __table_args__ = (
        Index(
            "ix_approval_chains_org_applies",
            "organization_id",
            "applies_to",
        ),
    )


class ApprovalChainStep(Base):
    """A single step in an approval chain"""

    __tablename__ = "approval_chain_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    chain_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("approval_chains.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    step_type: Mapped[ApprovalStepType] = mapped_column(
        SQLEnum(
            ApprovalStepType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ApprovalStepType.APPROVAL,
    )
    approver_type: Mapped[Optional[ApproverType]] = mapped_column(
        SQLEnum(
            ApproverType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    approver_value: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notification_emails: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )
    email_template_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    allow_self_approval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    auto_approve_under: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    chain: Mapped["ApprovalChain"] = relationship(
        "ApprovalChain", back_populates="steps"
    )
    email_template: Mapped[Optional["EmailTemplate"]] = relationship(
        "EmailTemplate", foreign_keys=[email_template_id]
    )

    __table_args__ = (Index("ix_approval_chain_steps_chain", "chain_id", "step_order"),)


class ApprovalStepRecord(Base):
    """Tracks actual approval step progression for a specific entity"""

    __tablename__ = "approval_step_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    chain_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("approval_chains.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("approval_chain_steps.id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[ApprovalEntityType] = mapped_column(
        SQLEnum(
            ApprovalEntityType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[ApprovalStepStatus] = mapped_column(
        SQLEnum(
            ApprovalStepStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ApprovalStepStatus.PENDING,
    )
    assigned_to: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approval_token: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, unique=True
    )
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    chain: Mapped["ApprovalChain"] = relationship(
        "ApprovalChain", foreign_keys=[chain_id]
    )
    step: Mapped["ApprovalChainStep"] = relationship(
        "ApprovalChainStep", foreign_keys=[step_id]
    )
    assignee: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[assigned_to]
    )
    actor: Mapped[Optional["User"]] = relationship("User", foreign_keys=[acted_by])

    __table_args__ = (
        Index(
            "ix_approval_step_records_entity",
            "entity_type",
            "entity_id",
        ),
        Index("ix_approval_step_records_assigned", "assigned_to", "status"),
    )


# ============================================
# Phase 2: Purchase Requests
# ============================================


class PurchaseRequest(Base):
    """Purchase request submitted by a member"""

    __tablename__ = "purchase_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_number: Mapped[str] = mapped_column(String(20), nullable=False)
    fiscal_year_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    requested_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    estimated_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    actual_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    status: Mapped[PurchaseRequestStatus] = mapped_column(
        SQLEnum(
            PurchaseRequestStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=PurchaseRequestStatus.DRAFT,
    )
    priority: Mapped[PurchaseRequestPriority] = mapped_column(
        SQLEnum(
            PurchaseRequestPriority,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=PurchaseRequestPriority.MEDIUM,
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    denial_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ordered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    received_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # An uploaded receipt: a Document under Finance > Receipts. receipt_url is
    # the older typed link, kept for rows that have one.
    receipt_document_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    apparatus_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus.id", ondelete="SET NULL"),
        nullable=True,
    )
    facility_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("facilities.id", ondelete="SET NULL"),
        nullable=True,
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    fiscal_year: Mapped["FiscalYear"] = relationship(
        "FiscalYear", foreign_keys=[fiscal_year_id]
    )
    budget: Mapped[Optional["Budget"]] = relationship(
        "Budget", foreign_keys=[budget_id]
    )
    requester: Mapped["User"] = relationship("User", foreign_keys=[requested_by])
    approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by]
    )
    apparatus: Mapped[Optional["Apparatus"]] = relationship(
        "Apparatus", foreign_keys=[apparatus_id]
    )
    facility: Mapped[Optional["Facility"]] = relationship(
        "Facility", foreign_keys=[facility_id]
    )

    __table_args__ = (
        # Numbers are generated per org (PR-YYYY-NNNN), so uniqueness must be
        # per org too — a global unique made two orgs' first request of a year
        # collide. The constraint also backs the retry-on-conflict allocator.
        UniqueConstraint(
            "organization_id", "request_number", name="uq_purchase_requests_org_number"
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_number: Mapped[str] = mapped_column(String(20), nullable=False)
    submitted_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    fiscal_year_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    status: Mapped[ExpenseReportStatus] = mapped_column(
        SQLEnum(
            ExpenseReportStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExpenseReportStatus.DRAFT,
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    denial_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    submitter: Mapped["User"] = relationship("User", foreign_keys=[submitted_by])
    fiscal_year: Mapped["FiscalYear"] = relationship(
        "FiscalYear", foreign_keys=[fiscal_year_id]
    )
    approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by]
    )
    line_items: Mapped[list["ExpenseLineItem"]] = relationship(
        "ExpenseLineItem",
        back_populates="expense_report",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Per-org uniqueness — see PurchaseRequest.__table_args__.
        UniqueConstraint(
            "organization_id", "report_number", name="uq_expense_reports_org_number"
        ),
        Index(
            "ix_expense_reports_org_status",
            "organization_id",
            "status",
        ),
    )


class ExpenseLineItem(Base):
    """Individual line item within an expense report"""

    __tablename__ = "expense_line_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    expense_report_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("expense_reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    date_incurred: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    expense_type: Mapped[ExpenseType] = mapped_column(
        SQLEnum(
            ExpenseType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExpenseType.GENERAL,
    )
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # An uploaded receipt: a Document under Finance > Receipts. receipt_url is
    # the older typed link, kept for rows that have one.
    receipt_document_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    merchant: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    expense_report: Mapped["ExpenseReport"] = relationship(
        "ExpenseReport", back_populates="line_items"
    )
    budget: Mapped[Optional["Budget"]] = relationship(
        "Budget", foreign_keys=[budget_id]
    )

    __table_args__ = (Index("ix_expense_line_items_report", "expense_report_id"),)


class CheckRequest(Base):
    """Request to cut a check for payment"""

    __tablename__ = "check_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_number: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    fiscal_year_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
    )
    budget_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("budgets.id", ondelete="SET NULL"),
        nullable=True,
    )
    payee_name: Mapped[str] = mapped_column(String(300), nullable=False)
    payee_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    memo: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    purpose: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[CheckRequestStatus] = mapped_column(
        SQLEnum(
            CheckRequestStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=CheckRequestStatus.DRAFT,
    )
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    denial_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    check_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    check_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    requester: Mapped["User"] = relationship("User", foreign_keys=[requested_by])
    fiscal_year: Mapped["FiscalYear"] = relationship(
        "FiscalYear", foreign_keys=[fiscal_year_id]
    )
    budget: Mapped[Optional["Budget"]] = relationship(
        "Budget", foreign_keys=[budget_id]
    )
    approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by]
    )

    __table_args__ = (
        # Per-org uniqueness — see PurchaseRequest.__table_args__.
        UniqueConstraint(
            "organization_id", "request_number", name="uq_check_requests_org_number"
        ),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    frequency: Mapped[DuesFrequency] = mapped_column(
        SQLEnum(
            DuesFrequency,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    grace_period_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    late_fee_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    fiscal_year_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fiscal_years.id", ondelete="SET NULL"),
        nullable=True,
    )
    applies_to_membership_types: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    fiscal_year: Mapped[Optional["FiscalYear"]] = relationship(
        "FiscalYear", foreign_keys=[fiscal_year_id]
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    member_dues: Mapped[list["MemberDues"]] = relationship(
        "MemberDues",
        back_populates="dues_schedule",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_dues_schedules_org_id", "organization_id"),)


class MemberDues(Base):
    """Individual member dues payment record"""

    __tablename__ = "member_dues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    dues_schedule_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("dues_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount_due: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    status: Mapped[DuesStatus] = mapped_column(
        SQLEnum(
            DuesStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=DuesStatus.PENDING,
    )
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    transaction_reference: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    late_fee_applied: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    waived_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    waived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    waive_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    dues_schedule: Mapped["DuesSchedule"] = relationship(
        "DuesSchedule", back_populates="member_dues"
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    waiver_approver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[waived_by]
    )
    payments: Mapped[list["DuesPayment"]] = relationship(
        "DuesPayment",
        back_populates="member_dues",
        cascade="all, delete-orphan",
        order_by="DuesPayment.received_at",
    )

    __table_args__ = (
        Index("ix_member_dues_org_id", "organization_id"),
        Index("ix_member_dues_user", "user_id", "status"),
        Index("ix_member_dues_schedule", "dues_schedule_id", "status"),
    )


class DuesPayment(Base):
    """A single payment received against a member's dues (FIN-6).

    ``MemberDues`` used to be the only record of payment: one ``amount_paid``
    total plus one set of ``payment_method`` / ``transaction_reference`` /
    ``notes`` columns, all overwritten by whichever payment was entered last.
    Nothing recorded that a payment had *happened*, so a retry could not be
    distinguished from a second instalment, and the detail of every earlier
    payment was destroyed as soon as another arrived.

    Each payment is now a row here, and the columns on ``MemberDues`` are
    derived from this ledger rather than mutated in place — see
    ``_apply_payment_totals``. That makes the total recomputable rather than
    accumulated, which is what allows a double-submission to be rejected
    without guessing.
    """

    __tablename__ = "dues_payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    member_dues_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("member_dues.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    transaction_reference: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # SET NULL requires nullable=True (MySQL 1830). The ledger row must outlive
    # the member who entered it — losing the treasurer must not lose the money.
    recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
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

    member_dues: Mapped["MemberDues"] = relationship(
        "MemberDues", back_populates="payments"
    )
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    recorder: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[recorded_by]
    )

    __table_args__ = (
        # Idempotency key. MySQL permits multiple NULLs in a unique index, so
        # cash taken at a meeting with no reference is unaffected — the
        # constraint binds only when a reference identifies the transaction.
        UniqueConstraint(
            "member_dues_id",
            "transaction_reference",
            name="uq_dues_payment_reference",
        ),
        Index("ix_dues_payments_org_id", "organization_id"),
        Index("ix_dues_payments_dues", "member_dues_id", "received_at"),
    )


# ============================================
# Phase 5: Export Mappings & Logs
# ============================================


class ExportMapping(Base):
    """Mapping between internal budget categories and QuickBooks accounts"""

    __tablename__ = "finance_export_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    internal_category: Mapped[str] = mapped_column(String(200), nullable=False)
    qb_account_name: Mapped[str] = mapped_column(String(200), nullable=False)
    qb_account_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # The balancing side of each journal entry: the account the money left
    # (expenses) or arrived in. QuickBooks rejects an entry whose debits and
    # credits differ, so a category without one cannot be exported.
    qb_offset_account_name: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    mapping_type: Mapped[ExportMappingType] = mapped_column(
        SQLEnum(
            ExportMappingType,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
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
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )

    __table_args__ = (Index("ix_export_mappings_org_id", "organization_id"),)


class ExportLog(Base):
    """Log of an export attempt, including interrupted streams."""

    __tablename__ = "finance_export_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    export_type: Mapped[str] = mapped_column(String(50), nullable=False)
    date_range_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    date_range_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_format: Mapped[ExportFormat] = mapped_column(
        SQLEnum(
            ExportFormat,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    exported_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    exported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # pending -> successful, failed (nothing delivered), or partial (some rows
    # delivered before a generator error/client disconnect).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    exporter: Mapped["User"] = relationship("User", foreign_keys=[exported_by])

    __table_args__ = (Index("ix_export_logs_org_id", "organization_id"),)
