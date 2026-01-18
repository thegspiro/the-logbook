"""
Training API Endpoints

Endpoints for training management including courses, records, requirements, and reports.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import date, datetime

from app.core.database import get_db
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.user import User
from app.schemas.training import (
    TrainingCourseCreate,
    TrainingCourseUpdate,
    TrainingCourseResponse,
    TrainingRecordCreate,
    TrainingRecordUpdate,
    TrainingRecordResponse,
    TrainingRequirementCreate,
    TrainingRequirementUpdate,
    TrainingRequirementResponse,
    UserTrainingStats,
    TrainingReport,
    RequirementProgress,
)
from app.services.training_service import TrainingService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# Training Courses

@router.get("/courses", response_model=List[TrainingCourseResponse])
async def list_courses(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all training courses

    **Authentication required**
    """
    query = select(TrainingCourse).where(
        TrainingCourse.organization_id == current_user.organization_id
    )

    if active_only:
        query = query.where(TrainingCourse.active == True)

    query = query.order_by(TrainingCourse.name)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/courses", response_model=TrainingCourseResponse, status_code=status.HTTP_201_CREATED)
async def create_course(
    course: TrainingCourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new training course

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    new_course = TrainingCourse(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        **course.model_dump()
    )

    db.add(new_course)
    await db.commit()
    await db.refresh(new_course)

    return new_course


@router.get("/courses/{course_id}", response_model=TrainingCourseResponse)
async def get_course(
    course_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific training course

    **Authentication required**
    """
    result = await db.execute(
        select(TrainingCourse)
        .where(TrainingCourse.id == course_id)
        .where(TrainingCourse.organization_id == current_user.organization_id)
    )
    course = result.scalar_one_or_none()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    return course


@router.patch("/courses/{course_id}", response_model=TrainingCourseResponse)
async def update_course(
    course_id: UUID,
    course_update: TrainingCourseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a training course

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(TrainingCourse)
        .where(TrainingCourse.id == course_id)
        .where(TrainingCourse.organization_id == current_user.organization_id)
    )
    course = result.scalar_one_or_none()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Update fields
    for field, value in course_update.model_dump(exclude_unset=True).items():
        setattr(course, field, value)

    await db.commit()
    await db.refresh(course)

    return course


# Training Records

@router.get("/records", response_model=List[TrainingRecordResponse])
async def list_records(
    user_id: Optional[UUID] = None,
    status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List training records

    **Authentication required**
    """
    query = select(TrainingRecord).where(
        TrainingRecord.organization_id == current_user.organization_id
    )

    if user_id:
        query = query.where(TrainingRecord.user_id == user_id)

    if status:
        query = query.where(TrainingRecord.status == status)

    if start_date:
        query = query.where(TrainingRecord.completion_date >= start_date)

    if end_date:
        query = query.where(TrainingRecord.completion_date <= end_date)

    query = query.order_by(TrainingRecord.completion_date.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/records", response_model=TrainingRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_record(
    record: TrainingRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new training record

    **Authentication required**
    """
    new_record = TrainingRecord(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        **record.model_dump()
    )

    db.add(new_record)
    await db.commit()
    await db.refresh(new_record)

    return new_record


@router.patch("/records/{record_id}", response_model=TrainingRecordResponse)
async def update_record(
    record_id: UUID,
    record_update: TrainingRecordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update a training record

    **Authentication required**
    """
    result = await db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.id == record_id)
        .where(TrainingRecord.organization_id == current_user.organization_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Record not found"
        )

    # Update fields
    for field, value in record_update.model_dump(exclude_unset=True).items():
        setattr(record, field, value)

    await db.commit()
    await db.refresh(record)

    return record


# Training Requirements

@router.get("/requirements", response_model=List[TrainingRequirementResponse])
async def list_requirements(
    year: Optional[int] = Query(None, description="Filter by year"),
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List training requirements

    **Authentication required**
    """
    query = select(TrainingRequirement).where(
        TrainingRequirement.organization_id == current_user.organization_id
    )

    if active_only:
        query = query.where(TrainingRequirement.active == True)

    if year:
        query = query.where(TrainingRequirement.year == year)

    query = query.order_by(TrainingRequirement.due_date)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/requirements", response_model=TrainingRequirementResponse, status_code=status.HTTP_201_CREATED)
async def create_requirement(
    requirement: TrainingRequirementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new training requirement

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    new_requirement = TrainingRequirement(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        **requirement.model_dump()
    )

    db.add(new_requirement)
    await db.commit()
    await db.refresh(new_requirement)

    return new_requirement


@router.patch("/requirements/{requirement_id}", response_model=TrainingRequirementResponse)
async def update_requirement(
    requirement_id: UUID,
    requirement_update: TrainingRequirementUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a training requirement

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(TrainingRequirement)
        .where(TrainingRequirement.id == requirement_id)
        .where(TrainingRequirement.organization_id == current_user.organization_id)
    )
    requirement = result.scalar_one_or_none()

    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requirement not found"
        )

    # Update fields
    for field, value in requirement_update.model_dump(exclude_unset=True).items():
        setattr(requirement, field, value)

    await db.commit()
    await db.refresh(requirement)

    return requirement


# Statistics and Reports

@router.get("/stats/user/{user_id}", response_model=UserTrainingStats)
async def get_user_stats(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get training statistics for a user

    **Authentication required**
    """
    training_service = TrainingService(db)
    stats = await training_service.get_user_training_stats(
        user_id=user_id,
        organization_id=current_user.organization_id
    )
    return stats


@router.get("/reports/user/{user_id}", response_model=TrainingReport)
async def generate_user_report(
    user_id: UUID,
    start_date: date = Query(..., description="Start date for report"),
    end_date: date = Query(..., description="End date for report"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a training report for a user

    **Authentication required**
    """
    training_service = TrainingService(db)
    report = await training_service.generate_training_report(
        organization_id=current_user.organization_id,
        start_date=start_date,
        end_date=end_date,
        user_id=user_id
    )
    return report


@router.get("/requirements/progress/{user_id}", response_model=List[RequirementProgress])
async def get_requirements_progress(
    user_id: UUID,
    year: Optional[int] = Query(None, description="Year for requirements"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get progress towards all requirements for a user

    **Authentication required**
    """
    training_service = TrainingService(db)
    progress = await training_service.get_all_requirements_progress(
        user_id=user_id,
        organization_id=current_user.organization_id,
        year=year
    )
    return progress


@router.get("/certifications/expiring", response_model=List[TrainingRecordResponse])
async def get_expiring_certifications(
    days_ahead: int = Query(90, description="Number of days to look ahead"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get certifications expiring within the specified timeframe

    **Authentication required**
    """
    training_service = TrainingService(db)
    expiring = await training_service.get_expiring_certifications(
        organization_id=current_user.organization_id,
        days_ahead=days_ahead
    )
    return expiring
