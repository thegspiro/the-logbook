"""
Election API Endpoints

Endpoints for election management including elections, candidates, voting, and results.
"""

import copy
import hashlib
import unicodedata
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit, get_client_ip
from app.core.utils import list_within_detail_limit, safe_error_detail
from app.models.election import (
    BallotSendJobKind,
    Candidate,
    Election,
    ElectionStatus,
    ManualBallotBatch,
    SavedBallotTemplate,
    Vote,
)
from app.models.event import Event, EventRSVP, RSVPStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import Organization, User
from app.schemas.column_bounds import INT32_MAX
from app.schemas.election import (
    VALID_QUORUM_TYPES,
    VALID_VICTORY_CONDITIONS,
    VALID_VOTING_METHODS,
    AttendeeCheckIn,
    AttendeeCheckInResponse,
    AttendeeListResponse,
    AttestManualBallotsResponse,
    BallotCandidateResponse,
    BallotElectionResponse,
    BallotItem,
    BallotPreviewResponse,
    BallotSendJobResponse,
    BallotSubmission,
    BallotSubmissionResponse,
    BallotTemplatesResponse,
    BulkVoteCreate,
    BulkVoterOverrideResponse,
    CandidateCreate,
    CandidateResponse,
    CandidateUpdate,
    CloneElectionRequest,
    ElectionCreate,
    ElectionDelete,
    ElectionDeleteResponse,
    ElectionListResponse,
    ElectionReportResponse,
    ElectionResponse,
    ElectionResults,
    ElectionRollback,
    ElectionRollbackResponse,
    ElectionSettingsResponse,
    ElectionStats,
    ElectionUpdate,
    EligibilityDefaults,
    EligibilityRosterResponse,
    EmailBallot,
    EmailBallotResponse,
    ForensicsResponse,
    ImportMeetingAttendeesResponse,
    ManualBallotBatchListResponse,
    ManualBallotsRequest,
    ManualBallotsResponse,
    MemberBallotResponse,
    MemberBallotSubmission,
    MemberVotingEligibilityResponse,
    MemberVotingEligibilityUpdate,
    MemberWaitOutcome,
    MergeWriteInsRequest,
    MergeWriteInsResponse,
    MyProxyAuthorizationsResponse,
    NominationActionResponse,
    NominationCreate,
    NonVotersResponse,
    PackageRecipientsResponse,
    PreMeetingPackageResponse,
    PreMeetingPackageSend,
    ProxyAuthorizationCreate,
    ProxyAuthorizationListResponse,
    ProxyAuthorizationResponse,
    ProxyVoteCreate,
    SavedBallotTemplateCreate,
    SavedBallotTemplateResponse,
    SoftDeleteVoteResponse,
    SuccessResponse,
    TestBallotResponse,
    VoidManualBallotsRequest,
    VoidManualBallotsResponse,
    VoteCreate,
    VoteIntegrityResponse,
    VoteReceiptResponse,
    VoterEligibility,
    VoteResponse,
    VoterOverrideListResponse,
    VoterOverrideRecord,
    seat_rule_error,
)
from app.services.ballot_send_jobs import (
    BALLOT_GUARD_KINDS,
    PACKAGE_GUARD_KINDS,
    PACKAGE_IN_PROGRESS_DETAIL,
    SEND_IN_PROGRESS_DETAIL,
    BallotSend,
    NominationsAnnouncementSend,
    PackageSend,
    QueuedSend,
    ReminderSend,
    enqueue_send,
    ensure_election_open,
    find_active_job,
    get_job,
    job_response,
    latest_job,
    perform_ballot_send,
    perform_reminder_send,
    queue_automatic_send,
)
from app.services.election_service import (
    ElectionService,
    ballot_item_candidate_positions,
    office_ineligible_message,
    position_ballot_items,
)
from app.services.membership_tier_service import (
    MembershipTierService,
    evaluate_wait,
    wait_ineligibility_reason,
)
from app.utils.membership import (
    VOTER_TYPE_LABELS,
    voter_type_decided_by_class,
    voter_type_key,
)
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_all_in_org, assert_in_org
from app.utils.org_timezone import (
    local_date,
    org_today,
    resolve_scheduling_timezone,
    today_in,
)

router = APIRouter()

# ELEC-12 (owner decision 2026-10-05): every Ballot Builder load returns the
# whole list, so the bound is on creation rather than on the response — a cap
# leaves the list contract untouched. 200 is far above any department's real
# use and keeps the unpaginated list cheap.
MAX_SAVED_BALLOT_TEMPLATES_PER_ORG = 200


# Rate-limit factories for public ballot endpoints (no auth required).
# SECURITY (ELEC-41): these must be `async def` and `await` check_rate_limit —
# check_rate_limit is itself `async def`, so a plain `def` wrapper that
# returns its call without awaiting it only constructs a coroutine and never
# runs the limiter's body (no exception is ever raised, regardless of request
# volume). FastAPI decides sync-vs-await by inspecting the dependency
# callable itself, not its return value, so this silently disabled rate
# limiting on every one of this module's public token routes.
async def _ballot_read_rate_limit(
    request: Request,
) -> None:
    """10 requests/minute per IP for ballot reads."""
    return await check_rate_limit(
        request,
        max_requests=10,
        window_seconds=60,
        lockout_seconds=300,
        scope="ballot_read",
    )


def _already_voted_detail(position: Optional[str]) -> str:
    if position:
        return f"You have already voted on: {position}"
    return "You have already voted in this election"


async def _ballot_vote_rate_limit(
    request: Request,
) -> None:
    """5 requests/minute per IP for vote submissions."""
    return await check_rate_limit(
        request,
        max_requests=5,
        window_seconds=60,
        lockout_seconds=600,
        scope="ballot_vote",
    )


async def _load_meeting_for_election(db: AsyncSession, election: Election) -> None:
    """Eagerly load the meeting relationship if not already loaded."""
    if election.meeting_id and not election.meeting:
        # Defense-in-depth: org-scope the meeting fetch so a stale/foreign
        # meeting_id can never surface another org's meeting in the response.
        result = await db.execute(
            select(Meeting).where(
                Meeting.id == election.meeting_id,
                Meeting.organization_id == str(election.organization_id),
            )
        )
        election.meeting = result.scalar_one_or_none()


async def _validate_election_links(
    db: AsyncSession, organization_id, meeting_id, event_id, eligible_voters=None
) -> None:
    """Reject a client-supplied meeting_id/event_id that isn't in the caller's org.

    Without this, an admin could point their election at another org's meeting
    or event id and read that org's attendee roster back through the
    import-attendees and election-detail endpoints (XC-1 cross-tenant leak).

    ``eligible_voters`` is a JSON list of member ids. Every reader re-filters it
    by organization, so a foreign id reaches no one — but it would still be
    stored as a dangling reference and counted nowhere, silently shrinking the
    roster the officer believes they set (XC-1).
    """
    if meeting_id:
        await assert_in_org(db, Meeting, meeting_id, organization_id, label="meeting")
    if event_id:
        await assert_in_org(db, Event, event_id, organization_id, label="event")
    await assert_all_in_org(
        db, User, eligible_voters, organization_id, label="eligible voter"
    )


def _withholds_live_detail(election: Election, viewer: Optional[User]) -> bool:
    """Whether ``viewer`` must not see who was sent a ballot or how many
    have voted (W50-70, owner decision 2026-10-08).

    While voting is open those are the election managers' alone: a member
    reading the turnout mid-vote (or which named members got a ballot) can
    act on it, which is why ``/results`` is already refused to them. A
    ``results_visible_immediately`` election deliberately shows its tally,
    so its counts stay; the recipient list never does.
    """
    return (
        viewer is not None
        and election.status == ElectionStatus.OPEN
        and not user_has_permission(viewer, "elections.manage")
    )


async def _build_election_response(
    db: AsyncSession, election: Election, viewer: Optional[User] = None
) -> ElectionResponse:
    """Build an ElectionResponse with meeting details populated.

    ``viewer`` is the caller on a route an ``elections.view`` member can
    reach; the open election's recipient list, voter list and (unless the
    results are public) live counts are then withheld (W50-70).
    """
    await _load_meeting_for_election(db, election)
    response: ElectionResponse = ElectionResponse.model_validate(election)
    # `total_votes`, `total_voters` and `voter_turnout_percentage` are declared
    # on the response but are not columns, so validating off the ORM row left
    # all three null on every detail fetch. The Publish Results panel reads
    # them, and so reported "No votes cast yet" beside a finished tally.
    (
        response.total_votes,
        response.total_voters,
        response.voter_turnout_percentage,
    ) = await ElectionService(db).get_vote_totals(
        election, UUID(str(election.organization_id))
    )
    response.closed_by_name = await ElectionService(db).closed_by_name(election)
    (
        response.ballots_must_be_resent,
        response.ballots_resend_reason,
    ) = await ElectionService(db).ballot_resend_state(election)
    # Nominations run between draft and voting, and closing them returns the
    # election to draft, so the announcement means nothing once voting opens.
    if election.status in (ElectionStatus.NOMINATIONS, ElectionStatus.DRAFT):
        announcement = await latest_job(
            db,
            str(election.id),
            str(election.organization_id),
            kind=BallotSendJobKind.ANNOUNCEMENT.value,
        )
        if announcement is not None and (
            viewer is None or user_has_permission(viewer, "elections.manage")
        ):
            response.nominations_announcement = job_response(announcement)
    if election.meeting:
        response.meeting_title = election.meeting.title
        response.meeting_type = (
            election.meeting.meeting_type.value
            if hasattr(election.meeting.meeting_type, "value")
            else election.meeting.meeting_type
        )
    if _withholds_live_detail(election, viewer):
        response.email_recipients = None
        response.eligible_voters = None
        response.ballots_must_be_resent = False
        response.ballots_resend_reason = None
        if not election.results_visible_immediately:
            response.total_votes = None
            response.total_voters = None
            response.voter_turnout_percentage = None
    return response


# ============================================
# Election Endpoints
# ============================================


@router.get("", response_model=list[ElectionListResponse])
async def list_elections(
    status_filter: str | None = None,
    event_id: str | None = None,
    meeting_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    List all elections

    **Authentication required**
    **Requires permission: elections.view**
    """
    query = select(Election).where(
        Election.organization_id == str(current_user.organization_id)
    )

    if status_filter:
        try:
            status_enum = ElectionStatus(status_filter)
            query = query.where(Election.status == status_enum)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {status_filter}",
            )

    if event_id:
        query = query.where(Election.event_id == event_id)

    if meeting_id:
        query = query.where(Election.meeting_id == meeting_id)

    query = query.order_by(Election.start_date.desc())

    result = await db.execute(query)
    elections = result.scalars().all()

    # Batch-fetch vote counts in a single query instead of N+1
    election_ids = [e.id for e in elections]
    vote_counts_map: dict = {}
    if election_ids:
        pending_manual_batch = select(ManualBallotBatch.id).where(
            ManualBallotBatch.id == Vote.manual_batch_id,
            ManualBallotBatch.election_id == Vote.election_id,
            ManualBallotBatch.status == "pending",
        )
        vote_counts_result = await db.execute(
            select(Vote.election_id, func.count(Vote.id))
            .where(Vote.election_id.in_(election_ids))
            .where(Vote.deleted_at.is_(None))
            .where(Vote.is_test.is_(False))
            .where(~pending_manual_batch.exists())
            .group_by(Vote.election_id)
        )
        vote_counts_map = dict(vote_counts_result.all())

    # Batch-fetch meeting titles for elections linked to meetings
    meeting_ids = [e.meeting_id for e in elections if e.meeting_id]
    meeting_map: dict = {}
    if meeting_ids:
        meetings_result = await db.execute(
            select(Meeting.id, Meeting.title, Meeting.meeting_date).where(
                Meeting.id.in_(meeting_ids),
                Meeting.organization_id == str(current_user.organization_id),
            )
        )
        for mid, mtitle, mdate in meetings_result.all():
            meeting_map[mid] = {"title": mtitle, "meeting_date": mdate}

    response_elections = []
    for election in elections:
        meeting_info = meeting_map.get(election.meeting_id, {})
        response_elections.append(
            ElectionListResponse(
                id=election.id,
                title=election.title,
                election_type=election.election_type,
                start_date=election.start_date,
                end_date=election.end_date,
                status=election.status.value,
                closed_at=election.closed_at,
                positions=election.positions,
                total_votes=(
                    None
                    if _withholds_live_detail(election, current_user)
                    and not election.results_visible_immediately
                    else vote_counts_map.get(election.id, 0)
                ),
                meeting_id=election.meeting_id,
                meeting_title=meeting_info.get("title"),
                meeting_date=meeting_info.get("meeting_date"),
                is_runoff=election.is_runoff,
                parent_election_id=election.parent_election_id,
                runoff_round=election.runoff_round,
                enable_runoffs=election.enable_runoffs,
            )
        )

    return response_elections


@router.post("", response_model=ElectionResponse, status_code=status.HTTP_201_CREATED)
async def create_election(
    election: ElectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Create a new election

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Validate dates
    if election.end_date <= election.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End date must be after start date",
        )

    import secrets as _secrets

    election_data = election.model_dump()
    # Validate client-supplied meeting/event links belong to the caller's org
    # before storing them (XC-1).
    try:
        await _validate_election_links(
            db,
            current_user.organization_id,
            election_data.get("meeting_id"),
            election_data.get("event_id"),
            election_data.get("eligible_voters"),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    # After the link check: the meeting kind is read from the linked meeting,
    # which must be known to be the caller's own first.
    await _apply_eligibility_defaults(
        db, current_user.organization_id, election, election_data
    )
    # Convert UUID objects to strings for JSON-serializable storage
    if election_data.get("eligible_voters"):
        election_data["eligible_voters"] = [
            str(v) for v in election_data["eligible_voters"]
        ]
    new_election = Election(
        id=uuid4(),
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        status=ElectionStatus.DRAFT,
        # SEC-12: Generate per-election salt for anonymous voter hash privacy
        voter_anonymity_salt=_secrets.token_hex(32),
        **election_data,
    )

    db.add(new_election)
    await db.commit()
    await db.refresh(new_election)

    logger.info(
        f"Election created | id={new_election.id} title={election.title!r} by={current_user.id}"
    )
    await log_audit_event(
        db=db,
        event_type="election_created",
        event_category="elections",
        severity="info",
        event_data={
            "election_id": str(new_election.id),
            "title": election.title,
            "election_type": election.election_type,
            "voting_method": election.voting_method,
            "anonymous": election.anonymous_voting,
        },
        user_id=str(current_user.id),
    )

    return await _build_election_response(db, new_election)


# ============================================
# Ballot Templates (must be before /{election_id} wildcard)
# ============================================


@router.get("/templates/ballot-items", response_model=BallotTemplatesResponse)
async def get_ballot_templates(
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get available ballot item templates

    Returns pre-configured templates for common ballot items like
    membership approvals, officer elections, and general resolutions.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    templates = ElectionService.get_ballot_templates()
    return BallotTemplatesResponse(templates=templates)


@router.get(
    "/templates/saved-ballots", response_model=list[SavedBallotTemplateResponse]
)
async def list_saved_ballot_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """List reusable ballot snapshots belonging to the caller's organization."""
    result = await db.execute(
        select(SavedBallotTemplate)
        .where(SavedBallotTemplate.organization_id == str(current_user.organization_id))
        .order_by(SavedBallotTemplate.name)
    )
    return list(result.scalars().all())


@router.post(
    "/templates/saved-ballots",
    response_model=SavedBallotTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_ballot_template(
    payload: SavedBallotTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """Save configuration-only ballot items for later reuse.

    The schema deliberately accepts no election, voter, candidate, token, or
    result fields, preventing a template from becoming a route for copying
    sensitive or stateful election data.
    """
    # Pitfall #27: lock the organization row so two saves arriving together
    # cannot both read 199 and land at 201, and count with a locking read so
    # the count is not answered from a snapshot older than the lock.
    await db.execute(
        select(Organization.id)
        .where(Organization.id == str(current_user.organization_id))
        .with_for_update()
    )
    existing = await db.execute(
        select(SavedBallotTemplate.id)
        .where(SavedBallotTemplate.organization_id == str(current_user.organization_id))
        .with_for_update()
    )
    if len(existing.scalars().all()) >= MAX_SAVED_BALLOT_TEMPLATES_PER_ORG:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This organization has reached the maximum of "
                f"{MAX_SAVED_BALLOT_TEMPLATES_PER_ORG} saved ballot templates. "
                "Delete one you no longer use before saving another."
            ),
        )
    template = SavedBallotTemplate(
        id=str(uuid4()),
        organization_id=str(current_user.organization_id),
        created_by=str(current_user.id),
        name=payload.name,
        name_key=hashlib.sha256(
            unicodedata.normalize("NFKC", payload.name).casefold().encode("utf-8")
        ).hexdigest(),
        description=payload.description,
        ballot_items=[
            item.model_dump(exclude_none=True) for item in payload.ballot_items
        ],
        voting_method=payload.voting_method,
        allow_write_ins=payload.allow_write_ins,
    )
    db.add(template)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A ballot template with this name already exists",
        )
    await db.refresh(template)
    await log_audit_event(
        db=db,
        event_type="ballot_template_created",
        event_category="elections",
        severity="info",
        event_data={"template_id": template.id, "name": template.name},
        user_id=str(current_user.id),
    )
    return template


@router.delete(
    "/templates/saved-ballots/{template_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_saved_ballot_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """Delete an organization-owned reusable ballot snapshot."""
    result = await db.execute(
        select(SavedBallotTemplate).where(
            SavedBallotTemplate.id == str(template_id),
            SavedBallotTemplate.organization_id == str(current_user.organization_id),
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
        )
    template_name = template.name
    await db.delete(template)
    await db.commit()
    await log_audit_event(
        db=db,
        event_type="ballot_template_deleted",
        event_category="elections",
        severity="info",
        event_data={"template_id": str(template_id), "name": template_name},
        user_id=str(current_user.id),
    )


# ============================================
# Anonymous Ballot Endpoints (Token-Based)
# IMPORTANT: These must be defined BEFORE the /{election_id} wildcard
# ============================================


class BallotLookupRequest(BaseModel):
    """Ballot lookup payload — the token travels in the body, never a URL."""

    token: str = Field(..., min_length=1, max_length=256)
    model_config = ConfigDict(extra="forbid")


class BallotLookupResponse(BaseModel):
    """Election view + candidates for a token holder, in one round-trip."""

    election: BallotElectionResponse
    candidates: list[BallotCandidateResponse] = []
    # True for a token minted by send-test-ballot: the page shows a TEST
    # BALLOT banner so a preview is never mistaken for the real thing.
    is_test: bool = False


@router.post("/ballot/lookup", response_model=BallotLookupResponse)
async def lookup_ballot_by_token(
    payload: BallotLookupRequest,
    db: AsyncSession = Depends(get_db),
    _rate: None = Depends(_ballot_read_rate_limit),
):
    """
    Get ballot information and candidates using a voting token

    This endpoint is public (no authentication required) and uses the
    high-entropy token from the email link. The token must be provided in
    the request body (not a query parameter or path segment) so the live
    credential never lands in server/proxy logs or browser history — the
    same rationale as the vote endpoints (R-D3). The emailed link carries
    the token in the URL *fragment*, which browsers never send to servers.

    SECURITY: returns only the minimal ballot view (BallotElectionResponse).
    The full ElectionResponse would leak the member roster — attendees,
    eligible_voters, email_recipients — to any token holder. Ballot items
    are filtered to the ones this voter is eligible for, and positions and
    candidates to the voter's eligible_positions snapshot (R-D4).

    **No authentication required**
    """
    service = ElectionService(db)
    election, voting_token, error = await service.get_ballot_by_token(payload.token)

    if error or election is None or voting_token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "An unexpected error occurred",
        )

    response = BallotElectionResponse.model_validate(election)

    # The full set of candidate.position values claimed by *any* ballot
    # item on this election — computed before any item filtering below, and
    # used to tell an item-scoped candidate apart from a plain positional
    # one (election.positions) further down. An election can configure
    # both at once (a candidate can be nominated for a plain position with
    # no ballot item at all), so a candidate's position not being in this
    # set is what identifies it as positional, not just "unrestricted".
    all_item_positions: set = set()
    if response.ballot_items:
        for item in response.ballot_items:
            all_item_positions.update(
                ballot_item_candidate_positions(
                    {"position": item.position, "title": item.title, "id": item.id}
                )
            )

    # Nothing in schema validation stops a plain `election.positions` entry
    # from equaling a ballot item's position/title/id (ELEC-29), so a
    # candidate's position can legitimately fall in both namespaces at
    # once. Snapshot the plain list before it is filtered by
    # eligible_positions below, so a colliding candidate can be checked
    # against *both* restrictions instead of only whichever namespace
    # classified it first.
    all_plain_positions: set = set(response.positions or [])

    allowed_item_positions: Optional[set] = None
    if voting_token.eligible_item_ids is not None and response.ballot_items is not None:
        allowed = set(voting_token.eligible_item_ids)
        response.ballot_items = [
            item for item in response.ballot_items if item.id in allowed
        ]
        # Candidates are stored under their ballot item's effective position
        # (the item's own "position" field, or its title/id for legacy
        # items persisted without one — see ballot_item_candidate_positions).
        # Hiding candidates for items outside this token's eligible set
        # here, not just the items themselves, keeps this endpoint from
        # handing out the candidate ids of a restricted item that
        # cast_vote_with_token would then have to refuse (R-1).
        allowed_item_positions = set()
        for item in response.ballot_items:
            allowed_item_positions.update(
                ballot_item_candidate_positions(
                    {"position": item.position, "title": item.title, "id": item.id}
                )
            )

    result = await db.execute(
        select(Candidate)
        .where(Candidate.election_id == election.id)
        .where(Candidate.accepted.is_(True))
        .order_by(Candidate.position, Candidate.display_order)
    )
    candidates = list(result.scalars().all())
    if allowed_item_positions is not None:
        # Keep candidates belonging to an allowed item, and leave any
        # candidate that isn't item-scoped at all alone — it's a plain
        # positional candidate, filtered by eligible_positions below, not
        # by this token's item restriction.
        candidates = [
            c
            for c in candidates
            if c.position in allowed_item_positions
            or c.position not in all_item_positions
        ]

    # Position-restricted token: hide positions/candidates the voter may
    # not vote for (mirrors the enforcement in cast_vote_with_token). Only
    # applies to positional candidates — an item-scoped candidate's
    # position rarely appears in election.positions, so applying this
    # filter to it too would strip out legitimate ballot-item candidates
    # in an election that configures both positions and ballot items.
    # EXCEPT when that item-scoped candidate's position *also* collides
    # with a plain `election.positions` entry (ELEC-29): then it is a
    # plain-positional candidate too, and must not be exempted from this
    # filter just because a same-named ballot item also happens to exist.
    # A plain position is served as a ballot item too, so the page renders
    # it as a race (ballot convergence, 2026-10-05); before, a voter
    # eligible only for a plain position opened an empty ballot. Only the
    # positions this token may vote for are added.
    position_items = [
        BallotItem.model_validate(item)
        for item in position_ballot_items(election)
        if voting_token.eligible_positions is None
        or item["position"] in voting_token.eligible_positions
    ]
    if position_items:
        response.ballot_items = list(response.ballot_items or []) + position_items

    if voting_token.eligible_positions is not None:
        allowed_positions = set(voting_token.eligible_positions)
        if response.positions is not None:
            response.positions = [
                p for p in response.positions if p in allowed_positions
            ]
        candidates = [
            c
            for c in candidates
            if (
                c.position in all_item_positions
                and c.position not in all_plain_positions
            )
            or c.position in allowed_positions
        ]

    return BallotLookupResponse(
        election=response,
        candidates=[BallotCandidateResponse.model_validate(c) for c in candidates],
        is_test=bool(voting_token.is_test),
    )


class VoteWithToken(BaseModel):
    """Vote payload that includes the voting token in the body (not URL)."""

    token: str = Field(..., min_length=1, max_length=256)
    candidate_id: UUID
    position: Optional[str] = Field(None, max_length=100)
    vote_rank: Optional[int] = Field(None, ge=1, le=INT32_MAX)
    model_config = ConfigDict(extra="forbid")


@router.post(
    "/ballot/vote", response_model=VoteResponse, status_code=status.HTTP_201_CREATED
)
async def cast_vote_with_token(
    vote_data: VoteWithToken,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _rate: None = Depends(_ballot_vote_rate_limit),
):
    """
    Cast a vote using a voting token

    This endpoint is public (no authentication required) and uses the
    high-entropy token to cast anonymous votes.

    The token must be provided in the request body (not as a query parameter)
    to avoid leaking it in server/proxy logs and browser history.

    **No authentication required**
    """
    token = vote_data.token
    service = ElectionService(db)
    vote, error = await service.cast_vote_with_token(
        token=token,
        candidate_id=vote_data.candidate_id,
        position=vote_data.position,
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        vote_rank=vote_data.vote_rank,
    )

    if error or vote is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "An unexpected error occurred",
        )

    # Return vote without revealing voter information. The receipt hash lets
    # the voter verify their vote was recorded via GET /{id}/verify-receipt.
    return VoteResponse(
        id=vote.id,
        election_id=vote.election_id,
        candidate_id=vote.candidate_id,
        position=vote.position,
        voted_at=vote.voted_at,
        voter_id=None,  # Never reveal voter ID for anonymous voting
        receipt_hash=vote.receipt_hash,
    )


class BallotSubmissionWithToken(BallotSubmission):
    """Ballot submission that includes the voting token in the body."""

    token: str = Field(..., min_length=1, max_length=256)
    model_config = ConfigDict(extra="forbid")


@router.post(
    "/ballot/vote/bulk",
    response_model=BallotSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_ballot_with_token(
    ballot: BallotSubmissionWithToken,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _rate: None = Depends(_ballot_vote_rate_limit),
):
    """
    Submit an entire ballot using a voting token

    Submits all ballot item votes atomically. Each vote can be an
    approval, denial, candidate selection, write-in, or abstention.

    The token must be provided in the request body (not as a query parameter)
    to avoid leaking it in server/proxy logs and browser history.

    **No authentication required** — uses voting token from email link.
    """
    token = ballot.token
    service = ElectionService(db)
    try:
        result, error = await service.submit_ballot_with_token(
            token=token,
            votes=[v.model_dump() for v in ballot.votes],
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except IntegrityError:
        # Backstop for a constraint the service did not anticipate (W50-6).
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This ballot has already been submitted",
        )

    if error or result is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "An unexpected error occurred",
        )

    return BallotSubmissionResponse(**result)


# ============================================
# Election Settings Endpoints
# IMPORTANT: Must be defined BEFORE /{election_id} wildcard
# ============================================


_ELECTION_DEFAULT_CHOICES = {
    "default_voting_method": VALID_VOTING_METHODS,
    "default_victory_condition": VALID_VICTORY_CONDITIONS,
    "default_quorum_type": VALID_QUORUM_TYPES,
}


def _election_defaults_view(stored) -> dict:
    """The department's election defaults as the create-election form reads them.

    A value saved before these were validated, or an explicit null, reads as
    the built-in default rather than reaching the form, which would submit it.
    The built-ins are the form's own starting values, so a department that
    never set a default sees no change.
    """
    defaults = stored if isinstance(stored, dict) else {}

    def choice(key: str, valid, fallback: str) -> str:
        value = defaults.get(key)
        return value if isinstance(value, str) and value in valid else fallback

    def flag(key: str, fallback: bool) -> bool:
        value = defaults.get(key)
        return value if isinstance(value, bool) else fallback

    def positive(key: str) -> Optional[int]:
        value = defaults.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            return None
        return value

    return {
        "default_voting_method": choice(
            "voting_method", VALID_VOTING_METHODS, "simple_majority"
        ),
        "default_victory_condition": choice(
            "victory_condition", VALID_VICTORY_CONDITIONS, "most_votes"
        ),
        "default_victory_percentage": positive("victory_percentage"),
        "default_anonymous_voting": flag("anonymous_voting", True),
        "default_allow_write_ins": flag("allow_write_ins", False),
        "default_quorum_type": choice("quorum_type", VALID_QUORUM_TYPES, "none"),
        "default_quorum_value": positive("quorum_value"),
    }


class ElectionSettingsUpdate(BaseModel):
    """Org-level election default settings."""

    default_voting_method: Optional[str] = None
    default_victory_condition: Optional[str] = None
    default_victory_percentage: Optional[int] = Field(None, ge=1, le=100)
    default_anonymous_voting: Optional[bool] = None
    default_allow_write_ins: Optional[bool] = None
    default_quorum_type: Optional[str] = None
    default_quorum_value: Optional[int] = Field(None, ge=1, le=INT32_MAX)
    # The settings screen's 1-10 range was advisory only: the browser flagged
    # rangeOverflow and the API still stored 111 behind "All changes saved".
    # 0 would silently refuse every delegation, so the floor is 1.
    max_proxies_per_person: Optional[int] = Field(None, ge=1, le=10)
    proxy_voting_enabled: Optional[bool] = None
    nominations_enabled: Optional[bool] = None
    paper_ballots_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    auto_open_enabled: Optional[bool] = None
    paper_ballot_attestations_required: Optional[int] = Field(
        None,
        ge=0,
        le=3,
        description=(
            "Officers (other than the recorder) who must attest a "
            "paper-ballot batch before its votes count. 0 disables "
            "attestation."
        ),
    )
    # Replaced whole: the settings screen sends the complete object.
    eligibility: Optional[EligibilityDefaults] = None
    # The annual meeting's own defaults, replaced whole. Unlike
    # ``eligibility``, null is meaningful: the annual meeting uses the
    # regular-meeting defaults.
    annual_eligibility: Optional[EligibilityDefaults] = None

    @field_validator(
        "default_voting_method",
        "default_victory_condition",
        "default_quorum_type",
    )
    @classmethod
    def defaults_must_be_known_choices(cls, value, info):
        """Store only a value the create-election form can start from.

        These were free strings until the form began reading them (ELEC2-9),
        so a typo was accepted and then silently ignored.
        """
        valid = _ELECTION_DEFAULT_CHOICES[info.field_name]
        if value is not None and value not in valid:
            raise ValueError(
                list_within_detail_limit("must be one of: ", sorted(valid))
            )
        return value

    @field_validator(
        "nominations_enabled",
        "paper_ballots_enabled",
        "reminders_enabled",
        "auto_open_enabled",
        mode="before",
    )
    @classmethod
    def feature_flags_must_be_boolean(cls, value):
        """Allow omitted feature flags, but reject an explicit JSON null."""
        if value is None:
            raise ValueError("feature flags must be true or false")
        return value

    @field_validator("eligibility", mode="before")
    @classmethod
    def eligibility_must_not_be_null(cls, value):
        """Omit eligibility to leave it alone; null would erase it silently."""
        if value is None:
            raise ValueError("eligibility must be an object")
        return value


def _feature_flag(features: dict, name: str) -> bool:
    """Resolve persisted flags consistently, including legacy null values."""
    value = features.get(name, True)
    return value if isinstance(value, bool) else True


_REGULAR_ELIGIBILITY_KEY = "election_eligibility"
_ANNUAL_ELIGIBILITY_KEY = "election_eligibility_annual"


def _stored_eligibility(org_settings: dict, key: str) -> Optional[EligibilityDefaults]:
    """One set of the department's stored eligibility defaults, or None.

    The value is validated on every write, but ``organizations.settings`` is
    free-form JSON, so a stored value that no longer validates reads as
    absent rather than failing every create and settings read.
    """
    raw = org_settings.get(key)
    if not isinstance(raw, dict):
        return None
    try:
        return EligibilityDefaults.model_validate(raw)
    except ValidationError:
        logger.warning("Stored {} is invalid; ignoring it", key)
        return None


def _eligibility_defaults(org_settings: dict) -> EligibilityDefaults:
    """The regular-meeting defaults, else the built-in ones (no
    election-wide rules, check-in required on new items)."""
    return (
        _stored_eligibility(org_settings, _REGULAR_ELIGIBILITY_KEY)
        or EligibilityDefaults()
    )


def _defaults_for_kind(org_settings: dict, meeting_kind: str) -> EligibilityDefaults:
    """The defaults an election held at ``meeting_kind`` copies: the annual
    meeting's own when the department set them, else the regular ones."""
    if meeting_kind == "annual":
        annual = _stored_eligibility(org_settings, _ANNUAL_ELIGIBILITY_KEY)
        if annual is not None:
            return annual
    return _eligibility_defaults(org_settings)


def _seeded_position_eligibility(
    positions: Optional[list], defaults: EligibilityDefaults
) -> Optional[dict]:
    """``position_eligibility`` for ``positions`` from the defaults, or None
    when the defaults restrict none of them.

    Matched without regard to case or surrounding space: "chief" on the
    election is the "Chief" the secretary configured.
    """
    if not positions or not defaults.position_voter_types:
        return None
    by_name = {
        name.strip().casefold(): types
        for name, types in defaults.position_voter_types.items()
    }
    seeded = {
        position: {"voter_types": list(by_name[position.strip().casefold()])}
        for position in positions
        if position.strip().casefold() in by_name
    }
    return seeded or None


def _tier_voting_rules(org_settings: dict) -> list:
    """Each membership tier's own voting rules, for read-only display.

    Defaults mirror ``MembershipTierBenefits`` so a tier that never set a
    benefit reports what the ballot check would apply to it.
    """
    tier_config = org_settings.get("membership_tiers", {})
    tiers = tier_config.get("tiers", []) if isinstance(tier_config, dict) else []
    rules = []
    for tier in tiers:
        if not isinstance(tier, dict) or not tier.get("id"):
            continue
        benefits = tier.get("benefits")
        if not isinstance(benefits, dict):
            benefits = {}
        rules.append(
            {
                "tier_id": str(tier["id"]),
                "name": str(tier.get("name") or tier["id"]),
                "voting_eligible": bool(benefits.get("voting_eligible", True)),
                "requires_meeting_attendance": bool(
                    benefits.get("voting_requires_meeting_attendance", False)
                ),
                "min_attendance_pct": float(
                    benefits.get("voting_min_attendance_pct", 0.0) or 0.0
                ),
                "attendance_period_months": int(
                    benefits.get("voting_attendance_period_months", 12) or 12
                ),
            }
        )
    return rules


def _active_rules_or_none(rules: Optional[dict]) -> Optional[dict]:
    """Election-wide rules as stored on the election: None when no rule is
    in force, so an election with nothing to enforce reads exactly like one
    created before the column existed."""
    if not rules:
        return None
    attendance = rules.get("attendance") or {}
    if attendance.get("mode", "none") == "none" and not rules.get("waiting_periods"):
        return None
    return rules


async def _meeting_kind_of_link(
    db: AsyncSession, organization_id: Any, meeting_id: Optional[Any]
) -> str:
    """``annual`` when the linked meeting record is an annual meeting, else
    ``regular``. Calendar events carry no annual type, so an election linked
    to one (or to nothing) is a regular-meeting election unless it says
    otherwise."""
    if not meeting_id:
        return "regular"
    result = await db.execute(
        select(Meeting.meeting_type).where(
            Meeting.id == str(meeting_id),
            Meeting.organization_id == str(organization_id),
        )
    )
    meeting_type = result.scalar_one_or_none()
    return "annual" if meeting_type == MeetingType.ANNUAL else "regular"


async def _apply_eligibility_defaults(
    db: AsyncSession,
    organization_id: Any,
    election: ElectionCreate,
    election_data: dict,
) -> None:
    """Fill a new election's meeting kind and eligibility from the
    department's defaults for that kind.

    Only what the request left out is filled: an explicit ``meeting_kind``,
    ``eligibility_rules`` (null included, meaning "no rules") or
    ``position_eligibility`` always wins. Defaults are copied, never
    referenced, so a later settings change leaves this election alone.
    """
    if not election_data.get("meeting_kind"):
        election_data["meeting_kind"] = await _meeting_kind_of_link(
            db, organization_id, election_data.get("meeting_id")
        )

    org_result = await db.execute(
        select(Organization).where(Organization.id == str(organization_id))
    )
    org = org_result.scalar_one_or_none()
    defaults = _defaults_for_kind(
        (org.settings or {}) if org else {}, election_data["meeting_kind"]
    )

    if "eligibility_rules" in election.model_fields_set:
        election_data["eligibility_rules"] = _active_rules_or_none(
            election_data.get("eligibility_rules")
        )
    else:
        election_data["eligibility_rules"] = _active_rules_or_none(
            defaults.rules.model_dump()
        )

    if election_data.get("position_eligibility") is None:
        seeded = _seeded_position_eligibility(election_data.get("positions"), defaults)
        if seeded:
            election_data["position_eligibility"] = seeded


async def _reapply_kind_defaults(
    db: AsyncSession, election: Election, update_data: dict
) -> None:
    """When an update moves an election to the other meeting kind, replace
    its copied rules with that kind's defaults.

    Only before voting opens (the update endpoint refuses the field after).
    What the same request sets explicitly wins, as it does on create.
    ``position_eligibility`` is rebuilt from the new kind's defaults, so a
    position the regular meeting restricted but the annual meeting does not
    is opened up rather than left holding the other kind's rule.
    """
    new_kind = update_data.get("meeting_kind")
    if not new_kind or new_kind == (election.meeting_kind or "regular"):
        return
    org_result = await db.execute(
        select(Organization).where(Organization.id == str(election.organization_id))
    )
    org = org_result.scalar_one_or_none()
    defaults = _defaults_for_kind((org.settings or {}) if org else {}, new_kind)
    if "eligibility_rules" not in update_data:
        update_data["eligibility_rules"] = defaults.rules.model_dump()
    if "position_eligibility" not in update_data:
        update_data["position_eligibility"] = _seeded_position_eligibility(
            update_data.get("positions", election.positions), defaults
        )


def _settings_response(org_settings: dict) -> dict:
    """The flat settings shape GET and PATCH both return."""
    election_defaults = org_settings.get("election_defaults", {})
    proxy_config = org_settings.get("proxy_voting", {})
    features = org_settings.get("election_features", {})
    if not isinstance(features, dict):
        features = {}
    return {
        # Flat fields matching frontend ElectionSettings type
        **_election_defaults_view(election_defaults),
        "proxy_voting_enabled": proxy_config.get("enabled", False),
        "max_proxies_per_person": proxy_config.get("max_proxies_per_person", 1),
        "nominations_enabled": _feature_flag(features, "nominations_enabled"),
        "paper_ballots_enabled": _feature_flag(features, "paper_ballots_enabled"),
        "reminders_enabled": _feature_flag(features, "reminders_enabled"),
        "auto_open_enabled": _feature_flag(features, "auto_open_enabled"),
        "paper_ballot_attestations_required": features.get(
            "paper_ballot_attestations_required", 2
        ),
        "eligibility": _eligibility_defaults(org_settings).model_dump(),
        "annual_eligibility": (
            annual.model_dump()
            if (annual := _stored_eligibility(org_settings, _ANNUAL_ELIGIBILITY_KEY))
            else None
        ),
        "tier_voting_rules": _tier_voting_rules(org_settings),
    }


@router.get("/settings", response_model=ElectionSettingsResponse)
async def get_election_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get organization-level election settings and defaults.

    **Authentication required**
    **Requires permission: elections.manage**
    """

    org_result = await db.execute(
        select(Organization).where(Organization.id == str(current_user.organization_id))
    )
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    from app.core.config import settings as app_settings

    signing_key_configured = bool(app_settings.VOTE_SIGNING_KEY)

    return {
        **_settings_response(org.settings or {}),
        "security": {
            "vote_signing_key_configured": signing_key_configured,
            "anonymity_salt_auto_destroy": True,
            "vote_chain_hashing": True,
        },
    }


@router.patch("/settings", response_model=ElectionSettingsResponse)
async def update_election_settings(
    settings_update: ElectionSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Update organization-level election settings.

    **Authentication required**
    **Requires permission: elections.manage**
    """

    org_result = await db.execute(
        select(Organization).where(Organization.id == str(current_user.organization_id))
    )
    org = org_result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Deep copy to avoid mutating SQLAlchemy's committed state via shared
    # nested references, which would prevent change detection on JSON columns.
    org_settings = copy.deepcopy(org.settings or {})
    election_defaults = org_settings.get("election_defaults", {})
    proxy_config = org_settings.get("proxy_voting", {})
    features = org_settings.get("election_features", {})
    if not isinstance(features, dict):
        features = {}

    update_data = settings_update.model_dump(exclude_unset=True)

    default_fields = {
        "default_voting_method": "voting_method",
        "default_victory_condition": "victory_condition",
        "default_victory_percentage": "victory_percentage",
        "default_anonymous_voting": "anonymous_voting",
        "default_allow_write_ins": "allow_write_ins",
        "default_quorum_type": "quorum_type",
        "default_quorum_value": "quorum_value",
    }

    for api_field, settings_field in default_fields.items():
        if api_field in update_data:
            election_defaults[settings_field] = update_data[api_field]

    # Checked on the merged defaults: an update may carry only the type or only
    # the value, so neither field alone says whether the pair is a valid percentage.
    stored_quorum_value = election_defaults.get("quorum_value")
    if (
        ("default_quorum_type" in update_data or "default_quorum_value" in update_data)
        and election_defaults.get("quorum_type") == "percentage"
        and stored_quorum_value is not None
        and stored_quorum_value > 100
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Percentage quorum cannot exceed 100",
        )

    if "proxy_voting_enabled" in update_data:
        proxy_config["enabled"] = update_data["proxy_voting_enabled"]

    if "max_proxies_per_person" in update_data:
        proxy_config["max_proxies_per_person"] = update_data["max_proxies_per_person"]

    for flag in (
        "nominations_enabled",
        "paper_ballots_enabled",
        "reminders_enabled",
        "auto_open_enabled",
        "paper_ballot_attestations_required",
    ):
        if flag in update_data:
            features[flag] = update_data[flag]

    if "eligibility" in update_data:
        org_settings[_REGULAR_ELIGIBILITY_KEY] = update_data["eligibility"]
    if "annual_eligibility" in update_data:
        if update_data["annual_eligibility"] is None:
            org_settings.pop(_ANNUAL_ELIGIBILITY_KEY, None)
        else:
            org_settings[_ANNUAL_ELIGIBILITY_KEY] = update_data["annual_eligibility"]

    org_settings["election_defaults"] = election_defaults
    org_settings["proxy_voting"] = proxy_config
    org_settings["election_features"] = features
    org.settings = org_settings

    await db.commit()

    await log_audit_event(
        db=db,
        event_type="election_settings_updated",
        event_category="elections",
        severity="info",
        event_data={"updated_fields": list(update_data.keys())},
        user_id=str(current_user.id),
    )

    # Return the full updated settings in the same flat shape as GET
    return _settings_response(org_settings)


async def _member_voting_eligibility(
    db: AsyncSession, member: User, org: Optional[Organization]
) -> MemberVotingEligibilityResponse:
    """A member's waiting-period standing under each meeting kind's current
    defaults, judged by the same helpers the ballot check uses, so the
    profile card cannot disagree with the ballot (pitfall #29)."""
    org_settings = (org.settings or {}) if org else {}
    tier_svc = MembershipTierService(db)
    organization_id = str(member.organization_id)
    type_key = voter_type_key(
        member.member_class,
        member.member_status,
        member.membership_type,
        MembershipTierService.ranks_as_by_tier(org),
    )
    tz = await resolve_scheduling_timezone(db, organization_id)
    today = today_in(tz)
    stamp = (
        member.member_class_since
        if type_key and voter_type_decided_by_class(type_key)
        else member.member_status_since
    )
    wait_starts = await tier_svc.get_type_wait_start(member, organization_id)
    outcomes = []
    for kind in ("regular", "annual"):
        rules = _defaults_for_kind(org_settings, kind).rules.model_dump()
        outcome = evaluate_wait(
            rules.get("waiting_periods"),
            type_key,
            wait_starts,
            bool(member.voting_wait_waived),
            today,
        )
        outcomes.append(
            MemberWaitOutcome(
                meeting_kind=kind,
                state=outcome.state,
                months=outcome.months,
                eligible_from=outcome.eligible_from,
                reason=wait_ineligibility_reason(outcome),
            )
        )
    return MemberVotingEligibilityResponse(
        user_id=str(member.id),
        member_type=type_key,
        member_type_label=VOTER_TYPE_LABELS.get(type_key) if type_key else None,
        type_since=local_date(stamp, tz) if stamp is not None else None,
        wait_starts=wait_starts,
        voting_wait_from=member.voting_wait_from,
        voting_wait_waived=bool(member.voting_wait_waived),
        voting_wait_override_reason=member.voting_wait_override_reason,
        outcomes=outcomes,
    )


async def _org_member(db: AsyncSession, user_id: UUID, organization_id: Any) -> User:
    """The member, resolved inside the caller's organization (pitfall #14)."""
    result = await db.execute(
        select(User).where(
            User.id == str(user_id),
            User.organization_id == str(organization_id),
            User.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
        )
    return member


@router.get(
    "/members/{user_id}/voting-eligibility",
    response_model=MemberVotingEligibilityResponse,
)
async def get_member_voting_eligibility(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    A member's voting waiting period: their type, when they became it, any
    override, and where they stand under each meeting kind's defaults.

    **Requires permission: elections.manage**
    """
    member = await _org_member(db, user_id, current_user.organization_id)
    org = await db.get(Organization, str(current_user.organization_id))
    return await _member_voting_eligibility(db, member, org)


@router.put(
    "/members/{user_id}/voting-eligibility",
    response_model=MemberVotingEligibilityResponse,
)
async def update_member_voting_eligibility(
    user_id: UUID,
    override: MemberVotingEligibilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Set or clear a member's voting-wait override: the date their wait counts
    from, and/or a waiver of the wait. A waiver never lifts a type the
    department made ineligible, nor an attendance requirement. Takes effect
    for elections not yet open; an open election keeps its frozen roll.

    **Requires permission: elections.manage**
    """
    member = await _org_member(db, user_id, current_user.organization_id)
    changes = override.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    before = {
        "voting_wait_from": (
            member.voting_wait_from.isoformat() if member.voting_wait_from else None
        ),
        "voting_wait_waived": bool(member.voting_wait_waived),
    }
    # A reason is owed for setting an override, not for clearing one.
    sets_override = (
        changes.get("voting_wait_from") is not None
        or changes.get("voting_wait_waived") is True
    )
    if sets_override and not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A reason is required to override a member's waiting period",
        )
    # The date says when the member became their type, so it cannot be ahead
    # of the department's today: a future one would bar them from voting
    # until it passed and the wait then ran out, with nothing on screen
    # saying why.
    wait_from = changes.get("voting_wait_from")
    if wait_from is not None:
        org = await db.get(Organization, str(current_user.organization_id))
        if wait_from > org_today(org):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The date the wait counts from cannot be in the future",
            )
    try:
        apply_updates(member, changes)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    overridden = member.voting_wait_from is not None or bool(member.voting_wait_waived)
    if not overridden:
        member.voting_wait_override_reason = None
    elif reason:
        member.voting_wait_override_reason = reason

    await db.commit()
    await db.refresh(member)

    await log_audit_event(
        db=db,
        event_type="member_voting_wait_override_changed",
        event_category="elections",
        severity="info",
        event_data={
            "member_id": str(member.id),
            "before": before,
            "after": {
                "voting_wait_from": (
                    member.voting_wait_from.isoformat()
                    if member.voting_wait_from
                    else None
                ),
                "voting_wait_waived": bool(member.voting_wait_waived),
            },
            "reason": member.voting_wait_override_reason,
        },
        user_id=str(current_user.id),
    )
    logger.info(
        "Voting wait override changed | member={} by={}", member.id, current_user.id
    )

    org = await db.get(Organization, str(current_user.organization_id))
    return await _member_voting_eligibility(db, member, org)


# ============================================
# Election Detail Endpoints
# ============================================


@router.get("/{election_id}", response_model=ElectionResponse)
async def get_election(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Get a specific election

    **Authentication required**
    **Requires permission: elections.view**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    return await _build_election_response(db, election, viewer=current_user)


def _as_update_value(field: str, stored: Any) -> Any:
    """The stored value in the shape ``ElectionUpdate`` dumps it, so a save
    that resubmits an unchanged ballot compares equal and does not retire
    every issued link (W50-47). A stored value the schema no longer accepts
    compares unequal, which errs toward retiring links — never toward
    serving a ballot that no longer matches."""
    try:
        return ElectionUpdate(**{field: stored}).model_dump(exclude_unset=True)[field]
    except (ValueError, TypeError, KeyError):
        return stored


@router.patch("/{election_id}", response_model=ElectionResponse)
async def update_election(
    election_id: UUID,
    election_update: ElectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Update an election

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Get update data
    update_data = election_update.model_dump(exclude_unset=True)

    # Determine what can be updated based on election status
    if election.status == ElectionStatus.OPEN:
        # For open elections, only allow updating end_date
        # NOTE: results_visible_immediately is intentionally BLOCKED for open elections
        # to prevent revealing live vote counts during active voting (strategic voting risk)
        allowed_fields = {"end_date"}
        disallowed_fields = set(update_data.keys()) - allowed_fields
        if disallowed_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot update {', '.join(disallowed_fields)} for open election. "
                    "Only end_date can be updated while voting is active."
                ),
            )

        # If updating end_date, validate it's in the future and after start_date
        if "end_date" in update_data:
            new_end_date = update_data["end_date"]
            if new_end_date.tzinfo is None:
                new_end_date = new_end_date.replace(tzinfo=timezone.utc)
            e_start = (
                election.start_date.replace(tzinfo=timezone.utc)
                if election.start_date and election.start_date.tzinfo is None
                else election.start_date
            )
            if e_start and new_end_date <= e_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date",
                )
            if new_end_date <= datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be in the future",
                )

    elif election.status == ElectionStatus.CLOSED:
        # For closed elections, only allow updating results_visible_immediately
        allowed_fields = {"results_visible_immediately"}
        disallowed_fields = set(update_data.keys()) - allowed_fields
        if disallowed_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot update {', '.join(disallowed_fields)} for closed election. "
                    "Only results_visible_immediately can be updated."
                ),
            )

    # For draft elections, validate dates if they're being updated
    elif election.status in (ElectionStatus.DRAFT, ElectionStatus.NOMINATIONS):
        if "end_date" in update_data and "start_date" not in update_data:
            new_end = update_data["end_date"]
            if new_end and new_end.tzinfo is None:
                new_end = new_end.replace(tzinfo=timezone.utc)
            db_start = (
                election.start_date.replace(tzinfo=timezone.utc)
                if election.start_date and election.start_date.tzinfo is None
                else election.start_date
            )
            if db_start and new_end <= db_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date",
                )
        elif "start_date" in update_data and "end_date" not in update_data:
            new_start = update_data["start_date"]
            if new_start and new_start.tzinfo is None:
                new_start = new_start.replace(tzinfo=timezone.utc)
            db_end = (
                election.end_date.replace(tzinfo=timezone.utc)
                if election.end_date and election.end_date.tzinfo is None
                else election.end_date
            )
            if db_end and db_end <= new_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date",
                )
        elif "end_date" in update_data and "start_date" in update_data:
            if update_data["end_date"] <= update_data["start_date"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date",
                )

    # Convert UUID objects to strings for JSON-serializable storage
    if "eligible_voters" in update_data and update_data["eligible_voters"]:
        update_data["eligible_voters"] = [
            str(v) for v in update_data["eligible_voters"]
        ]
    await _reapply_kind_defaults(db, election, update_data)
    if "eligibility_rules" in update_data:
        update_data["eligibility_rules"] = _active_rules_or_none(
            update_data["eligibility_rules"]
        )

    # Update fields — explicit allowlist prevents writing to read-only columns
    # (e.g. organization_id, created_by, voter_anonymity_salt) if the Pydantic
    # schema is ever inadvertently expanded.
    ALLOWED_ELECTION_UPDATE_FIELDS = {
        "title",
        "description",
        "election_type",
        "positions",
        "ballot_items",
        "position_eligibility",
        # Editable only before voting opens: the OPEN and CLOSED branches
        # above refuse every field but their own, so a running election's
        # electorate is never redrawn after ballots have gone out.
        "eligibility_rules",
        "meeting_kind",
        "meeting_date",
        "meeting_id",
        # `event_id` belongs here beside `meeting_id`: the block below
        # validates it is in-org before applying, so leaving it off the
        # allowlist meant the check ran and the value was then dropped —
        # PATCH returned 200 and the link was never made.
        "event_id",
        "start_date",
        "end_date",
        "anonymous_voting",
        "allow_write_ins",
        "max_votes_per_position",
        "seats_per_position",
        "results_visible_immediately",
        "eligible_voters",
        "voting_method",
        "victory_condition",
        "victory_threshold",
        "victory_percentage",
        "enable_runoffs",
        "runoff_type",
        "max_runoff_rounds",
        "quorum_type",
        "quorum_value",
        # These four are on ElectionUpdate and are ordinary Election columns,
        # but were never listed here — so setting them answered 200 and
        # changed nothing. Two of them drive scheduled behaviour, which made
        # the omission worse than cosmetic: an election configured to open
        # itself could not be told to stop.
        "auto_open",
        "nomination_deadline",
        "reminder_hours_before_close",
        "tie_policy",
    }
    # Validate a re-pointed meeting/event link is in-org before applying it,
    # so an admin can't repoint their election at another org's meeting/event
    # id and read that org's roster back (XC-1).
    if (
        update_data.get("meeting_id")
        or update_data.get("event_id")
        or update_data.get("eligible_voters")
    ):
        try:
            await _validate_election_links(
                db,
                election.organization_id,
                update_data.get("meeting_id"),
                update_data.get("event_id"),
                update_data.get("eligible_voters"),
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
            )

    # PATCH validation must consider the stored half of a partial update.
    # Validating each field in isolation would allow, for example, switching
    # quorum_type to percentage while retaining no value (or a count > 100).
    # Enforced only when the PATCH touches quorum config: legacy rows can
    # hold quorum_type != none with a NULL quorum_value, and checking on
    # every update made such elections uneditable (even a title-only PATCH
    # was rejected until the caller also repaired the quorum fields).
    if "quorum_type" in update_data or "quorum_value" in update_data:
        effective_quorum_type = update_data.get("quorum_type", election.quorum_type)
        effective_quorum_value = update_data.get("quorum_value", election.quorum_value)
        if effective_quorum_type != "none" and effective_quorum_value is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="quorum_value is required when quorum is enabled",
            )
        if (
            effective_quorum_type == "percentage"
            and effective_quorum_value is not None
            and effective_quorum_value > 100
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Percentage quorum cannot exceed 100",
            )

    # The seat count is checked against the stored half of a partial
    # update, like quorum above: switching a two-seat race to ranked choice
    # is refused even when the PATCH names only the method.
    if {
        "seats_per_position",
        "max_votes_per_position",
        "voting_method",
        "ballot_items",
    } & set(update_data):
        seat_error = seat_rule_error(
            update_data.get("seats_per_position", election.seats_per_position),
            update_data.get("max_votes_per_position", election.max_votes_per_position),
            update_data.get("voting_method", election.voting_method),
            update_data.get("ballot_items", election.ballot_items),
        )
        if seat_error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=seat_error
            )

    # A nominee keeps a position string the election no longer lists: the
    # ballot and results are built from election.positions, so the candidate
    # silently vanishes from both while still sitting on the candidate list,
    # and the member never learns their nomination evaporated. Refuse to
    # shrink the set past a nominee; adding positions is always fine.
    if "positions" in update_data:
        new_positions = set(update_data["positions"] or [])
        nominated = (
            (
                await db.execute(
                    select(Candidate.position)
                    .where(Candidate.election_id == election.id)
                    .where(Candidate.position.is_not(None))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        # A ballot-item candidate is keyed by its item (position, title or
        # id), not by election.positions, so it is never orphaned by this
        # list changing; without this exclusion any PATCH carrying positions
        # on a ballot-item election reported every item candidate.
        item_positions: set = set()
        for item in election.ballot_items or []:
            item_positions.update(ballot_item_candidate_positions(item))
        orphaned = sorted(
            p
            for p in nominated
            if p is not None and p not in new_positions and p not in item_positions
        )
        if orphaned:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Remove or reassign nominees for "
                    f"{', '.join(orphaned)} before dropping the position"
                ),
            )

    # A link serves the ballot snapshotted when it was minted, so a changed
    # ballot retires every outstanding link and the detail page prompts a
    # resend (W50-47). Compared by value: the edit form resubmits fields it
    # did not change.
    ballot_changed = any(
        field in update_data
        and update_data[field] != _as_update_value(field, getattr(election, field))
        for field in service.BALLOT_SHAPE_FIELDS
    )

    for field, value in update_data.items():
        if field in ALLOWED_ELECTION_UPDATE_FIELDS:
            setattr(election, field, value)

    election.updated_at = datetime.now(timezone.utc)
    links_invalidated = 0
    if ballot_changed:
        links_invalidated = await service.invalidate_tokens_for_ballot_change(election)

    await db.commit()
    await db.refresh(election)

    await log_audit_event(
        db=db,
        event_type="election_updated",
        event_category="elections",
        severity="warning" if links_invalidated else "info",
        event_data={
            "election_id": str(election_id),
            "title": election.title,
            "updated_fields": list(update_data.keys()),
            "ballot_links_invalidated": links_invalidated,
        },
        user_id=str(current_user.id),
    )

    return await _build_election_response(db, election)


@router.delete("/{election_id}", response_model=ElectionDeleteResponse)
async def delete_election(
    election_id: UUID,
    delete_data: ElectionDelete | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Delete an election.

    - Draft elections: Can be deleted freely (no reason required).
    - Open/closed elections: Requires a reason. Automatically sends
      alert notifications to all leadership members and creates a
      critical audit trail entry.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    election_title = election.title
    election_status = election.status.value
    reason = delete_data.reason if delete_data else None
    # Set only once the non-draft reason check below has passed; the
    # leadership alert is sent for exactly those elections.
    deletion_reason = ""
    notifications_sent = 0
    vote_count = 0

    # ``parent_election_id`` is ondelete=RESTRICT with no ORM cascade, so the
    # delete below would fail at commit with MySQL 1451 and surface as a 500
    # — after the leadership alert had already gone out and the audit row
    # been written for a deletion that never happened. Refuse up front, before
    # either side effect, and name the runoffs so the officer can act on it.
    runoff_children = (
        (
            await db.execute(
                select(Election.id)
                .where(Election.parent_election_id == str(election_id))
                .where(Election.organization_id == str(current_user.organization_id))
                .where(Election.is_runoff.is_(True))
            )
        )
        .scalars()
        .all()
    )
    if runoff_children:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This election has runoff election(s) that must be deleted "
                f"first: {', '.join(runoff_children)}"
            ),
        )

    # Non-draft elections require a reason and trigger leadership alerts
    if election.status != ElectionStatus.DRAFT:
        if not reason or len(reason.strip()) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A reason of at least 10 characters is required to delete a non-draft election",
            )
        deletion_reason = reason

        # Count active votes for audit context
        votes_result = await db.execute(
            select(func.count(Vote.id))
            .where(Vote.election_id == str(election_id))
            .where(Vote.deleted_at.is_(None))
        )
        vote_count = votes_result.scalar() or 0

    # The leadership alert and the audit row come after the commit, not
    # before: a delete that fails at commit (W50-1 — every tokened election,
    # via the un-cascaded voting_tokens backref) used to send "permanently
    # deleted" to the chief and record it with critical severity while the
    # election, its votes and its results were all still there.
    await db.delete(election)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        logger.error(
            f"Election delete refused by the database | id={election_id} "
            f"by={current_user.id}: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This election is still referenced by other records and "
                "could not be deleted"
            ),
        )

    if election_status != "draft":
        # The delete is committed; a failure here (template lookup, render,
        # provider) must not cost the critical audit row or turn a done
        # deletion into a 500.
        try:
            notifications_sent = await service._notify_leadership_of_deletion(
                election=election,
                performed_by=current_user.id,
                organization_id=current_user.organization_id,
                reason=deletion_reason,
                vote_count=vote_count,
            )
        except Exception as e:
            notifications_sent = 0
            logger.error(
                f"Failed to send election deletion notifications (non-blocking) "
                f"| election={election_id} error={e}"
            )

        logger.critical(
            f"NON-DRAFT ELECTION DELETED | id={election_id} title={election_title!r} "
            f"status={election_status} votes={vote_count} by={current_user.id} "
            f"reason={reason!r} notifications={notifications_sent}"
        )

        await log_audit_event(
            db=db,
            event_type="election_deleted_critical",
            event_category="elections",
            severity="critical",
            event_data={
                "election_id": str(election_id),
                "title": election_title,
                "status_at_deletion": election_status,
                "active_vote_count": vote_count,
                "reason": reason,
                "notifications_sent": notifications_sent,
            },
            user_id=str(current_user.id),
        )
    else:
        logger.info(
            f"Draft election deleted | id={election_id} title={election_title!r} by={current_user.id}"
        )

        await log_audit_event(
            db=db,
            event_type="election_deleted",
            event_category="elections",
            severity="warning",
            event_data={"election_id": str(election_id), "title": election_title},
            user_id=str(current_user.id),
        )
    await db.commit()

    if election_status == "draft":
        message = "Election deleted successfully"
    else:
        message = f"Election deleted. {notifications_sent} leadership members have been notified."

    return ElectionDeleteResponse(
        success=True,
        message=message,
        notifications_sent=notifications_sent,
    )


def _service_error_status(error: str) -> int:
    """The status a service's ``(result, error)`` string maps to.

    The service layer reports a missing election as the string
    ``"Election not found"`` rather than raising, and several lifecycle
    endpoints used to answer every such string with 400. The frontend reads
    the status, so a deleted election read as "bad request" on Open and
    Rollback while every by-id GET said 404. One definition, so the string
    comparison cannot drift between call sites (Pitfall #29).
    """
    code: int = (
        status.HTTP_404_NOT_FOUND
        if "not found" in error.lower()
        else status.HTTP_400_BAD_REQUEST
    )
    return code


@router.post("/{election_id}/open", response_model=ElectionResponse)
async def open_election(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Open an election for voting

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election, error = await service.open_election(
        election_id, current_user.organization_id
    )

    if error or election is None:
        raise HTTPException(
            status_code=_service_error_status(error or "An unexpected error occurred"),
            detail=error or "An unexpected error occurred",
        )

    return await _build_election_response(db, election)


@router.post("/{election_id}/close", response_model=ElectionResponse)
async def close_election(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Close an election and finalize results

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election, error = await service.close_election(
        election_id, current_user.organization_id, closed_by=current_user.id
    )

    if error or election is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code, detail=error or "An unexpected error occurred"
        )

    return await _build_election_response(db, election)


@router.post("/{election_id}/open-nominations", response_model=ElectionResponse)
async def open_nominations(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Open the nomination phase for a draft positional election.

    While nominations are open, members can nominate each other (or
    themselves) for the election's positions; third-party nominees must
    accept before they appear on the ballot.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election, error = await service.open_nominations(
        election_id, current_user.organization_id
    )
    if error or election is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code, detail=error or "An unexpected error occurred"
        )
    # One message per member takes about a second each, so the announcement
    # is queued as a background job rather than holding the request open; the
    # election response carries the job for the page to follow. None means an
    # announcement from an earlier opening is still going out.
    await queue_automatic_send(
        db,
        str(election.id),
        str(current_user.organization_id),
        requested_by=str(current_user.id),
        send=NominationsAnnouncementSend(acting_user_id=str(current_user.id)),
    )
    return await _build_election_response(db, election)


@router.post("/{election_id}/close-nominations", response_model=ElectionResponse)
async def close_nominations(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Close the nomination phase, returning the election to draft so the
    ballot can be finalized before voting opens.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election, error = await service.close_nominations(
        election_id, current_user.organization_id
    )
    if error or election is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code, detail=error or "An unexpected error occurred"
        )
    return await _build_election_response(db, election)


@router.post(
    "/{election_id}/nominations",
    response_model=CandidateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_nomination(
    election_id: UUID,
    nomination: NominationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Nominate a member (or yourself) for a position while nominations are
    open. Third-party nominations require the nominee's acceptance before
    they appear on the ballot; self-nominations are accepted implicitly.

    **Authentication required**
    **Requires permission: elections.view (any member)**
    """
    service = ElectionService(db)
    candidate, error = await service.create_nomination(
        election_id=election_id,
        organization_id=current_user.organization_id,
        nominator_id=str(current_user.id),
        position=nomination.position,
        nominee_user_id=(
            str(nomination.nominee_user_id) if nomination.nominee_user_id else None
        ),
        statement=nomination.statement,
    )
    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    return candidate


@router.post(
    "/{election_id}/nominations/{candidate_id}/accept",
    response_model=NominationActionResponse,
)
async def accept_nomination(
    election_id: UUID,
    candidate_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Accept your nomination — only the nominee can accept.

    **Authentication required**

    **Permissions required:** elections.view
    """
    service = ElectionService(db)
    ok, error = await service.respond_to_nomination(
        election_id=election_id,
        organization_id=current_user.organization_id,
        candidate_id=candidate_id,
        user_id=str(current_user.id),
        accept=True,
    )
    if not ok:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    return {"success": True, "message": "Nomination accepted"}


@router.post(
    "/{election_id}/nominations/{candidate_id}/decline",
    response_model=NominationActionResponse,
)
async def decline_nomination(
    election_id: UUID,
    candidate_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Decline your nomination — only the nominee can decline. The candidate
    entry is removed; the audit log retains the record.

    **Authentication required**

    **Permissions required:** elections.view
    """
    service = ElectionService(db)
    ok, error = await service.respond_to_nomination(
        election_id=election_id,
        organization_id=current_user.organization_id,
        candidate_id=candidate_id,
        user_id=str(current_user.id),
        accept=False,
    )
    if not ok:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    return {"success": True, "message": "Nomination declined"}


@router.post("/{election_id}/manual-ballots", response_model=ManualBallotsResponse)
async def record_manual_ballots(
    election_id: UUID,
    payload: ManualBallotsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Record an in-room paper-ballot tally for an open election.

    Creates one vote row per paper ballot, flagged is_manual and
    attributed to the recording officer; a ranked-choice ballot in
    ``ranked_ballots`` becomes one row per ranked candidate, grouped by a
    shared ``paper_ballot_id``. Manual votes carry no voter
    identity — the officer's attested count is the source of truth — and
    are signed and chained like electronic votes so integrity
    verification covers the full ballot box.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    recorded, batch_id, error = await service.record_manual_ballots(
        election_id=election_id,
        organization_id=current_user.organization_id,
        recorded_by=str(current_user.id),
        entries=[
            {"candidate_id": str(e.candidate_id), "count": e.count}
            for e in payload.entries
        ],
        ranked_ballots=[
            {"rankings": [str(cid) for cid in b.rankings], "count": b.count}
            for b in payload.ranked_ballots
        ],
        notes=payload.notes,
        allow_over_count=payload.allow_over_count,
        ballots_cast=payload.ballots_cast,
    )
    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    required = await service.get_required_attestations(current_user.organization_id)
    if required > 0:
        message = (
            f"Recorded {recorded} paper ballot(s) — awaiting {required} "
            f"officer attestation(s) before they count in results"
        )
    else:
        message = f"Recorded {recorded} paper ballot(s)"
    return {
        "recorded": recorded,
        "batch_id": batch_id,
        "status": "pending" if required > 0 else "confirmed",
        "attestations_required": required,
        "message": message,
    }


@router.get(
    "/{election_id}/manual-ballots",
    response_model=ManualBallotBatchListResponse,
)
async def list_manual_ballot_batches(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    List every paper-ballot batch for an election with its recorded
    totals, status (pending / confirmed / voided), and attestation trail.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )
    batches = await service.list_manual_ballot_batches(
        election_id, current_user.organization_id
    )
    return {"batches": batches}


@router.post(
    "/{election_id}/manual-ballots/{batch_id}/attest",
    response_model=AttestManualBallotsResponse,
)
async def attest_manual_ballots(
    election_id: UUID,
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Attest that a paper-ballot batch matches the physical count.

    The recording officer cannot attest their own batch and each officer
    counts once. When the required number of attestations is reached the
    batch is confirmed and its votes count in results.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    result, error = await service.attest_manual_ballot_batch(
        election_id=election_id,
        organization_id=current_user.organization_id,
        batch_id=batch_id,
        attested_by=str(current_user.id),
    )
    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    assert result is not None
    if result["status"] == "confirmed":
        message = "Batch fully attested — its ballots now count in results"
    else:
        remaining = result["required"] - result["attestations"]
        message = f"Attestation recorded — {remaining} more needed"
    return {**result, "message": message}


@router.post(
    "/{election_id}/manual-ballots/{batch_id}/void",
    response_model=VoidManualBallotsResponse,
)
async def void_manual_ballots(
    election_id: UUID,
    batch_id: str,
    payload: VoidManualBallotsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Void (soft-delete) every paper ballot recorded in one batch — the
    correction path for a mis-keyed tally. Rows are retained with the
    deletion reason and appear in the forensics report.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    voided, error = await service.void_manual_ballot_batch(
        election_id=election_id,
        organization_id=current_user.organization_id,
        batch_id=batch_id,
        deleted_by=str(current_user.id),
        reason=payload.reason,
    )
    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "no active" in error.lower() or "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    return {
        "voided": voided,
        "message": f"Voided {voided} paper ballot(s) from batch",
    }


@router.post("/{election_id}/clone", response_model=ElectionResponse)
async def clone_election(
    election_id: UUID,
    payload: CloneElectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Create a fresh draft election from an existing election's setup —
    positions, eligibility rules, voting method, quorum, and reminder
    configuration, with new dates and a fresh anonymity salt. Votes,
    tokens, attendees, and overrides are never copied.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    clone, error = await service.clone_election(
        election_id=election_id,
        organization_id=current_user.organization_id,
        created_by=str(current_user.id),
        title=payload.title,
        start_date=payload.start_date,
        end_date=payload.end_date,
        nomination_deadline=payload.nomination_deadline,
        include_candidates=payload.include_candidates,
    )
    if error or clone is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code, detail=error or "An unexpected error occurred"
        )
    return await _build_election_response(db, clone)


@router.post("/{election_id}/write-ins/merge", response_model=MergeWriteInsResponse)
async def merge_write_ins(
    election_id: UUID,
    payload: MergeWriteInsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Consolidate write-in spelling variants under one candidate. Votes are
    never mutated (signatures embed candidate_id) — results simply count
    merged candidates' votes under the target. The merge is audited.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    merged, error = await service.merge_write_in_candidates(
        election_id=election_id,
        organization_id=current_user.organization_id,
        source_candidate_ids=[str(c) for c in payload.source_candidate_ids],
        target_candidate_id=str(payload.target_candidate_id),
        merged_by=str(current_user.id),
    )
    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)
    return {
        "merged": merged,
        "message": f"Merged {merged} write-in variant(s)",
    }


@router.get("/{election_id}/printable-ballot")
async def download_printable_ballot(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Download the official blank paper ballot as a PDF, generated from the
    election setup so the paper exactly matches the system.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        buf, error, filename = await service.build_printable_ballot_pdf(
            election_id, current_user.organization_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if error or buf is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code,
            detail=error or "Failed to generate ballot PDF",
        )

    await log_audit_event(
        db=db,
        event_type="printable_ballot_downloaded",
        event_category="elections",
        severity="info",
        event_data={"election_id": str(election_id)},
        user_id=str(current_user.id),
    )
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{election_id}/certified-results")
async def download_certified_results(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Download the certified results package (PDF) for a closed election:
    final tallies, turnout and quorum, paper-batch attestation trail,
    integrity verification, and signature lines for certifying officers.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        buf, error, filename = await service.build_certified_results_pdf(
            election_id, current_user.organization_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if error or buf is None:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if error and "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(
            status_code=status_code,
            detail=error or "Failed to generate certified results PDF",
        )

    await log_audit_event(
        db=db,
        event_type="certified_results_downloaded",
        event_category="elections",
        severity="info",
        event_data={"election_id": str(election_id)},
        user_id=str(current_user.id),
    )
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{election_id}/rollback", response_model=ElectionRollbackResponse)
async def rollback_election(
    election_id: UUID,
    rollback_data: ElectionRollback,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Rollback an election to a previous status

    This is a sensitive operation that should only be used when necessary.
    Sends email notifications to leadership and logs the action.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election, notifications_sent, error = await service.rollback_election(
        election_id=election_id,
        organization_id=current_user.organization_id,
        performed_by=current_user.id,
        reason=rollback_data.reason,
    )

    if error:
        raise HTTPException(status_code=_service_error_status(error), detail=error)

    return ElectionRollbackResponse(
        success=True,
        election=election,
        message=f"Election rolled back successfully. {notifications_sent} leadership members notified.",
        notifications_sent=notifications_sent,
    )


# ============================================
# Candidate Endpoints
# ============================================


@router.get("/{election_id}/candidates", response_model=list[CandidateResponse])
async def list_candidates(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("elections.view", "elections.manage")
    ),
):
    """
    List all candidates for an election

    **Authentication required**
    **Requires permission: elections.view or elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Pending nominations are visible to members while nominations are open so
    # nominees can respond.  Outside that phase they are election-management
    # records and must not be exposed through the member-facing candidate list.
    include_pending = (
        election.status == ElectionStatus.NOMINATIONS
        or user_has_permission(current_user, "elections.manage")
    )
    return await service.list_candidates(election_id, accepted_only=not include_pending)


# Candidate fields that change what a cast ballot refers to; see update_candidate.
CANDIDATE_IDENTITY_FIELDS = frozenset({"name", "position", "accepted"})


async def _active_vote_count(db: AsyncSession, candidate_id: UUID) -> int:
    """Votes still standing for a candidate — the one definition update and
    delete both consult, so the two can never disagree on "has votes".

    Test ballots are excluded: they never enter a tally, so a rehearsal
    with a test token must not freeze the candidate list before a real
    voter has spoken.
    """
    votes_result = await db.execute(
        select(func.count(Vote.id))
        .where(Vote.candidate_id == str(candidate_id))
        .where(Vote.deleted_at.is_(None))
        .where(Vote.is_test.is_(False))
    )
    return votes_result.scalar() or 0


async def _assert_can_hold_office(
    service: ElectionService, user_id: Any, current_user: User
) -> None:
    """Refuse a member whose membership tier cannot hold office (TIER-OFFICE).

    A write-in (no member id) is not checked: there is no tier to read.
    """
    if not user_id:
        return
    member = (
        await service.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(current_user.organization_id))
        )
    ).scalar_one_or_none()
    if member is not None and not await service.member_can_hold_office(
        member, current_user.organization_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=office_ineligible_message(member.full_name),
        )


@router.post(
    "/{election_id}/candidates",
    response_model=CandidateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_candidate(
    election_id: UUID,
    candidate: CandidateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Nominate a candidate for an election

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Cannot add candidates to closed elections
    if election.status == ElectionStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add candidates to closed election",
        )

    # Verify election_id matches
    if candidate.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Election ID mismatch"
        )

    # Validate candidate position against election positions (if positions are defined)
    if candidate.position and election.positions:
        if candidate.position not in election.positions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Position '{candidate.position}' is not defined for this election. "
                    f"Valid positions: {', '.join(election.positions)}"
                ),
            )

    # Validate a client-supplied member id belongs to the caller's org before
    # storing it as the candidate's user_id (XC-1). None is allowed (write-in).
    try:
        await assert_in_org(
            db,
            User,
            candidate.user_id,
            current_user.organization_id,
            allow_none=True,
            label="member",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    await _assert_can_hold_office(service, candidate.user_id, current_user)

    new_candidate = Candidate(
        id=uuid4(),
        nominated_by=current_user.id,
        nomination_date=datetime.now(timezone.utc),
        accepted=True,  # Auto-accept if nominated by admin
        **candidate.model_dump(),
    )

    db.add(new_candidate)
    await db.commit()
    await db.refresh(new_candidate)

    await log_audit_event(
        db=db,
        event_type="candidate_created",
        event_category="elections",
        severity="info",
        event_data={
            "election_id": str(election_id),
            "candidate_id": str(new_candidate.id),
            "candidate_name": candidate.name,
            "position": candidate.position,
        },
        user_id=str(current_user.id),
    )

    return new_candidate


@router.patch(
    "/{election_id}/candidates/{candidate_id}", response_model=CandidateResponse
)
async def update_candidate(
    election_id: UUID,
    candidate_id: UUID,
    candidate_update: CandidateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Update a candidate

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Confirm the election belongs to the caller's org before touching the
    # candidate — the candidate is fetched by (id, election_id) path params
    # only, so without this an admin could edit another org's candidate.
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    result = await db.execute(
        select(Candidate)
        .where(Candidate.id == str(candidate_id))
        .where(Candidate.election_id == str(election_id))
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found"
        )

    # Same lifecycle rule as create_candidate: once the polls have closed the
    # candidate list is part of the certified result and must not change.
    if election.status == ElectionStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit candidates in a closed election",
        )

    update_data = candidate_update.model_dump(exclude_unset=True)
    if update_data.get("accepted") is True and not candidate.accepted:
        await _assert_can_hold_office(service, candidate.user_id, current_user)
    # An explicit null clears the position, which create_candidate allows too
    # (the candidate list shows such a candidate as unassigned). The edit form
    # resubmits the position on every save, so refusing null here would also
    # refuse a statement-only edit of an unassigned candidate.
    if update_data.get("position") and election.positions:
        if update_data["position"] not in election.positions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Position '{update_data['position']}' is not defined for "
                    f"this election. Valid positions: {', '.join(election.positions)}"
                ),
            )

    # Vote signatures embed candidate_id only, so renaming or re-positioning a
    # candidate who already has votes changes what the ballots mean while
    # verify_vote_integrity keeps reporting them untampered; a position move
    # also drops those votes out of their contest in the tally. Freeze the
    # identity fields once a vote exists; statement, photo and ordering stay
    # editable.
    # Compared by value, not by key: the edit form always resubmits the name
    # and position it was seeded with, so keying on presence would refuse a
    # statement-only edit during any election with a vote.
    identity_edits = {
        field
        for field in update_data.keys() & CANDIDATE_IDENTITY_FIELDS
        if update_data[field] != getattr(candidate, field)
    }
    if identity_edits and await _active_vote_count(db, candidate_id) > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot change a candidate's name, position or acceptance "
                "once votes have been cast"
            ),
        )

    previous = {field: getattr(candidate, field) for field in CANDIDATE_IDENTITY_FIELDS}
    # Acceptance goes through the service: it is refused once Close
    # Nominations has frozen the slate, and a manager accepting a member's
    # nomination for them is labelled and notified (W50-38).
    if "accepted" in update_data:
        accepted = update_data.pop("accepted")
        if accepted is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="accepted cannot be null",
            )
        acceptance_error = await service.set_candidate_acceptance(
            election, candidate, accepted, str(current_user.id)
        )
        if acceptance_error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=acceptance_error
            )
    accepted_on_behalf = (
        previous["accepted"] is False
        and candidate.accepted
        and candidate.accepted_on_behalf_by is not None
    )
    for field, value in update_data.items():
        setattr(candidate, field, value)

    candidate.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(candidate)
    if accepted_on_behalf:
        await service.after_acceptance_on_behalf(
            election, candidate, str(current_user.id)
        )

    await log_audit_event(
        db=db,
        event_type="candidate_updated",
        event_category="elections",
        severity="info",
        event_data={
            "election_id": str(election_id),
            "candidate_id": str(candidate_id),
            "candidate_name": candidate.name,
            "updated_fields": list(update_data.keys()),
            "previous": previous,
        },
        user_id=str(current_user.id),
    )

    return candidate


@router.delete(
    "/{election_id}/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_candidate(
    election_id: UUID,
    candidate_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Delete a candidate (only if no votes have been cast)

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Confirm the election belongs to the caller's org before touching the
    # candidate — the candidate is fetched by (id, election_id) path params
    # only, so without this an admin could delete another org's candidate.
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    result = await db.execute(
        select(Candidate)
        .where(Candidate.id == str(candidate_id))
        .where(Candidate.election_id == str(election_id))
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found"
        )

    # The ballot is set once voting opens; removing a name afterwards would
    # rewrite the ballot members already voted on.
    if election.status not in (ElectionStatus.DRAFT, ElectionStatus.NOMINATIONS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Candidates can only be removed while the election is a draft "
                "or taking nominations"
            ),
        )
    # Same freeze the manager's Accept / un-Accept respects: Close
    # Nominations made the slate final until nominations are reopened.
    if service.slate_frozen(election):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Nominations have closed, so the slate is final: candidates "
                "can no longer be removed. Reopen nominations to change it."
            ),
        )
    # Every real vote row, voided ones included: the cascade from Candidate
    # hard-deletes them, which would erase the record of a voided ballot
    # along with the candidate. Test ballots are rehearsal data and are
    # ignored here as they are when editing a candidate, so a rehearsal does
    # not freeze the list.
    any_votes = await db.execute(
        select(func.count(Vote.id))
        .where(Vote.candidate_id == str(candidate_id))
        .where(Vote.is_test.is_(False))
    )
    if (any_votes.scalar() or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot delete a candidate with recorded votes, including "
                "voided ballots"
            ),
        )

    candidate_name = candidate.name
    candidate_position = candidate.position
    released = await service.release_merged_write_ins(election_id, candidate.id)
    await db.delete(candidate)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="candidate_deleted",
        event_category="elections",
        severity="warning",
        event_data={
            "election_id": str(election_id),
            "candidate_id": str(candidate_id),
            "candidate_name": candidate_name,
            "position": candidate_position,
            "write_in_merges_released": released,
        },
        user_id=str(current_user.id),
    )


# ============================================
# Voting Endpoints
# ============================================


@router.get("/{election_id}/ballot", response_model=MemberBallotResponse)
async def get_member_ballot(
    election_id: UUID,
    proxy_authorization_id: Optional[str] = Query(default=None, max_length=64),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The in-app ballot for the current member: every ballot item and plain
    position, the candidates, and per item whether the member may vote on
    it and whether they already have. With ``proxy_authorization_id`` it is
    the ballot of the member whose proxy the caller holds.

    **Authentication required**
    """
    service = ElectionService(db)
    ballot, error = await service.get_member_ballot(
        current_user.id,
        election_id,
        current_user.organization_id,
        proxy_authorization_id=proxy_authorization_id,
    )
    if error == "Election not found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error)
    if error or ballot is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "An unexpected error occurred",
        )

    election_view = BallotElectionResponse.model_validate(ballot["election"])
    election_view.ballot_items = [
        BallotItem.model_validate(item) for item in ballot["ballot_items"]
    ]
    return MemberBallotResponse(
        election=election_view,
        candidates=[
            BallotCandidateResponse.model_validate(c) for c in ballot["candidates"]
        ],
        items=ballot["items"],
        proxy=ballot["proxy"],
    )


@router.post(
    "/{election_id}/ballot",
    response_model=BallotSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_member_ballot(
    election_id: UUID,
    ballot: MemberBallotSubmission,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cast the current member's in-app ballot, or a proxy ballot, atomically.

    Takes the emailed ballot's submission shape (one entry per ballot item).
    Every selection is recorded through the same checks as a single in-app
    vote; one refused selection records nothing. An item left on Abstain
    stays open to vote on later.

    **Authentication required**
    """
    service = ElectionService(db)
    try:
        result, error = await service.submit_member_ballot(
            user_id=current_user.id,
            election_id=election_id,
            organization_id=current_user.organization_id,
            votes=[v.model_dump() for v in ballot.votes],
            proxy_authorization_id=ballot.proxy_authorization_id,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except IntegrityError:
        # The dedup hash caught a vote the checks did not (a race with the
        # emailed link, say); nothing from this ballot was kept (W50-6).
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Database integrity check: a vote on this ballot was already "
                "recorded — no votes were recorded"
            ),
        )
    if error == "Election not found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    return result


@router.get(
    "/{election_id}/ballot/proxies", response_model=MyProxyAuthorizationsResponse
)
async def list_my_proxy_authorizations(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The proxies the current member holds in this election, for the Cast
    Vote tab's "voting for" choice.

    **Authentication required**
    """
    result = await ElectionService(db).get_my_proxy_authorizations(
        election_id, current_user.organization_id, current_user.id
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )
    return result


@router.get("/{election_id}/eligibility", response_model=VoterEligibility)
async def check_eligibility(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if current user is eligible to vote

    **Authentication required**
    """
    service = ElectionService(db)
    try:
        return await service.check_voter_eligibility(
            current_user.id, election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/{election_id}/vote",
    response_model=VoteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def cast_vote(
    election_id: UUID,
    vote: VoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cast a vote in an election

    **Authentication required**
    """
    # Verify election_id matches
    if vote.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Election ID mismatch"
        )

    service = ElectionService(db)
    try:
        new_vote, error = await service.cast_vote(
            user_id=current_user.id,
            election_id=election_id,
            candidate_id=vote.candidate_id,
            position=vote.position,
            organization_id=current_user.organization_id,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            vote_rank=vote.vote_rank,
        )
    except IntegrityError:
        # The service answers a dedup-hash collision itself; this is the
        # backstop so a constraint the service did not anticipate reads as
        # "already voted" rather than a 500 (W50-6).
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_already_voted_detail(vote.position),
        )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    return new_vote


@router.post(
    "/{election_id}/vote/bulk",
    response_model=list[VoteResponse],
    status_code=status.HTTP_201_CREATED,
)
async def cast_bulk_votes(
    election_id: UUID,
    bulk_vote: BulkVoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cast multiple votes at once (for multi-position elections)

    All votes are wrapped in a single transaction for atomicity —
    either all succeed or none are committed.

    **Authentication required**
    """
    # Verify election_id matches
    if bulk_vote.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Election ID mismatch"
        )

    service = ElectionService(db)
    votes = []

    # All-or-nothing: cast_vote(commit=False) flushes each vote inside the
    # request's transaction without committing (a savepoint would not work
    # here — cast_vote's own commit would end the outer transaction), and a
    # single commit at the end makes the whole ballot atomic.
    try:
        for vote_item in bulk_vote.votes:
            vote, error = await service.cast_vote(
                user_id=current_user.id,
                election_id=election_id,
                candidate_id=vote_item.candidate_id,
                position=vote_item.position,
                organization_id=current_user.organization_id,
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                vote_rank=vote_item.vote_rank,
                commit=False,
            )

            if error:
                await db.rollback()
                label = vote_item.position or str(vote_item.candidate_id)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{label}: {error} — no votes were recorded",
                )
            votes.append(vote)

        await db.commit()
    except HTTPException:
        raise
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Database integrity check: duplicate vote detected — "
                "no votes were recorded"
            ),
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(
                e, "Failed to cast bulk votes — all votes rolled back"
            ),
        )

    return votes


# ============================================
# Results Endpoints
# ============================================


@router.get("/{election_id}/results", response_model=ElectionResults)
async def get_results(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Get election results

    Results are only available if:
    - Election is closed, OR
    - results_visible_immediately is True

    **Requires permission: elections.view**
    """
    service = ElectionService(db)
    try:
        results = await service.get_election_results(
            election_id, current_user.organization_id, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not results:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Results not available yet"
        )

    return results


@router.get("/{election_id}/stats", response_model=ElectionStats)
async def get_stats(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get election statistics

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        stats = await service.get_election_stats(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not stats:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    return stats


@router.post("/{election_id}/send-ballot", response_model=EmailBallotResponse)
async def send_ballot_emails(
    election_id: UUID,
    email_data: EmailBallot,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Send ballot notification emails to eligible voters

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Verify election exists
    election_result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == current_user.organization_id)
    )
    election = election_result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    try:
        ensure_election_open(election)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    # A queued send is about to mint every member a new token; one sent here
    # alongside it would void whichever links land first.
    if (
        await find_active_job(
            db,
            election.id,
            str(current_user.organization_id),
            kinds=BALLOT_GUARD_KINDS,
        )
        is not None
    ):
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SEND_IN_PROGRESS_DETAIL,
        )

    service = ElectionService(db)
    try:
        return await perform_ballot_send(
            service,
            election,
            str(current_user.organization_id),
            recipient_user_ids=email_data.recipient_user_ids,
            subject=email_data.subject,
            message=email_data.message,
            base_ballot_url=_ballot_base_url(email_data),
            send_eligibility_summary=bool(email_data.send_eligibility_summary),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


def _ballot_base_url(email_data: EmailBallot) -> Optional[str]:
    """The ballot page the emailed links point at, or None for no link.

    SEC: use the server-configured FRONTEND_URL, NOT request.base_url — the
    latter derives from the client-controlled Host header, so a spoofed Host
    would send members ballot links (with voting tokens) to an attacker's
    domain. The token is appended by the service as a URL fragment:
    /ballot#token=xxx (fragments never reach any server — R-D3)
    """
    if not email_data.include_ballot_link:
        return None
    return f"{settings.FRONTEND_URL.rstrip('/')}/ballot"


@router.post(
    "/{election_id}/ballot-send-jobs",
    response_model=BallotSendJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_ballot_send_job_endpoint(
    election_id: UUID,
    email_data: EmailBallot,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Queue ballot emails to eligible voters and return without waiting.

    The send runs after the response; poll
    ``GET /{election_id}/ballot-send-jobs/{job_id}`` for its outcome. Only one
    send per election may be in progress: overlapping sends would mail every
    member twice and overwrite each other's record of who was sent a ballot.

    **Authentication required**
    **Requires permission: elections.manage**
    """

    async def precheck(election: Election) -> None:
        ensure_election_open(election)

    return await _queue_send(
        db,
        election_id,
        current_user,
        BallotSend(
            recipient_user_ids=email_data.recipient_user_ids,
            subject=email_data.subject,
            message=email_data.message,
            base_ballot_url=_ballot_base_url(email_data),
            send_eligibility_summary=bool(email_data.send_eligibility_summary),
        ),
        precheck,
    )


async def _queue_send(
    db: AsyncSession,
    election_id: UUID,
    current_user: User,
    send: QueuedSend,
    precheck: Callable[[Election], Awaitable[None]],
) -> BallotSendJobResponse:
    """Record a queued send and start it, or refuse it now.

    ``precheck`` raises ValueError for a send that cannot go out (400), so
    the secretary hears it at once rather than from a failed job a moment
    later. The runner checks again when the send starts.
    """
    organization_id = str(current_user.organization_id)
    # Locked so two requests arriving together cannot both find no job in
    # progress and both queue one.
    election_result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == organization_id)
        .with_for_update()
    )
    election = election_result.scalar_one_or_none()
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )
    try:
        await precheck(election)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    job = await enqueue_send(db, election, organization_id, str(current_user.id), send)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=send.in_progress_detail,
        )
    return job_response(job)


@router.get(
    "/{election_id}/ballot-send-jobs/{job_id}",
    response_model=BallotSendJobResponse,
)
async def get_ballot_send_job_endpoint(
    election_id: UUID,
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    The status of a queued ballot send or reminder and, once finished, its
    outcome.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    job = await get_job(
        db, str(job_id), str(election_id), str(current_user.organization_id)
    )
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ballot send not found"
        )
    return job_response(job)


@router.post("/{election_id}/send-report", response_model=ElectionReportResponse)
async def send_election_report(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Email the election report to the officer who requested it.

    The report includes election results, ballot recipients, and reasons
    why specific members did not receive ballots.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        success, message = await service.generate_and_send_election_report(
            election_id=election_id,
            organization_id=current_user.organization_id,
            requested_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    return ElectionReportResponse(success=True, message=message)


# ============================================
# Pre-Meeting Package (secretary meeting prep)
# ============================================


@router.get(
    "/{election_id}/package-recipients",
    response_model=PackageRecipientsResponse,
)
async def get_package_recipients(
    election_id: UUID,
    mode: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Prefill recipient list for the pre-meeting package modal.

    mode=leadership → active members holding a leadership role;
    mode=eligible_voters → roster members who will receive a ballot.
    The secretary edits the list freely before sending.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        recipients, error = await service.get_package_recipients(
            election_id, current_user.organization_id, mode
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    return PackageRecipientsResponse(recipients=recipients or [])


@router.get("/{election_id}/package-pdf")
async def download_package_pdf(
    election_id: UUID,
    variant: str = "member",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Download the pre-meeting package PDF (no email sent).

    variant=member → eligible-voter names and counts only;
    variant=full → adds per-member ineligibility reasons and overrides
    (leadership detail).

    **Authentication required**
    **Requires permission: elections.manage**
    """
    if variant not in ("member", "full"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="variant must be 'member' or 'full'",
        )

    service = ElectionService(db)
    try:
        buf, error, filename = await service.build_pre_meeting_package_pdf(
            election_id,
            current_user.organization_id,
            include_ineligibility_detail=(variant == "full"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if error or buf is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Failed to generate package PDF",
        )

    await log_audit_event(
        db=db,
        event_type="pre_meeting_package_downloaded",
        event_category="elections",
        severity="info",
        event_data={"election_id": str(election_id), "variant": variant},
        user_id=str(current_user.id),
    )

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{election_id}/send-package", response_model=PreMeetingPackageResponse)
async def send_pre_meeting_package(
    election_id: UUID,
    payload: PreMeetingPackageSend,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Email the pre-meeting package PDF to the given (secretary-edited)
    email list, one message per address so no recipient sees another's.

    ``unreached`` names every address the package could not be sent to.

    Synchronous, and about a second per address: kept for API callers. The
    election page queues the send with ``POST /{election_id}/package-send-jobs``.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    if (
        await find_active_job(
            db,
            str(election_id),
            str(current_user.organization_id),
            kinds=PACKAGE_GUARD_KINDS,
        )
        is not None
    ):
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=PACKAGE_IN_PROGRESS_DETAIL
        )

    service = ElectionService(db)
    try:
        success, message, sent_count, unreached = (
            await service.generate_and_send_pre_meeting_package(
                election_id=election_id,
                organization_id=current_user.organization_id,
                sent_by=current_user.id,
                recipient_emails=[str(e) for e in payload.recipient_emails],
                message=payload.message,
                include_full_roster=payload.include_full_roster,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    return PreMeetingPackageResponse(
        success=True, message=message, sent_count=sent_count, unreached=unreached
    )


@router.post(
    "/{election_id}/package-send-jobs",
    response_model=BallotSendJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_package_send_job_endpoint(
    election_id: UUID,
    payload: PreMeetingPackageSend,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Queue the pre-meeting package, one message per address, and return
    without waiting.

    Refused at once (400) for a closed or cancelled election; refused (409)
    while another package send for the election is running. A ballot send
    does not block it. Poll ``GET /{election_id}/ballot-send-jobs/{job_id}``
    for the outcome, which names any address the package could not be sent to.

    **Authentication required**
    **Requires permission: elections.manage**
    """

    async def precheck(election: Election) -> None:
        unavailable = ElectionService.package_unavailable_reason(election)
        if unavailable:
            raise ValueError(unavailable)

    return await _queue_send(
        db,
        election_id,
        current_user,
        PackageSend(
            sent_by=str(current_user.id),
            recipient_emails=[str(e) for e in payload.recipient_emails],
            message=payload.message,
            include_full_roster=payload.include_full_roster,
        ),
        precheck,
    )


@router.get("/{election_id}/non-voters", response_model=NonVotersResponse)
async def get_non_voters(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get list of eligible voters who have not yet voted.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        non_voters = await service.get_non_voters(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    return {"non_voters": non_voters, "count": len(non_voters)}


class RemindNonVotersRequest(BaseModel):
    """Optional overrides for the reminder email."""

    subject: Optional[str] = Field(None, max_length=200)
    message: Optional[str] = Field(None, max_length=2000)


@router.post("/{election_id}/remind-non-voters", response_model=EmailBallotResponse)
async def remind_non_voters(
    election_id: UUID,
    payload: Optional[RemindNonVotersRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Send a reminder ballot email — with a fresh voting link — to every
    eligible voter who has not yet cast a vote.

    Members who already voted are not contacted. Also stamps the election's
    reminder_sent_at, which suppresses the automatic pre-close reminder.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    if (
        await find_active_job(
            db,
            str(election_id),
            str(current_user.organization_id),
            kinds=BALLOT_GUARD_KINDS,
        )
        is not None
    ):
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=SEND_IN_PROGRESS_DETAIL,
        )

    service = ElectionService(db)
    try:
        return await perform_reminder_send(
            service,
            election_id,
            str(current_user.organization_id),
            requested_by=str(current_user.id),
            subject=payload.subject if payload else None,
            message=payload.message if payload else None,
            base_ballot_url=_reminder_ballot_url(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


def _reminder_ballot_url() -> str:
    # SEC: server-configured FRONTEND_URL, never the Host header (see
    # _ballot_base_url) — the link carries a live voting token.
    return f"{settings.FRONTEND_URL.rstrip('/')}/ballot"


@router.post(
    "/{election_id}/reminder-send-jobs",
    response_model=BallotSendJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_reminder_send_job_endpoint(
    election_id: UUID,
    payload: Optional[RemindNonVotersRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Queue a reminder, with a fresh voting link, to every eligible voter who
    has not yet voted, and return without waiting.

    Refused at once (400) when the election is not open, reminders are off,
    or one went out within the cooldown; refused (409) while any ballot send
    or reminder for the election is still running. Poll
    ``GET /{election_id}/ballot-send-jobs/{job_id}`` for the outcome.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)

    async def precheck(election: Election) -> None:
        await service.ensure_reminder_allowed(election, current_user.organization_id)

    return await _queue_send(
        db,
        election_id,
        current_user,
        ReminderSend(
            requested_by=str(current_user.id),
            subject=payload.subject if payload else None,
            message=payload.message if payload else None,
            base_ballot_url=_reminder_ballot_url(),
        ),
        precheck,
    )


@router.get(
    "/{election_id}/eligibility-roster",
    response_model=EligibilityRosterResponse,
)
async def get_eligibility_roster(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get a full roster of all active members with per-ballot-item
    eligibility status.  Shows who will receive a ballot, who won't,
    and why — designed for the secretary's pre-send review.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        result = await service.get_eligibility_roster(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    return result


# ============================================
# Vote Integrity and Audit Endpoints
# ============================================


@router.get("/{election_id}/integrity", response_model=VoteIntegrityResponse)
async def verify_vote_integrity(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Verify cryptographic integrity of all votes in an election.

    Checks HMAC-SHA256 signatures on every vote to detect tampering.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        result = await service.verify_vote_integrity(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=result["error"]
        )

    return result


@router.delete("/{election_id}/votes/{vote_id}", response_model=SoftDeleteVoteResponse)
async def soft_delete_vote(
    election_id: UUID,
    vote_id: UUID,
    reason: str = Query(..., min_length=3, max_length=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Soft-delete a vote with audit trail.

    The vote is not physically deleted — it is marked with deleted_at,
    deleted_by, and deletion_reason for full accountability.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # The reason is the only explanation the forensics report will ever
    # carry for this deletion; whitespace satisfies min_length but says
    # nothing.
    if not reason.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A reason is required to void a vote",
        )

    service = ElectionService(db)
    try:
        vote = await service.soft_delete_vote(
            vote_id,
            current_user.id,
            reason,
            current_user.organization_id,
            election_id=election_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not vote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vote not found or already deleted",
        )

    return {"message": "Vote soft-deleted successfully", "vote_id": str(vote.id)}


@router.get("/{election_id}/forensics", response_model=ForensicsResponse)
async def get_election_forensics(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Get a comprehensive forensics report for an election.

    Aggregates vote integrity, soft-deleted votes, rollback history,
    token access logs, audit trail entries, anomaly detection (suspicious
    IPs), and a voting timeline into a single response.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    try:
        report = await service.get_election_forensics(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    logger.info(
        f"Forensics report requested | election={election_id} by={current_user.id}"
    )

    return report


# ============================================
# Meeting Attendance Endpoints
# ============================================


@router.get("/{election_id}/attendees", response_model=AttendeeListResponse)
async def get_attendees(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    Get the attendance list for an election/meeting

    **Authentication required**
    **Requires permission: elections.view**
    """
    service = ElectionService(db)
    try:
        attendees = await service.get_attendees(
            election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    if attendees is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    return {"attendees": attendees, "total": len(attendees)}


@router.post(
    "/{election_id}/attendees",
    response_model=AttendeeCheckInResponse,
    status_code=status.HTTP_201_CREATED,
)
async def check_in_attendee(
    election_id: UUID,
    check_in: AttendeeCheckIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Check in a member as present at the meeting

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # AttendeeCheckIn.user_id is a plain string, so a mistyped id from the
    # attendance form used to escape here as an unhandled ValueError (500).
    try:
        user_id = UUID(check_in.user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="user_id must be a UUID",
        )

    service = ElectionService(db)
    attendee, error = await service.check_in_attendee(
        election_id=election_id,
        organization_id=current_user.organization_id,
        user_id=user_id,
        checked_in_by=current_user.id,
    )

    if error or attendee is None:
        raise HTTPException(
            status_code=_service_error_status(error or "An unexpected error occurred"),
            detail=error or "An unexpected error occurred",
        )

    # Get updated total
    attendees = await service.get_attendees(election_id, current_user.organization_id)

    return AttendeeCheckInResponse(
        success=True,
        attendee=attendee,
        message=f"{attendee['name']} checked in successfully",
        total_attendees=len(attendees) if attendees else 1,
    )


@router.delete(
    "/{election_id}/attendees/{user_id}",
    response_model=SuccessResponse,
    status_code=status.HTTP_200_OK,
)
async def remove_attendee(
    election_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Remove a member from the attendance list

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    success, error = await service.remove_attendee(
        election_id=election_id,
        organization_id=current_user.organization_id,
        user_id=user_id,
        removed_by=current_user.id,
    )

    if error:
        raise HTTPException(status_code=_service_error_status(error), detail=error)

    return {"success": True, "message": "Attendee removed"}


@router.post(
    "/{election_id}/import-meeting-attendees",
    response_model=ImportMeetingAttendeesResponse,
)
async def import_meeting_attendees(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Import attendees from the linked meeting or event into the election
    attendance list.

    When linked to a meeting (meeting_id): copies members marked present.
    When linked to an event (event_id): copies members who checked in,
    or who RSVP'd "going" if no one has checked in yet.

    Members already in the election's attendance list are skipped.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    service = ElectionService(db)
    election = await service.get_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    if not election.meeting_id and not election.event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election is not linked to a meeting or event",
        )

    # Defense-in-depth: an election created before FK validation existed could
    # still carry a foreign meeting_id/event_id. Refuse to read attendees from a
    # source that isn't in the caller's org.
    try:
        await _validate_election_links(
            db, election.organization_id, election.meeting_id, election.event_id
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Linked meeting or event is not accessible",
        )

    source_attendees: list[tuple[str, str]] = []
    source_label = "meeting"

    if election.meeting_id:
        meeting_attendees_result = await db.execute(
            select(MeetingAttendee)
            .options(selectinload(MeetingAttendee.user))
            .where(MeetingAttendee.meeting_id == election.meeting_id)
            .where(MeetingAttendee.present.is_(True))
        )
        for ma in meeting_attendees_result.scalars().all():
            user_name = "Unknown"
            if ma.user:
                user_name = (
                    f"{ma.user.first_name} {ma.user.last_name}".strip() or ma.user.email
                )
            source_attendees.append((str(ma.user_id), user_name))

    elif election.event_id:
        source_label = "event"
        checked_in_result = await db.execute(
            select(EventRSVP)
            .options(selectinload(EventRSVP.user))
            .where(EventRSVP.event_id == election.event_id)
            .where(EventRSVP.checked_in.is_(True))
        )
        checked_in_rsvps = checked_in_result.scalars().all()

        if checked_in_rsvps:
            rsvps_to_import = checked_in_rsvps
        else:
            going_result = await db.execute(
                select(EventRSVP)
                .options(selectinload(EventRSVP.user))
                .where(EventRSVP.event_id == election.event_id)
                .where(EventRSVP.status == RSVPStatus.GOING)
            )
            rsvps_to_import = going_result.scalars().all()

        for rsvp in rsvps_to_import:
            user_name = "Unknown"
            if rsvp.user:
                user_name = (
                    f"{rsvp.user.first_name} {rsvp.user.last_name}".strip()
                    or rsvp.user.email
                )
            source_attendees.append((str(rsvp.user_id), user_name))

    if not source_attendees:
        return ImportMeetingAttendeesResponse(
            success=True,
            imported=0,
            skipped=0,
            total_attendees=len(election.attendees or []),
            message=f"No attendees found in the linked {source_label}",
        )

    current_attendees = copy.deepcopy(election.attendees or [])
    existing_user_ids = {a["user_id"] for a in current_attendees}

    imported = 0
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for user_id, user_name in source_attendees:
        if user_id in existing_user_ids:
            skipped += 1
            continue

        current_attendees.append(
            {
                "user_id": user_id,
                "name": user_name,
                "checked_in_at": now_iso,
                "checked_in_by": str(current_user.id),
            }
        )
        imported += 1

    election.attendees = current_attendees
    election.updated_at = datetime.now(timezone.utc)
    await db.commit()

    audit_data: dict = {
        "election_id": str(election_id),
        "source": source_label,
        "imported": imported,
        "skipped": skipped,
    }
    if election.meeting_id:
        audit_data["meeting_id"] = election.meeting_id
    if election.event_id:
        audit_data["event_id"] = election.event_id

    await log_audit_event(
        db=db,
        event_type="meeting_attendees_imported",
        event_category="elections",
        severity="info",
        event_data=audit_data,
        user_id=str(current_user.id),
    )

    return ImportMeetingAttendeesResponse(
        success=True,
        imported=imported,
        skipped=skipped,
        total_attendees=len(current_attendees),
        message=(
            f"Imported {imported} attendee{'s' if imported != 1 else ''} "
            f"from {source_label} ({skipped} already present)"
        ),
    )


# ==================== Voter Eligibility Overrides ====================


class VoterOverrideRequest(BaseModel):
    """Request to grant a member voting rights despite tier/attendance restrictions."""

    user_id: UUID
    reason: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Why this member is being allowed to vote",
    )


@router.post(
    "/{election_id}/voter-overrides",
    response_model=VoterOverrideRecord,
    status_code=status.HTTP_201_CREATED,
)
async def add_voter_override(
    election_id: UUID,
    body: VoterOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Grant a member voting rights for this election, bypassing tier-based
    and meeting attendance restrictions.

    The override is recorded with a reason and the identity of the officer
    who granted it. On an election restricted to an ``eligible_voters`` list
    it also admits the member as though they were on it (W50-13). It does
    NOT bypass double-vote prevention.

    Requires `elections.manage` permission.
    """
    # Load the election
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == str(current_user.organization_id))
    )
    election = result.scalar_one_or_none()
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Verify the target user exists in the same org
    user_result = await db.execute(
        select(User)
        .where(User.id == str(body.user_id))
        .where(User.organization_id == current_user.organization_id)
    )
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
        )

    overrides = copy.deepcopy(election.voter_overrides or [])

    # Prevent duplicate overrides for the same user
    if any(o.get("user_id") == str(body.user_id) for o in overrides):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{target_user.full_name} already has a voting override for this election",
        )

    override_record = {
        "user_id": str(body.user_id),
        "member_name": target_user.full_name,
        "reason": body.reason,
        "overridden_by": str(current_user.id),
        "overridden_by_name": current_user.full_name,
        "overridden_at": datetime.now(timezone.utc).isoformat(),
    }
    overrides.append(override_record)
    election.voter_overrides = overrides

    await db.commit()

    # Audit log
    await log_audit_event(
        db=db,
        event_type="voter_override_granted",
        event_category="elections",
        severity="warning",
        event_data={
            "election_id": str(election_id),
            "election_title": election.title,
            "target_user_id": str(body.user_id),
            "member_name": target_user.full_name,
            "reason": body.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    logger.info(
        f"Voter override granted | election={election_id} "
        f"member={body.user_id} ({target_user.full_name}) by={current_user.id} reason={body.reason!r}"
    )

    return override_record


@router.get("/{election_id}/voter-overrides", response_model=VoterOverrideListResponse)
async def list_voter_overrides(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    List all voter eligibility overrides for an election.

    Requires `elections.manage` permission.
    """
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == str(current_user.organization_id))
    )
    election = result.scalar_one_or_none()
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    return {
        "election_id": str(election_id),
        "election_title": election.title,
        "overrides": election.voter_overrides or [],
    }


@router.delete(
    "/{election_id}/voter-overrides/{user_id}",
    response_model=SuccessResponse,
    status_code=status.HTTP_200_OK,
)
async def remove_voter_override(
    election_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Remove a voter eligibility override for a member.

    Requires `elections.manage` permission.
    """
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == str(current_user.organization_id))
    )
    election = result.scalar_one_or_none()
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    overrides = copy.deepcopy(election.voter_overrides or [])
    original_len = len(overrides)
    overrides = [o for o in overrides if o.get("user_id") != str(user_id)]

    if len(overrides) == original_len:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No override found for this member in this election",
        )

    election.voter_overrides = overrides
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="voter_override_removed",
        event_category="elections",
        severity="info",
        event_data={
            "election_id": str(election_id),
            "target_user_id": str(user_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"success": True, "message": "Voter override removed"}


class BulkVoterOverrideRequest(BaseModel):
    """Bulk grant voting overrides for multiple members at once."""

    user_ids: list[UUID]
    reason: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="Shared reason for all overrides (e.g. 'Shift B excused due to weather emergency')",
    )


@router.post(
    "/{election_id}/voter-overrides/bulk",
    response_model=BulkVoterOverrideResponse,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_add_voter_overrides(
    election_id: UUID,
    body: BulkVoterOverrideRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Grant voting overrides to multiple members at once.

    Useful when an entire shift or group missed a meeting due to
    a weather event or operational commitment.  Each override uses
    the same reason.  Already-overridden members are skipped.

    Creates an enhanced audit trail with `bulk_voter_override_granted`
    event and `warning` severity logging all affected members.

    Requires `elections.manage` permission.
    """
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == str(current_user.organization_id))
    )
    election = result.scalar_one_or_none()
    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    overrides = copy.deepcopy(election.voter_overrides or [])
    existing_ids = {o.get("user_id") for o in overrides}

    added = []
    skipped = []

    for uid in body.user_ids:
        uid_str = str(uid)
        if uid_str in existing_ids:
            skipped.append(uid_str)
            continue

        user_result = await db.execute(
            select(User)
            .where(User.id == uid_str)
            .where(User.organization_id == current_user.organization_id)
        )
        target_user = user_result.scalar_one_or_none()
        if not target_user:
            skipped.append(uid_str)
            continue

        override_record = {
            "user_id": uid_str,
            "member_name": target_user.full_name,
            "reason": body.reason,
            "overridden_by": str(current_user.id),
            "overridden_by_name": current_user.full_name,
            "overridden_at": datetime.now(timezone.utc).isoformat(),
        }
        overrides.append(override_record)
        existing_ids.add(uid_str)
        added.append({"user_id": uid_str, "name": target_user.full_name})

    election.voter_overrides = overrides
    await db.commit()

    # Enhanced audit trail for bulk operation
    await log_audit_event(
        db=db,
        event_type="bulk_voter_override_granted",
        event_category="elections",
        severity="warning",
        event_data={
            "election_id": str(election_id),
            "election_title": election.title,
            "reason": body.reason,
            "members_added": [m["name"] for m in added],
            "members_added_count": len(added),
            "members_skipped_count": len(skipped),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    logger.warning(
        f"BULK voter override granted | election={election_id} "
        f"added={len(added)} skipped={len(skipped)} by={current_user.id} "
        f"reason={body.reason!r}"
    )

    return {
        "success": True,
        "added": added,
        "added_count": len(added),
        "skipped_count": len(skipped),
        "message": f"{len(added)} override(s) granted, {len(skipped)} skipped (already overridden or not found)",
    }


# ==================== Proxy Voting ====================


@router.post(
    "/{election_id}/proxy-authorizations",
    response_model=ProxyAuthorizationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_proxy_authorization(
    election_id: UUID,
    body: ProxyAuthorizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Authorize one member to vote on behalf of another (proxy voting).

    The organization must have proxy voting enabled in its settings
    (`settings.proxy_voting.enabled = true`).  The secretary chooses
    the proxy type:

    - **single_election**: one-time proxy for this election only
    - **regular**: standing proxy (noted for reference; enforcement is
      per-election since each election stores its own authorizations)

    When ballot emails are sent, the proxy holder is automatically CC'd
    on the delegating member's ballot notification.

    On an anonymous election a proxy ballot is attributable: it stores whom
    it was cast for, and the proxy holder sees the choices. The request must
    carry `anonymity_acknowledged: true`, recording that the delegating
    member was told and accepts this; the member is also emailed the notice.

    Requires `elections.manage` permission.
    """
    service = ElectionService(db)
    auth_record, error = await service.add_proxy_authorization(
        election_id=election_id,
        organization_id=current_user.organization_id,
        delegating_user_id=body.delegating_user_id,
        proxy_user_id=body.proxy_user_id,
        proxy_type=body.proxy_type,
        reason=body.reason,
        authorized_by=current_user.id,
        anonymity_acknowledged=body.anonymity_acknowledged,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return auth_record


@router.get(
    "/{election_id}/proxy-authorizations", response_model=ProxyAuthorizationListResponse
)
async def list_proxy_authorizations(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    List all proxy voting authorizations for an election.

    Includes both active and revoked authorizations.  The response
    also indicates whether proxy voting is enabled at the org level.

    Requires `elections.manage` permission.
    """
    service = ElectionService(db)
    result = await service.get_proxy_authorizations(
        election_id=election_id,
        organization_id=current_user.organization_id,
    )

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    return result


@router.delete(
    "/{election_id}/proxy-authorizations/{authorization_id}",
    response_model=SuccessResponse,
    status_code=status.HTTP_200_OK,
)
async def revoke_proxy_authorization(
    election_id: UUID,
    authorization_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Revoke a proxy voting authorization.

    Cannot revoke if the proxy has already cast a vote using this
    authorization — the vote must be soft-deleted first.

    Requires `elections.manage` permission.
    """
    service = ElectionService(db)
    success, error = await service.revoke_proxy_authorization(
        election_id=election_id,
        organization_id=current_user.organization_id,
        authorization_id=authorization_id,
        revoked_by=current_user.id,
    )

    if error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in error.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=error)

    return {"success": True, "message": "Proxy authorization revoked"}


@router.post(
    "/{election_id}/proxy-vote",
    response_model=VoteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def cast_proxy_vote(
    election_id: UUID,
    vote: ProxyVoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cast a vote on behalf of another member using a proxy authorization.

    The current user must be the designated proxy in the authorization.
    The vote is recorded under the *delegating* member's identity (for
    eligibility and double-vote prevention), with full audit metadata
    showing who physically cast the proxy vote.

    The hash trail records:
    - `voter_id` / `voter_hash`: the delegating (absent) member
    - `proxy_voter_id`: the proxy who physically voted
    - `proxy_authorization_id`: the authorization used
    - `is_proxy_vote`: true

    **Authentication required**
    """
    if vote.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election ID mismatch",
        )

    service = ElectionService(db)
    new_vote, error = await service.cast_proxy_vote(
        proxy_user_id=current_user.id,
        election_id=election_id,
        candidate_id=vote.candidate_id,
        proxy_authorization_id=vote.proxy_authorization_id,
        position=vote.position,
        organization_id=current_user.organization_id,
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        vote_rank=vote.vote_rank,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return new_vote


# ============================================
# Test Ballot & Ballot Preview Endpoints
# ============================================


@router.post("/{election_id}/send-test-ballot", response_model=TestBallotResponse)
async def send_test_ballot(
    election_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Send a test ballot to the current user.

    Generates a voting token and sends the ballot email to the requesting user only.
    Test votes are recorded with is_test=True and excluded from real results.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Verify election exists
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == current_user.organization_id)
    )
    election = result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Build base ballot URL from the server-configured FRONTEND_URL, not the
    # client-controlled Host header (see note above — prevents ballot-link
    # phishing via a spoofed Host).
    base_ballot_url = f"{settings.FRONTEND_URL.rstrip('/')}/ballot"

    service = ElectionService(db)
    try:
        recipients_count, failed_count, skipped_count, _skipped_details, _sent_ids = (
            await service.send_ballot_emails(
                election_id=election_id,
                organization_id=current_user.organization_id,
                recipient_user_ids=[current_user.id],
                # No subject override: the send keeps the department's own
                # template subject and prefixes it "[TEST]" (W50-18).
                message="This is a TEST ballot. Votes cast will not count toward real results.",
                base_ballot_url=base_ballot_url,
                # Flag the issued token as a test ballot so votes cast with it
                # are stored is_test=True and excluded from real results.
                is_test=True,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    return {
        "success": failed_count == 0 and skipped_count == 0,
        "message": (
            "Test ballot sent to your email"
            if failed_count == 0 and skipped_count == 0
            else (
                "Failed to send test ballot"
                if failed_count > 0
                else "No eligible ballot items for your account"
            )
        ),
    }


@router.get("/{election_id}/preview-ballot", response_model=BallotPreviewResponse)
async def preview_ballot_for_user(
    election_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Preview what a specific user's ballot would look like.

    Returns all ballot items with eligibility annotations per item.
    Eligible items are shown normally; ineligible items include the reason
    for exclusion (e.g., "Probationary — not eligible for bylaw votes").

    On the real ballot, ineligible items are silently filtered out.
    This preview shows them grayed out with reasons for the secretary's review.

    **Authentication required**
    **Requires permission: elections.manage**
    """
    # Verify election
    result = await db.execute(
        select(Election)
        .where(Election.id == str(election_id))
        .where(Election.organization_id == current_user.organization_id)
    )
    election = result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Election not found"
        )

    # Verify target user exists in same org (roles eager-loaded for the
    # voter-type checks in annotate_ballot_items_for_user)
    user_result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .options(selectinload(User.roles))
    )
    target_user = user_result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Check overall eligibility
    service = ElectionService(db)
    try:
        eligibility = await service.check_voter_eligibility(
            user_id, election_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    # Get candidates
    candidates_result = await db.execute(
        select(Candidate)
        .where(Candidate.election_id == str(election_id))
        .where(Candidate.accepted.is_(True))
        .order_by(Candidate.position, Candidate.display_order)
    )
    candidates = candidates_result.scalars().all()

    # Annotate each ballot item with eligibility using the same logic that
    # filters the real ballot (voter-type categories via _user_has_role_type,
    # tier voting rules, secretary overrides, fail-closed attendance) — a
    # hand-rolled comparison here previously disagreed with what
    # send_ballot_emails actually sent (raw membership_type matching,
    # overrides ignored, attendance only checked when attendees was non-empty).
    ballot_items = election.ballot_items or []
    try:
        annotated_items = await service.annotate_ballot_items_for_user(
            target_user, election, str(current_user.organization_id)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    eligible_count = sum(
        1 for item in annotated_items if item["eligibility"]["eligible"]
    )

    return {
        "election_id": str(election_id),
        "election_title": election.title,
        "user_id": str(user_id),
        "user_name": target_user.full_name,
        "overall_eligibility": {
            "is_eligible": eligibility.is_eligible,
            "reason": eligibility.reason,
        },
        "ballot_items": annotated_items,
        "candidates": [
            {
                "id": str(c.id),
                "name": c.name,
                "position": c.position,
                "statement": c.statement,
            }
            for c in candidates
        ],
        "eligible_item_count": eligible_count,
        "total_item_count": len(ballot_items),
        "would_receive_ballot": eligible_count > 0 and eligibility.is_eligible,
    }


# ============================================
# Vote Receipt Verification
# ============================================


class VoteReceiptVerifyRequest(BaseModel):
    """Receipt carried in the request body, so it never lands in an access
    log, a proxy log or browser history the way a query string does (R-D3,
    ELEC-14)."""

    receipt: str = Field(..., min_length=1, max_length=128)
    model_config = ConfigDict(extra="forbid")


async def _verify_receipt(db: AsyncSession, election_id: UUID, receipt: str) -> dict:
    # Voided rows are fetched too: a voter whose ballot an officer voided
    # was otherwise told no such vote existed, which reads as a bogus
    # receipt rather than the sanctioned action it was (W50-54).
    result = await db.execute(
        select(Vote)
        .where(Vote.election_id == str(election_id))
        .where(Vote.receipt_hash == receipt)
    )
    vote = result.scalar_one_or_none()

    if not vote:
        return {
            "verified": False,
            "counted": False,
            "message": "No matching vote found for this receipt",
        }

    if vote.deleted_at is not None:
        return {
            "verified": False,
            "counted": False,
            "voided": True,
            "message": "This vote was voided by an officer",
            "voted_at": vote.voted_at.isoformat(),
            "position": vote.position,
        }

    # A test-ballot vote is stored (so its receipt verifies) but excluded
    # from every tally, and the receipt must say so rather than promise a
    # count the results will never show (W50-18).
    if vote.is_test:
        return {
            "verified": True,
            "counted": False,
            "message": (
                "This was a test vote. It was recorded but is not counted "
                "toward the election results."
            ),
            "voted_at": vote.voted_at.isoformat(),
            "position": vote.position,
        }

    return {
        "verified": True,
        "counted": True,
        "message": "Your vote has been recorded and is counted",
        "voted_at": vote.voted_at.isoformat(),
        "position": vote.position,
    }


@router.post("/{election_id}/verify-receipt", response_model=VoteReceiptResponse)
async def verify_vote_receipt_post(
    election_id: UUID,
    payload: VoteReceiptVerifyRequest,
    db: AsyncSession = Depends(get_db),
    _rate: None = Depends(_ballot_read_rate_limit),
):
    """
    Verify a vote receipt hash, with the receipt in the request body.

    This is a public endpoint — voters can check that their vote was recorded
    without revealing the vote content. Preferred over the deprecated GET,
    which carries the receipt in the URL.

    **No authentication required**
    """
    return await _verify_receipt(db, election_id, payload.receipt)


@router.get(
    "/{election_id}/verify-receipt",
    response_model=VoteReceiptResponse,
    deprecated=True,
)
async def verify_vote_receipt(
    election_id: UUID,
    receipt: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _rate: None = Depends(_ballot_read_rate_limit),
):
    """
    Verify a vote receipt hash (deprecated — use the POST form).

    Kept so external callers written against the documented GET keep working
    through the transition (owner decision 2026-10-05, ELEC-14). The receipt
    travels in the query string here, so it can land in server and proxy
    logs; the response says so with a ``Deprecation`` header and a ``Link``
    to the POST form.

    **No authentication required**
    """
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = (
        f'</api/v1/elections/{election_id}/verify-receipt>; rel="successor-version"'
    )
    return await _verify_receipt(db, election_id, receipt)
