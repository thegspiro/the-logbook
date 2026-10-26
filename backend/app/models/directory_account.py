"""
Directory account provisioning records (Google Workspace, Microsoft 365).

One row per member The Logbook tried to give an account in the department's
directory -- the provider named by ``provider`` -- when they were converted
from an applicant, or linked to an account already at their address. The row
is written in the same transaction as the member, before the provider is
called, so a crash between the commit and the provider's API call leaves a
``pending`` record an officer can retry rather than no trace at all.

The temporary password is never stored here: it lives only in memory for the
one call that creates (or resets) the account and the one email that delivers
it. A retry generates a new one.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid

GOOGLE_WORKSPACE_INTEGRATION = "google-workspace"
MICROSOFT_365_INTEGRATION = "microsoft-365"
DIRECTORY_INTEGRATION_TYPES = (GOOGLE_WORKSPACE_INTEGRATION, MICROSOFT_365_INTEGRATION)
# Integration config key: retiring suspends the member's directory account too.
# Off unless the department turns it on (owner decision, 2026-10-23).
SUSPEND_ON_RETIREMENT_KEY = "suspend_on_retirement"


class DirectoryProvider(str, Enum):
    GOOGLE = "google"
    MICROSOFT = "microsoft"


class DirectoryAccountStatus(str, Enum):
    PENDING = "pending"
    CREATED = "created"
    # The address already belonged to an account (a returning member, an
    # alias, a group). The Logbook records the link and changes nothing about
    # the account except suspending it when the member leaves.
    LINKED_EXISTING = "linked_existing"
    FAILED = "failed"


class DirectoryAccountProvision(Base):
    """A member's directory account, as The Logbook created or found it"""

    __tablename__ = "directory_account_provisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Which directory holds the account. Rows written before this column
    # existed read as Google, which is all they could be; there is no Python
    # default, so that every writer has to say which directory it means.
    provider: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=DirectoryProvider.GOOGLE.value
    )
    primary_email: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DirectoryAccountStatus.PENDING.value
    )
    # The provider's immutable id for the account, once known.
    external_user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Whether the member has been sent the account's temporary password. False on
    # a created account means nobody knows its password yet, which is the one
    # case where a retry may reset it.
    credentials_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Group addresses the member still has to be added to.
    pending_groups: Mapped[Optional[list[Any]]] = mapped_column(JSON, nullable=True)
    # Groups a departed member's account still has to be taken out of: the
    # integration's configured groups when the departure was recorded, less
    # any it has left. The sweep retries what is listed; a return clears it.
    pending_group_removals: Mapped[Optional[list[Any]]] = mapped_column(
        JSON, nullable=True
    )
    # The configured license could not be assigned yet (Microsoft 365, which
    # gives an account no mailbox until it is licensed). A retry assigns it.
    license_pending: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # The account is synced from on-premises Active Directory, so the
    # directory's API cannot suspend it: an administrator disables it there.
    # Set when that is discovered; the scheduled sweep stops retrying it.
    managed_on_premises: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Sanitized before it is written: no raw provider response.
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Suspension follows the member: dropped or deleted wants it suspended, a
    # return wants it back. ``suspension_settled`` is False until the directory has
    # been brought to ``suspension_wanted``; a failure leaves it False for a
    # retry. ``suspended_by_logbook`` records that the suspension is ours, and
    # only ours is ever lifted: an account someone had already suspended in
    # the directory stays suspended when the member returns.
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
    # The member's name changed and the account (one The Logbook created) has
    # not been given it yet. Set with the rename; the sweep retries it.
    name_pending: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # When the daily departure check, listing the directory, first found this
    # departed member's account still there more than 90 days after it was
    # suspended -- still holding its license. Cleared when the account is
    # gone from the directory, or the member returns.
    long_suspended_since: Mapped[Optional[datetime]] = mapped_column(
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
        Index("ix_directory_account_provisions_user", "user_id", unique=True),
        Index("ix_directory_account_provisions_org", "organization_id"),
    )
