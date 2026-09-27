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
"""

from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
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

    agency_name = Column(String(255), nullable=False)
    apparatus = Column(String(100), nullable=True)
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
