"""
Facilities Endpoint Permission Contract Tests

Locks two invariants on the facilities router (no DB — pure route
introspection, so it runs in the sandbox):

1. Every route is permission-gated (no bare-auth or open endpoints).
2. Sensitive resource families — access keys/codes, utility accounts and
   readings, capital projects, insurance policies, occupants — are NOT
   readable with the lower-privilege ``facilities.view`` grant.
3. ``facilities.view_sensitive`` is a READ-ONLY grant: sensitive GETs accept
   it (so explicitly authorized roles can read this data), but no mutation on
   the router does.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.facilities import (
    _SENSITIVE_READ_PERMISSIONS,
    _facility_response_for,
    _validate_shared_document_reference,
    router,
)
from app.core.permissions import (
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    get_permissions_by_category,
    permission_matches,
)
from app.models.user import Position, User

SENSITIVE_PREFIXES = (
    "/access-keys",
    "/utility-accounts",
    "/capital-projects",
    "/insurance-policies",
    "/occupants",
    "/documents",
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


def test_delete_permission_is_granular_across_every_destructive_route():
    """DELETE and facility archive accept the dedicated grant; no other
    mutation may accidentally inherit destructive authority."""
    destructive = []
    unexpected = []
    for route in _api_routes():
        accepts_delete = any(
            "facilities.delete" in permissions
            for permissions in _permission_sets(route)
        )
        is_destructive = route.methods == {"DELETE"} or (
            route.methods == {"POST"} and route.path == "/{facility_id}/archive"
        )
        if is_destructive:
            destructive.append(f"{sorted(route.methods)} {route.path}")
            assert (
                accepts_delete
            ), f"Destructive route missing facilities.delete: {route.path}"
            assert any(
                {"facilities.delete", "facilities.manage"} <= permissions
                for permissions in _permission_sets(route)
            ), f"Destructive route must retain manager access: {route.path}"
        elif accepts_delete:
            unexpected.append(f"{sorted(route.methods)} {route.path}")

    assert (
        len(destructive) == 20
    ), f"Expected all 19 DELETE routes plus archive, found {destructive}"
    assert not unexpected, (
        "facilities.delete must grant destructive operations only, found on: "
        f"{unexpected}"
    )


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


def test_default_positions_grant_sensitive_read_only_to_org_wide_roles():
    """Ranks whose duties require facility knowledge keep the sensitive read."""

    def perms(slug: str) -> set[str]:
        return set(DEFAULT_POSITIONS[slug]["permissions"])

    # Organization-wide roles may read all sensitive facility records without
    # receiving facility write access.
    for slug in ("vice_president", "treasurer"):
        assert "facilities.view_sensitive" in perms(slug), slug

    # Captain is a station-specific rank, while sensitive reads are scoped to
    # the organization. Do not grant cross-station access through rank defaults.
    assert "facilities.view_sensitive" not in perms("captain")

    # Full-management positions are covered through facilities.manage.
    for slug in (
        "fire_chief",
        "deputy_chief",
        "assistant_chief",
        "president",
        "facilities_manager",
    ):
        assert "facilities.manage" in perms(slug), slug

    # The baseline member cannot enter the facilities workspace at all.
    member = perms("member")
    assert "facilities.view" not in member
    assert not member & {
        "facilities.view_sensitive",
        "facilities.edit",
        "facilities.manage",
    }


def test_view_sensitive_is_offered_by_the_role_editor_catalog():
    """The role editor at /settings/roles builds its checkboxes from
    ``GET /roles/permissions/by-category``, which serves this catalog — if
    the permission drops out of it, existing organizations lose their only
    way to grant the sensitive read to additional positions."""
    facilities_perms = {
        p.name for p in get_permissions_by_category().get("facilities", [])
    }
    assert "facilities.view_sensitive" in facilities_perms


def test_chief_ranks_can_grant_captain_within_the_rank_ceiling():
    """A chief's facilities.manage satisfies the sensitive-read endpoints, but
    the rank grant ceiling compares permission names via permission_matches
    (exact / "*" / "module.*" only). Captain's defaults include
    facilities.view_sensitive, so without the explicit grant in the chief rank
    sets every Fire/Deputy/Assistant Chief got a 403 promoting a member to
    captain."""
    captain_perms = OPERATIONAL_RANKS["captain"]["default_permissions"]
    for chief in ("fire_chief", "deputy_chief", "assistant_chief"):
        chief_perms = set(OPERATIONAL_RANKS[chief]["default_permissions"])
        assert "facilities.view_sensitive" in chief_perms, chief
        missing = [
            perm for perm in captain_perms if not permission_matches(perm, chief_perms)
        ]
        assert not missing, f"{chief} cannot grant captain's defaults: {missing}"


def _user_with_permissions(perms: list[str]) -> User:
    user = User()
    user.positions.append(Position(permissions=perms))
    return user


def _facility_stub() -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="facility-1",
        organization_id="org-1",
        name="Station 1",
        is_archived=False,
        created_at=now,
        updated_at=now,
        lease_expiration=date(2030, 1, 1),
        property_tax_id="TAX-123",
    )


def test_facility_response_redacts_lease_fields_for_baseline_view():
    """lease_expiration/property_tax_id live on the main facility record
    (readable with facilities.view) but are lease terms — the sensitive tier's
    own boundary. Baseline viewers must get them blanked."""
    response = _facility_response_for(
        _facility_stub(), _user_with_permissions(["facilities.view"])
    )
    assert response.lease_expiration is None
    assert response.property_tax_id is None
    # The rest of the record stays intact for baseline viewers.
    assert response.name == "Station 1"


def test_facility_response_keeps_lease_fields_for_privileged_readers():
    for grant in (
        "facilities.view_sensitive",
        "facilities.edit",
        "facilities.manage",
        "facilities.*",
        "*",
    ):
        response = _facility_response_for(
            _facility_stub(), _user_with_permissions(["facilities.view", grant])
        )
        assert response.lease_expiration == date(2030, 1, 1), grant
        assert response.property_tax_id == "TAX-123", grant


def test_operational_reads_stay_available_to_facilities_view():
    """The baseline member grant must keep the operational surface readable."""
    operational_get_paths = {"", "/rooms", "/shutoff-locations", "/emergency-contacts"}
    for route in _api_routes():
        if route.path not in operational_get_paths or "GET" not in route.methods:
            continue
        assert any(
            "facilities.view" in permissions for permissions in _permission_sets(route)
        ), f"GET {route.path or '/'} no longer accepts facilities.view"


def test_file_crud_uses_four_distinct_facility_grants():
    """Reading, creating, editing and deleting are independent contracts."""
    expected = {
        ("GET", "/photos"): {"facilities.view", "facilities.manage"},
        ("GET", "/documents"): set(_SENSITIVE_READ_PERMISSIONS),
        ("POST", "/photos"): {
            "facilities.create",
            "facilities.edit",
            "facilities.manage",
        },
        ("POST", "/documents"): {
            "facilities.create",
            "facilities.edit",
            "facilities.manage",
        },
        ("PATCH", "/photos/{photo_id}"): {"facilities.edit", "facilities.manage"},
        ("PATCH", "/documents/{document_id}"): {"facilities.edit", "facilities.manage"},
        ("DELETE", "/photos/{photo_id}"): {"facilities.manage"},
        ("DELETE", "/documents/{document_id}"): {"facilities.manage"},
    }
    actual = {}
    for route in _api_routes():
        for method in route.methods:
            key = (method, route.path)
            if key in expected:
                actual[key] = _permission_sets(route)[0]
    assert actual == expected


@pytest.mark.asyncio
async def test_shared_file_reference_rejects_cross_organization_document():
    """The org-scoped storage lookup must not allow attaching another org's ID."""
    user = SimpleNamespace(organization_id=str(uuid4()))
    with patch(
        "app.api.v1.endpoints.facilities.DocumentsService.get_document_by_id",
        new=AsyncMock(return_value=None),
    ) as lookup:
        with pytest.raises(HTTPException) as exc:
            await _validate_shared_document_reference(
                AsyncMock(), f"document:{uuid4()}", user
            )
    assert exc.value.status_code == 404
    assert str(lookup.await_args.args[1]) == user.organization_id
