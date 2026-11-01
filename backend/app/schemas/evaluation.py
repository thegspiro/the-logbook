"""
Schemas for member performance evaluations.

``TemplateDefinition`` and ``TemplateWorkflow`` are the canonical stored shape
of ``evaluation_template_versions.definition`` / ``.workflow`` (CLAUDE.md
pitfall #20): every write goes through them, and what is stored is their
``model_dump()``, never the raw request body.

Validation is split in two on purpose. The shape — types, keys, ranges,
references to things that exist — is checked on every save, so a draft can
never hold something a later reader cannot parse. Completeness — at least one
rated item, weights adding up to 100, a workflow that ends in an
acknowledgement — is checked only when a draft is published
(``definition_publish_errors`` / ``workflow_publish_errors``), so a department
can save a half-built form and come back to it.

Responses are snake_case, like the rest of the reports module.
"""

import re
from datetime import date, datetime
from enum import Enum
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.evaluation import EvaluationStepType, EvaluationTemplateKind
from app.services.evaluation_data_sources import DATA_SOURCES_BY_KEY
from app.utils.membership import MemberClass, MemberStatus

_KEY = re.compile(r"^[a-z][a-z0-9_]{0,49}$")
_KEY_HINT = (
    "must start with a lowercase letter and use only lowercase letters, digits "
    "and underscores (at most 50 characters)"
)

MAX_SECTIONS = 30
MAX_ITEMS_PER_SECTION = 40
MAX_STEPS = 12


def _check_key(value: str, what: str) -> str:
    if not _KEY.match(value):
        raise ValueError(f"{what} key '{value}' {_KEY_HINT}")
    return value


class EvaluationTool(str, Enum):
    """How an item is answered."""

    LABELED_SCALE = "labeled_scale"
    NUMERIC_SCALE = "numeric_scale"
    MEETS = "meets"
    CHECKLIST = "checklist"
    NARRATIVE = "narrative"
    GOALS = "goals"


#: Tools that produce a number, and so can be weighted and scored.
SCORED_TOOLS = frozenset(
    {EvaluationTool.LABELED_SCALE, EvaluationTool.NUMERIC_SCALE, EvaluationTool.MEETS}
)
_SCALE_TOOLS = frozenset({EvaluationTool.LABELED_SCALE, EvaluationTool.NUMERIC_SCALE})


class ScaleLevel(BaseModel):
    value: int = Field(ge=0, le=10)
    label: str = Field(min_length=1, max_length=60)
    # The behavior that earns this level. Required on a labeled scale at
    # publish, since an unanchored scale is what the anchors exist to replace.
    anchor: Optional[str] = Field(default=None, max_length=500)

    @field_validator("label")
    @classmethod
    def _strip_label(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A scale level needs a label")
        return v

    @field_validator("anchor")
    @classmethod
    def _blank_anchor(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v is not None else None


# The largest value a data source can report: hours and counts over a review
# period stay far below it, and a percentage below 100.
MAX_BAND_VALUE = 100_000


class ScoreBand(BaseModel):
    """``min`` inclusive, ``max`` exclusive; ``max`` None means "and above"."""

    min: float = Field(ge=0, le=MAX_BAND_VALUE)
    max: Optional[float] = Field(default=None, ge=0, le=MAX_BAND_VALUE)
    score: int = Field(ge=0, le=10)

    @model_validator(mode="after")
    def _ordered(self) -> "ScoreBand":
        if self.max is not None and self.max <= self.min:
            raise ValueError("A score band's upper bound must be above its lower bound")
        return self


class ScoringRule(BaseModel):
    bands: List[ScoreBand] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _contiguous(self) -> "ScoringRule":
        bands = sorted(self.bands, key=lambda b: b.min)
        for lower, upper in zip(bands, bands[1:]):
            if lower.max is None:
                raise ValueError("Only the highest score band may be open-ended")
            if upper.min < lower.max:
                raise ValueError("Score bands overlap")
        self.bands = bands
        return self


class DataBlock(BaseModel):
    source: str
    scoring_rule: Optional[ScoringRule] = None

    @model_validator(mode="after")
    def _known_source(self) -> "DataBlock":
        source = DATA_SOURCES_BY_KEY.get(self.source)
        if source is None:
            raise ValueError(f"Unknown data source '{self.source}'")
        if self.scoring_rule is not None and not source.scoreable:
            raise ValueError(f"'{source.label}' is a list and cannot be scored")
        return self


class TemplateItem(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=150)
    help_text: Optional[str] = Field(default=None, max_length=1000)
    tool: EvaluationTool
    levels: List[ScaleLevel] = Field(default_factory=list, max_length=11)
    allow_na: bool = False
    # Percentage of the weighted overall; 0 leaves a scored item out of it.
    weight: int = Field(default=0, ge=0, le=100)
    # Levels at which the evaluator must describe a specific instance.
    require_example_for: List[Annotated[int, Field(ge=0, le=10)]] = Field(
        default_factory=list, max_length=11
    )
    checklist_options: List[str] = Field(default_factory=list, max_length=30)
    comment: Literal["none", "optional", "required"] = "optional"
    # Whether the member answers this item in their self-evaluation.
    include_in_self_evaluation: bool = True
    data_block: Optional[DataBlock] = None

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _check_key(v, "Item")

    @field_validator("checklist_options")
    @classmethod
    def _options(cls, v: List[str]) -> List[str]:
        cleaned = [o.strip() for o in v]
        if any(not o or len(o) > 150 for o in cleaned):
            raise ValueError("Checklist options must be 1 to 150 characters")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("Checklist options must be distinct")
        return cleaned

    @model_validator(mode="after")
    def _consistent(self) -> "TemplateItem":
        values = [level.value for level in self.levels]
        if self.tool in _SCALE_TOOLS:
            if values and values != list(range(values[0], values[0] + len(values))):
                raise ValueError(
                    f"'{self.label}': scale levels must be consecutive whole numbers"
                )
        elif self.levels:
            raise ValueError(f"'{self.label}': only a scale has levels")
        if self.tool not in SCORED_TOOLS and self.weight:
            raise ValueError(f"'{self.label}': only a rated item can carry weight")
        if self.tool != EvaluationTool.CHECKLIST and self.checklist_options:
            raise ValueError(f"'{self.label}': only a checklist has options")
        if not set(self.require_example_for) <= set(values):
            raise ValueError(
                f"'{self.label}': examples can only be required at levels the "
                "scale has"
            )
        rule = self.data_block.scoring_rule if self.data_block else None
        if rule is not None:
            if self.tool not in _SCALE_TOOLS:
                raise ValueError(
                    f"'{self.label}': a scoring rule suggests a level, so it needs "
                    "a scale"
                )
            if values and any(b.score not in values for b in rule.bands):
                raise ValueError(
                    f"'{self.label}': every score band must name a level of the scale"
                )
        return self


class TemplateSection(BaseModel):
    key: str
    title: str = Field(min_length=1, max_length=150)
    description: Optional[str] = Field(default=None, max_length=1000)
    # Shown only to members holding one of the definition's officer ranks.
    officer_only: bool = False
    items: List[TemplateItem] = Field(
        default_factory=list, max_length=MAX_ITEMS_PER_SECTION
    )

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _check_key(v, "Section")


class TemplateDefinition(BaseModel):
    sections: List[TemplateSection] = Field(
        default_factory=list, max_length=MAX_SECTIONS
    )
    overall_mode: Literal["weighted", "evaluator", "none"] = "weighted"
    # Rank codes (``operational_ranks.rank_code``) that add officer-only
    # sections. Checked against the department's ranks by the service.
    officer_ranks: List[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _unique_keys(self) -> "TemplateDefinition":
        section_keys = [s.key for s in self.sections]
        if len(set(section_keys)) != len(section_keys):
            raise ValueError("Section keys must be unique")
        item_keys = [i.key for s in self.sections for i in s.items]
        if len(set(item_keys)) != len(item_keys):
            raise ValueError("Item keys must be unique across the template")
        self.officer_ranks = list(dict.fromkeys(self.officer_ranks))
        return self


def definition_publish_errors(definition: TemplateDefinition) -> List[str]:
    """What stops a saved draft from being published."""
    errors: List[str] = []
    items = [i for s in definition.sections for i in s.items]
    if not items:
        errors.append("Add at least one item.")
    for section in definition.sections:
        if not section.items:
            errors.append(f"Section '{section.title}' has no items.")
    for item in items:
        if item.tool in _SCALE_TOOLS and len(item.levels) < 2:
            errors.append(f"'{item.label}' needs at least two scale levels.")
        if item.tool == EvaluationTool.LABELED_SCALE and any(
            not level.anchor for level in item.levels
        ):
            errors.append(f"'{item.label}': describe the behavior for every level.")
        if item.tool == EvaluationTool.CHECKLIST and not item.checklist_options:
            errors.append(f"'{item.label}' has no checklist options.")
    if definition.overall_mode == "weighted":
        weights = [i.weight for i in items if i.tool in SCORED_TOOLS]
        if not any(weights):
            errors.append("A weighted overall needs at least one weighted item.")
        elif sum(weights) != 100:
            errors.append(f"Item weights add up to {sum(weights)}%, not 100%.")
    if any(s.officer_only for s in definition.sections) and not (
        definition.officer_ranks
    ):
        errors.append("Choose the ranks that receive the officer-only sections.")
    return errors


class StepActor(BaseModel):
    """Who acts on a step.

    ``member`` and ``evaluator`` are the evaluation's own people; ``position``
    is anyone holding that department position; ``view_all`` is anyone who may
    read every evaluation, which is who calibrates.
    """

    kind: Literal["member", "evaluator", "position", "view_all"]
    position_id: Optional[str] = Field(default=None, max_length=36)

    @model_validator(mode="after")
    def _position(self) -> "StepActor":
        if (self.kind == "position") != (self.position_id is not None):
            raise ValueError("A position is named exactly when the actor is a position")
        return self


# The actor each step type may have. Fixed rather than configurable where the
# step is about a particular person: only the member writes their
# self-evaluation, only the assigned evaluator evaluates.
_ALLOWED_ACTORS: dict[str, frozenset[str]] = {
    EvaluationStepType.SELF_EVALUATION.value: frozenset({"member"}),
    EvaluationStepType.EVALUATOR.value: frozenset({"evaluator"}),
    EvaluationStepType.CALIBRATION.value: frozenset({"view_all"}),
    EvaluationStepType.APPROVAL.value: frozenset({"position"}),
    EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value: frozenset({"member"}),
}
_ONCE_ONLY = frozenset(
    {
        EvaluationStepType.SELF_EVALUATION.value,
        EvaluationStepType.EVALUATOR.value,
        EvaluationStepType.CALIBRATION.value,
        EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value,
    }
)
# Steps run in this order of type; approvals may repeat in the middle.
_TYPE_ORDER = {
    EvaluationStepType.SELF_EVALUATION.value: 0,
    EvaluationStepType.EVALUATOR.value: 1,
    EvaluationStepType.CALIBRATION.value: 2,
    EvaluationStepType.APPROVAL.value: 3,
    EvaluationStepType.MEMBER_ACKNOWLEDGEMENT.value: 4,
}


class WorkflowStep(BaseModel):
    key: str
    type: EvaluationStepType
    label: str = Field(min_length=1, max_length=100)
    actor: StepActor
    # Days after the review period ends.
    due_days: int = Field(ge=0, le=365)

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _check_key(v, "Step")

    @model_validator(mode="after")
    def _actor_fits(self) -> "WorkflowStep":
        if self.actor.kind not in _ALLOWED_ACTORS[self.type.value]:
            raise ValueError(f"'{self.label}': that actor cannot act on this step")
        return self


class TemplateWorkflow(BaseModel):
    steps: List[WorkflowStep] = Field(default_factory=list, max_length=MAX_STEPS)
    reminder_days_before: int = Field(default=3, ge=0, le=30)
    # When the member misses the self-evaluation deadline, the evaluator may
    # go on without it, and the PDF records that it was not submitted.
    evaluator_may_proceed_without_self_evaluation: bool = True
    # Days after finalization in which the member may attach a written
    # response. Thirty follows Cal. Gov. Code 3256.
    response_window_days: int = Field(default=30, ge=0, le=365)

    @model_validator(mode="after")
    def _ordered(self) -> "TemplateWorkflow":
        keys = [s.key for s in self.steps]
        if len(set(keys)) != len(keys):
            raise ValueError("Step keys must be unique")
        types = [s.type.value for s in self.steps]
        for once in _ONCE_ONLY:
            if types.count(once) > 1:
                raise ValueError("A workflow has at most one step of each kind")
        ranks = [_TYPE_ORDER[t] for t in types]
        if ranks != sorted(ranks):
            raise ValueError(
                "Steps run in order: self-evaluation, evaluator, calibration, "
                "approvals, then the member's acknowledgement"
            )
        dues = [s.due_days for s in self.steps]
        if dues != sorted(dues):
            raise ValueError("A later step cannot be due before an earlier one")
        return self


def workflow_publish_errors(
    workflow: TemplateWorkflow, kind: EvaluationTemplateKind
) -> List[str]:
    errors: List[str] = []
    types = [s.type for s in workflow.steps]
    if EvaluationStepType.EVALUATOR not in types:
        errors.append("The workflow needs an evaluator step.")
    if kind == EvaluationTemplateKind.ANNUAL:
        if not types or types[-1] != EvaluationStepType.MEMBER_ACKNOWLEDGEMENT:
            errors.append(
                "An annual evaluation ends with the member's acknowledgement."
            )
    else:
        # An interim check-in carries no signatures (owner decision 2026-10-31).
        signed = {
            EvaluationStepType.APPROVAL,
            EvaluationStepType.MEMBER_ACKNOWLEDGEMENT,
            EvaluationStepType.CALIBRATION,
        }
        if any(t in signed for t in types):
            errors.append(
                "A check-in has only the self-evaluation and evaluator steps."
            )
    return errors


def default_definition() -> TemplateDefinition:
    return TemplateDefinition()


def default_workflow(kind: EvaluationTemplateKind) -> TemplateWorkflow:
    steps = [
        WorkflowStep(
            key="self_evaluation",
            type=EvaluationStepType.SELF_EVALUATION,
            label="Self-evaluation",
            actor=StepActor(kind="member"),
            due_days=14,
        ),
        WorkflowStep(
            key="evaluator",
            type=EvaluationStepType.EVALUATOR,
            label="Evaluator",
            actor=StepActor(kind="evaluator"),
            due_days=30,
        ),
    ]
    if kind == EvaluationTemplateKind.ANNUAL:
        steps.append(
            WorkflowStep(
                key="member_acknowledgement",
                type=EvaluationStepType.MEMBER_ACKNOWLEDGEMENT,
                label="Member acknowledgement",
                actor=StepActor(kind="member"),
                due_days=58,
            )
        )
    return TemplateWorkflow(steps=steps)


# ---------------------------------------------------------------- templates ---


class _Matching(BaseModel):
    member_class: Optional[str] = None
    member_status: Optional[str] = None

    @field_validator("member_class")
    @classmethod
    def _class(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip().lower() or None
        if v is not None and v not in MemberClass.ALL:
            raise ValueError(f"Unknown member class '{v}'")
        return v

    @field_validator("member_status")
    @classmethod
    def _status(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip().lower() or None
        allowed = {
            value
            for name, value in vars(MemberStatus).items()
            if name.isupper() and isinstance(value, str)
        }
        if v is not None and v not in allowed:
            raise ValueError(f"Unknown member status '{v}'")
        return v


class EvaluationTemplateCreate(_Matching):
    name: str = Field(min_length=1, max_length=150)
    description: Optional[str] = Field(default=None, max_length=2000)
    kind: EvaluationTemplateKind = EvaluationTemplateKind.ANNUAL

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A template needs a name")
        return v


class EvaluationTemplateUpdate(_Matching):
    """Partial update; an omitted field is left alone, an explicit null on
    ``description`` / ``member_class`` / ``member_status`` clears it."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("A template needs a name")
        return v


class TemplateDraftWrite(BaseModel):
    definition: TemplateDefinition
    workflow: TemplateWorkflow


class TemplateVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    version_number: int
    published_at: Optional[datetime] = None


class TemplateVersionResponse(TemplateVersionSummary):
    definition: TemplateDefinition
    workflow: TemplateWorkflow
    updated_at: Optional[datetime] = None


class EvaluationTemplateSummary(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    kind: EvaluationTemplateKind
    member_class: Optional[str] = None
    member_status: Optional[str] = None
    is_active: bool
    published_version: Optional[int] = None
    has_draft: bool
    evaluations_count: int
    updated_at: Optional[datetime] = None


class EvaluationTemplateDetail(EvaluationTemplateSummary):
    draft: Optional[TemplateVersionResponse] = None
    published: Optional[TemplateVersionResponse] = None
    versions: List[TemplateVersionSummary] = Field(default_factory=list)


class PublishResult(BaseModel):
    """``errors`` lists what stops publishing; empty when it succeeded."""

    published: bool
    errors: List[str] = Field(default_factory=list)
    template: Optional[EvaluationTemplateDetail] = None


class BuilderPosition(BaseModel):
    id: str
    name: str


class BuilderRank(BaseModel):
    rank_code: str
    display_name: str
    is_active: bool


class BuilderOptions(BaseModel):
    """The department's own names the builder offers in its pickers: who may
    approve, and which ranks receive officer sections."""

    positions: List[BuilderPosition]
    ranks: List[BuilderRank]


class DataSourceResponse(BaseModel):
    key: str
    label: str
    unit: str
    module: str
    description: str
    scoreable: bool


# ------------------------------------------------------------------ periods ---


class EvaluationPeriodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    start_date: date
    end_date: date

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A review period needs a name")
        return v

    @model_validator(mode="after")
    def _ordered(self) -> "EvaluationPeriodCreate":
        if self.end_date < self.start_date:
            raise ValueError("A review period cannot end before it starts")
        return self


class EvaluationPeriodUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_closed: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("A review period needs a name")
        return v


class EvaluationPeriodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    start_date: date
    end_date: date
    is_closed: bool
    evaluations_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# -------------------------------------------------------------- evaluations ---

#: The scale an evaluator picks an overall rating from when a template's
#: ``overall_mode`` is ``evaluator``. Fixed rather than per-template: the
#: overall rating is compared across members and years, which a scale each
#: template could redefine would defeat.
OVERALL_LEVELS: List[ScaleLevel] = [
    ScaleLevel(value=1, label="Unsatisfactory"),
    ScaleLevel(value=2, label="Needs improvement"),
    ScaleLevel(value=3, label="Meets expectations"),
    ScaleLevel(value=4, label="Exceeds expectations"),
    ScaleLevel(value=5, label="Outstanding"),
]

MAX_ANSWER_TEXT = 5000


def _blank_to_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


class ItemAnswer(BaseModel):
    """One item's answer in an evaluator's part or a self-evaluation.

    The canonical stored shape of an entry in ``evaluation_parts.content``
    (CLAUDE.md pitfall #20): ``rating`` is the scale level given (``1`` /
    ``0`` for meets / does not meet), ``text`` the answer to a narrative or
    goals item, ``comment`` the remark beside a rated one, ``example`` the
    specific instance a level requires, and ``justification`` the evaluator's
    reason for departing from the score the data suggested.
    """

    model_config = ConfigDict(extra="forbid")

    rating: Optional[int] = Field(default=None, ge=0, le=10)
    na: bool = False
    checked: List[str] = Field(default_factory=list, max_length=30)
    text: Optional[str] = Field(default=None, max_length=MAX_ANSWER_TEXT)
    comment: Optional[str] = Field(default=None, max_length=MAX_ANSWER_TEXT)
    example: Optional[str] = Field(default=None, max_length=MAX_ANSWER_TEXT)
    justification: Optional[str] = Field(default=None, max_length=MAX_ANSWER_TEXT)

    @field_validator("text", "comment", "example", "justification")
    @classmethod
    def _blank(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)

    @model_validator(mode="after")
    def _na_is_unanswered(self) -> "ItemAnswer":
        if self.na and self.rating is not None:
            raise ValueError("An item marked N/A cannot also be rated")
        return self


class PartContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: dict[str, ItemAnswer] = Field(
        default_factory=dict, max_length=MAX_SECTIONS * MAX_ITEMS_PER_SECTION
    )
    overall_rating: Optional[int] = Field(default=None, ge=1, le=5)
    overall_comment: Optional[str] = Field(default=None, max_length=MAX_ANSWER_TEXT)

    @field_validator("overall_comment")
    @classmethod
    def _blank(cls, v: Optional[str]) -> Optional[str]:
        return _blank_to_none(v)


class EvaluationCreate(BaseModel):
    member_id: str = Field(min_length=1, max_length=36)
    period_id: str = Field(min_length=1, max_length=36)
    # Omitted means the caller evaluates the member themselves.
    evaluator_id: Optional[str] = Field(default=None, max_length=36)
    kind: EvaluationTemplateKind = EvaluationTemplateKind.ANNUAL
    # Omitted means the most specific active template that fits the member.
    template_id: Optional[str] = Field(default=None, max_length=36)


class PartWrite(BaseModel):
    content: PartContent


class PersonRef(BaseModel):
    id: str
    name: str


class EvaluationStepResponse(BaseModel):
    key: str
    type: EvaluationStepType
    label: str
    order: int
    status: str
    due_date: Optional[date] = None
    completed_at: Optional[datetime] = None


class EvaluationPartResponse(BaseModel):
    kind: str
    status: str
    content: PartContent
    submitted_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExcludedRangeResponse(BaseModel):
    start: date
    end: date
    reason: Literal["leave", "separation"]


class EvaluationSummary(BaseModel):
    id: str
    member: PersonRef
    evaluator: Optional[PersonRef] = None
    period_id: Optional[str] = None
    period_name: Optional[str] = None
    period_start: date
    period_end: date
    template_name: str
    kind: EvaluationTemplateKind
    status: str
    # The step waiting on someone, and when it is due.
    current_step: Optional[str] = None
    current_step_due: Optional[date] = None
    created_at: Optional[datetime] = None


class EvaluationViewer(BaseModel):
    """What the caller may do with this evaluation, decided by the server so
    the screens do not re-derive it (CLAUDE.md pitfall #29)."""

    is_member: bool
    is_evaluator: bool
    can_edit_self_evaluation: bool
    can_edit_evaluation: bool
    can_refresh_data: bool
    can_calibrate: bool


class EvaluationDetail(EvaluationSummary):
    coverage_start: Optional[date] = None
    coverage_end: Optional[date] = None
    excluded_ranges: List[ExcludedRangeResponse] = Field(default_factory=list)
    includes_officer_sections: bool
    # The form, with officer-only sections removed when they do not apply.
    definition: TemplateDefinition
    overall_levels: List[ScaleLevel]
    steps: List[EvaluationStepResponse]
    # Each source's entry as stored ({"available", "value", ...}); None when
    # the caller may not see the figures yet.
    data: Optional[dict] = None
    suggested_scores: dict[str, int] = Field(default_factory=dict)
    data_taken_at: Optional[datetime] = None
    parts: List[EvaluationPartResponse]
    # The evaluator's weighted overall, as a percentage of each item's scale,
    # when the template calculates one and the caller may read the part.
    weighted_overall: Optional[float] = None
    viewer: EvaluationViewer


class SubmitResult(BaseModel):
    outcome: Literal["submitted", "sent_for_calibration", "finalized"]
    evaluation: EvaluationDetail


class LiveDataResponse(BaseModel):
    """A member's figures for the current review period, computed now."""

    period_id: Optional[str] = None
    period_name: Optional[str] = None
    coverage_start: Optional[date] = None
    coverage_end: Optional[date] = None
    excluded_ranges: List[ExcludedRangeResponse] = Field(default_factory=list)
    sources: List[DataSourceResponse]
    data: dict
    note: Optional[str] = None
