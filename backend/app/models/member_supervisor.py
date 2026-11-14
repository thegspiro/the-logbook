"""
Member Supervisor Assignments

Who a member reports to, and since when (owner decision 2026-11-01). Each row
is one dated stretch: ``starts_on`` through ``ends_on`` inclusive, with
``ends_on`` NULL for the assignment in effect now. Changing a member's
supervisor closes the open row and opens a new one, so the history of who
supervised a member is kept rather than overwritten.

Writes go through ``MemberSupervisorService``, which checks what the database
cannot: a member never supervises themselves, the supervisor is a current
member of the same department, and dates do not overlap earlier rows.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# The generated column's expression, shared with the migration that creates
# the table so the two cannot drift.
OPEN_MARKER_EXPRESSION = "CASE WHEN ends_on IS NULL THEN 1 ELSE NULL END"


class MemberSupervisorAssignment(Base):
    """One stretch of time during which ``supervisor_id`` supervised ``member_id``.

    **At most one open row per member, enforced by the database.** MySQL has
    no partial unique index, so ``open_marker`` is a stored generated column
    that is 1 while ``ends_on`` is NULL and NULL once the row is closed; the
    unique key on ``(member_id, open_marker)`` then admits one open row and
    any number of closed ones, because MySQL treats NULLs as distinct. The
    expression reads ``ends_on`` only: MySQL refuses a stored generated column
    whose base column carries a foreign key with a referential action, and
    ``member_id`` is CASCADE. The service also takes the member's row lock
    before reading, so two concurrent changes queue rather than one failing
    on the key.

    **``supervisor_id`` is SET NULL, not CASCADE.** The rows are the
    *member's* history; hard-deleting the officer who once supervised them
    must not erase the record that the member had a supervisor over those
    dates. The row keeps its dates and reads "a former member". An open row
    left pointing at nobody is reported as no current supervisor, and setting
    a new one closes it as usual. ``member_id`` is CASCADE: the history
    belongs to the member and goes with them.

    "Never supervises themselves" is a service rule, not a CHECK, for the
    reason the ``Evaluation`` model gives: MySQL refuses a CHECK naming a
    column whose foreign key has a referential action.
    """

    __tablename__ = "member_supervisor_assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    supervisor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    open_marker: Mapped[Optional[int]] = mapped_column(
        Integer, Computed(OPEN_MARKER_EXPRESSION, persisted=True)
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "member_id", "open_marker", name="uq_member_supervisor_assignments_open"
        ),
        CheckConstraint("ends_on IS NULL OR ends_on >= starts_on", name="date_order"),
        Index(
            "ix_member_supervisor_assignments_org_member",
            "organization_id",
            "member_id",
            "starts_on",
        ),
        Index(
            "ix_member_supervisor_assignments_org_supervisor",
            "organization_id",
            "supervisor_id",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<MemberSupervisorAssignment(member_id={self.member_id}, "
            f"supervisor_id={self.supervisor_id}, {self.starts_on} - {self.ends_on})>"
        )
