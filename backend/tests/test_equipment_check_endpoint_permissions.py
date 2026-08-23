"""Equipment-check endpoint authorization and request regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.equipment_check import router
from app.core.database import get_db
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


def test_withdrawing_a_restock_report_requires_management_permission():
    """Baseline check submitters must not clear the supply worklist.

    Raising a restock report is the crew's (POST, submit-level); withdrawing
    one is the officer deciding the shelf has been dealt with.
    """
    permissions = _permission_set("/items/{template_item_id}/used", "DELETE")

    assert permissions == {"equipment_check.manage", "inventory.manage"}
    assert "equipment_check.submit" not in permissions


def test_swapping_stock_onto_a_truck_is_open_to_check_submitters():
    """Replacing expired stock is the crew's job standing at the compartment.

    EC-3 put a permission on this endpoint because it had none at all — any
    member could consume ready stock unauthenticated by role. A submit-level
    gate keeps that closed: the caller still needs a check permission, the
    lot is still org-scoped, every stored value still comes from the
    InventoryLot row rather than the request, and the swap is still recorded
    against its author. Requiring a manage right on top of that did not
    protect the record, it just meant an expired unit stayed on the truck
    until an officer was found.
    """
    permissions = _permission_set("/items/{template_item_id}/swap", "POST")

    assert permissions == {
        "equipment_check.submit",
        "equipment_check.manage",
        "inventory.manage",
    }


def test_supply_overview_requires_officer_permission():
    """Check and inventory officers, but not baseline viewers, get access."""
    permissions = _permission_set("/supply/expiring-items", "GET")

    assert permissions == {"equipment_check.view", "inventory.manage"}
    assert "inventory.view" not in permissions


@pytest.mark.parametrize(
    ("path", "method"),
    [("/checks", "POST"), ("/checks/{check_id}/complete", "PUT")],
)
def test_standalone_check_writes_require_submit_or_manage(path, method):
    assert _permission_set(path, method) == {
        "equipment_check.submit",
        "equipment_check.manage",
    }


def _user_with(*permissions: str):
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def _permission_dependency(path: str, method: str):
    for route in router.routes:
        if route.path == path and method in route.methods:
            return next(
                dependency.call
                for dependency in route.dependant.dependencies
                if getattr(dependency.call, "required_permissions", None) is not None
            )
    pytest.fail(f"Permission dependency not found for {method} {path}")


@pytest.mark.parametrize(
    "permissions",
    [("equipment_check.submit",), ("equipment_check.manage",)],
    ids=["submit-only user", "manager"],
)
@pytest.mark.parametrize(
    ("path", "method"),
    [("/checks", "POST"), ("/checks/{check_id}/complete", "PUT")],
)
async def test_submitters_and_managers_are_authorized(permissions, path, method):
    user = _user_with(*permissions)

    assert await _permission_dependency(path, method)(current_user=user) is user


async def _unauthorized_request(path: str, user, service_method: str):
    """Issue a real ASGI request and expose the would-be persistence call."""
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    payload = {
        "template_id": "template-1",
        "items": [
            {
                "template_item_id": "item-1",
                "compartment_name": "Cab",
                "item_name": "SCBA",
                "status": "fail",
            }
        ],
    }
    if path.endswith("/complete"):
        payload.pop("template_id")

    with patch(
        f"app.services.equipment_check_service.EquipmentCheckService.{service_method}",
        new_callable=AsyncMock,
    ) as persist:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.request(
                "PUT" if path.endswith("/complete") else "POST",
                path,
                json=payload,
            )
    return response, persist


async def test_user_with_no_grant_cannot_create_check_or_deficiency():
    check_records = []
    apparatus_deficiencies = []

    response, persist = await _unauthorized_request(
        "/checks", _user_with(), "submit_standalone_check"
    )

    assert response.status_code == 403
    persist.assert_not_awaited()
    assert check_records == []
    assert apparatus_deficiencies == []


async def test_removed_grant_cannot_complete_or_change_existing_records():
    # This models a draft created while the member held .submit. Authorization
    # must use their current grants, before the service can update either row.
    check_records = {"check-1": {"overall_status": "incomplete"}}
    apparatus_deficiencies = {"apparatus-1": {"has_deficiency": False}}
    former_submitter = _user_with()

    response, persist = await _unauthorized_request(
        "/checks/check-1/complete",
        former_submitter,
        "complete_incomplete_check",
    )

    assert response.status_code == 403
    persist.assert_not_awaited()
    assert check_records == {"check-1": {"overall_status": "incomplete"}}
    assert apparatus_deficiencies == {"apparatus-1": {"has_deficiency": False}}


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
