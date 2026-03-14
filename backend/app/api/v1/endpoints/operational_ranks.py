"""
Operational Rank API Endpoints

CRUD endpoints for per-organization operational rank management.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import User
from app.schemas.operational_rank import (
    RankCreate,
    RankReorderRequest,
    RankResponse,
    RankUpdate,
    RankValidationResponse,
)
from app.services.operational_rank_service import OperationalRankService

router = APIRouter()


def _rank_to_response(rank) -> RankResponse:
    return RankResponse(
        id=UUID(rank.id),
        organization_id=UUID(rank.organization_id),
        rank_code=rank.rank_code,
        display_name=rank.display_name,
        description=rank.description,
        sort_order=rank.sort_order,
        is_active=rank.is_active,
        created_at=rank.created_at,
        updated_at=rank.updated_at,
    )


@router.get("", response_model=list[RankResponse])
async def list_ranks(
    is_active: bool | None = Query(None, description="Filter by active status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all operational ranks for the organization.

    **Authentication required**
    """
    service = OperationalRankService(db)

    # Auto-seed defaults if the org has none yet
    await service.seed_defaults(current_user.organization_id)
    await db.commit()

    ranks = await service.list_ranks(
        organization_id=current_user.organization_id,
        is_active=is_active,
    )
    return [_rank_to_response(r) for r in ranks]


@router.post("", response_model=RankResponse, status_code=status.HTTP_201_CREATED)
async def create_rank(
    data: RankCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Create a new operational rank.

    **Authentication required**
    **Permissions required:** settings.manage
    """
    service = OperationalRankService(db)

    async with handle_service_errors("Failed to create rank"):
        rank = await service.create_rank(
            data=data,
            organization_id=current_user.organization_id,
        )

    return _rank_to_response(rank)


@router.get("/validate", response_model=RankValidationResponse)
async def validate_ranks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check for active members whose rank does not match any configured rank.

    Archived, retired, and dropped members are excluded — only members
    who are still actively interacting with the platform are checked.

    **Authentication required**
    """
    service = OperationalRankService(db)
    issues = await service.validate_ranks(current_user.organization_id)
    return RankValidationResponse(issues=issues, total=len(issues))


@router.get("/{rank_id}", response_model=RankResponse)
async def get_rank(
    rank_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific operational rank by ID.

    **Authentication required**
    """
    service = OperationalRankService(db)
    rank = ensure_found(
        await service.get_rank(rank_id, current_user.organization_id),
        "Rank",
    )

    return _rank_to_response(rank)


@router.patch("/{rank_id}", response_model=RankResponse)
async def update_rank(
    rank_id: UUID,
    data: RankUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Update an operational rank.

    **Authentication required**
    **Permissions required:** settings.manage
    """
    service = OperationalRankService(db)

    async with handle_service_errors("Failed to update rank"):
        rank = await service.update_rank(
            rank_id=rank_id,
            data=data,
            organization_id=current_user.organization_id,
        )

    ensure_found(rank, "Rank")

    return _rank_to_response(rank)


@router.delete("/{rank_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rank(
    rank_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Delete an operational rank.

    **Authentication required**
    **Permissions required:** settings.manage
    """
    service = OperationalRankService(db)
    deleted = await service.delete_rank(rank_id, current_user.organization_id)
    ensure_found(deleted, "Rank")


@router.post("/reorder", response_model=list[RankResponse])
async def reorder_ranks(
    data: RankReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Batch-update sort order for multiple ranks.

    **Authentication required**
    **Permissions required:** settings.manage
    """
    service = OperationalRankService(db)
    ranks = await service.reorder_ranks(
        organization_id=current_user.organization_id,
        items=[
            {"id": str(item.id), "sort_order": item.sort_order} for item in data.ranks
        ],
    )
    return [_rank_to_response(r) for r in ranks]
