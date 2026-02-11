"""
Dashboard Endpoints

Provides aggregated statistics for the main dashboard.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.models.event import Event
from app.models.user import User, UserStatus

router = APIRouter()


class DashboardStats(BaseModel):
    total_members: int
    active_members: int
    total_documents: int
    setup_percentage: int
    recent_events_count: int
    pending_tasks_count: int


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DashboardStats:
    """
    Get aggregated dashboard statistics for the current user's organization.
    """
    org_id = current_user.organization_id

    # Total members in organization
    result = await db.execute(
        select(func.count(User.id)).where(
            User.organization_id == org_id,
            User.deleted_at.is_(None),
        )
    )
    total_members = result.scalar() or 0

    # Active members
    result = await db.execute(
        select(func.count(User.id)).where(
            User.organization_id == org_id,
            User.status == UserStatus.ACTIVE,
            User.deleted_at.is_(None),
        )
    )
    active_members = result.scalar() or 0

    # Recent events (last 30 days)
    cutoff = datetime.utcnow() - timedelta(days=30)
    result = await db.execute(
        select(func.count(Event.id)).where(
            Event.organization_id == org_id,
            Event.created_at >= cutoff,
            Event.is_cancelled == False,  # noqa: E712
        )
    )
    recent_events_count = result.scalar() or 0

    return DashboardStats(
        total_members=total_members,
        active_members=active_members,
        total_documents=0,  # No document model yet
        setup_percentage=100,
        recent_events_count=recent_events_count,
        pending_tasks_count=0,
    )
