"""Flattening a scored test into one row per step.

``iter_criterion_rows`` backs the CSV export and the printed scorecard. It has
to agree with ``build_score_breakdown`` on every judgement call, because the
two describe the same test: results are matched positionally with a label
fallback, statements are read aloud rather than judged, and a non-critical
scored step is reported as points rather than as passed or failed. A second
implementation of those rules would drift the moment one side was fixed, so
these tests pin the shared one.
"""

import io
from types import SimpleNamespace

import pytest

from app.services.skills_testing_service import (
    build_score_breakdown,
    iter_criterion_rows,
)
from app.utils.csv_export import SafeCsvWriter

SECTIONS = [
    {
        "name": "Preparation",
        "criteria": [
            {"label": "Brief", "type": "statement", "statement_text": "Go."},
            {"label": "Checks cylinder", "type": "pass_fail", "required": True},
            {
                "label": "Seal quality",
                "type": "score",
                "max_score": 5,
                "passing_score": 3,
            },
        ],
    },
    {
        "name": "Donning",
        "criteria": [
            {
                "label": "In time",
                "type": "time_limit",
                "required": True,
                "time_limit_seconds": 60,
            },
            {
                "label": "PPE",
                "type": "checklist",
                "required": True,
                "checklist_items": ["Helmet", "Hood", "Gloves"],
            },
        ],
    },
]


def _template(**overrides):
    fields = {
        "sections": SECTIONS,
        "passing_percentage": None,
        "require_all_critical": True,
        "score_pass_fail_criteria": False,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _test(section_results):
    return SimpleNamespace(section_results=section_results, template_snapshot=None)


FULL_RESULTS = [
    {
        "section_id": "section-0",
        "criteria_results": [
            {"criterion_id": "criterion-0-0", "passed": True},
            {"criterion_id": "criterion-0-1", "passed": True, "notes": "Clean."},
            {"criterion_id": "criterion-0-2", "score": 4},
        ],
    },
    {
        "section_id": "section-1",
        "criteria_results": [
            {"criterion_id": "criterion-1-0", "passed": True, "time_seconds": 48},
            {
                "criterion_id": "criterion-1-1",
                "passed": False,
                "checklist_completed": [True, True, False],
            },
        ],
    },
]


def test_rows_come_out_in_sheet_order():
    rows = list(iter_criterion_rows(_test(FULL_RESULTS), _template()))

    assert [(r["section_index"], r["criterion_index"]) for r in rows] == [
        (0, 0),
        (0, 1),
        (0, 2),
        (1, 0),
        (1, 1),
    ]
    assert [r["label"] for r in rows][:2] == ["Brief", "Checks cylinder"]
    assert rows[0]["section_name"] == "Preparation"
    assert rows[3]["section_name"] == "Donning"


def test_each_type_carries_its_own_evidence():
    rows = {
        r["label"]: r for r in iter_criterion_rows(_test(FULL_RESULTS), _template())
    }

    assert rows["Seal quality"]["score"] == 4
    assert rows["Seal quality"]["max_score"] == 5
    assert rows["In time"]["time_seconds"] == 48
    assert rows["PPE"]["checklist"] == [True, True, False]
    assert rows["PPE"]["checklist_items"] == ["Helmet", "Hood", "Gloves"]
    assert rows["Checks cylinder"]["notes"] == "Clean."


def test_outcomes_match_the_scorecards_own_tallies():
    """The whole point of sharing the helper — the two must never disagree."""
    test, template = _test(FULL_RESULTS), _template()
    rows = list(iter_criterion_rows(test, template))
    breakdown = build_score_breakdown(test, template)

    for section in breakdown["sections"]:
        index = int(section["section_id"].split("-")[1])
        mine = [r for r in rows if r["section_index"] == index]
        assert sum(1 for r in mine if r["outcome"] == "passed") == section["passed"]
        assert sum(1 for r in mine if r["outcome"] == "failed") == section["failed"]
        assert (
            sum(1 for r in mine if r["outcome"] == "not_scored")
            == section["not_scored"]
        )
        assert (
            sum(1 for r in mine if r["outcome"] == "statement") == section["statements"]
        )


def test_a_statement_is_never_judged():
    rows = list(iter_criterion_rows(_test(FULL_RESULTS), _template()))
    assert rows[0]["outcome"] == "statement"
    assert rows[0]["critical"] is False


def test_a_non_critical_scored_step_reports_points_not_pass_fail():
    """It is stamped passed whatever number it records, so reporting that flag
    would show a step scored 0 of 5 as a pass."""
    rows = {
        r["label"]: r for r in iter_criterion_rows(_test(FULL_RESULTS), _template())
    }
    assert rows["Seal quality"]["outcome"] == "points"


def test_a_missing_result_reads_as_not_scored_rather_than_absent():
    """An audit file must show the step and that nobody marked it — dropping
    the row would make a skipped step indistinguishable from one the sheet
    never had."""
    rows = list(iter_criterion_rows(_test([]), _template()))

    assert len(rows) == 5
    outcomes = {r["label"]: r["outcome"] for r in rows}
    assert outcomes["Checks cylinder"] == "not_scored"
    assert outcomes["In time"] == "not_scored"


def test_criteria_are_matched_by_label_when_ids_are_absent():
    """Older clients wrote results keyed by label only."""
    rows = {
        r["label"]: r
        for r in iter_criterion_rows(
            _test(
                [
                    {
                        "section_id": "section-0",
                        "criteria_results": [
                            {"criterion_label": "Checks cylinder", "passed": False}
                        ],
                    }
                ]
            ),
            _template(),
        )
    }
    assert rows["Checks cylinder"]["outcome"] == "failed"


def test_a_template_with_no_sections_yields_nothing():
    assert list(iter_criterion_rows(_test(FULL_RESULTS), _template(sections=[]))) == []


def test_non_dict_entries_are_skipped_rather_than_crashing():
    """Sections are JSON — a hand-edited or half-migrated row must not 500 an
    export covering hundreds of other tests."""
    template = _template(
        sections=[
            "not a section",
            {"name": "Real", "criteria": ["not a criterion", {"label": "Ok"}]},
        ]
    )
    rows = list(iter_criterion_rows(_test([]), template))

    assert [r["label"] for r in rows] == ["Ok"]


def test_export_cells_are_neutralized_against_formula_injection():
    """Criterion labels and examiner notes are free text and reach Excel.

    Pinned here rather than left to the endpoint because the risk lives in
    these exact values — a member named or a step labelled `=cmd|…` runs on
    whoever opens the audit packet (CLAUDE.md pitfall #15).
    """
    rows = list(
        iter_criterion_rows(
            _test(
                [
                    {
                        "section_id": "section-0",
                        "criteria_results": [
                            {
                                "criterion_id": "criterion-0-1",
                                "passed": True,
                                "notes": '=cmd|"/c calc"!A1',
                            }
                        ],
                    }
                ]
            ),
            _template(
                sections=[
                    {
                        "name": "S",
                        "criteria": [
                            {"label": "ok", "type": "pass_fail"},
                            {"label": "@SUM(A1)", "type": "pass_fail"},
                        ],
                    }
                ]
            ),
        )
    )

    output = io.StringIO()
    writer = SafeCsvWriter(output)
    for row in rows:
        writer.writerow([row["label"], row["notes"] or ""])
    written = output.getvalue()

    assert "'@SUM(A1)" in written
    assert "'=cmd|" in written
    # The dangerous forms must not survive at the start of any cell.
    for line in written.splitlines():
        for cell in line.split(","):
            assert not cell.strip('"').startswith(("=", "+", "@", "\t", "\r"))


@pytest.mark.parametrize("snapshot_sections", [None, []])
def test_falls_back_when_a_test_has_no_usable_structure(snapshot_sections):
    template = _template(sections=snapshot_sections or [])
    assert list(iter_criterion_rows(_test(FULL_RESULTS), template)) == []
