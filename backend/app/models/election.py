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
