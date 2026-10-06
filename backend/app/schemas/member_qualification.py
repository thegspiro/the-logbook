"""Schemas for qualifications entered directly on a member's record.

snake_case on the wire, matching the member-service schemas beside it.
"""

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class MemberQualificationUpsert(BaseModel):
    """Record or correct one qualification. Every field is sent on every save:
    a blank date is an explicit null (no bound at that end), not "unchanged"."""

    granted_on: Optional[date] = None
    expires_on: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator("notes")
    @classmethod
    def _blank_notes(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return v.strip() or None

    @model_validator(mode="after")
    def _check_window(self) -> "MemberQualificationUpsert":
        if self.granted_on and self.expires_on and self.expires_on < self.granted_on:
            raise ValueError("expires_on cannot be before granted_on")
        return self


class MemberQualificationResponse(BaseModel):
    id: str
    user_id: str
    qualification_code: str
    label: str
    positions: List[str]
    granted_on: Optional[date] = None
    expires_on: Optional[date] = None
    notes: Optional[str] = None
    source: Literal["manual", "training_record"]
    in_force: bool


class QualificationImportRow(BaseModel):
    row: int
    user_id: str
    member_name: str
    qualification_code: str
    label: str
    granted_on: Optional[date] = None
    expires_on: Optional[date] = None
    action: Literal["create", "update"]


class QualificationImportError(BaseModel):
    row: int
    message: str


class MemberQualificationImportResponse(BaseModel):
    dry_run: bool
    total_rows: int
    valid_rows: int
    imported: int
    rows: List[QualificationImportRow]
    errors: List[QualificationImportError]
