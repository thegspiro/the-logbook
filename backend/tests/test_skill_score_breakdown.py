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


class TestPerCriterionScoreModes:
    """What a failed non-critical step costs, chosen per step.

    The gap these close is the one on the scorecard that prompted them: a
    practice run recorded a Fail against a cot question and reported 100%,
    because the only two settings available were "critical" (one slip fails the
    whole evaluation) and nothing at all.
    """

    # A twenty-point sheet with four knowledge questions beside it, one of them
    # answered wrong — the shape of the scorecard that started this.
    def _sheet(self, question_overrides):
        questions = [
            {"type": "pass_fail", "label": "Up a hill"},
            {"type": "pass_fail", "label": "How many people", **question_overrides},
            {"type": "pass_fail", "label": "With a patient"},
            {"type": "pass_fail", "label": "How high"},
        ]
        return [
            {
                "name": "Patient on Cot",
                "criteria": [{"type": "score", "label": "Package", "max_score": 20}],
            },
            {"name": "Cot Questions", "criteria": questions},
        ]

    def _marks(self):
        return [
            {
                "section_id": "section-0",
                "criteria_results": [{"criterion_id": "criterion-0-0", "score": 20}],
            },
            {
                "section_id": "section-1",
                "criteria_results": [
                    {"criterion_id": "criterion-1-0", "passed": True},
                    {"criterion_id": "criterion-1-1", "passed": False},
                    {"criterion_id": "criterion-1-2", "passed": True},
                    {"criterion_id": "criterion-1-3", "passed": True},
                ],
            },
        ]

    def test_unset_mode_still_costs_nothing(self):
        """The reported behavior, pinned: absent a mode, a failed Pass/Fail step
        leaves the percentage untouched."""
        breakdown = build_score_breakdown(
            _test(self._marks()), _template(self._sheet({}))
        )

        assert breakdown["percentage"] == 100.0
        assert breakdown["deducted"] == 0.0
        assert _section_of(breakdown, "Cot Questions")["failed"] == 1

    def test_deduct_takes_points_off_without_enlarging_the_pool(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(self._sheet({"score_mode": "deduct"})),
        )

        assert (breakdown["earned"], breakdown["available"]) == (20.0, 20.0)
        assert breakdown["deducted"] == 1.0
        assert breakdown["percentage"] == 95.0

    def test_deduction_amount_is_configurable(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(
                self._sheet({"score_mode": "deduct", "deduction_points": 5}),
            ),
        )

        assert breakdown["deducted"] == 5.0
        assert breakdown["percentage"] == 75.0

    def test_points_mode_enlarges_the_pool_instead(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(self._sheet({"score_mode": "points"})),
        )

        # Only the one question opted in, so the pool grows by its single point.
        assert (breakdown["earned"], breakdown["available"]) == (20.0, 21.0)
        assert breakdown["deducted"] == 0.0
        assert breakdown["percentage"] == 95.2

    def test_a_passing_deduct_step_costs_nothing(self):
        marks = self._marks()
        marks[1]["criteria_results"][1]["passed"] = True

        breakdown = build_score_breakdown(
            _test(marks), _template(self._sheet({"score_mode": "deduct"}))
        )

        assert breakdown["deducted"] == 0.0
        assert breakdown["percentage"] == 100.0

    def test_an_unscored_deduct_step_costs_nothing(self):
        """A deduction is a recorded judgement about what the candidate did. An
        examiner who never marked the step made no such judgement, and inventing
        one would charge a candidate for the examiner's omission."""
        marks = self._marks()
        del marks[1]["criteria_results"][1]

        breakdown = build_score_breakdown(
            _test(marks), _template(self._sheet({"score_mode": "deduct"}))
        )

        assert breakdown["deducted"] == 0.0
        assert _section_of(breakdown, "Cot Questions")["not_scored"] == 1

    def test_names_each_deduction_so_a_scorecard_can_show_its_working(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(self._sheet({"score_mode": "deduct", "deduction_points": 2})),
        )

        assert breakdown["deductions"] == [
            {
                "section_name": "Cot Questions",
                "criterion_label": "How many people",
                "points": 2.0,
            }
        ]

    def test_deduction_is_reported_against_its_own_section(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(self._sheet({"score_mode": "deduct"})),
        )

        questions = _section_of(breakdown, "Cot Questions")
        assert questions["deducted"] == 1.0
        # It earns nothing and still moves the percentage, so it cannot be
        # reported as a section that did not count.
        assert questions["counts_toward_score"] is True
        assert questions["available"] is None
        assert _section_of(breakdown, "Patient on Cot")["deducted"] == 0.0

    def test_explicit_none_overrides_the_template_wide_setting(self):
        """One question the department wants recorded but not scored, on a sheet
        where Pass/Fail steps otherwise carry points."""
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(
                self._sheet({"score_mode": "none"}), score_pass_fail_criteria=True
            ),
        )

        # Three questions in the pool, not four; the failed one is outside it.
        assert (breakdown["earned"], breakdown["available"]) == (23.0, 23.0)
        assert breakdown["percentage"] == 100.0

    def test_deduct_and_critical_are_independent(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(
                self._sheet({"score_mode": "deduct", "required": True}),
                require_all_critical=True,
            ),
        )

        assert breakdown["deducted"] == 1.0
        assert [f["criterion_label"] for f in breakdown["critical_failures"]] == [
            "How many people"
        ]

    def test_deductions_cannot_drive_the_percentage_below_zero(self):
        breakdown = build_score_breakdown(
            _test(self._marks()),
            _template(self._sheet({"score_mode": "deduct", "deduction_points": 50})),
        )

        assert breakdown["deducted"] == 50.0
        assert breakdown["percentage"] == 0.0

    def test_deductions_with_no_point_pool_are_flagged_rather_than_hidden(self):
        """Nothing on the sheet earns points, so there is no total to subtract
        from. The scorer cannot apply the deduction; it must not pretend it did."""
        sections = [
            {
                "name": "Cot Questions",
                "criteria": [
                    {"type": "pass_fail", "label": "How high", "score_mode": "deduct"}
                ],
            }
        ]
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "section_score": 50,
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": False}
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, _template(sections))

        assert breakdown["method"] == "section_average"
        assert breakdown["deducted"] == 1.0
        assert breakdown["deductions_unapplied"] is True

    def test_unapplied_is_false_when_the_deduction_landed(self):
        breakdown = build_score_breakdown(
            _test(self._marks()), _template(self._sheet({"score_mode": "deduct"}))
        )

        assert breakdown["deductions_unapplied"] is False

    def test_modes_are_frozen_into_the_snapshot(self):
        """A deduction added to a published template must not re-score results
        already on file — the same guarantee the template-wide setting has."""
        sections = self._sheet({})
        test = SimpleNamespace(
            template_snapshot=build_template_snapshot(_template(sections)),
            section_results=self._marks(),
        )
        live = _template(self._sheet({"score_mode": "deduct", "deduction_points": 5}))

        assert calculate_test_result(test, resolve_test_template(test, live)) == (
            100.0,
            "pass",
        )
        assert calculate_test_result(_test(self._marks()), live) == (75.0, "pass")

    def test_an_unknown_mode_is_treated_as_no_effect(self):
        """The schema rejects these on the way in; a row that predates that
        validation, or was written straight to the JSON column, must degrade to
        the behavior a template without modes has rather than crash a scorecard."""
        breakdown = build_score_breakdown(
            _test(self._marks()), _template(self._sheet({"score_mode": "penalise"}))
        )

        assert breakdown["percentage"] == 100.0
        assert breakdown["deducted"] == 0.0

    def test_checklist_and_timed_steps_can_deduct_too(self):
        sections = [
            {
                "name": "Evolution",
                "criteria": [
                    {"type": "score", "label": "Technique", "max_score": 10},
                    {
                        "type": "time_limit",
                        "label": "Under 60s",
                        "time_limit_seconds": 60,
                        "score_mode": "deduct",
                        "deduction_points": 2,
                    },
                    {
                        "type": "checklist",
                        "label": "Equipment",
                        "checklist_items": ["Mask", "Gloves"],
                        "score_mode": "deduct",
                    },
                ],
            }
        ]
        test = _test(
            [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "score": 10},
                        {"criterion_id": "criterion-0-1", "passed": False},
                        {"criterion_id": "criterion-0-2", "passed": False},
                    ],
                }
            ]
        )

        breakdown = build_score_breakdown(test, _template(sections))

        assert breakdown["deducted"] == 3.0
        assert breakdown["percentage"] == 70.0
