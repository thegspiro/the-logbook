"""
Member performance evaluations: drafting, the data snapshot and the workflow.

An evaluation is drafted for one member and one review period from the
published version of a template. Drafting measures the member's coverage and
takes a snapshot of the figures the form shows; the evaluator may refresh it
until they lock their part, after which it is fixed.

The workflow only moves forward. The self-evaluation and the evaluator's part
are open together, and each author saves drafts freely before submitting,
which locks their part. The evaluator never reads a self-evaluation before the
member submits it. Where the template has a calibration step, the evaluator's
first submission sends their draft to calibration instead of locking it;
calibration is hidden from the member, and the evaluator locks the part
afterwards, so any change it prompts is the evaluator's own. Approvals and the
member's acknowledgement are signed steps and complete through signatures,
which arrive with the signing change; a check-in has neither and finalizes
when the evaluator locks it.

Access is decided here, not by the screens (CLAUDE.md pitfall #29): who may
see an evaluation, which parts and figures they may read, and what they may
do, is computed per viewer and returned with the evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.utils import list_within_detail_limit
from app.models.evaluation import (
    Evaluation,
    EvaluationPart,
    EvaluationPartKind,
    EvaluationPartStatus,
    EvaluationPeriod,
    EvaluationStatus,
    EvaluationStep,
    EvaluationStepStatus,
    EvaluationStepType,
    EvaluationTemplate,
    EvaluationTemplateKind,
    EvaluationTemplateVersion,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User
from app.schemas.evaluation import (
    OVERALL_LEVELS,
    SCORED_TOOLS,
    EvaluationCreate,
    EvaluationTool,
    PartContent,
    TemplateDefinition,
    TemplateItem,
    TemplateWorkflow,
)
from app.services.evaluation_data_service import (
    Coverage,
    EvaluationDataService,
    build_snapshot,
    sources_used,
)
from app.services.evaluation_data_sources import DATA_SOURCES, DATA_SOURCES_BY_KEY
from app.services.member_supervisor_service import MemberSupervisorService
from app.utils.membership import canonical_member_status, effective_member_class
from app.utils.org_timezone import resolve_scheduling_timezone, today_in

_SCALE_TOOLS = frozenset({EvaluationTool.LABELED_SCALE, EvaluationTool.NUMERIC_SCALE})

_SELF = EvaluationStepType.SELF_EVALUATION.value
_EVALUATOR = EvaluationStepType.EVALUATOR.value
_CALIBRATION = EvaluationStepType.CALIBRATION.value

#: The step a part is written under.
_PART_STEP = {
    EvaluationPartKind.SELF_EVALUATION.value: _SELF,
    EvaluationPartKind.EVALUATOR.value: _EVALUATOR,
}

_DONE = (EvaluationStepStatus.COMPLETED.value, EvaluationStepStatus.SKIPPED.value)


# ------------------------------------------------------------ form helpers


def form_definition(
    definition: TemplateDefinition, officer: bool
) -> TemplateDefinition:
    """The form as this member sees it: officer-only sections only for an
    officer."""
    if officer:
        return definition
    return definition.model_copy(
        update={"sections": [s for s in definition.sections if not s.officer_only]}
    )


def form_items(definition: TemplateDefinition, kind: str) -> Dict[str, TemplateItem]:
    """The items a part answers, keyed; a self-evaluation answers only the
    items the template includes in it."""
    return {
        item.key: item
        for section in definition.sections
        for item in section.items
        if kind != EvaluationPartKind.SELF_EVALUATION.value
        or item.include_in_self_evaluation
    }


def _allowed_ratings(item: TemplateItem) -> Optional[set]:
    if item.tool in _SCALE_TOOLS:
        return {level.value for level in item.levels}
    if item.tool == EvaluationTool.MEETS:
        return {0, 1}
    return None


def shape_errors(
    content: PartContent, items: Dict[str, TemplateItem], kind: str
) -> List[str]:
    """What makes a saved answer unreadable against its form. Checked on every
    save, so a draft never stores what the form cannot show."""
    errors: List[str] = []
    for key, answer in content.answers.items():
        item = items.get(key)
        if item is None:
            errors.append(f"'{key}' is not on this form.")
            continue
        allowed = _allowed_ratings(item)
        if answer.rating is not None and (
            allowed is None or answer.rating not in allowed
        ):
            errors.append(f"'{item.label}': that rating is not on its scale.")
        if answer.na and not item.allow_na:
            errors.append(f"'{item.label}' cannot be marked N/A.")
        if answer.checked:
            if item.tool != EvaluationTool.CHECKLIST:
                errors.append(f"'{item.label}' is not a checklist.")
            elif not set(answer.checked) <= set(item.checklist_options):
                errors.append(f"'{item.label}': an option checked is not on its list.")
        if answer.text and item.tool not in (
            EvaluationTool.NARRATIVE,
            EvaluationTool.GOALS,
        ):
            errors.append(f"'{item.label}' takes a comment, not a written answer.")
        if answer.justification and kind != EvaluationPartKind.EVALUATOR.value:
            errors.append(f"'{item.label}': only the evaluator justifies a score.")
    if (
        kind != EvaluationPartKind.EVALUATOR.value
        and content.overall_rating is not None
    ):
        errors.append("Only the evaluator gives an overall rating.")
    return errors


def completeness_errors(
    content: PartContent,
    items: Dict[str, TemplateItem],
    kind: str,
    overall_mode: str,
    suggested: Dict[str, int],
) -> List[str]:
    """What must be filled in before a part can be submitted."""
    errors: List[str] = []
    evaluator = kind == EvaluationPartKind.EVALUATOR.value
    for key, item in items.items():
        answer = content.answers.get(key)
        if item.tool in SCORED_TOOLS:
            if answer is None or (answer.rating is None and not answer.na):
                errors.append(f"Rate '{item.label}'.")
                continue
            if answer.rating is not None and answer.rating in item.require_example_for:
                if not answer.example:
                    errors.append(f"'{item.label}': describe a specific example.")
            if (
                evaluator
                and key in suggested
                and answer.rating is not None
                and answer.rating != suggested[key]
                and not answer.justification
            ):
                errors.append(
                    f"'{item.label}': explain why the score differs from the "
                    f"{suggested[key]} the figures suggest."
                )
        if item.tool in (EvaluationTool.NARRATIVE, EvaluationTool.GOALS):
            if answer is None or not answer.text:
                errors.append(f"Answer '{item.label}'.")
        elif item.comment == "required" and (answer is None or not answer.comment):
            if not (answer is not None and answer.na):
                errors.append(f"'{item.label}' needs a comment.")
    if evaluator and overall_mode == "evaluator" and content.overall_rating is None:
        errors.append("Choose an overall rating.")
    return errors


def weighted_overall(
    content: PartContent, items: Dict[str, TemplateItem]
) -> Optional[float]:
    """The weighted overall as a percentage of each item's scale.

    Each rating is placed on its own scale (lowest level 0%, highest 100%;
    meets 100%, does not meet 0%) so items on different scales combine. An
    item marked N/A drops out and its weight is shared by the rest.
    """
    total_weight = 0
    score = 0.0
    for key, item in items.items():
        answer = content.answers.get(key)
        if not item.weight or answer is None or answer.rating is None:
            continue
        if item.tool == EvaluationTool.MEETS:
            position = float(answer.rating)
        else:
            values = [level.value for level in item.levels]
            low, high = min(values), max(values)
            if high == low:
                continue
            position = (answer.rating - low) / (high - low)
        total_weight += item.weight
        score += item.weight * position * 100
    if not total_weight:
        return None
    return round(score / total_weight, 1)


def _raise_if(errors: List[str]) -> None:
    if errors:
        raise ValueError(
            list_within_detail_limit("Fix the following: ", errors, separator=" ")
        )


# ------------------------------------------------------------------- roles


@dataclass(frozen=True)
class Roles:
    is_member: bool
    is_evaluator: bool
    view_all: bool
    manage: bool
    approver: bool

    @property
    def any(self) -> bool:
        return (
            self.is_member
            or self.is_evaluator
            or self.view_all
            or self.manage
            or self.approver
        )

    @property
    def reads_content(self) -> bool:
        """Everyone with access except a manager, who runs the process but
        does not read personnel content on that grant alone."""
        return self.is_member or self.is_evaluator or self.view_all or self.approver


def _name(user: Optional[User]) -> Optional[Dict[str, str]]:
    if user is None:
        return None
    return {"id": user.id, "name": user.full_name}


class EvaluationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------- loading

    async def _evaluation(
        self, organization_id: str, evaluation_id: str, *, for_update: bool = False
    ) -> Optional[Evaluation]:
        query = (
            select(Evaluation)
            .options(
                selectinload(Evaluation.template_version).selectinload(
                    EvaluationTemplateVersion.template
                ),
                selectinload(Evaluation.period),
            )
            .where(
                Evaluation.id == str(evaluation_id),
                Evaluation.organization_id == str(organization_id),
            )
        )
        if for_update:
            query = query.with_for_update()
        return (await self.db.execute(query)).scalar_one_or_none()

    async def _steps(
        self, evaluation: Evaluation, *, for_update: bool = False
    ) -> List[EvaluationStep]:
        # A locking read in write paths: under REPEATABLE READ a plain SELECT
        # answers from the snapshot the request's first read opened, which
        # predates the evaluation row lock (CLAUDE.md pitfall #27).
        query = (
            select(EvaluationStep)
            .where(
                EvaluationStep.evaluation_id == evaluation.id,
                EvaluationStep.organization_id == evaluation.organization_id,
                EvaluationStep.revision == evaluation.revision,
            )
            .order_by(EvaluationStep.step_order)
        )
        if for_update:
            query = query.with_for_update()
        return list((await self.db.execute(query)).scalars().all())

    async def _parts(
        self, evaluation: Evaluation, *, for_update: bool = False
    ) -> Dict[str, EvaluationPart]:
        query = select(EvaluationPart).where(
            EvaluationPart.evaluation_id == evaluation.id,
            EvaluationPart.organization_id == evaluation.organization_id,
            EvaluationPart.revision == evaluation.revision,
        )
        if for_update:
            query = query.with_for_update()
        return {p.kind: p for p in (await self.db.execute(query)).scalars().all()}

    async def _member(
        self,
        organization_id: str,
        user_id: Optional[str],
        *,
        with_positions: bool = False,
    ) -> Optional[User]:
        if not user_id:
            return None
        query = select(User).where(
            User.id == str(user_id),
            User.organization_id == str(organization_id),
            User.deleted_at.is_(None),
        )
        if with_positions:
            query = query.options(selectinload(User.positions))
        return (await self.db.execute(query)).scalar_one_or_none()

    @staticmethod
    def _definition(evaluation: Evaluation) -> TemplateDefinition:
        return form_definition(
            TemplateDefinition.model_validate(evaluation.template_version.definition),
            evaluation.includes_officer_sections,
        )

    @staticmethod
    def _workflow(evaluation: Evaluation) -> TemplateWorkflow:
        return TemplateWorkflow.model_validate(evaluation.template_version.workflow)

    def _roles(
        self, evaluation: Evaluation, viewer: User, steps: Sequence[EvaluationStep]
    ) -> Roles:
        workflow = self._workflow(evaluation)
        position_ids = {p.id for p in viewer.positions}
        live = {
            s.step_key for s in steps if s.status != EvaluationStepStatus.PENDING.value
        }
        approver = any(
            ws.type == EvaluationStepType.APPROVAL
            and ws.key in live
            and ws.actor.position_id in position_ids
            for ws in workflow.steps
        )
        is_member = evaluation.member_id == viewer.id
        return Roles(
            is_member=is_member,
            is_evaluator=evaluation.evaluator_id == viewer.id,
            # Nobody reads their own evaluation through a manager's grant: a
            # Chief being evaluated sees it as a member, like anyone else.
            view_all=not is_member
            and user_has_permission(viewer, "evaluations.view_all"),
            manage=not is_member and user_has_permission(viewer, "evaluations.manage"),
            approver=approver and not is_member,
        )

    # --------------------------------------------------------------- reads

    async def detail(
        self, organization_id: str, evaluation_id: str, viewer: User
    ) -> Optional[Dict[str, Any]]:
        """The evaluation as ``viewer`` may see it, or None when they may not
        see it at all (answered as not found, so its existence is not
        disclosed)."""
        evaluation = await self._evaluation(organization_id, evaluation_id)
        if evaluation is None:
            return None
        steps = await self._steps(evaluation)
        roles = self._roles(evaluation, viewer, steps)
        if not roles.any:
            return None
        parts = await self._parts(evaluation)
        people = await self._people(
            organization_id, [evaluation.member_id, evaluation.evaluator_id]
        )
        return self._detail_view(
            evaluation,
            steps,
            parts,
            roles,
            people,
            today_in(await resolve_scheduling_timezone(self.db, organization_id)),
        )

    def _released_to_member(
        self, evaluation: Evaluation, steps: Sequence[EvaluationStep]
    ) -> bool:
        """Whether the member may read the evaluator's part and the figures.

        Once everything before the member's acknowledgement is done, the
        evaluation is the member's to read; before then it is still being
        written and reviewed.
        """
        if evaluation.status == EvaluationStatus.FINALIZED.value:
            return True
        before = [
            s
            for s in steps
            if s.step_type != EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value
            and s.step_type != _SELF
        ]
        return bool(before) and all(s.status in _DONE for s in before)

    def _detail_view(
        self,
        evaluation: Evaluation,
        steps: Sequence[EvaluationStep],
        parts: Dict[str, EvaluationPart],
        roles: Roles,
        people: Dict[str, User],
        today: date,
    ) -> Dict[str, Any]:
        definition = self._definition(evaluation)
        released = self._released_to_member(evaluation, steps)
        by_key = {s.step_key: s for s in steps}

        visible_parts: List[Dict[str, Any]] = []
        for kind, part in parts.items():
            if kind == EvaluationPartKind.SELF_EVALUATION.value:
                show = roles.is_member or (
                    roles.reads_content
                    and part.status == EvaluationPartStatus.SUBMITTED.value
                )
            elif kind == EvaluationPartKind.EVALUATOR.value:
                show = (
                    roles.is_evaluator
                    or roles.view_all
                    or (
                        roles.approver
                        and part.status == EvaluationPartStatus.SUBMITTED.value
                    )
                    or (roles.is_member and released)
                )
            else:
                show = roles.reads_content and (not roles.is_member or released)
            if show:
                visible_parts.append(
                    {
                        "kind": kind,
                        "status": part.status,
                        "content": PartContent.model_validate(part.content),
                        "submitted_at": part.submitted_at,
                        "updated_at": part.updated_at,
                    }
                )

        show_data = (roles.reads_content and not roles.is_member) or released
        snapshot = evaluation.data_snapshot or {}
        evaluator_part = parts.get(EvaluationPartKind.EVALUATOR.value)
        evaluator_visible = any(
            p["kind"] == EvaluationPartKind.EVALUATOR.value for p in visible_parts
        )

        self_step = by_key.get(_SELF)
        evaluator_step = by_key.get(_EVALUATOR)
        calibration_step = by_key.get(_CALIBRATION)
        evaluator_locked = evaluator_step is None or evaluator_step.status in _DONE

        view = self._summary_view(evaluation, steps, people, roles)
        view.update(
            {
                "coverage_start": evaluation.coverage_start,
                "coverage_end": evaluation.coverage_end,
                "excluded_ranges": evaluation.excluded_ranges or [],
                "includes_officer_sections": evaluation.includes_officer_sections,
                "definition": definition,
                "overall_levels": OVERALL_LEVELS,
                "steps": [
                    self._step_view(s, evaluation)
                    for s in steps
                    # Calibration is never shown to the member.
                    if not (roles.is_member and s.step_type == _CALIBRATION)
                ],
                "data": snapshot.get("values") if show_data else None,
                "sources": (
                    [
                        self._source_view(s.key)
                        for s in DATA_SOURCES
                        if s.key in (snapshot.get("values") or {})
                    ]
                    if show_data
                    else []
                ),
                "suggested_scores": (
                    (snapshot.get("suggested_scores") or {}) if show_data else {}
                ),
                "data_taken_at": evaluation.snapshot_taken_at if show_data else None,
                "parts": visible_parts,
                "weighted_overall": (
                    weighted_overall(
                        PartContent.model_validate(evaluator_part.content),
                        form_items(definition, EvaluationPartKind.EVALUATOR.value),
                    )
                    if evaluator_part is not None
                    and evaluator_visible
                    and definition.overall_mode == "weighted"
                    else None
                ),
                "viewer": {
                    "is_member": roles.is_member,
                    "is_evaluator": roles.is_evaluator,
                    "can_edit_self_evaluation": roles.is_member
                    and self_step is not None
                    and self_step.status == EvaluationStepStatus.OPEN.value,
                    "can_edit_evaluation": roles.is_evaluator
                    and evaluator_step is not None
                    and evaluator_step.status == EvaluationStepStatus.OPEN.value,
                    "can_refresh_data": (roles.is_evaluator or roles.manage)
                    and not evaluator_locked,
                    "can_calibrate": roles.view_all
                    and calibration_step is not None
                    and calibration_step.status == EvaluationStepStatus.OPEN.value,
                },
            }
        )
        return view

    def _step_view(
        self, step: EvaluationStep, evaluation: Evaluation
    ) -> Dict[str, Any]:
        labels = {s.key: s.label for s in self._workflow(evaluation).steps}
        return {
            "key": step.step_key,
            "type": step.step_type,
            "label": labels.get(step.step_key, step.step_key),
            "order": step.step_order,
            "status": step.status,
            "due_date": step.due_date,
            "completed_at": step.completed_at,
        }

    def _summary_view(
        self,
        evaluation: Evaluation,
        steps: Sequence[EvaluationStep],
        people: Dict[str, User],
        roles: Optional[Roles] = None,
    ) -> Dict[str, Any]:
        template = evaluation.template_version.template
        visible = [
            s
            for s in steps
            if not (
                roles is not None and roles.is_member and s.step_type == _CALIBRATION
            )
        ]
        waiting = next(
            (s for s in visible if s.status == EvaluationStepStatus.OPEN.value), None
        )
        labels = {s.key: s.label for s in self._workflow(evaluation).steps}
        member = people.get(evaluation.member_id)
        return {
            "id": evaluation.id,
            "member": _name(member)
            or {"id": evaluation.member_id, "name": "Former member"},
            "evaluator": _name(people.get(evaluation.evaluator_id or "")),
            "period_id": evaluation.period_id,
            "period_name": evaluation.period.name if evaluation.period else None,
            "period_start": evaluation.period_start,
            "period_end": evaluation.period_end,
            "template_name": template.name,
            "kind": template.kind,
            "status": evaluation.status,
            "current_step": labels.get(waiting.step_key) if waiting else None,
            "current_step_due": waiting.due_date if waiting else None,
            "created_at": evaluation.created_at,
        }

    async def _people(
        self, organization_id: str, ids: Sequence[Optional[str]]
    ) -> Dict[str, User]:
        wanted = [i for i in set(ids) if i]
        if not wanted:
            return {}
        rows = await self.db.execute(
            select(User).where(
                User.id.in_(wanted), User.organization_id == organization_id
            )
        )
        return {u.id: u for u in rows.scalars().all()}

    async def list_evaluations(
        self,
        organization_id: str,
        viewer: User,
        *,
        period_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Evaluations the caller conducts, or every one for a holder of
        ``view_all`` or ``manage``. A member's own evaluations are listed by
        :meth:`list_mine`, never here."""
        query = (
            select(Evaluation)
            .options(
                selectinload(Evaluation.template_version).selectinload(
                    EvaluationTemplateVersion.template
                ),
                selectinload(Evaluation.period),
            )
            .where(
                Evaluation.organization_id == organization_id,
                Evaluation.member_id != viewer.id,
            )
            .order_by(Evaluation.period_end.desc(), Evaluation.created_at.desc())
        )
        if not (
            user_has_permission(viewer, "evaluations.view_all")
            or user_has_permission(viewer, "evaluations.manage")
        ):
            query = query.where(Evaluation.evaluator_id == viewer.id)
        if period_id:
            query = query.where(Evaluation.period_id == period_id)
        if status:
            query = query.where(Evaluation.status == status)
        evaluations = list((await self.db.execute(query)).scalars().all())
        return await self._summaries(organization_id, evaluations, None)

    async def list_mine(
        self, organization_id: str, member: User
    ) -> List[Dict[str, Any]]:
        query = (
            select(Evaluation)
            .options(
                selectinload(Evaluation.template_version).selectinload(
                    EvaluationTemplateVersion.template
                ),
                selectinload(Evaluation.period),
            )
            .where(
                Evaluation.organization_id == organization_id,
                Evaluation.member_id == member.id,
            )
            .order_by(Evaluation.period_end.desc(), Evaluation.created_at.desc())
        )
        evaluations = list((await self.db.execute(query)).scalars().all())
        roles = Roles(
            is_member=True,
            is_evaluator=False,
            view_all=False,
            manage=False,
            approver=False,
        )
        return await self._summaries(organization_id, evaluations, roles)

    async def _summaries(
        self,
        organization_id: str,
        evaluations: Sequence[Evaluation],
        roles: Optional[Roles],
    ) -> List[Dict[str, Any]]:
        if not evaluations:
            return []
        ids = [e.id for e in evaluations]
        step_rows = await self.db.execute(
            select(EvaluationStep)
            .where(
                EvaluationStep.organization_id == organization_id,
                EvaluationStep.evaluation_id.in_(ids),
            )
            .order_by(EvaluationStep.step_order)
        )
        steps_by: Dict[str, List[EvaluationStep]] = {}
        revisions = {e.id: e.revision for e in evaluations}
        for step in step_rows.scalars().all():
            if step.revision == revisions[step.evaluation_id]:
                steps_by.setdefault(step.evaluation_id, []).append(step)
        people = await self._people(
            organization_id,
            [e.member_id for e in evaluations] + [e.evaluator_id for e in evaluations],
        )
        return [
            self._summary_view(e, steps_by.get(e.id, []), people, roles)
            for e in evaluations
        ]

    async def live_data(self, organization_id: str, member: User) -> Dict[str, Any]:
        """The member's figures for the current review period, measured now.

        The current period is the one the member's latest open evaluation is
        for, or else the most recent open period that has begun. The sources
        are the ones that evaluation's form shows, or the whole catalog when
        the member has no evaluation yet.
        """
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        today = today_in(tz)
        evaluation = (
            await self.db.execute(
                select(Evaluation)
                .options(
                    selectinload(Evaluation.template_version),
                    selectinload(Evaluation.period),
                )
                .where(
                    Evaluation.organization_id == organization_id,
                    Evaluation.member_id == member.id,
                    Evaluation.status == EvaluationStatus.IN_PROGRESS.value,
                )
                .order_by(Evaluation.period_end.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        period: Optional[EvaluationPeriod]
        if evaluation is not None:
            period = evaluation.period
            start, end = evaluation.period_start, evaluation.period_end
            keys = sources_used(
                TemplateDefinition.model_validate(
                    evaluation.template_version.definition
                ),
                evaluation.includes_officer_sections,
            )
        else:
            period = (
                await self.db.execute(
                    select(EvaluationPeriod)
                    .where(
                        EvaluationPeriod.organization_id == organization_id,
                        EvaluationPeriod.is_closed.is_(False),
                        EvaluationPeriod.start_date <= today,
                    )
                    .order_by(EvaluationPeriod.start_date.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if period is None:
                return {
                    "sources": [],
                    "data": {},
                    "note": "No review period is open.",
                }
            start, end = period.start_date, period.end_date
            keys = [s.key for s in DATA_SOURCES]
        data_service = EvaluationDataService(self.db)
        # Measured to today, not the period's end: a figure for days that
        # have not happened yet would read as a shortfall.
        coverage = await data_service.coverage_for(
            organization_id, member, start, min(end, today), tz
        )
        base: Dict[str, Any] = {
            "period_id": period.id if period else None,
            "period_name": period.name if period else None,
            "sources": [self._source_view(k) for k in keys],
        }
        if coverage is None:
            return {
                **base,
                "data": {},
                "note": "You have no full month of service in this period yet.",
            }
        values = await data_service.compute(organization_id, member, coverage, keys, tz)
        return {
            **base,
            "coverage_start": coverage.start,
            "coverage_end": coverage.end,
            "excluded_ranges": coverage.as_json()["excluded"],
            "data": values,
        }

    @staticmethod
    def _source_view(key: str) -> Dict[str, Any]:
        source = DATA_SOURCES_BY_KEY[key]
        return {
            "key": source.key,
            "label": source.label,
            "unit": source.unit,
            "module": source.module,
            "description": source.description,
            "scoreable": source.scoreable,
        }

    # -------------------------------------------------------------- drafting

    async def draft_options(self, organization_id: str) -> Dict[str, Any]:
        """What the drafting dialog offers: current members, open review
        periods, and the members who may be assigned as evaluator. Ids and
        names only, so drafting does not also need ``members.view``."""
        members = list(
            (
                await self.db.execute(
                    select(User)
                    .options(selectinload(User.positions))
                    .where(
                        User.organization_id == organization_id,
                        User.deleted_at.is_(None),
                        User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                    )
                )
            )
            .scalars()
            .all()
        )
        members.sort(key=lambda u: (u.last_name or "", u.first_name or ""))
        periods = (
            (
                await self.db.execute(
                    select(EvaluationPeriod)
                    .where(
                        EvaluationPeriod.organization_id == organization_id,
                        EvaluationPeriod.is_closed.is_(False),
                    )
                    .order_by(EvaluationPeriod.start_date.desc())
                )
            )
            .scalars()
            .all()
        )
        return {
            "members": [{"id": u.id, "name": u.full_name} for u in members],
            "evaluators": [
                {"id": u.id, "name": u.full_name}
                for u in members
                if user_has_permission(u, "evaluations.conduct")
            ],
            "periods": [
                {
                    "id": p.id,
                    "name": p.name,
                    "start_date": p.start_date,
                    "end_date": p.end_date,
                }
                for p in periods
            ],
        }

    async def resolve_template(
        self, organization_id: str, member: User, kind: EvaluationTemplateKind
    ) -> EvaluationTemplate:
        """The most specific active, published template of ``kind`` that fits
        the member's class and status.

        A template naming both class and status beats one naming either, which
        beats one naming neither. Two equally specific fits (one by class, one
        by status) are ambiguous and refused rather than guessed between.
        """
        member_class = effective_member_class(
            member.member_class, member.membership_type
        )
        member_status = canonical_member_status(member.member_status)
        templates = (
            (
                await self.db.execute(
                    select(EvaluationTemplate)
                    .join(
                        EvaluationTemplateVersion,
                        EvaluationTemplateVersion.template_id == EvaluationTemplate.id,
                    )
                    .where(
                        EvaluationTemplate.organization_id == organization_id,
                        EvaluationTemplate.is_active.is_(True),
                        EvaluationTemplate.kind == kind.value,
                        EvaluationTemplateVersion.published_at.isnot(None),
                    )
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        fits: List[Tuple[int, EvaluationTemplate]] = []
        for template in templates:
            if template.member_class not in (None, member_class):
                continue
            if template.member_status not in (None, member_status):
                continue
            specificity = (template.member_class is not None) + (
                template.member_status is not None
            )
            fits.append((specificity, template))
        if not fits:
            raise ValueError(
                "No active, published template fits this member. Choose a template."
            )
        best = max(s for s, _ in fits)
        top = [t for s, t in fits if s == best]
        if len(top) > 1:
            names = sorted(t.name for t in top)
            raise ValueError(
                list_within_detail_limit(
                    "More than one template fits this member equally well: ",
                    names,
                    ". Choose a template.",
                )
            )
        return top[0]

    async def _published_version(
        self, organization_id: str, template: EvaluationTemplate
    ) -> EvaluationTemplateVersion:
        version = (
            await self.db.execute(
                select(EvaluationTemplateVersion)
                .options(selectinload(EvaluationTemplateVersion.template))
                .where(
                    EvaluationTemplateVersion.template_id == template.id,
                    EvaluationTemplateVersion.organization_id == organization_id,
                    EvaluationTemplateVersion.published_at.isnot(None),
                )
                .order_by(EvaluationTemplateVersion.version_number.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if version is None:
            raise ValueError(f"'{template.name}' has not been published.")
        return version

    async def create(
        self, organization_id: str, actor: User, data: EvaluationCreate
    ) -> str:
        """Draft one member's evaluation for one period.

        A holder of ``evaluations.manage`` may assign any evaluator who holds
        ``evaluations.conduct``; a holder of ``conduct`` alone may draft only
        an evaluation they will conduct themselves. Nobody evaluates
        themselves. One evaluation per member per period, enforced by the
        unique constraint, which also settles two drafts racing past the
        check below (CLAUDE.md pitfall #36).

        With no evaluator named, a manager's draft goes to the member's
        current supervisor when the supervisor may conduct evaluations, and
        otherwise to the manager (owner decision 2026-11-01); a conductor's
        draft is always their own.
        """
        manager = user_has_permission(actor, "evaluations.manage")
        evaluator_id = data.evaluator_id
        if evaluator_id is None and manager:
            evaluator_id = await MemberSupervisorService(self.db).default_evaluator_id(
                organization_id, data.member_id, "evaluations.conduct"
            )
        evaluator_id = evaluator_id or actor.id
        if not manager and evaluator_id != actor.id:
            raise PermissionError(
                "Only an evaluations manager assigns another evaluator."
            )
        if evaluator_id == data.member_id:
            raise ValueError("A member cannot evaluate themselves.")

        member = await self._member(organization_id, data.member_id)
        if member is None:
            raise ValueError("Member not found.")
        evaluator = await self._member(
            organization_id, evaluator_id, with_positions=True
        )
        if evaluator is None:
            raise ValueError("Evaluator not found.")
        if not user_has_permission(evaluator, "evaluations.conduct"):
            raise ValueError(
                f"{evaluator.full_name} is not able to conduct evaluations."
            )

        period = (
            await self.db.execute(
                select(EvaluationPeriod).where(
                    EvaluationPeriod.id == data.period_id,
                    EvaluationPeriod.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if period is None:
            raise ValueError("Review period not found.")
        if period.is_closed:
            raise ValueError(f"'{period.name}' is closed.")
        existing = await self.db.scalar(
            select(Evaluation.id).where(
                Evaluation.organization_id == organization_id,
                Evaluation.member_id == member.id,
                Evaluation.period_id == period.id,
            )
        )
        if existing:
            raise ValueError(
                f"{member.full_name} already has an evaluation for '{period.name}'."
            )

        if data.template_id:
            template = (
                await self.db.execute(
                    select(EvaluationTemplate).where(
                        EvaluationTemplate.id == data.template_id,
                        EvaluationTemplate.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()
            if template is None:
                raise ValueError("Template not found.")
            if not template.is_active:
                raise ValueError(f"'{template.name}' is retired.")
        else:
            template = await self.resolve_template(organization_id, member, data.kind)
        version = await self._published_version(organization_id, template)
        definition = TemplateDefinition.model_validate(version.definition)
        workflow = TemplateWorkflow.model_validate(version.workflow)

        tz = await resolve_scheduling_timezone(self.db, organization_id)
        data_service = EvaluationDataService(self.db)
        coverage = await data_service.coverage_for(
            organization_id, member, period.start_date, period.end_date, tz
        )
        if coverage is None:
            raise ValueError(
                f"{member.full_name} served no full month of '{period.name}'."
            )
        officer = bool(member.rank) and member.rank in definition.officer_ranks

        evaluation = Evaluation(
            organization_id=organization_id,
            member_id=member.id,
            evaluator_id=evaluator.id,
            period_id=period.id,
            template_version_id=version.id,
            status=EvaluationStatus.IN_PROGRESS.value,
            revision=1,
            period_start=period.start_date,
            period_end=period.end_date,
            includes_officer_sections=officer,
            created_by=actor.id,
        )
        await self._take_snapshot(evaluation, member, coverage, definition, officer, tz)
        for order, step in enumerate(workflow.steps):
            parallel = step.type.value in (_SELF, _EVALUATOR)
            evaluation.steps.append(
                EvaluationStep(
                    organization_id=organization_id,
                    revision=1,
                    step_key=step.key,
                    step_order=order,
                    step_type=step.type.value,
                    status=(
                        EvaluationStepStatus.OPEN.value
                        if parallel
                        else EvaluationStepStatus.PENDING.value
                    ),
                    due_date=period.end_date + timedelta(days=step.due_days),
                )
            )
        try:
            async with self.db.begin_nested():
                self.db.add(evaluation)
        except IntegrityError as exc:
            raise ValueError(
                f"{member.full_name} already has an evaluation for '{period.name}'."
            ) from exc
        await self.db.commit()
        return evaluation.id

    async def _take_snapshot(
        self,
        evaluation: Evaluation,
        member: User,
        coverage: Coverage,
        definition: TemplateDefinition,
        officer: bool,
        tz: Any,
    ) -> None:
        keys = sources_used(definition, officer)
        values = await EvaluationDataService(self.db).compute(
            evaluation.organization_id, member, coverage, keys, tz
        )
        taken_at = datetime.now(timezone.utc)
        evaluation.coverage_start = coverage.start
        evaluation.coverage_end = coverage.end
        evaluation.excluded_ranges = coverage.as_json()["excluded"]
        evaluation.data_snapshot = build_snapshot(
            coverage, values, definition, officer, taken_at
        )
        evaluation.snapshot_taken_at = taken_at

    async def refresh_data(
        self, organization_id: str, evaluation_id: str, actor: User
    ) -> Optional[bool]:
        """Re-measure coverage and figures, until the evaluator locks their
        part. None when the caller may not see the evaluation."""
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        steps = await self._steps(evaluation, for_update=True)
        roles = self._roles(evaluation, actor, steps)
        if not roles.any:
            return None
        if not (roles.is_evaluator or roles.manage):
            raise PermissionError(
                "Only the evaluator or a manager refreshes the figures."
            )
        evaluator_step = next((s for s in steps if s.step_type == _EVALUATOR), None)
        if evaluator_step is None or evaluator_step.status in _DONE:
            raise ValueError(
                "The figures are fixed once the evaluator has locked their part."
            )
        member = await self._member(organization_id, evaluation.member_id)
        if member is None:
            raise ValueError("The member's record is no longer available.")
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        coverage = await EvaluationDataService(self.db).coverage_for(
            organization_id, member, evaluation.period_start, evaluation.period_end, tz
        )
        if coverage is None:
            raise ValueError(f"{member.full_name} served no full month of the period.")
        definition = TemplateDefinition.model_validate(
            evaluation.template_version.definition
        )
        await self._take_snapshot(
            evaluation,
            member,
            coverage,
            definition,
            evaluation.includes_officer_sections,
            tz,
        )
        await self.db.commit()
        return True

    # ----------------------------------------------------------------- parts

    async def _writable(
        self, organization_id: str, evaluation_id: str, actor: User, kind: str
    ) -> Optional[
        Tuple[
            Evaluation, List[EvaluationStep], Dict[str, EvaluationPart], EvaluationStep
        ]
    ]:
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        steps = await self._steps(evaluation, for_update=True)
        roles = self._roles(evaluation, actor, steps)
        if not roles.any:
            return None
        author_ok = (
            roles.is_member
            if kind == EvaluationPartKind.SELF_EVALUATION.value
            else roles.is_evaluator
        )
        if not author_ok:
            raise PermissionError(
                "Only the member writes their self-evaluation."
                if kind == EvaluationPartKind.SELF_EVALUATION.value
                else "Only the assigned evaluator writes the evaluation."
            )
        step = next((s for s in steps if s.step_type == _PART_STEP[kind]), None)
        if step is None:
            raise ValueError("This evaluation has no such step.")
        if step.status != EvaluationStepStatus.OPEN.value:
            raise ValueError("That part is locked.")
        parts = await self._parts(evaluation, for_update=True)
        return evaluation, steps, parts, step

    async def save_part(
        self,
        organization_id: str,
        evaluation_id: str,
        actor: User,
        kind: str,
        content: PartContent,
    ) -> Optional[bool]:
        """Save progress. Never locks: submitting is a separate action."""
        loaded = await self._writable(organization_id, evaluation_id, actor, kind)
        if loaded is None:
            return None
        evaluation, _steps, parts, _step = loaded
        items = form_items(self._definition(evaluation), kind)
        _raise_if(shape_errors(content, items, kind))
        part = parts.get(kind)
        stored = content.model_dump(mode="json")
        if part is None:
            self.db.add(
                EvaluationPart(
                    organization_id=organization_id,
                    evaluation_id=evaluation.id,
                    revision=evaluation.revision,
                    kind=kind,
                    author_id=actor.id,
                    content=stored,
                    status=EvaluationPartStatus.DRAFT.value,
                )
            )
        else:
            part.content = stored
        await self.db.commit()
        return True

    async def submit_part(
        self, organization_id: str, evaluation_id: str, actor: User, kind: str
    ) -> Optional[str]:
        """Submit a saved part. Returns what happened: ``submitted``,
        ``sent_for_calibration`` or ``finalized``."""
        loaded = await self._writable(organization_id, evaluation_id, actor, kind)
        if loaded is None:
            return None
        evaluation, steps, parts, step = loaded
        part = parts.get(kind)
        if part is None:
            raise ValueError("Save the part before submitting it.")
        definition = self._definition(evaluation)
        items = form_items(definition, kind)
        content = PartContent.model_validate(part.content)
        suggested = (evaluation.data_snapshot or {}).get("suggested_scores") or {}
        _raise_if(shape_errors(content, items, kind))
        _raise_if(
            completeness_errors(
                content, items, kind, definition.overall_mode, suggested
            )
        )
        now = datetime.now(timezone.utc)

        if kind == EvaluationPartKind.EVALUATOR.value:
            calibration = next((s for s in steps if s.step_type == _CALIBRATION), None)
            if (
                calibration is not None
                and calibration.status == EvaluationStepStatus.PENDING.value
            ):
                calibration.status = EvaluationStepStatus.OPEN.value
                await self.db.commit()
                return "sent_for_calibration"
            if (
                calibration is not None
                and calibration.status == EvaluationStepStatus.OPEN.value
            ):
                raise ValueError("The evaluation is with calibration.")
            self_step = next((s for s in steps if s.step_type == _SELF), None)
            if (
                self_step is not None
                and self_step.status == EvaluationStepStatus.OPEN.value
            ):
                workflow = self._workflow(evaluation)
                today = today_in(
                    await resolve_scheduling_timezone(self.db, organization_id)
                )
                if not workflow.evaluator_may_proceed_without_self_evaluation:
                    raise ValueError("The member's self-evaluation is not in yet.")
                if self_step.due_date is not None and today <= self_step.due_date:
                    raise ValueError(
                        "The member has until "
                        f"{self_step.due_date.isoformat()} to submit their self-evaluation."
                    )
                # Missed: the member's draft stays theirs and is never shown.
                self_step.status = EvaluationStepStatus.SKIPPED.value
                self_step.completed_at = now

        part.status = EvaluationPartStatus.SUBMITTED.value
        part.submitted_at = now
        step.status = EvaluationStepStatus.COMPLETED.value
        step.completed_at = now
        step.completed_by = actor.id
        outcome = "submitted"
        if kind == EvaluationPartKind.EVALUATOR.value:
            outcome = self._advance(evaluation, steps, now)
        await self.db.commit()
        return outcome

    @staticmethod
    def _advance(
        evaluation: Evaluation, steps: Sequence[EvaluationStep], now: datetime
    ) -> str:
        """Open the next step after the evaluator locks; finalize when none is
        left (a check-in)."""
        pending = [s for s in steps if s.status == EvaluationStepStatus.PENDING.value]
        if pending:
            pending[0].status = EvaluationStepStatus.OPEN.value
            return "submitted"
        if all(s.status in _DONE for s in steps):
            evaluation.status = EvaluationStatus.FINALIZED.value
            evaluation.finalized_at = now
            return "finalized"
        return "submitted"

    async def complete_calibration(
        self, organization_id: str, evaluation_id: str, actor: User
    ) -> Optional[bool]:
        """Record that calibration happened. Only the fact is kept: what was
        discussed goes to the evaluator, not into the record."""
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        steps = await self._steps(evaluation, for_update=True)
        roles = self._roles(evaluation, actor, steps)
        if not roles.any:
            return None
        if not roles.view_all:
            raise PermissionError(
                "Calibration is completed by a holder of evaluations.view_all."
            )
        step = next((s for s in steps if s.step_type == _CALIBRATION), None)
        if step is None or step.status != EvaluationStepStatus.OPEN.value:
            raise ValueError("This evaluation is not waiting for calibration.")
        step.status = EvaluationStepStatus.COMPLETED.value
        step.completed_at = datetime.now(timezone.utc)
        step.completed_by = actor.id
        await self.db.commit()
        return True
