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


# A binding recorded inside one of these can be skipped entirely at runtime,
# so a later binding here must not be trusted to have overwritten an earlier
# one — the call site could still see either value depending on which branch
# actually ran. ``Match``/``match_case`` covers a ``match`` statement's arms,
# each of which runs at most once, same as an ``if``/``elif`` chain (Codex's
# fifth-round finding on PR #2389).
_CONDITIONAL_NODES = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.Try,
    ast.ExceptHandler,
    ast.Match,
    ast.match_case,
)

# (lineno, local_name, real_name, conditional)
_ScopeBindings = list[tuple[int, str, str, bool]]


def _assignment_source_name(value: ast.AST) -> str | None:
    """The bare name a simple alias assignment's right-hand side refers to.

    Single-hop only: ``check = verify_totp`` records ``verify_totp``, and
    ``check = mfa_service.verify_totp`` records ``verify_totp`` (matching
    this file's existing over-inclusive attribute handling — the receiver is
    never resolved). A chain (``a = verify_totp; b = a``) is not followed:
    ``b``'s binding records the literal RHS name ``a``, not what ``a`` itself
    resolves to. Closing that needs general data-flow/constant-propagation
    analysis this sweep does not attempt.
    """
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Attribute):
        return value.attr
    return None


def _local_scope_imports(scope_node: ast.AST) -> _ScopeBindings:
    """``(lineno, local_name, real_name, conditional)`` for each ``from``-import
    or simple alias assignment made directly in *scope_node*'s own body,
    sorted by source line.

    Descends into ``if``/``for``/``while``/``try``/``match`` blocks (bindings
    there still bind in the enclosing function) but stops at a nested
    function or class — that scope's own bindings belong to it, not to this
    one. ``conditional`` is True when the binding sits inside any of
    ``_CONDITIONAL_NODES``, at any nesting depth — a branch that might not
    execute.

    Kept as an ordered list rather than a ``dict`` so a second binding
    re-using the same local name (``... import verify_totp as check`` then,
    later in the same function, ``... import harmless as check``) doesn't
    silently overwrite the binding a call made *before* the reassignment
    resolves against — Codex's third-round finding on PR #2389 against the
    scope-aware fix that still collapsed same-scope bindings into a flat
    dict.
    """
    bindings: _ScopeBindings = []

    def walk(node: ast.AST, conditional: bool) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            child_conditional = conditional or isinstance(child, _CONDITIONAL_NODES)
            if isinstance(child, ast.ImportFrom):
                for alias in child.names:
                    bindings.append(
                        (
                            child.lineno,
                            alias.asname or alias.name,
                            alias.name,
                            conditional,
                        )
                    )
            elif (
                isinstance(child, ast.Assign)
                and len(child.targets) == 1
                and isinstance(child.targets[0], ast.Name)
            ):
                source_name = _assignment_source_name(child.value)
                if source_name is not None:
                    bindings.append(
                        (child.lineno, child.targets[0].id, source_name, conditional)
                    )
            walk(child, child_conditional)

    walk(scope_node, False)
    bindings.sort(key=lambda binding: binding[0])
    return bindings


def _resolve_names(
    name: str, lineno: int, scope_chain: list[_ScopeBindings]
) -> frozenset[str]:
    """All real names *name* could plausibly be bound to at *lineno*, through
    real lexical scoping: innermost function first, then each enclosing
    function, then the module.

    Within one scope, only bindings recorded at or before *lineno* count.
    Walking backward from the most recent one: an **unconditional** binding
    is a hard cutoff (it always executes, so nothing earlier can still apply)
    and resolution stops there; a **conditional** one might not have executed,
    so its real name is added to the possible set and the walk continues to
    whatever binding would apply if that branch was skipped. This catches
    Codex's fourth-round finding: a same-scope rebinding that itself sits
    inside an ``if`` must not be trusted to have silently replaced an earlier,
    non-consuming-verifier binding — both are possible, and this sweep must
    flag a call if *either* possibility is the forbidden name, not just
    whichever binding happens to be textually last. A same-named alias in one
    function must also never resolve a call in a sibling function or at
    module level (Codex's second-round finding, against a flat whole-module
    dict).
    """
    for bindings in reversed(scope_chain):
        relevant = sorted(
            (b for b in bindings if b[1] == name and b[0] <= lineno),
            key=lambda b: b[0],
        )
        if not relevant:
            continue
        possible: set[str] = set()
        for _binding_line, _local, real, conditional in reversed(relevant):
            possible.add(real)
            if not conditional:
                break
        return frozenset(possible)
    return frozenset({name})


def _called_names(node: ast.Call, scope_chain: list[_ScopeBindings]) -> frozenset[str]:
    """Every real name a Call node could plausibly target, however it is
    spelled.

    Resolves a bare ``ast.Name`` through *scope_chain* first, as it stood at
    this call's own line — see ``_resolve_names`` for why this can be more
    than one candidate. Tracks single-hop simple-assignment rebinding
    (``spend = verify_totp_get_timestep``) via ``_assignment_source_name``;
    a chain of assignments is not followed — see that function's docstring.

    For an ``ast.Attribute`` call, matches on the attribute name alone
    without resolving the receiver's provenance — ``x.verify_totp(...)``
    counts regardless of what ``x`` is. This is intentionally over-inclusive:
    the three names this file tracks are unique to `app/services/mfa_service.py`
    today (verified — nothing else in `app/` defines an attribute with any of
    these names), so narrowing to "only when the receiver resolves to
    `app.services.mfa_service`" would trade a real guarantee (nothing calls
    `verify_totp` through a receiver this sweep can't resolve, e.g.
    `self.mfa.verify_totp(...)` or a `getattr`) for cosmetic precision against
    a collision that does not exist. If a future unrelated attribute happens
    to collide with one of these names, that is this sweep's false positive
    to diagnose, not a defect to code around by weakening the check.
    """
    func = node.func
    if isinstance(func, ast.Name):
        return _resolve_names(func.id, node.lineno, scope_chain)
    if isinstance(func, ast.Attribute):
        return frozenset({func.attr})
    return frozenset()


def _python_files():
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        yield path


def _rel(path: pathlib.Path) -> str:
    return path.relative_to(APP_ROOT.parent).as_posix()


def _calls_with_context(
    tree: ast.AST,
) -> list[tuple[ast.Call, str, list[_ScopeBindings]]]:
    """Every Call in *tree*, paired with its owner function and the chain of
    import-alias scopes visible at that point (module first, innermost last).

    A single descent, carrying the nearest enclosing function name and its
    scope chain down. The obvious ``ast.walk``-inside-``ast.walk`` version is
    quadratic in module size and pushed this file past the 30s per-test
    timeout on `app/`'s largest modules; ``_local_scope_imports`` stays linear
    overall because it stops at each nested function boundary, so no node's
    import bindings are collected by more than one call.
    """
    found: list[tuple[ast.Call, str, list[_ScopeBindings]]] = []

    def descend(node: ast.AST, owner: str, scope_chain: list[_ScopeBindings]) -> None:
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
    tuple[str, ast.AST, list[tuple[ast.Call, str, list[_ScopeBindings]]]]
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
        if _called_names(call, scope_chain) & _NON_CONSUMING
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
            for name in _called_names(call, scope_chain):
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
