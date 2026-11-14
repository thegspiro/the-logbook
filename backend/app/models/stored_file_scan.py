"""
Stored File Scan Model

The ledger of the malware scan over files and images that were stored before
upload scanning covered them (``app.services.stored_file_rescan``).
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ScanVerdict(str, Enum):
    CLEAN = "clean"
    INFECTED = "infected"
    #: The row names a file that is not in storage: nothing was scanned, and
    #: nothing is there to serve.
    MISSING = "missing"
    #: A database-held value that does not decode to file bytes.
    UNREADABLE = "unreadable"


class StoredFileScan(Base):
    """One stored object the rescan has reached, and what clamd said.

    ``scan_key`` is the idempotency key: SHA-256 of ``file:<reference>`` for a
    file on the volume or in a department's store (so a file several rows
    share is scanned once), and of ``db:<table.column>:<row id>:<SHA-256 of
    the stored value>`` for an image held in the database (so a replaced
    photo is a new object and is scanned again). A key that is present is
    never scanned again; a scan that got no verdict writes no row, so the
    object is picked up by the next run.
    """

    __tablename__ = "stored_file_scans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    scan_key: Mapped[str] = mapped_column(String(64), nullable=False)
    #: ``<table>.<column>`` the object was found through.
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The first row found holding it; the audit record names the same row.
    row_id: Mapped[str] = mapped_column(String(36), nullable=False)
    #: The confined storage reference of a file; null for a database value.
    reference: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    #: SHA-256 of a database-held value as scanned, so removal clears it only
    #: if nobody has replaced it since.
    fingerprint: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    verdict: Mapped[str] = mapped_column(String(20), nullable=False)
    signature: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    #: Set once an infected object is gone. An infected row without it is a
    #: removal a crash interrupted; the next run finishes it.
    removed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: When the verdict was recorded — the scan itself.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("scan_key", name="uq_stored_file_scans_scan_key"),
        Index("idx_stored_file_scans_org", "organization_id"),
        Index("idx_stored_file_scans_pending_removal", "verdict", "removed_at"),
    )

    def __repr__(self):
        return f"<StoredFileScan(source={self.source}, verdict={self.verdict})>"
