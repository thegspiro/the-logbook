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
  are followed back to what they were bound to, and calls it makes are
  followed into the called function's ``return`` values, with its parameters
  bound to what the call passed, up to ``MAX_CALL_DEPTH`` calls deep. A call
  is followed when it names a function in the same module or imported from
  ``app``, a function through an imported ``app`` module, or a method on an
  object whose class the source shows: ``self`` or ``cls``, the class itself,
  a class built inline (``FooService(db).describe(...)``), a name assigned
  from one, a parameter annotated with one, or a ``self`` attribute some
  method assigns or annotates that way. The method is looked up on that class
  and then its bases. An object whose class only the running program knows
  -- one returned from a call, or held in a container -- is not followed.
* A message produced by a call is not text the first check can read, and is
  skipped there; the second check reads into it as above.
* A raise that never reaches ``safe_error_detail`` is still checked. That is
  deliberate: whether a service error reaches a client is decided by whichever
  endpoint calls the service, today or later.

Matching is done on the AST, in the manner of ``test_log_call_shape.py``.
"""

import ast
import functools
from pathlib import Path
from typing import NamedTuple
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


class _ModuleFacts(ast.NodeVisitor):
    """Everything the sweep needs from one module, read in a single pass.

    Its classes, its ``from app... import`` names, each function's nearest
    enclosing class, and every place a refusal message could be: a ``raise``
    of a call, or a ``super().__init__`` call inside a class. Which of those
    are refusals is settled by :meth:`sites` once every module's classes are
    known, since a refusal class may be defined anywhere.
    """

    def __init__(self, module):
        self.module = module
        self.class_defs = []
        self.imports = {}
        self.owners = {}
        self._functions = [None]
        self._classes = [None]
        self._candidates = []

    @classmethod
    def read(cls, tree, module):
        facts = cls(module)
        facts.visit(tree)
        return facts

    def _visit_function(self, node):
        self.owners[id(node)] = (self.module, self._classes[-1])
        self._functions.append(node)
        self.generic_visit(node)
        self._functions.pop()

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function

    def visit_ClassDef(self, node):
        self.class_defs.append(node)
        self._classes.append(node.name)
        self.generic_visit(node)
        self._classes.pop()

    def visit_ImportFrom(self, node):
        if (node.module or "").startswith("app"):
            for alias in node.names:
                self.imports[alias.asname or alias.name] = (node.module, alias.name)

    def visit_Raise(self, node):
        if isinstance(node.exc, ast.Call):
            self._candidates.append(
                (_base_name(node.exc.func), node.lineno, node.exc, self._functions[-1])
            )
        self.generic_visit(node)

    def visit_Call(self, node):
        # A subclass that composes its own message hands it to
        # super().__init__, so its raise sites pass data rather than the text.
        if self._classes[-1] is not None and _is_super_init(node):
            self._candidates.append(
                (self._classes[-1], node.lineno, node, self._functions[-1])
            )
        self.generic_visit(node)

    def sites(self, refusal_classes):
        """``(lineno, message expression, enclosing function)`` per refusal."""
        sites = []
        for name, lineno, call, function in self._candidates:
            if name in refusal_classes:
                argument = _message_argument(call)
                if argument is not None:
                    sites.append((lineno, argument, function))
        return sites


def _message_sites(tree, refusal_classes):
    """``(lineno, message expression, enclosing function)`` for each refusal."""
    return _ModuleFacts.read(tree, None).sites(refusal_classes)


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
        for scope in scopes:
            if node.id in scope:
                key = (id(scope), node.id)
                if key in seen:
                    return False
                return all(
                    _is_bounded_value(value, scopes, seen | {key})
                    for value in scope[node.id]
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
        if not isinstance(index, ast.Slice) or index.upper is None:
            return False
        upper = index.upper
        if isinstance(upper, ast.Constant):
            return isinstance(upper.value, int)
        # xs[:_SHOWN]: a slice ending at a constant is as fixed as a literal.
        return isinstance(upper, (ast.Name, ast.Attribute)) and _is_constant_name(
            _base_name(upper)
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


class _Argument(NamedTuple):
    """What a call passed for a parameter, with the caller's scopes to read it in."""

    expression: ast.expr
    scopes: tuple


def _is_bounded_value(value, scopes, seen):
    if value is None:
        return False
    if isinstance(value, _Argument):
        return _is_bounded(value.expression, value.scopes, seen)
    return _is_bounded(value, scopes, seen)


#: How many calls deep a message is followed into the functions that build it.
MAX_CALL_DEPTH = 3

#: Callees not followed: they bound what they are given by construction.
SELF_LIMITING_HELPERS = frozenset({("app/core/utils.py", "list_within_detail_limit")})


def _module_scope(tree):
    top_level = [
        node for node in tree.body if isinstance(node, (ast.Assign, ast.AnnAssign))
    ]
    return _assignments(ast.Module(body=top_level, type_ignores=[]))


def _own_nodes(function):
    """The nodes of ``function`` itself, not of functions or classes nested in it."""
    pending = list(ast.iter_child_nodes(function))
    while pending:
        node = pending.pop()
        yield node
        if not isinstance(
            node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
        ):
            pending.extend(ast.iter_child_nodes(node))


def _decorator_names(function):
    return {_base_name(d) for d in function.decorator_list}


class _Index:
    """Where each function and method in ``app/`` is, and what each module imports.

    Enough to resolve the calls a refusal message makes: a function in the same
    module or imported from ``app``, a function through an imported ``app``
    module, and a method -- through ``self``, ``cls`` or its class, or through
    an object whose class the source shows (see :meth:`class_of`), looked up
    on that class and then its bases.
    """

    def __init__(self, modules):
        """``modules`` is ``(module name, tree, _ModuleFacts)`` for each module."""
        self.trees = {}
        self.functions = {}
        self.methods = {}
        self.owners = {}
        self.imports = {}
        self.class_defs = {}
        self._module_scopes = {}
        self._local_scopes = {}
        self._attribute_values = {}
        for name, tree, facts in modules:
            self.trees[name] = tree
            self.imports[name] = facts.imports
            self.owners.update(facts.owners)
            functions = {}
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions[node.name] = node
                elif isinstance(node, ast.ClassDef):
                    self.class_defs[(name, node.name)] = node
                    self.methods[(name, node.name)] = {
                        item.name: item
                        for item in node.body
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                    }
            self.functions[name] = functions

    @staticmethod
    def relative(path):
        return str(Path(path).relative_to(BACKEND))

    def module_file(self, dotted):
        base = dotted.replace(".", "/")
        for candidate in (f"{base}.py", f"{base}/__init__.py"):
            if candidate in self.trees:
                return candidate
        return None

    def module_scope(self, module):
        if module not in self._module_scopes:
            self._module_scopes[module] = _module_scope(self.trees[module])
        return self._module_scopes[module]

    def local_scope(self, function):
        if id(function) not in self._local_scopes:
            self._local_scopes[id(function)] = _assignments(function)
        return self._local_scopes[id(function)]

    def _imported(self, module, name):
        """``(module file, original name)`` that ``name`` was imported as, if any."""
        target = self.imports.get(module, {}).get(name)
        if target is None:
            return None, None
        dotted, original = target
        submodule = self.module_file(f"{dotted}.{original}")
        if submodule is not None:
            return submodule, None
        return self.module_file(dotted), original

    def class_named(self, node, module):
        """``(module, class)`` for a name or ``module.Class`` naming an app class."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                node = ast.parse(node.value, mode="eval").body
            except SyntaxError:
                return None
        if isinstance(node, ast.Subscript):
            # Optional[FooService]
            return self.class_named(node.slice, module)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            # FooService | None
            return self.class_named(node.left, module) or self.class_named(
                node.right, module
            )
        if isinstance(node, ast.Name):
            if (module, node.id) in self.class_defs:
                return (module, node.id)
            source, original = self._imported(module, node.id)
            if source is not None and (source, original) in self.class_defs:
                return (source, original)
            return None
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            source, original = self._imported(module, node.value.id)
            if source is not None and original is None:
                if (source, node.attr) in self.class_defs:
                    return (source, node.attr)
        return None

    def method(self, class_ref, name, seen=frozenset()):
        """``name`` on the class ``class_ref`` or, failing that, on its bases."""
        if class_ref is None or class_ref in seen:
            return None
        found = self.methods.get(class_ref, {}).get(name)
        if found is not None:
            return found
        class_module = class_ref[0]
        for base in self.class_defs[class_ref].bases:
            found = self.method(
                self.class_named(base, class_module), name, seen | {class_ref}
            )
            if found is not None:
                return found
        return None

    def attribute_values(self, class_ref):
        """What each ``self.<attr>`` is assigned or annotated as, in any method."""
        if class_ref not in self._attribute_values:
            values = {}
            for node in ast.walk(self.class_defs[class_ref]):
                if isinstance(node, ast.Assign):
                    targets, value = node.targets, node.value
                elif isinstance(node, ast.AnnAssign):
                    targets, value = [node.target], node.annotation
                else:
                    continue
                for target in targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == "self"
                    ):
                        values.setdefault(target.attr, []).append(value)
            self._attribute_values[class_ref] = values
        return self._attribute_values[class_ref]

    def class_of(self, node, frame, seen=frozenset()):
        """The ``(module, class)`` of the object ``node`` evaluates to, if shown.

        The source shows it when the object is built by calling the class
        (``FooService(db)``), comes from a name every binding of which is such
        a call, is a parameter annotated with the class, or is a ``self``
        attribute some method of the class assigns or annotates that way.
        """
        if isinstance(node, ast.Await):
            return self.class_of(node.value, frame, seen)
        if isinstance(node, ast.Call):
            return self.class_named(node.func, frame.module)
        if isinstance(node, ast.Attribute):
            if (
                isinstance(node.value, ast.Name)
                and node.value.id == "self"
                and frame.owner_class is not None
            ):
                owner = (frame.module, frame.owner_class)
                for value in self.attribute_values(owner).get(node.attr, []):
                    found = self.class_of(value, frame, seen) or self.class_named(
                        value, frame.module
                    )
                    if found is not None:
                        return found
            return None
        if not isinstance(node, ast.Name) or node.id in seen:
            return None
        if node.id in ("self", "cls"):
            if frame.owner_class is None:
                return None
            return (frame.module, frame.owner_class)
        seen = seen | {node.id}
        if frame.function is not None:
            arguments = frame.function.args
            for param in [
                *arguments.posonlyargs,
                *arguments.args,
                *arguments.kwonlyargs,
            ]:
                if param.arg == node.id and param.annotation is not None:
                    found = self.class_named(param.annotation, frame.module)
                    if found is not None:
                        return found
        scope = next((s for s in frame.scopes if node.id in s), None)
        if scope is None:
            return None
        found = None
        for value in scope[node.id]:
            if isinstance(value, _Argument):
                value_class = self.class_of(
                    value.expression, frame._replace(scopes=value.scopes), seen
                )
            elif value is not None:
                value_class = self.class_of(value, frame, seen)
            else:
                continue
            if value_class is None or (found is not None and value_class != found):
                return None
            found = value_class
        return found

    def resolve(self, func, frame):
        """``(definition, first parameter is implicit)`` for a call, or None.

        The flag says the call binds the callee's first parameter itself: a
        method called on an instance, or a classmethod on its class.
        """
        module = frame.module
        if isinstance(func, ast.Name):
            local = self.functions.get(module, {}).get(func.id)
            if local is not None:
                return local, False
            source, original = self._imported(module, func.id)
            if source is not None and original is not None:
                found = self.functions.get(source, {}).get(original)
                if found is not None:
                    return found, False
            return None
        if not isinstance(func, ast.Attribute):
            return None
        receiver = func.value
        if isinstance(receiver, ast.Name) and receiver.id not in ("self", "cls"):
            named_class = self.class_named(receiver, module)
            if named_class is not None:
                found = self.method(named_class, func.attr)
                if found is None:
                    return None
                return found, "classmethod" in _decorator_names(found)
            source, original = self._imported(module, receiver.id)
            if source is not None and original is None:
                found = self.functions.get(source, {}).get(func.attr)
                return (found, False) if found is not None else None
        found = self.method(self.class_of(receiver, frame), func.attr)
        if found is None:
            return None
        return found, "staticmethod" not in _decorator_names(found)

    def bound_scope(self, function, call, caller_scopes, implicit_first):
        """The callee's bindings, with each parameter bound to what was passed.

        A parameter the call does not supply takes its default; one passed by
        ``*args`` or ``**kwargs``, or with no default, stays unreadable.
        """
        module, _ = self.owners[id(function)]
        scope = {
            name: list(values) for name, values in self.local_scope(function).items()
        }
        arguments = function.args
        positional = [*arguments.posonlyargs, *arguments.args]
        if implicit_first:
            positional = positional[1:]
        passed = {}
        if not any(isinstance(arg, ast.Starred) for arg in call.args):
            for param, arg in zip(positional, call.args):
                passed[param.arg] = _Argument(arg, caller_scopes)
        for keyword in call.keywords:
            if keyword.arg is not None:
                passed[keyword.arg] = _Argument(keyword.value, caller_scopes)
        module_scopes = (self.module_scope(module),)
        defaults = dict(
            zip(
                [param.arg for param in positional][
                    len(positional) - len(arguments.defaults) :
                ],
                arguments.defaults,
            )
        )
        defaults.update(
            (param.arg, default)
            for param, default in zip(arguments.kwonlyargs, arguments.kw_defaults)
            if default is not None
        )
        for name in [param.arg for param in [*positional, *arguments.kwonlyargs]]:
            value = passed.get(name)
            if value is None and name in defaults:
                value = _Argument(defaults[name], module_scopes)
            if value is not None and scope.get(name):
                scope[name][0] = value
        return scope


def _is_list_join(node):
    """Whether ``node`` joins items into text: ``", ".join(items)``.

    The separator must be a string literal or a constant, which leaves out
    SQLAlchemy's ``select(...).join(table, ...)`` and ``os.path.join``. An
    empty separator is left out too: ``"".join(c for c in uid if c.isalnum())``
    rebuilds one string rather than listing items.
    """
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "join"
        and len(node.args) == 1
        and not node.keywords
    ):
        return False
    separator = node.func.value
    if isinstance(separator, ast.Constant):
        return isinstance(separator.value, str) and separator.value != ""
    return isinstance(separator, (ast.Name, ast.Attribute)) and _is_constant_name(
        _base_name(separator)
    )


def _capped_items(call):
    """The items argument of a ``list_within_detail_limit`` call, if this is one.

    Whatever is built into those items is cut to fit by the helper itself.
    """
    if _base_name(call.func) != "list_within_detail_limit":
        return None
    if len(call.args) > 1:
        return call.args[1]
    return next((kw.value for kw in call.keywords if kw.arg == "items"), None)


def _walk_uncapped(expression):
    """``ast.walk`` that does not descend into a capped list of items."""
    pending = [expression]
    while pending:
        node = pending.pop()
        yield node
        capped = _capped_items(node) if isinstance(node, ast.Call) else None
        pending.extend(
            child for child in ast.iter_child_nodes(node) if child is not capped
        )


class _Frame(NamedTuple):
    """An expression that becomes part of a message, and where to read it."""

    expression: ast.expr
    scopes: tuple
    module: str
    owner_class: object
    function: object
    depth: int


def _message_frames(argument, scopes, module, owner_class, function, index):
    """The message expression, and everything it is built from.

    Followed transitively: each name the message reads, back to the values
    bound to it in the innermost scope that binds it; each argument a callee
    reads, back to the caller's expression; and each call to a function the
    index can resolve, into that function's ``return`` values with its
    parameters bound to what was passed, up to ``MAX_CALL_DEPTH`` calls deep.
    """
    frames = []
    pending = [_Frame(argument, scopes, module, owner_class, function, 0)]
    followed_names, followed_calls = set(), set()
    while pending:
        frame = pending.pop()
        frames.append(frame)
        for node in _walk_uncapped(frame.expression):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                scope = next((s for s in frame.scopes if node.id in s), None)
                if scope is None or (id(scope), node.id) in followed_names:
                    continue
                followed_names.add((id(scope), node.id))
                for value in scope[node.id]:
                    if isinstance(value, _Argument):
                        pending.append(
                            frame._replace(
                                expression=value.expression, scopes=value.scopes
                            )
                        )
                    elif value is not None:
                        pending.append(frame._replace(expression=value))
            elif (
                isinstance(node, ast.Call)
                and index is not None
                and frame.depth < MAX_CALL_DEPTH
            ):
                resolved = index.resolve(node.func, frame)
                if resolved is None or id(node) in followed_calls:
                    continue
                callee, implicit_first = resolved
                callee_module, callee_class = index.owners[id(callee)]
                if (callee_module, callee.name) in SELF_LIMITING_HELPERS:
                    continue
                followed_calls.add(id(node))
                callee_scopes = (
                    index.bound_scope(callee, node, frame.scopes, implicit_first),
                    index.module_scope(callee_module),
                )
                pending.extend(
                    _Frame(
                        returned.value,
                        callee_scopes,
                        callee_module,
                        callee_class,
                        callee,
                        frame.depth + 1,
                    )
                    for returned in _own_nodes(callee)
                    if isinstance(returned, ast.Return) and returned.value is not None
                )
    return frames


def _unbounded_joins(module, tree, sites, index):
    """Yield each join of data into a refusal.

    As ``(join module, join line, joined source, refusal line)``: the join can
    sit in another function, or another module, from the ``raise`` it feeds.
    """
    module_scope = index.module_scope(module) if index else _module_scope(tree)
    for lineno, argument, function in sites:
        if function is None:
            scopes, owner_class = (module_scope,), None
        else:
            local = index.local_scope(function) if index else _assignments(function)
            scopes = (local, module_scope)
            owner_class = index.owners[id(function)][1] if index else None
        for frame in _message_frames(
            argument, scopes, module, owner_class, function, index
        ):
            for node in _walk_uncapped(frame.expression):
                if _is_list_join(node) and not _is_bounded(node.args[0], frame.scopes):
                    yield frame.module, node.lineno, ast.unparse(node.args[0]), lineno


def _sent_to_client(text):
    """What ``safe_error_detail`` would send for a refusal with this message."""
    with patch.object(utils, "logger"):
        return safe_error_detail(ValueError(text))


@functools.cache
def _app_sweep():
    """Every refusal in ``app/``, read once.

    Returns ``(refusals, joins)``: written-out messages as
    ``(path, lineno, text)``, and joins of data into a message as
    ``(join module, join line, joined source, refusal module, refusal line)``,
    each join once however many refusals it reaches. Cached because parsing the whole of
    ``app/`` takes several seconds and several tests read the result; the
    per-test timeout is 30.
    """
    return _sweep(
        (path, ast.parse(path.read_text(encoding="utf-8")))
        for path in _python_sources()
    )


def _sweep(parsed):
    modules = []
    for path, tree in parsed:
        module = _Index.relative(path)
        modules.append((module, tree, _ModuleFacts.read(tree, module)))
    refusal_classes = _refusal_classes(
        cls for _, _, facts in modules for cls in facts.class_defs
    )
    index = _Index(modules)
    refusals, joins = [], set()
    for module, tree, facts in modules:
        sites = facts.sites(refusal_classes)
        refusals.extend(
            (BACKEND / module, lineno, text) for lineno, text in _refusals(tree, sites)
        )
        joins.update(
            (join_module, join_line, joined, module, raise_line)
            for join_module, join_line, joined, raise_line in _unbounded_joins(
                module, tree, sites, index
            )
        )
    return tuple(refusals), tuple(sorted(joins))


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
    """Each data-sized join once, with one refusal it reaches.

    Excluded by where the refusal is raised, since that decides whether it
    passes through safe_error_detail; allowlisted by where the join is.
    """
    first_refusal = {}
    for join_module, join_line, joined, module, raise_line in _app_sweep()[1]:
        if module.startswith(JOINS_NOT_SENT_THROUGH_SAFE_ERROR_DETAIL):
            continue
        first_refusal.setdefault((join_module, join_line, joined), (module, raise_line))
    return [
        (join_module, join_line, joined, module, raise_line)
        for (join_module, join_line, joined), (module, raise_line) in sorted(
            first_refusal.items()
        )
    ]


def test_no_refusal_joins_a_list_that_grows_with_the_data():
    offenders = [
        f"{join_module}:{join_line}: .join({joined})"
        + (
            ""
            if (join_module, join_line) == (module, raise_line)
            else f"  (reaches the refusal at {module}:{raise_line})"
        )
        for join_module, join_line, joined, module, raise_line in (
            _app_unbounded_joins()
        )
        if (join_module, joined) not in BOUNDED_JOINS
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
        (join_module, joined) for join_module, _, joined, _, _ in _app_unbounded_joins()
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


def _joins_in(modules):
    """The joined sources the check reports across ``modules``.

    ``modules`` maps a name under ``app/`` to its source: ``"a.py"`` is
    ``app/a.py``, imported as ``app.a``, so calls between them resolve as they
    do in the sweep.
    """
    _, joins = _sweep(
        (APP / name, ast.parse(source)) for name, source in modules.items()
    )
    return [joined for _, _, joined, _, _ in joins]


def _joins(source):
    return _joins_in({"snippet.py": source})


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


def test_the_join_check_follows_calls_into_other_functions():
    helper = (
        "def describe(names):\n"
        '    return "Blocked: " + ", ".join(names)\n'
        "def refuse(rows):\n"
        "    raise ValueError(describe([r.name for r in rows]))\n"
    )
    assert _joins(helper) == ["names"]
    # The caller decides: a fixed list passed in is a fixed list joined.
    assert _joins(helper.replace("[r.name for r in rows]", "STATUSES")) == []
    # A default stands in for an argument the call leaves out.
    assert (
        _joins(
            "def describe(names=STATUSES):\n"
            '    return ", ".join(names)\n'
            "def refuse():\n"
            "    raise ValueError(describe())\n"
        )
        == []
    )
    # A helper that slices before it joins is capped wherever it is called.
    assert (
        _joins(
            "def describe(names):\n"
            '    return ", ".join(names[:3])\n'
            "def refuse(ids):\n"
            "    raise ValueError(describe(ids))\n"
        )
        == []
    )


def test_the_join_check_follows_methods_and_imports():
    assert _joins(
        "class Service:\n"
        "    def _describe(self, names):\n"
        '        return ", ".join(names)\n'
        "    def refuse(self, ids):\n"
        '        raise ValueError(f"Unknown: {self._describe(ids)}")\n'
    ) == ["names"]
    helpers = {"helpers.py": 'def describe(names):\n    return ", ".join(names)\n'}
    assert _joins_in(
        {
            **helpers,
            "service.py": (
                "from app.helpers import describe\n"
                "def refuse(ids):\n"
                "    raise ValueError(describe(ids))\n"
            ),
        }
    ) == ["names"]
    assert _joins_in(
        {
            **helpers,
            "service.py": (
                "from app import helpers\n"
                "def refuse(ids):\n"
                "    raise ValueError(helpers.describe(ids))\n"
            ),
        }
    ) == ["names"]


_DESCRIBER = (
    "class Describer:\n"
    "    def __init__(self, db=None):\n"
    "        self.db = db\n"
    "    def describe(self, names):\n"
    '        return ", ".join(names)\n'
)


def test_the_join_check_follows_methods_on_objects():
    def refusing(body):
        return _joins(_DESCRIBER + body)

    # A name assigned from a constructor, and a constructor called inline.
    assert refusing(
        "def refuse(ids, db):\n"
        "    describer = Describer(db)\n"
        "    raise ValueError(describer.describe(ids))\n"
    ) == ["names"]
    assert refusing(
        "def refuse(ids, db):\n    raise ValueError(Describer(db).describe(ids))\n"
    ) == ["names"]
    # A parameter annotated with the class, plainly, optionally or as a string.
    for annotation in ("Describer", "Optional[Describer]", '"Describer"'):
        assert refusing(
            f"def refuse(describer: {annotation}, ids):\n"
            "    raise ValueError(describer.describe(ids))\n"
        ) == ["names"], annotation
    # A self attribute a method assigns.
    assert refusing(
        "class Service:\n"
        "    def __init__(self, db):\n"
        "        self.describer = Describer(db)\n"
        "    def refuse(self, ids):\n"
        "        raise ValueError(self.describer.describe(ids))\n"
    ) == ["names"]
    # A method the class inherits.
    assert refusing(
        "class Special(Describer):\n"
        "    pass\n"
        "def refuse(ids):\n"
        "    raise ValueError(Special().describe(ids))\n"
    ) == ["names"]


def test_a_method_call_binds_self_before_its_arguments():
    # Were self not bound by the call, STATUSES would land on self, names
    # would be left unreadable, and a fixed list would read as data.
    assert (
        _joins(
            _DESCRIBER + "def refuse(db):\n"
            "    raise ValueError(Describer(db).describe(STATUSES))\n"
        )
        == []
    )


def test_the_join_check_follows_objects_across_modules():
    assert _joins_in(
        {
            "describing.py": _DESCRIBER,
            "service.py": (
                "from app.describing import Describer\n"
                "def refuse(ids, db):\n"
                "    describer = Describer(db)\n"
                "    raise ValueError(describer.describe(ids))\n"
            ),
        }
    ) == ["names"]


def test_an_object_of_unknown_class_is_not_followed():
    # Built by a call the index cannot see into, or bound to two classes.
    assert (
        _joins(
            _DESCRIBER + "class Other:\n"
            "    def describe(self, names):\n"
            '        return "; ".join(names)\n'
            "def refuse(ids, flag):\n"
            "    describer = make_describer()\n"
            "    either = Describer()\n"
            "    either = Other()\n"
            "    raise ValueError(describer.describe(ids) + either.describe(ids))\n"
        )
        == []
    )


def test_the_join_check_stops_at_the_call_depth():
    chain = "".join(
        f"def f{n}(names):\n    return f{n + 1}(names)\n" for n in range(1, 5)
    )
    joining = 'def f{}(names):\n    return ", ".join(names)\n'
    refuse = "def refuse(ids):\n    raise ValueError(f1(ids))\n"
    # f1 -> f2 -> f3 joins: three calls deep, within MAX_CALL_DEPTH.
    shallow = "".join(
        f"def f{n}(names):\n    return f{n + 1}(names)\n" for n in range(1, 3)
    )
    assert _joins(shallow + joining.format(3) + refuse) == ["names"]
    # f1 -> ... -> f5 joins: past it, and not followed.
    assert _joins(chain + joining.format(5) + refuse) == []


def test_the_join_check_reads_only_lists_joined_into_text():
    # SQLAlchemy's join and os.path.join are not text joins.
    assert (
        _joins(
            "def q(table, ids):\n"
            "    return select(Item).join(table, Item.id.in_(ids))\n"
            "def refuse(table, ids):\n"
            "    raise ValueError(str(q(table, ids)))\n"
        )
        == []
    )
    # An empty separator rebuilds one string; it does not list items.
    assert _joins('def f(uid):\n    raise ValueError("".join(uid))') == []
    # Items handed to list_within_detail_limit are cut to fit by the helper.
    assert (
        _joins(
            "def f(errs):\n"
            "    raise ValueError(list_within_detail_limit(\n"
            '        "", [".".join(e) for e in errs], separator="; "))'
        )
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
