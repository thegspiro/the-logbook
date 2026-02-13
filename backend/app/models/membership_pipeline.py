"""
Membership Pipeline Database Models

SQLAlchemy models for the prospective member pipeline system.
Keeps prospective members on a separate table from active members,
with customizable pipeline steps that membership coordinators can
configure per-department.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Date,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Index,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


# --- Enums ---

class PipelineStepType(str, enum.Enum):
    """Type of pipeline step, determines UI behavior"""
    ACTION = "action"
    CHECKBOX = "checkbox"
    NOTE = "note"


class ActionType(str, enum.Enum):
    """Specific action type for action steps"""
    SEND_EMAIL = "send_email"
    SCHEDULE_MEETING = "schedule_meeting"
    COLLECT_DOCUMENT = "collect_document"
    CUSTOM = "custom"


class ProspectStatus(str, enum.Enum):
    """Status of a prospective member"""
    ACTIVE = "active"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    TRANSFERRED = "transferred"


class StepProgressStatus(str, enum.Enum):
    """Status of a prospect's progress on a single step"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


# --- Models ---

class MembershipPipeline(Base):
    """
    Pipeline definition for prospective member onboarding.

    Each organization can have multiple pipelines (e.g., from templates)
    but only one is marked as the default active pipeline.
    """
    __tablename__ = "membership_pipelines"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(255), nullable=False)
    description = Column(Text)
    is_template = Column(Boolean, default=False, index=True)
    is_default = Column(Boolean, default=False)
    auto_transfer_on_approval = Column(Boolean, default=False)

    created_by = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    steps = relationship(
        "MembershipPipelineStep",
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="MembershipPipelineStep.sort_order",
    )
    prospects = relationship(
        "ProspectiveMember",
        back_populates="pipeline",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_pipeline_org_default", "organization_id", "is_default"),
        Index("idx_pipeline_org_template", "organization_id", "is_template"),
    )

    def __repr__(self):
        return f"<MembershipPipeline(name={self.name})>"


class MembershipPipelineStep(Base):
    """
    A single step within a membership pipeline.

    Steps can be action-based (send email, schedule meeting),
    checkbox-based (mark complete), or note-based (add comments).
    Coordinators can add, remove, and reorder steps.
    """
    __tablename__ = "membership_pipeline_steps"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    pipeline_id = Column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(255), nullable=False)
    description = Column(Text)
    step_type = Column(
        Enum(PipelineStepType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=PipelineStepType.CHECKBOX,
    )
    action_type = Column(
        Enum(ActionType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    is_first_step = Column(Boolean, default=False)
    is_final_step = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0, nullable=False)
    email_template_id = Column(
        String(36),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    required = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    pipeline = relationship("MembershipPipeline", back_populates="steps")
    progress_records = relationship(
        "ProspectStepProgress",
        back_populates="step",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_pipeline_step_order", "pipeline_id", "sort_order"),
    )

    def __repr__(self):
        return f"<MembershipPipelineStep(name={self.name}, type={self.step_type})>"


class ProspectiveMember(Base):
    """
    Prospective member record, kept separate from the users table.

    Only copied to the users table when elected into membership,
    either automatically or via manual transfer by the coordinator.
    """
    __tablename__ = "prospective_members"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pipeline_id = Column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Personal Information
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(20))
    mobile = Column(String(20))
    date_of_birth = Column(Date)

    # Address
    address_street = Column(String(255))
    address_city = Column(String(100))
    address_state = Column(String(50))
    address_zip = Column(String(20))

    # Application details
    interest_reason = Column(Text)
    referral_source = Column(String(255))
    referred_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    # Pipeline tracking
    current_step_id = Column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
    )
    status = Column(
        Enum(ProspectStatus, values_callable=lambda x: [e.value for e in x]),
        default=ProspectStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    # Extensible data (from form submissions, custom fields, etc.)
    metadata_ = Column("metadata", JSON, default={})
    form_submission_id = Column(
        String(36),
        ForeignKey("form_submissions.id", ondelete="SET NULL"),
    )

    # Transfer tracking
    transferred_user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    transferred_at = Column(DateTime(timezone=True))

    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    pipeline = relationship("MembershipPipeline", back_populates="prospects")
    current_step = relationship("MembershipPipelineStep", foreign_keys=[current_step_id])
    referrer = relationship("User", foreign_keys=[referred_by])
    transferred_user = relationship("User", foreign_keys=[transferred_user_id])
    step_progress = relationship(
        "ProspectStepProgress",
        back_populates="prospect",
        cascade="all, delete-orphan",
    )
    activity_log = relationship(
        "ProspectActivityLog",
        back_populates="prospect",
        cascade="all, delete-orphan",
        order_by="ProspectActivityLog.created_at.desc()",
    )

    __table_args__ = (
        Index("idx_prospect_org_status", "organization_id", "status"),
        Index("idx_prospect_org_pipeline", "organization_id", "pipeline_id"),
        Index("idx_prospect_org_email", "organization_id", "email"),
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def __repr__(self):
        return f"<ProspectiveMember(name={self.full_name}, status={self.status})>"


class ProspectStepProgress(Base):
    """
    Tracks a prospect's progress on each pipeline step.

    One record per prospect-step combination, updated as the
    prospect advances through the pipeline.
    """
    __tablename__ = "prospect_step_progress"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    prospect_id = Column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_id = Column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = Column(
        Enum(StepProgressStatus, values_callable=lambda x: [e.value for e in x]),
        default=StepProgressStatus.PENDING,
        nullable=False,
    )
    completed_at = Column(DateTime(timezone=True))
    completed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))
    notes = Column(Text)
    action_result = Column(JSON)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    prospect = relationship("ProspectiveMember", back_populates="step_progress")
    step = relationship("MembershipPipelineStep", back_populates="progress_records")
    completer = relationship("User", foreign_keys=[completed_by])

    __table_args__ = (
        Index("idx_step_progress_prospect_step", "prospect_id", "step_id", unique=True),
    )

    def __repr__(self):
        return f"<ProspectStepProgress(prospect={self.prospect_id}, step={self.step_id}, status={self.status})>"


class ProspectActivityLog(Base):
    """
    Audit trail for prospect-related actions.

    Records every meaningful action taken on a prospect
    for accountability and history tracking.
    """
    __tablename__ = "prospect_activity_log"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    prospect_id = Column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action = Column(String(100), nullable=False)
    details = Column(JSON)
    performed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    prospect = relationship("ProspectiveMember", back_populates="activity_log")
    performer = relationship("User", foreign_keys=[performed_by])

    __table_args__ = (
        Index("idx_activity_log_prospect", "prospect_id"),
        Index("idx_activity_log_action", "action"),
    )

    def __repr__(self):
        return f"<ProspectActivityLog(prospect={self.prospect_id}, action={self.action})>"
