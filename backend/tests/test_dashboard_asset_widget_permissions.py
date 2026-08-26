"""Authorization regression tests for dashboard asset widgets."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_asset_widgets

# Every asset module switched on, so these tests isolate the permission gate.
ALL_ASSET_MODULES = ["inventory", "apparatus", "facilities"]

# Every one of these is granted to DEFAULT_POSITIONS["member"], so a widget
# gated on one is a widget every firefighter in the department receives.
BASELINE_MEMBER_GRANTS = ["inventory.view", "apparatus.view", "facilities.view"]


@pytest.mark.asyncio
@pytest.mark.parametrize("granted", BASELINE_MEMBER_GRANTS)
async def test_baseline_view_grants_receive_no_asset_widgets(granted: str):
    """A baseline member must not receive organization-wide asset counts."""
    user = SimpleNamespace(organization_id="org-1")

    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(
                return_value=SimpleNamespace(enabled_modules=ALL_ASSET_MODULES)
            ),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission == granted,
        ),
        patch(
            "app.api.v1.endpoints.dashboard.InventoryService",
            side_effect=AssertionError("inventory service must not be queried"),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.ApparatusService",
            side_effect=AssertionError("apparatus service must not be queried"),
        ),
    ):
        result = await get_asset_widgets(db=SimpleNamespace(), current_user=user)

    assert result.widgets == []
