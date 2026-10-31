"""
Member Performance Evaluation Models

A department evaluates its members once a review period closes — yearly for
most, monthly or quarterly for probationers — against a template it built for
that kind of member. The evaluator rates and writes; the member writes a
self-evaluation in parallel and later acknowledges the result; officers named
in the template's workflow approve it. The finished evaluation is a personnel
record, kept indefinitely.

Three properties shape the tables, and each is load-bearing:

**What was signed never changes.** A template is edited as a draft version and
frozen when published; an evaluation points at the version it started on, so
editing the template afterwards cannot rewrite one already under way. The data
pulled from the rest of the application (training, attendance, shifts, calls)
is copied into ``evaluations.data_snapshot`` rather than recomputed on view,
and every signature carries the hash of the exact content it was given for.

**Steps only move forward.** ``evaluation_steps`` records each workflow step's
state. A completed step is never reopened; the one route back is an
*amendment*, which starts a new ``revision`` of the evaluation with its own
steps, parts and signatures, and is itself recorded in
``evaluation_amendments``. The earlier revision's text is not kept — an
amendment exists to remove a statement that should not have been made, and a
retained copy would defeat it.

**Removal is never silent.** Deleting an evaluation leaves an
``evaluation_deletion_records`` row naming who removed it, when and why, with
denormalized names so the record still reads correctly after the people and
template it mentions are renamed or gone. ``member_id`` is RESTRICT on both
that table and ``evaluations``: a member with evaluation history cannot be
hard-deleted (``user_deletion_service`` reports it as a blocker and the member
is archived and anonymized instead), so personnel history cannot disappear as
a side effect of removing an account.

Supervisor-only commentary is deliberately absent (owner decision 2026-10-31).
Notes about a member that are shared among officers and used for a personnel
decision are, under firefighter procedural bill-of-rights statutes (e.g.
Cal. Gov. Code 3255-3256, *Poole v. Orange County Fire Authority*, 2015),
material the member is entitled to read and answer. Everything stored here is
either shown to the member or is workflow state.

Status, kind and type columns are plain strings rather than MySQL ENUMs, so a
new value is a code change rather than an ALTER TABLE; the enums below are the
allowed values and the schemas validate against them.
"""

import enum
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class EvaluationTemplateKind(str, enum.Enum):
    """``annual`` runs the full signature workflow; ``interim`` is a lighter
    check-in (a probationer's monthly review, a mid-year conversation) with no
    signatures."""

    ANNUAL = "annual"
    INTERIM = "interim"


class EvaluationStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    FINALIZED = "finalized"


class EvaluationStepType(str, enum.Enum):
    """What a workflow step asks of whoever acts on it.

    ``self_evaluation`` and ``evaluator`` run in parallel; the evaluator cannot
    read the self-evaluation until the member submits it. ``calibration`` is
    hidden from the member and comes before the evaluator locks their part, so
    any change it prompts is the evaluator's own, made with a justification
    the member can read.
    """

    SELF_EVALUATION = "self_evaluation"
    EVALUATOR = "evaluator"
    CALIBRATION = "calibration"
    APPROVAL = "approval"
    MEMBER_ACKNOWLEDGEMENT = "member_acknowledgement"


class EvaluationStepStatus(str, enum.Enum):
    PENDING = "pending"
    OPEN = "open"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class EvaluationPartKind(str, enum.Enum):
    """Who wrote a block of content. ``member_response`` is the written
    response a member may attach after finalization; it is added to the record
    without reopening the evaluation."""

    EVALUATOR = "evaluator"
    SELF_EVALUATION = "self_evaluation"
    MEMBER_RESPONSE = "member_response"


class EvaluationPartStatus(str, enum.Enum):
    """``draft`` is saved progress the author can pick up later; ``submitted``
    is locked. Saving and submitting are separate actions."""

    DRAFT = "draft"
    SUBMITTED = "submitted"


class SignatureDisposition(str, enum.Enum):
    """How a signer closed their step.

    A member's signature is an *acknowledgement* of receipt, never agreement.
    ``refused`` records a member who declined to sign, with their reason; the
    refusal is noted and the evaluation still finalizes, as the procedural
    bill-of-rights statutes provide.
    """

    SIGNED = "signed"
    ACKNOWLEDGED = "acknowledged"
    REFUSED = "refused"


class EvaluationTemplate(Base):
    """A department's evaluation form for one kind of member.

    A template matches members by ``member_class`` and ``member_status`` (see
    ``app/utils/membership.py``); NULL in either means "any". The content and
    workflow live on ``EvaluationTemplateVersion`` so that publishing a change
    never alters an evaluation already started. Retiring a template is
    ``is_active``; a template whose versions are referenced by an evaluation
    cannot be deleted (the version foreign key is RESTRICT).
    """

    __tablename__ = "evaluation_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=EvaluationTemplateKind.ANNUAL.value,
        server_default=EvaluationTemplateKind.ANNUAL.value,
    )
    member_class: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    member_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[list["EvaluationTemplateVersion"]] = relationship(
        "EvaluationTemplateVersion",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="EvaluationTemplateVersion.version_number",
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_evaluation_templates_org_name"
        ),
        Index("ix_evaluation_templates_org_active", "organization_id", "is_active"),
    )


class EvaluationTemplateVersion(Base):
    """One version of a template's content and workflow.

    ``published_at`` NULL is the editable draft; once set, the row is frozen.
    ``definition`` holds the sections, items, evaluation tools, behavioral
    anchors, data blocks with their scoring rules, and rank-triggered officer
    sections; ``workflow`` holds the ordered steps and their deadlines (days
    after the period ends). Both are written only through the template
    service, which settles them to one canonical shape on every write
    (CLAUDE.md pitfall #20).
    """

    __tablename__ = "evaluation_template_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("evaluation_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    workflow: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    template: Mapped["EvaluationTemplate"] = relationship(
        "EvaluationTemplate", back_populates="versions"
    )

    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "version_number",
            name="uq_evaluation_template_versions_number",
        ),
        Index(
            "ix_evaluation_template_versions_org_template",
            "organization_id",
            "template_id",
        ),
    )


class EvaluationPeriod(Base):
    """A review period a manager opens, e.g. "2026 Annual Review".

    Bulk drafting runs against one period. Each member's own coverage within
    it is narrower when they joined partway through, separated or were on an
    approved leave; that is computed per evaluation, not stored here.
    """

    __tablename__ = "evaluation_periods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_closed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_evaluation_periods_org_name"
        ),
        CheckConstraint("end_date >= start_date", name="date_order"),
        Index("ix_evaluation_periods_org_dates", "organization_id", "start_date"),
    )


class Evaluation(Base):
    """One member's evaluation for one period.

    ``period_start`` / ``period_end`` are the nominal dates (the period's, or
    custom dates for a one-off). ``coverage_start`` / ``coverage_end`` and
    ``excluded_ranges`` narrow them to the time the member was actually
    serving: from the first full month after joining, without separations or
    approved leaves of absence. Data blocks and requirements are measured
    over that coverage, not the nominal period.

    The evaluator can never be the member. That rule is enforced by the
    evaluation service rather than a CHECK constraint: MySQL refuses a CHECK
    on a column whose foreign key has a referential action, and
    ``evaluator_id`` must be SET NULL so an evaluator leaving the department
    does not block their removal.
    """

    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    evaluator_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    period_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("evaluation_periods.id", ondelete="RESTRICT"),
        nullable=True,
    )
    template_version_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("evaluation_template_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=EvaluationStatus.IN_PROGRESS.value,
        server_default=EvaluationStatus.IN_PROGRESS.value,
    )
    # Starts at 1; an amendment moves it on and the earlier revision's steps,
    # parts and signatures are superseded by the new revision's.
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    coverage_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    coverage_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    excluded_ranges: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    # Decided from the member's rank when the evaluation is drafted, so a
    # promotion afterwards does not add sections to a form already started.
    includes_officer_sections: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    data_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    snapshot_taken_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finalized_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    template_version: Mapped["EvaluationTemplateVersion"] = relationship(
        "EvaluationTemplateVersion"
    )
    period: Mapped[Optional["EvaluationPeriod"]] = relationship("EvaluationPeriod")
    steps: Mapped[list["EvaluationStep"]] = relationship(
        "EvaluationStep",
        back_populates="evaluation",
        cascade="all, delete-orphan",
        order_by="[EvaluationStep.revision, EvaluationStep.step_order]",
    )
    parts: Mapped[list["EvaluationPart"]] = relationship(
        "EvaluationPart", back_populates="evaluation", cascade="all, delete-orphan"
    )
    signatures: Mapped[list["EvaluationSignature"]] = relationship(
        "EvaluationSignature",
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )
    amendments: Mapped[list["EvaluationAmendment"]] = relationship(
        "EvaluationAmendment",
        back_populates="evaluation",
        cascade="all, delete-orphan",
        order_by="EvaluationAmendment.to_revision",
    )

    __table_args__ = (
        # One evaluation per member per period. A deleted evaluation's row is
        # gone (its deletion record stays), so a replacement can be drafted.
        # NULL period_id (a one-off with custom dates) is not constrained,
        # since MySQL treats NULLs as distinct in a unique index.
        UniqueConstraint("member_id", "period_id", name="uq_evaluations_member_period"),
        CheckConstraint("period_end >= period_start", name="period_order"),
        Index("ix_evaluations_org_status", "organization_id", "status"),
        Index("ix_evaluations_org_member", "organization_id", "member_id"),
        Index("ix_evaluations_org_evaluator", "organization_id", "evaluator_id"),
        Index("ix_evaluations_org_period", "organization_id", "period_id"),
    )


class EvaluationStep(Base):
    """The state of one workflow step on one revision of an evaluation.

    Copied from the template version's workflow when the evaluation (or an
    amendment's new revision) starts, with ``due_date`` resolved from the
    step's offset. ``completed`` is final; nothing moves a step back.
    """

    __tablename__ = "evaluation_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    step_key: Mapped[str] = mapped_column(String(50), nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    step_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=EvaluationStepStatus.PENDING.value,
        server_default=EvaluationStepStatus.PENDING.value,
    )
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    evaluation: Mapped["Evaluation"] = relationship(
        "Evaluation", back_populates="steps"
    )

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "revision", "step_key", name="uq_evaluation_steps_key"
        ),
        # The deadline reminder scan: open steps by due date, per department.
        Index("ix_evaluation_steps_org_due", "organization_id", "status", "due_date"),
    )


class EvaluationPart(Base):
    """A block of authored content: the evaluator's ratings and narrative, the
    member's self-evaluation, or the member's post-finalization response.

    ``content`` holds the responses keyed by template item, including any
    score a data block's rule calculated, the score finally given and the
    written justification when the two differ.
    """

    __tablename__ = "evaluation_parts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    author_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=EvaluationPartStatus.DRAFT.value,
        server_default=EvaluationPartStatus.DRAFT.value,
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    evaluation: Mapped["Evaluation"] = relationship(
        "Evaluation", back_populates="parts"
    )

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "revision", "kind", name="uq_evaluation_parts_kind"
        ),
        Index("ix_evaluation_parts_org_eval", "organization_id", "evaluation_id"),
    )


class EvaluationSignature(Base):
    """A signature given on one step of one revision.

    The signer must be signed in; ``signed_name`` is the name they typed and
    ``intent_confirmed`` their explicit confirmation that typing it is
    signing. ``content_hash`` is the SHA-256 of the exact content they were
    shown, and ``ip_address`` / ``user_agent`` record where it was given —
    together the intent and attribution evidence the ESIGN Act and UETA look
    for. A member's signature reads as an acknowledgement of receipt, not
    agreement.
    """

    __tablename__ = "evaluation_signatures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    step_key: Mapped[str] = mapped_column(String(50), nullable=False)
    signer_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    signed_name: Mapped[str] = mapped_column(String(200), nullable=False)
    disposition: Mapped[str] = mapped_column(String(20), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    intent_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    evaluation: Mapped["Evaluation"] = relationship(
        "Evaluation", back_populates="signatures"
    )

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id",
            "revision",
            "step_key",
            name="uq_evaluation_signatures_step",
        ),
        Index("ix_evaluation_signatures_org_eval", "organization_id", "evaluation_id"),
    )


class EvaluationAmendment(Base):
    """A finalized evaluation reopened as a new revision, and why.

    The reason is required and is announced to the member and everyone who
    signed. Only this record of the amendment is kept; the superseded text is
    not.
    """

    __tablename__ = "evaluation_amendments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False
    )
    from_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    to_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    amended_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    amended_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    evaluation: Mapped["Evaluation"] = relationship(
        "Evaluation", back_populates="amendments"
    )

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "to_revision", name="uq_evaluation_amendments_revision"
        ),
        Index("ix_evaluation_amendments_org_eval", "organization_id", "evaluation_id"),
    )


class EvaluationDeletionRecord(Base):
    """The permanent trace of a deleted evaluation.

    The evaluation row and its content are removed; this row stays on the
    member's history. ``evaluation_id`` deliberately has no foreign key — the
    row it named no longer exists. The names are copied at deletion time so
    the record still reads correctly after a rename or a removed account.
    """

    __tablename__ = "evaluation_deletion_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    evaluation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    period_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    template_name: Mapped[str] = mapped_column(String(150), nullable=False)
    evaluator_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    was_finalized: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    deleted_by_name: Mapped[str] = mapped_column(String(200), nullable=False)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", name="uq_evaluation_deletion_records_evaluation"
        ),
        Index(
            "ix_evaluation_deletion_records_org_member", "organization_id", "member_id"
        ),
    )
