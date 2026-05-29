"""Unit tests for skill-test scoring and pass/fail evaluation.

These cover ``calculate_test_result`` in isolation. The function is pure (no
database), so the template and test records are represented by light
``SimpleNamespace`` stand-ins exposing only the attributes the scorer reads.
"""

from types import SimpleNamespace

from app.services.skills_testing_service import calculate_test_result


def _template(sections, passing_percentage=None, require_all_critical=False):
    return SimpleNamespace(
        sections=sections,
        passing_percentage=passing_percentage,
        require_all_critical=require_all_critical,
    )


def _test(section_results):
    return SimpleNamespace(section_results=section_results)


def test_no_section_results_fails_with_no_score():
    template = _template([{"name": "S1", "criteria": []}])
    result = calculate_test_result(_test([]), template)
    assert result == (None, "fail")


def test_point_based_score_passes_threshold():
    template = _template(
        [
            {
                "name": "SCBA",
                "criteria": [
                    {"type": "score", "label": "Don", "max_score": 10},
                    {"type": "score", "label": "Doff", "max_score": 10},
                ],
            }
        ],
        passing_percentage=70,
    )
    test = _test(
        [
            {
                "section_id": "section-0",
                "criteria_results": [
                    {"criterion_id": "criterion-0-0", "score": 9},
                    {"criterion_id": "criterion-0-1", "score": 8},
                ],
            }
        ]
    )
    # 17 of 20 = 85%
    assert calculate_test_result(test, template) == (85.0, "pass")


def test_point_based_score_below_threshold_fails():
    template = _template(
        [
            {
                "name": "SCBA",
                "criteria": [{"type": "score", "label": "Don", "max_score": 10}],
            }
        ],
        passing_percentage=70,
    )
    test = _test(
        [
            {
                "section_id": "section-0",
                "criteria_results": [{"criterion_id": "criterion-0-0", "score": 5}],
            }
        ]
    )
    # 5 of 10 = 50% < 70%
    assert calculate_test_result(test, template) == (50.0, "fail")


def test_score_at_exact_threshold_passes():
    template = _template(
        [
            {
                "name": "S",
                "criteria": [{"type": "score", "label": "c", "max_score": 10}],
            }
        ],
        passing_percentage=70,
    )
    test = _test(
        [
            {
                "section_id": "section-0",
                "criteria_results": [{"criterion_id": "criterion-0-0", "score": 7}],
            }
        ]
    )
    # Exactly 70% — boundary is inclusive (>=)
    assert calculate_test_result(test, template) == (70.0, "pass")


def test_failed_critical_criterion_fails_despite_passing_percentage():
    template = _template(
        [
            {
                "name": "S",
                "criteria": [
                    {"type": "score", "label": "scored", "max_score": 10},
                    {"type": "checkbox", "label": "must-pass", "required": True},
                ],
            }
        ],
        passing_percentage=50,
        require_all_critical=True,
    )
    test = _test(
        [
            {
                "section_id": "section-0",
                "criteria_results": [
                    {"criterion_id": "criterion-0-0", "score": 10},
                    {"criterion_id": "criterion-0-1", "passed": False},
                ],
            }
        ]
    )
    # 100% on score, but the required criterion failed
    assert calculate_test_result(test, template) == (100.0, "fail")


def test_passed_critical_criterion_passes():
    template = _template(
        [
            {
                "name": "S",
                "criteria": [
                    {"type": "score", "label": "scored", "max_score": 10},
                    {"type": "checkbox", "label": "must-pass", "required": True},
                ],
            }
        ],
        passing_percentage=50,
        require_all_critical=True,
    )
    test = _test(
        [
            {
                "section_id": "section-0",
                "criteria_results": [
                    {"criterion_id": "criterion-0-0", "score": 10},
                    {"criterion_id": "criterion-0-1", "passed": True},
                ],
            }
        ]
    )
    assert calculate_test_result(test, template) == (100.0, "pass")


def test_missing_section_with_required_criterion_fails():
    template = _template(
        [
            {
                "name": "Present",
                "criteria": [{"type": "checkbox", "label": "ok", "required": True}],
            },
            {
                "name": "Absent",
                "criteria": [
                    {"type": "checkbox", "label": "missing", "required": True}
                ],
            },
        ],
        require_all_critical=True,
    )
    # Only the first section has a result; the second required section is absent.
    test = _test(
        [
            {
                "section_id": "section-0",
                "section_score": 100,
                "criteria_results": [{"criterion_id": "criterion-0-0", "passed": True}],
            }
        ]
    )
    score, outcome = calculate_test_result(test, template)
    assert outcome == "fail"


def test_statement_criteria_always_pass():
    template = _template(
        [
            {
                "name": "S",
                "criteria": [
                    {"type": "statement", "label": "read this", "required": True}
                ],
            }
        ],
        require_all_critical=True,
    )
    test = _test([{"section_id": "section-0", "section_score": 100}])
    # Statement criteria are informational and never block a pass.
    _, outcome = calculate_test_result(test, template)
    assert outcome == "pass"


def test_falls_back_to_section_score_average_without_score_criteria():
    template = _template(
        [
            {"name": "A", "criteria": [{"type": "checkbox", "label": "x"}]},
            {"name": "B", "criteria": [{"type": "checkbox", "label": "y"}]},
        ],
        passing_percentage=80,
    )
    test = _test(
        [
            {"section_id": "section-0", "section_score": 90},
            {"section_id": "section-1", "section_score": 70},
        ]
    )
    # No score-type criteria -> average the section_scores: (90 + 70) / 2 = 80
    assert calculate_test_result(test, template) == (80.0, "pass")


def test_non_positive_max_score_is_ignored():
    template = _template(
        [
            {
                "name": "S",
                "criteria": [
                    {"type": "score", "label": "zero", "max_score": 0},
                    {"type": "score", "label": "neg", "max_score": -5},
                ],
            }
        ]
    )
    # All score criteria are non-positive -> no point-based score, no section
    # scores either, so overall score is None and (with no passing pct) it passes.
    test = _test([{"section_id": "section-0", "criteria_results": []}])
    assert calculate_test_result(test, template) == (None, "pass")


def test_matches_section_and_criterion_by_name_and_label():
    template = _template(
        [
            {
                "name": "Ladder",
                "criteria": [{"type": "score", "label": "throw", "max_score": 20}],
            }
        ],
        passing_percentage=50,
    )
    # Results reference the section by name and criterion by label, not by id.
    test = _test(
        [
            {
                "section_name": "Ladder",
                "criteria_results": [{"criterion_label": "throw", "score": 15}],
            }
        ]
    )
    # 15 of 20 = 75%
    assert calculate_test_result(test, template) == (75.0, "pass")
