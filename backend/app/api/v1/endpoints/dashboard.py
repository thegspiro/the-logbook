"""
Dashboard Endpoints

Provides aggregated statistics for the main dashboard,
including an admin-level summary for Chiefs and department leaders.
"""

import logging
from datetime import datetime, date, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user, require_permission
from app.core.database import get_db
from app.models.event import Event, EventRSVP, EventExternalAttendee, EventType
from app.models.user import User, UserStatus
from app.models.meeting import MeetingActionItem, ActionItemStatus
from app.models.minute import ActionItem, MinutesActionItemStatus, MeetingMinutes
from app.models.training import (
    TrainingRecord,
    TrainingStatus,
    ProgramEnrollment,
    EnrollmentStatus,
    RequirementProgress,
    RequirementProgressStatus,
    ProgramRequirement,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class DashboardStats(BaseModel):
    total_members: int
    active_members: int
    total_documents: int
    setup_percentage: int
    recent_events_count: int
    pending_tasks_count: int


class AdminSummary(BaseModel):
    """Department-wide summary for Chiefs and admins."""
    active_members: int
    inactive_members: int
    total_members: int
    training_completion_pct: float
    upcoming_events_count: int
    overdue_action_items: int
    open_action_items: int
    recent_training_hours: float


class ActionItemSummary(BaseModel):
    """Unified action item from either meetings or minutes."""
    id: str
    source: str  # "meeting" or "minutes"
    source_id: str
    description: str
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    due_date: Optional[str] = None
    status: str
    priority: Optional[str] = None
    created_at: str


class CommunityEngagement(BaseModel):
    """Community engagement metrics for Public Outreach."""
    total_public_events: int
    total_member_attendees: int
    total_external_attendees: int
    upcoming_public_events: int


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
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
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
        total_documents=0,
        setup_percentage=100,
        recent_events_count=recent_events_count,
        pending_tasks_count=0,
    )


@router.get("/admin-summary", response_model=AdminSummary)
async def get_admin_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
) -> AdminSummary:
    """
    Department-wide admin summary for Chiefs and leaders.
    Aggregates key metrics across all modules.

    Each query section is isolated so a failure in one module
    (e.g. training, events) does not prevent member counts from
    being returned.
    """
    org_id = current_user.organization_id

    # ── Member counts (core — always required) ──
    result = await db.execute(
        select(func.count(User.id)).where(
            User.organization_id == org_id,
            User.deleted_at.is_(None),
        )
    )
    total_members = result.scalar() or 0

    result = await db.execute(
        select(func.count(User.id)).where(
            User.organization_id == org_id,
            User.status == UserStatus.ACTIVE,
            User.deleted_at.is_(None),
        )
    )
    active_members = result.scalar() or 0
    inactive_members = total_members - active_members

    # ── Training compliance % ──
    # Primary: Use program enrollment requirement progress (the real compliance data).
    # For each active/completed enrollment, count required requirement-progress
    # items that are completed or verified vs total required items.
    # Fallback: If no enrollments exist, use completed/non-cancelled training
    # records from the last 12 months.
    training_pct = 0.0
    try:
        # Count total required requirement-progress entries for active/completed enrollments
        # Exclude soft-deleted users so they don't inflate the denominator
        total_required_result = await db.execute(
            select(func.count(RequirementProgress.id))
            .join(ProgramEnrollment, RequirementProgress.enrollment_id == ProgramEnrollment.id)
            .join(User, User.id == ProgramEnrollment.user_id)
            .join(
                ProgramRequirement,
                and_(
                    ProgramRequirement.requirement_id == RequirementProgress.requirement_id,
                    ProgramRequirement.program_id == ProgramEnrollment.program_id,
                ),
            )
            .where(
                ProgramEnrollment.organization_id == org_id,
                ProgramEnrollment.status.in_([EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]),
                ProgramRequirement.is_required == True,  # noqa: E712
                User.deleted_at.is_(None),
            )
        )
        total_required = total_required_result.scalar() or 0

        if total_required > 0:
            # Count completed/verified ones (also excluding soft-deleted users)
            satisfied_result = await db.execute(
                select(func.count(RequirementProgress.id))
                .join(ProgramEnrollment, RequirementProgress.enrollment_id == ProgramEnrollment.id)
                .join(User, User.id == ProgramEnrollment.user_id)
                .join(
                    ProgramRequirement,
                    and_(
                        ProgramRequirement.requirement_id == RequirementProgress.requirement_id,
                        ProgramRequirement.program_id == ProgramEnrollment.program_id,
                    ),
                )
                .where(
                    ProgramEnrollment.organization_id == org_id,
                    ProgramEnrollment.status.in_([EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]),
                    ProgramRequirement.is_required == True,  # noqa: E712
                    User.deleted_at.is_(None),
                    RequirementProgress.status.in_([
                        RequirementProgressStatus.COMPLETED,
                        RequirementProgressStatus.VERIFIED,
                    ]),
                )
            )
            satisfied = satisfied_result.scalar() or 0
            training_pct = (satisfied / total_required * 100)
        else:
            # Fallback: no program enrollments — use record-based metric
            # but exclude cancelled records from the denominator
            twelve_months_ago = datetime.now(timezone.utc) - timedelta(days=365)
            result = await db.execute(
                select(func.count(TrainingRecord.id)).where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.created_at >= twelve_months_ago,
                    TrainingRecord.status != TrainingStatus.CANCELLED,
                )
            )
            total_records = result.scalar() or 0

            result = await db.execute(
                select(func.count(TrainingRecord.id)).where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.created_at >= twelve_months_ago,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                )
            )
            completed_records = result.scalar() or 0
            training_pct = (completed_records / total_records * 100) if total_records > 0 else 0.0
    except Exception as exc:
        logger.warning("admin-summary: training compliance query failed: %s", exc)

    # ── Upcoming events ──
    upcoming_events = 0
    try:
        result = await db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.start_datetime >= datetime.now(timezone.utc),
                Event.is_cancelled == False,  # noqa: E712
            )
        )
        upcoming_events = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: upcoming events query failed: %s", exc)

    # ── Action items (overdue + open) from meetings ──
    overdue_meeting = 0
    open_meeting = 0
    try:
        result = await db.execute(
            select(func.count(MeetingActionItem.id)).where(
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_([ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]),
                MeetingActionItem.due_date < date.today(),
            )
        )
        overdue_meeting = result.scalar() or 0

        result = await db.execute(
            select(func.count(MeetingActionItem.id)).where(
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_([ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]),
            )
        )
        open_meeting = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: meeting action items query failed: %s", exc)

    # ── Action items from minutes (scoped to organization via MeetingMinutes) ──
    overdue_minutes = 0
    open_minutes = 0
    try:
        result = await db.execute(
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                MeetingMinutes.organization_id == org_id,
                ActionItem.status.in_([
                    MinutesActionItemStatus.PENDING.value,
                    MinutesActionItemStatus.IN_PROGRESS.value,
                ]),
                ActionItem.due_date < datetime.now(timezone.utc),
            )
        )
        overdue_minutes = result.scalar() or 0

        result = await db.execute(
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                MeetingMinutes.organization_id == org_id,
                ActionItem.status.in_([
                    MinutesActionItemStatus.PENDING.value,
                    MinutesActionItemStatus.IN_PROGRESS.value,
                ]),
            )
        )
        open_minutes = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: minutes action items query failed: %s", exc)

    # ── Recent training hours (last 30 days) ──
    recent_hours = 0.0
    try:
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        result = await db.execute(
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= thirty_days_ago.date(),
            )
        )
        recent_hours = float(result.scalar() or 0)
    except Exception as exc:
        logger.warning("admin-summary: recent training hours query failed: %s", exc)

    return AdminSummary(
        active_members=active_members,
        inactive_members=inactive_members,
        total_members=total_members,
        training_completion_pct=round(training_pct, 1),
        upcoming_events_count=upcoming_events,
        overdue_action_items=overdue_meeting + overdue_minutes,
        open_action_items=open_meeting + open_minutes,
        recent_training_hours=recent_hours,
    )


@router.get("/action-items", response_model=List[ActionItemSummary])
async def get_unified_action_items(
    status_filter: Optional[str] = None,
    assigned_to_me: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> List[ActionItemSummary]:
    """
    Unified view of action items from both Meeting and Minutes modules.
    Merges results and returns them sorted by due date.
    """
    org_id = current_user.organization_id
    items: List[ActionItemSummary] = []

    # ── Meeting action items ──
    query = select(MeetingActionItem).where(
        MeetingActionItem.organization_id == org_id,
    )
    if status_filter:
        query = query.where(MeetingActionItem.status == status_filter)
    if assigned_to_me:
        query = query.where(MeetingActionItem.assigned_to == current_user.id)

    result = await db.execute(query.order_by(MeetingActionItem.due_date.asc()))
    for item in result.scalars().all():
        items.append(ActionItemSummary(
            id=item.id,
            source="meeting",
            source_id=item.meeting_id,
            description=item.description,
            assignee_id=item.assigned_to,
            due_date=item.due_date.isoformat() if item.due_date else None,
            status=item.status.value if hasattr(item.status, 'value') else str(item.status),
            priority=str(item.priority) if item.priority else None,
            created_at=item.created_at.isoformat() if item.created_at else "",
        ))

    # ── Minutes action items (scoped to organization via MeetingMinutes) ──
    query2 = (
        select(ActionItem)
        .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
        .where(MeetingMinutes.organization_id == org_id)
    )
    if status_filter:
        query2 = query2.where(ActionItem.status == status_filter)
    if assigned_to_me:
        query2 = query2.where(ActionItem.assignee_id == current_user.id)

    result2 = await db.execute(query2.order_by(ActionItem.due_date.asc()))
    for item in result2.scalars().all():
        items.append(ActionItemSummary(
            id=item.id,
            source="minutes",
            source_id=item.minutes_id,
            description=item.description,
            assignee_id=item.assignee_id,
            assignee_name=item.assignee_name,
            due_date=item.due_date.isoformat() if item.due_date else None,
            status=item.status.value if hasattr(item.status, 'value') else str(item.status),
            priority=item.priority.value if hasattr(item.priority, 'value') else str(item.priority) if item.priority else None,
            created_at=item.created_at.isoformat() if item.created_at else "",
        ))

    # Sort by due date (nulls last)
    items.sort(key=lambda x: x.due_date or "9999-12-31")
    return items


@router.get("/community-engagement", response_model=CommunityEngagement)
async def get_community_engagement(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
) -> CommunityEngagement:
    """
    Community engagement metrics for Public Outreach Coordinators.
    Aggregates public event data and attendee counts.
    """
    org_id = current_user.organization_id
    public_types = [
        EventType.PUBLIC_EDUCATION.value,
        EventType.FUNDRAISER.value,
        EventType.CEREMONY.value,
        EventType.SOCIAL.value,
    ]

    # Total public events (all time)
    result = await db.execute(
        select(func.count(Event.id)).where(
            Event.organization_id == org_id,
            Event.event_type.in_(public_types),
            Event.is_cancelled == False,  # noqa: E712
        )
    )
    total_public = result.scalar() or 0

    # Total member attendees at public events (checked in)
    result = await db.execute(
        select(func.count(EventRSVP.id)).where(
            EventRSVP.organization_id == org_id,
            EventRSVP.checked_in == True,  # noqa: E712
            EventRSVP.event_id.in_(
                select(Event.id).where(
                    Event.organization_id == org_id,
                    Event.event_type.in_(public_types),
                )
            ),
        )
    )
    total_member_attendees = result.scalar() or 0

    # Total external attendees
    result = await db.execute(
        select(func.count(EventExternalAttendee.id)).where(
            EventExternalAttendee.organization_id == org_id,
        )
    )
    total_external = result.scalar() or 0

    # Upcoming public events
    result = await db.execute(
        select(func.count(Event.id)).where(
            Event.organization_id == org_id,
            Event.event_type.in_(public_types),
            Event.start_datetime >= datetime.now(timezone.utc),
            Event.is_cancelled == False,  # noqa: E712
        )
    )
    upcoming_public = result.scalar() or 0

    return CommunityEngagement(
        total_public_events=total_public,
        total_member_attendees=total_member_attendees,
        total_external_attendees=total_external,
        upcoming_public_events=upcoming_public,
    )
