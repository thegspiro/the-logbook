"""
Pending File Deletion Model

The durable queue of stored files a committed delete still has to remove
(``app.services.pending_file_deletions``).
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class PendingDeletionReason(str, Enum):
    MEMBER_HARD_DELETE = "member_hard_delete"
    # A file anonymisation could not delete after dropping the row that named
    # it (a waiver or applicant document).
    MEMBER_ANONYMIZATION = "member_anonymization"


class PendingFileDeletion(Base):
    """One stored file a committed delete has yet to remove.

    Written in the same transaction as the delete whose rows named the file,
    so a refused or rolled-back delete leaves no row; resolved (deleted) once
    the file is gone or another row is found still naming it. A row left
    behind is a removal a crash or an unreachable store interrupted, and the
    hourly sweep finishes it.

    The idempotency key is the row id: resolving a row is a
    ``DELETE ... WHERE id`` whose affected count says whether this run or an
    earlier one did it, and deleting a file that is already gone counts as
    deleted. There is deliberately no unique key on the path: two deletes of
    members who share a file each queue it, and a unique key would turn the
    second delete's commit into a misleading conflict. Duplicate rows are
    harmless; the first removes the file and the second finds it gone.

    No member column, and no foreign key to the deleted rows: nothing here
    identifies the person whose files these were.
    """

    __tablename__ = "pending_file_deletions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: The confined real path or remote reference, as ``file_storage.resolve``
    #: returned it when the row was queued. Confined again before deleting.
    path: Mapped[str] = mapped_column(Text, nullable=False)
    #: The ``StorageArea`` value the path was confined to.
    area: Mapped[str] = mapped_column(String(40), nullable=False)
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: A fixed description of why the last attempt failed. Never the path or
    #: an exception's text, which can carry it.
    last_error: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    __table_args__ = (Index("idx_pending_file_deletions_org", "organization_id"),)

    def __repr__(self):
        return f"<PendingFileDeletion(area={self.area}, attempts={self.attempts})>"
