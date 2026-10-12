"""
Security Alert Schemas

Request bodies for the security-alert acknowledge/resolve workflow. Responses
from ``/security/*`` are plain snake_case dicts, matching the rest of that
router.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SecurityAlertResolveRequest(BaseModel):
    """Optional note recording what the officer found when resolving."""

    model_config = ConfigDict(extra="forbid")

    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def _blank_is_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None
