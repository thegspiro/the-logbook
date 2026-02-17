"""
Training Program Service

Business logic for training program management, enrollment, and progress tracking.
"""

import json
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from uuid import UUID
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, update
from sqlalchemy.orm import selectinload

from app.models.training import (
    TrainingRequirement, TrainingProgram, ProgramPhase, ProgramRequirement,
    ProgramMilestone, ProgramEnrollment, RequirementProgress, SkillEvaluation,
    SkillCheckoff, RequirementType, RequirementSource, ProgramStructureType,
    EnrollmentStatus, RequirementProgressStatus
)
from app.models.user import User
from app.schemas.training_program import (
    TrainingRequirementEnhancedCreate, TrainingProgramCreate, ProgramPhaseCreate,
    ProgramRequirementCreate, ProgramMilestoneCreate, ProgramEnrollmentCreate,
    RequirementProgressUpdate, SkillEvaluationCreate, SkillCheckoffCreate
)


class TrainingProgramService:
    """Service for training program management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== Training Requirement Methods ====================

    async def create_training_requirement(
        self,
        requirement_data: TrainingRequirementEnhancedCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingRequirement], Optional[str]]:
        """
        Create a new training requirement

        Returns: (requirement, error_message)
        """
        # Validate requirement type
        try:
            req_type = RequirementType(requirement_data.requirement_type)
        except ValueError:
            return None, f"Invalid requirement type: {requirement_data.requirement_type}"

        # Validate source
        try:
            source = RequirementSource(requirement_data.source)
        except ValueError:
            return None, f"Invalid source: {requirement_data.source}"

        # Create requirement
        requirement = TrainingRequirement(
            organization_id=organization_id,
            name=requirement_data.name,
            description=requirement_data.description,
            requirement_type=req_type,
            source=source,
            registry_name=requirement_data.registry_name,
            registry_code=requirement_data.registry_code,
            is_editable=requirement_data.is_editable,
            training_type=requirement_data.training_type,
            required_hours=requirement_data.required_hours,
            required_courses=requirement_data.required_courses,
            required_shifts=requirement_data.required_shifts,
            required_calls=requirement_data.required_calls,
            required_call_types=requirement_data.required_call_types,
            required_skills=requirement_data.required_skills,
            checklist_items=requirement_data.checklist_items,
            passing_score=getattr(requirement_data, 'passing_score', None),
            max_attempts=getattr(requirement_data, 'max_attempts', None),
            frequency=requirement_data.frequency,
            time_limit_days=requirement_data.time_limit_days,
            applies_to_all=requirement_data.applies_to_all,
            required_positions=requirement_data.required_positions,
            required_roles=requirement_data.required_roles,
            created_by=created_by,
        )

        self.db.add(requirement)
        await self.db.commit()
        await self.db.refresh(requirement)

        return requirement, None

    async def get_requirements(
        self,
        organization_id: UUID,
        source: Optional[str] = None,
        registry_name: Optional[str] = None,
        requirement_type: Optional[str] = None,
        position: Optional[str] = None,
    ) -> List[TrainingRequirement]:
        """
        Get training requirements with optional filters
        """
        query = select(TrainingRequirement).where(
            TrainingRequirement.organization_id == organization_id,
            TrainingRequirement.active == True
        )

        if source:
            query = query.where(TrainingRequirement.source == source)
        if registry_name:
            query = query.where(TrainingRequirement.registry_name == registry_name)
        if requirement_type:
            query = query.where(TrainingRequirement.requirement_type == requirement_type)
        if position:
            # Check if position is in the required_positions JSONB array
            query = query.where(TrainingRequirement.required_positions.contains([position]))

        result = await self.db.execute(query.order_by(TrainingRequirement.name))
        return result.scalars().all()

    async def update_training_requirement(
        self,
        requirement_id: UUID,
        organization_id: UUID,
        updates: Dict[str, Any],
    ) -> Tuple[Optional[TrainingRequirement], Optional[str]]:
        """
        Update a training requirement
        Only editable requirements can be modified

        Returns: (requirement, error_message)
        """
        result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.id == str(requirement_id))
            .where(TrainingRequirement.organization_id == str(organization_id))
        )
        requirement = result.scalar_one_or_none()

        if not requirement:
            return None, "Training requirement not found"

        if not requirement.is_editable:
            return None, "This requirement cannot be edited"

        # Update fields
        for field, value in updates.items():
            if hasattr(requirement, field) and value is not None:
                setattr(requirement, field, value)

        requirement.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(requirement)

        return requirement, None

    # ==================== Training Program Methods ====================

    async def create_training_program(
        self,
        program_data: TrainingProgramCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingProgram], Optional[str]]:
        """
        Create a new training program

        Returns: (program, error_message)
        """
        # Validate structure type
        try:
            structure_type = ProgramStructureType(program_data.structure_type)
        except ValueError:
            return None, f"Invalid structure type: {program_data.structure_type}"

        # Create program
        program = TrainingProgram(
            organization_id=organization_id,
            name=program_data.name,
            description=program_data.description,
            target_position=program_data.target_position,
            target_roles=program_data.target_roles,
            structure_type=structure_type,
            time_limit_days=program_data.time_limit_days,
            warning_days_before=program_data.warning_days_before,
            is_template=program_data.is_template,
            created_by=created_by,
        )

        self.db.add(program)
        await self.db.commit()
        await self.db.refresh(program)

        return program, None

    async def get_program_by_id(
        self,
        program_id: UUID,
        organization_id: UUID,
        include_phases: bool = False,
        include_requirements: bool = False,
    ) -> Optional[TrainingProgram]:
        """
        Get a training program by ID with optional eager loading
        """
        query = select(TrainingProgram).where(
            TrainingProgram.id == str(program_id),
            TrainingProgram.organization_id == str(organization_id)
        )

        if include_phases:
            query = query.options(selectinload(TrainingProgram.phases))
        if include_requirements:
            query = query.options(
                selectinload(TrainingProgram.program_requirements)
                .selectinload(ProgramRequirement.requirement)
            )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_programs(
        self,
        organization_id: UUID,
        target_position: Optional[str] = None,
        is_template: Optional[bool] = None,
    ) -> List[TrainingProgram]:
        """
        Get training programs with optional filters
        """
        query = select(TrainingProgram).where(
            TrainingProgram.organization_id == organization_id,
            TrainingProgram.active == True
        )

        if target_position:
            query = query.where(TrainingProgram.target_position == target_position)
        if is_template is not None:
            query = query.where(TrainingProgram.is_template == is_template)

        result = await self.db.execute(query.order_by(TrainingProgram.name))
        return result.scalars().all()

    # ==================== Program Phase Methods ====================

    async def create_program_phase(
        self,
        phase_data: ProgramPhaseCreate,
        organization_id: UUID,
    ) -> Tuple[Optional[ProgramPhase], Optional[str]]:
        """
        Create a new program phase

        Returns: (phase, error_message)
        """
        # Verify program exists
        program = await self.get_program_by_id(phase_data.program_id, organization_id)
        if not program:
            return None, "Training program not found"

        # Check for duplicate phase numbers
        existing_phase = await self.db.execute(
            select(ProgramPhase).where(
                ProgramPhase.program_id == str(phase_data.program_id),
                ProgramPhase.phase_number == phase_data.phase_number
            )
        )
        if existing_phase.scalar_one_or_none():
            return None, f"Phase {phase_data.phase_number} already exists for this program"

        # Create phase
        phase = ProgramPhase(
            program_id=phase_data.program_id,
            phase_number=phase_data.phase_number,
            name=phase_data.name,
            description=phase_data.description,
            prerequisite_phase_ids=phase_data.prerequisite_phase_ids,
            time_limit_days=phase_data.time_limit_days,
        )

        self.db.add(phase)
        await self.db.commit()
        await self.db.refresh(phase)

        return phase, None

    async def get_program_phases(
        self,
        program_id: UUID,
        organization_id: UUID,
    ) -> List[ProgramPhase]:
        """
        Get all phases for a program, ordered by phase_number
        """
        # Verify program exists and belongs to organization
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return []

        result = await self.db.execute(
            select(ProgramPhase)
            .where(ProgramPhase.program_id == str(program_id))
            .order_by(ProgramPhase.phase_number)
        )
        return result.scalars().all()

    # ==================== Program Requirement Methods ====================

    async def add_requirement_to_program(
        self,
        program_requirement_data: ProgramRequirementCreate,
        organization_id: UUID,
    ) -> Tuple[Optional[ProgramRequirement], Optional[str]]:
        """
        Link a requirement to a program or phase

        Returns: (program_requirement, error_message)
        """
        # Verify program exists
        program = await self.get_program_by_id(program_requirement_data.program_id, organization_id)
        if not program:
            return None, "Training program not found"

        # Verify requirement exists
        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.id == program_requirement_data.requirement_id)
            .where(TrainingRequirement.organization_id == str(organization_id))
        )
        requirement = req_result.scalar_one_or_none()
        if not requirement:
            return None, "Training requirement not found"

        # Verify phase exists if specified
        if program_requirement_data.phase_id:
            phase_result = await self.db.execute(
                select(ProgramPhase)
                .where(ProgramPhase.id == str(program_requirement_data.phase_id))
                .where(ProgramPhase.program_id == str(program_requirement_data.program_id))
            )
            if not phase_result.scalar_one_or_none():
                return None, "Program phase not found"

        # Check for duplicate
        existing = await self.db.execute(
            select(ProgramRequirement).where(
                ProgramRequirement.program_id == str(program_requirement_data.program_id),
                ProgramRequirement.requirement_id == str(program_requirement_data.requirement_id),
                ProgramRequirement.phase_id == (str(program_requirement_data.phase_id) if program_requirement_data.phase_id else None)
            )
        )
        if existing.scalar_one_or_none():
            return None, "This requirement is already linked to the program/phase"

        # Create program requirement link
        program_requirement = ProgramRequirement(
            program_id=program_requirement_data.program_id,
            phase_id=program_requirement_data.phase_id,
            requirement_id=program_requirement_data.requirement_id,
            is_required=program_requirement_data.is_required,
            is_prerequisite=program_requirement_data.is_prerequisite,
            sort_order=program_requirement_data.sort_order,
        )

        self.db.add(program_requirement)
        await self.db.commit()
        await self.db.refresh(program_requirement)

        return program_requirement, None

    async def get_program_requirements(
        self,
        program_id: UUID,
        organization_id: UUID,
        phase_id: Optional[UUID] = None,
    ) -> List[ProgramRequirement]:
        """
        Get requirements for a program, optionally filtered by phase
        """
        # Verify program exists
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return []

        query = select(ProgramRequirement).options(
            selectinload(ProgramRequirement.requirement)
        ).where(ProgramRequirement.program_id == str(program_id))

        if phase_id:
            query = query.where(ProgramRequirement.phase_id == str(phase_id))

        query = query.order_by(ProgramRequirement.sort_order)

        result = await self.db.execute(query)
        return result.scalars().all()

    # ==================== Program Milestone Methods ====================

    async def create_program_milestone(
        self,
        milestone_data: ProgramMilestoneCreate,
        organization_id: UUID,
    ) -> Tuple[Optional[ProgramMilestone], Optional[str]]:
        """
        Create a program milestone

        Returns: (milestone, error_message)
        """
        # Verify program exists
        program = await self.get_program_by_id(milestone_data.program_id, organization_id)
        if not program:
            return None, "Training program not found"

        # Verify phase exists if specified
        if milestone_data.phase_id:
            phase_result = await self.db.execute(
                select(ProgramPhase)
                .where(ProgramPhase.id == str(milestone_data.phase_id))
                .where(ProgramPhase.program_id == str(milestone_data.program_id))
            )
            if not phase_result.scalar_one_or_none():
                return None, "Program phase not found"

        # Create milestone
        milestone = ProgramMilestone(
            program_id=milestone_data.program_id,
            phase_id=milestone_data.phase_id,
            name=milestone_data.name,
            description=milestone_data.description,
            completion_percentage_threshold=milestone_data.completion_percentage_threshold,
            notification_message=milestone_data.notification_message,
        )

        self.db.add(milestone)
        await self.db.commit()
        await self.db.refresh(milestone)

        return milestone, None

    # ==================== Program Enrollment Methods ====================

    async def enroll_member(
        self,
        enrollment_data: ProgramEnrollmentCreate,
        organization_id: UUID,
        enrolled_by: Optional[UUID] = None,
    ) -> Tuple[Optional[ProgramEnrollment], Optional[str]]:
        """
        Enroll a member in a training program

        Returns: (enrollment, error_message)
        """
        # Verify program exists
        program = await self.get_program_by_id(enrollment_data.program_id, organization_id, include_phases=True)
        if not program:
            return None, "Training program not found"

        # Verify user exists
        user_result = await self.db.execute(
            select(User).where(User.id == enrollment_data.user_id)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return None, "User not found"

        # Check for existing active enrollment
        existing = await self.db.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == str(enrollment_data.user_id),
                ProgramEnrollment.program_id == str(enrollment_data.program_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE
            )
        )
        if existing.scalar_one_or_none():
            return None, "User is already enrolled in this program"

        # Calculate target completion date if not provided
        target_completion_date = enrollment_data.target_completion_date
        if not target_completion_date and program.time_limit_days:
            target_completion_date = date.today() + timedelta(days=program.time_limit_days)

        # Determine initial phase for phase-based programs
        current_phase_id = None
        if program.structure_type == ProgramStructureType.PHASES and program.phases:
            # Start with phase 1
            first_phase = min(program.phases, key=lambda p: p.phase_number)
            current_phase_id = first_phase.id

        # Create enrollment
        enrollment = ProgramEnrollment(
            user_id=enrollment_data.user_id,
            program_id=enrollment_data.program_id,
            enrolled_at=datetime.utcnow(),
            target_completion_date=target_completion_date,
            current_phase_id=current_phase_id,
            progress_percentage=0.0,
            status=EnrollmentStatus.ACTIVE,
            notes=enrollment_data.notes,
        )

        self.db.add(enrollment)
        await self.db.flush()

        # Create requirement progress tracking for all program requirements
        program_requirements = await self.get_program_requirements(program.id, organization_id)
        for prog_req in program_requirements:
            req_progress = RequirementProgress(
                enrollment_id=enrollment.id,
                requirement_id=prog_req.requirement_id,
                status=RequirementProgressStatus.NOT_STARTED,
                progress_value=0.0,
                progress_percentage=0.0,
            )
            self.db.add(req_progress)

        await self.db.commit()
        await self.db.refresh(enrollment)

        return enrollment, None

    async def get_member_enrollments(
        self,
        user_id: UUID,
        organization_id: UUID,
        status: Optional[str] = None,
    ) -> List[ProgramEnrollment]:
        """
        Get all program enrollments for a member
        """
        query = select(ProgramEnrollment).options(
            selectinload(ProgramEnrollment.program),
            selectinload(ProgramEnrollment.current_phase)
        ).join(TrainingProgram).where(
            ProgramEnrollment.user_id == user_id,
            TrainingProgram.organization_id == organization_id
        )

        if status:
            query = query.where(ProgramEnrollment.status == status)

        result = await self.db.execute(query.order_by(ProgramEnrollment.enrolled_at.desc()))
        return result.scalars().all()

    async def get_enrollment_by_id(
        self,
        enrollment_id: UUID,
        organization_id: UUID,
    ) -> Optional[ProgramEnrollment]:
        """
        Get enrollment by ID with eager loading
        """
        result = await self.db.execute(
            select(ProgramEnrollment)
            .options(
                selectinload(ProgramEnrollment.program),
                selectinload(ProgramEnrollment.current_phase),
                selectinload(ProgramEnrollment.requirement_progress)
                .selectinload(RequirementProgress.requirement)
            )
            .join(TrainingProgram)
            .where(
                ProgramEnrollment.id == enrollment_id,
                TrainingProgram.organization_id == organization_id
            )
        )
        return result.scalar_one_or_none()

    # ==================== Progress Tracking Methods ====================

    async def update_requirement_progress(
        self,
        progress_id: UUID,
        organization_id: UUID,
        updates: RequirementProgressUpdate,
        verified_by: Optional[UUID] = None,
    ) -> Tuple[Optional[RequirementProgress], Optional[str]]:
        """
        Update progress on a specific requirement

        Returns: (progress, error_message)
        """
        # Get progress with enrollment and program
        result = await self.db.execute(
            select(RequirementProgress)
            .options(
                selectinload(RequirementProgress.enrollment).selectinload(ProgramEnrollment.program),
                selectinload(RequirementProgress.requirement)
            )
            .join(ProgramEnrollment)
            .join(TrainingProgram)
            .where(
                RequirementProgress.id == progress_id,
                TrainingProgram.organization_id == organization_id
            )
        )
        progress = result.scalar_one_or_none()

        if not progress:
            return None, "Requirement progress not found"

        # Update status
        if updates.status:
            try:
                status = RequirementProgressStatus(updates.status)
                progress.status = status

                if status == RequirementProgressStatus.IN_PROGRESS and not progress.started_at:
                    progress.started_at = datetime.utcnow()
                elif status == RequirementProgressStatus.COMPLETED:
                    progress.completed_at = datetime.utcnow()
                    if verified_by:
                        progress.verified_by = verified_by
                        progress.verified_at = datetime.utcnow()
            except ValueError:
                return None, f"Invalid status: {updates.status}"

        # Update progress value
        if updates.progress_value is not None:
            progress.progress_value = updates.progress_value

            # Calculate percentage based on requirement type
            requirement = progress.requirement
            if requirement.requirement_type == RequirementType.HOURS and requirement.required_hours:
                progress.progress_percentage = min(100.0, (updates.progress_value / requirement.required_hours) * 100)
            elif requirement.requirement_type == RequirementType.SHIFTS and requirement.required_shifts:
                progress.progress_percentage = min(100.0, (updates.progress_value / requirement.required_shifts) * 100)
            elif requirement.requirement_type == RequirementType.CALLS and requirement.required_calls:
                progress.progress_percentage = min(100.0, (updates.progress_value / requirement.required_calls) * 100)

            # Auto-complete if reached 100%
            if progress.progress_percentage >= 100.0 and progress.status != RequirementProgressStatus.COMPLETED:
                progress.status = RequirementProgressStatus.COMPLETED
                progress.completed_at = datetime.utcnow()

        # Update notes
        if updates.progress_notes is not None:
            progress.progress_notes = updates.progress_notes

        # Update verification
        if verified_by:
            progress.verified_by = verified_by
            progress.verified_at = datetime.utcnow()

        progress.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(progress)

        # Recalculate enrollment progress
        await self._recalculate_enrollment_progress(progress.enrollment_id)

        return progress, None

    async def _recalculate_enrollment_progress(
        self,
        enrollment_id: UUID,
    ) -> None:
        """
        Recalculate overall progress percentage for an enrollment
        """
        # Get all requirement progress for this enrollment
        result = await self.db.execute(
            select(RequirementProgress)
            .join(ProgramRequirement)
            .where(
                RequirementProgress.enrollment_id == enrollment_id,
                ProgramRequirement.is_required == True
            )
        )
        all_progress = result.scalars().all()

        if not all_progress:
            return

        # Calculate average progress percentage of required items
        total_percentage = sum(p.progress_percentage for p in all_progress)
        avg_percentage = total_percentage / len(all_progress)

        # Update enrollment
        await self.db.execute(
            update(ProgramEnrollment)
            .where(ProgramEnrollment.id == str(enrollment_id))
            .values(
                progress_percentage=avg_percentage,
                updated_at=datetime.utcnow()
            )
        )

        # Check if enrollment is complete
        if avg_percentage >= 100.0:
            await self.db.execute(
                update(ProgramEnrollment)
                .where(ProgramEnrollment.id == str(enrollment_id))
                .values(
                    status=EnrollmentStatus.COMPLETED,
                    completed_at=datetime.utcnow()
                )
            )

        await self.db.commit()

    # ==================== Program Duplication Methods ====================

    async def duplicate_program(
        self,
        source_program_id: UUID,
        new_name: str,
        organization_id: UUID,
        created_by: UUID,
        increment_version: bool = True,
    ) -> Tuple[Optional[TrainingProgram], Optional[str]]:
        """
        Duplicate a program (template or regular) with all phases, requirements, and milestones

        Returns: (new_program, error_message)
        """
        # Get source program with all relationships
        source_result = await self.db.execute(
            select(TrainingProgram)
            .options(
                selectinload(TrainingProgram.phases)
                .selectinload(ProgramPhase.requirements),
                selectinload(TrainingProgram.phases)
                .selectinload(ProgramPhase.milestones)
            )
            .where(TrainingProgram.id == str(source_program_id))
            .where(TrainingProgram.organization_id == str(organization_id))
        )
        source_program = source_result.scalar_one_or_none()

        if not source_program:
            return None, "Source program not found"

        # Calculate new version
        new_version = source_program.version + 1 if increment_version else source_program.version

        # Create new program
        new_program = TrainingProgram(
            organization_id=organization_id,
            name=new_name,
            description=source_program.description,
            code=source_program.code,
            version=new_version,
            target_position=source_program.target_position,
            target_roles=source_program.target_roles,
            structure_type=source_program.structure_type,
            prerequisite_program_ids=source_program.prerequisite_program_ids,
            allows_concurrent_enrollment=source_program.allows_concurrent_enrollment,
            time_limit_days=source_program.time_limit_days,
            warning_days_before=source_program.warning_days_before,
            reminder_conditions=source_program.reminder_conditions,
            active=True,
            is_template=False,  # Duplicates are not templates by default
            created_by=created_by,
        )

        self.db.add(new_program)
        await self.db.flush()

        # Map old phase IDs to new phase IDs
        phase_id_map = {}

        # Get all phases sorted by phase_number
        phases = sorted(source_program.phases, key=lambda p: p.phase_number)

        # Duplicate phases
        for source_phase in phases:
            new_phase = ProgramPhase(
                program_id=new_program.id,
                phase_number=source_phase.phase_number,
                name=source_phase.name,
                description=source_phase.description,
                prerequisite_phase_ids=None,  # Will update after all phases created
                requires_manual_advancement=source_phase.requires_manual_advancement,
                time_limit_days=source_phase.time_limit_days,
            )
            self.db.add(new_phase)
            await self.db.flush()
            phase_id_map[str(source_phase.id)] = new_phase.id

            # Duplicate phase requirements
            for source_req in source_phase.requirements:
                new_req = ProgramRequirement(
                    program_id=new_program.id,
                    phase_id=new_phase.id,
                    requirement_id=source_req.requirement_id,
                    is_required=source_req.is_required,
                    is_prerequisite=source_req.is_prerequisite,
                    sort_order=source_req.sort_order,
                    program_specific_description=source_req.program_specific_description,
                    custom_deadline_days=source_req.custom_deadline_days,
                    notification_message=source_req.notification_message,
                )
                self.db.add(new_req)

            # Duplicate phase milestones
            for source_milestone in source_phase.milestones:
                new_milestone = ProgramMilestone(
                    program_id=new_program.id,
                    phase_id=new_phase.id,
                    name=source_milestone.name,
                    description=source_milestone.description,
                    completion_percentage_threshold=source_milestone.completion_percentage_threshold,
                    notification_message=source_milestone.notification_message,
                    requires_verification=source_milestone.requires_verification,
                    verification_notes=source_milestone.verification_notes,
                )
                self.db.add(new_milestone)

        # Update prerequisite phase IDs with new phase IDs
        for source_phase in phases:
            if source_phase.prerequisite_phase_ids:
                new_phase_id = phase_id_map[str(source_phase.id)]
                new_prerequisite_ids = [
                    str(phase_id_map[str(old_id)])
                    for old_id in source_phase.prerequisite_phase_ids
                    if str(old_id) in phase_id_map
                ]
                await self.db.execute(
                    update(ProgramPhase)
                    .where(ProgramPhase.id == str(new_phase_id))
                    .values(prerequisite_phase_ids=new_prerequisite_ids)
                )

        # Get program-level requirements (not in phases)
        program_reqs_result = await self.db.execute(
            select(ProgramRequirement)
            .where(ProgramRequirement.program_id == str(source_program_id))
            .where(ProgramRequirement.phase_id == None)
        )
        program_reqs = program_reqs_result.scalars().all()

        # Duplicate program-level requirements
        for source_req in program_reqs:
            new_req = ProgramRequirement(
                program_id=new_program.id,
                phase_id=None,
                requirement_id=source_req.requirement_id,
                is_required=source_req.is_required,
                is_prerequisite=source_req.is_prerequisite,
                sort_order=source_req.sort_order,
                program_specific_description=source_req.program_specific_description,
                custom_deadline_days=source_req.custom_deadline_days,
                notification_message=source_req.notification_message,
            )
            self.db.add(new_req)

        # Get program-level milestones
        program_milestones_result = await self.db.execute(
            select(ProgramMilestone)
            .where(ProgramMilestone.program_id == str(source_program_id))
            .where(ProgramMilestone.phase_id == None)
        )
        program_milestones = program_milestones_result.scalars().all()

        # Duplicate program-level milestones
        for source_milestone in program_milestones:
            new_milestone = ProgramMilestone(
                program_id=new_program.id,
                phase_id=None,
                name=source_milestone.name,
                description=source_milestone.description,
                completion_percentage_threshold=source_milestone.completion_percentage_threshold,
                notification_message=source_milestone.notification_message,
                requires_verification=source_milestone.requires_verification,
                verification_notes=source_milestone.verification_notes,
            )
            self.db.add(new_milestone)

        await self.db.commit()
        await self.db.refresh(new_program)

        return new_program, None

    # ==================== Bulk Enrollment Methods ====================

    async def bulk_enroll_members(
        self,
        program_id: UUID,
        user_ids: List[UUID],
        organization_id: UUID,
        target_completion_date: Optional[date] = None,
        enrolled_by: Optional[UUID] = None,
    ) -> Tuple[List[ProgramEnrollment], List[str]]:
        """
        Enroll multiple members in a program at once

        Returns: (enrollments, errors)
        """
        # Verify program exists
        program = await self.get_program_by_id(program_id, organization_id, include_phases=True)
        if not program:
            return [], ["Training program not found"]

        # Check for prerequisite programs
        prerequisite_errors = []
        if program.prerequisite_program_ids:
            for user_id in user_ids:
                for prereq_id in program.prerequisite_program_ids:
                    # Check if user has completed prerequisite
                    prereq_enrollment = await self.db.execute(
                        select(ProgramEnrollment)
                        .join(TrainingProgram)
                        .where(
                            ProgramEnrollment.user_id == user_id,
                            TrainingProgram.id == UUID(prereq_id),
                            TrainingProgram.organization_id == organization_id
                        )
                    )
                    enrollment = prereq_enrollment.scalar_one_or_none()

                    if not enrollment or enrollment.status != EnrollmentStatus.COMPLETED:
                        user_result = await self.db.execute(
                            select(User).where(User.id == str(user_id))
                        )
                        user = user_result.scalar_one_or_none()
                        user_name = f"{user.first_name} {user.last_name}" if user else str(user_id)
                        prerequisite_errors.append(
                            f"{user_name} has not completed prerequisite program"
                        )

        # Check for concurrent enrollment restrictions
        if not program.allows_concurrent_enrollment:
            for user_id in user_ids:
                active_enrollments = await self.db.execute(
                    select(ProgramEnrollment)
                    .join(TrainingProgram)
                    .where(
                        ProgramEnrollment.user_id == user_id,
                        ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                        TrainingProgram.organization_id == organization_id
                    )
                )
                if active_enrollments.scalar_one_or_none():
                    user_result = await self.db.execute(
                        select(User).where(User.id == str(user_id))
                    )
                    user = user_result.scalar_one_or_none()
                    user_name = f"{user.first_name} {user.last_name}" if user else str(user_id)
                    prerequisite_errors.append(
                        f"{user_name} is already enrolled in another program. This program does not allow concurrent enrollment."
                    )

        enrollments = []
        errors = prerequisite_errors.copy()

        for user_id in user_ids:
            # Skip if user had prerequisite errors
            if any(str(user_id) in error for error in prerequisite_errors):
                continue

            # Try to enroll
            enrollment, error = await self.enroll_member(
                enrollment_data=ProgramEnrollmentCreate(
                    user_id=user_id,
                    program_id=program_id,
                    target_completion_date=target_completion_date,
                ),
                organization_id=organization_id,
                enrolled_by=enrolled_by,
            )

            if error:
                errors.append(f"{user_id}: {error}")
            elif enrollment:
                enrollments.append(enrollment)

        return enrollments, errors

    # ==================== Registry Import Methods ====================

    async def import_registry_requirements(
        self,
        registry_file_path: str,
        organization_id: UUID,
        created_by: UUID,
        skip_existing: bool = True,
    ) -> Tuple[int, List[str]]:
        """
        Import requirements from a registry JSON file

        Returns: (imported_count, errors)
        """
        file_path = Path(registry_file_path)
        if not file_path.exists():
            return 0, [f"Registry file not found: {registry_file_path}"]

        try:
            with open(file_path, 'r') as f:
                registry_data = json.load(f)
        except json.JSONDecodeError as e:
            return 0, [f"Invalid JSON in registry file: {str(e)}"]

        registry_name = registry_data.get('registry_name')
        requirements_data = registry_data.get('requirements', [])

        imported_count = 0
        errors = []

        for req_data in requirements_data:
            # Check if requirement already exists
            if skip_existing and req_data.get('registry_code'):
                existing = await self.db.execute(
                    select(TrainingRequirement).where(
                        TrainingRequirement.organization_id == organization_id,
                        TrainingRequirement.registry_name == registry_name,
                        TrainingRequirement.registry_code == req_data.get('registry_code')
                    )
                )
                if existing.scalar_one_or_none():
                    continue

            try:
                # Create requirement from registry data
                requirement = TrainingRequirement(
                    organization_id=organization_id,
                    name=req_data.get('name'),
                    description=req_data.get('description'),
                    requirement_type=RequirementType(req_data.get('requirement_type', 'hours')),
                    source=RequirementSource.NATIONAL,
                    registry_name=registry_name,
                    registry_code=req_data.get('registry_code'),
                    is_editable=req_data.get('is_editable', True),
                    training_type=req_data.get('training_type'),
                    required_hours=req_data.get('required_hours'),
                    required_courses=req_data.get('required_courses'),
                    required_shifts=req_data.get('required_shifts'),
                    required_calls=req_data.get('required_calls'),
                    required_call_types=req_data.get('required_call_types'),
                    required_skills=req_data.get('required_skills'),
                    checklist_items=req_data.get('checklist_items'),
                    frequency=req_data.get('frequency', 'annual'),
                    time_limit_days=req_data.get('time_limit_days'),
                    applies_to_all=req_data.get('applies_to_all', False),
                    required_positions=req_data.get('required_positions'),
                    required_roles=req_data.get('required_roles'),
                    created_by=created_by,
                )
                self.db.add(requirement)
                imported_count += 1

            except Exception as e:
                errors.append(f"Error importing {req_data.get('name', 'unknown')}: {str(e)}")

        await self.db.commit()
        return imported_count, errors
