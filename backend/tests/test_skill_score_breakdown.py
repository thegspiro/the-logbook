"""Tests for the score breakdown a finished scorecard shows as its working.

Two things are being pinned down here.

The first is the arithmetic itself: which criteria feed the percentage, and the
``score_pass_fail_criteria`` opt-in that lets pass/fail steps feed it too. That
setting must default off everywhere it can be absent — an old template row, a
snapshot taken before the column existed — because turning it on retroactively
would change what every percentage already on record means.

The second is the tally the section headings show. Those counts were derived
from the ``passed`` flag alone, which the scoring screen sets on criteria that
never went through a pass/fail judgement: statements mark themselves, and
non-critical scored steps are stamped passed whatever number they earn. A
section holding one statement, one critical step and six scored steps therefore
read "11 passed" while two of those steps had scored zero.

Pure functions and SimpleNamespace stand-ins; no database.
"""

from types import SimpleNamespace

from app.services.skills_testing_service import (
    build_score_breakdown,
    build_template_snapshot,
    calculate_test_result,
    resolve_test_template,
)


def _template(sections, **overrides):
    return SimpleNamespace(
        name=overrides.get("name", "Power Lift and Cot"),
        version=overrides.get("version", 1),
        sections=sections,
        passing_percentage=overrides.get("passing_percentage"),
        require_all_critical=overrides.get("require_all_critical", False),
        time_limit_seconds=overrides.get("time_limit_seconds"),
        score_pass_fail_criteria=overrides.get("score_pass_fail_criteria", False),
    )


def _test(section_results):
    return SimpleNamespace(section_results=section_results)


def _section_of(breakdown, name):
    return next(s for s in breakdown["sections"] if s["section_name"] == name)


class TestPointArithmetic:
    """What the percentage is computed from."""

    def test_reports_earned_available_and_percentage(self):
        template = _template(
            [
                {
                    "name": "Bring the cot",
                    "criteria": [
                        {"type": "score", "label": "Remove", "max_score": 1},
                        {"type": "score", "label": "Move", "max_score": 1},
                    ],
                }
            ],
            passing_percentage=80,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "score": 1},
                        {"criterion_id": "criterion-0-1", "score": 0},
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["method"] == "points"
        assert (breakdown["earned"], breakdown["available"]) == (1.0, 2.0)
        assert breakdown["percentage"] == 50.0
        assert breakdown["passing_percentage"] == 80
        assert breakdown["meets_threshold"] is False

    def test_pass_fail_criteria_contribute_nothing_by_default(self):
        """The behavior that prompted the setting: a whole section of knowledge
        questions, half of them wrong, moving the percentage not at all."""
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [{"type": "score", "label": "Lift", "max_score": 2}],
                },
                {
                    "name": "Cot Questions",
                    "criteria": [
                        {"type": "pass_fail", "label": "Up a hill"},
                        {"type": "pass_fail", "label": "How high"},
                    ],
                },
            ]
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [{"criterion_id": "criterion-0-0", "score": 2}],
                },
                {
                    "section_id": "section-1",
                    "criteria_results": [
                        {"criterion_id": "criterion-1-0", "passed": True},
                        {"criterion_id": "criterion-1-1", "passed": False},
                    ],
                },
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["percentage"] == 100.0
        assert breakdown["available"] == 2.0
        # And the scorecard can say so: the section is flagged as contributing
        # nothing rather than silently omitted.
        questions = _section_of(breakdown, "Cot Questions")
        assert questions["counts_toward_score"] is False
        assert (questions["earned"], questions["available"]) == (None, None)
        assert (questions["passed"], questions["failed"]) == (1, 1)

    def test_pass_fail_criteria_score_when_template_opts_in(self):
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [{"type": "score", "label": "Lift", "max_score": 2}],
                },
                {
                    "name": "Cot Questions",
                    "criteria": [
                        {"type": "pass_fail", "label": "Up a hill"},
                        {"type": "pass_fail", "label": "How high"},
                    ],
                },
            ],
            score_pass_fail_criteria=True,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [{"criterion_id": "criterion-0-0", "score": 2}],
                },
                {
                    "section_id": "section-1",
                    "criteria_results": [
                        {"criterion_id": "criterion-1-0", "passed": True},
                        {"criterion_id": "criterion-1-1", "passed": False},
                    ],
                },
            ]
        )

        breakdown = build_score_breakdown(test, template)

        # 2 of 2 on the scored step, 1 of 2 on the questions -> 3 of 4.
        assert (breakdown["earned"], breakdown["available"]) == (3.0, 4.0)
        assert breakdown["percentage"] == 75.0
        assert _section_of(breakdown, "Cot Questions")["counts_toward_score"] is True

    def test_pass_fail_criterion_may_be_weighted_by_max_score(self):
        template = _template(
            [
                {
                    "name": "Questions",
                    "criteria": [
                        {"type": "pass_fail", "label": "Cheap"},
                        {"type": "pass_fail", "label": "Dear", "max_score": 4},
                    ],
                }
            ],
            score_pass_fail_criteria=True,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": True},
                        {"criterion_id": "criterion-0-1", "passed": False},
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert (breakdown["earned"], breakdown["available"]) == (1.0, 5.0)

    def test_checklist_and_timed_criteria_stay_out_of_the_point_pool(self):
        """Both are deliberately excluded — see _criterion_point_value."""
        template = _template(
            [
                {
                    "name": "Mixed",
                    "criteria": [
                        {"type": "checklist", "label": "Kit", "max_score": 3},
                        {"type": "time_limit", "label": "Don", "max_score": 3},
                    ],
                }
            ],
            score_pass_fail_criteria=True,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": True},
                        {"criterion_id": "criterion-0-1", "passed": True},
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["available"] == 0.0
        assert breakdown["method"] == "none"


class TestSectionTallies:
    """The counts beside a section heading."""

    def test_statements_are_counted_apart_from_passes(self):
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [
                        {"type": "statement", "label": "Opening Statement"},
                        {
                            "type": "pass_fail",
                            "label": "Scene safety",
                            "required": True,
                        },
                    ],
                }
            ]
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    # The scoring screen auto-marks statements passed.
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": True},
                        {"criterion_id": "criterion-0-1", "passed": True},
                    ],
                }
            ]
        )

        section = _section_of(build_score_breakdown(test, template), "Procedure")

        assert section["statements"] == 1
        assert section["passed"] == 1  # not 2

    def test_zero_point_scored_step_is_not_counted_as_passed(self):
        """A non-critical scored step carries points and nothing else. It is
        stamped ``passed: true`` at any value, so counting that flag reported a
        step that earned nothing as a pass."""
        template = _template(
            [
                {
                    "name": "Place cot",
                    "criteria": [
                        {"type": "score", "label": "Retract", "max_score": 1},
                        {"type": "score", "label": "Supine", "max_score": 1},
                    ],
                }
            ]
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "score": 1, "passed": True},
                        {"criterion_id": "criterion-0-1", "score": 0, "passed": True},
                    ],
                }
            ]
        )

        section = _section_of(build_score_breakdown(test, template), "Place cot")

        assert (section["passed"], section["failed"]) == (0, 0)
        assert (section["earned"], section["available"]) == (1.0, 2.0)

    def test_critical_scored_step_is_judged_against_its_passing_score(self):
        template = _template(
            [
                {
                    "name": "Critical",
                    "criteria": [
                        {
                            "type": "score",
                            "label": "Seat the stretcher",
                            "max_score": 4,
                            "passing_score": 3,
                            "required": True,
                        }
                    ],
                }
            ]
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [{"criterion_id": "criterion-0-0", "score": 2}],
                }
            ]
        )

        section = _section_of(build_score_breakdown(test, template), "Critical")

        assert (section["passed"], section["failed"]) == (0, 1)

    def test_unrecorded_steps_are_counted_as_not_scored(self):
        template = _template(
            [
                {
                    "name": "Partial",
                    "criteria": [
                        {"type": "statement", "label": "Read this"},
                        {"type": "pass_fail", "label": "Untouched"},
                        {"type": "pass_fail", "label": "Cleared"},
                    ],
                }
            ]
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-2", "passed": None},
                    ],
                }
            ]
        )

        section = _section_of(build_score_breakdown(test, template), "Partial")

        assert section["not_scored"] == 2
        assert section["statements"] == 1

    def test_sections_carry_positional_ids(self):
        template = _template(
            [
                {"name": "A", "criteria": []},
                {"name": "B", "criteria": []},
            ]
        )

        breakdown = build_score_breakdown(_test([]), template)

        assert [s["section_id"] for s in breakdown["sections"]] == [
            "section-0",
            "section-1",
        ]


class TestCriticalFailures:
    """Why a test with a passing percentage can still read as Failed."""

    def test_failed_critical_step_is_named(self):
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [
                        {"type": "pass_fail", "label": "Scene safety", "required": True}
                    ],
                }
            ],
            require_all_critical=True,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": False}
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["critical_failures"] == [
            {
                "section_name": "Procedure",
                "criterion_label": "Scene safety",
                "reason": "failed",
            }
        ]
        assert calculate_test_result(test, template) == (None, "fail")

    def test_unscored_critical_step_is_reported_as_such(self):
        """It fails the test exactly like a marked failure, so it cannot be
        left looking like a harmless omission."""
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [
                        {
                            "type": "pass_fail",
                            "label": "Scene safety",
                            "required": True,
                        },
                        {"type": "score", "label": "Lift", "max_score": 1},
                    ],
                }
            ],
            require_all_critical=True,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [{"criterion_id": "criterion-0-1", "score": 1}],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["percentage"] == 100.0
        assert breakdown["meets_threshold"] is True
        assert [f["reason"] for f in breakdown["critical_failures"]] == ["not_scored"]
        assert calculate_test_result(test, template)[1] == "fail"

    def test_statements_never_appear_as_critical_failures(self):
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [
                        {"type": "statement", "label": "Read this", "required": True}
                    ],
                }
            ],
            require_all_critical=True,
        )

        breakdown = build_score_breakdown(
            _test([{"section_id": "section-0"}]), template
        )

        assert breakdown["critical_failures"] == []

    def test_no_failures_listed_when_the_rule_is_off(self):
        template = _template(
            [
                {
                    "name": "Procedure",
                    "criteria": [
                        {"type": "pass_fail", "label": "Scene safety", "required": True}
                    ],
                }
            ],
            require_all_critical=False,
        )
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": False}
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, template)

        assert breakdown["critical_failures"] == []
        assert breakdown["require_all_critical"] is False


class TestSnapshotPinsTheScoringRule:
    """A template edited after the fact never re-scores a finished test."""

    def test_snapshot_captures_the_setting(self):
        snapshot = build_template_snapshot(
            _template([], score_pass_fail_criteria=True),
        )

        assert snapshot["score_pass_fail_criteria"] is True

    def test_snapshot_predating_the_setting_reads_as_off(self):
        """Every scorecard filed before the column existed was calculated from
        scored steps alone, and must keep reading that way."""
        test = SimpleNamespace(
            template_snapshot={
                "sections": [{"name": "S", "criteria": []}],
                "passing_percentage": 70,
                "require_all_critical": True,
                "time_limit_seconds": None,
            },
            section_results=[],
        )
        live = _template([], score_pass_fail_criteria=True)

        assert resolve_test_template(test, live).score_pass_fail_criteria is False

    def test_turning_the_setting_on_does_not_rescore_an_earlier_test(self):
        sections = [
            {
                "name": "Questions",
                "criteria": [
                    {"type": "score", "label": "Lift", "max_score": 1},
                    {"type": "pass_fail", "label": "How high"},
                ],
            }
        ]
        results = [
            {
                "section_id": "section-0",
                "criteria_results": [
                    {"criterion_id": "criterion-0-0", "score": 1},
                    {"criterion_id": "criterion-0-1", "passed": False},
                ],
            }
        ]
        test = SimpleNamespace(
            template_snapshot={
                "sections": sections,
                "passing_percentage": None,
                "require_all_critical": False,
                "time_limit_seconds": None,
                "score_pass_fail_criteria": False,
            },
            section_results=results,
        )
        # The officer has since switched the live template's scoring on.
        live = _template(sections, score_pass_fail_criteria=True)

        scored_against = resolve_test_template(test, live)

        assert calculate_test_result(test, scored_against) == (100.0, "pass")
        # Taken today, the same performance would score 1 of 2.
        assert calculate_test_result(_test(results), live) == (50.0, "pass")
