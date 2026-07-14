"""
Tests for the built-in sample program templates catalog
(app/services/sample_program_templates.py).

These are the curated firefighter / EMT recruit-school and new-member
orientation templates a training officer can add with one click. The catalog is
pure data validated at import; these tests guard its integrity and the
no-mutation contract the instantiate endpoint relies on.
"""

from app.models.training import (
    ProgramStructureType,
    RequirementFrequency,
    RequirementType,
)
from app.services.sample_program_templates import (
    SAMPLE_TEMPLATES,
    list_sample_template_summaries,
)

VALID_TYPES = {t.value for t in RequirementType}
VALID_FREQ = {f.value for f in RequirementFrequency}
VALID_STRUCTURE = {s.value for s in ProgramStructureType}


class TestCatalogIntegrity:
    def test_expected_templates_present(self):
        assert set(SAMPLE_TEMPLATES) == {
            "firefighter-recruit-school",
            "emt-recruit-school",
            "new-member-orientation",
        }

    def test_all_flagged_as_templates(self):
        for build in SAMPLE_TEMPLATES.values():
            assert build.program.is_template is True

    def test_structure_types_valid(self):
        for build in SAMPLE_TEMPLATES.values():
            assert build.program.structure_type in VALID_STRUCTURE

    def test_phase_numbers_are_unique_and_sequential(self):
        # program_phases has a unique (program_id, phase_number) constraint.
        for build in SAMPLE_TEMPLATES.values():
            numbers = [p.phase_number for p in build.phases]
            assert numbers == list(range(1, len(numbers) + 1))

    def test_requirement_types_and_frequencies_valid(self):
        for build in SAMPLE_TEMPLATES.values():
            for phase in build.phases:
                assert phase.requirements, f"{phase.name} has no requirements"
                for req in phase.requirements:
                    assert req.requirement_type in VALID_TYPES
                    assert req.frequency in VALID_FREQ

    def test_knowledge_tests_have_passing_score_and_attempts(self):
        for build in SAMPLE_TEMPLATES.values():
            for phase in build.phases:
                for req in phase.requirements:
                    if req.requirement_type == "knowledge_test":
                        assert req.passing_score is not None
                        assert req.max_attempts is not None

    def test_hours_requirements_have_hours(self):
        for build in SAMPLE_TEMPLATES.values():
            for phase in build.phases:
                for req in phase.requirements:
                    if req.requirement_type == "hours":
                        assert req.required_hours and req.required_hours > 0

    def test_orientation_has_annual_compliance_items(self):
        orientation = SAMPLE_TEMPLATES["new-member-orientation"]
        names = {
            req.name
            for phase in orientation.phases
            for req in phase.requirements
        }
        assert any("HIPAA" in n for n in names)
        assert any("Bloodborne" in n for n in names)
        annual = [
            req
            for phase in orientation.phases
            for req in phase.requirements
            if req.frequency == "annual"
        ]
        assert len(annual) >= 2


class TestSummaries:
    def test_summary_counts_match_catalog(self):
        summaries = {s["key"]: s for s in list_sample_template_summaries()}
        assert set(summaries) == set(SAMPLE_TEMPLATES)
        for key, build in SAMPLE_TEMPLATES.items():
            s = summaries[key]
            assert s["phase_count"] == len(build.phases)
            assert s["requirement_count"] == sum(
                len(p.requirements) for p in build.phases
            )
            assert s["name"] == build.program.name


class TestNoMutationContract:
    def test_deep_copy_override_does_not_touch_catalog(self):
        # The instantiate endpoint deep-copies then overrides name/is_template;
        # the shared catalog instance must stay pristine for the next caller.
        build = SAMPLE_TEMPLATES["firefighter-recruit-school"]
        original_name = build.program.name

        payload = build.model_copy(deep=True)
        payload.program.name = "My Department's Academy"
        payload.program.is_template = False

        assert build.program.name == original_name
        assert build.program.is_template is True
