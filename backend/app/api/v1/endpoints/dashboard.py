"""
Dashboard Endpoints

Provides aggregated statistics for the main dashboard,
including an admin-level summary for Chiefs and department leaders.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_active_user,
    require_permission,
    user_has_permission,
)
from app.core.database import get_db
from app.models.admin_hours import AdminHoursEntry, AdminHoursEntryStatus
from app.models.event import Event, EventExternalAttendee, EventRSVP, EventType
from app.models.meeting import ActionItemStatus, MeetingActionItem
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesMeetingType,
    MinutesStatus,
)
from app.models.notification import NotificationLog
from app.models.training import (
    Shift,
    ShiftEquipmentCheck,
    TrainingRecord,
    TrainingStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.organization_service import OrganizationService
from app.services.training_compliance import compute_org_compliance_pct

router = APIRouter()


def minutes_visibility_filter(current_user: User):
    """WHERE clause confining minutes action items to what *user* may see.

    Returns ``None`` for a ``minutes.manage`` holder (no restriction).

    MM-3 restricted draft and executive-session minutes to `minutes.manage`
    holders in the minutes module's own reads, but an action item carries that
    minutes record's free text in its ``description`` — an executive-session
    item can name a member alongside a disciplinary or legal matter. Any
    endpoint that reads `ActionItem` across the organization has to apply the
    same gate or it re-opens what MM-3 closed.

    The assignee carve-out is deliberate: an item assigned *to* the caller is
    work they are expected to do, and without it ``assigned_to_me`` would hide
    a member's own tasks from them.
    """
    if user_has_permission(current_user, "minutes.manage"):
        return None
    return or_(
        and_(
            MeetingMinutes.status == MinutesStatus.APPROVED.value,
            MeetingMinutes.meeting_type != MinutesMeetingType.EXECUTIVE.value,
        ),
        ActionItem.assignee_id == current_user.id,
    )


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
    recent_admin_hours: float
    pending_admin_hours_approvals: int


class ActionItemSummary(BaseModel):
    """Unified action item from either meetings or minutes."""

    id: str
    source: str  # "meeting" or "minutes"
    source_id: str
    description: str
    assignee_id: str | None = None
    assignee_name: str | None = None
    due_date: str | None = None
    status: str
    priority: str | None = None
    created_at: str


class CommunityEngagement(BaseModel):
    """Community engagement metrics for Public Outreach."""

    total_public_events: int
    total_member_attendees: int
    total_external_attendees: int
    upcoming_public_events: int


class OperationsItem(BaseModel):
    """A compact, non-sensitive operational exception or approval summary."""

    key: str
    label: str
    severity: str
    count: int
    oldest_age_days: int | None = None
    most_urgent: str | None = None
    href: str


class OperationsSection(BaseModel):
    key: str
    title: str
    items: list[OperationsItem]


class OperationsDashboard(BaseModel):
    generated_at: datetime
    timezone: str
    sections: list[OperationsSection]


# This is deliberately a data-source permission map, not a chief-role or
# settings.manage gate.  It is also mirrored by the frontend widget registry.
OPERATIONS_SECTION_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "operational_readiness": ("scheduling.manage",),
    "critical_exceptions": (
        "meetings.manage",
        "minutes.manage",
        "scheduling.manage",
        "equipment_check.manage",
        "notifications.manage",
    ),
    "membership_health": ("members.manage",),
    "upcoming_command_dates": ("events.manage",),
    "period_trends": ("training.manage",),
    "pending_approvals": ("admin_hours.manage",),
}


def _has_any(current_user: User, permissions: tuple[str, ...]) -> bool:
    return any(
        user_has_permission(current_user, permission) for permission in permissions
    )


def _age_days(value: date | datetime | None, today: date) -> int | None:
    if value is None:
        return None
    return max(
        0, (today - (value.date() if isinstance(value, datetime) else value)).days
    )


async def _count_and_oldest(db: AsyncSession, model, *criteria, date_column):
    result = await db.execute(
        select(func.count(model.id), func.min(date_column)).where(*criteria)
    )
    row = result.one()
    return int(row[0] or 0), row[1]


@router.get("/operations", response_model=OperationsDashboard)
async def get_operations_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> OperationsDashboard:
    """Return only the operational sections the caller is allowed to know.

    A missing section is intentional: callers cannot distinguish an empty data
    source from one they cannot access. Every statement includes the tenant id.
    """
    org_id = current_user.organization_id
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    timezone_name = (org.timezone if org else None) or "UTC"
    try:
        org_tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone_name, org_tz = "UTC", timezone.utc
    now = datetime.now(timezone.utc)
    local_today = now.astimezone(org_tz).date()
    local_midnight = datetime.combine(local_today, time.min, org_tz).astimezone(
        timezone.utc
    )
    enabled = set(
        (await OrganizationService(db).get_enabled_modules(org_id)).enabled_modules
    )
    sections: list[OperationsSection] = []

    if "scheduling" in enabled and _has_any(
        current_user, OPERATIONS_SECTION_PERMISSIONS["operational_readiness"]
    ):
        count, oldest = await _count_and_oldest(
            db,
            Shift,
            Shift.organization_id == org_id,
            Shift.shift_date == local_today,
            date_column=Shift.shift_date,
        )
        sections.append(
            OperationsSection(
                key="operational_readiness",
                title="Operational readiness",
                items=[
                    OperationsItem(
                        key="today_shifts",
                        label="Today's shifts",
                        severity="info",
                        count=count,
                        oldest_age_days=_age_days(oldest, local_today),
                        href="/scheduling/manage",
                    )
                ],
            )
        )

    exception_items: list[OperationsItem] = []
    if "scheduling" in enabled and user_has_permission(
        current_user, "scheduling.manage"
    ):
        count, oldest = await _count_and_oldest(
            db,
            Shift,
            Shift.organization_id == org_id,
            Shift.shift_date >= local_today,
            Shift.shift_officer_id.is_(None),
            date_column=Shift.shift_date,
        )
        exception_items.append(
            OperationsItem(
                key="unassigned_shift_officers",
                label="Shifts without an officer",
                severity="critical" if count else "ok",
                count=count,
                oldest_age_days=_age_days(oldest, local_today),
                most_urgent="Next shift without an officer" if count else None,
                href="/scheduling/manage?filter=missing-officer",
            )
        )
    if "minutes" in enabled and user_has_permission(current_user, "meetings.manage"):
        count, oldest = await _count_and_oldest(
            db,
            MeetingActionItem,
            MeetingActionItem.organization_id == org_id,
            MeetingActionItem.status.in_(
                [ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]
            ),
            MeetingActionItem.due_date < local_today,
            date_column=MeetingActionItem.due_date,
        )
        exception_items.append(
            OperationsItem(
                key="overdue_action_items",
                label="Overdue action items",
                severity="critical" if count else "ok",
                count=count,
                oldest_age_days=_age_days(oldest, local_today),
                most_urgent="Oldest overdue action item" if count else None,
                href="/action-items?status=overdue",
            )
        )
    # Minutes descriptions are never queried here. A minutes count is disclosed
    # only to minutes.manage holders, preserving executive/draft confidentiality.
    if "minutes" in enabled and user_has_permission(current_user, "minutes.manage"):
        # Explicit join is required because ActionItem has no organization_id.
        result = await db.execute(
            select(func.count(ActionItem.id), func.min(ActionItem.due_date))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                MeetingMinutes.organization_id == org_id,
                ActionItem.status.in_(
                    [
                        MinutesActionItemStatus.PENDING.value,
                        MinutesActionItemStatus.IN_PROGRESS.value,
                    ]
                ),
                ActionItem.due_date < now,
            )
        )
        count, oldest = result.one()
        exception_items.append(
            OperationsItem(
                key="minutes_action_items",
                label="Minutes action items",
                severity="critical" if count else "ok",
                count=count or 0,
                oldest_age_days=_age_days(oldest, local_today),
                most_urgent="Oldest overdue minutes action item" if count else None,
                href="/action-items?source=minutes&status=overdue",
            )
        )
    if "scheduling" in enabled and user_has_permission(
        current_user, "equipment_check.manage"
    ):
        count, oldest = await _count_and_oldest(
            db,
            ShiftEquipmentCheck,
            ShiftEquipmentCheck.organization_id == org_id,
            ShiftEquipmentCheck.overall_status.in_(["fail", "incomplete"]),
            date_column=ShiftEquipmentCheck.checked_at,
        )
        exception_items.append(
            OperationsItem(
                key="equipment_checks",
                label="Failed equipment checks",
                severity="critical" if count else "ok",
                count=count,
                oldest_age_days=_age_days(oldest, local_today),
                most_urgent="Oldest unresolved equipment check" if count else None,
                href="/equipment-checks?status=failed",
            )
        )
    if "notifications" in enabled and user_has_permission(
        current_user, "notifications.manage"
    ):
        count, oldest = await _count_and_oldest(
            db,
            NotificationLog,
            NotificationLog.organization_id == org_id,
            NotificationLog.error.is_not(None),
            date_column=NotificationLog.created_at,
        )
        exception_items.append(
            OperationsItem(
                key="notification_failures",
                label="Notification failures",
                severity="critical" if count else "ok",
                count=count,
                oldest_age_days=_age_days(oldest, local_today),
                most_urgent="Oldest delivery failure" if count else None,
                href="/notifications/manage?status=failed",
            )
        )
    if exception_items:
        sections.append(
            OperationsSection(
                key="critical_exceptions",
                title="Critical exceptions",
                items=exception_items,
            )
        )

    if "members" in enabled and _has_any(
        current_user, OPERATIONS_SECTION_PERMISSIONS["membership_health"]
    ):
        result = await db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
                User.status == UserStatus.ACTIVE,
            )
        )
        sections.append(
            OperationsSection(
                key="membership_health",
                title="Membership health",
                items=[
                    OperationsItem(
                        key="active_members",
                        label="Active members",
                        severity="info",
                        count=result.scalar() or 0,
                        href="/members?status=active",
                    )
                ],
            )
        )

    if "events" in enabled and _has_any(
        current_user, OPERATIONS_SECTION_PERMISSIONS["upcoming_command_dates"]
    ):
        boundary = local_midnight + timedelta(days=30)
        result = await db.execute(
            select(func.count(Event.id), func.min(Event.start_datetime)).where(
                Event.organization_id == org_id,
                Event.start_datetime >= local_midnight,
                Event.start_datetime < boundary,
                Event.is_cancelled.is_(False),
            )
        )  # noqa: E712
        count, first = result.one()
        sections.append(
            OperationsSection(
                key="upcoming_command_dates",
                title="Upcoming command dates",
                items=[
                    OperationsItem(
                        key="command_dates",
                        label="Next 30 days",
                        severity="info",
                        count=count or 0,
                        most_urgent=(
                            first.astimezone(org_tz).date().isoformat()
                            if first
                            else None
                        ),
                        href="/events?range=next-30-days",
                    )
                ],
            )
        )

    if "training" in enabled and _has_any(
        current_user, OPERATIONS_SECTION_PERMISSIONS["period_trends"]
    ):
        current_start, previous_start = (
            now - timedelta(days=30),
            now - timedelta(days=60),
        )
        result = await db.execute(
            select(func.count(TrainingRecord.id)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.created_at >= current_start,
            )
        )
        current_count = result.scalar() or 0
        result = await db.execute(
            select(func.count(TrainingRecord.id)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.created_at >= previous_start,
                TrainingRecord.created_at < current_start,
            )
        )
        previous_count = result.scalar() or 0
        sections.append(
            OperationsSection(
                key="period_trends",
                title="Period-over-period trends",
                items=[
                    OperationsItem(
                        key="training_records",
                        label=f"Training records ({current_count - previous_count:+d})",
                        severity="info",
                        count=current_count,
                        href="/training/reports",
                    )
                ],
            )
        )

    if _has_any(current_user, OPERATIONS_SECTION_PERMISSIONS["pending_approvals"]):
        count, oldest = await _count_and_oldest(
            db,
            AdminHoursEntry,
            AdminHoursEntry.organization_id == org_id,
            AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
            date_column=AdminHoursEntry.created_at,
        )
        sections.append(
            OperationsSection(
                key="pending_approvals",
                title="Pending approvals",
                items=[
                    OperationsItem(
                        key="admin_hours",
                        label="Admin hours",
                        severity="warning" if count else "ok",
                        count=count,
                        oldest_age_days=_age_days(oldest, local_today),
                        most_urgent="Oldest pending submission" if count else None,
                        href="/admin-hours/manage?status=pending",
                    )
                ],
            )
        )

    return OperationsDashboard(
        generated_at=now, timezone=timezone_name, sections=sections
    )


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
    # Uses the same logic as the compliance-matrix endpoint: for each active
    # member, evaluate every active training requirement and compute the
    # percentage of members who are fully compliant.
    training_pct = 0.0
    try:
        training_pct = await compute_org_compliance_pct(db, org_id)
    except Exception as exc:
        logger.warning("admin-summary: training compliance query failed: {}", exc)

    # ── Upcoming events (rolling 30-day window) ──
    upcoming_events = 0
    try:
        now_utc = datetime.now(timezone.utc)
        result = await db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.start_datetime >= now_utc,
                Event.start_datetime < now_utc + timedelta(days=30),
                Event.is_cancelled == False,  # noqa: E712
            )
        )
        upcoming_events = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: upcoming events query failed: {}", exc)

    # ── Action items (overdue + open) from meetings ──
    overdue_meeting = 0
    open_meeting = 0
    try:
        result = await db.execute(
            select(func.count(MeetingActionItem.id)).where(
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_(
                    [ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]
                ),
                MeetingActionItem.due_date < date.today(),
            )
        )
        overdue_meeting = result.scalar() or 0

        result = await db.execute(
            select(func.count(MeetingActionItem.id)).where(
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_(
                    [ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]
                ),
            )
        )
        open_meeting = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: meeting action items query failed: {}", exc)

    # ── Action items from minutes (scoped to organization via MeetingMinutes) ──
    overdue_minutes = 0
    open_minutes = 0
    try:
        result = await db.execute(
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                MeetingMinutes.organization_id == org_id,
                ActionItem.status.in_(
                    [
                        MinutesActionItemStatus.PENDING.value,
                        MinutesActionItemStatus.IN_PROGRESS.value,
                    ]
                ),
                ActionItem.due_date < datetime.now(timezone.utc),
            )
        )
        overdue_minutes = result.scalar() or 0

        result = await db.execute(
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                MeetingMinutes.organization_id == org_id,
                ActionItem.status.in_(
                    [
                        MinutesActionItemStatus.PENDING.value,
                        MinutesActionItemStatus.IN_PROGRESS.value,
                    ]
                ),
            )
        )
        open_minutes = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: minutes action items query failed: {}", exc)

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
        logger.warning("admin-summary: recent training hours query failed: {}", exc)

    # ── Admin hours (last 30 days) ──
    recent_admin_hours = 0.0
    pending_admin_approvals = 0
    try:
        thirty_days_ago_admin = datetime.now(timezone.utc) - timedelta(days=30)
        result = await db.execute(
            select(func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0)).where(
                AdminHoursEntry.organization_id == org_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.APPROVED,
                AdminHoursEntry.clock_in_at >= thirty_days_ago_admin,
                AdminHoursEntry.duration_minutes.isnot(None),
            )
        )
        total_minutes = float(result.scalar() or 0)
        recent_admin_hours = round(total_minutes / 60.0, 1)

        result = await db.execute(
            select(func.count(AdminHoursEntry.id)).where(
                AdminHoursEntry.organization_id == org_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
            )
        )
        pending_admin_approvals = result.scalar() or 0
    except Exception as exc:
        logger.warning("admin-summary: admin hours query failed: {}", exc)

    return AdminSummary(
        active_members=active_members,
        inactive_members=inactive_members,
        total_members=total_members,
        training_completion_pct=round(training_pct, 1),
        upcoming_events_count=upcoming_events,
        overdue_action_items=overdue_meeting + overdue_minutes,
        open_action_items=open_meeting + open_minutes,
        recent_training_hours=recent_hours,
        recent_admin_hours=recent_admin_hours,
        pending_admin_hours_approvals=pending_admin_approvals,
    )


@router.get("/action-items", response_model=list[ActionItemSummary])
async def get_unified_action_items(
    status_filter: str | None = None,
    assigned_to_me: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[ActionItemSummary]:
    """
    Unified view of action items from both Meeting and Minutes modules.
    Merges results and returns them sorted by due date.
    """
    org_id = current_user.organization_id
    items: list[ActionItemSummary] = []

    # This unified feed merges two modules and is NOT permission-gated at the
    # route, so gate each half in-code exactly as its owning module does —
    # otherwise a member with neither permission reads every action item's
    # description org-wide (the XC-2 re-exposure; DASH-1 only closed the inner
    # minutes restricted-split, which presupposes the caller already holds
    # minutes.view). Meetings' own action-item read allows meetings.view OR
    # minutes.view; minutes reads require minutes.view.
    can_view_meetings = user_has_permission(
        current_user, "meetings.view"
    ) or user_has_permission(current_user, "minutes.view")
    can_view_minutes = user_has_permission(current_user, "minutes.view")

    # ── Meeting action items ──
    if can_view_meetings:
        query = select(MeetingActionItem).where(
            MeetingActionItem.organization_id == org_id,
        )
        if status_filter:
            query = query.where(MeetingActionItem.status == status_filter)
        if assigned_to_me:
            query = query.where(MeetingActionItem.assigned_to == current_user.id)

        result = await db.execute(query.order_by(MeetingActionItem.due_date.asc()))
        for item in result.scalars().all():
            items.append(
                ActionItemSummary(
                    id=item.id,
                    source="meeting",
                    source_id=item.meeting_id,
                    description=item.description,
                    assignee_id=item.assigned_to,
                    due_date=item.due_date.isoformat() if item.due_date else None,
                    status=(
                        item.status.value
                        if hasattr(item.status, "value")
                        else str(item.status)
                    ),
                    priority=str(item.priority) if item.priority else None,
                    created_at=(item.created_at.isoformat() if item.created_at else ""),
                )
            )

    # ── Minutes action items (scoped to organization via MeetingMinutes) ──
    if can_view_minutes:
        query2 = (
            select(ActionItem)
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(MeetingMinutes.organization_id == org_id)
        )

        restriction = minutes_visibility_filter(current_user)
        if restriction is not None:
            query2 = query2.where(restriction)

        if status_filter:
            query2 = query2.where(ActionItem.status == status_filter)
        if assigned_to_me:
            query2 = query2.where(ActionItem.assignee_id == current_user.id)

        result2 = await db.execute(query2.order_by(ActionItem.due_date.asc()))
        for item in result2.scalars().all():
            items.append(
                ActionItemSummary(
                    id=item.id,
                    source="minutes",
                    source_id=item.minutes_id,
                    description=item.description,
                    assignee_id=item.assignee_id,
                    assignee_name=item.assignee_name,
                    due_date=item.due_date.isoformat() if item.due_date else None,
                    status=(
                        item.status.value
                        if hasattr(item.status, "value")
                        else str(item.status)
                    ),
                    priority=(
                        item.priority.value
                        if hasattr(item.priority, "value")
                        else str(item.priority) if item.priority else None
                    ),
                    created_at=(item.created_at.isoformat() if item.created_at else ""),
                )
            )

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
