"""
Shift History Import

A department moving onto the platform brings years of shifts with it, usually
as a spreadsheet exported from whatever it used before: one row per member per
shift. The import turns those rows into the records every hours and compliance
reader already consumes — a finalized ``Shift`` with ``ShiftAttendance`` per
member, or ``ExternalShiftHours`` for time on another agency's unit.

Nothing is written to those tables until the admin commits. Until then the
upload lives here as a draft: the raw cells exactly as read, the admin's
per-row corrections, and the decisions taken while reviewing (who a name is,
which unit a vehicle name means, whether two rows are the same shift). A draft
can take days of cleaning, so it is stored rather than held in the browser.

A committed import is final. Its shifts are ordinary shifts afterwards and are
corrected one at a time like any other; there is deliberately no batch undo.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
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


class ShiftHistoryImportStatus(str, Enum):
    DRAFT = "draft"
    COMMITTED = "committed"


class ShiftHistoryImport(Base):
    """One uploaded file and the review state around it."""

    __tablename__ = "shift_history_imports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ShiftHistoryImportStatus.DRAFT.value,
        server_default=ShiftHistoryImportStatus.DRAFT.value,
    )
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # IANA zone the file's wall-clock times are read in. Chosen at upload
    # (defaulting to the department's) and shown on every review screen,
    # because a file exported from a system set to another zone produces
    # hours that look wrong only to the person who knows what they should be.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)

    # The file's header row, and which header feeds which import field
    # (``{"start_time": "Time In", ...}``). Detected at upload, correctable.
    headers: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    column_mapping: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Review decisions, keyed by the source value they resolve so one decision
    # covers every row that carries it. Shapes are validated by the service on
    # write; readers still treat them defensively (pitfall #19).
    member_mappings: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    unit_mappings: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    position_mappings: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    # Answers to "is this the shift already on the schedule?" for probable
    # matches, keyed by the proposed shift's key.
    existing_shift_decisions: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Counts of what the commit wrote; NULL while a draft.
    summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

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
        Index("ix_shift_history_imports_org_status", "organization_id", "status"),
        CheckConstraint(
            "status IN ('draft', 'committed')",
            name="ck_shift_history_imports_status",
        ),
    )


class ShiftHistoryImportRow(Base):
    """One data row of the file, kept as read plus the reviewer's edits.

    Tenant-scoped only through its import: it has no tenant column of its own,
    so every lookup by id must constrain ``import_id`` to an import already
    resolved in the caller's organization (pitfall #14, the parent-resolution
    shape).
    """

    __tablename__ = "shift_history_import_rows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    import_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("shift_history_imports.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The spreadsheet line, counting the header as line 1, so an admin can
    # find the row in the file they uploaded.
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # ``{header: cell}`` exactly as read. Never rewritten, so changing the
    # column mapping re-reads the original cells rather than earlier output.
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # ``{field: value}`` corrections typed during review; they take precedence
    # over the mapped cell.
    edits: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    excluded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Reviewer's answer when this row's attendance scored as a *probable*
    # match for a shift proposed from other rows: "accept" joins it,
    # "separate" keeps it a shift of its own.
    match_decision: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Reviewer split this row off the entry before it. Back-to-back entries
    # for one member on one unit are joined automatically (a previous system
    # that could not count past midnight logged one stretch as two rows); set,
    # this row starts an attendance of its own instead.
    keep_separate: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
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
        Index("ix_shift_history_import_rows_import_line", "import_id", "line_number"),
        CheckConstraint(
            "match_decision IS NULL OR match_decision IN ('accept', 'separate')",
            name="ck_shift_history_import_rows_match_decision",
        ),
    )


class ShiftHistoryImportMappingKind(str, Enum):
    MEMBER = "member"
    UNIT = "unit"
    POSITION = "position"


class ShiftHistoryImportMapping(Base):
    """A review decision the department has committed, remembered for later
    files.

    A department brings its history in over several files, usually exported
    from the same system, so the same names, vehicles and positions recur. A
    decision is remembered only once an import using it is committed — a
    discarded draft teaches nothing — and a draft's own decision always wins
    over a remembered one.

    A member or outside unit the commit *created* is remembered as a mapping
    to the record it created, never as "create", so the next file cannot
    create the same person or unit a second time.
    """

    __tablename__ = "shift_history_import_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # The source value as the import keys it (``number:77``, ``|a106``,
    # ``nozzle``). Bounded by the request schema's key limit.
    source_key: Mapped[str] = mapped_column(String(600), nullable=False)
    mapping: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
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
            "organization_id",
            "kind",
            "source_key",
            name="uq_shift_history_import_mappings_org_kind_key",
        ),
        CheckConstraint(
            "kind IN ('member', 'unit', 'position')",
            name="ck_shift_history_import_mappings_kind",
        ),
    )
