"""
Email notices for member performance evaluations (owner decision 2026-11-02).

Four notices, each an editable template (``email_templates_evaluations``):

- **Waiting on you** when a step opens, to the people who act on it, and to the
  evaluator when calibration is done and their part can go on.
- **Deadline reminder**, once per step, ``reminder_days_before`` days before it
  is due (the template version's workflow sets the number).
- **Overdue**, once per step, after its due date: to the people who act on it
  and to the department's evaluation managers.
- **Finalized**, to the member and the evaluator.

Who acts on a step is the same rule the evaluation screens apply: the member
for the self-evaluation and acknowledgement, the assigned evaluator for theirs,
holders of ``evaluations.view_all`` for calibration, and holders of the step's
position for an approval. Nobody is told about their own evaluation through an
officer's grant, so the member is never among the calibrators, approvers or
managers emailed.

Email to the member about their own evaluation is
``EmailKind.PERFORMANCE_EVALUATIONS`` (always sent); everything an officer
receives because of a role is ``EmailKind.EVALUATION_DUTIES``, which they may
switch off. The bodies carry the member's name, the period and the step, never
a rating or a comment.

Every method here is best-effort and runs after the caller's commit: the
evaluation has moved on whether or not the email goes out, so a failure is
logged and never undoes it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.models.email_template import EmailTemplateType
from app.models.evaluation import (
    Evaluation,
    EvaluationStatus,
    EvaluationStep,
    EvaluationStepStatus,
    EvaluationStepType,
)
from app.models.user import (
    ACTIVE_ACCOUNT_STATUSES,
    Organization,
    Position,
    User,
    user_positions,
)
from app.schemas.evaluation import TemplateWorkflow, WorkflowStep
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.utils.org_timezone import scheduling_timezone, today_in

EVALUATION_PATH = "/reports/evaluations/{id}"

# The day a step is due, as every evaluation notice prints it.
DUE_DATE_FORMAT = "%B %d, %Y"

# A reminder is at most 30 days ahead (TemplateWorkflow.reminder_days_before),
# plus a day for the widest timezone gap. Only narrows the scan's query.
_SCAN_DAYS_AHEAD = 31

_OPENED = "opened"
_CALIBRATED = "calibrated"
_REMINDER = "reminder"
_OVERDUE = "overdue"

_TEMPLATE = {
    _OPENED: EmailTemplateType.EVALUATION_STEP_WAITING,
    _CALIBRATED: EmailTemplateType.EVALUATION_STEP_WAITING,
    _REMINDER: EmailTemplateType.EVALUATION_DEADLINE_REMINDER,
    _OVERDUE: EmailTemplateType.EVALUATION_OVERDUE,
}

# One sentence per (event, step type), for the people who act on the step.
# {member} is the evaluated member's name, {period} the period's.
_ACTOR_SUMMARY: Dict[str, Dict[str, str]] = {
    _OPENED: {
        EvaluationStepType.SELF_EVALUATION.value: (
            "Your self-evaluation for {period} is open."
        ),
        EvaluationStepType.EVALUATOR.value: (
            "You are evaluating {member} for {period}."
        ),
        EvaluationStepType.CALIBRATION.value: (
            "{member}'s evaluation for {period} is ready for calibration."
        ),
        EvaluationStepType.APPROVAL.value: (
            "{member}'s evaluation for {period} is waiting for your approval."
        ),
        EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value: (
            "Your evaluation for {period} is ready for you to read and " "acknowledge."
        ),
    },
    _CALIBRATED: {
        EvaluationStepType.EVALUATOR.value: (
            "Calibration of {member}'s evaluation for {period} is complete. "
            "Submit your part again to send it on."
        ),
    },
    _REMINDER: {
        EvaluationStepType.SELF_EVALUATION.value: (
            "Your self-evaluation for {period} is due soon."
        ),
        EvaluationStepType.EVALUATOR.value: (
            "Your evaluation of {member} for {period} is due soon."
        ),
        EvaluationStepType.CALIBRATION.value: (
            "Calibration of {member}'s evaluation for {period} is due soon."
        ),
        EvaluationStepType.APPROVAL.value: (
            "Your approval of {member}'s evaluation for {period} is due soon."
        ),
        EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value: (
            "Your acknowledgement of your evaluation for {period} is due soon."
        ),
    },
    _OVERDUE: {
        EvaluationStepType.SELF_EVALUATION.value: (
            "Your self-evaluation for {period} is past its due date."
        ),
        EvaluationStepType.EVALUATOR.value: (
            "Your evaluation of {member} for {period} is past its due date."
        ),
        EvaluationStepType.CALIBRATION.value: (
            "Calibration of {member}'s evaluation for {period} is past its " "due date."
        ),
        EvaluationStepType.APPROVAL.value: (
            "Your approval of {member}'s evaluation for {period} is past its "
            "due date."
        ),
        EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value: (
            "Your acknowledgement of your evaluation for {period} is past its "
            "due date."
        ),
    },
}

_MANAGER_OVERDUE = (
    "The {label} step of {member}'s evaluation for {period} is past its due date."
)


@dataclass(frozen=True)
class _Recipient:
    user: User
    kind: EmailKind
    summary: str


def _due_text(value: Optional[date]) -> str:
    return value.strftime(DUE_DATE_FORMAT) if value else "No due date"


def _evaluation_url(evaluation_id: str) -> str:
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    return f"{base}{EVALUATION_PATH.format(id=evaluation_id)}"


def _period_name(evaluation: Evaluation) -> str:
    if evaluation.period is not None:
        return evaluation.period.name
    return (
        f"{evaluation.period_start.strftime(DUE_DATE_FORMAT)} to "
        f"{evaluation.period_end.strftime(DUE_DATE_FORMAT)}"
    )


def reminder_due(
    step_due: Optional[date], reminder_days_before: int, today: date
) -> bool:
    """Whether ``today`` is inside a step's reminder window: from
    ``reminder_days_before`` days ahead of the due date through the due date."""
    if step_due is None:
        return False
    return step_due - timedelta(days=reminder_days_before) <= today <= step_due


class EvaluationNoticeService:
    def __init__(self, db: AsyncSession):
        self.db = db
        # Sends that raised, since the last reset. The scan reads it to leave
        # a step unstamped when the mail system was down for every recipient.
        self.send_errors = 0

    # ------------------------------------------------------------- loading

    async def _evaluation(
        self, organization_id: str, evaluation_id: str
    ) -> Optional[Evaluation]:
        from app.services.evaluation_service import EvaluationService

        return await EvaluationService(self.db)._evaluation(
            organization_id, evaluation_id
        )

    async def _people(
        self, organization_id: str, user_ids: Iterable[Optional[str]]
    ) -> Dict[str, User]:
        ids = [str(u) for u in user_ids if u]
        if not ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_(ids),
                User.organization_id == organization_id,
            )
        )
        return {u.id: u for u in result.scalars().all()}

    async def _current(self, organization_id: str, query: Any) -> List[User]:
        result = await self.db.execute(
            query.where(
                User.organization_id == organization_id,
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
                User.email.isnot(None),
            )
        )
        return list(result.scalars().unique().all())

    async def _holding(self, organization_id: str, permission: str) -> List[User]:
        members = await self._current(
            organization_id, select(User).options(selectinload(User.positions))
        )
        return [m for m in members if user_has_permission(m, permission)]

    async def _position_holders(
        self, organization_id: str, position_id: Optional[str]
    ) -> List[User]:
        if not position_id:
            return []
        return await self._current(
            organization_id,
            select(User)
            .join(user_positions, user_positions.c.user_id == User.id)
            .join(
                Position,
                and_(
                    Position.id == user_positions.c.position_id,
                    Position.organization_id == organization_id,
                ),
            )
            .where(Position.id == position_id),
        )

    async def _own(self, organization_id: str, user_id: Optional[str]) -> List[User]:
        if not user_id:
            return []
        return await self._current(
            organization_id, select(User).where(User.id == str(user_id))
        )

    async def _actors(
        self, evaluation: Evaluation, workflow_step: WorkflowStep
    ) -> List[User]:
        """Who acts on the step, as the screens decide it."""
        org_id = evaluation.organization_id
        actor = workflow_step.actor
        if actor.kind == "member":
            return await self._own(org_id, evaluation.member_id)
        if actor.kind == "evaluator":
            return await self._own(org_id, evaluation.evaluator_id)
        if actor.kind == "view_all":
            people = await self._holding(org_id, "evaluations.view_all")
        else:
            people = await self._position_holders(org_id, actor.position_id)
        return [p for p in people if p.id != evaluation.member_id]

    # ------------------------------------------------------------- sending

    async def _send(
        self,
        organization: Organization,
        evaluation: Evaluation,
        recipients: Sequence[_Recipient],
        template_type: EmailTemplateType,
        *,
        member_name: str,
        step_label: Optional[str] = None,
        due: Optional[date] = None,
    ) -> int:
        from app.services.email_service import EmailService

        required = department_required_kinds(organization)
        seen: set = set()
        email_service = EmailService(organization)
        sent = 0
        for recipient in recipients:
            user = recipient.user
            if user.id in seen or not user.email:
                continue
            seen.add(user.id)
            if not member_receives_email(
                user.notification_preferences, recipient.kind, required
            ):
                continue
            context: Dict[str, Any] = {
                "recipient_name": user.full_name,
                "member_name": member_name,
                "period_name": _period_name(evaluation),
                "summary": recipient.summary,
                "evaluation_url": _evaluation_url(evaluation.id),
            }
            if step_label is not None:
                context["step_label"] = step_label
                context["due_date"] = _due_text(due)
            # One recipient's failure must not keep the email from the rest,
            # nor reach the caller, whose transition has already committed.
            try:
                if await email_service.send_evaluation_notice(
                    template_type,
                    to_email=user.email,
                    context=context,
                    db=self.db,
                    organization_id=organization.id,
                ):
                    sent += 1
            except Exception as e:
                self.send_errors += 1
                logger.error(
                    "Failed to send {} for evaluation {} to user {}: {}",
                    template_type.value,
                    evaluation.id,
                    user.id,
                    e,
                )
        return sent

    async def _step_notice(
        self,
        organization: Organization,
        evaluation: Evaluation,
        step: EvaluationStep,
        event: str,
        *,
        include_managers: bool = False,
    ) -> int:
        workflow = TemplateWorkflow.model_validate(evaluation.template_version.workflow)
        workflow_step = next(
            (ws for ws in workflow.steps if ws.key == step.step_key), None
        )
        if workflow_step is None:
            return 0
        sentence = _ACTOR_SUMMARY[event].get(step.step_type)
        if sentence is None:
            return 0
        people = await self._people(evaluation.organization_id, [evaluation.member_id])
        member = people.get(evaluation.member_id)
        member_name = member.full_name if member else "a former member"
        period = _period_name(evaluation)
        summary = sentence.format(member=member_name, period=period)
        actors = await self._actors(evaluation, workflow_step)
        recipients = [
            _Recipient(
                user=user,
                kind=(
                    EmailKind.PERFORMANCE_EVALUATIONS
                    if user.id == evaluation.member_id
                    else EmailKind.EVALUATION_DUTIES
                ),
                summary=summary,
            )
            for user in actors
        ]
        if include_managers:
            acting = {u.id for u in actors}
            manager_summary = _MANAGER_OVERDUE.format(
                label=workflow_step.label, member=member_name, period=period
            )
            recipients += [
                _Recipient(
                    user=user, kind=EmailKind.EVALUATION_DUTIES, summary=manager_summary
                )
                for user in await self._holding(
                    evaluation.organization_id, "evaluations.manage"
                )
                if user.id not in acting and user.id != evaluation.member_id
            ]
        return await self._send(
            organization,
            evaluation,
            recipients,
            _TEMPLATE[event],
            member_name=member_name,
            step_label=workflow_step.label,
            due=step.due_date,
        )

    async def _open_steps(
        self, evaluation: Evaluation, keys: Iterable[str]
    ) -> List[EvaluationStep]:
        wanted = set(keys)
        if not wanted:
            return []
        result = await self.db.execute(
            select(EvaluationStep)
            .where(
                EvaluationStep.evaluation_id == evaluation.id,
                EvaluationStep.organization_id == evaluation.organization_id,
                EvaluationStep.revision == evaluation.revision,
                EvaluationStep.step_key.in_(wanted),
                EvaluationStep.status == EvaluationStepStatus.OPEN.value,
            )
            .order_by(EvaluationStep.step_order)
        )
        return list(result.scalars().all())

    # --------------------------------------------------- after a transition

    async def _settle(self, error: Exception) -> None:
        """Roll back only when the database itself failed.

        These run inside the caller's request after its commit, and the
        caller goes on to read the objects it loaded. A rollback expires
        them all, so an email problem must leave the session alone; only a
        failed statement, which leaves the session unusable until rolled
        back, calls for one.
        """
        if isinstance(error, SQLAlchemyError):
            await self.db.rollback()

    async def steps_opened(
        self, organization_id: str, evaluation_id: str, step_keys: Iterable[str]
    ) -> int:
        """Tell the people who act on each newly opened step. A step that
        opens already inside its reminder window is stamped as reminded: the
        notice gives its due date, and a reminder the next morning would say
        the same thing again."""
        try:
            evaluation = await self._evaluation(organization_id, evaluation_id)
            organization = await self.db.get(Organization, organization_id)
            if evaluation is None or organization is None:
                return 0
            workflow = TemplateWorkflow.model_validate(
                evaluation.template_version.workflow
            )
            today = today_in(scheduling_timezone(organization))
            sent = 0
            for step in await self._open_steps(evaluation, step_keys):
                sent += await self._step_notice(organization, evaluation, step, _OPENED)
                if step.reminder_sent_at is None and reminder_due(
                    step.due_date, workflow.reminder_days_before, today
                ):
                    step.reminder_sent_at = datetime.now(timezone.utc)
            await self.db.commit()
            return sent
        except Exception as e:
            await self._settle(e)
            logger.error(
                "Failed to send opened-step notices for evaluation {}: {}",
                evaluation_id,
                e,
            )
            return 0

    async def calibration_completed(
        self, organization_id: str, evaluation_id: str
    ) -> int:
        """Tell the evaluator their part can go on."""
        try:
            evaluation = await self._evaluation(organization_id, evaluation_id)
            organization = await self.db.get(Organization, organization_id)
            if evaluation is None or organization is None:
                return 0
            steps = [
                s
                for s in await self._open_steps(
                    evaluation,
                    [
                        ws.key
                        for ws in TemplateWorkflow.model_validate(
                            evaluation.template_version.workflow
                        ).steps
                        if ws.type == EvaluationStepType.EVALUATOR
                    ],
                )
            ]
            sent = 0
            for step in steps:
                sent += await self._step_notice(
                    organization, evaluation, step, _CALIBRATED
                )
            return sent
        except Exception as e:
            await self._settle(e)
            logger.error(
                "Failed to send calibration notice for evaluation {}: {}",
                evaluation_id,
                e,
            )
            return 0

    async def finalized(self, organization_id: str, evaluation_id: str) -> int:
        """Tell the member and the evaluator the record is final."""
        try:
            evaluation = await self._evaluation(organization_id, evaluation_id)
            organization = await self.db.get(Organization, organization_id)
            if (
                evaluation is None
                or organization is None
                or evaluation.status != EvaluationStatus.FINALIZED.value
            ):
                return 0
            people = await self._people(organization_id, [evaluation.member_id])
            member = people.get(evaluation.member_id)
            member_name = member.full_name if member else "a former member"
            period = _period_name(evaluation)
            recipients = [
                _Recipient(
                    user=user,
                    kind=EmailKind.PERFORMANCE_EVALUATIONS,
                    summary=f"Your evaluation for {period} is final.",
                )
                for user in await self._own(organization_id, evaluation.member_id)
            ] + [
                _Recipient(
                    user=user,
                    kind=EmailKind.EVALUATION_DUTIES,
                    summary=(
                        f"{member_name}'s evaluation for {period}, which you "
                        "conducted, is final."
                    ),
                )
                for user in await self._own(organization_id, evaluation.evaluator_id)
            ]
            return await self._send(
                organization,
                evaluation,
                recipients,
                EmailTemplateType.EVALUATION_FINALIZED,
                member_name=member_name,
            )
        except Exception as e:
            await self._settle(e)
            logger.error(
                "Failed to send finalized notices for evaluation {}: {}",
                evaluation_id,
                e,
            )
            return 0

    # ------------------------------------------------------------ the scan

    async def send_due_notices(self, now: Optional[datetime] = None) -> Dict[str, int]:
        """Send the deadline reminders and overdue notices that are due.

        Send, then stamp and commit (CLAUDE.md pitfall #36): a crash between
        the two sends that notice again on the next run. A duplicate reminder
        is a nuisance; a missed one is a deadline nobody was told about. Each
        step is locked and re-checked before sending, so two runs cannot both
        send it.
        """
        now = now or datetime.now(timezone.utc)
        horizon = now.date() + timedelta(days=_SCAN_DAYS_AHEAD)
        result = await self.db.execute(
            select(EvaluationStep.id, EvaluationStep.organization_id)
            .join(
                Evaluation,
                and_(
                    Evaluation.id == EvaluationStep.evaluation_id,
                    Evaluation.organization_id == EvaluationStep.organization_id,
                    Evaluation.revision == EvaluationStep.revision,
                ),
            )
            .join(Organization, Organization.id == EvaluationStep.organization_id)
            .where(
                Organization.active.isnot(False),
                Evaluation.status == EvaluationStatus.IN_PROGRESS.value,
                EvaluationStep.status == EvaluationStepStatus.OPEN.value,
                EvaluationStep.due_date.isnot(None),
                EvaluationStep.due_date <= horizon,
                or_(
                    EvaluationStep.reminder_sent_at.is_(None),
                    EvaluationStep.overdue_notice_sent_at.is_(None),
                ),
            )
        )
        candidates = [(str(sid), str(oid)) for sid, oid in result.all()]
        counts = {"considered": len(candidates), "reminders": 0, "overdue": 0}
        for step_id, organization_id in candidates:
            outcome = await self._notify_one(step_id, organization_id, now)
            if outcome is not None:
                counts[outcome] += 1
        return counts

    async def _notify_one(
        self, step_id: str, organization_id: str, now: datetime
    ) -> Optional[str]:
        """Send what one step is due, if anything: ``"overdue"``,
        ``"reminders"`` or None. Each step ends in its own commit, which
        releases its row lock; nothing is written unless a notice went out.
        Only a failed statement rolls back, since a rollback also expires
        every object the session holds."""
        try:
            step = (
                await self.db.execute(
                    select(EvaluationStep)
                    .where(
                        EvaluationStep.id == step_id,
                        EvaluationStep.organization_id == organization_id,
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            organization = await self.db.get(Organization, organization_id)
            if (
                step is None
                or organization is None
                or step.status != EvaluationStepStatus.OPEN.value
                or step.due_date is None
            ):
                await self.db.commit()
                return None
            evaluation = await self._evaluation(organization_id, step.evaluation_id)
            if (
                evaluation is None
                or evaluation.status != EvaluationStatus.IN_PROGRESS.value
                or evaluation.revision != step.revision
            ):
                await self.db.commit()
                return None
            today = now.astimezone(scheduling_timezone(organization)).date()
            workflow = TemplateWorkflow.model_validate(
                evaluation.template_version.workflow
            )
            outcome: Optional[str] = None
            self.send_errors = 0
            sent = 0
            if today > step.due_date and step.overdue_notice_sent_at is None:
                sent = await self._step_notice(
                    organization, evaluation, step, _OVERDUE, include_managers=True
                )
                outcome = "overdue"
            elif step.reminder_sent_at is None and reminder_due(
                step.due_date, workflow.reminder_days_before, today
            ):
                sent = await self._step_notice(
                    organization, evaluation, step, _REMINDER
                )
                outcome = "reminders"
            if outcome is None or (self.send_errors and not sent):
                # Nothing due, or the mail system failed for every recipient:
                # leave the step unstamped so tomorrow's run tries again.
                await self.db.commit()
                return None
            if outcome == "overdue":
                step.overdue_notice_sent_at = now
                # A reminder that the step is due soon is moot once it is late.
                step.reminder_sent_at = step.reminder_sent_at or now
            else:
                step.reminder_sent_at = now
            await self.db.commit()
            return outcome
        except Exception as e:
            await self.db.rollback()
            logger.error(
                "Failed to send due notice for evaluation step {}: {}", step_id, e
            )
            return None
