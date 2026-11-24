"""Community risk reduction (CRR): each department's catalogue of activities.

The catalogue is what CRR activity logging offers (owner decisions,
2026-11-21/22): the kinds of activity a department records (smoke alarm
installs, car seat checks), the counts each one records, and the risks and
priority populations an activity can be tagged with.

Rows are per department rather than shared system rows, so a department can
rename or retire a default as freely as one it added. ``is_system`` only
records that a row was seeded; a seeded row is retired, never deleted, which is
what lets ``CrrCatalogueService.ensure_defaults`` tell "never seeded" from
"everything was removed".

Codes are stable keys, made once from the label and never changed by a rename,
so a record that names a type keeps naming the same one.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid

#: The two kinds of tag. A risk is what an activity reduces (fire, falls); a
#: population is who it is aimed at (older adults, children).
CRR_TAG_KINDS = ("risk", "population")


class CrrActivityType(Base):
    """A kind of CRR activity a department records."""

    __tablename__ = "crr_activity_types"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # The Admin Hours category an activity of this type credits. NULL falls
    # back to the department's mapping for Public Education events, the rule
    # apparatus nights follow; never added to it, so nothing is credited twice.
    admin_hours_category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    measures: Mapped[List["CrrActivityMeasure"]] = relationship(
        "CrrActivityMeasure",
        back_populates="activity_type",
        cascade="all, delete-orphan",
        order_by="CrrActivityMeasure.sort_order",
    )
    tag_links: Mapped[List["CrrActivityTypeTag"]] = relationship(
        "CrrActivityTypeTag",
        back_populates="activity_type",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_crr_activity_types_code"),
        Index("ix_crr_activity_types_org", "organization_id", "is_active"),
    )


class CrrActivityMeasure(Base):
    """A count an activity type records, such as "alarms installed".

    Phase 4's yearly goals are set per measure, which is why a count is a row
    of its own rather than a label inside the type.
    """

    __tablename__ = "crr_activity_measures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    activity_type_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activity_types.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    activity_type: Mapped["CrrActivityType"] = relationship(
        "CrrActivityType", back_populates="measures"
    )

    __table_args__ = (
        UniqueConstraint(
            "activity_type_id", "code", name="uq_crr_activity_measures_code"
        ),
        Index("ix_crr_activity_measures_org", "organization_id"),
    )


class CrrTag(Base):
    """A risk or a priority population an activity can be tagged with."""

    __tablename__ = "crr_tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # One of CRR_TAG_KINDS; validated by the schema.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "kind", "code", name="uq_crr_tags_code"),
    )


class CrrActivityTypeTag(Base):
    """A tag an activity type carries by default.

    An activity copies its type's tags when it is recorded and can change them
    there, so editing a type's defaults never rewrites what was recorded.
    """

    __tablename__ = "crr_activity_type_tags"

    activity_type_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activity_types.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("crr_tags.id", ondelete="CASCADE"), primary_key=True
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    activity_type: Mapped["CrrActivityType"] = relationship(
        "CrrActivityType", back_populates="tag_links"
    )

    __table_args__ = (
        Index("ix_crr_activity_type_tags_tag", "tag_id"),
        Index("ix_crr_activity_type_tags_org", "organization_id"),
    )


class CrrActivity(Base):
    """One CRR activity a department carried out: a log entry, or an activity
    recorded against an outreach event.

    Location is kept in two tiers (owner decisions, 2026-11-21/22). ZIP, city,
    state and county are plain, because reporting by area reads them and they
    are kept for audit. The street address, the resident's name, phone and
    email, and the notes are encrypted at rest, are recorded only when the
    recorder ticks "add resident details", are shown only to holders of
    ``crr.view_contact``, and are cleared after the department's retention
    period (``resident_details_cleared_at`` marks that it happened).
    """

    __tablename__ = "crr_activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # RESTRICT: a type activities name is retired, never deleted.
    activity_type_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activity_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # An activity done at an outreach event. The activity outlives the event:
    # what was installed in a home is still true if the event is deleted.
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    zip_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    county: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    street_address: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    resident_name: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    resident_phone: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    resident_email: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    resident_details_cleared_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    counts: Mapped[List["CrrActivityCount"]] = relationship(
        "CrrActivityCount", cascade="all, delete-orphan"
    )
    tag_links: Mapped[List["CrrActivityTag"]] = relationship(
        "CrrActivityTag", cascade="all, delete-orphan"
    )
    members: Mapped[List["CrrActivityMember"]] = relationship(
        "CrrActivityMember", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_crr_activities_org_when", "organization_id", "occurred_at"),
        Index("ix_crr_activities_event", "event_id"),
        Index("ix_crr_activities_type", "activity_type_id"),
    )


class CrrActivityCount(Base):
    """How many of one measure an activity achieved ("3 alarms installed")."""

    __tablename__ = "crr_activity_counts"

    activity_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    measure_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activity_measures.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_crr_activity_counts_quantity"),
        Index("ix_crr_activity_counts_measure", "measure_id"),
        Index("ix_crr_activity_counts_org", "organization_id"),
    )


class CrrActivityTag(Base):
    """A risk or population an activity was tagged with, copied from its type's
    defaults when recorded and changeable afterwards."""

    __tablename__ = "crr_activity_tags"

    activity_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("crr_tags.id", ondelete="RESTRICT"), primary_key=True
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        Index("ix_crr_activity_tags_tag", "tag_id"),
        Index("ix_crr_activity_tags_org", "organization_id"),
    )


class CrrActivityMember(Base):
    """A member who carried out an activity, and for how long.

    The minutes are what Admin Hours is credited from, for a log entry only:
    an activity recorded against an event credits nothing, because the
    event's own attendance already does (owner decision, 2026-11-22).
    """

    __tablename__ = "crr_activity_members"

    activity_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("crr_activities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "minutes >= 0 AND minutes <= 1440", name="ck_crr_activity_members_minutes"
        ),
        Index("ix_crr_activity_members_user", "user_id"),
        Index("ix_crr_activity_members_org", "organization_id"),
    )
