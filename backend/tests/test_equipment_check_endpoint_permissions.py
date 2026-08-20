"""Equipment-check endpoint authorization and request regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import equipment_check as equipment_check_endpoint
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
def test_submission_endpoints_reject_arbitrary_timing(schema):
    """FastAPI request models reject values close-out cannot understand."""
    with pytest.raises(ValidationError):
        schema(
            template_id="tmpl-1",
            check_timing="whenever_the_client_says",
            items=[_check_item()],
        )


@pytest.mark.parametrize(
    "schema",
    [ShiftEquipmentCheckCreate, StandaloneEquipmentCheckCreate],
)
def test_submission_endpoints_allow_omitting_compatibility_timing(schema):
    request = schema(template_id="tmpl-1", items=[_check_item()])

    assert request.check_timing is None


async def test_shift_submission_endpoint_returns_400_for_template_mismatch():
    """A supported-but-wrong legacy value is surfaced as a client error."""
    service = MagicMock()
    service.submit_check = AsyncMock(
        side_effect=ValueError("check_timing does not match the selected template")
    )
    request = ShiftEquipmentCheckCreate(
        template_id="tmpl-1",
        check_timing="start_of_shift",
        items=[_check_item()],
    )
    user = SimpleNamespace(id="user-1", organization_id="org-1")

    with (
        patch.object(
            equipment_check_endpoint,
            "EquipmentCheckService",
            return_value=service,
        ),
        patch.object(
            equipment_check_endpoint, "_collect_user_permissions", return_value=[]
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await equipment_check_endpoint.submit_check(
                shift_id="shift-1",
                data=request,
                db=MagicMock(),
                current_user=user,
            )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "check_timing does not match the selected template"
    service.submit_check.assert_awaited_once()
