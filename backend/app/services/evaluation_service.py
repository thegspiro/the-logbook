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

import copy
import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.utils import list_within_detail_limit
from app.models.evaluation import (
    Evaluation,
    EvaluationAmendment,
    EvaluationDeletionRecord,
    EvaluationDocument,
    EvaluationPart,
    EvaluationPartKind,
    EvaluationPartStatus,
    EvaluationPeriod,
    EvaluationSignature,
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
    BulkDraftItem,
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
from app.services.evaluation_grading import (
    grade_content,
    grade_errors,
    override_reason_errors,
)
from app.services.evaluation_notice_service import EvaluationNoticeService
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


def normalized_name(value: Optional[str]) -> str:
    """A name compared for a signature: case and spacing ignored."""
    return " ".join((value or "").split()).casefold()


def content_hash(evaluation: Evaluation, parts: Dict[str, EvaluationPart]) -> str:
    """SHA-256 of the record a signature attests to.

    The submitted parts, the figures as they were frozen, and who, what and
    when the evaluation is about. A later change to any of them yields a
    different hash, so a signature can be checked against the record it was
    given on. Drafts and the member's post-finalization response are left
    out: neither is part of what was signed.
    """
    signed_kinds = (
        EvaluationPartKind.SELF_EVALUATION.value,
        EvaluationPartKind.EVALUATOR.value,
    )
    payload = {
        "evaluation_id": evaluation.id,
        "revision": evaluation.revision,
        "template_version_id": evaluation.template_version_id,
        "member_id": evaluation.member_id,
        "evaluator_id": evaluation.evaluator_id,
        "period": [evaluation.period_start, evaluation.period_end],
        "coverage": [evaluation.coverage_start, evaluation.coverage_end],
        "excluded_ranges": evaluation.excluded_ranges or [],
        "figures": (evaluation.data_snapshot or {}).get("values") or {},
        "parts": {
            kind: {"content": part.content, "submitted_at": part.submitted_at}
            for kind, part in sorted(parts.items())
            if kind in signed_kinds
            and part.status == EvaluationPartStatus.SUBMITTED.value
        },
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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

    @staticmethod
    def _open_keys(steps: Sequence[EvaluationStep]) -> set:
        return {
            s.step_key for s in steps if s.status == EvaluationStepStatus.OPEN.value
        }

    async def _announce(
        self,
        organization_id: str,
        evaluation_id: str,
        opened: Sequence[str],
        finalized: bool,
    ) -> None:
        """Email the people a transition concerns. After the commit, and
        best-effort: the notice service logs a failure and never raises."""
        notices = EvaluationNoticeService(self.db)
        if opened:
            await notices.steps_opened(organization_id, evaluation_id, opened)
        if finalized:
            await notices.finalized(organization_id, evaluation_id)

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
        signatures = (
            (
                await self.db.execute(
                    select(EvaluationSignature)
                    .where(
                        EvaluationSignature.evaluation_id == evaluation.id,
                        EvaluationSignature.organization_id == organization_id,
                        EvaluationSignature.revision == evaluation.revision,
                    )
                    .order_by(EvaluationSignature.signed_at)
                )
            )
            .scalars()
            .all()
        )
        document_id = await self.db.scalar(
            select(EvaluationDocument.id).where(
                EvaluationDocument.evaluation_id == evaluation.id,
                EvaluationDocument.organization_id == organization_id,
                EvaluationDocument.revision == evaluation.revision,
            )
        )
        return self._detail_view(
            evaluation,
            steps,
            parts,
            roles,
            people,
            today_in(await resolve_scheduling_timezone(self.db, organization_id)),
            viewer_positions={p.id for p in viewer.positions},
            signatures=signatures,
            # A finalized evaluation always has its PDF: it is made on
            # finalization, or on first download if that failed.
            document_available=bool(document_id)
            or evaluation.status == EvaluationStatus.FINALIZED.value,
            can_delete=not roles.is_member
            and user_has_permission(viewer, "evaluations.delete"),
            amendments=await self._amendments(evaluation),
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

    def _signable(
        self,
        evaluation: Evaluation,
        steps: Sequence[EvaluationStep],
        viewer_positions: set,
        roles: Roles,
    ) -> Optional[Dict[str, Any]]:
        """The signature ``viewer`` may give now, if any.

        An approval is signed by a holder of the step's position, never the
        member; the acknowledgement is the member's own, given as an
        acknowledgement of receipt or a refusal with a reason.
        """
        if evaluation.status != EvaluationStatus.IN_PROGRESS.value:
            return None
        workflow_steps = {ws.key: ws for ws in self._workflow(evaluation).steps}
        for step in steps:
            if step.status != EvaluationStepStatus.OPEN.value:
                continue
            ws = workflow_steps.get(step.step_key)
            if ws is None:
                continue
            if (
                ws.type == EvaluationStepType.APPROVAL
                and not roles.is_member
                and ws.actor.position_id in viewer_positions
            ):
                return {
                    "step_key": ws.key,
                    "label": ws.label,
                    "dispositions": ["signed"],
                }
            if ws.type == EvaluationStepType.MEMBER_ACKNOWLEDGEMENT and roles.is_member:
                return {
                    "step_key": ws.key,
                    "label": ws.label,
                    "dispositions": ["acknowledged", "refused"],
                }
        return None

    def _detail_view(
        self,
        evaluation: Evaluation,
        steps: Sequence[EvaluationStep],
        parts: Dict[str, EvaluationPart],
        roles: Roles,
        people: Dict[str, User],
        today: date,
        *,
        viewer_positions: Optional[set] = None,
        signatures: Sequence[EvaluationSignature] = (),
        document_available: bool = False,
        can_delete: bool = False,
        amendments: Sequence[Dict[str, Any]] = (),
    ) -> Dict[str, Any]:
        signable = self._signable(evaluation, steps, viewer_positions or set(), roles)
        definition = self._definition(evaluation)
        response_due = self._response_due(evaluation)
        response_part = parts.get(EvaluationPartKind.MEMBER_RESPONSE.value)
        response_submitted = (
            response_part is not None
            and response_part.status == EvaluationPartStatus.SUBMITTED.value
        )
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
            elif kind == EvaluationPartKind.MEMBER_RESPONSE.value:
                # The member's own draft is theirs; everyone who reads the
                # record sees the response once it is submitted.
                show = roles.is_member or (
                    roles.reads_content
                    and part.status == EvaluationPartStatus.SUBMITTED.value
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

        labels_by_key = {ws.key: ws.label for ws in self._workflow(evaluation).steps}
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
                # Signatures are part of the record: shown to whoever may read
                # its content, and to the member once it is released to them.
                "signatures": (
                    [
                        {
                            "step_key": sig.step_key,
                            "label": labels_by_key.get(sig.step_key, sig.step_key),
                            "signed_name": sig.signed_name,
                            "disposition": sig.disposition,
                            "comment": sig.comment,
                            "signed_at": sig.signed_at,
                        }
                        for sig in signatures
                    ]
                    if (roles.reads_content and not roles.is_member) or released
                    else []
                ),
                "document_available": document_available
                and ((roles.reads_content and not roles.is_member) or released),
                "revision": evaluation.revision,
                # Why the record was reopened is part of the record: everyone
                # who may see the evaluation sees it, the member included.
                "amendments": list(amendments),
                "response_due": response_due,
                # The calibrator's ticks: for whoever reads the record, and
                # for the member once it is released to them.
                "calibration_flags": (
                    list(calibration_step.flagged_items or [])
                    if calibration_step is not None
                    and (
                        (roles.reads_content and not roles.is_member)
                        or (roles.is_member and released)
                    )
                    else []
                ),
                "response_document_available": response_submitted
                and document_available
                and ((roles.reads_content and not roles.is_member) or released),
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
                # Visible exactly where the evaluator's ratings are, since
                # the grades are read from them.
                "grades": (
                    grade_content(
                        definition, PartContent.model_validate(evaluator_part.content)
                    )
                    if evaluator_part is not None and evaluator_visible
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
                    "can_sign": signable,
                    "can_delete": can_delete,
                    "can_amend": roles.manage
                    and evaluation.status == EvaluationStatus.FINALIZED.value,
                    "can_respond": roles.is_member
                    and response_due is not None
                    and today <= response_due
                    and not response_submitted,
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

    async def attention_counts(
        self, organization_id: str, viewer: User
    ) -> Dict[str, int]:
        """The numbers the evaluation pages' section strip badges.

        ``mine`` is the caller's own evaluations with a step open for them to
        act on — their self-evaluation or their acknowledgement. ``overdue``
        is the evaluations the caller may list on the conduct page (the ones
        they conduct, or every one for ``view_all`` and ``manage``) whose open
        step is past its due date; it is 0 for a caller who may not list any.
        """
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        today = today_in(tz)
        mine = await self.db.scalar(
            select(func.count(func.distinct(Evaluation.id)))
            .join(
                EvaluationStep,
                (EvaluationStep.evaluation_id == Evaluation.id)
                & (EvaluationStep.revision == Evaluation.revision),
            )
            .where(
                Evaluation.organization_id == organization_id,
                Evaluation.member_id == viewer.id,
                Evaluation.status == EvaluationStatus.IN_PROGRESS.value,
                EvaluationStep.organization_id == organization_id,
                EvaluationStep.status == EvaluationStepStatus.OPEN.value,
                EvaluationStep.step_type.in_(
                    (_SELF, EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value)
                ),
            )
        )
        overdue = 0
        if any(
            user_has_permission(viewer, grant)
            for grant in (
                "evaluations.conduct",
                "evaluations.view_all",
                "evaluations.manage",
            )
        ):
            # The same list the conduct page shows, so the badge counts rows
            # the viewer will find there (CLAUDE.md pitfall #29).
            listed = await self.list_evaluations(
                organization_id,
                viewer,
                status=EvaluationStatus.IN_PROGRESS.value,
            )
            overdue = sum(
                1
                for row in listed
                if row["current_step_due"] is not None
                and row["current_step_due"] < today
            )
        return {"mine": int(mine or 0), "overdue": overdue}

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

    async def preview_options(
        self, organization_id: str, can_use_member_data: bool
    ) -> Dict[str, Any]:
        """Periods a template preview can be measured over, and — only for a
        builder who may read members' figures — the members to measure."""
        periods = (
            (
                await self.db.execute(
                    select(EvaluationPeriod)
                    .where(EvaluationPeriod.organization_id == organization_id)
                    .order_by(EvaluationPeriod.start_date.desc())
                )
            )
            .scalars()
            .all()
        )
        members: List[Dict[str, str]] = []
        if can_use_member_data:
            people = (
                (
                    await self.db.execute(
                        select(User).where(
                            User.organization_id == organization_id,
                            User.deleted_at.is_(None),
                            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                        )
                    )
                )
                .scalars()
                .all()
            )
            members = [
                {"id": u.id, "name": u.full_name}
                for u in sorted(
                    people, key=lambda u: (u.last_name or "", u.first_name or "")
                )
            ]
        return {
            "can_use_member_data": can_use_member_data,
            "members": members,
            "periods": [
                {
                    "id": p.id,
                    "name": p.name,
                    "start_date": p.start_date,
                    "end_date": p.end_date,
                    "is_closed": p.is_closed,
                }
                for p in periods
            ],
        }

    async def preview_template(
        self,
        organization_id: str,
        definition: TemplateDefinition,
        member_id: Optional[str],
        period_id: Optional[str],
    ) -> Dict[str, Any]:
        """A form filled with figures, as an evaluation drafted from it would
        show them, computed now and stored nowhere.

        With a member, their real figures over the period, measured to today
        as ``live_data`` measures them. Without one, fixed sample figures, and
        officer-only sections are shown so the builder sees the whole form.
        The caller is responsible for deciding who may pass a member.
        """
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        today = today_in(tz)
        period: Optional[EvaluationPeriod] = None
        if period_id:
            period = (
                await self.db.execute(
                    select(EvaluationPeriod).where(
                        EvaluationPeriod.id == period_id,
                        EvaluationPeriod.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()
            if period is None:
                raise ValueError("Review period not found.")
        else:
            period = (
                await self.db.execute(
                    select(EvaluationPeriod)
                    .where(EvaluationPeriod.organization_id == organization_id)
                    .order_by(EvaluationPeriod.start_date.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        if period is not None:
            start, end = period.start_date, period.end_date
        else:
            # No period yet: the first-time builder still gets a preview,
            # over the year so far.
            start, end = date(today.year, 1, 1), today
        base: Dict[str, Any] = {
            "period_name": period.name if period else None,
            "period_start": start,
            "period_end": end,
            "overall_levels": OVERALL_LEVELS,
        }

        if member_id is None:
            keys = sources_used(definition, True)
            values = {key: self._sample_entry(key, end) for key in keys}
            snapshot = build_snapshot(
                Coverage(start, end, ()), values, definition, True
            )
            return {
                **base,
                "sample": True,
                "includes_officer_sections": True,
                "sources": [self._source_view(k) for k in keys],
                "data": values,
                "suggested_scores": snapshot["suggested_scores"],
                "note": "Sample figures. Choose a member to see real ones.",
            }

        member = (
            await self.db.execute(
                select(User).where(
                    User.id == member_id,
                    User.organization_id == organization_id,
                    User.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if member is None:
            raise ValueError("Member not found.")
        officer = bool(member.rank) and member.rank in definition.officer_ranks
        keys = sources_used(definition, officer)
        base.update(
            {
                "sample": False,
                "member_name": member.full_name,
                "includes_officer_sections": officer,
                "sources": [self._source_view(k) for k in keys],
            }
        )
        if start > today:
            return {
                **base,
                "data": {},
                "suggested_scores": {},
                "note": "This review period has not started yet.",
            }
        data_service = EvaluationDataService(self.db)
        # Measured to today, not the period's end, as live_data is: a figure
        # for days that have not happened yet would read as a shortfall.
        coverage = await data_service.coverage_for(
            organization_id, member, start, min(end, today), tz
        )
        if coverage is None:
            return {
                **base,
                "data": {},
                "suggested_scores": {},
                "note": f"{member.full_name} has no full month of service in "
                "this period.",
            }
        values = await data_service.compute(organization_id, member, coverage, keys, tz)
        snapshot = build_snapshot(coverage, values, definition, officer)
        return {
            **base,
            "coverage_start": coverage.start,
            "coverage_end": coverage.end,
            "data": values,
            "suggested_scores": snapshot["suggested_scores"],
            "note": None,
        }

    @staticmethod
    def _sample_entry(key: str, period_end: date) -> Dict[str, Any]:
        """A plausible figure for a source, in the shape the real one has, so
        a builder can see how an item will read before any member is chosen."""
        unit = DATA_SOURCES_BY_KEY[key].unit
        if key == "certifications.current":
            return {
                "available": True,
                "value": [
                    {"label": "Firefighter I", "expires_on": None},
                    {
                        "label": "EMT",
                        "expires_on": date(
                            period_end.year + 1, period_end.month, 1
                        ).isoformat(),
                    },
                ],
            }
        if key == "positions.held":
            return {"available": True, "value": [{"label": "Engine Company"}]}
        sample: Dict[str, Any] = {
            "hours": 36.0,
            "percent": 88.0,
            "count": 14,
            "rating": 4.1,
        }
        entry: Dict[str, Any] = {"available": True, "value": sample[unit]}
        if key == "shifts.hours":
            entry["external_hours"] = 0.0
        elif key == "shifts.count":
            entry["external_shifts"] = 0
        return entry

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
        opened = sorted(self._open_keys(evaluation.steps))
        try:
            async with self.db.begin_nested():
                self.db.add(evaluation)
        except IntegrityError as exc:
            raise ValueError(
                f"{member.full_name} already has an evaluation for '{period.name}'."
            ) from exc
        await self.db.commit()
        evaluation_id = evaluation.id
        await self._announce(organization_id, evaluation_id, opened, False)
        return evaluation_id

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
        definition = self._definition(evaluation)
        items = form_items(definition, kind)
        _raise_if(shape_errors(content, items, kind))
        _raise_if(
            grade_errors(
                definition, content, kind == EvaluationPartKind.EVALUATOR.value
            )
        )
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
        was_open = self._open_keys(steps)
        part = parts.get(kind)
        if part is None:
            raise ValueError("Save the part before submitting it.")
        definition = self._definition(evaluation)
        items = form_items(definition, kind)
        content = PartContent.model_validate(part.content)
        suggested = (evaluation.data_snapshot or {}).get("suggested_scores") or {}
        _raise_if(shape_errors(content, items, kind))
        evaluator = kind == EvaluationPartKind.EVALUATOR.value
        _raise_if(grade_errors(definition, content, evaluator))
        _raise_if(
            completeness_errors(
                content, items, kind, definition.overall_mode, suggested
            )
            + (override_reason_errors(definition, content) if evaluator else [])
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
                await self._announce(
                    organization_id, evaluation.id, [calibration.step_key], False
                )
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
        opened = sorted(self._open_keys(steps) - was_open)
        await self.db.commit()
        await self._announce(
            organization_id, evaluation.id, opened, outcome == "finalized"
        )
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

    async def sign(
        self,
        organization_id: str,
        evaluation_id: str,
        actor: User,
        *,
        signed_name: str,
        disposition: str,
        comment: Optional[str],
        ip_address: Optional[str],
        user_agent: Optional[str],
    ) -> Optional[str]:
        """Record ``actor``'s signature on the step now open to them.

        Returns ``signed``, or ``finalized`` when it was the last step. The
        typed name must be the signer's own; the endpoint has already required
        a recent re-verification of the session. The step is read under the
        evaluation's row lock, so a second submission finds it completed, and
        the unique key on (evaluation, revision, step) backs that up.
        """
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        steps = await self._steps(evaluation, for_update=True)
        roles = self._roles(evaluation, actor, steps)
        if not roles.any:
            return None
        signable = self._signable(
            evaluation, steps, {p.id for p in actor.positions}, roles
        )
        if signable is None:
            raise PermissionError(
                "There is nothing for you to sign on this evaluation."
            )
        if disposition not in signable["dispositions"]:
            raise ValueError("That is not how this step is signed.")
        if normalized_name(signed_name) != normalized_name(actor.full_name):
            raise ValueError(
                f"Type your name as it appears on your account: {actor.full_name}."
            )
        parts = await self._parts(evaluation, for_update=True)
        now = datetime.now(timezone.utc)
        self.db.add(
            EvaluationSignature(
                organization_id=organization_id,
                evaluation_id=evaluation.id,
                revision=evaluation.revision,
                step_key=signable["step_key"],
                signer_id=actor.id,
                signed_name=" ".join(signed_name.split()),
                disposition=disposition,
                comment=comment,
                intent_confirmed=True,
                content_hash=content_hash(evaluation, parts),
                ip_address=(ip_address or None) and ip_address[:45],
                user_agent=(user_agent or None) and user_agent[:512],
                signed_at=now,
            )
        )
        was_open = self._open_keys(steps)
        step = next(s for s in steps if s.step_key == signable["step_key"])
        step.status = EvaluationStepStatus.COMPLETED.value
        step.completed_at = now
        step.completed_by = actor.id
        outcome = self._advance(evaluation, steps, now)
        opened = sorted(self._open_keys(steps) - was_open)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError("This step has already been signed.") from exc
        await self._announce(
            organization_id, evaluation.id, opened, outcome == "finalized"
        )
        return "finalized" if outcome == "finalized" else "signed"

    async def complete_calibration(
        self,
        organization_id: str,
        evaluation_id: str,
        actor: User,
        flagged_items: Sequence[str] = (),
    ) -> Optional[bool]:
        """Record that calibration happened, and which of the evaluator's
        items the calibrator flagged for them to revisit (owner decision
        2026-11-02). Ticks only: what was discussed goes to the evaluator in
        person, not into the record, and the member sees the ticks once the
        evaluation is released to them."""
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
        items = form_items(
            self._definition(evaluation), EvaluationPartKind.EVALUATOR.value
        )
        flagged = list(dict.fromkeys(flagged_items))
        unknown = [key for key in flagged if key not in items]
        if unknown:
            raise ValueError("Flag only items on the evaluator's form.")
        step.status = EvaluationStepStatus.COMPLETED.value
        step.completed_at = datetime.now(timezone.utc)
        step.completed_by = actor.id
        step.flagged_items = flagged or None
        await self.db.commit()
        await EvaluationNoticeService(self.db).calibration_completed(
            organization_id, evaluation.id, flagged=bool(flagged)
        )
        return True

    # ------------------------------------------------------- bulk drafting

    async def _open_period(
        self, organization_id: str, period_id: str
    ) -> EvaluationPeriod:
        period = (
            await self.db.execute(
                select(EvaluationPeriod).where(
                    EvaluationPeriod.id == period_id,
                    EvaluationPeriod.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if period is None:
            raise ValueError("Review period not found.")
        if period.is_closed:
            raise ValueError(f"'{period.name}' is closed.")
        return period

    async def bulk_preview(
        self,
        organization_id: str,
        actor: User,
        period_id: str,
        kind: EvaluationTemplateKind,
    ) -> Dict[str, Any]:
        """Every current member as drafting them all for ``period_id`` would
        treat them (owner decision 2026-11-02: preview, then exclude).

        Each row is decided by the rules ``create`` applies, so a member the
        preview offers is one ``create`` accepts: the template that fits, a
        full month served, the supervisor who may conduct evaluations or else
        the drafter, and no second evaluation for the period. A member left
        out says why.
        """
        period = await self._open_period(organization_id, period_id)
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
        drafted = set(
            (
                await self.db.execute(
                    select(Evaluation.member_id).where(
                        Evaluation.organization_id == organization_id,
                        Evaluation.period_id == period.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        conductors = {
            u.id: u for u in members if user_has_permission(u, "evaluations.conduct")
        }
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        data_service = EvaluationDataService(self.db)
        supervisors = MemberSupervisorService(self.db)
        fallback = actor.id if actor.id in conductors else None

        rows: List[Dict[str, Any]] = []
        for member in members:
            row: Dict[str, Any] = {"member": _name(member)}
            rows.append(row)
            if member.id in drafted:
                row["skip_reason"] = "Already has an evaluation for this period."
                continue
            try:
                template = await self.resolve_template(organization_id, member, kind)
            except ValueError as exc:
                row["skip_reason"] = str(exc)
                continue
            row["template"] = {"id": template.id, "name": template.name}
            coverage = await data_service.coverage_for(
                organization_id, member, period.start_date, period.end_date, tz
            )
            if coverage is None:
                row["skip_reason"] = "Served no full month of the period."
                continue
            evaluator_id = (
                await supervisors.default_evaluator_id(
                    organization_id, member.id, "evaluations.conduct"
                )
                or fallback
            )
            if evaluator_id == member.id:
                evaluator_id = None
            evaluator = conductors.get(evaluator_id or "")
            row["evaluator"] = _name(evaluator)
        return {
            "period": {
                "id": period.id,
                "name": period.name,
                "start_date": period.start_date,
                "end_date": period.end_date,
            },
            "kind": kind,
            "rows": rows,
            "evaluators": [_name(u) for u in conductors.values()],
        }

    async def bulk_create(
        self,
        organization_id: str,
        actor: User,
        period_id: str,
        kind: EvaluationTemplateKind,
        items: Sequence[BulkDraftItem],
    ) -> List[Dict[str, Any]]:
        """Draft each listed member, one at a time through ``create``.

        Each draft commits on its own, so one member who cannot be drafted
        (their template was retired since the preview, someone drafted them
        meanwhile) is reported and the rest still go ahead. ``create``'s
        unique constraint settles a member drafted twice at once.
        """
        await self._open_period(organization_id, period_id)
        results: List[Dict[str, Any]] = []
        for item in items:
            try:
                evaluation_id = await self.create(
                    organization_id,
                    actor,
                    EvaluationCreate(
                        member_id=item.member_id,
                        period_id=period_id,
                        evaluator_id=item.evaluator_id,
                        kind=kind,
                    ),
                )
                results.append(
                    {"member_id": item.member_id, "evaluation_id": evaluation_id}
                )
            except (ValueError, PermissionError) as exc:
                results.append({"member_id": item.member_id, "error": str(exc)})
        return results

    # ------------------------------------------------------------ deletion

    async def delete(
        self, organization_id: str, evaluation_id: str, actor: User, reason: str
    ) -> Optional[Tuple[Dict[str, Any], List[str]]]:
        """Remove an evaluation and leave its deletion record.

        Returns the record and the stored PDF paths the caller removes after
        this commits, or None when there is no such evaluation in the
        department. Nobody deletes their own evaluation, whatever they hold.

        The rows go with one DELETE, cascading in the database to the steps,
        parts, signatures, amendments and documents: loading each collection
        to cascade through the ORM would be one round trip per collection
        for nothing.
        """
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        if evaluation.member_id == actor.id:
            raise PermissionError("Nobody deletes their own evaluation.")
        people = await self._people(
            organization_id, [evaluation.member_id, evaluation.evaluator_id]
        )
        evaluator = people.get(evaluation.evaluator_id or "")
        paths = list(
            (
                await self.db.execute(
                    select(EvaluationDocument.file_path).where(
                        EvaluationDocument.evaluation_id == evaluation.id,
                        EvaluationDocument.organization_id == organization_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        record = EvaluationDeletionRecord(
            organization_id=organization_id,
            member_id=evaluation.member_id,
            evaluation_id=evaluation.id,
            period_name=evaluation.period.name if evaluation.period else None,
            period_start=evaluation.period_start,
            period_end=evaluation.period_end,
            template_name=evaluation.template_version.template.name,
            evaluator_name=evaluator.full_name if evaluator else None,
            was_finalized=evaluation.status == EvaluationStatus.FINALIZED.value,
            reason=reason,
            deleted_by=actor.id,
            deleted_by_name=actor.full_name,
            deleted_at=datetime.now(timezone.utc),
        )
        self.db.add(record)
        self.db.expunge(evaluation)
        await self.db.execute(
            sql_delete(Evaluation).where(
                Evaluation.id == evaluation_id,
                Evaluation.organization_id == organization_id,
            )
        )
        await self.db.commit()
        member = people.get(record.member_id)
        await EvaluationNoticeService(self.db).deleted(
            organization_id, record.member_id, record.period_name or "", actor.full_name
        )
        return self._deletion_view(record, member), paths

    @staticmethod
    def _deletion_view(
        record: EvaluationDeletionRecord, member: Optional[User]
    ) -> Dict[str, Any]:
        return {
            "id": record.id,
            "member": {
                "id": record.member_id,
                "name": member.full_name if member else "Former member",
            },
            "period_name": record.period_name,
            "period_start": record.period_start,
            "period_end": record.period_end,
            "template_name": record.template_name,
            "evaluator_name": record.evaluator_name,
            "was_finalized": record.was_finalized,
            "reason": record.reason,
            "deleted_by_name": record.deleted_by_name,
            "deleted_at": record.deleted_at,
        }

    async def deletion_records(
        self, organization_id: str, member_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Deletion records, newest first; one member's when ``member_id`` is
        given."""
        query = select(EvaluationDeletionRecord).where(
            EvaluationDeletionRecord.organization_id == organization_id
        )
        if member_id:
            query = query.where(EvaluationDeletionRecord.member_id == member_id)
        records = (
            (
                await self.db.execute(
                    query.order_by(EvaluationDeletionRecord.deleted_at.desc())
                )
            )
            .scalars()
            .all()
        )
        people = await self._people(organization_id, [r.member_id for r in records])
        return [self._deletion_view(r, people.get(r.member_id)) for r in records]

    # ------------------------------------------------------------ amending

    async def _amendments(self, evaluation: Evaluation) -> List[Dict[str, Any]]:
        rows = (
            (
                await self.db.execute(
                    select(EvaluationAmendment)
                    .where(
                        EvaluationAmendment.evaluation_id == evaluation.id,
                        EvaluationAmendment.organization_id
                        == evaluation.organization_id,
                    )
                    .order_by(EvaluationAmendment.to_revision)
                )
            )
            .scalars()
            .all()
        )
        people = await self._people(
            evaluation.organization_id, [r.amended_by for r in rows]
        )
        return [
            {
                "from_revision": r.from_revision,
                "to_revision": r.to_revision,
                "reason": r.reason,
                "amended_by_name": (
                    people[r.amended_by].full_name
                    if r.amended_by in people
                    else "Former member"
                ),
                "amended_at": r.amended_at,
            }
            for r in rows
        ]

    @staticmethod
    def _reopened_due(
        workflow: TemplateWorkflow, step_key: str, today: date
    ) -> Optional[date]:
        """A reopened step's due date: the template's spacing between steps,
        counted from the day of the amendment rather than the period's end,
        which has long passed. The evaluator gets the time the template gives
        between the self-evaluation and their own step (fourteen days when
        there is no self-evaluation), and each later step keeps its distance
        from the evaluator's."""
        by_key = {ws.key: ws for ws in workflow.steps}
        step = by_key.get(step_key)
        if step is None:
            return None
        evaluator = next(
            ws for ws in workflow.steps if ws.type == EvaluationStepType.EVALUATOR
        )
        self_step = next(
            (
                ws
                for ws in workflow.steps
                if ws.type == EvaluationStepType.SELF_EVALUATION
            ),
            None,
        )
        lead = evaluator.due_days - self_step.due_days if self_step is not None else 14
        return today + timedelta(days=max(lead, 1) + step.due_days - evaluator.due_days)

    async def amend(
        self, organization_id: str, evaluation_id: str, actor: User, reason: str
    ) -> Optional[List[str]]:
        """Reopen a finalized evaluation as a new revision (owner decision
        2026-11-02: from the evaluator onward).

        The member's self-evaluation carries into the new revision as it was;
        the evaluator's part comes back as a draft for them to change; every
        later step (calibration, approvals, the member's acknowledgement)
        runs again, and a new PDF is frozen when it finalizes. The previous
        revision's parts and PDF are removed: an amendment exists to take back
        a statement that should not have been made, and a kept copy would
        defeat it. Its signatures stay, as the record that it was signed.

        Returns the stored PDF paths the caller removes after this commits,
        or None when there is no such evaluation in the department. The row
        lock and the unique key on (evaluation, to_revision) settle two
        amendments racing.
        """
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        if evaluation.member_id == actor.id:
            raise PermissionError("Nobody amends their own evaluation.")
        if evaluation.status != EvaluationStatus.FINALIZED.value:
            raise ValueError("Only a finalized evaluation can be amended.")
        steps = await self._steps(evaluation, for_update=True)
        parts = await self._parts(evaluation, for_update=True)
        workflow = self._workflow(evaluation)
        today = today_in(await resolve_scheduling_timezone(self.db, organization_id))
        old, new = evaluation.revision, evaluation.revision + 1
        old_steps = {s.step_key: s for s in steps}

        for order, ws in enumerate(workflow.steps):
            previous = old_steps.get(ws.key)
            if ws.type == EvaluationStepType.SELF_EVALUATION and previous is not None:
                step = EvaluationStep(
                    organization_id=organization_id,
                    evaluation_id=evaluation.id,
                    revision=new,
                    step_key=ws.key,
                    step_order=order,
                    step_type=ws.type.value,
                    status=previous.status,
                    due_date=previous.due_date,
                    completed_at=previous.completed_at,
                    completed_by=previous.completed_by,
                    reminder_sent_at=previous.reminder_sent_at,
                    overdue_notice_sent_at=previous.overdue_notice_sent_at,
                )
            else:
                step = EvaluationStep(
                    organization_id=organization_id,
                    evaluation_id=evaluation.id,
                    revision=new,
                    step_key=ws.key,
                    step_order=order,
                    step_type=ws.type.value,
                    status=(
                        EvaluationStepStatus.OPEN.value
                        if ws.type == EvaluationStepType.EVALUATOR
                        else EvaluationStepStatus.PENDING.value
                    ),
                    due_date=self._reopened_due(workflow, ws.key, today),
                )
            self.db.add(step)

        for kind, part in parts.items():
            if kind == EvaluationPartKind.MEMBER_RESPONSE.value:
                continue
            self.db.add(
                EvaluationPart(
                    organization_id=organization_id,
                    evaluation_id=evaluation.id,
                    revision=new,
                    kind=kind,
                    author_id=part.author_id,
                    content=copy.deepcopy(part.content),
                    status=(
                        EvaluationPartStatus.DRAFT.value
                        if kind == EvaluationPartKind.EVALUATOR.value
                        else part.status
                    ),
                    submitted_at=(
                        None
                        if kind == EvaluationPartKind.EVALUATOR.value
                        else part.submitted_at
                    ),
                )
            )
        for part in parts.values():
            await self.db.delete(part)

        documents = (
            (
                await self.db.execute(
                    select(EvaluationDocument).where(
                        EvaluationDocument.evaluation_id == evaluation.id,
                        EvaluationDocument.organization_id == organization_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        paths = [d.file_path for d in documents]
        for document in documents:
            await self.db.delete(document)

        evaluation.revision = new
        evaluation.status = EvaluationStatus.IN_PROGRESS.value
        evaluation.finalized_at = None
        self.db.add(
            EvaluationAmendment(
                organization_id=organization_id,
                evaluation_id=evaluation.id,
                from_revision=old,
                to_revision=new,
                reason=reason,
                amended_by=actor.id,
                amended_at=datetime.now(timezone.utc),
            )
        )
        signer_ids = list(
            (
                await self.db.execute(
                    select(EvaluationSignature.signer_id).where(
                        EvaluationSignature.evaluation_id == evaluation.id,
                        EvaluationSignature.organization_id == organization_id,
                        EvaluationSignature.revision == old,
                    )
                )
            )
            .scalars()
            .all()
        )
        evaluator_keys = [
            ws.key for ws in workflow.steps if ws.type == EvaluationStepType.EVALUATOR
        ]
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError("This evaluation has just been amended.") from exc

        notices = EvaluationNoticeService(self.db)
        await notices.steps_opened(organization_id, evaluation.id, evaluator_keys)
        await notices.amended(
            organization_id,
            evaluation.id,
            actor,
            [i for i in signer_ids if i],
        )
        return paths

    # ------------------------------------------------------------ response

    def _response_due(self, evaluation: Evaluation) -> Optional[date]:
        """The last day the member may attach a written response: the
        template's ``response_window_days`` after finalization (thirty by
        default, after Cal. Gov. Code 3256). None before finalization, and
        when the template allows no response.

        Counted from the UTC day of finalization, which is at most a day off
        the department's calendar, in the member's favour or against it by
        the same margin as any other dated notice here."""
        if (
            evaluation.status != EvaluationStatus.FINALIZED.value
            or evaluation.finalized_at is None
        ):
            return None
        window = self._workflow(evaluation).response_window_days
        if window <= 0:
            return None
        finalized = evaluation.finalized_at
        if finalized.tzinfo is None:
            finalized = finalized.replace(tzinfo=timezone.utc)
        return finalized.date() + timedelta(days=window)

    async def _respondable(
        self, organization_id: str, evaluation_id: str, actor: User
    ) -> Optional[Tuple[Evaluation, Optional[EvaluationPart]]]:
        """The evaluation and the member's response part, locked, when
        ``actor`` may still write it. None when they may not see it."""
        evaluation = await self._evaluation(
            organization_id, evaluation_id, for_update=True
        )
        if evaluation is None:
            return None
        steps = await self._steps(evaluation, for_update=True)
        roles = self._roles(evaluation, actor, steps)
        if not roles.any:
            return None
        if not roles.is_member:
            raise PermissionError(
                "Only the member writes a response to their evaluation."
            )
        due = self._response_due(evaluation)
        if due is None:
            raise ValueError("A response is added once the evaluation is final.")
        today = today_in(await resolve_scheduling_timezone(self.db, organization_id))
        if today > due:
            raise ValueError(
                f"Responses to this evaluation closed on {due.isoformat()}."
            )
        parts = await self._parts(evaluation, for_update=True)
        part = parts.get(EvaluationPartKind.MEMBER_RESPONSE.value)
        if part is not None and part.status == EvaluationPartStatus.SUBMITTED.value:
            raise ValueError("Your response has already been submitted.")
        return evaluation, part

    async def save_response(
        self, organization_id: str, evaluation_id: str, actor: User, text: str
    ) -> Optional[bool]:
        """Save the member's response as a draft, theirs alone until they
        submit it."""
        loaded = await self._respondable(organization_id, evaluation_id, actor)
        if loaded is None:
            return None
        evaluation, part = loaded
        content = PartContent(overall_comment=text).model_dump(mode="json")
        if part is None:
            self.db.add(
                EvaluationPart(
                    organization_id=organization_id,
                    evaluation_id=evaluation.id,
                    revision=evaluation.revision,
                    kind=EvaluationPartKind.MEMBER_RESPONSE.value,
                    author_id=actor.id,
                    content=content,
                    status=EvaluationPartStatus.DRAFT.value,
                )
            )
        else:
            part.content = content
        await self.db.commit()
        return True

    async def submit_response(
        self, organization_id: str, evaluation_id: str, actor: User
    ) -> Optional[bool]:
        """Submit the saved response. It is final: it joins the record, is
        printed in a second PDF beside the signed one, and the evaluator and
        the evaluation managers are told."""
        loaded = await self._respondable(organization_id, evaluation_id, actor)
        if loaded is None:
            return None
        evaluation, part = loaded
        if part is None or not PartContent.model_validate(part.content).overall_comment:
            raise ValueError("Save your response before submitting it.")
        part.status = EvaluationPartStatus.SUBMITTED.value
        part.submitted_at = datetime.now(timezone.utc)
        await self.db.commit()
        await EvaluationNoticeService(self.db).responded(organization_id, evaluation.id)
        return True
