"""A colleague's allowance usage and uniform sizes are quartermaster reads.

INV-8 / INV-9: ``GET /inventory/allowances/check/{user_id}/{category_id}`` and
``GET /inventory/members/{user_id}/size-preferences`` were gated on
``inventory.view``, which every member holds as part of the baseline Member
position, so any member could read how much of a category a colleague had been
issued and their uniform measurements. Owner decision: self or
``inventory.manage``, matching ``GET /inventory/users/{user_id}/clearance``.

The handlers are called directly with the service patched, so a 403 here is
raised before any query is issued.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.inventory import (
    check_member_allowance,
    get_member_size_preferences,
    router,
)

pytestmark = pytest.mark.unit

SELF = uuid.uuid4()
OTHER = uuid.uuid4()


def _user(user_id, *permissions):
    return SimpleNamespace(
        id=str(user_id),
        organization_id="org-a",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def _service():
    service = MagicMock()
    service._get_primary_role_id = AsyncMock(return_value=None)
    service.check_allowance = AsyncMock(
        return_value={
            "max_quantity": 2,
            "issued_this_period": 1,
            "remaining": 1,
            "period_type": "annual",
        }
    )
    service.get_member_size_preferences = AsyncMock(return_value=None)
    return service


@pytest.mark.parametrize(
    "path",
    [
        "/allowances/check/{user_id}/{category_id}",
        "/members/{user_id}/size-preferences",
    ],
)
def test_the_route_has_no_baseline_permission_dependency(path):
    """The gate lives in the handler; ``inventory.view`` must not be it."""
    for route in router.routes:
        if route.path == path and "GET" in route.methods:
            permissions = [
                dependency.call.required_permissions
                for dependency in route.dependant.dependencies
                if hasattr(dependency.call, "required_permissions")
            ]
            assert permissions == []
            return
    pytest.fail(f"GET {path} not found")


class TestAllowanceCheck:
    async def test_a_member_may_check_their_own(self):
        service = _service()
        with patch(
            "app.api.v1.endpoints.inventory.InventoryService", return_value=service
        ):
            result = await check_member_allowance(
                user_id=SELF,
                category_id=uuid.uuid4(),
                db=MagicMock(),
                current_user=_user(SELF, "inventory.view"),
            )
        assert result.remaining == 1

    async def test_a_baseline_member_may_not_check_a_colleagues(self):
        service = _service()
        with patch(
            "app.api.v1.endpoints.inventory.InventoryService", return_value=service
        ):
            with pytest.raises(HTTPException) as exc_info:
                await check_member_allowance(
                    user_id=OTHER,
                    category_id=uuid.uuid4(),
                    db=MagicMock(),
                    current_user=_user(SELF, "inventory.view"),
                )
        assert exc_info.value.status_code == 403
        service.check_allowance.assert_not_awaited()

    async def test_a_quartermaster_may_check_anyones(self):
        service = _service()
        with patch(
            "app.api.v1.endpoints.inventory.InventoryService", return_value=service
        ):
            result = await check_member_allowance(
                user_id=OTHER,
                category_id=uuid.uuid4(),
                db=MagicMock(),
                current_user=_user(SELF, "inventory.manage"),
            )
        assert result.max_quantity == 2


class TestSizePreferences:
    async def test_a_baseline_member_may_not_read_a_colleagues_sizes(self):
        service = _service()
        with patch(
            "app.api.v1.endpoints.inventory.InventoryService", return_value=service
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_member_size_preferences(
                    user_id=OTHER,
                    db=MagicMock(),
                    current_user=_user(SELF, "inventory.view"),
                )
        assert exc_info.value.status_code == 403
        service.get_member_size_preferences.assert_not_awaited()

    @pytest.mark.parametrize(
        ("target", "permissions"),
        [(SELF, ()), (OTHER, ("inventory.manage",))],
    )
    async def test_self_and_quartermaster_reach_the_lookup(self, target, permissions):
        service = _service()
        with patch(
            "app.api.v1.endpoints.inventory.InventoryService", return_value=service
        ):
            # No row on file is a 404 — past the gate, which is the point.
            with pytest.raises(HTTPException) as exc_info:
                await get_member_size_preferences(
                    user_id=target,
                    db=MagicMock(),
                    current_user=_user(SELF, *permissions),
                )
        assert exc_info.value.status_code == 404
        service.get_member_size_preferences.assert_awaited_once()
