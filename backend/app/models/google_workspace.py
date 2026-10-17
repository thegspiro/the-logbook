"""
Google Workspace account provisioning records.

One row per member The Logbook tried to give a Google Workspace account when
they were converted from an applicant. The row is written in the same
transaction as the member, before Google is called, so a crash between the
commit and the Directory API call leaves a ``pending`` record an officer can
retry rather than no trace at all.

The temporary Google password is never stored here: it lives only in memory
for the one call that creates (or resets) the account and the one email that
delivers it. A retry generates a new one.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

GOOGLE_WORKSPACE_INTEGRATION = "google-workspace"


class GoogleAccountStatus(str, Enum):
    PENDING = "pending"
    CREATED = "created"
    # The address already belonged to a Google account (a returning member, an
    # alias, a group). The Logbook records the link and changes nothing about
    # the account except suspending it when the member leaves.
    LINKED_EXISTING = "linked_existing"
    FAILED = "failed"


class GoogleAccountProvision(Base):
    """A member's Google Workspace account, as The Logbook created or found it"""

    __tablename__ = "google_account_provisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    primary_email: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=GoogleAccountStatus.PENDING.value
    )
    google_user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Whether the member has been sent the temporary Google password. False on
    # a created account means nobody knows its password yet, which is the one
    # case where a retry may reset it.
    credentials_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Group addresses the member still has to be added to.
    pending_groups: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    # Sanitized before it is written: no raw provider response.
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Suspension follows the member: dropped or deleted wants it suspended, a
    # return wants it back. ``suspension_settled`` is False until Google has
    # been brought to ``suspension_wanted``; a failure leaves it False for a
    # retry. ``suspended_by_logbook`` records that the suspension is ours, and
    # only ours is ever lifted: an account someone had already suspended in
    # Google stays suspended when the member returns.
    suspension_wanted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    suspension_settled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    suspended_by_logbook: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    suspended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    suspension_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # When the departure or return was recorded: how long an account has
    # been waiting, which ``updated_at`` cannot say -- every retry moves it.
    suspension_requested_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_google_account_provisions_user", "user_id", unique=True),
        Index("ix_google_account_provisions_org", "organization_id"),
    )
