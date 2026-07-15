"""
Training Program Service

Business logic for training program management, enrollment, and progress tracking.
"""

import asyncio
import copy
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.notification import NotificationCategory, NotificationChannel
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramMilestone,
    ProgramPhase,
    ProgramRequirement,
    ProgramStructureType,
    RequirementProgress,
    RequirementFrequency,
    RequirementProgressStatus,
    RequirementSource,
    RequirementType,
    TrainingCategory,
    TrainingProgram,
    TrainingRequirement,
    TrainingType,
)
from app.models.user import User
from app.schemas.training_program import (
    ProgramEnrollmentCreate,
    ProgramMilestoneCreate,
    ProgramMilestoneUpdate,
    ProgramPhaseCreate,
    ProgramPhaseUpdate,
    ProgramRequirementCreate,
    ProgramRequirementUpdate,
    RequirementProgressUpdate,
    TrainingProgramCreate,
    TrainingProgramUpdate,
    TrainingRequirementEnhancedCreate,
)
from app.services.notifications_service import NotificationsService
from app.services.training_waiver_service import (
    adjust_required,
    fetch_user_waivers,
    get_rolling_period_months,
)


class TrainingProgramService:
    """Service for training program management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== Notification Helpers ====================

    async def _notify_enrollment(
        self,
        enrollment: ProgramEnrollment,
        program: TrainingProgram,
        user: User,
        organization_id: UUID,
    ) -> None:
        """Send enrollment notification to the member and their mentors/officers."""
        notif_service = NotificationsService(self.db)

        # Notify the member
        await notif_service.log_notification(
            organization_id=organization_id,
            log_data={
                "recipient_id": str(user.id),
                "channel": NotificationChannel.IN_APP,
                "subject": f"Enrolled in Training Program: {program.name}",
                "message": (
                    f"You have been enrolled in the {program.name} training program. "
                    f"{'Target completion: ' + str(enrollment.target_completion_date) if enrollment.target_completion_date else 'Check your training dashboard for details.'}"
                ),
                "category": NotificationCategory.TRAINING,
                "action_url": f"/training/programs/{program.id}/progress",
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
            },
        )

        # Notify mentor/assigned officer if configured on the enrollment
        if getattr(enrollment, "mentor_id", None):
            await notif_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "recipient_id": str(enrollment.mentor_id),
                    "channel": NotificationChannel.IN_APP,
                    "subject": f"New Trainee Enrolled: {user.full_name} - {program.name}",
                    "message": f"{user.full_name} has been enrolled in {program.name}. You are assigned as their mentor.",
                    "category": NotificationCategory.TRAINING,
                    "action_url": f"/training/programs/{program.id}/enrollments",
                    "delivered": True,
                    "sent_at": datetime.now(timezone.utc),
                },
            )

    async def _notify_phase_advancement(
        self,
        enrollment: ProgramEnrollment,
        program: TrainingProgram,
        user: User,
        new_phase_name: str,
        organization_id: UUID,
    ) -> None:
        """Send phase advancement notification."""
        notif_service = NotificationsService(self.db)

        await notif_service.log_notification(
            organization_id=organization_id,
            log_data={
                "recipient_id": str(user.id),
                "channel": NotificationChannel.IN_APP,
                "subject": f"Phase Advanced: {program.name}",
                "message": f"Congratulations! You have advanced to {new_phase_name} in {program.name}.",
                "category": NotificationCategory.TRAINING,
                "action_url": f"/training/programs/{program.id}/progress",
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
            },
        )

        # Notify mentor
        if getattr(enrollment, "mentor_id", None):
            await notif_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "recipient_id": str(enrollment.mentor_id),
                    "channel": NotificationChannel.IN_APP,
                    "subject": f"Trainee Advanced: {user.full_name} - {program.name}",
                    "message": f"{user.full_name} has advanced to {new_phase_name} in {program.name}.",
                    "category": NotificationCategory.TRAINING,
                    "action_url": f"/training/programs/{program.id}/enrollments",
                    "delivered": True,
                    "sent_at": datetime.now(timezone.utc),
                },
            )

    async def _notify_program_completion(
        self,
        enrollment: ProgramEnrollment,
        program: TrainingProgram,
        user: User,
        organization_id: UUID,
    ) -> None:
        """Send program completion notification."""
        notif_service = NotificationsService(self.db)

        await notif_service.log_notification(
            organization_id=organization_id,
            log_data={
                "recipient_id": str(user.id),
                "channel": NotificationChannel.IN_APP,
                "subject": f"Program Completed: {program.name}",
                "message": f"Congratulations! You have completed the {program.name} training program.",
                "category": NotificationCategory.TRAINING,
                "action_url": f"/training/programs/{program.id}/progress",
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
            },
        )

        # Notify mentor
        if getattr(enrollment, "mentor_id", None):
            await notif_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "recipient_id": str(enrollment.mentor_id),
                    "channel": NotificationChannel.IN_APP,
                    "subject": f"Trainee Completed: {user.full_name} - {program.name}",
                    "message": f"{user.full_name} has completed {program.name}!",
                    "category": NotificationCategory.TRAINING,
                    "action_url": f"/training/programs/{program.id}/enrollments",
                    "delivered": True,
                    "sent_at": datetime.now(timezone.utc),
                },
            )

    async def _handle_evoc_completion(
        self,
        program: TrainingProgram,
        enrollment: ProgramEnrollment,
    ) -> None:
        """When a training program linked to an EVOC level completes,
        auto-add the member as an operator on qualifying apparatus."""
        from app.models.apparatus import EvocLevel
        from app.services.evoc_level_service import EvocLevelService

        evoc_result = await self.db.execute(
            select(EvocLevel).where(
                EvocLevel.training_program_id == str(program.id),
                EvocLevel.organization_id == str(program.organization_id),
                EvocLevel.is_active.is_(True),
            )
        )
        evoc_level = evoc_result.scalar_one_or_none()
        if not evoc_level:
            return

        evoc_service = EvocLevelService(self.db)
        new_operators = await evoc_service.auto_add_operators_for_evoc_completion(
            user_id=str(enrollment.user_id),
            evoc_level_id=str(evoc_level.id),
            organization_id=str(program.organization_id),
        )

        if new_operators:
            logger.info(
                f"Auto-added {len(new_operators)} operator record(s) for user "
                f"{enrollment.user_id} after EVOC level {evoc_level.level_number} "
                f"completion"
            )

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
            return (
                None,
                f"Invalid requirement type: {requirement_data.requirement_type}",
            )

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
            passing_score=getattr(requirement_data, "passing_score", None),
            max_attempts=getattr(requirement_data, "max_attempts", None),
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
            TrainingRequirement.active == True,  # noqa: E712
        )

        if source:
            query = query.where(TrainingRequirement.source == source)
        if registry_name:
            query = query.where(TrainingRequirement.registry_name == registry_name)
        if requirement_type:
            query = query.where(
                TrainingRequirement.requirement_type == requirement_type
            )
        if position:
            # Check if position is in the required_positions JSONB array
            query = query.where(
                TrainingRequirement.required_positions.contains([position])
            )

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

        # A changed numeric target changes completion math for enrolled members.
        target_fields = {
            "required_hours",
            "required_shifts",
            "required_calls",
            "required_courses",
        }
        target_changed = any(
            field in updates and getattr(requirement, field, None) != value
            for field, value in updates.items()
            if field in target_fields
        )

        # Update fields
        for field, value in updates.items():
            if hasattr(requirement, field) and value is not None:
                setattr(requirement, field, value)

        requirement.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(requirement)

        # Re-derive progress-row percentages so enrolled members' progress isn't
        # left stale against the new target.
        if target_changed:
            await self._recompute_progress_for_requirement(requirement)

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
            code=program_data.code,
            target_position=program_data.target_position,
            target_roles=program_data.target_roles,
            structure_type=structure_type,
            time_limit_days=program_data.time_limit_days,
            warning_days_before=program_data.warning_days_before,
            is_template=program_data.is_template,
            recert_enabled=program_data.recert_enabled,
            recert_interval_months=program_data.recert_interval_months,
            recert_anchor_month=program_data.recert_anchor_month,
            recert_anchor_day=program_data.recert_anchor_day,
            created_by=created_by,
        )

        self.db.add(program)
        await self.db.commit()
        await self.db.refresh(program)

        return program, None

    async def build_program(
        self,
        payload: Any,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingProgram], Optional[str]]:
        """Create a program and its full structure (phases, requirements,
        milestones) in a single transaction.

        The create-pipeline wizard used to fire one request per entity with no
        rollback, so any failure part-way left an orphaned, half-built program.
        Persisting everything under one commit makes the whole build atomic:
        it either lands complete or not at all.

        Returns: (program, error_message)
        """
        prog = payload.program

        try:
            structure_type = ProgramStructureType(prog.structure_type)
        except ValueError:
            return None, f"Invalid structure type: {prog.structure_type}"

        program = TrainingProgram(
            organization_id=organization_id,
            name=prog.name,
            description=prog.description,
            code=prog.code,
            target_position=prog.target_position,
            target_roles=prog.target_roles,
            structure_type=structure_type,
            time_limit_days=prog.time_limit_days,
            warning_days_before=prog.warning_days_before,
            is_template=prog.is_template,
            recert_enabled=getattr(prog, "recert_enabled", False),
            recert_interval_months=getattr(prog, "recert_interval_months", None),
            recert_anchor_month=getattr(prog, "recert_anchor_month", None),
            recert_anchor_day=getattr(prog, "recert_anchor_day", None),
            created_by=created_by,
        )
        self.db.add(program)
        await self.db.flush()

        for phase_input in payload.phases:
            phase = ProgramPhase(
                program_id=program.id,
                phase_number=phase_input.phase_number,
                name=phase_input.name,
                description=phase_input.description,
                time_limit_days=phase_input.time_limit_days,
                requires_manual_advancement=phase_input.requires_manual_advancement,
            )
            self.db.add(phase)
            await self.db.flush()

            for idx, req_input in enumerate(phase_input.requirements):
                try:
                    req_type = RequirementType(req_input.requirement_type)
                except ValueError:
                    return (
                        None,
                        f"Invalid requirement type: {req_input.requirement_type}",
                    )
                try:
                    frequency = RequirementFrequency(req_input.frequency)
                except ValueError:
                    frequency = RequirementFrequency.ONE_TIME

                checklist = [
                    c for c in (req_input.checklist_items or []) if c.strip()
                ] or None

                requirement = TrainingRequirement(
                    organization_id=organization_id,
                    name=req_input.name,
                    description=req_input.description,
                    requirement_type=req_type,
                    source=RequirementSource.DEPARTMENT,
                    frequency=frequency,
                    required_hours=req_input.required_hours,
                    required_shifts=req_input.required_shifts,
                    required_calls=req_input.required_calls,
                    passing_score=req_input.passing_score,
                    max_attempts=req_input.max_attempts,
                    checklist_items=checklist,
                    is_editable=True,
                    applies_to_all=False,
                    created_by=created_by,
                )
                self.db.add(requirement)
                await self.db.flush()

                self.db.add(
                    ProgramRequirement(
                        program_id=program.id,
                        phase_id=phase.id,
                        requirement_id=requirement.id,
                        is_required=req_input.is_required,
                        sort_order=req_input.sort_order or idx,
                    )
                )

            for ms_input in phase_input.milestones:
                self.db.add(
                    ProgramMilestone(
                        program_id=program.id,
                        phase_id=phase.id,
                        name=ms_input.name,
                        description=ms_input.description,
                        completion_percentage_threshold=(
                            ms_input.completion_percentage_threshold
                        ),
                        notification_message=ms_input.notification_message,
                    )
                )

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
            TrainingProgram.organization_id == str(organization_id),
        )

        if include_phases:
            query = query.options(selectinload(TrainingProgram.phases))
        if include_requirements:
            query = query.options(
                selectinload(TrainingProgram.program_requirements).selectinload(
                    ProgramRequirement.requirement
                )
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
            TrainingProgram.active == True,  # noqa: E712
        )

        if target_position:
            query = query.where(TrainingProgram.target_position == target_position)
        if is_template is not None:
            query = query.where(TrainingProgram.is_template == is_template)

        result = await self.db.execute(query.order_by(TrainingProgram.name))
        return result.scalars().all()

    # ==================== Program Phase Methods ====================

    async def update_training_program(
        self,
        program_id: UUID,
        organization_id: UUID,
        updates: TrainingProgramUpdate,
    ) -> Tuple[Optional[TrainingProgram], Optional[str]]:
        """
        Update a program's own fields (name, description, code, structure, time
        limits, target position/roles, template flag, active). Returns
        (program, error_message).
        """
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return None, "Training program not found"

        data = updates.model_dump(exclude_unset=True)
        if "structure_type" in data and data["structure_type"] is not None:
            try:
                data["structure_type"] = ProgramStructureType(data["structure_type"])
            except ValueError:
                return None, f"Invalid structure type: {data['structure_type']}"

        for field, value in data.items():
            setattr(program, field, value)

        await self.db.commit()
        await self.db.refresh(program)
        return program, None

    async def delete_training_program(
        self,
        program_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """
        Permanently delete a program and everything under it — phases,
        requirement links, milestones, enrollments, and enrolled members'
        progress. Also removes the program-specific requirements it owns once
        they're no longer referenced anywhere. Explicit ordered deletes (rather
        than ORM cascade) keep this deterministic on the async session.

        This is irreversible; the UI guards it behind a typed/confirmed warning.
        Returns (ok, error_message).
        """
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return False, "Training program not found"

        pid = str(program_id)

        enroll_rows = await self.db.execute(
            select(ProgramEnrollment.id).where(ProgramEnrollment.program_id == pid)
        )
        enrollment_ids = [str(r[0]) for r in enroll_rows.all()]

        link_rows = await self.db.execute(
            select(ProgramRequirement.requirement_id).where(
                ProgramRequirement.program_id == pid
            )
        )
        requirement_ids = [str(r[0]) for r in link_rows.all()]

        if enrollment_ids:
            await self.db.execute(
                delete(RequirementProgress).where(
                    RequirementProgress.enrollment_id.in_(enrollment_ids)
                )
            )
        await self.db.execute(
            delete(ProgramEnrollment).where(ProgramEnrollment.program_id == pid)
        )
        await self.db.execute(
            delete(ProgramMilestone).where(ProgramMilestone.program_id == pid)
        )
        await self.db.execute(
            delete(ProgramRequirement).where(ProgramRequirement.program_id == pid)
        )
        await self.db.execute(
            delete(ProgramPhase).where(ProgramPhase.program_id == pid)
        )

        # Drop program-specific requirements no longer referenced by any program.
        for req_id in set(requirement_ids):
            still_used = await self.db.execute(
                select(ProgramRequirement.id)
                .where(ProgramRequirement.requirement_id == req_id)
                .limit(1)
            )
            if still_used.scalar_one_or_none() is None:
                await self.db.execute(
                    delete(TrainingRequirement).where(TrainingRequirement.id == req_id)
                )

        await self.db.execute(delete(TrainingProgram).where(TrainingProgram.id == pid))
        await self.db.commit()
        return True, None

    async def _recompute_progress_for_requirement(
        self, requirement: TrainingRequirement
    ) -> None:
        """
        After a requirement's numeric target changes (hours/shifts/calls/course
        count), re-derive the stored ``progress_percentage`` on every progress
        row for it, then roll up each affected enrollment. Without this the row
        percentages stay stale until the next manual progress update.
        """
        numeric_targets = {
            RequirementType.HOURS: requirement.required_hours,
            RequirementType.SHIFTS: requirement.required_shifts,
            RequirementType.CALLS: requirement.required_calls,
            RequirementType.COURSES: (
                len(requirement.required_courses)
                if requirement.required_courses
                else None
            ),
        }
        target = numeric_targets.get(requirement.requirement_type)
        if not target:
            return  # status-based type, or no target set — nothing to recompute

        rows_result = await self.db.execute(
            select(RequirementProgress).where(
                RequirementProgress.requirement_id == str(requirement.id)
            )
        )
        rows = rows_result.scalars().all()
        affected_enrollment_ids = set()
        for row in rows:
            # Don't reopen a manually completed/verified/waived requirement.
            if row.status in (
                RequirementProgressStatus.COMPLETED,
                RequirementProgressStatus.VERIFIED,
                RequirementProgressStatus.WAIVED,
            ):
                continue
            row.progress_percentage = min(
                100.0, ((row.progress_value or 0) / target) * 100
            )
            if row.progress_percentage >= 100.0:
                row.status = RequirementProgressStatus.COMPLETED
                row.completed_at = datetime.now(timezone.utc)
            affected_enrollment_ids.add(row.enrollment_id)

        if affected_enrollment_ids:
            await self.db.commit()
            for eid in affected_enrollment_ids:
                await self._recalculate_enrollment_progress(UUID(str(eid)))
                await self._maybe_auto_advance_phase(UUID(str(eid)))

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

        # Check for duplicate phase numbers (application-level check for friendly errors)
        existing_phase = await self.db.execute(
            select(ProgramPhase).where(
                ProgramPhase.program_id == str(phase_data.program_id),
                ProgramPhase.phase_number == phase_data.phase_number,
            )
        )
        if existing_phase.scalar_one_or_none():
            return (
                None,
                f"Phase {phase_data.phase_number} already exists for this program",
            )

        # Create phase (DB-level unique constraint prevents race conditions)
        phase = ProgramPhase(
            program_id=phase_data.program_id,
            phase_number=phase_data.phase_number,
            name=phase_data.name,
            description=phase_data.description,
            prerequisite_phase_ids=phase_data.prerequisite_phase_ids,
            time_limit_days=phase_data.time_limit_days,
            requires_manual_advancement=phase_data.requires_manual_advancement,
        )

        self.db.add(phase)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            return (
                None,
                f"Phase {phase_data.phase_number} already exists for this program",
            )
        await self.db.refresh(phase)

        return phase, None

    async def _get_program_phase(
        self, phase_id: UUID, program_id: UUID, organization_id: UUID
    ) -> Optional[ProgramPhase]:
        result = await self.db.execute(
            select(ProgramPhase)
            .join(TrainingProgram, ProgramPhase.program_id == TrainingProgram.id)
            .where(
                ProgramPhase.id == str(phase_id),
                ProgramPhase.program_id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def update_program_phase(
        self,
        phase_id: UUID,
        program_id: UUID,
        organization_id: UUID,
        updates: ProgramPhaseUpdate,
    ) -> Tuple[Optional[ProgramPhase], Optional[str]]:
        """
        Update a phase's fields (name, description, time limit, manual-advance
        flag, prerequisites). ``phase_number`` is NOT changed here — use
        ``reorder_program_phases`` so numbering stays contiguous and collision-
        free. Returns (phase, error_message).
        """
        phase = await self._get_program_phase(phase_id, program_id, organization_id)
        if not phase:
            return None, "Program phase not found"

        data = updates.model_dump(exclude_unset=True)
        data.pop("phase_number", None)  # reordering is a separate operation
        for field, value in data.items():
            setattr(phase, field, value)

        await self.db.commit()
        await self.db.refresh(phase)
        return phase, None

    async def reorder_program_phases(
        self,
        program_id: UUID,
        organization_id: UUID,
        phase_ids: List[UUID],
    ) -> Tuple[Optional[List[ProgramPhase]], Optional[str]]:
        """
        Renumber phases to match the given order (1-based). The list must be
        exactly the program's current phases. Because (program_id, phase_number)
        is unique, we park everything on temporary negative numbers first, then
        assign the finals — avoiding mid-update collisions.
        """
        result = await self.db.execute(
            select(ProgramPhase)
            .join(TrainingProgram, ProgramPhase.program_id == TrainingProgram.id)
            .where(
                ProgramPhase.program_id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        phases = {str(p.id): p for p in result.scalars().all()}
        ordered_ids = [str(pid) for pid in phase_ids]
        if set(ordered_ids) != set(phases) or len(ordered_ids) != len(phases):
            return None, "The phase list must include every phase exactly once"

        for offset, pid in enumerate(ordered_ids):
            phases[pid].phase_number = -(offset + 1)
        await self.db.flush()
        for index, pid in enumerate(ordered_ids):
            phases[pid].phase_number = index + 1
        await self.db.commit()

        return [phases[pid] for pid in ordered_ids], None

    async def delete_program_phase(
        self,
        phase_id: UUID,
        program_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """
        Delete a phase and everything anchored to it, cleaning up enrolled
        members (auto-clean): drop the phase's requirement links and their
        progress rows, delete the phase's milestones, re-anchor any enrollee
        parked on this phase to the first remaining phase, then recompute /
        re-advance those enrollments. Returns (ok, error_message).
        """
        phase = await self._get_program_phase(phase_id, program_id, organization_id)
        if not phase:
            return False, "Program phase not found"

        # Requirement links on this phase, and the enrollments of this program.
        link_result = await self.db.execute(
            select(ProgramRequirement.id, ProgramRequirement.requirement_id).where(
                ProgramRequirement.phase_id == str(phase_id)
            )
        )
        link_rows = link_result.all()
        requirement_ids = [str(r[1]) for r in link_rows]

        enroll_result = await self.db.execute(
            select(ProgramEnrollment.id, ProgramEnrollment.current_phase_id).where(
                ProgramEnrollment.program_id == str(program_id)
            )
        )
        enroll_rows = enroll_result.all()
        program_enrollment_ids = [str(r[0]) for r in enroll_rows]

        # Drop progress rows for the phase's requirements (this program only).
        if requirement_ids and program_enrollment_ids:
            await self.db.execute(
                delete(RequirementProgress).where(
                    RequirementProgress.requirement_id.in_(requirement_ids),
                    RequirementProgress.enrollment_id.in_(program_enrollment_ids),
                )
            )

        # Re-anchor enrollees parked on this phase to the first remaining phase.
        remaining_result = await self.db.execute(
            select(ProgramPhase)
            .where(
                ProgramPhase.program_id == str(program_id),
                ProgramPhase.id != str(phase_id),
            )
            .order_by(ProgramPhase.phase_number)
        )
        remaining_phases = remaining_result.scalars().all()
        fallback_phase_id = remaining_phases[0].id if remaining_phases else None
        reanchored_ids = [str(r[0]) for r in enroll_rows if str(r[1]) == str(phase_id)]
        if reanchored_ids:
            await self.db.execute(
                update(ProgramEnrollment)
                .where(ProgramEnrollment.id.in_(reanchored_ids))
                .values(current_phase_id=fallback_phase_id)
            )

        # Delete the phase (cascades its ProgramRequirement links + milestones).
        await self.db.delete(phase)
        await self.db.commit()

        # Recompute the whole program's enrollments (removed requirements change
        # the denominator); re-advance the re-anchored ones through any phases
        # they've already completed.
        for eid in program_enrollment_ids:
            await self._recalculate_enrollment_progress(UUID(eid))
        for eid in reanchored_ids:
            await self._maybe_auto_advance_phase(UUID(eid))

        return True, None

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

    async def _load_program_requirement(
        self, program_requirement_id: str
    ) -> Optional[ProgramRequirement]:
        """Reload a program↔requirement link with its ``requirement`` eagerly
        loaded, so responses can include the requirement's name/type. Callers
        that commit (which expires attributes) must use this instead of a bare
        refresh — the response schema now declares a nested ``requirement`` and
        accessing an unloaded relationship on an async session raises.
        """
        result = await self.db.execute(
            select(ProgramRequirement)
            .options(selectinload(ProgramRequirement.requirement))
            .where(ProgramRequirement.id == str(program_requirement_id))
        )
        return result.scalar_one_or_none()

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
        program = await self.get_program_by_id(
            program_requirement_data.program_id, organization_id
        )
        if not program:
            return None, "Training program not found"

        # Verify requirement exists
        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(
                TrainingRequirement.id == str(program_requirement_data.requirement_id)
            )
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
                .where(
                    ProgramPhase.program_id == str(program_requirement_data.program_id)
                )
            )
            if not phase_result.scalar_one_or_none():
                return None, "Program phase not found"

        # Check for duplicate
        existing = await self.db.execute(
            select(ProgramRequirement).where(
                ProgramRequirement.program_id
                == str(program_requirement_data.program_id),
                ProgramRequirement.requirement_id
                == str(program_requirement_data.requirement_id),
                ProgramRequirement.phase_id
                == (
                    str(program_requirement_data.phase_id)
                    if program_requirement_data.phase_id
                    else None
                ),
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
        await self.db.flush()

        # Backfill progress rows for in-progress enrollments. Enrollment creates
        # a RequirementProgress row per requirement up front, and completion is
        # the average over those rows — so a requirement added after members
        # enrolled would never be counted, letting them be (or stay) marked
        # complete without it. Give every non-terminal enrollment a NOT_STARTED
        # row for the new requirement and recompute, so the new requirement
        # actually counts toward completion.
        enrollment_rows = await self.db.execute(
            select(ProgramEnrollment.id).where(
                ProgramEnrollment.program_id
                == str(program_requirement_data.program_id),
                ProgramEnrollment.status.in_(
                    [EnrollmentStatus.ACTIVE, EnrollmentStatus.ON_HOLD]
                ),
            )
        )
        affected_ids = [row[0] for row in enrollment_rows.all()]
        for eid in affected_ids:
            self.db.add(
                RequirementProgress(
                    enrollment_id=eid,
                    requirement_id=program_requirement_data.requirement_id,
                    status=RequirementProgressStatus.NOT_STARTED,
                    progress_value=0.0,
                    progress_percentage=0.0,
                )
            )
        await self.db.flush()
        for eid in affected_ids:
            await self._recalculate_enrollment_progress(UUID(eid))

        await self.db.commit()
        await self.db.refresh(program_requirement)

        loaded = await self._load_program_requirement(program_requirement.id)
        return (loaded or program_requirement), None

    async def update_program_requirement(
        self,
        program_requirement_id: UUID,
        organization_id: UUID,
        updates: ProgramRequirementUpdate,
    ) -> Tuple[Optional[ProgramRequirement], Optional[str]]:
        """
        Update a program↔requirement link (is_required / is_prerequisite /
        sort_order). Toggling ``is_required`` changes which items count toward
        completion, so affected enrollments are recomputed (and re-checked for
        phase advancement).

        Returns: (program_requirement, error_message)
        """
        result = await self.db.execute(
            select(ProgramRequirement)
            .join(
                TrainingProgram,
                ProgramRequirement.program_id == TrainingProgram.id,
            )
            .where(
                ProgramRequirement.id == str(program_requirement_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        program_requirement = result.scalar_one_or_none()
        if not program_requirement:
            return None, "Program requirement not found"

        data = updates.model_dump(exclude_unset=True)
        required_changed = (
            "is_required" in data
            and data["is_required"] != program_requirement.is_required
        )

        # Moving to a different phase: the target must belong to this program.
        if data.get("phase_id") is not None:
            target_phase = await self._get_program_phase(
                data["phase_id"], program_requirement.program_id, organization_id
            )
            if not target_phase:
                return None, "Target phase not found in this program"

        for field, value in data.items():
            setattr(program_requirement, field, value)

        await self.db.commit()
        await self.db.refresh(program_requirement)
        # Capture before the recompute below: _recalculate/_maybe_auto_advance
        # commit internally, which re-expires this instance's attributes.
        pr_id = program_requirement.id
        program_id_str = str(program_requirement.program_id)

        # Recompute enrollments whose completion math just changed.
        if required_changed:
            enrollment_rows = await self.db.execute(
                select(ProgramEnrollment.id).where(
                    ProgramEnrollment.program_id == program_id_str,
                    ProgramEnrollment.status.in_(
                        [EnrollmentStatus.ACTIVE, EnrollmentStatus.ON_HOLD]
                    ),
                )
            )
            for row in enrollment_rows.all():
                await self._recalculate_enrollment_progress(UUID(row[0]))
                await self._maybe_auto_advance_phase(UUID(row[0]))

        loaded = await self._load_program_requirement(pr_id)
        return (loaded or program_requirement), None

    async def remove_requirement_from_program(
        self,
        program_requirement_id: UUID,
        program_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """
        Unlink a requirement from the program (auto-clean): delete its progress
        rows for this program's enrollments, drop the link, delete the now-
        orphaned requirement if nothing else references it, then recompute the
        affected enrollments. Returns (ok, error_message).
        """
        result = await self.db.execute(
            select(ProgramRequirement)
            .join(TrainingProgram, ProgramRequirement.program_id == TrainingProgram.id)
            .where(
                ProgramRequirement.id == str(program_requirement_id),
                ProgramRequirement.program_id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        link = result.scalar_one_or_none()
        if not link:
            return False, "Program requirement not found"

        requirement_id = str(link.requirement_id)

        enroll_result = await self.db.execute(
            select(ProgramEnrollment.id).where(
                ProgramEnrollment.program_id == str(program_id)
            )
        )
        enrollment_ids = [str(r[0]) for r in enroll_result.all()]
        if enrollment_ids:
            await self.db.execute(
                delete(RequirementProgress).where(
                    RequirementProgress.requirement_id == requirement_id,
                    RequirementProgress.enrollment_id.in_(enrollment_ids),
                )
            )

        await self.db.delete(link)
        await self.db.flush()

        # If no other program links this requirement, remove the orphan so it
        # doesn't linger in the requirements library.
        others = await self.db.execute(
            select(ProgramRequirement.id)
            .where(ProgramRequirement.requirement_id == requirement_id)
            .limit(1)
        )
        if others.scalar_one_or_none() is None:
            await self.db.execute(
                delete(TrainingRequirement).where(
                    TrainingRequirement.id == requirement_id
                )
            )

        await self.db.commit()

        for eid in enrollment_ids:
            await self._recalculate_enrollment_progress(UUID(eid))
            await self._maybe_auto_advance_phase(UUID(eid))

        return True, None

    async def reorder_program_requirements(
        self,
        program_id: UUID,
        organization_id: UUID,
        program_requirement_ids: List[UUID],
    ) -> Tuple[Optional[List[ProgramRequirement]], Optional[str]]:
        """
        Set ``sort_order`` on the given links to match their order (0-based).
        The list may be a subset (e.g. one phase's requirements). Every id must
        belong to this program. Returns (links, error_message).
        """
        result = await self.db.execute(
            select(ProgramRequirement)
            .join(TrainingProgram, ProgramRequirement.program_id == TrainingProgram.id)
            .where(
                ProgramRequirement.program_id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        links = {str(link.id): link for link in result.scalars().all()}
        ordered_ids = [str(i) for i in program_requirement_ids]
        if any(pid not in links for pid in ordered_ids):
            return None, "A requirement does not belong to this program"

        for index, pid in enumerate(ordered_ids):
            links[pid].sort_order = index
        await self.db.commit()

        return [links[pid] for pid in ordered_ids], None

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

        query = (
            select(ProgramRequirement)
            .options(selectinload(ProgramRequirement.requirement))
            .where(ProgramRequirement.program_id == str(program_id))
        )

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
        program = await self.get_program_by_id(
            milestone_data.program_id, organization_id
        )
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

    async def _get_program_milestone(
        self, milestone_id: UUID, program_id: UUID, organization_id: UUID
    ) -> Optional[ProgramMilestone]:
        result = await self.db.execute(
            select(ProgramMilestone)
            .join(TrainingProgram, ProgramMilestone.program_id == TrainingProgram.id)
            .where(
                ProgramMilestone.id == str(milestone_id),
                ProgramMilestone.program_id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def update_program_milestone(
        self,
        milestone_id: UUID,
        program_id: UUID,
        organization_id: UUID,
        updates: ProgramMilestoneUpdate,
    ) -> Tuple[Optional[ProgramMilestone], Optional[str]]:
        """Update a milestone's name/description/threshold/message."""
        milestone = await self._get_program_milestone(
            milestone_id, program_id, organization_id
        )
        if not milestone:
            return None, "Program milestone not found"

        for field, value in updates.model_dump(exclude_unset=True).items():
            setattr(milestone, field, value)

        await self.db.commit()
        await self.db.refresh(milestone)
        return milestone, None

    async def delete_program_milestone(
        self,
        milestone_id: UUID,
        program_id: UUID,
        organization_id: UUID,
    ) -> Tuple[bool, Optional[str]]:
        """Delete a milestone (no enrollment side-effects — it's a notify hook)."""
        milestone = await self._get_program_milestone(
            milestone_id, program_id, organization_id
        )
        if not milestone:
            return False, "Program milestone not found"

        await self.db.delete(milestone)
        await self.db.commit()
        return True, None

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
        program = await self.get_program_by_id(
            enrollment_data.program_id, organization_id, include_phases=True
        )
        if not program:
            return None, "Training program not found"

        # Verify user exists in the same organization — the user_id comes
        # from the request body, so without this filter an officer could
        # enroll a member of another organization.
        user_result = await self.db.execute(
            select(User).where(
                User.id == str(enrollment_data.user_id),
                User.organization_id == str(organization_id),
            )
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return None, "User not found"

        # Check for existing active enrollment
        existing = await self.db.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == str(enrollment_data.user_id),
                ProgramEnrollment.program_id == str(enrollment_data.program_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )
        if existing.scalar_one_or_none():
            return None, "User is already enrolled in this program"

        # Calculate target completion date if not provided
        target_completion_date = enrollment_data.target_completion_date
        if not target_completion_date and program.time_limit_days:
            target_completion_date = date.today() + timedelta(
                days=program.time_limit_days
            )

        # Determine initial phase for phase-based programs
        current_phase_id = None
        if program.structure_type == ProgramStructureType.PHASES and program.phases:
            # Start with phase 1
            first_phase = min(program.phases, key=lambda p: p.phase_number)
            current_phase_id = first_phase.id

        # Schedule the first recert deadline for recert-enabled programs so the
        # member's cycle is tracked from day one.
        next_recert_reset_at = self._compute_next_recert_date(
            program, datetime.now(timezone.utc).date()
        )

        # Create enrollment
        enrollment = ProgramEnrollment(
            user_id=enrollment_data.user_id,
            program_id=enrollment_data.program_id,
            enrolled_at=datetime.now(timezone.utc),
            target_completion_date=target_completion_date,
            current_phase_id=current_phase_id,
            progress_percentage=0.0,
            status=EnrollmentStatus.ACTIVE,
            notes=enrollment_data.notes,
            next_recert_reset_at=next_recert_reset_at,
        )

        self.db.add(enrollment)
        await self.db.flush()

        # Create requirement progress tracking for all program requirements
        program_requirements = await self.get_program_requirements(
            program.id, organization_id
        )
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

        # Send enrollment notification
        try:
            await self._notify_enrollment(enrollment, program, user, organization_id)
        except Exception as e:
            logger.error(f"Failed to send enrollment notification: {e}")

        return enrollment, None

    async def get_enrollment_eligibility(
        self,
        program_id: UUID,
        organization_id: UUID,
    ) -> Optional[List[dict]]:
        """
        For every member of the org, decide whether they can be enrolled in this
        program right now, and if not, why. Mirrors the hard gates enforced by
        ``bulk_enroll_members`` so the enroll picker can surface eligibility up
        front instead of failing on submit:

          * ``enrolled``      — already actively enrolled in *this* program
          * ``prerequisite``  — hasn't completed a required prerequisite program
          * ``concurrent``    — active in another program and this one forbids
                                concurrent enrollment
          * ``eligible``      — none of the above

        The program's target position/roles are intentionally NOT gated here —
        they remain advisory. Returns None if the program doesn't exist.
        """
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return None

        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()
        user_id_strs = [str(u.id) for u in users]

        # Already actively enrolled in THIS program.
        enrolled_result = await self.db.execute(
            select(ProgramEnrollment.user_id).where(
                ProgramEnrollment.program_id == str(program_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )
        enrolled_ids = {str(row[0]) for row in enrolled_result.all()}

        # Missing prerequisites — per user, the specific programs not yet done.
        missing_prereqs: dict[str, List[str]] = {}
        if program.prerequisite_program_ids and user_id_strs:
            prereq_ids = [str(p) for p in program.prerequisite_program_ids]
            name_rows = await self.db.execute(
                select(TrainingProgram.id, TrainingProgram.name).where(
                    TrainingProgram.id.in_(prereq_ids),
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            prereq_names = {str(r[0]): r[1] for r in name_rows.all()}
            completed_result = await self.db.execute(
                select(ProgramEnrollment.user_id, ProgramEnrollment.program_id).where(
                    ProgramEnrollment.user_id.in_(user_id_strs),
                    ProgramEnrollment.program_id.in_(prereq_ids),
                    ProgramEnrollment.status == EnrollmentStatus.COMPLETED,
                )
            )
            completed_pairs = {(str(r[0]), str(r[1])) for r in completed_result.all()}
            for uid in user_id_strs:
                missing = [
                    prereq_names.get(pid, "a prerequisite program")
                    for pid in prereq_ids
                    if (uid, pid) not in completed_pairs
                ]
                if missing:
                    missing_prereqs[uid] = missing

        # Active in another program — a soft advisory, NOT a block. A member can
        # be in several programs at once (e.g. onboarding courses); we only note
        # it when this program prefers one-at-a-time so the officer has a
        # heads-up, and they can enroll anyway.
        concurrent_ids: set[str] = set()
        if not program.allows_concurrent_enrollment and user_id_strs:
            active_any_result = await self.db.execute(
                select(ProgramEnrollment.user_id)
                .join(TrainingProgram)
                .where(
                    ProgramEnrollment.user_id.in_(user_id_strs),
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            concurrent_ids = {str(row[0]) for row in active_any_result.all()}

        results: List[dict] = []
        for user in users:
            uid = str(user.id)
            # Hard gates first: already in this program, or missing a prereq.
            if uid in enrolled_ids:
                status, reason, eligible = (
                    "enrolled",
                    "Already enrolled in this program",
                    False,
                )
            elif uid in missing_prereqs:
                names = ", ".join(missing_prereqs[uid])
                status, reason, eligible = (
                    "prerequisite",
                    f"Must first complete: {names}",
                    False,
                )
            elif uid in concurrent_ids:
                # Advisory only — still eligible to enroll.
                status, reason, eligible = (
                    "concurrent",
                    "Also enrolled in another program",
                    True,
                )
            else:
                status, reason, eligible = "eligible", None, True
            results.append(
                {
                    "user_id": user.id,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "membership_number": user.membership_number,
                    "eligible": eligible,
                    "status": status,
                    "reason": reason,
                }
            )

        # Eligible first, then alphabetical — the order the picker wants.
        results.sort(
            key=lambda r: (
                not r["eligible"],
                (r["first_name"] or "").lower(),
                (r["last_name"] or "").lower(),
            )
        )
        return results

    async def get_member_enrollments(
        self,
        user_id: UUID,
        organization_id: UUID,
        status: Optional[str] = None,
    ) -> List[ProgramEnrollment]:
        """
        Get all program enrollments for a member
        """
        query = (
            select(ProgramEnrollment)
            .options(
                selectinload(ProgramEnrollment.program),
                selectinload(ProgramEnrollment.current_phase),
            )
            .join(TrainingProgram)
            .where(
                ProgramEnrollment.user_id == str(user_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )

        if status:
            query = query.where(ProgramEnrollment.status == status)

        result = await self.db.execute(
            query.order_by(ProgramEnrollment.enrolled_at.desc())
        )
        return result.scalars().all()

    async def get_program_enrollments(
        self,
        program_id: UUID,
        organization_id: UUID,
        status: Optional[str] = None,
    ) -> List[Tuple[ProgramEnrollment, User]]:
        """
        Get all enrollments for a program paired with the enrolled member.

        Powers the program detail view's Enrollments tab. Returning the User
        alongside each enrollment lets the API surface member names directly,
        so the UI doesn't render bare user_ids or make N follow-up lookups.
        """
        # Verify the program belongs to the organization
        program = await self.get_program_by_id(program_id, organization_id)
        if not program:
            return []

        query = (
            select(ProgramEnrollment, User)
            .join(User, ProgramEnrollment.user_id == User.id)
            .where(ProgramEnrollment.program_id == str(program_id))
        )

        if status:
            query = query.where(ProgramEnrollment.status == status)

        query = query.order_by(ProgramEnrollment.enrolled_at.desc())

        result = await self.db.execute(query)
        return list(result.all())

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
                selectinload(ProgramEnrollment.requirement_progress).selectinload(
                    RequirementProgress.requirement
                ),
            )
            .join(TrainingProgram)
            .where(
                ProgramEnrollment.id == str(enrollment_id),
                TrainingProgram.organization_id == str(organization_id),
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
        acting_user_id: Optional[UUID] = None,
        can_manage: bool = False,
    ) -> Tuple[Optional[RequirementProgress], Optional[str]]:
        """
        Update progress on a specific requirement

        Authorization: when ``acting_user_id`` is supplied (a member-initiated
        request), the member may only update progress on their own enrollment
        unless ``can_manage`` is True (training officers). System callers omit
        ``acting_user_id`` and are always permitted.

        Returns: (progress, error_message)
        """
        # Get progress with enrollment and program
        result = await self.db.execute(
            select(RequirementProgress)
            .options(
                selectinload(RequirementProgress.enrollment).selectinload(
                    ProgramEnrollment.program
                ),
                selectinload(RequirementProgress.requirement),
            )
            .join(ProgramEnrollment)
            .join(TrainingProgram)
            .where(
                RequirementProgress.id == str(progress_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        progress = result.scalar_one_or_none()

        if not progress:
            return None, "Requirement progress not found"

        # Authorization: a member may only update their own progress; editing
        # or verifying another member's requires training.manage. System
        # callers (acting_user_id is None) bypass this check.
        if (
            acting_user_id is not None
            and not can_manage
            and str(progress.enrollment.user_id) != str(acting_user_id)
        ):
            return None, "You are not authorized to update this training progress"

        # Update status
        if updates.status:
            try:
                status = RequirementProgressStatus(updates.status)
            except ValueError:
                return None, f"Invalid status: {updates.status}"

            progress.status = status

            if status == RequirementProgressStatus.NOT_STARTED:
                progress.progress_percentage = 0.0
                progress.completed_at = None
            elif status == RequirementProgressStatus.IN_PROGRESS:
                if not progress.started_at:
                    progress.started_at = datetime.now(timezone.utc)
                # Reverting from a completed/verified state — no longer done.
                progress.completed_at = None
            elif status in (
                RequirementProgressStatus.COMPLETED,
                RequirementProgressStatus.VERIFIED,
                RequirementProgressStatus.WAIVED,
            ):
                # Any satisfied state counts fully toward the enrollment rollup.
                # This is what lets non-numeric requirements (checklist, skills
                # evaluation, certification, knowledge test) advance progress
                # when an officer marks them done — previously only
                # hours/shifts/calls, which accrue a numeric progress_value,
                # ever moved progress_percentage off 0.
                progress.progress_percentage = 100.0
                progress.completed_at = datetime.now(timezone.utc)
                if verified_by:
                    progress.verified_by = verified_by
                    progress.verified_at = datetime.now(timezone.utc)

        # Knowledge/skills test score entry: an officer records a score and
        # pass/fail is derived from the requirement's passing_score (default 70).
        # The raw score + attempt history live in progress_notes; a pass completes
        # the requirement (which then rolls up and can advance the phase). This is
        # the lightweight groundwork for a fuller test-taking feature later.
        if updates.test_score is not None:
            requirement = progress.requirement

            # Enforce the attempt cap: once all attempts are used and the
            # requirement isn't already satisfied, no further scores are accepted.
            prior_attempts = len(
                (progress.progress_notes or {}).get("test_attempts", [])
            )
            already_done = progress.status in (
                RequirementProgressStatus.COMPLETED,
                RequirementProgressStatus.VERIFIED,
            )
            max_attempts = getattr(requirement, "max_attempts", None)
            if max_attempts and prior_attempts >= max_attempts and not already_done:
                return (
                    None,
                    f"Maximum attempts ({max_attempts}) reached for this test",
                )

            threshold = (
                requirement.passing_score
                if requirement is not None and requirement.passing_score is not None
                else 70.0
            )
            passed = updates.test_score >= threshold

            notes = copy.deepcopy(progress.progress_notes or {})
            attempts = notes.get("test_attempts", [])
            attempts.append(
                {
                    "score": updates.test_score,
                    "passed": passed,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                    "recorded_by": str(verified_by) if verified_by else None,
                }
            )
            notes["test_attempts"] = attempts
            notes["latest_score"] = updates.test_score
            notes["passing_score"] = threshold
            notes["passed"] = passed
            progress.progress_notes = notes

            if passed:
                progress.status = RequirementProgressStatus.COMPLETED
                progress.progress_percentage = 100.0
                progress.completed_at = datetime.now(timezone.utc)
                if verified_by:
                    progress.verified_by = verified_by
                    progress.verified_at = datetime.now(timezone.utc)
            else:
                # Failed attempt — recorded, but the requirement is not complete.
                if not progress.started_at:
                    progress.started_at = datetime.now(timezone.utc)
                if progress.status != RequirementProgressStatus.IN_PROGRESS:
                    progress.status = RequirementProgressStatus.IN_PROGRESS
                progress.completed_at = None

        # Update progress value
        if updates.progress_value is not None:
            progress.progress_value = updates.progress_value

            # Fetch waivers to adjust required values
            enrollment = progress.enrollment
            user_waivers = await fetch_user_waivers(
                self.db,
                str(enrollment.program.organization_id),
                str(enrollment.user_id),
            )

            # Determine evaluation window from enrollment period
            enroll_start = (
                enrollment.enrolled_at.date()
                if enrollment.enrolled_at
                else date.today()
            )
            enroll_end = enrollment.target_completion_date or date.today()

            # Calculate percentage based on requirement type (with waiver adjustment)
            requirement = progress.requirement
            if (
                requirement.requirement_type == RequirementType.HOURS
                and requirement.required_hours
            ):
                adj_required, _, _ = (
                    adjust_required(
                        requirement.required_hours,
                        enroll_start,
                        enroll_end,
                        user_waivers,
                        str(requirement.id),
                        period_months=get_rolling_period_months(requirement),
                    )
                    if user_waivers
                    else (requirement.required_hours, 0, 0)
                )
                progress.progress_percentage = min(
                    100.0, (updates.progress_value / adj_required) * 100
                )
            elif (
                requirement.requirement_type == RequirementType.SHIFTS
                and requirement.required_shifts
            ):
                adj_required, _, _ = (
                    adjust_required(
                        requirement.required_shifts,
                        enroll_start,
                        enroll_end,
                        user_waivers,
                        str(requirement.id),
                        period_months=get_rolling_period_months(requirement),
                    )
                    if user_waivers
                    else (requirement.required_shifts, 0, 0)
                )
                progress.progress_percentage = min(
                    100.0, (updates.progress_value / adj_required) * 100
                )
            elif (
                requirement.requirement_type == RequirementType.CALLS
                and requirement.required_calls
            ):
                adj_required, _, _ = (
                    adjust_required(
                        requirement.required_calls,
                        enroll_start,
                        enroll_end,
                        user_waivers,
                        str(requirement.id),
                        period_months=get_rolling_period_months(requirement),
                    )
                    if user_waivers
                    else (requirement.required_calls, 0, 0)
                )
                progress.progress_percentage = min(
                    100.0, (updates.progress_value / adj_required) * 100
                )
            elif (
                requirement.requirement_type == RequirementType.COURSES
                and requirement.required_courses
            ):
                # progress_value is the count of required courses completed;
                # percentage is that count over the number required. (Course-count
                # requirements are not waiver-adjusted.)
                total_required = len(requirement.required_courses)
                if total_required > 0:
                    progress.progress_percentage = min(
                        100.0, (updates.progress_value / total_required) * 100
                    )

            # Auto-complete if reached 100%
            if (
                progress.progress_percentage >= 100.0
                and progress.status != RequirementProgressStatus.COMPLETED
            ):
                progress.status = RequirementProgressStatus.COMPLETED
                progress.completed_at = datetime.now(timezone.utc)

        # Update notes
        if updates.progress_notes is not None:
            progress.progress_notes = updates.progress_notes

        # Update verification
        if verified_by:
            progress.verified_by = verified_by
            progress.verified_at = datetime.now(timezone.utc)

        progress.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(progress)

        # Recalculate enrollment progress
        await self._recalculate_enrollment_progress(progress.enrollment_id)

        # Auto-advance phases whose requirements are now complete (no-op for
        # non-phased programs and phases flagged for manual advancement)
        await self._maybe_auto_advance_phase(progress.enrollment_id)

        return progress, None

    @staticmethod
    def _clamp_day(year: int, month: int, day: int) -> date:
        """Build a date, clamping the day to the month's last valid day so a
        fixed anchor (e.g. day 30 or 31) never raises in a short month, and
        Feb 29 falls back to Feb 28 in a non-leap year."""
        import calendar

        last_day = calendar.monthrange(year, month)[1]
        return date(year, month, min(day, last_day))

    @classmethod
    def _add_months(cls, base: date, months: int) -> date:
        """Return `base` shifted forward by `months`, clamping the day."""
        total = (base.year * 12 + (base.month - 1)) + months
        year, month0 = divmod(total, 12)
        return cls._clamp_day(year, month0 + 1, base.day)

    @classmethod
    def _compute_next_recert_date(
        cls, program: TrainingProgram, base: date
    ) -> Optional[date]:
        """Next auto-reset date for an enrollment on this program, strictly
        after `base` (the enrollment date, or the last reset). Returns None when
        the program has no usable recert config.

        With a fixed anchor month/day the reset lands on that calendar date
        (e.g. NREMT's March 30) at the program's cadence; without one it rolls
        forward by the interval from `base`.
        """
        if not getattr(program, "recert_enabled", False):
            return None

        interval = program.recert_interval_months
        anchor_month = program.recert_anchor_month
        anchor_day = program.recert_anchor_day

        if anchor_month and anchor_day:
            # Number of whole years between resets (a 24-month cycle → every 2nd
            # anchor date). Defaults to yearly when no interval is set.
            interval_years = max(1, round((interval or 12) / 12))
            anchor = cls._clamp_day(base.year, anchor_month, anchor_day)
            if anchor <= base:
                anchor = cls._clamp_day(base.year + 1, anchor_month, anchor_day)
            if interval_years > 1:
                anchor = cls._clamp_day(
                    anchor.year + interval_years - 1, anchor_month, anchor_day
                )
            return anchor

        if interval:
            return cls._add_months(base, interval)
        return None

    @staticmethod
    def _blank_progress(row: RequirementProgress) -> None:
        """Zero a progress row back to a fresh, not-started state (for a new
        recert cycle) — clears the tally, the completion/verification stamps,
        and any recorded test attempts."""
        row.status = RequirementProgressStatus.NOT_STARTED
        row.progress_value = 0.0
        row.progress_percentage = 0.0
        row.progress_notes = None
        row.started_at = None
        row.completed_at = None
        row.verified_at = None
        row.verified_by = None
        row.verification_notes = None

    async def reset_requirement_progress(
        self,
        progress_id: UUID,
        organization_id: UUID,
    ) -> Tuple[Optional[RequirementProgress], Optional[str]]:
        """
        Reset a single member's progress on one requirement to not-started
        (start a new cycle). Recomputes the enrollment rollup afterward.
        Returns (progress, error_message).
        """
        result = await self.db.execute(
            select(RequirementProgress)
            .join(ProgramEnrollment)
            .join(TrainingProgram)
            .where(
                RequirementProgress.id == str(progress_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        progress = result.scalar_one_or_none()
        if not progress:
            return None, "Requirement progress not found"

        self._blank_progress(progress)
        await self.db.commit()

        enrollment_id = progress.enrollment_id
        await self._recalculate_enrollment_progress(UUID(str(enrollment_id)))
        await self.db.refresh(progress)
        return progress, None

    async def _get_program_for_enrollment(
        self, enrollment: ProgramEnrollment
    ) -> Optional[TrainingProgram]:
        """Load the parent program for an enrollment (for recert config)."""
        result = await self.db.execute(
            select(TrainingProgram).where(
                TrainingProgram.id == str(enrollment.program_id)
            )
        )
        return result.scalar_one_or_none()

    async def _perform_enrollment_reset(
        self,
        enrollment: ProgramEnrollment,
        program: Optional[TrainingProgram],
    ) -> None:
        """Core reset mutation shared by the manual and automatic paths: blank
        every requirement row, return the member to ACTIVE at the first phase,
        and — for recert-enabled programs — advance the recert deadline so the
        next cycle is scheduled. The caller owns the commit."""
        rows_result = await self.db.execute(
            select(RequirementProgress).where(
                RequirementProgress.enrollment_id == str(enrollment.id)
            )
        )
        for row in rows_result.scalars().all():
            self._blank_progress(row)

        # Re-anchor to the first phase for phased programs.
        first_phase_result = await self.db.execute(
            select(ProgramPhase.id)
            .where(ProgramPhase.program_id == str(enrollment.program_id))
            .order_by(ProgramPhase.phase_number)
            .limit(1)
        )
        first_phase_id = first_phase_result.scalar_one_or_none()

        enrollment.status = EnrollmentStatus.ACTIVE
        enrollment.progress_percentage = 0.0
        enrollment.completed_at = None
        enrollment.current_phase_id = first_phase_id

        # Schedule the next recert deadline (from today) so the cycle repeats.
        if program is not None and getattr(program, "recert_enabled", False):
            now = datetime.now(timezone.utc)
            enrollment.last_recert_reset_at = now
            enrollment.next_recert_reset_at = self._compute_next_recert_date(
                program, now.date()
            )

    async def reset_enrollment_progress(
        self,
        enrollment_id: UUID,
        organization_id: UUID,
    ) -> Tuple[Optional[ProgramEnrollment], Optional[str]]:
        """
        Start a fresh cycle for a whole enrollment: reset every requirement's
        progress, put the member back to ACTIVE at the first phase, and zero the
        overall percentage. Returns (enrollment, error_message).
        """
        result = await self.db.execute(
            select(ProgramEnrollment)
            .join(TrainingProgram)
            .where(
                ProgramEnrollment.id == str(enrollment_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        enrollment = result.scalar_one_or_none()
        if not enrollment:
            return None, "Enrollment not found"

        program = await self._get_program_for_enrollment(enrollment)
        await self._perform_enrollment_reset(enrollment, program)

        await self.db.commit()
        await self.db.refresh(enrollment)
        return enrollment, None

    async def auto_reset_if_due(self, enrollment: ProgramEnrollment) -> bool:
        """If this enrollment's recert deadline has passed, reset it in place for
        a new cycle. Returns True when a reset occurred. Safe to call on every
        progress load — a no-op when recert is disabled or the date is in the
        future."""
        reset_date = getattr(enrollment, "next_recert_reset_at", None)
        if not reset_date or reset_date > datetime.now(timezone.utc).date():
            return False

        program = await self._get_program_for_enrollment(enrollment)
        if not program or not getattr(program, "recert_enabled", False):
            return False

        await self._perform_enrollment_reset(enrollment, program)
        await self.db.commit()
        await self.db.refresh(enrollment)
        return True

    async def run_due_recert_resets(
        self, organization_id: UUID
    ) -> Tuple[int, Optional[str]]:
        """Auto-reset every enrollment in the organization whose recert deadline
        has passed. Intended for a scheduled sweep, but safe to call on demand.
        Returns (reset_count, error_message)."""
        today = datetime.now(timezone.utc).date()
        result = await self.db.execute(
            select(ProgramEnrollment)
            .join(TrainingProgram)
            .where(
                TrainingProgram.organization_id == str(organization_id),
                TrainingProgram.recert_enabled.is_(True),
                ProgramEnrollment.next_recert_reset_at.isnot(None),
                ProgramEnrollment.next_recert_reset_at <= today,
            )
        )
        enrollments = result.scalars().all()

        count = 0
        for enrollment in enrollments:
            program = await self._get_program_for_enrollment(enrollment)
            await self._perform_enrollment_reset(enrollment, program)
            count += 1

        if count:
            await self.db.commit()
        return count, None

    async def _recalculate_enrollment_progress(
        self,
        enrollment_id: UUID,
    ) -> None:
        """
        Recalculate overall progress percentage for an enrollment.
        Sends notifications on program completion.
        """
        # Get enrollment before update to detect state changes
        enrollment_result = await self.db.execute(
            select(ProgramEnrollment).where(ProgramEnrollment.id == str(enrollment_id))
        )
        enrollment = enrollment_result.scalar_one_or_none()
        if not enrollment:
            return

        was_completed = enrollment.status == EnrollmentStatus.COMPLETED

        # Get all requirement progress for this enrollment
        result = await self.db.execute(
            select(RequirementProgress)
            .join(ProgramRequirement)
            .where(
                RequirementProgress.enrollment_id == str(enrollment_id),
                ProgramRequirement.is_required == True,  # noqa: E712
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
                updated_at=datetime.now(timezone.utc),
            )
        )

        # Check if enrollment is complete
        if avg_percentage >= 100.0:
            await self.db.execute(
                update(ProgramEnrollment)
                .where(ProgramEnrollment.id == str(enrollment_id))
                .values(
                    status=EnrollmentStatus.COMPLETED,
                    completed_at=datetime.now(timezone.utc),
                )
            )
        elif was_completed:
            # Progress fell back below 100% for an enrollment that had already
            # completed — e.g. an officer corrected an over-count downward, or a
            # new required requirement was added to the program. Reopen it so it
            # doesn't stay marked complete without actually satisfying every
            # required item.
            await self.db.execute(
                update(ProgramEnrollment)
                .where(ProgramEnrollment.id == str(enrollment_id))
                .values(
                    status=EnrollmentStatus.ACTIVE,
                    completed_at=None,
                )
            )

        await self.db.commit()

        # Send completion notification if newly completed
        if avg_percentage >= 100.0 and not was_completed:
            try:
                # Re-fetch enrollment for notification
                await self.db.refresh(enrollment)
                program_result = await self.db.execute(
                    select(TrainingProgram).where(
                        TrainingProgram.id == str(enrollment.program_id)
                    )
                )
                program = program_result.scalar_one_or_none()
                user_result = await self.db.execute(
                    select(User).where(User.id == str(enrollment.user_id))
                )
                user = user_result.scalar_one_or_none()
                if program and user:
                    await self._notify_program_completion(
                        enrollment, program, user, UUID(str(program.organization_id))
                    )

                    # Auto-add as operator on matching apparatus when
                    # an EVOC training program completes
                    await self._handle_evoc_completion(program, enrollment)
            except Exception as e:
                logger.error(f"Failed to send program completion notification: {e}")

    # ==================== Phase Advancement Methods ====================

    async def _is_phase_complete(
        self,
        enrollment_id: UUID,
        phase_id: UUID,
    ) -> bool:
        """Whether every *required* requirement in a phase is satisfied for
        this enrollment. A phase with no required requirements is trivially
        complete (there is nothing gating advancement out of it)."""
        result = await self.db.execute(
            select(RequirementProgress)
            .join(ProgramRequirement)
            .where(
                RequirementProgress.enrollment_id == str(enrollment_id),
                ProgramRequirement.phase_id == str(phase_id),
                ProgramRequirement.is_required == True,  # noqa: E712
            )
        )
        rows = result.scalars().all()
        return all(p.progress_percentage >= 100.0 for p in rows)

    @staticmethod
    def _next_phase(
        phases: List[ProgramPhase],
        current_phase_id: Optional[str],
    ) -> Optional[ProgramPhase]:
        """The phase with the smallest phase_number greater than the current
        one, or the first phase when there is no current phase."""
        ordered = sorted(phases, key=lambda p: p.phase_number)
        if not ordered:
            return None
        if current_phase_id is None:
            return ordered[0]
        current = next((p for p in ordered if str(p.id) == str(current_phase_id)), None)
        if current is None:
            return ordered[0]
        for phase in ordered:
            if phase.phase_number > current.phase_number:
                return phase
        return None

    async def _notify_phase_for_enrollment(
        self,
        enrollment: ProgramEnrollment,
        program: TrainingProgram,
        new_phase_name: str,
    ) -> None:
        """Fetch the member and send the phase-advancement notification.
        Notification failures must never abort the advancement itself."""
        try:
            user_result = await self.db.execute(
                select(User).where(User.id == str(enrollment.user_id))
            )
            user = user_result.scalar_one_or_none()
            if user:
                await self._notify_phase_advancement(
                    enrollment,
                    program,
                    user,
                    new_phase_name,
                    UUID(str(program.organization_id)),
                )
        except Exception as e:
            logger.error(f"Failed to send phase advancement notification: {e}")

    async def advance_enrollment_phase(
        self,
        enrollment_id: UUID,
        organization_id: UUID,
        advanced_by: Optional[UUID] = None,
        force: bool = False,
    ) -> Tuple[Optional[ProgramEnrollment], Optional[str]]:
        """
        Manually advance an enrollment to the next phase (officer action).

        Requires the current phase's required requirements to be complete
        unless ``force`` is set. Returns: (enrollment, error_message)
        """
        enrollment = await self.get_enrollment_by_id(enrollment_id, organization_id)
        if not enrollment:
            return None, "Enrollment not found"

        program = await self.get_program_by_id(
            UUID(str(enrollment.program_id)), organization_id, include_phases=True
        )
        if not program:
            return None, "Training program not found"

        if program.structure_type != ProgramStructureType.PHASES:
            return None, "This program is not organized into phases"

        next_phase = self._next_phase(program.phases, enrollment.current_phase_id)
        if next_phase is None:
            return None, "Member is already at the final phase"

        if not force and enrollment.current_phase_id:
            complete = await self._is_phase_complete(
                enrollment_id, UUID(str(enrollment.current_phase_id))
            )
            if not complete:
                return (
                    None,
                    "The current phase's requirements are not yet complete",
                )

        await self.db.execute(
            update(ProgramEnrollment)
            .where(ProgramEnrollment.id == str(enrollment_id))
            .values(
                current_phase_id=next_phase.id,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self.db.commit()
        enrollment.current_phase_id = next_phase.id

        await self._notify_phase_for_enrollment(enrollment, program, next_phase.name)

        return enrollment, None

    async def _maybe_auto_advance_phase(
        self,
        enrollment_id: UUID,
    ) -> None:
        """Auto-advance an active enrollment through any consecutive phases
        whose required requirements are complete.

        Stops at a phase flagged ``requires_manual_advancement`` (an officer
        must advance out of it) or one that isn't complete. Safe to call after
        every progress update — it no-ops for non-phased programs and
        enrollments without a current phase.
        """
        enroll_result = await self.db.execute(
            select(ProgramEnrollment).where(ProgramEnrollment.id == str(enrollment_id))
        )
        enrollment = enroll_result.scalar_one_or_none()
        if not enrollment:
            return
        if not getattr(enrollment, "current_phase_id", None):
            return
        if getattr(enrollment, "status", None) != EnrollmentStatus.ACTIVE:
            return

        program_result = await self.db.execute(
            select(TrainingProgram)
            .options(selectinload(TrainingProgram.phases))
            .where(TrainingProgram.id == str(enrollment.program_id))
        )
        program = program_result.scalar_one_or_none()
        if not program or program.structure_type != ProgramStructureType.PHASES:
            return

        phases = list(program.phases)
        by_id = {str(p.id): p for p in phases}

        # Bound the loop by the phase count so a data anomaly can't spin forever.
        for _ in range(len(phases)):
            current = by_id.get(str(enrollment.current_phase_id))
            if current is None or current.requires_manual_advancement:
                return
            if not await self._is_phase_complete(enrollment_id, UUID(str(current.id))):
                return
            next_phase = self._next_phase(phases, enrollment.current_phase_id)
            if next_phase is None:
                return

            await self.db.execute(
                update(ProgramEnrollment)
                .where(ProgramEnrollment.id == str(enrollment_id))
                .values(
                    current_phase_id=next_phase.id,
                    updated_at=datetime.now(timezone.utc),
                )
            )
            await self.db.commit()
            enrollment.current_phase_id = next_phase.id
            await self._notify_phase_for_enrollment(
                enrollment, program, next_phase.name
            )

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
                selectinload(TrainingProgram.phases).selectinload(
                    ProgramPhase.requirements
                ),
                selectinload(TrainingProgram.phases).selectinload(
                    ProgramPhase.milestones
                ),
            )
            .where(TrainingProgram.id == str(source_program_id))
            .where(TrainingProgram.organization_id == str(organization_id))
        )
        source_program = source_result.scalar_one_or_none()

        if not source_program:
            return None, "Source program not found"

        # Calculate new version
        new_version = (
            source_program.version + 1 if increment_version else source_program.version
        )

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
            .where(
                ProgramRequirement.phase_id == None
            )  # noqa: E711 — SQLAlchemy IS NULL
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
            .where(ProgramMilestone.phase_id == None)  # noqa: E711 — SQLAlchemy IS NULL
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

    # ==================== Export / Import ====================

    async def export_program_to_json(
        self, program_id: UUID, organization_id: UUID
    ) -> dict:
        """Export a training program as a portable JSON structure.

        Includes all phases, milestones, and the full definition of each
        referenced TrainingRequirement so the program can be imported by
        another department without needing matching requirement IDs.
        """
        result = await self.db.execute(
            select(TrainingProgram)
            .options(
                selectinload(TrainingProgram.phases)
                .selectinload(ProgramPhase.requirements)
                .selectinload(ProgramRequirement.requirement),
                selectinload(TrainingProgram.phases).selectinload(
                    ProgramPhase.milestones
                ),
            )
            .where(
                TrainingProgram.id == str(program_id),
                TrainingProgram.organization_id == str(organization_id),
            )
        )
        program = result.scalar_one_or_none()
        if not program:
            raise ValueError("Program not found")

        # Serialize phases
        phases = []
        for phase in sorted(program.phases, key=lambda p: p.phase_number):
            phase_reqs = []
            for pr in sorted(phase.requirements, key=lambda r: r.sort_order):
                req = pr.requirement
                phase_reqs.append(
                    {
                        "is_required": pr.is_required,
                        "is_prerequisite": pr.is_prerequisite,
                        "sort_order": pr.sort_order,
                        "program_specific_description": pr.program_specific_description,
                        "custom_deadline_days": pr.custom_deadline_days,
                        "notification_message": pr.notification_message,
                        "requirement": (
                            self._serialize_requirement(req) if req else None
                        ),
                    }
                )
            phase_milestones = []
            for ms in sorted(phase.milestones, key=lambda m: m.created_at or ""):
                phase_milestones.append(
                    {
                        "name": ms.name,
                        "description": ms.description,
                        "completion_percentage_threshold": ms.completion_percentage_threshold,
                        "notification_message": ms.notification_message,
                        "requires_verification": ms.requires_verification,
                        "verification_notes": ms.verification_notes,
                    }
                )
            phases.append(
                {
                    "phase_number": phase.phase_number,
                    "name": phase.name,
                    "description": phase.description,
                    "requires_manual_advancement": phase.requires_manual_advancement,
                    "time_limit_days": phase.time_limit_days,
                    "requirements": phase_reqs,
                    "milestones": phase_milestones,
                }
            )

        # Program-level requirements (no phase)
        prog_reqs_result = await self.db.execute(
            select(ProgramRequirement)
            .options(selectinload(ProgramRequirement.requirement))
            .where(
                ProgramRequirement.program_id == str(program_id),
                ProgramRequirement.phase_id.is_(None),
            )
        )
        program_reqs = []
        for pr in prog_reqs_result.scalars().all():
            req = pr.requirement
            program_reqs.append(
                {
                    "is_required": pr.is_required,
                    "is_prerequisite": pr.is_prerequisite,
                    "sort_order": pr.sort_order,
                    "program_specific_description": pr.program_specific_description,
                    "custom_deadline_days": pr.custom_deadline_days,
                    "notification_message": pr.notification_message,
                    "requirement": self._serialize_requirement(req) if req else None,
                }
            )

        # Program-level milestones
        prog_ms_result = await self.db.execute(
            select(ProgramMilestone).where(
                ProgramMilestone.program_id == str(program_id),
                ProgramMilestone.phase_id.is_(None),
            )
        )
        program_milestones = []
        for ms in prog_ms_result.scalars().all():
            program_milestones.append(
                {
                    "name": ms.name,
                    "description": ms.description,
                    "completion_percentage_threshold": ms.completion_percentage_threshold,
                    "notification_message": ms.notification_message,
                    "requires_verification": ms.requires_verification,
                    "verification_notes": ms.verification_notes,
                }
            )

        return {
            "export_version": "1.0",
            "program": {
                "name": program.name,
                "description": program.description,
                "code": program.code,
                "version": program.version,
                "target_position": program.target_position,
                "target_roles": program.target_roles,
                "structure_type": (
                    program.structure_type.value
                    if hasattr(program.structure_type, "value")
                    else str(program.structure_type)
                ),
                "allows_concurrent_enrollment": program.allows_concurrent_enrollment,
                "time_limit_days": program.time_limit_days,
                "warning_days_before": program.warning_days_before,
                "reminder_conditions": program.reminder_conditions,
            },
            "phases": phases,
            "program_requirements": program_reqs,
            "program_milestones": program_milestones,
        }

    @staticmethod
    def _serialize_requirement(req: "TrainingRequirement") -> dict:
        """Serialize a TrainingRequirement for portable JSON export."""
        return {
            "name": req.name,
            "description": req.description,
            "requirement_type": (
                req.requirement_type.value
                if hasattr(req.requirement_type, "value")
                else str(req.requirement_type)
            ),
            "training_type": (
                (
                    req.training_type.value
                    if hasattr(req.training_type, "value")
                    else req.training_type
                )
                if req.training_type
                else None
            ),
            "source": (
                req.source.value if hasattr(req.source, "value") else str(req.source)
            ),
            "registry_name": req.registry_name,
            "registry_code": req.registry_code,
            "required_hours": req.required_hours,
            "frequency": (
                req.frequency.value
                if hasattr(req.frequency, "value")
                else str(req.frequency)
            ),
            "time_limit_days": req.time_limit_days,
            "applies_to_all": req.applies_to_all,
            "required_positions": req.required_positions,
            "required_roles": req.required_roles,
            "category_ids": req.category_ids,
            "passing_score": req.passing_score,
            "max_attempts": req.max_attempts,
        }

    async def import_program_from_json(
        self,
        data: dict,
        organization_id: UUID,
        created_by: UUID,
    ) -> TrainingProgram:
        """Import a training program from a portable JSON export.

        Creates the program, phases, milestones, and any referenced
        requirements that don't already exist (matched by name + source).
        """
        prog_data = data.get("program", {})

        # Uploaded JSON — validate the enum-backed field before it reaches
        # the DB enum column (invalid values crash at flush as a 500).
        try:
            structure_type = ProgramStructureType(
                str(prog_data.get("structure_type", "flexible")).strip().lower()
            )
        except ValueError:
            raise ValueError(
                f"Invalid structure_type '{prog_data.get('structure_type')}' "
                "in imported program"
            )

        program = TrainingProgram(
            organization_id=organization_id,
            name=prog_data.get("name", "Imported Program"),
            description=prog_data.get("description"),
            code=prog_data.get("code"),
            version=prog_data.get("version", 1),
            target_position=prog_data.get("target_position"),
            target_roles=prog_data.get("target_roles"),
            structure_type=structure_type,
            allows_concurrent_enrollment=prog_data.get(
                "allows_concurrent_enrollment", True
            ),
            time_limit_days=prog_data.get("time_limit_days"),
            warning_days_before=prog_data.get("warning_days_before"),
            reminder_conditions=prog_data.get("reminder_conditions"),
            active=True,
            is_template=False,
            created_by=created_by,
        )
        self.db.add(program)
        await self.db.flush()

        # Import phases
        for phase_data in data.get("phases", []):
            phase = ProgramPhase(
                program_id=program.id,
                phase_number=phase_data.get("phase_number", 0),
                name=phase_data.get("name", ""),
                description=phase_data.get("description"),
                requires_manual_advancement=phase_data.get(
                    "requires_manual_advancement", False
                ),
                time_limit_days=phase_data.get("time_limit_days"),
            )
            self.db.add(phase)
            await self.db.flush()

            for req_data in phase_data.get("requirements", []):
                req_id = await self._resolve_or_create_requirement(
                    req_data.get("requirement", {}),
                    organization_id,
                    created_by,
                )
                if req_id:
                    self.db.add(
                        ProgramRequirement(
                            program_id=program.id,
                            phase_id=phase.id,
                            requirement_id=req_id,
                            is_required=req_data.get("is_required", True),
                            is_prerequisite=req_data.get("is_prerequisite", False),
                            sort_order=req_data.get("sort_order", 0),
                            program_specific_description=req_data.get(
                                "program_specific_description"
                            ),
                            custom_deadline_days=req_data.get("custom_deadline_days"),
                            notification_message=req_data.get("notification_message"),
                        )
                    )

            for ms_data in phase_data.get("milestones", []):
                self.db.add(
                    ProgramMilestone(
                        program_id=program.id,
                        phase_id=phase.id,
                        name=ms_data.get("name", ""),
                        description=ms_data.get("description"),
                        completion_percentage_threshold=ms_data.get(
                            "completion_percentage_threshold"
                        ),
                        notification_message=ms_data.get("notification_message"),
                        requires_verification=ms_data.get(
                            "requires_verification", False
                        ),
                        verification_notes=ms_data.get("verification_notes"),
                    )
                )

        # Program-level requirements
        for req_data in data.get("program_requirements", []):
            req_id = await self._resolve_or_create_requirement(
                req_data.get("requirement", {}),
                organization_id,
                created_by,
            )
            if req_id:
                self.db.add(
                    ProgramRequirement(
                        program_id=program.id,
                        phase_id=None,
                        requirement_id=req_id,
                        is_required=req_data.get("is_required", True),
                        is_prerequisite=req_data.get("is_prerequisite", False),
                        sort_order=req_data.get("sort_order", 0),
                        program_specific_description=req_data.get(
                            "program_specific_description"
                        ),
                        custom_deadline_days=req_data.get("custom_deadline_days"),
                        notification_message=req_data.get("notification_message"),
                    )
                )

        # Program-level milestones
        for ms_data in data.get("program_milestones", []):
            self.db.add(
                ProgramMilestone(
                    program_id=program.id,
                    phase_id=None,
                    name=ms_data.get("name", ""),
                    description=ms_data.get("description"),
                    completion_percentage_threshold=ms_data.get(
                        "completion_percentage_threshold"
                    ),
                    notification_message=ms_data.get("notification_message"),
                    requires_verification=ms_data.get("requires_verification", False),
                    verification_notes=ms_data.get("verification_notes"),
                )
            )

        await self.db.commit()
        await self.db.refresh(program)
        return program

    async def _resolve_or_create_requirement(
        self,
        req_data: dict,
        organization_id: UUID,
        created_by: UUID,
    ) -> str | None:
        """Find an existing requirement by name+source, or create it."""
        if not req_data or not req_data.get("name"):
            return None

        name = req_data["name"]

        # req_data comes from an uploaded JSON file, so enum-backed fields
        # must be validated here — an invalid value would otherwise be
        # written to (or crash on) the DB enum columns.
        def _coerce_enum(raw: Any, enum_cls: type, field: str, default: Any = None):
            if raw is None:
                return default
            try:
                return enum_cls(str(raw).strip().lower())
            except ValueError:
                raise ValueError(
                    f"Invalid {field} '{raw}' in imported requirement '{name}'"
                )

        source = _coerce_enum(
            req_data.get("source"),
            RequirementSource,
            "source",
            RequirementSource.DEPARTMENT,
        )
        requirement_type = _coerce_enum(
            req_data.get("requirement_type"),
            RequirementType,
            "requirement_type",
            RequirementType.HOURS,
        )
        training_type = _coerce_enum(
            req_data.get("training_type"), TrainingType, "training_type"
        )
        frequency = _coerce_enum(
            req_data.get("frequency"),
            RequirementFrequency,
            "frequency",
            RequirementFrequency.ANNUAL,
        )

        existing = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == str(organization_id),
                TrainingRequirement.name == name,
                TrainingRequirement.source == source,
            )
        )
        found = existing.scalar_one_or_none()
        if found:
            return found.id

        req = TrainingRequirement(
            organization_id=organization_id,
            name=name,
            description=req_data.get("description"),
            requirement_type=requirement_type,
            training_type=training_type,
            source=source,
            registry_name=req_data.get("registry_name"),
            registry_code=req_data.get("registry_code"),
            required_hours=req_data.get("required_hours"),
            frequency=frequency,
            time_limit_days=req_data.get("time_limit_days"),
            applies_to_all=req_data.get("applies_to_all", False),
            required_positions=req_data.get("required_positions"),
            required_roles=req_data.get("required_roles"),
            category_ids=req_data.get("category_ids"),
            passing_score=req_data.get("passing_score"),
            max_attempts=req_data.get("max_attempts"),
            is_editable=True,
            created_by=created_by,
        )
        self.db.add(req)
        await self.db.flush()
        return req.id

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
        program = await self.get_program_by_id(
            program_id, organization_id, include_phases=True
        )
        if not program:
            return [], ["Training program not found"]

        # Batch-fetch user names for error messages (single query)
        user_id_strs = [str(uid) for uid in user_ids]
        users_result = await self.db.execute(
            select(User).where(User.id.in_(user_id_strs))
        )
        user_map = {str(u.id): u for u in users_result.scalars().all()}

        def _user_name(uid: UUID) -> str:
            u = user_map.get(str(uid))
            return f"{u.first_name} {u.last_name}" if u else str(uid)

        # Track which users failed a gate keyed by UUID, so the enrollment loop
        # below can reliably skip them. (Error strings are name-based for the
        # UI, so matching the raw user_id against them would never hit — that
        # bug previously let members who failed prerequisite/concurrency checks
        # get enrolled anyway.)
        blocked_user_ids: set[str] = set()

        # Check for prerequisite programs (batch query instead of O(U*P) queries)
        prerequisite_errors = []
        if program.prerequisite_program_ids:
            prereq_uuids = [UUID(pid) for pid in program.prerequisite_program_ids]
            # Single query: fetch all completed prerequisite enrollments for these users
            completed_prereqs_result = await self.db.execute(
                select(ProgramEnrollment.user_id, TrainingProgram.id)
                .join(TrainingProgram)
                .where(
                    ProgramEnrollment.user_id.in_(user_id_strs),
                    TrainingProgram.id.in_([str(p) for p in prereq_uuids]),
                    TrainingProgram.organization_id == str(organization_id),
                    ProgramEnrollment.status == EnrollmentStatus.COMPLETED,
                )
            )
            # Build a set of (user_id, program_id) pairs that are completed
            completed_pairs = {
                (str(row[0]), str(row[1])) for row in completed_prereqs_result.all()
            }

            for uid in user_ids:
                for prereq_id in program.prerequisite_program_ids:
                    if (str(uid), prereq_id) not in completed_pairs:
                        prerequisite_errors.append(
                            f"{_user_name(uid)} has not completed prerequisite program"
                        )
                        blocked_user_ids.add(str(uid))
                        break  # One missing prereq is enough

        # Concurrent enrollment is a soft advisory, not a block — a member can be
        # in several programs at once (onboarding courses, etc.). The picker
        # surfaces it; enrollment is never prevented on that basis. (A duplicate
        # active enrollment in *this same* program is still rejected by
        # enroll_member below.)

        enrollments = []
        errors = prerequisite_errors.copy()

        for user_id in user_ids:
            # Skip users blocked by a prerequisite/concurrency gate above
            if str(user_id) in blocked_user_ids:
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

    async def preview_registry_requirements(
        self,
        registry_file_path: str,
        organization_id: UUID,
    ) -> Tuple[Optional[List[dict]], Optional[str]]:
        """
        List a registry's requirements for the "pick and choose" import UI, each
        flagged with whether the org has already imported it (by registry_name +
        registry_code). Returns (items, error_message).
        """
        file_path = Path(registry_file_path)
        if not file_path.exists():
            return None, f"Registry file not found: {registry_file_path}"

        def _read_json(path: Path) -> Any:
            with open(path, "r") as f:
                return json.load(f)

        try:
            registry_data = await asyncio.to_thread(_read_json, file_path)
        except json.JSONDecodeError as e:
            return None, f"Invalid JSON in registry file: {str(e)}"

        registry_name = registry_data.get("registry_name")
        requirements_data = registry_data.get("requirements", [])
        topic_names = {
            ta.get("code"): ta.get("name")
            for ta in registry_data.get("nccr_topic_areas", [])
            if ta.get("code")
        }

        # Which of this registry's codes the org already holds (one query).
        existing_result = await self.db.execute(
            select(TrainingRequirement.registry_code).where(
                TrainingRequirement.organization_id == str(organization_id),
                TrainingRequirement.registry_name == registry_name,
            )
        )
        existing_codes = {row[0] for row in existing_result.all() if row[0]}

        items: List[dict] = []
        for req in requirements_data:
            code = req.get("registry_code")
            sections = [
                topic_names.get(d.get("registry_code"), d.get("registry_code"))
                for d in (req.get("category_hour_distributions") or [])
                if d.get("registry_code")
            ]
            items.append(
                {
                    "registry_code": code,
                    "name": req.get("name"),
                    "description": req.get("description"),
                    "requirement_type": req.get("requirement_type", "hours"),
                    "required_hours": req.get("required_hours"),
                    "frequency": req.get("frequency"),
                    "already_imported": bool(code and code in existing_codes),
                    "sections": sections,
                }
            )
        return items, None

    async def import_registry_requirements(
        self,
        registry_file_path: str,
        organization_id: UUID,
        created_by: UUID,
        skip_existing: bool = True,
        selected_codes: Optional[List[str]] = None,
    ) -> Tuple[int, int, List[str], Optional[str], Optional[str]]:
        """
        Import requirements from a registry JSON file.

        When ``selected_codes`` is provided, only requirements whose
        ``registry_code`` is in that list are imported (the "pick and choose"
        path); when it is None, the whole registry is imported.

        Returns:
            (imported_count, categories_created, errors, last_updated, source_url)
        """
        file_path = Path(registry_file_path)
        if not file_path.exists():
            return (
                0,
                0,
                [f"Registry file not found: {registry_file_path}"],
                None,
                None,
            )

        def _read_json(path: Path) -> Any:
            with open(path, "r") as f:
                return json.load(f)

        try:
            registry_data = await asyncio.to_thread(_read_json, file_path)
        except json.JSONDecodeError as e:
            return 0, 0, [f"Invalid JSON in registry file: {str(e)}"], None, None

        registry_name = registry_data.get("registry_name")
        last_updated = registry_data.get("last_updated")
        source_url = registry_data.get("source_url")
        requirements_data = registry_data.get("requirements", [])

        # Topic-area (section) names keyed by their registry_code, e.g.
        # "NCCR-AIRWAY" -> "Airway, Respiration & Ventilation". Used to name any
        # section categories we auto-create so imported requirements actually
        # link to something the org can tag courses/sessions with.
        topic_names = {
            ta.get("code"): ta.get("name")
            for ta in registry_data.get("nccr_topic_areas", [])
            if ta.get("code")
        }
        # Cache of ensured section categories: registry_code -> category id.
        ensured_categories: dict = {}
        categories_created = 0

        selected = set(selected_codes) if selected_codes is not None else None

        imported_count = 0
        errors = []

        for req_data in requirements_data:
            # Selective import: skip anything the caller didn't pick.
            if selected is not None and req_data.get("registry_code") not in selected:
                continue

            # Check if requirement already exists
            if skip_existing and req_data.get("registry_code"):
                existing = await self.db.execute(
                    select(TrainingRequirement).where(
                        TrainingRequirement.organization_id == str(organization_id),
                        TrainingRequirement.registry_name == registry_name,
                        TrainingRequirement.registry_code
                        == req_data.get("registry_code"),
                    )
                )
                if existing.scalar_one_or_none():
                    continue

            try:
                # Resolve category_ids from category_hour_distributions by
                # matching registry_code on TrainingCategory. Auto-create the
                # section category if the org doesn't have it yet, so the
                # requirement links to real categories (courses/sessions tagged
                # with a section then count toward it).
                category_ids = None
                distributions = req_data.get("category_hour_distributions")
                if distributions:
                    resolved_ids = []
                    for dist in distributions:
                        rc = dist.get("registry_code")
                        if not rc:
                            continue
                        if rc in ensured_categories:
                            resolved_ids.append(ensured_categories[rc])
                            continue
                        cat_result = await self.db.execute(
                            select(TrainingCategory).where(
                                TrainingCategory.organization_id
                                == str(organization_id),
                                TrainingCategory.registry_code == rc,
                                TrainingCategory.active.is_(True),
                            )
                        )
                        cat = cat_result.scalar_one_or_none()
                        if not cat:
                            cat = TrainingCategory(
                                organization_id=organization_id,
                                name=topic_names.get(rc, rc),
                                registry_code=rc,
                                created_by=created_by,
                                active=True,
                            )
                            self.db.add(cat)
                            await self.db.flush()
                            categories_created += 1
                        ensured_categories[rc] = cat.id
                        resolved_ids.append(cat.id)
                    if resolved_ids:
                        category_ids = resolved_ids

                # Create requirement from registry data
                requirement = TrainingRequirement(
                    organization_id=organization_id,
                    name=req_data.get("name"),
                    description=req_data.get("description"),
                    requirement_type=RequirementType(
                        req_data.get("requirement_type", "hours")
                    ),
                    source=RequirementSource.NATIONAL,
                    registry_name=registry_name,
                    registry_code=req_data.get("registry_code"),
                    is_editable=req_data.get("is_editable", True),
                    training_type=req_data.get("training_type"),
                    required_hours=req_data.get("required_hours"),
                    required_courses=req_data.get("required_courses"),
                    required_shifts=req_data.get("required_shifts"),
                    required_calls=req_data.get("required_calls"),
                    required_call_types=req_data.get("required_call_types"),
                    required_skills=req_data.get("required_skills"),
                    checklist_items=req_data.get("checklist_items"),
                    category_ids=category_ids,
                    frequency=req_data.get("frequency", "annual"),
                    time_limit_days=req_data.get("time_limit_days"),
                    applies_to_all=req_data.get("applies_to_all", False),
                    required_positions=req_data.get("required_positions"),
                    required_roles=req_data.get("required_roles"),
                    created_by=created_by,
                )
                self.db.add(requirement)
                imported_count += 1

            except Exception as e:
                errors.append(
                    f"Error importing {req_data.get('name', 'unknown')}: {str(e)}"
                )

        await self.db.commit()
        return imported_count, categories_created, errors, last_updated, source_url
