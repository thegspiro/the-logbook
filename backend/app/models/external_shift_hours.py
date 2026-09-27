"""
External Shift Hours

Shift hours a member worked outside the department's own schedule — most
often riding a neighbouring jurisdiction's apparatus under mutual aid or a
staffing agreement. There is no ``Shift`` row to attach the time to, so it
cannot live in ``shift_attendance``, whose every reader joins through
``shifts`` for the organization and the date.

An entry counts from the moment it is logged. An officer who finds one
wrong rejects it, which removes it from every total without deleting the
member's record of what they claimed.

The agency and apparatus come from a list officers maintain
(``external_agencies`` / ``external_apparatus``) rather than free text, so
leadership can count which outside units members help staff without
"Engine 42", "E-42" and "eng 42" reading as three different trucks.
"""

from enum import Enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ExternalShiftHoursStatus(str, Enum):
    COUNTED = "counted"
    REJECTED = "rejected"


# The same ceiling the officer's manual shift report accepts. One entry is
# one shift; a longer stretch is logged as the shifts it actually was.
MAX_EXTERNAL_SHIFT_MINUTES = 48 * 60


class ExternalAgency(Base):
    """A department members may staff apparatus for."""

    __tablename__ = "external_agencies"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "name", name="uq_external_agencies_org_name"
        ),
    )


class ExternalApparatus(Base):
    """One unit belonging to an :class:`ExternalAgency`."""

    __tablename__ = "external_apparatus"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    agency_id = Column(
        String(36),
        ForeignKey("external_agencies.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    apparatus_type = Column(String(50), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint("agency_id", "name", name="uq_external_apparatus_agency_name"),
        Index("ix_external_apparatus_org", "organization_id"),
    )


class ExternalShiftHours(Base):
    __tablename__ = "external_shift_hours"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    shift_date = Column(Date, nullable=False)
    duration_minutes = Column(Integer, nullable=False)

    # Required on every write; nullable only so removing a unit from the
    # list cannot take the shifts logged on it with it. The two name columns
    # are a snapshot taken at the write, which is what keeps such an entry
    # readable afterwards.
    external_apparatus_id = Column(
        String(36),
        ForeignKey("external_apparatus.id", ondelete="SET NULL"),
        nullable=True,
    )
    agency_name = Column(String(255), nullable=False)
    apparatus_name = Column(String(100), nullable=False)
    role = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)

    status = Column(
        String(20),
        nullable=False,
        default=ExternalShiftHoursStatus.COUNTED.value,
        server_default=ExternalShiftHoursStatus.COUNTED.value,
    )
    reviewed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index(
            "ix_external_shift_hours_org_user_date",
            "organization_id",
            "user_id",
            "shift_date",
        ),
        Index("ix_external_shift_hours_org_date", "organization_id", "shift_date"),
        Index("ix_external_shift_hours_apparatus", "external_apparatus_id"),
        CheckConstraint(
            "status IN ('counted', 'rejected')",
            name="ck_external_shift_hours_status",
        ),
        CheckConstraint(
            f"duration_minutes > 0 AND duration_minutes <= {MAX_EXTERNAL_SHIFT_MINUTES}",
            name="ck_external_shift_hours_duration",
        ),
    )

    def __repr__(self):
        return (
            f"<ExternalShiftHours(user_id={self.user_id}, "
            f"shift_date={self.shift_date}, minutes={self.duration_minutes})>"
        )
