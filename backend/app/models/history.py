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


class HistoryImportStatus(str, enum.Enum):
    DRAFT = "draft"
    COMMITTED = "committed"
    DISCARDED = "discarded"
    EXPIRED = "expired"


class HistoryImportDecision(str, enum.Enum):
    """What one row of an import becomes. Unset until the Historian decides."""

    MATCH = "match"
    MAP = "map"
    CREATE = "create"
    SKIP = "skip"
    SAME_AS = "same_as"


class MediaKind(str, enum.Enum):
    PHOTO = "photo"
    AUDIO = "audio"
    VIDEO = "video"


class MediaFileRole(str, enum.Enum):
    """One stored file of a media item.

    The original is kept exactly as received and only the archive's keepers
    download it; everyone else sees the viewing copy, which has its location
    and camera data stripped (owner decision, 2026-11-13).
    """

    ORIGINAL = "original"
    DISPLAY = "display"
    THUMBNAIL = "thumbnail"


class AlbumLevel(str, enum.Enum):
    """Albums are draft or shown to members; public album pages arrive with
    the public feed."""

    DRAFT = "draft"
    MEMBERS = "members"


class HistoryTitleAction(str, enum.Enum):
    """What an import does with a title it does not recognize."""

    MAP = "map"
    CREATE = "create"
    DROP = "drop"


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
    # Which import created the record, and the revision it had when created.
    # "Remove this import's records" deletes a record only while its revision
    # is still that one: any later edit, a later import's match included, means
    # someone has worked on it and it is no longer the import's to take back.
    import_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("history_imports.id", ondelete="SET NULL"), nullable=True
    )
    import_revision_number: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
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
        Index("ix_historical_members_import", "import_id"),
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
    # Periods are replaced as a set on every save, so this is when the current
    # set was written; the change history holds what came before.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

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
        Index("ix_hist_relations_org_member", "organization_id", "member_id"),
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


# --- Import ---


class HistoryImport(Base):
    """One uploaded roster file, from draft through commit.

    The record outlives its rows: after a commit it is the audit of what was
    imported and the anchor "Remove this import's records" works from. The rows,
    which hold the file's personal data, are deleted on commit, on discard and
    when an untouched draft expires.
    """

    __tablename__ = "history_imports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[HistoryImportStatus] = mapped_column(
        _enum(HistoryImportStatus),
        nullable=False,
        default=HistoryImportStatus.DRAFT,
    )
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    headers: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    #: {field: header} as detected from the file's header row.
    column_mapping: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Counts written at commit: {"created", "mapped", "matched", "skipped", ...}.
    summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    committed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    committed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
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
        Index("ix_history_imports_org_status", "organization_id", "status"),
        Index("ix_history_imports_status_expires", "status", "expires_at"),
    )


class HistoryImportRow(Base):
    """One line of an uploaded file, with the Historian's decision about it.

    The cells and edits are encrypted: a roster file carries birth dates and
    notes about people who may still be living. No ``organization_id``: reached
    only through its import, which is.
    """

    __tablename__ = "history_import_rows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    import_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("history_imports.id", ondelete="CASCADE"), nullable=False
    )
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    #: {field: text} as read from the file.
    cells: Mapped[dict[str, str]] = mapped_column(EncryptedJSON, nullable=False)
    #: {field: text} the Historian corrected on the review screen.
    edits: Mapped[Optional[dict[str, str]]] = mapped_column(
        EncryptedJSON, nullable=True
    )
    #: [{"kind": "match"|"map", "id", "strength"}]: ids only, no names.
    suggestions: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    decision: Mapped[Optional[HistoryImportDecision]] = mapped_column(
        _enum(HistoryImportDecision), nullable=True
    )
    target_member_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("historical_members.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_row_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("history_import_rows.id", ondelete="SET NULL"),
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

    __table_args__ = (
        Index("ix_history_import_rows_import", "import_id", "line_number"),
    )


class HistoryImportTitleMapping(Base):
    """A department's remembered answer for one title text an import met.

    Keyed on the same casefolded form the title list uses, so "asst. chief" in
    next year's file finds the answer given for "Asst. Chief" this year.
    """

    __tablename__ = "history_import_title_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    source_key: Mapped[str] = mapped_column(String(150), nullable=False)
    source_text: Mapped[str] = mapped_column(String(150), nullable=False)
    action: Mapped[HistoryTitleAction] = mapped_column(
        _enum(HistoryTitleAction), nullable=False
    )
    title_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("history_titles.id", ondelete="SET NULL"), nullable=True
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

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "source_key", name="uq_history_import_title_key"
        ),
    )


# --- Merge ---


class HistoryRecordRedirect(Base):
    """Where a merged-away record's address now leads.

    By ``record_type`` and id rather than a foreign key, like revisions, so the
    same table serves every kind of archive record. Never chained: a later
    merge of the surviving record re-points every redirect that led to it.
    """

    __tablename__ = "history_record_redirects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    record_type: Mapped[str] = mapped_column(String(30), nullable=False)
    old_id: Mapped[str] = mapped_column(String(36), nullable=False)
    new_id: Mapped[str] = mapped_column(String(36), nullable=False)
    merged_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "record_type", "old_id", name="uq_history_redirect_old"
        ),
        Index("ix_history_redirects_new", "organization_id", "record_type", "new_id"),
    )


# --- Sources ---


class HistorySource(Base):
    """One entry in a department's managed list of sources and donors.

    Managed like the title list (owner decision): records point at the entry,
    an entry in use is retired or merged, never deleted.
    """

    __tablename__ = "history_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    name_key: Mapped[str] = mapped_column(String(150), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
        UniqueConstraint("organization_id", "name_key", name="uq_history_source_key"),
    )


# --- Photos and media ---


class HistoryMedia(Base):
    """A photo, audio recording or video in the archive, with its catalogue.

    Published like a person record: draft, members or public, the clearance
    list standing between it and the public, and a change history under
    ``record_type = "media"``.
    """

    __tablename__ = "history_media"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[MediaKind] = mapped_column(_enum(MediaKind), nullable=False)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    taken_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    taken_date_precision: Mapped[DatePrecision] = mapped_column(
        _enum(DatePrecision), nullable=False, default=DatePrecision.YEAR
    )
    taken_date_circa: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    place: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    creator: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("history_sources.id", ondelete="SET NULL"), nullable=True
    )
    rights_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    accession_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    original_location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    research_notes: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)

    #: The uploader's file name, shown to keepers; never a path component.
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    #: Length of an audio or video item in whole seconds, read by ffprobe.
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    #: Groups the files of one batch upload. No foreign key: a batch has no
    #: record of its own.
    batch_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    publication_level: Mapped[PublicationLevel] = mapped_column(
        _enum(PublicationLevel), nullable=False, default=PublicationLevel.DRAFT
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    public_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    public_revision_number: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
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

    source: Mapped[Optional["HistorySource"]] = relationship("HistorySource")
    files: Mapped[list["HistoryMediaFile"]] = relationship(
        "HistoryMediaFile", back_populates="media", cascade="all, delete-orphan"
    )
    tags: Mapped[list["HistoryMediaTag"]] = relationship(
        "HistoryMediaTag", back_populates="media", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_history_media_org_level", "organization_id", "publication_level"),
        Index("ix_history_media_org_kind", "organization_id", "kind"),
        Index("ix_history_media_org_date", "organization_id", "taken_date"),
        Index("ix_history_media_source", "source_id"),
    )


class HistoryMediaFile(Base):
    """One stored file of a media item: its original, viewing copy or
    thumbnail. A row per file, so every stored path sits in one column that
    the storage tools (rescan, relocation, remote migration) can rewrite.

    No ``organization_id``: reached only through its media item, which is.
    """

    __tablename__ = "history_media_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    media_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("history_media.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MediaFileRole] = mapped_column(_enum(MediaFileRole), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    media: Mapped["HistoryMedia"] = relationship("HistoryMedia", back_populates="files")

    __table_args__ = (
        UniqueConstraint("media_id", "role", name="uq_history_media_file_role"),
    )


class HistoryMediaTag(Base):
    """A person shown or heard in a media item."""

    __tablename__ = "history_media_tags"

    media_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("history_media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    member_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_members.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    media: Mapped["HistoryMedia"] = relationship("HistoryMedia", back_populates="tags")
    member: Mapped["HistoricalMember"] = relationship("HistoricalMember")

    __table_args__ = (Index("ix_history_media_tags_member", "member_id"),)


class HistoryAlbum(Base):
    """A named group of media items, in an order the Historian sets."""

    __tablename__ = "history_albums"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_media_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("history_media.id", ondelete="SET NULL"), nullable=True
    )
    level: Mapped[AlbumLevel] = mapped_column(
        _enum(AlbumLevel), nullable=False, default=AlbumLevel.DRAFT
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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

    __table_args__ = (Index("ix_history_albums_org_level", "organization_id", "level"),)


class HistoryAlbumItem(Base):
    """One media item's place in one album."""

    __tablename__ = "history_album_items"

    album_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("history_albums.id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("history_media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_history_album_items_media", "media_id"),)
