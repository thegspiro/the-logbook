"""
Membership Pipeline Service

Business logic for prospective member pipeline management including
pipeline configuration, prospect tracking, step progression, and
transfer to full membership.
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update, delete
from sqlalchemy.orm import selectinload
from uuid import UUID, uuid4
import secrets
import string

from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStepProgress,
    ProspectActivityLog,
    ProspectStatus,
    StepProgressStatus,
    PipelineStepType,
)
from app.models.user import User, generate_uuid


class MembershipPipelineService:
    """Service for membership pipeline management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Pipeline CRUD
    # =========================================================================

    async def list_pipelines(
        self, organization_id: str, include_templates: bool = True
    ) -> List[MembershipPipeline]:
        """List all pipelines for an organization"""
        query = (
            select(MembershipPipeline)
            .where(MembershipPipeline.organization_id == organization_id)
            .options(selectinload(MembershipPipeline.steps))
            .order_by(MembershipPipeline.is_default.desc(), MembershipPipeline.created_at)
        )
        if not include_templates:
            query = query.where(MembershipPipeline.is_template == False)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_pipeline(self, pipeline_id: str, organization_id: str) -> Optional[MembershipPipeline]:
        """Get a single pipeline by ID"""
        query = (
            select(MembershipPipeline)
            .where(
                and_(
                    MembershipPipeline.id == pipeline_id,
                    MembershipPipeline.organization_id == organization_id,
                )
            )
            .options(selectinload(MembershipPipeline.steps))
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create_pipeline(
        self,
        organization_id: str,
        name: str,
        description: Optional[str] = None,
        is_template: bool = False,
        is_default: bool = False,
        auto_transfer_on_approval: bool = False,
        steps: Optional[List[Dict[str, Any]]] = None,
        created_by: Optional[str] = None,
    ) -> MembershipPipeline:
        """Create a new pipeline with optional initial steps"""
        # If setting as default, unset other defaults first
        if is_default:
            await self._unset_default_pipeline(organization_id)

        pipeline = MembershipPipeline(
            id=generate_uuid(),
            organization_id=organization_id,
            name=name,
            description=description,
            is_template=is_template,
            is_default=is_default,
            auto_transfer_on_approval=auto_transfer_on_approval,
            created_by=created_by,
        )
        self.db.add(pipeline)
        await self.db.flush()

        if steps:
            for i, step_data in enumerate(steps):
                step = MembershipPipelineStep(
                    id=generate_uuid(),
                    pipeline_id=pipeline.id,
                    name=step_data["name"],
                    description=step_data.get("description"),
                    step_type=step_data.get("step_type", "checkbox"),
                    action_type=step_data.get("action_type"),
                    is_first_step=step_data.get("is_first_step", i == 0),
                    is_final_step=step_data.get("is_final_step", False),
                    sort_order=step_data.get("sort_order", i),
                    email_template_id=step_data.get("email_template_id"),
                    required=step_data.get("required", True),
                )
                self.db.add(step)

        await self.db.commit()
        return await self.get_pipeline(pipeline.id, organization_id)

    async def update_pipeline(
        self, pipeline_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[MembershipPipeline]:
        """Update a pipeline's properties"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        if data.get("is_default") and not pipeline.is_default:
            await self._unset_default_pipeline(organization_id)

        for key, value in data.items():
            if value is not None and hasattr(pipeline, key):
                setattr(pipeline, key, value)

        await self.db.commit()
        return await self.get_pipeline(pipeline_id, organization_id)

    async def delete_pipeline(self, pipeline_id: str, organization_id: str) -> bool:
        """Delete a pipeline (cascades to steps, but not prospects — they become unassigned)"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        await self.db.delete(pipeline)
        await self.db.commit()
        return True

    async def duplicate_pipeline(
        self, pipeline_id: str, organization_id: str, new_name: str, created_by: Optional[str] = None
    ) -> Optional[MembershipPipeline]:
        """Duplicate a pipeline (useful for creating from templates)"""
        source = await self.get_pipeline(pipeline_id, organization_id)
        if not source:
            return None

        steps = [
            {
                "name": step.name,
                "description": step.description,
                "step_type": step.step_type.value if isinstance(step.step_type, PipelineStepType) else step.step_type,
                "action_type": step.action_type.value if step.action_type and hasattr(step.action_type, 'value') else step.action_type,
                "is_first_step": step.is_first_step,
                "is_final_step": step.is_final_step,
                "sort_order": step.sort_order,
                "email_template_id": step.email_template_id,
                "required": step.required,
            }
            for step in source.steps
        ]

        return await self.create_pipeline(
            organization_id=organization_id,
            name=new_name,
            description=source.description,
            is_template=False,
            is_default=False,
            auto_transfer_on_approval=source.auto_transfer_on_approval,
            steps=steps,
            created_by=created_by,
        )

    async def _unset_default_pipeline(self, organization_id: str):
        """Unset the current default pipeline for an organization"""
        await self.db.execute(
            update(MembershipPipeline)
            .where(
                and_(
                    MembershipPipeline.organization_id == organization_id,
                    MembershipPipeline.is_default == True,
                )
            )
            .values(is_default=False)
        )

    # =========================================================================
    # Step CRUD
    # =========================================================================

    async def add_step(
        self, pipeline_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[MembershipPipelineStep]:
        """Add a step to a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # Determine sort_order if not provided
        if "sort_order" not in data or data["sort_order"] is None:
            max_order = max((s.sort_order for s in pipeline.steps), default=-1)
            data["sort_order"] = max_order + 1

        step = MembershipPipelineStep(
            id=generate_uuid(),
            pipeline_id=pipeline_id,
            name=data["name"],
            description=data.get("description"),
            step_type=data.get("step_type", "checkbox"),
            action_type=data.get("action_type"),
            is_first_step=data.get("is_first_step", False),
            is_final_step=data.get("is_final_step", False),
            sort_order=data["sort_order"],
            email_template_id=data.get("email_template_id"),
            required=data.get("required", True),
        )
        self.db.add(step)
        await self.db.commit()
        await self.db.refresh(step)
        return step

    async def update_step(
        self, step_id: str, pipeline_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[MembershipPipelineStep]:
        """Update a pipeline step"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        step = next((s for s in pipeline.steps if s.id == step_id), None)
        if not step:
            return None

        for key, value in data.items():
            if value is not None and hasattr(step, key):
                setattr(step, key, value)

        await self.db.commit()
        await self.db.refresh(step)
        return step

    async def delete_step(self, step_id: str, pipeline_id: str, organization_id: str) -> bool:
        """Remove a step from a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        step = next((s for s in pipeline.steps if s.id == step_id), None)
        if not step:
            return False

        await self.db.delete(step)
        await self.db.commit()
        return True

    async def reorder_steps(
        self, pipeline_id: str, organization_id: str, step_ids: List[str]
    ) -> Optional[List[MembershipPipelineStep]]:
        """Reorder steps in a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        step_map = {s.id: s for s in pipeline.steps}
        for i, step_id in enumerate(step_ids):
            if step_id in step_map:
                step_map[step_id].sort_order = i

        await self.db.commit()
        return sorted(pipeline.steps, key=lambda s: s.sort_order)

    # =========================================================================
    # Prospect CRUD
    # =========================================================================

    async def list_prospects(
        self,
        organization_id: str,
        pipeline_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[List[ProspectiveMember], int]:
        """List prospects with filters"""
        query = (
            select(ProspectiveMember)
            .where(ProspectiveMember.organization_id == organization_id)
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline),
            )
        )

        if pipeline_id:
            query = query.where(ProspectiveMember.pipeline_id == pipeline_id)
        if status:
            query = query.where(ProspectiveMember.status == status)
        if search:
            search_term = f"%{search}%"
            query = query.where(
                ProspectiveMember.first_name.ilike(search_term)
                | ProspectiveMember.last_name.ilike(search_term)
                | ProspectiveMember.email.ilike(search_term)
            )

        # Count query
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Data query
        query = query.order_by(ProspectiveMember.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(query)
        prospects = list(result.scalars().all())

        return prospects, total

    async def get_prospect(self, prospect_id: str, organization_id: str) -> Optional[ProspectiveMember]:
        """Get a single prospect with full details"""
        query = (
            select(ProspectiveMember)
            .where(
                and_(
                    ProspectiveMember.id == prospect_id,
                    ProspectiveMember.organization_id == organization_id,
                )
            )
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline).selectinload(MembershipPipeline.steps),
                selectinload(ProspectiveMember.step_progress).selectinload(ProspectStepProgress.step),
            )
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create_prospect(
        self,
        organization_id: str,
        data: Dict[str, Any],
        created_by: Optional[str] = None,
    ) -> ProspectiveMember:
        """Create a new prospective member"""
        pipeline_id = data.get("pipeline_id")

        # Use org default pipeline if none specified
        if not pipeline_id:
            default_pipeline = await self._get_default_pipeline(organization_id)
            if default_pipeline:
                pipeline_id = default_pipeline.id

        # Get first step of the pipeline
        first_step_id = None
        if pipeline_id:
            first_step_id = await self._get_first_step_id(pipeline_id)

        prospect = ProspectiveMember(
            id=generate_uuid(),
            organization_id=organization_id,
            pipeline_id=pipeline_id,
            first_name=data["first_name"],
            last_name=data["last_name"],
            email=data["email"],
            phone=data.get("phone"),
            mobile=data.get("mobile"),
            date_of_birth=data.get("date_of_birth"),
            address_street=data.get("address_street"),
            address_city=data.get("address_city"),
            address_state=data.get("address_state"),
            address_zip=data.get("address_zip"),
            interest_reason=data.get("interest_reason"),
            referral_source=data.get("referral_source"),
            referred_by=data.get("referred_by"),
            current_step_id=first_step_id,
            status=ProspectStatus.ACTIVE,
            metadata_=data.get("metadata_", {}),
            form_submission_id=data.get("form_submission_id"),
            notes=data.get("notes"),
        )
        self.db.add(prospect)
        await self.db.flush()

        # Initialize step progress records for all steps in the pipeline
        if pipeline_id:
            await self._initialize_step_progress(prospect.id, pipeline_id, first_step_id)

        # Log the creation
        await self._log_activity(
            prospect_id=prospect.id,
            action="prospect_created",
            details={"source": "manual" if not data.get("form_submission_id") else "form_submission"},
            performed_by=created_by,
        )

        await self.db.commit()
        return await self.get_prospect(prospect.id, organization_id)

    async def update_prospect(
        self, prospect_id: str, organization_id: str, data: Dict[str, Any], updated_by: Optional[str] = None
    ) -> Optional[ProspectiveMember]:
        """Update a prospect's information"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        changes = {}
        for key, value in data.items():
            if value is not None and hasattr(prospect, key):
                old_value = getattr(prospect, key)
                if old_value != value:
                    changes[key] = {"from": str(old_value), "to": str(value)}
                    setattr(prospect, key, value)

        if changes:
            await self._log_activity(
                prospect_id=prospect_id,
                action="prospect_updated",
                details={"changes": changes},
                performed_by=updated_by,
            )

        await self.db.commit()
        return await self.get_prospect(prospect_id, organization_id)

    # =========================================================================
    # Step Progression
    # =========================================================================

    async def complete_step(
        self,
        prospect_id: str,
        organization_id: str,
        step_id: str,
        completed_by: str,
        notes: Optional[str] = None,
        action_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[ProspectiveMember]:
        """Mark a step as completed for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # Find or create the progress record
        progress = next(
            (p for p in prospect.step_progress if str(p.step_id) == str(step_id)),
            None,
        )

        if not progress:
            progress = ProspectStepProgress(
                id=generate_uuid(),
                prospect_id=prospect_id,
                step_id=step_id,
                status=StepProgressStatus.COMPLETED,
                completed_at=datetime.utcnow(),
                completed_by=completed_by,
                notes=notes,
                action_result=action_result,
            )
            self.db.add(progress)
        else:
            progress.status = StepProgressStatus.COMPLETED
            progress.completed_at = datetime.utcnow()
            progress.completed_by = completed_by
            if notes:
                progress.notes = notes
            if action_result:
                progress.action_result = action_result

        await self._log_activity(
            prospect_id=prospect_id,
            action="step_completed",
            details={"step_id": str(step_id), "notes": notes},
            performed_by=completed_by,
        )

        # Check if the completed step is the final step and auto-transfer is on
        step = next((s for s in prospect.pipeline.steps if str(s.id) == str(step_id)), None)
        if step and step.is_final_step and prospect.pipeline.auto_transfer_on_approval:
            await self._do_transfer(prospect, completed_by)
        else:
            # Advance to next step
            await self._advance_current_step(prospect, step_id)

        await self.db.commit()
        return await self.get_prospect(prospect_id, organization_id)

    async def advance_prospect(
        self,
        prospect_id: str,
        organization_id: str,
        advanced_by: str,
        notes: Optional[str] = None,
    ) -> Optional[ProspectiveMember]:
        """Advance a prospect to the next step in the pipeline"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect or not prospect.pipeline:
            return None

        sorted_steps = sorted(prospect.pipeline.steps, key=lambda s: s.sort_order)
        current_idx = next(
            (i for i, s in enumerate(sorted_steps) if str(s.id) == str(prospect.current_step_id)),
            -1,
        )

        if current_idx < 0 or current_idx >= len(sorted_steps) - 1:
            return prospect  # Already at the end or no current step

        next_step = sorted_steps[current_idx + 1]
        prospect.current_step_id = next_step.id

        # Mark next step as in_progress
        next_progress = next(
            (p for p in prospect.step_progress if str(p.step_id) == str(next_step.id)),
            None,
        )
        if next_progress:
            next_progress.status = StepProgressStatus.IN_PROGRESS
        else:
            self.db.add(ProspectStepProgress(
                id=generate_uuid(),
                prospect_id=prospect_id,
                step_id=next_step.id,
                status=StepProgressStatus.IN_PROGRESS,
            ))

        await self._log_activity(
            prospect_id=prospect_id,
            action="prospect_advanced",
            details={"to_step_id": str(next_step.id), "to_step_name": next_step.name, "notes": notes},
            performed_by=advanced_by,
        )

        await self.db.commit()
        return await self.get_prospect(prospect_id, organization_id)

    async def _advance_current_step(self, prospect: ProspectiveMember, completed_step_id: str):
        """After completing a step, move current_step_id to the next step"""
        if not prospect.pipeline:
            return

        sorted_steps = sorted(prospect.pipeline.steps, key=lambda s: s.sort_order)
        current_idx = next(
            (i for i, s in enumerate(sorted_steps) if str(s.id) == str(completed_step_id)),
            -1,
        )

        if current_idx >= 0 and current_idx < len(sorted_steps) - 1:
            next_step = sorted_steps[current_idx + 1]
            prospect.current_step_id = next_step.id

            # Mark next step as in_progress
            next_progress = next(
                (p for p in prospect.step_progress if str(p.step_id) == str(next_step.id)),
                None,
            )
            if next_progress:
                next_progress.status = StepProgressStatus.IN_PROGRESS

    # =========================================================================
    # Transfer to Membership
    # =========================================================================

    async def transfer_to_membership(
        self,
        prospect_id: str,
        organization_id: str,
        transferred_by: str,
        username: Optional[str] = None,
        rank: Optional[str] = None,
        station: Optional[str] = None,
        role_ids: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Transfer a prospect to a full User record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        if prospect.status == ProspectStatus.TRANSFERRED:
            return {"success": False, "message": "Prospect has already been transferred"}

        return await self._do_transfer(
            prospect, transferred_by, username, rank, station, role_ids
        )

    async def _do_transfer(
        self,
        prospect: ProspectiveMember,
        transferred_by: str,
        username: Optional[str] = None,
        rank: Optional[str] = None,
        station: Optional[str] = None,
        role_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Internal method to perform the actual transfer"""
        if not username:
            username = self._generate_username(prospect.first_name, prospect.last_name)

        user_id = generate_uuid()
        new_user = User(
            id=user_id,
            organization_id=prospect.organization_id,
            username=username,
            email=prospect.email,
            first_name=prospect.first_name,
            last_name=prospect.last_name,
            phone=prospect.phone,
            mobile=prospect.mobile,
            date_of_birth=prospect.date_of_birth,
            address_street=prospect.address_street,
            address_city=prospect.address_city,
            address_state=prospect.address_state,
            address_zip=prospect.address_zip,
            rank=rank,
            station=station,
        )
        self.db.add(new_user)

        # Update prospect record
        prospect.status = ProspectStatus.TRANSFERRED
        prospect.transferred_user_id = user_id
        prospect.transferred_at = datetime.utcnow()

        await self._log_activity(
            prospect_id=prospect.id,
            action="transferred_to_membership",
            details={"user_id": user_id, "username": username},
            performed_by=transferred_by,
        )

        await self.db.flush()

        return {
            "success": True,
            "prospect_id": prospect.id,
            "user_id": user_id,
            "message": f"Prospect {prospect.full_name} transferred to membership as {username}",
        }

    def _generate_username(self, first_name: str, last_name: str) -> str:
        """Generate a username from first and last name"""
        base = f"{first_name[0]}{last_name}".lower().replace(" ", "")
        # Add random suffix to avoid collisions
        suffix = ''.join(secrets.choice(string.digits) for _ in range(3))
        return f"{base}{suffix}"

    # =========================================================================
    # Kanban Board
    # =========================================================================

    async def get_kanban_board(
        self, pipeline_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get the kanban board view for a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # Get all active prospects for this pipeline
        query = (
            select(ProspectiveMember)
            .where(
                and_(
                    ProspectiveMember.organization_id == organization_id,
                    ProspectiveMember.pipeline_id == pipeline_id,
                    ProspectiveMember.status == ProspectStatus.ACTIVE,
                )
            )
            .options(selectinload(ProspectiveMember.current_step))
            .order_by(ProspectiveMember.created_at)
        )
        result = await self.db.execute(query)
        prospects = list(result.scalars().all())

        # Group prospects by current step
        columns = []
        for step in sorted(pipeline.steps, key=lambda s: s.sort_order):
            step_prospects = [p for p in prospects if str(p.current_step_id) == str(step.id)]
            columns.append({
                "step": step,
                "prospects": step_prospects,
                "count": len(step_prospects),
            })

        # Add column for prospects with no current step
        unassigned = [p for p in prospects if not p.current_step_id]
        if unassigned:
            columns.insert(0, {
                "step": None,
                "prospects": unassigned,
                "count": len(unassigned),
            })

        return {
            "pipeline": pipeline,
            "columns": columns,
            "total_prospects": len(prospects),
        }

    # =========================================================================
    # Activity Log
    # =========================================================================

    async def get_activity_log(
        self, prospect_id: str, organization_id: str, limit: int = 50
    ) -> List[ProspectActivityLog]:
        """Get activity log for a prospect"""
        # Verify the prospect belongs to the organization
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return []

        query = (
            select(ProspectActivityLog)
            .where(ProspectActivityLog.prospect_id == prospect_id)
            .options(selectinload(ProspectActivityLog.performer))
            .order_by(ProspectActivityLog.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _log_activity(
        self,
        prospect_id: str,
        action: str,
        details: Optional[Dict[str, Any]] = None,
        performed_by: Optional[str] = None,
    ):
        """Log an activity for a prospect"""
        log = ProspectActivityLog(
            id=generate_uuid(),
            prospect_id=prospect_id,
            action=action,
            details=details,
            performed_by=performed_by,
        )
        self.db.add(log)

    # =========================================================================
    # Template Seeding
    # =========================================================================

    async def seed_default_templates(self, organization_id: str, created_by: Optional[str] = None):
        """Create default pipeline templates for an organization"""
        templates = [
            {
                "name": "Standard Membership Pipeline",
                "description": "A standard pipeline for processing new membership applications with bookended steps.",
                "steps": [
                    {"name": "Interest Form Received", "step_type": "checkbox", "is_first_step": True, "required": True},
                    {"name": "Send Welcome Email", "step_type": "action", "action_type": "send_email", "required": True},
                    {"name": "Interest Meeting Attended", "step_type": "checkbox", "required": True},
                    {"name": "Application Sent", "step_type": "action", "action_type": "send_email", "required": True},
                    {"name": "Application Received", "step_type": "checkbox", "required": True},
                    {"name": "Background Check", "step_type": "checkbox", "required": True},
                    {"name": "Interview Completed", "step_type": "note", "required": True},
                    {"name": "Membership Vote", "step_type": "checkbox", "required": True},
                    {"name": "Approved / Elected", "step_type": "checkbox", "is_final_step": True, "required": True},
                ],
            },
            {
                "name": "Expedited Membership Pipeline",
                "description": "A shorter pipeline for lateral transfers or expedited membership approvals.",
                "steps": [
                    {"name": "Application Received", "step_type": "checkbox", "is_first_step": True, "required": True},
                    {"name": "Credentials Verified", "step_type": "checkbox", "required": True},
                    {"name": "Interview Completed", "step_type": "note", "required": True},
                    {"name": "Approved / Elected", "step_type": "checkbox", "is_final_step": True, "required": True},
                ],
            },
        ]

        for template_data in templates:
            await self.create_pipeline(
                organization_id=organization_id,
                name=template_data["name"],
                description=template_data["description"],
                is_template=True,
                steps=template_data["steps"],
                created_by=created_by,
            )

    # =========================================================================
    # Helpers
    # =========================================================================

    async def _get_default_pipeline(self, organization_id: str) -> Optional[MembershipPipeline]:
        """Get the default pipeline for an organization"""
        query = (
            select(MembershipPipeline)
            .where(
                and_(
                    MembershipPipeline.organization_id == organization_id,
                    MembershipPipeline.is_default == True,
                )
            )
            .options(selectinload(MembershipPipeline.steps))
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def _get_first_step_id(self, pipeline_id: str) -> Optional[str]:
        """Get the first step ID for a pipeline"""
        query = (
            select(MembershipPipelineStep)
            .where(MembershipPipelineStep.pipeline_id == pipeline_id)
            .order_by(MembershipPipelineStep.sort_order)
            .limit(1)
        )
        result = await self.db.execute(query)
        step = result.scalars().first()
        return step.id if step else None

    async def _initialize_step_progress(
        self, prospect_id: str, pipeline_id: str, first_step_id: Optional[str]
    ):
        """Create step progress records for all steps in a pipeline"""
        query = (
            select(MembershipPipelineStep)
            .where(MembershipPipelineStep.pipeline_id == pipeline_id)
            .order_by(MembershipPipelineStep.sort_order)
        )
        result = await self.db.execute(query)
        steps = result.scalars().all()

        for step in steps:
            status = StepProgressStatus.IN_PROGRESS if str(step.id) == str(first_step_id) else StepProgressStatus.PENDING
            progress = ProspectStepProgress(
                id=generate_uuid(),
                prospect_id=prospect_id,
                step_id=step.id,
                status=status,
            )
            self.db.add(progress)
