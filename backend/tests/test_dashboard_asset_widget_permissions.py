"""Authorization regression tests for dashboard asset widgets."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.api.v1.endpoints.dashboard import get_asset_widgets


@pytest.mark.asyncio
async def test_inventory_widgets_require_an_inventory_admin_permission():
    """A regular inventory viewer must not receive organization-wide counts."""
    user = SimpleNamespace(organization_id="org-1")
    permissions = {"inventory.view"}

    with (
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in permissions,
        ),
        patch(
            "app.api.v1.endpoints.dashboard.InventoryService",
            side_effect=AssertionError("inventory service must not be queried"),
        ),
    ):
        result = await get_asset_widgets(db=SimpleNamespace(), current_user=user)

    assert result.widgets == []
