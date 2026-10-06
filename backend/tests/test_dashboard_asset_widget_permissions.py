"""Authorization regression tests for dashboard asset widgets."""

from datetime import date
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
async def test_facilities_does_not_report_one_count_under_two_titles():
    """Each facilities tile must describe a population of its own.

    ``facilities-maintenance`` used to render the same overdue-work-order count
    as ``facilities-urgent-work-orders`` — one ``due_date <= today`` query
    feeding two tiles — under the title "Maintenance due", so a department with
    three overdue work orders read "Urgent work orders: 3" beside
    "Maintenance due: 3" and had no way to tell they were the same three.
    """
    user = SimpleNamespace(organization_id="org-1")
    # Distinct per call so a reused figure is visible as a repeated value
    # rather than hidden behind a single constant.
    db = SimpleNamespace(scalar=AsyncMock(side_effect=[7, 2, 5]))

    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["facilities"])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission
            in {"facilities.manage", "facilities.view"},
        ),
        patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=date(2026, 10, 4)),
        ),
    ):
        result = await get_asset_widgets(db=db, current_user=user)

    facilities = [w for w in result.widgets if w.module == "facilities"]
    assert facilities, "the facilities block did not run"
    assert "facilities-maintenance" not in {w.id for w in facilities}
    # The real guard: no two tiles may carry the same figure, which is what a
    # reinstated duplicate would do however it were titled.
    counts = [w.count for w in facilities]
    assert len(counts) == len(
        set(counts)
    ), "two facilities tiles report the same count: " + ", ".join(
        f"{w.id}={w.count}" for w in facilities
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("module", ALL_ASSET_MODULES)
async def test_settings_manager_without_the_modules_own_grant_gets_no_widgets(
    module: str,
):
    """A tile whose only action is Access Denied is worse than no tile.

    ``settings.manage`` is authority for the tallies, but every widget links
    into its module's pages, and those routes carry their own entry
    permissions: ``/apparatus`` wants ``apparatus.view`` OR
    ``apparatus.manage``, ``/facilities*`` wants ``facilities.view`` OR
    ``facilities.manage``, and ``/inventory*`` wants ``inventory.manage``
    outright. A delegated settings role holding none of them used to follow
    those links fine, because the two view grants were seeded to everybody;
    that stopped being so on 2026-08-26 and 2026-09-05.

    Parametrized per module because the lesson originally landed on apparatus
    alone — the inventory and facilities blocks kept handing out nine tiles
    that answered Access Denied until pass 3 (DASH-32).
    """
    user = SimpleNamespace(organization_id="org-1")

    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            # One module at a time, so a block that is legitimately empty for
            # another reason cannot stand in for the gate under test.
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=[module])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission == "settings.manage",
        ),
        patch(
            "app.api.v1.endpoints.dashboard.InventoryService",
            side_effect=AssertionError("inventory service must not be queried"),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.ApparatusService",
            side_effect=AssertionError("apparatus service must not be queried"),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(
                side_effect=AssertionError("no date lookup for a block that is skipped")
            ),
        ),
    ):
        result = await get_asset_widgets(db=SimpleNamespace(), current_user=user)

    assert result.widgets == []
