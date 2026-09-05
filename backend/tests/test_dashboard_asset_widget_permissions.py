"""Authorization regression tests for dashboard asset widgets."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_asset_widgets

# Every asset module switched on, so these tests isolate the permission gate.
ALL_ASSET_MODULES = ["inventory", "apparatus", "facilities"]

# View-level grants that must not open an organization-wide asset count.
# `inventory.view` is seeded to every member today; `facilities.view` and
# `apparatus.view` were, and were revoked (2026-08-26 and 2026-09-05). All
# three are kept here deliberately — a widget gated on a module's plain view
# grant is a widget any department could re-open to its whole roster by adding
# that grant back to its Member position on the positions screen.
VIEW_LEVEL_GRANTS = ["inventory.view", "apparatus.view", "facilities.view"]


@pytest.mark.asyncio
@pytest.mark.parametrize("granted", VIEW_LEVEL_GRANTS)
async def test_view_level_grants_receive_no_asset_widgets(granted: str):
    """A module's plain view grant must not open organization-wide counts."""
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


@pytest.mark.asyncio
async def test_settings_manager_without_an_apparatus_grant_gets_no_fleet_widgets():
    """A tile whose only action is Access Denied is worse than no tile.

    ``settings.manage`` is authority for the fleet tallies, but every apparatus
    widget links to ``/apparatus``, which the route and its endpoints gate on
    ``apparatus.view`` OR ``apparatus.manage``. A delegated settings role
    holding neither used to follow that link fine, because ``apparatus.view``
    was seeded to everybody; it stopped being so on 2026-09-05.
    """
    user = SimpleNamespace(organization_id="org-1")

    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            # Apparatus alone: `settings.manage` legitimately opens the
            # inventory and facilities blocks, which are not what this asserts.
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["apparatus"])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission == "settings.manage",
        ),
        patch(
            "app.api.v1.endpoints.dashboard.ApparatusService",
            side_effect=AssertionError("apparatus service must not be queried"),
        ),
    ):
        result = await get_asset_widgets(db=SimpleNamespace(), current_user=user)

    assert [w for w in result.widgets if w.module == "apparatus"] == []
