"""
Election Service

Business logic for election management including elections, candidates, voting, and results.
"""

from typing import List, Optional, Dict, Tuple
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID, uuid4
import hashlib
import hmac
import os
import secrets

from app.models.election import (
    Election,
    Candidate,
    Vote,
    VotingToken,
    ElectionStatus,
)
from app.models.user import User, Organization
from app.core.constants import (
    LEADERSHIP_ROLE_SLUGS,
    OPERATIONAL_ROLE_SLUGS,
    ADMINISTRATIVE_ROLE_SLUGS,
)
from app.schemas.election import (
    ElectionResults,
    CandidateResult,
    PositionResults,
    ElectionStats,
    VoterEligibility,
)
from app.services.email_service import EmailService
from app.core.audit import log_audit_event
from loguru import logger


class ElectionService:
    """Service for election management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Audit helpers
    # ------------------------------------------------------------------

    async def _audit(
        self,
        event_type: str,
        event_data: Dict,
        severity: str = "info",
        user_id: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        """Log an election event to the tamper-proof audit log."""
        await log_audit_event(
            db=self.db,
            event_type=event_type,
            event_category="elections",
            severity=severity,
            event_data=event_data,
            user_id=user_id,
            ip_address=ip_address,
        )

    async def _user_has_role_type(self, user: User, role_types: List[str]) -> bool:
        """
        Check if a user has any of the specified role types/slugs

        role_types can include:
        - "all" - everyone is eligible
        - "operational" - users with operational roles (firefighter, driver, officer roles)
        - "administrative" - users with administrative roles (secretary, treasurer, etc.)
        - "regular" - active members who are not probationary (regular + life)
        - "life" - life members only
        - "probationary" - probationary members only
        - Specific role slugs like "chief", "president", etc.
        """
        if not role_types or "all" in role_types:
            return True

        from app.models.user import UserStatus

        user_role_slugs = [role.slug for role in user.roles]

        # Check for direct role slug matches
        for role_slug in user_role_slugs:
            if role_slug in role_types:
                return True

        # Check for role type categories
        operational_roles = OPERATIONAL_ROLE_SLUGS
        administrative_roles = ADMINISTRATIVE_ROLE_SLUGS

        if "operational" in role_types:
            if any(slug in operational_roles for slug in user_role_slugs):
                return True

        if "administrative" in role_types:
            if any(slug in administrative_roles for slug in user_role_slugs):
                return True

        # Member class categories based on user status
        # "regular" = active members who are not probationary (includes life members)
        if "regular" in role_types:
            if user.status == UserStatus.ACTIVE:
                return True

        # "life" = members with a "life_member" role slug
        if "life" in role_types:
            if "life_member" in user_role_slugs:
                return True

        # "probationary" = members with probationary status
        if "probationary" in role_types:
            if user.status == UserStatus.PROBATIONARY:
                return True

        return False

    def _is_user_attending(self, user_id: str, election: Election) -> bool:
        """Check if a user is checked in as present at the meeting."""
        if not election.attendees:
            return False
        return any(a.get("user_id") == str(user_id) for a in election.attendees)

    # ------------------------------------------------------------------
    # Meeting attendance management
    # ------------------------------------------------------------------

    async def check_in_attendee(
        self,
        election_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        checked_in_by: UUID,
    ) -> Tuple[Optional[Dict], Optional[str]]:
        """
        Check in a member as present at the meeting for this election.

        Returns: (attendee_record, error_message)
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"

        # Get the user being checked in
        user_result = await self.db.execute(
            select(User).where(User.id == str(user_id)).where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return None, "User not found"

        # Initialize attendees list
        attendees = election.attendees or []

        # Check if already checked in
        if any(a.get("user_id") == str(user_id) for a in attendees):
            return None, "Member is already checked in"

        # Create attendee record
        attendee_record = {
            "user_id": str(user_id),
            "name": user.full_name,
            "checked_in_at": datetime.now(timezone.utc).isoformat(),
            "checked_in_by": str(checked_in_by),
        }
        attendees.append(attendee_record)
        election.attendees = attendees

        await self.db.commit()
        await self.db.refresh(election)

        logger.info(f"Attendee checked in | election={election_id} user={user_id} by={checked_in_by}")
        await self._audit("meeting_attendee_checked_in", {
            "election_id": str(election_id),
            "user_id": str(user_id),
            "name": user.full_name,
        }, user_id=str(checked_in_by))

        return attendee_record, None

    async def remove_attendee(
        self,
        election_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        removed_by: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """
        Remove a member from the attendance list.

        Returns: (success, error_message)
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return False, "Election not found"

        attendees = election.attendees or []
        original_count = len(attendees)
        attendees = [a for a in attendees if a.get("user_id") != str(user_id)]

        if len(attendees) == original_count:
            return False, "Member is not in the attendance list"

        election.attendees = attendees
        await self.db.commit()

        logger.info(f"Attendee removed | election={election_id} user={user_id} by={removed_by}")
        await self._audit("meeting_attendee_removed", {
            "election_id": str(election_id),
            "user_id": str(user_id),
        }, user_id=str(removed_by))

        return True, None

    async def get_attendees(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[List[Dict]]:
        """Get the attendance list for an election."""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None
        return election.attendees or []

    # ------------------------------------------------------------------
    # Ballot templates
    # ------------------------------------------------------------------

    @staticmethod
    def get_ballot_templates() -> List[Dict]:
        """
        Return the available ballot item templates.

        Templates cover common fire department meeting agenda items that
        the secretary can drop onto a ballot with one click.
        """
        return [
            {
                "id": "probationary_to_regular",
                "name": "Probationary to Regular Member",
                "description": "Vote to confirm the transition of a probationary member to regular membership.",
                "type": "membership_approval",
                "vote_type": "approval",
                "eligible_voter_types": ["regular", "life"],
                "require_attendance": True,
                "title_template": "Approve {name} for Regular Membership",
                "description_template": "Vote to approve the transition of {name} from probationary to regular member status.",
            },
            {
                "id": "admin_member_acceptance",
                "name": "Accept Administrative Member",
                "description": "Vote to accept a new administrative (non-operational) member into the roster.",
                "type": "membership_approval",
                "vote_type": "approval",
                "eligible_voter_types": ["all"],
                "require_attendance": True,
                "title_template": "Accept {name} as Administrative Member",
                "description_template": "Vote to accept {name} into the organization as an administrative member.",
            },
            {
                "id": "officer_election",
                "name": "Officer Election",
                "description": "Elect an officer for a specific position. Only operational members vote for operational officers.",
                "type": "officer_election",
                "vote_type": "candidate_selection",
                "eligible_voter_types": ["operational"],
                "require_attendance": True,
                "title_template": "Election for {name}",
                "description_template": "Vote for the {name} position.",
            },
            {
                "id": "board_election",
                "name": "Board/Administrative Election",
                "description": "Elect a board or administrative position. All members may vote.",
                "type": "officer_election",
                "vote_type": "candidate_selection",
                "eligible_voter_types": ["all"],
                "require_attendance": True,
                "title_template": "Election for {name}",
                "description_template": "Vote for the {name} position.",
            },
            {
                "id": "general_resolution",
                "name": "General Resolution",
                "description": "A general yes/no vote on any topic. All present members can vote.",
                "type": "general_vote",
                "vote_type": "approval",
                "eligible_voter_types": ["all"],
                "require_attendance": True,
                "title_template": "{name}",
                "description_template": None,
            },
            {
                "id": "bylaw_amendment",
                "name": "Bylaw Amendment",
                "description": "Vote on a proposed change to the organization's bylaws. Typically requires supermajority.",
                "type": "general_vote",
                "vote_type": "approval",
                "eligible_voter_types": ["regular", "life"],
                "require_attendance": True,
                "title_template": "Bylaw Amendment: {name}",
                "description_template": "Vote on the proposed bylaw amendment regarding {name}.",
            },
            {
                "id": "budget_approval",
                "name": "Budget Approval",
                "description": "Vote to approve a budget or expenditure. All present members can vote.",
                "type": "general_vote",
                "vote_type": "approval",
                "eligible_voter_types": ["all"],
                "require_attendance": True,
                "title_template": "Approve {name}",
                "description_template": "Vote to approve the proposed budget/expenditure: {name}.",
            },
        ]

    async def check_voter_eligibility(
        self, user_id: UUID, election_id: UUID, organization_id: UUID, position: Optional[str] = None
    ) -> VoterEligibility:
        """
        Check if a user is eligible to vote in an election and if they've already voted
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
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
        now = datetime.now(timezone.utc)
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
            .where(User.id == str(user_id))
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

        # ---- Secretary voter override ----
        # If the secretary (or elections manager) has granted this member an
        # override for this election, skip all tier and attendance checks.
        _has_override = False
        if election.voter_overrides:
            _has_override = any(
                o.get("user_id") == str(user_id)
                for o in election.voter_overrides
            )

        # ---- Membership tier voting rules ----
        # Look up the member's tier in org settings and enforce voting_eligible
        # and meeting attendance requirements.
        # (Skipped entirely when the member has a secretary override.)
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        if org and not _has_override:
            tier_config = (org.settings or {}).get("membership_tiers", {})
            tiers = tier_config.get("tiers", [])
            member_tier_id = getattr(user, "membership_type", None) or "active"
            tier_def = next((t for t in tiers if t.get("id") == member_tier_id), None)
            if tier_def:
                benefits = tier_def.get("benefits", {})
                # Check basic voting eligibility for this tier
                if not benefits.get("voting_eligible", True):
                    return VoterEligibility(
                        is_eligible=False,
                        has_voted=False,
                        positions_voted=[],
                        positions_remaining=[],
                        reason=f"Members at the '{tier_def.get('name', member_tier_id)}' tier are not eligible to vote",
                    )
                # Check meeting attendance requirement
                if benefits.get("voting_requires_meeting_attendance", False):
                    min_pct = benefits.get("voting_min_attendance_pct", 0.0)
                    period = benefits.get("voting_attendance_period_months", 12)
                    if min_pct > 0:
                        from app.services.membership_tier_service import MembershipTierService
                        tier_svc = MembershipTierService(self.db)
                        actual_pct = await tier_svc.get_meeting_attendance_pct(
                            user_id=str(user_id),
                            organization_id=str(organization_id),
                            period_months=period,
                        )
                        if actual_pct < min_pct:
                            return VoterEligibility(
                                is_eligible=False,
                                has_voted=False,
                                positions_voted=[],
                                positions_remaining=[],
                                reason=(
                                    f"Your meeting attendance is {actual_pct:.1f}% over the last "
                                    f"{period} months, below the {min_pct:.0f}% minimum required to vote"
                                ),
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

        # Check ballot item eligibility (member class + attendance)
        if position and election.ballot_items:
            matching_items = [
                item for item in election.ballot_items
                if item.get("position") == position or item.get("title") == position
            ]
            for item in matching_items:
                # Check member class / role eligibility
                eligible_types = item.get("eligible_voter_types", ["all"])
                if not await self._user_has_role_type(user, eligible_types):
                    return VoterEligibility(
                        is_eligible=False,
                        has_voted=False,
                        positions_voted=[],
                        positions_remaining=[],
                        reason=f"Your member class is not eligible to vote on this item",
                    )
                # Check attendance requirement
                if item.get("require_attendance", False):
                    if not self._is_user_attending(str(user_id), election):
                        return VoterEligibility(
                            is_eligible=False,
                            has_voted=False,
                            positions_voted=[],
                            positions_remaining=[],
                            reason="You must be checked in as present at the meeting to vote on this item",
                        )

        # Check what positions they've already voted for
        # For anonymous elections, lookup by voter_hash since voter_id is NULL
        if election.anonymous_voting:
            voter_hash = self._generate_voter_hash(
                user_id, election_id, election.voter_anonymity_salt or ""
            )
            vote_result = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_hash == voter_hash)
                .where(Vote.deleted_at.is_(None))
            )
        else:
            vote_result = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_id == str(user_id))
                .where(Vote.deleted_at.is_(None))
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
        vote_rank: Optional[int] = None,
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
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
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
            .where(Candidate.id == str(candidate_id))
            .where(Candidate.election_id == str(election_id))
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
            position_votes = [v for v in await self._get_user_votes(user_id, election_id, election) if v.position == position]
            if len(position_votes) >= election.max_votes_per_position:
                return None, f"Maximum votes for {position} reached"

        # Create the vote
        vote = Vote(
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=user_id if not election.anonymous_voting else None,
            voter_hash=self._generate_voter_hash(user_id, election_id, election.voter_anonymity_salt or "") if election.anonymous_voting else None,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc),
        )

        # Sign the vote for tampering detection
        vote.vote_signature = self._sign_vote(vote)

        self.db.add(vote)

        # SECURITY: Database-level constraint prevents double-voting
        # even if race condition bypasses application-level checks
        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            # Caught by unique constraint - duplicate vote attempted
            await self.db.rollback()
            logger.warning(
                "Double-vote attempt blocked by DB constraint | "
                f"election={election_id} position={position} anonymous={election.anonymous_voting}"
            )
            await self._audit("vote_double_attempt", {
                "election_id": str(election_id),
                "position": position,
                "anonymous": election.anonymous_voting,
            }, severity="warning", user_id=str(user_id), ip_address=ip_address)
            if position:
                return None, f"Database integrity check: You have already voted for {position}"
            return None, "Database integrity check: You have already voted in this election"

        # Audit & log the successful vote
        logger.info(
            f"Vote cast | election={election_id} position={position} "
            f"anonymous={election.anonymous_voting} vote_id={vote.id}"
        )
        await self._audit("vote_cast", {
            "election_id": str(election_id),
            "vote_id": str(vote.id),
            "position": position,
            "anonymous": election.anonymous_voting,
        }, user_id=str(user_id), ip_address=ip_address)

        return vote, None

    async def _get_user_votes(
        self, user_id: UUID, election_id: UUID, election: Optional[Election] = None
    ) -> List[Vote]:
        """Get all active (non-deleted) votes by a user in an election (handles anonymous voting)"""
        # For anonymous elections, lookup by voter_hash since voter_id is NULL
        if election and election.anonymous_voting:
            voter_hash = self._generate_voter_hash(
                user_id, election_id, election.voter_anonymity_salt or ""
            )
            result = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_hash == voter_hash)
                .where(Vote.deleted_at.is_(None))
            )
        else:
            result = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_id == str(user_id))
                .where(Vote.deleted_at.is_(None))
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
        data = f"{user_id}:{election_id}"
        return hmac.new(
            key=salt.encode() if salt else b"",
            msg=data.encode(),
            digestmod=hashlib.sha256,
        ).hexdigest()

    def _sign_vote(self, vote: Vote) -> str:
        """Generate a cryptographic signature for a vote to detect tampering.

        The signature covers all immutable vote fields so any modification
        (changing candidate, deleting and re-inserting, etc.) will produce
        a different signature.
        """
        signing_key = os.environ.get("VOTE_SIGNING_KEY", "default-signing-key")
        data = f"{vote.id}:{vote.election_id}:{vote.candidate_id}:{vote.voter_hash or vote.voter_id}:{vote.position}:{vote.voted_at.isoformat()}"
        return hmac.new(
            key=signing_key.encode(),
            msg=data.encode(),
            digestmod=hashlib.sha256,
        ).hexdigest()

    async def verify_vote_integrity(
        self, election_id: UUID, organization_id: UUID
    ) -> Dict:
        """Verify the cryptographic integrity of all votes in an election.

        Returns a summary with total votes checked, valid count, and any
        tampered vote IDs.
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return {"error": "Election not found"}

        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        all_votes = votes_result.scalars().all()

        total = len(all_votes)
        valid = 0
        tampered = []
        unsigned = 0

        for vote in all_votes:
            if not vote.vote_signature:
                unsigned += 1
                continue
            expected = self._sign_vote(vote)
            if vote.vote_signature == expected:
                valid += 1
            else:
                tampered.append(str(vote.id))

        integrity_status = "PASS" if len(tampered) == 0 else "FAIL"

        if tampered:
            logger.critical(
                f"VOTE INTEGRITY FAILURE | election={election_id} "
                f"tampered={len(tampered)} ids={tampered}"
            )
        else:
            logger.info(f"Vote integrity check PASS | election={election_id} total={total}")

        await self._audit("vote_integrity_check", {
            "election_id": str(election_id),
            "total_votes": total,
            "valid_signatures": valid,
            "tampered_votes": len(tampered),
            "integrity_status": integrity_status,
        }, severity="critical" if tampered else "info")

        return {
            "election_id": str(election_id),
            "total_votes": total,
            "valid_signatures": valid,
            "unsigned_votes": unsigned,
            "tampered_votes": len(tampered),
            "tampered_vote_ids": tampered,
            "integrity_status": integrity_status,
        }

    async def soft_delete_vote(
        self, vote_id: UUID, deleted_by: UUID, reason: str
    ) -> Optional[Vote]:
        """Soft-delete a vote with audit trail instead of hard-deleting."""
        result = await self.db.execute(
            select(Vote).where(Vote.id == str(vote_id)).where(Vote.deleted_at.is_(None))
        )
        vote = result.scalar_one_or_none()
        if not vote:
            return None

        vote.deleted_at = datetime.now(timezone.utc)
        vote.deleted_by = str(deleted_by)
        vote.deletion_reason = reason
        await self.db.commit()
        await self.db.refresh(vote)

        logger.warning(
            f"Vote soft-deleted | vote={vote_id} election={vote.election_id} "
            f"by={deleted_by} reason={reason!r}"
        )
        await self._audit("vote_soft_deleted", {
            "vote_id": str(vote_id),
            "election_id": str(vote.election_id),
            "reason": reason,
        }, severity="warning", user_id=str(deleted_by))

        return vote

    async def get_election_forensics(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[Dict]:
        """
        Aggregate all forensic data for an election into a single report.

        Pulls together:
        - Election metadata and configuration
        - Vote integrity check results
        - Soft-deleted votes with reasons
        - Rollback history
        - Voting token access logs
        - Audit log entries for this election
        """
        from app.models.audit import AuditLog

        # Get election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None

        # 1. Vote integrity
        integrity = await self.verify_vote_integrity(election_id, organization_id)

        # 2. Soft-deleted votes
        deleted_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.isnot(None))
        )
        deleted_votes = deleted_result.scalars().all()

        deleted_records = [
            {
                "vote_id": str(v.id),
                "candidate_id": str(v.candidate_id),
                "position": v.position,
                "deleted_at": v.deleted_at.isoformat() if v.deleted_at else None,
                "deleted_by": v.deleted_by,
                "deletion_reason": v.deletion_reason,
            }
            for v in deleted_votes
        ]

        # 3. Voting token access logs
        token_result = await self.db.execute(
            select(VotingToken)
            .where(VotingToken.election_id == str(election_id))
        )
        tokens = token_result.scalars().all()

        token_records = [
            {
                "token_id": str(t.id),
                "used": t.used,
                "used_at": t.used_at.isoformat() if t.used_at else None,
                "first_accessed_at": t.first_accessed_at.isoformat() if t.first_accessed_at else None,
                "access_count": t.access_count,
                "positions_voted": t.positions_voted,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "expires_at": t.expires_at.isoformat() if t.expires_at else None,
            }
            for t in tokens
        ]

        # 4. Audit log entries for this election
        audit_result = await self.db.execute(
            select(AuditLog)
            .where(AuditLog.event_category == "elections")
            .where(AuditLog.event_data["election_id"].as_string() == str(election_id))
            .order_by(AuditLog.timestamp.desc())
            .limit(200)
        )
        audit_entries = audit_result.scalars().all()

        audit_records = [
            {
                "id": entry.id,
                "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
                "event_type": entry.event_type,
                "severity": entry.severity.value if entry.severity else None,
                "user_id": entry.user_id,
                "ip_address": entry.ip_address,
                "event_data": entry.event_data,
            }
            for entry in audit_entries
        ]

        # 5. Active vote statistics by IP (detect ballot stuffing patterns)
        active_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        active_votes = active_result.scalars().all()

        ip_vote_counts: Dict[str, int] = {}
        for v in active_votes:
            ip = v.ip_address or "unknown"
            ip_vote_counts[ip] = ip_vote_counts.get(ip, 0) + 1

        # Flag IPs with suspiciously high vote counts (> 5 from same IP)
        suspicious_ips = {ip: count for ip, count in ip_vote_counts.items() if count > 5 and ip != "unknown"}

        # 6. Voting timeline (votes per hour)
        voting_timeline: Dict[str, int] = {}
        for v in active_votes:
            hour_key = v.voted_at.strftime("%Y-%m-%d %H:00") if v.voted_at else "unknown"
            voting_timeline[hour_key] = voting_timeline.get(hour_key, 0) + 1

        logger.info(f"Forensics report generated | election={election_id}")
        await self._audit("forensics_report_generated", {
            "election_id": str(election_id),
            "title": election.title,
        })

        # 7. Proxy voting summary
        proxy_votes = [v for v in active_votes if v.is_proxy_vote]
        proxy_vote_records = [
            {
                "vote_id": str(v.id),
                "position": v.position,
                "proxy_voter_id": v.proxy_voter_id,
                "delegating_user_id": v.proxy_delegating_user_id,
                "authorization_id": v.proxy_authorization_id,
                "voted_at": v.voted_at.isoformat() if v.voted_at else None,
            }
            for v in proxy_votes
        ]

        return {
            "election_id": str(election_id),
            "election_title": election.title,
            "election_status": election.status.value,
            "anonymous_voting": election.anonymous_voting,
            "voting_method": election.voting_method,
            "created_at": election.created_at.isoformat() if election.created_at else None,

            "vote_integrity": integrity,

            "deleted_votes": {
                "count": len(deleted_records),
                "records": deleted_records,
            },

            "rollback_history": election.rollback_history or [],

            "voting_tokens": {
                "total_issued": len(token_records),
                "total_used": sum(1 for t in token_records if t["used"]),
                "records": token_records,
            },

            "audit_log": {
                "total_entries": len(audit_records),
                "entries": audit_records,
            },

            "anomaly_detection": {
                "suspicious_ips": suspicious_ips,
                "ip_vote_distribution": ip_vote_counts,
            },

            "proxy_voting": {
                "authorizations": election.proxy_authorizations or [],
                "total_proxy_votes": len(proxy_vote_records),
                "proxy_votes": proxy_vote_records,
            },

            "voting_timeline": voting_timeline,
        }

    async def get_election_results(
        self, election_id: UUID, organization_id: UUID, user_id: Optional[UUID] = None
    ) -> Optional[ElectionResults]:
        """
        Get comprehensive election results

        SECURITY CRITICAL: Results are only visible AFTER election closing time.

        Before the election closes, use get_election_stats() to view:
        - Number of issued ballots (total_eligible_voters)
        - Number of received ballots (total_votes_cast)

        Results visibility rules:
        1. Election end_date must have passed (current time > end_date)
        2. Election status must be CLOSED
        3. OR results_visible_immediately flag is True (override for instant results)

        This prevents election manipulation and ensures integrity by not revealing
        results until voting has officially ended.
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        # SECURITY: Check if results can be viewed
        # Results are ONLY visible after the election closing time has passed
        current_time = datetime.now(timezone.utc)
        election_has_closed = current_time > election.end_date

        can_view = (
            (election.status == ElectionStatus.CLOSED and election_has_closed)
            or election.results_visible_immediately
        )

        if not can_view:
            # Before closing: use get_election_stats() for ballot counts only
            return None

        # Get all active (non-deleted) votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        all_votes = votes_result.scalars().all()

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
        )
        candidates = candidates_result.scalars().all()

        # Count total eligible voters
        if election.eligible_voters:
            total_eligible = len(election.eligible_voters)
        else:
            # Count all active users in organization
            users_result = await self.db.execute(
                select(func.count(User.id))
                .where(User.organization_id == str(organization_id))
                .where(User.is_active == True)  # noqa: E712
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
        Calculate results for a list of candidates based on configured voting method
        and victory conditions.

        Supports:
        - simple_majority: Standard first-past-the-post counting
        - ranked_choice: Instant-runoff voting with iterative elimination
        - approval: Each vote counts equally; most approvals wins
        - supermajority: Standard counting with higher threshold

        Returns:
            List of CandidateResult objects with winner flags set
        """
        if election.voting_method == "ranked_choice":
            return self._calculate_ranked_choice_results(candidates, votes, election, total_eligible)

        # Standard counting for simple_majority, approval, and supermajority
        # For approval voting, every vote counts equally (no ranking)
        vote_counts: Dict[str, int] = {}
        for vote in votes:
            vote_counts[vote.candidate_id] = vote_counts.get(vote.candidate_id, 0) + 1

        # For approval voting, total_votes = number of unique voters (not total ballots)
        if election.voting_method == "approval":
            if election.anonymous_voting:
                total_votes = len(set(v.voter_hash for v in votes if v.voter_hash))
            else:
                total_votes = len(set(v.voter_id for v in votes if v.voter_id))
            # If no unique voter tracking possible, fall back to total votes
            if total_votes == 0:
                total_votes = len(votes)
        else:
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
                    is_winner=False,
                )
            )

        results.sort(key=lambda x: x.vote_count, reverse=True)

        # Determine winners based on victory_condition
        if election.victory_condition == "most_votes":
            if results and results[0].vote_count > 0:
                max_votes = results[0].vote_count
                for result in results:
                    if result.vote_count == max_votes:
                        result.is_winner = True

        elif election.victory_condition == "majority":
            required_votes = (total_votes / 2) + 1
            for result in results:
                if result.vote_count >= required_votes:
                    result.is_winner = True

        elif election.victory_condition == "supermajority":
            required_percentage = election.victory_percentage or 67
            for result in results:
                if result.percentage >= required_percentage:
                    result.is_winner = True

        elif election.victory_condition == "threshold":
            if election.victory_threshold:
                for result in results:
                    if result.vote_count >= election.victory_threshold:
                        result.is_winner = True
            elif election.victory_percentage:
                for result in results:
                    if result.percentage >= election.victory_percentage:
                        result.is_winner = True

        return results

    def _calculate_ranked_choice_results(
        self, candidates: List[Candidate], votes: List[Vote], election: Election, total_eligible: int
    ) -> List[CandidateResult]:
        """
        Instant-runoff voting (ranked-choice) calculation.

        Algorithm:
        1. Count first-choice votes for each candidate
        2. If a candidate has >50% of votes, they win
        3. Otherwise, eliminate the candidate with fewest first-choice votes
        4. Redistribute their votes to next-ranked choices
        5. Repeat until a winner is found or only one candidate remains
        """
        candidate_map = {str(c.id): c for c in candidates}
        active_candidates = set(candidate_map.keys())

        # Group votes by voter (voter_hash or voter_id)
        voter_ballots: Dict[str, List[Vote]] = {}
        for vote in votes:
            voter_key = vote.voter_hash or str(vote.voter_id) or vote.id
            if voter_key not in voter_ballots:
                voter_ballots[voter_key] = []
            voter_ballots[voter_key].append(vote)

        # Sort each voter's ballot by rank
        for voter_key in voter_ballots:
            voter_ballots[voter_key].sort(key=lambda v: v.vote_rank or 999)

        # Track final vote counts and elimination order
        final_counts: Dict[str, int] = {cid: 0 for cid in active_candidates}
        total_voters = len(voter_ballots)
        winner_id = None

        # Run elimination rounds
        max_rounds = len(candidates)
        for _round in range(max_rounds):
            # Count first valid choice for each voter
            round_counts: Dict[str, int] = {cid: 0 for cid in active_candidates}

            for voter_key, ballot in voter_ballots.items():
                for vote in ballot:
                    cid = str(vote.candidate_id)
                    if cid in active_candidates:
                        round_counts[cid] += 1
                        break

            final_counts = round_counts

            # Check for majority winner
            for cid, count in round_counts.items():
                if total_voters > 0 and count > total_voters / 2:
                    winner_id = cid
                    break

            if winner_id:
                break

            # If only one candidate remains, they win
            if len(active_candidates) <= 1:
                winner_id = next(iter(active_candidates)) if active_candidates else None
                break

            # Eliminate candidate with fewest votes
            min_count = min(round_counts.values())
            # Get all candidates tied at the bottom
            bottom_candidates = [cid for cid, count in round_counts.items() if count == min_count]
            # Eliminate the first one (stable tie-breaking by ID)
            eliminated = sorted(bottom_candidates)[0]
            active_candidates.discard(eliminated)

        # If no winner after all rounds, last standing candidate wins
        if not winner_id and active_candidates:
            winner_id = max(active_candidates, key=lambda cid: final_counts.get(cid, 0))

        # Build results
        total_counted = sum(final_counts.values())
        results = []
        for candidate in candidates:
            cid = str(candidate.id)
            vote_count = final_counts.get(cid, 0)
            percentage = (vote_count / total_counted * 100) if total_counted > 0 else 0

            results.append(
                CandidateResult(
                    candidate_id=candidate.id,
                    candidate_name=candidate.name,
                    position=candidate.position,
                    vote_count=vote_count,
                    percentage=round(percentage, 2),
                    is_winner=(cid == winner_id),
                )
            )

        results.sort(key=lambda x: x.vote_count, reverse=True)
        return results

    async def get_election_stats(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[ElectionStats]:
        """
        Get election statistics including ballot counts

        This method can be called BEFORE the election closes to view:
        - Number of issued ballots (total_eligible_voters)
        - Number of received ballots (total_votes_cast)
        - Voter turnout percentage
        - Total unique voters

        This does NOT reveal individual candidate vote counts or results.
        For full results with candidate breakdowns, use get_election_results()
        which is only accessible after the election closing time.
        """
        # Get the election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        # Get all active (non-deleted) votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        all_votes = votes_result.scalars().all()

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
        )
        total_candidates = len(candidates_result.scalars().all())

        # Count eligible voters
        if election.eligible_voters:
            total_eligible = len(election.eligible_voters)
        else:
            users_result = await self.db.execute(
                select(func.count(User.id))
                .where(User.organization_id == str(organization_id))
                .where(User.is_active == True)  # noqa: E712
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
            .where(Candidate.accepted == True)  # noqa: E712
        )
        all_candidates = list(candidates_result.scalars().all())

        if len(all_candidates) < 2:
            return None  # Can't have a runoff with less than 2 candidates

        # Get vote counts for each candidate (exclude soft-deleted)
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
            .where(Vote.deleted_at.is_(None))
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
        runoff_start = datetime.now(timezone.utc) + timedelta(hours=1)  # Start 1 hour from now
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
                nomination_date=datetime.now(timezone.utc),
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
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()

        if not election:
            return None

        if election.status == ElectionStatus.CLOSED:
            return election

        # Only OPEN elections can be closed
        if election.status != ElectionStatus.OPEN:
            return None

        election.status = ElectionStatus.CLOSED
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(f"Election closed | election={election_id} title={election.title!r}")
        await self._audit("election_closed", {
            "election_id": str(election_id),
            "title": election.title,
        })

        # Check if runoffs are enabled and if we should create one
        if election.enable_runoffs and election.runoff_round < election.max_runoff_rounds:
            runoff = await self._check_and_create_runoff(election, organization_id)
            if runoff:
                logger.info(
                    f"Runoff created | parent={election_id} runoff={runoff.id} round={runoff.runoff_round}"
                )
                await self._audit("runoff_election_created", {
                    "parent_election_id": str(election_id),
                    "runoff_election_id": str(runoff.id),
                    "runoff_round": runoff.runoff_round,
                })

        return election

    async def open_election(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Open an election for voting"""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        if election.status != ElectionStatus.DRAFT:
            return None, f"Cannot open election with status {election.status.value}"

        # Validate election has at least one candidate
        candidates_result = await self.db.execute(
            select(func.count(Candidate.id))
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.accepted == True)  # noqa: E712
        )
        candidate_count = candidates_result.scalar() or 0

        if candidate_count == 0:
            return None, "Election must have at least one accepted candidate"

        election.status = ElectionStatus.OPEN
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(f"Election opened | election={election_id} title={election.title!r}")
        await self._audit("election_opened", {
            "election_id": str(election_id),
            "title": election.title,
            "candidate_count": candidate_count,
        })

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
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
        election.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(election)

        logger.warning(
            f"Election rolled back | election={election_id} "
            f"{from_status} -> {to_status} by={performed_by} reason={reason!r}"
        )
        await self._audit("election_rollback", {
            "election_id": str(election_id),
            "title": election.title,
            "from_status": from_status,
            "to_status": to_status,
            "reason": reason,
        }, severity="warning", user_id=str(performed_by))

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
        leadership_roles = LEADERSHIP_ROLE_SLUGS

        users_result = await self.db.execute(
            select(User)
            .join(User.roles)
            .where(User.organization_id == str(organization_id))
            .where(User.is_active == True)  # noqa: E712
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
            .where(User.id == str(performed_by))
        )
        performer = performer_result.scalar_one_or_none()
        performer_name = performer.full_name if performer else "Unknown"

        # Get organization for email service
        org_result = await self.db.execute(
            select(Organization)
            .where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        if not organization:
            return 0

        # Initialize email service
        email_service = EmailService(organization)

        # HTML-escape user-supplied data to prevent injection in emails
        import html
        safe_title = html.escape(election.title)
        safe_performer = html.escape(performer_name)
        safe_reason = html.escape(reason)
        safe_org_name = html.escape(organization.name)

        # Send notifications
        sent_count = 0
        for user in leadership_users:
            # Don't notify the person who performed the rollback
            if user.id == performed_by:
                continue

            subject = f"ALERT: Election Rolled Back - {election.title}"

            safe_first_name = html.escape(user.first_name)

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
            <p>Dear {safe_first_name},</p>

            <p>This is an important notification regarding an election rollback.</p>

            <div class="details">
                <h3>Election Details:</h3>
                <ul>
                    <li><strong>Title:</strong> {safe_title}</li>
                    <li><strong>Status Changed:</strong> {from_status.upper()} → {to_status.upper()}</li>
                    <li><strong>Performed By:</strong> {safe_performer}</li>
                    <li><strong>Date/Time:</strong> {datetime.now(timezone.utc).astimezone(ZoneInfo(getattr(organization, 'timezone', 'America/New_York'))).strftime('%B %d, %Y at %I:%M %p')}</li>
                </ul>
            </div>

            <div class="reason">
                <h3>Reason for Rollback:</h3>
                <p>{safe_reason}</p>
            </div>

            <p>This rollback has been logged in the election's audit trail. Please review the election details and coordinate with your team as needed.</p>

            <p>If you have any questions or concerns about this rollback, please contact {safe_performer} or review the election at your earliest convenience.</p>

            <p>Best regards,<br>{safe_org_name} Election System</p>
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
- Date/Time: {datetime.now(timezone.utc).astimezone(ZoneInfo(getattr(organization, 'timezone', 'America/New_York'))).strftime('%B %d, %Y at %I:%M %p')}

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
                logger.error(f"Failed to send rollback notification to {user.email}: {e}")
                continue

        return sent_count

    async def _notify_leadership_of_deletion(
        self,
        election: Election,
        performed_by: UUID,
        organization_id: UUID,
        reason: str,
        vote_count: int = 0,
    ) -> int:
        """
        Send critical email notifications to all leadership about an election deletion.

        This is triggered when a non-draft election (open or closed) is deleted,
        which is a major red-flag event.

        Returns: Number of notifications sent
        """
        from app.services.email_service import EmailService

        leadership_roles = LEADERSHIP_ROLE_SLUGS

        users_result = await self.db.execute(
            select(User)
            .join(User.roles)
            .where(User.organization_id == str(organization_id))
            .where(User.is_active == True)  # noqa: E712
            .options(selectinload(User.roles))
        )
        all_users = users_result.scalars().all()

        leadership_users = [
            user for user in all_users
            if any(role.slug in leadership_roles for role in user.roles)
        ]

        if not leadership_users:
            return 0

        performer_result = await self.db.execute(
            select(User).where(User.id == str(performed_by))
        )
        performer = performer_result.scalar_one_or_none()
        performer_name = performer.full_name if performer else "Unknown"

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        if not organization:
            return 0

        email_service = EmailService(organization)

        import html
        safe_title = html.escape(election.title)
        safe_performer = html.escape(performer_name)
        safe_reason = html.escape(reason)
        safe_org_name = html.escape(organization.name)
        election_status = election.status.value.upper()

        sent_count = 0
        for user in leadership_users:
            safe_first_name = html.escape(user.first_name)

            subject = f"CRITICAL: Election DELETED - {election.title}"

            html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #7f1d1d; color: white; padding: 20px; text-align: center; }}
        .critical-badge {{ background-color: #fef2f2; color: #991b1b; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; font-weight: bold; font-size: 16px; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-left: 4px solid #7f1d1d; margin: 15px 0; }}
        .reason {{ background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }}
        .warning {{ background-color: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>ELECTION DELETED</h1>
            <div class="critical-badge">CRITICAL - REQUIRES IMMEDIATE ATTENTION</div>
        </div>
        <div class="content">
            <p>Dear {safe_first_name},</p>

            <div class="warning">
                <p><strong>An election has been permanently deleted while in {election_status} status.</strong></p>
                <p>This is a critical action that has been automatically flagged. All leadership members have been notified.</p>
            </div>

            <div class="details">
                <h3>Election Details:</h3>
                <ul>
                    <li><strong>Title:</strong> {safe_title}</li>
                    <li><strong>Status at Deletion:</strong> {election_status}</li>
                    <li><strong>Active Votes at Deletion:</strong> {vote_count}</li>
                    <li><strong>Deleted By:</strong> {safe_performer}</li>
                    <li><strong>Date/Time:</strong> {datetime.now(timezone.utc).astimezone(ZoneInfo(getattr(organization, 'timezone', 'America/New_York'))).strftime('%B %d, %Y at %I:%M %p')}</li>
                </ul>
            </div>

            <div class="reason">
                <h3>Reason Given:</h3>
                <p>{safe_reason}</p>
            </div>

            <p>This deletion has been logged in the audit trail with <strong>CRITICAL</strong> severity. Please review this action and coordinate with your team immediately if this was not authorized.</p>

            <p>Best regards,<br>{safe_org_name} Election System</p>
        </div>
        <div class="footer">
            <p>This is an automated critical notification from the election management system.</p>
        </div>
    </div>
</body>
</html>
            """

            text_body = f"""CRITICAL: Election DELETED

Dear {user.first_name},

An election has been permanently deleted while in {election_status} status.
This is a critical action that has been automatically flagged. All leadership members have been notified.

ELECTION DETAILS:
- Title: {election.title}
- Status at Deletion: {election_status}
- Active Votes at Deletion: {vote_count}
- Deleted By: {performer_name}
- Date/Time: {datetime.now(timezone.utc).astimezone(ZoneInfo(getattr(organization, 'timezone', 'America/New_York'))).strftime('%B %d, %Y at %I:%M %p')}

REASON GIVEN:
{reason}

This deletion has been logged in the audit trail with CRITICAL severity. Please review this action and coordinate with your team immediately if this was not authorized.

Best regards,
{organization.name} Election System
            """

            try:
                success_count_user, failure_count_user = await email_service.send_email(
                    to_emails=[user.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                )
                if success_count_user > 0:
                    sent_count += 1
            except Exception as e:
                logger.error(f"Failed to send deletion notification to {user.email}: {e}")
                continue

        return sent_count

    async def _generate_voting_token(
        self, user_id: UUID, election_id: UUID, organization_id: UUID,
        election_end_date: datetime, anonymity_salt: str = "",
    ) -> VotingToken:
        """
        Generate a secure voting token for a user-election pair

        Args:
            user_id: User ID (for hashing, not stored directly)
            election_id: Election ID
            organization_id: Organization ID for tenant isolation
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
        max_expiry = datetime.now(timezone.utc) + timedelta(days=30)
        expires_at = min(election_end_date, max_expiry)

        voting_token = VotingToken(
            id=uuid4(),
            organization_id=organization_id,
            election_id=election_id,
            token=token,
            voter_hash=voter_hash,
            created_at=datetime.now(timezone.utc),
            expires_at=expires_at,
            used=False,
        )

        self.db.add(voting_token)
        return voting_token

    # ------------------------------------------------------------------
    # Proxy voting
    # ------------------------------------------------------------------

    def _is_proxy_voting_enabled(self, organization: "Organization") -> bool:
        """Check if the organization has opted in to proxy voting."""
        return (organization.settings or {}).get("proxy_voting", {}).get("enabled", False)

    async def add_proxy_authorization(
        self,
        election_id: UUID,
        organization_id: UUID,
        delegating_user_id: UUID,
        proxy_user_id: UUID,
        proxy_type: str,
        reason: str,
        authorized_by: UUID,
    ) -> Tuple[Optional[Dict], Optional[str]]:
        """
        Authorize one member to vote on behalf of another.

        Returns: (authorization_record, error_message)
        """
        # Load election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"

        # Check org-level proxy voting setting
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        if not org or not self._is_proxy_voting_enabled(org):
            return None, "Proxy voting is not enabled for this organization"

        # Cannot be your own proxy
        if str(delegating_user_id) == str(proxy_user_id):
            return None, "A member cannot be their own proxy"

        # Verify both users exist in the same org
        for uid, label in [(delegating_user_id, "Delegating member"), (proxy_user_id, "Proxy member")]:
            u_result = await self.db.execute(
                select(User).where(User.id == str(uid)).where(User.organization_id == str(organization_id))
            )
            if not u_result.scalar_one_or_none():
                return None, f"{label} not found"

        delegating_result = await self.db.execute(select(User).where(User.id == str(delegating_user_id)))
        delegating_user = delegating_result.scalar_one()
        proxy_result = await self.db.execute(select(User).where(User.id == str(proxy_user_id)))
        proxy_user = proxy_result.scalar_one()
        auth_result = await self.db.execute(select(User).where(User.id == str(authorized_by)))
        authorizer = auth_result.scalar_one()

        authorizations = election.proxy_authorizations or []

        # Prevent duplicate active authorization for the same delegating member
        for auth in authorizations:
            if auth.get("delegating_user_id") == str(delegating_user_id) and not auth.get("revoked_at"):
                return None, f"{delegating_user.full_name} already has an active proxy authorization for this election"

        auth_record = {
            "id": str(uuid4()),
            "delegating_user_id": str(delegating_user_id),
            "delegating_user_name": delegating_user.full_name,
            "proxy_user_id": str(proxy_user_id),
            "proxy_user_name": proxy_user.full_name,
            "proxy_type": proxy_type,
            "reason": reason,
            "authorized_by": str(authorized_by),
            "authorized_by_name": authorizer.full_name,
            "authorized_at": datetime.now(timezone.utc).isoformat(),
            "revoked_at": None,
        }
        authorizations.append(auth_record)
        election.proxy_authorizations = authorizations

        await self.db.commit()

        await self._audit("proxy_authorization_granted", {
            "election_id": str(election_id),
            "election_title": election.title,
            "delegating_user_id": str(delegating_user_id),
            "delegating_user_name": delegating_user.full_name,
            "proxy_user_id": str(proxy_user_id),
            "proxy_user_name": proxy_user.full_name,
            "proxy_type": proxy_type,
            "reason": reason,
        }, severity="warning", user_id=str(authorized_by))

        logger.info(
            f"Proxy authorization granted | election={election_id} "
            f"delegating={delegating_user_id} ({delegating_user.full_name}) "
            f"proxy={proxy_user_id} ({proxy_user.full_name}) "
            f"type={proxy_type} by={authorized_by}"
        )

        return auth_record, None

    async def revoke_proxy_authorization(
        self,
        election_id: UUID,
        organization_id: UUID,
        authorization_id: str,
        revoked_by: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """Revoke a proxy authorization. Cannot revoke if the proxy vote has already been cast."""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return False, "Election not found"

        authorizations = election.proxy_authorizations or []
        found = False
        for auth in authorizations:
            if auth.get("id") == authorization_id:
                if auth.get("revoked_at"):
                    return False, "This proxy authorization has already been revoked"
                # Check if a proxy vote has already been cast using this authorization
                vote_result = await self.db.execute(
                    select(Vote)
                    .where(Vote.election_id == str(election_id))
                    .where(Vote.proxy_authorization_id == authorization_id)
                    .where(Vote.deleted_at.is_(None))
                )
                if vote_result.scalar_one_or_none():
                    return False, "Cannot revoke — the proxy has already cast a vote using this authorization"

                auth["revoked_at"] = datetime.now(timezone.utc).isoformat()
                found = True
                break

        if not found:
            return False, "Proxy authorization not found"

        election.proxy_authorizations = authorizations
        await self.db.commit()

        await self._audit("proxy_authorization_revoked", {
            "election_id": str(election_id),
            "authorization_id": authorization_id,
        }, severity="info", user_id=str(revoked_by))

        return True, None

    async def get_proxy_authorizations(
        self, election_id: UUID, organization_id: UUID
    ) -> Optional[Dict]:
        """Return all proxy authorizations for an election plus the org-level enabled flag."""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        enabled = self._is_proxy_voting_enabled(org) if org else False

        return {
            "election_id": str(election_id),
            "election_title": election.title,
            "proxy_voting_enabled": enabled,
            "authorizations": election.proxy_authorizations or [],
        }

    def _get_active_proxy_authorizations_for_user(
        self, proxy_user_id: str, election: Election
    ) -> List[Dict]:
        """Return all active (non-revoked) proxy authorizations where this user is the proxy."""
        auths = election.proxy_authorizations or []
        return [
            a for a in auths
            if a.get("proxy_user_id") == proxy_user_id and not a.get("revoked_at")
        ]

    async def cast_proxy_vote(
        self,
        proxy_user_id: UUID,
        election_id: UUID,
        candidate_id: UUID,
        proxy_authorization_id: str,
        position: Optional[str],
        organization_id: UUID,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        vote_rank: Optional[int] = None,
    ) -> Tuple[Optional[Vote], Optional[str]]:
        """
        Cast a vote on behalf of another member using a proxy authorization.

        The vote records:
        - voter_id / voter_hash: identifies the *delegating* member (the absent voter)
        - proxy_voter_id: the person physically voting
        - proxy_authorization_id: the authorization that permits this
        - is_proxy_vote: True

        This means the delegating member's eligibility is checked (not the proxy's),
        and double-vote prevention applies to the delegating member.
        """
        # Load election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"

        # Check org-level proxy setting
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        if not org or not self._is_proxy_voting_enabled(org):
            return None, "Proxy voting is not enabled for this organization"

        # Locate the authorization
        auths = election.proxy_authorizations or []
        auth = next((a for a in auths if a.get("id") == proxy_authorization_id), None)
        if not auth:
            return None, "Proxy authorization not found"
        if auth.get("revoked_at"):
            return None, "This proxy authorization has been revoked"
        if auth.get("proxy_user_id") != str(proxy_user_id):
            return None, "You are not the designated proxy for this authorization"

        delegating_user_id = UUID(auth["delegating_user_id"])

        # Check the *delegating* member's eligibility (they are the voter of record)
        eligibility = await self.check_voter_eligibility(
            delegating_user_id, election_id, organization_id, position
        )
        if not eligibility.is_eligible:
            return None, f"Delegating member is not eligible: {eligibility.reason}"

        if position and position in eligibility.positions_voted:
            return None, f"Delegating member has already voted for {position}"
        if not election.positions and eligibility.has_voted:
            return None, "Delegating member has already voted in this election"

        # Verify candidate
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.id == str(candidate_id))
            .where(Candidate.election_id == str(election_id))
        )
        candidate = candidate_result.scalar_one_or_none()
        if not candidate:
            return None, "Candidate not found"
        if not candidate.accepted and not candidate.is_write_in:
            return None, "Candidate has not accepted nomination"
        if position and candidate.position != position:
            return None, "Candidate is not running for this position"

        # Create the vote as the delegating member, with proxy metadata
        vote = Vote(
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=delegating_user_id if not election.anonymous_voting else None,
            voter_hash=self._generate_voter_hash(
                delegating_user_id, election_id, election.voter_anonymity_salt or ""
            ) if election.anonymous_voting else None,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc),
            is_proxy_vote=True,
            proxy_voter_id=str(proxy_user_id),
            proxy_authorization_id=proxy_authorization_id,
            proxy_delegating_user_id=str(delegating_user_id),
        )
        vote.vote_signature = self._sign_vote(vote)
        self.db.add(vote)

        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Proxy double-vote attempt blocked | election={election_id} "
                f"delegating={delegating_user_id} proxy={proxy_user_id}"
            )
            await self._audit("proxy_vote_double_attempt", {
                "election_id": str(election_id),
                "delegating_user_id": str(delegating_user_id),
                "proxy_user_id": str(proxy_user_id),
                "authorization_id": proxy_authorization_id,
            }, severity="warning", user_id=str(proxy_user_id), ip_address=ip_address)
            return None, "Database integrity check: the delegating member has already voted"

        logger.info(
            f"Proxy vote cast | election={election_id} position={position} "
            f"delegating={delegating_user_id} proxy={proxy_user_id} "
            f"auth={proxy_authorization_id} vote_id={vote.id}"
        )
        await self._audit("proxy_vote_cast", {
            "election_id": str(election_id),
            "vote_id": str(vote.id),
            "position": position,
            "delegating_user_id": str(delegating_user_id),
            "proxy_user_id": str(proxy_user_id),
            "authorization_id": proxy_authorization_id,
            "anonymous": election.anonymous_voting,
        }, severity="info", user_id=str(proxy_user_id), ip_address=ip_address)

        return vote, None

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
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
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
                .where(User.id.in_([str(uid) for uid in recipient_user_ids]))
                .where(User.organization_id == str(organization_id))
            )
            recipients = users_result.scalars().all()
        elif election.eligible_voters:
            # Use election's eligible voters list
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([str(v) for v in election.eligible_voters]))
                .where(User.organization_id == str(organization_id))
            )
            recipients = users_result.scalars().all()
        else:
            # Send to all active users in organization
            users_result = await self.db.execute(
                select(User)
                .where(User.organization_id == str(organization_id))
                .where(User.is_active == True)  # noqa: E712
            )
            recipients = users_result.scalars().all()

        if not recipients:
            return 0, 0

        # Initialize email service with organization settings
        email_service = EmailService(organization)

        # Build a lookup of delegating_user_id -> proxy user email
        # so we can CC the proxy holder on ballot notifications
        proxy_cc_map: Dict[str, str] = {}
        for auth in (election.proxy_authorizations or []):
            if not auth.get("revoked_at"):
                proxy_uid = auth.get("proxy_user_id")
                delegating_uid = auth.get("delegating_user_id")
                if proxy_uid and delegating_uid:
                    proxy_u_result = await self.db.execute(
                        select(User).where(User.id == proxy_uid)
                    )
                    proxy_u = proxy_u_result.scalar_one_or_none()
                    if proxy_u:
                        proxy_cc_map[delegating_uid] = proxy_u.email

        # Send individual ballot emails with unique tokens
        success_count = 0
        failed_count = 0

        for recipient in recipients:
            # Generate unique voting token for this voter
            voting_token = await self._generate_voting_token(
                user_id=recipient.id,
                election_id=election_id,
                organization_id=organization_id,
                election_end_date=election.end_date,
                anonymity_salt=election.voter_anonymity_salt or "",
            )

            # Build unique ballot URL with token
            ballot_url = f"{base_ballot_url}?token={voting_token.token}" if base_ballot_url else None

            # If this voter has a proxy, CC the proxy holder
            cc_email = proxy_cc_map.get(str(recipient.id))

            sent = await email_service.send_ballot_notification(
                to_email=recipient.email,
                recipient_name=recipient.full_name,
                election_title=election.title,
                ballot_url=ballot_url,
                meeting_date=election.meeting_date,
                custom_message=message,
                cc_emails=[cc_email] if cc_email else None,
            )

            if sent:
                success_count += 1
            else:
                failed_count += 1

        # Update election with email sent status
        election.email_sent = True
        election.email_sent_at = datetime.now(timezone.utc)
        election.email_recipients = [str(user.id) for user in recipients]

        # Commit all voting tokens and election updates
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(
            f"Ballot emails sent | election={election_id} "
            f"success={success_count} failed={failed_count}"
        )
        await self._audit("ballot_emails_sent", {
            "election_id": str(election_id),
            "title": election.title,
            "recipients": success_count,
            "failed": failed_count,
        })

        return success_count, failed_count

    async def has_user_voted(
        self, user_id: UUID, election_id: UUID, election: Optional[Election] = None
    ) -> bool:
        """Check if a user has voted in an election (handles anonymous voting)"""
        if election and election.anonymous_voting:
            voter_hash = self._generate_voter_hash(
                user_id, election_id, election.voter_anonymity_salt or ""
            )
            result = await self.db.execute(
                select(func.count(Vote.id))
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_hash == voter_hash)
                .where(Vote.deleted_at.is_(None))
            )
        else:
            result = await self.db.execute(
                select(func.count(Vote.id))
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_id == str(user_id))
                .where(Vote.deleted_at.is_(None))
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
        token_exp = voting_token.expires_at.replace(tzinfo=timezone.utc) if voting_token.expires_at.tzinfo is None else voting_token.expires_at
        if datetime.now(timezone.utc) > token_exp:
            return None, None, "Voting token has expired"

        # Check if token has already been fully used
        if voting_token.used:
            return None, None, "This ballot has already been fully submitted"

        # Update access tracking
        if not voting_token.first_accessed_at:
            voting_token.first_accessed_at = datetime.now(timezone.utc)
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
        now = datetime.now(timezone.utc)
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
            .where(Candidate.id == str(candidate_id))
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
            .where(Vote.deleted_at.is_(None))
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
            voted_at=datetime.now(timezone.utc),
        )

        # Sign the vote for tampering detection
        vote.vote_signature = self._sign_vote(vote)

        self.db.add(vote)

        # Track which positions have been voted on via this token
        positions_voted = voting_token.positions_voted or []
        if position and position not in positions_voted:
            positions_voted.append(position)
            voting_token.positions_voted = positions_voted

        # Mark token as fully used only when all positions are voted
        # or if it's a single-position election
        election_positions = election.positions or []
        if not election_positions:
            # Single-position election — token used after first vote
            voting_token.used = True
            voting_token.used_at = datetime.now(timezone.utc)
        else:
            # Multi-position — check if all positions are now covered
            remaining = set(election_positions) - set(positions_voted)
            if not remaining:
                voting_token.used = True
                voting_token.used_at = datetime.now(timezone.utc)

        # SECURITY: Database-level constraint prevents double-voting
        # even if race condition bypasses application-level checks
        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Token double-vote attempt blocked | election={election.id} position={position}"
            )
            await self._audit("vote_double_attempt_token", {
                "election_id": str(election.id),
                "position": position,
            }, severity="warning", ip_address=ip_address)
            if position:
                return None, f"Database integrity check: You have already voted for {position}"
            return None, "Database integrity check: You have already voted in this election"

        logger.info(
            f"Token vote cast | election={election.id} position={position} vote_id={vote.id}"
        )
        await self._audit("vote_cast_token", {
            "election_id": str(election.id),
            "vote_id": str(vote.id),
            "position": position,
        }, ip_address=ip_address)

        return vote, None

    async def submit_ballot_with_token(
        self,
        token: str,
        votes: List[Dict],
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[Dict], Optional[str]]:
        """
        Submit an entire ballot atomically using a voting token.

        Each vote in the list corresponds to a ballot item and contains:
        - ballot_item_id: ID of the ballot item
        - choice: 'approve', 'deny', 'abstain', 'write_in', or a candidate UUID
        - write_in_name: Name for write-in votes (only when choice='write_in')

        Returns: (result_dict, error_message)
        """
        # Validate token and get ballot
        election, voting_token, error = await self.get_ballot_by_token(token)
        if error:
            return None, error

        # Check if this token has already been used
        if voting_token.used:
            return None, "This ballot has already been submitted"

        ballot_items = election.ballot_items or []
        if not ballot_items:
            return None, "This election has no ballot items configured"

        # Build a lookup of ballot items by ID
        item_map = {item.get("id"): item for item in ballot_items}

        # Get all accepted candidates for this election
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election.id)
            .where(Candidate.accepted == True)  # noqa: E712
        )
        candidates = candidate_result.scalars().all()
        candidate_map = {str(c.id): c for c in candidates}

        # Process each vote
        created_votes = []
        abstentions = 0

        for vote_data in votes:
            ballot_item_id = vote_data.get("ballot_item_id")
            choice = vote_data.get("choice", "abstain")
            write_in_name = vote_data.get("write_in_name")

            # Validate ballot item exists
            ballot_item = item_map.get(ballot_item_id)
            if not ballot_item:
                continue

            # Handle abstain — no vote recorded
            if choice == "abstain":
                abstentions += 1
                continue

            # Determine the position for this vote (use ballot item id as position)
            position = ballot_item.get("position") or ballot_item_id

            # Check if already voted for this position (prevents double-voting within the ballot)
            existing_check = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == election.id)
                .where(Vote.voter_hash == voting_token.voter_hash)
                .where(Vote.position == position)
                .where(Vote.deleted_at.is_(None))
            )
            if existing_check.scalar_one_or_none():
                return None, f"You have already voted on: {ballot_item.get('title', ballot_item_id)}"

            # Determine candidate_id based on choice
            candidate_id = None

            if choice == "write_in":
                if not write_in_name or not write_in_name.strip():
                    return None, f"Write-in name is required for: {ballot_item.get('title', ballot_item_id)}"

                # Create a write-in candidate
                write_in_candidate = Candidate(
                    election_id=election.id,
                    name=write_in_name.strip(),
                    position=position,
                    is_write_in=True,
                    accepted=True,
                    display_order=999,
                )
                self.db.add(write_in_candidate)
                await self.db.flush()
                candidate_id = write_in_candidate.id

            elif choice == "approve":
                # Find or create an "Approve" candidate for this ballot item
                approve_result = await self.db.execute(
                    select(Candidate)
                    .where(Candidate.election_id == election.id)
                    .where(Candidate.position == position)
                    .where(Candidate.name == "Approve")
                    .where(Candidate.is_write_in == False)  # noqa: E712
                )
                approve_candidate = approve_result.scalar_one_or_none()

                if not approve_candidate:
                    approve_candidate = Candidate(
                        election_id=election.id,
                        name="Approve",
                        position=position,
                        is_write_in=False,
                        accepted=True,
                        display_order=0,
                    )
                    self.db.add(approve_candidate)
                    await self.db.flush()

                candidate_id = approve_candidate.id

            elif choice == "deny":
                # Find or create a "Deny" candidate for this ballot item
                deny_result = await self.db.execute(
                    select(Candidate)
                    .where(Candidate.election_id == election.id)
                    .where(Candidate.position == position)
                    .where(Candidate.name == "Deny")
                    .where(Candidate.is_write_in == False)  # noqa: E712
                )
                deny_candidate = deny_result.scalar_one_or_none()

                if not deny_candidate:
                    deny_candidate = Candidate(
                        election_id=election.id,
                        name="Deny",
                        position=position,
                        is_write_in=False,
                        accepted=True,
                        display_order=1,
                    )
                    self.db.add(deny_candidate)
                    await self.db.flush()

                candidate_id = deny_candidate.id

            else:
                # Choice is a candidate UUID
                if choice not in candidate_map:
                    return None, f"Invalid candidate selection for: {ballot_item.get('title', ballot_item_id)}"
                candidate_id = UUID(choice)

            # Create the vote
            vote = Vote(
                election_id=election.id,
                candidate_id=candidate_id,
                voter_id=None,
                voter_hash=voting_token.voter_hash,
                position=position,
                ip_address=ip_address,
                user_agent=user_agent,
                voted_at=datetime.now(timezone.utc),
            )
            vote.vote_signature = self._sign_vote(vote)
            self.db.add(vote)
            created_votes.append(vote)

        # Mark token as fully used
        voting_token.used = True
        voting_token.used_at = datetime.now(timezone.utc)
        voting_token.positions_voted = [v.get("ballot_item_id") for v in votes if v.get("choice") != "abstain"]

        # Commit all votes atomically
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Ballot double-submission blocked | election={election.id}"
            )
            await self._audit("vote_double_attempt_token", {
                "election_id": str(election.id),
                "type": "bulk_ballot_submission",
            }, severity="warning", ip_address=ip_address)
            return None, "This ballot has already been submitted"

        logger.info(
            f"Ballot submitted | election={election.id} "
            f"votes={len(created_votes)} abstentions={abstentions}"
        )
        await self._audit("ballot_submitted_token", {
            "election_id": str(election.id),
            "votes_cast": len(created_votes),
            "abstentions": abstentions,
        }, ip_address=ip_address)

        return {
            "success": True,
            "votes_cast": len(created_votes),
            "abstentions": abstentions,
            "message": f"Ballot submitted successfully. {len(created_votes)} vote(s) cast, {abstentions} abstention(s).",
        }, None
