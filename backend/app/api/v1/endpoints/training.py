"""
Training API Endpoints

Endpoints for training management including courses, records, requirements, and reports.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import date, datetime, timedelta
import calendar

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingCategory,
    TrainingStatus,
    RequirementType,
    RequirementFrequency,
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
    HistoricalImportConfirmRequest,
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
# Historical Training Import (CSV)
# ============================================

@router.post("/import/parse")
async def parse_historical_import(
    file: UploadFile = File(...),
    match_by: str = Query("badge_number", pattern=r'^(email|badge_number)$',
                          description="How to match CSV rows to members: badge_number or email"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Parse a CSV file of historical training records and return a preview.

    Matches members using the strategy specified by `match_by`:
    - **badge_number**: Match by badge/employee number (default, most reliable)
    - **email**: Match by email address (checks both primary and personal email)

    Also matches courses by name/code.
    Returns parsed rows with match status so the user can review
    and map unmatched courses before confirming the import.

    **Requires permission: training.manage**
    """
    import csv
    import io

    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    # Read and decode CSV
    try:
        contents = await file.read()
        decoded = contents.decode('utf-8-sig')  # Handle BOM
    except UnicodeDecodeError:
        try:
            decoded = contents.decode('latin-1')
        except Exception:
            raise HTTPException(status_code=400, detail="Unable to decode file. Please use UTF-8 encoding.")

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no headers")

    column_headers = list(reader.fieldnames)

    # Normalize header lookup: lowercase stripped
    header_map = {h.strip().lower().replace(' ', '_'): h for h in column_headers}

    # Determine which CSV columns map to which fields
    def find_col(candidates: list[str]) -> str | None:
        for c in candidates:
            if c in header_map:
                return header_map[c]
        return None

    col_email = find_col(['email', 'member_email', 'user_email', 'e-mail', 'e_mail'])
    col_badge = find_col(['badge_number', 'badge', 'badge_no', 'employee_id', 'employee_number', 'member_id', 'id_number'])
    col_name = find_col(['name', 'member_name', 'full_name', 'member', 'employee_name'])
    col_course = find_col(['course_name', 'course', 'training', 'training_name', 'class', 'class_name'])
    col_course_code = find_col(['course_code', 'code', 'class_code'])
    col_type = find_col(['training_type', 'type', 'category'])
    col_date = find_col(['completion_date', 'date_completed', 'date', 'completed', 'completed_date'])
    col_expiration = find_col(['expiration_date', 'expires', 'expiry', 'expiry_date', 'cert_expiration'])
    col_hours = find_col(['hours_completed', 'hours', 'duration', 'credit_hours', 'total_hours'])
    col_credit = find_col(['credit_hours', 'credits', 'ceu', 'ce_hours'])
    col_cert = find_col(['certification_number', 'cert_number', 'cert_no', 'certificate'])
    col_agency = find_col(['issuing_agency', 'agency', 'issuer', 'issued_by'])
    col_instructor = find_col(['instructor', 'trainer', 'taught_by'])
    col_location = find_col(['location', 'venue', 'training_location', 'site'])
    col_score = find_col(['score', 'grade', 'test_score'])
    col_passed = find_col(['passed', 'pass', 'pass_fail', 'result'])
    col_notes = find_col(['notes', 'comments', 'remarks', 'description'])

    # Validate required columns based on match strategy
    if match_by == "email" and not col_email:
        raise HTTPException(
            status_code=400,
            detail="CSV must contain an 'email' column for email matching. "
                   f"Found columns: {', '.join(column_headers)}"
        )
    if match_by == "badge_number" and not col_badge:
        raise HTTPException(
            status_code=400,
            detail="CSV must contain a 'badge_number' column for badge matching. "
                   f"Found columns: {', '.join(column_headers)}"
        )
    if not col_course:
        raise HTTPException(
            status_code=400,
            detail="CSV must contain a 'course_name' or 'course' column. "
                   f"Found columns: {', '.join(column_headers)}"
        )

    # Pre-load org members and build lookup maps
    members_result = await db.execute(
        select(User)
        .where(User.organization_id == current_user.organization_id)
        .where(User.status != "archived")
    )
    members = members_result.scalars().all()

    email_to_user = {}
    badge_to_user = {}

    for m in members:
        if m.email:
            email_to_user[m.email.strip().lower()] = m
        if hasattr(m, 'personal_email') and m.personal_email:
            email_to_user[m.personal_email.strip().lower()] = m
        if hasattr(m, 'badge_number') and m.badge_number:
            badge_to_user[m.badge_number.strip().lower()] = m

    # Pre-load existing courses
    courses_result = await db.execute(
        select(TrainingCourse)
        .where(TrainingCourse.organization_id == current_user.organization_id)
        .where(TrainingCourse.active == True)
    )
    courses = courses_result.scalars().all()
    course_name_map = {c.name.strip().lower(): c for c in courses}
    course_code_map = {c.code.strip().lower(): c for c in courses if c.code}

    # Parse rows
    rows = []
    parse_errors = []
    unmatched_course_counts = {}
    members_matched_set = set()
    members_unmatched_set = set()
    row_num = 0

    for raw_row in reader:
        row_num += 1
        row_errors = []

        # Extract match fields
        email_val = (raw_row.get(col_email) or '').strip().lower() if col_email else ''
        badge_val = (raw_row.get(col_badge) or '').strip().lower() if col_badge else ''

        # Extract name for display (optional column)
        name_val = (raw_row.get(col_name) or '').strip() if col_name else ''

        # Validate required match field
        match_key = ''
        if match_by == "email":
            match_key = email_val
            if not match_key:
                row_errors.append("Missing email")
        elif match_by == "badge_number":
            match_key = badge_val
            if not match_key:
                row_errors.append("Missing badge number")

        course_val = (raw_row.get(col_course) or '').strip()
        if not course_val:
            row_errors.append("Missing course name")

        # Match member by selected strategy
        user_id = None
        matched_name = None
        member_matched = False

        def try_match(lookup: dict, key: str) -> bool:
            nonlocal user_id, matched_name, member_matched
            if key and key in lookup:
                user = lookup[key]
                user_id = str(user.id)
                matched_name = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username
                member_matched = True
                return True
            return False

        if match_by == "email":
            try_match(email_to_user, email_val)
        elif match_by == "badge_number":
            try_match(badge_to_user, badge_val)

        if member_matched:
            members_matched_set.add(match_key)
        elif match_key:
            members_unmatched_set.add(match_key)

        # Match course
        course_matched = False
        matched_course_id = None
        course_code_val = (raw_row.get(col_course_code) or '').strip() if col_course_code else None
        course_lower = course_val.lower()

        if course_code_val and course_code_val.lower() in course_code_map:
            course_matched = True
            matched_course_id = str(course_code_map[course_code_val.lower()].id)
        elif course_lower in course_name_map:
            course_matched = True
            matched_course_id = str(course_name_map[course_lower].id)

        if not course_matched and course_val:
            key = course_val.lower()
            if key not in unmatched_course_counts:
                unmatched_course_counts[key] = {"name": course_val, "code": course_code_val, "count": 0}
            unmatched_course_counts[key]["count"] += 1

        # Parse date fields
        def parse_date(val: str | None) -> date | None:
            if not val:
                return None
            val = val.strip()
            for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y', '%d/%m/%Y', '%m/%d/%y', '%Y/%m/%d'):
                try:
                    return datetime.strptime(val, fmt).date()
                except ValueError:
                    continue
            row_errors.append(f"Invalid date format: {val}")
            return None

        completion = parse_date(raw_row.get(col_date) if col_date else None)
        expiration = parse_date(raw_row.get(col_expiration) if col_expiration else None)

        # Parse numeric fields
        def parse_float(val: str | None) -> float | None:
            if not val or not val.strip():
                return None
            try:
                return float(val.strip())
            except ValueError:
                row_errors.append(f"Invalid number: {val}")
                return None

        hours = parse_float(raw_row.get(col_hours) if col_hours else None)
        credit = parse_float(raw_row.get(col_credit) if col_credit else None)
        score = parse_float(raw_row.get(col_score) if col_score else None)

        # Parse passed
        passed_val = None
        if col_passed:
            pv = (raw_row.get(col_passed) or '').strip().lower()
            if pv in ('true', 'yes', 'pass', 'passed', 'y', '1'):
                passed_val = True
            elif pv in ('false', 'no', 'fail', 'failed', 'n', '0'):
                passed_val = False

        from app.schemas.training import HistoricalImportParsedRow
        rows.append(HistoricalImportParsedRow(
            row_number=row_num,
            email=email_val or None,
            badge_number=badge_val or None,
            member_name=name_val or None,
            user_id=user_id,
            matched_member_name=matched_name,
            member_matched=member_matched,
            course_name=course_val,
            course_code=course_code_val,
            course_matched=course_matched,
            matched_course_id=matched_course_id,
            training_type=(raw_row.get(col_type) or '').strip() if col_type else None,
            completion_date=completion,
            expiration_date=expiration,
            hours_completed=hours,
            credit_hours=credit,
            certification_number=(raw_row.get(col_cert) or '').strip() if col_cert else None,
            issuing_agency=(raw_row.get(col_agency) or '').strip() if col_agency else None,
            instructor=(raw_row.get(col_instructor) or '').strip() if col_instructor else None,
            location=(raw_row.get(col_location) or '').strip() if col_location else None,
            score=score,
            passed=passed_val,
            notes=(raw_row.get(col_notes) or '').strip() if col_notes else None,
            errors=row_errors,
        ))

        if row_errors:
            for e in row_errors:
                parse_errors.append(f"Row {row_num}: {e}")

    from app.schemas.training import UnmatchedCourse, HistoricalImportParseResponse
    unmatched_courses = [
        UnmatchedCourse(
            csv_course_name=v["name"],
            csv_course_code=v["code"],
            occurrences=v["count"],
        )
        for v in sorted(unmatched_course_counts.values(), key=lambda x: -x["count"])
    ]

    return HistoricalImportParseResponse(
        total_rows=row_num,
        valid_rows=sum(1 for r in rows if not r.errors and r.member_matched),
        members_matched=len(members_matched_set),
        members_unmatched=len(members_unmatched_set),
        courses_matched=sum(1 for r in rows if r.course_matched),
        unmatched_courses=unmatched_courses,
        column_headers=column_headers,
        rows=rows,
        parse_errors=parse_errors[:50],
    )


@router.post("/import/confirm")
async def confirm_historical_import(
    request: HistoricalImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Confirm and execute a historical training import.

    Takes the parsed rows (possibly with updated course mappings) and creates
    TrainingRecord entries for each valid, matched row.

    **Requires permission: training.manage**
    """
    from app.schemas.training import HistoricalImportResult

    # Build course mapping lookup: csv_course_name_lower -> (action, course_id, training_type)
    course_map = {}
    for mapping in request.course_mappings:
        course_map[mapping.csv_course_name.lower()] = mapping

    # Auto-create courses where action == create_new
    created_courses = {}
    for mapping in request.course_mappings:
        if mapping.action == "create_new":
            t_type = mapping.new_training_type or request.default_training_type
            new_course = TrainingCourse(
                organization_id=current_user.organization_id,
                name=mapping.csv_course_name,
                training_type=t_type,
                duration_hours=0,
                active=True,
                created_by=current_user.id,
            )
            db.add(new_course)
            await db.flush()
            created_courses[mapping.csv_course_name.lower()] = str(new_course.id)

    imported = 0
    skipped = 0
    failed = 0
    errors = []

    for row in request.rows:
        # Skip rows without matched member
        if not row.user_id:
            skipped += 1
            continue

        # Determine course_id and course_name
        course_id = row.matched_course_id
        course_name = row.course_name
        training_type = row.training_type or request.default_training_type

        if not row.course_matched:
            mapping = course_map.get(row.course_name.lower())
            if mapping:
                if mapping.action == "skip":
                    skipped += 1
                    continue
                elif mapping.action == "map_existing":
                    course_id = mapping.existing_course_id
                elif mapping.action == "create_new":
                    course_id = created_courses.get(row.course_name.lower())
                    if mapping.new_training_type:
                        training_type = mapping.new_training_type
            # If no mapping provided, still import with course_name only (no course_id)

        # Validate training type
        valid_types = {'certification', 'continuing_education', 'skills_practice',
                       'orientation', 'refresher', 'specialty'}
        if training_type not in valid_types:
            training_type = request.default_training_type

        try:
            record = TrainingRecord(
                organization_id=current_user.organization_id,
                user_id=row.user_id,
                course_id=course_id,
                course_name=course_name,
                course_code=row.course_code,
                training_type=training_type,
                completion_date=row.completion_date,
                expiration_date=row.expiration_date,
                hours_completed=row.hours_completed or 0,
                credit_hours=row.credit_hours,
                certification_number=row.certification_number,
                issuing_agency=row.issuing_agency,
                status=request.default_status,
                score=row.score,
                passed=row.passed,
                instructor=row.instructor,
                location=row.location,
                notes=row.notes or "Imported from historical CSV",
                created_by=current_user.id,
            )
            db.add(record)
            await db.flush()
            imported += 1
        except Exception as e:
            failed += 1
            errors.append(f"Row {row.row_number}: {str(e)[:100]}")

    await db.commit()

    await log_audit_event(
        db=db,
        event_type="historical_training_imported",
        event_category="training",
        severity="info",
        event_data={
            "total": len(request.rows),
            "imported": imported,
            "skipped": skipped,
            "failed": failed,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return HistoricalImportResult(
        total=len(request.rows),
        imported=imported,
        skipped=skipped,
        failed=failed,
        errors=errors[:20],
    )


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


def _get_requirement_date_window(req, today: date):
    """Return (start_date, end_date) for evaluating a requirement's compliance window."""
    freq = req.frequency.value if hasattr(req.frequency, 'value') else str(req.frequency)
    current_year = today.year

    if freq == "one_time":
        return None, None
    elif freq == "biannual":
        base_year = req.year if req.year else current_year
        return date(base_year - 1, 1, 1), date(base_year, 12, 31)
    elif freq == "quarterly":
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        start_date = date(current_year, quarter_month, 1)
        end_month = quarter_month + 2
        end_year = current_year
        if end_month > 12:
            end_month -= 12
            end_year += 1
        end_day = calendar.monthrange(end_year, end_month)[1]
        return start_date, date(end_year, end_month, end_day)
    elif freq == "monthly":
        start_date = date(current_year, today.month, 1)
        end_day = calendar.monthrange(current_year, today.month)[1]
        return start_date, date(current_year, today.month, end_day)
    else:
        # Annual (default)
        yr = req.year if req.year else current_year
        return date(yr, 1, 1), date(yr, 12, 31)


def _evaluate_member_requirement(req, member_records, today: date):
    """
    Evaluate a single member's status for a single requirement.

    Returns (status, latest_completion_date, latest_expiry_date).

    Matching strategy depends on requirement_type:
    - HOURS:          Sum hours of completed records matching training_type within date window
    - COURSES:        Check if required course IDs are all completed
    - CERTIFICATION:  Check for matching certification records (by name or training_type)
    - SHIFTS/CALLS:   Count matching records within date window
    - Others:         Match by training_type or name
    """
    req_type = req.requirement_type.value if hasattr(req.requirement_type, 'value') else str(req.requirement_type)
    start_date, end_date = _get_requirement_date_window(req, today)

    # Filter completed records within the date window
    completed = [r for r in member_records if r.status == TrainingStatus.COMPLETED]
    if start_date and end_date:
        windowed = [
            r for r in completed
            if r.completion_date and start_date <= r.completion_date <= end_date
        ]
    else:
        windowed = completed

    # ---- HOURS requirements: sum hours by training_type ----
    if req_type == "hours":
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        # Also include records whose categories match this requirement's category_ids
        if req.category_ids and not req.training_type:
            type_matched = windowed  # All completed records count if no specific type

        total_hours = sum(r.hours_completed or 0 for r in type_matched)
        required = req.required_hours or 0

        latest = max(type_matched, key=lambda r: r.completion_date or date.min) if type_matched else None
        latest_comp = latest.completion_date.isoformat() if latest and latest.completion_date else None
        latest_exp = latest.expiration_date.isoformat() if latest and latest.expiration_date else None

        if required > 0 and total_hours >= required:
            return "completed", latest_comp, latest_exp
        elif total_hours > 0:
            return "in_progress", latest_comp, latest_exp
        else:
            return "not_started", None, None

    # ---- COURSES requirements: check required course IDs ----
    if req_type == "courses":
        course_ids = req.required_courses or []
        if not course_ids:
            return "not_started", None, None

        completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
        matched_count = sum(1 for cid in course_ids if cid in completed_course_ids)

        latest = max(windowed, key=lambda r: r.completion_date or date.min) if windowed else None
        latest_comp = latest.completion_date.isoformat() if latest and latest.completion_date else None
        latest_exp = latest.expiration_date.isoformat() if latest and latest.expiration_date else None

        if matched_count >= len(course_ids):
            return "completed", latest_comp, latest_exp
        elif matched_count > 0:
            return "in_progress", latest_comp, latest_exp
        else:
            return "not_started", None, None

    # ---- CERTIFICATION requirements: match by name, training_type, or cert number ----
    if req_type == "certification":
        matching = [
            r for r in completed
            if (
                (req.training_type and r.training_type == req.training_type)
                or (r.course_name and req.name and req.name.lower() in r.course_name.lower())
                or (r.certification_number and req.registry_code
                    and req.registry_code.lower() in r.certification_number.lower())
            )
        ]
        if matching:
            latest = max(matching, key=lambda r: r.completion_date or date.min)
            latest_comp = latest.completion_date.isoformat() if latest.completion_date else None
            latest_exp = latest.expiration_date.isoformat() if latest.expiration_date else None
            if latest.expiration_date and latest.expiration_date < today:
                return "expired", latest_comp, latest_exp
            return "completed", latest_comp, latest_exp
        return "not_started", None, None

    # ---- SHIFTS requirements ----
    if req_type == "shifts":
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        count = len(type_matched)
        required = req.required_shifts or 0

        latest = max(type_matched, key=lambda r: r.completion_date or date.min) if type_matched else None
        latest_comp = latest.completion_date.isoformat() if latest and latest.completion_date else None
        latest_exp = None

        if required > 0 and count >= required:
            return "completed", latest_comp, latest_exp
        elif count > 0:
            return "in_progress", latest_comp, latest_exp
        return "not_started", None, None

    # ---- CALLS requirements ----
    if req_type == "calls":
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        count = len(type_matched)
        required = req.required_calls or 0

        latest = max(type_matched, key=lambda r: r.completion_date or date.min) if type_matched else None
        latest_comp = latest.completion_date.isoformat() if latest and latest.completion_date else None
        latest_exp = None

        if required > 0 and count >= required:
            return "completed", latest_comp, latest_exp
        elif count > 0:
            return "in_progress", latest_comp, latest_exp
        return "not_started", None, None

    # ---- Fallback (skills_evaluation, checklist, knowledge_test, etc.) ----
    matching = []
    if req.training_type:
        matching = [r for r in windowed if r.training_type == req.training_type]
    if not matching and req.name:
        matching = [
            r for r in windowed
            if r.course_name and req.name.lower() in r.course_name.lower()
        ]

    if matching:
        latest = max(matching, key=lambda r: r.completion_date or date.min)
        latest_comp = latest.completion_date.isoformat() if latest.completion_date else None
        latest_exp = latest.expiration_date.isoformat() if latest.expiration_date else None
        if latest.expiration_date and latest.expiration_date < today:
            return "expired", latest_comp, latest_exp
        return "completed", latest_comp, latest_exp
    else:
        # Check for in-progress records
        in_progress = [r for r in member_records if r.status == TrainingStatus.IN_PROGRESS]
        ip_matching = []
        if req.training_type:
            ip_matching = [r for r in in_progress if r.training_type == req.training_type]
        if not ip_matching and req.name:
            ip_matching = [r for r in in_progress if r.course_name and req.name.lower() in r.course_name.lower()]
        if ip_matching:
            return "in_progress", None, None
    return "not_started", None, None


@router.get("/compliance-matrix")
async def get_compliance_matrix(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Training compliance matrix: for each active member, shows status
    of each active training requirement (completed, expired, in_progress, not_started).
    Uses requirement-type-aware matching (hours, courses, certifications, etc.)
    with frequency-based date windows.
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

    # Get active requirements only
    reqs_result = await db.execute(
        select(TrainingRequirement)
        .where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active == True,  # noqa: E712
        )
        .order_by(TrainingRequirement.name)
    )
    requirements = reqs_result.scalars().all()

    if not requirements:
        return {"members": [], "requirements": [], "generated_at": datetime.utcnow().isoformat()}

    # Get all training records for these members
    records_result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id.in_([m.id for m in members]),
        )
    )
    all_records = records_result.scalars().all()

    # Build lookup: user_id -> [records]
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
            req_status, comp_date, exp_date = _evaluate_member_requirement(
                req, member_records, today
            )

            if req_status == "completed":
                completed_count += 1

            req_statuses.append(RequirementStatusItem(
                requirement_id=req.id,
                requirement_name=req.name,
                status=req_status,
                completion_date=comp_date,
                expiry_date=exp_date,
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
async def get_expiring_certifications_detailed(
    days: int = Query(90, ge=1, le=365, description="Number of days to look ahead"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Returns training records with certifications expiring within the specified window.
    Used by Training Coordinators and Driver Trainers to proactively manage renewals.
    """
    org_id = current_user.organization_id
    today = date.today()
    cutoff_date = today + timedelta(days=days)

    # Also include already-expired certifications so the tab shows them
    result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.expiration_date.isnot(None),
            TrainingRecord.expiration_date <= cutoff_date,
        )
        .order_by(TrainingRecord.expiration_date.asc())
    )
    records = result.scalars().all()

    # Enrich with member names
    user_ids = list(set(r.user_id for r in records))
    users_map: dict = {}
    if user_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(user_ids))
        )
        users_map = {u.id: u for u in users_result.scalars().all()}

    # Return flat array matching frontend ExpiringCertification interface
    return [
        {
            "user_id": r.user_id,
            "member_name": (
                f"{users_map[r.user_id].last_name}, {users_map[r.user_id].first_name}"
                if r.user_id in users_map and users_map[r.user_id].last_name
                else users_map[r.user_id].username if r.user_id in users_map
                else "Unknown"
            ),
            "requirement_id": r.course_id or r.id,
            "requirement_name": r.course_name or "Certification",
            "expiry_date": r.expiration_date.isoformat() if r.expiration_date else None,
            "days_until_expiry": (r.expiration_date - today).days if r.expiration_date else 0,
            "status": (
                "expired" if r.expiration_date and r.expiration_date < today
                else "expiring_soon" if r.expiration_date and r.expiration_date <= cutoff_date
                else "current"
            ),
        }
        for r in records
    ]
