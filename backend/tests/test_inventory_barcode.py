"""
Tests for the unified inventory barcode generation
(app/services/inventory_service.py).

There is a single barcode scheme used everywhere — item creation, variant
generation, the label backfill, and the one-time migration 20260604_0200:

    INV-<first 8 uppercase hex of the item's own UUID>

``_barcode_for_item`` derives that value and verifies uniqueness within the
organization, widening to a fresh 12-hex token on the (rare) first-8
collision. The DB session is mocked, so the suite needs no MySQL.
"""

import re
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.inventory_service import InventoryService, _format_barcode

_CANONICAL = re.compile(r"^INV-[0-9A-F]{8}$")
_WIDENED = re.compile(r"^INV-[0-9A-F]{12}$")


class TestFormatBarcode:
    def test_derives_from_first_eight_hex_of_uuid(self):
        token = "12345678-90ab-cdef-1234-567890abcdef"
        assert _format_barcode(token) == "INV-12345678"

    def test_is_uppercase(self):
        assert _format_barcode("abcdef00-0000-0000-0000-000000000000") == "INV-ABCDEF00"

    def test_matches_canonical_format_for_real_uuids(self):
        assert all(_CANONICAL.match(_format_barcode(str(uuid4()))) for _ in range(20))


class TestBarcodeForItem:
    def _service(self, *scalar_results):
        db = MagicMock()
        db.scalar = AsyncMock(side_effect=list(scalar_results))
        return InventoryService(db), db

    async def test_derives_barcode_from_the_items_own_uuid(self):
        item_id = "deadbeef-0000-1111-2222-333344445555"
        service, db = self._service(None)  # not taken
        code = await service._barcode_for_item(item_id, uuid4())
        # The canonical value is reproducible from the id — this is what makes
        # app-created and migration-backfilled barcodes identical.
        assert code == _format_barcode(item_id)
        assert code == "INV-DEADBEEF"
        assert db.scalar.await_count == 1

    async def test_widens_on_first_eight_collision(self):
        # First-8 candidate is taken, the widened token is free.
        service, db = self._service("existing-id", None)
        code = await service._barcode_for_item(str(uuid4()), uuid4())
        assert _WIDENED.match(code)
        assert db.scalar.await_count == 2

    async def test_widens_with_retry_until_free(self):
        # Canonical taken, first widened taken, second widened free.
        service, db = self._service("taken", "taken", None)
        code = await service._barcode_for_item(str(uuid4()), uuid4())
        assert _WIDENED.match(code)
        assert db.scalar.await_count == 3

    async def test_query_is_scoped_to_the_organization(self):
        captured = []

        async def capture(stmt, *a, **k):
            captured.append(str(stmt))
            return None

        db = MagicMock()
        db.scalar = AsyncMock(side_effect=capture)
        service = InventoryService(db)
        await service._barcode_for_item(str(uuid4()), uuid4())
        assert "organization_id" in captured[0]
        assert "barcode" in captured[0]
