"""
Election Pydantic Schemas

Request and response schemas for election-related endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

VALID_VOTING_METHODS = {"simple_majority", "ranked_choice", "approval", "supermajority"}
VALID_VICTORY_CONDITIONS = {"most_votes", "majority", "supermajority", "threshold"}
VALID_RUNOFF_TYPES = {"top_two", "eliminate_lowest"}


# Ballot Item Schemas


class BallotItem(BaseModel):
    """Schema for a ballot item with voter eligibility rules"""

    id: str = Field(..., description="Unique identifier for this ballot item")
    type: str = Field(
        ..., description="Type: membership_approval, officer_election, general_vote"
    )
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    position: Optional[str] = Field(
        None, description="Position name for officer elections"
    )
    eligible_voter_types: List[str] = Field(
        default=["all"],
        description="Member class or role slug: 'all', 'regular', 'life', 'probationary', 'operational', 'administrative', or specific role slugs",
    )
    vote_type: str = Field(
        default="approval", description="approval, candidate_selection"
    )
    required_for_approval: Optional[int] = Field(
        None, description="Number of yes votes required"
    )
    require_attendance: bool = Field(
        default=False,
        description="If true, voter must be checked in as present at the meeting",
    )


class PositionEligibility(BaseModel):
    """Schema for position-specific voter eligibility"""

    voter_types: List[str] = Field(
        ..., description="Role slugs that can vote for this position"
    )
    min_votes_required: Optional[int] = Field(
        None, description="Minimum votes needed for approval"
    )


# Election Schemas


class ElectionBase(BaseModel):
    """Base election schema"""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: str = Field(default="general", max_length=50)
    positions: Optional[List[str]] = Field(
        default=None, description="List of positions to vote for"
    )
    ballot_items: Optional[List[BallotItem]] = Field(
        default=None, description="Structured ballot items with per-item eligibility"
    )
    position_eligibility: Optional[Dict[str, PositionEligibility]] = Field(
        default=None, description="Eligibility rules per position"
    )
    meeting_date: Optional[datetime] = Field(
        default=None, description="Meeting date for ballot"
    )
    attendees: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="Meeting attendees checked in for voting"
    )
    start_date: datetime
    end_date: datetime
    anonymous_voting: bool = Field(default=True)
    allow_write_ins: bool = Field(default=False)
    max_votes_per_position: int = Field(default=1, ge=1)
    results_visible_immediately: bool = Field(default=False)
    eligible_voters: Optional[List[UUID]] = Field(
        default=None,
        description="List of user IDs eligible to vote, null means all members",
    )

    # Voting method and victory conditions
    voting_method: str = Field(
        default="simple_majority",
        description="Voting method: simple_majority, ranked_choice, approval, supermajority",
    )
    victory_condition: str = Field(
        default="most_votes",
        description="Victory condition: most_votes, majority, supermajority, threshold",
    )
    victory_threshold: Optional[int] = Field(
        default=None, description="Numerical threshold for victory (e.g., 10 votes)"
    )
    victory_percentage: Optional[int] = Field(
        default=None,
        ge=1,
        le=100,
        description="Percentage threshold for victory (e.g., 60%)",
    )

    # Runoff configuration
    enable_runoffs: bool = Field(
        default=False, description="Automatically create runoff elections if no winner"
    )
    runoff_type: str = Field(
        default="top_two",
        description="Runoff type: top_two (top 2 advance), eliminate_lowest (remove lowest)",
    )
    max_runoff_rounds: int = Field(
        default=3, ge=1, le=10, description="Maximum number of runoff rounds"
    )

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, v: str) -> str:
        if v not in VALID_VOTING_METHODS:
            raise ValueError(
                f"Invalid voting method '{v}'. Must be one of: {', '.join(sorted(VALID_VOTING_METHODS))}"
            )
        return v

    @field_validator("victory_condition")
    @classmethod
    def validate_victory_condition(cls, v: str) -> str:
        if v not in VALID_VICTORY_CONDITIONS:
            raise ValueError(
                f"Invalid victory condition '{v}'. Must be one of: {', '.join(sorted(VALID_VICTORY_CONDITIONS))}"
            )
        return v

    @field_validator("runoff_type")
    @classmethod
    def validate_runoff_type(cls, v: str) -> str:
        if v not in VALID_RUNOFF_TYPES:
            raise ValueError(
                f"Invalid runoff type '{v}'. Must be one of: {', '.join(sorted(VALID_RUNOFF_TYPES))}"
            )
        return v


class ElectionCreate(ElectionBase):
    """Schema for creating a new election"""


class ElectionUpdate(BaseModel):
    """Schema for updating an election

    NOTE: status is intentionally excluded. Use the dedicated
    /open, /close, and /rollback endpoints to change election status.
    This prevents bypassing validation logic (candidate checks, result
    calculation, runoff creation, audit trails).
    """

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: Optional[str] = Field(None, max_length=50)
    positions: Optional[List[str]] = None
    ballot_items: Optional[List[BallotItem]] = None
    position_eligibility: Optional[Dict[str, PositionEligibility]] = None
    meeting_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    anonymous_voting: Optional[bool] = None
    allow_write_ins: Optional[bool] = None
    max_votes_per_position: Optional[int] = Field(None, ge=1)
    results_visible_immediately: Optional[bool] = None
    eligible_voters: Optional[List[UUID]] = None
    voting_method: Optional[str] = None
    victory_condition: Optional[str] = None
    victory_threshold: Optional[int] = None
    victory_percentage: Optional[int] = Field(None, ge=1, le=100)
    enable_runoffs: Optional[bool] = None
    runoff_type: Optional[str] = None
    max_runoff_rounds: Optional[int] = Field(None, ge=1, le=10)

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_VOTING_METHODS:
            raise ValueError(
                f"Invalid voting method '{v}'. Must be one of: {', '.join(sorted(VALID_VOTING_METHODS))}"
            )
        return v

    @field_validator("victory_condition")
    @classmethod
    def validate_victory_condition(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_VICTORY_CONDITIONS:
            raise ValueError(
                f"Invalid victory condition '{v}'. Must be one of: {', '.join(sorted(VALID_VICTORY_CONDITIONS))}"
            )
        return v

    @field_validator("runoff_type")
    @classmethod
    def validate_runoff_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_RUNOFF_TYPES:
            raise ValueError(
                f"Invalid runoff type '{v}'. Must be one of: {', '.join(sorted(VALID_RUNOFF_TYPES))}"
            )
        return v


class ElectionResponse(ElectionBase):
    """Schema for election response"""

    id: UUID
    organization_id: UUID
    status: str
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    # Email tracking
    email_sent: bool = False
    email_sent_at: Optional[datetime] = None
    email_recipients: Optional[List[UUID]] = None

    # Runoff tracking
    is_runoff: bool = False
    parent_election_id: Optional[UUID] = None
    runoff_round: int = 0

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
    statement: Optional[str] = Field(
        None, description="Candidate's statement or platform"
    )
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = Field(
        default=0, description="Order to display candidate in list"
    )


class CandidateCreate(CandidateBase):
    """Schema for creating/nominating a candidate"""

    election_id: UUID
    user_id: Optional[UUID] = Field(
        None, description="User ID if candidate is a member"
    )
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
    vote_rank: Optional[int] = Field(
        None, ge=1, description="Rank for ranked-choice voting (1 = first choice)"
    )


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
    voting_timeline: Optional[List[Dict[str, Any]]] = Field(
        None, description="Votes over time for charts"
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
        ..., description="List of {position: candidate_id} mappings"
    )


class EmailBallot(BaseModel):
    """Schema for sending ballot emails"""

    recipient_user_ids: Optional[List[UUID]] = Field(
        None, description="Specific users to email, null means all eligible"
    )
    subject: Optional[str] = Field(None, description="Email subject line")
    message: Optional[str] = Field(None, description="Additional message to include")
    include_ballot_link: bool = Field(
        default=True, description="Include link to voting page"
    )


class EmailBallotResponse(BaseModel):
    """Response after sending ballot emails"""

    success: bool
    recipients_count: int
    failed_count: int
    message: str


class ElectionRollback(BaseModel):
    """Schema for rolling back an election"""

    reason: str = Field(
        ..., min_length=10, max_length=500, description="Reason for rollback (required)"
    )


class ElectionRollbackResponse(BaseModel):
    """Response after rolling back an election"""

    success: bool
    election: ElectionResponse
    message: str
    notifications_sent: int


class ElectionDelete(BaseModel):
    """Schema for deleting an election. Reason required for non-draft elections."""

    reason: Optional[str] = Field(
        None,
        min_length=10,
        max_length=500,
        description="Reason for deletion (required for open/closed elections)",
    )


class ElectionDeleteResponse(BaseModel):
    """Response after deleting an election"""

    success: bool
    message: str
    notifications_sent: int


# Attendance Schemas


class AttendeeRecord(BaseModel):
    """Schema for a meeting attendee"""

    user_id: str
    name: str
    checked_in_at: str
    checked_in_by: str


class AttendeeCheckIn(BaseModel):
    """Schema for checking in an attendee"""

    user_id: str = Field(..., description="User ID of the member to check in")


class AttendeeCheckInResponse(BaseModel):
    """Response after checking in an attendee"""

    success: bool
    attendee: AttendeeRecord
    message: str
    total_attendees: int


# Ballot Template Schemas


class BallotTemplate(BaseModel):
    """Schema for a pre-configured ballot item template"""

    id: str
    name: str
    description: str
    type: str
    vote_type: str
    eligible_voter_types: List[str]
    require_attendance: bool
    title_template: str = Field(
        ...,
        description="Template string for the ballot item title, may contain {name} placeholder",
    )
    description_template: Optional[str] = None


class BallotTemplatesResponse(BaseModel):
    """Response containing available ballot templates"""

    templates: List[BallotTemplate]


# Ballot Submission Schemas (Token-Based)


class BallotItemVote(BaseModel):
    """A single vote within a ballot submission"""

    ballot_item_id: str = Field(..., description="ID of the ballot item being voted on")
    choice: str = Field(
        ..., description="'approve', 'deny', 'abstain', 'write_in', or a candidate UUID"
    )
    write_in_name: Optional[str] = Field(None, description="Name for write-in votes")


class BallotSubmission(BaseModel):
    """Full ballot submission with all votes"""

    votes: List[BallotItemVote] = Field(
        ..., description="List of votes, one per ballot item"
    )


class BallotSubmissionResponse(BaseModel):
    """Response after submitting a ballot"""

    success: bool
    votes_cast: int
    abstentions: int
    message: str


# Proxy Voting Schemas


class ProxyAuthorizationCreate(BaseModel):
    """Request to authorize one member to vote on behalf of another"""

    delegating_user_id: UUID = Field(
        ..., description="The absent member who is delegating their vote"
    )
    proxy_user_id: UUID = Field(
        ..., description="The member who will cast the vote on their behalf"
    )
    proxy_type: str = Field(
        default="single_election",
        description="'single_election' (one-time for this election) or 'regular' (standing proxy for future elections)",
    )
    reason: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Why the proxy is being authorized",
    )

    @field_validator("proxy_type")
    @classmethod
    def validate_proxy_type(cls, v: str) -> str:
        if v not in {"single_election", "regular"}:
            raise ValueError("proxy_type must be 'single_election' or 'regular'")
        return v


class ProxyAuthorizationResponse(BaseModel):
    """A proxy authorization record"""

    id: str
    delegating_user_id: str
    delegating_user_name: str
    proxy_user_id: str
    proxy_user_name: str
    proxy_type: str
    reason: str
    authorized_by: str
    authorized_by_name: str
    authorized_at: str
    revoked_at: Optional[str] = None


class ProxyAuthorizationListResponse(BaseModel):
    """List of proxy authorizations for an election"""

    election_id: str
    election_title: str
    proxy_voting_enabled: bool
    authorizations: List[ProxyAuthorizationResponse]


class ProxyVoteCreate(BaseModel):
    """Cast a vote on behalf of another member using a proxy authorization"""

    election_id: UUID
    candidate_id: UUID
    proxy_authorization_id: str = Field(
        ..., description="ID of the proxy authorization being used"
    )
    position: Optional[str] = Field(None, max_length=100)
    vote_rank: Optional[int] = Field(
        None, ge=1, description="Rank for ranked-choice voting"
    )
