"""Equipment-check endpoint authorization and request regressions."""

import pytest

from app.api.v1.endpoints.equipment_check import router
from app.schemas.equipment_check import (
    ShiftEquipmentCheckCreate,
    StandaloneEquipmentCheckCreate,
)


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


def test_supply_overview_requires_officer_permission():
    """Check and inventory officers, but not baseline viewers, get access."""
    permissions = _permission_set("/supply/expiring-items", "GET")

    assert permissions == {"equipment_check.view", "inventory.manage"}
    assert "inventory.view" not in permissions


def _check_item():
    return {
        "template_item_id": "item-1",
        "compartment_name": "Cab",
        "item_name": "SCBA",
        "status": "pass",
    }


@pytest.mark.parametrize(
    "schema",
    [ShiftEquipmentCheckCreate, StandaloneEquipmentCheckCreate],
)
def test_submission_endpoints_discard_arbitrary_timing(schema):
    """Submission payloads cannot forward timing into the service layer."""
    request = schema(
        template_id="tmpl-1",
        check_timing="whenever_the_client_says",
        items=[_check_item()],
    )

    assert "check_timing" not in request.model_dump()


@pytest.mark.parametrize(
    "schema",
    [ShiftEquipmentCheckCreate, StandaloneEquipmentCheckCreate],
)
def test_submission_endpoints_do_not_define_client_timing(schema):
    request = schema(template_id="tmpl-1", items=[_check_item()])

    assert "check_timing" not in type(request).model_fields
