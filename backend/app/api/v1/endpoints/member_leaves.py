"""
Member Leave of Absence API Endpoints

Manages leave of absence periods for department members.
When a member has an active leave for a month, that month is excluded
from rolling-period requirement calculations in the training module
and from shift scheduling in the shift module.

These endpoints live under the membership module:
POST   /users/leaves-of-absence                  - Create a leave
GET    /users/leaves-of-absence                  - List leaves (officers)
GET    /users/{user_id}/leaves-of-absence        - Get a member's leaves
GET    /users/leaves-of-absence/me               - Get current user's leaves
PATCH  /users/leaves-of-absence/{id}             - Update a leave
DELETE /users/leaves-of-absence/{id}             - Deactivate a leave
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    PaginationParams,
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_all_permissions,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.user import MemberLeaveOfAbsence, User
from app.services.member_leave_service import MemberLeaveService
from app.services.scheduling_service import SchedulingService

router = APIRouter()


class LeaveWidgetResponse(BaseModel):
    active: int
    ending_within_30_days: int
    open_ended: int
    queue_url: str = "/members?leave=active"


@router.get("/leaves-of-absence/widget-summary", response_model=LeaveWidgetResponse)
async def leave_widget_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Return oversight counts only, scoped to the officer's organization."""
    today = date.today()
    leaves = (
        (
            await db.execute(
                select(MemberLeaveOfAbsence).where(
                    MemberLeaveOfAbsence.organization_id
                    == current_user.organization_id,
                    MemberLeaveOfAbsence.active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    return LeaveWidgetResponse(
        active=len(leaves),
        ending_within_30_days=sum(
            1
            for leave in leaves
            if leave.end_date and today <= leave.end_date <= today + timedelta(days=30)
        ),
        open_ended=sum(1 for leave in leaves if leave.end_date is None),
    )


# ==================== Schemas ====================


class LeaveOfAbsenceCreate(BaseModel):
    user_id: str
    leave_type: str = "leave_of_absence"
    reason: str | None = None
    start_date: date
    end_date: date | None = None  # None = permanent leave
    exempt_from_training_waiver: bool = (
        False  # Override: keep training requirements active
    )


class LeaveOfAbsenceUpdate(BaseModel):
    leave_type: str | None = None
    reason: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    active: bool | None = None
    exempt_from_training_waiver: bool | None = None


class LeaveOfAbsenceResponse(BaseModel):
    id: str
    organization_id: str
    user_id: str
    leave_type: str
    reason: str | None = None
    start_date: date
    end_date: date | None = None
    granted_by: str | None = None
    granted_at: datetime | None = None
    active: bool
    exempt_from_training_waiver: bool = False
    linked_training_waiver_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ==================== Helpers ====================


def _to_response(leave) -> LeaveOfAbsenceResponse:
    return LeaveOfAbsenceResponse(
        id=str(leave.id),
        organization_id=str(leave.organization_id),
        user_id=str(leave.user_id),
        leave_type=(
            leave.leave_type.value
            if hasattr(leave.leave_type, "value")
            else str(leave.leave_type)
        ),
        reason=leave.reason,
        start_date=leave.start_date,
        end_date=leave.end_date,
        granted_by=str(leave.granted_by) if leave.granted_by else None,
        granted_at=leave.granted_at,
        active=leave.active,
        exempt_from_training_waiver=leave.exempt_from_training_waiver,
        linked_training_waiver_id=leave.linked_training_waiver_id,
        created_at=leave.created_at,
        updated_at=leave.updated_at,
    )


# ==================== Endpoints ====================


@router.post(
    "/leaves-of-absence",
    response_model=LeaveOfAbsenceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_leave_of_absence(
    data: LeaveOfAbsenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_all_permissions("members.manage", "scheduling.assign")
    ),
):
    """Create a leave of absence for a member."""
    if data.end_date and data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    svc = MemberLeaveService(db)
    try:
        leave = await svc.create_leave(
            organization_id=str(current_user.organization_id),
            user_id=data.user_id,
            start_date=data.start_date,
            end_date=data.end_date,
            leave_type=data.leave_type,
            reason=data.reason,
            granted_by=str(current_user.id),
            exempt_from_training_waiver=data.exempt_from_training_waiver,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    await log_audit_event(
        db=db,
        event_type="leave_of_absence_created",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(leave.user_id),
            "leave_id": str(leave.id),
            "leave_type": data.leave_type,
            "start_date": data.start_date.isoformat(),
            "end_date": data.end_date.isoformat() if data.end_date else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Keep the schedule representative: drop the member's existing shift
    # assignments during the leave so those slots show as open for fill-in or
    # hold-over. Best-effort — the leave itself is already committed.
    try:
        await SchedulingService(db).cancel_member_assignments_in_range(
            current_user.organization_id,
            data.user_id,
            data.start_date,
            data.end_date,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Failed to cancel shift assignments for leave (user {}): {}",
            data.user_id,
            exc,
        )

    return _to_response(leave)


@router.get("/leaves-of-absence", response_model=list[LeaveOfAbsenceResponse])
async def list_leaves_of_absence(
    user_id: str | None = Query(None),
    active_only: bool = Query(True),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """List leaves of absence for the organization."""
    svc = MemberLeaveService(db)
    leaves = await svc.list_leaves(
        organization_id=str(current_user.organization_id),
        user_id=user_id,
        active_only=active_only,
    )
    paginated = leaves[pagination.skip : pagination.skip + pagination.limit]
    return [_to_response(leave) for leave in paginated]


@router.get("/leaves-of-absence/me", response_model=list[LeaveOfAbsenceResponse])
async def get_my_leaves(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's leaves of absence."""
    svc = MemberLeaveService(db)
    leaves = await svc.list_leaves(
        organization_id=str(current_user.organization_id),
        user_id=str(current_user.id),
        active_only=True,
    )
    return [_to_response(leave) for leave in leaves]


@router.get("/{user_id}/leaves-of-absence", response_model=list[LeaveOfAbsenceResponse])
async def get_member_leaves(
    user_id: str,
    active_only: bool = Query(True),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific member's leaves of absence."""
    # Members can view their own; officers can view anyone's
    is_own = str(current_user.id) == user_id
    if not is_own:
        user_perms = _collect_user_permissions(current_user)
        if not _has_permission("members.manage", user_perms):
            raise HTTPException(status_code=403, detail="Not authorized")

    svc = MemberLeaveService(db)
    leaves = await svc.list_leaves(
        organization_id=str(current_user.organization_id),
        user_id=user_id,
        active_only=active_only,
    )
    paginated = leaves[pagination.skip : pagination.skip + pagination.limit]
    return [_to_response(leave) for leave in paginated]


@router.patch("/leaves-of-absence/{leave_id}", response_model=LeaveOfAbsenceResponse)
async def update_leave_of_absence(
    leave_id: str,
    data: LeaveOfAbsenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Update a leave of absence."""
    svc = MemberLeaveService(db)
    updates = data.model_dump(exclude_unset=True)
    try:
        updated = await svc.update_leave(
            organization_id=str(current_user.organization_id),
            leave_id=leave_id,
            **updates,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    leave = ensure_found(updated, "Leave of absence")

    await log_audit_event(
        db=db,
        event_type="leave_of_absence_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(leave.user_id),
            "leave_id": str(leave.id),
            "fields_changed": sorted(updates.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _to_response(leave)


@router.delete("/leaves-of-absence/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_leave_of_absence(
    leave_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Deactivate a leave of absence (soft delete)."""
    svc = MemberLeaveService(db)
    # Fetched before deactivation so the audit event still has the leave's
    # target member — deactivate_leave returns only a success flag.
    leave = await svc.get_leave(
        organization_id=str(current_user.organization_id), leave_id=leave_id
    )
    success = await svc.deactivate_leave(
        organization_id=str(current_user.organization_id),
        leave_id=leave_id,
    )
    ensure_found(success, "Leave of absence")

    await log_audit_event(
        db=db,
        event_type="leave_of_absence_deleted",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(leave.user_id) if leave else None,
            "leave_id": leave_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
