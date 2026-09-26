"""
No new code reads "today" off the server's clock.

A container runs in UTC, so ``date.today()`` — and ``datetime.now(timezone.utc)
.date()``, which is the same thing spelled out — is already tomorrow for a US
department every evening. Everything that decides expired-versus-not, counts
days, or picks "this month" asks the department's calendar instead
(``app/utils/org_timezone.py``: ``org_today``, ``resolve_org_today``,
``today_in``).

This walks the AST of ``app/`` rather than grepping, so a comment or docstring
that mentions ``date.today()`` does not count and a call split across lines
does. The few calls that remain are listed below with the reason each one is
right as it stands; a new one fails here until it either moves to the
department's date or earns a line in the list.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

APP = Path(__file__).resolve().parent.parent / "app"

# (path relative to app/, enclosing function) -> why the server's date is right.
ALLOWED = {
    (
        "services/external_training_service.py",
        "sync_training_records",
    ): "the end bound sent to an external provider's API; the UTC date is never "
    "earlier than any US department's, so it can only include more records",
    (
        "schemas/shift_completion.py",
        "shift_date_not_future",
    ): "a schema validator cannot see the organization; for a US department "
    "the server's date is never behind its own, so it never refuses a real date",
    (
        "schemas/training_submission.py",
        "_validate_completion_date",
    ): "same as the shift-completion validator, with a day's tolerance on top",
}


def _is_server_today(node: ast.Call) -> bool:
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    # date.today() / _date.today() / datetime.today()
    if func.attr == "today" and not node.args:
        return isinstance(func.value, ast.Name) and func.value.id in {
            "date",
            "_date",
            "datetime",
        }
    # datetime.now(timezone.utc).date() / datetime.utcnow().date() /
    # datetime.now().date()
    if func.attr == "date" and not node.args and isinstance(func.value, ast.Call):
        inner = func.value
        if not isinstance(inner.func, ast.Attribute):
            return False
        if inner.func.attr == "utcnow":
            return True
        if inner.func.attr != "now":
            return False
        if not inner.args:
            return True
        arg = inner.args[0]
        # A zone the caller resolved (``datetime.now(tz)``) is the point;
        # only UTC spelled out is the server's date in disguise.
        return (isinstance(arg, ast.Attribute) and arg.attr in {"utc", "UTC"}) or (
            isinstance(arg, ast.Name) and arg.id == "UTC"
        )
    return False


def _server_today_calls():
    found = []
    for path in sorted(APP.rglob("*.py")):
        rel = path.relative_to(APP).as_posix()
        if rel == "utils/org_timezone.py":
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for func in ast.walk(tree):
            if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(func):
                if isinstance(node, ast.Call) and _is_server_today(node):
                    found.append((rel, func.name, node.lineno))
    # A call inside a nested function is seen from both; keep the innermost.
    innermost = {}
    for rel, name, line in found:
        innermost[(rel, line)] = name
    return sorted((rel, name, line) for (rel, line), name in innermost.items())


def test_no_new_code_reads_today_off_the_server_clock():
    offenders = [
        f"app/{rel}:{line} in {name}()"
        for rel, name, line in _server_today_calls()
        if (rel, name) not in ALLOWED
    ]
    assert not offenders, (
        "These read today's date from the server, which is UTC and already "
        "tomorrow for a US department every evening. Use the department's "
        "date (org_today / resolve_org_today / today_in in "
        "app/utils/org_timezone.py):\n  " + "\n  ".join(offenders)
    )


def test_every_allowance_is_still_needed():
    live = {(rel, name) for rel, name, _ in _server_today_calls()}
    stale = sorted(set(ALLOWED) - live)
    assert not stale, f"No longer reads the server's date; drop from ALLOWED: {stale}"


def test_the_detector_sees_each_spelling():
    for source in (
        "def f():\n    return date.today()",
        "def f():\n    return datetime.now(timezone.utc).date()",
        "def f():\n    return datetime.utcnow().date()",
        "def f():\n    return datetime.now().date()",
        "def f():\n    return _date.today()",
    ):
        calls = [
            n
            for n in ast.walk(ast.parse(source))
            if isinstance(n, ast.Call) and _is_server_today(n)
        ]
        assert calls, source
    resolved = "def f(tz):\n    return datetime.now(tz).date()"
    assert not [
        n
        for n in ast.walk(ast.parse(resolved))
        if isinstance(n, ast.Call) and _is_server_today(n)
    ]
