"""Unit tests for storefront order serialization."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.storefront_service import StorefrontService


@pytest.mark.asyncio
async def test_product_locks_use_canonical_cart_ids():
    db = MagicMock()
    db.execute = AsyncMock()
    service = StorefrontService(db)
    product_id = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"

    await service._lock_products([product_id, product_id.lower()], "tenant-id")

    statement = db.execute.await_args.args[0]
    parameters = statement.compile().params
    assert parameters["id_1"] == [product_id.lower()]
