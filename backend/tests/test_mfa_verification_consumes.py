"""Guard: every second-factor check in ``app/`` verifies AND consumes.

AUTH-7 (security review pass 3) found that ``mfa_verify_setup``,
``mfa_disable`` and ``mfa_regenerate_recovery_codes`` each called the
non-consuming ``mfa_service.verify_totp``, so a code observed in use at one of
those routes could still be replayed at ``POST /auth/mfa/login`` for the rest
of its ~30-90s window. AUTH-9 and AUTH-13 then had to put a row lock behind the
consuming helpers so two concurrent requests could not both spend one code.

All of that lives in two helpers in ``app/api/v1/endpoints/auth.py``:

* ``_verify_and_consume_totp`` — the only caller of ``verify_totp_get_timestep``
* ``_verify_and_consume_recovery_code`` — the only caller of
  ``find_matching_recovery_code``

Nothing enforced that until this file. The non-consuming ``verify_totp`` is
still exported (it is the primitive the service's own unit tests exercise), and
an author reaching for the obvious name would silently reintroduce AUTH-7 —
the same shape as the dead ``_InMemoryFailureTracker.clear`` AUTH-6 removed for
contradicting a documented invariant.

The sweep is AST-based rather than a grep so a call spelled
``mfa_service.verify_totp(...)``, ``verify_totp(...)`` after a ``from``-import,
or an aliased import all count the same.
"""

import ast
import pathlib

APP_ROOT = pathlib.Path(__file__).resolve().parents[1] / "app"

# Verification primitives that do NOT consume the credential they check.
_NON_CONSUMING = {"verify_totp"}

# Consuming primitives, and the single function each is allowed to be called
# from. Widening either entry means a second place can spend a code, which is
# the state AUTH-9/AUTH-13 had to lock; make that a deliberate edit here.
_CONSUMING_CALLERS = {
    "verify_totp_get_timestep": (
        "app/api/v1/endpoints/auth.py",
        "_verify_and_consume_totp",
    ),
    "find_matching_recovery_code": (
        "app/api/v1/endpoints/auth.py",
        "_verify_and_consume_recovery_code",
    ),
}

# Hand-rolling a TOTP check bypasses both helpers without naming either, so the
# library itself is confined to the one module that wraps it.
_PYOTP_OWNER = "app/services/mfa_service.py"


def _local_scope_imports(scope_node: ast.AST) -> dict[str, str]:
    """``from``-import bindings made directly in *scope_node*'s own body.

    Descends into ``if``/``for``/``while``/``try`` blocks (imports there still
    bind in the enclosing function) but stops at a nested function or class —
    that scope's own imports belong to it, not to this one.
    """
    bindings: dict[str, str] = {}

    def walk(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if isinstance(child, ast.ImportFrom):
                for alias in child.names:
                    bindings[alias.asname or alias.name] = alias.name
            walk(child)

    walk(scope_node)
    return bindings


def _resolve_name(name: str, scope_chain: list[dict[str, str]]) -> str:
    """Resolve *name* through real lexical scoping: innermost function first,
    then each enclosing function, then the module. A same-named alias in one
    function must never resolve a call in a sibling function or at module
    level — that was Codex's second-round finding on PR #2389 against a flat,
    whole-module alias dict.
    """
    for scope in reversed(scope_chain):
        if name in scope:
            return scope[name]
    return name


def _called_name(node: ast.Call, scope_chain: list[dict[str, str]]) -> str | None:
    """The real function name a Call node targets, however it is spelled.

    Resolves a bare ``ast.Name`` through *scope_chain* first. Does not track
    simple-assignment rebinding (``spend = verify_totp_get_timestep``) — that
    needs data-flow analysis this sweep does not attempt.
    """
    func = node.func
    if isinstance(func, ast.Name):
        return _resolve_name(func.id, scope_chain)
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _python_files():
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        yield path


def _rel(path: pathlib.Path) -> str:
    return path.relative_to(APP_ROOT.parent).as_posix()


def _calls_with_context(
    tree: ast.AST,
) -> list[tuple[ast.Call, str, list[dict[str, str]]]]:
    """Every Call in *tree*, paired with its owner function and the chain of
    import-alias scopes visible at that point (module first, innermost last).

    A single descent, carrying the nearest enclosing function name and its
    scope chain down. The obvious ``ast.walk``-inside-``ast.walk`` version is
    quadratic in module size and pushed this file past the 30s per-test
    timeout on `app/`'s largest modules; ``_local_scope_imports`` stays linear
    overall because it stops at each nested function boundary, so no node's
    import bindings are collected by more than one call.
    """
    found: list[tuple[ast.Call, str, list[dict[str, str]]]] = []

    def descend(node: ast.AST, owner: str, scope_chain: list[dict[str, str]]) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                child_chain = scope_chain + [_local_scope_imports(child)]
                descend(child, child.name, child_chain)
                continue
            if isinstance(child, ast.Call):
                found.append((child, owner, scope_chain))
            descend(child, owner, scope_chain)

    descend(tree, "<module>", [_local_scope_imports(tree)])
    return found


# Parsing and indexing the whole `app/` tree costs a few seconds and all three
# tests need it, so do it once at import.
_MODULES: list[
    tuple[str, ast.AST, list[tuple[ast.Call, str, list[dict[str, str]]]]]
] = [
    (_rel(path), tree, _calls_with_context(tree))
    for path, tree in (
        (p, ast.parse(p.read_text(encoding="utf-8"))) for p in _python_files()
    )
]


def test_no_app_code_calls_the_non_consuming_totp_verifier():
    offenders = [
        f"{rel}:{call.lineno} in {owner}()"
        for rel, _tree, calls in _MODULES
        for call, owner, scope_chain in calls
        if _called_name(call, scope_chain) in _NON_CONSUMING
    ]

    assert not offenders, (
        "mfa_service.verify_totp verifies without recording the time-step as "
        "spent, so a code it accepts can be replayed at POST /auth/mfa/login "
        "(AUTH-7). Call auth._verify_and_consume_totp instead. Offending "
        "call sites: " + ", ".join(offenders)
    )


def test_consuming_primitives_have_exactly_one_caller_each():
    found: dict[str, list[str]] = {name: [] for name in _CONSUMING_CALLERS}
    for rel, _tree, calls in _MODULES:
        for call, owner, scope_chain in calls:
            name = _called_name(call, scope_chain)
            if name in found:
                found[name].append(f"{rel}::{owner}")

    for name, (expected_file, expected_func) in _CONSUMING_CALLERS.items():
        expected = f"{expected_file}::{expected_func}"
        assert found[name] == [expected], (
            f"{name} must be called from exactly one place — {expected} — so "
            "that verification and consumption stay a single locked operation "
            f"(AUTH-9/AUTH-13). Found: {found[name] or 'no call sites'}"
        )


def test_pyotp_is_confined_to_the_mfa_service():
    importers = []
    for rel, tree, _calls in _MODULES:
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [(node.module or "").split(".")[0]]
            else:
                continue
            if "pyotp" in names and rel not in importers:
                importers.append(rel)

    assert importers == [_PYOTP_OWNER], (
        "pyotp must be imported only by app/services/mfa_service.py — a "
        "hand-rolled TOTP check elsewhere skips the consume-and-lock helpers "
        f"without naming them. Found: {importers}"
    )
