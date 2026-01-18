"""
Election Pydantic Schemas

Request and response schemas for election-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict
from datetime import datetime
from uuid import UUID


# Election Schemas

class ElectionBase(BaseModel):
    """Base election schema"""
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: str = Field(default="general", max_length=50)
    positions: Optional[List[str]] = Field(default=None, description="List of positions to vote for")
    start_date: datetime
    end_date: datetime
    anonymous_voting: bool = Field(default=True)
    allow_write_ins: bool = Field(default=False)
    max_votes_per_position: int = Field(default=1, ge=1)
    results_visible_immediately: bool = Field(default=False)
    eligible_voters: Optional[List[UUID]] = Field(default=None, description="List of user IDs eligible to vote, null means all members")


class ElectionCreate(ElectionBase):
    """Schema for creating a new election"""
    pass


class ElectionUpdate(BaseModel):
    """Schema for updating an election"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: Optional[str] = Field(None, max_length=50)
    positions: Optional[List[str]] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: Optional[str] = None
    anonymous_voting: Optional[bool] = None
    allow_write_ins: Optional[bool] = None
    max_votes_per_position: Optional[int] = Field(None, ge=1)
    results_visible_immediately: Optional[bool] = None
    eligible_voters: Optional[List[UUID]] = None


class ElectionResponse(ElectionBase):
    """Schema for election response"""
    id: UUID
    organization_id: UUID
    status: str
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    # Include vote counts if results are visible
    total_votes: Optional[int] = None
    total_voters: Optional[int] = None
    voter_turnout_percentage: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class ElectionListResponse(BaseModel):
    """Schema for election list item"""
    id: UUID
    title: str
    election_type: str
    start_date: datetime
    end_date: datetime
    status: str
    positions: Optional[List[str]] = None
    total_votes: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# Candidate Schemas

class CandidateBase(BaseModel):
    """Base candidate schema"""
    name: str = Field(..., min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = Field(None, description="Candidate's statement or platform")
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = Field(default=0, description="Order to display candidate in list")


class CandidateCreate(CandidateBase):
    """Schema for creating/nominating a candidate"""
    election_id: UUID
    user_id: Optional[UUID] = Field(None, description="User ID if candidate is a member")
    is_write_in: bool = Field(default=False)


class CandidateUpdate(BaseModel):
    """Schema for updating a candidate"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    accepted: Optional[bool] = None
    display_order: Optional[int] = None


class CandidateResponse(CandidateBase):
    """Schema for candidate response"""
    id: UUID
    election_id: UUID
    user_id: Optional[UUID] = None
    nomination_date: datetime
    nominated_by: Optional[UUID] = None
    accepted: bool
    is_write_in: bool
    created_at: datetime
    updated_at: datetime

    # Include vote count if results are visible
    vote_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class CandidateAcceptance(BaseModel):
    """Schema for accepting/declining a nomination"""
    accepted: bool


# Vote Schemas

class VoteCreate(BaseModel):
    """Schema for casting a vote"""
    election_id: UUID
    candidate_id: UUID
    position: Optional[str] = Field(None, max_length=100)


class VoteResponse(BaseModel):
    """Schema for vote response (limited info for privacy)"""
    id: UUID
    election_id: UUID
    candidate_id: UUID
    position: Optional[str] = None
    voted_at: datetime

    # Only include voter_id if voting is not anonymous
    voter_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Election Results and Statistics

class CandidateResult(BaseModel):
    """Results for a single candidate"""
    candidate_id: UUID
    candidate_name: str
    position: Optional[str] = None
    vote_count: int
    percentage: float
    is_winner: bool


class PositionResults(BaseModel):
    """Results for a specific position"""
    position: str
    total_votes: int
    candidates: List[CandidateResult]


class ElectionResults(BaseModel):
    """Complete election results"""
    election_id: UUID
    election_title: str
    status: str
    total_votes: int
    total_eligible_voters: int
    voter_turnout_percentage: float
    results_by_position: List[PositionResults]
    overall_results: List[CandidateResult]


class ElectionStats(BaseModel):
    """Election statistics"""
    election_id: UUID
    total_candidates: int
    total_votes_cast: int
    total_eligible_voters: int
    total_voters: int  # Unique voters
    voter_turnout_percentage: float
    votes_by_position: Dict[str, int]
    voting_timeline: Optional[List[Dict[str, any]]] = Field(
        None,
        description="Votes over time for charts"
    )


class VoterEligibility(BaseModel):
    """Check if current user is eligible to vote"""
    is_eligible: bool
    has_voted: bool
    positions_voted: List[str]
    positions_remaining: List[str]
    reason: Optional[str] = Field(None, description="Reason if not eligible")


class BulkVoteCreate(BaseModel):
    """Schema for casting multiple votes at once (for multi-position elections)"""
    election_id: UUID
    votes: List[Dict[str, UUID]] = Field(
        ...,
        description="List of {position: candidate_id} mappings"
    )
