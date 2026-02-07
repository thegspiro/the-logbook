"""
Election Service

Business logic for election management including elections, candidates, voting, and results.
"""

from typing import List, Optional, Dict, Tuple
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID, uuid4
import hashlib
import secrets

from app.models.election import (
    Election,
    Candidate,
    Vote,
    VotingToken,
    ElectionStatus,
)
from app.models.user import User, Organization
from app.schemas.election import (
    ElectionResults,
    CandidateResult,
    PositionResults,
    ElectionStats,
    VoterEligibility,
)
from app.services.email_service import EmailService


class ElectionService:
    """Service for election management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _user_has_role_type(self, user: User, role_types: List[str]) -> bool:
        """
        Check if a user has any of the specified role types/slugs

        role_types can include:
        - "all" - everyone is eligible
        - "operational" - users with operational roles (firefighter, driver, officer roles)
        - "administrative" - users with administrative roles (secretary, treasurer, etc.)
        - Specific role slugs like "chief", "president", etc.
        """
        if not role_types or "all" in role_types:
            return True

        user_role_slugs = [role.slug for role in user.roles]

        # Check for direct role slug matches
        for role_slug in user_role_slugs:
            if role_slug in role_types:
                return True

        # Check for role type categories
        operational_roles = ["chief", "assistant_chief", "captain", "lieutenant", "firefighter", "driver", "emt", "paramedic"]
        administrative_roles = ["president", "vice_president", "secretary", "assistant_secretary", "treasurer"]

        if "operational" in role_types:
            if any(slug in operational_roles for slug in user_role_slugs):
                return True

        if "administrative" in role_types:
            if any(slug in administrative_roles for slug in user_role_slugs):
                return True

        return False

    async def check_voter_eligibility(
        self, user_id: UUID, election_id: UUID, organization_id: UUID, position: Optional[str] = None
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

        # Get user with roles for position-specific eligibility checking
        user_result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.roles))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason="User not found",
            )

        # Check position-specific eligibility (if checking for a specific position)
        if position and election.position_eligibility:
            position_rules = election.position_eligibility.get(position)
            if position_rules:
                voter_types = position_rules.get("voter_types", ["all"])
                if not await self._user_has_role_type(user, voter_types):
                    return VoterEligibility(
                        is_eligible=False,
                        has_voted=False,
                        positions_voted=[],
                        positions_remaining=[],
                        reason=f"You do not have the required role type to vote for {position}",
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
            voter_hash=self._generate_voter_hash(user_id, election_id, election.voter_anonymity_salt or "") if election.anonymous_voting else None,
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

    def _generate_voter_hash(
        self, user_id: UUID, election_id: UUID, salt: str = ""
    ) -> str:
        """Generate a keyed hash to track anonymous voters without revealing identity.

        Uses a per-election salt (SEC-12) so that voter hashes cannot be
        pre-computed from known user IDs.  The salt is stored on the Election
        model and can be destroyed after the election closes to make
        de-anonymization permanently impossible.
        """
        import hmac
        data = f"{user_id}:{election_id}"
        return hmac.new(
            key=salt.encode() if salt else b"",
            msg=data.encode(),
            digestmod=hashlib.sha256,
        ).hexdigest()

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
                    position_candidates, position_votes, election, total_eligible
                )

                results_by_position.append(
                    PositionResults(
                        position=position,
                        total_votes=len(position_votes),
                        candidates=candidate_results,
                    )
                )

        # Overall results (all candidates regardless of position)
        overall_results = await self._calculate_candidate_results(candidates, all_votes, election, total_eligible)

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
        self, candidates: List[Candidate], votes: List[Vote], election: Election, total_eligible: int
    ) -> List[CandidateResult]:
        """
        Calculate results for a list of candidates based on configured victory conditions

        Args:
            candidates: List of candidates to calculate results for
            votes: List of votes cast for these candidates
            election: Election instance with victory condition configuration
            total_eligible: Total number of eligible voters

        Returns:
            List of CandidateResult objects with winner flags set
        """
        # Count votes per candidate
        vote_counts = {}
        for vote in votes:
            vote_counts[vote.candidate_id] = vote_counts.get(vote.candidate_id, 0) + 1

        total_votes = len(votes)

        # Build results
        results = []
        for candidate in candidates:
            vote_count = vote_counts.get(candidate.id, 0)

            # Calculate percentage of votes cast
            percentage = (vote_count / total_votes * 100) if total_votes > 0 else 0

            # Calculate percentage of eligible voters (for threshold calculations)
            percentage_of_eligible = (vote_count / total_eligible * 100) if total_eligible > 0 else 0

            results.append(
                CandidateResult(
                    candidate_id=candidate.id,
                    candidate_name=candidate.name,
                    position=candidate.position,
                    vote_count=vote_count,
                    percentage=round(percentage, 2),
                    is_winner=False,  # Will be set below based on victory conditions
                )
            )

        # Sort by vote count (descending)
        results.sort(key=lambda x: x.vote_count, reverse=True)

        # Determine winners based on victory_condition
        if election.victory_condition == "most_votes":
            # Simple plurality - candidate(s) with most votes wins (handles ties)
            if results and results[0].vote_count > 0:
                max_votes = results[0].vote_count
                for result in results:
                    if result.vote_count == max_votes:
                        result.is_winner = True

        elif election.victory_condition == "majority":
            # Requires >50% of total votes cast
            required_votes = (total_votes / 2) + 1
            for result in results:
                if result.vote_count >= required_votes:
                    result.is_winner = True

        elif election.victory_condition == "supermajority":
            # Requires 2/3 of total votes cast (or custom percentage from victory_percentage)
            required_percentage = election.victory_percentage or 67
            for result in results:
                if result.percentage >= required_percentage:
                    result.is_winner = True

        elif election.victory_condition == "threshold":
            # Requires specific number or percentage
            if election.victory_threshold:
                # Numerical threshold (e.g., must receive at least 10 votes)
                for result in results:
                    if result.vote_count >= election.victory_threshold:
                        result.is_winner = True
            elif election.victory_percentage:
                # Percentage threshold (e.g., must receive at least 60% of votes cast)
                for result in results:
                    if result.percentage >= election.victory_percentage:
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

    async def _check_and_create_runoff(
        self, election: Election, organization_id: UUID
    ) -> Optional[Election]:
        """Check if a runoff is needed and create it if so"""
        # Get results to check if there's a winner
        results = await self.get_election_results(
            election.id, organization_id
        )

        if not results:
            return None

        # Check overall results for a winner
        has_winner = any(candidate.is_winner for candidate in results.overall_results)

        # Also check position results if applicable
        if not has_winner and results.results_by_position:
            for position_result in results.results_by_position:
                if not any(c.is_winner for c in position_result.candidates):
                    has_winner = False
                    break
            else:
                has_winner = True

        # If there's a winner, no runoff needed
        if has_winner:
            return None

        # Get all candidates sorted by vote count
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election.id)
            .where(Candidate.accepted == True)
        )
        all_candidates = list(candidates_result.scalars().all())

        if len(all_candidates) < 2:
            return None  # Can't have a runoff with less than 2 candidates

        # Get vote counts for each candidate
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
        )
        all_votes = list(votes_result.scalars().all())

        candidate_vote_counts = {}
        for vote in all_votes:
            candidate_vote_counts[vote.candidate_id] = candidate_vote_counts.get(vote.candidate_id, 0) + 1

        # Sort candidates by vote count
        sorted_candidates = sorted(
            all_candidates,
            key=lambda c: candidate_vote_counts.get(c.id, 0),
            reverse=True
        )

        # Determine which candidates advance to runoff based on runoff_type
        if election.runoff_type == "top_two":
            # Top 2 candidates advance
            advancing_candidates = sorted_candidates[:2]
        elif election.runoff_type == "eliminate_lowest":
            # All except lowest candidate
            advancing_candidates = sorted_candidates[:-1]
        else:
            # Default to top 2
            advancing_candidates = sorted_candidates[:2]

        # Create runoff election
        runoff_start = datetime.utcnow() + timedelta(hours=1)  # Start 1 hour from now
        runoff_end = runoff_start + timedelta(days=1)  # 1 day duration by default

        runoff_election = Election(
            id=uuid4(),
            organization_id=organization_id,
            created_by=election.created_by,
            status=ElectionStatus.DRAFT,
            title=f"{election.title} - Runoff Round {election.runoff_round + 1}",
            description=f"Runoff election for {election.title}. No candidate received the required votes in the previous round.",
            election_type=election.election_type,
            positions=election.positions,
            start_date=runoff_start,
            end_date=runoff_end,
            anonymous_voting=election.anonymous_voting,
            allow_write_ins=False,  # No write-ins in runoffs
            max_votes_per_position=election.max_votes_per_position,
            results_visible_immediately=election.results_visible_immediately,
            eligible_voters=election.eligible_voters,
            voting_method=election.voting_method,
            victory_condition=election.victory_condition,
            victory_threshold=election.victory_threshold,
            victory_percentage=election.victory_percentage,
            enable_runoffs=election.enable_runoffs,
            runoff_type=election.runoff_type,
            max_runoff_rounds=election.max_runoff_rounds,
            is_runoff=True,
            parent_election_id=election.id,
            runoff_round=election.runoff_round + 1,
        )

        self.db.add(runoff_election)
        await self.db.flush()

        # Create candidates for runoff
        for candidate in advancing_candidates:
            runoff_candidate = Candidate(
                id=uuid4(),
                election_id=runoff_election.id,
                user_id=candidate.user_id,
                name=candidate.name,
                position=candidate.position,
                statement=candidate.statement,
                photo_url=candidate.photo_url,
                nomination_date=datetime.utcnow(),
                nominated_by=election.created_by,
                accepted=True,
                is_write_in=False,
                display_order=candidate.display_order,
            )
            self.db.add(runoff_candidate)

        await self.db.commit()
        await self.db.refresh(runoff_election)

        return runoff_election

    async def close_election(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[Election]:
        """Close an election and finalize results, creating runoff if needed"""
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

        # Check if runoffs are enabled and if we should create one
        if election.enable_runoffs and election.runoff_round < election.max_runoff_rounds:
            await self._check_and_create_runoff(election, organization_id)

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

    async def rollback_election(
        self,
        election_id: UUID,
        organization_id: UUID,
        performed_by: UUID,
        reason: str,
    ) -> Tuple[Optional[Election], int, Optional[str]]:
        """
        Rollback an election to a previous status

        Returns: (Election, notifications_sent, error_message)
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, 0, "Election not found"

        # Determine the rollback action based on current status
        from_status = election.status.value
        to_status = None

        if election.status == ElectionStatus.CLOSED:
            # Rollback from closed to open
            to_status = "open"
            new_status = ElectionStatus.OPEN
        elif election.status == ElectionStatus.OPEN:
            # Rollback from open to draft
            to_status = "draft"
            new_status = ElectionStatus.DRAFT
        else:
            return None, 0, f"Cannot rollback election with status {from_status}"

        # Create rollback record
        rollback_record = {
            "timestamp": datetime.utcnow().isoformat(),
            "performed_by": str(performed_by),
            "from_status": from_status,
            "to_status": to_status,
            "reason": reason,
        }

        # Initialize rollback_history if it doesn't exist
        if election.rollback_history is None:
            election.rollback_history = []

        # Add to rollback history
        election.rollback_history.append(rollback_record)

        # Update status
        election.status = new_status
        election.updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(election)

        # Send email notifications to leadership
        notifications_sent = await self._notify_leadership_of_rollback(
            election=election,
            performed_by=performed_by,
            organization_id=organization_id,
            from_status=from_status,
            to_status=to_status,
            reason=reason,
        )

        return election, notifications_sent, None

    async def _notify_leadership_of_rollback(
        self,
        election: Election,
        performed_by: UUID,
        organization_id: UUID,
        from_status: str,
        to_status: str,
        reason: str,
    ) -> int:
        """
        Send email notifications to leadership about election rollback

        Returns: Number of notifications sent
        """
        from app.services.email_service import EmailService

        # Get leadership users (Chief, President, Vice President, Secretary roles)
        leadership_roles = ["chief", "president", "vice_president", "secretary"]

        users_result = await self.db.execute(
            select(User)
            .join(User.roles)
            .where(User.organization_id == organization_id)
            .where(User.is_active == True)
            .options(selectinload(User.roles))
        )
        all_users = users_result.scalars().all()

        # Filter to leadership users
        leadership_users = [
            user for user in all_users
            if any(role.slug in leadership_roles for role in user.roles)
        ]

        if not leadership_users:
            return 0

        # Get the user who performed the rollback
        performer_result = await self.db.execute(
            select(User)
            .where(User.id == performed_by)
        )
        performer = performer_result.scalar_one_or_none()
        performer_name = performer.full_name if performer else "Unknown"

        # Get organization for email service
        org_result = await self.db.execute(
            select(Organization)
            .where(Organization.id == organization_id)
        )
        organization = org_result.scalar_one_or_none()

        if not organization:
            return 0

        # Initialize email service
        email_service = EmailService(organization)

        # Send notifications
        sent_count = 0
        for user in leadership_users:
            # Don't notify the person who performed the rollback
            if user.id == performed_by:
                continue

            subject = f"ALERT: Election Rolled Back - {election.title}"

            html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #dc2626; color: white; padding: 20px; text-align: center; }}
        .alert-badge {{ background-color: #fef2f2; color: #991b1b; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; font-weight: bold; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }}
        .reason {{ background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚠️ Election Rollback Alert</h1>
            <div class="alert-badge">REQUIRES ATTENTION</div>
        </div>
        <div class="content">
            <p>Dear {user.first_name},</p>

            <p>This is an important notification regarding an election rollback.</p>

            <div class="details">
                <h3>Election Details:</h3>
                <ul>
                    <li><strong>Title:</strong> {election.title}</li>
                    <li><strong>Status Changed:</strong> {from_status.upper()} → {to_status.upper()}</li>
                    <li><strong>Performed By:</strong> {performer_name}</li>
                    <li><strong>Date/Time:</strong> {datetime.utcnow().strftime('%B %d, %Y at %I:%M %p UTC')}</li>
                </ul>
            </div>

            <div class="reason">
                <h3>Reason for Rollback:</h3>
                <p>{reason}</p>
            </div>

            <p>This rollback has been logged in the election's audit trail. Please review the election details and coordinate with your team as needed.</p>

            <p>If you have any questions or concerns about this rollback, please contact {performer_name} or review the election at your earliest convenience.</p>

            <p>Best regards,<br>{organization.name} Election System</p>
        </div>
        <div class="footer">
            <p>This is an automated notification from the election management system.</p>
        </div>
    </div>
</body>
</html>
            """

            text_body = f"""ALERT: Election Rolled Back

Dear {user.first_name},

This is an important notification regarding an election rollback.

ELECTION DETAILS:
- Title: {election.title}
- Status Changed: {from_status.upper()} → {to_status.upper()}
- Performed By: {performer_name}
- Date/Time: {datetime.utcnow().strftime('%B %d, %Y at %I:%M %p UTC')}

REASON FOR ROLLBACK:
{reason}

This rollback has been logged in the election's audit trail. Please review the election details and coordinate with your team as needed.

If you have any questions or concerns about this rollback, please contact {performer_name} or review the election at your earliest convenience.

Best regards,
{organization.name} Election System
            """

            try:
                # Send email
                success_count_user, failure_count_user = await email_service.send_email(
                    to_emails=[user.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                )
                if success_count_user > 0:
                    sent_count += 1
            except Exception as e:
                # Log error but continue
                print(f"Failed to send rollback notification to {user.email}: {str(e)}")
                continue

        return sent_count

    async def _generate_voting_token(
        self, user_id: UUID, election_id: UUID, election_end_date: datetime,
        anonymity_salt: str = "",
    ) -> VotingToken:
        """
        Generate a secure voting token for a user-election pair

        Args:
            user_id: User ID (for hashing, not stored directly)
            election_id: Election ID
            election_end_date: Election end date (token expires after this)
            anonymity_salt: Per-election salt for voter anonymity

        Returns:
            VotingToken instance
        """
        # Generate secure random token
        token = secrets.token_urlsafe(64)

        # Generate voter hash (same method as used in voting)
        voter_hash = self._generate_voter_hash(user_id, election_id, anonymity_salt)

        # Token expires when election ends (or 30 days if election is longer)
        max_expiry = datetime.utcnow() + timedelta(days=30)
        expires_at = min(election_end_date, max_expiry)

        voting_token = VotingToken(
            id=uuid4(),
            election_id=election_id,
            token=token,
            voter_hash=voter_hash,
            created_at=datetime.utcnow(),
            expires_at=expires_at,
            used=False,
        )

        self.db.add(voting_token)
        return voting_token

    async def send_ballot_emails(
        self,
        election_id: UUID,
        organization_id: UUID,
        recipient_user_ids: Optional[List[UUID]] = None,
        subject: Optional[str] = None,
        message: Optional[str] = None,
        base_ballot_url: str = None,
    ) -> Tuple[int, int]:
        """
        Send ballot notification emails to eligible voters with unique hashed links

        Returns: (recipients_count, failed_count)
        """
        # Get election with organization
        result = await self.db.execute(
            select(Election, Organization)
            .join(Organization, Election.organization_id == Organization.id)
            .where(Election.id == election_id)
            .where(Election.organization_id == organization_id)
        )
        row = result.one_or_none()

        if not row:
            return 0, 0

        election, organization = row

        # Determine recipients
        if recipient_user_ids:
            # Use specified recipients
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_(recipient_user_ids))
                .where(User.organization_id == organization_id)
            )
            recipients = users_result.scalars().all()
        elif election.eligible_voters:
            # Use election's eligible voters list
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([UUID(uid) for uid in election.eligible_voters]))
                .where(User.organization_id == organization_id)
            )
            recipients = users_result.scalars().all()
        else:
            # Send to all active users in organization
            users_result = await self.db.execute(
                select(User)
                .where(User.organization_id == organization_id)
                .where(User.is_active == True)
            )
            recipients = users_result.scalars().all()

        if not recipients:
            return 0, 0

        # Initialize email service with organization settings
        email_service = EmailService(organization)

        # Send individual ballot emails with unique tokens
        success_count = 0
        failed_count = 0

        for recipient in recipients:
            # Generate unique voting token for this voter
            voting_token = await self._generate_voting_token(
                user_id=recipient.id,
                election_id=election_id,
                election_end_date=election.end_date,
                anonymity_salt=election.voter_anonymity_salt or "",
            )

            # Build unique ballot URL with token
            ballot_url = f"{base_ballot_url}?token={voting_token.token}" if base_ballot_url else None

            sent = await email_service.send_ballot_notification(
                to_email=recipient.email,
                recipient_name=recipient.full_name,
                election_title=election.title,
                ballot_url=ballot_url,
                meeting_date=election.meeting_date,
                custom_message=message,
            )

            if sent:
                success_count += 1
            else:
                failed_count += 1

        # Update election with email sent status
        election.email_sent = True
        election.email_sent_at = datetime.utcnow()
        election.email_recipients = [str(user.id) for user in recipients]

        # Commit all voting tokens and election updates
        await self.db.commit()
        await self.db.refresh(election)

        return success_count, failed_count

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

    async def get_ballot_by_token(
        self, token: str
    ) -> Tuple[Optional[Election], Optional[VotingToken], Optional[str]]:
        """
        Retrieve ballot information using a voting token

        Returns: (Election, VotingToken, error_message)
        """
        # Find the voting token
        result = await self.db.execute(
            select(VotingToken)
            .where(VotingToken.token == token)
        )
        voting_token = result.scalar_one_or_none()

        if not voting_token:
            return None, None, "Invalid voting token"

        # Check if token has expired
        if datetime.utcnow() > voting_token.expires_at:
            return None, None, "Voting token has expired"

        # Check if token has already been used
        if voting_token.used:
            return None, None, "This ballot has already been submitted"

        # Update access tracking
        if not voting_token.first_accessed_at:
            voting_token.first_accessed_at = datetime.utcnow()
        voting_token.access_count += 1
        await self.db.commit()

        # Get the election
        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == voting_token.election_id)
        )
        election = election_result.scalar_one_or_none()

        if not election:
            return None, None, "Election not found"

        # Check if election is still open
        now = datetime.utcnow()
        if election.status != ElectionStatus.OPEN:
            return None, None, f"Election is {election.status.value}"

        if now < election.start_date:
            return None, None, "Voting has not started yet"

        if now > election.end_date:
            return None, None, "Voting has ended"

        return election, voting_token, None

    async def cast_vote_with_token(
        self,
        token: str,
        candidate_id: UUID,
        position: Optional[str],
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[Vote], Optional[str]]:
        """
        Cast a vote using a voting token

        Returns: (Vote object, error_message)
        """
        # Validate token and get ballot
        election, voting_token, error = await self.get_ballot_by_token(token)

        if error:
            return None, error

        # Verify candidate exists and belongs to this election
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.id == candidate_id)
            .where(Candidate.election_id == election.id)
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

        # Check if this token has already voted for this position
        existing_votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
            .where(Vote.voter_hash == voting_token.voter_hash)
            .where(Vote.position == position if position else True)
        )
        existing_votes = existing_votes_result.scalars().all()

        if existing_votes:
            return None, f"You have already voted for {position}" if position else "You have already voted"

        # Check max votes per position
        if position:
            position_votes = [v for v in existing_votes if v.position == position]
            if len(position_votes) >= election.max_votes_per_position:
                return None, f"Maximum votes for {position} reached"

        # Create the vote
        vote = Vote(
            election_id=election.id,
            candidate_id=candidate_id,
            voter_id=None,  # Anonymous - not stored
            voter_hash=voting_token.voter_hash,
            position=position,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.utcnow(),
        )

        self.db.add(vote)

        # Mark token as used if all positions have been voted for
        # For now, mark as used after any vote (can be enhanced for multi-position)
        voting_token.used = True
        voting_token.used_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(vote)

        return vote, None
