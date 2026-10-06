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
from typing import Any, Dict, List, NamedTuple, Optional, Set, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import and_, func, or_, select
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
from app.models.email_template import EmailTemplateType
from app.models.membership_pipeline import ProspectElectionPackage
from app.models.user import Organization, User
from app.schemas.election import (
    CandidateResult,
    ElectionResults,
    ElectionStats,
    PositionResults,
    VoterEligibility,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
    recipients_for,
)
from app.services.email_service import BuiltMessage, EmailService
from app.services.email_template_service import (
    DEFAULT_ELECTION_DELETED_HTML,
    DEFAULT_ELECTION_DELETED_SUBJECT,
    DEFAULT_ELECTION_DELETED_TEXT,
    DEFAULT_ELECTION_ROLLBACK_HTML,
    DEFAULT_ELECTION_ROLLBACK_SUBJECT,
    DEFAULT_ELECTION_ROLLBACK_TEXT,
    EmailTemplateService,
)
from app.services.email_theme import (
    TABLE_STYLE,
    TD_STYLE,
    TH_STYLE,
    WRAP_STYLE,
    with_subline,
)
from app.utils.org_timezone import (
    ZONED_DATE_TIME_FORMAT,
    format_in_org_timezone,
    resolve_scheduling_timezone,
    to_local,
)

# What a member sees when they open the link a reminder replaced. Not
# "expired": the election is still open and their newer email works.
SUPERSEDED_TOKEN_MESSAGE = "This link was replaced by a newer ballot email"
REOPENED_TOKEN_MESSAGE = (
    "This election was closed and reopened, so this ballot link is no longer "
    "valid. Ask your secretary for a new ballot link."
)

# " - Runoff Round 2" and friends, only at the very end of a title.
# The shipped (subject, html, text) of each leadership alert, used when the
# organization has no stored template of that type.
_ALERT_DEFAULTS = {
    EmailTemplateType.ELECTION_ROLLBACK: (
        DEFAULT_ELECTION_ROLLBACK_SUBJECT,
        DEFAULT_ELECTION_ROLLBACK_HTML,
        DEFAULT_ELECTION_ROLLBACK_TEXT,
    ),
    EmailTemplateType.ELECTION_DELETED: (
        DEFAULT_ELECTION_DELETED_SUBJECT,
        DEFAULT_ELECTION_DELETED_HTML,
        DEFAULT_ELECTION_DELETED_TEXT,
    ),
}


def _stage_label(status: str) -> str:
    """An election status as a reader would name it: ``"open"`` -> ``"Open"``."""
    return str(status or "").replace("_", " ").title()


_RUNOFF_SUFFIX = re.compile(r"\s*-\s*Runoff Round\s+\d+\s*$", re.IGNORECASE)


def _runoff_base_title(election) -> str:
    """The original race's title, with any runoff suffix stripped.

    A runoff is named after the round it follows, and that round may itself be
    a runoff — so naming round three after round two produced
    "Fire Chief Election - Runoff Round 1 - Runoff Round 2", growing by a
    clause per round. Every round in a chain should read as a round of the
    same election.
    """
    return _RUNOFF_SUFFIX.sub("", election.title or "").strip()


def _join_names(names: List[str]) -> str:
    """Join names as ``A and B`` / ``A, B and C`` for the runoff description."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def ballot_item_candidate_positions(item: Dict) -> Set[str]:
    """The ``Candidate.position`` values that belong to this ballot item.

    An item with its own "position" field claims exactly that value — this
    is also what new votes are stored/deduped under (see
    ``ElectionService.submit_ballot_with_token``). Items persisted without
    an explicit position (created before ballot items carried one, or via
    the admin candidate endpoint with no ``election.positions`` configured)
    are matched by their title *or* id instead — the same fallback the
    voting UI (``BallotVotingPage.tsx::getCandidatesForItem``) and
    ``ElectionService.check_voter_eligibility`` already rely on. Dropping
    this fallback here (matching only the item id) would silently empty
    the candidate list of every legacy candidate-selection ballot item on
    deploy — those ballots would render with no choices and be
    unsubmittable, even though the candidates and the item are otherwise
    unchanged.
    """
    item_position = item.get("position")
    if item_position:
        return {item_position}
    return {value for value in (item.get("title"), item.get("id")) if value}


def _dedup_position_key(
    item: Optional[Dict], effective_position: Optional[str]
) -> Optional[str]:
    """The position component fed into a vote's dedup hash (R-D5/ELEC-34).

    An item with its own explicit "position" field, or a plain positional
    candidate (``item`` is ``None``), is keyed by ``effective_position``
    unchanged — unambiguous either way. A *legacy* item (no explicit
    "position") is instead keyed by the item's own id: the one alias in
    ``ballot_item_candidate_positions`` that is stable and identical no
    matter which route computes it, unlike the title, which
    ``cast_vote_with_token`` used to hash directly via
    ``candidate.position``. Two tokens racing on the same legacy item
    through different routes now hash to the same value, so the database's
    UNIQUE constraint on ``vote_dedup_hash`` — the documented backstop for
    when a race bypasses the pre-insert duplicate check — actually catches
    the collision instead of silently accepting both (Codex round 7).

    This governs only the dedup hash, never the stored ``Vote.position``
    value itself (display, eligibility comparisons, and completion
    tracking all keep using ``effective_position``/the route's own
    convention) — the id is opaque and would make user-facing messages and
    per-position result grouping unreadable.
    """
    if item is not None and not item.get("position"):
        return item.get("id") or effective_position
    return effective_position


class VoteTarget(NamedTuple):
    """What ``_resolve_vote_target`` settled for one in-app or proxy vote."""

    candidate: Candidate
    effective_position: Optional[str]
    matching_item: Optional[Dict]
    position_label: Optional[str]


def _effective_voting_method(
    election: "Election", item: Optional[Dict]
) -> Optional[str]:
    """The voting method that actually governs one vote's dedup discriminator.

    A ballot item may override the election-level voting method
    (``BallotItemInput.voting_method`` — see ``submit_ballot_with_token``,
    which already resolves this override to decide which submission forms
    it accepts). Both vote-submission routes must resolve the SAME override
    when picking the dedup-hash discriminator (``_dedup_discriminator``), or
    an item overriding e.g. a ``simple_majority`` election to ``approval``
    hashes differently depending on which route cast the vote — one route
    keys off the item, the other off the raw election column — and the
    UNIQUE constraint on ``vote_dedup_hash`` stops being able to catch two
    routes racing on the same logical vote (Codex round 9, ELEC-37).
    Mirrors why ``_dedup_position_key`` exists for the position component.

    ``item=None`` (a plain positional candidate, or a caller that does not
    resolve a matching ballot item) falls back to the election's own
    method — unchanged behavior for those callers.
    """
    if item is not None:
        override = item.get("voting_method")
        if override:
            return override
    return election.voting_method


def _dedup_scoped_item_aliases(item: Dict, all_items: List[Dict]) -> Set[str]:
    """The alias subset of ``ballot_item_candidate_positions(item)`` that is
    safe to use when scanning *stored votes* for a prior vote on this item
    (ELEC-38).

    The schema enforces only unique item **ids** — nothing stops one item's
    title from equaling a different item's id (or explicit position
    override), so ``ballot_item_candidate_positions``' title/id fallback for
    a legacy item can, on that collision, also match a genuinely different
    item's votes. That broad match is what candidate lookups need (a real
    legacy candidate can only be found by title, and narrowing there would
    empty a legitimate item's candidate list — see
    ``ballot_item_candidate_positions``'s own docstring), but it is a false
    positive for duplicate-vote detection, which only has to decide whether
    THIS submission would be a re-vote. Under-matching there is safe: new
    votes for a legacy item are always hashed against the item's own id via
    ``_dedup_position_key``/the bulk route's canonical ``position`` value,
    never its title, so the database's ``vote_dedup_hash`` UNIQUE
    constraint still catches a genuine duplicate on this item even when an
    alias was dropped here to avoid colliding with a sibling item.

    An item's own id is never dropped — ids are unique per election
    (``unique_item_ids``), so it can never collide with anything. A
    fallback alias (the title, for a legacy item) is dropped only when some
    OTHER item in the same election already claims that exact string as its
    own id or explicit position override — that other item is the
    unambiguous owner of votes stored under it.
    """
    aliases = ballot_item_candidate_positions(item)
    if item.get("position"):
        # Explicit position — this item's one alias, never ambiguous.
        return aliases
    item_id = item.get("id")
    other_canonical_keys = {
        (other.get("position") or other.get("id"))
        for other in all_items
        if other.get("id") != item_id
    }
    return {
        alias
        for alias in aliases
        if alias == item_id or alias not in other_canonical_keys
    }


def _token_eligibility_error(
    voting_token: "VotingToken",
    election: "Election",
    effective_position: Optional[str],
    matching_item: Optional[Dict],
    *,
    ineligible_item_message: Optional[str] = None,
) -> Optional[str]:
    """Enforce a voting token's per-item and per-position snapshots for one
    candidate (R-1/R-D4/ELEC-29/ELEC-33).

    Shared by ``cast_vote_with_token`` (single-vote route) and
    ``submit_ballot_with_token`` (bulk route) so this collision-aware logic
    is defined once: a ballot item's position/title/id can legitimately
    collide with a plain ``election.positions`` entry (ELEC-29), so a
    candidate scoped to an item can *also* be a plain-positional candidate,
    and must clear both applicable eligibility snapshots rather than
    whichever one a caller happened to check. Before ELEC-33, the bulk
    route only checked ``eligible_item_ids`` and never applied this
    collision check at all, leaving it reachable through a crafted bulk
    request even after ELEC-29 closed it in the lookup and single-vote
    routes.

    Returns an error message if the token is not eligible, else ``None``.
    """
    if matching_item is not None:
        if voting_token.eligible_item_ids is not None and matching_item.get(
            "id"
        ) not in set(voting_token.eligible_item_ids):
            if ineligible_item_message is not None:
                return ineligible_item_message
            return (
                f"You are not eligible to vote for {effective_position}"
                if effective_position
                else "You are not eligible to vote in this election"
            )

    # Nothing in schema validation stops a plain `election.positions` entry
    # from equaling a ballot item's position/title/id (ELEC-29) — so a
    # candidate can legitimately belong to *both* namespaces at once.
    # Detecting that requires checking every alias the item can be known
    # by, not only whichever literal this particular vote resolved to
    # (`effective_position`): the bulk route resolves a legacy item's
    # position to its id (the storage/dedup convention), while the
    # collision is necessarily via the item's *title* — a random id is not
    # going to equal a plain position name. Using `effective_position`
    # alone here (ELEC-29's original check) missed that shape entirely,
    # which is exactly how ELEC-33 stayed open in the bulk route (Codex
    # round 7) after the single-vote route was fixed.
    item_aliases = (
        ballot_item_candidate_positions(matching_item)
        if matching_item is not None
        else set()
    )
    colliding_positions = (
        item_aliases & set(election.positions)
        if matching_item is not None and election.positions
        else set()
    )

    if matching_item is None or colliding_positions:
        # Either not scoped to any ballot item at all (a plain positional
        # candidate, or this election has no ballot items), or scoped to
        # both a ballot item AND a colliding plain position (ELEC-29) — in
        # which case the item check above is necessary but not sufficient,
        # and this candidate must also clear the send-time
        # position-eligibility snapshot (R-D4). NULL snapshot = legacy
        # token, or an election/position with no eligibility rules
        # configured — unrestricted (documented fail-open, time-bounded by
        # token expiry). This is deliberately *not* checked for an
        # item-scoped candidate with no collision: `eligible_positions` is
        # drawn from `election.positions` only, so applying it to a
        # ballot-item candidate whose position never appears in that list
        # would reject legitimate item votes outright.
        #
        # The value(s) checked against `eligible_positions` are the
        # colliding plain-position labels themselves when any exist — not
        # `effective_position`, which for a colliding legacy item in the
        # bulk route is the item id — falling back to `effective_position`
        # only for a genuinely plain (no matching_item) candidate.
        #
        # A legacy item's title *and* id can each separately collide with
        # a *different* configured plain position at once (schema allows
        # an id like "treasurer" alongside an unrelated title "Secretary",
        # both also present in `election.positions`). Which alias is "the"
        # position this vote is really for is inherently ambiguous — that
        # ambiguity is exactly why both are matched at all (see
        # `ballot_item_candidate_positions`) — so picking a single member
        # via `next(iter(colliding_positions))` checked an arbitrary one
        # (Python set iteration order depends on hash seeding) and let a
        # token eligible for only one of the two colliding positions vote
        # anyway, bypassing the other's restriction entirely (Codex round
        # 8). Failing closed — requiring eligibility for every colliding
        # label, not just one — closes that without guessing which alias
        # is "real".
        if voting_token.eligible_positions is not None:
            if colliding_positions:
                denied = sorted(
                    label
                    for label in colliding_positions
                    if label not in voting_token.eligible_positions
                )
            else:
                denied = (
                    [effective_position]
                    if effective_position not in voting_token.eligible_positions
                    else []
                )
            if denied:
                check_label = denied[0]
                return (
                    f"You are not eligible to vote for {check_label}"
                    if check_label
                    else "You are not eligible to vote in this election"
                )

    return None


def round_percentage(value: float) -> float:
    """The one rounding every percentage the module reports goes through.

    Turnout was printed as 9.5% / 10% / 9.52% on a single page because each
    site chose its own precision (W50-65). Two decimals is the contract the
    frontend renders as-is; a caller that wants fewer must not re-round.
    """
    return round(float(value), 2)


def _tier_benefits(user: Any, org: Any) -> dict:
    """The benefits of ``user``'s membership tier in ``org``'s settings.

    Empty when the department stores no tiers or the member's tier is not
    among them, so each caller's own default (eligible) applies.
    """
    tier_config = (org.settings or {}).get("membership_tiers", {}) if org else {}
    tiers = tier_config.get("tiers", []) if isinstance(tier_config, dict) else []
    member_tier_id = getattr(user, "membership_type", None) or "active"
    tier_def = next(
        (t for t in tiers if isinstance(t, dict) and t.get("id") == member_tier_id),
        None,
    )
    benefits = tier_def.get("benefits", {}) if tier_def else {}
    return benefits if isinstance(benefits, dict) else {}


# Domain label for the key fingerprint stored on each vote; distinct from the
# audit log's so the two fingerprints of one shared key do not match.
_VOTE_KEY_ID_LABEL = b"logbook:vote-signing-key-id:v1"


def vote_signing_key_id(key: str) -> str:
    """Return the fingerprint recorded on a vote signed with ``key``.

    A keyed digest of a fixed label, truncated: it identifies the key without
    revealing it, since recovering the key from it means breaking the HMAC.
    """
    return hmac.new(key.encode(), _VOTE_KEY_ID_LABEL, hashlib.sha256).hexdigest()[:16]


def office_ineligible_message(name: Optional[str]) -> str:
    return (
        f"{name or 'This member'}'s membership tier cannot hold elected office. "
        "An administrator can change that under Membership Tiers."
    )


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
            key: (
                value
                if isinstance(value := features.get(key, default), bool)
                else default
            )
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

    @staticmethod
    def _is_attested_vote(election_id: UUID):
        """SQL predicate excluding votes that belong to a pending paper batch."""
        pending_batch = select(ManualBallotBatch.id).where(
            ManualBallotBatch.id == Vote.manual_batch_id,
            ManualBallotBatch.election_id == str(election_id),
            ManualBallotBatch.status == "pending",
        )
        return ~pending_batch.exists()

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
        organization_id: Optional[str] = None,
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
            organization_id=organization_id,
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

    @staticmethod
    def _audit_voter(election: "Election", user_id: UUID) -> Optional[str]:
        """User to record on a voter-action audit event, or None.

        Same reasoning as ``_audit_ip``: an anonymous vote row stores only a
        salted voter hash, and ``close_election`` destroys the salt so the
        ballot can never be joined back to a member. An audit row naming the
        voter beside ``vote_id`` would undo that (``votes.candidate_id`` is one
        join away) and, being hash-chained, could never be scrubbed. Callers
        must stamp ``organization_id`` explicitly when this returns None —
        ``create_log_entry`` resolves the tenant from ``user_id``, and a row
        with neither drops out of the org-scoped audit views.
        """
        return None if election.anonymous_voting else str(user_id)

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
        *,
        accepted_only: bool = False,
    ) -> List[Candidate]:
        """List candidates for an election ordered by position."""
        query = select(Candidate).where(Candidate.election_id == str(election_id))
        if accepted_only:
            query = query.where(Candidate.accepted.is_(True))
        result = await self.db.execute(
            query.order_by(Candidate.position, Candidate.display_order)
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Role / eligibility helpers
    # ------------------------------------------------------------------

    async def _user_has_role_type(self, user: User, role_types: List[str]) -> bool:
        """
        Check if a user has any of the specified voter-type categories.

        Eligibility is determined primarily by the member's class and status
        (``member_class`` / ``member_status``), with a fallback to direct
        role-slug matching for custom/specific slugs.

        The built-in voter categories preserve their legacy election meaning.
        Status-based categories also require operational class; otherwise an
        administrative member with regular standing would gain access to
        ballots restricted to active/life members before the split.

        role_types can include:
        - "all" - everyone is eligible
        - "operational" - operational members in regular (active) standing
        - "administrative" - members whose class is administrative
        - "regular" - regular or life members (the non-probationary voting body)
        - "life" - life members only (membership_type "life")
        - "probationary" - probationary members (membership_type "probationary")
        - Specific role slugs like "chief", "president", etc.
        """
        if not role_types or "all" in role_types:
            return True

        from app.utils.membership import (
            MemberClass,
            MemberStatus,
            split_membership_type,
        )

        member_class = getattr(user, "member_class", None)
        member_status = getattr(user, "member_status", None)
        membership_type = getattr(user, "membership_type", None)
        live_class, live_status = split_membership_type(membership_type)

        # A live membership_type that is an org-configured custom tier
        # ("senior") splits to (None, None) — that is the important case,
        # not the fallback one. `_reconcile_membership` (models/user.py)
        # deliberately *preserves* member_class/member_status from before a
        # switch onto such a tier, because shift eligibility needs to keep
        # recognizing a member who still rides. That carryover must not
        # leak into election eligibility: a member moved onto a custom tier
        # is meant to match no built-in voter category (see
        # split_membership_type's docstring — "would widen the electorate
        # of any ballot restricted to either"), so the stale class/status
        # cached on the row is discarded here regardless of what shift
        # eligibility keeps it for.
        if membership_type and live_class is None and live_status is None:
            member_class, member_status = None, None
        elif not member_class or not member_status:
            # A row written before the split, or a caller passing a stub. The
            # legacy field still carries both facts, just fused.
            member_class, member_status = live_class, live_status
        # Deliberately not defaulted. Both stay None when the member's
        # membership_type is an org-configured tier id ("senior") rather than
        # one of the seven known values, and None matches no class and no
        # status — which is what such a member matched before. Defaulting here
        # would quietly enrol every custom tier in the operational regular
        # body. The role-slug fallback below still applies to them.
        member_class = (member_class or "").strip().lower()
        member_status = (member_status or "").strip().lower()

        # Preserve the voter-category contract from the legacy fused field.
        # Requiring both axes prevents administrative regulars and operational
        # prospective/retired members from receiving restricted ballot tokens.
        if "operational" in role_types:
            if (
                member_class == MemberClass.OPERATIONAL
                and member_status == MemberStatus.REGULAR
            ):
                return True

        if "administrative" in role_types:
            if member_class == MemberClass.ADMINISTRATIVE:
                return True

        if "social" in role_types:
            if member_class == MemberClass.SOCIAL:
                return True

        if "regular" in role_types:
            if member_class == MemberClass.OPERATIONAL and member_status in (
                MemberStatus.REGULAR,
                MemberStatus.LIFE,
            ):
                return True

        if "life" in role_types:
            if (
                member_class == MemberClass.OPERATIONAL
                and member_status == MemberStatus.LIFE
            ):
                return True

        if "probationary" in role_types:
            if (
                member_class == MemberClass.OPERATIONAL
                and member_status == MemberStatus.PROBATIONARY
            ):
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

    async def _member_voting_gates(
        self,
        user: "User",
        election: Election,
        organization_id: str,
        organization: Optional["Organization"] = None,
    ) -> Tuple[bool, bool]:
        """The two universal eligibility gates a voter must clear before ANY
        scope-specific rule (per-item ``eligible_voter_types``, per-position
        ``voter_types``) is even considered.

        Returns ``(tier_voting_eligible, has_override)``:

        - ``tier_voting_eligible``: False when the member's membership tier
          has ``benefits.voting_eligible == False`` (e.g. the shipped
          "probationary" tier) — a global ban that applies regardless of
          which scope (ballot item or plain position) is being evaluated.
        - ``has_override``: True when this election's ``voter_overrides``
          names this user — grants blanket eligibility for every scope,
          bypassing per-item/per-position voter-type rules entirely.

        Both ``annotate_ballot_items_for_user`` (item eligibility) and the
        plain-position eligibility snapshot in ``send_ballot_emails`` apply
        these identically. Before this helper existed, the item path
        computed both gates inline and the newer positional path (ELEC-26)
        computed neither — a globally banned member could still receive a
        live positional credential, and an overridden member's override
        didn't reach their positional votes (Codex round 6, ELEC-30/31).
        """
        if organization:
            org = organization
        else:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
        tier_voting_eligible = _tier_benefits(user, org).get("voting_eligible", True)

        has_override = bool(
            election.voter_overrides
            and any(o.get("user_id") == str(user.id) for o in election.voter_overrides)
        )
        return tier_voting_eligible, has_override

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

        # Human-readable tier name for the ineligibility reason below. The
        # voting_eligible/override booleans themselves come from the shared
        # gate helper so this path can never drift from the positional one.
        tier_name = member_tier_id
        if tier_def:
            tier_name = tier_def.get("name", member_tier_id)
        tier_voting_eligible, has_override = await self._member_voting_gates(
            user, election, organization_id, org
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

    @staticmethod
    def _restricted_voter_ids(election: Election) -> Optional[Set[str]]:
        """The members a restricted-list election admits, or None if it has
        no list.

        A secretary voter override extends the list (W50-13, owner decision
        2026-10-05): the roster reads "Override" and counts the member as
        eligible, so the vote, the ballot mailer, the non-voter list and
        the turnout denominator must all agree that the member is admitted.
        Before this the override was recorded and shown while every vote path
        still refused the member as "not on the list". An empty stored list
        is read as "no list", the one meaning every reader agrees on (W50-41).
        """
        if not election.eligible_voters:
            return None
        admitted = {str(v) for v in election.eligible_voters}
        admitted |= {
            str(o["user_id"])
            for o in (election.voter_overrides or [])
            if o.get("user_id")
        }
        return admitted

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

        # Check if user is in eligible voters list (if specified). A voter
        # override extends the list — see _restricted_voter_ids.
        restricted_ids = self._restricted_voter_ids(election)
        if restricted_ids is not None:
            if str(user_id) not in restricted_ids:
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
            # A legacy item (no explicit "position") keys its candidates by
            # title *or* id — the same aliases every other reader resolves
            # through ballot_item_candidate_positions. Matching title alone
            # left an id-keyed vote unmatched here, so the item's voter-type
            # and attendance rules were never evaluated (W50 S02).
            matching_items = [
                item
                for item in election.ballot_items
                if position in ballot_item_candidate_positions(item)
                or item.get("title") == position
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
        vote_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(self._voter_identity_filter(election, user_id))
            .where(Vote.is_test.is_(False))
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

    async def _resolve_vote_target(
        self,
        election: Election,
        candidate_id: UUID,
        position: Optional[str],
    ) -> Tuple[Optional[VoteTarget], Optional[str]]:
        """Resolve what an in-app or proxy vote is for, the one way.

        The signed-in ballot omits the position field for every ballot-item
        election, and an omitted position used to skip every per-item
        voter-type and attendance rule (W50 S02) — so the candidate is
        resolved first and its own position is the fallback. The ballot
        item the candidate belongs to is what the dedup hash keys a legacy
        item by (see ``_dedup_position_key``), and the same resolution
        gives the proxy route the same hash as the member's own vote for
        the same choice; two definitions let a proxy ballot with no
        position slip past the in-app ballot's duplicate check (W50 S12).
        The caller must already hold the election row lock — every read
        that follows this one is a duplicate check.
        """
        candidate_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.id == str(candidate_id))
            .where(Candidate.election_id == str(election.id))
        )
        candidate = candidate_result.scalar_one_or_none()
        if not candidate:
            return None, "Candidate not found"
        if not candidate.accepted and not candidate.is_write_in:
            return None, "Candidate has not accepted nomination"

        # A position that names the candidate's item by another alias (its
        # title) still resolves to the item, so the eligibility gate sees it;
        # the caller checks the exact match after that gate, so an
        # ineligible member is told they are ineligible, not that the
        # candidate is elsewhere.
        effective_position = position or candidate.position
        matching_item = (
            next(
                (
                    item
                    for item in election.ballot_items
                    if effective_position is not None
                    and effective_position in ballot_item_candidate_positions(item)
                ),
                None,
            )
            if election.ballot_items
            else None
        )
        # A legacy item keys its candidates by its opaque id; a message that
        # names the id means nothing to the voter, so it shows the title.
        position_label = effective_position
        if matching_item is not None and effective_position == matching_item.get("id"):
            position_label = matching_item.get("title") or effective_position
        return (
            VoteTarget(candidate, effective_position, matching_item, position_label),
            None,
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
        # Serialize vote validation and insertion for this election. The
        # method-aware dedup hash permits distinct candidates/ranks, so its
        # unique constraint cannot enforce per-voter limits by itself. The
        # lock is taken BEFORE the eligibility/duplicate reads: under MySQL
        # REPEATABLE READ a plain SELECT reads the transaction's snapshot,
        # so reads issued before the lock could never observe a competing
        # voter's commit even after the lock was granted — two concurrent
        # submissions both passed the duplicate check.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, "Election not found"

        target, error = await self._resolve_vote_target(
            election, candidate_id, position
        )
        if not target:
            return None, error
        effective_position = target.effective_position
        matching_item = target.matching_item

        # Check eligibility. This gate is authoritative: check_voter_eligibility
        # enforces election status, the open/close window, restricted
        # eligible-voter lists, membership-tier/attendance rules, and — because
        # position is passed — per-position and per-ballot-item voter-type and
        # attendance restrictions. Skipping it would let any authenticated
        # member vote in a draft/closed election, outside the voting window,
        # without being on the eligible list, or on items restricted to other
        # member classes.
        eligibility = await self.check_voter_eligibility(
            user_id, election_id, organization_id, position=effective_position
        )
        if not eligibility.is_eligible:
            return None, eligibility.reason or "You are not eligible to vote"

        if position and target.candidate.position != position:
            return None, "Candidate is not running for this position"

        limit_error = await self._validate_vote_limits(
            election,
            user_id,
            candidate_id,
            effective_position,
            vote_rank,
            position_label=target.position_label,
        )
        if limit_error:
            return None, limit_error

        # Hash the voter in every election, named ones included: the emailed
        # ballot link stores only this hash, and the dedup hash must be built
        # from the same input on both paths or the UNIQUE constraint can never
        # fire across them (see _voter_identity_filter).
        voter_hash = self._generate_voter_hash(
            user_id, election_id, election.voter_anonymity_salt or ""
        )
        voter_id_or_hash = voter_hash

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
            position=effective_position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc).replace(microsecond=0),
            # MySQL-compatible dedup hash for DB-level double-vote prevention
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election_id,
                voter_id_or_hash,
                _dedup_position_key(matching_item, effective_position),
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank
                ),
            ),
        )

        # Sign the vote for tampering detection
        self._apply_vote_signature(vote)

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

        # Read off the election BEFORE the commit attempt: a failed commit
        # rolls the session back, which expires every loaded instance, and
        # touching ``election`` in the except branch below then lazy-loads
        # under asyncio and raises MissingGreenlet — the "duplicate" answer
        # became a 500 instead of the 400 the caller expects (W50-6).
        anonymous = election.anonymous_voting
        audit_user = self._audit_voter(election, user_id)
        audit_ip = self._audit_ip(election, ip_address)
        election_org_id = str(election.organization_id)

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
                    "position": effective_position,
                    "anonymous": election.anonymous_voting,
                    "bulk": True,
                },
                user_id=self._audit_voter(election, user_id),
                ip_address=self._audit_ip(election, ip_address),
                organization_id=str(election.organization_id),
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
                f"election={election_id} position={effective_position} anonymous={anonymous}"
            )
            await self._audit(
                "vote_double_attempt",
                {
                    "election_id": str(election_id),
                    "position": effective_position,
                    "anonymous": anonymous,
                },
                severity="warning",
                user_id=audit_user,
                ip_address=audit_ip,
                organization_id=election_org_id,
            )
            if effective_position:
                return (
                    None,
                    "Database integrity check: You have already voted for "
                    f"{target.position_label}",
                )
            return (
                None,
                "Database integrity check: You have already voted in this election",
            )

        # Audit & log the successful vote
        logger.info(
            f"Vote cast | election={election_id} position={effective_position} "
            f"anonymous={election.anonymous_voting} vote_id={vote.id}"
        )
        await self._audit(
            "vote_cast",
            {
                "election_id": str(election_id),
                "vote_id": str(vote.id),
                "position": effective_position,
                "anonymous": election.anonymous_voting,
            },
            user_id=self._audit_voter(election, user_id),
            ip_address=self._audit_ip(election, ip_address),
            organization_id=str(election.organization_id),
        )

        return vote, None

    async def _validate_vote_limits(
        self,
        election: Election,
        user_id: UUID,
        candidate_id: UUID,
        position: Optional[str],
        vote_rank: Optional[int],
        voter_label: str = "You have",
        position_label: Optional[str] = None,
    ) -> Optional[str]:
        """Rank validation and method-aware duplicate/limit rules, shared by
        ``cast_vote`` and ``cast_proxy_vote`` so a proxy ballot is the same
        ballot as the member's own (W50 S12). Returns an error message, or
        None when the vote may be recorded. The caller must already hold the
        election row lock. ``position_label`` is what a message calls the
        position (a legacy item's title rather than its id); the comparison
        itself stays on ``position``.
        """
        if position_label is None:
            position_label = position
        if election.voting_method == "ranked_choice" and vote_rank is None:
            return "vote_rank is required for ranked-choice voting"
        if election.voting_method != "ranked_choice" and vote_rank is not None:
            return "vote_rank is not applicable for this voting method"

        # Approval voting records one vote per approved candidate and ranked
        # choice one vote per rank, so a blanket "already voted for this
        # position" rule would reject every legitimate second vote
        # (module-audit ELEC-3). This must be a locking read: the
        # transaction's snapshot may predate the election lock (the auth
        # dependency reads first), and a snapshot read here would miss a
        # competing voter's just-committed rows.
        existing_votes = await self._get_user_votes(
            user_id, election.id, election, for_update=True
        )
        position_votes = [v for v in existing_votes if v.position == position]

        if election.voting_method == "ranked_choice":
            if any(v.vote_rank == vote_rank for v in position_votes):
                return f"{voter_label} already cast a rank-{vote_rank} vote" + (
                    f" for {position_label}" if position else ""
                )
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return f"{voter_label} already ranked this candidate"
        elif election.voting_method == "approval":
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return f"{voter_label} already voted for this candidate"
        else:
            max_votes = election.max_votes_per_position or 1
            if any(str(v.candidate_id) == str(candidate_id) for v in position_votes):
                return f"{voter_label} already voted for this candidate"
            if len(position_votes) >= max_votes:
                if position:
                    if max_votes == 1:
                        return f"{voter_label} already voted for {position_label}"
                    return f"Maximum votes for {position_label} reached"
                if max_votes == 1:
                    return f"{voter_label} already voted in this election"
                return "Maximum votes for this election reached"
        return None

    async def _get_user_votes(
        self,
        user_id: UUID,
        election_id: UUID,
        election: Optional[Election] = None,
        for_update: bool = False,
    ) -> List[Vote]:
        """Get all active (non-deleted) votes by a user in an election (handles anonymous voting).

        ``for_update`` makes this a locking read. Under MySQL REPEATABLE READ
        a plain SELECT reads the transaction's snapshot, which can predate a
        competing voter's commit even when the caller already holds the
        election row lock — duplicate-vote checks need committed current
        rows, not the snapshot. Callers must hold the election lock first so
        lock ordering stays election → votes.
        """
        if election is not None:
            identity = self._voter_identity_filter(election, user_id)
        else:
            identity = Vote.voter_id == str(user_id)
        query = (
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(identity)
            .where(Vote.is_test.is_(False))
            .where(Vote.deleted_at.is_(None))
        )
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        return result.scalars().all()

    def _voter_identity_filter(self, election: Election, user_id: UUID):
        """The one definition of "rows this member cast in this election".

        Every vote row carries ``voter_hash`` — the in-app path, the proxy
        path and the emailed-link path all derive it the same way — so the
        hash is the identity the two conventions share. ``voter_id`` is set
        only in named elections, and only by the in-app and proxy paths: a
        link vote stores the hash alone, and rows written before every path
        hashed the voter carry the id alone. Keying a named election on
        ``voter_id`` by itself let a member vote once in the app and once by
        link, each path blind to the other's rows, so the named branch
        matches either column. ``check_voter_eligibility``, ``_get_user_votes``
        and ``has_user_voted`` all read through this rather than each
        re-deriving the rule.

        The identity alone is not "has this member voted": a test ballot
        (``send-test-ballot``) is keyed to the very same hash and stored
        ``is_test=True``, and it counts for nothing — so each of those three
        callers also excludes ``is_test`` rows, the way every results reader
        does. Only the token route matches ``is_test`` against the token
        instead, so a manager cannot double-cast a *test* ballot either.
        """
        voter_hash = self._generate_voter_hash(
            user_id,
            election_id=UUID(str(election.id)),
            salt=election.voter_anonymity_salt or "",
        )
        if election.anonymous_voting:
            return Vote.voter_hash == voter_hash
        return or_(Vote.voter_id == str(user_id), Vote.voter_hash == voter_hash)

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

    def _token_voter_is_on_frozen_roll(
        self, election: Election, voting_token: VotingToken
    ) -> bool:
        """Return whether an anonymous token represents a frozen-roll voter.

        Tokens retain only the voter's keyed hash, so compare it with hashes
        derived from the frozen roster and any secretary overrides.  A NULL
        snapshot preserves the documented live-roster behavior for legacy
        elections.
        """
        snapshot = getattr(election, "eligible_roster_snapshot", None)
        if snapshot is None:
            return True

        permitted_ids = {str(user_id) for user_id in snapshot}
        permitted_ids.update(
            str(override["user_id"])
            for override in (election.voter_overrides or [])
            if override.get("user_id")
        )
        salt = election.voter_anonymity_salt or ""
        return any(
            hmac.compare_digest(
                voting_token.voter_hash,
                self._generate_voter_hash(user_id, election.id, salt),
            )
            for user_id in permitted_ids
        )

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
        election: Election,
        candidate_id,
        vote_rank: Optional[int],
        item: Optional[Dict] = None,
    ) -> str:
        """Pick the dedup-hash discriminator for this vote's *effective*
        voting method (ELEC-37) — the matched ballot item's override if it
        has one, else the election's. ``item`` defaults to ``None`` (the
        election-only resolution) for callers that don't yet resolve a
        matching ballot item (``cast_vote``, ``cast_proxy_vote``); pass the
        matched item wherever one is available so an item-level override is
        honored consistently — see ``_effective_voting_method``.

        ``max_votes_per_position`` has no item-level override in the
        schema, so it is always read from the election regardless of
        ``item``.
        """
        method = _effective_voting_method(election, item)
        if method == "ranked_choice":
            return f"rank:{vote_rank}"
        if method == "approval" or (election.max_votes_per_position or 1) > 1:
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

    @staticmethod
    def _legacy_vote_signing_key(current_key: str) -> Optional[str]:
        """SECRET_KEY, when a distinct dedicated VOTE_SIGNING_KEY is set.

        Before 2026-10-06 the Unraid compose files did not pass
        VOTE_SIGNING_KEY through, so installs that set it in ``.env`` signed
        every ballot with the SECRET_KEY fallback. Those ballots must keep
        verifying once the dedicated key arrives (owner decision,
        2026-10-06); verify_vote_integrity bounds how far.
        """
        dedicated = settings.VOTE_SIGNING_KEY
        secret = settings.SECRET_KEY
        if not dedicated or not secret or secret in (dedicated, current_key):
            return None
        return secret

    def _apply_vote_signature(self, vote: Vote) -> None:
        """Sign ``vote`` and record which key signed it."""
        signing_key = self._get_vote_signing_key()
        vote.vote_signature = self._sign_vote(vote, signing_key)
        vote.signing_key_id = vote_signing_key_id(signing_key)

    async def _vote_key_cutover(self, current_key_id: str) -> Optional[datetime]:
        """When the first vote recording the dedicated key was cast.

        Deliberately not scoped to one organization: the signing key is a
        deployment setting, so the moment it took effect is a fact about the
        deployment. Only this timestamp leaves the query, and an election
        created after the key arrived then cannot hold a SECRET_KEY ballot
        merely because none of its own ballots predate it.
        """
        cutover = (
            await self.db.execute(
                select(func.min(Vote.voted_at)).where(
                    Vote.signing_key_id == current_key_id
                )
            )
        ).scalar()
        return self._ensure_utc(cutover)

    def _sign_vote(self, vote: Vote, signing_key: Optional[str] = None) -> str:
        """Generate a cryptographic signature for a vote to detect tampering.

        The signature covers all immutable vote fields so any modification
        (changing candidate, deleting and re-inserting, altering rank, or
        converting a proxy vote) will produce a different signature.
        ``signing_key`` overrides the current key; verification passes the
        key a vote's ``signing_key_id`` names.
        """
        if signing_key is None:
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
        self,
        election_id: UUID,
        organization_id: UUID,
        *,
        audit: bool = True,
    ) -> Dict:
        """Verify the cryptographic integrity of all votes in an election.

        Returns a summary with total votes checked, valid count, and any
        tampered vote IDs. ``total_votes`` is every signed row in the chain —
        test ballots and pending paper batches included, because they are
        chained too — and is broken down into ``counted_votes``,
        ``pending_paper_votes`` and ``test_votes`` so a reader can reconcile
        it against the tally, which counts only the first (W50-65).

        ``audit=False`` runs the check without writing a
        ``vote_integrity_check`` audit row: the forensics report embeds this
        check on every read, and a critical row per page load buried the
        one the officer's Run Check wrote.
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
        test_votes = sum(1 for v in all_votes if v.is_test)
        real_votes = [v for v in all_votes if not v.is_test]
        counted_votes = len(await self._exclude_unattested(election_id, real_votes))
        pending_paper_votes = len(real_votes) - counted_votes
        valid = 0
        tampered = []
        unsigned = 0

        current_key = self._get_vote_signing_key()
        current_id = vote_signing_key_id(current_key)
        legacy_key = self._legacy_vote_signing_key(current_key)
        legacy_id = vote_signing_key_id(legacy_key) if legacy_key else None
        # SECRET_KEY verifies a ballot only if it was cast no later than the
        # first ballot signed with the dedicated key, so it cannot become a
        # permanent second key. voted_at is inside the signature, so moving
        # it earlier needs a key that signs. Looked up only when needed.
        cutover: Optional[datetime] = None
        cutover_loaded = False
        legacy_verified = 0

        for vote in all_votes:
            if not vote.vote_signature:
                unsigned += 1
                continue
            recorded = getattr(vote, "signing_key_id", None)
            if recorded is not None and recorded not in (current_id, legacy_id):
                # Signed with a key that is no longer configured.
                tampered.append(str(vote.id))
                continue
            if recorded in (None, current_id) and hmac.compare_digest(
                vote.vote_signature, self._sign_vote(vote, current_key)
            ):
                valid += 1
                continue
            if legacy_key is None or recorded == current_id:
                tampered.append(str(vote.id))
                continue
            if not hmac.compare_digest(
                vote.vote_signature, self._sign_vote(vote, legacy_key)
            ):
                tampered.append(str(vote.id))
                continue
            if not cutover_loaded:
                cutover = await self._vote_key_cutover(current_id)
                cutover_loaded = True
            voted_at = self._ensure_utc(vote.voted_at)
            if cutover is not None and (voted_at is None or voted_at > cutover):
                tampered.append(str(vote.id))
                continue
            valid += 1
            legacy_verified += 1

        if legacy_verified:
            logger.warning(
                f"Vote integrity | election={election_id}: {legacy_verified} "
                "ballots verified with SECRET_KEY, the fallback that signed them "
                "before VOTE_SIGNING_KEY reached the backend. They are accepted "
                "only up to the first ballot signed with VOTE_SIGNING_KEY; "
                "rotating SECRET_KEY will make them unverifiable."
            )

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

        if audit:
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
            "counted_votes": counted_votes,
            "pending_paper_votes": pending_paper_votes,
            "test_votes": test_votes,
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
        election_id: Optional[UUID] = None,
    ) -> Optional[Vote]:
        """Soft-delete a vote with audit trail instead of hard-deleting.

        ``election_id`` is the election the caller acted on; a vote that
        lives in another election is not found rather than voided under the
        wrong URL, so the audit trail matches the screen the officer used.
        """
        query = (
            select(Vote)
            .join(Election, Vote.election_id == Election.id)
            .where(Vote.id == str(vote_id))
            .where(Vote.deleted_at.is_(None))
        )
        if organization_id:
            query = query.where(Election.organization_id == str(organization_id))
        if election_id:
            query = query.where(Vote.election_id == str(election_id))
        result = await self.db.execute(query)
        vote = result.scalar_one_or_none()
        if not vote:
            return None

        vote.deleted_at = datetime.now(timezone.utc)
        vote.deleted_by = str(deleted_by)
        vote.deletion_reason = reason
        # The UNIQUE dedup hash exists to stop a second ballot from the same
        # voter. A voided ballot is not a ballot, so its hash must not keep
        # blocking the replacement vote the officer voided it to allow
        # (W50-6). The signature and chain hash do not cover this column, so
        # clearing it leaves integrity verification intact.
        vote.vote_dedup_hash = None
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

        # 1. Vote integrity. Not audited here: this report is read on every
        # visit to the panel, and a `vote_integrity_check` row per read (at
        # critical severity after a sanctioned void) drowned the one row the
        # officer's own Run Check wrote (W50-65).
        integrity = await self.verify_vote_integrity(
            election_id, organization_id, audit=False
        )

        # 2. Soft-deleted votes
        deleted_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.isnot(None))
        )
        deleted_votes = deleted_result.scalars().all()

        # W50-2: on an anonymous ballot the voided vote's choice must not be
        # reported. The audit log pairs vote_id with the officer who voided it
        # and, on rows written before ``_audit_voter`` existed, with the voter
        # who cast it -- so a candidate_id beside that vote_id would name a
        # voter's choice in two reads. Anonymous elections report the void
        # (that it happened, when, why) without the choice.
        reveal_choice = not election.anonymous_voting
        deleted_records = [
            {
                "vote_id": str(v.id),
                "candidate_id": str(v.candidate_id) if reveal_choice else None,
                "position": v.position,
                "deleted_at": v.deleted_at.isoformat() if v.deleted_at else None,
                "deleted_by": v.deleted_by,
                "deletion_reason": v.deletion_reason,
                # A voided paper batch voids one row per tallied ballot; the
                # batch id lets the panel report it as one batch rather than
                # as N "voided votes" (W50-65).
                "is_manual": bool(v.is_manual),
                "manual_batch_id": v.manual_batch_id,
            }
            for v in deleted_votes
        ]
        voided_paper_batches = {
            v.manual_batch_id for v in deleted_votes if v.manual_batch_id
        }

        # 3. Voting token access logs
        token_result = await self.db.execute(
            select(VotingToken).where(VotingToken.election_id == str(election_id))
        )
        tokens = token_result.scalars().all()

        # Issued = used + superseded + expired + live. "Unused" alone read a
        # reminder's retired links as ballots still out (W50-65).
        now_utc = datetime.now(timezone.utc)
        total_used = sum(1 for t in tokens if t.used)
        total_superseded = sum(
            1 for t in tokens if not t.used and t.superseded_at is not None
        )
        total_expired = sum(
            1
            for t in tokens
            if not t.used
            and t.superseded_at is None
            and t.expires_at is not None
            and self._ensure_utc(t.expires_at) <= now_utc
        )
        total_live = len(tokens) - total_used - total_superseded - total_expired

        token_records = [
            {
                "token_id": str(t.id),
                "used": t.used,
                "used_at": t.used_at.isoformat() if t.used_at else None,
                "superseded_at": (
                    t.superseded_at.isoformat() if t.superseded_at else None
                ),
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
                # `AuditLog.id` is a BigInteger; every id on this response —
                # and in the frontend's `ForensicsReport` type — is a string.
                # Passing the raw int failed response validation, so the whole
                # forensics report 500'd for any election with an audit trail,
                # which is every election that has ever been touched.
                "id": str(entry.id),
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

        # 6. Voting timeline (votes per hour), in the department's hours: a
        # reviewer reading "02:00" against the meeting's 10 PM close would
        # otherwise see votes cast after it.
        org_tz = await resolve_scheduling_timezone(self.db, organization_id)
        voting_timeline: Dict[str, int] = {}
        for v in active_votes:
            hour_key = (
                to_local(v.voted_at, org_tz).strftime("%Y-%m-%d %H:00")
                if v.voted_at
                else "unknown"
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
                "paper_batch_count": len(voided_paper_batches),
                "records": deleted_records,
            },
            "rollback_history": election.rollback_history or [],
            "voting_tokens": {
                "total_issued": len(token_records),
                "total_used": total_used,
                "total_superseded": total_superseded,
                "total_expired": total_expired,
                "total_live": total_live,
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
            "voting_timeline_timezone": getattr(org_tz, "key", None) or str(org_tz),
        }

    async def get_vote_totals(
        self, election: Election, organization_id: UUID
    ) -> Tuple[int, int, float]:
        """Counted votes, voters and turnout for one election.

        The cheap summary the detail response needs. `ElectionResponse`
        declares `total_votes`, `total_voters` and `voter_turnout_percentage`
        and the detail endpoint validated straight off the ORM row, which has
        no such columns — so all three came back null on every fetch and the
        Publish Results panel, which reads them, said "No votes cast yet" over
        a closed election with a full ballot box.

        Counts what results count: test votes, soft-deleted votes and
        unattested paper batches are all excluded, so this cannot disagree
        with the tally on the same page.
        """
        votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election.id))
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test.is_(False))
        )
        all_votes = await self._exclude_unattested(
            UUID(str(election.id)), votes_result.scalars().all()
        )
        voters = self._count_ballots_cast(
            election,
            all_votes,
            await self._recorded_paper_ballot_counts(UUID(str(election.id))),
        )
        eligible = await self._count_eligible_voters(election, organization_id)
        turnout = (voters / eligible * 100) if eligible > 0 else 0.0
        return len(all_votes), voters, round_percentage(turnout)

    @staticmethod
    def _count_ballots_cast(
        election: Election,
        all_votes: List[Vote],
        recorded_ballots: Optional[Dict[str, int]] = None,
    ) -> int:
        """How many voters this election's ballots represent.

        Electronic votes are deduplicated by voter: one member voting for
        three positions is one voter, not three.

        A paper ballot cannot be deduplicated that way, because it carries no
        voter identity at all — the recording officer attests a count, not a
        roster. Counted by identity alone an in-room election reported **zero
        voters** however full the box was, and that was not just a wrong
        turnout figure: a percentage quorum then failed for every paper
        election, which clears every winner and stamps the result "advisory
        only". A department that votes on paper, which is most volunteer
        departments, never saw a winner declared.

        A physical ballot can select multiple candidates in one position for
        approval, ranked-choice, and other multi-vote elections. Since paper
        tallies do not retain ballot-level groupings, use the largest candidate
        tally as the conservative number of represented paper voters in those
        elections — a lower bound (ten approval ballots split 5/5 across two
        candidates count as five voters), which understates turnout but cannot
        certify a quorum that was never met. Single-choice elections can
        safely use the largest summed position tally.

        When the recording officer attested the physical ballot count for a
        batch (``recorded_ballots``, keyed by batch id), that exact count is
        preferred over the estimate — see the inline note for how counts from
        several batches combine conservatively.
        """
        # A link vote in a named election carries the hash alone, so the id
        # by itself would drop that voter from turnout.
        identified = {
            v.voter_hash or v.voter_id for v in all_votes if v.voter_hash or v.voter_id
        }

        manual_by_position: Dict[Optional[str], int] = {}
        manual_by_candidate: Dict[Tuple[Optional[str], Optional[str]], int] = {}
        for vote in all_votes:
            if getattr(vote, "is_manual", False):
                manual_by_position[vote.position] = (
                    manual_by_position.get(vote.position, 0) + 1
                )
                key = (vote.position, vote.candidate_id)
                manual_by_candidate[key] = manual_by_candidate.get(key, 0) + 1
        # Multi-vote is a property of the ballot, not just the election row:
        # ballot items may override the election-level voting method (the
        # same resolution submit_token_ballot applies when accepting votes).
        # If ANY item is effectively multi-vote, position sums would count
        # one paper ballot once per selection, so only the per-candidate
        # tally is a safe per-voter bound.
        election_method = getattr(election, "voting_method", "simple_majority")
        effective_methods = {election_method}
        for item in getattr(election, "ballot_items", None) or []:
            if isinstance(item, dict):
                effective_methods.add(item.get("voting_method") or election_method)
        is_single_choice = (
            effective_methods.issubset({"simple_majority", "supermajority"})
            and getattr(election, "max_votes_per_position", 1) == 1
        )
        manual_counts = manual_by_position if is_single_choice else manual_by_candidate
        paper_ballots = max(manual_counts.values()) if manual_counts else 0

        # Prefer counts the recording officer attested (ManualBallotBatch.
        # ballots_cast) over the tally-derived estimate. Each recorded count
        # is exact for its own stack, but two batches may or may not be the
        # same physical ballots. In a single-choice election they combine per
        # position:
        #
        #   sum ballots_cast over the batches that recorded votes for a
        #   position, then take the max across positions.
        #
        # A single-choice physical ballot marks any GIVEN position at most
        # once, so two such batches that both hold votes for the same position
        # cannot be the same ballots — their attested counts add. In a
        # multi-vote election, however, one stack may be entered in separate
        # per-candidate batches for the same position. Without ballot-level
        # grouping, only the largest attested batch is then a safe turnout
        # lower bound. This can understate a genuinely split box, but cannot
        # inflate turnout and certify a quorum that was not met.
        #
        # Votes with no position share the None bucket, exactly as the
        # estimate above buckets them, so an unpositioned batch is compared
        # against its peers rather than silently merged into every position.
        # Only batches whose votes are present in all_votes count, so
        # attestation/void filtering applied upstream carries over, and a
        # batch with no attested count contributes nothing rather than a
        # zero that would drag the total under the estimate.
        if recorded_ballots:
            positions_by_batch: Dict[str, Set[Optional[str]]] = {}
            for vote in all_votes:
                if not getattr(vote, "is_manual", False):
                    continue
                batch_id = getattr(vote, "manual_batch_id", None)
                if batch_id in recorded_ballots:
                    positions_by_batch.setdefault(batch_id, set()).add(vote.position)

            if is_single_choice:
                recorded_by_position: Dict[Optional[str], int] = {}
                for batch_id, positions in positions_by_batch.items():
                    for position in positions:
                        recorded_by_position[position] = (
                            recorded_by_position.get(position, 0)
                            + recorded_ballots[batch_id]
                        )
                if recorded_by_position:
                    paper_ballots = max(
                        paper_ballots, max(recorded_by_position.values())
                    )
            elif positions_by_batch:
                paper_ballots = max(
                    paper_ballots,
                    max(recorded_ballots[batch_id] for batch_id in positions_by_batch),
                )

        return len(identified) + paper_ballots

    async def _recorded_paper_ballot_counts(self, election_id: UUID) -> Dict[str, int]:
        """ballots_cast by batch id, for batches where the officer recorded
        the physical ballot count (see _count_ballots_cast)."""
        result = await self.db.execute(
            select(ManualBallotBatch.id, ManualBallotBatch.ballots_cast)
            .where(ManualBallotBatch.election_id == str(election_id))
            .where(ManualBallotBatch.ballots_cast.is_not(None))
        )
        return {batch_id: count for batch_id, count in result.all()}

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

        restricted_ids = self._restricted_voter_ids(election)
        if restricted_ids is not None:
            return len(restricted_ids)

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

        SECURITY CRITICAL: Results are only visible once voting has ended.

        Before the election closes, use get_election_stats() to view:
        - Number of issued ballots (total_eligible_voters)
        - Number of received ballots (total_votes_cast)

        Results visibility rules:
        1. Election status is CLOSED — voting has ended, whether at the
           scheduled end or early, by an officer
        2. OR results_visible_immediately flag is True (override for instant results)

        A CLOSED election accepts no votes on any path, so its tally is final
        and revealing it cannot steer a vote. The scheduled end date used to
        be a second condition, which left an election closed early at the
        meeting refused to everyone — the officer who closed it included —
        until a date days later, while the report mail, the certified PDF and
        the runoff check already carried the same numbers (W50-10, W50-22;
        owner decision 2026-10-05: an early close releases results exactly
        as the scheduled end would have).
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

        # SECURITY: results are only visible once voting has ended (CLOSED);
        # see the docstring for why the scheduled end is not also required.
        can_view = (
            election.status == ElectionStatus.CLOSED
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

        # Voters, not votes — and paper ballots count. See _count_ballots_cast.
        recorded_ballots = await self._recorded_paper_ballot_counts(
            UUID(str(election.id))
        )
        unique_voters = self._count_ballots_cast(election, all_votes, recorded_ballots)

        # Calculate turnout
        voter_turnout = (
            (unique_voters / total_eligible * 100) if total_eligible > 0 else 0
        )

        # The ballot item a position's candidates belong to, so the tally
        # applies the item's victory-condition override (W50 S04). Matched
        # by the same alias set every other item/position lookup uses.
        def _item_for_position(position: Optional[str]) -> Optional[Dict]:
            if not position:
                return None
            return next(
                (
                    i
                    for i in election.ballot_items or []
                    if position in ballot_item_candidate_positions(i)
                ),
                None,
            )

        # Calculate results by position
        results_by_position = []
        if election.positions:
            for position in election.positions:
                position_votes = [v for v in all_votes if v.position == position]
                position_candidates = [c for c in candidates if c.position == position]

                candidate_results = await self._calculate_candidate_results(
                    position_candidates,
                    position_votes,
                    election,
                    total_eligible,
                    _item_for_position(position),
                    recorded_ballots,
                )

                results_by_position.append(
                    PositionResults(
                        position=position,
                        total_votes=len(position_votes),
                        candidates=candidate_results,
                        is_tie=any(c.is_tied for c in candidate_results),
                    )
                )

        # Each ballot item is its own contest (W50 S05). A business-meeting
        # ballot — budget, bylaw amendment, membership packages — carries no
        # ``election.positions``; its Approve/Deny candidates are keyed by
        # the item's position (see ``submit_ballot_with_token``). Without
        # this pass the only tally is the flat overall pool, where one
        # motion's "Approve" and another's "Deny" compete for the same
        # winner flag with percentages of the whole ballot, and the report
        # email, certified PDF and close-time tie check — all of which read
        # ``results_by_position`` — report nothing at all. A vote stored
        # with no position (legacy rows) is attributed through its
        # candidate, the same read-time fallback the ballot submission
        # applies. An item whose position is also a plain
        # ``election.positions`` entry (the ELEC-29 collision) was already
        # tallied above and is not reported twice.
        reported_positions = {pr.position for pr in results_by_position}
        for item in election.ballot_items or []:
            aliases = ballot_item_candidate_positions(item)
            if aliases & reported_positions:
                continue
            item_candidates = [c for c in candidates if c.position in aliases]
            item_candidate_ids = {c.id for c in item_candidates}
            item_votes = [
                v
                for v in all_votes
                if v.position in aliases
                or (v.position is None and v.candidate_id in item_candidate_ids)
            ]
            if not item_candidates and not item_votes:
                continue
            item_results = await self._calculate_candidate_results(
                item_candidates,
                item_votes,
                election,
                total_eligible,
                item,
                recorded_ballots,
            )
            contest_key = item.get("position") or item.get("id") or item.get("title")
            reported_positions.update(aliases)
            results_by_position.append(
                PositionResults(
                    position=contest_key,
                    label=item.get("title") or None,
                    total_votes=len(item_votes),
                    candidates=item_results,
                    is_tie=any(c.is_tied for c in item_results),
                )
            )

        # Overall results (all candidates regardless of position). The pool
        # can only be graded by an item's rule when every candidate belongs
        # to that one item — a general-vote ballot with no configured
        # positions, which is what the results page renders when
        # results_by_position is empty. A pool spanning several items keeps
        # the election's rule, as it always has.
        candidate_items = [_item_for_position(c.position) for c in candidates]
        overall_item = None
        if candidate_items and all(i is not None for i in candidate_items):
            distinct = {id(i) for i in candidate_items}
            if len(distinct) == 1:
                overall_item = candidate_items[0]
        overall_results = await self._calculate_candidate_results(
            candidates,
            all_votes,
            election,
            total_eligible,
            overall_item,
            recorded_ballots,
        )

        # Check quorum. Stays None for quorum_type "none": there is no bar
        # to clear, so neither "met" nor "not met" is true (W50-48).
        quorum_met: Optional[bool] = None
        quorum_detail = None
        if election.quorum_type == "percentage" and election.quorum_value:
            quorum_met = voter_turnout >= election.quorum_value
            quorum_detail = (
                f"Quorum requires {election.quorum_value}% turnout. "
                f"Actual: {round_percentage(voter_turnout)}% "
                f"({unique_voters}/{total_eligible})."
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
            voter_turnout_percentage=round_percentage(voter_turnout),
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
        item: Optional[Dict] = None,
        recorded_ballots: Optional[Dict[str, int]] = None,
    ) -> List[CandidateResult]:
        """
        Calculate results for a list of candidates based on configured voting method
        and victory conditions.

        Supports:
        - simple_majority: Standard first-past-the-post counting
        - ranked_choice: Instant-runoff voting with iterative elimination
        - approval: Each vote counts equally; most approvals wins
        - supermajority: Standard counting with higher threshold

        ``item`` is the ballot item these candidates belong to, when there is
        one. A ballot item may override the election's ``voting_method``,
        ``victory_condition`` and ``victory_percentage`` (W50 S04): the
        BallotBuilder offers the override, the printed ballot states it, and
        the tally is the reader that decides whether a "Supermajority (67%)"
        bylaw amendment carried — so it must apply the item's rule, not the
        election's. A missing or null override means "use the election's",
        which is also how a cleared override arrives (the builder omits the
        key). ``victory_threshold`` has no per-item override.

        ``recorded_ballots`` is the officer-attested paper count per batch
        (see ``_recorded_paper_ballot_counts``); the approval denominator
        prefers it the same way turnout does.

        Returns:
            List of CandidateResult objects with winner flags set
        """
        voting_method = _effective_voting_method(election, item)
        if item and item.get("victory_condition"):
            victory_condition = item["victory_condition"]
            victory_percentage = item.get("victory_percentage")
        else:
            victory_condition = election.victory_condition
            victory_percentage = election.victory_percentage

        if voting_method == "ranked_choice":
            return self._calculate_ranked_choice_results(
                candidates, votes, election, total_eligible
            )

        # Standard counting for simple_majority, approval, and supermajority
        # For approval voting, every vote counts equally (no ranking)
        vote_counts: Dict[str, int] = {}
        for vote in votes:
            vote_counts[vote.candidate_id] = vote_counts.get(vote.candidate_id, 0) + 1

        # For approval voting the denominator is voters, not approvals. A
        # paper ballot carries no voter identity, so counting identified
        # voters alone put every paper approval in the numerator and none in
        # the denominator: a mixed in-room election reported 600% and the
        # supermajority / threshold conditions below graded against it. The
        # turnout helper already estimates paper voters conservatively (and
        # prefers the officer-attested count), so it is the one definition.
        if voting_method == "approval":
            total_votes = self._count_ballots_cast(election, votes, recorded_ballots)
            # If no voter tracking is possible at all, fall back to total votes
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
                    percentage=round_percentage(percentage),
                    is_winner=False,
                )
            )

        results.sort(key=lambda x: x.vote_count, reverse=True)

        # Determine winners based on victory_condition
        if victory_condition == "most_votes":
            if results and results[0].vote_count > 0:
                max_votes = results[0].vote_count
                tied_top = [r for r in results if r.vote_count == max_votes]
                policy = getattr(election, "tie_policy", None) or "co_winners"
                if len(tied_top) > 1:
                    # A tie is a fact of the count whatever the policy does
                    # with it, so it is flagged either way: the report, the
                    # certified PDF and the results screen each have to say
                    # "tie" rather than print two 50% rows that look like a
                    # decided race (W50-32). Only co_winners also declares
                    # the tied candidates elected; under runoff / revote /
                    # chair_decides no winner is declared here and the
                    # policy governs resolution.
                    for result in tied_top:
                        result.is_tied = True
                    if policy == "co_winners":
                        for result in tied_top:
                            result.is_winner = True
                else:
                    tied_top[0].is_winner = True

        elif victory_condition == "majority":
            # Strictly more than half. Use integer math: floor(n/2)+1 is the
            # smallest vote count exceeding half. The previous (n/2)+1 float
            # form over-required by a full vote for odd totals — e.g. with 3
            # votes it demanded 2.5 (→3), so a candidate with 2 of 3 (a clear
            # 66% majority) was wrongly denied the win.
            required_votes = total_votes // 2 + 1
            for result in results:
                if result.vote_count >= required_votes:
                    result.is_winner = True

        elif victory_condition == "supermajority":
            required_percentage = victory_percentage or 67
            for result in results:
                if result.percentage >= required_percentage:
                    result.is_winner = True

        elif victory_condition == "threshold":
            if election.victory_threshold:
                for result in results:
                    if result.vote_count >= election.victory_threshold:
                        result.is_winner = True
            elif victory_percentage:
                for result in results:
                    if result.percentage >= victory_percentage:
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
                    percentage=round_percentage(percentage),
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

        # Voters, not votes — and paper ballots count. See _count_ballots_cast.
        unique_voters = self._count_ballots_cast(
            election,
            all_votes,
            await self._recorded_paper_ballot_counts(UUID(str(election.id))),
        )

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
            voter_turnout_percentage=round_percentage(voter_turnout),
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

        # Get eligible voters (a restricted list, extended by overrides)
        restricted_ids = self._restricted_voter_ids(election)
        if restricted_ids is not None:
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_(sorted(restricted_ids)))
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

        # Match on either identity column: a named election's link votes
        # carry only the hash, its older in-app votes only the id.
        voted_hashes = {v.voter_hash for v in votes if v.voter_hash}
        voted_ids = (
            set()
            if election.anonymous_voting
            else {str(v.voter_id) for v in votes if v.voter_id}
        )
        non_voters = []
        for user in eligible_users:
            if str(user.id) in voted_ids:
                continue
            user_hash = self._generate_voter_hash(
                user.id, election_id, election.voter_anonymity_salt or ""
            )
            if user_hash in voted_hashes:
                continue
            non_voters.append(
                {
                    "id": user.id,
                    "full_name": user.full_name,
                    "email": user.email,
                }
            )

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

        # Close time in the department's timezone, and in the same format
        # the ballot template prints its own "Voting closes" line — the two
        # sit a paragraph apart in the same mail.
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        end_local = format_in_org_timezone(
            self._ensure_utc(election.end_date), organization, ZONED_DATE_TIME_FORMAT
        )

        sent, failed, skipped, skipped_details, sent_user_ids = (
            await self.send_ballot_emails(
                election_id=election_id,
                organization_id=organization_id,
                recipient_user_ids=[UUID(nv["id"]) for nv in non_voters],
                subject=subject or f"Reminder: vote in {election.title}",
                message=message
                or (
                    "This is a reminder that you have not yet voted in "
                    f"{election.title}. Voting closes at {end_local}."
                ),
                base_ballot_url=base_ballot_url,
                is_reminder=True,
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
                .values(
                    expires_at=now.replace(microsecond=0),
                    superseded_at=now.replace(microsecond=0),
                )
            )
            expired_count = len(expire_ids)

        # Only a delivered reminder starts the cooldown: stamping an
        # all-failed send would block a manual retry for an hour and disarm
        # the automatic pre-close reminder, which fires only while this is
        # NULL — leaving the lifecycle task free to retry is the point.
        # Nobody left to remind is not a failure, though: stamping then keeps
        # the lifecycle task from re-running (and warning) every tick.
        if sent > 0 or (skipped > 0 and failed == 0):
            election.reminder_sent_at = now.replace(microsecond=0)
        else:
            logger.warning(
                f"Non-voter reminder delivered nothing | election={election_id} "
                f"failed={failed} skipped={skipped}"
            )
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

    async def closed_by_name(self, election: Election) -> Optional[str]:
        """Display name of the officer who closed ``election``, or None for
        an automatic (lifecycle) close or a since-deleted account."""
        if not election.closed_by:
            return None
        result = await self.db.execute(
            select(User.first_name, User.last_name).where(
                User.id == str(election.closed_by),
                User.organization_id == str(election.organization_id),
            )
        )
        row = result.one_or_none()
        if row is None:
            return None
        first, last = row
        return f"{first or ''} {last or ''}".strip() or None

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
            member_emails = [
                m.email
                for m in recipients_for(
                    members,
                    EmailKind.ELECTION_NOTICES,
                    department_required_kinds(organization),
                )
                if m.email
            ]
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
            if not member_receives_email(
                nominee.notification_preferences,
                EmailKind.ELECTION_NOTICES,
                department_required_kinds(organization),
            ):
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

    async def member_can_hold_office(self, user: "User", organization_id: Any) -> bool:
        """Whether ``user``'s membership tier may hold elected office.

        The reader for ``MembershipTierBenefits.can_hold_office`` (owner
        decision TIER-OFFICE; pitfall 19). A department with no stored tiers,
        or a member whose tier is not in them, keeps today's behaviour: anyone
        may stand.
        """
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        return _tier_benefits(user, org).get("can_hold_office", True) is not False

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
        if not await self.member_can_hold_office(nominee, organization_id):
            return None, office_ineligible_message(nominee.full_name)

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
            # The tier may have changed since the nomination was made.
            nominee = (
                await self.db.execute(
                    select(User)
                    .where(User.id == str(user_id))
                    .where(User.organization_id == str(organization_id))
                )
            ).scalar_one_or_none()
            if nominee is not None and not await self.member_can_hold_office(
                nominee, organization_id
            ):
                return False, office_ineligible_message(nominee.full_name)
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
        ballots_cast: Optional[int] = None,
    ) -> Tuple[int, Optional[str], Optional[str]]:
        """Record an in-room paper-ballot tally as vote rows.

        Each entry is {"candidate_id", "count"}. The created votes carry no
        voter identity and no dedup hash — the recording officer's attested
        count is the source of truth, attributed via recorded_by and the
        audit log. Votes are signed and chained like electronic ones so
        integrity verification covers the full ballot box.

        Sanity guard: a batch that would push any position's total ballots
        past what the eligible-voter count can produce is rejected, and so is
        an attested physical count (``ballots_cast``) above that same
        eligible-voter count — a typo like 40-for-4 must be a conscious
        override (``allow_over_count``, which is audited), never a silent
        success. The attested count is the one turnout and quorum trust
        directly, so an implausible one certifies a quorum out of nothing.

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

        if ballots_cast is not None:
            # One physical ballot can select a given candidate at most once,
            # so a per-candidate tally exceeding the attested ballot count is
            # physically impossible — reject rather than store a count the
            # turnout math would then trust.
            per_candidate: Dict[str, int] = {}
            for entry in entries:
                cid = str(entry["candidate_id"])
                per_candidate[cid] = per_candidate.get(cid, 0) + int(
                    entry.get("count", 0)
                )
            largest = max(per_candidate.values())
            if ballots_cast < largest:
                return (
                    0,
                    None,
                    f"A candidate in this batch received {largest} votes, "
                    f"which cannot come from {ballots_cast} physical "
                    f"ballot(s). Double-check the ballot count.",
                )

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
        # count toward the cap — but only those results would count: a
        # pending batch is an unconfirmed claim (W50-40), and letting it
        # occupy the cap refuses every ordinary batch keyed in after an
        # over-count override until the officers attest or void it.
        if not allow_over_count:
            new_by_position: Dict[str, int] = {}
            for entry in entries:
                cand = candidates.get(str(entry["candidate_id"]))
                if cand is not None and cand.position:
                    new_by_position[cand.position] = new_by_position.get(
                        cand.position, 0
                    ) + int(entry.get("count", 0))

            if new_by_position or ballots_cast is not None:
                eligible_count = await self._count_eligible_voters(
                    election, organization_id
                )

                # One eligible member can hand in one physical ballot, so the
                # attested count has no multiplier — unlike a position tally,
                # which a multi-vote ballot legitimately inflates.
                if (
                    ballots_cast is not None
                    and eligible_count
                    and ballots_cast > eligible_count
                ):
                    return (
                        0,
                        None,
                        f"This batch attests {ballots_cast} physical ballot(s), "
                        f"but only {eligible_count} member(s) are eligible. "
                        f"Double-check the ballot count, or re-submit with the "
                        f"over-count override if the tally is correct.",
                    )

                if new_by_position:
                    existing_rows = await self.db.execute(
                        select(Vote.position, func.count(Vote.id))
                        .where(Vote.election_id == str(election_id))
                        .where(Vote.deleted_at.is_(None))
                        .where(Vote.is_test.is_(False))
                        .where(self._is_attested_vote(election_id))
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
                                f"This batch would put {pos} at {projected} "
                                f"ballots, but only {eligible_count} member(s) "
                                f"are eligible (cap {cap}). Double-check the "
                                f"counts, or re-submit with the over-count "
                                f"override if the tally is correct.",
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
            ballots_cast=ballots_cast,
            over_count_override=allow_over_count,
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
                self._apply_vote_signature(vote)
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
        # Lock the election FIRST, before the batch. Election deletion locks
        # parent-then-child: the DELETE on `elections` takes the election
        # row's lock, and the ON DELETE CASCADE that removes its
        # manual_ballot_batches rows locks each batch only after that.
        # Attesting the batch-then-election (the original order here) is
        # the reverse — child-then-parent — so a concurrent attest and
        # delete can each hold one row and wait on the other, an InnoDB
        # deadlock neither this call nor delete_election retries. Matching
        # the parent-to-child order removes the cycle while keeping both
        # locks held before either check proceeds (ELEC-15's serialization
        # property is unchanged).
        #
        # FOR UPDATE also serializes with close_election, which locks and
        # commits the election independently of any batch: a plain read
        # here could still observe a stale OPEN status past a concurrent
        # close, because the two locks would otherwise never block each
        # other and REPEATABLE READ's snapshot for a plain read would not
        # reflect a commit made after this transaction began. A locking
        # read forces this transaction to wait for any in-flight close to
        # finish and then see its committed CLOSED status, so a batch
        # attested "just in time" is consistently rejected rather than
        # sometimes slipping past the close.
        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = election_result.scalar_one_or_none()
        if not election:
            return None, "Election not found"
        if election.status != ElectionStatus.OPEN:
            return (
                None,
                "Attestations can only be added while voting is open",
            )

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
        user_ids.update(b.voided_by for b in batches if b.voided_by)
        for b in batches:
            user_ids.update(a.attested_by for a in b.attestations if a.attested_by)
        names: Dict[str, str] = {}
        if user_ids:
            users_result = await self.db.execute(
                select(User.id, User.first_name, User.last_name).where(
                    User.id.in_(list(user_ids)),
                    User.organization_id == str(organization_id),
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
                    "ballots_cast": b.ballots_cast,
                    "over_count_override": bool(b.over_count_override),
                    "required_attestations": b.required_attestations or 0,
                    "voided_by": b.voided_by,
                    "voided_by_name": names.get(b.voided_by or ""),
                    "voided_at": b.voided_at,
                    "void_reason": b.void_reason,
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
        # Lock the election FIRST, before the batch and votes, matching
        # delete_election's parent-to-child order: the DELETE on `elections`
        # takes the election row's lock, and the ON DELETE CASCADE that
        # removes its manual_ballot_batches (and their votes) locks each
        # child row only after that. Locking the batch (and, via the old
        # join, the election) before that would be child-then-parent — a
        # concurrent void and delete can each hold one row and wait on the
        # other, an InnoDB deadlock neither endpoint retries. Unlike
        # attest_manual_ballot_batch (ELEC-15/24), voiding never gates on the
        # election's OPEN/CLOSED status and results are always computed live
        # from current vote/batch state rather than snapshotted at close, so
        # this lock exists only to fix the ordering — it adds no new
        # serialization with close_election.
        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        if election_result.scalar_one_or_none() is None:
            return 0, "Election not found"

        # Lock the batch next — it's the row every void of this batch
        # contends on. Without this, two concurrent voids can both load the
        # same not-yet-voided votes before either commits, both report
        # success, and the later ORM flush overwrites the first officer's
        # deleted_by/reason/timestamp, corrupting the forensic attribution
        # this operation exists to preserve. Locking also lets the
        # already-voided check below see a concurrent void's committed
        # result instead of a stale pre-lock snapshot (CLAUDE.md #27:
        # lock the parent row *and* read its state through the lock).
        # Absent for batches recorded before the attestation feature
        # existed — those have no row to lock or flag, so this stays a
        # best-effort guard for them, not a correctness gap introduced here.
        batch_result = await self.db.execute(
            select(ManualBallotBatch)
            .where(ManualBallotBatch.id == batch_id)
            .where(ManualBallotBatch.organization_id == str(organization_id))
            .with_for_update()
        )
        batch = batch_result.scalar_one_or_none()
        if batch is not None and batch.status == "voided":
            return 0, "This batch has already been voided"

        # The election is already locked and org-scoped above, so the votes
        # query no longer needs to join Election just to filter by org.
        result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == str(election_id))
            .where(Vote.manual_batch_id == batch_id)
            .where(Vote.is_manual.is_(True))
            .where(Vote.deleted_at.is_(None))
            .with_for_update()
        )
        votes = list(result.scalars().all())
        if not votes:
            return 0, "No active paper ballots found for this batch"

        now = datetime.now(timezone.utc)
        for vote in votes:
            vote.deleted_at = now
            vote.deleted_by = str(deleted_by)
            vote.deletion_reason = reason

        if batch is not None:
            batch.status = "voided"
            batch.voided_by = str(deleted_by)
            batch.voided_at = now
            batch.void_reason = reason
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

        # Ballot items may carry a prospect_package_id (added when an
        # applicant's election package is put on the ballot). That link is
        # state, not configuration: _sync_package_statuses follows it when an
        # election closes, so a copied id would let the clone's votes
        # overwrite the ORIGINAL applicant package's elected/not_elected
        # status. Strip it from every cloned item.
        cloned_ballot_items = copy.deepcopy(source.ballot_items)
        if cloned_ballot_items:
            for item in cloned_ballot_items:
                if isinstance(item, dict):
                    item.pop("prospect_package_id", None)

        clone = Election(
            id=str(uuid4()),
            organization_id=str(organization_id),
            created_by=str(created_by),
            status=ElectionStatus.DRAFT,
            title=title,
            description=source.description,
            election_type=source.election_type,
            positions=copy.deepcopy(source.positions),
            # Ballot items are the core of a reusable ballot.  Copied deeply
            # (so a later edit to the clone cannot mutate a mutable source
            # value held by the ORM session) with stateful keys stripped above.
            ballot_items=cloned_ballot_items,
            position_eligibility=copy.deepcopy(source.position_eligibility),
            start_date=start_date,
            end_date=end_date,
            nomination_deadline=nomination_deadline,
            anonymous_voting=source.anonymous_voting,
            allow_write_ins=source.allow_write_ins,
            max_votes_per_position=source.max_votes_per_position,
            # Not copied: this is the ONLY field the update endpoint lets an
            # officer change on a CLOSED election, which is how results get
            # published after the fact. That makes it a post-close decision
            # about the source's tally, not ballot setup — carrying it over
            # would let the draft show a results tab before a vote is cast.
            results_visible_immediately=False,
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
        # An approval item (a motion, a membership vote) is a contest in
        # its own right: the electronic ballot offers Approve / Deny for
        # it, so the paper ballot must carry the same question or the
        # in-room voter cannot answer it at all (W50-8). Its Approve/Deny
        # option rows only materialise once a vote is cast, so the item
        # is read from the ballot definition, not from the candidates.
        approval_items = [
            item
            for item in (election.ballot_items or [])
            if isinstance(item, dict)
            and item.get("vote_type") == "approval"
            and item.get("title")
        ]
        if not election.positions and not approval_items:
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
        if not candidates and not approval_items:
            return None, "The election has no accepted candidates yet", ""

        positions = []
        for position in election.positions or []:
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
            "approval_items": [
                {"title": item["title"], "description": item.get("description")}
                for item in approval_items
            ],
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
                # closed_at is NULL only on elections closed before the
                # column existed; their scheduled end is the best record.
                "closed_display": await self._org_local_time(
                    organization, election.closed_at or election.end_date
                ),
                "closed_by_display": (
                    await self.closed_by_name(election) or "automatic close"
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
                            UUID(str(election.id)),
                            organization_id,
                            base_ballot_url=(
                                f"{settings.FRONTEND_URL.rstrip('/')}/ballot"
                            ),
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
        # A rollback CLOSED->OPEN leaves ``runoff_round`` at 0 and the child
        # it minted in place, so the round counter alone cannot tell a first
        # close from a re-close: a second "Runoff Round 1" with the same
        # candidates would sit beside the first, both eligible to open. Look
        # for the child itself. Org-scoped even though the parent already
        # was, per Pitfall 14. A department that wants the runoff regenerated
        # with corrected votes deletes the existing one first.
        existing = await self.db.execute(
            select(Election.id)
            .where(Election.parent_election_id == election.id)
            .where(Election.organization_id == str(organization_id))
            .where(Election.is_runoff.is_(True))
            .limit(1)
        )
        existing_runoff_id = existing.scalar_one_or_none()
        if existing_runoff_id:
            logger.info(
                f"Runoff already exists, not creating another | "
                f"parent={election.id} runoff={existing_runoff_id}"
            )
            await self._audit(
                "runoff_already_exists",
                {
                    "parent_election_id": str(election.id),
                    "runoff_election_id": str(existing_runoff_id),
                },
            )
            return None

        # Get results to check if there's a winner. Bypass the results-visibility
        # gate: closing an election early (before end_date, e.g. at the end of a
        # meeting) is the normal flow, and without the bypass get_election_results
        # returns None and the runoff would be silently skipped.
        results = await self.get_election_results(
            election.id, organization_id, _internal_bypass_visibility=True
        )

        if not results:
            return None

        # A multi-position election is decided seat by seat, so the runoff
        # is too. ``overall_results`` pools every ballot across positions and
        # nearly always crowns somebody in that pool (under ``most_votes`` its
        # top candidate is always a winner), which is not evidence that any
        # one race was settled: a Chief race with no majority and an
        # unopposed Secretary used to close with no runoff at all. The
        # per-position ``is_winner`` is consumed rather than re-derived — it
        # already carries the quorum clearing and tie_policy (W50 S06).
        configured_positions = list(election.positions or [])
        if configured_positions:
            unresolved_positions = [
                pr.position
                for pr in results.results_by_position
                if pr.position in configured_positions
                and not any(c.is_winner for c in pr.candidates)
            ]
            if not unresolved_positions:
                return None
        else:
            unresolved_positions = []
            if any(candidate.is_winner for candidate in results.overall_results):
                return None

        # Ballot order breaks a tie at the cut line: a stable sort by vote
        # count keeps it, where an unordered row scan would pick whichever
        # tied candidate MySQL happened to return first.
        candidates_result = await self.db.execute(
            select(Candidate)
            .where(Candidate.election_id == election.id)
            .where(Candidate.accepted.is_(True))
            .order_by(Candidate.position, Candidate.display_order, Candidate.name)
        )
        all_candidates = list(candidates_result.scalars().all())

        def _advancing(ranked: List[Candidate]) -> List[Candidate]:
            if len(ranked) < 2:
                return []  # Can't have a runoff with less than 2 candidates
            if election.runoff_type == "eliminate_lowest":
                return ranked[:-1]
            return ranked[:2]  # top_two, and the default

        advancing_candidates: List[Candidate] = []
        runoff_positions: List[str] = []
        if configured_positions:
            # Rank each unresolved race by its own tally, so a decided seat's
            # winner cannot "advance" against a candidate for another office.
            for pr in results.results_by_position:
                if pr.position not in unresolved_positions:
                    continue
                position_counts = {
                    str(c.candidate_id): c.vote_count for c in pr.candidates
                }
                ranked = sorted(
                    (c for c in all_candidates if c.position == pr.position),
                    key=lambda c: position_counts.get(str(c.id), 0),
                    reverse=True,
                )
                advancing = _advancing(ranked)
                if advancing:
                    advancing_candidates.extend(advancing)
                    runoff_positions.append(pr.position)
        else:
            # Aggregate vote counts at the DB level instead of loading all
            # vote rows into Python memory.
            vote_counts_result = await self.db.execute(
                select(Vote.candidate_id, func.count(Vote.id))
                .where(Vote.election_id == election.id)
                .where(Vote.deleted_at.is_(None))
                .where(Vote.is_test.is_(False))
                .where(self._is_attested_vote(election.id))
                .group_by(Vote.candidate_id)
            )
            candidate_vote_counts = dict(vote_counts_result.all())
            advancing_candidates = _advancing(
                sorted(
                    all_candidates,
                    key=lambda c: candidate_vote_counts.get(c.id, 0),
                    reverse=True,
                )
            )

        if not advancing_candidates:
            return None

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
        # Say why the round is being re-run. A plurality tie is not a missed
        # threshold, and a description claiming "the required votes" were not
        # reached, on a 1-1 tie under most_votes, is wrong on the ballot every
        # voter reads (W50-34). The tie flags are consumed from the results,
        # never re-derived (pitfall 29).
        if configured_positions:
            tied_ids = {
                str(c.candidate_id)
                for pr in results.results_by_position
                if pr.position in unresolved_positions
                for c in pr.candidates
                if c.is_tied
            }
        else:
            tied_ids = {
                str(c.candidate_id) for c in results.overall_results if c.is_tied
            }
        # Ballot order, not tally order: tied rows sort equal, so the tally
        # would name them in whatever order the rows were scanned.
        tied_names = [c.name for c in all_candidates if str(c.id) in tied_ids]
        base_title = _runoff_base_title(election)
        if tied_names:
            runoff_description = (
                f"Runoff election for {base_title}. The previous round ended "
                f"in a tie between {_join_names(tied_names)}."
            )
        else:
            runoff_description = (
                f"Runoff election for {base_title}. No candidate received the "
                f"required votes in the previous round."
            )

        # The child carries only the candidate-selection items for the seats
        # it re-runs. Without them a runoff of an item-based ballot has no
        # ballot at all: the results pass keys each contest by its item, and
        # the "Send Ballot Emails" gate refuses an election with neither
        # items nor positions, so the runoff could never be mailed (W50-34).
        # Approval items (a budget, a bylaw amendment) are decided in one
        # round and are not copied; nor is the package link a clone strips,
        # for the same reason (see clone_election).
        advancing_positions = {c.position for c in advancing_candidates}
        runoff_ballot_items = []
        for item in copy.deepcopy(election.ballot_items or []):
            if not isinstance(item, dict):
                continue
            if item.get("vote_type") != "candidate_selection":
                continue
            if not ballot_item_candidate_positions(item) & advancing_positions:
                continue
            item.pop("prospect_package_id", None)
            runoff_ballot_items.append(item)

        runoff_start = datetime.now(timezone.utc) + timedelta(
            hours=1
        )  # Default; open_election clamps a future start to "now" on open
        runoff_end = runoff_start + timedelta(days=1)  # 1 day duration by default

        runoff_election = Election(
            id=str(uuid4()),
            organization_id=organization_id,
            created_by=election.created_by,
            status=ElectionStatus.DRAFT,
            title=(
                f"{_runoff_base_title(election)} - "
                f"Runoff Round {election.runoff_round + 1}"
            ),
            description=runoff_description,
            election_type=election.election_type,
            # Only the unresolved seats are re-run; a fresh list, never the
            # parent's JSON value (pitfall 12).
            positions=(
                runoff_positions
                if configured_positions
                else copy.deepcopy(election.positions)
            ),
            ballot_items=runoff_ballot_items or None,
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
            # Without this the child falls back to the column default,
            # co_winners, so a re-tie in the runoff declared both candidates
            # elected and never reached round 2 — the opposite of what the
            # parent's "runoff" policy promised (W50-34).
            tie_policy=getattr(election, "tie_policy", None) or "co_winners",
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
        self,
        election_id: UUID,
        organization_id: UUID,
        closed_by: Optional[UUID] = None,
    ) -> Tuple[Optional[Election], Optional[str]]:
        """Close an election and finalize results, creating runoff if needed.

        ``closed_by`` is the officer who pressed Close; the lifecycle task
        passes nothing, which is how an automatic close is told apart.
        """
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
        # The certified PDF, the report and the cards all dated the close to
        # end_date, which an early close leaves untouched (W50-14).
        election.closed_at = datetime.now(timezone.utc)
        election.closed_by = str(closed_by) if closed_by else None
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
                "closed_at": election.closed_at.isoformat(),
                "automatic": closed_by is None,
                "anonymity_salt_destroyed": True,
                "ip_metadata_purged": ip_metadata_purged,
            },
            user_id=str(closed_by) if closed_by else None,
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
                    f"Election closed with tie(s) | "
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
                # get_election_forensics selects audit rows by
                # event_data.election_id, so the row is written once under
                # the parent and mirrored under the runoff: without the key
                # the event appeared in neither election's forensics.
                runoff_event = {
                    "parent_election_id": str(election_id),
                    "runoff_election_id": str(runoff.id),
                    "runoff_round": runoff.runoff_round,
                }
                for scoped_id in (election_id, runoff.id):
                    await self._audit(
                        "runoff_election_created",
                        {"election_id": str(scoped_id), **runoff_event},
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
            .where(self._is_attested_vote(election.id))
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
            # The roster honours an existing snapshot, so a stale one left by
            # a rolled-back open must be cleared first or this freeze would
            # only ever narrow the previous one.
            election.eligible_roster_snapshot = None
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
        # The status decision is a read-then-write (Pitfall 27): lock the row
        # as close/open do, so a close and a rollback overlapping cannot leave
        # an OPEN parent beside a freshly minted runoff, and two rollbacks
        # cannot both append a history record.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
        )
        election = result.scalar_one_or_none()

        if not election:
            return None, 0, "Election not found"

        # Determine the rollback action based on current status
        from_status = election.status.value
        to_status = None
        salt_regenerated = False
        tokens_invalidated = 0

        if election.status == ElectionStatus.CLOSED:
            # Rollback from closed to open.
            # SECURITY (module-audit ELEC-4): close_election destroys the
            # per-election anonymity salt. Reopening after that would make
            # _generate_voter_hash produce hashes that no longer match the
            # recorded votes, so every prior voter could vote a second time
            # (both the app checks and the dedup hash would miss them).
            # Refuse the rollback in that case — a new election is the safe path.
            if election.voter_anonymity_salt is None:
                votes_count_result = await self.db.execute(
                    select(func.count(Vote.id))
                    .where(Vote.election_id == str(election_id))
                    .where(Vote.deleted_at.is_(None))
                )
                votes_count = votes_count_result.scalar() or 0
                if election.anonymous_voting and votes_count > 0:
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
                if votes_count == 0:
                    # With zero votes the destroyed salt protects nothing, but
                    # already-emailed ballot tokens carry voter hashes keyed to
                    # the old salt — _token_voter_is_on_frozen_roll would reject
                    # every one of them against a missing (or fresh) salt, so
                    # those links are dead either way. Mint a new salt the same
                    # way election creation does, and expire the issued tokens
                    # so admins can re-send ballots keyed to the new salt.
                    election.voter_anonymity_salt = secrets.token_hex(32)
                    salt_regenerated = True
                    now = datetime.now(timezone.utc)
                    invalidate_result = await self.db.execute(
                        sql_update(VotingToken)
                        .where(VotingToken.election_id == str(election_id))
                        .where(VotingToken.expires_at > now)
                        # Floor to the second: MySQL DATETIME(0) ROUNDS
                        # fractional seconds, so expiring at now=:56.9 would
                        # store :57 and leave the token briefly valid.
                        # superseded_at too, so the lookup can say the link
                        # was retired rather than that voting is over.
                        .values(
                            expires_at=now.replace(microsecond=0),
                            superseded_at=now.replace(microsecond=0),
                        )
                    )
                    tokens_invalidated = invalidate_result.rowcount or 0
            to_status = "open"
            new_status = ElectionStatus.OPEN
            # The reopened election has not closed yet; the eventual re-close
            # stamps its own instant and officer.
            election.closed_at = None
            election.closed_by = None
        elif election.status == ElectionStatus.OPEN:
            # Rollback from open to draft
            to_status = "draft"
            new_status = ElectionStatus.DRAFT
            # A draft has no frozen roll. The roster gate keys on the snapshot
            # rather than on status, so leaving the earlier open's roll here
            # would report members who joined since as off a roll that no
            # longer exists (the next open freezes a fresh one).
            election.eligible_roster_snapshot = None
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
        if salt_regenerated:
            # Surface to admins that previously issued ballot links are now
            # dead and ballots must be re-sent (re-sending mints tokens keyed
            # to the regenerated salt).
            rollback_record["anonymity_salt_regenerated"] = True
            rollback_record["voting_tokens_invalidated"] = tokens_invalidated
            rollback_record["ballots_must_be_resent"] = True

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
            f"{from_status} -> {to_status} by={performed_by} reason={reason!r} "
            f"salt_regenerated={salt_regenerated} "
            f"tokens_invalidated={tokens_invalidated}"
        )
        await self._audit(
            "election_rollback",
            {
                "election_id": str(election_id),
                "title": election.title,
                "from_status": from_status,
                "to_status": to_status,
                "reason": reason,
                "anonymity_salt_regenerated": salt_regenerated,
                "voting_tokens_invalidated": tokens_invalidated,
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
                tokens_invalidated=tokens_invalidated,
                ballots_must_be_resent=salt_regenerated,
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
        template_type: EmailTemplateType,
        extra_context: Dict[str, str],
        skip_performer: bool = False,
        log_label: str = "notification",
    ) -> int:
        """
        Email every active leadership member one of the election alerts.

        The message is the organization's own ``election_rollback`` /
        ``election_deleted`` template, falling back to the shipped default,
        so a department that edits the alert on the Email Templates screen
        changes what leadership receives. Before, this built its own body
        and those templates were stored but never sent.

        *extra_context* carries the variables that differ between the two
        alerts (the stages, the vote count); the ones they share are filled
        here.

        Returns: Number of notifications sent
        """
        leadership_roles = LEADERSHIP_ROLE_SLUGS

        # No join to User.roles: it returned one row per position held, so a
        # leadership member holding `president` and the auto-assigned `member`
        # was emailed twice and counted twice in the "N leadership members have
        # been notified" message shown to whoever rolled the election back. The
        # positions are already eager-loaded, and the filter below is in Python,
        # so the join bought nothing. Matches the sibling query in
        # get_package_recipients.
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.is_active.is_(True))
            .options(selectinload(User.roles))
        )
        all_users = users_result.scalars().all()

        leadership = [
            user
            for user in all_users
            if any(role.slug in leadership_roles for role in user.roles)
        ]

        if not leadership:
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

        leadership_users = recipients_for(
            leadership,
            EmailKind.ELECTION_ADMIN,
            department_required_kinds(organization),
        )

        if not leadership_users:
            return 0

        email_service = EmailService(organization)

        org_tz = getattr(organization, "timezone", None) or "America/New_York"
        action_time = (
            datetime.now(timezone.utc)
            .astimezone(ZoneInfo(org_tz))
            .strftime("%B %d, %Y at %I:%M %p")
        )

        # Loaded once rather than per recipient: every leadership member gets
        # the same template, and _render_with_fallback would otherwise query
        # for it on every iteration.
        template = await EmailTemplateService(self.db).get_template(
            str(organization_id), template_type
        )

        sent_count = 0
        for user in leadership_users:
            if skip_performer and str(user.id) == str(performed_by):
                continue

            # Plain values: the renderer escapes each one for the HTML body
            # and leaves the subject and plain-text body unescaped.
            context = {
                "recipient_name": user.first_name or user.full_name or "",
                "election_title": election.title,
                "performer_name": performer_name,
                "reason": reason,
                "action_time": action_time,
                **extra_context,
            }
            (
                subject,
                html_body,
                text_body,
            ) = await email_service._render_with_fallback(
                template_type=template_type,
                context=context,
                template=template,
                default_subject=_ALERT_DEFAULTS[template_type][0],
                default_html=_ALERT_DEFAULTS[template_type][1],
                default_text=_ALERT_DEFAULTS[template_type][2],
            )

            try:
                success_count_user, failure_count_user = await email_service.send_email(
                    to_emails=[user.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    db=self.db,
                    template_type=template_type.value,
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
        tokens_invalidated: int = 0,
        ballots_must_be_resent: bool = False,
    ) -> int:
        """
        Send email notifications to leadership about election rollback.

        The member who rolled it back is not emailed about their own action.

        Returns: Number of notifications sent
        """
        # The template used to carry a fixed "votes after the stage returned
        # to no longer count" line. A rollback deletes no vote on any path
        # (W50-37), and the only thing it can invalidate is the issued ballot
        # links, on a zero-vote reopen that re-minted the anonymity salt — so
        # the sentence is composed from what this rollback actually did.
        effect = "All recorded votes remain counted; this rollback discarded none."
        if ballots_must_be_resent:
            links = "link" if tokens_invalidated == 1 else "links"
            effect += (
                f" {tokens_invalidated} issued ballot {links} "
                f"{'was' if tokens_invalidated == 1 else 'were'} invalidated: "
                "every ballot email already sent is dead, and ballots must be "
                "sent again."
            )
        else:
            effect += (
                " No issued ballot links were invalidated, so ballots do not "
                "need to be sent again."
            )
        return await self._notify_leadership(
            election=election,
            performed_by=performed_by,
            organization_id=organization_id,
            reason=reason,
            template_type=EmailTemplateType.ELECTION_ROLLBACK,
            extra_context={
                "previous_stage": _stage_label(from_status),
                "current_stage": _stage_label(to_status),
                "tokens_invalidated": str(tokens_invalidated),
                "ballots_must_be_resent": "Yes" if ballots_must_be_resent else "No",
                "rollback_effect": effect,
            },
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
        deleted, which is a major red-flag event, so the member who deleted
        it is emailed too.

        Returns: Number of notifications sent
        """
        return await self._notify_leadership(
            election=election,
            performed_by=performed_by,
            organization_id=organization_id,
            reason=reason,
            template_type=EmailTemplateType.ELECTION_DELETED,
            extra_context={
                "election_status": _stage_label(election.status.value),
                "vote_count": str(vote_count),
            },
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

    def _max_proxies_per_person(self, organization: "Organization") -> int:
        """Free-form JSON: a bad or missing value degrades to the documented
        default of 1 rather than raising (Pitfall 19)."""
        raw = (
            (organization.settings or {})
            .get("proxy_voting", {})
            .get("max_proxies_per_person", 1)
        )
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return 1
        return value if value >= 1 else 1

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

        # max_proxies_per_person is the cap on vote-bundling the settings
        # screen promises; it gates nothing unless read here (Pitfall 19).
        max_proxies = self._max_proxies_per_person(org)
        held = sum(
            1
            for auth in authorizations
            if auth.get("proxy_user_id") == str(proxy_user_id)
            and not auth.get("revoked_at")
        )
        if held >= max_proxies:
            return (
                None,
                f"{proxy_user.full_name} already holds the maximum of "
                f"{max_proxies} proxy authorization(s) for this election",
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
        # Locked for the same reason as cast_vote: the per-voter limit checks
        # below are read-then-write, and the dedup UNIQUE cannot enforce them
        # once the discriminator permits distinct candidates or ranks.
        result = await self.db.execute(
            select(Election)
            .where(Election.id == str(election_id))
            .where(Election.organization_id == str(organization_id))
            .with_for_update()
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

        # Resolved the same way as cast_vote, so the delegating member's
        # per-item eligibility, limits and dedup hash are the ones their own
        # ballot would get; the raw client position used to reach all three.
        target, error = await self._resolve_vote_target(
            election, candidate_id, position
        )
        if not target:
            return None, error
        effective_position = target.effective_position

        # Check the *delegating* member's eligibility (they are the voter of record)
        eligibility = await self.check_voter_eligibility(
            delegating_user_id, election_id, organization_id, effective_position
        )
        if not eligibility.is_eligible:
            return None, f"Delegating member is not eligible: {eligibility.reason}"

        if position and target.candidate.position != position:
            return None, "Candidate is not running for this position"

        limit_error = await self._validate_vote_limits(
            election,
            delegating_user_id,
            candidate_id,
            effective_position,
            vote_rank,
            voter_label="Delegating member has",
            position_label=target.position_label,
        )
        if limit_error:
            return None, limit_error

        # Hashed in every election, for the same reason as cast_vote: the
        # link path keys on the hash, so the dedup input must be the hash.
        voter_hash = self._generate_voter_hash(
            delegating_user_id, election_id, election.voter_anonymity_salt or ""
        )
        voter_id_or_hash = voter_hash

        # Create the vote as the delegating member, with proxy metadata.
        # Explicit id: signatures cover it and are computed pre-flush.
        vote = Vote(
            id=str(uuid4()),
            election_id=election_id,
            candidate_id=candidate_id,
            voter_id=delegating_user_id if not election.anonymous_voting else None,
            voter_hash=voter_hash,
            position=effective_position,
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
                _dedup_position_key(target.matching_item, effective_position),
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank
                ),
            ),
        )
        self._apply_vote_signature(vote)
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
            f"Proxy vote cast | election={election_id} position={effective_position} "
            f"delegating={delegating_user_id} proxy={proxy_user_id} "
            f"auth={proxy_authorization_id} vote_id={vote.id}"
        )
        await self._audit(
            "proxy_vote_cast",
            {
                "election_id": str(election_id),
                "vote_id": str(vote.id),
                "position": effective_position,
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
        is_reminder: bool = False,
    ) -> Tuple[int, int, int, List[Dict], List[str]]:
        """
        Send ballot notification emails to eligible voters with unique voting links.

        ``subject`` replaces the template's subject line for this send;
        ``is_reminder`` marks a follow-up to a ballot already sent, which
        leaves the election's "ballots sent" stamp alone.

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
            # The election's list, plus any overridden member (W50-13)
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_(sorted(self._restricted_voter_ids(election) or [])))
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

        # Frozen-roll sets are loop-invariant — build them once, not per
        # recipient. None means the roll was never frozen (legacy election).
        frozen_roster = getattr(election, "eligible_roster_snapshot", None)
        frozen_roster_ids = (
            {str(uid) for uid in frozen_roster} if frozen_roster is not None else None
        )
        override_ids = {
            str(override["user_id"])
            for override in (election.voter_overrides or [])
            if override.get("user_id")
        }

        for recipient in recipients:
            # Do not issue a live ballot credential to someone added after
            # the voter roll was frozen. Secretary overrides remain valid.
            # Test sends are exempt: their tokens (and any votes cast with
            # them) are flagged is_test, use a namespaced dedup hash, and are
            # excluded from results/stats/rosters, so a test ballot is never
            # a live credential — and admins must be able to preview ballots
            # without being on the frozen roll.
            if (
                not is_test
                and frozen_roster_ids is not None
                and str(recipient.id) not in frozen_roster_ids
                and str(recipient.id) not in override_ids
            ):
                skipped_count += 1
                reason = self.NOT_ON_FROZEN_ROLL
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

            # Empty ballot prevention: compute eligible ballot items, but do
            # NOT decide to skip yet — a mixed election may still owe this
            # recipient a ballot for a plain position even when they are
            # ineligible for every structured item (see the positions block
            # below). Deciding on items alone here excluded a voter who was
            # eligible only for a plain position: eligible_positions had not
            # even been computed yet.
            eligible_items: List[Dict] = []
            if election.ballot_items:
                eligible_items = await self._get_eligible_ballot_items_for_user(
                    user=recipient,
                    election=election,
                    organization_id=str(organization_id),
                    organization=organization,
                )

            # Positions: snapshot which of this election's plain positions
            # this recipient may vote for, mirroring the per-item snapshot
            # below — the token carries no user identity, so
            # position_eligibility (R-D4) can only be enforced at vote time
            # from a send-time snapshot. eligible_positions is always a list
            # (never left None) whenever the election defines positions:
            # None is reserved for "this election has no positions at all",
            # and an empty list means "evaluated, ineligible for all" —
            # see below for why that distinction matters even when no
            # per-position rules exist.
            #
            # Deliberately NOT gated on "no ballot items": the schema
            # allows an election to configure both `positions` and
            # `ballot_items` at once, and a candidate can be nominated for
            # a plain position that isn't tied to any ballot item. Skipping
            # this snapshot whenever ballot_items exist left such a
            # candidate's eligibility unchecked at every layer —
            # eligible_positions stayed None regardless of position_eligibility
            # rules, and the per-item check in cast_vote_with_token only
            # ever fires for a candidate that resolves to an item — so a
            # token eligible for one item could vote for *any* plain
            # position with no eligibility check at all.
            eligible_positions: Optional[List[str]] = None
            if election.positions:
                # Apply the same two universal gates the item snapshot above
                # goes through (_member_voting_gates), and do so
                # unconditionally on election.positions rather than only
                # when position_eligibility is configured: a globally
                # voting-ineligible tier must fail every position outright
                # whether or not any per-position rule exists to
                # independently reject the member — the absence of
                # position-specific rules is "no rules for this position ->
                # everyone [whose tier allows voting] may vote for it", not
                # an exemption from the tier ban itself (Codex round 7,
                # ELEC-35 — evaluating this gate only inside the
                # `and election.position_eligibility` branch let a
                # tier-banned member with no position rules configured
                # receive an eligible_positions=None token, which the vote
                # path reads as unrestricted). An election override grants
                # every position unconditionally, the positional mirror of
                # the override already bypassing every ballot item's
                # voter-type rules (Codex round 6, ELEC-30/ELEC-31).
                tier_voting_eligible, has_override = await self._member_voting_gates(
                    recipient, election, str(organization_id), organization
                )
                if tier_voting_eligible or has_override:
                    eligible_positions = []
                    for pos in election.positions:
                        if has_override:
                            eligible_positions.append(pos)
                            continue
                        pos_rules = (election.position_eligibility or {}).get(pos)
                        if not pos_rules:
                            # No rules for this position → everyone whose
                            # tier permits voting may vote for it (mirrors
                            # check_voter_eligibility).
                            eligible_positions.append(pos)
                            continue
                        voter_types = pos_rules.get("voter_types", ["all"])
                        if await self._user_has_role_type(recipient, voter_types):
                            eligible_positions.append(pos)
                else:
                    # Globally voting-ineligible tier and no override: zero
                    # eligible positions — the positional mirror of
                    # annotate_ballot_items_for_user failing every item for
                    # the same member. Empty (not None) so downstream code
                    # correctly reads this as "evaluated, ineligible for
                    # all", not "unrestricted". This is what closes
                    # ELEC-35: previously this branch was only reachable
                    # when position_eligibility was configured, so a
                    # tier-banned member on an election with plain
                    # positions and no position rules fell through with
                    # eligible_positions left at its None default instead.
                    eligible_positions = []

            # Empty ballot prevention: decide now that BOTH eligibility sets
            # above are known. A mixed election defines ballot items and/or
            # plain positions independently, so a recipient is skipped only
            # when they qualify for neither structure the election actually
            # defines — being eligible for one plain position is enough to
            # warrant a ballot even if every structured item excludes them,
            # and vice versa. eligible_positions is authoritative for
            # whether the recipient qualifies via positions: it is already
            # empty for a tier-banned member even when no position_eligibility
            # rules exist (see above), so there is no separate "unrestricted
            # positions always qualify" carve-out here any more.
            items_defined = bool(election.ballot_items)
            positions_defined = bool(election.positions)

            qualifies = False
            if items_defined:
                qualifies = qualifies or bool(eligible_items)
            if positions_defined:
                qualifies = qualifies or bool(eligible_positions)

            if (items_defined or positions_defined) and not qualifies:
                skipped_count += 1
                if items_defined and positions_defined:
                    reason = (
                        "Not eligible for any ballot item or position in "
                        "this election — role type, attendance, and "
                        "membership did not match any item or position "
                        "requirements"
                    )
                elif positions_defined:
                    reason = (
                        "Not eligible for any position in this election — "
                        "membership type does not match any position's "
                        "voter-type rules, or this membership tier is not "
                        "voting-eligible"
                    )
                else:
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

        # ---- Phase 2: Render, then send the whole batch at once ----
        # Render each email using the pre-loaded template (or default), then
        # hand the batch to the service: SMTP departments get one connection
        # for all of them rather than per-email TCP+TLS+auth overhead, and
        # Cloudflare departments get the REST API.
        mime_messages: List[Optional[BuiltMessage]] = []
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
                # A caller's subject wins over the template's: a reminder
                # titled "Ballot Available" read as a first notice, and the
                # subject typed into the resend dialog never reached the mail
                # at all (W50-27).
                if subject:
                    subj = subject
                # A test ballot must be told apart from the real one in the
                # inbox, whatever template the department configured: the
                # body's one TEST line is easy to miss, and the secretary
                # otherwise reads their own preview as the member send
                # (W50-18).
                if is_test and not subj.startswith("[TEST]"):
                    subj = f"[TEST] {subj}"
                # build_batch_message, not build_message: the pair the latter
                # returns is MIME only, which the Cloudflare backend cannot
                # send — a Cloudflare department's ballots all failed on it.
                built = email_service.build_batch_message(
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
                mime_messages.append(built)
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
        # Stamp the flag only on a confirmed delivery: the detail page reports
        # what this decided (Resend / Remind Non-Voters unlock on it), and an
        # SMTP outage that rejected every message has sent nothing. An earlier
        # successful batch keeps its stamp through a fully-failed resend.
        # A test send stamps nothing: the detail page reads email_sent as
        # "members have ballots" and offers Resend with a warning about
        # regenerating their tokens, and email_recipients feeds the report's
        # "received a ballot" roster — none of which a secretary's own
        # preview is (W50-18). A reminder leaves the stamp alone too: the
        # detail page shows it beside "Resend Ballot Emails" as when the
        # ballots went out, and a reminder has its own reminder_sent_at
        # (W50-27).
        if success_count > 0 and not is_test and not is_reminder:
            election.email_sent = True
            election.email_sent_at = datetime.now(timezone.utc)
        # Merge rather than replace: a reminder re-send targets only the
        # non-voters, and replacing would erase the original recipients'
        # "ballot sent" record.
        if not is_test:
            election.email_recipients = sorted(
                set(election.email_recipients or []) | set(sent_user_ids)
            )
            election.email_skipped_details = self._merge_skipped_details(
                election.email_skipped_details,
                election.email_recipients,
                skipped_details,
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
                "is_test": is_test,
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
        requested: bool = False,
    ) -> Tuple[bool, str]:
        """
        Generate and send an election report email to the secretary (election
        creator) and any leadership members.

        *requested* is True when an officer pressed "Send report": that send
        goes out regardless of the creator's email choices. The automatic send
        when an election closes follows them (``EmailKind.ELECTION_ADMIN``).

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

        # The results read below bypasses the visibility gate, so this is the
        # only thing standing between an officer and a live per-candidate
        # tally mid-vote. Gate on status rather than end_date: close_election
        # sets CLOSED before calling this, and an early close (end_date still
        # in the future) must still get its automatic report.
        if election.status != ElectionStatus.CLOSED:
            return (
                False,
                "Election report is only available after the election closes",
            )

        # Load organization
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return False, "Organization not found"

        # Get election results (the visibility gate was enforced above)
        results = await self.get_election_results(
            election_id, organization_id, _internal_bypass_visibility=True
        )

        # A tied race is reported with what the close did about it: the
        # runoff child, when one was created, already exists by the time
        # the report is built (see close_election).
        runoff_created = False
        if results and any(pr.is_tie for pr in results.results_by_position):
            runoff_created = (
                await self.db.execute(
                    select(Election.id)
                    .where(Election.parent_election_id == str(election_id))
                    .where(Election.organization_id == str(organization_id))
                    .where(Election.is_runoff.is_(True))
                    .limit(1)
                )
            ).scalar_one_or_none() is not None

        # Build results HTML/text
        results_html, results_text = self._build_results_tables(
            results, runoff_created=runoff_created
        )

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
            quorum_status = self._quorum_status_text(results)
            quorum_detail = results.quorum_detail or ""

        # Build ballot recipients list and skipped voters list
        ballot_recipients_html, ballot_recipients_text, ballot_recipients_count = (
            await self._build_ballot_recipient_lists(election, organization_id)
        )
        skipped_html, skipped_text, skipped_count = self._build_skipped_voter_lists(
            election
        )

        # Determine report recipients (election creator + leadership)
        to_emails = []
        recipient_name = "Secretary"
        if election.created_by:
            creator_result = await self.db.execute(
                select(User).where(User.id == election.created_by)
            )
            creator = creator_result.scalar_one_or_none()
            if (
                creator
                and creator.email
                and (
                    requested
                    or member_receives_email(
                        creator.notification_preferences,
                        EmailKind.ELECTION_ADMIN,
                        department_required_kinds(organization),
                    )
                )
            ):
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
            closed_at=_fmt_dt(election.closed_at or election.end_date),
            closed_by=await self.closed_by_name(election) or "Automatic close",
            total_eligible_voters=total_eligible,
            total_votes_cast=total_votes,
            voter_turnout_percentage=turnout,
            quorum_status=quorum_status,
            quorum_detail=quorum_detail,
            results_html=results_html,
            results_text=results_text,
            ballot_recipients_html=ballot_recipients_html,
            ballot_recipients_text=ballot_recipients_text,
            ballot_recipients_count=ballot_recipients_count,
            skipped_voters_html=skipped_html,
            skipped_voters_text=skipped_text,
            skipped_voters_count=skipped_count,
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
        from app.utils.pre_meeting_package_pdf import (
            render_pre_meeting_package_pdf,
            summarize_item_eligibility,
        )

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
                "items": summarize_item_eligibility(
                    election.ballot_items or [], roster_members
                ),
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

    @staticmethod
    def _tie_outcome_line(tie_policy: Optional[str], runoff_created: bool) -> str:
        """The one line a tied race gets in the close report.

        Two 50% rows do not tell the secretary whether the seat is decided;
        the tie policy does, and for a runoff whether the round was in fact
        created (runoffs disabled, or the round cap reached, leave the seat
        open with nothing scheduled).
        """
        policy = tie_policy or "co_winners"
        if policy == "co_winners":
            return "Tie \u2014 co-winners per the election's tie policy"
        if policy == "runoff":
            if runoff_created:
                return "Tie \u2014 no winner declared; runoff round created"
            return (
                "Tie \u2014 no winner declared; the tie policy calls for a "
                "runoff round, but none was created"
            )
        if policy == "revote":
            return "Tie \u2014 no winner declared; resolved by a revote at the meeting"
        if policy == "chair_decides":
            return "Tie \u2014 no winner declared; resolved by the chair per the bylaws"
        return f"Tie \u2014 no winner declared; tie policy: {policy}"

    @staticmethod
    def _quorum_status_text(results: ElectionResults) -> str:
        """The one-line quorum verdict the close report prints.

        Shared with the certified PDF's wording so the two records cannot
        disagree about an election that has no quorum rule (W50-48).
        """
        if results.quorum_met is None:
            return "No quorum requirement"
        return "Quorum Met" if results.quorum_met else "Quorum NOT Met"

    def _build_results_tables(
        self, results, runoff_created: bool = False
    ) -> Tuple[str, str]:
        """Build HTML and plain-text tables of election results."""
        if not results or not results.results_by_position:
            return (
                "<p><em>No results available.</em></p>",
                "No results available.",
            )

        # HTML table. Three columns so it fits a phone: the position is a
        # heading row over its candidates instead of a column repeated on
        # every row, and the percentage rides under the vote count.
        rows = []
        rows.append(
            f'<table style="{TABLE_STYLE}">'
            "<tr>"
            f'<th style="{TH_STYLE}text-align:left;">Candidate</th>'
            f'<th style="{TH_STYLE}text-align:center;">Votes</th>'
            f'<th style="{TH_STYLE}text-align:center;">Result</th>'
            "</tr>"
        )

        text_parts = []
        for pos_result in results.results_by_position:
            # A ballot item's contest key is its id; the reader wants its title.
            contest = getattr(pos_result, "label", None) or pos_result.position
            position = html.escape(contest)
            text_parts.append(f"Position: {contest}")
            rows.append(
                f'<tr><td colspan="3" style="{TD_STYLE}{WRAP_STYLE}'
                f'background-color:#f8fafc;font-weight:600;">{position}</td></tr>'
            )
            for candidate in pos_result.candidates:
                name = html.escape(candidate.candidate_name)
                pct = f"{candidate.percentage:.1f}%"
                if candidate.is_winner and candidate.is_tied:
                    result_label = "\u2705 Elected (tie \u2014 co-winner)"
                    winner_text = " \u2014 ELECTED (tie \u2014 co-winner)"
                elif candidate.is_winner:
                    result_label = "\u2705 Elected"
                    winner_text = " \u2014 ELECTED"
                elif candidate.is_tied:
                    result_label = "\u26a0\ufe0f Tied"
                    winner_text = " \u2014 TIED"
                else:
                    result_label = "\u2014"
                    winner_text = ""
                rows.append(
                    f'<tr><td style="{TD_STYLE}{WRAP_STYLE}">{name}</td>'
                    f'<td style="{TD_STYLE}text-align:center;white-space:nowrap;">'
                    f"{with_subline(str(candidate.vote_count), pct)}</td>"
                    f'<td style="{TD_STYLE}text-align:center;">{result_label}</td></tr>'
                )
                text_parts.append(
                    f"  {candidate.candidate_name} — {candidate.vote_count} votes ({pct}){winner_text}"
                )
            if pos_result.is_tie:
                outcome = self._tie_outcome_line(
                    getattr(results, "tie_policy", None), runoff_created
                )
                rows.append(
                    f'<tr><td style="{TD_STYLE}" colspan="3">'
                    f"<strong>{html.escape(outcome)}</strong></td></tr>"
                )
                text_parts.append(f"  {outcome}")

        rows.append("</table>")
        return "\n".join(rows), "\n".join(text_parts)

    BALLOTS_NOT_EMAILED = "Ballots were not emailed for this election."
    # One string for the send, the reminder and the roster: the report
    # prints the reason the send recorded, and the roster must say the same
    # thing before the send that the send will say after it (W50-55).
    NOT_ON_FROZEN_ROLL = "Not on the voter roll frozen when the election opened"

    @staticmethod
    def summarize_skipped(skipped_details: List[Dict]) -> str:
        """The skipped clause of a send/reminder summary, e.g.
        ``"2 skipped (1: Not checked in for meeting; 1: Not on the voter
        roll frozen when the election opened)"``.

        Built from the reasons the send actually recorded rather than a
        fixed "did not meet ballot item requirements" — that sentence named
        an item rule for a member who was skipped for not being on the
        frozen roll (W50-55). Returns "" when nothing was skipped.
        """
        if not skipped_details:
            return ""
        counts: Dict[str, int] = {}
        for detail in skipped_details:
            reason = detail.get("reason") or "No reason recorded"
            counts[reason] = counts.get(reason, 0) + 1
        if len(counts) == 1:
            (reason,) = counts
            return f"{len(skipped_details)} skipped ({reason})"
        # Most common first, then alphabetical so the sentence is stable.
        by_reason = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        breakdown = "; ".join(f"{n}: {reason}" for reason, n in by_reason)
        return f"{len(skipped_details)} skipped ({breakdown})"

    @staticmethod
    def _merge_skipped_details(
        prior: Optional[List[Dict]],
        recipient_ids: List[str],
        skipped_details: List[Dict],
    ) -> List[Dict]:
        """Fold one send's skip list into the election's record of it.

        Mirrors the email_recipients merge above it: a reminder targets only
        the non-voters, so replacing the list would forget everyone the
        first send skipped. A member is never on both lists — a ballot that
        did go out (this send or an earlier one) settles the question, and a
        member skipped again keeps the latest reason.
        """
        received = {str(uid) for uid in recipient_ids}
        merged: Dict[str, Dict] = {
            str(d["user_id"]): d
            for d in (prior or [])
            if str(d.get("user_id")) not in received
        }
        for detail in skipped_details:
            if str(detail["user_id"]) not in received:
                merged[str(detail["user_id"])] = detail
        return sorted(
            merged.values(), key=lambda d: (d.get("name") or "", d["user_id"])
        )

    async def _build_ballot_recipient_lists(
        self, election: Election, organization_id: str
    ) -> Tuple[str, str, int]:
        """Build HTML and text lists of members who received ballots.

        Returns (html, text, count); the count is the length of the list
        printed, so the heading can never disagree with the names under it.
        """
        recipient_ids = election.email_recipients or []
        users = []
        if recipient_ids:
            # The report passes a UUID; bound as-is it matches no row, and
            # every report then read "no ballot emails were sent" (W50-33).
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_([str(uid) for uid in recipient_ids]))
                .where(User.organization_id == str(organization_id))
            )
            users = users_result.scalars().all()

        if not users:
            return (
                f"<p><em>{self.BALLOTS_NOT_EMAILED}</em></p>",
                self.BALLOTS_NOT_EMAILED,
                0,
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
            len(users),
        )

    def _build_skipped_voter_lists(self, election: Election) -> Tuple[str, str, int]:
        """Build HTML and text lists of members who did NOT receive ballots.

        Reads only what the send recorded (email_skipped_details), never a
        fresh eligibility pass: a reason derived at close time describes the
        member now, not the decision the send made, and the diff against
        every active member it replaced listed people the send never
        considered at all (W50-33).
        """
        if not election.email_recipients:
            return (
                f"<p><em>{self.BALLOTS_NOT_EMAILED}</em></p>",
                self.BALLOTS_NOT_EMAILED,
                0,
            )

        skipped = election.email_skipped_details
        if skipped is None:
            # Ballots went out before the skip list was recorded.
            note = "No record of skipped members was kept for this send."
            return f"<p><em>{note}</em></p>", note, 0
        if not skipped:
            note = "No members were skipped."
            return f"<p><em>{note}</em></p>", note, 0

        html_rows = [
            f'<table style="{TABLE_STYLE}"><tr>'
            f'<th style="{TH_STYLE}text-align:left;">Member</th>'
            f'<th style="{TH_STYLE}text-align:left;">Reason</th>'
            "</tr>"
        ]
        text_items = []
        for detail in sorted(skipped, key=lambda d: d.get("name") or ""):
            name = detail.get("name") or "Unknown member"
            reason = detail.get("reason") or "No reason recorded"
            html_rows.append(
                f'<tr><td style="{TD_STYLE}">{html.escape(name)}</td>'
                f'<td style="{TD_STYLE}">{html.escape(reason)}</td></tr>'
            )
            text_items.append(f"  - {name}: {reason}")

        html_rows.append("</table>")
        return "\n".join(html_rows), "\n".join(text_items), len(skipped)

    async def has_user_voted(
        self, user_id: UUID, election_id: UUID, election: Optional[Election] = None
    ) -> bool:
        """Check if a user has voted in an election (handles anonymous voting)"""
        if election is not None:
            identity = self._voter_identity_filter(election, user_id)
        else:
            identity = Vote.voter_id == str(user_id)
        result = await self.db.execute(
            select(func.count(Vote.id))
            .where(Vote.election_id == str(election_id))
            .where(identity)
            .where(Vote.is_test.is_(False))
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

        # A link a reminder retired is also expired, so this must come
        # first: "expired" reads as voting being over, and the member's
        # newer email still holds a working link (W50-27). A rollback
        # retires links the same way but issues nothing in their place —
        # and the re-send that follows keys new tokens to a fresh salt — so
        # a retired link with no newer one for its holder was reopened,
        # not reminded.
        if voting_token.superseded_at is not None:
            newer = await self.db.execute(
                select(func.count(VotingToken.id))
                .where(VotingToken.election_id == voting_token.election_id)
                .where(VotingToken.voter_hash == voting_token.voter_hash)
                .where(VotingToken.superseded_at.is_(None))
                .where(VotingToken.id != voting_token.id)
            )
            if (newer.scalar() or 0) > 0:
                return None, None, SUPERSEDED_TOKEN_MESSAGE
            return None, None, REOPENED_TOKEN_MESSAGE

        # Check if token has expired
        token_exp = self._ensure_utc(voting_token.expires_at)
        if datetime.now(timezone.utc) > token_exp:
            return None, None, "Voting token has expired"

        # Check if token has already been fully used
        if voting_token.used:
            return None, None, "This ballot has already been fully submitted"

        # Record the first open only. ``access_count`` is incremented on a
        # successful submit, not here: every ballot page load and every
        # refused submit re-enters this lookup, so a member whose ballot
        # was rejected six times read as seven "accesses" in forensics and
        # a single successful ballot was indistinguishable from a replayed
        # link (W50-54).
        if not voting_token.first_accessed_at:
            voting_token.first_accessed_at = datetime.now(timezone.utc)
            await self.db.commit()

        # Get the election
        election_result = await self.db.execute(
            select(Election).where(Election.id == voting_token.election_id)
        )
        election = election_result.scalar_one_or_none()

        if not election:
            return None, None, "Election not found"

        # Check if election is still open. This runs before the frozen-roll
        # compare: closing destroys the anonymity salt, so after close every
        # token's hash fails the roll check and a member who did vote was
        # told they were never on the roll (W50-44).
        now = datetime.now(timezone.utc)
        if election.status == ElectionStatus.CLOSED:
            return None, None, "Voting has closed"

        window_error = self._token_window_error(election, voting_token, now)
        if window_error:
            return None, None, window_error

        # Defense in depth for tokens issued before the roll was frozen (or
        # by an older application node): a credential cannot bypass the same
        # frozen-roll boundary enforced by authenticated voting. Test tokens
        # are exempt — they only ever produce is_test votes (excluded from
        # results/stats/rosters), and test previews are deliberately sendable
        # to admins who are not on the frozen roll.
        if not voting_token.is_test and not self._token_voter_is_on_frozen_roll(
            election, voting_token
        ):
            if election.voter_anonymity_salt is None:
                # An open election with no salt was closed and reopened: the
                # close destroyed the salt this link's hash was keyed to, so
                # the compare cannot say whether the holder is on the roll —
                # only that the link predates the reopen and a re-sent
                # ballot is the way back in.
                return None, None, REOPENED_TOKEN_MESSAGE
            return (
                None,
                None,
                (
                    "You are not on the voter roll that was frozen when this "
                    "election opened"
                ),
            )

        return election, voting_token, None

    async def _lock_token_ballot_for_submission(
        self, election: Election, voting_token: VotingToken
    ) -> Tuple[Optional[Election], Optional[VotingToken], Optional[str]]:
        """Serialize token submissions with election lifecycle and vote writes.

        ``get_ballot_by_token`` commits its access counter, so its validation is
        necessarily optimistic. Re-lock both rows in the same order used by the
        rest of the voting lifecycle, then re-check mutable state. Besides closing
        the token replay race, the election lock serializes updates to
        ``last_chain_hash`` so concurrent ballots cannot fork the vote audit chain.

        Both re-selects need ``populate_existing=True``, not just
        ``with_for_update()``. ``get_ballot_by_token`` already loaded this same
        ``election``/``voting_token`` pair into the session's identity map (and
        ``expire_on_commit=False`` means its commit does not expire them), so a
        re-SELECT for a primary key already in the identity map returns the
        cached Python object without copying the new row's columns onto it —
        the lock is acquired at the SQL level, but ``locked_token.used`` /
        ``locked_election.status`` would still read the pre-lock value. Same
        requirement as ``quorum_service.py``'s ``calculate_quorum`` fix.
        """
        election_result = await self.db.execute(
            select(Election)
            .where(Election.id == election.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        locked_election = election_result.scalar_one_or_none()
        if not locked_election:
            return None, None, "Election not found"

        token_result = await self.db.execute(
            select(VotingToken)
            .where(VotingToken.id == voting_token.id)
            .where(VotingToken.election_id == locked_election.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        locked_token = token_result.scalar_one_or_none()
        if not locked_token:
            return None, None, "Invalid voting token"
        if locked_token.used:
            return None, None, "This ballot has already been fully submitted"
        if locked_token.superseded_at is not None:
            return None, None, SUPERSEDED_TOKEN_MESSAGE

        now = datetime.now(timezone.utc)
        if now > self._ensure_utc(locked_token.expires_at):
            return None, None, "Voting token has expired"
        if locked_election.status not in (ElectionStatus.OPEN, ElectionStatus.DRAFT):
            return None, None, "Election is not open for voting"
        window_error = self._token_window_error(locked_election, locked_token, now)
        if window_error:
            return None, None, window_error

        return locked_election, locked_token, None

    def _token_window_error(
        self, election: Election, voting_token: VotingToken, now: datetime
    ) -> Optional[str]:
        """Whether this token may be used on this election right now.

        A live token needs an OPEN election inside its voting window. A test
        token (``send-test-ballot``) may also be used on a DRAFT — that is
        the preview Election Settings offers, and drafts are the only
        elections it offers it for (W50-19, owner decision 2026-10-05). A
        draft's scheduled start is usually still ahead, so the start is not
        enforced for it; the end is, since a draft past its end cannot open.
        Nothing a test token writes counts: its votes are ``is_test``,
        namespaced in the dedup hash and excluded from every tally, roster
        and the candidate-edit guard (``_active_vote_count``).
        """
        start = self._ensure_utc(election.start_date)
        end = self._ensure_utc(election.end_date)
        draft_preview = election.status == ElectionStatus.DRAFT and bool(
            voting_token.is_test
        )
        if election.status != ElectionStatus.OPEN and not draft_preview:
            return f"Election is {election.status.value}"
        if start and now < start and not draft_preview:
            return "Voting has not started yet"
        if end and now > end:
            return "Voting has ended"
        return None

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

        election, voting_token, error = await self._lock_token_ballot_for_submission(
            election, voting_token
        )
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

        # Fall back to candidate.position so omitting the position field
        # can't bypass either eligibility check below.
        effective_position = position or candidate.position

        # A candidate is either scoped to a ballot item or a plain position
        # (`election.positions`) — an election can configure both at once,
        # so which eligibility snapshot governs this vote has to be decided
        # per-candidate, not per-election. Candidates are matched to their
        # ballot item the same way the voting UI and check_voter_eligibility
        # already do: by the item's own "position" field when set, or by
        # the item's title/id for legacy items created without one (see
        # ballot_item_candidate_positions).
        matching_item = (
            next(
                (
                    item
                    for item in election.ballot_items
                    if effective_position is not None
                    and effective_position in ballot_item_candidate_positions(item)
                ),
                None,
            )
            if election.ballot_items
            else None
        )

        # Enforce the token's per-item AND (when this candidate's position
        # collides with a plain election.positions entry, ELEC-29)
        # per-position eligibility snapshots — shared with the bulk route
        # in `_token_eligibility_error` (ELEC-33) so the two routes cannot
        # drift again. Without the item check, a token scoped to one
        # ballot item could vote on any other item's candidate via this
        # single-vote route (R-1).
        eligibility_error = _token_eligibility_error(
            voting_token, election, effective_position, matching_item
        )
        if eligibility_error:
            return None, eligibility_error

        # Method-aware duplicate and limit checks — the token-path mirror of
        # cast_vote's rules (R-D5): approval records one vote per approved
        # candidate and ranked choice one per rank, so a blanket "already
        # voted for this position" rule would reject every legitimate second
        # vote. For a positionless vote, match only other positionless votes —
        # `Vote.position == None if position is None` would otherwise degrade
        # to a no-op filter and any prior vote (for any position) would block.
        # Match is_test so a manager's test ballot never consumes their real
        # vote slot — mirroring the `test:` namespace in the dedup hash.
        # Votes stored before position normalization have position IS NULL
        # (with NULL-based dedup hashes), so a same-position filter alone
        # would let a token that voted pre-deploy cast a second counted vote.
        # Handled at read time — no migration: a NULL-position vote for a
        # candidate running for the effective position counts as a vote for
        # that position.
        #
        # A legacy ballot item (no explicit "position" field) can have prior
        # votes stored under either of its aliases — its title (this route's
        # historical convention, via candidate.position) or its id (the
        # bulk route's convention, `submit_ballot_with_token` below) —
        # depending on which route cast them. Matching only
        # `effective_position` missed the other route's rows, letting the
        # same voter cast one vote through each (Codex round 7, ELEC-34).
        # Compare against every alias this item's candidates can be keyed
        # under, not just the one this call resolved.
        # Scoped, not the raw alias set: a legacy item's title can equal a
        # different item's id/explicit position (ELEC-38), and this route's
        # own duplicate/limit checks below key off `position_votes` alone —
        # unlike the bulk route, there is no separate candidate-ownership
        # use of this alias set to preserve, so it is safe to narrow here
        # too (see _dedup_scoped_item_aliases).
        position_aliases = (
            _dedup_scoped_item_aliases(matching_item, election.ballot_items or [])
            if matching_item is not None
            else ({effective_position} if effective_position else set())
        )
        if effective_position:
            position_filter = or_(
                Vote.position.in_(position_aliases),
                and_(
                    Vote.position.is_(None),
                    Vote.candidate_id.in_(
                        select(Candidate.id)
                        .where(Candidate.election_id == election.id)
                        .where(Candidate.position.in_(position_aliases))
                    ),
                ),
            )
        else:
            position_filter = Vote.position.is_(None)
        existing_votes_result = await self.db.execute(
            select(Vote)
            .where(Vote.election_id == election.id)
            .where(Vote.voter_hash == voting_token.voter_hash)
            .where(Vote.is_test == voting_token.is_test)
            .where(Vote.deleted_at.is_(None))
            .where(position_filter)
        )
        position_votes = existing_votes_result.scalars().all()

        if election.voting_method == "ranked_choice":
            if any(v.vote_rank == vote_rank for v in position_votes):
                return None, (
                    f"You have already cast a rank-{vote_rank} vote"
                    + (f" for {effective_position}" if effective_position else "")
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
                if effective_position:
                    if max_votes == 1:
                        return None, f"You have already voted for {effective_position}"
                    return None, f"Maximum votes for {effective_position} reached"
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
            position=effective_position,
            vote_rank=vote_rank,
            ip_address=ip_address,
            user_agent=user_agent,
            voted_at=datetime.now(timezone.utc).replace(microsecond=0),
            is_test=voting_token.is_test,
            vote_dedup_hash=self._compute_vote_dedup_hash(
                election.id,
                dedup_voter,
                _dedup_position_key(matching_item, effective_position),
                discriminator=self._dedup_discriminator(
                    election, candidate_id, vote_rank, item=matching_item
                ),
            ),
        )

        # Sign the vote for tampering detection
        self._apply_vote_signature(vote)

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

        # Track which positions have been voted on via this token. Use the
        # effective position (falls back to candidate.position), not the raw
        # submitted one — an omitted position field would otherwise never
        # mark the token as having voted for it, leaving the token reusable
        # for that position and never completing (used=True) below.
        positions_voted = copy.deepcopy(voting_token.positions_voted or [])
        if effective_position and effective_position not in positions_voted:
            positions_voted.append(effective_position)
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
        # A mixed election's token can owe votes in BOTH scopes at once —
        # plain positions AND ballot items — since this single-vote route
        # also accepts item-scoped candidates (see `matching_item` above).
        # Folding each eligible item's candidate-position label(s) into the
        # same completion set `election_positions` already uses means
        # "covered every position in eligible_positions" can no longer be
        # mistaken for "ballot fully cast" while an eligible item is still
        # unvoted — completion has to cover whichever scopes this token is
        # actually eligible for (Codex round 6, ELEC-32). None
        # eligible_item_ids = unrestricted (every ballot item), mirroring
        # the None handling for eligible_positions above.
        eligible_item_ids = (
            set(voting_token.eligible_item_ids)
            if voting_token.eligible_item_ids is not None
            else None
        )
        item_position_labels: set = set()
        for item in election.ballot_items or []:
            if eligible_item_ids is None or item.get("id") in eligible_item_ids:
                item_position_labels |= ballot_item_candidate_positions(item)
        required_labels = set(election_positions) | item_position_labels
        if not multi_vote_method:
            if not required_labels:
                # Nothing owed in either scope — token used after first vote.
                voting_token.used = True
                voting_token.used_at = datetime.now(timezone.utc)
            else:
                # Multi-scope — check if every owed position AND item has
                # now been covered.
                remaining = required_labels - set(positions_voted)
                if not remaining:
                    voting_token.used = True
                    voting_token.used_at = datetime.now(timezone.utc)

        voting_token.access_count += 1

        # Snapshot before the commit: rollback expires ``election`` and a
        # lazy load in the except branch raises MissingGreenlet (W50-6).
        election_id_str = str(election.id)
        audit_ip = self._audit_ip(election, ip_address)

        # SECURITY: Database-level unique constraint on vote_dedup_hash
        # prevents double-voting even if race condition bypasses application checks
        try:
            await self.db.commit()
            await self.db.refresh(vote)
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Token double-vote attempt blocked | election={election_id_str} position={position}"
            )
            await self._audit(
                "vote_double_attempt_token",
                {
                    "election_id": election_id_str,
                    "position": position,
                },
                severity="warning",
                ip_address=audit_ip,
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

        election, voting_token, error = await self._lock_token_ballot_for_submission(
            election, voting_token
        )
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

        # The token is one-shot, so the ballot is atomic: an item id the
        # election no longer has (a link issued before a rollback-to-draft
        # rewrote the items, or a mis-addressed payload) must refuse the
        # whole submission before anything is written, leaving the token
        # unused so the voter can reload and resubmit. Skipping the vote and
        # consuming the token would burn a member's only ballot on a
        # "success" that recorded nothing.
        if any(v.get("ballot_item_id") not in item_map for v in votes):
            return None, (
                "This ballot is out of date — it names items that are no "
                "longer on the election. Reload the ballot and try again."
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
            """Build/sign/chain one Vote row and append it to created_votes.

            ``vote_position`` is always the caller's already-canonical
            ``ballot_item.get("position") or ballot_item_id`` (see the loop
            below) — exactly what ``_dedup_position_key()`` would also
            return for this item, so it is used directly for the dedup
            hash here rather than routed through that helper a second time.
            ``cast_vote_with_token`` is the one route that still needs the
            helper, since its hash input (``effective_position``) is not
            already in this canonical form for a legacy item (ELEC-34).
            """
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
            self._apply_vote_signature(new_vote)
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

            ballot_item = item_map[ballot_item_id]

            # Handle abstain — no vote recorded. No selection at all counts
            # as an abstention too (the schema allows omitting all forms).
            if choice == "abstain" or (
                choice is None and not candidate_ids and not rankings
            ):
                abstentions += 1
                continue

            # Determine the position for this vote (use ballot item id as position)
            position = ballot_item.get("position") or ballot_item_id

            # Enforce per-item eligibility (voter types / attendance were
            # evaluated when the ballot was issued and snapshotted on the
            # token) AND, when this item's position collides with a
            # restricted plain `election.positions` entry (ELEC-29), the
            # position-eligibility snapshot too. Shared with
            # cast_vote_with_token via `_token_eligibility_error` (ELEC-33)
            # so this collision-aware check can't drift between the two
            # vote-submission routes again: before ELEC-33, this bulk route
            # only ever checked `eligible_item_ids`, so a token ineligible
            # for a colliding plain position (`eligible_positions=[]`)
            # could still submit that position's candidate here.
            # SECURITY: without the item-eligibility half, any token holder
            # could vote on items restricted to other member classes by
            # POSTing their ids.
            eligibility_error = _token_eligibility_error(
                voting_token,
                election,
                position,
                ballot_item,
                ineligible_item_message=(
                    "You are not eligible to vote on: "
                    f"{ballot_item.get('title', ballot_item_id)}"
                ),
            )
            if eligibility_error:
                return None, eligibility_error

            # The set of candidate.position values that legitimately belong
            # to this item — broader than `position` above, which is only
            # the *storage* value for new votes. A legacy item persisted
            # without its own "position" field has candidates keyed to its
            # title instead of its id (see ballot_item_candidate_positions);
            # comparing against `position` alone would reject every one of
            # those candidates here even though they are exactly who this
            # item's ballot is for.
            item_candidate_positions = ballot_item_candidate_positions(ballot_item)

            # Check if already voted for this position (prevents double-voting
            # within the ballot). Match is_test so a test ballot never blocks
            # the same member's real ballot — mirroring the dedup-hash
            # namespace (`test:` prefix). Votes stored before position
            # normalization have position IS NULL, so a same-position filter
            # alone would let a token that voted pre-deploy vote again —
            # treat a NULL-position vote for a candidate whose position is
            # in item_candidate_positions (not just `position` itself) as a
            # vote on this item: a legacy item's candidates may be keyed by
            # title instead of the item id (read-time handling, no
            # migration). Using `position` alone here would miss a NULL-
            # position vote cast against a title-keyed legacy candidate,
            # letting the same voter cast a second, differently-keyed vote
            # for the same contest.
            #
            # The non-NULL branch has the same gap one level up: a legacy
            # item's votes may already be stored under either alias —
            # `position` (this route's own convention, the item id) or the
            # item's title (cast_vote_with_token's historical convention,
            # via candidate.position) — depending on which route cast them.
            # Matching only `position` missed a prior vote cast through the
            # other route, letting the same voter cast one vote through each
            # (Codex round 7, ELEC-34).
            #
            # For THIS check specifically (not candidate ownership above),
            # use the collision-scoped alias set rather than the full one:
            # the schema enforces only unique item ids, so a legacy item's
            # title fallback can equal a DIFFERENT item's id, and matching
            # on the raw alias would treat that other item's already-stored
            # vote as a duplicate of this one (Codex round 9, ELEC-38).
            # Dropping a colliding fallback alias here is safe — new votes
            # for a legacy item are always dedup-hashed against its own
            # canonical id, never its title, so the UNIQUE constraint on
            # vote_dedup_hash still catches a genuine repeat on this exact
            # item even when this pre-check no longer does.
            dedup_check_positions = _dedup_scoped_item_aliases(
                ballot_item, ballot_items
            )
            existing_check = await self.db.execute(
                select(Vote)
                .where(Vote.election_id == election.id)
                .where(Vote.voter_hash == voting_token.voter_hash)
                .where(Vote.is_test == voting_token.is_test)
                .where(
                    or_(
                        Vote.position.in_(dedup_check_positions),
                        and_(
                            Vote.position.is_(None),
                            Vote.candidate_id.in_(
                                select(Candidate.id)
                                .where(Candidate.election_id == election.id)
                                .where(Candidate.position.in_(dedup_check_positions))
                            ),
                        ),
                    )
                )
                .where(Vote.deleted_at.is_(None))
                .limit(1)
            )
            if existing_check.scalars().first():
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
                    if (
                        not ranked_candidate
                        or ranked_candidate.position not in item_candidate_positions
                    ):
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
                    if (
                        not multi_candidate
                        or multi_candidate.position not in item_candidate_positions
                    ):
                        return (
                            None,
                            f"Invalid candidate selection for: {item_title}",
                        )
                    _create_token_vote(UUID(cid), position, None, f"cand:{cid}")
                continue

            # Determine candidate_id based on choice
            candidate_id = None

            if choice == "write_in":
                if not election.allow_write_ins:
                    return (
                        None,
                        f"Write-in votes are not allowed for: {item_title}",
                    )
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
                # Choice is a candidate UUID. Must belong to *this* ballot
                # item's position — same check the rankings/candidate_ids
                # branches above already make — or a crafted submission
                # could select a candidate from ballot item A while naming
                # item B, binding an otherwise-uneligible candidate onto B's
                # position (_create_token_vote below stores it there).
                choice_candidate = candidate_map.get(choice)
                if (
                    choice_candidate is None
                    or choice_candidate.position not in item_candidate_positions
                ):
                    return (
                        None,
                        f"Invalid candidate selection for: {ballot_item.get('title', ballot_item_id)}",
                    )
                candidate_id = UUID(choice)

            # The write-in name is stored verbatim (stripped above), never
            # HTML-escaped: escaping at the write expanded a schema-legal
            # 200-char name past the String(200) column (DataError -> 500),
            # and every renderer (React text nodes, the results email)
            # escapes at output anyway, so a stored `&amp;` displayed as
            # the literal text `&amp;`.

            # Single-selection path (write-in/approve/deny/plain-UUID choice).
            # Discriminator is resolved the same way the single-vote route
            # resolves it (`_dedup_discriminator`, item-aware since ELEC-37)
            # rather than hardcoded "": when this item overrides the
            # election's voting method to "approval", the single-vote route
            # already hashes this candidate with a `cand:{id}` discriminator,
            # and this backward-compatible `choice` form is still accepted
            # for an approval-overridden item (nothing method-gates it the
            # way the `rankings`/`candidate_ids` branches above are gated).
            # Hardcoding "" here left the two routes hashing the same
            # logical approval vote differently, so two tokens racing
            # through the two forms could both pass the pre-check and the
            # UNIQUE constraint on `vote_dedup_hash` never saw a collision
            # (Codex round 10). For every other method this still resolves
            # to "" exactly as before — byte-identical dedup hashes with
            # rows written before the multi-select forms existed.
            _create_token_vote(
                candidate_id,
                position,
                None,
                self._dedup_discriminator(
                    election, candidate_id, None, item=ballot_item
                ),
            )

        # Mark token as fully used
        voting_token.used = True
        voting_token.used_at = datetime.now(timezone.utc)
        voting_token.access_count += 1
        voting_token.positions_voted = [
            v.get("ballot_item_id")
            for v in votes
            if v.get("choice") not in (None, "abstain")
            or v.get("candidate_ids")
            or v.get("rankings")
        ]

        # Snapshot before the commit: rollback expires ``election`` and a
        # lazy load in the except branch raises MissingGreenlet (W50-6).
        election_id_str = str(election.id)
        audit_ip = self._audit_ip(election, ip_address)

        # Commit all votes atomically
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            logger.warning(
                f"Ballot double-submission blocked | election={election_id_str}"
            )
            await self._audit(
                "vote_double_attempt_token",
                {
                    "election_id": election_id_str,
                    "type": "bulk_ballot_submission",
                },
                severity="warning",
                ip_address=audit_ip,
            )
            return None, "This ballot has already been submitted"

        logger.info(
            f"Ballot submitted | election={election.id} "
            f"votes={len(created_votes)} abstentions={abstentions}"
        )
        audit_data = {
            "election_id": str(election.id),
            "votes_cast": len(created_votes),
            "abstentions": abstentions,
        }
        # The vote ids are what an officer needs to void one of these votes
        # from the forensics panel, which is the only place a token ballot
        # is visible. On an anonymous ballot they stay out: one row listing
        # every vote of a ballot ties the voter's choices together, which
        # the per-vote rows exist to prevent (W50-54).
        if not election.anonymous_voting:
            audit_data["vote_ids"] = [str(v.id) for v in created_votes]
        await self._audit(
            "ballot_submitted_token",
            audit_data,
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

        # Check who has voted (for live status). The hash match runs for
        # every election — a named election's link votes carry only the
        # hash — and named elections add the id-only rows written in-app.
        voted_user_ids: set = set()
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
        if not election.anonymous_voting:
            vote_result = await self.db.execute(
                select(Vote.voter_id)
                .where(Vote.election_id == str(election_id))
                .where(Vote.voter_id.isnot(None))
                .where(Vote.deleted_at.is_(None))
                .where(Vote.is_test.is_(False))
            )
            voted_user_ids |= {str(r[0]) for r in vote_result.all() if r[0]}

        ballot_items = election.ballot_items or []
        override_user_ids = {o.get("user_id") for o in (election.voter_overrides or [])}

        # The roll frozen at open. None means the election has not opened
        # (or predates the freeze) and eligibility is evaluated live — which
        # is also what open_election reads to build the snapshot. Once it
        # exists, send_ballot_emails skips anyone not on it who holds no
        # override, so the roster must not promise them a ballot (W50-55).
        frozen_roster = getattr(election, "eligible_roster_snapshot", None)
        frozen_roster_ids = (
            {str(uid) for uid in frozen_roster} if frozen_roster is not None else None
        )
        ballot_recipient_ids = {str(uid) for uid in (election.email_recipients or [])}

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

            # A member outside a restricted voter list is never handed to
            # the send, so that reason stays; everyone else the send would
            # turn away at the frozen roll gets the reason the send records.
            if (
                frozen_roster_ids is not None
                and not has_override
                and in_eligible_list
                and user_id not in frozen_roster_ids
            ):
                will_receive_ballot = False
                overall_reason = self.NOT_ON_FROZEN_ROLL

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
                    "ballot_sent": user_id in ballot_recipient_ids,
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
            "total_ballots_sent": sum(1 for r in roster if r["ballot_sent"]),
            "email_sent_at": election.email_sent_at,
            "roster": roster,
        }
