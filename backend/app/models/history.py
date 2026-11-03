"""
History Module Database Models

The department's archive: people who served (``historical_members``), the
titles they held, how they were related, and two things every archive record
shares — a change history (``history_revisions``) and the department's
clearance list for putting a record in front of the public.

Revisions and clearance requests point at their record by ``record_type`` and
``record_id`` rather than by a foreign key, because the same machinery serves
photos, documents, events and articles in later phases. Every read of those
tables therefore filters ``organization_id`` as well as the record id.
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
from app.core.encrypted_types import EncryptedDate, EncryptedJSON, EncryptedText
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import User


def _enum(enum_cls: type[enum.Enum]) -> Enum:
    return Enum(enum_cls, values_callable=lambda members: [m.value for m in members])


# --- Enums ---


class DatePrecision(str, enum.Enum):
    """How much of a stored date is known. A year-only date is stored as 1 Jan."""

    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class PublicationLevel(str, enum.Enum):
    """Who may read a record, in increasing reach."""

    DRAFT = "draft"
    MEMBERS = "members"
    PUBLIC = "public"


class FieldVisibility(str, enum.Enum):
    """Who may read one sensitive field of a record that is itself readable."""

    HISTORIAN = "historian"
    MEMBERS = "members"
    PUBLIC = "public"


class TitleSource(str, enum.Enum):
    """Where a title-list entry came from. Informational only once stored."""

    RANK = "rank"
    POSITION = "position"
    CUSTOM = "custom"


class RelationType(str, enum.Enum):
    """A family link, read from the first person: A is ``parent_of`` B."""

    PARENT_OF = "parent_of"
    GRANDPARENT_OF = "grandparent_of"
    SIBLING = "sibling"
    SPOUSE = "spouse"
    OTHER = "other"


class RevisionKind(str, enum.Enum):
    """One entry in a record's change history."""

    CREATED = "created"
    MINOR = "minor"
    SUBSTANTIAL = "substantial"
    PUBLISHED = "published"
    UNPUBLISHED = "unpublished"
    SUBMITTED = "submitted"
    CLEARED = "cleared"
    RETURNED = "returned"
    WITHDRAWN = "withdrawn"


class ClearancePurpose(str, enum.Enum):
    """Why a record was sent through the clearance list."""

    PUBLIC = "public"
    REVIEW = "review"


class ClearanceStatus(str, enum.Enum):
    PENDING = "pending"
    CLEARED = "cleared"
    RETURNED = "returned"
    WITHDRAWN = "withdrawn"


class ClearanceDecisionKind(str, enum.Enum):
    CLEARED = "cleared"
    RETURNED = "returned"


# --- Title list ---


class HistoryTitle(Base):
    """One entry in a department's managed list of historical titles.

    Records point at the entry rather than copying its text, so correcting a
    spelling here corrects it on every record, and a title that is in use can
    only be merged away, never deleted out from under the records using it.
    """

    __tablename__ = "history_titles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    # Casefolded, whitespace-collapsed copy of ``name``: what uniqueness is
    # decided on, so "Asst. Chief" and "asst.  chief" cannot both be entered.
    name_key: Mapped[str] = mapped_column(String(150), nullable=False)
    source: Mapped[TitleSource] = mapped_column(
        _enum(TitleSource), nullable=False, default=TitleSource.CUSTOM
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Retired rather than deleted: a retired title stays on the records that
    # carry it but is no longer offered. Rows are never removed except by a
    # merge, which is also why a department's list is pre-filled exactly once —
    # an organization with no rows at all has never been seeded.
    is_retired: Mapped[bool] = mapped_column(
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

    __table_args__ = (
        UniqueConstraint("organization_id", "name_key", name="uq_history_title_key"),
    )


# --- People ---


class HistoricalMember(Base):
    """A person who served the department, as the archive records them.

    The record keeps its own copy of the person's identity even when it is
    linked to an account: anonymizing that account later leaves the history
    record as it is (owner decision, recorded in docs/KNOWN_LIMITATIONS.md).

    Restricted fields — birth date, addresses, verification sources, research
    notes — are never sent to members or the public. Encrypted at rest because
    they are personal data about people who may still be living.
    """

    __tablename__ = "historical_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    first_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    middle_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    suffix: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    nickname: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Free text that may repeat: departments reissue badge numbers across
    # decades. Reuse is warned about at entry, never refused.
    badge_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    birth_date: Mapped[Optional[date]] = mapped_column(EncryptedDate, nullable=True)
    birth_date_precision: Mapped[DatePrecision] = mapped_column(
        _enum(DatePrecision), nullable=False, default=DatePrecision.DAY
    )
    birth_date_circa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    biography: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    addresses: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    verification_sources: Mapped[Optional[str]] = mapped_column(
        EncryptedText, nullable=True
    )
    research_notes: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)

    is_memorial: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    is_line_of_duty_death: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    death_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    death_date_precision: Mapped[DatePrecision] = mapped_column(
        _enum(DatePrecision), nullable=False, default=DatePrecision.DAY
    )
    death_date_circa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    death_date_visibility: Mapped[FieldVisibility] = mapped_column(
        _enum(FieldVisibility), nullable=False, default=FieldVisibility.HISTORIAN
    )
    death_circumstances: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    death_circumstances_visibility: Mapped[FieldVisibility] = mapped_column(
        _enum(FieldVisibility), nullable=False, default=FieldVisibility.HISTORIAN
    )
    burial_location: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    burial_location_visibility: Mapped[FieldVisibility] = mapped_column(
        _enum(FieldVisibility), nullable=False, default=FieldVisibility.HISTORIAN
    )

    publication_level: Mapped[PublicationLevel] = mapped_column(
        _enum(PublicationLevel), nullable=False, default=PublicationLevel.DRAFT
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The version the public sees: the last one cleared for it. A substantial
    # edit leaves this alone until the edit is cleared in turn, so nothing
    # unreviewed reaches the public and the page does not vanish meanwhile.
    public_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    public_revision_number: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    # The latest revision a substantial edit produced. Public changes are
    # pending while this is newer than ``public_revision_number``.
    substantial_revision_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    revision_number: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
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

    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    service_periods: Mapped[list["HistoricalMemberServicePeriod"]] = relationship(
        "HistoricalMemberServicePeriod",
        back_populates="member",
        cascade="all, delete-orphan",
        order_by="HistoricalMemberServicePeriod.sort_order",
    )

    __table_args__ = (
        Index("ix_historical_members_org_last", "organization_id", "last_name"),
        Index(
            "ix_historical_members_org_level", "organization_id", "publication_level"
        ),
        Index(
            "ix_historical_members_org_lodd",
            "organization_id",
            "is_line_of_duty_death",
        ),
    )


class HistoricalMemberServicePeriod(Base):
    """One stretch of service. A person who left and rejoined has several.

    No ``organization_id``: reached only through its member, which is.
    """

    __tablename__ = "historical_member_service_periods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    member_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    start_precision: Mapped[DatePrecision] = mapped_column(
        _enum(DatePrecision), nullable=False, default=DatePrecision.YEAR
    )
    start_circa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_precision: Mapped[DatePrecision] = mapped_column(
        _enum(DatePrecision), nullable=False, default=DatePrecision.YEAR
    )
    end_circa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Distinguishes "1998–present" from a period whose end is simply unknown;
    # both have no end date.
    is_ongoing: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    member: Mapped["HistoricalMember"] = relationship(
        "HistoricalMember", back_populates="service_periods"
    )
    titles: Mapped[list["HistoricalMemberPeriodTitle"]] = relationship(
        "HistoricalMemberPeriodTitle",
        back_populates="period",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_hist_service_periods_member", "member_id"),)


class HistoricalMemberPeriodTitle(Base):
    """A title held during one service period."""

    __tablename__ = "historical_member_period_titles"

    period_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_member_service_periods.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # RESTRICT: a title in use is merged into another, never deleted.
    title_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("history_titles.id", ondelete="RESTRICT"),
        primary_key=True,
    )

    period: Mapped["HistoricalMemberServicePeriod"] = relationship(
        "HistoricalMemberServicePeriod", back_populates="titles"
    )
    title: Mapped["HistoryTitle"] = relationship("HistoryTitle")


class HistoricalMemberRelation(Base):
    """A family link between two people, stored once and read from both ends."""

    __tablename__ = "historical_member_relations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    related_member_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    relation_type: Mapped[RelationType] = mapped_column(
        _enum(RelationType), nullable=False
    )
    # Required for ``other`` ("cousin", "uncle"), unused otherwise.
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "member_id",
            "related_member_id",
            "relation_type",
            name="uq_historical_member_relation",
        ),
        Index("ix_hist_relations_related", "related_member_id"),
    )


# --- Change history ---


class HistoryRevision(Base):
    """One entry in an archive record's change history.

    Edits carry a snapshot of the whole record as it stood afterwards, restricted
    fields included, so the snapshot is encrypted like those fields are.
    Publication and clearance events carry no snapshot.
    """

    __tablename__ = "history_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    record_type: Mapped[str] = mapped_column(String(30), nullable=False)
    record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # The record's revision number this entry produced or refers to.
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[RevisionKind] = mapped_column(_enum(RevisionKind), nullable=False)
    snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(
        EncryptedJSON, nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    actor: Mapped[Optional["User"]] = relationship("User", foreign_keys=[actor_id])

    __table_args__ = (
        Index(
            "ix_history_revisions_record",
            "organization_id",
            "record_type",
            "record_id",
            "created_at",
        ),
    )


# --- Clearance ---


class HistoryClearanceStep(Base):
    """One step in a department's clearance list, in order.

    Any one member holding the step's position clears it. If the position is
    deleted the step keeps its place with no position, which blocks it with a
    message rather than letting records skip a review the department set up.
    """

    __tablename__ = "history_clearance_steps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    position_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
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

    __table_args__ = (
        Index("ix_history_clearance_steps_org", "organization_id", "step_order"),
    )


class HistoryClearanceRequest(Base):
    """One submission of one revision through the clearance list.

    ``steps`` is the list as it stood at submission. A request finishes the
    review it started even if the department edits its list meanwhile.
    """

    __tablename__ = "history_clearance_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    record_type: Mapped[str] = mapped_column(String(30), nullable=False)
    record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    purpose: Mapped[ClearancePurpose] = mapped_column(
        _enum(ClearancePurpose), nullable=False
    )
    status: Mapped[ClearanceStatus] = mapped_column(
        _enum(ClearanceStatus), nullable=False, default=ClearanceStatus.PENDING
    )
    #: [{"step_id", "step_order", "name", "position_id"}], frozen at submission.
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    #: Index into ``steps`` of the step now awaiting a decision.
    current_step_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    submitted_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    decisions: Mapped[list["HistoryClearanceDecision"]] = relationship(
        "HistoryClearanceDecision",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="HistoryClearanceDecision.decided_at",
    )

    __table_args__ = (
        Index(
            "ix_history_clearance_requests_record",
            "organization_id",
            "record_type",
            "record_id",
        ),
        Index("ix_history_clearance_requests_status", "organization_id", "status"),
    )


class HistoryClearanceDecision(Base):
    """One step's decision on one request.

    No ``organization_id``: reached only through its request, which is.
    """

    __tablename__ = "history_clearance_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("history_clearance_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    step_name: Mapped[str] = mapped_column(String(150), nullable=False)
    decision: Mapped[ClearanceDecisionKind] = mapped_column(
        _enum(ClearanceDecisionKind), nullable=False
    )
    decided_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Owner decision: a member may clear their own submission (a small
    # department's President writes and publishes), and the history says so.
    decided_by_author: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    request: Mapped["HistoryClearanceRequest"] = relationship(
        "HistoryClearanceRequest", back_populates="decisions"
    )

    __table_args__ = (Index("ix_history_clearance_decisions_req", "request_id"),)
