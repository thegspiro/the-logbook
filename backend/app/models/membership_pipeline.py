"""
Membership Pipeline Database Models

SQLAlchemy models for the prospective member pipeline system.
Keeps prospective members on a separate table from active members,
with customizable pipeline steps that membership coordinators can
configure per-department.
"""

import enum
import hashlib
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Computed,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.election import Election
    from app.models.event import Event
    from app.models.user import Position, User

# --- Enums ---


class PipelineStepType(str, enum.Enum):
    """Type of pipeline step, determines UI behavior"""

    ACTION = "action"
    CHECKBOX = "checkbox"
    NOTE = "note"
    FORM_SUBMISSION = "form_submission"
    DOCUMENT_UPLOAD = "document_upload"
    ELECTION_VOTE = "election_vote"
    MANUAL_APPROVAL = "manual_approval"
    MEETING = "meeting"
    STATUS_PAGE_TOGGLE = "status_page_toggle"
    AUTOMATED_EMAIL = "automated_email"
    REFERENCE_CHECK = "reference_check"
    CHECKLIST = "checklist"
    INTERVIEW_REQUIREMENT = "interview_requirement"
    MULTI_APPROVAL = "multi_approval"
    MEDICAL_SCREENING = "medical_screening"


class ActionType(str, enum.Enum):
    """Specific action type for action steps"""

    SEND_EMAIL = "send_email"
    SCHEDULE_MEETING = "schedule_meeting"
    COLLECT_DOCUMENT = "collect_document"
    CUSTOM = "custom"


class ProspectStatus(str, enum.Enum):
    """Status of a prospective member"""

    ACTIVE = "active"
    ON_HOLD = "on_hold"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    INACTIVE = "inactive"
    TRANSFERRED = "transferred"


class StepProgressStatus(str, enum.Enum):
    """Status of a prospect's progress on a single step"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class InterviewRecommendation(str, enum.Enum):
    """Interviewer's recommendation for a prospect"""

    RECOMMEND = "recommend"
    RECOMMEND_WITH_RESERVATIONS = "recommend_with_reservations"
    DO_NOT_RECOMMEND = "do_not_recommend"
    UNDECIDED = "undecided"


# --- Models ---


class MembershipPipeline(Base):
    """
    Pipeline definition for prospective member onboarding.

    Each organization can have multiple pipelines (e.g., from templates)
    but only one is marked as the default active pipeline.
    """

    __tablename__ = "membership_pipelines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_template: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False, index=True
    )
    is_default: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True, index=True)
    auto_transfer_on_approval: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )
    inactivity_config: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )
    # What an applicant becomes on conversion, per applicant track. NULL means
    # not configured: conversion uses DEFAULT_CONVERSION_OUTCOMES in
    # app.schemas.membership_pipeline. Shape: PipelineConversionConfig.
    conversion_config: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    public_status_enabled: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )
    # Off: the public status page lists only completed stages, and withholds
    # the stage total — a count alone tells the applicant how much is left.
    public_show_future_stages: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    report_stage_groups: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, default=list
    )

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    steps: Mapped[list["MembershipPipelineStep"]] = relationship(
        "MembershipPipelineStep",
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="MembershipPipelineStep.sort_order",
    )
    prospects: Mapped[list["ProspectiveMember"]] = relationship(
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    pipeline_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    step_type: Mapped[PipelineStepType] = mapped_column(
        Enum(PipelineStepType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=PipelineStepType.CHECKBOX,
        server_default="checkbox",
    )
    action_type: Mapped[Optional[ActionType]] = mapped_column(
        Enum(ActionType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    is_first_step: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_final_step: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    email_template_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    required: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    inactivity_timeout_days: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    notify_prospect_on_completion: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )
    public_visible: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    pipeline: Mapped["MembershipPipeline"] = relationship(
        "MembershipPipeline", back_populates="steps"
    )
    progress_records: Mapped[list["ProspectStepProgress"]] = relationship(
        "ProspectStepProgress",
        back_populates="step",
        cascade="all, delete-orphan",
    )

    # Unique, not merely indexed. sort_order is not decoration: "the next
    # stage" is an index into the steps sorted by it, so two stages sharing a
    # value make both the board's column order and the destination of an
    # advance depend on how the sort happened to break the tie — differently
    # from one page load to the next. The service already avoids collisions on
    # every path that allocates one; this is the backstop that makes that a
    # guarantee rather than a convention, and it is what a concurrent writer
    # racing past the row lock would hit.
    #
    # `pipeline_id` has no index of its own, so InnoDB uses this one — the only
    # one with `pipeline_id` leftmost — to enforce the foreign key above. That
    # is why migration c7e2a4b9d180 creates it before dropping the permissive
    # `idx_pipeline_step_order` it replaced: MySQL 8.0 rejects the drop with
    # error 1553 while the constraint has nothing else to lean on. Renaming or
    # narrowing this index means checking that path again.
    __table_args__ = (
        Index("uq_pipeline_step_order", "pipeline_id", "sort_order", unique=True),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Personal Information
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    mobile: Mapped[Optional[str]] = mapped_column(String(20))
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)

    # Address
    address_street: Mapped[Optional[str]] = mapped_column(String(255))
    address_city: Mapped[Optional[str]] = mapped_column(String(100))
    address_state: Mapped[Optional[str]] = mapped_column(String(50))
    address_zip: Mapped[Optional[str]] = mapped_column(String(20))

    # Application details
    interest_reason: Mapped[Optional[str]] = mapped_column(Text)
    referral_source: Mapped[Optional[str]] = mapped_column(String(255))
    referred_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    desired_membership_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, default=None
    )  # e.g., "probationary", "administrative"
    # The role the applicant is being brought in to hold, decided during the
    # pipeline and applied by the transfer. SET NULL rather than CASCADE: a
    # deleted role must not take the application with it, and the coordinator
    # is better served by an empty picker than a missing applicant.
    #
    # The target is `positions`, not `roles`: 20260805_0008 renamed the table,
    # and `Role` survives only as a Python alias of `Position` (models/user.py).
    # The column keeps the `role` wording because that is the vocabulary the
    # API boundary already uses -- TransferProspectRequest.role_ids, which this
    # feeds -- and renaming it here would split one concept across two names.
    target_role_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
    )

    # Pipeline tracking
    current_step_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[ProspectStatus] = mapped_column(
        Enum(ProspectStatus, values_callable=lambda x: [e.value for e in x]),
        default=ProspectStatus.ACTIVE,
        nullable=False,
        index=True,
        server_default="active",
    )

    # Extensible data (from form submissions, custom fields, etc.)
    metadata_: Mapped[Optional[dict[str, Any]]] = mapped_column(
        "metadata", JSON, default=dict
    )
    form_submission_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("form_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Public status check token (PP-6). The token is a bearer credential, so
    # neither column yields it from a database or backup read alone:
    #   - status_token_hash is the SHA-256 of the token and is the ONLY column
    #     a lookup may match on. A hash, not a password KDF, because the token
    #     is 256 bits of randomness — there is nothing to brute-force.
    #   - status_token is the token itself, AES-256-GCM encrypted, kept only
    #     because later pipeline emails re-send the link. It is never queried.
    # Writers assign status_token only: the validator below keeps the hash in
    # step with every assignment, including a rotation or a clear.
    status_token: Mapped[Optional[str]] = mapped_column(EncryptedText)
    status_token_hash: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    status_token_created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )

    # Transfer tracking
    transferred_user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    transferred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Lifecycle stamps. `status` says where an application stands now; these
    # say when it got there and what was given as the reason, which is what
    # the drawer and the applicant table report. They are written by
    # MembershipPipelineService._stamp_lifecycle (chosen transitions, single,
    # bulk and generic update) and inline by the inactivity sweep -- the reason
    # itself is also logged as activity, and that log is where the migration
    # backfilled these columns from.
    deactivated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deactivated_reason: Mapped[Optional[str]] = mapped_column(Text)
    reactivated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    withdrawn_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    withdrawal_reason: Mapped[Optional[str]] = mapped_column(Text)

    # When the application's *current* inactive spell began, for the
    # auto-purge clock. Unlike deactivated_at it mirrors status: set on every
    # entry into inactive, cleared on every exit. It is a separate column
    # because deactivated_at is history the drawer displays, and the upgrade
    # that introduced auto-purge had to restart the clock for applications
    # already inactive (feecd81eef2d) without rewriting the date
    # a department sees as "Deactivated". NULL is never purged.
    inactive_since: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    notes: Mapped[Optional[str]] = mapped_column(Text)

    # MySQL has no partial unique indexes.  NULL values do not conflict in a
    # unique index, so this generated column enforces uniqueness only while a
    # prospect is active (and keeps create_all schemas aligned with Alembic).
    active_email: Mapped[Optional[str]] = mapped_column(
        String(255),
        Computed(
            "CASE WHEN status = 'active' THEN email ELSE NULL END", persisted=True
        ),
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    pipeline: Mapped[Optional["MembershipPipeline"]] = relationship(
        "MembershipPipeline", back_populates="prospects"
    )
    current_step: Mapped[Optional["MembershipPipelineStep"]] = relationship(
        "MembershipPipelineStep", foreign_keys=[current_step_id]
    )
    referrer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[referred_by]
    )
    # Read-only here: the name is serialised from this rather than stored, so
    # a renamed role cannot leave a stale copy on every applicant who wanted it.
    # Named "Position" because that is the mapped class; `Role` is an alias and
    # the registry cannot resolve a relationship by it.
    target_role: Mapped[Optional["Position"]] = relationship(
        "Position", foreign_keys=[target_role_id]
    )
    transferred_user: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[transferred_user_id]
    )
    step_progress: Mapped[list["ProspectStepProgress"]] = relationship(
        "ProspectStepProgress",
        back_populates="prospect",
        cascade="all, delete-orphan",
    )
    activity_log: Mapped[list["ProspectActivityLog"]] = relationship(
        "ProspectActivityLog",
        back_populates="prospect",
        cascade="all, delete-orphan",
        order_by="ProspectActivityLog.created_at.desc()",
    )

    __table_args__ = (
        Index("idx_prospect_org_status", "organization_id", "status"),
        Index("idx_prospect_org_pipeline", "organization_id", "pipeline_id"),
        Index("idx_prospect_org_email", "organization_id", "email"),
        Index(
            "uq_prospect_org_active_email",
            "organization_id",
            "active_email",
            unique=True,
        ),
    )

    @staticmethod
    def hash_status_token(token: str) -> str:
        """The lookup key for a public status token: hex SHA-256."""
        return hashlib.sha256(token.encode()).hexdigest()

    @validates("status_token")
    def _sync_status_token_hash(self, _key: str, token: str | None) -> str | None:
        self.status_token_hash = self.hash_status_token(token) if token else None
        return token

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
    __table_args__ = (
        Index(
            "idx_step_progress_prospect_step",
            "prospect_id",
            "step_id",
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[StepProgressStatus] = mapped_column(
        Enum(StepProgressStatus, values_callable=lambda x: [e.value for e in x]),
        default=StepProgressStatus.PENDING,
        nullable=False,
        server_default="pending",
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    action_result: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", back_populates="step_progress"
    )
    step: Mapped["MembershipPipelineStep"] = relationship(
        "MembershipPipelineStep", back_populates="progress_records"
    )
    completer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[completed_by]
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)
    performed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", back_populates="activity_log"
    )
    performer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[performed_by]
    )

    __table_args__ = (
        Index("idx_activity_log_prospect", "prospect_id"),
        Index("idx_activity_log_action", "action"),
    )

    def __repr__(self):
        return (
            f"<ProspectActivityLog(prospect={self.prospect_id}, action={self.action})>"
        )


class ProspectDocument(Base):
    """
    Document uploaded for a prospective member.

    Tracks files attached during the pipeline process,
    such as ID photos, background checks, certifications, etc.
    """

    __tablename__ = "prospect_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
        nullable=True,
    )

    document_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100))

    uploaded_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", backref="documents"
    )
    step: Mapped[Optional["MembershipPipelineStep"]] = relationship(
        "MembershipPipelineStep"
    )
    uploader: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[uploaded_by]
    )

    __table_args__ = (Index("idx_prospect_doc_prospect", "prospect_id"),)

    def __repr__(self):
        return f"<ProspectDocument(prospect={self.prospect_id}, type={self.document_type})>"


class ProspectElectionPackage(Base):
    """
    Election package for a prospective member.

    Bundles applicant information for the membership vote,
    integrating with the Elections module.
    """

    __tablename__ = "prospect_election_packages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="SET NULL"),
        nullable=True,
    )
    step_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
        nullable=True,
    )
    election_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("elections.id", ondelete="SET NULL"),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False, server_default="draft"
    )  # draft, ready, submitted, voted
    applicant_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )
    coordinator_notes: Mapped[Optional[str]] = mapped_column(Text)
    package_config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", backref="election_packages"
    )
    pipeline: Mapped[Optional["MembershipPipeline"]] = relationship(
        "MembershipPipeline"
    )
    step: Mapped[Optional["MembershipPipelineStep"]] = relationship(
        "MembershipPipelineStep"
    )
    election: Mapped[Optional["Election"]] = relationship(
        "Election", foreign_keys=[election_id], lazy="joined"
    )

    __table_args__ = (
        Index("idx_election_pkg_prospect", "prospect_id"),
        Index("idx_election_pkg_status", "status"),
    )

    @property
    def election_title(self):
        return self.election.title if self.election else None

    @property
    def election_end_date(self):
        return self.election.end_date if self.election else None

    @property
    def election_status(self):
        return self.election.status.value if self.election else None

    def __repr__(self):
        return f"<ProspectElectionPackage(prospect={self.prospect_id}, status={self.status})>"


class ProspectInterview(Base):
    """
    Interview record for a prospective member.

    Tracks interviews conducted by department members (membership coordinators,
    chiefs, presidents, etc.) at different stages of the pipeline.
    Multiple interviewers can submit their own notes and recommendations.
    """

    __tablename__ = "prospect_interviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipelines.id", ondelete="SET NULL"),
        nullable=True,
    )
    step_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Interviewer info
    interviewer_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    interviewer_role: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # e.g., "Membership Coordinator", "Chief"

    # Interview content
    notes: Mapped[Optional[str]] = mapped_column(Text)
    recommendation: Mapped[Optional[InterviewRecommendation]] = mapped_column(
        Enum(
            InterviewRecommendation,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
    recommendation_notes: Mapped[Optional[str]] = mapped_column(Text)

    # Interview scheduling
    interview_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", backref="interviews"
    )
    pipeline: Mapped[Optional["MembershipPipeline"]] = relationship(
        "MembershipPipeline"
    )
    step: Mapped[Optional["MembershipPipelineStep"]] = relationship(
        "MembershipPipelineStep"
    )
    interviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[interviewer_id]
    )

    __table_args__ = (
        Index("idx_interview_interviewer", "interviewer_id"),
        Index(
            "idx_interview_prospect_interviewer",
            "prospect_id",
            "interviewer_id",
        ),
    )

    def __repr__(self):
        return f"<ProspectInterview(prospect={self.prospect_id}, interviewer={self.interviewer_id})>"


class ProspectEventLink(Base):
    """
    Links a prospective member to an upcoming event.

    Allows coordinators to associate relevant events (e.g., meetings,
    trainings, social gatherings) with a prospect so they can be
    invited or tracked against those events.
    """

    __tablename__ = "prospect_event_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    prospect_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    linked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    prospect: Mapped["ProspectiveMember"] = relationship(
        "ProspectiveMember", backref="event_links"
    )
    event: Mapped["Event"] = relationship("Event", foreign_keys=[event_id])
    linker: Mapped[Optional["User"]] = relationship("User", foreign_keys=[linked_by])

    __table_args__ = (
        Index(
            "idx_prospect_event_link_unique",
            "prospect_id",
            "event_id",
            unique=True,
        ),
    )
