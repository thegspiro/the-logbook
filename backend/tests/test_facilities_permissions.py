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
3. ``facilities.view_sensitive`` is a READ-ONLY grant: sensitive GETs accept
   it (so captain / vice president / treasurer can read this data), but no
   mutation on the router does.
"""

from fastapi.routing import APIRoute

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.facilities import router
from app.core.permissions import DEFAULT_POSITIONS

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
        "Sensitive facility data must require "
        "facilities.view_sensitive/edit/manage, "
        f"but these routes accept facilities.view: {leaky}"
    )


def test_view_sensitive_grants_sensitive_reads_but_never_writes():
    missing_read = []
    writable = []
    for route in _api_routes():
        accepts = any(
            "facilities.view_sensitive" in permissions
            for permissions in _permission_sets(route)
        )
        if route.path.startswith(SENSITIVE_PREFIXES) and route.methods == {"GET"}:
            if not accepts:
                missing_read.append(route.path)
        elif accepts:
            # Any non-GET route, and any GET outside the sensitive families,
            # has no business accepting the read-only sensitive grant.
            writable.append(f"{sorted(route.methods)} {route.path}")
    assert (
        not missing_read
    ), f"Sensitive GETs missing facilities.view_sensitive: {missing_read}"
    assert (
        not writable
    ), f"facilities.view_sensitive must stay read-only, found on: {writable}"


def test_default_positions_grant_sensitive_read_to_facility_ranks():
    """Ranks whose duties require facility knowledge keep the sensitive read."""

    def perms(slug: str) -> set[str]:
        return set(DEFAULT_POSITIONS[slug]["permissions"])

    # Read-only sensitive access for ranks with facility duties but no
    # facility write role: station commander, president's deputy, and the
    # treasurer (utilities/insurance/budgets are financial records).
    for slug in ("captain", "vice_president", "treasurer"):
        assert "facilities.view_sensitive" in perms(slug), slug

    # Full-management positions are covered through facilities.manage.
    for slug in (
        "fire_chief",
        "deputy_chief",
        "assistant_chief",
        "president",
        "facilities_manager",
    ):
        assert "facilities.manage" in perms(slug), slug

    # The baseline member stays operational-only.
    member = perms("member")
    assert "facilities.view" in member
    assert not member & {
        "facilities.view_sensitive",
        "facilities.edit",
        "facilities.manage",
    }


def test_operational_reads_stay_available_to_facilities_view():
    """The baseline member grant must keep the operational surface readable."""
    operational_get_paths = {"", "/rooms", "/shutoff-locations", "/emergency-contacts"}
    for route in _api_routes():
        if route.path not in operational_get_paths or "GET" not in route.methods:
            continue
        assert any(
            "facilities.view" in permissions for permissions in _permission_sets(route)
        ), f"GET {route.path or '/'} no longer accepts facilities.view"
