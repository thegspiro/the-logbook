"""Course Links: each time an officer linked a name's records to a course.

Training Admin -> Curriculum -> Course Links sets a library course on every
unlinked training record carrying a name, with the course's category and
training type. A link can change hundreds of records at once ("Link all
suggested"), so each one is kept here with what every record held before, and
an officer can unlink it (owner decision 2026-11-16).

Only what the link changed is stored per record: its course was always empty,
so the category and training type are the whole of what an unlink puts back.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class TrainingCourseLink(Base):
    """One name's records linked to one library course."""

    __tablename__ = "training_course_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL: a course deleted since leaves the history readable by name.
    course_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("training_courses.id", ondelete="SET NULL"),
        nullable=True,
    )
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # The name's grouping key (name_key in app/services/training_course_links.py)
    # and the spelling shown for it.
    name_key: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    linked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    undone_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    undone_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_training_course_links_org_linked", "organization_id", "linked_at"),
    )


class TrainingCourseLinkRecord(Base):
    """A record a link changed, and the category and type it had before."""

    __tablename__ = "training_course_link_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    link_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("training_course_links.id", ondelete="CASCADE"),
        nullable=False,
    )
    # CASCADE: a record deleted since has nothing to put back.
    record_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("training_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    # No foreign key: a category deleted since is put back as it was, and the
    # record then shows none, as it would have.
    previous_category_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True
    )
    previous_training_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "link_id", "record_id", name="uq_training_course_link_records_link_record"
        ),
        Index("ix_training_course_link_records_record", "record_id"),
    )
