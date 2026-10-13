"""
INV-8: a scanned storage-area label resolves to its storage area.

Every storage area is assigned an ``SA-…`` barcode "so it can be scanned", but
``/inventory/lookup`` searched items only, so a shelf label returned nothing.
The lookup now also returns ``storage_areas`` — exact, case-insensitive,
active, in-org matches on the area barcode — alongside the item results.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.inventory import lookup_item_by_code
from app.models.inventory import InventoryItem, StorageArea, StorageLocationType
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Scan FD", slug=f"scan-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_area(db, org, name, barcode, is_active=True):
    area = StorageArea(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        storage_type=StorageLocationType.SHELF,
        barcode=barcode,
        is_active=is_active,
    )
    db.add(area)
    await db.flush()
    return area


class TestFindStorageAreasByCode:
    async def test_an_exact_label_resolves_to_its_area(self, db_session):
        org = await _make_org(db_session)
        shelf = await _make_area(db_session, org, "Glove shelf", "SA-0007")

        found = await InventoryService(db_session).find_storage_areas_by_code(
            "SA-0007", org.id
        )

        assert [a.id for a in found] == [shelf.id]

    async def test_matching_ignores_case_and_surrounding_space(self, db_session):
        org = await _make_org(db_session)
        shelf = await _make_area(db_session, org, "Glove shelf", "SA-0007")

        found = await InventoryService(db_session).find_storage_areas_by_code(
            "  sa-0007 ", org.id
        )

        assert [a.id for a in found] == [shelf.id]

    async def test_a_partial_code_matches_no_area(self, db_session):
        org = await _make_org(db_session)
        await _make_area(db_session, org, "Glove shelf", "SA-0007")

        found = await InventoryService(db_session).find_storage_areas_by_code(
            "SA-00", org.id
        )

        assert found == []

    async def test_inactive_and_other_department_areas_are_not_returned(
        self, db_session
    ):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        await _make_area(db_session, org, "Retired shelf", "SA-0009", False)
        await _make_area(db_session, other, "Their shelf", "SA-0010")
        service = InventoryService(db_session)

        assert await service.find_storage_areas_by_code("SA-0009", org.id) == []
        assert await service.find_storage_areas_by_code("SA-0010", org.id) == []


class TestLookupEndpoint:
    async def test_a_shelf_label_comes_back_as_a_storage_area(self, db_session):
        org = await _make_org(db_session)
        shelf = await _make_area(db_session, org, "Glove shelf", "SA-0007")
        user = SimpleNamespace(organization_id=org.id)

        response = await lookup_item_by_code(
            code="SA-0007", limit=20, db=db_session, current_user=user
        )

        assert response.results == []
        assert response.total == 0
        assert len(response.storage_areas) == 1
        hit = response.storage_areas[0]
        assert str(hit.id) == shelf.id
        assert hit.name == "Glove shelf"
        assert hit.barcode == "SA-0007"
        assert hit.storage_type == "shelf"

    async def test_an_item_scan_carries_no_storage_areas(self, db_session):
        org = await _make_org(db_session)
        await _make_area(db_session, org, "Glove shelf", "SA-0007")
        db_session.add(
            InventoryItem(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Radio",
                barcode="RAD-1",
                active=True,
            )
        )
        await db_session.flush()
        user = SimpleNamespace(organization_id=org.id)

        response = await lookup_item_by_code(
            code="RAD-1", limit=20, db=db_session, current_user=user
        )

        assert [r.item.name for r in response.results] == ["Radio"]
        assert response.storage_areas == []
