"""
Evaluation templates and review periods: the setup half of member
performance evaluations.

A template's content lives on its versions. The one version with
``published_at`` NULL is the editable draft; publishing stamps it and freezes
it, and the next edit opens a new draft numbered after it. An evaluation
records the version it started on, so nothing here can change one already
under way.

Every query is scoped to the caller's organization (CLAUDE.md pitfall #14),
and every id a template stores — an approval step's position, an officer
rank — is checked against that organization before it is saved.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation import (
    Evaluation,
    EvaluationPeriod,
    EvaluationTemplate,
    EvaluationTemplateKind,
    EvaluationTemplateVersion,
)
from app.models.operational_rank import OperationalRank
from app.models.user import Position
from app.schemas.evaluation import (
    EvaluationPeriodCreate,
    EvaluationTemplateCreate,
    TemplateDefinition,
    TemplateDraftWrite,
    TemplateWorkflow,
    default_definition,
    default_workflow,
    definition_publish_errors,
    workflow_publish_errors,
)
from app.services.evaluation_data_sources import DATA_SOURCES
from app.utils.model_updates import apply_updates


class EvaluationTemplateService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------ templates --

    async def get_template(
        self, organization_id: str, template_id: str, *, for_update: bool = False
    ) -> Optional[EvaluationTemplate]:
        query = select(EvaluationTemplate).where(
            EvaluationTemplate.id == str(template_id),
            EvaluationTemplate.organization_id == str(organization_id),
        )
        if for_update:
            query = query.with_for_update()
        return (await self.db.execute(query)).scalar_one_or_none()

    async def list_templates(self, organization_id: str) -> List[Dict[str, Any]]:
        templates = (
            (
                await self.db.execute(
                    select(EvaluationTemplate)
                    .where(EvaluationTemplate.organization_id == str(organization_id))
                    .order_by(EvaluationTemplate.name)
                )
            )
            .scalars()
            .all()
        )
        versions = await self._versions_by_template(
            organization_id, [t.id for t in templates]
        )
        counts = await self._evaluation_counts(organization_id)
        return [
            self._summary(t, versions.get(t.id, []), counts.get(t.id, 0))
            for t in templates
        ]

    async def template_detail(
        self, organization_id: str, template_id: str
    ) -> Optional[Dict[str, Any]]:
        template = await self.get_template(organization_id, template_id)
        if template is None:
            return None
        versions = (
            await self._versions_by_template(organization_id, [template.id])
        ).get(template.id, [])
        counts = await self._evaluation_counts(organization_id)
        detail = self._summary(template, versions, counts.get(template.id, 0))
        draft = next((v for v in versions if v.published_at is None), None)
        published = [v for v in versions if v.published_at is not None]
        detail["draft"] = self._version_view(draft) if draft else None
        detail["published"] = self._version_view(published[-1]) if published else None
        detail["versions"] = [
            {
                "id": v.id,
                "version_number": v.version_number,
                "published_at": v.published_at,
            }
            for v in published
        ]
        return detail

    async def create_template(
        self, organization_id: str, data: EvaluationTemplateCreate, actor_id: str
    ) -> str:
        await self._assert_name_free(organization_id, data.name, exclude_id=None)
        await self._assert_matching_free(
            organization_id,
            data.kind.value,
            data.member_class,
            data.member_status,
            exclude_id=None,
        )
        template = EvaluationTemplate(
            organization_id=str(organization_id),
            name=data.name,
            description=data.description,
            kind=data.kind.value,
            member_class=data.member_class,
            member_status=data.member_status,
            created_by=str(actor_id),
        )
        self.db.add(template)
        await self.db.flush()
        self.db.add(
            EvaluationTemplateVersion(
                organization_id=str(organization_id),
                template_id=template.id,
                version_number=1,
                definition=default_definition().model_dump(mode="json"),
                workflow=default_workflow(data.kind).model_dump(mode="json"),
                created_by=str(actor_id),
            )
        )
        await self.db.commit()
        return template.id

    async def update_template(
        self, organization_id: str, template_id: str, updates: Dict[str, Any]
    ) -> Optional[EvaluationTemplate]:
        template = await self.get_template(organization_id, template_id)
        if template is None:
            return None
        if "name" in updates and updates["name"] is None:
            raise ValueError("A template needs a name")
        if updates.get("name") is not None:
            await self._assert_name_free(
                organization_id, updates["name"], exclude_id=template.id
            )
        becomes_active = updates.get("is_active", template.is_active)
        if becomes_active:
            await self._assert_matching_free(
                organization_id,
                template.kind,
                updates.get("member_class", template.member_class),
                updates.get("member_status", template.member_status),
                exclude_id=template.id,
            )
        apply_updates(template, updates)
        await self.db.commit()
        return template

    async def save_draft(
        self,
        organization_id: str,
        template_id: str,
        data: TemplateDraftWrite,
        actor_id: str,
    ) -> Optional[str]:
        """Write the draft, opening one after the latest published version if
        none is open. Returns the template id, or None when it is not this
        organization's."""
        # Locked so two editors saving at once cannot both open a draft with
        # the same next version number.
        template = await self.get_template(
            organization_id, template_id, for_update=True
        )
        if template is None:
            return None
        await self._assert_references_in_org(
            organization_id, data.definition, data.workflow
        )
        draft = await self._draft(organization_id, template.id)
        if draft is None:
            latest = await self.db.scalar(
                select(func.max(EvaluationTemplateVersion.version_number)).where(
                    EvaluationTemplateVersion.template_id == template.id,
                    EvaluationTemplateVersion.organization_id == str(organization_id),
                )
            )
            draft = EvaluationTemplateVersion(
                organization_id=str(organization_id),
                template_id=template.id,
                version_number=(latest or 0) + 1,
                created_by=str(actor_id),
            )
            self.db.add(draft)
        draft.definition = data.definition.model_dump(mode="json")
        draft.workflow = data.workflow.model_dump(mode="json")
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError(
                "The template was changed by someone else. Reload it and try again."
            ) from exc
        return template.id

    async def discard_draft(self, organization_id: str, template_id: str) -> bool:
        template = await self.get_template(
            organization_id, template_id, for_update=True
        )
        if template is None:
            return False
        draft = await self._draft(organization_id, template.id)
        if draft is None:
            raise ValueError("There is no draft to discard.")
        published = await self.db.scalar(
            select(func.count())
            .select_from(EvaluationTemplateVersion)
            .where(
                EvaluationTemplateVersion.template_id == template.id,
                EvaluationTemplateVersion.organization_id == str(organization_id),
                EvaluationTemplateVersion.published_at.is_not(None),
            )
        )
        if not published:
            raise ValueError(
                "This template has never been published, so the draft is all it "
                "has. Delete the template instead."
            )
        await self.db.delete(draft)
        await self.db.commit()
        return True

    async def publish(
        self, organization_id: str, template_id: str, actor_id: str
    ) -> Optional[List[str]]:
        """Freeze the draft. Returns the reasons it cannot be published (empty
        on success), or None when the template is not this organization's."""
        template = await self.get_template(
            organization_id, template_id, for_update=True
        )
        if template is None:
            return None
        draft = await self._draft(organization_id, template.id)
        if draft is None:
            return ["There is no draft to publish."]
        definition = TemplateDefinition.model_validate(draft.definition)
        workflow = TemplateWorkflow.model_validate(draft.workflow)
        errors = definition_publish_errors(definition) + workflow_publish_errors(
            workflow, EvaluationTemplateKind(template.kind)
        )
        if errors:
            return errors
        # A rank or position removed since the draft was saved would leave the
        # frozen version pointing at nothing.
        await self._assert_references_in_org(organization_id, definition, workflow)
        draft.published_at = func.now()
        draft.published_by = str(actor_id)
        await self.db.commit()
        return []

    async def delete_template(self, organization_id: str, template_id: str) -> bool:
        template = await self.get_template(organization_id, template_id)
        if template is None:
            return False
        if (await self._evaluation_counts(organization_id)).get(template.id):
            raise ValueError(
                "Evaluations have been started on this template, so it is kept "
                "with them. Retire it instead."
            )
        await self.db.delete(template)
        await self.db.commit()
        return True

    async def builder_options(self, organization_id: str) -> Dict[str, Any]:
        positions = (
            await self.db.execute(
                select(Position.id, Position.name)
                .where(Position.organization_id == str(organization_id))
                .order_by(Position.name)
            )
        ).all()
        ranks = (
            await self.db.execute(
                select(
                    OperationalRank.rank_code,
                    OperationalRank.display_name,
                    OperationalRank.is_active,
                )
                .where(OperationalRank.organization_id == str(organization_id))
                .order_by(OperationalRank.sort_order, OperationalRank.display_name)
            )
        ).all()
        return {
            "positions": [{"id": p.id, "name": p.name} for p in positions],
            "ranks": [
                {
                    "rank_code": r.rank_code,
                    "display_name": r.display_name,
                    "is_active": bool(r.is_active),
                }
                for r in ranks
            ],
        }

    @staticmethod
    def data_sources() -> List[Dict[str, Any]]:
        return [
            {
                "key": s.key,
                "label": s.label,
                "unit": s.unit,
                "module": s.module,
                "description": s.description,
                "scoreable": s.scoreable,
            }
            for s in DATA_SOURCES
        ]

    # -------------------------------------------------------------- periods --

    async def list_periods(self, organization_id: str) -> List[Dict[str, Any]]:
        periods = (
            (
                await self.db.execute(
                    select(EvaluationPeriod)
                    .where(EvaluationPeriod.organization_id == str(organization_id))
                    .order_by(EvaluationPeriod.start_date.desc())
                )
            )
            .scalars()
            .all()
        )
        counts = dict(
            (
                await self.db.execute(
                    select(Evaluation.period_id, func.count())
                    .where(
                        Evaluation.organization_id == str(organization_id),
                        Evaluation.period_id.is_not(None),
                    )
                    .group_by(Evaluation.period_id)
                )
            ).all()
        )
        return [self._period_view(p, counts.get(p.id, 0)) for p in periods]

    async def get_period(
        self, organization_id: str, period_id: str
    ) -> Optional[EvaluationPeriod]:
        return (
            await self.db.execute(
                select(EvaluationPeriod).where(
                    EvaluationPeriod.id == str(period_id),
                    EvaluationPeriod.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()

    async def create_period(
        self, organization_id: str, data: EvaluationPeriodCreate, actor_id: str
    ) -> Dict[str, Any]:
        await self._assert_period_name_free(organization_id, data.name, exclude_id=None)
        period = EvaluationPeriod(
            organization_id=str(organization_id),
            name=data.name,
            start_date=data.start_date,
            end_date=data.end_date,
            created_by=str(actor_id),
        )
        self.db.add(period)
        await self.db.commit()
        await self.db.refresh(period)
        return self._period_view(period, 0)

    async def update_period(
        self, organization_id: str, period_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        period = await self.get_period(organization_id, period_id)
        if period is None:
            return None
        for field in ("name", "start_date", "end_date", "is_closed"):
            if field in updates and updates[field] is None:
                raise ValueError(f"'{field}' cannot be cleared")
        count = await self._period_evaluation_count(organization_id, period.id)
        moves = {
            field
            for field in ("start_date", "end_date")
            if field in updates and updates[field] != getattr(period, field)
        }
        if moves and count:
            # Each evaluation copied the period's dates and measured its data
            # over them; moving the period would leave them disagreeing.
            raise ValueError(
                "Evaluations have been drafted for this period, so its dates are "
                "fixed. Open a new period instead."
            )
        start = updates.get("start_date", period.start_date)
        end = updates.get("end_date", period.end_date)
        if end < start:
            raise ValueError("A review period cannot end before it starts")
        if updates.get("name") is not None:
            await self._assert_period_name_free(
                organization_id, updates["name"], exclude_id=period.id
            )
        apply_updates(period, updates)
        await self.db.commit()
        await self.db.refresh(period)
        return self._period_view(period, count)

    async def delete_period(self, organization_id: str, period_id: str) -> bool:
        period = await self.get_period(organization_id, period_id)
        if period is None:
            return False
        if await self._period_evaluation_count(organization_id, period.id):
            raise ValueError(
                "Evaluations have been drafted for this period. Close it instead."
            )
        await self.db.delete(period)
        await self.db.commit()
        return True

    # -------------------------------------------------------------- helpers --

    async def _draft(
        self, organization_id: str, template_id: str
    ) -> Optional[EvaluationTemplateVersion]:
        return (
            await self.db.execute(
                select(EvaluationTemplateVersion).where(
                    EvaluationTemplateVersion.template_id == str(template_id),
                    EvaluationTemplateVersion.organization_id == str(organization_id),
                    EvaluationTemplateVersion.published_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def _versions_by_template(
        self, organization_id: str, template_ids: List[str]
    ) -> Dict[str, List[EvaluationTemplateVersion]]:
        if not template_ids:
            return {}
        rows = (
            (
                await self.db.execute(
                    select(EvaluationTemplateVersion)
                    .where(
                        EvaluationTemplateVersion.organization_id
                        == str(organization_id),
                        EvaluationTemplateVersion.template_id.in_(template_ids),
                    )
                    .order_by(EvaluationTemplateVersion.version_number)
                )
            )
            .scalars()
            .all()
        )
        grouped: Dict[str, List[EvaluationTemplateVersion]] = {}
        for row in rows:
            grouped.setdefault(row.template_id, []).append(row)
        return grouped

    async def _evaluation_counts(self, organization_id: str) -> Dict[str, int]:
        rows = await self.db.execute(
            select(EvaluationTemplateVersion.template_id, func.count(Evaluation.id))
            .join(
                Evaluation,
                Evaluation.template_version_id == EvaluationTemplateVersion.id,
            )
            .where(
                Evaluation.organization_id == str(organization_id),
                EvaluationTemplateVersion.organization_id == str(organization_id),
            )
            .group_by(EvaluationTemplateVersion.template_id)
        )
        return {template_id: int(count) for template_id, count in rows.all()}

    async def _period_evaluation_count(
        self, organization_id: str, period_id: str
    ) -> int:
        return int(
            await self.db.scalar(
                select(func.count())
                .select_from(Evaluation)
                .where(
                    Evaluation.organization_id == str(organization_id),
                    Evaluation.period_id == str(period_id),
                )
            )
            or 0
        )

    async def _assert_name_free(
        self, organization_id: str, name: str, exclude_id: Optional[str]
    ) -> None:
        query = select(EvaluationTemplate.id).where(
            EvaluationTemplate.organization_id == str(organization_id),
            func.lower(EvaluationTemplate.name) == name.lower(),
        )
        if exclude_id is not None:
            query = query.where(EvaluationTemplate.id != exclude_id)
        if await self.db.scalar(query):
            raise ValueError(f"A template named '{name}' already exists.")

    async def _assert_matching_free(
        self,
        organization_id: str,
        kind: str,
        member_class: Optional[str],
        member_status: Optional[str],
        exclude_id: Optional[str],
    ) -> None:
        """Two active templates of one kind cannot claim exactly the same
        members, or drafting would have no way to choose between them. A more
        specific template beside a general one is fine: the specific one wins."""
        query = select(EvaluationTemplate.name).where(
            EvaluationTemplate.organization_id == str(organization_id),
            EvaluationTemplate.is_active.is_(True),
            EvaluationTemplate.kind == kind,
            (
                EvaluationTemplate.member_class.is_(None)
                if member_class is None
                else EvaluationTemplate.member_class == member_class
            ),
            (
                EvaluationTemplate.member_status.is_(None)
                if member_status is None
                else EvaluationTemplate.member_status == member_status
            ),
        )
        if exclude_id is not None:
            query = query.where(EvaluationTemplate.id != exclude_id)
        clash = await self.db.scalar(query)
        if clash:
            raise ValueError(
                f"'{clash}' already applies to exactly these members. Change who "
                "this template applies to, or retire the other one."
            )

    async def _assert_references_in_org(
        self,
        organization_id: str,
        definition: TemplateDefinition,
        workflow: TemplateWorkflow,
    ) -> None:
        if definition.officer_ranks:
            known = set(
                (
                    await self.db.execute(
                        select(OperationalRank.rank_code).where(
                            OperationalRank.organization_id == str(organization_id),
                            OperationalRank.rank_code.in_(definition.officer_ranks),
                        )
                    )
                )
                .scalars()
                .all()
            )
            unknown = [r for r in definition.officer_ranks if r not in known]
            if unknown:
                raise ValueError(
                    "These ranks are not defined in your department: "
                    + ", ".join(unknown)
                )
        position_ids = {
            s.actor.position_id for s in workflow.steps if s.actor.position_id
        }
        if position_ids:
            found = set(
                (
                    await self.db.execute(
                        select(Position.id).where(
                            Position.organization_id == str(organization_id),
                            Position.id.in_(position_ids),
                        )
                    )
                )
                .scalars()
                .all()
            )
            if found != position_ids:
                raise ValueError(
                    "An approval step names a position that does not exist."
                )

    async def _assert_period_name_free(
        self, organization_id: str, name: str, exclude_id: Optional[str]
    ) -> None:
        query = select(EvaluationPeriod.id).where(
            EvaluationPeriod.organization_id == str(organization_id),
            func.lower(EvaluationPeriod.name) == name.lower(),
        )
        if exclude_id is not None:
            query = query.where(EvaluationPeriod.id != exclude_id)
        if await self.db.scalar(query):
            raise ValueError(f"A review period named '{name}' already exists.")

    @staticmethod
    def _summary(
        template: EvaluationTemplate,
        versions: List[EvaluationTemplateVersion],
        evaluations_count: int,
    ) -> Dict[str, Any]:
        published = [v.version_number for v in versions if v.published_at is not None]
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "kind": template.kind,
            "member_class": template.member_class,
            "member_status": template.member_status,
            "is_active": template.is_active,
            "published_version": max(published) if published else None,
            "has_draft": any(v.published_at is None for v in versions),
            "evaluations_count": evaluations_count,
            "updated_at": template.updated_at,
        }

    @staticmethod
    def _version_view(version: EvaluationTemplateVersion) -> Dict[str, Any]:
        return {
            "id": version.id,
            "version_number": version.version_number,
            "published_at": version.published_at,
            "updated_at": version.updated_at,
            "definition": version.definition,
            "workflow": version.workflow,
        }

    @staticmethod
    def _period_view(
        period: EvaluationPeriod, evaluations_count: int
    ) -> Dict[str, Any]:
        return {
            "id": period.id,
            "name": period.name,
            "start_date": period.start_date,
            "end_date": period.end_date,
            "is_closed": period.is_closed,
            "evaluations_count": evaluations_count,
            "created_at": period.created_at,
            "updated_at": period.updated_at,
        }
