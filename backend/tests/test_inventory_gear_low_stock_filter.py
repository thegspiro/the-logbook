"""The gear items list and its export take ``low_stock`` (the alert email's link).

The low-stock alert email links gear recipients to
``/inventory/admin/items?low_stock=true``. That page is only worth opening if
it lists exactly the items the email named, so the filter must reuse the
email's own scan (``get_low_stock_items_for_alerts``) rather than define "low"
a second time, must leave medical stock out as the rest of the gear list does,
and must reach the export too: a file that disagrees with the screen it was
exported from is read as the truth.

Mocked sessions and services — no DB.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints import inventory as inventory_endpoints
from app.models.inventory import MEDICAL_ITEM_TYPES, ItemType
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.unit

ORG_ID = "org-1"


def _user():
    return SimpleNamespace(id="user-1", organization_id=ORG_ID, positions=[], rank=None)


def _low_row(item_id):
    return (SimpleNamespace(id=item_id), 1, False)


class _Session:
    async def __aenter__(self):
        return MagicMock()

    async def __aexit__(self, *exc_info):
        return False


@pytest.fixture
def service():
    svc = MagicMock()
    svc.get_items = AsyncMock(return_value=([], 0))
    svc.get_item_group_counts = AsyncMock(return_value=[])
    svc.get_items_page = AsyncMock(return_value=[])
    svc.get_low_stock_items_for_alerts = AsyncMock(
        return_value=[_low_row("i-1"), _low_row("i-2")]
    )
    with patch.object(
        inventory_endpoints,
        "InventoryService",
        return_value=svc,
        GROUPABLE=InventoryService.GROUPABLE,
    ):
        yield svc


async def _list(**overrides):
    params = dict(skip=0, limit=100, sort_order=None, db=AsyncMock())
    params.update(overrides)
    return await inventory_endpoints.list_items(current_user=_user(), **params)


class TestListLowStock:
    async def test_narrows_to_the_alert_scans_items_without_medical_stock(
        self, service
    ):
        await _list(low_stock=True)

        service.get_low_stock_items_for_alerts.assert_awaited_once_with(
            ORG_ID, exclude_item_types=MEDICAL_ITEM_TYPES
        )
        assert service.get_items.await_args.kwargs["item_ids"] == ["i-1", "i-2"]

    async def test_nothing_low_lists_nothing_rather_than_everything(self, service):
        service.get_low_stock_items_for_alerts.return_value = []

        await _list(low_stock=True)

        # An empty id set must reach the query as an empty set: None means
        # "no narrowing" and would list the whole catalogue under a low-stock
        # banner.
        assert service.get_items.await_args.kwargs["item_ids"] == []

    async def test_group_headers_count_the_same_narrowed_set(self, service):
        await _list(low_stock=True, group_by="color")

        assert service.get_item_group_counts.await_args.kwargs["item_ids"] == [
            "i-1",
            "i-2",
        ]

    async def test_without_the_flag_the_scan_is_not_run(self, service):
        await _list()

        service.get_low_stock_items_for_alerts.assert_not_awaited()
        assert service.get_items.await_args.kwargs["item_ids"] is None


class TestExportLowStock:
    async def _export(self, **params):
        with patch.object(
            inventory_endpoints, "async_session_factory", return_value=_Session()
        ):
            response = await inventory_endpoints.export_items_csv(
                current_user=_user(), sort_order=None, **params
            )
            return [chunk async for chunk in response.body_iterator]

    async def test_export_narrows_to_the_same_set_as_the_list(self, service):
        await self._export(low_stock=True)

        service.get_low_stock_items_for_alerts.assert_awaited_once_with(
            ORG_ID, exclude_item_types=MEDICAL_ITEM_TYPES
        )
        assert service.get_items_page.await_args.kwargs["item_ids"] == ["i-1", "i-2"]

    async def test_export_without_the_flag_is_not_narrowed(self, service):
        await self._export()

        service.get_low_stock_items_for_alerts.assert_not_awaited()
        assert service.get_items_page.await_args.kwargs["item_ids"] is None


def _category_item(item_id, item_type, quantity=1):
    item = MagicMock()
    item.id = item_id
    item.quantity = quantity
    item.reorder_point = 10
    item.category = None if item_type is None else SimpleNamespace(item_type=item_type)
    return item


class TestAlertScanExcludesADomain:
    async def _scan(self, items, **kwargs):
        db = AsyncMock()
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = items
        totals_result = MagicMock()
        totals_result.all.return_value = []
        medical_result = MagicMock()
        medical_result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(
            side_effect=[items_result, totals_result, medical_result]
        )
        with patch(
            "app.services.inventory_service.resolve_org_today",
            AsyncMock(return_value=date.today()),
        ):
            return await InventoryService(db).get_low_stock_items_for_alerts(
                ORG_ID, **kwargs
            )

    async def test_medical_items_are_carved_out_and_the_rest_kept(self):
        gear = _category_item("g", ItemType.UNIFORM)
        medical = _category_item("m", sorted(MEDICAL_ITEM_TYPES)[0])

        rows = await self._scan([gear, medical], exclude_item_types=MEDICAL_ITEM_TYPES)

        assert [item.id for item, _oh, _fl in rows] == ["g"]

    async def test_an_uncategorized_item_is_gear_and_stays(self):
        # category_id NOT IN (...) in SQL would drop a NULL category; the
        # nobody-filed-it item is exactly the one that must stay visible.
        uncategorized = _category_item("u", None)

        rows = await self._scan([uncategorized], exclude_item_types=MEDICAL_ITEM_TYPES)

        assert [item.id for item, _oh, _fl in rows] == ["u"]

    async def test_without_an_exclusion_every_domain_is_scanned(self):
        gear = _category_item("g", ItemType.UNIFORM)
        medical = _category_item("m", sorted(MEDICAL_ITEM_TYPES)[0])

        rows = await self._scan([gear, medical])

        assert {item.id for item, _oh, _fl in rows} == {"g", "m"}
