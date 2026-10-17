"""
Directory account provisioning schemas (Google Workspace, Microsoft 365).

The class names, the module and the ``not_in_google`` count predate Microsoft
365 support and are kept: they are the wire contract the screens read.
snake_case on the wire, like the integrations module this belongs to.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import ConfigDict, Field

from app.schemas.base import UTCResponseBase


class GoogleAccountResponse(UTCResponseBase):
    """One member's directory account, as The Logbook last saw it."""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    # "google" or "microsoft", and the product's name for the screen.
    provider: str = "google"
    provider_name: str = "Google Workspace"
    primary_email: str
    status: str
    credentials_sent: bool = False
    pending_groups: List[str] = Field(default_factory=list)
    # Microsoft 365: the license is not assigned yet (no mailbox), and the
    # account is synced from on-premises Active Directory.
    license_pending: bool = False
    managed_on_premises: bool = False
    last_error: Optional[str] = None
    attempts: int = 0
    last_attempt_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    # Whether the member's departure wants the account suspended, whether
    # the directory has been brought into line, and whether the suspension in place
    # is The Logbook's own (only that one is lifted on a return).
    suspension_wanted: bool = False
    suspension_settled: bool = True
    suspended_by_logbook: bool = False
    suspended_at: Optional[datetime] = None
    suspension_error: Optional[str] = None


class GoogleAccountEnvelope(UTCResponseBase):
    """``account`` is null for a member The Logbook made no account for."""

    account: Optional[GoogleAccountResponse] = None


class LinkExistingResponse(UTCResponseBase):
    """What linking the existing roster did (or, previewed, would do)."""

    applied: bool
    linked: int
    already_linked: int
    unfinished: int
    departed: int
    not_in_google: int
    off_domain: int
    account_in_use: int


class AttentionItemResponse(UTCResponseBase):
    """One member's account that needs a person to act."""

    user_id: str
    member_name: str
    primary_email: str
    # not_suspended / not_unsuspended / not_created / setup_unfinished
    issue: str
    # How the screen and the email word the issue.
    label: str
    detail: Optional[str] = None
    since: Optional[datetime] = None
    # Waiting long enough that the daily alert reports it.
    overdue: bool


class AttentionResponse(UTCResponseBase):
    items: List[AttentionItemResponse]
    # The connected directory's name, for the heading; null when none is.
    provider_name: Optional[str] = None
