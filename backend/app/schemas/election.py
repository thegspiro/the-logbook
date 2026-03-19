"""
Election Pydantic Schemas

Request and response schemas for election-related endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import UTCResponseBase

VALID_VOTING_METHODS = {"simple_majority", "ranked_choice", "approval", "supermajority"}
VALID_VICTORY_CONDITIONS = {"most_votes", "majority", "supermajority", "threshold"}
VALID_RUNOFF_TYPES = {"top_two", "eliminate_lowest"}
VALID_BALLOT_ITEM_TYPES = {"membership_approval", "officer_election", "general_vote"}
VALID_VOTE_TYPES = {"approval", "candidate_selection"}


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
        description=(
            "Member class or role slug: 'all', 'regular', 'life', "
            "'probationary', 'operational', 'administrative', or specific role slugs"
        ),
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

    # Per-item victory condition overrides (optional — defaults to election-level)
    victory_condition: Optional[str] = Field(
        default=None,
        description=(
            "Override election-level victory condition for this item: "
            "most_votes, majority, supermajority, threshold"
        ),
    )
    victory_percentage: Optional[int] = Field(
        default=None,
        ge=1,
        le=100,
        description="Override election-level victory percentage (e.g., 67 for 2/3 supermajority)",
    )
    voting_method: Optional[str] = Field(
        default=None,
        description="Override election-level voting method for this item",
    )

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_BALLOT_ITEM_TYPES:
            raise ValueError(
                f"Invalid ballot item type '{v}'. Must be one of: {', '.join(sorted(VALID_BALLOT_ITEM_TYPES))}"
            )
        return v

    @field_validator("vote_type")
    @classmethod
    def validate_vote_type(cls, v: str) -> str:
        if v not in VALID_VOTE_TYPES:
            raise ValueError(
                f"Invalid vote type '{v}'. Must be one of: {', '.join(sorted(VALID_VOTE_TYPES))}"
            )
        return v


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
    meeting_id: Optional[UUID] = Field(
        default=None, description="Optional link to a formal meeting record"
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

    # Quorum configuration
    quorum_type: str = Field(
        default="none",
        description="Quorum type: none, percentage, count",
    )
    quorum_value: Optional[int] = Field(
        default=None,
        ge=1,
        le=100,
        description="Quorum value (percentage or count depending on quorum_type)",
    )

    @field_validator("quorum_type")
    @classmethod
    def validate_quorum_type(cls, v: str) -> str:
        if v not in ("none", "percentage", "count"):
            raise ValueError("quorum_type must be 'none', 'percentage', or 'count'")
        return v

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
    meeting_id: Optional[UUID] = None
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
    quorum_type: Optional[str] = None
    quorum_value: Optional[int] = Field(None, ge=1, le=100)

    @field_validator("quorum_type")
    @classmethod
    def validate_quorum_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("none", "percentage", "count"):
            raise ValueError("quorum_type must be 'none', 'percentage', or 'count'")
        return v

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


class ElectionResponse(UTCResponseBase):
    """Schema for election response"""

    id: UUID
    organization_id: UUID
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: str = Field(default="general", max_length=50)
    positions: Optional[List[str]] = None
    ballot_items: Optional[List[BallotItem]] = None
    position_eligibility: Optional[Dict[str, PositionEligibility]] = None
    meeting_date: Optional[datetime] = None
    meeting_id: Optional[UUID] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    start_date: datetime
    end_date: datetime
    anonymous_voting: bool = True
    allow_write_ins: bool = False
    max_votes_per_position: int = 1
    results_visible_immediately: bool = False
    eligible_voters: Optional[List[UUID]] = None
    voting_method: str = "simple_majority"
    victory_condition: str = "most_votes"
    victory_threshold: Optional[int] = None
    victory_percentage: Optional[int] = None
    enable_runoffs: bool = False
    runoff_type: str = "top_two"
    max_runoff_rounds: int = 3
    quorum_type: str = "none"
    quorum_value: Optional[int] = None
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


class ElectionListResponse(UTCResponseBase):
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


class CandidateResponse(UTCResponseBase):
    """Schema for candidate response"""

    id: UUID
    election_id: UUID
    user_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = 0
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


class VoteResponse(UTCResponseBase):
    """Schema for vote response (limited info for privacy)"""

    id: UUID
    election_id: UUID
    candidate_id: UUID
    position: Optional[str] = None
    voted_at: datetime

    # Only include voter_id if voting is not anonymous
    voter_id: Optional[UUID] = None

    # Voter receipt — can be used to verify the vote was recorded
    receipt_hash: Optional[str] = None

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
    quorum_met: bool = True
    quorum_detail: Optional[str] = None


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
    send_eligibility_summary: bool = Field(
        default=False,
        description="Email the secretary a summary of who received "
        "ballots and who was skipped with reasons",
    )


class SkippedVoterDetail(BaseModel):
    """Detail about a voter who was skipped during ballot email sending"""

    user_id: str
    name: str
    reason: str


class EmailBallotResponse(BaseModel):
    """Response after sending ballot emails"""

    success: bool
    recipients_count: int
    failed_count: int
    skipped_count: int = 0
    skipped_details: List[SkippedVoterDetail] = []
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


class ElectionReportResponse(BaseModel):
    """Response after sending an election report"""

    success: bool
    message: str


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


# ============================================
# Response Models for Previously Untyped Endpoints
# ============================================


class SuccessResponse(BaseModel):
    """Generic success response for simple operations"""

    success: bool
    message: str


class ElectionSettingsResponse(BaseModel):
    """Organization-level election settings"""

    default_voting_method: Optional[str] = "simple_majority"
    default_victory_condition: Optional[str] = "most_votes"
    default_victory_percentage: Optional[int] = None
    default_anonymous_voting: Optional[bool] = True
    default_allow_write_ins: Optional[bool] = False
    default_quorum_type: Optional[str] = "none"
    default_quorum_value: Optional[int] = None
    proxy_voting_enabled: Optional[bool] = False
    max_proxies_per_person: Optional[int] = 1
    security: Optional[Dict[str, Any]] = None


class NonVoterRecord(BaseModel):
    """A voter who hasn't voted yet"""

    id: str
    full_name: str
    email: str


class NonVotersResponse(BaseModel):
    """Response for non-voters endpoint"""

    non_voters: List[NonVoterRecord]
    count: int


class VoteIntegrityResponse(BaseModel):
    """Response for vote integrity check"""

    election_id: str
    election_title: str
    total_votes_checked: int
    valid_votes: int
    invalid_votes: int
    chain_valid: bool
    details: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None


class SoftDeleteVoteResponse(BaseModel):
    """Response after soft-deleting a vote"""

    message: str
    vote_id: str


class ForensicsResponse(BaseModel):
    """Response for election forensics report"""

    election_id: str
    election_title: str
    integrity: Optional[Dict[str, Any]] = None
    deleted_votes: Optional[List[Dict[str, Any]]] = None
    rollback_history: Optional[List[Dict[str, Any]]] = None
    token_access_log: Optional[List[Dict[str, Any]]] = None
    audit_trail: Optional[List[Dict[str, Any]]] = None
    anomalies: Optional[Dict[str, Any]] = None
    voting_timeline: Optional[List[Dict[str, Any]]] = None


class AttendeeListResponse(BaseModel):
    """Response for attendance list"""

    attendees: List[AttendeeRecord]
    total: int


class VoterOverrideRecord(BaseModel):
    """A single voter override entry"""

    user_id: str
    member_name: Optional[str] = None
    reason: str
    overridden_by: str
    overridden_by_name: Optional[str] = None
    overridden_at: str


class VoterOverrideListResponse(BaseModel):
    """Response for voter override list"""

    election_id: str
    election_title: str
    overrides: List[VoterOverrideRecord]


class BulkVoterOverrideAddedMember(BaseModel):
    """A member who was added in a bulk override operation"""

    user_id: str
    name: str


class BulkVoterOverrideResponse(BaseModel):
    """Response for bulk voter override"""

    success: bool
    added: List[BulkVoterOverrideAddedMember]
    added_count: int
    skipped_count: int
    message: str


class TestBallotResponse(BaseModel):
    """Response for test ballot send"""

    success: bool
    message: str


class BallotPreviewItem(BaseModel):
    """Ballot item with eligibility annotation"""

    id: str
    type: str
    title: str
    description: Optional[str] = None
    position: Optional[str] = None
    eligible_voter_types: List[str] = Field(default=["all"])
    vote_type: str = "approval"
    require_attendance: bool = False
    eligibility: Dict[str, Any]


class BallotPreviewCandidate(BaseModel):
    """Simplified candidate for ballot preview"""

    id: str
    name: str
    position: Optional[str] = None
    statement: Optional[str] = None


class BallotPreviewEligibility(BaseModel):
    """Eligibility summary for ballot preview"""

    is_eligible: bool
    reason: Optional[str] = None


class BallotPreviewResponse(BaseModel):
    """Response for ballot preview endpoint"""

    election_id: str
    election_title: str
    user_id: str
    user_name: str
    overall_eligibility: BallotPreviewEligibility
    ballot_items: List[Dict[str, Any]]
    candidates: List[BallotPreviewCandidate]
    eligible_item_count: int
    total_item_count: int
    would_receive_ballot: bool


class VoteReceiptResponse(BaseModel):
    """Response for vote receipt verification"""

    verified: bool
    message: str
    voted_at: Optional[str] = None
    position: Optional[str] = None
