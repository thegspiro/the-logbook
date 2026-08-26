"""A disabled module puts nothing on anybody's dashboard.

Permission and module enablement answer different questions, and the dashboard
endpoints used to ask only the first. ``finance.manage`` says this treasurer
may see the department's money; it does not say the department runs the
Finance module — and the three finance cards on the main dashboard are the
only link into ``/finance`` anywhere in the UI, so a department that had
switched Finance off was still handed its dues, cash flow and budget burn.

The same shape was live in ``/asset-widgets``, which gated inventory,
apparatus and facilities counts on permission alone.

These call the endpoint functions directly with the database mocked, so an
assertion about ``db.execute`` is an assertion that the query was never
issued — a module that is off should cost nothing, not merely be filtered out
of the response afterwards.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_asset_widgets, get_main_dashboard_widgets

pytestmark = pytest.mark.asyncio

# Everything the two endpoints can gate on, so a test that names one module
# switches off exactly that one.
ALL_MODULES = [
    "members",
    "events",
    "documents",
    "roles",
    "settings",
    "finance",
    "grants",
    "inventory",
    "apparatus",
    "facilities",
]

WIDGET_PERMISSIONS = ["finance.manage", "fundraising.view", "events.manage"]
ASSET_PERMISSIONS = ["inventory.manage", "apparatus.manage", "facilities.manage"]


def _user():
    return SimpleNamespace(id="chief", organization_id="org-a")


def _without(*modules: str) -> list[str]:
    return [module for module in ALL_MODULES if module not in modules]


def _patches(enabled: list[str], granted: list[str]):
    """Module lookup and permission checks, both answered from memory."""
    return (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=enabled)),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in granted,
        ),
    )


async def _widgets(enabled: list[str], granted: list[str]):
    service = MagicMock()
    service.finance = AsyncMock(return_value={"dues_paid": 1})
    service.fundraising = AsyncMock(return_value={"campaign_raised": 1})
    service.community = AsyncMock(return_value={"public_events": 1})
    modules_patch, permission_patch = _patches(enabled, granted)
    with (
        modules_patch,
        permission_patch,
        patch(
            "app.api.v1.endpoints.dashboard.DashboardWidgetService",
            return_value=service,
        ),
    ):
        response = await get_main_dashboard_widgets(
            period="month", db=MagicMock(), current_user=_user()
        )
    return response, service


async def test_finance_widgets_need_the_finance_module_not_just_the_permission():
    """The reported defect: a treasurer's cards on a department with no Finance."""
    response, service = await _widgets(_without("finance"), WIDGET_PERMISSIONS)

    assert response.finance is None
    service.finance.assert_not_awaited()
    # The other two blocks are unaffected — this is a per-module gate.
    assert response.fundraising is not None
    assert response.community is not None


async def test_finance_widgets_are_served_when_the_module_is_on():
    """The gate has to let the enabled case through, or it is just a removal."""
    response, service = await _widgets(ALL_MODULES, WIDGET_PERMISSIONS)

    assert response.finance == {"dues_paid": 1}
    service.finance.assert_awaited_once_with("org-a", "month")


async def test_community_widgets_need_the_events_module():
    response, service = await _widgets(_without("events"), WIDGET_PERMISSIONS)

    assert response.community is None
    service.community.assert_not_awaited()


async def test_fundraising_widgets_need_the_grants_module():
    response, service = await _widgets(_without("grants"), WIDGET_PERMISSIONS)

    assert response.fundraising is None
    service.fundraising.assert_not_awaited()


@pytest.mark.parametrize(
    ("module", "prefix"),
    [
        ("inventory", "inventory-"),
        ("apparatus", "apparatus-"),
        ("facilities", "facilities-"),
    ],
)
async def test_a_disabled_asset_module_contributes_no_widgets(module: str, prefix: str):
    db = MagicMock()
    db.scalar = AsyncMock(return_value=0)
    modules_patch, permission_patch = _patches(_without(module), ASSET_PERMISSIONS)
    with (
        modules_patch,
        permission_patch,
        patch("app.api.v1.endpoints.dashboard.InventoryService") as inventory,
        patch("app.api.v1.endpoints.dashboard.ApparatusService") as apparatus,
    ):
        inventory.return_value.get_inventory_summary = AsyncMock(
            return_value={"total_items": 0}
        )
        inventory.return_value.get_low_stock_items = AsyncMock(return_value=[])
        apparatus.return_value.get_fleet_summary = AsyncMock(
            return_value={
                "out_of_service_count": 0,
                "in_maintenance_count": 0,
                "maintenance_due_soon": 0,
            }
        )
        response = await get_asset_widgets(db=db, current_user=_user())

    assert not [w for w in response.widgets if w.id.startswith(prefix)]
    # The other two modules still report, so this is not an all-or-nothing gate.
    assert response.widgets


async def test_every_asset_module_off_queries_nothing_at_all():
    """Off must mean not asked, not asked-and-discarded."""
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=AssertionError("no asset count may be queried"))
    modules_patch, permission_patch = _patches(
        _without("inventory", "apparatus", "facilities"), ASSET_PERMISSIONS
    )
    with (
        modules_patch,
        permission_patch,
        patch(
            "app.api.v1.endpoints.dashboard.InventoryService",
            side_effect=AssertionError("inventory service must not be queried"),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.ApparatusService",
            side_effect=AssertionError("apparatus service must not be queried"),
        ),
    ):
        response = await get_asset_widgets(db=db, current_user=_user())

    assert response.widgets == []
