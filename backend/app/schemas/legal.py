"""
Legal Document Pydantic Schemas

Request/response shapes for Governance -> Legal Documents, the screen where the
secretary and department leaders read the published privacy notice and terms and
propose alternative wording for local rules.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.legal import LegalDocumentType, LegalRevisionStatus
from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)

# Requests are camelCase too. The screen sends back the same casing the
# responses arrive in — `documentType`, `changeNote` — and without this the
# request models only bound the snake_case names, so every propose and every
# draft edit came back 422. `populate_by_name` keeps the snake_case names
# working for anything posting to the API directly (tests, scripts).
_REQUEST_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

# Matches the cap the public endpoint applies when serving custom text, so a
# body that would be silently truncated on the way out is rejected on the way
# in instead.
MAX_BODY_CHARS = 100_000


def _require_text(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError(f"{field} cannot be blank")
    return text


class LegalRevisionCreate(BaseModel):
    """A proposed revision to one public legal document."""

    model_config = _REQUEST_CONFIG

    document_type: LegalDocumentType
    body: str = Field(..., max_length=MAX_BODY_CHARS)
    change_note: str = Field(..., max_length=2000)
    effective_date: Optional[str] = Field(None, max_length=64)

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, v: str) -> str:
        return _require_text(v, "Document text")

    @field_validator("change_note")
    @classmethod
    def _note_not_blank(cls, v: str) -> str:
        # Required, not optional: the reason a wording was chosen is the part a
        # later reader (or a records request) actually needs, and it is never
        # reconstructable from the diff.
        return _require_text(v, "Change note")

    @field_validator("effective_date")
    @classmethod
    def _blank_date_is_none(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None


class LegalRevisionUpdate(BaseModel):
    """Edit to a draft. Only drafts are editable; published text is history."""

    model_config = _REQUEST_CONFIG

    body: Optional[str] = Field(None, max_length=MAX_BODY_CHARS)
    change_note: Optional[str] = Field(None, max_length=2000)
    effective_date: Optional[str] = Field(None, max_length=64)

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, v: Optional[str]) -> Optional[str]:
        return _require_text(v, "Document text") if v is not None else None

    @field_validator("change_note")
    @classmethod
    def _note_not_blank(cls, v: Optional[str]) -> Optional[str]:
        return _require_text(v, "Change note") if v is not None else None

    @field_validator("effective_date")
    @classmethod
    def _blank_date_clears(cls, v: Optional[str]) -> Optional[str]:
        # Blank means "clear it", not "store an empty string": the key is
        # present, so apply_updates writes the None through as a clear.
        return (v.strip() or None) if v else None


class LegalRevisionResponse(UTCResponseBase):
    """One revision, with the display name of who proposed and published it."""

    model_config = _RESPONSE_CONFIG

    id: str
    document_type: LegalDocumentType
    status: LegalRevisionStatus
    body: str
    change_note: str
    effective_date: Optional[str] = None
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    published_by: Optional[str] = None
    published_by_name: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LegalDocumentState(UTCResponseBase):
    """What members currently see for one document, and its proposals."""

    model_config = _RESPONSE_CONFIG

    document_type: LegalDocumentType
    public_path: str
    # True when no custom text is published and the page renders the platform
    # default. The screen has to say which of the two a reader is looking at:
    # "no revisions" and "the built-in notice is live" mean the same thing on
    # this screen and very different things to a member.
    using_platform_default: bool
    published_body: Optional[str] = None
    published_effective_date: Optional[str] = None
    published_at: Optional[datetime] = None
    published_by_name: Optional[str] = None
    drafts: list[LegalRevisionResponse] = []
    history: list[LegalRevisionResponse] = []


class LegalDocumentsOverview(BaseModel):
    """Both public documents plus what the caller is allowed to do with them."""

    model_config = _RESPONSE_CONFIG

    organization_name: Optional[str] = None
    can_publish: bool
    documents: list[LegalDocumentState]
