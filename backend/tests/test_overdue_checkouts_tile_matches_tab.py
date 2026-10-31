"""The Overdue returns tile counts exactly the loans the Overdue tab lists.

DASH-37. The tile used to add every loan whose stored ``is_overdue`` flag was
set, including one extended since the daily task flagged it, which the tab
(due date in the past) leaves out. Both now use
``InventoryService.overdue_checkout_clause``.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.inventory import (
    CheckOutRecord,
    InventoryItem,
    ItemStatus,
    TrackingType,
)
from app.services.inventory_service import InventoryService
from tests.test_admin_hub_db import _member, _org

pytestmark = [pytest.mark.integration]


async def _loan(db, org, borrower, *, due, flagged=False, returned=False):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Radio {uuid.uuid4().hex[:4]}",
        tracking_type=TrackingType.INDIVIDUAL,
        quantity=1,
        status=ItemStatus.AVAILABLE,
    )
    db.add(item)
    await db.flush()
    loan = CheckOutRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_id=item.id,
        user_id=borrower.id,
        checked_out_at=datetime.now(timezone.utc) - timedelta(days=10),
        expected_return_at=due,
        is_overdue=flagged,
        is_returned=returned,
    )
    db.add(loan)
    await db.flush()
    return loan.id


async def test_tile_count_equals_tab_rows(db_session):
    org = await _org(db_session)
    borrower = await _member(db_session, org)
    now = datetime.now(timezone.utc)
    past_due = await _loan(db_session, org, borrower, due=now - timedelta(days=1))
    no_due_flagged = await _loan(db_session, org, borrower, due=None, flagged=True)
    # Flagged by the daily task, then extended: not overdue any more.
    await _loan(db_session, org, borrower, due=now + timedelta(days=3), flagged=True)
    await _loan(db_session, org, borrower, due=now + timedelta(days=3))
    await _loan(db_session, org, borrower, due=now - timedelta(days=1), returned=True)

    listed = await InventoryService(db_session).get_overdue_checkouts(org.id)
    counted = await db_session.scalar(
        select(func.count(CheckOutRecord.id)).where(
            CheckOutRecord.organization_id == org.id,
            InventoryService.overdue_checkout_clause(now),
        )
    )

    assert sorted(str(r.id) for r in listed) == sorted([past_due, no_due_flagged])
    assert counted == len(listed)
