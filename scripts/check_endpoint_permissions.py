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

The understated class is a warning rather than an error only because there is a
standing backlog of them. Pass ``--strict`` to treat it as an error too; when
the backlog reaches zero, make that the default in CI.

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

# "**Requires permission: training.view or training.manage**" and the several
# spellings in use across the codebase.
DOC_PERM_RE = re.compile(r"Requires?\s+permissions?:\s*([^\n]*)", re.I)
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


def enforced_permissions(node: ast.AST) -> set[str]:
    """Permission strings passed to require_permission / require_all_permissions.

    Read from anywhere in the signature's defaults, so it does not matter which
    parameter carries the dependency or how the call is formatted.
    """
    perms: set[str] = set()
    args = node.args
    for default in list(args.defaults) + [d for d in args.kw_defaults if d]:
        for sub in ast.walk(default):
            if not isinstance(sub, ast.Call):
                continue
            fn = sub.func
            name = (
                fn.id
                if isinstance(fn, ast.Name)
                else fn.attr if isinstance(fn, ast.Attribute) else None
            )
            if name in PERMISSION_HELPERS:
                for arg in sub.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        perms.add(arg.value)
    return perms


def documented_permissions(doc: str) -> tuple[set[str], bool]:
    """Permissions named in a docstring, and whether it claims auth-only."""
    perms: set[str] = set()
    for m in DOC_PERM_RE.finditer(doc):
        # Stop at a sentence break so following prose cannot contribute tokens.
        perms.update(PERM_TOKEN_RE.findall(m.group(1)))
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

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not is_route(node):
                continue
            doc = ast.get_docstring(node) or ""
            if not doc:
                continue

            checked += 1
            enforced = enforced_permissions(node)
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
