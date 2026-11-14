"""Every reader of a waiver period says what it does with each source.

``fetch_user_waivers`` and ``fetch_org_waivers`` hand every grader one list of
``WaiverPeriod``s from four places: training waivers, leaves of absence, the
Chief's overrides and, since 2026-11-10, approved session waiver requests
(``SOURCE_SESSION_EXCUSAL``). The last two are not periods of absence. An
override excuses nothing, and an excusal excuses exactly one session, the one
its ``event_id`` names, while carrying ``requirement_ids=None`` and the
session's own day as its dates. A reader that treats every period as dated
absence therefore reads an excusal as a blanket waiver of the whole day: it
excuses every other session held that day and, through ``month_waivers``,
pro-rates a month of hours. That is the shape the evaluation's session figure
had (``w.requirement_ids is None``), and nothing failed.

So this sweep finds, in every module that imports the waiver service, each
function that branches on a period's ``source``, ``sources`` or
``requirement_ids``, names a ``SOURCE_*`` constant, or reads the dates of a
loop variable drawn from something named like waivers, leaves or periods. A
function that names ``SOURCE_SESSION_EXCUSAL`` has decided; any other must be
in ``REVIEWED`` with the reason it is safe. A new reader that does neither
fails here. The heuristic over-reports (leave rows are not periods), which is
the safe direction: each such entry is one line of reasoning in the list.
"""

import ast
import functools
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"

pytestmark = pytest.mark.unit

#: ``(path under app/, function)`` -> why it may ignore the excusal.
REVIEWED = {
    ("services/training_waiver_service.py", "_leave_and_waiver_periods"): (
        "builds leave and waiver periods from their rows; the excusal is "
        "added separately by the fetchers and never passes through it"
    ),
    ("services/training_waiver_service.py", "_override_period"): (
        "builds an override period; reads none"
    ),
    ("services/training_waiver_service.py", "override_covers"): (
        "matches source == SOURCE_OVERRIDE only, so every other source is ignored"
    ),
    ("services/training_waiver_service.py", "excused_month_reasons"): (
        "reads month_waivers' result, which drops the excusal"
    ),
    ("services/training_compliance.py", "monthly_hours"): (
        "reads month_waivers' result (MonthWaiver.sources), which drops the excusal"
    ),
    ("services/scheduling_service.py", "get_shift_compliance"): (
        "keeps SOURCE_LEAVE periods only"
    ),
    ("services/scheduling_service.py", "_get_unavailable_dates_by_user"): (
        "reads MemberLeaveOfAbsence rows, not waiver periods"
    ),
    ("services/evaluation_data_service.py", "compute_coverage"): (
        "reads MemberLeaveOfAbsence rows, not waiver periods"
    ),
    ("services/evaluation_data_service.py", "served_intervals"): (
        "reads MemberServicePeriod rows, not waiver periods"
    ),
    ("api/v1/endpoints/training_module_config.py", "get_member_requirements"): (
        "lists MemberLeaveOfAbsence rows, not waiver periods"
    ),
}

_PERIOD_FIELDS = {"source", "start_date", "end_date", "event_id"}
_ALWAYS_PERIOD_FIELDS = {"requirement_ids", "sources"}
_WAIVERISH = re.compile(r"waiver|leave|period", re.I)
_DECIDED = "SOURCE_SESSION_EXCUSAL"


def _loop_names(func: ast.AST, source: str) -> set:
    """Names bound by a loop or comprehension over a waiver-like iterable."""
    names: set[str] = set()
    for node in ast.walk(func):
        if isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            if _WAIVERISH.search(ast.get_source_segment(source, node.iter) or ""):
                names.update(
                    n.id for n in ast.walk(node.target) if isinstance(n, ast.Name)
                )
    return names


def scan(source: str):
    """``(function, decided)`` for each function that reads waiver periods."""
    found = []
    for func in ast.walk(ast.parse(source)):
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        loops = _loop_names(func, source)
        reads = False
        decided = False
        for node in ast.walk(func):
            if isinstance(node, ast.Name) and node.id.startswith("SOURCE_"):
                reads = True
                decided = decided or node.id == _DECIDED
            elif isinstance(node, ast.Attribute):
                if node.attr in _ALWAYS_PERIOD_FIELDS:
                    reads = True
                elif (
                    node.attr in _PERIOD_FIELDS
                    and isinstance(node.value, ast.Name)
                    and node.value.id in loops
                ):
                    reads = True
        if reads:
            found.append((func.name, decided))
    return found


@functools.lru_cache(maxsize=1)
def _readers():
    """``{(path, function): decided}`` across every module using the service.

    Cached: three tests read it, and parsing the tree is the slow part.
    """
    readers = {}
    for path in sorted(APP.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if "training_waiver_service" not in text and (
            path.name != "training_waiver_service.py"
        ):
            continue
        relative = path.relative_to(APP).as_posix()
        for name, decided in scan(text):
            key = (relative, name)
            readers[key] = readers.get(key, False) or decided
    return readers


def test_every_reader_decides_about_the_session_excusal():
    undecided = sorted(
        f"{path}::{name}"
        for (path, name), decided in _readers().items()
        if not decided and (path, name) not in REVIEWED
    )
    assert not undecided, (
        "These functions read waiver periods without saying what they do with "
        "SOURCE_SESSION_EXCUSAL. An excusal carries requirement_ids=None and "
        "its session's day as its dates, so a date-based reader takes it for a "
        "blanket waiver of the whole day. Handle the source (match on "
        "event_id, or drop it), or add the function to REVIEWED with the "
        "reason it is safe:\n  " + "\n  ".join(undecided)
    )


def test_every_reviewed_reader_still_exists_and_still_ignores_it():
    readers = _readers()
    stale = sorted(
        f"{path}::{name}"
        for (path, name) in REVIEWED
        if (path, name) not in readers or readers[(path, name)]
    )
    assert not stale, (
        "REVIEWED names readers that are gone or now handle the excusal "
        f"themselves; remove them: {stale}"
    )


def test_the_known_readers_decide():
    """The two readers that branch on dates for grading name the source."""
    readers = _readers()
    assert readers[("services/training_waiver_service.py", "month_waivers")]
    assert readers[("services/training_compliance.py", "_waiver_excuses")]


class TestTheDetectionItself:
    """A sweep that quietly stopped detecting would pass forever."""

    def test_a_blanket_test_on_requirement_ids_is_a_reader(self):
        source = (
            "def f(periods):\n"
            "    return [w for w in periods if w.requirement_ids is None]\n"
        )
        assert scan(source) == [("f", False)]

    def test_dates_read_off_a_waiver_loop_are_a_reader(self):
        source = (
            "def f(waivers, day):\n"
            "    return any(w.start_date <= day <= w.end_date for w in waivers)\n"
        )
        assert scan(source) == [("f", False)]

    def test_naming_the_excusal_is_a_decision(self):
        source = (
            "def f(waivers):\n"
            "    return [w for w in waivers if w.source != SOURCE_SESSION_EXCUSAL]\n"
        )
        assert scan(source) == [("f", True)]

    def test_dates_on_an_unrelated_loop_are_not_a_reader(self):
        source = (
            "def f(shifts, day):\n"
            "    return any(s.start_date <= day for s in shifts)\n"
        )
        assert scan(source) == []
