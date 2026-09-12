"""A scorecard cannot be filed with steps the examiner never resolved.

A blank step is the quietest way this module can report a wrong result. A
point-carrying one enlarges the denominator and earns nothing, so it costs the
candidate full marks with nothing on the screen saying so — and that is the
exact opposite of how an unmarked ``deduct`` step is treated, which charges
nothing because the examiner made no judgement. Two rules, opposite directions,
neither visible on the filed result.

So completion requires a judgement on every step: a mark, or an explicit waiver
with a reason. ``unresolved_criteria`` is what the endpoint checks, and
``waived_critical_criteria`` closes the one state a waiver must never reach —
a critical step, where "did not apply" is never the right answer and a waiver
would produce a pass for a candidate who never demonstrated the skill.

Pure functions and SimpleNamespace stand-ins; no database.
"""

from types import SimpleNamespace

from app.services.skills_testing_service import (
    unresolved_criteria,
    waived_critical_criteria,
)


def _template(criteria, name="Water supply"):
    return SimpleNamespace(sections=[{"name": name, "criteria": criteria}])


def _test(criteria_results):
    return SimpleNamespace(
        section_results=[
            {"section_id": "section-0", "criteria_results": criteria_results}
        ]
    )


def _labels(rows):
    return [row["label"] for row in rows]


class TestUnresolvedCriteria:
    def test_reports_a_step_with_no_result_at_all(self):
        template = _template(
            [
                {"type": "pass_fail", "label": "Sets the hydrant"},
                {"type": "pass_fail", "label": "Charges the line"},
            ]
        )
        test = _test([{"criterion_id": "criterion-0-0", "passed": True}])

        assert _labels(unresolved_criteria(test, template)) == ["Charges the line"]

    def test_reports_a_step_recorded_with_no_verdict(self):
        template = _template([{"type": "pass_fail", "label": "Sets the hydrant"}])
        # A step opened and left — a note typed against it does not make it
        # judged.
        test = _test(
            [{"criterion_id": "criterion-0-0", "passed": None, "notes": "see above"}]
        )

        assert _labels(unresolved_criteria(test, template)) == ["Sets the hydrant"]

    def test_accepts_a_marked_step(self):
        template = _template([{"type": "pass_fail", "label": "Sets the hydrant"}])

        for verdict in (True, False):
            test = _test([{"criterion_id": "criterion-0-0", "passed": verdict}])
            assert unresolved_criteria(test, template) == []

    def test_accepts_a_waived_step(self):
        template = _template([{"type": "pass_fail", "label": "Sets the hydrant"}])
        test = _test(
            [
                {
                    "criterion_id": "criterion-0-0",
                    "passed": None,
                    "waived": True,
                    "waive_reason": "the evolution never reached the hydrant",
                }
            ]
        )

        assert unresolved_criteria(test, template) == []

    def test_ignores_statements(self):
        # A statement is read aloud and marks itself, so there is nothing for
        # the examiner to resolve and blocking on one would be unclearable.
        template = _template(
            [
                {"type": "statement", "label": "Brief the candidate"},
                {"type": "pass_fail", "label": "Sets the hydrant"},
            ]
        )
        test = _test([{"criterion_id": "criterion-0-1", "passed": True}])

        assert unresolved_criteria(test, template) == []

    def test_catches_a_blank_non_critical_scored_step(self):
        # The case the outcome vocabulary alone cannot see: a non-critical
        # scored step always reports "points", whatever is recorded against it,
        # so its blankness is only visible in the absence of a number.
        template = _template(
            [{"type": "score", "label": "Sets the pressure", "max_score": 5}]
        )

        assert _labels(unresolved_criteria(_test([]), template)) == [
            "Sets the pressure"
        ]
        scored = _test([{"criterion_id": "criterion-0-0", "score": 3, "passed": True}])
        assert unresolved_criteria(scored, template) == []

    def test_covers_steps_that_carry_no_points(self):
        # On the pass/fail sheets in the starter library almost nothing carries
        # points, so a guard scoped to the point pool would barely fire there —
        # and a blank reads just as badly on the filed result.
        template = _template([{"type": "pass_fail", "label": "Sets the hydrant"}])

        assert _labels(unresolved_criteria(_test([]), template)) == ["Sets the hydrant"]

    def test_reports_where_each_step_lives_and_whether_it_is_critical(self):
        template = _template(
            [
                {"type": "pass_fail", "label": "Sets the hydrant", "required": True},
                {"type": "pass_fail", "label": "Charges the line"},
            ]
        )

        rows = unresolved_criteria(_test([]), template)

        assert [(r["section_name"], r["label"], r["critical"]) for r in rows] == [
            ("Water supply", "Sets the hydrant", True),
            ("Water supply", "Charges the line", False),
        ]

    def test_reports_in_sheet_order_across_sections(self):
        template = SimpleNamespace(
            sections=[
                {"name": "Approach", "criteria": [{"label": "Sizes up"}]},
                {"name": "Attack", "criteria": [{"label": "Advances the line"}]},
            ]
        )

        rows = unresolved_criteria(SimpleNamespace(section_results=[]), template)

        assert _labels(rows) == ["Sizes up", "Advances the line"]
        assert [r["section_index"] for r in rows] == [0, 1]


class TestWaivedCriticalCriteria:
    def test_reports_a_waiver_on_a_critical_step(self):
        template = _template(
            [{"type": "pass_fail", "label": "Opens the airway", "required": True}]
        )
        test = _test(
            [
                {
                    "criterion_id": "criterion-0-0",
                    "passed": None,
                    "waived": True,
                    "waive_reason": "manikin unavailable",
                }
            ]
        )

        assert _labels(waived_critical_criteria(test, template)) == ["Opens the airway"]

    def test_allows_a_waiver_on_a_non_critical_step(self):
        template = _template([{"type": "pass_fail", "label": "Sets the hydrant"}])
        test = _test(
            [
                {
                    "criterion_id": "criterion-0-0",
                    "passed": None,
                    "waived": True,
                    "waive_reason": "never reached it",
                }
            ]
        )

        assert waived_critical_criteria(test, template) == []

    def test_allows_a_critical_step_that_was_actually_marked(self):
        template = _template(
            [{"type": "pass_fail", "label": "Opens the airway", "required": True}]
        )
        test = _test([{"criterion_id": "criterion-0-0", "passed": False}])

        assert waived_critical_criteria(test, template) == []
