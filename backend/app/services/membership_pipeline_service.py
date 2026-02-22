"""
Membership Pipeline Service

Business logic for prospective member pipeline management including
pipeline configuration, prospect tracking, step progression, and
transfer to full membership.
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update, delete
from sqlalchemy.orm import selectinload
from uuid import UUID, uuid4
import secrets
import string
from loguru import logger

from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStepProgress,
    ProspectActivityLog,
    ProspectDocument,
    ProspectElectionPackage,
    InterviewRecord,
    ReferenceCheckRecord,
    ProspectStatus,
    StepProgressStatus,
    PipelineStepType,
    InterviewStatus,
    ReferenceCheckStatus,
)
from app.models.user import User, UserStatus, Organization, generate_uuid


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
            .options(
                selectinload(MembershipPipeline.steps),
                selectinload(MembershipPipeline.prospects),
            )
            .order_by(MembershipPipeline.is_default.desc(), MembershipPipeline.created_at)
        )
        if not include_templates:
            query = query.where(MembershipPipeline.is_template == False)  # noqa: E712
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
        is_active: bool = True,
        auto_transfer_on_approval: bool = False,
        inactivity_config: Optional[Dict[str, Any]] = None,
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
            is_active=is_active,
            auto_transfer_on_approval=auto_transfer_on_approval,
            inactivity_config=inactivity_config or {},
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
                    config=step_data.get("config", {}),
                    inactivity_timeout_days=step_data.get("inactivity_timeout_days"),
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
            if hasattr(pipeline, key):
                setattr(pipeline, key, value)

        await self.db.commit()
        return await self.get_pipeline(pipeline_id, organization_id)

    async def delete_pipeline(self, pipeline_id: str, organization_id: str) -> bool:
        """Delete a pipeline. Unassigns prospects first so they are not cascade-deleted."""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        # Detach prospects from this pipeline so they survive the cascade delete
        await self.db.execute(
            update(ProspectiveMember)
            .where(ProspectiveMember.pipeline_id == pipeline_id)
            .values(pipeline_id=None, current_step_id=None)
        )

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
                "config": step.config or {},
                "inactivity_timeout_days": step.inactivity_timeout_days,
            }
            for step in source.steps
        ]

        return await self.create_pipeline(
            organization_id=organization_id,
            name=new_name,
            description=source.description,
            is_template=False,
            is_default=False,
            is_active=source.is_active,
            auto_transfer_on_approval=source.auto_transfer_on_approval,
            inactivity_config=source.inactivity_config,
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
                    MembershipPipeline.is_default == True,  # noqa: E712
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
            config=data.get("config", {}),
            inactivity_timeout_days=data.get("inactivity_timeout_days"),
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
        """Remove a step from a pipeline.

        Preserves progress records by nullifying their step_id reference
        instead of letting the cascade destroy them.  Also moves any
        prospect whose current_step_id points to this step to the next
        available step (or None).
        """
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        step = next((s for s in pipeline.steps if s.id == step_id), None)
        if not step:
            return False

        # Detach progress records so they survive the cascade
        await self.db.execute(
            update(ProspectStepProgress)
            .where(ProspectStepProgress.step_id == step_id)
            .values(step_id=None)
        )

        # Move prospects sitting on this step to the next step (or None)
        sorted_steps = sorted(pipeline.steps, key=lambda s: s.sort_order)
        current_idx = next(
            (i for i, s in enumerate(sorted_steps) if str(s.id) == str(step_id)),
            -1,
        )
        next_step_id = None
        if current_idx >= 0 and current_idx < len(sorted_steps) - 1:
            next_step_id = sorted_steps[current_idx + 1].id

        await self.db.execute(
            update(ProspectiveMember)
            .where(ProspectiveMember.current_step_id == step_id)
            .values(current_step_id=next_step_id)
        )

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
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            search_term = f"%{safe_search}%"
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

    async def check_existing_members(
        self,
        organization_id: str,
        email: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Check if an email or name matches any existing users in the organization,
        including archived members. Returns a list of matches with their status
        so leadership can decide whether to reactivate instead of creating new.
        """
        conditions = [
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        ]

        # Match by email or by first+last name
        match_conditions = [func.lower(User.email) == email.lower()]
        if first_name and last_name:
            match_conditions.append(
                and_(
                    func.lower(User.first_name) == first_name.lower(),
                    func.lower(User.last_name) == last_name.lower(),
                )
            )

        conditions.append(or_(*match_conditions))

        result = await self.db.execute(
            select(User).where(*conditions)
        )
        matches = result.scalars().all()

        return [
            {
                "user_id": str(m.id),
                "name": m.full_name,
                "email": m.email,
                "status": m.status.value if hasattr(m.status, 'value') else str(m.status),
                "membership_number": m.membership_number,
                "archived_at": m.archived_at.isoformat() if m.archived_at else None,
                "match_type": "email" if m.email and m.email.lower() == email.lower() else "name",
            }
            for m in matches
        ]

    async def create_prospect(
        self,
        organization_id: str,
        data: Dict[str, Any],
        created_by: Optional[str] = None,
    ) -> ProspectiveMember:
        """Create a new prospective member.

        Raises ValueError if a prospect with the same email already exists
        in this organization (regardless of pipeline).
        """
        # Enforce per-org email uniqueness at the service level
        email = data["email"]
        existing = await self.db.execute(
            select(ProspectiveMember.id).where(
                and_(
                    ProspectiveMember.organization_id == organization_id,
                    func.lower(ProspectiveMember.email) == email.lower(),
                )
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"A prospect with email '{email}' already exists in this organization")

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
        """Update a prospect's information.

        Uses exclude_unset=True at the API layer, so keys present in ``data``
        were explicitly provided by the caller — even if the value is None
        (meaning "clear this field").
        """
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        changes = {}
        for key, value in data.items():
            if not hasattr(prospect, key):
                continue
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

    async def delete_prospect(
        self, prospect_id: str, organization_id: str, deleted_by: Optional[str] = None
    ) -> bool:
        """Delete a prospect. Only withdrawn or rejected prospects can be deleted."""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return False

        # Only allow deletion of withdrawn or rejected prospects
        if prospect.status not in (ProspectStatus.WITHDRAWN, ProspectStatus.REJECTED):
            return False

        await self.db.delete(prospect)
        await self.db.commit()
        return True

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
                completed_at=datetime.now(timezone.utc),
                completed_by=completed_by,
                notes=notes,
                action_result=action_result,
            )
            self.db.add(progress)
        else:
            progress.status = StepProgressStatus.COMPLETED
            progress.completed_at = datetime.now(timezone.utc)
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

            # Mark next step as in_progress, creating the record if it doesn't exist
            next_progress = next(
                (p for p in prospect.step_progress if str(p.step_id) == str(next_step.id)),
                None,
            )
            if next_progress:
                next_progress.status = StepProgressStatus.IN_PROGRESS
            else:
                self.db.add(ProspectStepProgress(
                    id=generate_uuid(),
                    prospect_id=prospect.id,
                    step_id=next_step.id,
                    status=StepProgressStatus.IN_PROGRESS,
                ))

    # =========================================================================
    # Transfer to Membership
    # =========================================================================

    async def transfer_to_membership(
        self,
        prospect_id: str,
        organization_id: str,
        transferred_by: str,
        username: Optional[str] = None,
        membership_id: Optional[str] = None,
        rank: Optional[str] = None,
        station: Optional[str] = None,
        role_ids: Optional[List[str]] = None,
        department_email: Optional[str] = None,
        use_personal_as_primary: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Transfer a prospect to a full User record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        if prospect.status == ProspectStatus.TRANSFERRED:
            return {"success": False, "message": "Prospect has already been transferred"}

        return await self._do_transfer(
            prospect, transferred_by, username, membership_id, rank, station, role_ids,
            department_email=department_email,
            use_personal_as_primary=use_personal_as_primary,
        )

    async def _do_transfer(
        self,
        prospect: ProspectiveMember,
        transferred_by: str,
        username: Optional[str] = None,
        membership_id: Optional[str] = None,
        rank: Optional[str] = None,
        station: Optional[str] = None,
        role_ids: Optional[List[str]] = None,
        department_email: Optional[str] = None,
        use_personal_as_primary: bool = False,
    ) -> Dict[str, Any]:
        """Internal method to perform the actual transfer.

        Email assignment rules:
        1. If ``use_personal_as_primary`` is True the prospect's existing
           email is kept as the primary ``User.email`` and also stored in
           ``User.personal_email`` (department uses personal email).
        2. If ``department_email`` is provided it becomes ``User.email``
           and the prospect's original email becomes ``User.personal_email``.
        3. If neither is provided but the org has ``settings.email.domain``
           configured, a department email is auto-generated as
           ``first_name.last_name@domain`` and the original becomes
           ``personal_email``.
        4. Fallback: prospect email → ``User.email``, no personal_email set.
        """

        # Check for existing users with the same email (prevents duplicates)
        existing_matches = await self.check_existing_members(
            organization_id=prospect.organization_id,
            email=prospect.email,
            first_name=prospect.first_name,
            last_name=prospect.last_name,
        )
        if existing_matches:
            archived = [m for m in existing_matches if m["status"] == "archived"]
            active_or_other = [m for m in existing_matches if m["status"] != "archived"]

            if archived:
                match = archived[0]
                return {
                    "success": False,
                    "existing_member_match": match,
                    "message": (
                        f"A previously archived member matches this prospect: "
                        f"{match['name']} ({match['email']}). "
                        f"Use POST /api/v1/users/{match['user_id']}/reactivate "
                        f"to restore their account instead of creating a duplicate."
                    ),
                }
            elif active_or_other:
                match = active_or_other[0]
                return {
                    "success": False,
                    "existing_member_match": match,
                    "message": (
                        f"A member with this email already exists: "
                        f"{match['name']} (status: {match['status']}). "
                        f"Cannot create a duplicate user record."
                    ),
                }

        if not username:
            username = self._generate_username(prospect.first_name, prospect.last_name)

        # Auto-assign membership ID if not manually provided
        if not membership_id:
            from app.services.organization_service import OrganizationService
            org_service = OrganizationService(self.db)
            membership_id = await org_service.generate_next_membership_id(prospect.organization_id)

        # Resolve email assignment
        primary_email, personal_email = await self._resolve_transfer_emails(
            prospect=prospect,
            department_email=department_email,
            use_personal_as_primary=use_personal_as_primary,
        )

        user_id = generate_uuid()
        new_user = User(
            id=user_id,
            organization_id=prospect.organization_id,
            username=username,
            email=primary_email,
            personal_email=personal_email,
            first_name=prospect.first_name,
            last_name=prospect.last_name,
            phone=prospect.phone,
            mobile=prospect.mobile,
            date_of_birth=prospect.date_of_birth,
            address_street=prospect.address_street,
            address_city=prospect.address_city,
            address_state=prospect.address_state,
            address_zip=prospect.address_zip,
            membership_id=membership_id,
            rank=rank,
            station=station,
        )
        self.db.add(new_user)

        # Assign initial roles/positions if provided
        if role_ids:
            from app.models.user import Role
            role_result = await self.db.execute(
                select(Role)
                .where(Role.id.in_([str(rid) for rid in role_ids]))
                .where(Role.organization_id == prospect.organization_id)
            )
            roles = list(role_result.scalars().all())
            if roles:
                new_user.roles = roles

        # Auto-assign membership number if enabled for this organization
        from app.services.organization_service import OrganizationService
        org_service = OrganizationService(self.db)
        membership_number = await org_service.assign_next_membership_number(
            organization_id=prospect.organization_id,
            user=new_user,
        )

        # Update prospect record
        prospect.status = ProspectStatus.TRANSFERRED
        prospect.transferred_user_id = user_id
        prospect.transferred_at = datetime.now(timezone.utc)

        transfer_details: Dict[str, Any] = {
            "user_id": user_id,
            "username": username,
            "primary_email": primary_email,
        }
        if personal_email:
            transfer_details["personal_email"] = personal_email
        if membership_number:
            transfer_details["membership_number"] = membership_number

        await self._log_activity(
            prospect_id=prospect.id,
            action="transferred_to_membership",
            details=transfer_details,
            performed_by=transferred_by,
        )

        await self.db.flush()

        # Auto-enroll into probationary training pipeline if one exists
        enrollment_result = await self._auto_enroll_probationary(
            user_id=user_id,
            organization_id=prospect.organization_id,
            enrolled_by=transferred_by,
        )

        result_msg = f"Prospect {prospect.full_name} transferred to membership as {username}"
        if enrollment_result:
            result_msg += f". Auto-enrolled in training program: {enrollment_result['program_name']}"

        return {
            "success": True,
            "prospect_id": prospect.id,
            "user_id": user_id,
            "membership_number": membership_number,
            "primary_email": primary_email,
            "personal_email": personal_email,
            "message": result_msg,
            "auto_enrollment": enrollment_result,
        }

    async def _auto_enroll_probationary(
        self,
        user_id: str,
        organization_id: str,
        enrolled_by: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Auto-enroll a newly converted member into the organization's
        default probationary training program if one exists.

        The org setting `auto_enroll_program_id` in `settings.training` points
        to the default probationary training program. If not set, looks for a
        program with "probationary" in the name.
        """
        try:
            from app.models.training import TrainingProgram, ProgramEnrollment, EnrollmentStatus
            from app.models.user import Organization

            # Check org settings for auto-enroll program
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return None

            training_settings = (org.settings or {}).get("training", {})
            auto_program_id = training_settings.get("auto_enroll_program_id")

            if auto_program_id:
                program_result = await self.db.execute(
                    select(TrainingProgram).where(
                        TrainingProgram.id == auto_program_id,
                        TrainingProgram.organization_id == organization_id,
                    )
                )
                program = program_result.scalar_one_or_none()
            else:
                # Look for a program with "probationary" in the name
                program_result = await self.db.execute(
                    select(TrainingProgram).where(
                        TrainingProgram.organization_id == organization_id,
                        TrainingProgram.name.ilike("%probationary%"),
                        TrainingProgram.active == True,  # noqa: E712
                    ).limit(1)
                )
                program = program_result.scalar_one_or_none()

            if not program:
                return None

            # Check if already enrolled
            existing = await self.db.execute(
                select(ProgramEnrollment).where(
                    ProgramEnrollment.user_id == user_id,
                    ProgramEnrollment.program_id == str(program.id),
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                )
            )
            if existing.scalar_one_or_none():
                return None  # Already enrolled

            enrollment = ProgramEnrollment(
                organization_id=organization_id,
                user_id=user_id,
                program_id=str(program.id),
                enrolled_by=enrolled_by,
                status=EnrollmentStatus.ACTIVE,
            )
            self.db.add(enrollment)
            await self.db.flush()

            logger.info(
                f"Auto-enrolled user {user_id} in probationary program "
                f"'{program.name}' (program_id={program.id})"
            )

            return {
                "enrollment_id": str(enrollment.id),
                "program_id": str(program.id),
                "program_name": program.name,
            }

        except Exception as e:
            logger.error(f"Auto-enrollment failed for user {user_id}: {e}")
            return None

    def _generate_username(self, first_name: str, last_name: str) -> str:
        """Generate a username from first and last name"""
        base = f"{first_name[0]}{last_name}".lower().replace(" ", "")
        # Add random suffix to avoid collisions
        suffix = ''.join(secrets.choice(string.digits) for _ in range(3))
        return f"{base}{suffix}"

    async def _resolve_transfer_emails(
        self,
        prospect: ProspectiveMember,
        department_email: Optional[str] = None,
        use_personal_as_primary: bool = False,
    ) -> tuple[str, Optional[str]]:
        """Determine primary and personal emails for a newly converted member.

        Resolution cascade:
        1. Caller explicitly requests personal-as-primary -> done.
        2. Caller provides an explicit department email -> use it.
        3. Org-level email_generation settings:
           a. use_personal_as_primary -> done.
           b. enabled + domain -> auto-generate with format & duplicate check.
        4. Legacy fallback: settings.email.domain (first.last@domain).
        5. Final fallback: prospect email = primary, no personal stored.

        Returns (primary_email, personal_email).
        """
        from app.services.organization_service import OrganizationService

        prospect_email = prospect.email

        if use_personal_as_primary:
            return prospect_email, prospect_email

        if department_email:
            return department_email, prospect_email

        # Use the org-level email generation settings
        org_service = OrganizationService(self.db)
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == prospect.organization_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            return prospect_email, None

        settings_dict = org.settings or {}
        email_gen = settings_dict.get("email_generation", {})

        # Check org-level "use personal as primary"
        if email_gen.get("use_personal_as_primary", False):
            return prospect_email, prospect_email

        # Auto-generate using org email generation settings
        if email_gen.get("enabled") and email_gen.get("domain"):
            generated, _incremented = await org_service.generate_unique_email(
                organization_id=prospect.organization_id,
                first_name=prospect.first_name,
                last_name=prospect.last_name,
            )
            if generated:
                return generated, prospect_email

        # Legacy fallback: settings.email.domain
        legacy_email = settings_dict.get("email", {})
        legacy_domain = legacy_email.get("domain")
        if legacy_email.get("use_personal_as_primary", False):
            return prospect_email, prospect_email
        if legacy_domain:
            fname = prospect.first_name.lower().replace(" ", "")
            lname = prospect.last_name.lower().replace(" ", "")
            generated = f"{fname}.{lname}@{legacy_domain}"
            return generated, prospect_email

        # Final fallback
        return prospect_email, None

    # =========================================================================
    # Interview Management
    # =========================================================================

    async def list_interviews(
        self, prospect_id: str, organization_id: str, step_id: Optional[str] = None
    ) -> List[InterviewRecord]:
        """List all interviews for a prospect, optionally filtered by step"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return []

        query = (
            select(InterviewRecord)
            .where(InterviewRecord.prospect_id == prospect_id)
            .order_by(InterviewRecord.created_at)
        )
        if step_id:
            query = query.where(InterviewRecord.step_id == step_id)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_interview(
        self, interview_id: str, prospect_id: str, organization_id: str
    ) -> Optional[InterviewRecord]:
        """Get a single interview record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        query = (
            select(InterviewRecord)
            .where(
                and_(
                    InterviewRecord.id == interview_id,
                    InterviewRecord.prospect_id == prospect_id,
                )
            )
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create_interview(
        self,
        prospect_id: str,
        organization_id: str,
        step_id: str,
        scheduled_at: Optional[datetime] = None,
        location: Optional[str] = None,
        interviewer_ids: Optional[List[str]] = None,
        questions: Optional[List[Dict[str, Any]]] = None,
        created_by: Optional[str] = None,
    ) -> Optional[InterviewRecord]:
        """Create an interview record for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # If no questions provided, pull preset questions from the step config
        if questions is None:
            step = next(
                (s for s in (prospect.pipeline.steps if prospect.pipeline else [])
                 if str(s.id) == str(step_id)),
                None,
            )
            if step and step.config:
                questions = step.config.get("questions", [])

        interview = InterviewRecord(
            id=generate_uuid(),
            prospect_id=prospect_id,
            step_id=step_id,
            scheduled_at=scheduled_at,
            location=location,
            status=InterviewStatus.SCHEDULED,
            interviewer_ids=[str(uid) for uid in (interviewer_ids or [])],
            questions=questions or [],
        )
        self.db.add(interview)

        await self._log_activity(
            prospect_id=prospect_id,
            action="interview_scheduled",
            details={
                "interview_id": interview.id,
                "step_id": step_id,
                "scheduled_at": scheduled_at.isoformat() if scheduled_at else None,
                "interviewer_count": len(interviewer_ids or []),
            },
            performed_by=created_by,
        )

        await self.db.commit()
        await self.db.refresh(interview)
        return interview

    async def update_interview(
        self,
        interview_id: str,
        prospect_id: str,
        organization_id: str,
        data: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> Optional[InterviewRecord]:
        """Update an interview record (notes, questions, status, etc.)"""
        interview = await self.get_interview(interview_id, prospect_id, organization_id)
        if not interview:
            return None

        for key, value in data.items():
            if not hasattr(interview, key):
                continue
            if key == "interviewer_ids" and value is not None:
                value = [str(uid) for uid in value]
            setattr(interview, key, value)

        # If marking as completed, set completed_at and completed_by
        if data.get("status") == InterviewStatus.COMPLETED.value:
            if not interview.completed_at:
                interview.completed_at = datetime.now(timezone.utc)
            if not interview.completed_by and updated_by:
                interview.completed_by = updated_by

        await self._log_activity(
            prospect_id=prospect_id,
            action="interview_updated",
            details={
                "interview_id": interview_id,
                "updates": list(data.keys()),
            },
            performed_by=updated_by,
        )

        await self.db.commit()
        await self.db.refresh(interview)
        return interview

    async def get_interview_history(
        self, prospect_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Get all completed interviews for a prospect, with interviewer names.

        This is used by later interview steps to review notes from
        previous interviews.
        """
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return []

        query = (
            select(InterviewRecord)
            .where(
                and_(
                    InterviewRecord.prospect_id == prospect_id,
                    InterviewRecord.status == InterviewStatus.COMPLETED,
                )
            )
            .order_by(InterviewRecord.completed_at)
        )
        result = await self.db.execute(query)
        interviews = list(result.scalars().all())

        # Resolve interviewer names
        all_interviewer_ids = set()
        for iv in interviews:
            all_interviewer_ids.update(iv.interviewer_ids or [])

        name_map: Dict[str, str] = {}
        if all_interviewer_ids:
            user_result = await self.db.execute(
                select(User.id, User.first_name, User.last_name)
                .where(User.id.in_(list(all_interviewer_ids)))
            )
            for row in user_result.all():
                name_map[str(row[0])] = f"{row[1]} {row[2]}".strip()

        # Also resolve step names
        step_ids = {iv.step_id for iv in interviews if iv.step_id}
        step_name_map: Dict[str, str] = {}
        if step_ids:
            step_result = await self.db.execute(
                select(MembershipPipelineStep.id, MembershipPipelineStep.name)
                .where(MembershipPipelineStep.id.in_(list(step_ids)))
            )
            for row in step_result.all():
                step_name_map[str(row[0])] = row[1]

        history = []
        for iv in interviews:
            history.append({
                "id": iv.id,
                "step_id": iv.step_id,
                "step_name": step_name_map.get(str(iv.step_id), "Unknown Step"),
                "scheduled_at": iv.scheduled_at.isoformat() if iv.scheduled_at else None,
                "completed_at": iv.completed_at.isoformat() if iv.completed_at else None,
                "interviewer_ids": iv.interviewer_ids or [],
                "interviewer_names": [
                    name_map.get(uid, uid) for uid in (iv.interviewer_ids or [])
                ],
                "questions": iv.questions or [],
                "notes": iv.notes,
                "status": iv.status.value if hasattr(iv.status, 'value') else str(iv.status),
            })

        return history

    # =========================================================================
    # Reference Check Management
    # =========================================================================

    async def list_reference_checks(
        self, prospect_id: str, organization_id: str, step_id: Optional[str] = None
    ) -> List[ReferenceCheckRecord]:
        """List all reference checks for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return []

        query = (
            select(ReferenceCheckRecord)
            .where(ReferenceCheckRecord.prospect_id == prospect_id)
            .order_by(ReferenceCheckRecord.created_at)
        )
        if step_id:
            query = query.where(ReferenceCheckRecord.step_id == step_id)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_reference_check(
        self, check_id: str, prospect_id: str, organization_id: str
    ) -> Optional[ReferenceCheckRecord]:
        """Get a single reference check record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        query = (
            select(ReferenceCheckRecord)
            .where(
                and_(
                    ReferenceCheckRecord.id == check_id,
                    ReferenceCheckRecord.prospect_id == prospect_id,
                )
            )
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create_reference_check(
        self,
        prospect_id: str,
        organization_id: str,
        step_id: str,
        reference_name: str,
        reference_phone: Optional[str] = None,
        reference_email: Optional[str] = None,
        reference_relationship: Optional[str] = None,
        questions: Optional[List[Dict[str, Any]]] = None,
        created_by: Optional[str] = None,
    ) -> Optional[ReferenceCheckRecord]:
        """Create a reference check record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # Pull preset questions from step config if none provided
        if questions is None:
            step = next(
                (s for s in (prospect.pipeline.steps if prospect.pipeline else [])
                 if str(s.id) == str(step_id)),
                None,
            )
            if step and step.config:
                questions = step.config.get("questions", [])

        check = ReferenceCheckRecord(
            id=generate_uuid(),
            prospect_id=prospect_id,
            step_id=step_id,
            reference_name=reference_name,
            reference_phone=reference_phone,
            reference_email=reference_email,
            reference_relationship=reference_relationship,
            status=ReferenceCheckStatus.PENDING,
            questions=questions or [],
        )
        self.db.add(check)

        await self._log_activity(
            prospect_id=prospect_id,
            action="reference_check_created",
            details={
                "check_id": check.id,
                "step_id": step_id,
                "reference_name": reference_name,
            },
            performed_by=created_by,
        )

        await self.db.commit()
        await self.db.refresh(check)
        return check

    async def update_reference_check(
        self,
        check_id: str,
        prospect_id: str,
        organization_id: str,
        data: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> Optional[ReferenceCheckRecord]:
        """Update a reference check record"""
        check = await self.get_reference_check(check_id, prospect_id, organization_id)
        if not check:
            return None

        for key, value in data.items():
            if hasattr(check, key):
                setattr(check, key, value)

        # If marking as completed or attempted, set contacted_at/by
        if data.get("status") in (
            ReferenceCheckStatus.COMPLETED.value,
            ReferenceCheckStatus.ATTEMPTED.value,
        ):
            if not check.contacted_at:
                check.contacted_at = datetime.now(timezone.utc)
            if not check.contacted_by and updated_by:
                check.contacted_by = updated_by

        await self._log_activity(
            prospect_id=prospect_id,
            action="reference_check_updated",
            details={
                "check_id": check_id,
                "updates": list(data.keys()),
            },
            performed_by=updated_by,
        )

        await self.db.commit()
        await self.db.refresh(check)
        return check

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
                    {"name": "Reference Checks", "step_type": "reference_check", "required": True, "config": {
                        "required_references_count": 3,
                        "questions": [
                            {"text": "How long have you known the applicant?", "type": "preset"},
                            {"text": "How would you describe their character?", "type": "preset"},
                            {"text": "Would you recommend them for membership?", "type": "preset"},
                        ],
                    }},
                    {"name": "Initial Interview", "step_type": "interview", "required": True, "config": {
                        "questions": [
                            {"text": "Why are you interested in joining?", "type": "preset"},
                            {"text": "What relevant experience do you have?", "type": "preset"},
                            {"text": "What are your availability and commitment expectations?", "type": "preset"},
                        ],
                        "allow_view_previous_interviews": True,
                        "required_interviewers_count": 2,
                    }},
                    {"name": "Final Interview with Chief", "step_type": "interview", "required": True, "config": {
                        "questions": [
                            {"text": "Review of previous interview notes", "type": "preset"},
                            {"text": "Additional questions from leadership", "type": "freeform"},
                        ],
                        "allow_view_previous_interviews": True,
                        "required_interviewers_count": 1,
                    }},
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
                    {"name": "Interview", "step_type": "interview", "required": True, "config": {
                        "questions": [
                            {"text": "Describe your relevant credentials and experience", "type": "preset"},
                            {"text": "Why are you seeking a lateral transfer?", "type": "preset"},
                        ],
                        "allow_view_previous_interviews": True,
                        "required_interviewers_count": 1,
                    }},
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
                    MembershipPipeline.is_default == True,  # noqa: E712
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

    # =========================================================================
    # Pipeline Statistics
    # =========================================================================

    async def get_pipeline_stats(self, pipeline_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        """Get statistics for a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # Count prospects by status
        status_counts = {}
        for status_val in ProspectStatus:
            count_query = (
                select(func.count(ProspectiveMember.id))
                .where(
                    and_(
                        ProspectiveMember.pipeline_id == pipeline_id,
                        ProspectiveMember.status == status_val,
                    )
                )
            )
            result = await self.db.execute(count_query)
            status_counts[status_val.value] = result.scalar() or 0

        total = sum(status_counts.values())

        # Count prospects by current step
        step_ids = [step.id for step in pipeline.steps]
        by_step = []
        for step in sorted(pipeline.steps, key=lambda s: s.sort_order):
            step_count_query = (
                select(func.count(ProspectiveMember.id))
                .where(
                    and_(
                        ProspectiveMember.pipeline_id == pipeline_id,
                        ProspectiveMember.current_step_id == step.id,
                        ProspectiveMember.status == ProspectStatus.ACTIVE,
                    )
                )
            )
            result = await self.db.execute(step_count_query)
            by_step.append({
                "stage_id": step.id,
                "stage_name": step.name,
                "count": result.scalar() or 0,
            })

        # Count active prospects whose current_step_id is NULL or doesn't
        # match any existing step (orphaned due to step deletion)
        if step_ids:
            orphan_query = (
                select(func.count(ProspectiveMember.id))
                .where(
                    and_(
                        ProspectiveMember.pipeline_id == pipeline_id,
                        ProspectiveMember.status == ProspectStatus.ACTIVE,
                        or_(
                            ProspectiveMember.current_step_id.is_(None),
                            ProspectiveMember.current_step_id.notin_(step_ids),
                        ),
                    )
                )
            )
        else:
            orphan_query = (
                select(func.count(ProspectiveMember.id))
                .where(
                    and_(
                        ProspectiveMember.pipeline_id == pipeline_id,
                        ProspectiveMember.status == ProspectStatus.ACTIVE,
                    )
                )
            )
        orphan_result = await self.db.execute(orphan_query)
        orphan_count = orphan_result.scalar() or 0
        if orphan_count > 0:
            by_step.append({
                "stage_id": None,
                "stage_name": "Unassigned",
                "count": orphan_count,
            })

        # Calculate avg days to transfer using portable SQL
        # julianday() works on SQLite; for PostgreSQL use EXTRACT(EPOCH FROM ...)/86400
        avg_days = None
        transferred_count = status_counts.get("transferred", 0)
        if transferred_count > 0:
            avg_query = (
                select(
                    func.avg(
                        func.julianday(ProspectiveMember.transferred_at)
                        - func.julianday(ProspectiveMember.created_at)
                    )
                )
                .where(
                    and_(
                        ProspectiveMember.pipeline_id == pipeline_id,
                        ProspectiveMember.status == ProspectStatus.TRANSFERRED,
                        ProspectiveMember.transferred_at.isnot(None),
                    )
                )
            )
            try:
                result = await self.db.execute(avg_query)
                avg_days = result.scalar()
            except Exception:
                # Fallback: compute in Python if the DB doesn't support julianday
                rows_query = (
                    select(
                        ProspectiveMember.transferred_at,
                        ProspectiveMember.created_at,
                    )
                    .where(
                        and_(
                            ProspectiveMember.pipeline_id == pipeline_id,
                            ProspectiveMember.status == ProspectStatus.TRANSFERRED,
                            ProspectiveMember.transferred_at.isnot(None),
                        )
                    )
                )
                rows_result = await self.db.execute(rows_query)
                rows = rows_result.all()
                if rows:
                    total_days = sum(
                        (r[0] - r[1]).total_seconds() / 86400 for r in rows if r[0] and r[1]
                    )
                    avg_days = total_days / len(rows) if rows else None

        conversion_rate = (transferred_count / total * 100) if total > 0 else 0

        return {
            "pipeline_id": pipeline_id,
            "total_prospects": total,
            "active_count": status_counts.get("active", 0),
            "approved_count": status_counts.get("approved", 0),
            "rejected_count": status_counts.get("rejected", 0),
            "on_hold_count": status_counts.get("on_hold", 0),
            "inactive_count": status_counts.get("inactive", 0),
            "withdrawn_count": status_counts.get("withdrawn", 0),
            "transferred_count": transferred_count,
            "by_step": by_step,
            "avg_days_to_transfer": float(avg_days) if avg_days else None,
            "conversion_rate": round(conversion_rate, 1),
        }

    # =========================================================================
    # Purge Inactive Prospects
    # =========================================================================

    async def purge_inactive_prospects(
        self,
        pipeline_id: str,
        organization_id: str,
        prospect_ids: Optional[List[str]] = None,
        purged_by: Optional[str] = None,
    ) -> int:
        """Delete withdrawn/inactive prospects from a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return 0

        conditions = [
            ProspectiveMember.pipeline_id == pipeline_id,
            ProspectiveMember.status == ProspectStatus.WITHDRAWN,
        ]
        if prospect_ids:
            conditions.append(ProspectiveMember.id.in_(prospect_ids))

        # Count first
        count_query = select(func.count(ProspectiveMember.id)).where(and_(*conditions))
        result = await self.db.execute(count_query)
        count = result.scalar() or 0

        if count > 0:
            # Delete (cascade will handle related records)
            del_query = delete(ProspectiveMember).where(and_(*conditions))
            await self.db.execute(del_query)
            await self.db.commit()

        return count

    # =========================================================================
    # Document Management
    # =========================================================================

    async def get_prospect_documents(
        self, prospect_id: str, organization_id: str
    ) -> List[ProspectDocument]:
        """Get all documents for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return []

        query = (
            select(ProspectDocument)
            .where(ProspectDocument.prospect_id == prospect_id)
            .order_by(ProspectDocument.created_at.desc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def add_prospect_document(
        self,
        prospect_id: str,
        organization_id: str,
        document_type: str,
        file_name: str,
        file_path: str,
        file_size: int = 0,
        mime_type: Optional[str] = None,
        step_id: Optional[str] = None,
        uploaded_by: Optional[str] = None,
    ) -> Optional[ProspectDocument]:
        """Add a document to a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        doc = ProspectDocument(
            id=generate_uuid(),
            prospect_id=prospect_id,
            step_id=step_id,
            document_type=document_type,
            file_name=file_name,
            file_path=file_path,
            file_size=file_size,
            mime_type=mime_type,
            uploaded_by=uploaded_by,
        )
        self.db.add(doc)

        await self._log_activity(
            prospect_id=prospect_id,
            action="document_uploaded",
            details={"document_type": document_type, "file_name": file_name},
            performed_by=uploaded_by,
        )

        await self.db.commit()
        return doc

    async def delete_prospect_document(
        self,
        document_id: str,
        prospect_id: str,
        organization_id: str,
        deleted_by: Optional[str] = None,
    ) -> bool:
        """Delete a prospect document"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return False

        query = (
            select(ProspectDocument)
            .where(
                and_(
                    ProspectDocument.id == document_id,
                    ProspectDocument.prospect_id == prospect_id,
                )
            )
        )
        result = await self.db.execute(query)
        doc = result.scalars().first()
        if not doc:
            return False

        await self._log_activity(
            prospect_id=prospect_id,
            action="document_deleted",
            details={"document_type": doc.document_type, "file_name": doc.file_name},
            performed_by=deleted_by,
        )

        await self.db.delete(doc)
        await self.db.commit()
        return True

    # =========================================================================
    # Election Package Management
    # =========================================================================

    async def get_election_package(
        self, prospect_id: str, organization_id: str
    ) -> Optional[ProspectElectionPackage]:
        """Get the election package for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        query = (
            select(ProspectElectionPackage)
            .where(ProspectElectionPackage.prospect_id == prospect_id)
            .order_by(ProspectElectionPackage.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create_election_package(
        self,
        prospect_id: str,
        organization_id: str,
        pipeline_id: Optional[str] = None,
        step_id: Optional[str] = None,
        coordinator_notes: Optional[str] = None,
        package_config: Optional[Dict[str, Any]] = None,
        created_by: Optional[str] = None,
    ) -> Optional[ProspectElectionPackage]:
        """Create an election package for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # Build applicant snapshot
        snapshot = {
            "first_name": prospect.first_name,
            "last_name": prospect.last_name,
            "email": prospect.email,
            "phone": prospect.phone,
            "date_of_birth": str(prospect.date_of_birth) if prospect.date_of_birth else None,
            "interest_reason": prospect.interest_reason,
            "referral_source": prospect.referral_source,
            "created_at": str(prospect.created_at) if prospect.created_at else None,
        }

        pkg = ProspectElectionPackage(
            id=generate_uuid(),
            prospect_id=prospect_id,
            pipeline_id=pipeline_id or prospect.pipeline_id,
            step_id=step_id,
            status="draft",
            applicant_snapshot=snapshot,
            coordinator_notes=coordinator_notes,
            package_config=package_config or {},
        )
        self.db.add(pkg)

        await self._log_activity(
            prospect_id=prospect_id,
            action="election_package_created",
            details={"package_id": pkg.id},
            performed_by=created_by,
        )

        await self.db.commit()
        return pkg

    async def update_election_package(
        self,
        prospect_id: str,
        organization_id: str,
        updates: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> Optional[ProspectElectionPackage]:
        """Update an election package for a prospect"""
        pkg = await self.get_election_package(prospect_id, organization_id)
        if not pkg:
            return None

        for key, value in updates.items():
            if hasattr(pkg, key) and value is not None:
                setattr(pkg, key, value)

        await self._log_activity(
            prospect_id=prospect_id,
            action="election_package_updated",
            details={"updates": list(updates.keys())},
            performed_by=updated_by,
        )

        await self.db.commit()
        await self.db.refresh(pkg)
        return pkg

    async def list_election_packages(
        self,
        organization_id: str,
        pipeline_id: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> List[ProspectElectionPackage]:
        """List election packages, optionally filtered by pipeline and status"""
        query = (
            select(ProspectElectionPackage)
            .join(ProspectiveMember, ProspectElectionPackage.prospect_id == ProspectiveMember.id)
            .where(ProspectiveMember.organization_id == organization_id)
        )
        if pipeline_id:
            query = query.where(ProspectElectionPackage.pipeline_id == pipeline_id)
        if status_filter:
            query = query.where(ProspectElectionPackage.status == status_filter)

        query = query.order_by(ProspectElectionPackage.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())
