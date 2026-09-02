"""Every SQL ``LIKE``/``ILIKE`` pattern is built and escaped in one place.

A user's search string reaches SQL as a *pattern*, not a literal. SQLAlchemy
parameterizes the value, so this is not an injection risk — but ``%`` and ``_``
inside that parameter are still wildcards to the database. Two distinct
failures follow, and the codebase had both:

1. **No escaping at all.** ``pattern = f"%{search}%"`` — a member typing ``%``
   into the box matches every row in the org's table, which widens the result
   set past what the screen was gated for and turns a paginated list into a
   full scan. Found in the department-message admin list and the message-history
   endpoint.

2. **Escaping with no ``ESCAPE`` clause.** The transform runs, but
   ``.ilike(pattern)`` is emitted without ``ESCAPE '\\'``. MySQL's default
   escape character depends on ``sql_mode`` — under ``NO_BACKSLASH_ESCAPES``
   the backslashes are literal and every wildcard comes back, silently. The
   escaping looks present in review and is inert at runtime.

``app.utils.sql_search`` exists to own both halves, but only one call site used
it: the transform had been copy-pasted into fourteen more files, each of which
had to remember the ``escape=`` kwarg separately. These two tests make that
impossible to reintroduce — the invariant is exception-free, so there is no
allowlist to grow.

Declaring ``escape=`` on a system-generated pattern (``"ORD-2026-%"``) is inert
rather than wrong: the ``%`` is not preceded by a backslash, so it stays a
wildcard. That is why those four sites conform too instead of being exempted.

``.contains()`` is the third way in, and the one the first two tests missed:
it builds a LIKE too, with the term dropped in raw unless ``autoescape=True``
is passed. The public-portal access-log filter used it, so an admin searching
for ``%`` matched every row. Column ``.contains()`` on a JSON array is a
different operator entirely (``TrainingRequirement.category_ids.contains([id])``)
and is left alone.
"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
SQL_SEARCH = APP / "utils" / "sql_search.py"

#: The literal transform ``escape_like`` performs. Anywhere else, it is a copy.
_HAND_ROLLED = '.replace("%", "\\%")'


def _python_sources():
    return sorted(p for p in APP.rglob("*.py"))


def _like_calls(tree):
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("like", "ilike")
        ):
            yield node


def test_every_like_call_declares_the_escape_character():
    """No ``.like()``/``.ilike()`` may rely on the database's default escape."""
    offenders = []
    for path in _python_sources():
        source = path.read_text(encoding="utf-8")
        if ".like(" not in source and ".ilike(" not in source:
            continue
        for call in _like_calls(ast.parse(source)):
            escape = next(
                (kw.value for kw in call.keywords if kw.arg == "escape"), None
            )
            if escape is None or ast.unparse(escape) != "LIKE_ESCAPE_CHAR":
                rel = path.relative_to(APP.parent)
                got = "no escape= kwarg" if escape is None else ast.unparse(escape)
                offenders.append(f"{rel}:{call.lineno} ({got})")

    assert not offenders, (
        "These LIKE/ILIKE calls must pass escape=LIKE_ESCAPE_CHAR from "
        "app.utils.sql_search — without it the wildcard escaping is inert "
        "under MySQL's NO_BACKSLASH_ESCAPES sql_mode:\n  " + "\n  ".join(offenders)
    )


def test_wildcard_escaping_lives_only_in_sql_search():
    """The escape transform has exactly one implementation."""
    offenders = []
    for path in _python_sources():
        if path == SQL_SEARCH:
            continue
        source = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(source.splitlines(), start=1):
            if _HAND_ROLLED in line:
                offenders.append(f"{path.relative_to(APP.parent)}:{lineno}")

    assert not offenders, (
        "LIKE-wildcard escaping is duplicated here. Call "
        "app.utils.sql_search.like_pattern() instead so a fix lands once:\n  "
        + "\n  ".join(offenders)
    )


def _sql_contains_calls(tree):
    """``Model.column.contains(...)`` / ``cast(...).contains(...)`` calls.

    A bare ``value.contains(x)`` on a Python string or list is unrelated, so
    the receiver has to look like a column expression: an attribute reached
    through a capitalised name, or the result of ``cast()``.
    """
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "contains"
        ):
            continue
        receiver = node.func.value
        if (
            isinstance(receiver, ast.Call)
            and getattr(receiver.func, "id", "") == "cast"
        ):
            yield node
            continue
        if isinstance(receiver, ast.Attribute):
            root = receiver
            while isinstance(root, ast.Attribute):
                root = root.value
            if isinstance(root, ast.Name) and root.id[:1].isupper():
                yield node


def test_column_contains_escapes_its_term():
    """``.contains()`` builds a LIKE, and needs telling to escape the term."""
    offenders = []
    for path in _python_sources():
        source = path.read_text(encoding="utf-8")
        if ".contains(" not in source:
            continue
        for call in _sql_contains_calls(ast.parse(source)):
            # A JSON array containment test is a different operator and takes
            # no pattern.
            if call.args and isinstance(call.args[0], (ast.List, ast.Tuple)):
                continue
            autoescape = next(
                (kw.value for kw in call.keywords if kw.arg == "autoescape"), None
            )
            if autoescape is None or ast.unparse(autoescape) != "True":
                rel = path.relative_to(APP.parent)
                offenders.append(f"{rel}:{call.lineno} ({ast.unparse(call)[:70]})")

    assert not offenders, (
        "These column .contains() calls build a LIKE with the caller's term "
        "dropped in raw, so a '%' matches every row. Pass autoescape=True, or "
        "use like_pattern() with .like(..., escape=LIKE_ESCAPE_CHAR):\n  "
        + "\n  ".join(offenders)
    )
