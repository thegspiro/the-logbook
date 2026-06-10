"""
Regression guard: equipment-request fulfillment must row-lock the request.

fulfill_equipment_request checks status == APPROVED, creates an
issuance/checkout/assignment, and only then marks the request FULFILLED.
Without SELECT ... FOR UPDATE on the request row, two concurrent fulfill
calls can both pass the status check and each create a fulfillment record
(double-issue). This test captures the statement the service executes and
asserts it compiles with FOR UPDATE, without needing a real database.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from sqlalchemy.dialects import mysql

from app.services.inventory_service import InventoryService


async def test_fulfillment_request_select_is_row_locked():
    captured = []

    async def capture_execute(statement, *args, **kwargs):
        captured.append(statement)
        result = MagicMock()
        # Return no request — the service exits right after this first query,
        # which is the only statement under test.
        result.scalar_one_or_none.return_value = None
        return result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=capture_execute)
    service = InventoryService(db)

    req, error = await service.fulfill_equipment_request(
        request_id=uuid4(),
        organization_id=uuid4(),
        fulfilled_by=uuid4(),
    )

    assert req is None
    assert error == "Request not found"
    assert len(captured) == 1

    sql = str(captured[0].compile(dialect=mysql.dialect()))
    assert "FOR UPDATE" in sql.upper()
