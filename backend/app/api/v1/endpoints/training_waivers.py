"""
Training Waivers API Endpoints

Manages leave of absence / waiver periods for training requirements.
When a member has an active waiver for a month, that month is excluded
from rolling-period requirement calculations.

POST   /training/waivers          - Create a waiver (training officers)
GET    /training/waivers          - List waivers (training officers)
GET    /training/waivers/me       - Get current user's waivers
PATCH  /training/waivers/{id}     - Update a waiver (training officers)
DELETE /training/waivers/{id}     - Deactivate a waiver (training officers)
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User
from app.models.training import TrainingWaiver, TrainingWaiverType
from app.core.utils import generate_uuid

router = APIRouter()


# ==================== Schemas ====================

class TrainingWaiverCreate(BaseModel):
    user_id: str
    waiver_type: str = "leave_of_absence"
    reason: Optional[str] = None
    start_date: date
    end_date: date
    requirement_ids: Optional[List[str]] = None


class TrainingWaiverUpdate(BaseModel):
    waiver_type: Optional[str] = None
    reason: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    requirement_ids: Optional[List[str]] = None
    active: Optional[bool] = None


class TrainingWaiverResponse(BaseModel):
    id: str
    organization_id: str
    user_id: str
    waiver_type: str
    reason: Optional[str] = None
    start_date: date
    end_date: date
    requirement_ids: Optional[List[str]] = None
    granted_by: Optional[str] = None
    granted_at: Optional[datetime] = None
    active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ==================== Endpoints ====================

@router.post("", response_model=TrainingWaiverResponse, status_code=status.HTTP_201_CREATED)
async def create_training_waiver(
    data: TrainingWaiverCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Create a training waiver / leave of absence for a member."""
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # Validate waiver type
    try:
        waiver_type = TrainingWaiverType(data.waiver_type)
    except ValueError:
        waiver_type = TrainingWaiverType.OTHER

    waiver = TrainingWaiver(
        id=generate_uuid(),
        organization_id=str(current_user.organization_id),
        user_id=data.user_id,
        waiver_type=waiver_type,
        reason=data.reason,
        start_date=data.start_date,
        end_date=data.end_date,
        requirement_ids=data.requirement_ids,
        granted_by=str(current_user.id),
        granted_at=datetime.utcnow(),
        active=True,
    )
    db.add(waiver)
    await db.commit()
    await db.refresh(waiver)

    return _to_response(waiver)


@router.get("", response_model=List[TrainingWaiverResponse])
async def list_training_waivers(
    user_id: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """List training waivers for the organization."""
    query = select(TrainingWaiver).where(
        TrainingWaiver.organization_id == str(current_user.organization_id)
    )

    if user_id:
        query = query.where(TrainingWaiver.user_id == user_id)
    if active_only:
        query = query.where(TrainingWaiver.active == True)  # noqa: E712

    query = query.order_by(TrainingWaiver.start_date.desc())
    result = await db.execute(query)
    waivers = result.scalars().all()

    return [_to_response(w) for w in waivers]


@router.get("/me", response_model=List[TrainingWaiverResponse])
async def get_my_waivers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's training waivers."""
    result = await db.execute(
        select(TrainingWaiver)
        .where(
            TrainingWaiver.organization_id == str(current_user.organization_id),
            TrainingWaiver.user_id == str(current_user.id),
            TrainingWaiver.active == True,  # noqa: E712
        )
        .order_by(TrainingWaiver.start_date.desc())
    )
    waivers = result.scalars().all()
    return [_to_response(w) for w in waivers]


@router.patch("/{waiver_id}", response_model=TrainingWaiverResponse)
async def update_training_waiver(
    waiver_id: str,
    data: TrainingWaiverUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Update a training waiver."""
    result = await db.execute(
        select(TrainingWaiver)
        .where(
            TrainingWaiver.id == waiver_id,
            TrainingWaiver.organization_id == str(current_user.organization_id),
        )
    )
    waiver = result.scalar_one_or_none()
    if not waiver:
        raise HTTPException(status_code=404, detail="Waiver not found")

    updates = data.model_dump(exclude_unset=True)
    if "waiver_type" in updates:
        try:
            updates["waiver_type"] = TrainingWaiverType(updates["waiver_type"])
        except ValueError:
            updates["waiver_type"] = TrainingWaiverType.OTHER

    for key, value in updates.items():
        setattr(waiver, key, value)

    waiver.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(waiver)

    return _to_response(waiver)


@router.delete("/{waiver_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_training_waiver(
    waiver_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Deactivate a training waiver (soft delete)."""
    result = await db.execute(
        select(TrainingWaiver)
        .where(
            TrainingWaiver.id == waiver_id,
            TrainingWaiver.organization_id == str(current_user.organization_id),
        )
    )
    waiver = result.scalar_one_or_none()
    if not waiver:
        raise HTTPException(status_code=404, detail="Waiver not found")

    waiver.active = False
    waiver.updated_at = datetime.utcnow()
    await db.commit()


def _to_response(waiver: TrainingWaiver) -> TrainingWaiverResponse:
    return TrainingWaiverResponse(
        id=str(waiver.id),
        organization_id=str(waiver.organization_id),
        user_id=str(waiver.user_id),
        waiver_type=waiver.waiver_type.value if hasattr(waiver.waiver_type, 'value') else str(waiver.waiver_type),
        reason=waiver.reason,
        start_date=waiver.start_date,
        end_date=waiver.end_date,
        requirement_ids=waiver.requirement_ids,
        granted_by=str(waiver.granted_by) if waiver.granted_by else None,
        granted_at=waiver.granted_at,
        active=waiver.active,
        created_at=waiver.created_at,
        updated_at=waiver.updated_at,
    )
