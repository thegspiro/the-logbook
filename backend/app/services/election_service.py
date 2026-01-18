"""
Election Service

Business logic for election management including elections, candidates, voting, and results.
"""

from typing import List, Optional, Dict, Tuple
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID
import hashlib

from app.models.election import (
    Election,
    Candidate,
    Vote,
    ElectionStatus,
)
from app.models.user import User
from app.schemas.election import (
    ElectionResults,
    CandidateResult,
    PositionResults,
    ElectionStats,
    VoterEligibility,
)


class ElectionService:
    """Service for election management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_voter_eligibility(
        self, user_id: UUID, election_id: UUID, organization_id: UUID
    ) -> VoterEligibility:
        """
        Check if a user is eligible to vote in an election and if they've already voted
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason="Election not found",
            )

        # Check if election is open
        now = datetime.utcnow()
        if election.status != ElectionStatus.OPEN:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason=f"Election is {election.status.value}",
            )

        if now < election.start_date:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason="Election has not started yet",
            )

        if now > election.end_date:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason="Election has ended",
            )

        # Check if user is in eligible voters list (if specified)
        if election.eligible_voters is not None:
            if str(user_id) not in election.eligible_voters:
                return VoterEligibility(
                    is_eligible=False,
                    has_voted=False,
                    positions_voted=[],
                    positions_remaining=[],
                    reason="You are not eligible to vote in this election",
                )

        # Check what positions they've already voted for
        vote_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election_id)
            .where(Vote.voter_id == user_id)
        )
        existing_votes = vote_result.scalars().all()

        positions_voted = list(set(vote.position for vote in existing_votes if vote.position))

        # Determine remaining positions
        all_positions = election.positions or []
        positions_remaining = [pos for pos in all_positions if pos not in positions_voted]

        # If all positions are voted or no positions defined, check if they've voted at all
        has_voted = len(existing_votes) > 0

        # For non-positional elections, only one vote total
        if not all_positions and has_voted:
            return VoterEligibility(
                is_eligible=False,
                has_voted=True,
                positions_voted=positions_voted,
                positions_remaining=[],
                reason="You have already voted in this election",
            )

        return VoterEligibility(
            is_eligible=True,
            has_voted=has_voted,
            positions_voted=positions_voted,
            positions_remaining=positions_remaining,
            reason=None,
        )

    async def cast_vote(
        self,
        user_id: UUID,
        election_id: UUID,
        candidate_id: UUID,
        position: Optional[str],
        organization_id: UUID,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[Vote], Optional[str]]:
        """
        Cast a vote for a candidate

        Returns: (Vote object, error message)
        """
        # Check eligibility
        eligibility = await self.check_voter_eligibility(user_id, election_id, organization_id)

        # Get election for further checks
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        # Check if specific position has been voted for
        if position and position in eligibility.positions_voted:
            return None, f"You have already voted for {position}"

        # For single-position elections, check if they've voted at all
        if not election.positions and eligibility.has_voted:
            return None, "You have already voted in this election"

        # Verify candidate exists and belongs to this election
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.id == candidate_id)
            .where(Candidate.election_id == election_id)
        )
        candidate = candidate_result.scalar_one_or_none()

        if not candidate:
            return None, "Candidate not found"

        # Verify candidate has accepted nomination (unless write-in)
        if not candidate.accepted and not candidate.is_write_in:
            return None, "Candidate has not accepted nomination"

        # Verify position matches if specified
        if position and candidate.position != position:
            return None, "Candidate is not running for this position"

        # Check max votes per position
        if position:
            position_votes = [v for v in await self._get_user_votes(user_id, election_id) if v.position == position]
            if len(position_votes) >= election.max_votes_per_position:
                return None, f"Maximum votes for {position} reached"

        # Create the vote
        vote = Vote(
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=user_id if not election.anonymous_voting else None,
            voter_hash=self._generate_voter_hash(user_id, election_id) if election.anonymous_voting else None,
            position=position,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.utcnow(),
        )

        self.db.add(vote)
        await self.db.commit()
        await self.db.refresh(vote)

        return vote, None

    async def _get_user_votes(self, user_id: UUID, election_id: UUID) -> List[Vote]:
        """Get all votes by a user in an election"""
        result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election_id)
            .where(Vote.voter_id == user_id)
        )
        return result.scalars().all()

    def _generate_voter_hash(self, user_id: UUID, election_id: UUID) -> str:
        """Generate a hash to track anonymous voters without revealing identity"""
        # Combine user_id and election_id and hash to allow duplicate vote checking
        # while maintaining anonymity
        data = f"{user_id}:{election_id}"
        return hashlib.sha256(data.encode()).hexdigest()

    async def get_election_results(
        self, election_id: UUID, organization_id: UUID, user_id: Optional[UUID] = None
    ) -> Optional[ElectionResults]:
        """
        Get comprehensive election results

        Only returns results if:
        - Election is closed, OR
        - results_visible_immediately is True, OR
        - User has permission to view results
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        # Check if results can be viewed
        # TODO: Add permission check for early viewing
        can_view = (
            election.status == ElectionStatus.CLOSED
            or election.results_visible_immediately
        )

        if not can_view:
            return None

        # Get all votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election_id)
        )
        all_votes = votes_result.scalars().all()

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election_id)
        )
        candidates = candidates_result.scalars().all()

        # Count total eligible voters
        if election.eligible_voters:
            total_eligible = len(election.eligible_voters)
        else:
            # Count all active users in organization
            users_result = await self.db.execute(
                select(func.count(User.id))
                .where(User.organization_id == organization_id)
                .where(User.is_active == True)
            )
            total_eligible = users_result.scalar() or 0

        # Count unique voters
        if election.anonymous_voting:
            unique_voters = len(set(v.voter_hash for v in all_votes if v.voter_hash))
        else:
            unique_voters = len(set(v.voter_id for v in all_votes if v.voter_id))

        # Calculate turnout
        voter_turnout = (unique_voters / total_eligible * 100) if total_eligible > 0 else 0

        # Calculate results by position
        results_by_position = []
        if election.positions:
            for position in election.positions:
                position_votes = [v for v in all_votes if v.position == position]
                position_candidates = [c for c in candidates if c.position == position]

                candidate_results = await self._calculate_candidate_results(
                    position_candidates, position_votes
                )

                results_by_position.append(
                    PositionResults(
                        position=position,
                        total_votes=len(position_votes),
                        candidates=candidate_results,
                    )
                )

        # Overall results (all candidates regardless of position)
        overall_results = await self._calculate_candidate_results(candidates, all_votes)

        return ElectionResults(
            election_id=election.id,
            election_title=election.title,
            status=election.status.value,
            total_votes=len(all_votes),
            total_eligible_voters=total_eligible,
            voter_turnout_percentage=round(voter_turnout, 2),
            results_by_position=results_by_position,
            overall_results=overall_results,
        )

    async def _calculate_candidate_results(
        self, candidates: List[Candidate], votes: List[Vote]
    ) -> List[CandidateResult]:
        """Calculate results for a list of candidates"""
        # Count votes per candidate
        vote_counts = {}
        for vote in votes:
            vote_counts[vote.candidate_id] = vote_counts.get(vote.candidate_id, 0) + 1

        total_votes = len(votes)

        # Build results
        results = []
        for candidate in candidates:
            vote_count = vote_counts.get(candidate.id, 0)
            percentage = (vote_count / total_votes * 100) if total_votes > 0 else 0

            results.append(
                CandidateResult(
                    candidate_id=candidate.id,
                    candidate_name=candidate.name,
                    position=candidate.position,
                    vote_count=vote_count,
                    percentage=round(percentage, 2),
                    is_winner=False,  # Will be set below
                )
            )

        # Sort by vote count (descending)
        results.sort(key=lambda x: x.vote_count, reverse=True)

        # Mark winner(s) - could be ties
        if results:
            max_votes = results[0].vote_count
            for result in results:
                if result.vote_count == max_votes and max_votes > 0:
                    result.is_winner = True

        return results

    async def get_election_stats(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[ElectionStats]:
        """Get detailed statistics about an election"""
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        # Get all votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election_id)
        )
        all_votes = votes_result.scalars().all()

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election_id)
        )
        total_candidates = len(candidates_result.scalars().all())

        # Count eligible voters
        if election.eligible_voters:
            total_eligible = len(election.eligible_voters)
        else:
            users_result = await self.db.execute(
                select(func.count(User.id))
                .where(User.organization_id == organization_id)
                .where(User.is_active == True)
            )
            total_eligible = users_result.scalar() or 0

        # Count unique voters
        if election.anonymous_voting:
            unique_voters = len(set(v.voter_hash for v in all_votes if v.voter_hash))
        else:
            unique_voters = len(set(v.voter_id for v in all_votes if v.voter_id))

        # Calculate turnout
        voter_turnout = (unique_voters / total_eligible * 100) if total_eligible > 0 else 0

        # Votes by position
        votes_by_position = {}
        for vote in all_votes:
            if vote.position:
                votes_by_position[vote.position] = votes_by_position.get(vote.position, 0) + 1

        return ElectionStats(
            election_id=election.id,
            total_candidates=total_candidates,
            total_votes_cast=len(all_votes),
            total_eligible_voters=total_eligible,
            total_voters=unique_voters,
            voter_turnout_percentage=round(voter_turnout, 2),
            votes_by_position=votes_by_position,
            voting_timeline=None,  # Could be implemented for charts
        )

    async def close_election(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[Election]:
        """Close an election and finalize results"""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        if election.status == ElectionStatus.CLOSED:
            return election

        election.status = ElectionStatus.CLOSED
        await self.db.commit()
        await self.db.refresh(election)

        return election

    async def open_election(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Open an election for voting"""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        if election.status != ElectionStatus.DRAFT:
            return None, f"Cannot open election with status {election.status.value}"

        # Validate election has at least one candidate
        candidates_result = await self.db.execute(
            select(func.count(Candidate.id))
            .where(Candidate.election_id == election_id)
            .where(Candidate.accepted == True)
        )
        candidate_count = candidates_result.scalar() or 0

        if candidate_count == 0:
            return None, "Election must have at least one accepted candidate"

        election.status = ElectionStatus.OPEN
        await self.db.commit()
        await self.db.refresh(election)

        return election, None

    async def has_user_voted(
        self, user_id: UUID, election_id: UUID
    ) -> bool:
        """Check if a user has voted in an election"""
        result = await self.db.execute(
            select(func.count(Vote.id))
            .where(Vote.election_id == election_id)
            .where(Vote.voter_id == user_id)
        )
        vote_count = result.scalar() or 0
        return vote_count > 0
