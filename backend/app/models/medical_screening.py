"""
Medical Screening Database Models

SQLAlchemy models for tracking medical screenings, physical exams,
and compliance requirements for both active members and prospective members.
Designed for reuse across the application (annual member requirements,
pipeline stages, etc.).
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(255), nullable=False)
    screening_type = Column(
        Enum(ScreeningType, name="screening_type_enum"),
        nullable=False,
    )
    description = Column(Text, nullable=True)
    frequency_months = Column(
        Integer,
        nullable=True,
        comment="Recurrence in months (e.g. 12 for annual). NULL = one-time.",
    )
    applies_to_roles = Column(
        JSON,
        nullable=True,
        comment="JSON list of role names this requirement applies to.",
    )
    is_active = Column(Boolean, default=True, nullable=False)
    grace_period_days = Column(
        Integer,
        default=30,
        nullable=False,
        comment="Days past due before flagging non-compliant.",
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    records = relationship(
        "ScreeningRecord",
        back_populates="requirement",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_screening_req_org", "organization_id"),
        Index("idx_screening_req_org_type", "organization_id", "screening_type"),
    )


class ScreeningRecord(Base):
    """
    Individual screening instance for a user or prospective member.

    Links to either a user_id (active member) or a prospect_id (prospective
    member in the pipeline), but not both.
    """

    __tablename__ = "screening_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    requirement_id = Column(
        String(36),
        ForeignKey("screening_requirements.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        comment="For active members. NULL if this is for a prospect.",
    )
    prospect_id = Column(
        String(36),
        ForeignKey("prospective_members.id", ondelete="CASCADE"),
        nullable=True,
        comment="For prospective members. NULL if this is for an active member.",
    )
    screening_type = Column(
        Enum(ScreeningType, name="screening_type_enum"),
        nullable=False,
    )
    status = Column(
        Enum(ScreeningStatus, name="screening_status_enum"),
        nullable=False,
        default=ScreeningStatus.SCHEDULED,
    )
    scheduled_date = Column(Date, nullable=True)
    completed_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)
    provider_name = Column(String(255), nullable=True)
    result_summary = Column(Text, nullable=True)
    result_data = Column(
        JSON,
        nullable=True,
        comment="Structured results (scores, measurements, etc.).",
    )
    reviewed_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    requirement = relationship("ScreeningRequirement", back_populates="records")
    user = relationship("User", foreign_keys=[user_id])
    prospect = relationship("ProspectiveMember", foreign_keys=[prospect_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])

    __table_args__ = (
        Index("idx_screening_rec_org", "organization_id"),
        Index("idx_screening_rec_user", "user_id"),
        Index("idx_screening_rec_prospect", "prospect_id"),
        Index("idx_screening_rec_status", "organization_id", "status"),
        Index(
            "idx_screening_rec_expiration",
            "organization_id",
            "expiration_date",
        ),
    )
