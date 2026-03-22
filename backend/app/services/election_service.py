"""
Election Service

Business logic for election management including elections, candidates, voting, and results.
"""

import copy
import hashlib
import hmac
import html
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.constants import (
    LEADERSHIP_ROLE_SLUGS,
)
from app.models.election import Candidate, Election, ElectionStatus, Vote, VotingToken
from app.models.membership_pipeline import ProspectElectionPackage
from app.models.user import Organization, User
from app.schemas.election import (
    CandidateResult,
    ElectionResults,
    ElectionStats,
    PositionResults,
    VoterEligibility,
)
from app.services.email_service import EmailService


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

    # ------------------------------------------------------------------
    # Election CRUD helpers
    # ------------------------------------------------------------------

    async def list_elections(
        self,
        organization_id,
        status_filter: Optional[str] = None,
    ) -> List[Election]:
        """List elections for an organization, optionally filtered by status."""
        query = select(Election).where(Election.organization_id == str(organization_id))

        if status_filter:
            status_enum = ElectionStatus(status_filter)
            query = query.where(Election.status == status_enum)

        query = query.order_by(Election.start_date.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_election(
        self,
        election_id,
        organization_id,
    ) -> Optional[Election]:
        """Get a single election by ID within the given organization."""
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def list_candidates(
        self,
        election_id,
    ) -> List[Candidate]:
        """List accepted/all candidates for an election ordered by position."""
        result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
            .order_by(Candidate.position, Candidate.display_order)
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Role / eligibility helpers
    # ------------------------------------------------------------------

    async def _user_has_role_type(self, user: User, role_types: List[str]) -> bool:
        """
        Check if a user has any of the specified voter-type categories.

        Eligibility is determined primarily by the member's
        ``membership_type`` (department membership classification), with a
        fallback to direct role-slug matching for custom/specific slugs.

        role_types can include:
        - "all" - everyone is eligible
        - "operational" - members with membership_type "active"
        - "administrative" - members with membership_type "administrative"
        - "regular" - active or life members (membership_type in active, life)
        - "life" - life members only (membership_type "life")
        - "probationary" - probationary members (membership_type "probationary")
        - Specific role slugs like "chief", "president", etc.
        """
        if not role_types or "all" in role_types:
            return True

        from app.models.user import MembershipType

        member_type = getattr(user, "membership_type", None) or "active"

        # Membership-type category checks
        if "operational" in role_types:
            if member_type == MembershipType.ACTIVE:
                return True

        if "administrative" in role_types:
            if member_type == MembershipType.ADMINISTRATIVE:
                return True

        # "regular" = active or life members (non-probationary voting members)
        if "regular" in role_types:
            if member_type in (MembershipType.ACTIVE, MembershipType.LIFE):
                return True

        if "life" in role_types:
            if member_type == MembershipType.LIFE:
                return True

        if "probationary" in role_types:
            if member_type == MembershipType.PROBATIONARY:
                return True

        # Fallback: check for direct role slug matches
        user_role_slugs = [role.slug for role in user.roles]
        for role_slug in user_role_slugs:
            if role_slug in role_types:
                return True

        return False

    def _is_user_attending(self, user_id: str, election: Election) -> bool:
        """Check if a user is checked in as present at the meeting."""
        if not election.attendees:
            return False
        return any(a.get("user_id") == str(user_id) for a in election.attendees)

    @staticmethod
    def _build_ballot_items_lists(
        eligible_items: List[Dict],
    ) -> Tuple[str, str]:
        """Build HTML and plain-text lists of ballot items for the email.

        Returns (html_string, text_string).
        """
        if not eligible_items:
            return "", ""

        html_parts = ["<ul>"]
        text_parts = []
        for item in eligible_items:
            title = html.escape(item.get("title", "Untitled"))
            item_type = item.get("type", "").replace("_", " ").title()
            vote_type = item.get("vote_type", "").replace("_", " ")
            label = f"<strong>{title}</strong>"
            if item_type:
                label += f" &mdash; {html.escape(item_type)}"
            if vote_type:
                label += f" ({html.escape(vote_type)})"
            html_parts.append(f"<li>{label}</li>")

            text_label = f"  - {item.get('title', 'Untitled')}"
            if item_type:
                text_label += f" — {item_type}"
            if vote_type:
                text_label += f" ({vote_type})"
            text_parts.append(text_label)

        html_parts.append("</ul>")
        return "\n".join(html_parts), "\n".join(text_parts)

    async def _get_eligible_ballot_items_for_user(
        self,
        user: "User",
        election: Election,
        organization_id: str,
        organization: Optional["Organization"] = None,
    ) -> List[Dict]:
        """
        Return the subset of election.ballot_items that the user is eligible
        to vote on, based on their member class, role, and attendance.

        Each returned dict is the original ballot item with an added
        ``_eligible`` flag and ``_reason`` (only set when ineligible).
        Items where the user is eligible are returned as-is.
        """
        ballot_items = election.ballot_items or []
        if not ballot_items:
            # If there are no ballot items but there are positions/candidates,
            # the election uses the positional voting path — always eligible.
            return []

        # Use pre-loaded org if provided, otherwise query
        if organization:
            org = organization
        else:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
        tier_config = (org.settings or {}).get("membership_tiers", {}) if org else {}
        tiers = tier_config.get("tiers", [])
        member_tier_id = getattr(user, "membership_type", None) or "active"
        tier_def = next((t for t in tiers if t.get("id") == member_tier_id), None)

        # Check if tier is voting-eligible at all
        tier_voting_eligible = True
        if tier_def:
            benefits = tier_def.get("benefits", {})
            tier_voting_eligible = benefits.get("voting_eligible", True)

        # Secretary override check
        has_override = False
        if election.voter_overrides:
            has_override = any(
                o.get("user_id") == str(user.id) for o in election.voter_overrides
            )

        eligible_items: List[Dict] = []
        for item in ballot_items:
            # If user has secretary override, skip eligibility checks
            if has_override:
                eligible_items.append(item)
                continue

            # Check tier voting eligibility
            if not tier_voting_eligible:
                continue

            # Check per-item voter type eligibility
            eligible_types = item.get("eligible_voter_types", ["all"])
            if not await self._user_has_role_type(user, eligible_types):
                continue

            # Check attendance requirement for this item
            if item.get("require_attendance", False):
                if not self._is_user_attending(str(user.id), election):
                    continue

            eligible_items.append(item)

        return eligible_items

    async def _get_ineligibility_reason_for_user(
        self,
        user: "User",
        election: Election,
        organization_id: str,
        organization: Optional["Organization"] = None,
    ) -> Optional[str]:
        """
        Return a human-readable reason explaining why a user has zero
        eligible ballot items, or None if they are eligible for at least one.

        This is used to build the skipped_details list returned to admins
        after sending ballot emails.
        """
        ballot_items = election.ballot_items or []
        if not ballot_items:
            return None

        # Use pre-loaded org if provided, otherwise query
        if organization:
            org = organization
        else:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
        tier_config = (org.settings or {}).get("membership_tiers", {}) if org else {}
        tiers = tier_config.get("tiers", [])
        member_tier_id = getattr(user, "membership_type", None) or "active"
        tier_def = next((t for t in tiers if t.get("id") == member_tier_id), None)

        # Secretary override — if present, they are eligible for everything
        if election.voter_overrides and any(
            o.get("user_id") == str(user.id) for o in election.voter_overrides
        ):
            return None

        # Tier-level ineligibility (affects all items)
        if tier_def:
            benefits = tier_def.get("benefits", {})
            if not benefits.get("voting_eligible", True):
                tier_name = tier_def.get("name", member_tier_id)
                return f"Membership tier '{tier_name}' is not eligible to vote"

        # Check each item for role-type and attendance requirements
        role_blocked = 0
        attendance_blocked = 0
        required_types_seen: set = set()
        for item in ballot_items:
            eligible_types = item.get("eligible_voter_types", ["all"])
            if not await self._user_has_role_type(user, eligible_types):
                role_blocked += 1
                required_types_seen.update(eligible_types)
                continue
            if item.get("require_attendance", False):
                if not self._is_user_attending(str(user.id), election):
                    attendance_blocked += 1
                    continue

        total = len(ballot_items)
        member_type = getattr(user, "membership_type", None) or "active"
        reasons = []
        if role_blocked > 0:
            required_label = ", ".join(sorted(required_types_seen))
            reasons.append(
                f"membership type not eligible for {role_blocked}/{total} item(s) "
                f"(requires: {required_label}; member has: {member_type})"
            )
        if attendance_blocked > 0:
            reasons.append(
                f"not checked in for {attendance_blocked}/{total} "
                f"attendance-required item(s)"
            )

        if reasons:
            return "; ".join(reasons)

        return None

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
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return None, "User not found"

        # Deep copy to break shared references with SQLAlchemy's committed state
        attendees = copy.deepcopy(election.attendees or [])

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

        logger.info(
            f"Attendee checked in | election={election_id} user={user_id} by={checked_in_by}"
        )
        await self._audit(
            "meeting_attendee_checked_in",
            {
                "election_id": str(election_id),
                "user_id": str(user_id),
                "name": user.full_name,
            },
            user_id=str(checked_in_by),
        )

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

        attendees = copy.deepcopy(election.attendees or [])
        original_count = len(attendees)
        attendees = [a for a in attendees if a.get("user_id") != str(user_id)]

        if len(attendees) == original_count:
            return False, "Member is not in the attendance list"

        election.attendees = attendees
        await self.db.commit()

        logger.info(
            f"Attendee removed | election={election_id} user={user_id} by={removed_by}"
        )
        await self._audit(
            "meeting_attendee_removed",
            {
                "election_id": str(election_id),
                "user_id": str(user_id),
            },
            user_id=str(removed_by),
        )

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
        self,
        user_id: UUID,
        election_id: UUID,
        organization_id: UUID,
        position: Optional[str] = None,
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
        start = (
            election.start_date.replace(tzinfo=timezone.utc)
            if election.start_date and election.start_date.tzinfo is None
            else election.start_date
        )
        end = (
            election.end_date.replace(tzinfo=timezone.utc)
            if election.end_date and election.end_date.tzinfo is None
            else election.end_date
        )
        if election.status != ElectionStatus.OPEN:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason=f"Election is {election.status.value}",
            )

        if start and now < start:
            return VoterEligibility(
                is_eligible=False,
                has_voted=False,
                positions_voted=[],
                positions_remaining=[],
                reason="Election has not started yet",
            )

        if end and now > end:
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
                    reason=(
                        "This election is restricted to a specific voter list "
                        "and you are not on it. Contact the election administrator "
                        "if you believe this is an error."
                    ),
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
                o.get("user_id") == str(user_id) for o in election.voter_overrides
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
                        from app.services.membership_tier_service import (
                            MembershipTierService,
                        )

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
                    eligible_label = ", ".join(voter_types)
                    member_type = getattr(user, "membership_type", None) or "active"
                    return VoterEligibility(
                        is_eligible=False,
                        has_voted=False,
                        positions_voted=[],
                        positions_remaining=[],
                        reason=(
                            f"Voting for the {position} position requires one of "
                            f"these voter types: {eligible_label}. Your current "
                            f"membership type ({member_type}) does not qualify."
                        ),
                    )

        # Check ballot item eligibility (member class + attendance)
        if position and election.ballot_items:
            matching_items = [
                item
                for item in election.ballot_items
                if item.get("position") == position or item.get("title") == position
            ]
            for item in matching_items:
                # Check member class / role eligibility
                eligible_types = item.get("eligible_voter_types", ["all"])
                if not await self._user_has_role_type(user, eligible_types):
                    eligible_label = ", ".join(eligible_types)
                    member_type = getattr(user, "membership_type", None) or "active"
                    return VoterEligibility(
                        is_eligible=False,
                        has_voted=False,
                        positions_voted=[],
                        positions_remaining=[],
                        reason=(
                            f"This ballot item requires one of these voter types: "
                            f"{eligible_label}. Your current membership type "
                            f"({member_type}) does not qualify."
                        ),
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

        positions_voted = list(
            set(vote.position for vote in existing_votes if vote.position)
        )

        # Determine remaining positions
        all_positions = election.positions or []
        positions_remaining = [
            pos for pos in all_positions if pos not in positions_voted
        ]

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
        eligibility = await self.check_voter_eligibility(
            user_id, election_id, organization_id
        )

        # Get election for further checks
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        # Validate vote_rank matches voting method
        if election.voting_method == "ranked_choice" and vote_rank is None:
            return None, "vote_rank is required for ranked-choice voting"
        if election.voting_method != "ranked_choice" and vote_rank is not None:
            return None, "vote_rank is not applicable for this voting method"

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
            position_votes = [
                v
                for v in await self._get_user_votes(user_id, election_id, election)
                if v.position == position
            ]
            if len(position_votes) >= election.max_votes_per_position:
                return None, f"Maximum votes for {position} reached"

        # Compute voter identity for hashing
        voter_hash = (
            self._generate_voter_hash(
                user_id, election_id, election.voter_anonymity_salt or ""
            )
            if election.anonymous_voting
            else None
        )
        voter_id_or_hash = voter_hash or str(user_id)

        # Create the vote
        vote = Vote(
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=user_id if not election.anonymous_voting else None,
            voter_hash=voter_hash,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc),
            # MySQL-compatible dedup hash for DB-level double-vote prevention
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election_id, voter_id_or_hash, position
            ),
        )

        # Sign the vote for tampering detection
        vote.vote_signature = self._sign_vote(vote)

        # Sequential chain hash — links this vote to the previous one
        vote.chain_hash = self._compute_chain_hash(
            election.last_chain_hash, vote.vote_signature
        )

        # Voter receipt — returned so the voter can verify their vote was recorded
        vote.receipt_hash = self._compute_receipt_hash(
            str(vote.id), vote.vote_signature
        )

        self.db.add(vote)

        # Update election's chain hash pointer
        election.last_chain_hash = vote.chain_hash

        # SECURITY: Database-level unique constraint on vote_dedup_hash
        # prevents double-voting even if race condition bypasses application checks
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
            await self._audit(
                "vote_double_attempt",
                {
                    "election_id": str(election_id),
                    "position": position,
                    "anonymous": election.anonymous_voting,
                },
                severity="warning",
                user_id=str(user_id),
                ip_address=ip_address,
            )
            if position:
                return (
                    None,
                    f"Database integrity check: You have already voted for {position}",
                )
            return (
                None,
                "Database integrity check: You have already voted in this election",
            )

        # Audit & log the successful vote
        logger.info(
            f"Vote cast | election={election_id} position={position} "
            f"anonymous={election.anonymous_voting} vote_id={vote.id}"
        )
        await self._audit(
            "vote_cast",
            {
                "election_id": str(election_id),
                "vote_id": str(vote.id),
                "position": position,
                "anonymous": election.anonymous_voting,
            },
            user_id=str(user_id),
            ip_address=ip_address,
        )

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

    # ------------------------------------------------------------------
    # Vote security helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_vote_dedup_hash(
        election_id: UUID, voter_id_or_hash: str, position: Optional[str]
    ) -> str:
        """Compute a MySQL-compatible dedup hash for double-vote prevention.

        Returns SHA256(election_id:voter_id_or_hash:position) which is stored
        in a UNIQUE column to enforce one-vote-per-voter-per-position at the
        database level.
        """
        pos_key = position or "__NO_POS__"
        data = f"{election_id}:{voter_id_or_hash}:{pos_key}"
        return hashlib.sha256(data.encode()).hexdigest()

    def _compute_chain_hash(
        self, previous_chain_hash: Optional[str], vote_signature: str
    ) -> str:
        """Compute the next hash in the sequential vote chain.

        chain_hash = SHA256(previous_chain_hash + vote_signature)
        An unbroken chain proves no votes have been deleted or reordered.
        """
        prev = previous_chain_hash or "GENESIS"
        data = f"{prev}:{vote_signature}"
        return hashlib.sha256(data.encode()).hexdigest()

    @staticmethod
    def _compute_receipt_hash(vote_id: str, vote_signature: str) -> str:
        """Generate a receipt hash the voter can use to verify their vote exists.

        receipt = SHA256(vote_id + vote_signature + random_nonce)
        The nonce is embedded so the receipt cannot be reverse-engineered.
        """
        nonce = secrets.token_hex(16)
        data = f"{vote_id}:{vote_signature}:{nonce}"
        return hashlib.sha256(data.encode()).hexdigest()

    def _get_vote_signing_key(self) -> str:
        """Return the vote signing key, falling back to SECRET_KEY.

        A dedicated VOTE_SIGNING_KEY is recommended so that rotating
        SECRET_KEY does not invalidate existing vote signatures.
        """
        key = settings.VOTE_SIGNING_KEY or settings.SECRET_KEY
        if key == settings.SECRET_KEY and not settings.VOTE_SIGNING_KEY:
            logger.warning(
                "VOTE_SIGNING_KEY not configured — falling back to SECRET_KEY. "
                "Set VOTE_SIGNING_KEY for independent key rotation."
            )
        return key

    def _sign_vote(self, vote: Vote) -> str:
        """Generate a cryptographic signature for a vote to detect tampering.

        The signature covers all immutable vote fields so any modification
        (changing candidate, deleting and re-inserting, altering rank, or
        converting a proxy vote) will produce a different signature.
        """
        signing_key = self._get_vote_signing_key()
        # Include vote_rank for ranked-choice integrity and proxy fields
        data = (
            f"{vote.id}:{vote.election_id}:{vote.candidate_id}"
            f":{vote.voter_hash or vote.voter_id}:{vote.position}"
            f":{vote.vote_rank}:{vote.is_proxy_vote}"
            f":{vote.proxy_delegating_user_id}:{vote.voted_at.isoformat()}"
        )
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

        # Verify the sequential vote chain (ordered by voted_at)
        chain_broken = False
        chain_break_at = None
        sorted_votes = sorted(
            [v for v in all_votes if v.chain_hash],
            key=lambda v: v.voted_at,
        )
        prev_chain = "GENESIS"
        for vote in sorted_votes:
            expected_chain = self._compute_chain_hash(
                prev_chain, vote.vote_signature or ""
            )
            if vote.chain_hash != expected_chain:
                chain_broken = True
                chain_break_at = str(vote.id)
                break
            prev_chain = vote.chain_hash

        integrity_status = "PASS"
        if tampered:
            integrity_status = "FAIL"
        elif chain_broken:
            integrity_status = "CHAIN_BROKEN"

        if tampered:
            logger.critical(
                f"VOTE INTEGRITY FAILURE | election={election_id} "
                f"tampered={len(tampered)} ids={tampered}"
            )
        elif chain_broken:
            logger.critical(
                f"VOTE CHAIN BROKEN | election={election_id} "
                f"break_at={chain_break_at}"
            )
        else:
            logger.info(
                f"Vote integrity check PASS | election={election_id} total={total}"
            )

        await self._audit(
            "vote_integrity_check",
            {
                "election_id": str(election_id),
                "total_votes": total,
                "valid_signatures": valid,
                "tampered_votes": len(tampered),
                "chain_verified": not chain_broken,
                "chain_break_at": chain_break_at,
                "integrity_status": integrity_status,
            },
            severity="critical" if (tampered or chain_broken) else "info",
        )

        return {
            "election_id": str(election_id),
            "total_votes": total,
            "valid_signatures": valid,
            "unsigned_votes": unsigned,
            "tampered_votes": len(tampered),
            "tampered_vote_ids": tampered,
            "chain_verified": not chain_broken,
            "chain_break_at": chain_break_at,
            "integrity_status": integrity_status,
        }

    async def soft_delete_vote(
        self,
        vote_id: UUID,
        deleted_by: UUID,
        reason: str,
        organization_id: Optional[UUID] = None,
    ) -> Optional[Vote]:
        """Soft-delete a vote with audit trail instead of hard-deleting."""
        query = (
            select(Vote)
            .join(Election, Vote.election_id == Election.id)
            .where(Vote.id == str(vote_id))
            .where(Vote.deleted_at.is_(None))
        )
        if organization_id:
            query = query.where(Election.organization_id == str(organization_id))
        result = await self.db.execute(query)
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
        await self._audit(
            "vote_soft_deleted",
            {
                "vote_id": str(vote_id),
                "election_id": str(vote.election_id),
                "reason": reason,
            },
            severity="warning",
            user_id=str(deleted_by),
        )

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
            select(VotingToken).where(VotingToken.election_id == str(election_id))
        )
        tokens = token_result.scalars().all()

        token_records = [
            {
                "token_id": str(t.id),
                "used": t.used,
                "used_at": t.used_at.isoformat() if t.used_at else None,
                "first_accessed_at": (
                    t.first_accessed_at.isoformat() if t.first_accessed_at else None
                ),
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
        suspicious_ips = {
            ip: count
            for ip, count in ip_vote_counts.items()
            if count > 5 and ip != "unknown"
        }

        # 6. Voting timeline (votes per hour)
        voting_timeline: Dict[str, int] = {}
        for v in active_votes:
            hour_key = (
                v.voted_at.strftime("%Y-%m-%d %H:00") if v.voted_at else "unknown"
            )
            voting_timeline[hour_key] = voting_timeline.get(hour_key, 0) + 1

        logger.info(f"Forensics report generated | election={election_id}")
        await self._audit(
            "forensics_report_generated",
            {
                "election_id": str(election_id),
                "title": election.title,
            },
        )

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
            "created_at": (
                election.created_at.isoformat() if election.created_at else None
            ),
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
        self,
        election_id: UUID,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
        _internal_bypass_visibility: bool = False,
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
        end_date = (
            election.end_date.replace(tzinfo=timezone.utc)
            if election.end_date and election.end_date.tzinfo is None
            else election.end_date
        )
        election_has_closed = end_date is not None and current_time > end_date

        can_view = (
            (election.status == ElectionStatus.CLOSED and election_has_closed)
            or election.results_visible_immediately
            or _internal_bypass_visibility
        )

        if not can_view:
            # Before closing: use get_election_stats() for ballot counts only
            return None

        # Get all active (non-deleted) votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test == False)  # noqa: E712
        )
        all_votes = votes_result.scalars().all()

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate).where(Candidate.election_id == str(election_id))
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
        voter_turnout = (
            (unique_voters / total_eligible * 100) if total_eligible > 0 else 0
        )

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
        overall_results = await self._calculate_candidate_results(
            candidates, all_votes, election, total_eligible
        )

        # Check quorum
        quorum_met = True
        quorum_detail = None
        if election.quorum_type == "percentage" and election.quorum_value:
            quorum_met = voter_turnout >= election.quorum_value
            quorum_detail = (
                f"Quorum requires {election.quorum_value}% turnout. "
                f"Actual: {round(voter_turnout, 1)}% ({unique_voters}/{total_eligible})."
            )
            if not quorum_met:
                quorum_detail += " Quorum NOT met — results are advisory only."
                # Clear winners if quorum not met
                for r in overall_results:
                    r.is_winner = False
                for pr in results_by_position:
                    for r in pr.candidates:
                        r.is_winner = False
        elif election.quorum_type == "count" and election.quorum_value:
            quorum_met = unique_voters >= election.quorum_value
            quorum_detail = (
                f"Quorum requires {election.quorum_value} voters. "
                f"Actual: {unique_voters}."
            )
            if not quorum_met:
                quorum_detail += " Quorum NOT met — results are advisory only."
                for r in overall_results:
                    r.is_winner = False
                for pr in results_by_position:
                    for r in pr.candidates:
                        r.is_winner = False

        return ElectionResults(
            election_id=election.id,
            election_title=election.title,
            status=election.status.value,
            total_votes=len(all_votes),
            total_eligible_voters=total_eligible,
            voter_turnout_percentage=round(voter_turnout, 2),
            results_by_position=results_by_position,
            overall_results=overall_results,
            quorum_met=quorum_met,
            quorum_detail=quorum_detail,
        )

    async def _calculate_candidate_results(
        self,
        candidates: List[Candidate],
        votes: List[Vote],
        election: Election,
        total_eligible: int,
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
            return self._calculate_ranked_choice_results(
                candidates, votes, election, total_eligible
            )

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
        self,
        candidates: List[Candidate],
        votes: List[Vote],
        election: Election,
        total_eligible: int,
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
            bottom_candidates = [
                cid for cid, count in round_counts.items() if count == min_count
            ]
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
            select(Candidate).where(Candidate.election_id == str(election_id))
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
        voter_turnout = (
            (unique_voters / total_eligible * 100) if total_eligible > 0 else 0
        )

        # Votes by position
        votes_by_position = {}
        for vote in all_votes:
            if vote.position:
                votes_by_position[vote.position] = (
                    votes_by_position.get(vote.position, 0) + 1
                )

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

    async def get_non_voters(
        self, election_id: UUID, organization_id: UUID
    ) -> List[Dict]:
        """Return list of eligible voters who have not yet cast a vote.

        Returns a list of dicts with ``id``, ``full_name``, and ``email``
        for each non-voter.
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return []

        # Get eligible voters
        if election.eligible_voters:
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([str(v) for v in election.eligible_voters]))
                .where(User.organization_id == str(organization_id))
                .options(selectinload(User.roles))
            )
        else:
            users_result = await self.db.execute(
                select(User)
                .where(User.organization_id == str(organization_id))
                .where(User.is_active == True)  # noqa: E712
                .options(selectinload(User.roles))
            )
        eligible_users = users_result.scalars().all()

        # Get all voter hashes / voter IDs who have voted
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        votes = votes_result.scalars().all()

        if election.anonymous_voting:
            voted_hashes = {v.voter_hash for v in votes if v.voter_hash}
            non_voters = []
            for user in eligible_users:
                user_hash = self._generate_voter_hash(
                    user.id, election_id, election.voter_anonymity_salt or ""
                )
                if user_hash not in voted_hashes:
                    non_voters.append(
                        {
                            "id": user.id,
                            "full_name": user.full_name,
                            "email": user.email,
                        }
                    )
        else:
            voted_ids = {v.voter_id for v in votes if v.voter_id}
            non_voters = [
                {
                    "id": user.id,
                    "full_name": user.full_name,
                    "email": user.email,
                }
                for user in eligible_users
                if str(user.id) not in voted_ids
            ]

        return non_voters

    async def _check_and_create_runoff(
        self, election: Election, organization_id: UUID
    ) -> Optional[Election]:
        """Check if a runoff is needed and create it if so"""
        # Get results to check if there's a winner
        results = await self.get_election_results(election.id, organization_id)

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

        # Aggregate vote counts at the DB level instead of loading all
        # vote rows into Python memory.
        vote_counts_result = await self.db.execute(
            select(Vote.candidate_id, func.count(Vote.id))
            .where(Vote.election_id == election.id)
            .where(Vote.deleted_at.is_(None))
            .group_by(Vote.candidate_id)
        )
        candidate_vote_counts = dict(vote_counts_result.all())

        # Sort candidates by vote count
        sorted_candidates = sorted(
            all_candidates,
            key=lambda c: candidate_vote_counts.get(c.id, 0),
            reverse=True,
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
        runoff_start = datetime.now(timezone.utc) + timedelta(
            hours=1
        )  # Start 1 hour from now
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
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Close an election and finalize results, creating runoff if needed"""
        # SELECT ... FOR UPDATE prevents concurrent close_election calls from
        # both reading the election as OPEN and creating duplicate runoffs.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        if election.status == ElectionStatus.CLOSED:
            return election, None

        # Only OPEN elections can be closed
        if election.status != ElectionStatus.OPEN:
            return (
                None,
                f"Cannot close election with status '{election.status.value}'. Only open elections can be closed.",
            )

        election.status = ElectionStatus.CLOSED
        # SEC: Destroy the per-election anonymity salt so voter hashes can
        # never be reversed back to user IDs, even with full DB access.
        election.voter_anonymity_salt = None
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(
            f"Election closed | election={election_id} title={election.title!r} "
            f"anonymity_salt_destroyed=True"
        )
        await self._audit(
            "election_closed",
            {
                "election_id": str(election_id),
                "title": election.title,
                "anonymity_salt_destroyed": True,
            },
        )

        # Check if runoffs are enabled and if we should create one
        if (
            election.enable_runoffs
            and election.runoff_round < election.max_runoff_rounds
        ):
            runoff = await self._check_and_create_runoff(election, organization_id)
            if runoff:
                logger.info(
                    f"Runoff created | parent={election_id} runoff={runoff.id} round={runoff.runoff_round}"
                )
                await self._audit(
                    "runoff_election_created",
                    {
                        "parent_election_id": str(election_id),
                        "runoff_election_id": str(runoff.id),
                        "runoff_round": runoff.runoff_round,
                    },
                )

        # Sync linked membership pipeline packages with vote outcomes
        try:
            await self._sync_package_statuses(election, organization_id)
        except Exception as e:
            logger.error(
                f"Failed to sync package statuses (non-blocking) | "
                f"election={election_id} error={e}"
            )

        # Fire-and-forget: send election report to secretary
        try:
            await self.generate_and_send_election_report(
                election_id=election_id,
                organization_id=organization_id,
            )
        except Exception as e:
            logger.error(
                f"Failed to send election report (non-blocking) | "
                f"election={election_id} error={e}"
            )

        return election, None

    async def _sync_package_statuses(
        self, election: Election, organization_id: UUID
    ) -> None:
        """Update ProspectElectionPackage statuses based on vote outcomes.

        For each membership_approval ballot item that references a
        prospect_package_id, tallies the Approve vs Deny votes and sets the
        package status to 'elected' or 'not_elected'.
        """
        ballot_items = election.ballot_items or []
        pkg_items = [
            item for item in ballot_items
            if item.get("type") == "membership_approval"
            and item.get("prospect_package_id")
        ]
        if not pkg_items:
            return

        pkg_ids = [item["prospect_package_id"] for item in pkg_items]
        pkgs_result = await self.db.execute(
            select(ProspectElectionPackage).where(
                ProspectElectionPackage.id.in_(pkg_ids)
            )
        )
        pkgs_by_id = {p.id: p for p in pkgs_result.scalars().all()}

        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test == False)  # noqa: E712
        )
        all_votes = votes_result.scalars().all()

        for item in pkg_items:
            pkg = pkgs_by_id.get(item["prospect_package_id"])
            if not pkg:
                continue

            position = item.get("position") or item["id"]
            item_votes = [v for v in all_votes if v.position == position]

            approve_count = 0
            deny_count = 0
            for vote in item_votes:
                candidate_result = await self.db.execute(
                    select(Candidate.name).where(
                        Candidate.id == vote.candidate_id
                    )
                )
                name = candidate_result.scalar_one_or_none()
                if name == "Approve":
                    approve_count += 1
                elif name == "Deny":
                    deny_count += 1

            new_status = "elected" if approve_count > deny_count else "not_elected"
            pkg.status = new_status

            logger.info(
                f"Package status synced | package={pkg.id} "
                f"prospect={pkg.prospect_id} approve={approve_count} "
                f"deny={deny_count} status={new_status}"
            )
            await self._audit(
                "election_package_result_synced",
                {
                    "election_id": election.id,
                    "package_id": pkg.id,
                    "prospect_id": pkg.prospect_id,
                    "approve_count": approve_count,
                    "deny_count": deny_count,
                    "new_status": new_status,
                },
            )

        await self.db.commit()

    async def open_election(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Open an election for voting"""
        # SELECT ... FOR UPDATE prevents concurrent open calls from
        # both reading the election as DRAFT and opening it simultaneously.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        if election.status != ElectionStatus.DRAFT:
            return None, f"Cannot open election with status {election.status.value}"

        # Validate election has at least one candidate or ballot item
        candidates_result = await self.db.execute(
            select(func.count(Candidate.id))
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.accepted == True)  # noqa: E712
        )
        candidate_count = candidates_result.scalar() or 0
        ballot_items = election.ballot_items or []

        if candidate_count == 0 and len(ballot_items) == 0:
            return (
                None,
                "Election must have at least one accepted candidate or ballot item",
            )

        election.status = ElectionStatus.OPEN
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(
            f"Election opened | election={election_id} title={election.title!r}"
        )
        await self._audit(
            "election_opened",
            {
                "election_id": str(election_id),
                "title": election.title,
                "candidate_count": candidate_count,
            },
        )

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

        # Deep copy to avoid SQLAlchemy JSON mutation detection issue
        history = copy.deepcopy(election.rollback_history or [])
        history.append(rollback_record)
        election.rollback_history = history

        # Update status
        election.status = new_status
        election.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(election)

        logger.warning(
            f"Election rolled back | election={election_id} "
            f"{from_status} -> {to_status} by={performed_by} reason={reason!r}"
        )
        await self._audit(
            "election_rollback",
            {
                "election_id": str(election_id),
                "title": election.title,
                "from_status": from_status,
                "to_status": to_status,
                "reason": reason,
            },
            severity="warning",
            user_id=str(performed_by),
        )

        # Send email notifications to leadership (non-blocking — the
        # rollback is already committed, so notification failures must
        # not cause the endpoint to return 500)
        notifications_sent = 0
        try:
            notifications_sent = await self._notify_leadership_of_rollback(
                election=election,
                performed_by=performed_by,
                organization_id=organization_id,
                from_status=from_status,
                to_status=to_status,
                reason=reason,
            )
        except Exception as e:
            logger.error(
                f"Failed to send rollback notifications (non-blocking) | "
                f"election={election_id} error={e}"
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
        from app.services.email_service import (
            EmailService,
            build_email_logo_html,
        )

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
            user
            for user in all_users
            if any(role.slug in leadership_roles for role in user.roles)
        ]

        if not leadership_users:
            return 0

        # Get the user who performed the rollback
        performer_result = await self.db.execute(
            select(User).where(User.id == str(performed_by))
        )
        performer = performer_result.scalar_one_or_none()
        performer_name = performer.full_name if performer else "Unknown"

        # Get organization for email service
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        if not organization:
            return 0

        # Initialize email service
        email_service = EmailService(organization)

        # HTML-escape user-supplied data to prevent injection in emails
        safe_title = html.escape(election.title)
        safe_performer = html.escape(performer_name)
        safe_reason = html.escape(reason)
        safe_org_name = html.escape(organization.name)

        # Compute timestamp once for all recipients
        org_tz = getattr(organization, "timezone", None) or "America/New_York"
        formatted_time = (
            datetime.now(timezone.utc)
            .astimezone(ZoneInfo(org_tz))
            .strftime("%B %d, %Y at %I:%M %p")
        )

        logo_html = build_email_logo_html(organization)

        # Send notifications
        sent_count = 0
        for user in leadership_users:
            # Don't notify the person who performed the rollback
            if str(user.id) == str(performed_by):
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
        {logo_html}
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
                    <li><strong>Date/Time:</strong> {formatted_time}</li>
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
- Date/Time: {formatted_time}

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
                logger.error(
                    f"Failed to send rollback notification to {user.email}: {e}"
                )
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
        from app.services.email_service import (
            EmailService,
            build_email_logo_html,
        )

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
            user
            for user in all_users
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

        safe_title = html.escape(election.title)
        safe_performer = html.escape(performer_name)
        safe_reason = html.escape(reason)
        safe_org_name = html.escape(organization.name)
        election_status = election.status.value.upper()

        # Compute timestamp once for all recipients
        org_tz = getattr(organization, "timezone", None) or "America/New_York"
        formatted_time = (
            datetime.now(timezone.utc)
            .astimezone(ZoneInfo(org_tz))
            .strftime("%B %d, %Y at %I:%M %p")
        )

        logo_html = build_email_logo_html(organization)

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
        {logo_html}
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
                    <li><strong>Date/Time:</strong> {formatted_time}</li>
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
- Date/Time: {formatted_time}

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
                logger.error(
                    f"Failed to send deletion notification to {user.email}: {e}"
                )
                continue

        return sent_count

    async def _generate_voting_token(
        self,
        user_id: UUID,
        election_id: UUID,
        organization_id: UUID,
        election_end_date: datetime,
        anonymity_salt: str = "",
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
        end_for_expiry = (
            election_end_date.replace(tzinfo=timezone.utc)
            if election_end_date and election_end_date.tzinfo is None
            else election_end_date
        )
        expires_at = min(end_for_expiry, max_expiry) if end_for_expiry else max_expiry

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
        return (
            (organization.settings or {}).get("proxy_voting", {}).get("enabled", False)
        )

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

        # Verify all users exist in the same org (single query per user)
        delegating_result = await self.db.execute(
            select(User)
            .where(User.id == str(delegating_user_id))
            .where(User.organization_id == str(organization_id))
        )
        delegating_user = delegating_result.scalar_one_or_none()
        if not delegating_user:
            return None, "Delegating member not found"

        proxy_result = await self.db.execute(
            select(User)
            .where(User.id == str(proxy_user_id))
            .where(User.organization_id == str(organization_id))
        )
        proxy_user = proxy_result.scalar_one_or_none()
        if not proxy_user:
            return None, "Proxy member not found"

        auth_result = await self.db.execute(
            select(User)
            .where(User.id == str(authorized_by))
            .where(User.organization_id == str(organization_id))
        )
        authorizer = auth_result.scalar_one_or_none()
        if not authorizer:
            return None, "Authorizing user not found"

        authorizations = copy.deepcopy(election.proxy_authorizations or [])

        # Prevent duplicate active authorization for the same delegating member
        for auth in authorizations:
            if auth.get("delegating_user_id") == str(
                delegating_user_id
            ) and not auth.get("revoked_at"):
                return (
                    None,
                    f"{delegating_user.full_name} already has an active proxy authorization for this election",
                )

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

        await self._audit(
            "proxy_authorization_granted",
            {
                "election_id": str(election_id),
                "election_title": election.title,
                "delegating_user_id": str(delegating_user_id),
                "delegating_user_name": delegating_user.full_name,
                "proxy_user_id": str(proxy_user_id),
                "proxy_user_name": proxy_user.full_name,
                "proxy_type": proxy_type,
                "reason": reason,
            },
            severity="warning",
            user_id=str(authorized_by),
        )

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

        authorizations = copy.deepcopy(election.proxy_authorizations or [])
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
                    return (
                        False,
                        "Cannot revoke — the proxy has already cast a vote using this authorization",
                    )

                auth["revoked_at"] = datetime.now(timezone.utc).isoformat()
                found = True
                break

        if not found:
            return False, "Proxy authorization not found"

        election.proxy_authorizations = authorizations
        await self.db.commit()

        await self._audit(
            "proxy_authorization_revoked",
            {
                "election_id": str(election_id),
                "authorization_id": authorization_id,
            },
            severity="info",
            user_id=str(revoked_by),
        )

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
            a
            for a in auths
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

        try:
            delegating_user_id = UUID(auth["delegating_user_id"])
        except (ValueError, KeyError):
            return None, "Invalid proxy authorization data"

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

        # Compute voter identity for hashing
        voter_hash = (
            self._generate_voter_hash(
                delegating_user_id, election_id, election.voter_anonymity_salt or ""
            )
            if election.anonymous_voting
            else None
        )
        voter_id_or_hash = voter_hash or str(delegating_user_id)

        # Create the vote as the delegating member, with proxy metadata
        vote = Vote(
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=delegating_user_id if not election.anonymous_voting else None,
            voter_hash=voter_hash,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc),
            is_proxy_vote=True,
            proxy_voter_id=str(proxy_user_id),
            proxy_authorization_id=proxy_authorization_id,
            proxy_delegating_user_id=str(delegating_user_id),
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election_id, voter_id_or_hash, position
            ),
        )
        vote.vote_signature = self._sign_vote(vote)
        vote.chain_hash = self._compute_chain_hash(
            election.last_chain_hash, vote.vote_signature
        )
        vote.receipt_hash = self._compute_receipt_hash(
            str(vote.id), vote.vote_signature
        )
        self.db.add(vote)
        election.last_chain_hash = vote.chain_hash

        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Proxy double-vote attempt blocked | election={election_id} "
                f"delegating={delegating_user_id} proxy={proxy_user_id}"
            )
            await self._audit(
                "proxy_vote_double_attempt",
                {
                    "election_id": str(election_id),
                    "delegating_user_id": str(delegating_user_id),
                    "proxy_user_id": str(proxy_user_id),
                    "authorization_id": proxy_authorization_id,
                },
                severity="warning",
                user_id=str(proxy_user_id),
                ip_address=ip_address,
            )
            return (
                None,
                "Database integrity check: the delegating member has already voted",
            )

        logger.info(
            f"Proxy vote cast | election={election_id} position={position} "
            f"delegating={delegating_user_id} proxy={proxy_user_id} "
            f"auth={proxy_authorization_id} vote_id={vote.id}"
        )
        await self._audit(
            "proxy_vote_cast",
            {
                "election_id": str(election_id),
                "vote_id": str(vote.id),
                "position": position,
                "delegating_user_id": str(delegating_user_id),
                "proxy_user_id": str(proxy_user_id),
                "authorization_id": proxy_authorization_id,
                "anonymous": election.anonymous_voting,
            },
            severity="info",
            user_id=str(proxy_user_id),
            ip_address=ip_address,
        )

        return vote, None

    async def send_ballot_emails(
        self,
        election_id: UUID,
        organization_id: UUID,
        recipient_user_ids: Optional[List[UUID]] = None,
        subject: Optional[str] = None,
        message: Optional[str] = None,
        base_ballot_url: Optional[str] = None,
    ) -> Tuple[int, int, int, List[Dict]]:
        """
        Send ballot notification emails to eligible voters with unique hashed links.

        Members with zero eligible ballot items are skipped (not sent
        an empty ballot). A per-member reason is included in ``skipped_details``.

        Returns: (recipients_count, failed_count, skipped_count, skipped_details)
        """
        # Get election
        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = election_result.scalar_one_or_none()

        if not election:
            logger.warning(
                f"Cannot send ballot emails: election not found | "
                f"election={election_id} org={organization_id}"
            )
            return 0, 0, 0, []

        # Load organization separately to avoid INNER JOIN masking the election
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        if not organization:
            logger.error(
                f"Cannot send ballot emails: organization not found | "
                f"election={election_id} org={organization_id}"
            )
            return 0, 0, 0, []

        # Determine recipients (eagerly load roles for eligibility checks)
        if recipient_user_ids:
            # Use specified recipients
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([str(uid) for uid in recipient_user_ids]))
                .where(User.organization_id == str(organization_id))
                .options(selectinload(User.roles))
            )
            recipients = users_result.scalars().all()
        elif election.eligible_voters:
            # Use election's eligible voters list
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([str(v) for v in election.eligible_voters]))
                .where(User.organization_id == str(organization_id))
                .options(selectinload(User.roles))
            )
            recipients = users_result.scalars().all()
            if not recipients:
                logger.warning(
                    f"No matching users for eligible_voters list | "
                    f"election={election_id} "
                    f"eligible_voter_ids={election.eligible_voters}"
                )
        else:
            # Send to all active users in organization
            users_result = await self.db.execute(
                select(User)
                .where(User.organization_id == str(organization_id))
                .where(User.is_active == True)  # noqa: E712
                .options(selectinload(User.roles))
            )
            recipients = users_result.scalars().all()

        if not recipients:
            logger.warning(
                f"No recipients found for ballot emails | "
                f"election={election_id} org={organization_id} "
                f"eligible_voters_set={election.eligible_voters is not None}"
                f" recipient_ids_provided={bool(recipient_user_ids)}"
            )
            return 0, 0, 0, []

        # Initialize email service with organization settings
        email_service = EmailService(organization)

        # Pre-load the admin-configured ballot notification template (once)
        # so each recipient's email can be rendered without a per-email DB query.
        ballot_template = None
        try:
            from app.models.email_template import EmailTemplateType
            from app.services.email_template_service import EmailTemplateService

            template_service = EmailTemplateService(self.db)
            ballot_template = await template_service.get_template(
                str(organization_id), EmailTemplateType.BALLOT_NOTIFICATION
            )
        except Exception as e:
            logger.warning(
                f"Failed to load ballot notification template, "
                f"using default | election={election_id} error={e}"
            )

        # Build a lookup of delegating_user_id -> proxy user email
        # so we can CC the proxy holder on ballot notifications.
        # Batch-fetch all proxy users in a single query instead of N+1.
        proxy_cc_map: Dict[str, str] = {}
        proxy_user_ids: set = set()
        proxy_mappings: List[Tuple[str, str]] = []
        for auth in election.proxy_authorizations or []:
            if not auth.get("revoked_at"):
                proxy_uid = auth.get("proxy_user_id")
                delegating_uid = auth.get("delegating_user_id")
                if proxy_uid and delegating_uid:
                    proxy_user_ids.add(proxy_uid)
                    proxy_mappings.append((delegating_uid, proxy_uid))
        if proxy_user_ids:
            proxy_result = await self.db.execute(
                select(User)
                .where(User.id.in_(list(proxy_user_ids)))
                .where(User.organization_id == str(organization_id))
            )
            proxy_users_by_id = {
                str(u.id): u.email for u in proxy_result.scalars().all()
            }
            for delegating_uid, proxy_uid in proxy_mappings:
                if proxy_uid in proxy_users_by_id:
                    proxy_cc_map[delegating_uid] = proxy_users_by_id[proxy_uid]

        # Resolve admin contact info (election creator or org email)
        admin_contact_name = ""
        admin_contact_email = ""
        if election.created_by:
            creator_result = await self.db.execute(
                select(User).where(User.id == election.created_by)
            )
            creator = creator_result.scalar_one_or_none()
            if creator:
                admin_contact_name = creator.full_name
                admin_contact_email = creator.email
        if not admin_contact_email:
            admin_contact_name = organization.name
            admin_contact_email = getattr(organization, "email", None) or ""

        # ---- Phase 1: Prepare emails (sequential — DB + eligibility) ----
        skipped_count = 0
        skipped_details: List[Dict] = []
        pending_emails: List[Dict] = []

        for recipient in recipients:
            # Empty ballot prevention: skip members who have zero eligible
            # ballot items so they don't receive a confusing empty ballot.
            eligible_items: List[Dict] = []
            if election.ballot_items:
                eligible_items = await self._get_eligible_ballot_items_for_user(
                    user=recipient,
                    election=election,
                    organization_id=str(organization_id),
                    organization=organization,
                )
                if not eligible_items:
                    skipped_count += 1
                    reason = await self._get_ineligibility_reason_for_user(
                        user=recipient,
                        election=election,
                        organization_id=str(organization_id),
                        organization=organization,
                    ) or (
                        "No eligible ballot items — role type and "
                        "attendance did not match any item requirements"
                    )
                    skipped_details.append(
                        {
                            "user_id": str(recipient.id),
                            "name": recipient.full_name or recipient.username,
                            "reason": reason,
                        }
                    )
                    logger.info(
                        f"Skipping ballot email for user={recipient.id} "
                        f"({reason}) | election={election_id}"
                    )
                    continue

            # Build ballot items lists for the email
            items_html, items_text = self._build_ballot_items_lists(eligible_items)

            # Generate unique voting token for this voter
            voting_token = await self._generate_voting_token(
                user_id=recipient.id,
                election_id=election_id,
                organization_id=organization_id,
                election_end_date=election.end_date,
                anonymity_salt=election.voter_anonymity_salt or "",
            )

            # Build unique ballot URL with token
            ballot_url = (
                f"{base_ballot_url}?token={voting_token.token}"
                if base_ballot_url
                else None
            )

            # If this voter has a proxy, CC the proxy holder
            cc_email = proxy_cc_map.get(str(recipient.id))

            pending_emails.append(
                {
                    "recipient_id": str(recipient.id),
                    "to_email": recipient.email,
                    "recipient_name": recipient.full_name,
                    "election_title": election.title,
                    "ballot_url": ballot_url,
                    "meeting_date": election.meeting_date,
                    "custom_message": message,
                    "cc_emails": [cc_email] if cc_email else None,
                    "start_date": election.start_date,
                    "end_date": election.end_date,
                    "positions": election.positions,
                    "ballot_items_html": items_html,
                    "ballot_items_text": items_text,
                    "admin_contact_name": admin_contact_name,
                    "admin_contact_email": admin_contact_email,
                }
            )

        # ---- Phase 2: Render + batch send via single SMTP connection ----
        # Render each email using the pre-loaded template (or default),
        # build MIME messages, then send all through one SMTP connection
        # to avoid per-email TCP+TLS+auth overhead.
        mime_messages = []
        # Track which user ID corresponds to each slot in mime_messages
        # so we can correlate send results back to specific users.
        mime_user_ids: List[Optional[str]] = []
        for params in pending_emails:
            rid = params.pop("recipient_id")
            cc_emails = params.pop("cc_emails", None)
            try:
                subj, html_body, text_body = email_service.render_ballot_notification(
                    recipient_name=params["recipient_name"],
                    election_title=params["election_title"],
                    ballot_url=params["ballot_url"],
                    meeting_date=params["meeting_date"],
                    custom_message=params["custom_message"],
                    start_date=params["start_date"],
                    end_date=params["end_date"],
                    positions=params["positions"],
                    ballot_items_html=params["ballot_items_html"],
                    ballot_items_text=params["ballot_items_text"],
                    admin_contact_name=params["admin_contact_name"],
                    admin_contact_email=params["admin_contact_email"],
                    template=ballot_template,
                )
                recipients, msg_str = email_service.build_message(
                    to_email=params["to_email"],
                    subject=subj,
                    html_body=html_body,
                    text_body=text_body,
                    cc_emails=cc_emails,
                    reply_to=admin_contact_email or None,
                    list_unsubscribe=(
                        f"mailto:{admin_contact_email}" if admin_contact_email else None
                    ),
                )
                mime_messages.append((recipients, msg_str))
                mime_user_ids.append(rid)
            except Exception as e:
                logger.error(
                    f"Ballot email render failed | election={election_id} "
                    f"recipient={rid} error={e}"
                )
                mime_messages.append(None)
                mime_user_ids.append(rid)

        # Send all rendered messages through a single SMTP connection
        if any(m is not None for m in mime_messages):
            batch_to_send = [m for m in mime_messages if m is not None]
            send_results = await email_service.send_batch(batch_to_send)

            # Map results back, counting None entries as failures and
            # recording which user IDs actually received their email.
            result_iter = iter(send_results)
            success_count = 0
            failed_count = 0
            sent_user_ids: List[str] = []
            for idx, m in enumerate(mime_messages):
                uid = mime_user_ids[idx]
                if m is None:
                    failed_count += 1
                elif next(result_iter):
                    success_count += 1
                    if uid:
                        sent_user_ids.append(uid)
                else:
                    failed_count += 1
        else:
            success_count = 0
            failed_count = len(mime_messages)
            sent_user_ids = []

        # Update election with email sent status — only record the user
        # IDs whose email was actually delivered to the SMTP server.
        # Previously this stored ALL intended recipients (including
        # skipped and failed), causing the UI to show members as
        # "ballot sent" when they never received one.
        election.email_sent = True
        election.email_sent_at = datetime.now(timezone.utc)
        election.email_recipients = sent_user_ids

        # Commit all voting tokens and election updates
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(
            f"Ballot emails sent | election={election_id} "
            f"success={success_count} failed={failed_count} "
            f"skipped_empty={skipped_count}"
        )
        await self._audit(
            "ballot_emails_sent",
            {
                "election_id": str(election_id),
                "title": election.title,
                "recipients": success_count,
                "failed": failed_count,
                "skipped_empty_ballot": skipped_count,
            },
        )

        return success_count, failed_count, skipped_count, skipped_details

    async def generate_and_send_election_report(
        self,
        election_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, str]:
        """
        Generate and send an election report email to the secretary (election
        creator) and any leadership members.

        The report includes:
        - Election results (per-position winners, vote counts, percentages)
        - Quorum status
        - Who received ballots
        - Who didn't receive ballots and why

        Returns: (success, message)
        """
        from app.services.email_service import EmailService

        # Load election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return False, "Election not found"

        # Load organization
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return False, "Organization not found"

        # Get election results (bypass visibility check since we're
        # generating the official report after closing)
        results = await self.get_election_results(
            election_id, organization_id, _internal_bypass_visibility=True
        )

        # Build results HTML/text
        results_html, results_text = self._build_results_tables(results)

        # Determine eligible voters count and build turnout info
        total_eligible = 0
        total_votes = 0
        turnout = 0.0
        quorum_status = "N/A"
        quorum_detail = ""

        if results:
            total_eligible = results.total_eligible_voters
            total_votes = results.total_votes
            turnout = results.voter_turnout_percentage
            quorum_status = "Quorum Met" if results.quorum_met else "Quorum NOT Met"
            quorum_detail = results.quorum_detail or ""

        # Build ballot recipients list and skipped voters list
        ballot_recipients_html, ballot_recipients_text = (
            await self._build_ballot_recipient_lists(election, organization_id)
        )
        skipped_html, skipped_text = await self._build_skipped_voter_lists(
            election, organization_id
        )

        # Determine report recipients (election creator + leadership)
        to_emails = []
        recipient_name = "Secretary"
        if election.created_by:
            creator_result = await self.db.execute(
                select(User).where(User.id == election.created_by)
            )
            creator = creator_result.scalar_one_or_none()
            if creator and creator.email:
                to_emails.append(creator.email)
                recipient_name = creator.full_name or "Secretary"

        if not to_emails:
            return False, "No recipient found for election report"

        # Format dates using org timezone
        org_tz = getattr(organization, "timezone", None) or "America/New_York"
        try:
            tz = ZoneInfo(org_tz)
        except Exception:
            tz = ZoneInfo("America/New_York")

        def _fmt_dt(dt):
            if not dt:
                return ""
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(tz).strftime("%B %d, %Y at %I:%M %p")

        email_service = EmailService(organization)
        success_count, failure_count = await email_service.send_election_report(
            to_emails=to_emails,
            recipient_name=recipient_name,
            election_title=election.title,
            election_type=election.election_type or "General",
            start_date=_fmt_dt(election.start_date),
            end_date=_fmt_dt(election.end_date),
            total_eligible_voters=total_eligible,
            total_votes_cast=total_votes,
            voter_turnout_percentage=turnout,
            quorum_status=quorum_status,
            quorum_detail=quorum_detail,
            results_html=results_html,
            results_text=results_text,
            ballot_recipients_html=ballot_recipients_html,
            ballot_recipients_text=ballot_recipients_text,
            skipped_voters_html=skipped_html,
            skipped_voters_text=skipped_text,
            db=self.db,
            organization_id=str(organization_id),
        )

        if success_count > 0:
            logger.info(
                f"Election report sent | election={election_id} " f"to={to_emails}"
            )
            return True, f"Election report sent to {', '.join(to_emails)}"
        else:
            logger.error(
                f"Failed to send election report | election={election_id} "
                f"failures={failure_count}"
            )
            return False, "Failed to send election report email"

    async def send_eligibility_summary_email(
        self,
        election_id: UUID,
        organization_id: UUID,
        sent_count: int,
        skipped_count: int,
        skipped_details: List[Dict],
    ) -> Tuple[bool, str]:
        """
        Send the secretary an email summarizing who received ballots
        and who was skipped (with per-member reasons).

        Called after ballot emails are dispatched when the secretary
        opts in via the send_eligibility_summary flag.

        Returns: (success, message)
        """
        from app.services.email_service import EmailService

        # Load election
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return False, "Election not found"

        # Load organization
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return False, "Organization not found"

        # Determine the secretary (election creator)
        to_emails: List[str] = []
        secretary_name = "Secretary"
        if election.created_by:
            creator_result = await self.db.execute(
                select(User).where(User.id == election.created_by)
            )
            creator = creator_result.scalar_one_or_none()
            if creator and creator.email:
                to_emails.append(creator.email)
                secretary_name = creator.full_name or "Secretary"

        if not to_emails:
            return False, "No recipient found for eligibility summary"

        # Look up recipient names from election.email_recipients
        recipient_names: List[str] = []
        email_recipient_ids = election.email_recipients or []
        if email_recipient_ids:
            users_result = await self.db.execute(
                select(User).where(
                    User.id.in_([str(uid) for uid in email_recipient_ids])
                )
            )
            recipient_users = users_result.scalars().all()
            recipient_names = [u.full_name or u.username for u in recipient_users]

        # Build the recipients list (who got ballots)
        recipients_html_parts = ["<ul>"]
        recipients_text_parts = []
        for name in sorted(recipient_names):
            safe_name = html.escape(name)
            recipients_html_parts.append(f"<li>{safe_name}</li>")
            recipients_text_parts.append(f"  - {name}")
        recipients_html_parts.append("</ul>")
        if not recipient_names:
            recipients_html_parts = ["<p><em>No members received ballots.</em></p>"]
            recipients_text_parts = ["  (none)"]

        recipients_html = "\n".join(recipients_html_parts)
        recipients_text = "\n".join(recipients_text_parts)

        # Build the skipped voters table (who was skipped and why)
        if skipped_details:
            skipped_html_parts = [
                '<table style="width:100%;border-collapse:collapse;'
                'margin-top:8px;">',
                "<tr>"
                '<th style="text-align:left;padding:8px;border-bottom:'
                '2px solid #e5e7eb;font-weight:600;">Member</th>'
                '<th style="text-align:left;padding:8px;border-bottom:'
                '2px solid #e5e7eb;font-weight:600;">Reason</th>'
                "</tr>",
            ]
            skipped_text_parts = []
            for detail in sorted(skipped_details, key=lambda d: d["name"]):
                safe_name = html.escape(detail["name"])
                safe_reason = html.escape(detail["reason"])
                skipped_html_parts.append(
                    f'<tr><td style="padding:8px;border-bottom:1px solid '
                    f'#e5e7eb;">{safe_name}</td>'
                    f'<td style="padding:8px;border-bottom:1px solid '
                    f'#e5e7eb;">{safe_reason}</td></tr>'
                )
                skipped_text_parts.append(f"  - {detail['name']}: {detail['reason']}")
            skipped_html_parts.append("</table>")
            skipped_html = "\n".join(skipped_html_parts)
            skipped_text = "\n".join(skipped_text_parts)
        else:
            skipped_html = (
                "<p><em>All members met eligibility requirements "
                "&mdash; no one was skipped.</em></p>"
            )
            skipped_text = "  All members met eligibility requirements."

        # Attendee count
        total_checked_in = len(election.attendees or [])

        email_service = EmailService(organization)
        success_count, failure_count = await email_service.send_eligibility_summary(
            to_emails=to_emails,
            recipient_name=secretary_name,
            election_title=election.title,
            sent_count=sent_count,
            skipped_count=skipped_count,
            total_checked_in=total_checked_in,
            recipients_html=recipients_html,
            recipients_text=recipients_text,
            skipped_voters_html=skipped_html,
            skipped_voters_text=skipped_text,
            db=self.db,
            organization_id=str(organization_id),
        )

        if success_count > 0:
            logger.info(
                f"Eligibility summary sent | election={election_id} " f"to={to_emails}"
            )
            return True, f"Eligibility summary sent to {', '.join(to_emails)}"
        else:
            logger.error(
                f"Failed to send eligibility summary | "
                f"election={election_id} failures={failure_count}"
            )
            return False, "Failed to send eligibility summary email"

    def _build_results_tables(self, results) -> Tuple[str, str]:
        """Build HTML and plain-text tables of election results."""
        if not results or not results.results_by_position:
            return (
                "<p><em>No results available.</em></p>",
                "No results available.",
            )

        # HTML table
        rows = []
        rows.append(
            '<table style="width:100%;border-collapse:collapse;margin:10px 0;">'
            '<tr style="background:#f3f4f6;">'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Position</th>'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Candidate</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Votes</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">%</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Result</th>'
            "</tr>"
        )

        text_parts = []
        for pos_result in results.results_by_position:
            position = html.escape(pos_result.position)
            text_parts.append(f"Position: {pos_result.position}")
            for candidate in pos_result.candidates:
                name = html.escape(candidate.candidate_name)
                pct = f"{candidate.percentage:.1f}%"
                result_label = "\u2705 Elected" if candidate.is_winner else "\u2014"
                rows.append(
                    f'<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">{position}</td>'
                    f'<td style="padding:8px;border-bottom:1px solid #e5e7eb;">{name}</td>'
                    f'<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">{candidate.vote_count}</td>'
                    f'<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">{pct}</td>'
                    f'<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">{result_label}</td></tr>'
                )
                winner_text = " — ELECTED" if candidate.is_winner else ""
                text_parts.append(
                    f"  {candidate.candidate_name} — {candidate.vote_count} votes ({pct}){winner_text}"
                )

        rows.append("</table>")
        return "\n".join(rows), "\n".join(text_parts)

    async def _build_ballot_recipient_lists(
        self, election: Election, organization_id: str
    ) -> Tuple[str, str]:
        """Build HTML and text lists of members who received ballots."""
        recipient_ids = election.email_recipients or []
        if not recipient_ids:
            return (
                "<p><em>No ballot emails were sent.</em></p>",
                "No ballot emails were sent.",
            )

        users_result = await self.db.execute(
            select(User)
            .where(User.id.in_([str(uid) for uid in recipient_ids]))
            .where(User.organization_id == organization_id)
        )
        users = users_result.scalars().all()

        if not users:
            return (
                "<p><em>No ballot emails were sent.</em></p>",
                "No ballot emails were sent.",
            )

        html_items = []
        text_items = []
        for user in sorted(users, key=lambda u: u.full_name or u.username):
            name = html.escape(user.full_name or user.username)
            email_addr = html.escape(user.email)
            html_items.append(f"<li>{name} ({email_addr})</li>")
            text_items.append(f"  - {user.full_name or user.username} ({user.email})")

        return (
            f"<ul>{''.join(html_items)}</ul>",
            "\n".join(text_items),
        )

    async def _build_skipped_voter_lists(
        self, election: Election, organization_id: str
    ) -> Tuple[str, str]:
        """Build HTML and text lists of members who did NOT receive ballots, with reasons."""
        recipient_ids = set(str(uid) for uid in (election.email_recipients or []))

        # Get all active users in the org
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.is_active == True)  # noqa: E712
            .options(selectinload(User.roles))
        )
        all_active = users_result.scalars().all()

        # Find users who didn't get a ballot
        skipped_users = [u for u in all_active if str(u.id) not in recipient_ids]

        if not skipped_users:
            return (
                "<p><em>All active members received ballots.</em></p>",
                "All active members received ballots.",
            )

        html_rows = [
            '<table style="width:100%;border-collapse:collapse;margin:10px 0;">'
            '<tr style="background:#f3f4f6;">'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Member</th>'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Reason</th>'
            "</tr>"
        ]
        text_items = []

        for user in sorted(skipped_users, key=lambda u: u.full_name or u.username):
            reason = await self._get_ineligibility_reason_for_user(
                user=user,
                election=election,
                organization_id=organization_id,
            )
            if not reason:
                # Check if they were in the eligible list at all
                eligible_list = election.eligible_voters
                if eligible_list and str(user.id) not in [
                    str(v) for v in eligible_list
                ]:
                    reason = (
                        "Not in the eligible voters list — this election "
                        "is restricted to specific members"
                    )
                else:
                    reason = (
                        "No eligible ballot items — member's role type and "
                        "attendance status did not match any item requirements"
                    )

            name = html.escape(user.full_name or user.username)
            safe_reason = html.escape(reason)
            html_rows.append(
                f'<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">{name}</td>'
                f'<td style="padding:8px;border-bottom:1px solid #e5e7eb;">{safe_reason}</td></tr>'
            )
            text_items.append(f"  - {user.full_name or user.username}: {reason}")

        html_rows.append("</table>")
        return "\n".join(html_rows), "\n".join(text_items)

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
            select(VotingToken).where(VotingToken.token == token)
        )
        voting_token = result.scalar_one_or_none()

        if not voting_token:
            return None, None, "Invalid voting token"

        # Check if token has expired
        token_exp = (
            voting_token.expires_at.replace(tzinfo=timezone.utc)
            if voting_token.expires_at.tzinfo is None
            else voting_token.expires_at
        )
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
            select(Election).where(Election.id == voting_token.election_id)
        )
        election = election_result.scalar_one_or_none()

        if not election:
            return None, None, "Election not found"

        # Check if election is still open
        now = datetime.now(timezone.utc)
        start = (
            election.start_date.replace(tzinfo=timezone.utc)
            if election.start_date and election.start_date.tzinfo is None
            else election.start_date
        )
        end = (
            election.end_date.replace(tzinfo=timezone.utc)
            if election.end_date and election.end_date.tzinfo is None
            else election.end_date
        )
        if election.status != ElectionStatus.OPEN:
            return None, None, f"Election is {election.status.value}"

        if start and now < start:
            return None, None, "Voting has not started yet"

        if end and now > end:
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
            return None, (
                f"You have already voted for {position}"
                if position
                else "You have already voted"
            )

        # Check max votes per position
        if position:
            position_votes = [v for v in existing_votes if v.position == position]
            if len(position_votes) >= election.max_votes_per_position:
                return None, f"Maximum votes for {position} reached"

        # Create the vote with security hashes
        vote = Vote(
            election_id=election.id,
            candidate_id=candidate_id,
            voter_id=None,  # Anonymous - not stored
            voter_hash=voting_token.voter_hash,
            position=position,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc),
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election.id, voting_token.voter_hash, position
            ),
        )

        # Sign the vote for tampering detection
        vote.vote_signature = self._sign_vote(vote)

        # Sequential chain hash and voter receipt
        vote.chain_hash = self._compute_chain_hash(
            election.last_chain_hash, vote.vote_signature
        )
        vote.receipt_hash = self._compute_receipt_hash(
            str(vote.id), vote.vote_signature
        )

        self.db.add(vote)

        # Update election chain pointer
        election.last_chain_hash = vote.chain_hash

        # Track which positions have been voted on via this token
        positions_voted = copy.deepcopy(voting_token.positions_voted or [])
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

        # SECURITY: Database-level unique constraint on vote_dedup_hash
        # prevents double-voting even if race condition bypasses application checks
        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Token double-vote attempt blocked | election={election.id} position={position}"
            )
            await self._audit(
                "vote_double_attempt_token",
                {
                    "election_id": str(election.id),
                    "position": position,
                },
                severity="warning",
                ip_address=ip_address,
            )
            if position:
                return (
                    None,
                    f"Database integrity check: You have already voted for {position}",
                )
            return (
                None,
                "Database integrity check: You have already voted in this election",
            )

        logger.info(
            f"Token vote cast | election={election.id} position={position} vote_id={vote.id}"
        )
        await self._audit(
            "vote_cast_token",
            {
                "election_id": str(election.id),
                "vote_id": str(vote.id),
                "position": position,
            },
            ip_address=ip_address,
        )

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
                return (
                    None,
                    f"You have already voted on: {ballot_item.get('title', ballot_item_id)}",
                )

            # Determine candidate_id based on choice
            candidate_id = None

            if choice == "write_in":
                if not write_in_name or not write_in_name.strip():
                    return (
                        None,
                        f"Write-in name is required for: {ballot_item.get('title', ballot_item_id)}",
                    )

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
                    return (
                        None,
                        f"Invalid candidate selection for: {ballot_item.get('title', ballot_item_id)}",
                    )
                candidate_id = UUID(choice)

            # Sanitize write-in name to prevent XSS
            if write_in_name and choice == "write_in":
                write_in_candidate.name = html.escape(write_in_name.strip())

            # Create the vote with security hashes
            vote = Vote(
                election_id=election.id,
                candidate_id=candidate_id,
                voter_id=None,
                voter_hash=voting_token.voter_hash,
                position=position,
                ip_address=ip_address,
                user_agent=user_agent,
                voted_at=datetime.now(timezone.utc),
                vote_dedup_hash=self._compute_vote_dedup_hash(
                    election.id, voting_token.voter_hash, position
                ),
            )
            vote.vote_signature = self._sign_vote(vote)
            vote.chain_hash = self._compute_chain_hash(
                election.last_chain_hash, vote.vote_signature
            )
            vote.receipt_hash = self._compute_receipt_hash(
                str(vote.id), vote.vote_signature
            )
            election.last_chain_hash = vote.chain_hash
            self.db.add(vote)
            created_votes.append(vote)

        # Mark token as fully used
        voting_token.used = True
        voting_token.used_at = datetime.now(timezone.utc)
        voting_token.positions_voted = [
            v.get("ballot_item_id") for v in votes if v.get("choice") != "abstain"
        ]

        # Commit all votes atomically
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            logger.warning(f"Ballot double-submission blocked | election={election.id}")
            await self._audit(
                "vote_double_attempt_token",
                {
                    "election_id": str(election.id),
                    "type": "bulk_ballot_submission",
                },
                severity="warning",
                ip_address=ip_address,
            )
            return None, "This ballot has already been submitted"

        logger.info(
            f"Ballot submitted | election={election.id} "
            f"votes={len(created_votes)} abstentions={abstentions}"
        )
        await self._audit(
            "ballot_submitted_token",
            {
                "election_id": str(election.id),
                "votes_cast": len(created_votes),
                "abstentions": abstentions,
            },
            ip_address=ip_address,
        )

        return {
            "success": True,
            "votes_cast": len(created_votes),
            "abstentions": abstentions,
            "message": f"Ballot submitted successfully. {len(created_votes)} vote(s) cast, {abstentions} abstention(s).",
        }, None
