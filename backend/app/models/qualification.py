"""Member qualifications — what a member is trained and certified to do.

A qualification is not a rank. Rank is where a member sits in the chain of
command (Lieutenant, Captain, Chief); a qualification is what they are
certified to do (EMT, Paramedic, Driver/Operator, Firefighter I/II). The two
are independent, and a single ``User.rank`` string could express only one of
them — so a *Captain who is also a Paramedic*, an entirely ordinary member of a
volunteer department, had no way to be recorded as both.

The distinction is not ours; the standards already draw it. Firefighter I and
II are NFPA 1001 certification levels, apparatus operator is NFPA 1002, and the
officer ladder is NFPA 1021. EMT and Paramedic are EMS credentials on a
separate track again.

Qualifications expire and ranks do not, which is the other half of why they
cannot share a column. A member holds Captain until the department changes it;
they hold EMT until a date, after which they do not. ``expires_on`` is what
makes that expressible, and shift eligibility reads it *as of the shift date*
rather than as of today — the same rule EVOC certifications already use for
drivers, and for the same reason: a certification that is current now but
lapses before the shift qualifies nobody to work it.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import User


class MemberQualification(Base):
    """One qualification held by one member.

    Rows are per organization as well as per user: the same person can only be
    a member of one department here, but scoping the row means every read is
    org-filterable without a join back through ``users`` (CLAUDE.md pitfall
    #14).
    """

    __tablename__ = "member_qualifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # A code from QUALIFICATIONS in app/services/qualification_service.py.
    # Stored as a string rather than an enum so a department can be given its
    # own qualifications later without a schema change — the same shape the
    # rank list already has.
    qualification_code: Mapped[str] = mapped_column(String(50), nullable=False)

    granted_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # NULL means it does not expire. A qualification with no expiry is
    # ordinary — Firefighter I does not lapse in most states — so NULL has to
    # mean "current forever" rather than "unknown", and every reader treats it
    # that way.
    expires_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", backref="qualifications")

    __table_args__ = (
        # One row per member per qualification. Renewing an EMT card updates
        # the expiry on the row that is there rather than stacking a second
        # one, so "does this member hold X" never has to pick between rows.
        UniqueConstraint(
            "user_id", "qualification_code", name="uq_member_qualification"
        ),
        Index("ix_member_qual_org_code", "organization_id", "qualification_code"),
    )

    def __repr__(self) -> str:
        return (
            f"<MemberQualification(user_id={self.user_id}, "
            f"code={self.qualification_code}, expires_on={self.expires_on})>"
        )
