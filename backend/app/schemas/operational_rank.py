"""
Operational Rank Pydantic Schemas

Request and response schemas for the operational-ranks endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


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


class RankUpdate(BaseModel):
    """Schema for updating an operational rank."""

    rank_code: Optional[str] = Field(None, min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class RankResponse(BaseModel):
    """Full rank response."""

    id: UUID
    organization_id: UUID
    rank_code: str
    display_name: str
    description: Optional[str] = None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RankListResponse(BaseModel):
    """List wrapper for rank responses."""

    ranks: List[RankResponse]
    total: int


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
