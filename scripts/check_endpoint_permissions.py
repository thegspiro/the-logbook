#!/usr/bin/env python3
"""
Compare each API endpoint's documented permissions against the ones it enforces.

Why this exists
---------------
Endpoint docstrings are not decoration. They are rendered into the interactive
API documentation at ``/docs``, and they are what the wiki's API reference and
the module guides are written from. When a docstring and its
``require_permission(...)`` dependency disagree, the disagreement propagates
outward into every document downstream, and it is discovered months later during
a documentation pass rather than at the commit that caused it.

That is not hypothetical. Opening skills testing to non-officers changed the
dependency on several routes; the prose describing who may run a test went stale
in five separate documents, one of which was the QA checklist — which told a
tester to verify behaviour the application no longer had.

This script closes the loop at the source.

Findings
--------
**Errors** (fail the build):

``mismatch``
    The docstring names a different permission set than the decorator enforces.
    Whichever is right, a reader is being misled.

``undefended``
    The docstring claims a permission but the route has no permission
    dependency at all. This is the dangerous direction — the documentation
    promises a gate that does not exist, and a reviewer reading the docstring
    would conclude the route is protected.

**Warnings** (reported, do not fail):

``understated``
    The route enforces a permission but the docstring only says
    "Authentication required". The route is safe — it is stricter than
    advertised — but callers are told less than the truth.

The understated class is a warning rather than an error by default. **CI runs
with ``--strict``**, so in practice it fails the build too — the backlog that
justified the softer default reached zero on 2026-08-18.

Usage:

    python scripts/check_endpoint_permissions.py            # errors fail
    python scripts/check_endpoint_permissions.py --strict   # warnings fail too
    python scripts/check_endpoint_permissions.py --list-understated
"""

from __future__ import annotations

import argparse
import ast
import glob
import re
import sys
from dataclasses import dataclass, field

ENDPOINT_GLOB = "backend/app/api/**/*.py"

PERMISSION_HELPERS = {"require_permission", "require_all_permissions"}

# Helpers called in a route BODY that enforce a permission the signature does
# not. They exist where the permission is not the only way in — the officer
# named on a shift may manage it without holding scheduling.manage — so the
# check needs a loaded row and cannot be a dependency. See enforced_permissions.
BODY_AUTHORIZERS = {
    "_authorize_shift_management",
    "_authorize_assignment_management",
    "_authorize_handoff_access",
    "_authorize_test_write",
}

# Two spellings are in use across the codebase and BOTH must be recognised:
#
#   **Requires permission: training.view or training.manage**   (428 uses)
#   **Permissions required:** facilities.view or facilities.manage   (202 uses)
#
# Only the first was matched until 2026-08-18, and the omission was worse than
# a miscount. A docstring the regex cannot see contributes no documented
# permissions at all, so it could never produce a `mismatch` — it fell into the
# `understated` bucket, which is a warning that does not fail the build. All
# 202 routes using the second spelling were therefore exempt from the very
# check this script exists to perform: one could have named a permission the
# route did not enforce, indefinitely, and CI would have stayed green while
# reporting the route as merely under-documented.
#
# That also explains the "189-route under-documentation backlog" the CI comment
# refers to. It was mostly not a backlog: 163 of those routes were documented
# in a spelling nothing read.
DOC_PERM_RE = re.compile(
    r"(?:Requires?\s+permissions?|Permissions?\s+required)\s*:?\**\s*([^\n]*)",
    re.I,
)
# A permission list long enough to wrap is common — four alternatives do not fit
# in one line inside an indented docstring:
#
#     **Permissions required:** apparatus.view, apparatus.manage,
#     scheduling.view, or scheduling.manage
#
# Capturing only the marker's own line silently dropped every permission after
# the wrap, which reads as a `mismatch` — an ERROR — against a docstring that is
# in fact complete and correct. Two routes were failing that way.
#
# Continuation stops at a blank line, at a new emphasis block, or once the text
# so far has ended a sentence, so ordinary prose below the list cannot
# contribute tokens. `apparatus.manage` is not a sentence end: the terminator
# has to be a period at the end of a line.
_SENTENCE_END_RE = re.compile(r"[.!?]\s*$")
# A permission is `resource.action`, or a wildcard (`module.*`, or a bare `*`).
# The wildcard alternative is spelled out rather than folding `*` into the
# action character class: doing that lets the trailing `**` of markdown bold
# ("**Requires permission: events.manage**") be swallowed into the token, so
# every emphasised docstring reads as a mismatch against itself.
PERM_TOKEN_RE = re.compile(r"[a-z_]+\.(?:\*|[a-z_]+)")
DOC_AUTH_ONLY_RE = re.compile(r"Authentication required", re.I)


@dataclass
class Finding:
    kind: str
    path: str
    func: str
    enforced: set[str] = field(default_factory=set)
    documented: set[str] = field(default_factory=set)

    def render(self) -> str:
        def show(s: set[str]) -> str:
            return ", ".join(sorted(s)) if s else "(none)"

        return (
            f"{self.path}::{self.func}\n"
            f"    enforced by code: {show(self.enforced)}\n"
            f"    stated in docstring: {show(self.documented)}"
        )


def is_route(node: ast.AST) -> bool:
    """True for a function carrying an @router.<verb>(...) decorator."""
    for dec in getattr(node, "decorator_list", []):
        call = dec.func if isinstance(dec, ast.Call) else dec
        if (
            isinstance(call, ast.Attribute)
            and isinstance(call.value, ast.Name)
            and call.value.id == "router"
        ):
            return True
    return False


def _call_name(node: ast.Call) -> str | None:
    fn = node.func
    if isinstance(fn, ast.Name):
        return fn.id
    if isinstance(fn, ast.Attribute):
        return fn.attr
    return None


def authorizer_permissions(tree: ast.AST) -> dict[str, set[str]]:
    """Permissions each body authorizer in this module enforces internally.

    ``_authorize_assignment_management(service, user, assignment_id)`` takes no
    permission argument — it hardcodes ``user_has_permission(user,
    "scheduling.assign")`` in its own body. A call site therefore names no
    permission, and reading only call sites left two routes looking undefended.

    Resolving it from the helper's definition rather than a hand-written map
    means the mapping cannot drift: change the permission inside the helper and
    this follows it. Helpers that take the permission as a *parameter* (as
    ``_authorize_shift_management`` does) contribute nothing here — the literal
    is at the call site, where it is already read — because a bare ``Name``
    reference is not a string constant.
    """
    found: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name not in BODY_AUTHORIZERS:
            continue
        perms: set[str] = set()
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call) and _call_name(sub) in (
                PERMISSION_HELPERS | {"user_has_permission"}
            ):
                for arg in sub.args:
                    if (
                        isinstance(arg, ast.Constant)
                        and isinstance(arg.value, str)
                        and PERM_TOKEN_RE.fullmatch(arg.value)
                    ):
                        perms.add(arg.value)
        found[node.name] = perms
    return found


def _permissions_from_calls(nodes, authorizers: dict[str, set[str]]) -> set[str]:
    """Permissions enforced by helper calls anywhere under `nodes`."""
    perms: set[str] = set()
    for root in nodes:
        for sub in ast.walk(root):
            if not isinstance(sub, ast.Call):
                continue
            name = _call_name(sub)
            if name not in PERMISSION_HELPERS | BODY_AUTHORIZERS:
                continue
            for arg in sub.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    # A body authorizer's other arguments are a service, a user
                    # and an id, so only dotted permission literals qualify.
                    if name in PERMISSION_HELPERS or PERM_TOKEN_RE.fullmatch(arg.value):
                        perms.add(arg.value)
            # A helper that hardcodes its own permission contributes it here.
            perms |= authorizers.get(name, set())
    return perms


def enforced_permissions(node: ast.AST, authorizers: dict[str, set[str]]) -> set[str]:
    """Permissions this route enforces, from the signature *and* the body.

    Two enforcement patterns are in use, and reading only the first is what
    produced eight false `undefended` findings against `scheduling.py`:

    1. **A dependency in the signature** — ``Depends(require_permission(...))``.
       The common case.

    2. **A helper called in the body** — ``_authorize_shift_management(...)``.
       Used where the permission is not the only way in: the officer named on a
       shift may manage that shift's crew, attendance, calls, finalization and
       cancellation *without* ``scheduling.assign``/``scheduling.manage``
       (documented in docs/SCHEDULING_MODULE.md, "Per-shift officer
       authority"). That check needs the shift row, so it cannot live in the
       signature — a dependency would have to load the shift a second time, and
       a route carrying both would enforce the permission twice and defeat the
       officer path entirely.

    Reading only the signature made those routes look like they enforced
    nothing while their docstrings named a permission, which the script reports
    as ``undefended`` — its most alarming finding, and here entirely wrong. A
    reader trusting it would have "fixed" the report by adding the dependency,
    which would have removed the shift officer's access.
    """
    args = node.args
    signature = list(args.defaults) + [d for d in args.kw_defaults if d]
    return _permissions_from_calls(signature, authorizers) | _permissions_from_calls(
        node.body, authorizers
    )


def _permission_clause(doc: str, match: re.Match) -> str:
    """The marker's own line plus any lines the permission list wrapped onto."""
    clause = match.group(1)
    if _SENTENCE_END_RE.search(clause):
        return clause

    rest = doc[match.end() :]
    for line in rest.split("\n")[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("**"):
            break
        clause += " " + stripped
        if _SENTENCE_END_RE.search(stripped):
            break
    return clause


def documented_permissions(doc: str) -> tuple[set[str], bool]:
    """Permissions named in a docstring, and whether it claims auth-only."""
    perms: set[str] = set()
    for m in DOC_PERM_RE.finditer(doc):
        # Stop at a sentence break so following prose cannot contribute tokens.
        perms.update(PERM_TOKEN_RE.findall(_permission_clause(doc, m)))
    return perms, bool(DOC_AUTH_ONLY_RE.search(doc))


def analyze() -> tuple[list[Finding], int]:
    findings: list[Finding] = []
    checked = 0

    for path in sorted(glob.glob(ENDPOINT_GLOB, recursive=True)):
        try:
            tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
        except SyntaxError as exc:  # pragma: no cover - a broken file fails lint
            print(f"{path}: could not parse: {exc}", file=sys.stderr)
            continue

        # Resolved once per module: a body authorizer and the routes calling it
        # always live in the same endpoint file.
        authorizers = authorizer_permissions(tree)

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not is_route(node):
                continue
            doc = ast.get_docstring(node) or ""
            if not doc:
                continue

            checked += 1
            enforced = enforced_permissions(node, authorizers)
            documented, auth_only = documented_permissions(doc)

            if documented and enforced and documented != enforced:
                findings.append(
                    Finding("mismatch", path, node.name, enforced, documented)
                )
            elif documented and not enforced:
                findings.append(
                    Finding("undefended", path, node.name, enforced, documented)
                )
            elif enforced and not documented and auth_only:
                findings.append(
                    Finding("understated", path, node.name, enforced, documented)
                )

    return findings, checked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--strict",
        action="store_true",
        help="treat understated docstrings as errors too",
    )
    ap.add_argument(
        "--list-understated",
        action="store_true",
        help="print every understated route rather than a count",
    )
    opts = ap.parse_args()

    findings, checked = analyze()
    errors = [f for f in findings if f.kind in ("mismatch", "undefended")]
    warnings = [f for f in findings if f.kind == "understated"]

    for f in errors:
        print(f"ERROR [{f.kind}] {f.render()}\n")

    if warnings:
        if opts.list_understated or opts.strict:
            for f in warnings:
                print(f"WARN  [understated] {f.render()}\n")
        else:
            print(
                f"{len(warnings)} route(s) enforce a permission but document "
                f'only "Authentication required".\n'
                f"Run with --list-understated to see them.\n"
            )

    print(f"Checked {checked} documented route handlers.")
    print(f"  errors:   {len(errors)}")
    print(f"  warnings: {len(warnings)}")

    if errors:
        return 1
    if opts.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
