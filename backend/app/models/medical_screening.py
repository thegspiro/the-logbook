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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import (
    EncryptedEnum,
    EncryptedJSON,
    EncryptedReference,
    EncryptedText,
)
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

    # No relationship to ScreeningRecord: the record's requirement_id is
    # ciphertext since MS-18 (owner decision 2026-11-06), so there is no
    # foreign key to join on. A record is a member's medical history and must
    # outlive the requirement it was filed against; deleting a requirement
    # clears its records' links in MedicalScreeningService.delete_requirement,
    # which is what the old ON DELETE SET NULL did.

    __table_args__ = (
        Index("idx_screening_req_org_type", "organization_id", "screening_type"),
    )


class ScreeningRecord(Base):
    """
    Individual screening instance for a user or prospective member.

    Created for either a user_id (active member) or a prospect_id (prospective
    member in the pipeline), never both. The one exception is set by the
    transfer to membership: it adds the new member's user_id to the
    prospect's records and keeps prospect_id, so both ids mark a record
    carried across (W71b-2, migration beedcad5b36a).
    """

    __tablename__ = "screening_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # MS-18 (owner decision 2026-11-06): the link is ciphertext. A plain id
    # leads straight to a requirement whose name says what the screening was,
    # which would undo encrypting screening_type below. No foreign key: the
    # database cannot match ciphertext, so the link is checked in-org when it
    # is written and cleared in code when its requirement is deleted.
    requirement_id: Mapped[Optional[str]] = mapped_column(
        EncryptedReference,
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
    # MS-18 (owner decision 2026-11-06): which screening a member had is PHI
    # on its own — "this member — psychological evaluation" — so the type is
    # ciphertext like the status below, and is matched in Python after
    # decryption. The requirement's own type stays plaintext: it describes
    # the department's policy, not a person.
    screening_type: Mapped[ScreeningType] = mapped_column(
        EncryptedEnum(ScreeningType),
        nullable=False,
    )
    # MS-18: the outcome is PHI too — "failed" beside a member's name and a
    # psychological evaluation says what the encrypted notes would. Stored as
    # ciphertext, so the database cannot filter or sort on it: readers load
    # rows and compare the decrypted value in Python, and the column refuses
    # a SQL comparison outright. No server default: a database default would
    # be plaintext. The ORM default always supplies a value.
    status: Mapped[ScreeningStatus] = mapped_column(
        EncryptedEnum(ScreeningStatus),
        nullable=False,
        default=ScreeningStatus.SCHEDULED,
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
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    prospect: Mapped[Optional["ProspectiveMember"]] = relationship(
        "ProspectiveMember", foreign_keys=[prospect_id]
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewed_by]
    )

    if TYPE_CHECKING:
        # Not columns. MedicalScreeningService stamps display names on loaded records
        # for the list response. Declared only for the type checker: an annotation
        # SQLAlchemy sees would have to be mapped.
        user_name: Optional[str]
        prospect_name: Optional[str]
        reviewer_name: Optional[str]
        requirement_name: Optional[str]

    __table_args__ = (
        Index("idx_screening_rec_user", "user_id"),
        Index("idx_screening_rec_prospect", "prospect_id"),
        Index(
            "idx_screening_rec_expiration",
            "organization_id",
            "expiration_date",
        ),
    )


class ScreeningReminderSend(Base):
    """One expiry reminder sent for one screening, at one tier (W71b-4).

    The unique key ``(screening_record_id, tier_days, due_date)`` is what makes
    a second daily run, or two runs at once, a no-op (pitfall #36): the run
    inserts this row before it sends, and a duplicate insert means another run
    already has that reminder. ``due_date`` is part of the key so an officer
    who corrects the record's expiration date re-arms the reminders for the
    new date rather than leaving them spent on the old one.

    Holds no PHI beyond what ``screening_records`` already keeps in plaintext:
    the record id and the due date.
    """

    __tablename__ = "screening_reminder_sends"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    screening_record_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("screening_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    tier_days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="The reminder tier: days before the due date (90, 60, 30 or 7).",
    )
    due_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        comment="The due date this reminder was about.",
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "screening_record_id",
            "tier_days",
            "due_date",
            name="uq_screening_reminder_send",
        ),
        Index("idx_screening_reminder_org", "organization_id"),
    )
