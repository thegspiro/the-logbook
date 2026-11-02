"""
Shift evaluation service

Who must be evaluated after a shift, on which form, and saving what the shift
officer fills in.

Who is evaluated (decided per shift, from the shift's crew):

- A member enrolled in an active training program whose program names an
  evaluation form is evaluated on that form, one evaluation per program. When
  the department lets one evaluation count for several programs, a member in
  more than one gets a single evaluation, and the officer picks the form when
  the programs use different ones.
- Otherwise, when the department has a general form switched to optional or
  required, a member who sat in one of that form's evaluated seats gets it.

Close-out (``SchedulingService.finalize_shift``) refuses while a required
evaluation is not submitted, whatever the "require officer shift completion
report" setting says: attaching a form to a program is the department's
opt-in. A department with no form attached sees no change.

The member sees a submitted evaluation on the same terms as their shift
report: at once, unless the department requires report review, in which case
once the report for that shift is approved.

Program credit (evaluated shifts, transports, refusals) lands when the member
can see the evaluation and follows it from then on: an edit restates the
credit, and anything that hides the evaluation again takes it back. Each
credit is keyed on the evaluation in the requirement credit ledger, so
re-running the sync never counts an evaluation twice (Pitfall #36).
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shift_evaluation import (
    COMBINED_SCOPE,
    DEFAULT_GENERAL_EVALUATION_MODE,
    GENERAL_SCOPE,
    ShiftEvaluation,
    ShiftEvaluationTemplate,
)
from app.models.training import (
    AssignmentStatus,
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramRequirement,
    ProgressCreditSource,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementProgressStatus,
    RequirementType,
    Shift,
    ShiftAssignment,
    ShiftCompletionReport,
    TrainingModuleConfig,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.shift_evaluation import (
    EvaluationItemResponse,
    ShiftEvaluationDetail,
    ShiftEvaluationForm,
    ShiftEvaluationRequirement,
    ShiftEvaluationRoster,
    ShiftEvaluationSave,
    ShiftEvaluationSummary,
    TemplateOption,
)
from app.services.training_program_service import TrainingProgramService
from app.utils.positions import canonical_position

# Mirrors SchedulingService.INACTIVE_ASSIGNMENT_STATUSES. Not imported from
# there because scheduling_service imports this module for the close-out
# check; a declined or cancelled seat is not crew.
_INACTIVE_ASSIGNMENT_STATUSES = (AssignmentStatus.DECLINED, AssignmentStatus.CANCELLED)

# The template fields an evaluation keeps a copy of.
_SNAPSHOT_FIELDS = (
    "name",
    "scale",
    "allow_not_applicable",
    "not_applicable_label",
    "comment_required_at_or_below",
    "header_fields",
    "statistics",
    "sections",
    "closing_comments_label",
    "closing_comments_hint",
)


# The requirement types an evaluation credits.
_CREDITED_TYPES = (
    RequirementType.EVALUATED_SHIFTS,
    RequirementType.TRANSPORTS,
    RequirementType.REFUSALS,
)
# A progress row in one of these states takes no new credit: the member is
# already done, or the requirement was set aside for them.
_CLOSED_PROGRESS = (
    RequirementProgressStatus.COMPLETED,
    RequirementProgressStatus.VERIFIED,
    RequirementProgressStatus.WAIVED,
)


def credit_units(evaluation: ShiftEvaluation, requirement: Any) -> float:
    """What one submitted evaluation is worth toward one requirement."""
    rtype = requirement.requirement_type
    statistics = evaluation.statistics or {}
    if rtype == RequirementType.TRANSPORTS:
        return float(statistics.get("transports") or 0)
    if rtype == RequirementType.REFUSALS:
        return float(statistics.get("refusals") or 0)
    if rtype != RequirementType.EVALUATED_SHIFTS:
        return 0.0
    if requirement.evaluation_excludes_lowest_rating:
        # The form's own lowest rating, from the copy it was filled out on,
        # so a later edit to the template's scale cannot regrade it.
        scale = (evaluation.template_snapshot or {}).get("scale") or []
        values = [int(level["value"]) for level in scale if "value" in level]
        if values:
            lowest = min(values)
            for answer in (evaluation.responses or {}).values():
                if (answer or {}).get("rating") == lowest:
                    return 0.0
    return 1.0


def _name(user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    return user.full_name or user.display_name


def template_snapshot(template: ShiftEvaluationTemplate) -> dict[str, Any]:
    """The copy of a template an evaluation is filled out and read back on."""
    snapshot = {name: getattr(template, name) for name in _SNAPSHOT_FIELDS}
    snapshot["id"] = template.id
    snapshot["version"] = template.version
    return snapshot


@dataclass
class _Requirement:
    member: User
    seat: Optional[str]
    scope_key: str
    required: bool
    enrollment_ids: list[str] = field(default_factory=list)
    program_names: list[str] = field(default_factory=list)
    templates: list[ShiftEvaluationTemplate] = field(default_factory=list)
    evaluation: Optional[ShiftEvaluation] = None


class ShiftEvaluationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -- Loading ---------------------------------------------------------

    async def get_shift(
        self, shift_id: UUID | str, organization_id: UUID | str
    ) -> Optional[Shift]:
        result = await self.db.execute(
            select(Shift).where(
                Shift.id == str(shift_id),
                Shift.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _config(
        self, organization_id: UUID | str
    ) -> Optional[TrainingModuleConfig]:
        # Read without creating: a department with no settings row has no
        # general form, which is the "off" default.
        result = await self.db.execute(
            select(TrainingModuleConfig).where(
                TrainingModuleConfig.organization_id == str(organization_id)
            )
        )
        return result.scalars().first()

    async def _unit_label(
        self, shift: Shift, organization_id: UUID | str
    ) -> Optional[str]:
        # The shift report's own labelling (Apparatus, then basic apparatus),
        # reused rather than copied so the two screens name a unit alike.
        from app.services.shift_completion_service import ShiftCompletionService

        labels = await ShiftCompletionService(self.db).shift_unit_labels(
            {shift.id}, organization_id
        )
        return labels.get(shift.id)

    # -- Who is evaluated ------------------------------------------------

    async def requirements(
        self, shift: Shift, organization_id: UUID | str
    ) -> list[_Requirement]:
        org = str(organization_id)
        crew_rows = (
            await self.db.execute(
                select(ShiftAssignment, User)
                .join(User, User.id == ShiftAssignment.user_id)
                .where(
                    ShiftAssignment.shift_id == shift.id,
                    ShiftAssignment.assignment_status.notin_(
                        _INACTIVE_ASSIGNMENT_STATUSES
                    ),
                    User.organization_id == org,
                )
                .order_by(User.last_name, User.first_name, User.id)
            )
        ).all()
        members = {str(user.id): (assignment, user) for assignment, user in crew_rows}

        existing = {
            (str(e.member_id), e.scope_key): e
            for e in (
                await self.db.execute(
                    select(ShiftEvaluation).where(
                        ShiftEvaluation.shift_id == shift.id,
                        ShiftEvaluation.organization_id == org,
                    )
                )
            ).scalars()
        }

        enrollments: dict[str, list[tuple[ProgramEnrollment, TrainingProgram]]] = {}
        if members:
            rows = (
                await self.db.execute(
                    select(ProgramEnrollment, TrainingProgram)
                    .join(
                        TrainingProgram,
                        TrainingProgram.id == ProgramEnrollment.program_id,
                    )
                    .where(
                        ProgramEnrollment.user_id.in_(list(members)),
                        ProgramEnrollment.organization_id == org,
                        ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                        TrainingProgram.organization_id == org,
                        TrainingProgram.shift_evaluation_template_id.is_not(None),
                    )
                    # Ordered so the per-program evaluations, and the form
                    # offered first on a combined one, come out the same way
                    # on every read.
                    .order_by(TrainingProgram.name, ProgramEnrollment.id)
                )
            ).all()
            for enrollment, program in rows:
                enrollments.setdefault(str(enrollment.user_id), []).append(
                    (enrollment, program)
                )

        config = await self._config(org)
        general_id = config.general_shift_evaluation_template_id if config else None
        general_mode = (
            config.general_shift_evaluation_mode if config else None
        ) or DEFAULT_GENERAL_EVALUATION_MODE
        combine = bool(config and config.one_shift_evaluation_for_multiple_programs)

        template_ids = {
            str(program.shift_evaluation_template_id)
            for pairs in enrollments.values()
            for _, program in pairs
        }
        if general_id and general_mode != "off":
            template_ids.add(str(general_id))
        templates: dict[str, ShiftEvaluationTemplate] = {}
        if template_ids:
            for template in (
                await self.db.execute(
                    select(ShiftEvaluationTemplate).where(
                        ShiftEvaluationTemplate.id.in_(template_ids),
                        ShiftEvaluationTemplate.organization_id == org,
                    )
                )
            ).scalars():
                templates[str(template.id)] = template

        result: list[_Requirement] = []
        for member_id, (assignment, user) in members.items():
            seat = canonical_position(
                str(getattr(assignment.position, "value", assignment.position) or "")
            )
            pairs = [
                (e, p)
                for e, p in enrollments.get(member_id, [])
                if str(p.shift_evaluation_template_id) in templates
            ]
            if pairs and combine and len(pairs) > 1:
                options: list[ShiftEvaluationTemplate] = []
                for _, program in pairs:
                    template = templates[str(program.shift_evaluation_template_id)]
                    if template not in options:
                        options.append(template)
                result.append(
                    _Requirement(
                        member=user,
                        seat=seat,
                        scope_key=COMBINED_SCOPE,
                        required=True,
                        enrollment_ids=[str(e.id) for e, _ in pairs],
                        program_names=[p.name for _, p in pairs],
                        templates=options,
                    )
                )
            elif pairs:
                for enrollment, program in pairs:
                    result.append(
                        _Requirement(
                            member=user,
                            seat=seat,
                            scope_key=str(enrollment.id),
                            required=True,
                            enrollment_ids=[str(enrollment.id)],
                            program_names=[program.name],
                            templates=[
                                templates[str(program.shift_evaluation_template_id)]
                            ],
                        )
                    )
            elif general_id and general_mode != "off" and str(general_id) in templates:
                general = templates[str(general_id)]
                if seat and seat in (general.evaluated_seats or []):
                    result.append(
                        _Requirement(
                            member=user,
                            seat=seat,
                            scope_key=GENERAL_SCOPE,
                            required=general_mode == "required",
                            templates=[general],
                        )
                    )

        for requirement in result:
            requirement.evaluation = existing.pop(
                (str(requirement.member.id), requirement.scope_key), None
            )

        # An evaluation already on file that no rule calls for any more (the
        # member left the program, a seat was changed) stays listed, so it is
        # neither orphaned nor counted as required.
        if existing:
            orphan_members = {member_id for member_id, _ in existing}
            users = {
                str(u.id): u
                for u in (
                    await self.db.execute(
                        select(User).where(
                            User.id.in_(orphan_members), User.organization_id == org
                        )
                    )
                ).scalars()
            }
            for (member_id, scope_key), evaluation in existing.items():
                orphan = users.get(member_id)
                if orphan is None:
                    continue
                result.append(
                    _Requirement(
                        member=orphan,
                        seat=None,
                        scope_key=scope_key,
                        required=False,
                        enrollment_ids=list(evaluation.enrollment_ids or []),
                        program_names=list(evaluation.program_names or []),
                        evaluation=evaluation,
                    )
                )
        return result

    async def missing_required(
        self, shift_id: UUID | str, organization_id: UUID | str
    ) -> list[tuple[str, str]]:
        """Required evaluations not yet submitted, as ``(member_id, label)``."""
        shift = await self.get_shift(shift_id, organization_id)
        if shift is None:
            return []
        missing = []
        for requirement in await self.requirements(shift, organization_id):
            if not requirement.required:
                continue
            if requirement.evaluation and requirement.evaluation.status == "submitted":
                continue
            label = _name(requirement.member) or "A member"
            if requirement.program_names:
                label = f"{label} ({', '.join(requirement.program_names)})"
            missing.append((str(requirement.member.id), label))
        return missing

    # -- Responses ---------------------------------------------------------

    def _requirement_response(
        self, requirement: _Requirement, users: dict[str, User]
    ) -> ShiftEvaluationRequirement:
        evaluation = requirement.evaluation
        options = [TemplateOption(id=t.id, name=t.name) for t in requirement.templates]
        if evaluation is not None and not options:
            options = [
                TemplateOption(
                    id=str(evaluation.template_id or ""),
                    name=str((evaluation.template_snapshot or {}).get("name", "")),
                )
            ]
        return ShiftEvaluationRequirement(
            member_id=str(requirement.member.id),
            member_name=_name(requirement.member) or "A member",
            seat=requirement.seat,
            scope_key=requirement.scope_key,
            program_names=requirement.program_names,
            required=requirement.required,
            template_options=options,
            evaluation=(
                ShiftEvaluationSummary(
                    id=evaluation.id,
                    status=evaluation.status,
                    average_rating=evaluation.average_rating,
                    rated_count=evaluation.rated_count,
                    low_rating_count=evaluation.low_rating_count,
                    evaluator_name=_name(users.get(str(evaluation.evaluator_id))),
                    submitted_at=evaluation.submitted_at,
                    updated_at=evaluation.updated_at,
                )
                if evaluation is not None
                else None
            ),
        )

    async def _users(
        self, ids: set[str], organization_id: UUID | str
    ) -> dict[str, User]:
        ids = {i for i in ids if i}
        if not ids:
            return {}
        rows = await self.db.execute(
            select(User).where(
                User.id.in_(ids), User.organization_id == str(organization_id)
            )
        )
        return {str(u.id): u for u in rows.scalars()}

    async def roster(
        self, shift: Shift, organization_id: UUID | str
    ) -> ShiftEvaluationRoster:
        requirements = await self.requirements(shift, organization_id)
        users = await self._users(
            {
                str(r.evaluation.evaluator_id)
                for r in requirements
                if r.evaluation and r.evaluation.evaluator_id
            },
            organization_id,
        )
        return ShiftEvaluationRoster(
            shift_id=shift.id,
            shift_date=shift.shift_date,
            shift_start=shift.start_time,
            shift_end=shift.end_time,
            unit_label=await self._unit_label(shift, organization_id),
            platoon=shift.platoon,
            requirements=[self._requirement_response(r, users) for r in requirements],
        )

    async def detail(
        self, evaluation: ShiftEvaluation, organization_id: UUID | str
    ) -> ShiftEvaluationDetail:
        users = await self._users(
            {str(evaluation.member_id), str(evaluation.evaluator_id or "")},
            organization_id,
        )
        responses = {
            key: EvaluationItemResponse.model_validate(value)
            for key, value in (evaluation.responses or {}).items()
            if isinstance(value, dict)
        }
        return ShiftEvaluationDetail(
            id=evaluation.id,
            member_id=str(evaluation.member_id),
            member_name=_name(users.get(str(evaluation.member_id))),
            evaluator_id=(
                str(evaluation.evaluator_id) if evaluation.evaluator_id else None
            ),
            evaluator_name=_name(users.get(str(evaluation.evaluator_id))),
            shift_id=evaluation.shift_id,
            shift_date=evaluation.shift_date,
            shift_start=evaluation.shift_start,
            shift_end=evaluation.shift_end,
            unit_label=evaluation.unit_label,
            scope_key=evaluation.scope_key,
            program_names=list(evaluation.program_names or []),
            template_id=evaluation.template_id,
            template_version=evaluation.template_version,
            template=dict(evaluation.template_snapshot or {}),
            status=evaluation.status,
            header_values=dict(evaluation.header_values or {}),
            statistics=dict(evaluation.statistics or {}),
            responses=responses,
            closing_comments=evaluation.closing_comments,
            average_rating=evaluation.average_rating,
            rated_count=evaluation.rated_count,
            low_rating_count=evaluation.low_rating_count,
            submitted_at=evaluation.submitted_at,
            updated_at=evaluation.updated_at,
        )

    # -- The form ----------------------------------------------------------

    async def _find_requirement(
        self,
        shift: Shift,
        member_id: str,
        scope_key: str,
        organization_id: UUID | str,
    ) -> _Requirement:
        for requirement in await self.requirements(shift, organization_id):
            if (
                str(requirement.member.id) == str(member_id)
                and requirement.scope_key == scope_key
            ):
                return requirement
        raise LookupError("No evaluation is called for for this member on this shift")

    @staticmethod
    def _pick_template(
        requirement: _Requirement, template_id: Optional[str]
    ) -> Optional[ShiftEvaluationTemplate]:
        if template_id:
            for template in requirement.templates:
                if str(template.id) == str(template_id):
                    return template
            raise ValueError("That form is not one this evaluation can use")
        return requirement.templates[0] if requirement.templates else None

    async def _prefill_statistics(self, shift: Shift, member_id: str) -> dict[str, int]:
        # The same per-member call count the shift report pre-fills, from the
        # call log or the close-out tally. Transports and refusals are typed.
        from app.services.shift_completion_service import ShiftCompletionService

        calls, _types = await ShiftCompletionService(
            self.db
        )._get_trainee_call_data_from_shift(shift.id, str(member_id))
        return {"calls": int(calls or 0)}

    async def form(
        self,
        shift: Shift,
        member_id: str,
        scope_key: str,
        organization_id: UUID | str,
        template_id: Optional[str] = None,
    ) -> ShiftEvaluationForm:
        requirement = await self._find_requirement(
            shift, member_id, scope_key, organization_id
        )
        users = await self._users(
            (
                {str(requirement.evaluation.evaluator_id)}
                if requirement.evaluation and requirement.evaluation.evaluator_id
                else set()
            ),
            organization_id,
        )
        evaluation = requirement.evaluation
        if evaluation is not None and not template_id:
            snapshot = dict(evaluation.template_snapshot or {})
            chosen_id = evaluation.template_id
        else:
            template = self._pick_template(requirement, template_id)
            if template is None:
                raise LookupError("This evaluation's form no longer exists")
            snapshot = template_snapshot(template)
            chosen_id = template.id
        return ShiftEvaluationForm(
            requirement=self._requirement_response(requirement, users),
            shift_id=shift.id,
            shift_date=shift.shift_date,
            shift_start=shift.start_time,
            shift_end=shift.end_time,
            unit_label=await self._unit_label(shift, organization_id),
            platoon=shift.platoon,
            template=snapshot,
            template_id=chosen_id,
            evaluation=(
                await self.detail(evaluation, organization_id) if evaluation else None
            ),
            prefill_statistics=await self._prefill_statistics(shift, member_id),
        )

    # -- Saving ------------------------------------------------------------

    @staticmethod
    def _settle_answers(
        snapshot: dict[str, Any], body: ShiftEvaluationSave
    ) -> dict[str, Any]:
        """Check the body against the form and compute the summary figures.

        Keys the form does not have are dropped rather than stored, so the
        stored shape is always the form's (Pitfall #20). A draft may be
        incomplete; a submission may not.
        """
        scale_values = {int(level["value"]) for level in snapshot.get("scale") or []}
        allow_na = bool(snapshot.get("allow_not_applicable"))
        threshold = snapshot.get("comment_required_at_or_below")
        problems: list[str] = []

        header_values: dict[str, str] = {}
        for header in snapshot.get("header_fields") or []:
            raw = (body.header_values.get(header["key"]) or "").strip()
            if len(raw) > 200:
                raise ValueError(f"'{header['label']}' is limited to 200 characters")
            if (
                raw
                and header.get("type") == "choice"
                and raw not in (header.get("options") or [])
            ):
                raise ValueError(
                    f"'{raw}' is not one of the choices for '{header['label']}'"
                )
            if raw:
                header_values[header["key"]] = raw
            elif header.get("required"):
                problems.append(f"Answer '{header['label']}'.")

        statistics: dict[str, int] = {}
        for key in snapshot.get("statistics") or []:
            if key in body.statistics:
                statistics[key] = int(body.statistics[key])
            else:
                problems.append(f"Enter the number of {key}.")
        if "calls" in statistics:
            outcomes = statistics.get("transports", 0) + statistics.get("refusals", 0)
            if outcomes > statistics["calls"]:
                raise ValueError(
                    "Transports and refusals together cannot exceed the number of calls"
                )

        responses: dict[str, dict[str, Any]] = {}
        ratings: list[int] = []
        low = 0
        for section in snapshot.get("sections") or []:
            for item in section.get("items") or []:
                answer = body.responses.get(item["key"])
                if answer is None:
                    problems.append(f"Rate '{item['label']}'.")
                    continue
                if answer.rating is not None and answer.rating not in scale_values:
                    raise ValueError(f"'{answer.rating}' is not a rating on this form")
                if answer.not_applicable and not allow_na:
                    raise ValueError("This form does not allow N/A")
                if answer.rating is None and not answer.not_applicable:
                    problems.append(f"Rate '{item['label']}'.")
                needs_comment = bool(item.get("comment_always_required")) or (
                    answer.rating is not None
                    and threshold is not None
                    and answer.rating <= int(threshold)
                )
                if needs_comment and not answer.comment:
                    problems.append(f"Add a comment for '{item['label']}'.")
                if answer.rating is not None:
                    ratings.append(answer.rating)
                    if threshold is not None and answer.rating <= int(threshold):
                        low += 1
                responses[item["key"]] = {
                    "rating": answer.rating,
                    "not_applicable": answer.not_applicable,
                    "comment": answer.comment,
                }

        if body.submit and problems:
            raise ValueError("Finish the evaluation first: " + " ".join(problems[:5]))

        return {
            "header_values": header_values,
            "statistics": statistics,
            "responses": responses,
            "closing_comments": (
                body.closing_comments
                if snapshot.get("closing_comments_label")
                else None
            ),
            "average_rating": (
                round(sum(ratings) / len(ratings), 2) if ratings else None
            ),
            "rated_count": len(ratings),
            "low_rating_count": low,
        }

    async def save(
        self,
        shift: Shift,
        member_id: str,
        scope_key: str,
        organization_id: UUID | str,
        body: ShiftEvaluationSave,
        evaluator: User,
    ) -> ShiftEvaluation:
        """Create or update the evaluation; raises ValueError / LookupError."""
        if str(member_id) == str(evaluator.id):
            raise ValueError("You cannot evaluate yourself")
        requirement = await self._find_requirement(
            shift, member_id, scope_key, organization_id
        )
        evaluation = requirement.evaluation

        if evaluation is None or (
            body.template_id
            and str(body.template_id) != str(evaluation.template_id)
            and evaluation.status == "draft"
        ):
            template = self._pick_template(
                requirement, str(body.template_id) if body.template_id else None
            )
            if template is None:
                raise LookupError("This evaluation's form no longer exists")
            snapshot = template_snapshot(template)
            template_id: Optional[str] = template.id
            version = template.version
        else:
            snapshot = dict(evaluation.template_snapshot or {})
            template_id = evaluation.template_id
            version = evaluation.template_version

        answers = self._settle_answers(snapshot, body)
        unit_label = await self._unit_label(shift, organization_id)

        if evaluation is None:
            evaluation = ShiftEvaluation(
                organization_id=str(organization_id),
                shift_id=shift.id,
                member_id=str(member_id),
                scope_key=scope_key,
            )
            self.db.add(evaluation)

        evaluation.shift_date = shift.shift_date
        evaluation.shift_start = shift.start_time
        evaluation.shift_end = shift.end_time
        evaluation.unit_label = unit_label
        evaluation.evaluator_id = str(evaluator.id)
        evaluation.enrollment_ids = list(requirement.enrollment_ids)
        evaluation.program_names = list(requirement.program_names)
        evaluation.template_id = template_id
        evaluation.template_version = version
        evaluation.template_snapshot = snapshot
        for column, value in answers.items():
            setattr(evaluation, column, value)
        if body.submit:
            if evaluation.status != "submitted":
                evaluation.submitted_at = datetime.now(timezone.utc)
            evaluation.status = "submitted"
        elif evaluation.status != "submitted":
            evaluation.status = "draft"

        try:
            await self.db.commit()
        except IntegrityError:
            # Two officers opened the same evaluation and both created it: the
            # unique key kept one row; apply this save to it (Pitfall #36).
            await self.db.rollback()
            requirement = await self._find_requirement(
                shift, member_id, scope_key, organization_id
            )
            if requirement.evaluation is None:
                raise
            return await self.save(
                shift, member_id, scope_key, organization_id, body, evaluator
            )
        await self.db.refresh(evaluation)
        if evaluation.status == "submitted":
            await self.sync_credit(evaluation, organization_id)
            await self.db.refresh(evaluation)
        return evaluation

    # -- Program credit ------------------------------------------------------

    async def sync_credit(
        self, evaluation: ShiftEvaluation, organization_id: UUID | str
    ) -> None:
        """Bring the evaluation's program credit in line with what it says now.

        Called after the evaluation or the state that decides its visibility
        has been committed: the credit ledger's own conflict handling rolls the
        session back, which must not take an uncommitted change with it.
        """
        enrollment_ids = [str(e) for e in (evaluation.enrollment_ids or [])]
        if not enrollment_ids:
            return
        visible = await self.visible_to_member(evaluation, organization_id)
        rows = (
            await self.db.execute(
                select(RequirementProgress, TrainingRequirement, ProgramEnrollment)
                .join(
                    ProgramEnrollment,
                    ProgramEnrollment.id == RequirementProgress.enrollment_id,
                )
                .join(
                    TrainingRequirement,
                    TrainingRequirement.id == RequirementProgress.requirement_id,
                )
                .join(
                    ProgramRequirement,
                    (ProgramRequirement.requirement_id == TrainingRequirement.id)
                    & (ProgramRequirement.program_id == ProgramEnrollment.program_id),
                )
                .where(
                    RequirementProgress.enrollment_id.in_(enrollment_ids),
                    ProgramEnrollment.organization_id == str(organization_id),
                    ProgramEnrollment.user_id == evaluation.member_id,
                    TrainingRequirement.requirement_type.in_(_CREDITED_TYPES),
                )
            )
        ).all()
        if not rows:
            return
        credited = set(
            (
                await self.db.execute(
                    select(RequirementProgressCredit.progress_id).where(
                        RequirementProgressCredit.progress_id.in_(
                            [str(progress.id) for progress, _, _ in rows]
                        ),
                        RequirementProgressCredit.source_type
                        == ProgressCreditSource.SHIFT_EVALUATION,
                        RequirementProgressCredit.source_id == str(evaluation.id),
                    )
                )
            ).scalars()
        )
        # Plain values first: a ledger conflict rolls the session back and
        # expires every loaded row.
        plan = [
            (
                str(progress.id),
                credit_units(evaluation, requirement) if visible else 0.0,
                str(progress.id) in credited,
                enrollment.status == EnrollmentStatus.ACTIVE
                and progress.status not in _CLOSED_PROGRESS,
            )
            for progress, requirement, enrollment in rows
        ]
        evaluation_id = str(evaluation.id)
        evaluator_id = evaluation.evaluator_id
        program_service = TrainingProgramService(self.db)
        for progress_id, units, has_credit, open_for_credit in plan:
            if units > 0 and (has_credit or open_for_credit):
                _, error = await program_service.apply_requirement_credit(
                    progress_id=progress_id,
                    organization_id=organization_id,
                    source_type=ProgressCreditSource.SHIFT_EVALUATION,
                    source_id=evaluation_id,
                    units=units,
                    verified_by=evaluator_id,
                    applied_by=evaluator_id,
                    mark_in_progress=not has_credit,
                    restate=True,
                )
            elif units <= 0 and has_credit:
                _, error = await program_service.revoke_requirement_credit(
                    progress_id=progress_id,
                    organization_id=organization_id,
                    source_type=ProgressCreditSource.SHIFT_EVALUATION,
                    source_id=evaluation_id,
                    verified_by=evaluator_id,
                )
            else:
                continue
            if error:
                logger.error(
                    "Shift evaluation {} credit to progress {} failed: {}",
                    evaluation_id,
                    progress_id,
                    error,
                )

    async def sync_credit_for_shift_member(
        self,
        shift_id: Optional[str],
        member_id: str,
        organization_id: UUID | str,
    ) -> None:
        """Re-sync after the member's shift report changed review state."""
        if not shift_id:
            return
        evaluations = (
            await self.db.execute(
                select(ShiftEvaluation).where(
                    ShiftEvaluation.organization_id == str(organization_id),
                    ShiftEvaluation.shift_id == str(shift_id),
                    ShiftEvaluation.member_id == str(member_id),
                    ShiftEvaluation.status == "submitted",
                )
            )
        ).scalars()
        for evaluation_id in [e.id for e in evaluations]:
            evaluation = await self.get(evaluation_id, organization_id)
            if evaluation is not None:
                await self.sync_credit(evaluation, organization_id)

    async def sync_credit_for_organization(self, organization_id: UUID | str) -> None:
        """Re-sync every submitted evaluation, after report review is toggled."""
        evaluation_ids = list(
            (
                await self.db.execute(
                    select(ShiftEvaluation.id).where(
                        ShiftEvaluation.organization_id == str(organization_id),
                        ShiftEvaluation.status == "submitted",
                    )
                )
            ).scalars()
        )
        for evaluation_id in evaluation_ids:
            evaluation = await self.get(evaluation_id, organization_id)
            if evaluation is not None:
                await self.sync_credit(evaluation, organization_id)

    # -- Reading -----------------------------------------------------------

    async def get(
        self, evaluation_id: UUID | str, organization_id: UUID | str
    ) -> Optional[ShiftEvaluation]:
        result = await self.db.execute(
            select(ShiftEvaluation).where(
                ShiftEvaluation.id == str(evaluation_id),
                ShiftEvaluation.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def visible_to_member(
        self, evaluation: ShiftEvaluation, organization_id: UUID | str
    ) -> bool:
        """Whether the evaluated member may see it, on the shift report's terms."""
        if evaluation.status != "submitted":
            return False
        config = await self._config(organization_id)
        if not (config and config.report_review_required):
            return True
        if not evaluation.shift_id:
            return False
        status = (
            await self.db.execute(
                select(ShiftCompletionReport.review_status).where(
                    ShiftCompletionReport.shift_id == evaluation.shift_id,
                    ShiftCompletionReport.trainee_id == evaluation.member_id,
                    ShiftCompletionReport.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        return status == "approved"

    async def list_for_member(
        self,
        member_id: UUID | str,
        organization_id: UUID | str,
        *,
        start_date=None,
        end_date=None,
        member_view: bool = False,
    ) -> list[ShiftEvaluation]:
        query = select(ShiftEvaluation).where(
            ShiftEvaluation.organization_id == str(organization_id),
            ShiftEvaluation.member_id == str(member_id),
            ShiftEvaluation.status == "submitted",
        )
        if start_date is not None:
            query = query.where(ShiftEvaluation.shift_date >= start_date)
        if end_date is not None:
            query = query.where(ShiftEvaluation.shift_date <= end_date)
        query = query.order_by(ShiftEvaluation.shift_date.desc(), ShiftEvaluation.id)
        evaluations = list((await self.db.execute(query)).scalars())
        if member_view:
            evaluations = [
                e
                for e in evaluations
                if await self.visible_to_member(e, organization_id)
            ]
        return evaluations

    async def averages_by_form(
        self,
        member_id: UUID | str,
        organization_id: UUID | str,
        *,
        start_date=None,
        end_date=None,
        member_view: bool = False,
    ) -> list[dict[str, Any]]:
        """The member's average rating on each evaluation form.

        One figure per form and scale, never pooled: a 1-4 shift evaluation
        and a 1-5 report rating, or two forms on different scales, do not
        average into anything meaningful. Each evaluation weighs the same,
        however many items it rated; one with every item N/A has no rating
        and is left out.
        """
        evaluations = await self.list_for_member(
            member_id,
            organization_id,
            start_date=start_date,
            end_date=end_date,
            member_view=member_view,
        )
        groups: dict[tuple[str, int], dict[str, Any]] = {}
        # Newest first, so each group takes the form's latest name.
        for evaluation in evaluations:
            if evaluation.average_rating is None:
                continue
            snapshot = evaluation.template_snapshot or {}
            values = [
                int(level["value"])
                for level in snapshot.get("scale") or []
                if "value" in level
            ]
            if not values:
                continue
            scale_max = max(values)
            name = snapshot.get("name") or "Shift evaluation"
            key = (str(evaluation.template_id or name), scale_max)
            group = groups.setdefault(
                key,
                {
                    "template_id": evaluation.template_id,
                    "form_name": name,
                    "scale_max": scale_max,
                    "ratings": [],
                },
            )
            group["ratings"].append(float(evaluation.average_rating))
        averages = [
            {
                "template_id": group["template_id"],
                "form_name": group["form_name"],
                "scale_max": group["scale_max"],
                "average": round(sum(group["ratings"]) / len(group["ratings"]), 1),
                "evaluations": len(group["ratings"]),
            }
            for group in groups.values()
        ]
        return sorted(averages, key=lambda a: (a["form_name"].lower(), a["scale_max"]))
