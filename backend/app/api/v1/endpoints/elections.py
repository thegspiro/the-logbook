"""
Election API Endpoints

Endpoints for election management including elections, candidates, voting, and results.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from uuid import UUID, uuid4
from datetime import datetime

from app.core.database import get_db
from app.models.election import (
    Election,
    Candidate,
    Vote,
    ElectionStatus,
)
from app.models.user import User
from app.schemas.election import (
    ElectionCreate,
    ElectionUpdate,
    ElectionResponse,
    ElectionListResponse,
    CandidateCreate,
    CandidateUpdate,
    CandidateResponse,
    CandidateAcceptance,
    VoteCreate,
    VoteResponse,
    ElectionResults,
    ElectionStats,
    VoterEligibility,
    BulkVoteCreate,
    EmailBallot,
    EmailBallotResponse,
    ElectionRollback,
    ElectionRollbackResponse,
)
from app.services.election_service import ElectionService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Election Endpoints
# ============================================

@router.get("", response_model=List[ElectionListResponse])
async def list_elections(
    status_filter: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    List all elections

    **Authentication required**
    **Requires permission: elections.view**
    """
    query = select(Election).where(
        Election.organization_id == current_user.organization_id
    )

    if status_filter:
        try:
            status_enum = ElectionStatus(status_filter)
            query = query.where(Election.status == status_enum)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {status_filter}"
            )

    query = query.order_by(Election.start_date.desc())

    result = await db.execute(query)
    elections = result.scalars().all()

    # Add vote counts if available
    response_elections = []
    for election in elections:
        votes_result = await db.execute(
            select(func.count(Vote.id))
            .where(Vote.election_id == election.id)
        )
        total_votes = votes_result.scalar() or 0

        response_elections.append(
            ElectionListResponse(
                id=election.id,
                title=election.title,
                election_type=election.election_type,
                start_date=election.start_date,
                end_date=election.end_date,
                status=election.status.value,
                positions=election.positions,
                total_votes=total_votes,
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
            detail="End date must be after start date"
        )

    import secrets as _secrets
    new_election = Election(
        id=uuid4(),
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        status=ElectionStatus.DRAFT,
        # SEC-12: Generate per-election salt for anonymous voter hash privacy
        voter_anonymity_salt=_secrets.token_hex(32),
        **election.model_dump()
    )

    db.add(new_election)
    await db.commit()
    await db.refresh(new_election)

    return new_election


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
    result = await db.execute(
        select(Election)
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    return election


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
    result = await db.execute(
        select(Election)
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    # Get update data
    update_data = election_update.model_dump(exclude_unset=True)

    # Determine what can be updated based on election status
    if election.status == ElectionStatus.OPEN:
        # For open elections, only allow updating end_date and results_visible_immediately
        allowed_fields = {"end_date", "results_visible_immediately"}
        disallowed_fields = set(update_data.keys()) - allowed_fields
        if disallowed_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update {', '.join(disallowed_fields)} for open election. Only end_date and results_visible_immediately can be updated."
            )

        # If updating end_date, validate it's in the future and after start_date
        if "end_date" in update_data:
            new_end_date = update_data["end_date"]
            if new_end_date <= election.start_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date"
                )
            if new_end_date <= datetime.utcnow():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be in the future"
                )

    elif election.status == ElectionStatus.CLOSED:
        # For closed elections, only allow updating results_visible_immediately
        allowed_fields = {"results_visible_immediately"}
        disallowed_fields = set(update_data.keys()) - allowed_fields
        if disallowed_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update {', '.join(disallowed_fields)} for closed election. Only results_visible_immediately can be updated."
            )

    # For draft elections, validate dates if they're being updated
    elif election.status == ElectionStatus.DRAFT:
        if "end_date" in update_data and "start_date" not in update_data:
            if update_data["end_date"] <= election.start_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date"
                )
        elif "start_date" in update_data and "end_date" not in update_data:
            if election.end_date <= update_data["start_date"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date"
                )
        elif "end_date" in update_data and "start_date" in update_data:
            if update_data["end_date"] <= update_data["start_date"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="End date must be after start date"
                )

    # Update fields
    for field, value in update_data.items():
        setattr(election, field, value)

    election.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(election)

    return election


@router.delete("/{election_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_election(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.manage")),
):
    """
    Delete an election (only if in draft status with no votes)

    **Authentication required**
    **Requires permission: elections.manage**
    """
    result = await db.execute(
        select(Election)
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    # Can only delete draft elections
    if election.status != ElectionStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only delete draft elections"
        )

    # Check for votes
    votes_result = await db.execute(
        select(func.count(Vote.id))
        .where(Vote.election_id == election_id)
    )
    vote_count = votes_result.scalar() or 0

    if vote_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete election with existing votes"
        )

    await db.delete(election)
    await db.commit()


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
    election, error = await service.open_election(election_id, current_user.organization_id)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return election


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
    election = await service.close_election(election_id, current_user.organization_id)

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    return election


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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return ElectionRollbackResponse(
        success=True,
        election=election,
        message=f"Election rolled back successfully. {notifications_sent} leadership members notified.",
        notifications_sent=notifications_sent,
    )


# ============================================
# Candidate Endpoints
# ============================================

@router.get("/{election_id}/candidates", response_model=List[CandidateResponse])
async def list_candidates(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("elections.view")),
):
    """
    List all candidates for an election

    **Authentication required**
    **Requires permission: elections.view**
    """
    # Verify election exists and belongs to organization
    election_result = await db.execute(
        select(Election)
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = election_result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    result = await db.execute(
        select(Candidate)
        .where(Candidate.election_id == election_id)
        .order_by(Candidate.position, Candidate.display_order)
    )

    return result.scalars().all()


@router.post("/{election_id}/candidates", response_model=CandidateResponse, status_code=status.HTTP_201_CREATED)
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
    # Verify election exists and belongs to organization
    election_result = await db.execute(
        select(Election)
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = election_result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    # Cannot add candidates to closed elections
    if election.status == ElectionStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add candidates to closed election"
        )

    # Verify election_id matches
    if candidate.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election ID mismatch"
        )

    new_candidate = Candidate(
        id=uuid4(),
        nominated_by=current_user.id,
        nomination_date=datetime.utcnow(),
        accepted=True,  # Auto-accept if nominated by admin
        **candidate.model_dump()
    )

    db.add(new_candidate)
    await db.commit()
    await db.refresh(new_candidate)

    return new_candidate


@router.patch("/{election_id}/candidates/{candidate_id}", response_model=CandidateResponse)
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
    result = await db.execute(
        select(Candidate)
        .where(Candidate.id == candidate_id)
        .where(Candidate.election_id == election_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found"
        )

    # Update fields
    update_data = candidate_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(candidate, field, value)

    candidate.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(candidate)

    return candidate


@router.delete("/{election_id}/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    result = await db.execute(
        select(Candidate)
        .where(Candidate.id == candidate_id)
        .where(Candidate.election_id == election_id)
    )
    candidate = result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found"
        )

    # Check for votes
    votes_result = await db.execute(
        select(func.count(Vote.id))
        .where(Vote.candidate_id == candidate_id)
    )
    vote_count = votes_result.scalar() or 0

    if vote_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete candidate with existing votes"
        )

    await db.delete(candidate)
    await db.commit()


# ============================================
# Voting Endpoints
# ============================================

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
    return await service.check_voter_eligibility(
        current_user.id, election_id, current_user.organization_id
    )


@router.post("/{election_id}/vote", response_model=VoteResponse, status_code=status.HTTP_201_CREATED)
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election ID mismatch"
        )

    service = ElectionService(db)
    new_vote, error = await service.cast_vote(
        user_id=current_user.id,
        election_id=election_id,
        candidate_id=vote.candidate_id,
        position=vote.position,
        organization_id=current_user.organization_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return new_vote


@router.post("/{election_id}/vote/bulk", response_model=List[VoteResponse], status_code=status.HTTP_201_CREATED)
async def cast_bulk_votes(
    election_id: UUID,
    bulk_vote: BulkVoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cast multiple votes at once (for multi-position elections)

    **Authentication required**
    """
    # Verify election_id matches
    if bulk_vote.election_id != election_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Election ID mismatch"
        )

    service = ElectionService(db)
    votes = []
    errors = []

    for vote_data in bulk_vote.votes:
        position = list(vote_data.keys())[0]
        candidate_id = vote_data[position]

        vote, error = await service.cast_vote(
            user_id=current_user.id,
            election_id=election_id,
            candidate_id=candidate_id,
            position=position,
            organization_id=current_user.organization_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        if error:
            errors.append(f"{position}: {error}")
        elif vote:
            votes.append(vote)

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="; ".join(errors)
        )

    return votes


# ============================================
# Results Endpoints
# ============================================

@router.get("/{election_id}/results", response_model=ElectionResults)
async def get_results(
    election_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get election results

    Results are only available if:
    - Election is closed, OR
    - results_visible_immediately is True

    **Authentication required**
    """
    service = ElectionService(db)
    results = await service.get_election_results(
        election_id, current_user.organization_id, current_user.id
    )

    if not results:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Results not available yet"
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
    stats = await service.get_election_stats(election_id, current_user.organization_id)

    if not stats:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
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
        .where(Election.id == election_id)
        .where(Election.organization_id == current_user.organization_id)
    )
    election = election_result.scalar_one_or_none()

    if not election:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election not found"
        )

    # Build base ballot URL (token will be appended by service)
    base_url = str(request.base_url).rstrip("/")
    base_ballot_url = f"{base_url}/api/v1/elections/ballot" if email_data.include_ballot_link else None

    service = ElectionService(db)
    recipients_count, failed_count = await service.send_ballot_emails(
        election_id=election_id,
        organization_id=current_user.organization_id,
        recipient_user_ids=email_data.recipient_user_ids,
        subject=email_data.subject,
        message=email_data.message,
        base_ballot_url=base_ballot_url,
    )

    return EmailBallotResponse(
        success=failed_count == 0,
        recipients_count=recipients_count,
        failed_count=failed_count,
        message=f"Ballot emails sent to {recipients_count} recipient(s)" if failed_count == 0 else f"Sent to {recipients_count} recipients with {failed_count} failures",
    )


# ============================================
# Anonymous Ballot Endpoints (Token-Based)
# ============================================

@router.get("/ballot", response_model=ElectionResponse)
async def get_ballot_by_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get ballot information using a voting token

    This endpoint is public (no authentication required) and uses the
    secure hashed token from the email link.

    **No authentication required**
    """
    service = ElectionService(db)
    election, voting_token, error = await service.get_ballot_by_token(token)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return election


@router.get("/ballot/{token}/candidates", response_model=List[CandidateResponse])
async def get_ballot_candidates(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get candidates for a ballot using voting token

    **No authentication required**
    """
    service = ElectionService(db)
    election, voting_token, error = await service.get_ballot_by_token(token)

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Get candidates for this election
    result = await db.execute(
        select(Candidate)
        .where(Candidate.election_id == election.id)
        .where(Candidate.accepted == True)
        .order_by(Candidate.position, Candidate.display_order)
    )

    return result.scalars().all()


@router.post("/ballot/vote", response_model=VoteResponse, status_code=status.HTTP_201_CREATED)
async def cast_vote_with_token(
    vote_data: VoteCreate,
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Cast a vote using a voting token

    This endpoint is public (no authentication required) and uses the
    secure hashed token to cast anonymous votes.

    **No authentication required**
    """
    service = ElectionService(db)
    vote, error = await service.cast_vote_with_token(
        token=token,
        candidate_id=vote_data.candidate_id,
        position=vote_data.position,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Return vote without revealing voter information
    return VoteResponse(
        id=vote.id,
        election_id=vote.election_id,
        candidate_id=vote.candidate_id,
        position=vote.position,
        voted_at=vote.voted_at,
        voter_id=None,  # Never reveal voter ID for anonymous voting
    )
