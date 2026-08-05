"""
Election Models

Database models for election management, including elections, candidates, and votes.
"""

from enum import Enum

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class ElectionStatus(str, Enum):
    """Election status enumeration"""

    DRAFT = "draft"
    # Optional pre-ballot phase: members may nominate candidates (and
    # nominees accept/decline). Closing nominations returns the election
    # to DRAFT so the secretary finalizes the ballot before opening.
    NOMINATIONS = "nominations"
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    # Election details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    election_type = Column(
        String(50), nullable=False, default="general"
    )  # officer, board, general, poll

    # Positions being voted on (for multi-position elections)
    positions = Column(JSON, nullable=True)  # ["Chief", "President", "Secretary"]

    # Ballot items for structured voting with per-item eligibility
    # Format: [{"id": "item1", "type": "membership_approval", "title": "...",
    #           "eligible_voter_types": ["operational"], "vote_type": "approval"}]
    ballot_items = Column(JSON, nullable=True)

    # Position-specific eligibility rules
    # Format: {"Chief": {"voter_types": ["operational"]}, "Member": {"voter_types": ["all"]}}
    position_eligibility = Column(JSON, nullable=True)

    # Email notification tracking
    email_sent = Column(Boolean, nullable=False, default=False, server_default="0")
    email_sent_at = Column(DateTime(timezone=True), nullable=True)
    email_recipients = Column(
        JSON, nullable=True
    )  # List of user IDs who received email
    meeting_date = Column(
        DateTime(timezone=True), nullable=True
    )  # For meeting-based ballots

    # Optional link to a formal meeting record
    meeting_id = Column(
        String(36), ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True
    )

    # Optional link to a calendar event (e.g. business meeting events)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )

    # Timing
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)

    # Lifecycle automation (election_lifecycle scheduled task).
    # auto_open: opt-in — a half-configured draft must never open itself, so
    # the task only auto-opens drafts explicitly flagged by the creator.
    # Auto-CLOSE needs no flag: every vote path already rejects votes after
    # end_date, and closing runs the IP purge / salt destruction, so leaving
    # an overdue election open is strictly worse than closing it.
    auto_open = Column(Boolean, nullable=False, default=False, server_default="0")

    # Auto-reminder to non-voters: NULL = disabled. When set, the lifecycle
    # task sends ONE reminder once now >= end_date - reminder_hours_before_close
    # and no reminder (manual or automatic) has been sent yet.
    reminder_hours_before_close = Column(Integer, nullable=True)
    reminder_sent_at = Column(DateTime(timezone=True), nullable=True)

    # Nomination phase: when the election is in NOMINATIONS status and a
    # deadline is set, the lifecycle task closes nominations (back to DRAFT)
    # once the deadline passes. NULL = nominations close manually.
    nomination_deadline = Column(DateTime(timezone=True), nullable=True)

    # Status
    status = Column(
        SQLEnum(ElectionStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ElectionStatus.DRAFT,
    )

    # Election settings
    anonymous_voting = Column(Boolean, nullable=False, default=True)
    allow_write_ins = Column(Boolean, nullable=False, default=False)
    max_votes_per_position = Column(Integer, nullable=False, default=1)
    results_visible_immediately = Column(Boolean, nullable=False, default=False)
    eligible_voters = Column(JSON, nullable=True)  # List of user IDs or role slugs

    # Voting method and victory conditions
    voting_method = Column(
        String(50),
        nullable=False,
        default="simple_majority",
        server_default="simple_majority",
    )
    # Voting methods: simple_majority, ranked_choice, approval, supermajority

    victory_condition = Column(
        String(50), nullable=False, default="most_votes", server_default="most_votes"
    )
    # Victory conditions: most_votes, majority, supermajority, threshold

    victory_threshold = Column(Integer, nullable=True)
    # For numerical threshold (e.g., 10 votes required)

    victory_percentage = Column(Integer, nullable=True)
    # For percentage threshold (e.g., 60% required)

    # What happens when the top candidates tie under most_votes:
    #   co_winners (legacy default) — all tied candidates declared winners
    #   runoff — no winner declared; the runoff machinery (if enabled)
    #            resolves it, and the tie is flagged in results
    #   revote — no winner declared; the department re-votes at the meeting
    #   chair_decides — no winner declared; the chair resolves per bylaws
    tie_policy = Column(
        String(20), nullable=False, default="co_winners", server_default="co_winners"
    )

    # Voter roll frozen when the election opens: list of user ids eligible
    # at open time. NULL = legacy election (eligibility evaluated live).
    # A mid-election membership change must not alter who may vote or the
    # turnout denominator — "eligible" means eligible when voting opened.
    # Secretary voter overrides granted during the meeting still add voters.
    eligible_roster_snapshot = Column(JSON, nullable=True)

    # Runoff configuration
    enable_runoffs = Column(Boolean, nullable=False, default=False, server_default="0")
    # Whether to automatically create runoff elections if no winner

    runoff_type = Column(
        String(50), nullable=False, default="top_two", server_default="top_two"
    )
    # Runoff types: top_two (top 2 candidates advance), eliminate_lowest (remove lowest, re-vote)

    max_runoff_rounds = Column(Integer, nullable=False, default=3, server_default="3")
    # Maximum number of runoff rounds to prevent infinite loops

    is_runoff = Column(Boolean, nullable=False, default=False, server_default="0")
    # Indicates this election is a runoff from another election

    parent_election_id = Column(String(36), ForeignKey("elections.id"), nullable=True)
    # Reference to parent election if this is a runoff

    runoff_round = Column(Integer, nullable=False, default=0, server_default="0")
    # Which round of runoff this is (0 = original election)

    # Per-election anonymity salt for voter hash (SEC-12).
    # Generated when the election is created and can be destroyed after
    # the election closes to make de-anonymization impossible.
    voter_anonymity_salt = Column(String(64), nullable=True)

    # Meeting attendance tracking
    # Format: [{"user_id": "abc-123", "name": "John Doe", "checked_in_at": "2026-02-10T09:00:00",
    #           "checked_in_by": "user-456"}]
    attendees = Column(JSON, nullable=True)

    # Voter eligibility overrides — secretary can grant voting rights
    # Format: [{"user_id": "abc-123", "reason": "Excused absence approved",
    #           "overridden_by": "user-456", "overridden_by_name": "Jane Smith",
    #           "overridden_at": "2026-02-14T10:00:00"}]
    voter_overrides = Column(JSON, nullable=True)

    # Proxy voting authorizations — secretary can allow one member to vote on behalf of another
    # Format: [{"id": "auth-uuid", "delegating_user_id": "abc-123", "delegating_user_name": "John Doe",
    #           "proxy_user_id": "def-456", "proxy_user_name": "Jane Smith",
    #           "proxy_type": "single_election",  # "single_election" or "regular"
    #           "reason": "Cannot attend — authorized by board",
    #           "authorized_by": "user-789", "authorized_by_name": "Secretary Name",
    #           "authorized_at": "2026-02-14T10:00:00", "revoked_at": null}]
    proxy_authorizations = Column(JSON, nullable=True)

    # Quorum configuration — minimum voter turnout for valid results
    quorum_type = Column(
        String(20), nullable=False, default="none", server_default="none"
    )  # none, percentage, count
    quorum_value = Column(Integer, nullable=True)  # e.g., 51 (percent) or 20 (count)

    # Sequential vote chain hash — last hash in the chain for integrity verification
    last_chain_hash = Column(String(64), nullable=True)

    # Rollback audit trail
    rollback_history = Column(JSON, nullable=True)
    # Format: [{"timestamp": "2024-01-19T10:00:00", "performed_by": "user_id",
    #           "from_status": "closed", "to_status": "open", "reason": "Error in vote count"}]

    # Metadata
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    candidates = relationship(
        "Candidate", back_populates="election", cascade="all, delete-orphan"
    )
    votes = relationship(
        "Vote", back_populates="election", cascade="all, delete-orphan"
    )
    meeting = relationship("Meeting", foreign_keys=[meeting_id])
    event = relationship("Event", foreign_keys=[event_id])

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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    election_id = Column(
        String(36), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False
    )

    # Candidate information
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # Null for write-ins
    name = Column(String(200), nullable=False)  # For display (or write-in name)
    position = Column(String(100), nullable=True)  # Position they're running for
    statement = Column(Text, nullable=True)  # Candidate statement
    photo_url = Column(String(500), nullable=True)

    # Nomination details
    nomination_date = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    nominated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    accepted = Column(Boolean, nullable=False, default=True)  # For member candidates
    is_write_in = Column(Boolean, nullable=False, default=False)

    # Write-in consolidation: when spelling variants of the same person are
    # merged, sources point at the canonical candidate and results count
    # their votes under it. Votes are NEVER mutated — vote signatures embed
    # candidate_id, so re-pointing votes would break integrity verification.
    merged_into_candidate_id = Column(String(36), nullable=True)

    # Order for display
    display_order = Column(Integer, nullable=False, default=0)

    # Metadata
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    election = relationship("Election", back_populates="candidates")
    votes = relationship(
        "Vote", back_populates="candidate", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_candidates_election_id", "election_id"),
        Index("ix_candidates_user_id", "user_id"),
        Index("ix_candidates_position", "position"),
    )


class VotingToken(Base):
    """
    Voting token model for secure anonymous ballot access

    Each eligible voter receives a unique high-entropy token via email to access
    their ballot. Only the token's SHA-256 is stored (ELEC-5) — the raw value
    exists solely in the emailed link, so database read access never yields a
    live ballot credential. The token ensures anonymous voting while
    preventing duplicate votes.
    """

    __tablename__ = "voting_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    election_id = Column(
        String(36), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False
    )

    # SHA-256 of the ballot-access token (raw token sent via email only)
    token = Column(String(128), nullable=False, unique=True)

    # Hashed voter identifier (for tracking without revealing identity)
    voter_hash = Column(String(64), nullable=False)  # SHA256 hash

    # Token metadata
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # Usage tracking
    used = Column(Boolean, nullable=False, default=False, server_default="0")
    used_at = Column(DateTime(timezone=True), nullable=True)

    # Test-ballot flag — votes cast with a test token are marked is_test
    # and excluded from results/stats/rosters
    is_test = Column(Boolean, nullable=False, default=False, server_default="0")

    # Ballot items this voter was eligible for when the token was issued.
    # Eligibility cannot be recomputed at submission time because the token
    # stores only a one-way voter_hash, so it is snapshotted here at send
    # time. NULL = legacy token or positional election (no per-item limit).
    eligible_item_ids = Column(JSON, nullable=True)

    # Positions this voter was eligible for at send time (the election's
    # position_eligibility voter_types evaluated against the recipient) —
    # the positional-election mirror of eligible_item_ids, and snapshotted
    # for the same reason. NULL = legacy token or election without position
    # rules (unrestricted).
    eligible_positions = Column(JSON, nullable=True)

    # Access tracking
    first_accessed_at = Column(DateTime(timezone=True), nullable=True)
    access_count = Column(Integer, nullable=False, default=0, server_default="0")

    # Multi-position tracking: which positions have been voted on via this token
    positions_voted = Column(JSON, nullable=True)  # ["Chief", "President"]

    # Relationships
    election = relationship("Election", backref="voting_tokens")

    __table_args__ = (
        Index("ix_voting_tokens_election_id", "election_id"),
        Index("ix_voting_tokens_voter_hash", "voter_hash"),
        Index("ix_voting_tokens_organization_id", "organization_id"),
    )


class Vote(Base):
    """
    Vote model for recording votes

    Supports both anonymous and non-anonymous voting.
    """

    __tablename__ = "votes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    election_id = Column(
        String(36), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id = Column(
        String(36), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False
    )

    # Voter information (nullable for anonymous voting)
    voter_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # For tracking purposes (even in anonymous voting, we can track that a user voted)
    voter_hash = Column(
        String(64), nullable=True
    )  # SHA256 hash of voter_id + election_id

    # Vote details
    position = Column(
        String(100), nullable=True
    )  # Position being voted for (multi-position elections)
    vote_rank = Column(
        Integer, nullable=True
    )  # For ranked-choice voting (1 = first choice)
    voted_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Cryptographic signature for tampering detection
    # HMAC-SHA256(id:election_id:candidate_id:voter_hash:position:vote_rank:is_proxy:proxy_delegating:voted_at)
    vote_signature = Column(String(128), nullable=True)

    # MySQL-compatible dedup hash — SHA256(election_id:voter_id_or_hash:position)
    # Unique constraint on this column prevents double-voting at DB level.
    vote_dedup_hash = Column(String(64), nullable=True, unique=True)

    # Sequential chain hash — SHA256(previous_chain_hash + vote_signature)
    # Links votes in an immutable chain; a missing or reordered vote breaks the chain.
    chain_hash = Column(String(64), nullable=True)

    # Voter receipt — SHA256(vote_id + vote_signature + nonce) returned to the voter
    # so they can verify their vote was recorded (without revealing content).
    receipt_hash = Column(String(64), nullable=True)

    # Test ballot flag — test votes are excluded from real results/stats
    is_test = Column(Boolean, nullable=False, default=False, server_default="0")

    # Manual (paper-ballot) entry: votes keyed in by an officer from an
    # in-room paper tally. No voter identity or dedup hash — the officer's
    # attested count is the source of truth; recorded_by attributes it.
    is_manual = Column(Boolean, nullable=False, default=False, server_default="0")
    recorded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Shared id across one paper-tally entry, so a mis-keyed batch can be
    # voided in a single audited action.
    manual_batch_id = Column(String(36), nullable=True, index=True)

    # Proxy voting — tracks when a vote is cast on behalf of another member
    is_proxy_vote = Column(Boolean, nullable=False, default=False, server_default="0")
    proxy_voter_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # The person who physically voted
    proxy_authorization_id = Column(
        String(36), nullable=True
    )  # References proxy_authorizations[].id on Election
    proxy_delegating_user_id = Column(
        String(36), nullable=True
    )  # The absent member on whose behalf the vote is cast

    # IP and user agent for audit (not shown to users)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)

    # Soft-delete for audit trail (votes are never hard-deleted)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(String(36), nullable=True)
    deletion_reason = Column(Text, nullable=True)

    # Relationships
    election = relationship("Election", back_populates="votes")
    candidate = relationship("Candidate", back_populates="votes")

    __table_args__ = (
        Index("ix_votes_election_id", "election_id"),
        Index("ix_votes_candidate_id", "candidate_id"),
        Index("ix_votes_voter_id", "voter_id"),
        Index("ix_votes_voter_hash", "voter_hash"),
        Index("ix_votes_deleted_at", "deleted_at"),
        Index("ix_votes_is_proxy_vote", "is_proxy_vote"),
    )


class ManualBallotBatch(Base):
    """One paper-tally entry — the set of manual votes sharing a batch id.

    The batch is the unit of officer attestation: when the organization
    requires N attestations, the batch starts ``pending`` and its votes are
    excluded from results and stats until N distinct officers (other than
    the recording officer) confirm the counts. ``voided`` mirrors the
    soft-deleted votes of a corrected batch.
    """

    __tablename__ = "manual_ballot_batches"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    election_id = Column(
        String(36),
        ForeignKey("elections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recorded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes = Column(Text, nullable=True)
    # 'pending' (awaiting attestations) | 'confirmed' | 'voided'
    status = Column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    # Snapshot of the org's requirement at record time, so changing the
    # setting later never silently confirms or un-confirms an old batch.
    required_attestations = Column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    confirmed_at = Column(DateTime(timezone=True), nullable=True)

    attestations = relationship(
        "ManualBallotAttestation",
        back_populates="batch",
        cascade="all, delete-orphan",
    )


class ManualBallotAttestation(Base):
    """One officer's confirmation that a paper-tally batch matches the
    physical count. The unique constraint makes double-attestation by the
    same officer impossible at the DB level."""

    __tablename__ = "manual_ballot_attestations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    batch_id = Column(
        String(36),
        ForeignKey("manual_ballot_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    attested_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    attested_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    batch = relationship("ManualBallotBatch", back_populates="attestations")

    __table_args__ = (
        UniqueConstraint("batch_id", "attested_by", name="uq_batch_attester"),
    )
