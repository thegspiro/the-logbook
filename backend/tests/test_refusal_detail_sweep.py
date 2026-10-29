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
  fit with short values spliced in.
* A list joined into a message grows with the data, so the second check fails
  on any ``.join`` in a refusal whose list the source does not show is fixed
  in size: a constant, an enum, a slice with a fixed end, or a local built only
  from those. Build such a message with ``list_within_detail_limit``, which
  keeps it under the cap however long the list gets. Names the message reads
  are followed back to what they were bound to in the same function or the
  module, so a join assembled into a variable before the ``raise`` is read
  too; one that crosses into another function is not.
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


class _MessageSites(ast.NodeVisitor):
    """Collect each refusal message expression with its enclosing function.

    A site is a ``raise`` of a refusal class, or a ``super().__init__`` call
    inside a refusal class: a subclass that composes its own message hands it
    there, so its raise sites pass data rather than the text.
    """

    def __init__(self, refusal_classes):
        self.refusal_classes = refusal_classes
        self.functions = [None]
        self.classes = [None]
        self.sites = []

    def _visit_function(self, node):
        self.functions.append(node)
        self.generic_visit(node)
        self.functions.pop()

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function

    def visit_ClassDef(self, node):
        self.classes.append(node.name)
        self.generic_visit(node)
        self.classes.pop()

    def _record(self, lineno, call):
        argument = _message_argument(call)
        if argument is not None:
            self.sites.append((lineno, argument, self.functions[-1]))

    def visit_Raise(self, node):
        if (
            isinstance(node.exc, ast.Call)
            and _base_name(node.exc.func) in self.refusal_classes
        ):
            self._record(node.lineno, node.exc)
        self.generic_visit(node)

    def visit_Call(self, node):
        if self.classes[-1] in self.refusal_classes and _is_super_init(node):
            self._record(node.lineno, node)
        self.generic_visit(node)


def _message_sites(tree, refusal_classes):
    """``(lineno, message expression, enclosing function)`` for each refusal."""
    visitor = _MessageSites(refusal_classes)
    visitor.visit(tree)
    return visitor.sites


def _refusals(tree, sites):
    """Yield ``(lineno, text)`` for each refusal message written out as text."""
    constants = _module_constants(tree)
    for lineno, argument, _ in sites:
        text = _message_text(argument, constants)
        if text is not None:
            yield lineno, text


#: Calls that hand back a collection no larger than the one they were given.
_SIZE_PRESERVING = frozenset(
    {"sorted", "list", "tuple", "set", "frozenset", "reversed"}
)
_DICT_VIEWS = frozenset({"keys", "values", "items"})
_GROWING_METHODS = frozenset({"append", "add", "extend", "update", "insert"})


def _is_constant_name(name):
    """``CONSTANT``, ``_CONSTANT`` or a class such as an enum: fixed in size."""
    bare = name.lstrip("_")
    return bool(bare) and bare[0].isupper()


def _assignments(scope):
    """Each name bound in ``scope``, with every value it is bound to.

    A value of None means the name is bound in a way whose size cannot be read:
    a parameter, a loop or unpacking target, an augmented assignment, or a
    collection grown by ``.append`` and its kin.
    """
    bound = {}
    if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
        arguments = scope.args
        for arg in [
            *arguments.posonlyargs,
            *arguments.args,
            *arguments.kwonlyargs,
            arguments.vararg,
            arguments.kwarg,
        ]:
            if arg is not None:
                bound.setdefault(arg.arg, []).append(None)
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    bound.setdefault(target.id, []).append(node.value)
                else:
                    for name in ast.walk(target):
                        if isinstance(name, ast.Name):
                            bound.setdefault(name.id, []).append(None)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            bound.setdefault(node.target.id, []).append(node.value)
        elif isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name):
            bound.setdefault(node.target.id, []).append(None)
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            for name in ast.walk(node.target):
                if isinstance(name, ast.Name):
                    bound.setdefault(name.id, []).append(None)
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in _GROWING_METHODS
            and isinstance(node.func.value, ast.Name)
        ):
            bound.setdefault(node.func.value.id, []).append(None)
    return bound


def _is_bounded(node, scopes, seen=frozenset()):
    """Whether ``node`` is a collection of fixed size, as far as the source says.

    Fixed means it comes from the code rather than from data: a literal, a
    constant or enum, a slice with a fixed end, a comprehension over one of
    those, or a name every one of whose bindings is one of those. ``scopes``
    is the enclosing function's bindings, then the module's.
    """
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.Name):
        if _is_constant_name(node.id):
            return True
        if node.id in seen:
            return False
        for scope in scopes:
            if node.id in scope:
                values = scope[node.id]
                return all(
                    value is not None and _is_bounded(value, scopes, seen | {node.id})
                    for value in values
                )
        return False
    if isinstance(node, ast.Attribute):
        # Status.ALL, or self._FIELDS: a constant reached through its owner.
        return _is_constant_name(node.attr) or (
            isinstance(node.value, ast.Name) and _is_constant_name(node.value.id)
        )
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name) and func.id in _SIZE_PRESERVING:
            return bool(node.args) and _is_bounded(node.args[0], scopes, seen)
        if isinstance(func, ast.Attribute) and func.attr in _DICT_VIEWS:
            return _is_bounded(func.value, scopes, seen)
        return False
    if isinstance(node, ast.Subscript):
        index = node.slice
        return (
            isinstance(index, ast.Slice)
            and isinstance(index.upper, ast.Constant)
            and isinstance(index.upper.value, int)
        )
    if isinstance(node, (ast.GeneratorExp, ast.ListComp, ast.SetComp)):
        return all(_is_bounded(gen.iter, scopes, seen) for gen in node.generators)
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return all(
            _is_bounded(elt.value, scopes, seen)
            for elt in node.elts
            if isinstance(elt, ast.Starred)
        )
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, ast.Sub):
            return _is_bounded(node.left, scopes, seen)
        if isinstance(node.op, ast.BitAnd):
            return _is_bounded(node.left, scopes, seen) or _is_bounded(
                node.right, scopes, seen
            )
        if isinstance(node.op, (ast.BitOr, ast.Add)):
            return _is_bounded(node.left, scopes, seen) and _is_bounded(
                node.right, scopes, seen
            )
    return False


def _message_expressions(argument, scopes):
    """The message expression, plus every value bound to a name it reads.

    Followed transitively, so a join that builds ``shown`` two assignments
    before ``raise ValueError(f"Unknown: {shown}")`` is read as part of the
    message. A name is looked up in the innermost scope that binds it; a
    binding whose value cannot be read (a parameter, a loop target) adds
    nothing.
    """
    expressions, pending, followed = [], [argument], set()
    while pending:
        expression = pending.pop()
        expressions.append(expression)
        for node in ast.walk(expression):
            if not (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)):
                continue
            if node.id in followed:
                continue
            followed.add(node.id)
            scope = next((scope for scope in scopes if node.id in scope), {})
            pending.extend(value for value in scope.get(node.id, ()) if value)
    return expressions


def _unbounded_joins(tree, sites):
    """Yield ``(lineno, joined source)`` for each join of data into a refusal."""
    top_level = [
        node for node in tree.body if isinstance(node, (ast.Assign, ast.AnnAssign))
    ]
    module_scope = _assignments(ast.Module(body=top_level, type_ignores=[]))
    function_scopes = {}
    for lineno, argument, function in sites:
        if function is None:
            scopes = (module_scope,)
        else:
            if function not in function_scopes:
                function_scopes[function] = _assignments(function)
            scopes = (function_scopes[function], module_scope)
        for expression in _message_expressions(argument, scopes):
            for node in ast.walk(expression):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "join"
                    and node.args
                    and not _is_bounded(node.args[0], scopes)
                ):
                    yield lineno, ast.unparse(node.args[0])


def _sent_to_client(text):
    """What ``safe_error_detail`` would send for a refusal with this message."""
    with patch.object(utils, "logger"):
        return safe_error_detail(ValueError(text))


@functools.cache
def _app_sweep():
    """Every refusal in ``app/``, read once.

    Returns ``(refusals, joins)``: written-out messages as
    ``(path, lineno, text)``, and joins of data into a message as
    ``(path, lineno, joined source)``. Cached because parsing the whole of
    ``app/`` takes several seconds and several tests read the result; the
    per-test timeout is 30.
    """
    parsed = [
        (path, ast.parse(path.read_text(encoding="utf-8")))
        for path in _python_sources()
    ]
    refusal_classes = _refusal_classes(
        node
        for _, tree in parsed
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
    )
    refusals, joins = [], []
    for path, tree in parsed:
        sites = _message_sites(tree, refusal_classes)
        refusals.extend((path, lineno, text) for lineno, text in _refusals(tree, sites))
        joins.extend(
            (path, lineno, joined) for lineno, joined in _unbounded_joins(tree, sites)
        )
    return tuple(refusals), tuple(joins)


def _app_refusals():
    return _app_sweep()[0]


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


def _sites(source, extra_classes=()):
    tree = ast.parse(source)
    classes = _refusal_classes(
        node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)
    )
    return tree, _message_sites(tree, classes | set(extra_classes))


#: A ValueError raised in a Pydantic validator becomes a 422 that Pydantic
#: builds itself; it never passes through safe_error_detail, so the cap that
#: makes a joined list dangerous does not apply. Their lists are enum values
#: and field names.
JOINS_NOT_SENT_THROUGH_SAFE_ERROR_DETAIL = ("app/schemas/",)

#: Joins whose size the source cannot show is bounded, but which are, each
#: with the reason. Keyed by file and the joined expression as written, so a
#: moved line does not stale the entry and a changed expression does.
BOUNDED_JOINS = {
    ("app/models/grant.py", "allowed"): (
        "allowed_next_statuses(): a subset of the ApplicationStatus enum"
    ),
    ("app/services/inventory_service.py", "parts"): (
        "StorageAreaNotEmptyError builds at most two parts: items and nested areas"
    ),
    ("app/services/event_service.py", "sorted(changed)"): (
        "an attendance-lock refusal: attendance_lock_http_error sends it without "
        "the length cap, and it lists field names"
    ),
    ("app/services/event_service.py", "sorted(sensitive)"): (
        "an attendance-lock refusal: attendance_lock_http_error sends it without "
        "the length cap, and it lists field names"
    ),
    ("app/services/file_storage_service.py", "remote_storage.labels().values()"): (
        "the remote storage platforms registered in code"
    ),
    ("app/services/minutes_record_service.py", "failed"): (
        "SuggestionApplyConflict has its own 409 handler, which sends the message "
        "and the failed ids without safe_error_detail"
    ),
}


def _app_unbounded_joins():
    return [
        (path, lineno, joined)
        for path, lineno, joined in _app_sweep()[1]
        if not str(path.relative_to(BACKEND)).startswith(
            JOINS_NOT_SENT_THROUGH_SAFE_ERROR_DETAIL
        )
    ]


def test_no_refusal_joins_a_list_that_grows_with_the_data():
    offenders = [
        f"{path.relative_to(BACKEND)}:{lineno}: ', '.join({joined})"
        for path, lineno, joined in _app_unbounded_joins()
        if (str(path.relative_to(BACKEND)), joined) not in BOUNDED_JOINS
    ]

    assert not offenders, (
        "These refusals join a list whose length comes from data -- ids the "
        "client sent, names an organization chose, rows that matched -- so "
        f"enough of them push the message past {utils.MAX_ERROR_DETAIL_LENGTH} "
        "characters and safe_error_detail sends 'An unexpected error occurred' "
        "instead. Build the message with list_within_detail_limit, which keeps "
        "what fits and counts the rest. If the list really is fixed in size, add "
        "it to BOUNDED_JOINS with the reason:\n  " + "\n  ".join(offenders)
    )


def test_every_bounded_join_entry_still_matches_a_join():
    """An entry for a join that has gone would excuse the next one written."""
    present = {
        (str(path.relative_to(BACKEND)), joined)
        for path, _, joined in _app_unbounded_joins()
    }
    stale = sorted(set(BOUNDED_JOINS) - present)
    assert not stale, f"BOUNDED_JOINS entries that match nothing: {stale}"


def _found(source, extra_classes=()):
    tree, sites = _sites(source, extra_classes)
    return [text for _, text in _refusals(tree, sites)]


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


def _joins(source):
    tree, sites = _sites(source)
    return [joined for _, joined in _unbounded_joins(tree, sites)]


def test_the_join_check_flags_lists_that_come_from_data():
    assert _joins('def f(ids):\n    raise ValueError(", ".join(ids))') == ["ids"]
    assert _joins(
        "def f(rows):\n"
        "    names = [r.name for r in rows]\n"
        "    raise ValueError(f\"Blocked: {', '.join(names)}\")"
    ) == ["names"]
    assert _joins(
        "def f(rows):\n"
        "    names = []\n"
        "    for r in rows:\n"
        "        names.append(r.name)\n"
        '    raise ValueError(", ".join(sorted(names)))'
    ) == ["sorted(names)"]
    assert _joins(
        "class Taken(ValueError):\n"
        "    def __init__(self, ids):\n"
        '        super().__init__("Taken: " + ", ".join(ids))'
    ) == ["ids"]


def test_the_join_check_follows_variables_built_before_the_raise():
    assert _joins(
        "def f(ids):\n"
        '    shown = ", ".join(ids)\n'
        '    raise ValueError(f"Unknown: {shown}")'
    ) == ["ids"]
    # Through a second variable, and when the message itself is a variable.
    assert _joins(
        "def f(rows):\n"
        "    names = [r.name for r in rows]\n"
        '    shown = ", ".join(names)\n'
        '    message = "Blocked: " + shown\n'
        "    raise ValueError(message)"
    ) == ["names"]
    # A capped variable is still capped.
    assert (
        _joins(
            "def f(ids):\n"
            '    shown = ", ".join(ids[:3])\n'
            '    raise ValueError(f"Unknown: {shown}")'
        )
        == []
    )
    # A name bound twice in a cycle is followed once.
    assert (
        _joins("def f(a):\n" "    b = a\n" "    a = b\n" '    raise ValueError(f"{a}")')
        == []
    )


def test_the_join_check_leaves_fixed_lists_alone():
    assert _joins('raise ValueError(", ".join(STATUSES))') == []
    assert _joins('raise ValueError(", ".join(s.value for s in Status))') == []
    assert _joins('raise ValueError(", ".join(sorted(Mode.ALL)))') == []
    assert (
        _joins(
            "def f(self, updates):\n"
            "    bad = sorted(k for k in self._FORBIDDEN & updates.keys())\n"
            '    raise ValueError(", ".join(bad))'
        )
        == []
    )
    assert _joins("def f(ids):\n" '    raise ValueError(", ".join(ids[:3]))') == []
    assert (
        _joins(
            "def f():\n"
            "    valid = {e.value for e in Kind}\n"
            '    raise ValueError(", ".join(sorted(valid)))'
        )
        == []
    )
    # Already capped: no join left to measure.
    assert (
        _joins(
            'def f(ids):\n    raise ValueError(list_within_detail_limit("X: ", ids))'
        )
        == []
    )


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
