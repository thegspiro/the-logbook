"""
Training Program API Endpoints

Endpoints for managing training programs, enrollments, and member progress tracking.
"""

from typing import Optional, List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.user import User
from app.schemas.training_program import (
    # Requirements
    TrainingRequirementEnhancedCreate,
    TrainingRequirementEnhancedUpdate,
    TrainingRequirementEnhancedResponse,
    # Programs
    TrainingProgramCreate,
    TrainingProgramUpdate,
    TrainingProgramResponse,
    ProgramWithPhasesAndRequirements,
    # Phases
    ProgramPhaseCreate,
    ProgramPhaseUpdate,
    ProgramPhaseResponse,
    # Program Requirements
    ProgramRequirementCreate,
    ProgramRequirementResponse,
    # Milestones
    ProgramMilestoneCreate,
    ProgramMilestoneResponse,
    # Enrollments
    ProgramEnrollmentCreate,
    ProgramEnrollmentUpdate,
    ProgramEnrollmentResponse,
    MemberProgramProgress,
    # Progress
    RequirementProgressUpdate,
    RequirementProgressResponse,
    # Registry
    RegistryImportResult,
)
from app.services.training_program_service import TrainingProgramService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ==================== Training Requirement Endpoints ====================

@router.post("/requirements", response_model=TrainingRequirementEnhancedResponse, status_code=status.HTTP_201_CREATED)
async def create_training_requirement(
    requirement_data: TrainingRequirementEnhancedCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new training requirement

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    requirement, error = await service.create_training_requirement(
        requirement_data=requirement_data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return requirement


@router.get("/requirements", response_model=List[TrainingRequirementEnhancedResponse])
async def get_training_requirements(
    source: Optional[str] = Query(None, description="Filter by source (department, state, national)"),
    registry_name: Optional[str] = Query(None, description="Filter by registry name"),
    requirement_type: Optional[str] = Query(None, description="Filter by requirement type"),
    position: Optional[str] = Query(None, description="Filter by position"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get training requirements with optional filters

    **Authentication required**
    """
    service = TrainingProgramService(db)

    requirements = await service.get_requirements(
        organization_id=current_user.organization_id,
        source=source,
        registry_name=registry_name,
        requirement_type=requirement_type,
        position=position,
    )

    return requirements


@router.get("/requirements/{requirement_id}", response_model=TrainingRequirementEnhancedResponse)
async def get_training_requirement(
    requirement_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific training requirement by ID

    **Authentication required**
    """
    service = TrainingProgramService(db)

    from sqlalchemy import select
    from app.models.training import TrainingRequirement

    result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.id == requirement_id,
            TrainingRequirement.organization_id == current_user.organization_id
        )
    )
    requirement = result.scalar_one_or_none()

    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training requirement not found"
        )

    return requirement


@router.patch("/requirements/{requirement_id}", response_model=TrainingRequirementEnhancedResponse)
async def update_training_requirement(
    requirement_id: UUID,
    updates: TrainingRequirementEnhancedUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a training requirement

    Only editable requirements can be modified.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    requirement, error = await service.update_training_requirement(
        requirement_id=requirement_id,
        organization_id=current_user.organization_id,
        updates=updates.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_program_updated",
        event_category="training",
        severity="info",
        event_data={
            "requirement_id": str(requirement_id),
            "action": "requirement_updated",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return requirement


# ==================== Training Program Endpoints ====================

@router.post("/programs", response_model=TrainingProgramResponse, status_code=status.HTTP_201_CREATED)
async def create_training_program(
    program_data: TrainingProgramCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new training program

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    program, error = await service.create_training_program(
        program_data=program_data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_program_created",
        event_category="training",
        severity="info",
        event_data={
            "program_id": str(program.id),
            "program_name": program.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return program


@router.get("/programs", response_model=List[TrainingProgramResponse])
async def get_training_programs(
    target_position: Optional[str] = Query(None, description="Filter by target position"),
    is_template: Optional[bool] = Query(None, description="Filter by template status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all training programs with optional filters

    **Authentication required**
    """
    service = TrainingProgramService(db)

    programs = await service.get_programs(
        organization_id=current_user.organization_id,
        target_position=target_position,
        is_template=is_template,
    )

    return programs


@router.get("/programs/{program_id}", response_model=ProgramWithPhasesAndRequirements)
async def get_training_program(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get detailed training program information including phases and requirements

    **Authentication required**
    """
    service = TrainingProgramService(db)

    program = await service.get_program_by_id(
        program_id=program_id,
        organization_id=current_user.organization_id,
        include_phases=True,
        include_requirements=True,
    )

    if not program:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training program not found"
        )

    # Get phases
    phases = await service.get_program_phases(program_id, current_user.organization_id)

    # Get requirements
    program_requirements = await service.get_program_requirements(program_id, current_user.organization_id)
    requirements = [pr.requirement for pr in program_requirements]

    # Get milestones
    from sqlalchemy import select
    from app.models.training import ProgramMilestone

    milestones_result = await db.execute(
        select(ProgramMilestone).where(ProgramMilestone.program_id == program_id)
    )
    milestones = milestones_result.scalars().all()

    return ProgramWithPhasesAndRequirements(
        id=program.id,
        organization_id=program.organization_id,
        name=program.name,
        description=program.description,
        target_position=program.target_position,
        target_roles=program.target_roles,
        structure_type=program.structure_type.value,
        time_limit_days=program.time_limit_days,
        warning_days_before=program.warning_days_before,
        is_template=program.is_template,
        active=program.active,
        created_at=program.created_at,
        updated_at=program.updated_at,
        created_by=program.created_by,
        phases=phases,
        requirements=requirements,
        milestones=milestones,
        total_requirements=len(requirements),
        total_required=sum(1 for pr in program_requirements if pr.is_required),
    )


# ==================== Program Phase Endpoints ====================

@router.post("/programs/{program_id}/phases", response_model=ProgramPhaseResponse, status_code=status.HTTP_201_CREATED)
async def create_program_phase(
    program_id: UUID,
    phase_data: ProgramPhaseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new phase for a training program

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Ensure program_id in path matches program_id in body
    if phase_data.program_id != program_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Program ID in path must match program ID in request body"
        )

    service = TrainingProgramService(db)

    phase, error = await service.create_program_phase(
        phase_data=phase_data,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return phase


@router.get("/programs/{program_id}/phases", response_model=List[ProgramPhaseResponse])
async def get_program_phases(
    program_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all phases for a training program

    **Authentication required**
    """
    service = TrainingProgramService(db)

    phases = await service.get_program_phases(
        program_id=program_id,
        organization_id=current_user.organization_id,
    )

    return phases


# ==================== Program Requirement Endpoints ====================

@router.post("/programs/{program_id}/requirements", response_model=ProgramRequirementResponse, status_code=status.HTTP_201_CREATED)
async def add_requirement_to_program(
    program_id: UUID,
    requirement_link: ProgramRequirementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Add a requirement to a training program or phase

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Ensure program_id in path matches program_id in body
    if requirement_link.program_id != program_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Program ID in path must match program ID in request body"
        )

    service = TrainingProgramService(db)

    program_requirement, error = await service.add_requirement_to_program(
        program_requirement_data=requirement_link,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return program_requirement


@router.get("/programs/{program_id}/requirements", response_model=List[ProgramRequirementResponse])
async def get_program_requirements(
    program_id: UUID,
    phase_id: Optional[UUID] = Query(None, description="Filter by phase"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get requirements for a training program, optionally filtered by phase

    **Authentication required**
    """
    service = TrainingProgramService(db)

    requirements = await service.get_program_requirements(
        program_id=program_id,
        organization_id=current_user.organization_id,
        phase_id=phase_id,
    )

    return requirements


# ==================== Program Milestone Endpoints ====================

@router.post("/programs/{program_id}/milestones", response_model=ProgramMilestoneResponse, status_code=status.HTTP_201_CREATED)
async def create_program_milestone(
    program_id: UUID,
    milestone_data: ProgramMilestoneCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a milestone for a training program

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Ensure program_id in path matches program_id in body
    if milestone_data.program_id != program_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Program ID in path must match program ID in request body"
        )

    service = TrainingProgramService(db)

    milestone, error = await service.create_program_milestone(
        milestone_data=milestone_data,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return milestone


# ==================== Program Enrollment Endpoints ====================

@router.post("/enrollments", response_model=ProgramEnrollmentResponse, status_code=status.HTTP_201_CREATED)
async def enroll_member_in_program(
    enrollment_data: ProgramEnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Enroll a member in a training program

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    enrollment, error = await service.enroll_member(
        enrollment_data=enrollment_data,
        organization_id=current_user.organization_id,
        enrolled_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return enrollment


@router.get("/enrollments/me", response_model=List[ProgramEnrollmentResponse])
async def get_my_enrollments(
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get current user's program enrollments

    **Authentication required**
    """
    service = TrainingProgramService(db)

    enrollments = await service.get_member_enrollments(
        user_id=current_user.id,
        organization_id=current_user.organization_id,
        status=status,
    )

    return enrollments


@router.get("/enrollments/user/{user_id}", response_model=List[ProgramEnrollmentResponse])
async def get_user_enrollments(
    user_id: UUID,
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.view_all")),
):
    """
    Get enrollments for a specific user (requires permission)

    **Authentication required**
    **Requires permission: training.view_all**
    """
    service = TrainingProgramService(db)

    enrollments = await service.get_member_enrollments(
        user_id=user_id,
        organization_id=current_user.organization_id,
        status=status,
    )

    return enrollments


@router.get("/enrollments/{enrollment_id}", response_model=MemberProgramProgress)
async def get_enrollment_progress(
    enrollment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get detailed progress information for an enrollment

    **Authentication required**
    """
    service = TrainingProgramService(db)

    enrollment = await service.get_enrollment_by_id(
        enrollment_id=enrollment_id,
        organization_id=current_user.organization_id,
    )

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment not found"
        )

    # Check permission: user can view their own or needs training.view_all
    if enrollment.user_id != current_user.id:
        user_permissions = set()
        for role in current_user.roles:
            user_permissions.update(role.permissions or [])
        if "*" not in user_permissions and "training.view_all" not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this enrollment"
            )

    # Calculate time remaining
    time_remaining_days = None
    is_behind_schedule = False
    if enrollment.target_completion_date:
        from datetime import date
        days_remaining = (enrollment.target_completion_date - date.today()).days
        time_remaining_days = days_remaining

        # Simple heuristic: behind schedule if less than 50% time and less than 50% progress
        if enrollment.target_completion_date and time_remaining_days is not None:
            time_elapsed = (date.today() - enrollment.enrolled_at.date()).days
            total_time = (enrollment.target_completion_date - enrollment.enrolled_at.date()).days
            if total_time > 0:
                time_progress = (time_elapsed / total_time) * 100
                is_behind_schedule = time_progress > enrollment.progress_percentage + 20

    # Get next milestones
    from sqlalchemy import select
    from app.models.training import ProgramMilestone

    milestones_result = await db.execute(
        select(ProgramMilestone)
        .where(ProgramMilestone.program_id == enrollment.program_id)
        .where(ProgramMilestone.completion_percentage_threshold > enrollment.progress_percentage)
        .order_by(ProgramMilestone.completion_percentage_threshold)
        .limit(3)
    )
    next_milestones = milestones_result.scalars().all()

    # Count completed requirements
    completed_requirements = sum(
        1 for rp in enrollment.requirement_progress
        if rp.status == "completed"
    )

    return MemberProgramProgress(
        enrollment=enrollment,
        program=enrollment.program,
        current_phase=enrollment.current_phase,
        requirement_progress=enrollment.requirement_progress,
        completed_requirements=completed_requirements,
        total_requirements=len(enrollment.requirement_progress),
        next_milestones=next_milestones,
        time_remaining_days=time_remaining_days,
        is_behind_schedule=is_behind_schedule,
    )


# ==================== Requirement Progress Endpoints ====================

@router.patch("/progress/{progress_id}", response_model=RequirementProgressResponse)
async def update_requirement_progress(
    progress_id: UUID,
    updates: RequirementProgressUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update progress on a specific requirement

    Users can update their own progress, training officers can verify and adjust.

    **Authentication required**
    """
    service = TrainingProgramService(db)

    # Determine if this is a verification update
    verified_by = None
    # You could add permission check here for training.manage to allow verification
    # For now, we'll allow users to update their own progress

    progress, error = await service.update_requirement_progress(
        progress_id=progress_id,
        organization_id=current_user.organization_id,
        updates=updates,
        verified_by=verified_by,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    return progress


# ==================== Program Duplication Endpoints ====================

@router.post("/programs/{program_id}/duplicate", response_model=TrainingProgramResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_program(
    program_id: UUID,
    new_name: str = Query(..., description="Name for the duplicated program"),
    increment_version: bool = Query(True, description="Increment version number"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Duplicate a program (template or regular) with all phases, requirements, and milestones

    Creates an independent copy of the program with a new name and optional version increment.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    new_program, error = await service.duplicate_program(
        source_program_id=program_id,
        new_name=new_name,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        increment_version=increment_version,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    await log_audit_event(
        db=db,
        event_type="training_program_created",
        event_category="training",
        severity="info",
        event_data={
            "program_id": str(new_program.id),
            "program_name": new_program.name,
            "source_program_id": str(program_id),
            "action": "duplicated",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return new_program


# ==================== Bulk Enrollment Endpoints ====================

class BulkEnrollmentRequest(BaseModel):
    """Request schema for bulk enrollment"""
    user_ids: List[UUID] = Field(..., min_items=1, description="List of user IDs to enroll")
    target_completion_date: Optional[date] = None

class BulkEnrollmentResponse(BaseModel):
    """Response schema for bulk enrollment"""
    success_count: int
    enrolled_users: List[UUID]
    errors: List[str]

@router.post("/programs/{program_id}/bulk-enroll", response_model=BulkEnrollmentResponse)
async def bulk_enroll_members(
    program_id: UUID,
    enrollment_request: BulkEnrollmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Enroll multiple members in a program at once

    Validates prerequisites and concurrent enrollment restrictions before enrolling.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = TrainingProgramService(db)

    enrollments, errors = await service.bulk_enroll_members(
        program_id=program_id,
        user_ids=enrollment_request.user_ids,
        organization_id=current_user.organization_id,
        target_completion_date=enrollment_request.target_completion_date,
        enrolled_by=current_user.id,
    )

    return BulkEnrollmentResponse(
        success_count=len(enrollments),
        enrolled_users=[e.user_id for e in enrollments],
        errors=errors,
    )


# ==================== Registry Import Endpoints ====================

@router.post("/requirements/import/{registry_name}", response_model=RegistryImportResult)
async def import_registry_requirements(
    registry_name: str,
    skip_existing: bool = Query(True, description="Skip requirements that already exist"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Import requirements from a registry JSON file

    Available registries: nfpa, nremt, proboard, ifsac

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Map registry names to file paths
    registry_files = {
        "nfpa": "backend/app/data/registries/nfpa_requirements.json",
        "nremt": "backend/app/data/registries/nremt_requirements.json",
        "proboard": "backend/app/data/registries/proboard_requirements.json",
    }

    registry_file = registry_files.get(registry_name.lower())
    if not registry_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown registry: {registry_name}. Available: {', '.join(registry_files.keys())}"
        )

    service = TrainingProgramService(db)

    imported_count, errors = await service.import_registry_requirements(
        registry_file_path=registry_file,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        skip_existing=skip_existing,
    )

    return RegistryImportResult(
        registry_name=registry_name,
        imported_count=imported_count,
        skipped_count=0,  # Could be calculated if needed
        errors=errors,
    )
