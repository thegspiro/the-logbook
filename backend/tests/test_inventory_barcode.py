"""
Tests for inventory barcode generation (app/services/inventory_service.py).

Barcodes use one scheme everywhere: a per-organization sequential number,
``<prefix><zero-padded number>`` (default ``INV-000001``). The prefix and
counter live in ``organization.settings["barcode"]``; ``_next_sequential_barcode``
locks the org row, formats the next number, skips any already-taken value, and
advances the counter. The DB session is mocked, so the suite needs no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.inventory_service import InventoryService, _format_sequential_barcode


class TestFormatSequentialBarcode:
    def test_zero_pads_to_six_digits(self):
        assert _format_sequential_barcode("INV-", 1) == "INV-000001"
        assert _format_sequential_barcode("INV-", 42) == "INV-000042"

    def test_grows_past_six_digits(self):
        assert _format_sequential_barcode("INV-", 1234567) == "INV-1234567"

    def test_honours_a_custom_prefix(self):
        assert _format_sequential_barcode("FCFD-", 7) == "FCFD-000007"


class TestNextSequentialBarcode:
    def _service(self, org, *exists_results):
        """Build a service whose first scalar() returns the org (FOR UPDATE)
        and whose subsequent scalar() calls answer the existence checks."""
        db = MagicMock()
        db.scalar = AsyncMock(side_effect=[org, *exists_results])
        db.flush = AsyncMock()
        return InventoryService(db), db

    async def test_first_barcode_for_a_fresh_org(self):
        org = SimpleNamespace(settings={})
        service, db = self._service(org, None)  # number 1 is free
        code = await service._next_sequential_barcode(uuid4())
        assert code == "INV-000001"
        # Counter advanced and persisted on the org settings.
        assert org.settings["barcode"]["next_number"] == 2
        assert org.settings["barcode"]["prefix"] == "INV-"
        db.flush.assert_awaited()

    async def test_continues_from_stored_counter(self):
        org = SimpleNamespace(
            settings={"barcode": {"prefix": "INV-", "next_number": 50}}
        )
        service, _ = self._service(org, None)
        code = await service._next_sequential_barcode(uuid4())
        assert code == "INV-000050"
        assert org.settings["barcode"]["next_number"] == 51

    async def test_skips_a_number_already_in_use(self):
        org = SimpleNamespace(settings={"barcode": {"next_number": 5}})
        # 5 is taken, 6 is free.
        service, db = self._service(org, "taken-item-id", None)
        code = await service._next_sequential_barcode(uuid4())
        assert code == "INV-000006"
        assert org.settings["barcode"]["next_number"] == 7

    async def test_honours_a_configured_custom_prefix(self):
        org = SimpleNamespace(
            settings={"barcode": {"prefix": "FCFD-", "next_number": 1}}
        )
        service, _ = self._service(org, None)
        code = await service._next_sequential_barcode(uuid4())
        assert code == "FCFD-000001"

    async def test_locks_the_org_row_for_update(self):
        captured = []
        org = SimpleNamespace(settings={})

        async def scalar(stmt, *a, **k):
            captured.append(str(stmt))
            return org if len(captured) == 1 else None

        db = MagicMock()
        db.scalar = AsyncMock(side_effect=scalar)
        db.flush = AsyncMock()
        service = InventoryService(db)
        await service._next_sequential_barcode(uuid4())
        assert "FOR UPDATE" in captured[0].upper()

    async def test_raises_when_org_missing(self):
        service, _ = self._service(None)
        try:
            await service._next_sequential_barcode(uuid4())
            raised = False
        except ValueError:
            raised = True
        assert raised
