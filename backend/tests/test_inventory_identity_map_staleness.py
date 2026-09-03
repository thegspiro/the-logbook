"""Regression test for the identity-map staleness Codex found in PR #2190
(INV-21): batch_return names a candidate ItemIssuance/CheckOutRecord row with
an unlocked SELECT, in the same session it then hands to return_to_pool /
checkin_item, before either method locks the item and locks-and-re-reads the
holding record itself.

This is not the lock-ordering race INV-20 fixed (test_inventory_return_locking
covers that with source inspection). It is a distinct failure mode that a
correctly-ordered lock does not close: SQLAlchemy's identity map, by default,
does not overwrite an already-loaded ORM object's attributes when a later
SELECT for the same primary key runs in the same session/transaction -- even
one issued with .with_for_update(). The locking SELECT does see the latest
row at the SQL level (InnoDB locking reads bypass the REPEATABLE READ
snapshot; see CLAUDE.md pitfall #27), but the Python object handed back is the
stale one from the first, unlocked read, unless the query passes
``populate_existing=True``.

This can only be demonstrated against a real database with two independent
connections/transactions -- a mock has no identity map, and the shared-
connection savepoint session used by the ``db_session`` fixture elsewhere in
this suite cannot show a genuine cross-transaction commit becoming visible to
a lock acquired afterward. So these tests open two real sessions via
``database_manager.session_factory()`` directly and clean up their own rows,
matching the precedent in test_action_item_reminders.py's use of a real
session over a mocked one for exactly this class of session-semantics bug.

Confirmed failing (both, on the unfixed code) via ``git stash`` before the
fix that adds ``populate_existing=True`` to the locked re-reads in
``_get_item_locked``, ``return_to_pool`` and ``checkin_item``, and passing
after.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text

from app.core.database import database_manager
from app.models.inventory import (
    CheckOutRecord,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    TrackingType,
)
from app.services.inventory_service import InventoryService

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def _insert_org_and_user(session, org_id: str, user_id: str) -> None:
    await session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Identity Map Staleness Test Org",
            "otype": "fire_department",
            "slug": f"imst-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "fn": "Test",
            "ln": "Member",
            "em": f"member-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )


async def _cleanup(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        # inventory_notification_queue.performed_by/user_id FK the users this
        # test creates -- _queue_inventory_notification (best-effort, wrapped
        # in try/except in the service) queues a row on every successful
        # return/check-in, so it has to go before the users do.
        await session.execute(
            text(
                "DELETE FROM inventory_notification_queue WHERE organization_id = :org"
            ),
            {"org": org_id},
        )
        await session.execute(
            text("DELETE FROM item_issuances WHERE organization_id = :org"),
            {"org": org_id},
        )
        await session.execute(
            text("DELETE FROM checkout_records WHERE organization_id = :org"),
            {"org": org_id},
        )
        await session.execute(
            text("DELETE FROM inventory_items WHERE organization_id = :org"),
            {"org": org_id},
        )
        await session.execute(
            text("DELETE FROM users WHERE organization_id = :org"), {"org": org_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": org_id}
        )
        await session.commit()


@pytest.mark.usefixtures("_initialize_database")
async def test_return_to_pool_sees_a_concurrent_return_not_its_own_stale_cache():
    """Simulates batch_return: session A names an ItemIssuance with an
    unlocked SELECT (batch_return's own candidate-selection query), exactly
    like it does before delegating to return_to_pool. Before A calls
    return_to_pool, a *different* session/transaction (B) independently
    returns and commits that same issuance -- a direct pool return, or
    another batch racing this one. A's own subsequent return_to_pool call,
    for the identical issuance, must see B's committed is_returned=True and
    refuse the double return -- not silently succeed a second time on the
    is_returned=False it cached before B ever ran.
    """
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    issuance_id = str(uuid.uuid4())

    async with database_manager.session_factory() as setup:
        await _insert_org_and_user(setup, org_id, user_id)
        await setup.execute(
            text(
                "INSERT INTO inventory_items "
                "(id, organization_id, name, tracking_type, quantity, "
                "quantity_issued, `condition`, status) "
                "VALUES (:id, :org, :name, :tt, :qty, :qi, :cond, :status)"
            ),
            {
                "id": item_id,
                "org": org_id,
                "name": "Pool Widget",
                "tt": TrackingType.POOL.value,
                "qty": 5,
                "qi": 1,
                "cond": ItemCondition.GOOD.value,
                "status": ItemStatus.AVAILABLE.value,
            },
        )
        await setup.execute(
            text(
                "INSERT INTO item_issuances "
                "(id, organization_id, item_id, user_id, quantity_issued, "
                "issued_at, is_returned) "
                "VALUES (:id, :org, :item, :user, 1, :now, 0)"
            ),
            {
                "id": issuance_id,
                "org": org_id,
                "item": item_id,
                "user": user_id,
                "now": datetime.now(timezone.utc),
            },
        )
        await setup.commit()

    session_a = database_manager.session_factory()
    session_b = database_manager.session_factory()
    try:
        # Session A: batch_return's own unlocked candidate-selection read of
        # the full ItemIssuance row -- this is what puts the pre-race object
        # in A's identity map.
        peek = await session_a.execute(
            select(ItemIssuance).where(ItemIssuance.id == issuance_id)
        )
        cached_issuance = peek.scalar_one()
        assert cached_issuance.is_returned is False

        # Session B: a fully independent, already-committed return of the
        # SAME issuance -- the race return_to_pool's locked re-read exists
        # to catch.
        service_b = InventoryService(session_b)
        ok_b, err_b = await service_b.return_to_pool(
            issuance_id=uuid.UUID(issuance_id),
            organization_id=uuid.UUID(org_id),
            returned_by=uuid.UUID(user_id),
        )
        assert ok_b is True, err_b

        # Session A: now call return_to_pool for the identical issuance, in
        # the SAME session that already cached the pre-race object. This is
        # the assertion that matters: it must observe B's committed change,
        # not the stale copy identity-mapped above.
        service_a = InventoryService(session_a)
        ok_a, err_a = await service_a.return_to_pool(
            issuance_id=uuid.UUID(issuance_id),
            organization_id=uuid.UUID(org_id),
            returned_by=uuid.UUID(user_id),
        )
        assert ok_a is False, (
            "return_to_pool succeeded a second time on the same issuance -- "
            "it read its own session's stale, pre-race cached copy instead "
            "of B's committed is_returned=True (identity-map staleness, "
            "INV-21)"
        )
        assert "already been returned" in (err_a or "")
    finally:
        await session_a.rollback()
        await session_b.rollback()
        await session_a.close()
        await session_b.close()
        await _cleanup(org_id)


@pytest.mark.usefixtures("_initialize_database")
async def test_checkin_item_sees_a_concurrent_checkin_not_its_own_stale_cache():
    """Same scenario as above, for checkin_item / CheckOutRecord. Session A
    names a checkout with an unlocked full-row SELECT (mirroring
    batch_return's own candidate lookup); session B independently checks it
    in and commits; A's own checkin_item call for the same checkout must see
    B's committed is_returned=True rather than re-recording a check-in over
    it from a stale cached copy.
    """
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    checkout_id = str(uuid.uuid4())

    async with database_manager.session_factory() as setup:
        await _insert_org_and_user(setup, org_id, user_id)
        await setup.execute(
            text(
                "INSERT INTO inventory_items "
                "(id, organization_id, name, tracking_type, `condition`, status) "
                "VALUES (:id, :org, :name, :tt, :cond, :status)"
            ),
            {
                "id": item_id,
                "org": org_id,
                "name": "Checkout Widget",
                "tt": TrackingType.INDIVIDUAL.value,
                "cond": ItemCondition.GOOD.value,
                "status": ItemStatus.CHECKED_OUT.value,
            },
        )
        await setup.execute(
            text(
                "INSERT INTO checkout_records "
                "(id, organization_id, item_id, user_id, checked_out_at, "
                "is_returned) "
                "VALUES (:id, :org, :item, :user, :now, 0)"
            ),
            {
                "id": checkout_id,
                "org": org_id,
                "item": item_id,
                "user": user_id,
                "now": datetime.now(timezone.utc),
            },
        )
        await setup.commit()

    session_a = database_manager.session_factory()
    session_b = database_manager.session_factory()
    try:
        peek = await session_a.execute(
            select(CheckOutRecord).where(CheckOutRecord.id == checkout_id)
        )
        cached_checkout = peek.scalar_one()
        assert cached_checkout.is_returned is False

        service_b = InventoryService(session_b)
        ok_b, err_b = await service_b.checkin_item(
            checkout_id=uuid.UUID(checkout_id),
            organization_id=uuid.UUID(org_id),
            checked_in_by=uuid.UUID(user_id),
            return_condition=ItemCondition.GOOD,
        )
        assert ok_b is True, err_b

        service_a = InventoryService(session_a)
        ok_a, err_a = await service_a.checkin_item(
            checkout_id=uuid.UUID(checkout_id),
            organization_id=uuid.UUID(org_id),
            checked_in_by=uuid.UUID(user_id),
            return_condition=ItemCondition.DAMAGED,
        )
        assert ok_a is False, (
            "checkin_item succeeded a second time on the same checkout -- it "
            "read its own session's stale, pre-race cached copy instead of "
            "B's committed is_returned=True (identity-map staleness, INV-21)"
        )
        assert "already checked in" in (err_a or "").lower()
    finally:
        await session_a.rollback()
        await session_b.rollback()
        await session_a.close()
        await session_b.close()
        await _cleanup(org_id)
