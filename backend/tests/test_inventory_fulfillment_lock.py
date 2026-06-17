"""
Regression guard: equipment-request fulfillment must claim the request
atomically, not merely row-lock the read.

fulfill_equipment_request checks status == APPROVED, creates an
issuance/checkout/assignment, and marks the request FULFILLED. The
issue/checkout/assign calls commit internally, which releases the SELECT ...
FOR UPDATE lock *before* the status is flipped — so the lock alone leaves a
window for two concurrent fulfills to both pass the APPROVED check and
double-issue. The real guard is a single-statement APPROVED -> FULFILLED
UPDATE; if it affects zero rows, another caller won the race and this one
must abort. These tests capture both the locked read and the atomic claim,
without needing a real database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from sqlalchemy.dialects import mysql

from app.models.inventory import RequestStatus
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


async def test_fulfillment_aborts_when_claim_lost_to_concurrent_call():
    # The initial locked SELECT sees the request as APPROVED...
    req = SimpleNamespace(
        status=RequestStatus.APPROVED,
        item_id=str(uuid4()),
        quantity=1,
        requester_id=str(uuid4()),
        request_type="assignment",
    )
    select_result = MagicMock()
    select_result.scalar_one_or_none.return_value = req

    # ...but the atomic APPROVED -> FULFILLED claim matches zero rows because a
    # concurrent fulfill already claimed it.
    claim_result = MagicMock()
    claim_result.rowcount = 0

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[select_result, claim_result])
    db.commit = AsyncMock()
    service = InventoryService(db)

    out, error = await service.fulfill_equipment_request(
        request_id=uuid4(),
        organization_id=uuid4(),
        fulfilled_by=uuid4(),
    )

    # Must abort before any issuance rather than double-issue.
    assert out is None
    assert error == "Only approved requests can be fulfilled"
    assert db.execute.await_count == 2  # locked select + the failed claim only
