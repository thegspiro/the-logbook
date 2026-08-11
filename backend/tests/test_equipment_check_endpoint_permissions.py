"""Authorization regressions for equipment-check inventory mutations."""

import pytest

from app.api.v1.endpoints.equipment_check import router


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/items/{template_item_id}/used", "DELETE"),
        ("/items/{template_item_id}/swap", "POST"),
    ],
)
def test_inventory_mutations_require_management_permission(path, method):
    """Baseline check submitters must not mutate supply officers' records."""
    permissions = _permission_set(path, method)

    assert permissions == {"equipment_check.manage", "inventory.manage"}
    assert "equipment_check.submit" not in permissions
