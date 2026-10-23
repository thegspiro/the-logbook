"""No log call both interpolates an f-string and passes formatting arguments.

Loguru runs the message through ``str.format`` whenever positional or keyword
arguments are supplied, and stdlib ``logging`` runs it through ``%`` whenever
positional arguments are. An f-string message has already had its values
spliced in by then, so the second pass re-parses *those values* as a format
string. A member who types ``{x}`` into a search box turns

    logger.info(f"Search by {term} in {{}}", org_id)

into a ``KeyError`` raised from the logging line, and the request fails on its
way to recording what it was doing. CLAUDE.md Pitfall #33 states the rule.

This sweep covers that one shape because it is the shape a static check can
decide. The other half of Pitfall #33 — an f-string that splices user text
carrying a newline into the text and file sinks — depends on where the value
came from, which the AST does not say, so it remains review discipline.

Matching is done on the AST, in the manner of ``test_csv_writer_sweep.py``, so
a docstring or comment quoting the banned shape is not mistaken for one.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"
SCRIPTS = BACKEND / "scripts"

LOG_METHODS = {
    "trace",
    "debug",
    "info",
    "success",
    "warning",
    "warn",
    "error",
    "exception",
    "critical",
    "log",
}

#: Receivers treated as a logger. ``audit_logger`` is deliberately absent: it
#: is ``AuditLogger`` from ``app/core/audit.py``, whose methods take structured
#: fields rather than a format string.
LOGGER_NAMES = {"logger", "log", "_logger", "_log", "LOGGER"}


def _python_sources():
    return sorted(
        path for root in (APP, SCRIPTS) if root.is_dir() for path in root.rglob("*.py")
    )


def _imports_loguru_logger(tree):
    """True when the module binds Loguru's ``logger``.

    It matters for keyword arguments only: Loguru formats on them too, while
    stdlib ``logging`` treats ``exc_info=``/``extra=`` as options and formats on
    positional arguments alone.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "loguru":
            if any(alias.name == "logger" for alias in node.names):
                return True
    return False


def _receiver_is_logger(func):
    value = func.value
    if isinstance(value, ast.Name):
        return value.id in LOGGER_NAMES
    # logger.opt(...).info(...) and logger.bind(...).info(...)
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
        return value.func.attr in {"opt", "bind"} and _receiver_is_logger(value.func)
    return False


def _reformatted_fstring_calls(tree):
    """Yield the line of each log call whose f-string message is formatted again."""
    loguru = _imports_loguru_logger(tree)
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in LOG_METHODS
            and _receiver_is_logger(node.func)
        ):
            continue
        # logger.log("INFO", msg, ...) carries the level first.
        message_index = 1 if node.func.attr == "log" else 0
        if len(node.args) <= message_index:
            continue
        if not isinstance(node.args[message_index], ast.JoinedStr):
            continue
        has_positional = len(node.args) > message_index + 1
        has_keywords = loguru and bool(node.keywords)
        if has_positional or has_keywords:
            yield node.lineno


def test_no_fstring_log_message_is_formatted_twice():
    offenders = []
    for path in _python_sources():
        source = path.read_text(encoding="utf-8")
        for lineno in _reformatted_fstring_calls(ast.parse(source)):
            offenders.append(f"{path.relative_to(BACKEND)}:{lineno}")

    assert not offenders, (
        "These log calls splice values into an f-string and then pass "
        "formatting arguments as well, so a '{' or '%' in a spliced value is "
        "re-parsed and raises at the logging line. Pass every value as an "
        "argument instead — logger.info('Search by {!r} in {}', term, org_id) "
        "— see CLAUDE.md Pitfall #33:\n  " + "\n  ".join(offenders)
    )


def _calls(source):
    return list(_reformatted_fstring_calls(ast.parse(source)))


def test_the_sweep_flags_each_shape_it_claims_to():
    loguru = "from loguru import logger\n"
    assert _calls(loguru + 'logger.info(f"a {x} {{}}", y)\n') == [2]
    assert _calls(loguru + 'logger.info(f"a {x} {{n}}", n=y)\n') == [2]
    assert _calls(loguru + 'logger.log("INFO", f"a {x} {{}}", y)\n') == [2]
    assert _calls(loguru + 'logger.opt(depth=1).warning(f"a {x} {{}}", y)\n') == [2]
    assert _calls(
        'import logging\nlog = logging.getLogger()\nlog.info(f"a {x} %s", y)\n'
    ) == [3]


def test_the_sweep_leaves_the_correct_shapes_alone():
    loguru = "from loguru import logger\n"
    assert _calls(loguru + 'logger.info(f"a {x}")\n') == []
    assert _calls(loguru + 'logger.info("a {!r} {}", x, y)\n') == []
    assert _calls(loguru + 'logger.log("INFO", f"a {x}")\n') == []
    # stdlib treats keyword arguments as options, not as format values
    assert (
        _calls(
            'import logging\nlog = logging.getLogger()\nlog.error(f"a {x}", exc_info=True)\n'
        )
        == []
    )
    # AuditLogger is not a format-string logger
    assert _calls('audit_logger.info(f"a {x}", y)\n') == []


def test_the_sweep_actually_reaches_the_logging_code():
    """A sweep that silently stopped finding log calls would pass forever."""
    seen = 0
    for path in _python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in LOG_METHODS
                and _receiver_is_logger(node.func)
                and node.args
                and isinstance(node.args[0], ast.JoinedStr)
            ):
                seen += 1
    # Over six hundred f-string log calls existed when this was written; the
    # floor only has to prove the walk is reaching them.
    assert seen > 100
