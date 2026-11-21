"""
Apparatus event models.

Community outreach that rolls an apparatus with a named crew (a Santamobile
run, a holiday parade, a touch-a-truck) but is **not a shift**. A department
keeps reusable templates — which apparatus, which seats, how strictly the
Driver seat follows EVOC, and which Admin Hours category the crew's time goes
to — and schedules them onto one or many nights. Each night is an ordinary
``Event`` with its own crew, so check-in, finalization and hour crediting are
the events module's existing machinery rather than a second copy of it.

None of these rows is a ``Shift``. Shift hours, coverage, eligibility and
shift reports never read them; the scheduling calendar shows them only as a
read-only "outreach · not a shift" overlay.
"""

import enum
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.apparatus import Apparatus


class ApparatusEventEvocMode(str, enum.Enum):
    """How the Driver seat treats the apparatus's required EVOC level.

    ``enforce`` routes through the same rule shifts use (the department's
    ``enforce_evoc`` setting and approved driver exceptions included); ``warn``
    reports a shortfall without blocking; ``ignore`` skips the check, for a
    static display where nobody drives.
    """

    ENFORCE = "enforce"
    WARN = "warn"
    IGNORE = "ignore"


class ApparatusEventSeatType(str, enum.Enum):
    """Only a ``driver`` seat carries an EVOC rule; every other seat is a
    free-text job (Navigator, Santa, Elf) with no qualification attached."""

    DRIVER = "driver"
    GENERAL = "general"


class ApparatusEventSeatMethod(str, enum.Enum):
    """How the current occupant got the seat, shown on the crew board."""

    SELF_SIGNUP = "self_signup"
    ASSIGNED = "assigned"


class ApparatusEventTemplate(Base):
    """A reusable plan for an apparatus event, scheduled onto any number of
    nights. Editing a template changes nights scheduled afterwards only — a
    scheduled night copies the plan, so it can be adjusted on its own."""

    __tablename__ = "apparatus_event_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # An EventType value; validated by the schema, which also refuses
    # "training" (a Training event credits training records, not Admin Hours).
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="public_education"
    )
    # Wall-clock "HH:MM" in the department's timezone. The night's UTC start
    # is computed from it when scheduling, so a template reads "6:00 PM"
    # across a daylight-saving change.
    default_start_time: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=180, server_default="180"
    )
    location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    admin_hours_category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    evoc_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enforce", server_default="enforce"
    )
    allow_self_signup: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    show_on_schedule: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    duplicated_from_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_event_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Archived rather than deleted, so nights scheduled from it keep saying
    # which template they came from.
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_by: Mapped[Optional[str]] = mapped_column(
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

    units: Mapped[List["ApparatusEventTemplateUnit"]] = relationship(
        "ApparatusEventTemplateUnit",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="ApparatusEventTemplateUnit.sort_order",
    )

    __table_args__ = (
        Index("ix_apparatus_event_templates_org", "organization_id", "is_archived"),
    )


class ApparatusEventTemplateUnit(Base):
    """One apparatus on a template, with its seats."""

    __tablename__ = "apparatus_event_template_units"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    template_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_event_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    template: Mapped["ApparatusEventTemplate"] = relationship(
        "ApparatusEventTemplate", back_populates="units"
    )
    apparatus: Mapped["Apparatus"] = relationship("Apparatus")
    seats: Mapped[List["ApparatusEventTemplateSeat"]] = relationship(
        "ApparatusEventTemplateSeat",
        back_populates="unit",
        cascade="all, delete-orphan",
        order_by="ApparatusEventTemplateSeat.sort_order",
    )

    __table_args__ = (
        Index("ix_apparatus_event_template_units_template", "template_id"),
    )


class ApparatusEventTemplateSeat(Base):
    """A named job on a template's apparatus, ``count`` seats wide ("Elf",
    4). Scheduling expands it into ``count`` individual night seats."""

    __tablename__ = "apparatus_event_template_seats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    unit_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("apparatus_event_template_units.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    seat_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="general", server_default="general"
    )
    count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    unit: Mapped["ApparatusEventTemplateUnit"] = relationship(
        "ApparatusEventTemplateUnit", back_populates="seats"
    )

    __table_args__ = (Index("ix_apparatus_event_template_seats_unit", "unit_id"),)


class EventApparatusPlan(Base):
    """Marks an ``Event`` as an apparatus night and carries the rules copied
    from its template. Its presence is what redirects the night's hour credit
    to ``admin_hours_category_id`` in place of the event-type mapping — see
    ``AdminHoursService.crew_hour_category_overrides``."""

    __tablename__ = "event_apparatus_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("apparatus_event_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Nights scheduled together share this id, which is how a night knows it
    # is "Night 2 of 5" and links to its siblings. Not a recurrence series:
    # each night is edited, cancelled and finalized on its own.
    series_id: Mapped[str] = mapped_column(String(36), nullable=False)
    admin_hours_category_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("admin_hours_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    evoc_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enforce", server_default="enforce"
    )
    allow_self_signup: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    show_on_schedule: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    units: Mapped[List["EventApparatusUnit"]] = relationship(
        "EventApparatusUnit",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="EventApparatusUnit.sort_order",
    )

    __table_args__ = (
        Index("ux_event_apparatus_plans_event", "event_id", unique=True),
        Index("ix_event_apparatus_plans_series", "organization_id", "series_id"),
    )


class EventApparatusUnit(Base):
    """One apparatus committed to one night."""

    __tablename__ = "event_apparatus_units"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("event_apparatus_plans.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    apparatus_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("apparatus.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    plan: Mapped["EventApparatusPlan"] = relationship(
        "EventApparatusPlan", back_populates="units"
    )
    apparatus: Mapped["Apparatus"] = relationship("Apparatus")
    seats: Mapped[List["EventApparatusSeat"]] = relationship(
        "EventApparatusSeat",
        back_populates="unit",
        cascade="all, delete-orphan",
        order_by="EventApparatusSeat.sort_order",
    )

    __table_args__ = (
        Index(
            "ux_event_apparatus_units_event_app",
            "event_id",
            "apparatus_id",
            unique=True,
        ),
        # The conflict check asks "is this apparatus on any other night that
        # overlaps?", which starts from the apparatus.
        Index("ix_event_apparatus_units_apparatus", "organization_id", "apparatus_id"),
    )


class EventApparatusSeat(Base):
    """One seat on one night's apparatus — open when ``user_id`` is NULL."""

    __tablename__ = "event_apparatus_seats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    unit_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("event_apparatus_units.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    seat_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="general", server_default="general"
    )
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assignment_method: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    assigned_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    unit: Mapped["EventApparatusUnit"] = relationship(
        "EventApparatusUnit", back_populates="seats"
    )

    __table_args__ = (
        # One seat per member per night. NULLs (open seats) do not collide in
        # a MySQL unique index, so this constrains only filled seats — and it
        # is what makes two concurrent claims by one member fail at the
        # database even if both pass the service's check.
        Index(
            "ux_event_apparatus_seats_event_user", "event_id", "user_id", unique=True
        ),
        Index("ix_event_apparatus_seats_unit", "unit_id"),
        Index("ix_event_apparatus_seats_org_user", "organization_id", "user_id"),
    )
