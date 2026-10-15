"""
Google Workspace account provisioning schemas.

snake_case on the wire, like the integrations module this belongs to.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import ConfigDict, Field

from app.schemas.base import UTCResponseBase


class GoogleAccountResponse(UTCResponseBase):
    """One member's Google Workspace account, as The Logbook last saw it."""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    primary_email: str
    status: str
    credentials_sent: bool = False
    pending_groups: List[str] = Field(default_factory=list)
    last_error: Optional[str] = None
    attempts: int = 0
    last_attempt_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class GoogleAccountEnvelope(UTCResponseBase):
    """``account`` is null for a member The Logbook made no account for."""

    account: Optional[GoogleAccountResponse] = None
