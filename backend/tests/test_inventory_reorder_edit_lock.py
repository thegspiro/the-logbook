"""
INV-16: the plain reorder-request PATCH serializes against receipts and
refuses to lower the order below what has already arrived.

The owner chose to close this without a contract change: no
``expected_version`` on PATCH. The edit takes the same row lock the
transition and receipt paths take, and ``quantity_requested`` may not drop
below ``quantity_received`` — the state ``receive_reorder``'s outstanding
check never anticipated.
"""

import uuid

import pytest
from sqlalchemy import event

from app.models.inventory import ReorderRequest
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Reorder FD", slug=f"reorder-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_reorder(db, org, requested, received):
    reorder = ReorderRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_name="Nitrile gloves",
        quantity_requested=requested,
        quantity_received=received,
    )
    db.add(reorder)
    await db.flush()
    return reorder


async def _update(db, org, reorder, data):
    return await InventoryService(db).update_reorder_request(
        request_id=reorder.id,
        organization_id=org.id,
        data=data,
        current_user_id=None,
    )


class TestQuantityFloor:
    async def test_lowering_below_received_is_refused(self, db_session):
        org = await _make_org(db_session)
        reorder = await _make_reorder(db_session, org, requested=10, received=6)

        updated, error = await _update(
            db_session, org, reorder, {"quantity_requested": 5}
        )

        assert updated is None
        assert error is not None
        assert "6 already received" in error
        await db_session.refresh(reorder)
        assert reorder.quantity_requested == 10

    async def test_lowering_to_exactly_received_is_allowed(self, db_session):
        org = await _make_org(db_session)
        reorder = await _make_reorder(db_session, org, requested=10, received=6)

        updated, error = await _update(
            db_session, org, reorder, {"quantity_requested": 6}
        )

        assert error is None
        assert updated.quantity_requested == 6

    async def test_other_fields_still_edit_after_a_receipt(self, db_session):
        org = await _make_org(db_session)
        reorder = await _make_reorder(db_session, org, requested=10, received=6)

        updated, error = await _update(
            db_session, org, reorder, {"notes": "Backordered remainder"}
        )

        assert error is None
        assert updated.notes == "Backordered remainder"
        assert updated.quantity_requested == 10

    async def test_floor_reads_the_committed_received_not_a_stale_copy(
        self, db_session
    ):
        """The session already holds the row with received=0; another writer
        then records a receipt. The lock's populate_existing read must see it."""
        org = await _make_org(db_session)
        reorder = await _make_reorder(db_session, org, requested=10, received=0)
        await InventoryService(db_session).get_reorder_request(reorder.id, org.id)
        await db_session.execute(
            ReorderRequest.__table__.update()
            .where(ReorderRequest.__table__.c.id == reorder.id)
            .values(quantity_received=8)
        )

        updated, error = await _update(
            db_session, org, reorder, {"quantity_requested": 4}
        )

        assert updated is None
        assert "8 already received" in error


class TestRowLock:
    async def test_the_edit_locks_the_reorder_row(self, db_session):
        org = await _make_org(db_session)
        reorder = await _make_reorder(db_session, org, requested=10, received=0)
        statements = []

        def capture(_conn, _cursor, statement, *_args):
            statements.append(statement)

        engine = db_session.bind.sync_engine
        event.listen(engine, "before_cursor_execute", capture)
        try:
            _, error = await _update(db_session, org, reorder, {"notes": "x"})
        finally:
            event.remove(engine, "before_cursor_execute", capture)

        assert error is None
        assert any(
            "reorder_requests" in s and "FOR UPDATE" in s for s in statements
        ), statements

    async def test_another_departments_request_is_not_found(self, db_session):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        reorder = await _make_reorder(db_session, other, requested=10, received=0)

        updated, error = await _update(db_session, org, reorder, {"notes": "x"})

        assert updated is None
        assert error == "Reorder request not found"
