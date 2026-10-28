"""Every refusal the code writes out is one ``safe_error_detail`` lets through.

Endpoints send a service's ``ValueError`` / ``PermissionError`` to the client
through ``safe_error_detail`` (``app/core/utils.py``), which replaces the
message with "An unexpected error occurred" when it is longer than
``MAX_ERROR_DETAIL_LENGTH`` or matches one of ``_UNSAFE_PATTERNS``. Those
patterns look for leaked SQL, and they match ordinary English too:
"Cannot delete ... Remove the requirement from those apparatus" reads as
``DELETE ... FROM``. Either way the person is told nothing about why they were
refused or what to do, and nothing fails, because the generic message is a
valid 400. Four refusals did exactly this until #3704 and #3735.

So this sweeps the source: every ``raise`` of ``ValueError``,
``PermissionError`` or a subclass of either, and every message a subclass
passes to ``super().__init__``, wherever the message is written out as text.
Each is sent through the real ``safe_error_detail`` and must come back
unchanged.

What the sweep can and cannot see:

* An f-string placeholder, and any non-text part of a concatenation, is read
  as a single character. A message checked here is therefore known only to
  fit with short values spliced in. A list joined into a message grows with
  the data; build it with ``list_within_detail_limit``, which keeps it under
  the cap however long the list gets.
* A message produced by a call (a helper, ``str(exc)``) is not text the sweep
  can read, and is skipped.
* A raise that never reaches ``safe_error_detail`` is still checked. That is
  deliberate: whether a service error reaches a client is decided by whichever
  endpoint calls the service, today or later.

Matching is done on the AST, in the manner of ``test_log_call_shape.py``.
"""

import ast
import functools
from pathlib import Path
from unittest.mock import patch

from app.core import utils
from app.core.utils import safe_error_detail

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"

#: Stands in for anything the sweep cannot read as text: an f-string
#: placeholder, or a non-text part of a concatenation.
PLACEHOLDER = "X"

REFUSAL_BASES = frozenset({"ValueError", "PermissionError"})


def _python_sources():
    return sorted(APP.rglob("*.py"))


def _base_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _refusal_classes(class_defs):
    """The refusal base names plus every class in ``class_defs`` derived from one."""
    names = set(REFUSAL_BASES)
    classes = list(class_defs)
    grew = True
    while grew:
        grew = False
        for cls in classes:
            if cls.name not in names and any(
                _base_name(base) in names for base in cls.bases
            ):
                names.add(cls.name)
                grew = True
    return names


def _module_constants(tree):
    """Module-level ``NAME = "text"`` assignments, as written."""
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target, value = node.targets[0], node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            target, value = node.target, node.value
        else:
            continue
        if isinstance(target, ast.Name):
            text = _message_text(value, {})
            if text is not None:
                constants[target.id] = text
    return constants


def _message_text(node, constants):
    """The text of a message expression, or None if it is not written out."""
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.JoinedStr):
        return "".join(
            part.value if isinstance(part, ast.Constant) else PLACEHOLDER
            for part in node.values
        )
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _message_text(node.left, constants)
        right = _message_text(node.right, constants)
        if left is None and right is None:
            return None
        return (left or PLACEHOLDER) + (right or PLACEHOLDER)
    return None


def _message_argument(call):
    if call.args:
        return call.args[0]
    return next(
        (kw.value for kw in call.keywords if kw.arg in {"message", "msg", "detail"}),
        None,
    )


def _is_super_init(call):
    func = call.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "__init__"
        and isinstance(func.value, ast.Call)
        and isinstance(func.value.func, ast.Name)
        and func.value.func.id == "super"
    )


def _refusals(tree, nodes, refusal_classes):
    """Yield ``(lineno, text)`` for each refusal message written out as text.

    ``nodes`` is ``list(ast.walk(tree))``, walked once by the caller and shared
    with the subclass search.
    """
    constants = _module_constants(tree)
    for node in nodes:
        if (
            isinstance(node, ast.Raise)
            and isinstance(node.exc, ast.Call)
            and _base_name(node.exc.func) in refusal_classes
        ):
            call = node.exc
        elif isinstance(node, ast.ClassDef) and node.name in refusal_classes:
            # A subclass that composes its own message hands it to
            # super().__init__, so its raise sites pass data, not the text.
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call) and _is_super_init(inner):
                    argument = _message_argument(inner)
                    text = argument and _message_text(argument, constants)
                    if text is not None:
                        yield inner.lineno, text
            continue
        else:
            continue
        argument = _message_argument(call)
        text = argument and _message_text(argument, constants)
        if text is not None:
            yield node.lineno, text


def _sent_to_client(text):
    """What ``safe_error_detail`` would send for a refusal with this message."""
    with patch.object(utils, "logger"):
        return safe_error_detail(ValueError(text))


@functools.cache
def _app_refusals():
    """Every written-out refusal in ``app/`` as ``(path, lineno, text)``.

    Cached because parsing the whole of ``app/`` takes several seconds and two
    tests read the result; the per-test timeout is 30.
    """
    parsed = []
    for path in _python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        parsed.append((path, tree, list(ast.walk(tree))))
    refusal_classes = _refusal_classes(
        node
        for _, _, nodes in parsed
        for node in nodes
        if isinstance(node, ast.ClassDef)
    )
    return tuple(
        (path, lineno, text)
        for path, tree, nodes in parsed
        for lineno, text in _refusals(tree, nodes, refusal_classes)
    )


def test_every_refusal_reaches_the_client_as_written():
    offenders = []
    for path, lineno, text in _app_refusals():
        if _sent_to_client(text) != text:
            why = (
                f"{len(text)} characters"
                if len(text) > utils.MAX_ERROR_DETAIL_LENGTH
                else "matches an _UNSAFE_PATTERNS entry"
            )
            offenders.append(
                f"{path.relative_to(BACKEND)}:{lineno} ({why}): {text[:90]!r}"
            )

    assert not offenders, (
        "safe_error_detail replaces these refusals with 'An unexpected error "
        f"occurred', because they run past {utils.MAX_ERROR_DETAIL_LENGTH} "
        "characters or read like leaked SQL ('delete ... from', 'select ... "
        "from'). Shorten or reword the message; build a list into it with "
        "list_within_detail_limit:\n  " + "\n  ".join(offenders)
    )


def _found(source, extra_classes=()):
    tree = ast.parse(source)
    nodes = list(ast.walk(tree))
    classes = _refusal_classes(n for n in nodes if isinstance(n, ast.ClassDef))
    return [text for _, text in _refusals(tree, nodes, classes | set(extra_classes))]


def test_the_sweep_reads_each_shape_of_message():
    assert _found('raise ValueError("plain")') == ["plain"]
    assert _found('raise PermissionError(f"no {who} here")') == ["no X here"]
    assert _found('raise ValueError("a " + "b")') == ["a b"]
    assert _found('raise ValueError("listed: " + ", ".join(xs))') == ["listed: X"]
    assert _found('MSG = "kept"\nraise ValueError(MSG)') == ["kept"]
    assert _found('raise ValueError("why") from exc') == ["why"]
    assert _found('raise CodedValueError(message="coded")', {"CodedValueError"}) == [
        "coded"
    ]


def test_the_sweep_follows_subclasses_and_their_own_messages():
    source = (
        "class InUse(ValueError):\n"
        "    def __init__(self, count):\n"
        '        super().__init__(f"Still holds {count} items.")\n'
        "class StillInUse(InUse):\n"
        "    pass\n"
        'raise StillInUse("direct")\n'
    )
    assert sorted(_found(source)) == ["Still holds X items.", "direct"]


def test_the_sweep_skips_what_it_cannot_read():
    assert _found("raise ValueError(str(exc))") == []
    assert _found("raise ValueError(build_message(x))") == []
    assert _found("raise ValueError()") == []
    assert _found('raise RuntimeError("not a refusal")') == []


def test_the_check_refuses_what_safe_error_detail_hides():
    """The two ways a refusal disappeared, against the real sanitizer."""
    readable = "Cannot delete this level. Clear it on those apparatus first."
    assert _sent_to_client(readable) == readable

    reads_as_sql = "Cannot delete this level. Remove it from those apparatus first."
    assert _sent_to_client(reads_as_sql) != reads_as_sql

    too_long = "x" * (utils.MAX_ERROR_DETAIL_LENGTH + 1)
    assert _sent_to_client(too_long) != too_long


def test_the_sweep_actually_reaches_the_refusals():
    """A sweep that silently stopped finding raises would pass forever."""
    seen = len(_app_refusals())
    # About 1,860 written-out refusals existed when this was written; the floor
    # only has to prove the walk is reaching them.
    assert seen > 1000
