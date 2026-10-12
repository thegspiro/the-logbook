"""
Medical Screening Database Models

SQLAlchemy models for tracking medical screenings, physical exams,
and compliance requirements for both active members and prospective members.
Designed for reuse across the application (annual member requirements,
pipeline stages, etc.).
"""

import enum
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import EncryptedJSON, EncryptedText
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.membership_pipeline import ProspectiveMember
    from app.models.user import User

# --- Enums ---


class ScreeningType(str, enum.Enum):
    """Type of medical screening or exam."""

    PHYSICAL_EXAM = "physical_exam"
    MEDICAL_CLEARANCE = "medical_clearance"
    DRUG_SCREENING = "drug_screening"
    VISION_HEARING = "vision_hearing"
    FITNESS_ASSESSMENT = "fitness_assessment"
    PSYCHOLOGICAL = "psychological"


class ScreeningStatus(str, enum.Enum):
    """Status of an individual screening record."""

    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    PASSED = "passed"
    FAILED = "failed"
    PENDING_REVIEW = "pending_review"
    WAIVED = "waived"
    EXPIRED = "expired"


# --- Models ---


class ScreeningRequirement(Base):
    """
    Organization-level definition of a required screening.

    Defines what screenings are required, how often, and for which roles.
    For example: 'Annual Physical Exam' required every 12 months for
    all firefighters and EMTs.
    """

    __tablename__ = "screening_requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    screening_type: Mapped[ScreeningType] = mapped_column(
        Enum(
            ScreeningType,
            name="screening_type_enum",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    frequency_months: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Recurrence in months (e.g. 12 for annual). NULL = one-time.",
    )
    applies_to_roles: Mapped[Optional[list[str]]] = mapped_column(
        JSON,
        nullable=True,
        comment="JSON list of role names this requirement applies to.",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    grace_period_days: Mapped[int] = mapped_column(
        Integer,
        default=30,
        nullable=False,
        comment="Days past due before flagging non-compliant.",
        server_default="30",
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    # A screening record is a member's medical history and must outlive the
    # requirement it was filed against: ScreeningRecord.requirement_id is
    # ondelete="SET NULL", and deleting a requirement only unlinks its
    # records. No "delete" / "delete-orphan" here -- either would have the ORM
    # delete the records before the database's SET NULL ever applied.
    # passive_deletes=True leaves unloaded records to that SET NULL instead
    # of loading the whole collection just to null it; any already loaded
    # are nulled by the ORM, the same outcome.
    records: Mapped[list["ScreeningRecord"]] = relationship(
        "ScreeningRecord",
        back_populates="requirement",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_screening_req_org_type", "organization_id", "screening_type"),
    )


class ScreeningRecord(Base):
    """
    Individual screening instance for a user or prospective member.

    Links to either a user_id (active member) or a prospect_id (prospective
    member in the pipeline), but not both.
    """

    __tablename__ = "screening_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    requirement_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("screening_requirements.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        comment="For active members. NULL if this is for a prospect.",
    )
    prospect_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=True,
        comment="For prospective members. NULL if this is for an active member.",
    )
    screening_type: Mapped[ScreeningType] = mapped_column(
        Enum(
            ScreeningType,
            name="screening_type_enum",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    status: Mapped[ScreeningStatus] = mapped_column(
        Enum(
            ScreeningStatus,
            name="screening_status_enum",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ScreeningStatus.SCHEDULED,
        server_default="scheduled",
    )
    scheduled_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiration_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # PHI (MS-1): provider identity, free-text summaries, structured results and
    # reviewer notes are protected health information — stored encrypted at rest
    # via the transparent EncryptedText/EncryptedJSON column types. Legacy
    # plaintext rows continue to read cleanly during the migration window.
    provider_name: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    result_summary: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    result_data: Mapped[Optional[dict[str, Any]]] = mapped_column(
        EncryptedJSON,
        nullable=True,
        comment="Structured results (scores, measurements, etc.). Encrypted at rest (MS-1).",
    )
    reviewed_by: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # MS-7 (owner decision 2026-10-05): a medical_screening.manage holder may
    # record their own screening — in a small department they are often the
    # only person who can — but the result is marked rather than trusted
    # silently. True when the record's status was last set by the member it is
    # about: on create, or by an update that supplies a status. Compliance
    # still counts it; the compliance views show it as self-recorded.
    self_recorded: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
        comment="Status last set by the record's own subject (MS-7).",
    )
    notes: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    requirement: Mapped[Optional["ScreeningRequirement"]] = relationship(
        "ScreeningRequirement", back_populates="records"
    )
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    prospect: Mapped[Optional["ProspectiveMember"]] = relationship(
        "ProspectiveMember", foreign_keys=[prospect_id]
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewed_by]
    )

    __table_args__ = (
        Index("idx_screening_rec_user", "user_id"),
        Index("idx_screening_rec_prospect", "prospect_id"),
        Index("idx_screening_rec_status", "organization_id", "status"),
        Index(
            "idx_screening_rec_expiration",
            "organization_id",
            "expiration_date",
        ),
    )
