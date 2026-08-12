"""
Election Service

Business logic for election management including elections, candidates, voting, and results.
"""

import copy
import hashlib
import hmac
import html
import os
import re
import secrets
import tempfile
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy import update as sql_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.constants import LEADERSHIP_ROLE_SLUGS
from app.models.election import (
    Candidate,
    Election,
    ElectionStatus,
    ManualBallotAttestation,
    ManualBallotBatch,
    Vote,
    VotingToken,
)
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
from app.services.email_theme import TABLE_STYLE, TD_STYLE, TH_STYLE


class ElectionService:
    """Service for election management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _ensure_utc(dt: datetime | None) -> datetime | None:
        """Stamp naive datetimes with UTC tzinfo."""
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    # Per-organization feature flags (org.settings["election_features"]).
    # Everything defaults ON so existing behavior is unchanged; departments
    # opt OUT via Election Settings. Auto-close is deliberately NOT a flag:
    # votes are already rejected after end_date, and closing is what runs
    # result finalization and the anonymous-election IP/salt purge — a
    # department cannot opt out of that privacy guarantee.
    # Minimum minutes between non-voter reminder sends (manual or automatic).
    REMINDER_COOLDOWN_MINUTES = 60

    # Anti-spam: a member may have at most this many PENDING (un-accepted)
    # third-party nominations outstanding per election.
    MAX_PENDING_NOMINATIONS_PER_MEMBER = 10

    FEATURE_DEFAULTS = {
        "nominations_enabled": True,
        "paper_ballots_enabled": True,
        "reminders_enabled": True,
        "auto_open_enabled": True,
    }

    # Officers (other than the recorder) who must confirm a paper-ballot
    # batch before its votes count. 0 disables attestation entirely.
    PAPER_ATTESTATIONS_DEFAULT = 2
    PAPER_ATTESTATIONS_MAX = 3

    async def get_feature_flags(self, organization_id: UUID) -> Dict[str, bool]:
        """Resolve the org's election feature toggles (missing keys = ON)."""
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = result.scalar_one_or_none()
        features = ((org.settings or {}) if org else {}).get("election_features", {})
        if not isinstance(features, dict):
            features = {}
        return {
            key: bool(features.get(key, default))
            for key, default in self.FEATURE_DEFAULTS.items()
        }

    async def get_required_attestations(self, organization_id: UUID) -> int:
        """How many officers must attest a paper-ballot batch (0 = off)."""
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = result.scalar_one_or_none()
        features = ((org.settings or {}) if org else {}).get("election_features", {})
        if not isinstance(features, dict):
            features = {}
        try:
            required = int(
                features.get(
                    "paper_ballot_attestations_required",
                    self.PAPER_ATTESTATIONS_DEFAULT,
                )
            )
        except (TypeError, ValueError):
            required = self.PAPER_ATTESTATIONS_DEFAULT
        return max(0, min(required, self.PAPER_ATTESTATIONS_MAX))

    async def _exclude_unattested(self, election_id: UUID, votes: List) -> List:
        """Drop manual votes whose batch is still awaiting attestations.

        Pending batches are recorded and chained but unconfirmed claims —
        they must not move results or stats until the required officers
        attest them. Batches with no batch row (recorded before the
        attestation feature existed) count as confirmed.
        """
        batch_ids = {getattr(v, "manual_batch_id", None) for v in votes}
        batch_ids.discard(None)
        if not batch_ids:
            return list(votes)
        result = await self.db.execute(
            select(ManualBallotBatch.id).where(
                ManualBallotBatch.election_id == str(election_id),
                ManualBallotBatch.id.in_(batch_ids),
                ManualBallotBatch.status == "pending",
            )
        )
        pending = {row[0] for row in result.all()}
        if not pending:
            return list(votes)
        return [v for v in votes if getattr(v, "manual_batch_id", None) not in pending]

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

    @staticmethod
    def _audit_ip(election: "Election", ip_address: Optional[str]) -> Optional[str]:
        """IP to record on a voter-action audit event, or None.

        Audit rows are hash-chained (ip_address is part of the chain input),
        so they can never be scrubbed after the fact — unlike Vote.ip_address,
        which feeds live ballot-stuffing detection and is purged at close.
        For anonymous elections a voter's IP therefore must not enter the
        audit log at all (ELEC-6 residual). Non-anonymous elections keep it.
        """
        return None if election.anonymous_voting else ip_address

    # ------------------------------------------------------------------
    # Election CRUD helpers
    # ------------------------------------------------------------------

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

    async def annotate_ballot_items_for_user(
        self,
        user: "User",
        election: Election,
        organization_id: str,
        organization: Optional["Organization"] = None,
    ) -> List[Dict]:
        """
        Annotate every ballot item with this user's eligibility and, when
        ineligible, a human-readable reason.

        This is the single source of truth for per-item eligibility —
        the real ballot filter (_get_eligible_ballot_items_for_user) and the
        secretary's preview-ballot endpoint both derive from it, so the
        preview can never disagree with what the member actually receives.
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
        tier_name = member_tier_id
        if tier_def:
            benefits = tier_def.get("benefits", {})
            tier_voting_eligible = benefits.get("voting_eligible", True)
            tier_name = tier_def.get("name", member_tier_id)

        # Secretary override check
        has_override = False
        if election.voter_overrides:
            has_override = any(
                o.get("user_id") == str(user.id) for o in election.voter_overrides
            )

        annotated_items: List[Dict] = []
        for item in ballot_items:
            eligible = True
            reason = None

            # A secretary override grants eligibility for every item
            if has_override:
                pass
            elif not tier_voting_eligible:
                eligible = False
                reason = f"Membership tier '{tier_name}' is not eligible to vote"
            else:
                eligible_types = item.get("eligible_voter_types", ["all"])
                if not await self._user_has_role_type(user, eligible_types):
                    member_type = getattr(user, "membership_type", None) or "active"
                    eligible = False
                    reason = (
                        f"Requires voter type(s): {', '.join(eligible_types)}; "
                        f"member has: {member_type}"
                    )
                elif item.get(
                    "require_attendance", False
                ) and not self._is_user_attending(str(user.id), election):
                    eligible = False
                    reason = "Member must be checked in as present at the meeting"

            annotated_items.append(
                {
                    **item,
                    "eligibility": {"eligible": eligible, "reason": reason},
                }
            )

        return annotated_items

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

        Derived from annotate_ballot_items_for_user so the filter and the
        secretary preview always agree.
        """
        annotated = await self.annotate_ballot_items_for_user(
            user, election, organization_id, organization
        )
        return [
            {k: v for k, v in item.items() if k != "eligibility"}
            for item in annotated
            if item["eligibility"]["eligible"]
        ]

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
        start = self._ensure_utc(election.start_date)
        end = self._ensure_utc(election.end_date)
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

        # ---- Voter roll frozen at open ----
        # When a snapshot exists, eligibility means "on the roll when voting
        # opened" — a mid-election membership change cannot add voters. A
        # secretary override granted during the meeting still counts.
        snapshot = getattr(election, "eligible_roster_snapshot", None)
        if snapshot is not None and not _has_override:
            if str(user_id) not in snapshot:
                return VoterEligibility(
                    is_eligible=False,
                    has_voted=False,
                    positions_voted=[],
                    positions_remaining=[],
                    reason=(
                        "You are not on the voter roll that was frozen when "
                        "this election opened. Contact the election "
                        "administrator if you believe this is an error."
                    ),
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

        # For non-positional single-vote elections, only one vote total.
        # Approval, ranked-choice, and multi-vote elections legitimately
        # record several votes per voter; their duplicate rules are enforced
        # per-candidate/per-rank in cast_vote.
        single_vote_method = (
            election.voting_method not in ("approval", "ranked_choice")
            and (election.max_votes_per_position or 1) <= 1
        )
        if not all_positions and has_voted and single_vote_method:
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
        commit: bool = True,
    ) -> Tuple[Optional[Vote], Optional[str]]:
        """
        Cast a vote for a candidate

        When ``commit`` is False the vote is flushed but not committed and any
        IntegrityError propagates — the caller owns the transaction (used by
        the bulk endpoint for all-or-nothing multi-vote submission).

        Returns: (Vote object, error message)
        """
        # Check eligibility. This gate is authoritative: check_voter_eligibility
        # enforces election status, the open/close window, restricted
        # eligible-voter lists, membership-tier/attendance rules, and — because
        # position is passed — per-position and per-ballot-item voter-type and
        # attendance restrictions. Skipping it would let any authenticated
        # member vote in a draft/closed election, outside the voting window,
        # without being on the eligible list, or on items restricted to other
        # member classes.
        eligibility = await self.check_voter_eligibility(
            user_id, election_id, organization_id, position=position
        )
        if not eligibility.is_eligible:
            return None, eligibility.reason or "You are not eligible to vote"

        # Serialize vote validation and insertion for this election. The
        # method-aware dedup hash permits distinct candidates/ranks, so its
        # unique constraint cannot enforce per-voter limits by itself.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        # Validate vote_rank matches voting method
        if election.voting_method == "ranked_choice" and vote_rank is None:
            return None, "vote_rank is required for ranked-choice voting"
        if election.voting_method != "ranked_choice" and vote_rank is not None:
            return None, "vote_rank is not applicable for this voting method"

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

        # Method-aware duplicate and limit checks. Approval voting records one
        # vote per approved candidate and ranked choice one vote per rank, so
        # a blanket "already voted for this position" rule would reject every
        # legitimate second vote (module-audit ELEC-3).
        existing_votes = await self._get_user_votes(user_id, election_id, election)
        position_votes = [v for v in existing_votes if v.position == position]

        if election.voting_method == "ranked_choice":
            if any(v.vote_rank == vote_rank for v in position_votes):
                return None, (
                    f"You have already cast a rank-{vote_rank} vote"
                    + (f" for {position}" if position else "")
                )
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already ranked this candidate"
        elif election.voting_method == "approval":
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already voted for this candidate"
        else:
            max_votes = election.max_votes_per_position or 1
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already voted for this candidate"
            if len(position_votes) >= max_votes:
                if position:
                    if max_votes == 1:
                        return None, f"You have already voted for {position}"
                    return None, f"Maximum votes for {position} reached"
                if max_votes == 1:
                    return None, "You have already voted in this election"
                return None, "Maximum votes for this election reached"

        # Compute voter identity for hashing
        voter_hash = (
            self._generate_voter_hash(
                user_id, election_id, election.voter_anonymity_salt or ""
            )
            if election.anonymous_voting
            else None
        )
        voter_id_or_hash = voter_hash or str(user_id)

        # Create the vote. The id must exist BEFORE _sign_vote /
        # _compute_receipt_hash run — signatures cover the id, and the ORM
        # column default only fires at flush (signing id=None made every
        # vote fail later verification).
        vote = Vote(
            id=str(uuid4()),
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=user_id if not election.anonymous_voting else None,
            voter_hash=voter_hash,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc).replace(microsecond=0),
            # MySQL-compatible dedup hash for DB-level double-vote prevention
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election_id,
                voter_id_or_hash,
                position,
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank
                ),
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
        if not commit:
            # Caller owns the transaction (bulk voting): flush so the unique
            # constraint fires now, but let IntegrityError propagate so the
            # caller can roll back the whole batch.
            await self.db.flush()
            await self._audit(
                "vote_cast",
                {
                    "election_id": str(election_id),
                    "vote_id": str(vote.id),
                    "position": position,
                    "anonymous": election.anonymous_voting,
                    "bulk": True,
                },
                user_id=str(user_id),
                ip_address=self._audit_ip(election, ip_address),
            )
            return vote, None

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
                ip_address=self._audit_ip(election, ip_address),
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
            ip_address=self._audit_ip(election, ip_address),
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
        election_id: UUID,
        voter_id_or_hash: str,
        position: Optional[str],
        discriminator: str = "",
    ) -> str:
        """Compute a MySQL-compatible dedup hash for double-vote prevention.

        Returns SHA256(election_id:voter_id_or_hash:position[:discriminator])
        which is stored in a UNIQUE column to enforce vote uniqueness at the
        database level.

        The discriminator widens the uniqueness scope for methods that
        legitimately record several votes per position (ELEC-3): ranked
        choice passes ``rank:<n>`` (one vote per rank), approval/multi-vote
        passes ``cand:<id>`` (one vote per candidate). Single-vote elections
        pass "" — byte-identical to the legacy hash, so existing rows keep
        their protection unchanged.
        """
        pos_key = position or "__NO_POS__"
        data = f"{election_id}:{voter_id_or_hash}:{pos_key}"
        if discriminator:
            data += f":{discriminator}"
        return hashlib.sha256(data.encode()).hexdigest()

    @staticmethod
    def _dedup_discriminator(
        election: Election, candidate_id, vote_rank: Optional[int]
    ) -> str:
        """Pick the dedup-hash discriminator for this election's voting method."""
        if election.voting_method == "ranked_choice":
            return f"rank:{vote_rank}"
        if (
            election.voting_method == "approval"
            or (election.max_votes_per_position or 1) > 1
        ):
            return f"cand:{candidate_id}"
        return ""

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
        # Include vote_rank for ranked-choice integrity and proxy fields.
        # voted_at must be canonicalized to a round-trip-stable form: MySQL
        # DATETIME has second precision and returns naive values, so the raw
        # isoformat() of the aware, microsecond-bearing write-time datetime
        # would never match after reload (every vote would read as tampered).
        # Vote creation zeroes microseconds so second-precision UTC is exact.
        voted_at = self._ensure_utc(vote.voted_at)
        voted_at_canon = (
            voted_at.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")
            if voted_at
            else None
        )
        # bool(...) canonicalizes is_proxy_vote: constructors that omit it
        # sign None (the ORM default only applies at flush), but the reloaded
        # row yields False — "None" vs "False" flagged every non-proxy vote
        # as tampered on verification.
        # bool() canonicalization also applies to is_manual (paper-ballot
        # entry): covering it stops a stored paper vote from being silently
        # re-labeled as an electronic one (or vice versa).
        data = (
            f"{vote.id}:{vote.election_id}:{vote.candidate_id}"
            f":{vote.voter_hash or vote.voter_id}:{vote.position}"
            f":{vote.vote_rank}:{bool(vote.is_proxy_vote)}"
            f":{vote.proxy_delegating_user_id}:{voted_at_canon}"
            f":{bool(vote.is_manual)}"
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

        # Verify the sequential vote chain by RECONSTRUCTING the order from
        # the hashes themselves: from prev_chain, exactly one remaining vote
        # can satisfy chain_hash == H(prev_chain, signature). voted_at cannot
        # order the walk — it has second precision, so votes cast within the
        # same second sort ambiguously and a time-ordered walk reports a
        # false break.
        chain_broken = False
        chain_break_at = None
        remaining = {str(v.id): v for v in all_votes if v.chain_hash}
        prev_chain = "GENESIS"
        while remaining:
            next_vote = next(
                (
                    v
                    for v in remaining.values()
                    if v.chain_hash
                    == self._compute_chain_hash(prev_chain, v.vote_signature or "")
                ),
                None,
            )
            if next_vote is None:
                chain_broken = True
                # Earliest unlinked vote is the best available break marker.
                chain_break_at = str(
                    min(
                        remaining.values(),
                        key=lambda v: self._ensure_utc(v.voted_at),
                    ).id
                )
                break
            prev_chain = next_vote.chain_hash
            del remaining[str(next_vote.id)]

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

        # Flag IPs with suspiciously high vote counts (> 5 from same IP).
        # SEC (ELEC-6): only the thresholded suspicious set is exposed — the
        # full per-IP vote map allowed vote-to-voter correlation in small
        # departments. For anonymous elections the underlying per-vote
        # IP/user-agent metadata is purged entirely at close.
        suspicious_ips = {
            ip: count
            for ip, count in ip_vote_counts.items()
            if count > 5 and ip != "unknown"
        }
        unique_ip_count = sum(1 for ip in ip_vote_counts if ip != "unknown")
        ip_metadata_purged = (
            election.anonymous_voting and election.status == ElectionStatus.CLOSED
        )

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
                "unique_ip_count": unique_ip_count,
                "ip_metadata_purged": ip_metadata_purged,
            },
            "proxy_voting": {
                "authorizations": election.proxy_authorizations or [],
                "total_proxy_votes": len(proxy_vote_records),
                "proxy_votes": proxy_vote_records,
            },
            "voting_timeline": voting_timeline,
        }

    async def _count_eligible_voters(
        self, election: Election, organization_id: UUID
    ) -> int:
        """Count voters eligible for this election (turnout/quorum denominator).

        Uses the explicit ``eligible_voters`` list when set. Otherwise counts
        active org members, excluding membership tiers whose benefits mark
        them not ``voting_eligible`` — counting non-voting tiers (social,
        junior, ...) would let a percentage quorum fail even when every
        actually-eligible member voted. Members of excluded tiers who hold a
        secretary voter override are added back.

        This is deliberately election-level only: per-ballot-item role or
        attendance restrictions are not modeled here, since turnout is
        reported for the election as a whole.
        """
        # Roll frozen at open: the snapshot is the denominator, plus any
        # secretary overrides granted after the freeze.
        snapshot = getattr(election, "eligible_roster_snapshot", None)
        if snapshot is not None:
            override_ids = {
                o.get("user_id")
                for o in (election.voter_overrides or [])
                if o.get("user_id")
            }
            return len(set(snapshot) | override_ids)

        if election.eligible_voters:
            return len(election.eligible_voters)

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tiers = (((org.settings or {}).get("membership_tiers", {}) if org else {})).get(
            "tiers", []
        )
        ineligible_tier_ids = {
            t.get("id")
            for t in tiers
            if not t.get("benefits", {}).get("voting_eligible", True)
        }

        counts_result = await self.db.execute(
            select(User.membership_type, func.count(User.id))
            .where(User.organization_id == str(organization_id))
            .where(User.is_active.is_(True))
            .group_by(User.membership_type)
        )
        total = 0
        for member_type, count in counts_result.all():
            if (member_type or "active") not in ineligible_tier_ids:
                total += count

        # Secretary overrides restore eligibility for members of excluded tiers
        override_ids = {
            o.get("user_id")
            for o in (election.voter_overrides or [])
            if o.get("user_id")
        }
        if override_ids and ineligible_tier_ids:
            override_count = await self.db.execute(
                select(func.count(User.id))
                .where(User.id.in_(list(override_ids)))
                .where(User.organization_id == str(organization_id))
                .where(User.is_active.is_(True))
                .where(User.membership_type.in_(list(ineligible_tier_ids)))
            )
            total += override_count.scalar() or 0

        return total

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
        end_date = self._ensure_utc(election.end_date)
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
            .where(Vote.is_test.is_(False))
        )
        all_votes = await self._exclude_unattested(
            election_id, votes_result.scalars().all()
        )

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate).where(Candidate.election_id == str(election_id))
        )
        candidates = candidates_result.scalars().all()

        # Write-in consolidation: merged candidates disappear from the
        # results list and their votes count under the merge target. Votes
        # are remapped via lightweight copies — the ORM rows are never
        # touched, because vote signatures embed candidate_id.
        merge_map = {
            c.id: c.merged_into_candidate_id
            for c in candidates
            if getattr(c, "merged_into_candidate_id", None)
        }
        if merge_map:
            all_votes = [
                (
                    SimpleNamespace(
                        id=v.id,
                        candidate_id=merge_map[v.candidate_id],
                        position=v.position,
                        voter_hash=v.voter_hash,
                        voter_id=v.voter_id,
                        vote_rank=v.vote_rank,
                        is_manual=v.is_manual,
                        manual_batch_id=v.manual_batch_id,
                    )
                    if v.candidate_id in merge_map
                    else v
                )
                for v in all_votes
            ]
            candidates = [c for c in candidates if c.id not in merge_map]

        # Count total eligible voters (excludes non-voting membership tiers)
        total_eligible = await self._count_eligible_voters(election, organization_id)

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
                        is_tie=any(c.is_tied for c in candidate_results),
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
            tie_policy=getattr(election, "tie_policy", None) or "co_winners",
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
                tied_top = [r for r in results if r.vote_count == max_votes]
                policy = getattr(election, "tie_policy", None) or "co_winners"
                if len(tied_top) > 1 and policy != "co_winners":
                    # Unresolved tie: no winner is declared here — the
                    # tie_policy (runoff / revote / chair_decides) governs
                    # resolution, and results flag the tie explicitly.
                    for result in tied_top:
                        result.is_tied = True
                else:
                    for result in tied_top:
                        result.is_winner = True

        elif election.victory_condition == "majority":
            # Strictly more than half. Use integer math: floor(n/2)+1 is the
            # smallest vote count exceeding half. The previous (n/2)+1 float
            # form over-required by a full vote for odd totals — e.g. with 3
            # votes it demanded 2.5 (→3), so a candidate with 2 of 3 (a clear
            # 66% majority) was wrongly denied the win.
            required_votes = total_votes // 2 + 1
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

        # Get all active (non-deleted, non-test) votes
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test.is_(False))
        )
        all_votes = await self._exclude_unattested(
            election_id, votes_result.scalars().all()
        )

        # Get all candidates
        candidates_result = await self.db.execute(
            select(Candidate).where(Candidate.election_id == str(election_id))
        )
        total_candidates = len(candidates_result.scalars().all())

        # Count eligible voters (excludes non-voting membership tiers)
        total_eligible = await self._count_eligible_voters(election, organization_id)

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

        manual_votes = sum(1 for v in all_votes if v.is_manual)
        return ElectionStats(
            election_id=election.id,
            total_candidates=total_candidates,
            total_votes_cast=len(all_votes),
            total_eligible_voters=total_eligible,
            total_voters=unique_voters,
            voter_turnout_percentage=round(voter_turnout, 2),
            votes_by_position=votes_by_position,
            manual_votes=manual_votes,
            electronic_votes=len(all_votes) - manual_votes,
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
                .where(User.is_active.is_(True))
                .options(selectinload(User.roles))
            )
        eligible_users = users_result.scalars().all()

        # Get all voter hashes / voter IDs who have voted (test votes don't count)
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test.is_(False))
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

    async def remind_non_voters(
        self,
        election_id: UUID,
        organization_id: UUID,
        user_id: Optional[str] = None,
        subject: Optional[str] = None,
        message: Optional[str] = None,
        base_ballot_url: Optional[str] = None,
    ) -> Tuple[int, int, int, List[Dict]]:
        """Send a reminder ballot email to eligible voters who haven't voted.

        Reuses the real ballot-send path, so each reminded member gets a
        FRESH voting token/link. Prior unused tokens deliberately stay valid:
        the vote dedup hash is keyed on voter_hash, so multiple live tokens
        can never yield more than one vote — while expiring the old token
        could disenfranchise a member whose reminder email bounces.

        Hardening:
        - A one-hour cooldown (against ``reminder_sent_at``) stops repeated
          manual sends from spamming members with fresh links.
        - After the send, prior unused tokens are expired — but ONLY for
          members whose reminder email was confirmed handed to the SMTP
          server. A member whose reminder failed keeps their old link, so a
          bounce can never strand a voter with zero working ballots.

        Stamps ``reminder_sent_at`` so the automatic reminder (lifecycle
        task) fires at most once per election, counting manual reminders.

        Returns: (reminded_count, failed_count, skipped_count, skipped_details)
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            raise ValueError("Election not found")
        if election.status != ElectionStatus.OPEN:
            raise ValueError("Reminders can only be sent for open elections")
        flags = await self.get_feature_flags(organization_id)
        if not flags["reminders_enabled"]:
            raise ValueError(
                "Non-voter reminders are disabled for this organization — "
                "enable them in Election Settings"
            )

        # Cooldown: a manager double-clicking (or automation racing a manual
        # send) must not spam members — each send mints fresh tokens.
        now = datetime.now(timezone.utc)
        last_sent = self._ensure_utc(election.reminder_sent_at)
        if last_sent and now - last_sent < timedelta(
            minutes=self.REMINDER_COOLDOWN_MINUTES
        ):
            wait_min = self.REMINDER_COOLDOWN_MINUTES - int(
                (now - last_sent).total_seconds() // 60
            )
            raise ValueError(
                f"A reminder was already sent recently — try again in about "
                f"{max(wait_min, 1)} minute(s)"
            )

        non_voters = await self.get_non_voters(election_id, organization_id)
        if not non_voters:
            return 0, 0, 0, []

        # Snapshot each non-voter's PRE-EXISTING unused tokens so the ones
        # superseded by this reminder can be expired after confirmed delivery
        # (the tokens minted by the send below are not in this snapshot).
        salt = election.voter_anonymity_salt or ""
        hash_by_user = {
            nv["id"]: self._generate_voter_hash(nv["id"], election_id, salt)
            for nv in non_voters
        }
        prior_tokens_result = await self.db.execute(
            select(VotingToken.id, VotingToken.voter_hash)
            .where(VotingToken.election_id == str(election_id))
            .where(VotingToken.voter_hash.in_(list(hash_by_user.values())))
            .where(VotingToken.used.is_(False))
            .where(VotingToken.is_test.is_(False))
            .where(VotingToken.expires_at > now)
        )
        prior_token_ids_by_hash: Dict[str, List[str]] = {}
        for token_id, voter_hash in prior_tokens_result.all():
            prior_token_ids_by_hash.setdefault(voter_hash, []).append(token_id)

        # Close time in the department's timezone, not UTC.
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        try:
            from zoneinfo import ZoneInfo

            org_tz = ZoneInfo(
                (organization.timezone if organization else None) or "UTC"
            )
        except Exception:
            from zoneinfo import ZoneInfo

            org_tz = ZoneInfo("UTC")
        end_local = self._ensure_utc(election.end_date).astimezone(org_tz)

        sent, failed, skipped, skipped_details, sent_user_ids = (
            await self.send_ballot_emails(
                election_id=election_id,
                organization_id=organization_id,
                recipient_user_ids=[UUID(nv["id"]) for nv in non_voters],
                subject=subject or f"Reminder: vote in {election.title}",
                message=message
                or (
                    "This is a reminder that you have not yet voted in "
                    f"{election.title}. Voting closes at "
                    f"{end_local:%Y-%m-%d %H:%M %Z}."
                ),
                base_ballot_url=base_ballot_url,
            )
        )

        # Expire superseded tokens for confirmed deliveries only.
        expired_count = 0
        expire_ids: List[str] = []
        for uid in sent_user_ids:
            expire_ids.extend(prior_token_ids_by_hash.get(hash_by_user.get(uid), []))
        if expire_ids:
            from sqlalchemy import update as sa_update

            # Floor to the second: MySQL DATETIME(0) ROUNDS fractional
            # seconds, so expiring at now=:56.9 would store :57 and leave
            # the token briefly valid — it must be expired immediately.
            await self.db.execute(
                sa_update(VotingToken)
                .where(VotingToken.id.in_(expire_ids))
                .values(expires_at=now.replace(microsecond=0))
            )
            expired_count = len(expire_ids)

        election.reminder_sent_at = now.replace(microsecond=0)
        await self.db.commit()

        logger.info(
            f"Non-voter reminder sent | election={election_id} "
            f"reminded={sent} failed={failed} skipped={skipped}"
        )
        await self._audit(
            "election_reminder_sent",
            {
                "election_id": str(election_id),
                "title": election.title,
                "reminded": sent,
                "failed": failed,
                "skipped": skipped,
                "superseded_tokens_expired": expired_count,
            },
            user_id=user_id,
        )
        return sent, failed, skipped, skipped_details

    async def _org_local_time(self, organization, dt) -> str:
        """Format an aware datetime in the organization's timezone."""
        from zoneinfo import ZoneInfo

        try:
            tz = ZoneInfo((organization.timezone if organization else None) or "UTC")
        except Exception:
            tz = ZoneInfo("UTC")
        local = self._ensure_utc(dt).astimezone(tz)
        return f"{local:%Y-%m-%d %H:%M %Z}"

    async def _announce_nominations_open(
        self, election, organization_id: UUID, acting_user_id: Optional[str]
    ) -> None:
        """Email active members that the nomination phase is open.

        Best-effort: any failure is logged, never raised — an email outage
        must not block the phase transition.
        """
        try:
            import html as html_mod

            from app.services.email_service import EmailService, wrap_email_body

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            organization = org_result.scalar_one_or_none()
            if not organization:
                return

            members_result = await self.db.execute(
                select(User)
                .where(User.organization_id == str(organization_id))
                .where(User.is_active.is_(True))
            )
            members = members_result.scalars().all()
            member_emails = [m.email for m in members if m.email]
            if not member_emails:
                return

            # To: the acting officer (or org contact / creator) so member
            # addresses stay in BCC and are never exposed to each other.
            to_email = None
            if acting_user_id:
                actor = next(
                    (m for m in members if str(m.id) == str(acting_user_id)), None
                )
                to_email = actor.email if actor else None
            to_email = to_email or organization.email or member_emails[0]
            bcc = [e for e in member_emails if e != to_email]

            deadline_line = ""
            if election.nomination_deadline:
                deadline_local = await self._org_local_time(
                    organization, election.nomination_deadline
                )
                deadline_line = (
                    f"<p>Nominations close automatically at "
                    f"<strong>{deadline_local}</strong>.</p>"
                )

            title = html_mod.escape(election.title)
            positions = ", ".join(
                html_mod.escape(p) for p in (election.positions or [])
            )
            body_html = (
                f"<p>Nominations are now open for <strong>{title}</strong>.</p>"
                f"<p>Positions: {positions}</p>"
                f"{deadline_line}"
                "<p>Sign in to the intranet to nominate a member — or "
                "yourself — from the election's Nominations tab.</p>"
            )
            html_body = wrap_email_body(
                organization,
                title=f"Nominations Open: {title}",
                body_html=body_html,
            )
            email_service = EmailService(organization)
            await email_service.send_email(
                to_emails=[to_email],
                subject=f"Nominations Open: {election.title}",
                html_body=html_body,
                bcc_emails=bcc,
                db=self.db,
                template_type="custom",
                sent_by=acting_user_id,
            )
        except Exception as e:
            logger.warning(
                f"Nominations-open announcement failed | "
                f"election={election.id} error={e}"
            )

    async def _notify_nominee(self, election, candidate, organization_id: UUID) -> None:
        """Email a third-party nominee that they must accept or decline.

        Best-effort: a mail failure must never fail the nomination itself —
        the pending nomination is still visible on the election page.
        """
        try:
            import html as html_mod

            from app.services.email_service import EmailService, wrap_email_body

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            organization = org_result.scalar_one_or_none()
            nominee_result = await self.db.execute(
                select(User).where(User.id == str(candidate.user_id))
            )
            nominee = nominee_result.scalar_one_or_none()
            if not organization or not nominee or not nominee.email:
                return

            deadline_line = ""
            if election.nomination_deadline:
                deadline_local = await self._org_local_time(
                    organization, election.nomination_deadline
                )
                deadline_line = (
                    f"<p>Please respond before nominations close at "
                    f"<strong>{deadline_local}</strong>.</p>"
                )

            title = html_mod.escape(election.title)
            position = html_mod.escape(candidate.position or "")
            body_html = (
                f"<p>You have been nominated for <strong>{position}</strong> "
                f"in <strong>{title}</strong>.</p>"
                "<p>Your name will only appear on the ballot if you accept. "
                "Sign in to the intranet and open the election's Nominations "
                "tab to accept or decline.</p>"
                f"{deadline_line}"
            )
            html_body = wrap_email_body(
                organization,
                title=f"You've been nominated: {position}",
                body_html=body_html,
            )
            email_service = EmailService(organization)
            await email_service.send_email(
                to_emails=[nominee.email],
                subject=f"You've been nominated for {candidate.position} — "
                f"{election.title}",
                html_body=html_body,
                db=self.db,
                template_type="custom",
            )
        except Exception as e:
            logger.warning(
                f"Nominee notification failed | election={election.id} "
                f"candidate={candidate.id} error={e}"
            )

    async def open_nominations(
        self,
        election_id: UUID,
        organization_id: UUID,
        acting_user_id: Optional[str] = None,
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Move a DRAFT election into the NOMINATIONS phase.

        Only positional elections take nominations — ballot-item elections
        have no candidates to nominate. Announces the open phase to active
        members by email (best-effort — announcement failure never blocks
        the phase change).
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"
        flags = await self.get_feature_flags(organization_id)
        if not flags["nominations_enabled"]:
            return None, (
                "Nominations are disabled for this organization — "
                "enable them in Election Settings"
            )
        if election.status != ElectionStatus.DRAFT:
            return None, (
                f"Cannot open nominations for an election with status "
                f"'{election.status.value}'. Only draft elections can "
                f"enter the nomination phase."
            )
        if not election.positions:
            return None, (
                "Nominations require at least one position — ballot-item "
                "elections have no candidates to nominate."
            )

        election.status = ElectionStatus.NOMINATIONS
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(f"Nominations opened | election={election_id}")
        await self._announce_nominations_open(election, organization_id, acting_user_id)
        await self._audit(
            "nominations_opened",
            {
                "election_id": str(election_id),
                "title": election.title,
                "nomination_deadline": (
                    election.nomination_deadline.isoformat()
                    if election.nomination_deadline
                    else None
                ),
            },
        )
        return election, None

    async def close_nominations(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Close the nomination phase, returning the election to DRAFT.

        The secretary then finalizes the ballot (pending acceptances,
        ordering) before opening voting — open_election validates that at
        least one accepted candidate exists.
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"
        if election.status != ElectionStatus.NOMINATIONS:
            return None, "Election is not in the nomination phase"

        election.status = ElectionStatus.DRAFT
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(f"Nominations closed | election={election_id}")
        await self._audit(
            "nominations_closed",
            {"election_id": str(election_id), "title": election.title},
        )
        return election, None

    async def create_nomination(
        self,
        election_id: UUID,
        organization_id: UUID,
        nominator_id: str,
        position: str,
        nominee_user_id: Optional[str] = None,
        statement: Optional[str] = None,
    ) -> Tuple[Optional[Candidate], Optional[str]]:
        """Nominate a member (or yourself) for a position.

        Third-party nominations are stored with accepted=False and only
        appear on the ballot once the nominee accepts; self-nominations are
        accepted implicitly.
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return None, "Election not found"
        if election.status != ElectionStatus.NOMINATIONS:
            return None, "Nominations are not open for this election"
        flags = await self.get_feature_flags(organization_id)
        if not flags["nominations_enabled"]:
            return None, (
                "Nominations are disabled for this organization — "
                "enable them in Election Settings"
            )
        if position not in (election.positions or []):
            return None, f"'{position}' is not a position in this election"

        nominee_id = str(nominee_user_id or nominator_id)
        # XC-1: the nominee must be an active member of the caller's org.
        user_result = await self.db.execute(
            select(User)
            .where(User.id == nominee_id)
            .where(User.organization_id == str(organization_id))
        )
        nominee = user_result.scalar_one_or_none()
        if not nominee or not nominee.is_active:
            return None, "Nominee must be an active member of this organization"

        dup_result = await self.db.execute(
            select(func.count(Candidate.id))
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.user_id == nominee_id)
            .where(Candidate.position == position)
        )
        if (dup_result.scalar() or 0) > 0:
            return None, f"{nominee.full_name} is already nominated for {position}"

        is_self = nominee_id == str(nominator_id)

        # Anti-spam: cap how many PENDING third-party nominations one member
        # can have outstanding in a single election. Self-nominations and
        # accepted nominations don't count against the cap.
        if not is_self:
            pending_result = await self.db.execute(
                select(func.count(Candidate.id))
                .where(Candidate.election_id == str(election_id))
                .where(Candidate.nominated_by == str(nominator_id))
                .where(Candidate.accepted.is_(False))
            )
            if (
                pending_result.scalar() or 0
            ) >= self.MAX_PENDING_NOMINATIONS_PER_MEMBER:
                return None, (
                    "You have too many pending nominations in this election — "
                    "wait for nominees to respond before adding more"
                )
        now = datetime.now(timezone.utc).replace(microsecond=0)
        order_result = await self.db.execute(
            select(func.count(Candidate.id)).where(
                Candidate.election_id == str(election_id)
            )
        )
        candidate = Candidate(
            id=str(uuid4()),
            election_id=str(election_id),
            user_id=nominee_id,
            name=nominee.full_name,
            position=position,
            statement=statement,
            nomination_date=now,
            nominated_by=str(nominator_id),
            accepted=is_self,
            is_write_in=False,
            display_order=order_result.scalar() or 0,
        )
        self.db.add(candidate)
        await self.db.commit()
        await self.db.refresh(candidate)

        # Third-party nominees must know they have a pending nomination —
        # without this the nomination silently expires un-accepted.
        if not is_self:
            await self._notify_nominee(election, candidate, organization_id)

        logger.info(
            f"Nomination created | election={election_id} nominee={nominee_id} "
            f"position={position} self={is_self}"
        )
        await self._audit(
            "candidate_nominated",
            {
                "election_id": str(election_id),
                "candidate_id": str(candidate.id),
                "nominee_user_id": nominee_id,
                "position": position,
                "self_nomination": is_self,
            },
            user_id=str(nominator_id),
        )
        return candidate, None

    async def respond_to_nomination(
        self,
        election_id: UUID,
        organization_id: UUID,
        candidate_id: UUID,
        user_id: str,
        accept: bool,
    ) -> Tuple[bool, Optional[str]]:
        """Nominee accepts or declines their nomination.

        Allowed during NOMINATIONS and afterwards while the election is
        still DRAFT (a nominee may respond after the phase closes but
        before the ballot opens). Declining removes the candidate row; the
        audit log keeps the record.
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = result.scalar_one_or_none()
        if not election:
            return False, "Election not found"
        if election.status not in (
            ElectionStatus.NOMINATIONS,
            ElectionStatus.DRAFT,
        ):
            return False, "Nominations can no longer be changed for this election"

        cand_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.id == str(candidate_id))
            .where(Candidate.election_id == str(election_id))
        )
        candidate = cand_result.scalar_one_or_none()
        if not candidate:
            return False, "Nomination not found"
        if str(candidate.user_id) != str(user_id):
            return False, "Only the nominee can respond to this nomination"
        if candidate.is_write_in:
            return False, "Write-in candidates cannot respond to nominations"

        if accept:
            candidate.accepted = True
            event = "nomination_accepted"
        else:
            await self.db.delete(candidate)
            event = "nomination_declined"
        await self.db.commit()

        logger.info(
            f"Nomination response | election={election_id} "
            f"candidate={candidate_id} accepted={accept}"
        )
        await self._audit(
            event,
            {
                "election_id": str(election_id),
                "candidate_id": str(candidate_id),
                "position": candidate.position,
                "candidate_name": candidate.name,
            },
            user_id=str(user_id),
        )
        return True, None

    async def record_manual_ballots(
        self,
        election_id: UUID,
        organization_id: UUID,
        recorded_by: str,
        entries: List[Dict],
        notes: Optional[str] = None,
        allow_over_count: bool = False,
    ) -> Tuple[int, Optional[str], Optional[str]]:
        """Record an in-room paper-ballot tally as vote rows.

        Each entry is {"candidate_id", "count"}. The created votes carry no
        voter identity and no dedup hash — the recording officer's attested
        count is the source of truth, attributed via recorded_by and the
        audit log. Votes are signed and chained like electronic ones so
        integrity verification covers the full ballot box.

        Sanity guard: a batch that would push any position's total ballots
        past what the eligible-voter count can produce is rejected — a typo
        like 40-for-4 must be a conscious override (``allow_over_count``,
        which is audited), never a silent success.

        Every vote in the batch shares a ``manual_batch_id`` so a mis-keyed
        batch can be voided in one action (void_manual_ballot_batch).

        Returns: (recorded_count, batch_id, error)
        """
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()
        if not election:
            return 0, None, "Election not found"
        if election.status != ElectionStatus.OPEN:
            return (
                0,
                None,
                "Paper ballots can only be recorded while voting is open",
            )
        flags = await self.get_feature_flags(organization_id)
        if not flags["paper_ballots_enabled"]:
            return (
                0,
                None,
                "Paper-ballot entry is disabled for this organization — "
                "enable it in Election Settings",
            )
        if not entries:
            return 0, None, "No ballot entries provided"

        total = sum(int(e.get("count", 0)) for e in entries)
        if total <= 0:
            return 0, None, "Ballot counts must be positive"
        if total > 2000:
            return 0, None, "Cannot record more than 2000 paper ballots at once"

        candidate_ids = [str(e["candidate_id"]) for e in entries]
        cand_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.id.in_(candidate_ids))
        )
        candidates = {c.id: c for c in cand_result.scalars().all()}

        # ── Sanity guard: per-position plausibility ──────────────────
        # cap = eligible voters × votes each voter may legitimately cast
        # for the position (approval: one per accepted candidate; else
        # max_votes_per_position). Existing non-test, non-deleted votes
        # count toward the cap.
        if not allow_over_count:
            new_by_position: Dict[str, int] = {}
            for entry in entries:
                cand = candidates.get(str(entry["candidate_id"]))
                if cand is not None and cand.position:
                    new_by_position[cand.position] = new_by_position.get(
                        cand.position, 0
                    ) + int(entry.get("count", 0))

            if new_by_position:
                eligible_count = await self._count_eligible_voters(
                    election, organization_id
                )
                existing_rows = await self.db.execute(
                    select(Vote.position, func.count(Vote.id))
                    .where(Vote.election_id == str(election_id))
                    .where(Vote.deleted_at.is_(None))
                    .where(Vote.is_test.is_(False))
                    .where(Vote.position.in_(list(new_by_position.keys())))
                    .group_by(Vote.position)
                )
                existing_by_position = dict(existing_rows.all())

                for pos, new_count in new_by_position.items():
                    if election.voting_method == "approval":
                        cand_count_result = await self.db.execute(
                            select(func.count(Candidate.id))
                            .where(Candidate.election_id == str(election_id))
                            .where(Candidate.position == pos)
                            .where(Candidate.accepted.is_(True))
                        )
                        multiplier = max(cand_count_result.scalar() or 1, 1)
                    else:
                        multiplier = max(election.max_votes_per_position or 1, 1)
                    cap = eligible_count * multiplier
                    projected = existing_by_position.get(pos, 0) + new_count
                    if cap and projected > cap:
                        return (
                            0,
                            None,
                            f"This batch would put {pos} at {projected} ballots, "
                            f"but only {eligible_count} member(s) are eligible "
                            f"(cap {cap}). Double-check the counts, or re-submit "
                            f"with the over-count override if the tally is "
                            f"correct.",
                        )

        batch_id = str(uuid4())
        now = datetime.now(timezone.utc).replace(microsecond=0)

        # Attestation: when the org requires N officer confirmations, the
        # batch starts pending and its votes stay out of results/stats
        # until N distinct officers (other than the recorder) attest it.
        required_attestations = await self.get_required_attestations(organization_id)
        batch = ManualBallotBatch(
            id=batch_id,
            election_id=str(election_id),
            organization_id=str(organization_id),
            recorded_by=str(recorded_by),
            notes=notes,
            status="pending" if required_attestations > 0 else "confirmed",
            required_attestations=required_attestations,
            created_at=now,
            confirmed_at=None if required_attestations > 0 else now,
        )
        self.db.add(batch)

        recorded = 0
        breakdown = []
        for entry in entries:
            cand = candidates.get(str(entry["candidate_id"]))
            if cand is None:
                return (
                    0,
                    None,
                    "One or more candidates do not belong to this election",
                )
            if not cand.accepted and not cand.is_write_in:
                return 0, None, f"{cand.name} has not accepted nomination"
            count = int(entry.get("count", 0))
            if count < 0:
                return 0, None, "Ballot counts must be positive"
            for _ in range(count):
                vote = Vote(
                    id=str(uuid4()),
                    election_id=str(election_id),
                    candidate_id=cand.id,
                    voter_id=None,
                    voter_hash=None,
                    position=cand.position,
                    voted_at=now,
                    is_test=False,
                    is_manual=True,
                    recorded_by=str(recorded_by),
                    manual_batch_id=batch_id,
                    vote_dedup_hash=None,
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
                recorded += 1
            breakdown.append({"candidate": cand.name, "count": count})

        await self.db.commit()

        logger.info(
            f"Manual ballots recorded | election={election_id} total={recorded} "
            f"recorded_by={recorded_by}"
        )
        await self._audit(
            "election_manual_ballots_recorded",
            {
                "election_id": str(election_id),
                "batch_id": batch_id,
                "total": recorded,
                "breakdown": breakdown,
                "notes": notes,
                "over_count_override": allow_over_count,
                "required_attestations": required_attestations,
                "batch_status": (
                    "pending" if required_attestations > 0 else "confirmed"
                ),
            },
            severity="warning" if allow_over_count else "info",
            user_id=str(recorded_by),
        )
        return recorded, batch_id, None

    async def attest_manual_ballot_batch(
        self,
        election_id: UUID,
        organization_id: UUID,
        batch_id: str,
        attested_by: str,
    ) -> Tuple[Optional[Dict], Optional[str]]:
        """Record one officer's confirmation of a paper-tally batch.

        The recording officer can never attest their own batch, and each
        officer counts once. When the batch's snapshotted requirement is
        met it flips to confirmed and its votes start counting in results.
        Attestation is only possible while voting is open — a batch still
        pending at close stays excluded from the certified results and is
        flagged in the audit log by close_election.

        Returns: ({attestations, required, status}, error)
        """
        # FOR UPDATE serializes concurrent attesters so the confirm
        # transition happens exactly once.
        result = await self.db.execute(
            select(ManualBallotBatch)
            .where(ManualBallotBatch.id == batch_id)
            .where(ManualBallotBatch.election_id == str(election_id))
            .where(ManualBallotBatch.organization_id == str(organization_id))
            .with_for_update()
        )
        batch = result.scalar_one_or_none()
        if not batch:
            return None, "Paper-ballot batch not found"
        if batch.status == "voided":
            return None, "This batch has been voided and cannot be attested"
        if batch.status == "confirmed":
            return None, "This batch is already fully attested"

        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
        )
        election = election_result.scalar_one_or_none()
        if not election:
            return None, "Election not found"
        if election.status != ElectionStatus.OPEN:
            return (
                None,
                "Attestations can only be added while voting is open",
            )

        if batch.recorded_by and str(attested_by) == str(batch.recorded_by):
            return (
                None,
                "The recording officer cannot attest their own batch — "
                "a different officer must confirm the count",
            )

        existing = await self.db.execute(
            select(func.count(ManualBallotAttestation.id)).where(
                ManualBallotAttestation.batch_id == batch.id,
                ManualBallotAttestation.attested_by == str(attested_by),
            )
        )
        if (existing.scalar() or 0) > 0:
            return None, "You have already attested this batch"

        now = datetime.now(timezone.utc).replace(microsecond=0)
        self.db.add(
            ManualBallotAttestation(
                id=str(uuid4()),
                batch_id=batch.id,
                organization_id=str(organization_id),
                attested_by=str(attested_by),
                attested_at=now,
            )
        )
        await self.db.flush()

        count_result = await self.db.execute(
            select(func.count(ManualBallotAttestation.id)).where(
                ManualBallotAttestation.batch_id == batch.id
            )
        )
        attestation_count = count_result.scalar() or 0
        required = batch.required_attestations or 0
        confirmed = attestation_count >= required
        if confirmed:
            batch.status = "confirmed"
            batch.confirmed_at = now
        await self.db.commit()

        logger.info(
            f"Manual ballot batch attested | election={election_id} "
            f"batch={batch_id} attestations={attestation_count}/{required} "
            f"by={attested_by} confirmed={confirmed}"
        )
        await self._audit(
            "election_manual_ballots_attested",
            {
                "election_id": str(election_id),
                "batch_id": batch_id,
                "attestations": attestation_count,
                "required": required,
                "confirmed": confirmed,
            },
            user_id=str(attested_by),
        )
        return (
            {
                "attestations": attestation_count,
                "required": required,
                "status": "confirmed" if confirmed else "pending",
            },
            None,
        )

    async def list_manual_ballot_batches(
        self, election_id: UUID, organization_id: UUID
    ) -> List[Dict]:
        """All paper-tally batches for an election, newest first.

        Each entry carries the recorded totals per candidate (as keyed in,
        regardless of later voiding — the batch status conveys that), the
        recorder, and the attestation trail.
        """
        batches_result = await self.db.execute(
            select(ManualBallotBatch)
            .where(ManualBallotBatch.election_id == str(election_id))
            .where(ManualBallotBatch.organization_id == str(organization_id))
            .options(selectinload(ManualBallotBatch.attestations))
            .order_by(ManualBallotBatch.created_at.desc())
        )
        batches = list(batches_result.scalars().all())
        if not batches:
            return []

        totals_result = await self.db.execute(
            select(
                Vote.manual_batch_id,
                Candidate.id,
                Candidate.name,
                Candidate.position,
                func.count(Vote.id),
            )
            .join(Candidate, Vote.candidate_id == Candidate.id)
            .where(Vote.election_id == str(election_id))
            .where(Vote.is_manual.is_(True))
            .where(Vote.manual_batch_id.in_([b.id for b in batches]))
            .group_by(Vote.manual_batch_id, Candidate.id)
        )
        totals_by_batch: Dict[str, List[Dict]] = {}
        for b_id, cand_id, cand_name, position, count in totals_result.all():
            totals_by_batch.setdefault(b_id, []).append(
                {
                    "candidate_id": cand_id,
                    "candidate_name": cand_name,
                    "position": position,
                    "count": count,
                }
            )

        user_ids = {b.recorded_by for b in batches if b.recorded_by}
        for b in batches:
            user_ids.update(a.attested_by for a in b.attestations if a.attested_by)
        names: Dict[str, str] = {}
        if user_ids:
            users_result = await self.db.execute(
                select(User.id, User.first_name, User.last_name).where(
                    User.id.in_(list(user_ids))
                )
            )
            for uid, first, last in users_result.all():
                names[uid] = f"{first or ''} {last or ''}".strip() or uid

        out = []
        for b in batches:
            totals = totals_by_batch.get(b.id, [])
            out.append(
                {
                    "batch_id": b.id,
                    "status": b.status,
                    "recorded_by": b.recorded_by,
                    "recorded_by_name": names.get(b.recorded_by or ""),
                    "recorded_at": b.created_at,
                    "notes": b.notes,
                    "required_attestations": b.required_attestations or 0,
                    "attestations": [
                        {
                            "user_id": a.attested_by,
                            "name": names.get(a.attested_by or ""),
                            "attested_at": a.attested_at,
                        }
                        for a in sorted(
                            b.attestations,
                            key=lambda a: (a.attested_at is None, a.attested_at),
                        )
                    ],
                    "totals": totals,
                    "total_ballots": sum(t["count"] for t in totals),
                }
            )
        return out

    async def void_manual_ballot_batch(
        self,
        election_id: UUID,
        organization_id: UUID,
        batch_id: str,
        deleted_by: str,
        reason: str,
    ) -> Tuple[int, Optional[str]]:
        """Void (soft-delete) every vote from one paper-tally batch.

        Corrections for a mis-keyed batch in a single audited action instead
        of vote-by-vote soft deletes. Uses the same soft-delete semantics as
        the single-vote endpoint — rows are retained with deleted_at/by and
        the reason, and appear in the forensics report.
        """
        result = await self.db.execute(
            select(Vote)
            .join(Election, Vote.election_id == Election.id)
            .where(Election.organization_id == str(organization_id))
            .where(Vote.election_id == str(election_id))
            .where(Vote.manual_batch_id == batch_id)
            .where(Vote.is_manual.is_(True))
            .where(Vote.deleted_at.is_(None))
        )
        votes = list(result.scalars().all())
        if not votes:
            return 0, "No active paper ballots found for this batch"

        now = datetime.now(timezone.utc)
        for vote in votes:
            vote.deleted_at = now
            vote.deleted_by = str(deleted_by)
            vote.deletion_reason = reason

        # Mirror the void on the batch row (absent for batches recorded
        # before the attestation feature existed).
        batch_result = await self.db.execute(
            select(ManualBallotBatch)
            .where(ManualBallotBatch.id == batch_id)
            .where(ManualBallotBatch.organization_id == str(organization_id))
        )
        batch = batch_result.scalar_one_or_none()
        if batch is not None:
            batch.status = "voided"
        await self.db.commit()

        logger.warning(
            f"Manual ballot batch voided | election={election_id} "
            f"batch={batch_id} count={len(votes)} by={deleted_by}"
        )
        await self._audit(
            "election_manual_ballots_voided",
            {
                "election_id": str(election_id),
                "batch_id": batch_id,
                "count": len(votes),
                "reason": reason,
            },
            severity="warning",
            user_id=str(deleted_by),
        )
        return len(votes), None

    async def clone_election(
        self,
        election_id: UUID,
        organization_id: UUID,
        created_by: str,
        title: str,
        start_date: datetime,
        end_date: datetime,
        nomination_deadline: Optional[datetime] = None,
        include_candidates: bool = False,
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Create a fresh DRAFT election from an existing election's setup.

        Copies the configuration a recurring election needs (positions,
        eligibility rules, voting method, quorum, reminders, tie policy) and
        deliberately does NOT copy anything stateful: votes, tokens,
        attendees, overrides, proxy authorizations, the anonymity salt
        (generated fresh — salts are strictly per-election), reminder
        timestamps, or meeting/event links. Candidates are copied only on
        request (accepted ones, with fresh ids), since a new year usually
        means new nominations.
        """
        source = await self.get_election(election_id, organization_id)
        if not source:
            return None, "Election not found"

        clone = Election(
            id=str(uuid4()),
            organization_id=str(organization_id),
            created_by=str(created_by),
            status=ElectionStatus.DRAFT,
            title=title,
            description=source.description,
            election_type=source.election_type,
            positions=copy.deepcopy(source.positions),
            position_eligibility=copy.deepcopy(source.position_eligibility),
            start_date=start_date,
            end_date=end_date,
            nomination_deadline=nomination_deadline,
            anonymous_voting=source.anonymous_voting,
            allow_write_ins=source.allow_write_ins,
            max_votes_per_position=source.max_votes_per_position,
            results_visible_immediately=source.results_visible_immediately,
            eligible_voters=copy.deepcopy(source.eligible_voters),
            voting_method=source.voting_method,
            victory_condition=source.victory_condition,
            victory_threshold=source.victory_threshold,
            victory_percentage=source.victory_percentage,
            tie_policy=getattr(source, "tie_policy", None) or "co_winners",
            enable_runoffs=source.enable_runoffs,
            runoff_type=source.runoff_type,
            max_runoff_rounds=source.max_runoff_rounds,
            quorum_type=source.quorum_type,
            quorum_value=source.quorum_value,
            auto_open=source.auto_open,
            reminder_hours_before_close=source.reminder_hours_before_close,
            voter_anonymity_salt=secrets.token_hex(32),
        )
        self.db.add(clone)

        copied_candidates = 0
        if include_candidates:
            cand_result = await self.db.execute(
                select(Candidate)
                .where(Candidate.election_id == str(election_id))
                .where(Candidate.accepted.is_(True))
                .where(Candidate.merged_into_candidate_id.is_(None))
                .order_by(Candidate.position, Candidate.display_order)
            )
            for cand in cand_result.scalars().all():
                self.db.add(
                    Candidate(
                        id=str(uuid4()),
                        election_id=clone.id,
                        user_id=cand.user_id,
                        name=cand.name,
                        position=cand.position,
                        statement=cand.statement,
                        photo_url=cand.photo_url,
                        accepted=True,
                        is_write_in=cand.is_write_in,
                        display_order=cand.display_order,
                    )
                )
                copied_candidates += 1

        await self.db.commit()
        await self.db.refresh(clone)

        logger.info(
            f"Election cloned | source={election_id} clone={clone.id} "
            f"candidates_copied={copied_candidates}"
        )
        await self._audit(
            "election_cloned",
            {
                "source_election_id": str(election_id),
                "clone_election_id": clone.id,
                "title": title,
                "candidates_copied": copied_candidates,
            },
            user_id=str(created_by),
        )
        return clone, None

    async def merge_write_in_candidates(
        self,
        election_id: UUID,
        organization_id: UUID,
        source_candidate_ids: List[str],
        target_candidate_id: str,
        merged_by: str,
    ) -> Tuple[int, Optional[str]]:
        """Consolidate write-in spelling variants under one candidate.

        Alias-based: sources get ``merged_into_candidate_id`` set and
        results count their votes under the target. Votes are NEVER
        re-pointed — vote signatures embed candidate_id, so mutating them
        would break integrity verification. Only write-in candidates can
        be merge sources (real nominees are never silently folded away).
        """
        election = await self.get_election(election_id, organization_id)
        if not election:
            return 0, "Election not found"

        wanted = set(source_candidate_ids) | {target_candidate_id}
        cand_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.id.in_(list(wanted)))
        )
        by_id = {c.id: c for c in cand_result.scalars().all()}
        missing = wanted - set(by_id)
        if missing:
            return 0, "One or more candidates do not belong to this election"

        target = by_id[target_candidate_id]
        if target.merged_into_candidate_id:
            return 0, "The target candidate has itself been merged"

        sources = [by_id[cid] for cid in source_candidate_ids]
        for cand in sources:
            if not cand.is_write_in:
                return 0, (
                    f"{cand.name} is not a write-in — only write-in "
                    f"variants can be merged"
                )
            if cand.merged_into_candidate_id:
                return 0, f"{cand.name} has already been merged"

        for cand in sources:
            cand.merged_into_candidate_id = target.id
        await self.db.commit()

        merged_names = [c.name for c in sources]
        logger.info(
            f"Write-ins merged | election={election_id} "
            f"sources={merged_names} target={target.name!r} by={merged_by}"
        )
        await self._audit(
            "election_write_ins_merged",
            {
                "election_id": str(election_id),
                "target_candidate_id": target.id,
                "target_name": target.name,
                "merged_candidate_ids": [c.id for c in sources],
                "merged_names": merged_names,
            },
            user_id=str(merged_by),
        )
        return len(sources), None

    async def build_printable_ballot_pdf(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[BytesIO], Optional[str], str]:
        """Render the official blank paper ballot for in-room voting.

        Generated from the election itself so the paper exactly matches
        the system: positions in order, accepted candidates in display
        order, write-in lines when allowed, and method-specific
        instructions. Pairs with paper-ballot entry + attestation.

        Returns: (pdf_buffer, error, filename)
        """
        from app.utils.election_ballot_pdf import render_printable_ballot_pdf

        election = await self.get_election(election_id, organization_id)
        if not election:
            return None, "Election not found", ""
        if election.status in (ElectionStatus.CLOSED, ElectionStatus.CANCELLED):
            return (
                None,
                "Printable ballots are only available before the election " "closes",
                "",
            )
        if not election.positions:
            return (
                None,
                "Printable ballots require a positional election",
                "",
            )

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.accepted.is_(True))
            .where(Candidate.merged_into_candidate_id.is_(None))
            .order_by(Candidate.position, Candidate.display_order)
        )
        candidates = list(candidates_result.scalars().all())
        if not candidates:
            return None, "The election has no accepted candidates yet", ""

        positions = []
        for position in election.positions:
            positions.append(
                {
                    "name": position,
                    "candidates": [
                        c.name for c in candidates if c.position == position
                    ],
                }
            )

        data = {
            "election": {
                "title": election.title,
                "voting_method": election.voting_method,
                "max_votes_per_position": election.max_votes_per_position or 1,
                "allow_write_ins": bool(election.allow_write_ins),
            },
            "positions": positions,
        }
        meta = {
            "org_name": organization.name if organization else "",
            "generated_at": await self._org_local_time(
                organization, datetime.now(timezone.utc)
            ),
        }
        buf = render_printable_ballot_pdf(data, meta)
        safe_title = re.sub(r"[^A-Za-z0-9_-]+", "_", election.title)[:60]
        return buf, None, f"ballot_{safe_title}.pdf"

    async def build_certified_results_pdf(
        self, election_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[BytesIO], Optional[str], str]:
        """Render the certified results package for a CLOSED election.

        The formal record for the meeting minutes: final tallies, turnout
        and quorum, the paper-batch attestation trail (including voided
        and unattested batches), and the integrity-verification outcome,
        with signature lines for the certifying officers.

        Returns: (pdf_buffer, error, filename)
        """
        from app.utils.certified_results_pdf import render_certified_results_pdf

        election = await self.get_election(election_id, organization_id)
        if not election:
            return None, "Election not found", ""
        if election.status != ElectionStatus.CLOSED:
            return (
                None,
                "Certified results are only available after the election " "closes",
                "",
            )

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        results = await self.get_election_results(
            election_id, organization_id, _internal_bypass_visibility=True
        )
        if not results:
            return None, "Results could not be computed", ""

        stats = await self.get_election_stats(election_id, organization_id)
        batches = await self.list_manual_ballot_batches(election_id, organization_id)
        integrity = await self.verify_vote_integrity(election_id, organization_id)

        data = {
            "election": {
                "title": election.title,
                "closed_display": await self._org_local_time(
                    organization, election.end_date
                ),
                "voting_method": election.voting_method,
                "victory_condition": election.victory_condition,
                "tie_policy": getattr(election, "tie_policy", None) or "co_winners",
                "anonymous_voting": bool(election.anonymous_voting),
            },
            "results": results.model_dump(),
            "stats": stats.model_dump() if stats else {},
            "batches": [
                {
                    "batch_id": b["batch_id"],
                    "status": b["status"],
                    "total_ballots": b["total_ballots"],
                    "recorded_by_name": b["recorded_by_name"],
                    "attester_names": [
                        a["name"] for a in b["attestations"] if a.get("name")
                    ],
                }
                for b in batches
            ],
            "integrity": integrity,
        }
        meta = {
            "org_name": organization.name if organization else "",
            "generated_at": await self._org_local_time(
                organization, datetime.now(timezone.utc)
            ),
        }
        buf = render_certified_results_pdf(data, meta)
        safe_title = re.sub(r"[^A-Za-z0-9_-]+", "_", election.title)[:60]
        return buf, None, f"certified_results_{safe_title}.pdf"

    async def process_election_lifecycle(self, organization_id: UUID) -> int:
        """Run scheduled lifecycle transitions for one organization.

        - Auto-open DRAFT elections flagged ``auto_open`` whose start_date
          has arrived (and whose end_date hasn't passed). Uses the real
          open_election path so candidate validation still applies — a
          draft that fails validation is logged and retried next tick.
        - Auto-close OPEN elections past end_date. Votes are already
          rejected after end_date; closing runs finalization (results,
          runoffs, anonymous-election IP purge and salt destruction), so
          an overdue election left open is a privacy liability. No opt-in.
        - Send the one automatic non-voter reminder for OPEN elections
          configured with ``reminder_hours_before_close``.

        Returns the number of lifecycle actions performed.
        """
        now = datetime.now(timezone.utc)
        actions = 0
        flags = await self.get_feature_flags(organization_id)

        result = await self.db.execute(
            select(Election.id, Election.status).where(
                Election.organization_id == str(organization_id),
                Election.status.in_(
                    [
                        ElectionStatus.DRAFT,
                        ElectionStatus.NOMINATIONS,
                        ElectionStatus.OPEN,
                    ]
                ),
            )
        )
        rows = result.all()

        for election_id, _status in rows:
            # Re-read inside each unit of work; open/close/remind commit.
            row = await self.db.execute(
                select(Election).where(Election.id == election_id)
            )
            election = row.scalar_one_or_none()
            if election is None:
                continue
            start = self._ensure_utc(election.start_date)
            end = self._ensure_utc(election.end_date)

            if election.status == ElectionStatus.NOMINATIONS:
                deadline = self._ensure_utc(election.nomination_deadline)
                if deadline and deadline <= now:
                    _closed, err = await self.close_nominations(
                        UUID(str(election.id)), organization_id
                    )
                    if err:
                        logger.warning(
                            f"Auto-close nominations failed | "
                            f"election={election.id} reason={err}"
                        )
                    else:
                        actions += 1
                        await self._audit(
                            "nominations_auto_closed",
                            {
                                "election_id": str(election.id),
                                "title": election.title,
                            },
                        )
                # Auto-open (if flagged) picks the election up on the next
                # tick, once it is back in DRAFT.
                continue

            if (
                election.status == ElectionStatus.DRAFT
                and flags["auto_open_enabled"]
                and election.auto_open
                and start
                and start <= now
                and end
                and end > now
            ):
                opened, err = await self.open_election(
                    UUID(str(election.id)), organization_id
                )
                if err:
                    logger.warning(
                        f"Auto-open skipped | election={election.id} reason={err}"
                    )
                else:
                    actions += 1
                    await self._audit(
                        "election_auto_opened",
                        {"election_id": str(election.id), "title": election.title},
                    )
                continue

            if election.status != ElectionStatus.OPEN:
                continue

            if end and end <= now:
                closed, err = await self.close_election(
                    UUID(str(election.id)), organization_id
                )
                if err:
                    logger.warning(
                        f"Auto-close failed | election={election.id} reason={err}"
                    )
                else:
                    actions += 1
                    await self._audit(
                        "election_auto_closed",
                        {"election_id": str(election.id), "title": election.title},
                    )
                continue

            if (
                flags["reminders_enabled"]
                and election.reminder_hours_before_close
                and election.reminder_sent_at is None
                and end
                and now >= end - timedelta(hours=election.reminder_hours_before_close)
            ):
                try:
                    reminded, _failed, _skipped, _details = (
                        await self.remind_non_voters(
                            UUID(str(election.id)), organization_id
                        )
                    )
                    actions += 1
                    logger.info(
                        f"Auto-reminder sent | election={election.id} "
                        f"reminded={reminded}"
                    )
                except ValueError as e:
                    logger.warning(
                        f"Auto-reminder skipped | election={election.id} reason={e}"
                    )

        return actions

    async def _check_and_create_runoff(
        self, election: Election, organization_id: UUID
    ) -> Optional[Election]:
        """Check if a runoff is needed and create it if so"""
        # Get results to check if there's a winner. Bypass the results-visibility
        # gate: closing an election early (before end_date, e.g. at the end of a
        # meeting) is the normal flow, and without the bypass get_election_results
        # returns None and the runoff would be silently skipped.
        results = await self.get_election_results(
            election.id, organization_id, _internal_bypass_visibility=True
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
            .where(Candidate.accepted.is_(True))
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
            .where(Vote.is_test.is_(False))
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

        # Create runoff election. The runoff must inherit the parent's full
        # rule set — a runoff round with looser rules than round one would
        # decide the race under different (weaker) conditions:
        #   - quorum: a quorum-required election's runoff needs the same bar
        #   - position_eligibility: position-level voter-type restrictions
        #   - meeting/event link + attendees: the electorate context
        #   - voter_overrides: members granted eligibility for this race
        # The anonymity salt is generated FRESH (never copied): salts are
        # strictly per-election, and the parent's salt is destroyed at close.
        # Without a salt of its own, an anonymous runoff's voter hashes would
        # be keyed with "" and be pre-computable from user ids (SEC-12).
        runoff_start = datetime.now(timezone.utc) + timedelta(
            hours=1
        )  # Default; open_election clamps a future start to "now" on open
        runoff_end = runoff_start + timedelta(days=1)  # 1 day duration by default

        runoff_election = Election(
            id=str(uuid4()),
            organization_id=organization_id,
            created_by=election.created_by,
            status=ElectionStatus.DRAFT,
            title=f"{election.title} - Runoff Round {election.runoff_round + 1}",
            description=f"Runoff election for {election.title}. No candidate received the required votes in the previous round.",
            election_type=election.election_type,
            positions=election.positions,
            position_eligibility=copy.deepcopy(election.position_eligibility),
            start_date=runoff_start,
            end_date=runoff_end,
            anonymous_voting=election.anonymous_voting,
            voter_anonymity_salt=secrets.token_hex(32),
            allow_write_ins=False,  # No write-ins in runoffs
            max_votes_per_position=election.max_votes_per_position,
            results_visible_immediately=election.results_visible_immediately,
            eligible_voters=election.eligible_voters,
            voter_overrides=copy.deepcopy(election.voter_overrides),
            meeting_id=election.meeting_id,
            event_id=election.event_id,
            meeting_date=election.meeting_date,
            attendees=copy.deepcopy(election.attendees),
            voting_method=election.voting_method,
            victory_condition=election.victory_condition,
            victory_threshold=election.victory_threshold,
            victory_percentage=election.victory_percentage,
            quorum_type=election.quorum_type,
            quorum_value=election.quorum_value,
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
                id=str(uuid4()),
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

        # SEC (ELEC-6): For anonymous elections, purge the per-vote IP and
        # user-agent metadata at the same moment. During voting they feed the
        # live ballot-stuffing detection; after close they would let anyone
        # with DB or forensics access correlate votes to voters in a small
        # department. The tamper-proof audit log keeps its own event trail.
        ip_metadata_purged = False
        if election.anonymous_voting:
            await self.db.execute(
                sql_update(Vote)
                .where(Vote.election_id == str(election_id))
                .values(ip_address=None, user_agent=None)
            )
            ip_metadata_purged = True

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
                "ip_metadata_purged": ip_metadata_purged,
            },
        )

        # Paper-ballot batches that never received their required officer
        # attestations stay excluded from the certified results — flag them
        # so the discrepancy is visible in the audit trail.
        pending_result = await self.db.execute(
            select(ManualBallotBatch.id).where(
                ManualBallotBatch.election_id == str(election_id),
                ManualBallotBatch.status == "pending",
            )
        )
        pending_batch_ids = [row[0] for row in pending_result.all()]
        if pending_batch_ids:
            logger.warning(
                f"Election closed with unattested paper-ballot batches | "
                f"election={election_id} batches={pending_batch_ids}"
            )
            await self._audit(
                "election_manual_ballots_unattested_at_close",
                {
                    "election_id": str(election_id),
                    "batch_ids": pending_batch_ids,
                    "detail": (
                        "These paper-ballot batches never received the "
                        "required attestations and are excluded from the "
                        "certified results"
                    ),
                },
                severity="warning",
            )

        # Flag unresolved ties at close so the required resolution (per the
        # election's tie_policy) is visible in the audit trail. Best-effort:
        # a results-computation error must never block the close.
        try:
            tie_results = await self.get_election_results(
                election_id, organization_id, _internal_bypass_visibility=True
            )
            tied_positions = [
                p.position
                for p in (tie_results.results_by_position if tie_results else [])
                if p.is_tie
            ]
            if tied_positions:
                policy = getattr(election, "tie_policy", None) or "co_winners"
                logger.warning(
                    f"Election closed with unresolved tie(s) | "
                    f"election={election_id} positions={tied_positions} "
                    f"policy={policy}"
                )
                await self._audit(
                    "election_tie_detected",
                    {
                        "election_id": str(election_id),
                        "positions": tied_positions,
                        "tie_policy": policy,
                    },
                    severity="warning",
                )
        except Exception as e:
            logger.error(
                f"Tie detection at close failed (non-blocking) | "
                f"election={election_id} error={e}"
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
            item
            for item in ballot_items
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
            .where(Vote.is_test.is_(False))
        )
        all_votes = votes_result.scalars().all()

        # Batch-fetch all candidate names to avoid N+1 queries
        candidate_ids = {v.candidate_id for v in all_votes if v.candidate_id}
        candidate_names: Dict[str, str] = {}
        if candidate_ids:
            cand_result = await self.db.execute(
                select(Candidate.id, Candidate.name).where(
                    Candidate.id.in_(list(candidate_ids))
                )
            )
            candidate_names = {str(row.id): row.name for row in cand_result.all()}

        for item in pkg_items:
            pkg = pkgs_by_id.get(item["prospect_package_id"])
            if not pkg:
                continue

            position = item.get("position") or item["id"]
            item_votes = [v for v in all_votes if v.position == position]

            approve_count = 0
            deny_count = 0
            for vote in item_votes:
                name = candidate_names.get(str(vote.candidate_id))
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
            .where(Candidate.accepted.is_(True))
        )
        candidate_count = candidates_result.scalar() or 0
        ballot_items = election.ballot_items or []

        if candidate_count == 0 and len(ballot_items) == 0:
            return (
                None,
                "Election must have at least one accepted candidate or ballot item",
            )

        now = datetime.now(timezone.utc)
        end = self._ensure_utc(election.end_date)
        if end and end <= now:
            return (
                None,
                "Election end date has already passed — update the dates "
                "before opening",
            )

        # Freeze the voter roll: eligibility for this election now means
        # "eligible when voting opened" — a membership change mid-election
        # can no longer add or remove voters, and the turnout denominator
        # is fixed and defensible. Secretary overrides still add voters.
        # Best-effort: a roster failure leaves the snapshot NULL, which is
        # the documented legacy behavior (live evaluation).
        try:
            roster = await self.get_eligibility_roster(election_id, organization_id)
            election.eligible_roster_snapshot = [
                m["user_id"]
                for m in roster.get("roster", [])
                if m.get("will_receive_ballot")
            ]
        except Exception as e:
            logger.error(
                f"Failed to freeze voter roll (non-blocking) | "
                f"election={election_id} error={e}"
            )

        # Opening the election is the declaration that voting starts now.
        # Every vote path rejects votes before start_date, and auto-created
        # runoffs default to a start one hour out — without this clamp, a
        # runoff opened at the meeting would bounce every vote with
        # "Election has not started yet" until the scheduled start.
        start = self._ensure_utc(election.start_date)
        start_adjusted = False
        if start and start > now:
            # Floor to the second: MySQL DATETIME(0) ROUNDS fractional
            # seconds, so storing now=:12.7s would persist :13 and reject
            # votes cast during the first second after opening.
            election.start_date = now.replace(microsecond=0)
            start_adjusted = True

        election.status = ElectionStatus.OPEN
        await self.db.commit()
        await self.db.refresh(election)

        logger.info(
            f"Election opened | election={election_id} title={election.title!r} "
            f"start_adjusted={start_adjusted}"
        )
        await self._audit(
            "election_opened",
            {
                "election_id": str(election_id),
                "title": election.title,
                "candidate_count": candidate_count,
                # True when a future start_date was clamped to the open time
                "start_adjusted_to_open_time": start_adjusted,
                "roster_frozen_count": (
                    len(election.eligible_roster_snapshot)
                    if election.eligible_roster_snapshot is not None
                    else None
                ),
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
            # Rollback from closed to open.
            # SECURITY (module-audit ELEC-4): close_election destroys the
            # per-election anonymity salt. Reopening after that would make
            # _generate_voter_hash produce hashes that no longer match the
            # recorded votes, so every prior voter could vote a second time
            # (both the app checks and the dedup hash would miss them).
            # Refuse the rollback in that case — a new election is the safe path.
            if election.anonymous_voting and election.voter_anonymity_salt is None:
                votes_count_result = await self.db.execute(
                    select(func.count(Vote.id))
                    .where(Vote.election_id == str(election_id))
                    .where(Vote.deleted_at.is_(None))
                )
                if (votes_count_result.scalar() or 0) > 0:
                    return (
                        None,
                        0,
                        (
                            "Cannot reopen this election: its anonymity salt was "
                            "destroyed when it closed, so members who already voted "
                            "could vote again undetected. Create a new election "
                            "instead."
                        ),
                    )
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

    async def _notify_leadership(
        self,
        election: Election,
        performed_by: UUID,
        organization_id: UUID,
        reason: str,
        *,
        subject_prefix: str,
        header_color: str,
        header_title: str,
        badge_text: str,
        badge_css_class: str,
        detail_items_html: str,
        detail_items_text: str,
        reason_label: str,
        html_preamble: str,
        text_preamble: str,
        html_postamble: str,
        text_postamble: str,
        footer_text: str,
        extra_styles: str = "",
        skip_performer: bool = False,
        log_label: str = "notification",
    ) -> int:
        """
        Shared helper that sends a templated leadership email notification.

        Callers supply the pieces that differ between rollback and deletion
        alerts; the boilerplate (DB lookups, HTML skeleton, send loop) lives
        here once.

        Returns: Number of notifications sent
        """
        from app.services.email_service import EmailService, build_email_logo_html

        leadership_roles = LEADERSHIP_ROLE_SLUGS

        users_result = await self.db.execute(
            select(User)
            .join(User.roles)
            .where(User.organization_id == str(organization_id))
            .where(User.is_active.is_(True))
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

        org_tz = getattr(organization, "timezone", None) or "America/New_York"
        formatted_time = (
            datetime.now(timezone.utc)
            .astimezone(ZoneInfo(org_tz))
            .strftime("%B %d, %Y at %I:%M %p")
        )

        logo_html = build_email_logo_html(organization)

        # Render detail list items with common variables
        rendered_detail_html = detail_items_html.format(
            safe_title=safe_title,
            safe_performer=safe_performer,
            formatted_time=formatted_time,
        )
        rendered_detail_text = detail_items_text.format(
            title=election.title,
            performer_name=performer_name,
            formatted_time=formatted_time,
        )

        details_border = header_color

        sent_count = 0
        for user in leadership_users:
            if skip_performer and str(user.id) == str(performed_by):
                continue

            safe_first_name = html.escape(user.first_name)

            subject = f"{subject_prefix}{election.title}"

            html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: {header_color}; color: white; padding: 20px; text-align: center; }}
        .{badge_css_class} {{ background-color: #fef2f2; color: #991b1b; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; font-weight: bold; }}
        .content {{ padding: 20px; background-color: #f9fafb; }}
        .details {{ background-color: white; padding: 15px; border-left: 4px solid {details_border}; margin: 15px 0; }}
        .reason {{ background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }}
        .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }}{extra_styles}
    </style>
</head>
<body>
    <div class="container">
        {logo_html}
        <div class="header">
            <h1>{header_title}</h1>
            <div class="{badge_css_class}">{badge_text}</div>
        </div>
        <div class="content">
            <p>Dear {safe_first_name},</p>

            {html_preamble}

            <div class="details">
                <h3>Election Details:</h3>
                <ul>
                    {rendered_detail_html}
                </ul>
            </div>

            <div class="reason">
                <h3>{reason_label}:</h3>
                <p>{safe_reason}</p>
            </div>

            {html_postamble.format(safe_performer=safe_performer)}

            <p>Best regards,<br>{safe_org_name} Election System</p>
        </div>
        <div class="footer">
            <p>{footer_text}</p>
        </div>
    </div>
</body>
</html>
            """

            text_body_preamble = text_preamble
            text_body_postamble = text_postamble.format(
                performer_name=performer_name,
            )

            text_body = f"""{subject_prefix}{election.title}

Dear {user.first_name},

{text_body_preamble}

ELECTION DETAILS:
{rendered_detail_text}

{reason_label.upper()}:
{reason}

{text_body_postamble}

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
                logger.error(f"Failed to send {log_label} to {user.email}: {e}")
                continue

        return sent_count

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
        Send email notifications to leadership about election rollback.

        Returns: Number of notifications sent
        """
        return await self._notify_leadership(
            election=election,
            performed_by=performed_by,
            organization_id=organization_id,
            reason=reason,
            subject_prefix="ALERT: Election Rolled Back - ",
            header_color="#dc2626",
            header_title="\u26a0\ufe0f Election Rollback Alert",
            badge_text="REQUIRES ATTENTION",
            badge_css_class="alert-badge",
            detail_items_html=(
                "<li><strong>Title:</strong> {safe_title}</li>"
                f"<li><strong>Status Changed:</strong> {from_status.upper()}"
                f" \u2192 {to_status.upper()}</li>"
                "<li><strong>Performed By:</strong> {safe_performer}</li>"
                "<li><strong>Date/Time:</strong> {formatted_time}</li>"
            ),
            detail_items_text=(
                "- Title: {title}\n"
                f"- Status Changed: {from_status.upper()}"
                f" \u2192 {to_status.upper()}\n"
                "- Performed By: {performer_name}\n"
                "- Date/Time: {formatted_time}"
            ),
            reason_label="Reason for Rollback",
            html_preamble=(
                "<p>This is an important notification regarding"
                " an election rollback.</p>"
            ),
            text_preamble=(
                "This is an important notification regarding" " an election rollback."
            ),
            html_postamble=(
                "<p>This rollback has been logged in the election's"
                " audit trail. Please review the election details and"
                " coordinate with your team as needed.</p>\n\n"
                "            <p>If you have any questions or concerns"
                " about this rollback, please contact {safe_performer}"
                " or review the election at your earliest"
                " convenience.</p>"
            ),
            text_postamble=(
                "This rollback has been logged in the election's"
                " audit trail. Please review the election details and"
                " coordinate with your team as needed.\n\n"
                "If you have any questions or concerns about this"
                " rollback, please contact {performer_name} or review"
                " the election at your earliest convenience."
            ),
            footer_text=(
                "This is an automated notification from the election"
                " management system."
            ),
            skip_performer=True,
            log_label="rollback notification",
        )

    async def _notify_leadership_of_deletion(
        self,
        election: Election,
        performed_by: UUID,
        organization_id: UUID,
        reason: str,
        vote_count: int = 0,
    ) -> int:
        """
        Send critical email notifications to all leadership about an
        election deletion.

        This is triggered when a non-draft election (open or closed) is
        deleted, which is a major red-flag event.

        Returns: Number of notifications sent
        """
        election_status = election.status.value.upper()

        return await self._notify_leadership(
            election=election,
            performed_by=performed_by,
            organization_id=organization_id,
            reason=reason,
            subject_prefix="CRITICAL: Election DELETED - ",
            header_color="#7f1d1d",
            header_title="ELECTION DELETED",
            badge_text="CRITICAL - REQUIRES IMMEDIATE ATTENTION",
            badge_css_class="critical-badge",
            extra_styles=(
                "\n        .warning { background-color: #fef2f2;"
                " padding: 15px; border-left: 4px solid #dc2626;"
                " margin: 15px 0; }"
            ),
            detail_items_html=(
                "<li><strong>Title:</strong> {safe_title}</li>"
                f"<li><strong>Status at Deletion:</strong>"
                f" {election_status}</li>"
                f"<li><strong>Active Votes at Deletion:</strong>"
                f" {vote_count}</li>"
                "<li><strong>Deleted By:</strong> {safe_performer}</li>"
                "<li><strong>Date/Time:</strong> {formatted_time}</li>"
            ),
            detail_items_text=(
                "- Title: {title}\n"
                f"- Status at Deletion: {election_status}\n"
                f"- Active Votes at Deletion: {vote_count}\n"
                "- Deleted By: {performer_name}\n"
                "- Date/Time: {formatted_time}"
            ),
            reason_label="Reason Given",
            html_preamble=(
                '<div class="warning">'
                f"<p><strong>An election has been permanently deleted"
                f" while in {election_status} status.</strong></p>"
                "<p>This is a critical action that has been"
                " automatically flagged. All leadership members have"
                " been notified.</p>"
                "</div>"
            ),
            text_preamble=(
                f"An election has been permanently deleted while in"
                f" {election_status} status.\n"
                "This is a critical action that has been automatically"
                " flagged. All leadership members have been notified."
            ),
            html_postamble=(
                "<p>This deletion has been logged in the audit trail"
                " with <strong>CRITICAL</strong> severity. Please"
                " review this action and coordinate with your team"
                " immediately if this was not authorized.</p>"
            ),
            text_postamble=(
                "This deletion has been logged in the audit trail with"
                " CRITICAL severity. Please review this action and"
                " coordinate with your team immediately if this was"
                " not authorized."
            ),
            footer_text=(
                "This is an automated critical notification from the"
                " election management system."
            ),
            skip_performer=False,
            log_label="deletion notification",
        )

    async def _generate_voting_token(
        self,
        user_id: UUID,
        election_id: UUID,
        organization_id: UUID,
        election_end_date: datetime,
        anonymity_salt: str = "",
        is_test: bool = False,
        eligible_item_ids: Optional[List[str]] = None,
        eligible_positions: Optional[List[str]] = None,
    ) -> VotingToken:
        """
        Generate a secure voting token for a user-election pair

        Args:
            user_id: User ID (for hashing, not stored directly)
            election_id: Election ID
            organization_id: Organization ID for tenant isolation
            election_end_date: Election end date (token expires after this)
            anonymity_salt: Per-election salt for voter anonymity
            is_test: Mark this token as a test ballot — votes cast with it
                are flagged is_test and excluded from real results
            eligible_item_ids: Ballot items this voter may vote on, snapshotted
                at send time (None = unrestricted / positional election)
            eligible_positions: Positions this voter may vote for, snapshotted
                at send time from position_eligibility (None = unrestricted /
                election without position rules)

        Returns:
            (VotingToken, raw_token) — the raw token exists only in this
            return value (for the emailed ballot link); the row stores its
            SHA-256, so DB read access never yields a live credential
            (module-audit ELEC-5).
        """
        # Generate secure random token; store only its hash
        raw_token = secrets.token_urlsafe(64)
        token = self._hash_voting_token(raw_token)

        # Generate voter hash (same method as used in voting)
        voter_hash = self._generate_voter_hash(user_id, election_id, anonymity_salt)

        # Token expires when election ends (or 30 days if election is longer)
        max_expiry = datetime.now(timezone.utc) + timedelta(days=30)
        end_for_expiry = self._ensure_utc(election_end_date)
        expires_at = min(end_for_expiry, max_expiry) if end_for_expiry else max_expiry

        voting_token = VotingToken(
            id=str(uuid4()),
            organization_id=str(organization_id),
            election_id=str(election_id),
            token=token,
            voter_hash=voter_hash,
            created_at=datetime.now(timezone.utc),
            expires_at=expires_at,
            used=False,
            is_test=is_test,
            eligible_item_ids=eligible_item_ids,
            eligible_positions=eligible_positions,
        )

        self.db.add(voting_token)
        return voting_token, raw_token

    @staticmethod
    def _hash_voting_token(raw_token: str) -> str:
        """SHA-256 a voting token for at-rest storage / lookup (ELEC-5).

        Tokens are 512-bit random values, so an unsalted hash is sufficient
        (no feasible brute-force or rainbow-table attack surface).
        """
        return hashlib.sha256(raw_token.encode()).hexdigest()

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

        # Create the vote as the delegating member, with proxy metadata.
        # Explicit id: signatures cover it and are computed pre-flush.
        vote = Vote(
            id=str(uuid4()),
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=delegating_user_id if not election.anonymous_voting else None,
            voter_hash=voter_hash,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc).replace(microsecond=0),
            is_proxy_vote=True,
            proxy_voter_id=str(proxy_user_id),
            proxy_authorization_id=proxy_authorization_id,
            proxy_delegating_user_id=str(delegating_user_id),
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election_id,
                voter_id_or_hash,
                position,
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank
                ),
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
                ip_address=self._audit_ip(election, ip_address),
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
            ip_address=self._audit_ip(election, ip_address),
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
        is_test: bool = False,
    ) -> Tuple[int, int, int, List[Dict], List[str]]:
        """
        Send ballot notification emails to eligible voters with unique voting links.

        Members with zero eligible ballot items are skipped (not sent
        an empty ballot). A per-member reason is included in ``skipped_details``.

        When ``is_test`` is True the issued tokens are flagged as test ballots:
        votes cast with them are stored with is_test=True and excluded from
        results, stats, and rosters.

        Returns: (recipients_count, failed_count, skipped_count,
        skipped_details, sent_user_ids) — sent_user_ids are the members whose
        email was actually handed to the SMTP server, so callers can act on
        confirmed deliveries (e.g. expiring superseded tokens).
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
            return 0, 0, 0, [], []

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
            return 0, 0, 0, [], []

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
                .where(User.is_active.is_(True))
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
            return 0, 0, 0, [], []

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

            # Positional elections: snapshot which positions this recipient
            # may vote for, mirroring the per-item snapshot below — the token
            # carries no user identity, so position_eligibility (R-D4) can
            # only be enforced at vote time from a send-time snapshot. None =
            # no position rules on this election (unrestricted, and the
            # used-token computation stays on election.positions).
            eligible_positions: Optional[List[str]] = None
            if (
                not election.ballot_items
                and election.positions
                and election.position_eligibility
            ):
                eligible_positions = []
                for pos in election.positions:
                    pos_rules = election.position_eligibility.get(pos)
                    if not pos_rules:
                        # No rules for this position → everyone may vote
                        # (mirrors check_voter_eligibility).
                        eligible_positions.append(pos)
                        continue
                    voter_types = pos_rules.get("voter_types", ["all"])
                    if await self._user_has_role_type(recipient, voter_types):
                        eligible_positions.append(pos)
                if not eligible_positions:
                    skipped_count += 1
                    reason = (
                        "Not eligible for any position in this election — "
                        "membership type does not match any position's "
                        "voter-type rules"
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

            # Generate unique voting token for this voter. For ballot-item
            # elections the recipient's eligible item ids are snapshotted on
            # the token so per-item eligibility can be enforced at submission
            # time (the token itself carries no user identity).
            voting_token, raw_ballot_token = await self._generate_voting_token(
                user_id=recipient.id,
                election_id=election_id,
                organization_id=organization_id,
                election_end_date=election.end_date,
                anonymity_salt=election.voter_anonymity_salt or "",
                is_test=is_test,
                eligible_item_ids=(
                    [str(item.get("id")) for item in eligible_items if item.get("id")]
                    if election.ballot_items
                    else None
                ),
                eligible_positions=eligible_positions,
            )

            # Build unique ballot URL with the RAW token (the row stores only
            # its hash — the raw value never touches the database). The token
            # rides in the URL *fragment*: browsers never send fragments to
            # any server, so the live credential stays out of frontend-host /
            # proxy access logs (R-D3). The voting page reads it from
            # location.hash and POSTs it in request bodies from then on.
            ballot_url = (
                f"{base_ballot_url}#token={raw_ballot_token}"
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
                subj, html_body, text_body = (
                    await email_service.render_ballot_notification(
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
        # Merge rather than replace: a reminder re-send targets only the
        # non-voters, and replacing would erase the original recipients'
        # "ballot sent" record.
        election.email_recipients = sorted(
            set(election.email_recipients or []) | set(sent_user_ids)
        )

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

        return (
            success_count,
            failed_count,
            skipped_count,
            skipped_details,
            sent_user_ids,
        )

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

    # ------------------------------------------------------------------
    # Pre-meeting package (secretary meeting prep)
    # ------------------------------------------------------------------

    async def get_package_recipients(
        self,
        election_id: UUID,
        organization_id: UUID,
        mode: str,
    ) -> Tuple[Optional[List[Dict]], Optional[str]]:
        """Resolve a prefill recipient list for the pre-meeting package modal.

        mode:
        - "leadership": active members holding a leadership role slug
        - "eligible_voters": roster members who will receive a ballot

        The list is only a starting point — the secretary edits it freely in
        the modal (remove anyone, add outside addresses) before sending.

        Returns: (recipients [{user_id, name, email}], error)
        """
        election = await self.get_election(election_id, organization_id)
        if not election:
            return None, "Election not found"

        recipients: List[Dict] = []
        if mode == "leadership":
            users_result = await self.db.execute(
                select(User)
                .where(User.organization_id == str(organization_id))
                .where(User.is_active.is_(True))
                .options(selectinload(User.roles))
                .order_by(User.last_name, User.first_name)
            )
            for user in users_result.scalars().all():
                if not user.email:
                    continue
                if any(role.slug in LEADERSHIP_ROLE_SLUGS for role in user.roles):
                    recipients.append(
                        {
                            "user_id": str(user.id),
                            "name": user.full_name or user.username,
                            "email": user.email,
                        }
                    )
        elif mode == "eligible_voters":
            roster = await self.get_eligibility_roster(election_id, organization_id)
            for member in roster.get("roster", []):
                if member.get("will_receive_ballot") and member.get("email"):
                    recipients.append(
                        {
                            "user_id": member["user_id"],
                            "name": member["full_name"],
                            "email": member["email"],
                        }
                    )
        else:
            return None, f"Unknown recipient mode: {mode}"

        return recipients, None

    async def build_pre_meeting_package_pdf(
        self,
        election_id: UUID,
        organization_id: UUID,
        include_ineligibility_detail: bool = False,
    ) -> Tuple[Optional[BytesIO], Optional[str], str]:
        """Assemble package data and render the PDF.

        Two variants: the member variant lists eligible voters and counts
        only; the full variant (leadership) adds per-member ineligibility
        reasons and granted overrides.

        Returns: (pdf_buffer, error, filename)
        """
        from app.models.meeting import Meeting
        from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf

        election = await self.get_election(election_id, organization_id)
        if not election:
            return None, "Election not found", ""
        if election.status in (ElectionStatus.CLOSED, ElectionStatus.CANCELLED):
            return (
                None,
                "Pre-meeting packages are only available for draft or open "
                "elections",
                "",
            )

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return None, "Organization not found", ""

        tz = ZoneInfo(organization.timezone or "America/New_York")

        def _fmt_local(dt) -> str:
            dt = self._ensure_utc(dt)
            if not dt:
                return ""
            return dt.astimezone(tz).strftime("%B %d, %Y at %I:%M %p")

        # Meeting context (org-scoped — a stale/foreign meeting_id must not
        # surface another org's meeting in the package)
        meeting_data: Optional[Dict] = None
        if election.meeting_id:
            meeting_result = await self.db.execute(
                select(Meeting)
                .where(Meeting.id == election.meeting_id)
                .where(Meeting.organization_id == str(organization_id))
            )
            meeting = meeting_result.scalar_one_or_none()
            if meeting:
                date_display = ""
                if meeting.meeting_date:
                    date_display = meeting.meeting_date.strftime("%B %d, %Y")
                    if meeting.start_time:
                        date_display += f" at {meeting.start_time.strftime('%I:%M %p')}"
                meeting_type = meeting.meeting_type
                meeting_data = {
                    "title": meeting.title,
                    "meeting_type": (
                        meeting_type.value.replace("_", " ").title()
                        if hasattr(meeting_type, "value")
                        else str(meeting_type or "")
                    ),
                    "date_display": date_display,
                    "location": meeting.location,
                    "agenda": meeting.agenda,
                }

        # Roster (single source of truth for eligibility)
        roster = await self.get_eligibility_roster(election_id, organization_id)
        roster_members = roster.get("roster", [])
        eligible = [
            {
                "full_name": m["full_name"],
                "membership_type": m.get("membership_type"),
                "has_override": m.get("has_override", False),
            }
            for m in roster_members
            if m.get("will_receive_ballot")
        ]
        ineligible = [
            {
                "full_name": m["full_name"],
                "reason": m.get("ineligibility_reason") or "Not eligible",
            }
            for m in roster_members
            if not m.get("will_receive_ballot")
        ]
        names_by_id = {m["user_id"]: m["full_name"] for m in roster_members}
        overrides = [
            {
                "full_name": names_by_id.get(
                    record.get("user_id"), record.get("user_id")
                ),
                "reason": record.get("reason"),
                "overridden_by_name": record.get("overridden_by_name"),
            }
            for record in (election.voter_overrides or [])
        ]

        # Accepted candidates in ballot order
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == str(election_id))
            .where(Candidate.accepted.is_(True))
            .order_by(Candidate.position, Candidate.display_order)
        )
        candidates = [
            {
                "name": c.name,
                "position": c.position,
                "statement": c.statement,
            }
            for c in candidates_result.scalars().all()
        ]

        data = {
            "election": {
                "title": election.title,
                "description": election.description,
                "positions": election.positions,
                "start_display": _fmt_local(election.start_date),
                "end_display": _fmt_local(election.end_date),
                "voting_method": election.voting_method,
                "victory_condition": election.victory_condition,
                "victory_percentage": election.victory_percentage,
                "victory_threshold": election.victory_threshold,
                "anonymous_voting": election.anonymous_voting,
                "allow_write_ins": election.allow_write_ins,
                "quorum_type": election.quorum_type,
                "quorum_value": election.quorum_value,
                "enable_runoffs": election.enable_runoffs,
                "runoff_type": election.runoff_type,
                "max_runoff_rounds": election.max_runoff_rounds,
                "proxy_voting_enabled": self._is_proxy_voting_enabled(organization),
            },
            "meeting": meeting_data,
            "ballot_items": election.ballot_items or [],
            "candidates": candidates,
            "roster": {
                "total_members": roster.get("total_members", 0),
                "total_eligible": roster.get("total_eligible", 0),
                "total_ineligible": roster.get("total_ineligible", 0),
                "total_overrides": roster.get("total_overrides", 0),
                "eligible": eligible,
                "ineligible": ineligible,
                "overrides": overrides,
            },
        }
        meta = {
            "org_name": organization.name,
            "generated_at": datetime.now(timezone.utc).astimezone(tz),
        }

        slug = re.sub(r"[^a-z0-9]+", "-", (election.title or "election").lower())
        filename = f"pre-meeting-package-{slug.strip('-') or 'election'}.pdf"

        buf = render_pre_meeting_package_pdf(
            data, meta, include_ineligibility_detail=include_ineligibility_detail
        )
        return buf, None, filename

    async def generate_and_send_pre_meeting_package(
        self,
        election_id: UUID,
        organization_id: UUID,
        sent_by: UUID,
        recipient_emails: List[str],
        message: Optional[str] = None,
        include_full_roster: bool = False,
    ) -> Tuple[bool, str, int]:
        """Email the pre-meeting package PDF to a secretary-edited list.

        ``recipient_emails`` is the FINAL list — prefills (leadership /
        eligible voters) are resolved in the modal and freely edited there,
        including outside addresses. Recipients go on BCC so addresses are
        not exposed to each other.

        Returns: (success, message, sent_count)
        """
        # Deduplicate case-insensitively, preserving order
        seen: set = set()
        cleaned_emails: List[str] = []
        for email_addr in recipient_emails:
            addr = (email_addr or "").strip()
            if addr and addr.lower() not in seen:
                seen.add(addr.lower())
                cleaned_emails.append(addr)
        if not cleaned_emails:
            return False, "No recipient email addresses provided", 0

        buf, error, filename = await self.build_pre_meeting_package_pdf(
            election_id, organization_id, include_full_roster
        )
        if error or buf is None:
            return False, error or "Failed to generate package PDF", 0

        election = await self.get_election(election_id, organization_id)
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        # The sender goes on To (so the email has a visible recipient and the
        # secretary gets a copy); the edited list goes on BCC.
        sender_result = await self.db.execute(
            select(User)
            .where(User.id == str(sent_by))
            .where(User.organization_id == str(organization_id))
        )
        sender = sender_result.scalar_one_or_none()
        if sender and sender.email:
            to_emails = [sender.email]
            bcc_emails = [e for e in cleaned_emails if e != sender.email]
        else:
            to_emails = [cleaned_emails[0]]
            bcc_emails = cleaned_emails[1:]

        tz = ZoneInfo(
            (organization.timezone if organization else None) or "America/New_York"
        )
        start_local = self._ensure_utc(election.start_date).astimezone(tz)
        end_local = self._ensure_utc(election.end_date).astimezone(tz)

        message_html = ""
        message_text = ""
        if message and message.strip():
            safe_message = html.escape(message.strip()).replace("\n", "<br/>")
            message_html = f"<p style='white-space:pre-line'>{safe_message}</p><hr/>"
            message_text = f"{message.strip()}\n\n---\n\n"

        variant_note = (
            "the full voter-eligibility roster (including ineligibility " "reasons)"
            if include_full_roster
            else "the eligible-voter list"
        )
        body_html = (
            f"{message_html}"
            f"<p>The pre-meeting package for "
            f"<strong>{html.escape(election.title)}</strong> is attached "
            f"as a PDF. It contains the meeting details, the ballot preview "
            f"with candidates, and {variant_note}.</p>"
            f"<p>Voting opens "
            f"{start_local.strftime('%B %d, %Y at %I:%M %p')} and closes "
            f"{end_local.strftime('%B %d, %Y at %I:%M %p')}.</p>"
        )
        body_text = (
            f"{message_text}"
            f"The pre-meeting package for {election.title} is attached as a "
            f"PDF. It contains the meeting details, the ballot preview with "
            f"candidates, and {variant_note}.\n\n"
            f"Voting opens {start_local.strftime('%B %d, %Y at %I:%M %p')} "
            f"and closes {end_local.strftime('%B %d, %Y at %I:%M %p')}."
        )

        from app.services.email_service import wrap_email_body

        html_body = wrap_email_body(
            organization,
            title=f"Pre-Meeting Package: {html.escape(election.title)}",
            body_html=body_html,
        )

        email_service = EmailService(organization)
        # Unique temp dir so the human-readable attachment filename (used as
        # the attachment name by send_email) can't collide across concurrent
        # sends of the same election
        tmp_dir = tempfile.mkdtemp(prefix="premeeting-pkg-")
        tmp_path = os.path.join(tmp_dir, filename)
        try:
            with open(tmp_path, "wb") as tmp:
                tmp.write(buf.getvalue())

            success_count, failure_count = await email_service.send_email(
                to_emails=to_emails,
                subject=f"Pre-Meeting Package: {election.title}",
                html_body=html_body,
                text_body=body_text,
                attachment_paths=[tmp_path],
                bcc_emails=bcc_emails,
                db=self.db,
                template_type="pre_meeting_package",
                sent_by=str(sent_by),
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass

        sent_count = len(cleaned_emails) if success_count > 0 else 0
        await self._audit(
            "pre_meeting_package_sent",
            {
                "election_id": str(election_id),
                "title": election.title,
                "recipient_count": len(cleaned_emails),
                "full_roster_variant": include_full_roster,
                "success": success_count > 0,
            },
            user_id=str(sent_by),
        )

        if success_count > 0:
            logger.info(
                f"Pre-meeting package sent | election={election_id} "
                f"recipients={len(cleaned_emails)} full={include_full_roster}"
            )
            return (
                True,
                f"Pre-meeting package sent to {len(cleaned_emails)} " f"recipient(s)",
                sent_count,
            )
        logger.error(
            f"Failed to send pre-meeting package | election={election_id} "
            f"failures={failure_count}"
        )
        return False, "Failed to send pre-meeting package email", 0

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
            f'<table style="{TABLE_STYLE}">'
            "<tr>"
            f'<th style="{TH_STYLE}text-align:left;">Position</th>'
            f'<th style="{TH_STYLE}text-align:left;">Candidate</th>'
            f'<th style="{TH_STYLE}text-align:center;">Votes</th>'
            f'<th style="{TH_STYLE}text-align:center;">%</th>'
            f'<th style="{TH_STYLE}text-align:center;">Result</th>'
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
                    f'<tr><td style="{TD_STYLE}">{position}</td>'
                    f'<td style="{TD_STYLE}">{name}</td>'
                    f'<td style="{TD_STYLE}text-align:center;">{candidate.vote_count}</td>'
                    f'<td style="{TD_STYLE}text-align:center;">{pct}</td>'
                    f'<td style="{TD_STYLE}text-align:center;">{result_label}</td></tr>'
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
            .where(User.is_active.is_(True))
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
            f'<table style="{TABLE_STYLE}"><tr>'
            f'<th style="{TH_STYLE}text-align:left;">Member</th>'
            f'<th style="{TH_STYLE}text-align:left;">Reason</th>'
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
                f'<tr><td style="{TD_STYLE}">{name}</td>'
                f'<td style="{TD_STYLE}">{safe_reason}</td></tr>'
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
        # Tokens are stored as SHA-256 hashes (ELEC-5) — hash the presented
        # raw token before lookup. Pre-migration rows were hashed in place
        # (migration 20260731_0001), so old emailed links keep working.
        result = await self.db.execute(
            select(VotingToken).where(
                VotingToken.token == self._hash_voting_token(token)
            )
        )
        voting_token = result.scalar_one_or_none()

        if not voting_token:
            return None, None, "Invalid voting token"

        # Check if token has expired
        token_exp = self._ensure_utc(voting_token.expires_at)
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
        start = self._ensure_utc(election.start_date)
        end = self._ensure_utc(election.end_date)
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
        vote_rank: Optional[int] = None,
    ) -> Tuple[Optional[Vote], Optional[str]]:
        """
        Cast a vote using a voting token

        Returns: (Vote object, error_message)
        """
        # Validate token and get ballot
        election, voting_token, error = await self.get_ballot_by_token(token)

        if error:
            return None, error

        # Validate vote_rank matches the voting method (parity with cast_vote)
        if election.voting_method == "ranked_choice" and vote_rank is None:
            return None, "vote_rank is required for ranked-choice voting"
        if election.voting_method != "ranked_choice" and vote_rank is not None:
            return None, "vote_rank is not applicable for this voting method"

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

        # Enforce the send-time position-eligibility snapshot (R-D4). Fall
        # back to candidate.position so omitting the position field can't
        # bypass the check. NULL snapshot = legacy token or election without
        # position rules — unrestricted (documented fail-open, time-bounded
        # by token expiry).
        effective_position = position or candidate.position
        if (
            voting_token.eligible_positions is not None
            and effective_position not in voting_token.eligible_positions
        ):
            return None, (
                f"You are not eligible to vote for {effective_position}"
                if effective_position
                else "You are not eligible to vote in this election"
            )

        # Method-aware duplicate and limit checks — the token-path mirror of
        # cast_vote's rules (R-D5): approval records one vote per approved
        # candidate and ranked choice one per rank, so a blanket "already
        # voted for this position" rule would reject every legitimate second
        # vote. For a positionless vote, match only other positionless votes —
        # `Vote.position == None if position is None` would otherwise degrade
        # to a no-op filter and any prior vote (for any position) would block.
        # Match is_test so a manager's test ballot never consumes their real
        # vote slot — mirroring the `test:` namespace in the dedup hash.
        existing_votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
            .where(Vote.voter_hash == voting_token.voter_hash)
            .where(Vote.is_test == voting_token.is_test)
            .where(Vote.deleted_at.is_(None))
            .where(Vote.position == position if position else Vote.position.is_(None))
        )
        position_votes = existing_votes_result.scalars().all()

        if election.voting_method == "ranked_choice":
            if any(v.vote_rank == vote_rank for v in position_votes):
                return None, (
                    f"You have already cast a rank-{vote_rank} vote"
                    + (f" for {position}" if position else "")
                )
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already ranked this candidate"
        elif election.voting_method == "approval":
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already voted for this candidate"
        else:
            max_votes = election.max_votes_per_position or 1
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return None, "You have already voted for this candidate"
            if len(position_votes) >= max_votes:
                if position:
                    if max_votes == 1:
                        return None, f"You have already voted for {position}"
                    return None, f"Maximum votes for {position} reached"
                if max_votes == 1:
                    return None, "You have already voted"
                return None, "Maximum votes for this election reached"

        # Create the vote with security hashes. Test-ballot tokens produce
        # is_test votes (excluded from results) and use a namespaced dedup
        # input so a test vote never blocks the same member's real vote.
        dedup_voter = (
            f"test:{voting_token.voter_hash}"
            if voting_token.is_test
            else voting_token.voter_hash
        )
        vote = Vote(
            # Explicit id: signatures cover it and are computed pre-flush.
            id=str(uuid4()),
            election_id=election.id,
            candidate_id=candidate_id,
            voter_id=None,  # Anonymous - not stored
            voter_hash=voting_token.voter_hash,
            position=position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc).replace(microsecond=0),
            is_test=voting_token.is_test,
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election.id,
                dedup_voter,
                position,
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank
                ),
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
        # or if it's a single-position election. A position-restricted token
        # is complete once its *eligible* positions are covered — measuring
        # against election.positions would leave it forever un-used.
        # Multi-vote methods (approval / ranked / max_votes>1) legitimately
        # cast several votes through this endpoint, and "every slot filled"
        # isn't knowable per-vote — there the bulk ballot endpoint remains
        # the atomic used=True path, and get_ballot_by_token's used check
        # stays the backstop against wholesale re-submission.
        multi_vote_method = (
            election.voting_method in ("ranked_choice", "approval")
            or (election.max_votes_per_position or 1) > 1
        )
        election_positions = (
            voting_token.eligible_positions
            if voting_token.eligible_positions is not None
            else (election.positions or [])
        )
        if not multi_vote_method:
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
                ip_address=self._audit_ip(election, ip_address),
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
            ip_address=self._audit_ip(election, ip_address),
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

        Each vote in the list corresponds to a ballot item and contains
        exactly one selection form (none at all = abstain):
        - choice: 'approve', 'deny', 'abstain', 'write_in', or a candidate
          UUID (single-selection items; write_in_name required for write-ins)
        - candidate_ids: multi-select candidate UUIDs for approval /
          multi-vote items (R-D5)
        - rankings: ordered candidate UUIDs for ranked-choice items,
          index 0 = rank 1 (R-D5)

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

        # Per-item eligibility snapshotted on the token at send time.
        # None = legacy token (issued before this column existed) — no
        # restriction; a list restricts non-abstain votes to those items.
        # SECURITY: without this check any token holder could vote on items
        # restricted to other member classes by POSTing their ids.
        allowed_item_ids = (
            set(voting_token.eligible_item_ids)
            if voting_token.eligible_item_ids is not None
            else None
        )

        # Get all accepted candidates for this election
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election.id)
            .where(Candidate.accepted.is_(True))
        )
        candidates = candidate_result.scalars().all()
        candidate_map = {str(c.id): c for c in candidates}

        # Process each vote
        created_votes = []
        abstentions = 0

        # Test-ballot tokens produce is_test votes and a namespaced dedup
        # input so a test submission never blocks the same member's real
        # ballot.
        dedup_voter = (
            f"test:{voting_token.voter_hash}"
            if voting_token.is_test
            else voting_token.voter_hash
        )

        def _create_token_vote(
            cand_id, vote_position: str, rank: Optional[int], discriminator: str
        ) -> Vote:
            """Build/sign/chain one Vote row and append it to created_votes."""
            new_vote = Vote(
                # Explicit id: signatures cover it, computed pre-flush.
                id=str(uuid4()),
                election_id=election.id,
                candidate_id=cand_id,
                voter_id=None,
                voter_hash=voting_token.voter_hash,
                position=vote_position,
                vote_rank=rank,
                ip_address=ip_address,
                user_agent=user_agent,
                voted_at=datetime.now(timezone.utc).replace(microsecond=0),
                is_test=voting_token.is_test,
                vote_dedup_hash=self._compute_vote_dedup_hash(
                    election.id,
                    dedup_voter,
                    vote_position,
                    discriminator=discriminator,
                ),
            )
            new_vote.vote_signature = self._sign_vote(new_vote)
            new_vote.chain_hash = self._compute_chain_hash(
                election.last_chain_hash, new_vote.vote_signature
            )
            new_vote.receipt_hash = self._compute_receipt_hash(
                str(new_vote.id), new_vote.vote_signature
            )
            election.last_chain_hash = new_vote.chain_hash
            self.db.add(new_vote)
            created_votes.append(new_vote)
            return new_vote

        for vote_data in votes:
            ballot_item_id = vote_data.get("ballot_item_id")
            choice = vote_data.get("choice")
            candidate_ids = vote_data.get("candidate_ids")
            rankings = vote_data.get("rankings")
            write_in_name = vote_data.get("write_in_name")

            # Validate ballot item exists
            ballot_item = item_map.get(ballot_item_id)
            if not ballot_item:
                continue

            # Handle abstain — no vote recorded. No selection at all counts
            # as an abstention too (the schema allows omitting all forms).
            if choice == "abstain" or (
                choice is None and not candidate_ids and not rankings
            ):
                abstentions += 1
                continue

            # Enforce per-item eligibility (voter types / attendance were
            # evaluated when the ballot was issued and snapshotted on the token)
            if allowed_item_ids is not None and ballot_item_id not in allowed_item_ids:
                return (
                    None,
                    "You are not eligible to vote on: "
                    f"{ballot_item.get('title', ballot_item_id)}",
                )

            # Determine the position for this vote (use ballot item id as position)
            position = ballot_item.get("position") or ballot_item_id

            # Check if already voted for this position (prevents double-voting
            # within the ballot). Match is_test so a test ballot never blocks
            # the same member's real ballot — mirroring the dedup-hash
            # namespace (`test:` prefix).
            existing_check = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == election.id)
                .where(Vote.voter_hash == voting_token.voter_hash)
                .where(Vote.is_test == voting_token.is_test)
                .where(Vote.position == position)
                .where(Vote.deleted_at.is_(None))
            )
            if existing_check.scalar_one_or_none():
                return (
                    None,
                    f"You have already voted on: {ballot_item.get('title', ballot_item_id)}",
                )

            # Items may override the election-level voting method; the
            # multi-select / ranked payload forms are only accepted where the
            # effective method calls for them (R-D5).
            effective_method = (
                ballot_item.get("voting_method") or election.voting_method
            )
            item_title = ballot_item.get("title", ballot_item_id)

            if rankings is not None:
                if effective_method != "ranked_choice":
                    return (
                        None,
                        f"Ranked votes are not accepted for: {item_title}",
                    )
                for idx, cid in enumerate(rankings):
                    ranked_candidate = candidate_map.get(cid)
                    if not ranked_candidate or ranked_candidate.position != position:
                        return (
                            None,
                            f"Invalid candidate selection for: {item_title}",
                        )
                    rank = idx + 1
                    _create_token_vote(UUID(cid), position, rank, f"rank:{rank}")
                continue

            if candidate_ids is not None:
                max_votes = election.max_votes_per_position or 1
                if effective_method != "approval" and max_votes <= 1:
                    return (
                        None,
                        f"Multiple selections are not accepted for: {item_title}",
                    )
                if effective_method != "approval" and len(candidate_ids) > max_votes:
                    return (
                        None,
                        f"Too many selections for: {item_title} (max {max_votes})",
                    )
                for cid in candidate_ids:
                    multi_candidate = candidate_map.get(cid)
                    if not multi_candidate or multi_candidate.position != position:
                        return (
                            None,
                            f"Invalid candidate selection for: {item_title}",
                        )
                    _create_token_vote(UUID(cid), position, None, f"cand:{cid}")
                continue

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
                    .where(Candidate.is_write_in.is_(False))
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
                    .where(Candidate.is_write_in.is_(False))
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

            # Single-selection path — discriminator stays "" so dedup hashes
            # remain byte-identical with rows written before the multi-select
            # forms existed (the per-position pre-check above is the dedup).
            _create_token_vote(candidate_id, position, None, "")

        # Mark token as fully used
        voting_token.used = True
        voting_token.used_at = datetime.now(timezone.utc)
        voting_token.positions_voted = [
            v.get("ballot_item_id")
            for v in votes
            if v.get("choice") not in (None, "abstain")
            or v.get("candidate_ids")
            or v.get("rankings")
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
                ip_address=self._audit_ip(election, ip_address),
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
            ip_address=self._audit_ip(election, ip_address),
        )

        return {
            "success": True,
            "votes_cast": len(created_votes),
            "abstentions": abstentions,
            "message": f"Ballot submitted successfully. {len(created_votes)} vote(s) cast, {abstentions} abstention(s).",
            # Receipts let the voter verify their votes were recorded via the
            # public verify-receipt endpoint without revealing vote content.
            "receipt_hashes": [v.receipt_hash for v in created_votes],
        }, None

    # ------------------------------------------------------------------
    # Eligibility Roster (secretary view)
    # ------------------------------------------------------------------

    async def get_eligibility_roster(
        self,
        election_id: UUID,
        organization_id: UUID,
    ) -> Dict:
        """
        Build a full roster of all active members with per-ballot-item
        eligibility status.  Designed for the secretary to see at a glance
        who will receive a ballot, who won't, and why.
        """
        election = await self.get_election(election_id, organization_id)
        if not election:
            raise ValueError("Election not found")

        # Load all active users with roles
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.is_active.is_(True))
            .options(selectinload(User.roles))
            .order_by(User.last_name, User.first_name)
        )
        users = list(users_result.scalars().all())

        # Load org settings for tier checks
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()

        # Check who has voted (for live status)
        voted_user_ids: set = set()
        if election.anonymous_voting:
            # Batch-compute voter hashes and query once instead of N+1
            hash_to_user: Dict[str, str] = {}
            for user in users:
                voter_hash = self._generate_voter_hash(
                    user.id,
                    election_id,
                    election.voter_anonymity_salt or "",
                )
                hash_to_user[voter_hash] = str(user.id)

            if hash_to_user:
                all_hashes = list(hash_to_user.keys())
                vote_result = await self.db.execute(
                    select(Vote.voter_hash)
                    .where(Vote.election_id == str(election_id))
                    .where(Vote.voter_hash.in_(all_hashes))
                    .where(Vote.deleted_at.is_(None))
                    .where(Vote.is_test.is_(False))
                    .distinct()
                )
                for row in vote_result.all():
                    matched_hash = row[0]
                    uid = hash_to_user.get(matched_hash)
                    if uid:
                        voted_user_ids.add(uid)
        else:
            vote_result = await self.db.execute(
                select(Vote.voter_id)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_id.isnot(None))
                .where(Vote.deleted_at.is_(None))
                .where(Vote.is_test.is_(False))
            )
            voted_user_ids = {str(r[0]) for r in vote_result.all() if r[0]}

        ballot_items = election.ballot_items or []
        override_user_ids = {o.get("user_id") for o in (election.voter_overrides or [])}

        # Membership tier definitions for the positional (no-ballot-items)
        # eligibility path below
        tier_defs = (
            ((organization.settings or {}) if organization else {})
            .get("membership_tiers", {})
            .get("tiers", [])
        )

        roster = []
        for user in users:
            user_id = str(user.id)
            has_override = user_id in override_user_ids
            has_voted = user_id in voted_user_ids
            is_attending = self._is_user_attending(user_id, election)

            # Restricted voter list check
            in_eligible_list = True
            if election.eligible_voters:
                in_eligible_list = user_id in [str(v) for v in election.eligible_voters]

            # Per-item eligibility
            item_eligibility = []
            eligible_count = 0
            for item in ballot_items:
                if has_override or not election.eligible_voters or in_eligible_list:
                    eligible_items = await self._get_eligible_ballot_items_for_user(
                        user,
                        election,
                        str(organization_id),
                        organization,
                    )
                    item_ids = {i.get("id") for i in eligible_items}
                    for bi in ballot_items:
                        is_eligible = bi.get("id") in item_ids
                        reason = None
                        if not is_eligible and not has_override:
                            eligible_types = bi.get("eligible_voter_types", ["all"])
                            if not await self._user_has_role_type(user, eligible_types):
                                member_type = (
                                    getattr(user, "membership_type", None) or "active"
                                )
                                reason = (
                                    f"Membership type '{member_type}' not in "
                                    f"required: {', '.join(eligible_types)}"
                                )
                            elif bi.get("require_attendance") and not is_attending:
                                reason = "Not checked in for meeting"
                        item_eligibility.append(
                            {
                                "ballot_item_id": bi.get("id", ""),
                                "ballot_item_title": bi.get("title", ""),
                                "eligible": is_eligible,
                                "reason": reason,
                            }
                        )
                        if is_eligible:
                            eligible_count += 1
                    break  # computed all items in one pass
                else:
                    for bi in ballot_items:
                        item_eligibility.append(
                            {
                                "ballot_item_id": bi.get("id", ""),
                                "ballot_item_title": bi.get("title", ""),
                                "eligible": False,
                                "reason": "Not in eligible voters list",
                            }
                        )
                    break

            # Positional elections (no structured ballot items): eligibility
            # is election-level — restricted voter list, tier voting rules,
            # and secretary overrides. Without this branch every member of a
            # candidate/position-only election would show as ineligible
            # (eligible_count can only accrue from ballot items).
            positional_eligible = False
            positional_reason = None
            if not ballot_items and in_eligible_list:
                if has_override:
                    positional_eligible = True
                else:
                    member_tier_id = getattr(user, "membership_type", None) or "active"
                    tier_def = next(
                        (t for t in tier_defs if t.get("id") == member_tier_id),
                        None,
                    )
                    benefits = (tier_def or {}).get("benefits", {})
                    positional_eligible = benefits.get("voting_eligible", True)
                    if not positional_eligible:
                        tier_name = (tier_def or {}).get("name", member_tier_id)
                        positional_reason = (
                            f"Membership tier '{tier_name}' is not eligible " f"to vote"
                        )

            # Overall ineligibility reason
            overall_reason = None
            if not in_eligible_list and not has_override:
                overall_reason = "Not in eligible voters list"
                eligible_count = 0
            elif not ballot_items:
                overall_reason = positional_reason
            elif eligible_count == 0 and not has_override:
                overall_reason = await self._get_ineligibility_reason_for_user(
                    user,
                    election,
                    str(organization_id),
                    organization,
                )

            will_receive_ballot = (
                eligible_count > 0 or has_override or positional_eligible
            ) and in_eligible_list

            member_type = getattr(user, "membership_type", None) or "active"
            roster.append(
                {
                    "user_id": user_id,
                    "full_name": user.full_name or user.username,
                    "email": user.email,
                    "membership_type": member_type,
                    "has_override": has_override,
                    "has_voted": has_voted,
                    "is_attending": is_attending,
                    "will_receive_ballot": will_receive_ballot,
                    "eligible_item_count": eligible_count if will_receive_ballot else 0,
                    "total_item_count": len(ballot_items),
                    "ineligibility_reason": overall_reason,
                    "item_eligibility": item_eligibility,
                }
            )

        total_eligible = sum(1 for r in roster if r["will_receive_ballot"])
        total_voted = sum(1 for r in roster if r["has_voted"])
        total_overrides = sum(1 for r in roster if r["has_override"])

        return {
            "election_id": str(election_id),
            "election_title": election.title,
            "election_status": (
                election.status.value
                if hasattr(election.status, "value")
                else str(election.status)
            ),
            "total_members": len(roster),
            "total_eligible": total_eligible,
            "total_ineligible": len(roster) - total_eligible,
            "total_voted": total_voted,
            "total_overrides": total_overrides,
            "roster": roster,
        }
