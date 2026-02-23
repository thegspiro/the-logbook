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

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.dependencies import get_current_user, require_permission, _collect_user_permissions, _has_permission
from app.models.user import User
from app.services.member_leave_service import MemberLeaveService

router = APIRouter()


# ==================== Schemas ====================

class LeaveOfAbsenceCreate(BaseModel):
    user_id: str
    leave_type: str = "leave_of_absence"
    reason: Optional[str] = None
    start_date: date
    end_date: date
    exempt_from_training_waiver: bool = False  # Override: keep training requirements active


class LeaveOfAbsenceUpdate(BaseModel):
    leave_type: Optional[str] = None
    reason: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    active: Optional[bool] = None
    exempt_from_training_waiver: Optional[bool] = None


class LeaveOfAbsenceResponse(BaseModel):
    id: str
    organization_id: str
    user_id: str
    leave_type: str
    reason: Optional[str] = None
    start_date: date
    end_date: date
    granted_by: Optional[str] = None
    granted_at: Optional[datetime] = None
    active: bool
    exempt_from_training_waiver: bool = False
    linked_training_waiver_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ==================== Helpers ====================

def _to_response(leave) -> LeaveOfAbsenceResponse:
    return LeaveOfAbsenceResponse(
        id=str(leave.id),
        organization_id=str(leave.organization_id),
        user_id=str(leave.user_id),
        leave_type=leave.leave_type.value if hasattr(leave.leave_type, 'value') else str(leave.leave_type),
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

@router.post("/leaves-of-absence", response_model=LeaveOfAbsenceResponse, status_code=status.HTTP_201_CREATED)
async def create_leave_of_absence(
    data: LeaveOfAbsenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Create a leave of absence for a member."""
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    svc = MemberLeaveService(db)
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
    return _to_response(leave)


@router.get("/leaves-of-absence", response_model=List[LeaveOfAbsenceResponse])
async def list_leaves_of_absence(
    user_id: Optional[str] = Query(None),
    active_only: bool = Query(True),
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
    return [_to_response(l) for l in leaves]


@router.get("/leaves-of-absence/me", response_model=List[LeaveOfAbsenceResponse])
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
    return [_to_response(l) for l in leaves]


@router.get("/{user_id}/leaves-of-absence", response_model=List[LeaveOfAbsenceResponse])
async def get_member_leaves(
    user_id: str,
    active_only: bool = Query(True),
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
    return [_to_response(l) for l in leaves]


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
    leave = await svc.update_leave(
        organization_id=str(current_user.organization_id),
        leave_id=leave_id,
        **updates,
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Leave of absence not found")
    return _to_response(leave)


@router.delete("/leaves-of-absence/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_leave_of_absence(
    leave_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Deactivate a leave of absence (soft delete)."""
    svc = MemberLeaveService(db)
    success = await svc.deactivate_leave(
        organization_id=str(current_user.organization_id),
        leave_id=leave_id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Leave of absence not found")
