"""Platform-wide conditions an administrator must be told about."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class SystemNotice(BaseModel):
    #: Stable identifier, so the client can key and test for a notice.
    key: str
    severity: Literal["warning", "critical"]
    title: str
    detail: str
    #: Something an administrator can do here to clear the notice, when there
    #: is one. Most notices clear only when the server's configuration does.
    action: Optional[Literal["confirm_key_custody"]] = None


class KeyCustodyStatus(BaseModel):
    #: Identifies the key in use without revealing it (an HMAC, not the key).
    key_fingerprint: str
    confirmed: bool
    confirmed_at: Optional[datetime] = None
    confirmed_via: Optional[str] = None


class KeyCustodyConfirm(BaseModel):
    #: The fingerprint the administrator was shown, so a key changed in the
    #: meantime is not confirmed on their behalf.
    key_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{16}$")
