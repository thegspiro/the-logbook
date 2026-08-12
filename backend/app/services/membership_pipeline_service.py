"""
Membership Pipeline Service

Business logic for prospective member pipeline management including
pipeline configuration, prospect tracking, step progression, and
transfer to full membership.
"""

import asyncio
import copy
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from loguru import logger
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.models.election import Election, ElectionStatus
from app.models.email_template import EmailTemplate
from app.models.event import Event
from app.models.membership_pipeline import (
    ActionType,
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
from app.models.user import Organization, User, UserStatus, generate_uuid
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org, is_in_org
from app.utils.prospect_fields import FIELD_TYPE_MAP as _SHARED_FIELD_TYPE_MAP
from app.utils.prospect_fields import LABEL_MAP as _SHARED_LABEL_MAP
from app.utils.prospect_fields import (
    REQUIRED_PROSPECT_FIELDS as _SHARED_REQUIRED_FIELDS,
)


class MembershipPipelineService:
    """Service for membership pipeline management"""

    # Ceiling on cards returned by the kanban board. Well above any real
    # department's active pipeline, so it is a guard against an unbounded
    # response rather than a paging size — per-column counts stay exact even
    # when it bites.
    MAX_KANBAN_CARDS = 500

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
            query = query.where(MembershipPipeline.is_template.is_(False))
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
            # Refresh identity-map instances so a pipeline read after
            # add_step/reorder in the same session sees the current steps
            # collection, not the one cached at creation time.
            .execution_options(populate_existing=True)
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
                await self._assert_email_template_in_org(
                    step_data.get("email_template_id"), organization_id
                )
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

        apply_updates(pipeline, data, skip=self._PIPELINE_PROTECTED_FIELDS)

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
                    MembershipPipeline.is_default.is_(True),
                )
            )
            .values(is_default=False)
        )

    # =========================================================================
    # Step CRUD
    # =========================================================================

    async def _assert_email_template_in_org(
        self, email_template_id: Any, organization_id: str
    ) -> None:
        # MP-5 (XC-1): a step's email_template_id is a client-supplied FK to the
        # org-scoped EmailTemplate used when the stage email fires. Validate it
        # belongs to the caller's org (optional — a step need not send email).
        await assert_in_org(
            self.db,
            EmailTemplate,
            email_template_id,
            organization_id,
            allow_none=True,
            label="email template",
        )

    async def add_step(
        self, pipeline_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[MembershipPipelineStep]:
        """Add a step to a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        await self._assert_email_template_in_org(
            data.get("email_template_id"), organization_id
        )

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
            notify_prospect_on_completion=data.get(
                "notify_prospect_on_completion", False
            ),
            public_visible=data.get("public_visible", True),
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

        if "email_template_id" in data:
            await self._assert_email_template_in_org(
                data.get("email_template_id"), organization_id
            )

        # Capture the old form_id before applying updates so we can clean up
        # the integration if the step is being reassigned to a different form.
        old_config = step.config if isinstance(step.config, dict) else {}
        old_form_id = old_config.get("form_id")

        apply_updates(step, data, skip=self._STEP_PROTECTED_FIELDS)

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
            await self._cleanup_orphaned_form_integration(old_form_id, organization_id)

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
            await self._cleanup_orphaned_form_integration(form_id, organization_id)

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

    @staticmethod
    def _apply_prospect_exclusions(
        query, exclude_prospect_ids: Optional[Iterable[str]]
    ):
        """Drop specific prospect rows from a query over ``ProspectiveMember``.

        Used to keep a caller's own prospective-membership record out of the
        lists, boards and counts they can see (see app/api/prospect_privacy.py).
        """
        ids = [str(i) for i in (exclude_prospect_ids or []) if i]
        if not ids:
            return query
        return query.where(ProspectiveMember.id.notin_(ids))

    @staticmethod
    def _prospect_search_filter(search: str) -> ColumnElement[bool]:
        """Build the name/email search predicate for a prospect list query.

        Each whitespace-separated term must match somewhere, so "smith john"
        finds the same person as "john smith" — coordinators type the full
        name far more often than a single field, and matching the raw string
        against each column individually never hits.
        """

        def _escape(value: str) -> str:
            return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

        terms = [t for t in search.split() if t]
        if not terms:
            terms = [search]

        clauses = []
        for term in terms:
            pattern = f"%{_escape(term)}%"
            clauses.append(
                or_(
                    ProspectiveMember.first_name.ilike(pattern),
                    ProspectiveMember.last_name.ilike(pattern),
                    ProspectiveMember.email.ilike(pattern),
                )
            )
        return and_(*clauses)

    async def list_prospects(
        self,
        organization_id: str,
        pipeline_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> tuple[List[ProspectiveMember], int]:
        """List prospects with filters"""
        query = (
            select(ProspectiveMember)
            .where(ProspectiveMember.organization_id == organization_id)
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline),
                selectinload(ProspectiveMember.step_progress),
            )
        )

        if pipeline_id:
            query = query.where(ProspectiveMember.pipeline_id == pipeline_id)
        if status:
            query = query.where(ProspectiveMember.status == status)
        query = self._apply_prospect_exclusions(query, exclude_prospect_ids)
        if search:
            query = query.where(self._prospect_search_filter(search))

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

    @staticmethod
    def enrich_prospect_list_item(
        prospect: ProspectiveMember, now: datetime
    ) -> Dict[str, Any]:
        """Compute derived fields for a prospect list response.

        Returns a dict with stage_entered_at, days_in_stage,
        days_in_pipeline, days_since_activity, inactivity_alert_level,
        and inactivity_timeout_days.  Called by the list_prospects
        endpoint to keep business logic out of the endpoint layer.
        """

        def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
            if dt is not None and dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        stage_entered_at = None
        if prospect.current_step_id and prospect.step_progress:
            for sp in prospect.step_progress:
                if sp.step_id == prospect.current_step_id:
                    stage_entered_at = sp.created_at
                    break
        if stage_entered_at is None:
            stage_entered_at = prospect.created_at

        stage_entered_at = _ensure_utc(stage_entered_at)
        p_created_at = _ensure_utc(prospect.created_at)
        p_updated_at = _ensure_utc(prospect.updated_at)

        days_in_stage = (now - stage_entered_at).days if stage_entered_at else 0
        days_in_pipeline = (now - p_created_at).days if p_created_at else 0
        last_activity = p_updated_at or p_created_at
        days_since_activity = (now - last_activity).days if last_activity else 0

        timeout_days = (
            prospect.current_step.inactivity_timeout_days
            if prospect.current_step and prospect.current_step.inactivity_timeout_days
            else None
        )
        inactivity_alert_level = "normal"
        if timeout_days and days_in_stage > 0:
            if days_in_stage >= timeout_days:
                inactivity_alert_level = "critical"
            elif days_in_stage >= timeout_days * 0.75:
                inactivity_alert_level = "warning"

        return {
            "stage_entered_at": stage_entered_at,
            "days_in_stage": days_in_stage,
            "days_in_pipeline": days_in_pipeline,
            "days_since_activity": days_since_activity,
            "last_activity": last_activity,
            "inactivity_alert_level": inactivity_alert_level,
            "inactivity_timeout_days": timeout_days,
        }

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
            # Refresh identity-map instances: the prospect's pipeline/steps
            # may already be cached in this session from an earlier call, and
            # advance/complete logic must see the committed collections.
            .execution_options(populate_existing=True)
        )
        result = await self.db.execute(query)
        prospect = result.scalars().first()
        if prospect is not None:
            # MP2 (BXC-2): ProspectResponse declares a flat pipeline_name that the
            # ORM row doesn't have, so it was always null on the detail / create /
            # update / advance / regress paths (only the list path built it) — and
            # the applicant detail view renders it. The pipeline relationship is
            # eager-loaded above, so populate it here (the single fetch every one
            # of those paths returns through). Non-mapped attribute; never persisted.
            prospect.pipeline_name = (
                prospect.pipeline.name if prospect.pipeline else None
            )
        return prospect

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

        # Validate a client-supplied pipeline_id belongs to the caller's org.
        # An unvalidated foreign id would seed current_step_id / step_progress
        # from another org's pipeline and leak its step names/config back in the
        # prospect response.
        if pipeline_id:
            if await self.get_pipeline(pipeline_id, organization_id) is None:
                raise ValueError("Invalid pipeline")

        # Same reasoning for the referring member. It is copied onto the User
        # record at transfer (see _do_transfer), so an unvalidated id does not
        # just dangle on the prospect — it lands in the members table as a
        # cross-tenant reference that outlives the application.
        await assert_in_org(
            self.db,
            User,
            data.get("referred_by"),
            organization_id,
            allow_none=True,
            label="referring member",
        )

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

    # MP-6: fields whose plaintext values must NOT be written into the
    # activity log (returned by GET /prospects/{id}/activity). For these we
    # record only that the field changed, not the sensitive old/new values.
    _SENSITIVE_ACTIVITY_FIELDS = frozenset(
        {
            "date_of_birth",
            "address_street",
            "address_city",
            "address_state",
            "address_zip",
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

        # referred_by is the one client-supplied foreign key this update
        # accepts; every other FK is in _PROSPECT_PROTECTED_FIELDS.
        if "referred_by" in data:
            await assert_in_org(
                self.db,
                User,
                data.get("referred_by"),
                organization_id,
                allow_none=True,
                label="referring member",
            )

        changes = {}
        for key, value in data.items():
            if key in self._PROSPECT_PROTECTED_FIELDS:
                continue
            if value is not None and hasattr(prospect, key):
                old_value = getattr(prospect, key)
                if old_value != value:
                    if key in self._SENSITIVE_ACTIVITY_FIELDS:
                        changes[key] = {"changed": True}
                    else:
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
                    if i.recommendation and i.recommendation.value == required_rec
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
                missing = [r for r in required_approvers if r not in approved_roles]
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
                            ScreeningRecord.screening_type.in_(required_screenings),
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
                missing = [s for s in required_screenings if s not in passed_types]
                if missing:
                    raise ValueError(
                        f"Medical screenings not yet passed: " f"{', '.join(missing)}."
                    )

    async def complete_step(
        self,
        prospect_id: str,
        organization_id: str,
        step_id: str,
        completed_by: str,
        notes: Optional[str] = None,
        action_result: Optional[Dict[str, Any]] = None,
        *,
        skip_requirements: bool = False,
    ) -> Optional[ProspectiveMember]:
        """Mark a step as completed for a prospect"""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None

        # MP-5: reject a step_id that isn't part of this prospect's pipeline
        # so a client can't write a ProspectStepProgress row referencing a
        # foreign or nonexistent step (dangling-FK / integrity).
        pipeline_steps = prospect.pipeline.steps if prospect.pipeline else []
        step = next(
            (s for s in pipeline_steps if str(s.id) == str(step_id)),
            None,
        )
        if not step:
            raise ValueError("Step does not belong to this prospect's pipeline")

        # Only the dedicated coordinator skip path may bypass a stage gate.
        # Keeping this server-side avoids accepting a client-controlled
        # ``skipped`` flag on the ordinary completion endpoint.
        if not skip_requirements:
            await self._validate_step_completion(prospect, step)

        # Find or create the progress record
        progress = next(
            (p for p in prospect.step_progress if str(p.step_id) == str(step_id)),
            None,
        )

        completion_status = (
            StepProgressStatus.SKIPPED
            if skip_requirements
            else StepProgressStatus.COMPLETED
        )
        if not progress:
            progress = ProspectStepProgress(
                id=generate_uuid(),
                prospect_id=prospect_id,
                step_id=step_id,
                status=completion_status,
                completed_at=datetime.now(timezone.utc),
                completed_by=completed_by,
                notes=notes,
                action_result=action_result,
            )
            self.db.add(progress)
        else:
            progress.status = completion_status
            progress.completed_at = datetime.now(timezone.utc)
            progress.completed_by = completed_by
            if notes:
                progress.notes = notes
            if action_result:
                progress.action_result = action_result

        activity_action = "step_skipped" if skip_requirements else "step_completed"
        await self._log_activity(
            prospect_id=prospect_id,
            action=activity_action,
            details={"step_id": str(step_id), "notes": notes},
            performed_by=completed_by,
        )

        # Notify the prospect that this step is completed, if configured
        if (
            not skip_requirements
            and step.notify_prospect_on_completion
            and prospect.email
        ):
            await self._send_step_completion_notification(prospect, step)

        # Check if the completed step is the final step and auto-transfer is on
        if step.is_final_step and prospect.pipeline.auto_transfer_on_approval:
            await self._do_transfer(prospect, completed_by)
        else:
            # Advance to next step
            await self._advance_current_step(prospect, step_id)

        await self.db.commit()
        return await self.get_prospect(prospect_id, organization_id)

    async def skip_current_step(
        self,
        prospect_id: str,
        organization_id: str,
        skipped_by: str,
        notes: Optional[str] = None,
    ) -> Optional[ProspectiveMember]:
        """Explicitly bypass the current stage while preserving an audit trail."""
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect:
            return None
        if not prospect.pipeline or not prospect.current_step_id:
            raise ValueError("Prospect has no current stage to skip")
        steps = sorted(prospect.pipeline.steps, key=lambda step: step.sort_order)
        if steps and str(prospect.current_step_id) == str(steps[-1].id):
            raise ValueError(
                "The final stage cannot be skipped; convert or reject instead"
            )

        return await self.complete_step(
            prospect_id=prospect_id,
            organization_id=organization_id,
            step_id=str(prospect.current_step_id),
            completed_by=skipped_by,
            notes=notes,
            action_result={"skipped": True},
            skip_requirements=True,
        )

    async def complete_current_step_for_integration_event(
        self,
        organization_id: str,
        emails: List[str],
        *,
        step_type: str,
        provider_key: str,
        provider_value: str,
        completed_by: str,
        action_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, str]]:
        """Auto-advance a prospect when an integration event arrives.

        Finds an active prospect in the org whose email matches one of
        ``emails`` and whose current step is of ``step_type`` configured with
        ``config[provider_key] == provider_value`` (e.g. a meeting step using
        Cal.com when an applicant books, or a document step using Documenso
        when they finish signing), then completes that step.

        Returns ``{"prospect_id", "step_id"}`` on success, or None when nothing
        matched (unknown email, wrong current stage, or already advanced) — a
        no-match is a normal, non-error outcome for a public webhook.
        """
        normalized = {e.strip().lower() for e in emails if e and e.strip()}
        if not normalized:
            return None

        query = (
            select(ProspectiveMember)
            .where(
                ProspectiveMember.organization_id == organization_id,
                ProspectiveMember.status == ProspectStatus.ACTIVE,
                func.lower(ProspectiveMember.email).in_(normalized),
            )
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline).selectinload(
                    MembershipPipeline.steps
                ),
            )
        )
        result = await self.db.execute(query)
        prospects = result.scalars().all()

        for prospect in prospects:
            step = prospect.current_step
            if not step:
                continue
            step_type_value = (
                step.step_type.value
                if hasattr(step.step_type, "value")
                else step.step_type
            )
            if step_type_value != step_type:
                continue
            if (step.config or {}).get(provider_key) != provider_value:
                continue
            await self.complete_step(
                prospect_id=str(prospect.id),
                organization_id=organization_id,
                step_id=str(step.id),
                completed_by=completed_by,
                action_result=action_result,
            )
            return {"prospect_id": str(prospect.id), "step_id": str(step.id)}

        return None

    async def advance_prospect(
        self,
        prospect_id: str,
        organization_id: str,
        advanced_by: str,
        notes: Optional[str] = None,
    ) -> Optional[ProspectiveMember]:
        """Complete the current step and advance a prospect.

        Advancement used to move ``current_step_id`` directly.  That bypassed
        every stage gate enforced by :meth:`complete_step` (interviews,
        checklists, approvals, references, and medical screening) and left the
        departed step marked in progress.  Keep one progression path so the
        configured workflow and its audit record cannot diverge.
        """
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

        # Report a no-op as a no-op. Returning the untouched prospect made
        # "advance" indistinguishable from "advanced": the caller got a 200,
        # the UI reported success, and an audit entry claimed a movement that
        # never happened — which matters for a log kept to reconstruct who
        # moved whom through membership.
        if current_idx < 0:
            raise ValueError("Prospect has no current stage to advance from")
        if current_idx >= len(sorted_steps) - 1:
            raise ValueError("Prospect is already at the final stage")

        advanced = await self.complete_step(
            prospect_id=prospect_id,
            organization_id=organization_id,
            step_id=str(sorted_steps[current_idx].id),
            completed_by=advanced_by,
            notes=notes,
        )

        # complete_step records the step-level event ("step_completed");
        # "prospect_advanced" is the established audit action reports and the
        # activity feed reconstruct movements from, so an explicit advance
        # still writes it — only after the gated completion succeeded.
        next_step = sorted_steps[current_idx + 1]
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
        return advanced

    # =========================================================================
    # Bulk Actions
    # =========================================================================

    async def _bulk_apply(
        self,
        prospect_ids: Iterable[str],
        organization_id: str,
        apply,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Run ``apply`` over each prospect id, itemizing per-id outcomes.

        One failure never aborts the rest — a coordinator acting on thirty
        applicants should not lose twenty-nine because one is at the final
        stage. ``apply`` owns its own commit, so each prospect is durable
        before the next is attempted; a rejected one is refused before it
        writes anything.

        ``exclude_prospect_ids`` carries the caller's own prospect record
        (see app/api/prospect_privacy.py). Bulk ids arrive in the request
        body, so the router's path-parameter guard cannot see them; they are
        reported as "not found", identical to an id that does not exist, so
        the response discloses nothing either way.
        """
        # Local import: app.api imports the service layer, so a module-level
        # import here would close the cycle.
        from app.api.prospect_privacy import normalize_prospect_id

        hidden = {str(i) for i in (exclude_prospect_ids or []) if i}
        results: List[Dict[str, Any]] = []

        for raw_id in prospect_ids:
            prospect_id = str(raw_id)
            if normalize_prospect_id(prospect_id) in hidden:
                results.append(
                    {
                        "prospect_id": prospect_id,
                        "name": None,
                        "succeeded": False,
                        "error": "Prospect not found",
                    }
                )
                continue

            prospect = await self.get_prospect(prospect_id, organization_id)
            if not prospect:
                results.append(
                    {
                        "prospect_id": prospect_id,
                        "name": None,
                        "succeeded": False,
                        "error": "Prospect not found",
                    }
                )
                continue

            name = prospect.full_name
            try:
                await apply(prospect)
            except ValueError as exc:
                results.append(
                    {
                        "prospect_id": prospect_id,
                        "name": name,
                        "succeeded": False,
                        "error": str(exc),
                    }
                )
                continue
            except Exception as exc:  # pragma: no cover - defensive
                # Leave the session usable for the ids still queued behind
                # this one, rather than failing the whole batch.
                await self.db.rollback()
                logger.exception(
                    f"Bulk action failed for prospect {prospect_id}: {exc}"
                )
                results.append(
                    {
                        "prospect_id": prospect_id,
                        "name": name,
                        "succeeded": False,
                        "error": "Action failed",
                    }
                )
                continue

            results.append(
                {
                    "prospect_id": prospect_id,
                    "name": name,
                    "succeeded": True,
                    "error": None,
                }
            )

        return results

    async def bulk_advance_prospects(
        self,
        prospect_ids: Iterable[str],
        organization_id: str,
        advanced_by: str,
        notes: Optional[str] = None,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Advance several prospects, reporting each one's outcome."""

        async def _advance(prospect: ProspectiveMember) -> None:
            await self.advance_prospect(
                prospect_id=str(prospect.id),
                organization_id=organization_id,
                advanced_by=advanced_by,
                notes=notes,
            )

        return await self._bulk_apply(
            prospect_ids, organization_id, _advance, exclude_prospect_ids
        )

    async def bulk_set_prospect_status(
        self,
        prospect_ids: Iterable[str],
        organization_id: str,
        status: str,
        changed_by: str,
        reason: Optional[str] = None,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Set the status of several prospects, reporting each one's outcome.

        ``reason`` is written to the activity log only. The previous bulk
        path sent it through ``update_prospect`` as ``notes``, which
        *overwrote* the coordinator notes on every selected record — a bulk
        rejection silently destroyed whatever had been written about each
        applicant.
        """
        try:
            target = ProspectStatus(status)
        except ValueError:
            raise ValueError(f"Invalid status: {status}")

        async def _set_status(prospect: ProspectiveMember) -> None:
            previous = (
                prospect.status.value
                if hasattr(prospect.status, "value")
                else str(prospect.status)
            )
            if previous == target.value:
                raise ValueError(f"Prospect is already {target.value}")
            prospect.status = target
            await self._log_activity(
                prospect_id=str(prospect.id),
                action="prospect_status_changed",
                details={
                    "from": previous,
                    "to": target.value,
                    "reason": reason,
                    "bulk": True,
                },
                performed_by=changed_by,
            )
            await self.db.commit()

        return await self._bulk_apply(
            prospect_ids, organization_id, _set_status, exclude_prospect_ids
        )

    async def regress_prospect(
        self,
        prospect_id: str,
        organization_id: str,
        regressed_by: str,
        notes: Optional[str] = None,
    ) -> Optional[ProspectiveMember]:
        """Move a prospect back to the previous step."""
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

        if current_idx <= 0:
            return prospect  # Already at the first step

        prev_step = sorted_steps[current_idx - 1]
        prospect.current_step_id = prev_step.id

        # Reset the previous step's progress to in_progress
        prev_progress = next(
            (p for p in prospect.step_progress if str(p.step_id) == str(prev_step.id)),
            None,
        )
        if prev_progress:
            prev_progress.status = StepProgressStatus.IN_PROGRESS
        else:
            self.db.add(
                ProspectStepProgress(
                    id=generate_uuid(),
                    prospect_id=prospect_id,
                    step_id=prev_step.id,
                    status=StepProgressStatus.IN_PROGRESS,
                )
            )

        await self._log_activity(
            prospect_id=prospect_id,
            action="prospect_regressed",
            details={
                "to_step_id": str(prev_step.id),
                "to_step_name": prev_step.name,
                "notes": notes,
            },
            performed_by=regressed_by,
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

            # Send automated email if the next step is an automated_email stage
            # (or a legacy action step with action_type=send_email)
            if self._is_email_step(next_step):
                await self.db.flush()
                await self._send_stage_email(prospect, next_step)

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
        department_email: Optional[str] = None,
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
            department_email=department_email,
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
        department_email: Optional[str] = None,
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
            username = await self._generate_unique_username(
                prospect.first_name,
                prospect.last_name,
                prospect.organization_id,
            )
        else:
            # Validate manually-provided username is unique
            existing = await self.db.execute(
                select(func.count())
                .select_from(User)
                .where(
                    User.organization_id == prospect.organization_id,
                    User.username == username,
                    User.deleted_at.is_(None),
                )
            )
            if (existing.scalar() or 0) > 0:
                raise ValueError(f"Username '{username}' is already taken")

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

        # Use explicit override, or auto-generate from org settings; keep
        # prospect's personal email as a secondary contact address.
        if not department_email:
            department_email = await self._generate_department_email(
                prospect.first_name,
                prospect.last_name,
                prospect.organization_id,
            )
        primary_email = department_email or prospect.email
        personal_email = prospect.email if department_email else None

        # Records created before referred_by was validated on write may carry a
        # referrer from another org. Drop it rather than fail the transfer —
        # legacy data must not block a member being elected — but do not let it
        # cross into the users table, where it would outlive the application.
        referred_by = prospect.referred_by
        if referred_by and not await is_in_org(
            self.db, User, referred_by, prospect.organization_id
        ):
            logger.warning(
                f"Dropping out-of-org referred_by {referred_by} while "
                f"transferring prospect {prospect.id}"
            )
            referred_by = None

        user_id = generate_uuid()
        new_user = User(
            id=user_id,
            organization_id=prospect.organization_id,
            username=username,
            email=primary_email,
            personal_email=personal_email,
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
            password_changed_at=datetime.now(timezone.utc),
            # Preserve referral data from prospect
            referral_source=prospect.referral_source,
            interest_reason=prospect.interest_reason,
            referred_by_user_id=referred_by,
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

        # Ensure default "member" role is always assigned
        from app.core.constants import ROLE_MEMBER
        from app.models.user import Role

        assigned_slugs = {r.slug for r in (new_user.roles or [])}
        if ROLE_MEMBER not in assigned_slugs:
            member_result = await self.db.execute(
                select(Role).where(
                    Role.organization_id == prospect.organization_id,
                    Role.slug == ROLE_MEMBER,
                )
            )
            member_role = member_result.scalar_one_or_none()
            if member_role:
                await self.db.refresh(new_user, ["positions"])
                new_user.positions.append(member_role)

        # Update prospect record
        prospect.status = ProspectStatus.TRANSFERRED
        prospect.transferred_user_id = user_id
        prospect.transferred_at = datetime.now(timezone.utc)

        transfer_details: Dict[str, Any] = {"user_id": user_id, "username": username}
        if membership_id:
            transfer_details["membership_number"] = membership_id

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
            prog = enrollment_result["program_name"]
            result_msg += f". Auto-enrolled in training program: {prog}"

        # Send welcome email with temporary credentials if requested.
        # Use the primary (department) email so the new member receives
        # credentials at the address they'll actually log in with.
        welcome_email_sent = False
        if send_welcome_email:
            welcome_email_sent = await self._send_transfer_welcome_email(
                prospect=prospect,
                username=username,
                temp_password=temp_password,
                organization_id=prospect.organization_id,
                recipient_email=primary_email,
            )

        return {
            "success": True,
            "prospect_id": prospect.id,
            "user_id": user_id,
            "membership_number": membership_id,
            "email": primary_email,
            "personal_email": personal_email,
            "department_email_generated": department_email is not None,
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
                        TrainingProgram.active.is_(True),
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

        except ValueError as e:
            logger.warning(f"Auto-enrollment skipped for user {user_id}: {e}")
            return None
        except Exception as e:
            logger.opt(exception=True).error(
                f"Auto-enrollment failed for user {user_id}: {e}",
            )
            raise

    @staticmethod
    def _is_email_step(step: MembershipPipelineStep) -> bool:
        """Return True if the step should trigger an automated email.

        Matches both the modern ``automated_email`` step type and the
        legacy pattern of ``action`` + ``action_type='send_email'``.
        """
        if step.step_type == PipelineStepType.AUTOMATED_EMAIL:
            return True
        if step.step_type == PipelineStepType.ACTION:
            action = step.action_type
            raw = action.value if isinstance(action, ActionType) else action
            if raw == ActionType.SEND_EMAIL.value:
                return True
        return False

    async def _fetch_meeting_details(
        self,
        organization_id: str,
        event_type: Optional[str] = None,
        event_id: Optional[str] = None,
        html: bool = True,
    ) -> List[str]:
        """Fetch upcoming event details for the meeting section of a stage email.

        Returns a list of formatted detail strings (HTML-escaped if *html* is True).
        If the event cannot be found or has already passed, returns an empty list.
        """
        import html as _html

        from app.models.event import Event

        try:
            query = select(Event).where(
                Event.organization_id == str(organization_id),
                Event.start_datetime >= datetime.now(timezone.utc),
            )
            if event_id:
                query = query.where(Event.id == str(event_id))
            elif event_type:
                query = query.where(Event.event_type == event_type)
            query = query.order_by(Event.start_datetime).limit(1)

            result = await self.db.execute(query)
            event = result.scalar_one_or_none()
            if not event:
                return []

            title = event.title or ""
            start = event.start_datetime
            loc = event.location or ""

            parts: List[str] = []
            if title:
                parts.append(_html.escape(title) if html else title)
            if start:
                fmt = start.strftime("%A, %B %d, %Y at %I:%M %p")
                parts.append(_html.escape(fmt) if html else fmt)
            if loc:
                parts.append(_html.escape(loc) if html else loc)
            return parts
        except Exception as e:
            logger.warning(f"Failed to fetch meeting event details: {e}")
            return []

    async def _send_stage_email(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
    ) -> bool:
        """Send the automated email configured on a pipeline stage."""
        try:
            import html as _html

            from app.services.email_service import EmailService
            from app.services.email_template_service import DEFAULT_CSS

            config: Dict[str, Any] = step.config or {}
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == prospect.organization_id)
            )
            org = org_result.scalar_one_or_none()
            if not org:
                logger.error("Cannot send stage email: organization not found")
                return False

            org_name = _html.escape(org.name or "The Logbook")
            first_name = _html.escape(prospect.first_name or "")

            # Resolve subject, substituting {{organization_name}} if present
            raw_subject = config.get(
                "email_subject",
                "Update on Your Membership Application",
            )
            subject = raw_subject.replace(
                "{{organization_name}}", org.name or "The Logbook"
            )

            # Build HTML sections from config, respecting section_order
            sections: List[str] = []

            # Helpers to build individual section HTML
            def _build_welcome() -> str | None:
                if config.get("include_welcome") and config.get("welcome_message"):
                    return f"<p>{_html.escape(config['welcome_message'])}</p>"
                return None

            def _build_faq_link() -> str | None:
                if config.get("include_faq_link") and config.get("faq_url"):
                    faq_url = _html.escape(config["faq_url"])
                    return (
                        f'<p><a href="{faq_url}" class="button">'
                        "View Membership FAQ</a></p>"
                    )
                return None

            async def _build_next_meeting() -> str | None:
                if not config.get("include_next_meeting"):
                    return None
                meeting_parts: List[str] = []
                event_type_filter = config.get("next_meeting_event_type")
                event_id = config.get("next_meeting_event_id")
                if event_type_filter or event_id:
                    meeting_parts = await self._fetch_meeting_details(
                        prospect.organization_id,
                        event_type=event_type_filter,
                        event_id=event_id,
                    )
                extra_details = config.get("next_meeting_details")
                if extra_details:
                    meeting_parts.append(_html.escape(extra_details))
                if meeting_parts:
                    return (
                        '<div class="details">'
                        "<strong>Next Meeting</strong><br>"
                        + "<br>".join(meeting_parts)
                        + "</div>"
                    )
                return None

            def _build_status_tracker() -> str | None:
                if not config.get("include_status_tracker"):
                    return None
                if (
                    prospect.status_token
                    and prospect.pipeline
                    and getattr(prospect.pipeline, "public_status_enabled", False)
                ):
                    from app.core.config import settings as app_settings

                    frontend_url = getattr(app_settings, "FRONTEND_URL", "") or ""
                    status_url = (
                        f"{frontend_url}/application-status" f"/{prospect.status_token}"
                    )
                    safe_url = _html.escape(status_url)
                    return (
                        '<p><a href="' + safe_url + '" class="button">'
                        "Track Your Application</a></p>"
                    )
                return None

            def _build_custom_section_html(
                custom: Dict[str, Any],
            ) -> str | None:
                title = _html.escape(custom.get("title", ""))
                body = _html.escape(custom.get("content", ""))
                if title or body:
                    heading = f"<strong>{title}</strong><br>" if title else ""
                    return f'<div class="details">{heading}{body}</div>'
                return None

            def _build_custom_section_text(
                custom: Dict[str, Any],
            ) -> str | None:
                title = custom.get("title", "")
                body = custom.get("content", "")
                if title or body:
                    return f"{title}\n{body}" if title else body
                return None

            # Default section order for backward compatibility
            default_order = [
                "welcome",
                "faq_link",
                "next_meeting",
                "status_tracker",
            ]
            custom_by_id: Dict[str, Dict[str, Any]] = {
                s["id"]: s for s in config.get("custom_sections", []) if s.get("id")
            }
            section_order = config.get("section_order")
            if not section_order:
                section_order = default_order + list(custom_by_id.keys())

            for sid in section_order:
                html_part: str | None = None
                if sid == "welcome":
                    html_part = _build_welcome()
                elif sid == "faq_link":
                    html_part = _build_faq_link()
                elif sid == "next_meeting":
                    html_part = await _build_next_meeting()
                elif sid == "status_tracker":
                    html_part = _build_status_tracker()
                else:
                    custom = custom_by_id.get(sid)
                    if custom:
                        html_part = _build_custom_section_html(custom)
                if html_part:
                    sections.append(html_part)

            body_html = (
                "\n".join(sections)
                if sections
                else ("<p>Your membership application has been updated.</p>")
            )

            html_body = (
                f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>"
                f'<div class="container">'
                f'<div class="header"><h1>{org_name}</h1></div>'
                f'<div class="content">'
                f"<p>Hi {first_name},</p>"
                f"{body_html}"
                f"</div>"
                f'<div class="footer">This email was sent by {org_name}.</div>'
                f"</div></body></html>"
            )

            # Build plain-text version in the same section_order
            text_parts = [f"Hi {prospect.first_name},"]
            for sid in section_order:
                if sid == "welcome":
                    if config.get("include_welcome") and config.get("welcome_message"):
                        text_parts.append(config["welcome_message"])
                elif sid == "faq_link":
                    if config.get("include_faq_link") and config.get("faq_url"):
                        text_parts.append(f"View Membership FAQ: {config['faq_url']}")
                elif sid == "next_meeting":
                    if config.get("include_next_meeting"):
                        text_meeting: List[str] = []
                        if config.get("next_meeting_event_type") or config.get(
                            "next_meeting_event_id"
                        ):
                            text_meeting = await self._fetch_meeting_details(
                                prospect.organization_id,
                                event_type=config.get("next_meeting_event_type"),
                                event_id=config.get("next_meeting_event_id"),
                                html=False,
                            )
                        if config.get("next_meeting_details"):
                            text_meeting.append(config["next_meeting_details"])
                        if text_meeting:
                            text_parts.append(
                                "Next Meeting:\n" + "\n".join(text_meeting)
                            )
                elif sid == "status_tracker":
                    if config.get("include_status_tracker") and prospect.status_token:
                        if prospect.pipeline and getattr(
                            prospect.pipeline,
                            "public_status_enabled",
                            False,
                        ):
                            from app.core.config import settings as app_settings

                            frontend_url = (
                                getattr(app_settings, "FRONTEND_URL", "") or ""
                            )
                            status_url = (
                                f"{frontend_url}/application-status"
                                f"/{prospect.status_token}"
                            )
                            text_parts.append(f"Track your application: {status_url}")
                else:
                    custom = custom_by_id.get(sid)
                    if custom:
                        text = _build_custom_section_text(custom)
                        if text:
                            text_parts.append(text)
            text_parts.append(f"This email was sent by {org.name or 'The Logbook'}.")
            text_body = "\n\n".join(text_parts)

            email_svc = EmailService(org)
            success, _ = await email_svc.send_email(
                to_emails=[prospect.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=self.db,
                template_type="pipeline_stage",
            )
            if success:
                logger.info(
                    f"Stage email sent to {prospect.email} " f"for step '{step.name}'"
                )
            return success > 0
        except Exception as e:
            logger.error(f"Failed to send stage email to {prospect.email}: {e}")
            return False

    async def _send_step_completion_notification(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
    ) -> bool:
        """Send a notification email when a pipeline step is completed."""
        try:
            import html as _html

            from app.services.email_service import EmailService
            from app.services.email_template_service import DEFAULT_CSS

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == prospect.organization_id)
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return False

            org_name = _html.escape(org.name or "The Logbook")
            first_name = _html.escape(prospect.first_name or "")
            step_name = _html.escape(step.name or "")
            subject = f"Application Update — {step.name} Complete"

            html_body = (
                f"<!DOCTYPE html><html><head>"
                f"<style>{DEFAULT_CSS}</style></head><body>"
                f'<div class="container">'
                f'<div class="header"><h1>{org_name}</h1></div>'
                f'<div class="content">'
                f"<p>Hi {first_name},</p>"
                f"<p>We're writing to let you know that the "
                f"<strong>{step_name}</strong> step of your "
                f"membership application has been completed.</p>"
                f"<p>We'll be in touch with next steps soon.</p>"
                f"</div>"
                f'<div class="footer">'
                f"This email was sent by {org_name}.</div>"
                f"</div></body></html>"
            )
            text_body = (
                f"Hi {prospect.first_name},\n\n"
                f"The {step.name} step of your membership "
                f"application has been completed.\n\n"
                f"We'll be in touch with next steps soon.\n\n"
                f"This email was sent by "
                f"{org.name or 'The Logbook'}."
            )

            email_svc = EmailService(org)
            success, _ = await email_svc.send_email(
                to_emails=[prospect.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=self.db,
                template_type="pipeline_stage",
            )
            if success:
                logger.info(
                    "Step-completion notification sent to "
                    f"{prospect.email} for step '{step.name}'"
                )
            return success > 0
        except Exception as e:
            logger.error(
                "Failed to send step-completion notification "
                f"to {prospect.email}: {e}"
            )
            return False

    async def _send_transfer_welcome_email(
        self,
        prospect: ProspectiveMember,
        username: str,
        temp_password: str,
        organization_id: str,
        recipient_email: Optional[str] = None,
    ) -> bool:
        """Send welcome email with credentials to a transferred member."""
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

            to_email = recipient_email or prospect.email
            email_svc = EmailService(org)
            sent = await email_svc.send_welcome_email(
                to_email=to_email,
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
            target = recipient_email or prospect.email
            logger.error(f"Failed to send welcome email to {target}: {e}")
            return False

    @staticmethod
    def _sanitize_name_for_identifier(name: str) -> str:
        """Normalize a name for use in usernames and email local parts.

        Strips accents (François → francois), removes apostrophes and
        non-alphanumeric characters, and lowercases the result.
        """
        nfkd = unicodedata.normalize("NFKD", name)
        ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
        lowered = ascii_only.lower()
        return re.sub(r"[^a-z0-9]", "", lowered)

    async def _generate_unique_username(
        self, first_name: str, last_name: str, organization_id: str
    ) -> str:
        """Generate a username guaranteed unique within the organization.

        Starts with 'flastname' (e.g. 'jsmith'), then tries 'jsmith1',
        'jsmith2', etc. until an unused name is found.
        """
        first = self._sanitize_name_for_identifier(first_name)
        last = self._sanitize_name_for_identifier(last_name)
        if not first or not last:
            raise ValueError(
                "First name and last name are required for username generation"
            )
        base = f"{first[0]}{last}"
        candidate = base

        max_attempts = 1000
        suffix = 0
        for _ in range(max_attempts):
            result = await self.db.execute(
                select(func.count())
                .select_from(User)
                .where(
                    User.organization_id == organization_id,
                    User.username == candidate,
                    User.deleted_at.is_(None),
                )
            )
            if (result.scalar() or 0) == 0:
                return candidate
            suffix += 1
            candidate = f"{base}{suffix}"

        raise ValueError(
            f"Cannot generate unique username after {max_attempts} attempts "
            f"(base='{base}')"
        )

    async def _generate_department_email(
        self,
        first_name: str,
        last_name: str,
        organization_id: str,
    ) -> Optional[str]:
        """Generate a unique department email based on org settings.

        Returns None when the feature is disabled or no domain is configured,
        letting callers fall back to the prospect's personal email.
        """
        from app.services.organization_service import OrganizationService

        org_service = OrganizationService(self.db)
        org_settings = await org_service.get_organization_settings(organization_id)
        dept = org_settings.department_email

        if not dept.enabled or not dept.domain:
            return None

        from app.schemas.organization import DepartmentEmailFormat

        first = self._sanitize_name_for_identifier(first_name)
        last = self._sanitize_name_for_identifier(last_name)
        if not first or not last:
            logger.warning(
                "Skipping department email generation: sanitized name is empty "
                f"(first={first_name!r}, last={last_name!r})"
            )
            return None

        if dept.format == DepartmentEmailFormat.FIRST_DOT_LAST:
            local = f"{first}.{last}"
        elif dept.format == DepartmentEmailFormat.FIRST_INITIAL_LAST:
            local = f"{first[0]}{last}"
        elif dept.format == DepartmentEmailFormat.FIRST_LAST:
            local = f"{first}{last}"
        elif dept.format == DepartmentEmailFormat.LAST_DOT_FIRST:
            local = f"{last}.{first}"
        else:
            local = f"{first}.{last}"

        candidate = f"{local}@{dept.domain}"

        suffix = 0
        while True:
            existing = await self.db.execute(
                select(func.count())
                .select_from(User)
                .where(
                    User.organization_id == organization_id,
                    User.email == candidate,
                    User.deleted_at.is_(None),
                )
            )
            if (existing.scalar() or 0) == 0:
                return candidate
            suffix += 1
            candidate = f"{local}{suffix}@{dept.domain}"

    # =========================================================================
    # Kanban Board
    # =========================================================================

    async def get_kanban_board(
        self,
        pipeline_id: str,
        organization_id: str,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get the kanban board view for a pipeline.

        Card loading is capped at :data:`MAX_KANBAN_CARDS`; the per-column
        ``count`` values come from a separate aggregate, so a truncated board
        still reports the true size of every column rather than quietly
        under-reporting it. ``truncated`` says whether any card was withheld.
        """
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        scope = and_(
            ProspectiveMember.organization_id == organization_id,
            ProspectiveMember.pipeline_id == pipeline_id,
            ProspectiveMember.status == ProspectStatus.ACTIVE,
        )

        # True per-column totals, independent of how many cards are loaded.
        count_query = self._apply_prospect_exclusions(
            select(
                ProspectiveMember.current_step_id,
                func.count(ProspectiveMember.id),
            ).where(scope),
            exclude_prospect_ids,
        ).group_by(ProspectiveMember.current_step_id)
        count_rows = (await self.db.execute(count_query)).all()
        counts = {
            (str(step_id) if step_id else None): (count or 0)
            for step_id, count in count_rows
        }
        total_prospects = sum(counts.values())

        query = (
            select(ProspectiveMember)
            .where(scope)
            # Same eager loads as the prospect list: the card projection reads
            # pipeline name and step progress, and a lazy load out of the async
            # response path raises MissingGreenlet rather than just being slow.
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline),
                selectinload(ProspectiveMember.step_progress),
            )
            .order_by(ProspectiveMember.created_at)
            .limit(self.MAX_KANBAN_CARDS)
        )
        query = self._apply_prospect_exclusions(query, exclude_prospect_ids)
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
                    "count": counts.get(str(step.id), 0),
                }
            )

        # Add column for prospects with no current step
        unassigned = [p for p in prospects if not p.current_step_id]
        unassigned_count = counts.get(None, 0)
        if unassigned or unassigned_count:
            columns.insert(
                0,
                {
                    "step": None,
                    "prospects": unassigned,
                    "count": unassigned_count,
                },
            )

        return {
            "pipeline": pipeline,
            "columns": columns,
            "total_prospects": total_prospects,
            "returned_prospects": len(prospects),
            "truncated": total_prospects > len(prospects),
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

    async def _try_auto_advance_step(
        self,
        prospect_id: str,
        organization_id: str,
        step_id: str,
        completed_by: str,
        trigger: str,
        action_result: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Attempt to auto-advance a prospect past the given step.

        Checks whether the step has ``auto_advance`` enabled in its config
        and whether the prospect is currently on that step.  If both
        conditions are met, calls ``complete_step`` which will validate
        step-specific requirements before advancing.

        Returns True if auto-advance succeeded, False otherwise.
        """
        prospect = await self.get_prospect(prospect_id, organization_id)
        if not prospect or not prospect.pipeline:
            return False

        step = next(
            (s for s in prospect.pipeline.steps if str(s.id) == str(step_id)),
            None,
        )
        if (
            not step
            or not (step.config or {}).get("auto_advance")
            or str(prospect.current_step_id) != str(step_id)
        ):
            return False

        try:
            result = {"auto_advanced": True, "trigger": trigger}
            if action_result:
                result.update(action_result)
            await self.complete_step(
                prospect_id=prospect_id,
                organization_id=organization_id,
                step_id=step_id,
                completed_by=completed_by,
                notes=f"Auto-advanced on {trigger}",
                action_result=result,
            )
            logger.info(
                f"Auto-advanced prospect {prospect_id} "
                f"past step '{step.name}' on {trigger}"
            )
            return True
        except Exception as e:
            logger.error(
                f"Failed to auto-advance prospect " f"{prospect_id} on {trigger}: {e}"
            )
            return False

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
                        "step_type": "form_submission",
                        "is_first_step": True,
                        "required": True,
                    },
                    {
                        "name": "Send Welcome Email",
                        "step_type": "automated_email",
                        "required": True,
                        "config": {
                            "email_subject": "Welcome to {{organization_name}}!",
                            "include_welcome": True,
                            "welcome_message": (
                                "Thank you for your interest in joining our department. "
                                "We look forward to meeting you!"
                            ),
                            "include_next_meeting": True,
                            "next_meeting_details": (
                                "Please contact the department for the next meeting date and location."
                            ),
                            "include_faq_link": False,
                        },
                    },
                    {
                        "name": "Interest Meeting Attended",
                        "step_type": "checkbox",
                        "required": True,
                    },
                    {
                        "name": "Application Sent",
                        "step_type": "automated_email",
                        "required": True,
                        "config": {
                            "email_subject": "Membership Application — Next Steps",
                            "include_welcome": True,
                            "welcome_message": (
                                "Please find the attached membership application. "
                                "Complete and return it at your earliest convenience."
                            ),
                            "include_faq_link": False,
                        },
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
                    MembershipPipeline.is_default.is_(True),
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

    async def find_active_prospect_by_email(
        self, organization_id: str, email: str
    ) -> Optional[ProspectiveMember]:
        """Public wrapper over :meth:`_find_active_prospect_by_email`.

        Callers that create prospects from a non-application context — a guest
        signing in at a room kiosk, say — need to know whether one already
        exists *before* calling :meth:`create_prospect`, whose duplicate path
        emails the applicant a "we already have your application" notice. That
        notice is right for a re-submitted application and wrong for someone
        who merely walked into a second interest meeting.
        """
        return await self._find_active_prospect_by_email(organization_id, email)

    async def _find_active_prospect_by_email(
        self, organization_id: str, email: str
    ) -> Optional[ProspectiveMember]:
        """Return an existing active/pending prospect with the given email.

        Eager-loads the same relationships :meth:`get_prospect` does, because
        ``create_prospect`` returns this instance straight to the client when it
        detects a duplicate. ``ProspectResponse`` reads ``current_step`` and
        ``step_progress``, and resolving those lazily from the async response
        path raises ``MissingGreenlet`` rather than merely being slow — so
        without this the duplicate path answered **500** instead of returning
        the existing applicant, which is the whole point of detecting one.
        """
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
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline).selectinload(
                    MembershipPipeline.steps
                ),
                selectinload(ProspectiveMember.step_progress).selectinload(
                    ProspectStepProgress.step
                ),
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

    @classmethod
    def _map_form_fields(
        cls, fields: List[Any]
    ) -> tuple[Dict[str, Dict[str, str]], set[str]]:
        """Map form fields to prospect fields using label then field_type.

        Returns (mapped, used_targets) where mapped is
        {target: {field_id, label, method}} and used_targets is the set
        of prospect field names that were successfully matched.
        Shared by validate_form_for_pipeline and the legacy
        FormIntegration repair path.
        """
        mapped: Dict[str, Dict[str, str]] = {}
        used_targets: set[str] = set()

        for field in fields:
            normalised = field.label.strip().lower()
            target = cls._LABEL_MAP.get(normalised)
            if target and target not in used_targets:
                mapped[target] = {
                    "field_id": str(field.id),
                    "label": field.label,
                    "method": "label",
                }
                used_targets.add(target)

        for field in fields:
            if str(field.id) in {m["field_id"] for m in mapped.values()}:
                continue
            ft = field.field_type
            if hasattr(ft, "value"):
                ft = ft.value
            target = cls._FIELD_TYPE_MAP.get(ft)
            if target and target not in used_targets:
                mapped[target] = {
                    "field_id": str(field.id),
                    "label": field.label,
                    "method": "field_type",
                }
                used_targets.add(target)

        return mapped, used_targets

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

        mapped, used_targets = self._map_form_fields(fields)
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
        # Org-scope the lookup: form_id arrives from client-supplied step config,
        # so without the org filter an admin could stamp/mutate another org's
        # form (XC-1 cross-tenant write). Fail closed if it isn't in-org.
        form_result = await self.db.execute(
            select(Form).where(
                Form.id == str(form_id),
                Form.organization_id == str(organization_id),
            )
        )
        form = form_result.scalars().first()
        if form is None:
            logger.warning(
                f"Cannot set integration_type for form {form_id}: "
                "form not found in organization"
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

        mapped, used_targets = self._map_form_fields(fields)
        field_mappings: Dict[str, str] = {
            m["field_id"]: target for target, m in mapped.items()
        }

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
        except IntegrityError:
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

    async def _cleanup_orphaned_form_integration(
        self, form_id: str, organization_id: str
    ) -> None:
        """Remove the MEMBERSHIP_INTEREST FormIntegration for *form_id* if no
        other pipeline step still references it in its config.

        Both queries are org-scoped: form_id comes from client-supplied step
        config, so an unscoped delete could remove another org's FormIntegration
        (XC-1 cross-tenant write). The step-usage check is likewise limited to
        the caller's org.
        """
        from app.models.forms import FormIntegration, IntegrationTarget

        # Check if any remaining step in THIS org still references this form_id
        # via a targeted JSON query (MySQL JSON_UNQUOTE(JSON_EXTRACT(...))).
        # Steps are org-scoped through their parent pipeline.
        str_form_id = str(form_id)
        step_count_result = await self.db.execute(
            select(func.count(MembershipPipelineStep.id))
            .join(
                MembershipPipeline,
                MembershipPipelineStep.pipeline_id == MembershipPipeline.id,
            )
            .where(
                func.json_unquote(
                    func.json_extract(MembershipPipelineStep.config, "$.form_id")
                )
                == str_form_id,
                MembershipPipeline.organization_id == str(organization_id),
            )
        )
        if (step_count_result.scalar() or 0) > 0:
            return  # Another step still uses this form — keep the integration.

        result = await self.db.execute(
            select(FormIntegration).where(
                and_(
                    FormIntegration.form_id == str(form_id),
                    FormIntegration.organization_id == str(organization_id),
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
        self,
        pipeline_id: str,
        organization_id: str,
        exclude_prospect_ids: Optional[Iterable[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get statistics for a pipeline"""
        pipeline = await self.get_pipeline(pipeline_id, organization_id)
        if not pipeline:
            return None

        # One grouped query per axis rather than one per status and one per
        # step: a 12-stage pipeline previously cost ~20 round trips to render
        # a single stat header.
        base_scope = and_(
            ProspectiveMember.organization_id == organization_id,
            ProspectiveMember.pipeline_id == pipeline_id,
        )

        status_query = self._apply_prospect_exclusions(
            select(
                ProspectiveMember.status,
                func.count(ProspectiveMember.id),
            ).where(base_scope),
            exclude_prospect_ids,
        ).group_by(ProspectiveMember.status)
        status_rows = (await self.db.execute(status_query)).all()

        status_counts = {s.value: 0 for s in ProspectStatus}
        for status_val, count in status_rows:
            key = status_val.value if hasattr(status_val, "value") else str(status_val)
            status_counts[key] = count or 0

        total = sum(status_counts.values())

        step_query = self._apply_prospect_exclusions(
            select(
                ProspectiveMember.current_step_id,
                func.count(ProspectiveMember.id),
            ).where(
                and_(base_scope, ProspectiveMember.status == ProspectStatus.ACTIVE)
            ),
            exclude_prospect_ids,
        ).group_by(ProspectiveMember.current_step_id)
        step_rows = (await self.db.execute(step_query)).all()
        step_counts = {str(step_id): count or 0 for step_id, count in step_rows}

        by_step = [
            {
                "stage_id": step.id,
                "stage_name": step.name,
                "count": step_counts.get(str(step.id), 0),
            }
            for step in sorted(pipeline.steps, key=lambda s: s.sort_order)
        ]

        # Calculate avg days to transfer
        avg_days = None
        transferred_count = status_counts.get("transferred", 0)
        if transferred_count > 0:
            avg_query = self._apply_prospect_exclusions(
                select(
                    func.avg(
                        func.datediff(
                            ProspectiveMember.transferred_at,
                            ProspectiveMember.created_at,
                        )
                    )
                ).where(
                    and_(
                        base_scope,
                        ProspectiveMember.status == ProspectStatus.TRANSFERRED,
                        ProspectiveMember.transferred_at.isnot(None),
                    )
                ),
                exclude_prospect_ids,
            )
            result = await self.db.execute(avg_query)
            avg_days = result.scalar()

        # Conversion is measured against decided applications. Active, held,
        # inactive, and voluntarily withdrawn records have not produced a
        # positive/negative hiring decision and must not depress the rate.
        decided_count = transferred_count + status_counts.get("rejected", 0)
        conversion_rate = (
            transferred_count / decided_count * 100 if decided_count > 0 else 0
        )

        return {
            "pipeline_id": pipeline_id,
            "total_prospects": total,
            "active_count": status_counts.get("active", 0),
            "on_hold_count": status_counts.get("on_hold", 0),
            "inactive_count": status_counts.get("inactive", 0),
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

        # MP-5 (XC-1): a client-supplied step_id must belong to this prospect's
        # own (org-scoped) pipeline — the same guard create_interview /
        # create_election_package apply. Without it a foreign/other-pipeline
        # step id persists as a dangling FK on the document (and would drive the
        # auto-advance below off a step that isn't the prospect's).
        if step_id:
            steps = prospect.pipeline.steps if prospect.pipeline else []
            if not any(str(s.id) == str(step_id) for s in steps):
                raise ValueError("Step does not belong to this prospect's pipeline")

        # Validate file_path: must resolve to a location under the uploads
        # volume (mounted at /app/uploads in docker-compose) to prevent path
        # traversal via symlinks or unicode tricks.
        from pathlib import Path

        base_dir = Path("/app/uploads").resolve()
        resolved = Path(file_path).resolve()
        if (
            not str(resolved).startswith(str(base_dir) + os.sep)
            and resolved != base_dir
        ):
            raise ValueError(
                "Invalid file_path: must be under /app/uploads and may not "
                "contain path traversal"
            )

        # Sanitise file_name to prevent path injection through the file name
        safe_file_name = os.path.basename(file_name)

        doc = ProspectDocument(
            id=generate_uuid(),
            prospect_id=prospect_id,
            step_id=step_id,
            document_type=document_type,
            file_name=safe_file_name,
            file_path=str(resolved),
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

        # Auto-advance if the step has auto_advance enabled
        if step_id:
            await self._try_auto_advance_step(
                prospect_id=prospect_id,
                organization_id=organization_id,
                step_id=step_id,
                completed_by=uploaded_by or "system",
                trigger="document upload",
                action_result={"document_id": doc.id},
            )

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

        # Remove the stored file from disk before dropping the DB row so the
        # two stay consistent. Best-effort: a missing file must not block the
        # metadata deletion.
        stored_path = doc.file_path
        await self.db.delete(doc)
        await self.db.commit()

        if stored_path:
            import os

            try:
                if os.path.exists(stored_path):
                    await asyncio.to_thread(os.remove, stored_path)
            except OSError as exc:
                logger.warning(
                    f"Failed to remove prospect document file {stored_path}: {exc}"
                )

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

        # MP-5: validate any client-supplied pipeline_id / step_id are in-org
        # and consistent, so the package can't persist a foreign/dangling FK.
        effective_pipeline = prospect.pipeline
        if pipeline_id and str(pipeline_id) != str(prospect.pipeline_id or ""):
            effective_pipeline = await self.get_pipeline(
                str(pipeline_id), organization_id
            )
            if not effective_pipeline:
                raise ValueError("Pipeline does not belong to this organization")
        if step_id:
            steps = effective_pipeline.steps if effective_pipeline else []
            if not any(str(s.id) == str(step_id) for s in steps):
                raise ValueError("Step does not belong to the selected pipeline")

        # Eagerly load documents so the snapshot captures attached files
        doc_query = (
            select(ProspectDocument)
            .where(ProspectDocument.prospect_id == prospect_id)
            .order_by(ProspectDocument.created_at)
        )
        doc_result = await self.db.execute(doc_query)
        documents = list(doc_result.scalars().all())

        # Build stage history from completed step progress
        stage_history: List[Dict[str, Any]] = []
        for sp in prospect.step_progress or []:
            if sp.status == StepProgressStatus.COMPLETED and sp.step:
                stage_history.append(
                    {
                        "stage_name": sp.step.name,
                        "completed_at": (
                            str(sp.completed_at) if sp.completed_at else None
                        ),
                    }
                )

        # Build applicant snapshot — capture all relevant prospect data
        # so the election package is self-contained even if the prospect
        # record is later modified.
        snapshot: Dict[str, Any] = {
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
            "desired_membership_type": prospect.desired_membership_type,
            "notes": prospect.notes,
            "created_at": str(prospect.created_at) if prospect.created_at else None,
            "documents": [
                {
                    "name": doc.file_name,
                    "document_type": doc.document_type,
                }
                for doc in documents
            ],
            "stage_history": stage_history,
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
        # `created_at` / `updated_at` are server-side defaults, so the INSERT
        # leaves them expired. The endpoint serialises this object through a
        # response_model that requires both, and Pydantic's attribute read is
        # synchronous — the lazy reload it triggers raises MissingGreenlet and
        # the POST 500s on a package it did create. Load them here instead.
        await self.db.refresh(pkg)
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

        applied = dict(updates)
        if isinstance(applied.get("package_config"), dict):
            # Merge into existing config to avoid wiping previously stored
            # keys (documents, stage_summary, etc.) — a partial config dict
            # adds to what is there rather than replacing it. An explicit
            # null still falls through to apply_updates and clears the column.
            merged = copy.deepcopy(pkg.package_config or {})
            merged.update(applied["package_config"])
            applied["package_config"] = merged

        apply_updates(pkg, applied, skip=self._ELECTION_PKG_PROTECTED_FIELDS)

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
        exclude_prospect_ids: Optional[Iterable[str]] = None,
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
        query = self._apply_prospect_exclusions(query, exclude_prospect_ids)
        if pipeline_id:
            query = query.where(ProspectElectionPackage.pipeline_id == pipeline_id)
        if status_filter:
            query = query.where(ProspectElectionPackage.status == status_filter)

        query = query.order_by(ProspectElectionPackage.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def assign_package_to_election(
        self,
        prospect_id: str,
        organization_id: str,
        election_id: str,
        assigned_by: Optional[str] = None,
    ) -> ProspectElectionPackage:
        """Assign a ready election package to a draft election as a ballot item.

        Creates a membership_approval ballot item from the package snapshot
        and appends it to the election's ballot_items JSON. Updates the
        package status to 'added_to_ballot' and links it to the election.

        Raises ValueError if the package is not ready or the election is
        not in DRAFT status.
        """
        pkg = await self.get_election_package(prospect_id, organization_id)
        if not pkg:
            raise ValueError("Election package not found")
        if pkg.status != "ready":
            raise ValueError(
                f"Package must be in 'ready' status to assign "
                f"(current: '{pkg.status}')"
            )

        election_result = await self.db.execute(
            select(Election).where(
                Election.id == election_id,
                Election.organization_id == organization_id,
            )
        )
        election = election_result.scalars().first()
        if not election:
            raise ValueError("Election not found")
        if election.status != ElectionStatus.DRAFT:
            raise ValueError("Election must be in DRAFT status to add ballot items")

        snapshot = pkg.applicant_snapshot or {}
        first_name = snapshot.get("first_name", "")
        last_name = snapshot.get("last_name", "")
        full_name = f"{first_name} {last_name}".strip() or "Applicant"
        membership_type = (
            snapshot.get("desired_membership_type", "regular") or "regular"
        )

        # Build a ballot item title from the appropriate template
        if membership_type == "administrative":
            title = f"Accept {full_name} as Administrative Member"
            description = (
                f"Vote to accept {full_name} into the organization "
                f"as an administrative member."
            )
            eligible_voter_types = ["all"]
        else:
            title = f"Approve {full_name} for Regular Membership"
            description = (
                f"Vote to approve the transition of {full_name} "
                f"from probationary to regular member status."
            )
            eligible_voter_types = ["regular", "life"]

        # Use stage config overrides if available
        config = pkg.package_config or {}
        recommended = config.get("recommended_ballot_item") or {}
        ballot_item_id = f"pkg_{pkg.id[:8]}_{generate_uuid()[:8]}"

        ballot_item = {
            "id": ballot_item_id,
            "type": "membership_approval",
            "title": recommended.get("title") or title,
            "description": recommended.get("description") or description,
            "eligible_voter_types": (
                recommended.get("eligible_voter_types") or eligible_voter_types
            ),
            "vote_type": "approval",
            "require_attendance": recommended.get("require_attendance", True),
            "victory_condition": recommended.get("victory_condition"),
            "victory_percentage": recommended.get("victory_percentage"),
            "voting_method": recommended.get("voting_method"),
            "prospect_package_id": pkg.id,
        }

        # Append to election's ballot_items JSON (deep-copy to avoid
        # SQLAlchemy change-tracking issues with shared references).
        existing_items = copy.deepcopy(election.ballot_items or [])
        existing_items.append(ballot_item)
        election.ballot_items = existing_items

        # Link the package to this election and advance status
        pkg.election_id = election_id
        pkg.status = "added_to_ballot"
        updated_config = copy.deepcopy(pkg.package_config or {})
        updated_config["ballot_item_id"] = ballot_item_id
        updated_config["assigned_by"] = assigned_by
        updated_config["assigned_at"] = datetime.now(timezone.utc).isoformat()
        pkg.package_config = updated_config

        await self._log_activity(
            prospect_id=prospect_id,
            action="election_package_assigned",
            details={
                "package_id": pkg.id,
                "election_id": election_id,
                "election_title": election.title,
                "ballot_item_id": ballot_item_id,
            },
            performed_by=assigned_by,
        )

        await self.db.commit()
        await self.db.refresh(pkg)
        return pkg

    # =========================================================================
    # Public Status Check
    # =========================================================================

    # Status tokens expire after 30 days to limit exposure if leaked.
    _STATUS_TOKEN_TTL_DAYS = 30

    @staticmethod
    def _build_current_stage_action(step: Any) -> Optional[Dict[str, Any]]:
        """Derive an applicant-facing action from the current step's config.

        Surfaces integration-backed affordances on the public status page:
        a Cal.com self-scheduling link for meeting stages, or an e-signature
        note for document stages configured to use Documenso. Only a
        coordinator-configured public booking URL is ever echoed — no
        credentials or internal identifiers.
        """
        config = getattr(step, "config", None) or {}
        raw_type = getattr(step, "step_type", None)
        step_type = raw_type.value if hasattr(raw_type, "value") else raw_type

        if step_type == "meeting" and config.get("scheduling_provider") == "calcom":
            url = config.get("calcom_booking_url") or ""
            # Only surface a link we can trust as an external http(s) URL.
            if isinstance(url, str) and url.lower().startswith(("http://", "https://")):
                return {
                    "type": "calcom_scheduling",
                    "label": "Schedule Your Meeting",
                    "url": url,
                    "message": "Pick a time that works for you.",
                }
            return None

        if (
            step_type == "document_upload"
            and config.get("signing_provider") == "documenso"
        ):
            return {
                "type": "documenso_signature",
                "label": "Documents Sent for Signature",
                "message": (
                    "The department will send your documents to sign "
                    "electronically. Watch your email for a signing request."
                ),
            }

        return None

    async def get_prospect_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Look up a prospect by their public status token. Returns limited public-safe fields.

        Returns None if the pipeline has public_status_enabled=False,
        if the token has expired, or if no match is found.
        Only steps with public_visible=True are included in the timeline.

        Successful lookups refresh the token's inactivity timestamp. The
        bearer token itself is never reflected into the response.
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

        # Keep the token stable — it is the credential embedded in the
        # status link emailed to the prospect, so it must survive repeat
        # views (refreshes, bookmarks, revisits). Rotating it on read made
        # the emailed link single-use: the caller never receives the new
        # token, so the next request 404'd. Refresh only the timestamp so
        # the TTL slides forward on each check — the link expires after
        # _STATUS_TOKEN_TTL_DAYS of inactivity rather than a fixed window
        # from when the application was submitted (which a multi-week
        # pipeline would routinely outlast).
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
            # Pipeline position, not created_at. Progress rows for an applicant
            # who moves several stages in quick succession share a timestamp to
            # the second, and the DATETIME tie then renders the applicant's own
            # status page with its stages in an arbitrary order.
            for sp in sorted(
                prospect.step_progress,
                key=lambda p: (
                    p.step.sort_order if p.step else 0,
                    p.created_at,
                ),
            ):
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
        current_stage_action = None
        if prospect.current_step and str(prospect.current_step.id) in public_step_ids:
            current_stage_name = prospect.current_step.name
            current_stage_action = self._build_current_stage_action(
                prospect.current_step
            )

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
            "current_stage_action": current_stage_action,
            "pipeline_name": prospect.pipeline.name if prospect.pipeline else None,
            "total_stages": total_public_stages,
            "stage_timeline": completed_stages,
            "applied_at": (
                prospect.created_at.isoformat() if prospect.created_at else None
            ),
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

        Prior-activity lookups are batched rather than run per prospect: this
        runs over every stale prospect in the organization, so a department
        with a long-neglected pipeline paid one SELECT per prospect plus one
        UPDATE each just to decide it had nothing new to do.
        """
        warnings = await self.check_inactivity(organization_id)
        if not warnings:
            return {"warnings_sent": 0, "marked_inactive": 0, "total_checked": 0}

        critical = [w for w in warnings if w["alert_level"] == "critical"]
        warned = [w for w in warnings if w["alert_level"] != "critical"]

        already_marked = await self._prospects_with_action(
            [w["prospect_id"] for w in critical], "marked_inactive_by_system"
        )
        last_warned_at = await self._latest_action_times(
            [w["prospect_id"] for w in warned], "inactivity_warning_sent"
        )

        now = datetime.now(timezone.utc)
        warning_count = 0
        inactive_count = 0

        to_mark = [w for w in critical if w["prospect_id"] not in already_marked]
        if to_mark:
            # One UPDATE for the whole batch instead of one per prospect.
            await self.db.execute(
                update(ProspectiveMember)
                .where(ProspectiveMember.id.in_([w["prospect_id"] for w in to_mark]))
                .values(status=ProspectStatus.INACTIVE)
            )
            for w in to_mark:
                await self._log_activity(
                    prospect_id=w["prospect_id"],
                    action="marked_inactive_by_system",
                    details={
                        "days_inactive": w["days_inactive"],
                        "timeout_days": w["timeout_days"],
                    },
                    performed_by=processed_by,
                )
            inactive_count = len(to_mark)

        for w in warned:
            previous = last_warned_at.get(w["prospect_id"])
            # Warn at most once per 7-day period.
            if previous is not None and (now - previous).days < 7:
                continue
            await self._log_activity(
                prospect_id=w["prospect_id"],
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

    async def _prospects_with_action(self, prospect_ids: List[str], action: str) -> set:
        """Which of ``prospect_ids`` already have an activity entry for ``action``."""
        if not prospect_ids:
            return set()
        result = await self.db.execute(
            select(ProspectActivityLog.prospect_id)
            .where(
                ProspectActivityLog.prospect_id.in_(prospect_ids),
                ProspectActivityLog.action == action,
            )
            .distinct()
        )
        return {str(pid) for pid in result.scalars().all()}

    async def _latest_action_times(
        self, prospect_ids: List[str], action: str
    ) -> Dict[str, datetime]:
        """Most recent ``action`` timestamp per prospect, as aware UTC."""
        if not prospect_ids:
            return {}
        result = await self.db.execute(
            select(
                ProspectActivityLog.prospect_id,
                func.max(ProspectActivityLog.created_at),
            )
            .where(
                ProspectActivityLog.prospect_id.in_(prospect_ids),
                ProspectActivityLog.action == action,
            )
            .group_by(ProspectActivityLog.prospect_id)
        )
        times: Dict[str, datetime] = {}
        for prospect_id, created_at in result.all():
            if created_at is None:
                continue
            # func.max() can come back naive depending on the driver, and the
            # comparison below is against an aware "now".
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            times[str(prospect_id)] = created_at
        return times

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

        # MP-5: reject a client-supplied step_id that isn't in this prospect's
        # pipeline (integrity — prevents a dangling step FK on the interview).
        if step_id:
            steps = prospect.pipeline.steps if prospect.pipeline else []
            if not any(str(s.id) == str(step_id) for s in steps):
                raise ValueError("Step does not belong to this prospect's pipeline")

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

        # Auto-advance if the step has auto_advance enabled
        effective_step_id = step_id or (
            str(prospect.current_step_id) if prospect.current_step_id else None
        )
        if effective_step_id and organization_id:
            await self._try_auto_advance_step(
                prospect_id=prospect_id,
                organization_id=organization_id,
                step_id=effective_step_id,
                completed_by=interviewer_id,
                trigger="interview submission",
                action_result={"interview_id": interview.id},
            )

        # Re-fetch to get relationships loaded
        interview_loaded = await self.get_interview(interview.id, organization_id)
        if interview_loaded is None:
            raise ValueError(
                f"Failed to re-fetch interview {interview.id} immediately after creation"
            )
        return interview_loaded

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
                    linker_name = f"{linker.first_name} {linker.last_name}".strip()

            enriched.append(
                {
                    "id": link.id,
                    "prospect_id": link.prospect_id,
                    "event_id": link.event_id,
                    "event_title": event.title if event else None,
                    "event_type": (
                        event.event_type.value if event and event.event_type else None
                    ),
                    "custom_category": (event.custom_category if event else None),
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

        # The commit expired every attribute on `link`, and the response below
        # reads several of them — including the server-side `created_at`. Those
        # reads are synchronous, so the lazy reload they trigger raises
        # MissingGreenlet and the POST 500s on a link it did create.
        await self.db.refresh(link)

        # Return enriched response
        linker_result = await self.db.execute(select(User).where(User.id == linked_by))
        linker = linker_result.scalar_one_or_none()
        linker_name = (
            f"{linker.first_name} {linker.last_name}".strip() if linker else None
        )

        return {
            "id": link.id,
            "prospect_id": link.prospect_id,
            "event_id": link.event_id,
            "event_title": event.title,
            "event_type": (event.event_type.value if event.event_type else None),
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
