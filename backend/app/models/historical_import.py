"""
Historical Data Import

A department moving onto the platform brings years of activity with it, usually
as one export from whatever it used before, holding every kind of hour a member
logged in a single file: shifts on a unit, time on call from home, training,
administrative work. This module stores such a file while it is mapped and
sorted, before any of it is written anywhere.

The import does not write records itself. It reads the file once, settles which
column means what, routes each row to the kind of record it describes, and
hands each kind to the import built for it — shifts and on-call time go to the
shift history import as review batches (``ShiftHistoryImport`` rows carrying
``historical_import_id``). Each of those is reviewed and committed on its own.

``ImportedSourceRecord`` is the ledger that makes the whole thing safe to run
twice. Every record a historical import writes is entered against the source
system's own row id, under a unique key, so a second run of the same file — or a
restarted one — finds the row already accounted for instead of writing it again
(pitfall #36).
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import (
    JSON,
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


class HistoricalImportStatus(str, Enum):
    # Columns and routing may still change.
    DRAFT = "draft"
    # Shift review batches exist; what they were built from is fixed.
    ROUTED = "routed"


class HistoricalRecordType(str, Enum):
    """What a row's hours become. Stored in ``hour_columns`` and the ledger."""

    SHIFT = "shift"
    ON_CALL = "on_call"
    TRAINING = "training"
    ADMIN = "admin"
    IGNORE = "ignore"


class ImportedRecordKind(str, Enum):
    """The table a ledger entry's ``record_id`` points into."""

    SHIFT_ATTENDANCE = "shift_attendance"
    EXTERNAL_SHIFT_HOURS = "external_shift_hours"


class HistoricalImport(Base):
    """One uploaded export and the decisions about how to read it."""

    __tablename__ = "historical_imports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=HistoricalImportStatus.DRAFT.value,
        server_default=HistoricalImportStatus.DRAFT.value,
    )
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # The name of the system the file came from. It namespaces the ledger: the
    # same row id in two different systems is two different rows, and the same
    # id in two exports of one system is one. A department re-importing a file
    # must therefore give the same name, which the screen pre-fills.
    source_system: Mapped[str] = mapped_column(String(100), nullable=False)

    # IANA zone the file's wall-clock times are in. Passed to every batch.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)

    headers: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    # ``{field: header}`` for the shared fields (member, date, times, unit...).
    column_mapping: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # ``{header: HistoricalRecordType value}``: each column holding hours, and
    # what a nonzero value in it makes the row.
    hour_columns: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # ``{header: call type slug}``: columns counting calls, by the
    # department's configured call types.
    call_columns: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # How the rows route under the current settings (counts, examples of each
    # problem and clean-up). Recomputed whenever the settings change, so the
    # screen does not re-read every row of a large file on each visit.
    summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    routed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    routed_at: Mapped[Optional[datetime]] = mapped_column(
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
        Index("ix_historical_imports_org_status", "organization_id", "status"),
        CheckConstraint(
            "status IN ('draft', 'routed')",
            name="ck_historical_imports_status",
        ),
    )


class HistoricalImportRow(Base):
    """One data row of the file, exactly as read.

    Tenant-scoped only through its import (no tenant column of its own), so a
    lookup must constrain ``import_id`` to an import already resolved in the
    caller's organization (pitfall #14, the parent-resolution shape).
    """

    __tablename__ = "historical_import_rows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    import_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("historical_imports.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The spreadsheet line, counting the header as line 1.
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # ``{header: cell}`` as read. Never rewritten, so a changed mapping
    # re-reads the original cells.
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    __table_args__ = (
        Index("ix_historical_import_rows_import_line", "import_id", "line_number"),
    )


class ImportedSourceRecord(Base):
    """A source row that an import has turned into a record.

    The unique key is what makes a re-run a no-op: the row is looked up before
    it is written, and two commits racing past that lookup collide here rather
    than both writing. Several source rows may name one record — a member's
    back-to-back entries joined into one attendance — so ``record_id`` is not
    unique.
    """

    __tablename__ = "imported_source_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    source_system: Mapped[str] = mapped_column(String(100), nullable=False)
    source_id: Mapped[str] = mapped_column(String(100), nullable=False)
    record_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    # No foreign key: it points into whichever table ``record_kind`` names.
    record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    historical_import_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("historical_imports.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "source_system",
            "source_id",
            name="uq_imported_source_records_org_system_id",
        ),
        Index("ix_imported_source_records_record", "record_kind", "record_id"),
    )
