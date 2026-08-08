"""
Tests for freezing a skill test's template structure at creation.

Criterion identity in a scorecard is positional (``criterion-{section}-{index}``)
and ``PUT /templates/{id}`` rewrites ``skill_templates.sections`` in place, so
without a snapshot an edit to a published template retroactively rewrites
finished scorecards. These pin down that a test is always read and scored
against the structure it was actually taken under.

Pure functions and SimpleNamespace stand-ins; no database.
"""

import copy
from types import SimpleNamespace

from app.services.skills_testing_service import (
    build_template_snapshot,
    calculate_test_result,
    resolve_test_template,
)


def _template(sections=None, **overrides):
    sections = overrides.pop("sections", sections)
    return SimpleNamespace(
        name=overrides.get("name", "SCBA Evaluation"),
        version=overrides.get("version", 1),
        sections=sections,
        passing_percentage=overrides.get("passing_percentage"),
        require_all_critical=overrides.get("require_all_critical", False),
        time_limit_seconds=overrides.get("time_limit_seconds"),
    )


def _sections(*labels):
    return [
        {
            "name": "Section A",
            "criteria": [
                {"label": label, "type": "pass_fail", "required": True}
                for label in labels
            ],
        }
    ]


class TestBuildTemplateSnapshot:
    def test_captures_structure_and_scoring_rules(self):
        template = _template(
            _sections("Don mask"),
            version=3,
            passing_percentage=80.0,
            require_all_critical=True,
            time_limit_seconds=120,
        )

        snapshot = build_template_snapshot(template)

        assert snapshot["version"] == 3
        assert snapshot["passing_percentage"] == 80.0
        assert snapshot["require_all_critical"] is True
        assert snapshot["time_limit_seconds"] == 120
        assert snapshot["sections"][0]["criteria"][0]["label"] == "Don mask"

    def test_snapshot_does_not_alias_the_live_template(self):
        """The whole point: a later edit to the template must not reach in and
        change the frozen copy (Pitfall #12 — JSON columns share references)."""
        template = _template(_sections("Don mask"))
        snapshot = build_template_snapshot(template)

        # Simulate an in-place edit of the published template.
        template.sections[0]["criteria"].insert(
            0, {"label": "New first step", "type": "pass_fail", "required": True}
        )
        template.sections[0]["name"] = "Renamed section"

        assert len(snapshot["sections"][0]["criteria"]) == 1
        assert snapshot["sections"][0]["criteria"][0]["label"] == "Don mask"
        assert snapshot["sections"][0]["name"] == "Section A"

    def test_handles_a_template_with_no_sections(self):
        assert build_template_snapshot(_template(None))["sections"] == []


class TestResolveTestTemplate:
    def test_prefers_the_snapshot_over_the_live_template(self):
        live = _template(_sections("Edited criterion"), passing_percentage=90.0)
        test = SimpleNamespace(
            template_snapshot={
                "sections": _sections("Original criterion"),
                "passing_percentage": 70.0,
                "require_all_critical": True,
                "time_limit_seconds": 60,
            }
        )

        resolved = resolve_test_template(test, live)

        assert resolved.sections[0]["criteria"][0]["label"] == "Original criterion"
        assert resolved.passing_percentage == 70.0
        assert resolved.time_limit_seconds == 60

    def test_falls_back_to_the_live_template_when_unsnapshotted(self):
        """Rows created before the column existed, and any the backfill missed."""
        live = _template(_sections("Don mask"))
        test = SimpleNamespace(template_snapshot=None)

        assert resolve_test_template(test, live) is live

    def test_display_name_still_comes_from_the_live_template(self):
        """A renamed template is the same template — the snapshot freezes
        structure and scoring rules, not identity."""
        live = _template(_sections("Don mask"), name="SCBA Evaluation (2026)")
        test = SimpleNamespace(template_snapshot={"sections": _sections("Don mask")})

        assert resolve_test_template(test, live).name == "SCBA Evaluation (2026)"

    def test_survives_the_template_being_deleted(self):
        test = SimpleNamespace(template_snapshot={"sections": _sections("Don mask")})

        resolved = resolve_test_template(test, None)

        assert resolved.sections[0]["criteria"][0]["label"] == "Don mask"
        assert resolved.name is None


class TestScoringAgainstTheSnapshot:
    """The failure this all exists to prevent, end to end through the scorer."""

    def test_inserting_a_criterion_does_not_shift_recorded_results(self):
        original = [
            {
                "name": "Section A",
                "criteria": [
                    {
                        "label": "Don mask",
                        "type": "score",
                        "max_score": 10,
                        "required": False,
                    }
                ],
            }
        ]
        # The examiner scored 10/10 on the only criterion there was.
        test = SimpleNamespace(
            section_results=[
                {
                    "section_id": "section-0",
                    "section_name": "Section A",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "score": 10, "passed": True}
                    ],
                }
            ],
            template_snapshot={
                "sections": copy.deepcopy(original),
                "passing_percentage": 60.0,
                "require_all_critical": False,
                "time_limit_seconds": None,
            },
        )

        # An officer later inserts a step at the front of the published template.
        live = _template(
            passing_percentage=60.0,
            sections=[
                {
                    "name": "Section A",
                    "criteria": [
                        {
                            "label": "Check cylinder pressure",
                            "type": "score",
                            "max_score": 10,
                            "required": False,
                        },
                        {
                            "label": "Don mask",
                            "type": "score",
                            "max_score": 10,
                            "required": False,
                        },
                    ],
                }
            ],
        )

        # Against the live template the recorded criterion-0-0 would now bind to
        # "Check cylinder pressure" and the total available would double: 10/20.
        assert calculate_test_result(test, live) == (50.0, "fail")

        # Against the snapshot the result is what was actually earned.
        assert calculate_test_result(test, resolve_test_template(test, live)) == (
            100.0,
            "pass",
        )

    def test_passing_threshold_is_frozen_too(self):
        """A result must not flip to a fail because the bar was raised later."""
        sections = [
            {
                "name": "Section A",
                "criteria": [
                    {
                        "label": "Don mask",
                        "type": "score",
                        "max_score": 10,
                        "required": False,
                    }
                ],
            }
        ]
        test = SimpleNamespace(
            section_results=[
                {
                    "section_id": "section-0",
                    "section_name": "Section A",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "score": 8, "passed": True}
                    ],
                }
            ],
            template_snapshot={
                "sections": copy.deepcopy(sections),
                "passing_percentage": 70.0,
                "require_all_critical": False,
                "time_limit_seconds": None,
            },
        )

        live = _template(copy.deepcopy(sections), passing_percentage=90.0)

        assert calculate_test_result(test, live) == (80.0, "fail")
        assert calculate_test_result(test, resolve_test_template(test, live)) == (
            80.0,
            "pass",
        )


class TestResolveElapsedSeconds:
    """The examiner's stopwatch, not the length of the sitting."""

    def test_prefers_the_measured_reading(self):
        from datetime import datetime, timedelta, timezone

        from app.services.skills_testing_service import resolve_elapsed_seconds

        started = datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc)
        completed = started + timedelta(hours=7)

        # Seven hours of wall clock, but the evaluation itself took three
        # minutes — the rest was waiting for the next candidate.
        assert resolve_elapsed_seconds(180, started, completed) == 180

    def test_keeps_a_measured_zero(self):
        """0 is a real reading (the examiner never started the clock) and must
        not be treated as absent — `if not measured` would fall through to a
        wall-clock value that means something entirely different."""
        from datetime import datetime, timedelta, timezone

        from app.services.skills_testing_service import resolve_elapsed_seconds

        started = datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc)
        assert resolve_elapsed_seconds(0, started, started + timedelta(hours=2)) == 0

    def test_falls_back_to_wall_clock_when_unmeasured(self):
        from datetime import datetime, timedelta, timezone

        from app.services.skills_testing_service import resolve_elapsed_seconds

        started = datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc)
        completed = started + timedelta(minutes=5)

        assert resolve_elapsed_seconds(None, started, completed) == 300

    def test_returns_none_when_nothing_is_known(self):
        from app.services.skills_testing_service import resolve_elapsed_seconds

        assert resolve_elapsed_seconds(None, None, None) is None
