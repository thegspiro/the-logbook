"""
Starting points for a department's first member evaluation templates.

A chief opening evaluations for the first time otherwise faces an empty
builder: sections, items, behavior anchors for every level, weights that add
to 100 and a workflow, all before the first evaluation can be drafted. A
starter fills a new template's first draft with generic fire-service content
that publishes as it stands, so the department edits wording rather than
starting from nothing.

Nothing here is seeded. A starter is read only when a template is created
from it, and what is stored is then the department's own draft — changing a
starter later never touches a template built from one.

The score bands on the figure-backed items are placeholders a department is
expected to change: what counts as enough training hours or shifts differs
too much between departments for any default to be right.

Officer-only sections are left out on purpose. Publishing one requires the
department's own rank codes, which a starter cannot know, so a starter that
included one would not publish without edits.
"""

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from app.models.evaluation import EvaluationTemplateKind
from app.schemas.evaluation import (
    TemplateDefinition,
    TemplateWorkflow,
    default_workflow,
)
from app.utils.membership import MemberStatus

_FIVE_LABELS = (
    "Unsatisfactory",
    "Needs improvement",
    "Meets expectations",
    "Exceeds expectations",
    "Outstanding",
)
_THREE_LABELS = ("Below expectations", "On track", "Ahead of expectations")

Band = Tuple[float, Optional[float], int]


def _levels(labels: Sequence[str], anchors: Sequence[str]) -> List[dict]:
    return [
        {"value": value, "label": label, "anchor": anchor}
        for value, (label, anchor) in enumerate(zip(labels, anchors), start=1)
    ]


def _rated(
    key: str,
    label: str,
    help_text: str,
    anchors: Sequence[str],
    *,
    weight: int = 0,
    labels: Sequence[str] = _FIVE_LABELS,
    example_for: Sequence[int] = (),
    source: Optional[str] = None,
    bands: Sequence[Band] = (),
) -> dict:
    item: dict = {
        "key": key,
        "label": label,
        "help_text": help_text,
        "tool": "labeled_scale",
        "levels": _levels(labels, anchors),
        "weight": weight,
        "require_example_for": list(example_for),
        "comment": "optional",
    }
    if source is not None:
        rule = (
            {"bands": [{"min": lo, "max": hi, "score": s} for lo, hi, s in bands]}
            if bands
            else None
        )
        item["data_block"] = {"source": source, "scoring_rule": rule}
    return item


def _written(
    key: str,
    label: str,
    help_text: str,
    *,
    tool: str = "narrative",
    source: Optional[str] = None,
) -> dict:
    item: dict = {
        "key": key,
        "label": label,
        "help_text": help_text,
        "tool": tool,
        "comment": "none",
    }
    if source is not None:
        item["data_block"] = {"source": source, "scoring_rule": None}
    return item


def _annual_definition() -> TemplateDefinition:
    return TemplateDefinition.model_validate(
        {
            "overall_mode": "weighted",
            "officer_ranks": [],
            "sections": [
                {
                    "key": "training_readiness",
                    "title": "Training and readiness",
                    "description": (
                        "Whether the member keeps their skills and "
                        "qualifications current."
                    ),
                    "items": [
                        _rated(
                            "training_participation",
                            "Training participation",
                            "Hours of training completed over the review period.",
                            (
                                "Rarely takes part in training and falls well "
                                "short of the department's expectation.",
                                "Takes part in some training but falls short of "
                                "the department's expectation.",
                                "Completes the training the department expects.",
                                "Completes more training than expected and seeks "
                                "out opportunities to learn.",
                                "Far exceeds the expectation and helps others "
                                "train.",
                            ),
                            weight=15,
                            source="training.hours",
                            bands=(
                                (0, 12, 1),
                                (12, 24, 2),
                                (24, 36, 3),
                                (36, 48, 4),
                                (48, None, 5),
                            ),
                        ),
                        _rated(
                            "training_requirements",
                            "Required training",
                            "Share of the member's required training that is met.",
                            (
                                "Most required training is not met.",
                                "Several required trainings are not met.",
                                "Nearly all required training is met.",
                                "All required training is met, on time.",
                                "All required training is met well ahead of "
                                "deadlines.",
                            ),
                            weight=15,
                            source="training.requirements_met_pct",
                            bands=(
                                (0, 70, 1),
                                (70, 85, 2),
                                (85, 95, 3),
                                (95, 100, 4),
                                (100, None, 5),
                            ),
                        ),
                        _written(
                            "certifications",
                            "Certifications and qualifications",
                            "Note any certification to earn or renew next year.",
                            source="certifications.current",
                        ),
                    ],
                },
                {
                    "key": "operational_performance",
                    "title": "Operational performance",
                    "description": "How the member performs on calls and on duty.",
                    "items": [
                        _rated(
                            "scene_performance",
                            "Emergency scene performance",
                            "Skill, judgement and effectiveness on calls.",
                            (
                                "Frequently needs correction on basic tasks "
                                "and cannot be relied on to work unsupervised.",
                                "Performs basic tasks but often needs direction.",
                                "Performs assigned tasks competently and with "
                                "little direction.",
                                "Performs beyond the assigned role and "
                                "anticipates what the scene needs.",
                                "Consistently excellent; others look to them "
                                "on the fireground or at the patient.",
                            ),
                            weight=20,
                            example_for=(1, 5),
                        ),
                        _rated(
                            "safety",
                            "Safety and accountability",
                            "Use of PPE, accountability, and safe practice.",
                            (
                                "Has been unsafe, or disregards safety " "practice.",
                                "Needs reminders about PPE or accountability.",
                                "Follows safety practice and accountability "
                                "without reminders.",
                                "Watches out for the safety of others as well "
                                "as their own.",
                                "Models safe practice and corrects unsafe acts "
                                "in others.",
                            ),
                            weight=15,
                            example_for=(1, 2),
                        ),
                        _rated(
                            "duty_participation",
                            "Duty and shift participation",
                            "Availability for shifts and duty crews.",
                            (
                                "Rarely available for duty.",
                                "Available less often than the department " "needs.",
                                "Meets the department's duty expectation.",
                                "Regularly covers more than expected.",
                                "Among the most reliable members for duty " "coverage.",
                            ),
                            weight=10,
                            source="shifts.hours",
                        ),
                    ],
                },
                {
                    "key": "professionalism",
                    "title": "Professionalism and teamwork",
                    "items": [
                        _rated(
                            "teamwork",
                            "Teamwork and communication",
                            "Working with the crew, officers and the public.",
                            (
                                "Causes friction or communicates poorly.",
                                "Sometimes struggles to work with others or "
                                "share information.",
                                "Works well with others and communicates " "clearly.",
                                "Strengthens the crew and keeps others " "informed.",
                                "Brings the crew together and is sought out for "
                                "help.",
                            ),
                            weight=10,
                        ),
                        _rated(
                            "conduct",
                            "Professional conduct",
                            "Reliability, attitude, and how the member "
                            "represents the department.",
                            (
                                "Conduct has reflected poorly on the " "department.",
                                "Occasional lapses in reliability or attitude.",
                                "Reliable, respectful and follows department "
                                "policy.",
                                "A positive example to others.",
                                "Exemplary; an ambassador for the department.",
                            ),
                            weight=10,
                            example_for=(1,),
                        ),
                        _rated(
                            "meeting_attendance",
                            "Meeting attendance",
                            "Business meetings attended over the period.",
                            (
                                "Rarely attends meetings.",
                                "Attends some meetings.",
                                "Attends most meetings.",
                                "Attends nearly every meeting.",
                                "Attends every meeting and takes part.",
                            ),
                            weight=5,
                            source="events.meeting_attendance_pct",
                            bands=(
                                (0, 25, 1),
                                (25, 50, 2),
                                (50, 75, 3),
                                (75, 90, 4),
                                (90, None, 5),
                            ),
                        ),
                    ],
                },
                {
                    "key": "development",
                    "title": "Development",
                    "items": [
                        _written(
                            "strengths",
                            "Strengths",
                            "What the member does especially well.",
                        ),
                        _written(
                            "development_areas",
                            "Areas for development",
                            "Where the member should focus to grow.",
                        ),
                        _written(
                            "goals",
                            "Goals for the coming year",
                            "Specific goals, agreed with the member.",
                            tool="goals",
                        ),
                    ],
                },
            ],
        }
    )


def _check_in_definition() -> TemplateDefinition:
    return TemplateDefinition.model_validate(
        {
            "overall_mode": "none",
            "officer_ranks": [],
            "sections": [
                {
                    "key": "progress",
                    "title": "Progress",
                    "description": (
                        "Where the probationary member stands against what is "
                        "expected at this point."
                    ),
                    "items": [
                        _rated(
                            "training_progress",
                            "Training progress",
                            "Required training completed so far.",
                            (
                                "Behind on required training for this stage.",
                                "Keeping pace with required training.",
                                "Ahead of the expected training schedule.",
                            ),
                            labels=_THREE_LABELS,
                            source="training.requirements_met_pct",
                        ),
                        _rated(
                            "skills_progress",
                            "Skills",
                            "Practical skills signed off so far.",
                            (
                                "Struggling with skills expected by now.",
                                "Demonstrating the skills expected by now.",
                                "Demonstrating skills beyond this stage.",
                            ),
                            labels=_THREE_LABELS,
                            source="skills.tests_passed",
                        ),
                        _rated(
                            "participation",
                            "Participation",
                            "Shifts, drills and meetings attended.",
                            (
                                "Participating less than expected.",
                                "Participating as expected.",
                                "Participating more than expected.",
                            ),
                            labels=_THREE_LABELS,
                            source="shifts.count",
                        ),
                        _rated(
                            "attitude",
                            "Attitude and fit",
                            "Willingness to learn and fit with the crew.",
                            (
                                "Concerns about attitude or fit with the crew.",
                                "Eager to learn and fitting in well.",
                                "A standout attitude; already a strong part of "
                                "the crew.",
                            ),
                            labels=_THREE_LABELS,
                            example_for=(1,),
                        ),
                    ],
                },
                {
                    "key": "next_steps",
                    "title": "Next steps",
                    "items": [
                        _written(
                            "going_well",
                            "What is going well",
                            "Progress worth recognizing.",
                        ),
                        _written(
                            "before_next_check_in",
                            "Before the next check-in",
                            "What the member should work on, and who will help.",
                            tool="goals",
                        ),
                    ],
                },
            ],
        }
    )


@dataclass(frozen=True)
class EvaluationStarter:
    key: str
    name: str
    description: str
    kind: EvaluationTemplateKind
    member_class: Optional[str]
    member_status: Optional[str]
    definition: Callable[[], TemplateDefinition]

    def workflow(self) -> TemplateWorkflow:
        return default_workflow(self.kind)


STARTERS: Tuple[EvaluationStarter, ...] = (
    EvaluationStarter(
        key="annual_member",
        name="Annual Member Evaluation",
        description=(
            "A yearly evaluation of training, operational performance and "
            "professionalism, with goals for the coming year. Training hours, "
            "required training and meeting attendance suggest a rating from "
            "the member's figures."
        ),
        kind=EvaluationTemplateKind.ANNUAL,
        member_class=None,
        member_status=None,
        definition=_annual_definition,
    ),
    EvaluationStarter(
        key="probationary_check_in",
        name="Probationary Check-in",
        description=(
            "A short, unsigned check-in on a probationary member's training, "
            "skills, participation and attitude, with what to work on before "
            "the next one."
        ),
        kind=EvaluationTemplateKind.INTERIM,
        member_class=None,
        member_status=MemberStatus.PROBATIONARY,
        definition=_check_in_definition,
    ),
)

STARTERS_BY_KEY: Dict[str, EvaluationStarter] = {s.key: s for s in STARTERS}
