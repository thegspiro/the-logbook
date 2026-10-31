"""A ratchet on routes that require sign-in but check no permission.

A route whose only gate is ``get_current_user`` is open to every member of
the organization, so whatever it returns has to be scoped by the handler
itself: filtered to the caller, limited to what any member may see, or
checked against a permission inside the body. Nothing outside the handler
enforces that. ``GET /prospective-members/my-sign-offs`` was this shape and
showed officers their own pending application (MP-32). It was found only
because a review happened to re-list every route, and a diff-bounded review
before it had missed the new route entirely.

**This is a ratchet, not a rule.** It cannot tell whether a handler scopes
its result correctly; that takes reading it. It freezes the set that existed
on 2026-10-25 and fails on any new one, so each new member-wide route is a
reviewed decision rather than an accident. A baselined route that gains a
permission dependency, or is removed, fails too, so the list only shrinks.
``test_org_scoping_ratchet.py`` works the same way.

Scope, and its limits:

* **Only ``app/api/v1/endpoints/``**, the same tree
  ``test_endpoint_auth_coverage.py`` sweeps. A route with no auth dependency
  at all is that file's concern, not this one's.
* **A permission dependency means** ``require_permission``,
  ``require_all_permissions`` or ``require_role`` in the signature or in the
  decorator's ``dependencies=``. A check made inside the body
  (``user_has_permission`` and the like) does not count, because a static
  read cannot tell whether it gates the whole route or only one branch.
* **Keyed on file and function, not line**, so an unrelated edit above a
  route does not churn the baseline.
"""

import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ENDPOINTS = BACKEND / "app" / "api" / "v1" / "endpoints"
BASELINE = pathlib.Path(__file__).with_name("permissionless_route_baseline.txt")

ROUTE_METHODS = {"get", "post", "put", "patch", "delete"}
AUTH_DEPS = {"get_current_user", "get_current_active_user", "get_current_user_optional"}
PERMISSION_DEPS = {
    "require_permission",
    "require_all_permissions",
    "require_role",
    # Per-applicant access (app/api/prospect_access.py): a permission, or an
    # assignment to the applicant, which is a grant a coordinator made.
    "require_prospect_access",
    "require_interview_access",
    "require_pipeline_reader",
    "require_view_all",
}


def _names(node):
    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            yield child.id
        elif isinstance(child, ast.Attribute):
            yield child.attr


def scan_source(source, rel_path):
    """``rel_path::function`` for each route that signs in but checks no permission."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        decorators = [
            d
            for d in node.decorator_list
            if isinstance(d, ast.Call)
            and isinstance(d.func, ast.Attribute)
            and d.func.attr in ROUTE_METHODS
        ]
        if not decorators:
            continue
        gates = (
            list(node.args.defaults)
            + [d for d in node.args.kw_defaults if d is not None]
            + [
                k.value
                for d in decorators
                for k in d.keywords
                if k.arg == "dependencies"
            ]
        )
        names = {n for gate in gates for n in _names(gate)}
        if names & AUTH_DEPS and not names & PERMISSION_DEPS:
            found.append(f"{rel_path}::{node.name}")
    return found


def current_findings():
    keys = set()
    for path in sorted(ENDPOINTS.glob("*.py")):
        keys.update(
            scan_source(
                path.read_text(encoding="utf-8"),
                path.relative_to(BACKEND).as_posix(),
            )
        )
    return keys


def read_baseline():
    entries = set()
    for line in BASELINE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            entries.add(line)
    return entries


def test_no_new_permissionless_route():
    added = sorted(current_findings() - read_baseline())
    assert added == [], (
        "New route gated only by sign-in, with no require_permission / "
        "require_all_permissions / require_role. Every member of the "
        "organization can call it, so the handler alone decides what they "
        "see. Add a permission dependency, or, if the route is meant for "
        "every member (scoped to the caller, or data any member may read), "
        "add it to tests/permissionless_route_baseline.txt with a reason on "
        "the line above saying how it is scoped:\n  " + "\n  ".join(added)
    )


def test_baseline_has_no_stale_entries():
    """The list may only shrink, so it never drifts into a blanket pass."""
    stale = sorted(read_baseline() - current_findings())
    assert stale == [], (
        "These baseline entries no longer flag. If the route gained a "
        "permission dependency or was removed, delete the line; if it was "
        "renamed or moved, update it:\n  " + "\n  ".join(stale)
    )


class TestTheDetectionItself:
    """A ratchet that quietly stopped detecting would pass forever."""

    def _scan(self, source):
        return scan_source(source, "probe.py")

    def test_a_sign_in_only_route_is_flagged(self):
        assert self._scan(
            '@router.get("/mine")\n'
            "async def mine(current_user=Depends(get_current_user)):\n"
            "    pass\n"
        ) == ["probe.py::mine"]

    def test_a_permission_in_the_signature_clears_it(self):
        assert (
            self._scan(
                '@router.get("/x")\n'
                "async def x(current_user=Depends("
                'require_permission("a.view"))):\n'
                "    pass\n"
            )
            == []
        )

    def test_a_permission_in_the_decorator_clears_it(self):
        assert (
            self._scan(
                '@router.post("/x", dependencies=[Depends('
                'require_role("admin"))])\n'
                "async def x(current_user=Depends(get_current_user)):\n"
                "    pass\n"
            )
            == []
        )

    def test_a_route_with_no_auth_is_left_to_the_auth_coverage_test(self):
        assert (
            self._scan(
                '@router.get("/x")\nasync def x(db=Depends(get_db)):\n    pass\n'
            )
            == []
        )

    def test_a_plain_function_is_not_a_route(self):
        assert (
            self._scan(
                "async def helper(current_user=Depends(get_current_user)):\n    pass\n"
            )
            == []
        )

    def test_the_known_sign_in_only_routes_are_found(self):
        """Proves the sweep reads the real tree, not an empty directory."""
        assert {
            "app/api/v1/endpoints/membership_pipeline.py::list_my_sign_offs",
            "app/api/v1/endpoints/auth.py::get_current_user_info",
        } <= current_findings()
