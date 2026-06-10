"""
Tests for the unified inventory barcode generation
(app/services/inventory_service.py).

Item creation, variant generation, and label backfill all route through one
canonical helper that emits ``INV-XXXXXXXX`` (8 uppercase hex) and verifies
uniqueness within the organization, regenerating on the (astronomically
unlikely) collision. The DB session is mocked, so the suite needs no MySQL.
"""

import re
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.inventory_service import InventoryService, _new_barcode

_CANONICAL = re.compile(r"^INV-[0-9A-F]{8}$")


class TestNewBarcode:
    def test_matches_canonical_format(self):
        assert _CANONICAL.match(_new_barcode())

    def test_is_uppercase_and_unique_per_call(self):
        codes = {_new_barcode() for _ in range(50)}
        # Random source — 50 draws should not collide, and all are uppercase.
        assert len(codes) == 50
        assert all(c == c.upper() for c in codes)


class TestGenerateUniqueBarcode:
    def _service(self, *scalar_results):
        db = MagicMock()
        db.scalar = AsyncMock(side_effect=list(scalar_results))
        return InventoryService(db), db

    async def test_returns_first_candidate_when_free(self):
        service, db = self._service(None)
        code = await service._generate_unique_barcode(uuid4())
        assert _CANONICAL.match(code)
        assert db.scalar.await_count == 1

    async def test_regenerates_on_collision(self):
        # First candidate already exists, second is free.
        service, db = self._service("existing-item-id", None)
        code = await service._generate_unique_barcode(uuid4())
        assert _CANONICAL.match(code)
        assert db.scalar.await_count == 2

    async def test_widens_token_after_exhausting_attempts(self):
        # Every probe reports a collision; after `attempts` tries it falls back
        # to a longer 12-hex token without another query.
        service, db = self._service(*(["taken"] * 5))
        code = await service._generate_unique_barcode(uuid4(), attempts=5)
        assert re.match(r"^INV-[0-9A-F]{12}$", code)
        assert db.scalar.await_count == 5

    async def test_query_is_scoped_to_the_organization(self):
        captured = []

        async def capture(stmt, *a, **k):
            captured.append(str(stmt))
            return None

        db = MagicMock()
        db.scalar = AsyncMock(side_effect=capture)
        service = InventoryService(db)
        await service._generate_unique_barcode(uuid4())
        assert "organization_id" in captured[0]
        assert "barcode" in captured[0]
