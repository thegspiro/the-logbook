"""Regression tests for static finance routes shadowed by a dynamic sibling.

Starlette matches routes in registration order and takes the first full
match, so a fixed-path route (``/budgets/summary``, ``/approval-chains/
preview``) registered *after* a same-method, same-shape ``/{id}``-style route
is permanently unreachable: every request lands on the id-lookup handler with
the literal path segment ("summary", "preview") as the id, which never
matches a real row and always 404s. Both were broken this way — see
``test_roles_route_resolution.py`` for the same bug class caught earlier in
the roles router.
"""

from starlette.routing import Match

from app.api.v1.endpoints.finance import router


def _full_matches(path: str, method: str = "GET") -> list[str]:
    """Every route that would fully match, in registration order.

    Real dispatch takes only the first entry — a later fully-matching route
    is exactly the "shadowed and unreachable" bug this file exists to catch,
    so the whole list (not just the first hit) is what these tests assert on.
    """
    scope = {"type": "http", "path": path, "method": method}
    return [
        route.endpoint.__name__
        for route in router.routes
        if route.matches(scope)[0] == Match.FULL
    ]


def _resolves_to(path: str, method: str = "GET") -> str:
    """The endpoint name dispatch would actually pick: the first full match."""
    matches = _full_matches(path, method)
    assert matches, f"no route matches {method} {path}"
    return matches[0]


def test_budget_summary_is_not_captured_as_a_budget_id() -> None:
    # `/{budget_id}` structurally matches "summary" too (a bare `str` path
    # param matches any single segment) -- the bug is that route winning the
    # dispatch, which is what `_resolves_to` (registration-order winner)
    # checks, not whether the by-id route matches at all.
    assert _resolves_to("/budgets/summary") == "get_budget_summary"


def test_budget_id_routes_still_match_a_real_id() -> None:
    budget_id = "00000000-0000-0000-0000-000000000001"
    assert _resolves_to(f"/budgets/{budget_id}") == "get_budget"
    assert _resolves_to(f"/budgets/{budget_id}", "PUT") == "update_budget"


def test_approval_chain_preview_is_not_captured_as_a_chain_id() -> None:
    assert _resolves_to("/approval-chains/preview") == "preview_approval_chain"


def test_approval_chain_id_routes_still_match_a_real_id() -> None:
    chain_id = "00000000-0000-0000-0000-000000000001"
    assert _resolves_to(f"/approval-chains/{chain_id}") == "get_approval_chain"
    assert _resolves_to(f"/approval-chains/{chain_id}", "PUT") == (
        "update_approval_chain"
    )
    assert _resolves_to(f"/approval-chains/{chain_id}", "DELETE") == (
        "delete_approval_chain"
    )


def test_no_route_in_the_finance_router_is_shadowed_by_an_earlier_one() -> None:
    """Whole-router sweep, not just the two known cases.

    For every route, replay its own path/method against every route
    registered *before* it. A full match on an earlier route means the later
    route can never be reached.
    """
    routes = router.routes
    for index, route in enumerate(routes):
        for method in route.methods:
            scope = {"type": "http", "path": route.path, "method": method}
            for earlier in routes[:index]:
                match, _ = earlier.matches(scope)
                assert match != Match.FULL, (
                    f"{method} {route.path} ({route.endpoint.__name__}) is "
                    f"shadowed by earlier route {earlier.path} "
                    f"({earlier.endpoint.__name__})"
                )
