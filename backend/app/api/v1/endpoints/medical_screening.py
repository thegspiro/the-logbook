"""
Medical Screening API Endpoints

Endpoints for managing medical screening requirements, records,
and compliance tracking for active members and prospective members.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.user import User
from app.schemas.medical_screening import (
    ComplianceSummary,
    ExpiringScreening,
    ScreeningRecordCreate,
    ScreeningRecordResponse,
    ScreeningRecordUpdate,
    ScreeningRequirementCreate,
    ScreeningRequirementResponse,
    ScreeningRequirementUpdate,
)
from app.services.medical_screening_service import MedicalScreeningService

router = APIRouter()


# --- Screening Requirements ---


@router.get(
    "/requirements",
    response_model=List[ScreeningRequirementResponse],
)
async def list_requirements(
    is_active: Optional[bool] = Query(None),
    screening_type: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """List screening requirements for the current organization."""
    service = MedicalScreeningService(db)
    requirements = await service.list_requirements(
        organization_id=current_user.organization_id,
        is_active=is_active,
        screening_type=screening_type,
    )
    return requirements[pagination.skip : pagination.skip + pagination.limit]


@router.get(
    "/requirements/{requirement_id}",
    response_model=ScreeningRequirementResponse,
)
async def get_requirement(
    requirement_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """Get a single screening requirement."""
    service = MedicalScreeningService(db)
    requirement = await service.get_requirement(
        requirement_id, current_user.organization_id
    )
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening requirement not found",
        )
    return requirement


@router.post(
    "/requirements",
    response_model=ScreeningRequirementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_requirement(
    data: ScreeningRequirementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Create a new screening requirement."""
    service = MedicalScreeningService(db)
    requirement = await service.create_requirement(
        organization_id=current_user.organization_id,
        data=data,
    )
    await log_audit_event(
        db=db,
        event_type="medical_screening.requirement_created",
        event_category="medical_screening",
        severity="info",
        event_data={"requirement_name": data.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return requirement


@router.put(
    "/requirements/{requirement_id}",
    response_model=ScreeningRequirementResponse,
)
async def update_requirement(
    requirement_id: str,
    data: ScreeningRequirementUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Update a screening requirement."""
    service = MedicalScreeningService(db)
    requirement = await service.update_requirement(
        requirement_id, current_user.organization_id, data
    )
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening requirement not found",
        )
    await log_audit_event(
        db=db,
        event_type="medical_screening.requirement_updated",
        event_category="medical_screening",
        severity="info",
        event_data={"requirement_id": requirement_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return requirement


@router.delete(
    "/requirements/{requirement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_requirement(
    requirement_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Delete a screening requirement."""
    service = MedicalScreeningService(db)
    deleted = await service.delete_requirement(
        requirement_id, current_user.organization_id
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening requirement not found",
        )
    await log_audit_event(
        db=db,
        event_type="medical_screening.requirement_deleted",
        event_category="medical_screening",
        severity="warning",
        event_data={"requirement_id": requirement_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()


# --- Screening Records ---


@router.get(
    "/records",
    response_model=List[ScreeningRecordResponse],
)
async def list_records(
    user_id: Optional[str] = Query(None),
    prospect_id: Optional[str] = Query(None),
    screening_type: Optional[str] = Query(None),
    record_status: Optional[str] = Query(None, alias="status"),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """List screening records with optional filters."""
    service = MedicalScreeningService(db)
    records = await service.list_records(
        organization_id=current_user.organization_id,
        user_id=user_id,
        prospect_id=prospect_id,
        screening_type=screening_type,
        status=record_status,
    )
    return records[pagination.skip : pagination.skip + pagination.limit]


@router.get(
    "/records/{record_id}",
    response_model=ScreeningRecordResponse,
)
async def get_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """Get a single screening record."""
    service = MedicalScreeningService(db)
    record = await service.get_record(record_id, current_user.organization_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening record not found",
        )
    return record


@router.post(
    "/records",
    response_model=ScreeningRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_record(
    data: ScreeningRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Create a new screening record."""
    service = MedicalScreeningService(db)
    record = await service.create_record(
        organization_id=current_user.organization_id,
        data=data,
    )
    await log_audit_event(
        db=db,
        event_type="medical_screening.record_created",
        event_category="medical_screening",
        severity="info",
        event_data={
            "record_user_id": data.user_id,
            "screening_type": data.screening_type,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return record


@router.put(
    "/records/{record_id}",
    response_model=ScreeningRecordResponse,
)
async def update_record(
    record_id: str,
    data: ScreeningRecordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Update a screening record."""
    service = MedicalScreeningService(db)
    record = await service.update_record(
        record_id,
        current_user.organization_id,
        data,
        reviewed_by=current_user.id,
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening record not found",
        )
    await log_audit_event(
        db=db,
        event_type="medical_screening.record_updated",
        event_category="medical_screening",
        severity="info",
        event_data={"record_id": record_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return record


@router.delete(
    "/records/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.manage")),
):
    """Delete a screening record."""
    service = MedicalScreeningService(db)
    deleted = await service.delete_record(record_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening record not found",
        )
    await log_audit_event(
        db=db,
        event_type="medical_screening.record_deleted",
        event_category="medical_screening",
        severity="warning",
        event_data={"record_id": record_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()


# --- Compliance ---


@router.get(
    "/compliance/{user_id}",
    response_model=ComplianceSummary,
)
async def get_user_compliance(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """Get compliance status for a specific user."""
    service = MedicalScreeningService(db)
    return await service.get_compliance_status(
        organization_id=current_user.organization_id,
        user_id=user_id,
    )


@router.get(
    "/compliance/prospect/{prospect_id}",
    response_model=ComplianceSummary,
)
async def get_prospect_compliance(
    prospect_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """Get compliance status for a prospective member."""
    service = MedicalScreeningService(db)
    return await service.get_compliance_status(
        organization_id=current_user.organization_id,
        prospect_id=prospect_id,
    )


@router.get(
    "/expiring",
    response_model=List[ExpiringScreening],
)
async def get_expiring_screenings(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("medical_screening.view")),
):
    """Get screening records expiring within the specified number of days."""
    service = MedicalScreeningService(db)
    return await service.get_expiring_soon(
        organization_id=current_user.organization_id,
        days=days,
    )
