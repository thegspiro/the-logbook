"""
Facilities Endpoint Permission Contract Tests

Locks two invariants on the facilities router (no DB — pure route
introspection, so it runs in the sandbox):

1. Every route is permission-gated (no bare-auth or open endpoints).
2. Sensitive resource families — access keys/codes, utility accounts and
   readings, capital projects, insurance policies, occupants — are NOT
   readable with the baseline ``facilities.view`` grant. The default
   "member" position holds ``facilities.view``, so exposing these reads to
   it would hand every member door/alarm codes, account numbers, budgets,
   and lease terms.
"""

from fastapi.routing import APIRoute

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.facilities import router

SENSITIVE_PREFIXES = (
    "/access-keys",
    "/utility-accounts",
    "/capital-projects",
    "/insurance-policies",
    "/occupants",
)


def _permission_sets(route: APIRoute) -> list[set[str]]:
    """Collect the required-permission sets of every PermissionChecker on a route."""
    found: list[set[str]] = []

    def walk(dependant):
        for dep in dependant.dependencies:
            if isinstance(dep.call, PermissionChecker):
                found.append(set(dep.call.required_permissions))
            walk(dep)

    walk(route.dependant)
    return found


def _api_routes() -> list[APIRoute]:
    routes = [r for r in router.routes if isinstance(r, APIRoute)]
    assert routes, "facilities router has no routes — import wiring broken?"
    return routes


def test_every_facilities_route_is_permission_gated():
    ungated = [
        f"{sorted(route.methods)} {route.path}"
        for route in _api_routes()
        if not _permission_sets(route)
    ]
    assert not ungated, f"Routes without a permission check: {ungated}"


def test_sensitive_families_are_not_readable_with_facilities_view():
    leaky = []
    sensitive_routes = 0
    for route in _api_routes():
        if not route.path.startswith(SENSITIVE_PREFIXES):
            continue
        sensitive_routes += 1
        for permissions in _permission_sets(route):
            if "facilities.view" in permissions:
                leaky.append(f"{sorted(route.methods)} {route.path}")
    # Guard the guard: prefix drift must fail loudly, not skip silently.
    assert sensitive_routes >= 22, (
        f"Only {sensitive_routes} sensitive routes matched — did the "
        "sensitive route paths move?"
    )
    assert not leaky, (
        "Sensitive facility data must require facilities.edit/manage, "
        f"but these routes accept facilities.view: {leaky}"
    )


def test_operational_reads_stay_available_to_facilities_view():
    """The baseline member grant must keep the operational surface readable."""
    operational_get_paths = {"", "/rooms", "/shutoff-locations", "/emergency-contacts"}
    for route in _api_routes():
        if route.path not in operational_get_paths or "GET" not in route.methods:
            continue
        assert any(
            "facilities.view" in permissions for permissions in _permission_sets(route)
        ), f"GET {route.path or '/'} no longer accepts facilities.view"
