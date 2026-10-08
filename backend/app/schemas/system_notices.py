"""Platform-wide conditions an administrator must be told about."""

from typing import Literal

from pydantic import BaseModel


class SystemNotice(BaseModel):
    #: Stable identifier, so the client can key and test for a notice.
    key: str
    severity: Literal["warning", "critical"]
    title: str
    detail: str
