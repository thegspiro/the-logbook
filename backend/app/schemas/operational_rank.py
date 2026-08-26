"""
Operational Rank Pydantic Schemas

Request and response schemas for the operational-ranks endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.permissions import get_rank_default_permissions
from app.schemas.base import UTCResponseBase


class RankCreate(BaseModel):
    """Schema for creating a new operational rank."""

    rank_code: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Machine-friendly code (e.g. 'captain')",
    )
    display_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Human-readable label (e.g. 'Captain')",
    )
    description: Optional[str] = Field(
        None, description="Optional description of this rank"
    )
    sort_order: int = Field(
        default=0, description="Display ordering (lower = higher rank)"
    )
    is_active: bool = Field(default=True)
    eligible_positions: Optional[List[str]] = Field(
        default=None,
        description="Shift positions this rank is eligible to sign up for",
    )


class RankUpdate(BaseModel):
    """Schema for updating an operational rank."""

    rank_code: Optional[str] = Field(None, min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    eligible_positions: Optional[List[str]] = None


class RankResponse(UTCResponseBase):
    """Full rank response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    rank_code: str
    display_name: str
    description: Optional[str] = None
    sort_order: int
    is_active: bool
    eligible_positions: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def default_permission_count(self) -> int:
        """How many permissions this rank confers on its own, or 0.

        Rank defaults resolve from a code-level registry keyed by
        ``rank_code``, not from this row, so a rank a department invents for
        itself — Battalion Chief, Firefighter II — confers nothing. That is
        the documented design (positions are the primary source of
        permissions), but it was invisible: the editor rendered a custom rank
        identically to a seeded one. Reported so the screen can say which is
        which rather than leaving an admin to discover it from a member who
        cannot see anything.
        """
        return len(get_rank_default_permissions(self.rank_code))


class RankReorderItem(BaseModel):
    """Single item in a reorder request."""

    id: UUID
    sort_order: int


class RankReorderRequest(BaseModel):
    """Batch-reorder ranks."""

    ranks: List[RankReorderItem] = Field(..., min_length=1)


class RankValidationIssue(BaseModel):
    """A single rank-validation issue (member with unrecognised rank)."""

    member_id: str
    member_name: str
    rank_code: str


class RankValidationResponse(BaseModel):
    """Result of rank validation across active members."""

    issues: List[RankValidationIssue]
    total: int
