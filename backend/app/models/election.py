"""
Election Models

Database models for election management, including elections, candidates, and votes.
"""

from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Enum as SQLEnum,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from uuid import uuid4
from datetime import datetime
from enum import Enum

from app.core.database import Base


class ElectionStatus(str, Enum):
    """Election status enumeration"""
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class Election(Base):
    """
    Election model for managing elections within an organization

    Supports various election types including officer elections,
    board elections, and general voting.
    """
    __tablename__ = "elections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)

    # Election details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    election_type = Column(String(50), nullable=False, default="general")  # officer, board, general, poll

    # Positions being voted on (for multi-position elections)
    positions = Column(JSONB, nullable=True)  # ["Chief", "President", "Secretary"]

    # Ballot items for structured voting with per-item eligibility
    # Format: [{"id": "item1", "type": "membership_approval", "title": "...",
    #           "eligible_voter_types": ["operational"], "vote_type": "approval"}]
    ballot_items = Column(JSONB, nullable=True)

    # Position-specific eligibility rules
    # Format: {"Chief": {"voter_types": ["operational"]}, "Member": {"voter_types": ["all"]}}
    position_eligibility = Column(JSONB, nullable=True)

    # Email notification tracking
    email_sent = Column(Boolean, nullable=False, default=False)
    email_sent_at = Column(DateTime, nullable=True)
    email_recipients = Column(JSONB, nullable=True)  # List of user IDs who received email
    meeting_date = Column(DateTime, nullable=True)  # For meeting-based ballots

    # Timing
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)

    # Status
    status = Column(SQLEnum(ElectionStatus), nullable=False, default=ElectionStatus.DRAFT)

    # Election settings
    anonymous_voting = Column(Boolean, nullable=False, default=True)
    allow_write_ins = Column(Boolean, nullable=False, default=False)
    max_votes_per_position = Column(Integer, nullable=False, default=1)
    results_visible_immediately = Column(Boolean, nullable=False, default=False)
    eligible_voters = Column(JSONB, nullable=True)  # List of user IDs or role slugs

    # Voting method and victory conditions
    voting_method = Column(String(50), nullable=False, default="simple_majority")
    # Voting methods: simple_majority, ranked_choice, approval, supermajority

    victory_condition = Column(String(50), nullable=False, default="most_votes")
    # Victory conditions: most_votes, majority, supermajority, threshold

    victory_threshold = Column(Integer, nullable=True)
    # For numerical threshold (e.g., 10 votes required)

    victory_percentage = Column(Integer, nullable=True)
    # For percentage threshold (e.g., 60% required)

    # Runoff configuration
    enable_runoffs = Column(Boolean, nullable=False, default=False)
    # Whether to automatically create runoff elections if no winner

    runoff_type = Column(String(50), nullable=False, default="top_two")
    # Runoff types: top_two (top 2 candidates advance), eliminate_lowest (remove lowest, re-vote)

    max_runoff_rounds = Column(Integer, nullable=False, default=3)
    # Maximum number of runoff rounds to prevent infinite loops

    is_runoff = Column(Boolean, nullable=False, default=False)
    # Indicates this election is a runoff from another election

    parent_election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=True)
    # Reference to parent election if this is a runoff

    runoff_round = Column(Integer, nullable=False, default=0)
    # Which round of runoff this is (0 = original election)

    # Metadata
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    candidates = relationship("Candidate", back_populates="election", cascade="all, delete-orphan")
    votes = relationship("Vote", back_populates="election", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_elections_organization_id", "organization_id"),
        Index("ix_elections_status", "status"),
        Index("ix_elections_dates", "start_date", "end_date"),
    )


class Candidate(Base):
    """
    Candidate model for election candidates

    Can represent existing members or write-in candidates.
    """
    __tablename__ = "candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=False)

    # Candidate information
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # Null for write-ins
    name = Column(String(200), nullable=False)  # For display (or write-in name)
    position = Column(String(100), nullable=True)  # Position they're running for
    statement = Column(Text, nullable=True)  # Candidate statement
    photo_url = Column(String(500), nullable=True)

    # Nomination details
    nomination_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    nominated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    accepted = Column(Boolean, nullable=False, default=True)  # For member candidates
    is_write_in = Column(Boolean, nullable=False, default=False)

    # Order for display
    display_order = Column(Integer, nullable=False, default=0)

    # Metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    election = relationship("Election", back_populates="candidates")
    votes = relationship("Vote", back_populates="candidate", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_candidates_election_id", "election_id"),
        Index("ix_candidates_user_id", "user_id"),
        Index("ix_candidates_position", "position"),
    )


class VotingToken(Base):
    """
    Voting token model for secure anonymous ballot access

    Each eligible voter receives a unique hashed token via email to access their ballot.
    The token ensures anonymous voting while preventing duplicate votes.
    """
    __tablename__ = "voting_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=False)

    # Secure token for ballot access (sent via email)
    token = Column(String(128), nullable=False, unique=True, index=True)

    # Hashed voter identifier (for tracking without revealing identity)
    voter_hash = Column(String(64), nullable=False)  # SHA256 hash

    # Token metadata
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    # Usage tracking
    used = Column(Boolean, nullable=False, default=False)
    used_at = Column(DateTime, nullable=True)

    # Access tracking
    first_accessed_at = Column(DateTime, nullable=True)
    access_count = Column(Integer, nullable=False, default=0)

    # Relationships
    election = relationship("Election", backref="voting_tokens")

    __table_args__ = (
        Index("ix_voting_tokens_election_id", "election_id"),
        Index("ix_voting_tokens_token", "token"),
        Index("ix_voting_tokens_voter_hash", "voter_hash"),
    )


class Vote(Base):
    """
    Vote model for recording votes

    Supports both anonymous and non-anonymous voting.
    """
    __tablename__ = "votes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=False)

    # Voter information (nullable for anonymous voting)
    voter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # For tracking purposes (even in anonymous voting, we can track that a user voted)
    voter_hash = Column(String(64), nullable=True)  # SHA256 hash of voter_id + election_id

    # Vote details
    position = Column(String(100), nullable=True)  # Position being voted for (multi-position elections)
    voted_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # IP and user agent for audit (not shown to users)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)

    # Relationships
    election = relationship("Election", back_populates="votes")
    candidate = relationship("Candidate", back_populates="votes")

    __table_args__ = (
        Index("ix_votes_election_id", "election_id"),
        Index("ix_votes_candidate_id", "candidate_id"),
        Index("ix_votes_voter_id", "voter_id"),
        Index("ix_votes_voter_hash", "voter_hash"),
    )
