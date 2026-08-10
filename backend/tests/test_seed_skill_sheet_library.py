"""The seeded skill sheets must be sheets you can actually run a test against.

Seed data is normally trusted rather than tested, and that is how the
skills-testing demo dataset shipped with every criterion typed ``"checkbox"``.
The API accepted it (the field was a bare string), the templates table listed
them, the picker offered them — and every evaluation run against them scored 0%
and failed, because the examiner screen renders no control for an unknown type
and ``require_all_critical`` counts an unmarked critical step as a failure.

Nothing in the stack was positioned to notice: the schema did not constrain the
value, and no test ever carried a blueprint all the way through to a score. So
these do exactly that — validate every sheet against the real create-template
schema, then score it with the real scorer.
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

# The seeders live outside the backend package, beside the other operational
# scripts, because the screenshot harness and the general seeder share them.
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

pytest.importorskip(
    "skill_sheet_library",
    reason="scripts/ not present in this checkout",
)

from seed_skills_testing import (  # noqa: E402  (path set up above)
    build_section_results,
    first_critical,
)
from skill_sheet_library import (  # noqa: E402
    SKILL_SHEETS,
    build_template_payload,
    criterion_result,
    iter_criteria,
)

from app.schemas.skills_testing import (  # noqa: E402
    CRITERION_TYPES,
    SkillTemplateCreate,
)
from app.services.skills_testing_service import (  # noqa: E402
    build_score_breakdown,
    calculate_test_result,
)

SHEET_IDS = [sheet["name"] for sheet in SKILL_SHEETS]


def _template(sheet):
    """A stand-in exposing the attributes the scorer reads off a template."""
    return SimpleNamespace(
        sections=sheet["sections"],
        passing_percentage=sheet.get("passing_percentage"),
        require_all_critical=sheet.get("require_all_critical", True),
        score_pass_fail_criteria=sheet.get("score_pass_fail_criteria", False),
    )


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_sheet_is_accepted_by_the_create_template_schema(sheet):
    """The seeder posts these verbatim, so the schema is the real gate."""
    template = SkillTemplateCreate(**build_template_payload(sheet))
    assert template.sections, "a template with no sections cannot be published"
    for section in template.sections:
        assert section.criteria, f"section {section.name!r} has no criteria"


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_every_criterion_type_is_renderable(sheet):
    for _si, _ci, section, criterion in iter_criteria(sheet):
        assert criterion["type"] in CRITERION_TYPES, (
            f"{sheet['name']} / {section['name']} / {criterion['label']} "
            f"uses {criterion['type']!r}, which the examiner screen cannot "
            "render — the step would be unscorable"
        )


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_a_cleanly_scored_sheet_passes(sheet):
    """The regression that matters: a clean run must not score 0% and fail."""
    test = SimpleNamespace(section_results=build_section_results(sheet))
    score, outcome = calculate_test_result(test, _template(sheet))

    assert outcome == "pass"
    assert score is not None, "a fully scored sheet must produce a percentage"
    assert score > 0


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_failing_a_critical_step_fails_the_test(sheet):
    """Every sheet has a critical step, and failing it decides the outcome."""
    position = first_critical(sheet)
    assert position is not None, (
        f"{sheet['name']} declares no critical step — a sheet where nothing "
        "can fail the candidate is not an evaluation"
    )

    test = SimpleNamespace(
        section_results=build_section_results(sheet, fail_at=position)
    )
    _score, outcome = calculate_test_result(test, _template(sheet))
    assert outcome == "fail"


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_no_criterion_is_left_unscored_by_a_full_run(sheet):
    """A full run must leave nothing blank on the scorecard.

    ``not_scored`` is the state the old data was permanently stuck in, and it
    is indistinguishable on the breakdown from an examiner who skipped a step.
    """
    test = SimpleNamespace(section_results=build_section_results(sheet))
    breakdown = build_score_breakdown(test, _template(sheet))

    assert not breakdown["critical_failures"]
    for section in breakdown["sections"]:
        assert section["not_scored"] == 0, (
            f"{sheet['name']} / {section['section_name']} left "
            f"{section['not_scored']} step(s) unscored after a full run"
        )


@pytest.mark.parametrize("sheet", SKILL_SHEETS, ids=SHEET_IDS)
def test_results_carry_the_evidence_field_for_their_type(sheet):
    """Each type's scorecard row renders its own evidence, not a bare score."""
    evidence = {
        "score": "score",
        "time_limit": "time_seconds",
        "checklist": "checklist_completed",
    }
    for _si, _ci, _section, criterion in iter_criteria(sheet):
        field = evidence.get(criterion["type"])
        if not field:
            continue
        assert field in criterion_result(criterion, True)


def test_the_library_exercises_every_criterion_type():
    """Otherwise a whole rendering path has no seeded example to look at."""
    seen = {c["type"] for sheet in SKILL_SHEETS for *_, c in iter_criteria(sheet)}
    assert seen == set(CRITERION_TYPES)


def test_sheet_names_are_unique():
    """The seeders are idempotent by name; duplicates would never re-create."""
    assert len(SHEET_IDS) == len(set(SHEET_IDS))
