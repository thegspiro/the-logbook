#!/usr/bin/env python3
"""
Compare each frontend route's documented permission against the one it enforces.

Why this exists
---------------
`APPLICATION_PAGES.md` is the map people use to answer "who can see this page?".
Support answers questions from it, the training guides are written against it,
and it is the first thing consulted when a member reports a missing control —
because a control that is absent is usually a permission or module-state issue,
not a rendering failure.

Nothing checked it against the routes. On 2026-08-16 a documentation pass found
the Check-In QR Codes directory listed as **Authenticated** when its route has
required `locations.manage` or `facilities.manage` for weeks, and four routes
that had been live for days with no entry at all. A wrong permission in that
file is worse than a missing one: it sends someone hunting for a grant that is
already correct, or reassures them a page is restricted when it is not.

This is the frontend counterpart to `check_endpoint_permissions.py`, which does
the same job for API endpoints against their docstrings, and it uses the same
error/warning split.

What it reports
---------------
ERROR   undocumented  a route exists with no mention in APPLICATION_PAGES.md
ERROR   mismatch      documented and enforced permissions disagree
ERROR   stale         the document lists a route the application no longer has
WARN    unlisted      the route is described in prose or a heading, but has no
                      row in a permission table — so there is nothing to check
WARN    understated   the code enforces a permission; the document says only
                      "Authenticated"

Redirect routes — those whose element is `<Navigate>` — are skipped. A redirect
has no permission of its own; whatever it forwards to does the gating, so there
is nothing for a permission table to state. The count is printed so the
exclusion is visible rather than silent.

The document is at zero errors and zero warnings as of 2026-08-16, and CI runs
this with --strict to keep it there.

Usage:
    python3 scripts/check_route_permissions.py
    python3 scripts/check_route_permissions.py --list-warnings
    python3 scripts/check_route_permissions.py --strict   # warnings fail too
"""

from __future__ import annotations

import argparse
import glob
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DOC = REPO_ROOT / "APPLICATION_PAGES.md"
ROUTE_FILES = ["frontend/src/App.tsx", "frontend/src/modules/*/routes.tsx"]

# Match every route declaration so relative and wildcard routes still delimit
# the source window for the preceding absolute route. Only absolute paths are
# added to the documentation comparison below.
PATH_RE = re.compile(r'path="([^"]*)"')
PROTECTED_RE = re.compile(r"<ProtectedRoute\b")
# A route whose element is <Navigate> is a redirect, not a page. It has no
# permission of its own — whatever it forwards to does the gating — so it has
# nothing to state in a permission table and is excluded from the comparison.
# APPLICATION_PAGES.md lists these under "Legacy redirects" bullets instead,
# which is the right place for them.
REDIRECT_RE = re.compile(r"<Navigate\b")
PERM_ONE_RE = re.compile(r'requiredPermission="([^"]+)"')
PERM_ANY_RE = re.compile(r"requiredAnyPermission=\{\[([^\]]*)\]\}")
# A route may pass a named constant instead of an array literal, so that two
# routes sharing one gate cannot drift apart:
#
#     export const MEDICAL_VIEW_PERMISSIONS = ['inventory.view_medical', ...];
#     <ProtectedRoute requiredAnyPermission={MEDICAL_VIEW_PERMISSIONS}>
#
# Reading only the literal form scored both medical-supplies routes as
# authenticated-only and demanded the document say so — the checker would have
# talked the file into the exact error it exists to catch. Resolve the constant
# from the same file instead.
PERM_CONST_REF_RE = re.compile(r"requiredAnyPermission=\{([A-Za-z_][A-Za-z0-9_]*)\}")
CONST_ARRAY_RE = re.compile(
    r"^(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*\[([^\]]*)\]",
    re.M,
)
PERM_TOKEN_RE = re.compile(r"[a-z_]+\.(?:\*|[a-z_]+)")

# A table row whose first cell is a route: | `/path` | Page | Permission |
DOC_ROW_RE = re.compile(r"^\|\s*`?(/[^ |`]*)`?\s*\|([^|]*)\|([^|\n]*)", re.M)
# Any inline-code route mention, for the "described but not tabulated" tier.
DOC_MENTION_RE = re.compile(r"`(/[^`\s]*)`")
# The admin hubs state their permission in prose under the heading rather than
# in a row, because their tables list tabs rather than routes:
#
#     ### Training Admin Hub (`/training/admin`)
#     Requires `training.manage` permission. Tab-based admin interface.
#
# That is a perfectly good way to document a page, so read it rather than
# demanding a redundant row.
DOC_HEADING_PERM_RE = re.compile(
    # The capture runs to end of line, not to the first period: a permission
    # contains one (`training.manage`), so stopping at "." truncates every token.
    r"^#+[^\n]*\(`(/[^`\s]*)`\)[^\n]*\n+[^\n]*?Requires? ([^\n]*)",
    re.M,
)

AUTH_ONLY_RE = re.compile(r"authenticat", re.I)


def normalize(path: str) -> str:
    """`/events/:eventId` and `/events/:id` are the same page to a reader."""
    return re.sub(r":[A-Za-z_]+", ":x", path.rstrip("/")) or "/"


@dataclass
class Finding:
    kind: str
    route: str
    source: str = ""
    enforced: set[str] = field(default_factory=set)
    documented: set[str] = field(default_factory=set)

    def render(self) -> str:
        def show(s: set[str]) -> str:
            return ", ".join(sorted(s)) if s else "(none — authenticated only)"

        head = f"{self.route}" + (f"  [{self.source}]" if self.source else "")
        if self.kind in ("undocumented", "unlisted"):
            return f"{head}\n    enforced by the route: {show(self.enforced)}"
        if self.kind == "stale":
            return f"{head}\n    documented as: {show(self.documented)}"
        return (
            f"{head}\n"
            f"    enforced by the route: {show(self.enforced)}\n"
            f"    stated in APPLICATION_PAGES.md: {show(self.documented)}"
        )


def gate_for(window: str, consts: dict[str, set[str]], source: str) -> set[str]:
    """Permissions enforced by the first ProtectedRoute in a route's element.

    An empty set means authenticated-only. That is the honest reading rather
    than "ungated": every module route sits inside a bare `<ProtectedRoute>` in
    `App.tsx` that wraps the whole app layout, so a child with no gate of its
    own still requires a session.

    `consts` maps the route file's own `const NAME = [...]` arrays to the
    permissions in them, so a gate passed by name resolves the same as one
    written inline.
    """
    if not PROTECTED_RE.search(window):
        return set()
    perms = set(PERM_ONE_RE.findall(window))
    for group in PERM_ANY_RE.findall(window):
        perms.update(PERM_TOKEN_RE.findall(group))
    for name in PERM_CONST_REF_RE.findall(window):
        if name not in consts:
            # Silently scoring this as authenticated-only is the one outcome
            # worth refusing: it would report a gated page as open and then
            # insist the document agree. An unresolvable name means the array
            # lives in another file — move it, or teach this script to follow
            # the import.
            raise SystemExit(
                f"{source}: requiredAnyPermission={{{name}}} refers to a "
                f"permission list this script cannot resolve. Declare the "
                f"array in the same route file, or extend CONST_ARRAY_RE."
            )
        perms.update(consts[name])
    return perms


def collect_routes() -> tuple[dict[str, tuple[set[str], str]], set[str]]:
    """Map normalized route -> (enforced permissions, file), plus redirects."""
    routes: dict[str, tuple[set[str], str]] = {}
    redirects: set[str] = set()
    for pattern in ROUTE_FILES:
        for file in sorted(glob.glob(str(REPO_ROOT / pattern))):
            text = Path(file).read_text()
            rel = str(Path(file).relative_to(REPO_ROOT))
            consts = {
                name: set(PERM_TOKEN_RE.findall(body))
                for name, body in CONST_ARRAY_RE.findall(text)
            }
            matches = list(PATH_RE.finditer(text))
            for i, m in enumerate(matches):
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                window = text[m.start() : end]
                if not m.group(1).startswith("/"):
                    continue
                key = normalize(m.group(1))
                if REDIRECT_RE.search(window):
                    redirects.add(key)
                    continue
                # First definition wins; a later duplicate is a nested index
                # route, not a second page.
                routes.setdefault(key, (gate_for(window, consts, rel), rel))
    return {k: v for k, v in routes.items() if k not in redirects}, redirects


def collect_doc() -> tuple[dict[str, set[str]], set[str]]:
    """Map normalized route -> documented permissions, plus every mention."""
    text = DOC.read_text()
    rows: dict[str, set[str]] = {}
    for route, _page, perm_cell in DOC_ROW_RE.findall(text):
        # `/scheduling?tab=equipment-checks` is a deep link into a route, not a
        # route — the router never sees the query string. Documenting them is
        # useful; checking them against `path=` declarations is not.
        if "?" in route:
            continue
        key = normalize(route)
        perms = set(PERM_TOKEN_RE.findall(perm_cell))
        if not perms and AUTH_ONLY_RE.search(perm_cell):
            perms = set()
        rows.setdefault(key, perms)
    for route, sentence in DOC_HEADING_PERM_RE.findall(text):
        rows.setdefault(normalize(route), set(PERM_TOKEN_RE.findall(sentence)))
    mentions = {normalize(m) for m in DOC_MENTION_RE.findall(text)}
    return rows, mentions


def analyze() -> tuple[list[Finding], int, int]:
    routes, redirects = collect_routes()
    rows, mentions = collect_doc()
    findings: list[Finding] = []

    for route, (enforced, source) in sorted(routes.items()):
        if route in rows:
            documented = rows[route]
            if documented == enforced:
                continue
            # Code enforces something, the table says authenticated-only. Same
            # tier the endpoint checker uses: under-documented, not wrong.
            kind = "understated" if enforced and not documented else "mismatch"
            findings.append(Finding(kind, route, source, enforced, documented))
        elif route in mentions:
            findings.append(Finding("unlisted", route, source, enforced))
        else:
            findings.append(Finding("undocumented", route, source, enforced))

    for route, documented in sorted(rows.items()):
        if route not in routes and route not in redirects:
            findings.append(Finding("stale", route, str(DOC.name), set(), documented))

    return findings, len(routes), len(redirects)


ERROR_KINDS = {"undocumented", "mismatch", "stale"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument(
        "--strict", action="store_true", help="treat warnings as errors too"
    )
    ap.add_argument(
        "--list-warnings",
        action="store_true",
        help="print every warning rather than a count",
    )
    opts = ap.parse_args()

    findings, checked, redirects = analyze()
    errors = [f for f in findings if f.kind in ERROR_KINDS]
    warnings = [f for f in findings if f.kind not in ERROR_KINDS]

    for f in errors:
        print(f"ERROR [{f.kind}] {f.render()}\n")

    if warnings:
        if opts.list_warnings or opts.strict:
            for f in warnings:
                print(f"WARN  [{f.kind}] {f.render()}\n")
        else:
            kinds = ", ".join(sorted({f.kind for f in warnings}))
            print(
                f"{len(warnings)} route(s) are described but not tabulated, or "
                f"document less than they enforce ({kinds}).\n"
                f"Run with --list-warnings to see them.\n"
            )

    print(f"Checked {checked} routes against {DOC.name}.")
    print(f"  redirects skipped: {redirects}")
    print(f"  errors:   {len(errors)}")
    print(f"  warnings: {len(warnings)}")

    if errors:
        return 1
    if opts.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
