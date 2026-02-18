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
from app.core.audit import log_audit_event
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingCategory,
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
    TrainingCategoryCreate,
    TrainingCategoryUpdate,
    TrainingCategoryResponse,
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
        .where(TrainingCourse.id == str(course_id))
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
        .where(TrainingCourse.id == str(course_id))
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
        query = query.where(TrainingRecord.user_id == str(user_id))

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

    await log_audit_event(
        db=db,
        event_type="training_record_created",
        event_category="training",
        severity="info",
        event_data={
            "record_id": str(new_record.id),
            "user_id": str(new_record.user_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

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
        .where(TrainingRecord.id == str(record_id))
        .where(TrainingRecord.organization_id == current_user.organization_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Record not found"
        )

    # Update fields
    update_fields = record_update.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(record, field, value)

    await db.commit()
    await db.refresh(record)

    event_data = {"record_id": str(record_id), "fields_updated": list(update_fields.keys())}
    # Detect completion
    if "status" in update_fields and update_fields["status"] == "completed":
        event_data["completion_recorded"] = True
    await log_audit_event(
        db=db,
        event_type="training_record_updated",
        event_category="training",
        severity="info",
        event_data=event_data,
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return record


# Training Categories

@router.get("/categories", response_model=List[TrainingCategoryResponse])
async def list_categories(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all training categories

    **Authentication required**
    """
    query = select(TrainingCategory).where(
        TrainingCategory.organization_id == current_user.organization_id
    )

    if active_only:
        query = query.where(TrainingCategory.active == True)

    query = query.order_by(TrainingCategory.sort_order, TrainingCategory.name)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/categories", response_model=TrainingCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    category: TrainingCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new training category

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    new_category = TrainingCategory(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        **category.model_dump()
    )

    db.add(new_category)
    await db.commit()
    await db.refresh(new_category)

    return new_category


@router.get("/categories/{category_id}", response_model=TrainingCategoryResponse)
async def get_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific training category

    **Authentication required**
    """
    result = await db.execute(
        select(TrainingCategory)
        .where(TrainingCategory.id == str(category_id))
        .where(TrainingCategory.organization_id == current_user.organization_id)
    )
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    return category


@router.patch("/categories/{category_id}", response_model=TrainingCategoryResponse)
async def update_category(
    category_id: UUID,
    category_update: TrainingCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a training category

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(TrainingCategory)
        .where(TrainingCategory.id == str(category_id))
        .where(TrainingCategory.organization_id == current_user.organization_id)
    )
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    # Update fields
    for field, value in category_update.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    await db.commit()
    await db.refresh(category)

    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a training category (soft delete by setting active=False)

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(TrainingCategory)
        .where(TrainingCategory.id == str(category_id))
        .where(TrainingCategory.organization_id == current_user.organization_id)
    )
    category = result.scalar_one_or_none()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found"
        )

    # Soft delete
    category.active = False
    await db.commit()


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
        .where(TrainingRequirement.id == str(requirement_id))
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


@router.delete("/requirements/{requirement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_requirement(
    requirement_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a training requirement (soft delete by setting active=False)

    Requires training officer permissions.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(TrainingRequirement)
        .where(TrainingRequirement.id == str(requirement_id))
        .where(TrainingRequirement.organization_id == current_user.organization_id)
    )
    requirement = result.scalar_one_or_none()

    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requirement not found"
        )

    # Soft delete
    requirement.active = False
    await db.commit()


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


# ============================================
# Competency Matrix / Heat Map
# ============================================

@router.get("/competency-matrix")
async def get_competency_matrix(
    requirement_ids: Optional[str] = Query(None, description="Comma-separated requirement IDs to filter"),
    user_ids: Optional[str] = Query(None, description="Comma-separated user IDs to filter"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Generate a competency matrix / heat map for the department.

    Shows all active members vs. all active training requirements,
    color-coded by status:
    - **current** (green): completed and not expiring soon
    - **expiring_soon** (yellow): expiring within 90 days
    - **expired** (red): past expiration date
    - **not_started** (gray): no record on file

    The `summary` block provides aggregate readiness metrics.

    Requires `training.manage` permission.
    """
    from app.services.competency_matrix_service import CompetencyMatrixService

    service = CompetencyMatrixService(db)
    req_ids = requirement_ids.split(",") if requirement_ids else None
    u_ids = user_ids.split(",") if user_ids else None

    matrix = await service.get_competency_matrix(
        organization_id=current_user.organization_id,
        requirement_ids=req_ids,
        user_ids=u_ids,
    )
    return matrix


# ============================================
# Certification Expiration Alert Processing
# ============================================

@router.post("/certifications/process-alerts")
async def process_certification_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Trigger the certification expiration alert pipeline.

    Sends tiered notifications for expiring and expired certifications:
    - 90/60 days: notify member only
    - 30 days: notify member + CC training officer
    - 7 days: notify member + CC training + compliance officers
    - Expired: escalation with CC to chief

    This endpoint is idempotent — each tier is sent only once.
    In production, wire this to a daily cron job.

    Requires `training.manage` permission.
    """
    from app.services.cert_alert_service import CertAlertService

    service = CertAlertService(db)
    result = await service.process_alerts(current_user.organization_id)
    return result


# ============================================
# Peer Skill Evaluation Sign-Off
# ============================================

@router.post("/skill-evaluations/{skill_id}/check-evaluator")
async def check_evaluator_permission(
    skill_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if the current user is authorized to sign off on a skill evaluation.

    The training officer/chief configures `allowed_evaluators` on each
    SkillEvaluation to control who may sign off:
    - `{"type": "roles", "roles": ["shift_leader", "driver_trainer"]}` — role-based
    - `{"type": "specific_users", "user_ids": ["uuid1", ...]}` — named individuals
    - `null` — any user with `training.manage` permission (default)

    **Authentication required**
    """
    from app.models.training import SkillEvaluation
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(SkillEvaluation)
        .where(SkillEvaluation.id == str(skill_id))
        .where(SkillEvaluation.organization_id == current_user.organization_id)
    )
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill evaluation not found")

    allowed = skill.allowed_evaluators
    is_authorized = False
    reason = ""

    if allowed is None:
        # Default: any user with training.manage permission
        # Check user roles for the permission
        user_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.roles))
        )
        user_with_roles = user_result.scalar_one_or_none()
        if user_with_roles:
            user_perms = set()
            for role in user_with_roles.roles:
                user_perms.update(role.permissions or [])
            is_authorized = "training.manage" in user_perms
        reason = "Authorized via training.manage permission" if is_authorized else "Default: requires training.manage permission"

    elif allowed.get("type") == "roles":
        required_roles = set(allowed.get("roles", []))
        # Load user roles
        user_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.roles))
        )
        user = user_result.scalar_one_or_none()
        if user:
            user_roles = {r.slug for r in user.roles}
            is_authorized = bool(user_roles & required_roles)
            if is_authorized:
                matching = user_roles & required_roles
                reason = f"Authorized via role(s): {', '.join(matching)}"
            else:
                reason = f"Required role(s): {', '.join(required_roles)}"

    elif allowed.get("type") == "specific_users":
        allowed_ids = set(allowed.get("user_ids", []))
        is_authorized = str(current_user.id) in allowed_ids
        reason = "Authorized as designated evaluator" if is_authorized else "Not in designated evaluators list"

    return {
        "skill_id": skill_id,
        "skill_name": skill.name,
        "is_authorized": is_authorized,
        "reason": reason,
    }


@router.post("/enrollments")
async def enroll_member_in_program(
    user_id: UUID = Query(..., description="Member to enroll"),
    program_id: UUID = Query(..., description="Training program to enroll into"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Enroll a member into any training pipeline/program.

    The training officer can enroll anyone into any program. This is used for:
    - Manually enrolling probationary members who weren't auto-enrolled
    - Enrolling administrative members converting to operational
    - Assigning specialty training programs (driver training, AIC, etc.)

    **Requires permission: training.manage**
    """
    from app.models.training import TrainingProgram, ProgramEnrollment, EnrollmentStatus

    # Verify user exists in org
    user_result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
    )
    member = user_result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Verify program exists
    program_result = await db.execute(
        select(TrainingProgram)
        .where(TrainingProgram.id == str(program_id))
        .where(TrainingProgram.organization_id == str(current_user.organization_id))
    )
    program = program_result.scalar_one_or_none()
    if not program:
        raise HTTPException(status_code=404, detail="Training program not found")

    # Check for existing active enrollment
    existing = await db.execute(
        select(ProgramEnrollment).where(
            ProgramEnrollment.user_id == str(user_id),
            ProgramEnrollment.program_id == str(program_id),
            ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"{member.full_name} is already enrolled in '{program.name}'"
        )

    enrollment = ProgramEnrollment(
        organization_id=str(current_user.organization_id),
        user_id=str(user_id),
        program_id=str(program_id),
        enrolled_by=str(current_user.id),
        status=EnrollmentStatus.ACTIVE,
    )
    db.add(enrollment)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="training_enrollment_created",
        event_category="training",
        severity="info",
        event_data={
            "enrollment_id": str(enrollment.id),
            "user_id": str(user_id),
            "member_name": member.full_name,
            "program_id": str(program_id),
            "program_name": program.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "enrollment_id": str(enrollment.id),
        "user_id": str(user_id),
        "member_name": member.full_name,
        "program_id": str(program_id),
        "program_name": program.name,
        "status": "active",
    }


# ============================================
# Compliance Matrix
# ============================================

from app.models.user import UserStatus
from pydantic import BaseModel


class RequirementStatusItem(BaseModel):
    requirement_id: str
    requirement_name: str
    status: str  # "completed", "in_progress", "expired", "not_started"
    completion_date: Optional[str] = None
    expiry_date: Optional[str] = None


class MemberComplianceRow(BaseModel):
    user_id: str
    member_name: str
    requirements: List[RequirementStatusItem]
    completion_pct: float


@router.get("/compliance-matrix")
async def get_compliance_matrix(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Training compliance matrix: for each active member, shows status
    of each training requirement (completed, expired, in_progress, not_started).
    """
    org_id = current_user.organization_id

    # Get all active members
    members_result = await db.execute(
        select(User)
        .where(
            User.organization_id == org_id,
            User.status == UserStatus.ACTIVE,
            User.deleted_at.is_(None),
        )
        .order_by(User.last_name, User.first_name)
    )
    members = members_result.scalars().all()

    # Get all requirements for this org
    reqs_result = await db.execute(
        select(TrainingRequirement)
        .where(TrainingRequirement.organization_id == org_id)
        .order_by(TrainingRequirement.name)
    )
    requirements = reqs_result.scalars().all()

    if not requirements:
        return {"members": [], "requirements": []}

    # Get all training records for these members
    records_result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id.in_([m.id for m in members]),
        )
    )
    all_records = records_result.scalars().all()

    # Build lookup: {user_id: {course_id: [records]}}
    records_by_user = {}
    for r in all_records:
        records_by_user.setdefault(r.user_id, []).append(r)

    today = date.today()
    matrix = []

    for member in members:
        member_records = records_by_user.get(member.id, [])
        req_statuses = []
        completed_count = 0

        for req in requirements:
            # Find matching records for this requirement
            matching = [
                r for r in member_records
                if r.course_id == req.course_id or (
                    r.course_name and req.name and
                    r.course_name.lower() == req.name.lower()
                )
            ]

            if matching:
                # Get most recent completed record
                completed_records = [
                    r for r in matching
                    if r.status == TrainingStatus.COMPLETED
                ]
                if completed_records:
                    latest = max(completed_records, key=lambda r: r.completion_date or date.min)
                    if latest.expiration_date and latest.expiration_date < today:
                        req_status = "expired"
                    else:
                        req_status = "completed"
                        completed_count += 1
                else:
                    in_progress = [r for r in matching if r.status == TrainingStatus.IN_PROGRESS]
                    req_status = "in_progress" if in_progress else "not_started"
            else:
                req_status = "not_started"

            latest_record = max(matching, key=lambda r: r.completion_date or date.min) if matching else None
            req_statuses.append(RequirementStatusItem(
                requirement_id=req.id,
                requirement_name=req.name,
                status=req_status,
                completion_date=latest_record.completion_date.isoformat() if latest_record and latest_record.completion_date else None,
                expiry_date=latest_record.expiration_date.isoformat() if latest_record and latest_record.expiration_date else None,
            ))

        pct = (completed_count / len(requirements) * 100) if requirements else 0
        member_name = f"{member.last_name}, {member.first_name}" if member.last_name else member.first_name or member.username
        matrix.append(MemberComplianceRow(
            user_id=member.id,
            member_name=member_name,
            requirements=req_statuses,
            completion_pct=round(pct, 1),
        ))

    return {
        "members": [m.model_dump() for m in matrix],
        "requirements": [
            {"id": r.id, "name": r.name}
            for r in requirements
        ],
        "generated_at": datetime.utcnow().isoformat(),
    }


# ============================================
# Expiring Certifications
# ============================================

@router.get("/expiring-certifications")
async def get_expiring_certifications(
    days: int = Query(90, ge=1, le=365, description="Number of days to look ahead"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Returns training records with certifications expiring within the specified window.
    Used by Training Coordinators and Driver Trainers to proactively manage renewals.
    """
    org_id = current_user.organization_id
    cutoff_date = date.today() + __import__("datetime").timedelta(days=days)

    result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.expiration_date.isnot(None),
            TrainingRecord.expiration_date <= cutoff_date,
            TrainingRecord.expiration_date >= date.today(),
        )
        .order_by(TrainingRecord.expiration_date.asc())
    )
    records = result.scalars().all()

    # Enrich with member names
    user_ids = list(set(r.user_id for r in records))
    users_result = await db.execute(
        select(User).where(User.id.in_(user_ids))
    )
    users_map = {u.id: u for u in users_result.scalars().all()}

    return {
        "expiring_certifications": [
            {
                "record_id": r.id,
                "user_id": r.user_id,
                "member_name": (
                    f"{users_map[r.user_id].last_name}, {users_map[r.user_id].first_name}"
                    if r.user_id in users_map and users_map[r.user_id].last_name
                    else users_map[r.user_id].username if r.user_id in users_map
                    else "Unknown"
                ),
                "course_name": r.course_name,
                "certification_number": r.certification_number,
                "expiration_date": r.expiration_date.isoformat() if r.expiration_date else None,
                "days_until_expiry": (r.expiration_date - date.today()).days if r.expiration_date else None,
            }
            for r in records
        ],
        "total": len(records),
        "lookup_days": days,
    }
