"""No test module reads the clock when it is imported.

A module-level ``NOW = datetime.now(timezone.utc)`` is read once, during
collection, and used by tests that run many minutes later; a module-level
``TODAY = date.today()`` is yesterday's date for every test that runs after a
midnight the run crosses. Both fail only at some times of day. A module reads
its clock in a function registered with ``tests.clock_support.reread_each_test``
instead, so each test starts from values read at that moment.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

TESTS = Path(__file__).resolve().parent

# date.today(), datetime.now(...), datetime.utcnow(), datetime.today(), and the
# same through the module: datetime.date.today(), datetime.datetime.now(...).
_CLOCK_READS = {"today", "now", "utcnow"}
_CLOCK_OWNERS = {"date", "datetime"}


def _evaluated_now(node: ast.AST):
    """The nodes evaluated when ``node`` is: a lambda's body runs later."""
    yield node
    for child in ast.iter_child_nodes(node):
        if not isinstance(child, ast.Lambda):
            yield from _evaluated_now(child)


def _reads_the_clock(node: ast.AST) -> bool:
    for call in _evaluated_now(node):
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)):
            continue
        if call.func.attr not in _CLOCK_READS:
            continue
        owner = call.func.value
        name = (
            owner.attr
            if isinstance(owner, ast.Attribute)
            else getattr(owner, "id", None)
        )
        if name in _CLOCK_OWNERS:
            return True
    return False


def _import_time_reads(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    found = []
    for stmt in tree.body:
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)) and stmt.value is not None:
            if _reads_the_clock(stmt.value):
                found.append(f"{path.name}:{stmt.lineno}")
    return found


def test_no_test_module_reads_the_clock_at_import():
    offenders = [
        hit for path in sorted(TESTS.rglob("*.py")) for hit in _import_time_reads(path)
    ]
    assert offenders == [], (
        "These module-level assignments read the clock when the file is "
        "imported, so the tests that use them run against a stale time, or "
        "yesterday's date once the run crosses midnight. Move them into a "
        "_clock() function registered with tests.clock_support."
        "reread_each_test: " + ", ".join(offenders)
    )


def test_the_sweep_sees_each_shape_it_names():
    source = (
        "from datetime import date, datetime, timezone\n"
        "import datetime as dt\n"
        "A = date.today()\n"
        "B = datetime.now(timezone.utc)\n"
        "C = datetime.utcnow()\n"
        "D = dt.date.today()\n"
        "E: object = dt.datetime.now()\n"
        "F = (datetime.now(timezone.utc) + 1).isoformat()\n"
        "G = datetime(2026, 1, 1)\n"
        "H = st.builds(lambda m: datetime.now() + m, st.integers())\n"
        "def later():\n"
        "    return date.today()\n"
    )
    tree = ast.parse(source)
    flagged = [
        stmt.targets[0].id if isinstance(stmt, ast.Assign) else stmt.target.id
        for stmt in tree.body
        if isinstance(stmt, (ast.Assign, ast.AnnAssign))
        and stmt.value is not None
        and _reads_the_clock(stmt.value)
    ]
    assert flagged == ["A", "B", "C", "D", "E", "F"]
