"""
Officer Schemas

Pydantic schemas for the department office directory that supplies email
templates with ``{{president_name}}``-style signature variables.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class OfficerCandidate(BaseModel):
    """A member holding one of an office's position slugs."""

    id: str
    name: str


class OfficerVariable(BaseModel):
    """A template variable contributed by the office directory."""

    name: str
    description: str


class OfficerResponse(BaseModel):
    """One resolved department office."""

    office_key: str
    label: str
    category: str
    default_title: str
    position_slugs: List[str] = []
    user_id: Optional[str] = None
    name: str = ""
    title: str = ""
    email: str = ""
    phone: str = ""
    # "assigned" (pinned by an admin), "auto" (inferred from the member's
    # position), or "unset" (nobody holds this office yet).
    source: str
    # Raw admin overrides, echoed back so the edit form can round-trip them.
    override_name: Optional[str] = None
    override_title: Optional[str] = None
    override_email: Optional[str] = None
    override_phone: Optional[str] = None
    auto_candidates: List[OfficerCandidate] = []


class OfficerDirectoryResponse(BaseModel):
    """The full office list plus the variables it exposes to templates."""

    offices: List[OfficerResponse]
    variables: List[OfficerVariable]


class OfficerUpdate(BaseModel):
    """Request schema for assigning an office.

    Every field is optional: an office may be filled by linking a member
    (``user_id``), by typing a name outright (``display_name``), or both —
    linking a member and overriding just the signature title, for example.
    """

    user_id: Optional[str] = None
    display_name: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, max_length=150)
    email: Optional[str] = Field(None, max_length=320)
    phone: Optional[str] = Field(None, max_length=50)
