"""Regression tests for static role routes shadowed by ``/{role_id}``."""

from starlette.routing import Match

from app.api.v1.endpoints.roles import router


def _full_matches(path: str, method: str = "GET") -> list[str]:
    scope = {"type": "http", "path": path, "method": method}
    return [
        route.endpoint.__name__
        for route in router.routes
        if route.matches(scope)[0] == Match.FULL
    ]


def test_static_role_routes_are_not_captured_as_role_ids() -> None:
    """Named endpoints must resolve without first failing UUID validation."""
    assert _full_matches("/my/roles") == ["get_my_roles"]
    assert _full_matches("/my/permissions") == ["get_my_permissions"]
    assert _full_matches("/admin-access/check") == ["check_admin_access"]
    assert _full_matches("/user/00000000-0000-0000-0000-000000000001/permissions") == [
        "get_user_permissions"
    ]


def test_role_id_routes_still_match_uuids() -> None:
    role_id = "00000000-0000-0000-0000-000000000001"
    assert _full_matches(f"/{role_id}") == ["get_role"]
    assert _full_matches(f"/{role_id}", "PATCH") == ["update_role"]
    assert _full_matches(f"/{role_id}", "DELETE") == ["delete_role"]
    assert _full_matches(f"/{role_id}/clone", "POST") == ["clone_role"]
    assert _full_matches(f"/{role_id}/users") == ["get_role_users"]
