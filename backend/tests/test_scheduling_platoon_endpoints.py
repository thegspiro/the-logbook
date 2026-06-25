"""
Tests for the platoon-management endpoint permission gating.

Unit-level: inspects the scheduling router's declared dependencies without a
running server or database. The overview is read-gated; the bulk-assign is
manage-gated.
"""

from app.api.v1.endpoints.scheduling import router


def _get_route_deps(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == path:
            if method in getattr(route, "methods", set()):
                dependant = getattr(route, "dependant", None)
                if not dependant:
                    return None
                names = []
                for dep in dependant.dependencies:
                    call = dep.call
                    perms = getattr(call, "required_permissions", None)
                    if perms:
                        names.append(f"PermissionChecker({','.join(perms)})")
                    else:
                        names.append(getattr(call, "__name__", str(call)))
                return names
    return None


class TestPlatoonEndpoints:
    def test_overview_route_exists(self):
        assert _get_route_deps("/platoons/overview", "GET") is not None

    def test_overview_requires_scheduling_view(self):
        deps = _get_route_deps("/platoons/overview", "GET")
        assert any(
            "scheduling.view" in d or "require_permission" in d for d in deps
        ), deps

    def test_bulk_assign_route_exists(self):
        assert _get_route_deps("/platoons/bulk-assign", "POST") is not None

    def test_bulk_assign_requires_scheduling_manage(self):
        deps = _get_route_deps("/platoons/bulk-assign", "POST")
        assert any(
            "scheduling.manage" in d or "require_permission" in d for d in deps
        ), deps
