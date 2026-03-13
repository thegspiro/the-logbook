"""
Membership Pipeline Service

Business logic for prospective member pipeline management including
pipeline configuration, prospect tracking, step progression, and
transfer to full membership.
"""

import secrets
import string
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.membership_pipeline import (
    InterviewRecommendation,
    MembershipPipeline,
    MembershipPipelineStep,
    PipelineStepType,
    ProspectActivityLog,
    ProspectDocument,
    ProspectElectionPackage,
    ProspectEventLink,
    ProspectInterview,
    ProspectiveMember,
    ProspectStatus,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.event import Event
from app.models.user import Organization, User, UserStatus, generate_uuid
from app.utils.prospect_fields import (
    FIELD_TYPE_MAP as _SHARED_FIELD_TYPE_MAP,
    LABEL_MAP as _SHARED_LABEL_MAP,
    REQUIRED_PROSPECT_FIELDS as _SHARED_REQUIRED_FIELDS,
)


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
            .order_by(
                MembershipPipeline.is_default.desc(), MembershipPipeline.created_at
            )
        )
        if not include_templates:
            query = query.where(MembershipPipeline.is_template == False)  # noqa: E712
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_pipeline(
        self, pipeline_id: str, organization_id: str
    ) -> Optional[MembershipPipeline]:
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

    # Fields that may never be set via the generic update dict
    _PIPELINE_PROTECTED_FIELDS = frozenset(
        {
            "id",
            "organization_id",
            "created_by",
            "created_at",
            "updated_at",
            "steps",
            "prospects",
        }
    )

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
            if key in self._PIPELINE_PROTECTED_FIELDS:
                continue
            if value is not None and hasattr(pipeline, key):
                setattr(pipeline, key, value)

        await self.db.commit()
        return await self.get_pipeline(pipeline_id, organization_id)

    async def delete_pipeline(self, pipeline_id: str, organization_id: str) -> bool:
        """Delete a pipeline.

        Raises ``ValueError`` if active or on-hold prospects still
        reference this pipeline.  Cascades to steps; prospects with
        terminal statuses have their ``pipeline_id`` set to NULL.
        """
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        # Guard: refuse to delete if active prospects are attached.
        active_count_result = await self.db.execute(
            select(func.count()).where(
                ProspectiveMember.pipeline_id == pipeline_id,
                ProspectiveMember.status.in_(
                    [
                        ProspectStatus.ACTIVE,
                        ProspectStatus.ON_HOLD,
                    ]
                ),
            )
        )
        active_count = active_count_result.scalar() or 0
        if active_count > 0:
            raise ValueError(
                f"Cannot delete pipeline — {active_count} active/on-hold "
                f"prospect(s) are still assigned to it. Move or resolve "
                f"them before deleting."
            )

        await self.db.delete(pipeline)
        await self.db.commit()
        return True

    async def duplicate_pipeline(
        self,
        pipeline_id: str,
        organization_id: str,
        new_name: str,
        created_by: Optional[str] = None,
    ) -> Optional[MembershipPipeline]:
        """Duplicate a pipeline (useful for creating from templates)"""
        source = await self.get_pipeline(pipeline_id, organization_id)
        if not source:
            return None

        steps = [
            {
                "name": step.name,
                "description": step.description,
                "step_type": (
                    step.step_type.value
                    if isinstance(step.step_type, PipelineStepType)
                    else step.step_type
                ),
                "action_type": (
                    step.action_type.value
                    if step.action_type and hasattr(step.action_type, "value")
                    else step.action_type
                ),
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

        # If the step references a form, ensure a MEMBERSHIP_INTEREST
        # FormIntegration exists so form submissions auto-create prospects.
        config = data.get("config") or {}
        form_id = config.get("form_id")
        if form_id:
            await self._ensure_membership_form_integration(form_id, organization_id)

        return step

    _STEP_PROTECTED_FIELDS = frozenset(
        {
            "id",
            "pipeline_id",
            "created_at",
            "updated_at",
            "pipeline",
            "progress_records",
        }
    )

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

        # Capture the old form_id before applying updates so we can clean up
        # the integration if the step is being reassigned to a different form.
        old_config = step.config if isinstance(step.config, dict) else {}
        old_form_id = old_config.get("form_id")

        for key, value in data.items():
            if key in self._STEP_PROTECTED_FIELDS:
                continue
            if value is not None and hasattr(step, key):
                setattr(step, key, value)

        await self.db.commit()
        await self.db.refresh(step)

        # If the updated config references a form, ensure a
        # MEMBERSHIP_INTEREST FormIntegration exists.
        new_config = data.get("config") or (step.config if step.config else {})
        new_form_id = (
            new_config.get("form_id") if isinstance(new_config, dict) else None
        )
        if new_form_id:
            await self._ensure_membership_form_integration(new_form_id, organization_id)

        # If the form changed, clean up the old form's integration (if no
        # other step still references it).
        if old_form_id and old_form_id != new_form_id:
            await self._cleanup_orphaned_form_integration(old_form_id)

        return step

    async def delete_step(
        self, step_id: str, pipeline_id: str, organization_id: str
    ) -> bool:
        """Remove a step from a pipeline.

        If any active/on-hold prospects have this step as their
        ``current_step_id``, they are automatically advanced to the
        next step (or to the previous step if this is the last one)
        before the step is deleted.
        """
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return False

        step = next((s for s in pipeline.steps if s.id == step_id), None)
        if not step:
            return False

        # Auto-advance any prospects sitting on this step.
        stranded_result = await self.db.execute(
            select(ProspectiveMember).where(
                ProspectiveMember.current_step_id == step_id,
                ProspectiveMember.status.in_(
                    [
                        ProspectStatus.ACTIVE,
                        ProspectStatus.ON_HOLD,
                    ]
                ),
            )
        )
        stranded = list(stranded_result.scalars().all())

        if stranded:
            sorted_steps = sorted(pipeline.steps, key=lambda s: s.sort_order)
            step_idx = next(
                (i for i, s in enumerate(sorted_steps) if s.id == step_id),
                -1,
            )
            # Pick the next step, or the previous one if we're last.
            if step_idx >= 0 and step_idx < len(sorted_steps) - 1:
                fallback_step = sorted_steps[step_idx + 1]
            elif step_idx > 0:
                fallback_step = sorted_steps[step_idx - 1]
            else:
                fallback_step = None

            for prospect in stranded:
                prospect.current_step_id = fallback_step.id if fallback_step else None
                await self._log_activity(
                    prospect_id=prospect.id,
                    action="step_deleted_auto_moved",
                    details={
                        "deleted_step_id": step_id,
                        "deleted_step_name": step.name,
                        "moved_to_step_id": (
                            fallback_step.id if fallback_step else None
                        ),
                    },
                )

            await self.db.flush()

        # Capture form_id before deleting so we can clean up the integration.
        config = step.config if isinstance(step.config, dict) else {}
        form_id = config.get("form_id")

        await self.db.delete(step)
        await self.db.commit()

        # If the deleted step referenced a form, remove the auto-created
        # MEMBERSHIP integration — but only if no other step still uses it.
        if form_id:
            await self._cleanup_orphaned_form_integration(form_id)

        return True

    async def reorder_steps(
        self, pipeline_id: str, organization_id: str, step_ids: List[str]
    ) -> Optional[List[MembershipPipelineStep]]:
        """Reorder steps in a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # Use individual UPDATE statements instead of ORM attribute mutation
        # to avoid stale session state issues with the double-commit pattern
        # in get_session().
        for i, step_id in enumerate(step_ids):
            await self.db.execute(
                update(MembershipPipelineStep)
                .where(
                    and_(
                        MembershipPipelineStep.id == step_id,
                        MembershipPipelineStep.pipeline_id == pipeline_id,
                    )
                )
                .values(sort_order=i)
            )

        await self.db.flush()

        # Re-query steps from the database instead of refreshing individual
        # attributes on existing ORM objects.  In async SQLAlchemy, Core
        # UPDATE statements can leave other column attributes expired, and
        # partial refresh (only sort_order) doesn't reload them.  Accessing
        # those expired attributes during Pydantic response serialization
        # then triggers a lazy load which is unsupported in async contexts,
        # causing a MissingGreenlet / Internal Server Error.
        result = await self.db.execute(
            select(MembershipPipelineStep)
            .where(MembershipPipelineStep.pipeline_id == pipeline_id)
            .order_by(MembershipPipelineStep.sort_order)
        )
        return list(result.scalars().all())

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
            safe_search = (
                search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
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
        query = (
            query.order_by(ProspectiveMember.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(query)
        prospects = list(result.scalars().all())

        return prospects, total

    async def get_prospect(
        self, prospect_id: str, organization_id: str
    ) -> Optional[ProspectiveMember]:
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
                selectinload(ProspectiveMember.pipeline).selectinload(
                    MembershipPipeline.steps
                ),
                selectinload(ProspectiveMember.step_progress).selectinload(
                    ProspectStepProgress.step
                ),
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
        from sqlalchemy import or_

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

        result = await self.db.execute(select(User).where(*conditions))
        matches = result.scalars().all()

        return [
            {
                "user_id": str(m.id),
                "name": m.full_name,
                "email": m.email,
                "status": (
                    m.status.value if hasattr(m.status, "value") else str(m.status)
                ),
                "membership_number": m.membership_number,
                "archived_at": m.archived_at.isoformat() if m.archived_at else None,
                "match_type": (
                    "email" if m.email and m.email.lower() == email.lower() else "name"
                ),
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

        If an active prospect with the same email already exists in this
        organization, a duplicate notification email is sent to the
        applicant (with the department BCC'd) and the existing prospect
        is returned instead of creating a new record.
        """
        email = data.get("email", "").strip().lower()
        if email:
            existing = await self._find_active_prospect_by_email(organization_id, email)
            if existing:
                # Fire-and-forget: send duplicate notification email
                await self._notify_duplicate_application(existing, organization_id)
                logger.info(
                    f"Duplicate prospect detected for email {email} "
                    f"in org {organization_id} — returning existing "
                    f"prospect {existing.id}"
                )
                return existing

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
            desired_membership_type=data.get("desired_membership_type"),
            current_step_id=first_step_id,
            status=ProspectStatus.ACTIVE,
            metadata_=data.get("metadata_", {}),
            form_submission_id=data.get("form_submission_id"),
            notes=data.get("notes"),
            status_token=secrets.token_urlsafe(32),
            status_token_created_at=datetime.now(timezone.utc),
        )
        self.db.add(prospect)
        await self.db.flush()

        # Initialize step progress records for all steps in the pipeline
        if pipeline_id:
            await self._initialize_step_progress(
                prospect.id, pipeline_id, first_step_id
            )

        # Log the creation
        await self._log_activity(
            prospect_id=prospect.id,
            action="prospect_created",
            details={
                "source": (
                    "manual"
                    if not data.get("form_submission_id")
                    else "form_submission"
                )
            },
            performed_by=created_by,
        )

        await self.db.commit()
        return await self.get_prospect(prospect.id, organization_id)

    # Fields that may never be set via the generic update dict
    _PROSPECT_PROTECTED_FIELDS = frozenset(
        {
            "id",
            "organization_id",
            "pipeline_id",
            "current_step_id",
            "transferred_user_id",
            "transferred_at",
            "form_submission_id",
            "created_at",
            "updated_at",
            "step_progress",
            "activity_log",
            "pipeline",
            "current_step",
            "referrer",
            "transferred_user",
            "documents",
            "election_packages",
        }
    )

    async def update_prospect(
        self,
        prospect_id: str,
        organization_id: str,
        data: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> Optional[ProspectiveMember]:
        """Update a prospect's information"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        changes = {}
        for key, value in data.items():
            if key in self._PROSPECT_PROTECTED_FIELDS:
                continue
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

    async def _validate_step_completion(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
    ) -> None:
        """
        Validate that stage-specific requirements are met before allowing
        step completion. Raises ValueError if requirements are not satisfied.
        """
        config = step.config or {}
        step_type = step.step_type

        if step_type == PipelineStepType.INTERVIEW_REQUIREMENT:
            required_count = config.get("required_count", 1)
            required_rec = config.get("required_recommendation")
            interviews = [
                i
                for i in getattr(prospect, "interviews", [])
                if str(i.step_id) == str(step.id)
            ]
            if len(interviews) < required_count:
                raise ValueError(
                    f"This step requires at least {required_count} "
                    f"interview(s); only {len(interviews)} recorded."
                )
            if required_rec:
                matching = [
                    i
                    for i in interviews
                    if i.recommendation
                    and i.recommendation.value == required_rec
                ]
                if not matching:
                    raise ValueError(
                        f"At least one interview must have a "
                        f"'{required_rec}' recommendation."
                    )

        elif step_type == PipelineStepType.CHECKLIST:
            items = config.get("items", [])
            require_all = config.get("require_all", True)
            if require_all and items:
                progress = next(
                    (
                        p
                        for p in prospect.step_progress
                        if str(p.step_id) == str(step.id)
                    ),
                    None,
                )
                completed_items = (
                    (progress.action_result or {}).get("completed_items", [])
                    if progress
                    else []
                )
                if len(completed_items) < len(items):
                    raise ValueError(
                        f"All {len(items)} checklist items must be "
                        f"completed; only {len(completed_items)} done."
                    )

        elif step_type == PipelineStepType.MULTI_APPROVAL:
            required_approvers = config.get("required_approvers", [])
            if required_approvers:
                progress = next(
                    (
                        p
                        for p in prospect.step_progress
                        if str(p.step_id) == str(step.id)
                    ),
                    None,
                )
                approvals = (
                    (progress.action_result or {}).get("approvals", [])
                    if progress
                    else []
                )
                approved_roles = {a.get("role") for a in approvals}
                missing = [
                    r for r in required_approvers if r not in approved_roles
                ]
                if missing:
                    raise ValueError(
                        f"Approval still needed from: {', '.join(missing)}."
                    )

        elif step_type == PipelineStepType.REFERENCE_CHECK:
            required_count = config.get("required_count", 1)
            require_all = config.get("require_all_before_advance", True)
            if require_all:
                progress = next(
                    (
                        p
                        for p in prospect.step_progress
                        if str(p.step_id) == str(step.id)
                    ),
                    None,
                )
                references = (
                    (progress.action_result or {}).get("references", [])
                    if progress
                    else []
                )
                if len(references) < required_count:
                    raise ValueError(
                        f"This step requires at least {required_count} "
                        f"reference(s); only {len(references)} received."
                    )

        elif step_type == PipelineStepType.MEDICAL_SCREENING:
            required_screenings = config.get("required_screenings", [])
            require_all_passed = config.get("require_all_passed", True)
            if required_screenings and require_all_passed:
                from app.models.medical_screening import (
                    ScreeningRecord,
                    ScreeningStatus,
                )

                result = await self.db.execute(
                    select(ScreeningRecord).where(
                        and_(
                            ScreeningRecord.prospect_id == prospect.id,
                            ScreeningRecord.screening_type.in_(
                                required_screenings
                            ),
                            ScreeningRecord.status.in_(
                                [
                                    ScreeningStatus.PASSED,
                                    ScreeningStatus.COMPLETED,
                                ]
                            ),
                        )
                    )
                )
                records = result.scalars().all()
                passed_types = {r.screening_type.value for r in records}
                missing = [
                    s for s in required_screenings if s not in passed_types
                ]
                if missing:
                    raise ValueError(
                        f"Medical screenings not yet passed: "
                        f"{', '.join(missing)}."
                    )

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

        # Validate stage-specific requirements before allowing completion
        step = next(
            (s for s in prospect.pipeline.steps if str(s.id) == str(step_id)),
            None,
        )
        if step:
            await self._validate_step_completion(prospect, step)

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
        step = next(
            (s for s in prospect.pipeline.steps if str(s.id) == str(step_id)), None
        )
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
            (
                i
                for i, s in enumerate(sorted_steps)
                if str(s.id) == str(prospect.current_step_id)
            ),
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
            self.db.add(
                ProspectStepProgress(
                    id=generate_uuid(),
                    prospect_id=prospect_id,
                    step_id=next_step.id,
                    status=StepProgressStatus.IN_PROGRESS,
                )
            )

        # Auto-link event if the new step requires meeting attendance
        await self._auto_link_event_for_step(prospect, next_step)

        await self._log_activity(
            prospect_id=prospect_id,
            action="prospect_advanced",
            details={
                "to_step_id": str(next_step.id),
                "to_step_name": next_step.name,
                "notes": notes,
            },
            performed_by=advanced_by,
        )

        await self.db.commit()
        return await self.get_prospect(prospect_id, organization_id)

    async def _advance_current_step(
        self, prospect: ProspectiveMember, completed_step_id: str
    ):
        """After completing a step, move current_step_id to the next step"""
        if not prospect.pipeline:
            return

        sorted_steps = sorted(prospect.pipeline.steps, key=lambda s: s.sort_order)
        current_idx = next(
            (
                i
                for i, s in enumerate(sorted_steps)
                if str(s.id) == str(completed_step_id)
            ),
            -1,
        )

        if current_idx >= 0 and current_idx < len(sorted_steps) - 1:
            next_step = sorted_steps[current_idx + 1]
            prospect.current_step_id = next_step.id

            # Mark next step as in_progress
            next_progress = next(
                (
                    p
                    for p in prospect.step_progress
                    if str(p.step_id) == str(next_step.id)
                ),
                None,
            )
            if next_progress:
                next_progress.status = StepProgressStatus.IN_PROGRESS

            # Auto-link event if the new step requires meeting attendance
            await self._auto_link_event_for_step(prospect, next_step)

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
        send_welcome_email: bool = False,
        middle_name: Optional[str] = None,
        hire_date=None,
        emergency_contacts: Optional[List[Dict[str, Any]]] = None,
        membership_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Transfer a prospect to a full User record"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        if prospect.status == ProspectStatus.TRANSFERRED:
            return {
                "success": False,
                "message": "Prospect has already been transferred",
            }

        return await self._do_transfer(
            prospect,
            transferred_by,
            username,
            membership_id,
            rank,
            station,
            role_ids,
            send_welcome_email=send_welcome_email,
            middle_name=middle_name,
            hire_date=hire_date,
            emergency_contacts=emergency_contacts,
            membership_type=membership_type,
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
        send_welcome_email: bool = False,
        middle_name: Optional[str] = None,
        hire_date=None,
        emergency_contacts: Optional[List[Dict[str, Any]]] = None,
        membership_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Internal method to perform the actual transfer"""

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
                # Archived member found — recommend reactivation
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
                # Active or other status — block duplicate
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
            membership_id = await org_service.generate_next_membership_id(
                prospect.organization_id
            )

        # Generate a temporary password so the new member can log in.
        # The password is hashed before storage; the plaintext is only
        # kept in memory for the optional welcome email.
        from app.core.security import generate_temporary_password, hash_password

        temp_password = generate_temporary_password()
        password_hash = hash_password(temp_password)

        user_id = generate_uuid()
        new_user = User(
            id=user_id,
            organization_id=prospect.organization_id,
            username=username,
            email=prospect.email,
            password_hash=password_hash,
            first_name=prospect.first_name,
            middle_name=middle_name,
            last_name=prospect.last_name,
            phone=prospect.phone,
            mobile=prospect.mobile,
            date_of_birth=prospect.date_of_birth,
            hire_date=hire_date,
            address_street=prospect.address_street,
            address_city=prospect.address_city,
            address_state=prospect.address_state,
            address_zip=prospect.address_zip,
            emergency_contacts=emergency_contacts or [],
            membership_number=membership_id,
            rank=rank,
            station=station,
            status=UserStatus.ACTIVE,
            membership_type=membership_type or "probationary",
            must_change_password=True,
            # Preserve referral data from prospect
            referral_source=prospect.referral_source,
            interest_reason=prospect.interest_reason,
            referred_by_user_id=prospect.referred_by,
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

        transfer_details: Dict[str, Any] = {"user_id": user_id, "username": username}
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

        result_msg = (
            f"Prospect {prospect.full_name} transferred to membership as {username}"
        )
        if enrollment_result:
            result_msg += f". Auto-enrolled in training program: {enrollment_result['program_name']}"

        # Send welcome email with temporary credentials if requested
        welcome_email_sent = False
        if send_welcome_email:
            welcome_email_sent = await self._send_transfer_welcome_email(
                prospect=prospect,
                username=username,
                temp_password=temp_password,
                organization_id=prospect.organization_id,
            )

        return {
            "success": True,
            "prospect_id": prospect.id,
            "user_id": user_id,
            "membership_number": membership_number,
            "message": result_msg,
            "auto_enrollment": enrollment_result,
            "welcome_email_sent": welcome_email_sent,
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
            from app.models.training import (
                EnrollmentStatus,
                ProgramEnrollment,
                TrainingProgram,
            )
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
                    select(TrainingProgram)
                    .where(
                        TrainingProgram.organization_id == organization_id,
                        TrainingProgram.name.ilike("%probationary%"),
                        TrainingProgram.active == True,  # noqa: E712
                    )
                    .limit(1)
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

    async def _send_transfer_welcome_email(
        self,
        prospect: ProspectiveMember,
        username: str,
        temp_password: str,
        organization_id: str,
    ) -> bool:
        """Send welcome email with temporary credentials to a newly transferred member."""
        try:
            from app.core.config import settings
            from app.services.email_service import EmailService

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return False

            org_name = org.name or "The Logbook"
            login_url = (
                f"{settings.FRONTEND_URL}/login"
                if hasattr(settings, "FRONTEND_URL") and settings.FRONTEND_URL
                else "/login"
            )

            email_svc = EmailService(org)
            sent = await email_svc.send_welcome_email(
                to_email=prospect.email,
                first_name=prospect.first_name,
                last_name=prospect.last_name,
                username=username,
                temp_password=temp_password,
                organization_name=org_name,
                login_url=login_url,
                organization_id=organization_id,
            )
            return bool(sent)
        except Exception as e:
            logger.error(f"Failed to send welcome email to {prospect.email}: {e}")
            return False

    def _generate_username(self, first_name: str, last_name: str) -> str:
        """Generate a username from first and last name"""
        base = f"{first_name[0]}{last_name}".lower().replace(" ", "")
        # Add random suffix to avoid collisions
        suffix = "".join(secrets.choice(string.digits) for _ in range(3))
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
            step_prospects = [
                p for p in prospects if str(p.current_step_id) == str(step.id)
            ]
            columns.append(
                {
                    "step": step,
                    "prospects": step_prospects,
                    "count": len(step_prospects),
                }
            )

        # Add column for prospects with no current step
        unassigned = [p for p in prospects if not p.current_step_id]
        if unassigned:
            columns.insert(
                0,
                {
                    "step": None,
                    "prospects": unassigned,
                    "count": len(unassigned),
                },
            )

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

    async def seed_default_templates(
        self, organization_id: str, created_by: Optional[str] = None
    ):
        """Create default pipeline templates for an organization"""
        templates = [
            {
                "name": "Standard Membership Pipeline",
                "description": "A standard pipeline for processing new membership applications with bookended steps.",
                "steps": [
                    {
                        "name": "Interest Form Received",
                        "step_type": "checkbox",
                        "is_first_step": True,
                        "required": True,
                    },
                    {
                        "name": "Send Welcome Email",
                        "step_type": "action",
                        "action_type": "send_email",
                        "required": True,
                    },
                    {
                        "name": "Interest Meeting Attended",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Application Sent",
                        "step_type": "action",
                        "action_type": "send_email",
                        "required": True,
                    },
                    {
                        "name": "Application Received",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Background Check",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Interview Completed",
                        "step_type": "note",
                        "required": True,
                    },
                    {
                        "name": "Membership Vote",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Approved / Elected",
                        "step_type": "checkbox",
                        "is_final_step": True,
                        "required": True,
                    },
                ],
            },
            {
                "name": "Expedited Membership Pipeline",
                "description": "A shorter pipeline for lateral transfers or expedited membership approvals.",
                "steps": [
                    {
                        "name": "Application Received",
                        "step_type": "checkbox",
                        "is_first_step": True,
                        "required": True,
                    },
                    {
                        "name": "Credentials Verified",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Interview Completed",
                        "step_type": "note",
                        "required": True,
                    },
                    {
                        "name": "Approved / Elected",
                        "step_type": "checkbox",
                        "is_final_step": True,
                        "required": True,
                    },
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

    async def _get_default_pipeline(
        self, organization_id: str
    ) -> Optional[MembershipPipeline]:
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
            status = (
                StepProgressStatus.IN_PROGRESS
                if str(step.id) == str(first_step_id)
                else StepProgressStatus.PENDING
            )
            progress = ProspectStepProgress(
                id=generate_uuid(),
                prospect_id=prospect_id,
                step_id=step.id,
                status=status,
            )
            self.db.add(progress)

    # =========================================================================
    # Duplicate Detection
    # =========================================================================

    async def _find_active_prospect_by_email(
        self, organization_id: str, email: str
    ) -> Optional[ProspectiveMember]:
        """Return an existing active/pending prospect with the given email."""
        result = await self.db.execute(
            select(ProspectiveMember)
            .where(
                and_(
                    ProspectiveMember.organization_id == organization_id,
                    func.lower(ProspectiveMember.email) == email.lower(),
                    ProspectiveMember.status.in_(
                        [
                            ProspectStatus.ACTIVE,
                        ]
                    ),
                )
            )
            .order_by(ProspectiveMember.created_at)
            .limit(1)
        )
        return result.scalars().first()

    async def _notify_duplicate_application(
        self, existing_prospect: ProspectiveMember, organization_id: str
    ) -> None:
        """Send a duplicate-application notification email to the applicant.

        The organization's contact email is BCC'd so leadership is aware.
        """
        try:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return

            from app.services.email_service import EmailService

            email_svc = EmailService(org)

            # Format the original application date
            original_date = "unknown"
            if existing_prospect.created_at:
                original_date = existing_prospect.created_at.strftime("%B %d, %Y")

            applicant_name = (
                f"{existing_prospect.first_name} {existing_prospect.last_name}"
            )

            # BCC the department's email so they know a duplicate came in
            bcc = [org.email] if org.email else None

            await email_svc.send_duplicate_application_email(
                to_email=existing_prospect.email,
                applicant_name=applicant_name,
                organization_name=org.name or "the department",
                original_date=original_date,
                bcc_emails=bcc,
                db=self.db,
                organization_id=organization_id,
            )

            # Log the duplicate attempt on the existing prospect's activity
            await self._log_activity(
                prospect_id=existing_prospect.id,
                action="duplicate_application_detected",
                details={
                    "notification_sent_to": existing_prospect.email,
                    "department_bcc": bool(bcc),
                },
            )
            await self.db.commit()

        except Exception as e:
            logger.warning(
                f"Failed to send duplicate application notification for "
                f"{existing_prospect.email}: {e}"
            )

    # -- Label-to-prospect-field mapping (shared source of truth) --
    # Re-exported from app.utils.prospect_fields as class attrs so
    # that existing references (e.g. FormsService._LABEL_MAP) still work.
    _LABEL_MAP: Dict[str, str] = _SHARED_LABEL_MAP
    _FIELD_TYPE_MAP: Dict[str, str] = _SHARED_FIELD_TYPE_MAP
    _REQUIRED_PROSPECT_FIELDS: set[str] = _SHARED_REQUIRED_FIELDS

    async def validate_form_for_pipeline(self, form_id: str) -> Dict[str, Any]:
        """Check whether a form's fields can be mapped to prospect data.

        Returns a dict describing which prospect fields are mapped,
        which required ones are missing, and suggestions for fixing any
        gaps.  The frontend calls this when the user picks a form in the
        pipeline-stage config modal so they get immediate feedback.
        """
        from app.models.forms import FormField

        fields_result = await self.db.execute(
            select(FormField).where(FormField.form_id == str(form_id))
        )
        fields = list(fields_result.scalars().all())

        if not fields:
            return {
                "valid": False,
                "mapped_fields": {},
                "missing_required": sorted(self._REQUIRED_PROSPECT_FIELDS),
                "suggestions": [
                    "This form has no fields. Add fields for First Name, "
                    "Last Name, and Email before using it in a pipeline."
                ],
            }

        # Build mapping using the same logic as _ensure_membership_form_integration.
        mapped: Dict[str, Dict[str, str]] = {}  # target -> {field_id, label, method}
        used_targets: set[str] = set()

        # Pass 1 — match by label.
        for field in fields:
            normalised = field.label.strip().lower()
            target = self._LABEL_MAP.get(normalised)
            if target and target not in used_targets:
                mapped[target] = {
                    "field_id": str(field.id),
                    "label": field.label,
                    "method": "label",
                }
                used_targets.add(target)

        # Pass 2 — match by field_type.
        for field in fields:
            if str(field.id) in {m["field_id"] for m in mapped.values()}:
                continue
            ft = field.field_type
            if hasattr(ft, "value"):
                ft = ft.value
            target = self._FIELD_TYPE_MAP.get(ft)
            if target and target not in used_targets:
                mapped[target] = {
                    "field_id": str(field.id),
                    "label": field.label,
                    "method": "field_type",
                }
                used_targets.add(target)

        missing = sorted(self._REQUIRED_PROSPECT_FIELDS - used_targets)
        suggestions: list[str] = []
        if missing:
            friendly = {
                "first_name": "First Name",
                "last_name": "Last Name",
                "email": "Email",
            }
            names = [friendly.get(f, f) for f in missing]
            suggestions.append(
                f"Add or rename fields so the form includes: "
                f"{', '.join(names)}. "
                f"Recognized labels include: "
                + ", ".join(
                    f'"{lbl}"'
                    for lbl, tgt in sorted(self._LABEL_MAP.items())
                    if tgt in missing
                )
                + "."
            )

        return {
            "valid": len(missing) == 0,
            "mapped_fields": mapped,
            "missing_required": missing,
            "suggestions": suggestions,
        }

    async def _ensure_membership_form_integration(
        self, form_id: str, organization_id: str
    ) -> None:
        """Mark *form_id* as a membership-interest form.

        Preferred path: set ``form.integration_type`` directly so the
        forms service uses label-based mapping at submission time
        without needing a ``FormIntegration`` record.

        Legacy fallback: if the form already has a ``FormIntegration``
        for membership, ensure its ``field_mappings`` are healthy.
        """
        from app.models.forms import (
            Form,
            FormField,
            FormIntegration,
            IntegrationTarget,
            IntegrationType,
        )

        # ---- Direct path: stamp integration_type on the form ----
        form_result = await self.db.execute(select(Form).where(Form.id == str(form_id)))
        form = form_result.scalars().first()
        if form is None:
            logger.warning(
                f"Cannot set integration_type for form {form_id}: form not found"
            )
            return

        if not form.integration_type:
            form.integration_type = IntegrationType.MEMBERSHIP_INTEREST
            await self.db.commit()
            logger.info(f"Set integration_type=membership_interest on form {form_id}")
            return

        if form.integration_type == IntegrationType.MEMBERSHIP_INTEREST:
            return  # Already configured — nothing to do.

        # ---- Legacy fallback: repair FormIntegration if present ----
        existing_result = await self.db.execute(
            select(FormIntegration).where(
                and_(
                    FormIntegration.form_id == str(form_id),
                    FormIntegration.target_module == IntegrationTarget.MEMBERSHIP,
                )
            )
        )
        existing_integration = existing_result.scalars().first()

        fields_result = await self.db.execute(
            select(FormField).where(FormField.form_id == str(form_id))
        )
        fields = list(fields_result.scalars().all())
        if not fields:
            logger.warning(
                f"Cannot auto-create membership integration for form {form_id}: "
                "form has no fields"
            )
            return

        field_mappings: Dict[str, str] = {}
        used_targets: set[str] = set()

        for field in fields:
            normalised = field.label.strip().lower()
            target = self._LABEL_MAP.get(normalised)
            if target and target not in used_targets:
                field_mappings[str(field.id)] = target
                used_targets.add(target)

        for field in fields:
            if str(field.id) in field_mappings:
                continue
            ft = field.field_type
            if hasattr(ft, "value"):
                ft = ft.value
            target = self._FIELD_TYPE_MAP.get(ft)
            if target and target not in used_targets:
                field_mappings[str(field.id)] = target
                used_targets.add(target)

        if not field_mappings:
            logger.warning(
                f"Cannot auto-create membership integration for form {form_id}: "
                "could not map any fields to prospect fields"
            )
            return

        missing = {"first_name", "last_name", "email"} - used_targets

        if existing_integration is not None:
            current_mappings = existing_integration.field_mappings or {}
            current_field_ids = set(current_mappings.keys())
            form_field_ids = {str(f.id) for f in fields}
            current_targets = set(current_mappings.values())
            covers_required = self._REQUIRED_PROSPECT_FIELDS <= current_targets
            has_valid_ids = (
                bool(current_field_ids) and current_field_ids <= form_field_ids
            )

            if covers_required and has_valid_ids:
                return

            existing_integration.field_mappings = field_mappings
            await self.db.commit()
            logger.info(
                f"Repaired MEMBERSHIP_INTEREST integration for form {form_id}: "
                f"updated field_mappings ({len(current_mappings)} → "
                f"{len(field_mappings)} mapping(s))"
            )
            return

        if missing:
            logger.warning(
                f"Auto-created membership integration for form {form_id} is "
                f"missing required mappings: {missing}. Prospects will not be "
                "auto-created until the integration field_mappings are updated."
            )

        integration = FormIntegration(
            id=generate_uuid(),
            form_id=str(form_id),
            organization_id=organization_id,
            target_module=IntegrationTarget.MEMBERSHIP,
            integration_type=IntegrationType.MEMBERSHIP_INTEREST,
            field_mappings=field_mappings,
            is_active=True,
        )
        self.db.add(integration)
        try:
            await self.db.commit()
        except Exception:
            # A concurrent call may have created the integration between our
            # existence check and this INSERT (the unique constraint on
            # (form_id, target_module) prevents duplicates).  Roll back and
            # let the other copy stand.
            await self.db.rollback()
            logger.info(
                f"MEMBERSHIP_INTEREST integration for form {form_id} already "
                "created by a concurrent request — skipping."
            )
            return

        logger.info(
            f"Auto-created MEMBERSHIP_INTEREST integration for form {form_id} "
            f"with {len(field_mappings)} field mapping(s)"
        )

    async def _cleanup_orphaned_form_integration(self, form_id: str) -> None:
        """Remove the MEMBERSHIP_INTEREST FormIntegration for *form_id* if no
        other pipeline step still references it in its config."""
        from app.models.forms import FormIntegration, IntegrationTarget

        # Check if any remaining step still references this form_id via a
        # targeted JSON query (MySQL JSON_UNQUOTE(JSON_EXTRACT(...))).
        str_form_id = str(form_id)
        step_count_result = await self.db.execute(
            select(func.count(MembershipPipelineStep.id)).where(
                func.json_unquote(
                    func.json_extract(MembershipPipelineStep.config, "$.form_id")
                )
                == str_form_id
            )
        )
        if (step_count_result.scalar() or 0) > 0:
            return  # Another step still uses this form — keep the integration.

        result = await self.db.execute(
            select(FormIntegration).where(
                and_(
                    FormIntegration.form_id == str(form_id),
                    FormIntegration.target_module == IntegrationTarget.MEMBERSHIP,
                )
            )
        )
        integration = result.scalars().first()
        if integration is not None:
            await self.db.delete(integration)
            await self.db.commit()
            logger.info(
                f"Removed orphaned MEMBERSHIP_INTEREST integration for form {form_id}"
            )

    # =========================================================================
    # Pipeline Statistics
    # =========================================================================

    async def get_pipeline_stats(
        self, pipeline_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get statistics for a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # Count prospects by status
        status_counts = {}
        for status_val in ProspectStatus:
            count_query = select(func.count(ProspectiveMember.id)).where(
                and_(
                    ProspectiveMember.pipeline_id == pipeline_id,
                    ProspectiveMember.status == status_val,
                )
            )
            result = await self.db.execute(count_query)
            status_counts[status_val.value] = result.scalar() or 0

        total = sum(status_counts.values())

        # Count prospects by current step
        by_step = []
        for step in sorted(pipeline.steps, key=lambda s: s.sort_order):
            step_count_query = select(func.count(ProspectiveMember.id)).where(
                and_(
                    ProspectiveMember.pipeline_id == pipeline_id,
                    ProspectiveMember.current_step_id == step.id,
                    ProspectiveMember.status == ProspectStatus.ACTIVE,
                )
            )
            result = await self.db.execute(step_count_query)
            by_step.append(
                {
                    "stage_id": step.id,
                    "stage_name": step.name,
                    "count": result.scalar() or 0,
                }
            )

        # Calculate avg days to transfer
        avg_days = None
        transferred_count = status_counts.get("transferred", 0)
        if transferred_count > 0:
            avg_query = select(
                func.avg(
                    func.datediff(
                        ProspectiveMember.transferred_at,
                        ProspectiveMember.created_at,
                    )
                )
            ).where(
                and_(
                    ProspectiveMember.pipeline_id == pipeline_id,
                    ProspectiveMember.status == ProspectStatus.TRANSFERRED,
                    ProspectiveMember.transferred_at.isnot(None),
                )
            )
            result = await self.db.execute(avg_query)
            avg_days = result.scalar()

        conversion_rate = (transferred_count / total * 100) if total > 0 else 0

        return {
            "pipeline_id": pipeline_id,
            "total_prospects": total,
            "active_count": status_counts.get("active", 0),
            "approved_count": status_counts.get("approved", 0),
            "rejected_count": status_counts.get("rejected", 0),
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
        import os

        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # Validate file_path: must be under the expected uploads directory
        # and must not contain path traversal sequences.
        normalized = os.path.normpath(file_path)
        if ".." in normalized or not normalized.startswith("/uploads/"):
            raise ValueError(
                "Invalid file_path: must be under /uploads/ and may not contain path traversal"
            )

        # Sanitise file_name to prevent path injection through the file name
        safe_file_name = os.path.basename(file_name)

        doc = ProspectDocument(
            id=generate_uuid(),
            prospect_id=prospect_id,
            step_id=step_id,
            document_type=document_type,
            file_name=safe_file_name,
            file_path=normalized,
            file_size=file_size,
            mime_type=mime_type,
            uploaded_by=uploaded_by,
        )
        self.db.add(doc)

        await self._log_activity(
            prospect_id=prospect_id,
            action="document_uploaded",
            details={"document_type": document_type, "file_name": safe_file_name},
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

        query = select(ProspectDocument).where(
            and_(
                ProspectDocument.id == document_id,
                ProspectDocument.prospect_id == prospect_id,
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

        # Build applicant snapshot — capture all relevant prospect data
        # so the election package is self-contained even if the prospect
        # record is later modified.
        snapshot = {
            "first_name": prospect.first_name,
            "last_name": prospect.last_name,
            "email": prospect.email,
            "phone": prospect.phone,
            "mobile": prospect.mobile,
            "date_of_birth": (
                str(prospect.date_of_birth) if prospect.date_of_birth else None
            ),
            "address_street": prospect.address_street,
            "address_city": prospect.address_city,
            "address_state": prospect.address_state,
            "address_zip": prospect.address_zip,
            "interest_reason": prospect.interest_reason,
            "referral_source": prospect.referral_source,
            "notes": prospect.notes,
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

    _ELECTION_PKG_PROTECTED_FIELDS = frozenset(
        {
            "id",
            "prospect_id",
            "pipeline_id",
            "election_id",
            "created_at",
            "updated_at",
            "prospect",
            "pipeline",
            "step",
        }
    )

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
            if key in self._ELECTION_PKG_PROTECTED_FIELDS:
                continue
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
            .join(
                ProspectiveMember,
                ProspectElectionPackage.prospect_id == ProspectiveMember.id,
            )
            .where(ProspectiveMember.organization_id == organization_id)
        )
        if pipeline_id:
            query = query.where(ProspectElectionPackage.pipeline_id == pipeline_id)
        if status_filter:
            query = query.where(ProspectElectionPackage.status == status_filter)

        query = query.order_by(ProspectElectionPackage.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    # =========================================================================
    # Public Status Check
    # =========================================================================

    # Status tokens expire after 30 days to limit exposure if leaked.
    _STATUS_TOKEN_TTL_DAYS = 30

    async def get_prospect_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Look up a prospect by their public status token. Returns limited public-safe fields.

        Returns None if the pipeline has public_status_enabled=False,
        if the token has expired, or if no match is found.
        Only steps with public_visible=True are included in the timeline.

        On each successful lookup the token is rotated and the new
        token is included in the response so the caller can update
        their bookmark.
        """
        query = (
            select(ProspectiveMember)
            .where(ProspectiveMember.status_token == token)
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline).selectinload(
                    MembershipPipeline.steps
                ),
                selectinload(ProspectiveMember.step_progress).selectinload(
                    ProspectStepProgress.step
                ),
            )
        )
        result = await self.db.execute(query)
        prospect = result.scalars().first()
        if not prospect:
            return None

        # Check token expiration
        from datetime import timedelta

        if prospect.status_token_created_at:
            age = datetime.now(timezone.utc) - prospect.status_token_created_at
            if age > timedelta(days=self._STATUS_TOKEN_TTL_DAYS):
                logger.info(
                    f"Status token for prospect {prospect.id} expired "
                    f"({age.days} days old)"
                )
                return None

        # Check if the pipeline has opted in to public status pages
        if not prospect.pipeline or not prospect.pipeline.public_status_enabled:
            return None

        # Rotate the token so the old one becomes invalid.
        new_token = secrets.token_urlsafe(32)
        prospect.status_token = new_token
        prospect.status_token_created_at = datetime.now(timezone.utc)

        # Collect IDs of steps marked as public_visible
        public_step_ids = set()
        if prospect.pipeline and prospect.pipeline.steps:
            for step in prospect.pipeline.steps:
                if step.public_visible:
                    public_step_ids.add(str(step.id))

        # Build stage timeline — only include public-visible steps
        completed_stages = []
        if prospect.step_progress:
            for sp in sorted(prospect.step_progress, key=lambda p: p.created_at):
                if str(sp.step_id) not in public_step_ids:
                    continue
                completed_stages.append(
                    {
                        "stage_name": sp.step.name if sp.step else "Unknown",
                        "status": (
                            sp.status.value
                            if hasattr(sp.status, "value")
                            else sp.status
                        ),
                        "completed_at": (
                            sp.completed_at.isoformat() if sp.completed_at else None
                        ),
                    }
                )

        total_public_stages = len(public_step_ids)

        # Current stage name — only show if it's public_visible
        current_stage_name = None
        if prospect.current_step and str(prospect.current_step.id) in public_step_ids:
            current_stage_name = prospect.current_step.name

        await self.db.commit()

        return {
            "first_name": prospect.first_name,
            "last_name": prospect.last_name,
            "status": (
                prospect.status.value
                if hasattr(prospect.status, "value")
                else prospect.status
            ),
            "current_stage_name": current_stage_name,
            "pipeline_name": prospect.pipeline.name if prospect.pipeline else None,
            "total_stages": total_public_stages,
            "stage_timeline": completed_stages,
            "applied_at": (
                prospect.created_at.isoformat() if prospect.created_at else None
            ),
            # Rotated token — caller should update their bookmark.
            "status_token": new_token,
        }

    # =========================================================================
    # Inactivity Detection
    # =========================================================================

    async def check_inactivity(self, organization_id: str) -> List[Dict[str, Any]]:
        """
        Find all active prospects that have exceeded their pipeline or step
        inactivity thresholds. Returns a list of prospects with their alert level.
        """

        # Get all active prospects for this org
        query = (
            select(ProspectiveMember)
            .where(
                and_(
                    ProspectiveMember.organization_id == organization_id,
                    ProspectiveMember.status == ProspectStatus.ACTIVE,
                )
            )
            .options(
                selectinload(ProspectiveMember.pipeline),
                selectinload(ProspectiveMember.current_step),
            )
        )
        result = await self.db.execute(query)
        prospects = list(result.scalars().all())

        warnings = []
        now = datetime.now(timezone.utc)

        for prospect in prospects:
            # Determine effective timeout
            timeout_days = None

            # Step-level override takes precedence
            if prospect.current_step and prospect.current_step.inactivity_timeout_days:
                timeout_days = prospect.current_step.inactivity_timeout_days
            elif prospect.pipeline and prospect.pipeline.inactivity_config:
                config = prospect.pipeline.inactivity_config
                preset = config.get("timeout_preset", "3_months")
                if preset == "never":
                    continue
                elif preset == "custom":
                    timeout_days = config.get("custom_timeout_days")
                else:
                    preset_map = {"3_months": 90, "6_months": 180, "1_year": 365}
                    timeout_days = preset_map.get(preset)

            if not timeout_days:
                continue

            days_inactive = (now - (prospect.updated_at or prospect.created_at)).days
            warning_pct = 80  # default warning at 80%
            if prospect.pipeline and prospect.pipeline.inactivity_config:
                warning_pct = prospect.pipeline.inactivity_config.get(
                    "warning_threshold_percent", 80
                )

            warning_threshold = int(timeout_days * warning_pct / 100)

            if days_inactive >= timeout_days:
                alert_level = "critical"
            elif days_inactive >= warning_threshold:
                alert_level = "warning"
            else:
                continue  # Not yet at warning level

            warnings.append(
                {
                    "prospect_id": str(prospect.id),
                    "prospect_name": prospect.full_name,
                    "prospect_email": prospect.email,
                    "current_stage": (
                        prospect.current_step.name if prospect.current_step else None
                    ),
                    "pipeline_name": (
                        prospect.pipeline.name if prospect.pipeline else None
                    ),
                    "days_inactive": days_inactive,
                    "timeout_days": timeout_days,
                    "alert_level": alert_level,
                }
            )

        return warnings

    async def process_inactivity_warnings(
        self, organization_id: str, processed_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process inactivity warnings: mark critical prospects as inactive,
        send coordinator emails for warnings.
        Returns count of warnings and actions taken.
        """
        warnings = await self.check_inactivity(organization_id)
        warning_count = 0
        inactive_count = 0

        for w in warnings:
            prospect_id = w["prospect_id"]

            if w["alert_level"] == "critical":
                # Check if we already logged an inactivity warning recently
                recent_log = await self.db.execute(
                    select(ProspectActivityLog)
                    .where(
                        and_(
                            ProspectActivityLog.prospect_id == prospect_id,
                            ProspectActivityLog.action == "marked_inactive_by_system",
                        )
                    )
                    .limit(1)
                )
                if not recent_log.scalars().first():
                    # Mark as inactive
                    await self.db.execute(
                        update(ProspectiveMember)
                        .where(ProspectiveMember.id == prospect_id)
                        .values(status=ProspectStatus.INACTIVE)
                    )
                    await self._log_activity(
                        prospect_id=prospect_id,
                        action="marked_inactive_by_system",
                        details={
                            "days_inactive": w["days_inactive"],
                            "timeout_days": w["timeout_days"],
                        },
                        performed_by=processed_by,
                    )
                    inactive_count += 1
            else:
                # Warning level — log it (email would be sent here)
                recent_warning = await self.db.execute(
                    select(ProspectActivityLog)
                    .where(
                        and_(
                            ProspectActivityLog.prospect_id == prospect_id,
                            ProspectActivityLog.action == "inactivity_warning_sent",
                        )
                    )
                    .order_by(ProspectActivityLog.created_at.desc())
                    .limit(1)
                )
                existing_warning = recent_warning.scalars().first()
                # Only warn once per 7-day period
                warning_created = (
                    existing_warning.created_at.replace(tzinfo=timezone.utc)
                    if existing_warning
                    and existing_warning.created_at
                    and existing_warning.created_at.tzinfo is None
                    else (
                        existing_warning.created_at
                        if existing_warning and existing_warning.created_at
                        else None
                    )
                )
                if (
                    not existing_warning
                    or not warning_created
                    or (datetime.now(timezone.utc) - warning_created).days >= 7
                ):
                    await self._log_activity(
                        prospect_id=prospect_id,
                        action="inactivity_warning_sent",
                        details={
                            "days_inactive": w["days_inactive"],
                            "timeout_days": w["timeout_days"],
                            "alert_level": w["alert_level"],
                        },
                        performed_by=processed_by,
                    )
                    warning_count += 1

        if warning_count > 0 or inactive_count > 0:
            await self.db.commit()

        return {
            "warnings_sent": warning_count,
            "marked_inactive": inactive_count,
            "total_checked": len(warnings),
        }

    # =========================================================================
    # Interview Management
    # =========================================================================

    async def list_interviews(
        self,
        prospect_id: str,
        organization_id: str,
    ) -> List[ProspectInterview]:
        """List all interviews for a prospect."""
        # Verify prospect belongs to org
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            raise ValueError("Prospect not found")

        result = await self.db.execute(
            select(ProspectInterview)
            .where(ProspectInterview.prospect_id == prospect_id)
            .options(selectinload(ProspectInterview.interviewer))
            .order_by(ProspectInterview.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_interview(
        self,
        interview_id: str,
        organization_id: str,
    ) -> Optional[ProspectInterview]:
        """Get a single interview by ID, verifying org access."""
        result = await self.db.execute(
            select(ProspectInterview)
            .join(
                ProspectiveMember,
                ProspectInterview.prospect_id == ProspectiveMember.id,
            )
            .where(
                ProspectInterview.id == interview_id,
                ProspectiveMember.organization_id == organization_id,
            )
            .options(selectinload(ProspectInterview.interviewer))
        )
        return result.scalar_one_or_none()

    async def create_interview(
        self,
        prospect_id: str,
        organization_id: str,
        interviewer_id: str,
        notes: Optional[str] = None,
        recommendation: Optional[str] = None,
        recommendation_notes: Optional[str] = None,
        interviewer_role: Optional[str] = None,
        interview_date: Optional[datetime] = None,
        step_id: Optional[str] = None,
    ) -> ProspectInterview:
        """Create an interview record for a prospect."""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            raise ValueError("Prospect not found")

        rec_enum = None
        if recommendation:
            try:
                rec_enum = InterviewRecommendation(recommendation)
            except ValueError:
                raise ValueError(
                    f"Invalid recommendation: {recommendation}. "
                    "Must be one of: recommend, recommend_with_reservations, "
                    "do_not_recommend, undecided"
                )

        interview = ProspectInterview(
            id=generate_uuid(),
            prospect_id=prospect_id,
            pipeline_id=str(prospect.pipeline_id) if prospect.pipeline_id else None,
            step_id=step_id
            or (str(prospect.current_step_id) if prospect.current_step_id else None),
            interviewer_id=interviewer_id,
            interviewer_role=interviewer_role,
            notes=notes,
            recommendation=rec_enum,
            recommendation_notes=recommendation_notes,
            interview_date=interview_date or datetime.now(timezone.utc),
        )
        self.db.add(interview)

        await self._log_activity(
            prospect_id=prospect_id,
            action="interview_submitted",
            details={
                "interviewer_id": interviewer_id,
                "interviewer_role": interviewer_role,
                "recommendation": recommendation,
            },
            performed_by=interviewer_id,
        )

        await self.db.commit()

        # Re-fetch to get relationships loaded
        return await self.get_interview(interview.id, organization_id)  # type: ignore[return-value]

    async def update_interview(
        self,
        interview_id: str,
        organization_id: str,
        interviewer_id: str,
        notes: Optional[str] = None,
        recommendation: Optional[str] = None,
        recommendation_notes: Optional[str] = None,
        interviewer_role: Optional[str] = None,
        interview_date: Optional[datetime] = None,
    ) -> Optional[ProspectInterview]:
        """Update an interview. Only the original interviewer can update."""
        interview = await self.get_interview(interview_id, organization_id)
        if not interview:
            raise ValueError("Interview not found")

        if str(interview.interviewer_id) != str(interviewer_id):
            raise ValueError("Only the original interviewer can update this interview")

        if notes is not None:
            interview.notes = notes
        if recommendation is not None:
            try:
                interview.recommendation = InterviewRecommendation(recommendation)
            except ValueError:
                raise ValueError(f"Invalid recommendation: {recommendation}")
        if recommendation_notes is not None:
            interview.recommendation_notes = recommendation_notes
        if interviewer_role is not None:
            interview.interviewer_role = interviewer_role
        if interview_date is not None:
            interview.interview_date = interview_date

        await self._log_activity(
            prospect_id=str(interview.prospect_id),
            action="interview_updated",
            details={
                "interview_id": interview_id,
                "interviewer_id": interviewer_id,
            },
            performed_by=interviewer_id,
        )

        await self.db.commit()
        return await self.get_interview(interview_id, organization_id)

    async def delete_interview(
        self,
        interview_id: str,
        organization_id: str,
        deleted_by: str,
    ) -> bool:
        """Delete an interview record."""
        interview = await self.get_interview(interview_id, organization_id)
        if not interview:
            return False

        prospect_id = str(interview.prospect_id)
        await self.db.execute(
            delete(ProspectInterview).where(ProspectInterview.id == interview_id)
        )

        await self._log_activity(
            prospect_id=prospect_id,
            action="interview_deleted",
            details={"interview_id": interview_id},
            performed_by=deleted_by,
        )

        await self.db.commit()
        return True

    # =========================================================================
    # Event Links
    # =========================================================================

    async def list_event_links(
        self,
        prospect_id: str,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """List all event links for a prospect, enriched with event details."""
        # Verify prospect belongs to org
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            raise ValueError("Prospect not found")

        query = (
            select(ProspectEventLink)
            .where(ProspectEventLink.prospect_id == prospect_id)
            .order_by(ProspectEventLink.created_at.desc())
        )
        result = await self.db.execute(query)
        links = list(result.scalars().all())

        enriched: List[Dict[str, Any]] = []
        for link in links:
            event_result = await self.db.execute(
                select(Event).where(Event.id == link.event_id)
            )
            event = event_result.scalar_one_or_none()

            linker_name = None
            if link.linked_by:
                linker_result = await self.db.execute(
                    select(User).where(User.id == link.linked_by)
                )
                linker = linker_result.scalar_one_or_none()
                if linker:
                    linker_name = (
                        f"{linker.first_name} {linker.last_name}".strip()
                    )

            enriched.append(
                {
                    "id": link.id,
                    "prospect_id": link.prospect_id,
                    "event_id": link.event_id,
                    "event_title": event.title if event else None,
                    "event_type": (
                        event.event_type.value
                        if event and event.event_type
                        else None
                    ),
                    "custom_category": (
                        event.custom_category if event else None
                    ),
                    "event_start": event.start_datetime if event else None,
                    "event_end": event.end_datetime if event else None,
                    "event_location": event.location if event else None,
                    "is_cancelled": event.is_cancelled if event else False,
                    "notes": link.notes,
                    "linked_by": link.linked_by,
                    "linked_by_name": linker_name,
                    "created_at": link.created_at,
                }
            )
        return enriched

    async def link_event(
        self,
        prospect_id: str,
        event_id: str,
        organization_id: str,
        linked_by: str,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Link an event to a prospect."""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            raise ValueError("Prospect not found")

        # Verify event exists and belongs to same org
        event_result = await self.db.execute(
            select(Event).where(
                and_(
                    Event.id == event_id,
                    Event.organization_id == organization_id,
                )
            )
        )
        event = event_result.scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        # Check for duplicate link
        existing = await self.db.execute(
            select(ProspectEventLink).where(
                and_(
                    ProspectEventLink.prospect_id == prospect_id,
                    ProspectEventLink.event_id == event_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("Event is already linked to this prospect")

        link = ProspectEventLink(
            id=generate_uuid(),
            prospect_id=prospect_id,
            event_id=event_id,
            notes=notes,
            linked_by=linked_by,
        )
        self.db.add(link)

        await self._log_activity(
            prospect_id=prospect_id,
            action="event_linked",
            details={
                "event_id": event_id,
                "event_title": event.title,
            },
            performed_by=linked_by,
        )

        await self.db.commit()

        # Return enriched response
        linker_result = await self.db.execute(
            select(User).where(User.id == linked_by)
        )
        linker = linker_result.scalar_one_or_none()
        linker_name = (
            f"{linker.first_name} {linker.last_name}".strip()
            if linker
            else None
        )

        return {
            "id": link.id,
            "prospect_id": link.prospect_id,
            "event_id": link.event_id,
            "event_title": event.title,
            "event_type": (
                event.event_type.value if event.event_type else None
            ),
            "custom_category": event.custom_category,
            "event_start": event.start_datetime,
            "event_end": event.end_datetime,
            "event_location": event.location,
            "is_cancelled": event.is_cancelled,
            "notes": link.notes,
            "linked_by": link.linked_by,
            "linked_by_name": linker_name,
            "created_at": link.created_at,
        }

    async def unlink_event(
        self,
        prospect_id: str,
        link_id: str,
        organization_id: str,
        unlinked_by: str,
    ) -> bool:
        """Remove an event link from a prospect."""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return False

        result = await self.db.execute(
            select(ProspectEventLink).where(
                and_(
                    ProspectEventLink.id == link_id,
                    ProspectEventLink.prospect_id == prospect_id,
                )
            )
        )
        link = result.scalar_one_or_none()
        if not link:
            return False

        event_id = link.event_id
        await self.db.execute(
            delete(ProspectEventLink).where(ProspectEventLink.id == link_id)
        )

        await self._log_activity(
            prospect_id=prospect_id,
            action="event_unlinked",
            details={"event_id": event_id, "link_id": link_id},
            performed_by=unlinked_by,
        )

        await self.db.commit()
        return True

    async def _auto_link_event_for_step(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
    ) -> None:
        """
        Auto-link the next upcoming event when a prospect enters a meeting
        step that has a linked_event_type configured.

        The event is selected based on the current date (not when the prospect
        entered the pipeline), so even if months have passed, it always finds
        the *next* upcoming event matching the type and optional category.
        """
        if not step.config or not isinstance(step.config, dict):
            return

        event_type = step.config.get("linked_event_type")
        if not event_type:
            return

        event_category = step.config.get("linked_event_category")
        now = datetime.now(timezone.utc)

        # Build query for next upcoming event matching type (and category)
        conditions = [
            Event.organization_id == prospect.organization_id,
            Event.event_type == event_type,
            Event.end_datetime > now,
            Event.is_cancelled.is_(False),
        ]
        if event_category:
            conditions.append(Event.custom_category == event_category)

        query = (
            select(Event)
            .where(and_(*conditions))
            .order_by(Event.start_datetime.asc())
            .limit(1)
        )
        result = await self.db.execute(query)
        event = result.scalar_one_or_none()
        if not event:
            return

        # Check if already linked
        existing = await self.db.execute(
            select(ProspectEventLink).where(
                and_(
                    ProspectEventLink.prospect_id == prospect.id,
                    ProspectEventLink.event_id == event.id,
                )
            )
        )
        if existing.scalar_one_or_none():
            return

        link = ProspectEventLink(
            id=generate_uuid(),
            prospect_id=prospect.id,
            event_id=event.id,
            notes=f"Auto-linked: next {event_type}"
            + (f" ({event_category})" if event_category else ""),
        )
        self.db.add(link)

        await self._log_activity(
            prospect_id=prospect.id,
            action="event_auto_linked",
            details={
                "event_id": event.id,
                "event_title": event.title,
                "step_id": step.id,
                "step_name": step.name,
            },
            performed_by=None,
        )
