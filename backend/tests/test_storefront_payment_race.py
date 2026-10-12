"""
Two payments landing on one order at once must both reach the ledger (SF-9).

``record_payment`` adds to ``amount_paid``. Off a plain SELECT, a payment that
arrives while another holds the order mid-write reads the balance from before
it, and its write lands on top: the order is short one payment and the member
is chased for money already sent. The realistic case is the PayPal webhook's
auto-apply landing while a treasurer records a payment on the same order.
``record_payment`` now reads the order with a lock, so the second payment
waits and adds to the first.

``refund_order`` is the same shape of read-modify-write on ``amount_paid``
and, until this pass, locked nothing: a settlement committing between its
read and its write was silently overwritten the instant refund's own blocked
UPDATE finally landed, computed from a balance that predated the settlement.
It now locks the order too, for the same reason and the same way. (See
SF8-04-1 in the findings doc for why ``waive_order_payment`` is flagged, not
fixed the same way: it does not do arithmetic on ``amount_paid`` at all, and
its real gap — unconditionally overwriting ``payment_status`` even when the
order was already settled by the time of read — is a business-rule question
a lock does not answer.)

The first writer here is raw SQL holding the row lock, so the test does not
depend on the code under test to create the contention.

Real connections, not ``db_session``: the race needs two transactions.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.services.storefront_service import StorefrontService

pytestmark = [pytest.mark.integration]

# How long the first writer holds the order row after taking its lock, so the
# second payment is certain to arrive while it is held.
_HOLD_SECONDS = 0.3


async def _seed(
    amount_paid: str = "0", payment_status: str = "unpaid"
) -> tuple[str, str]:
    org, window, order = (str(uuid.uuid4()) for _ in range(3))
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations (id,name,organization_type,slug,"
                    "timezone,active) VALUES (:i,'Payment Race FD',"
                    "'fire_department',:s,'UTC',1)"
                ),
                {"i": org, "s": f"pay-race-{org[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO store_order_windows (id,organization_id,name,"
                    "status) VALUES (:i,:o,'Window','open')"
                ),
                {"i": window, "o": org},
            )
            await conn.execute(
                text(
                    "INSERT INTO store_orders (id,organization_id,window_id,"
                    "order_number,customer_name,status,payment_status,subtotal,"
                    "tax_amount,shipping_amount,discount_amount,total,amount_paid,"
                    "fulfillment_method,submitted_at) VALUES (:i,:o,:w,'ORD-1','M',"
                    "'submitted',:ps,100,0,0,0,100,:ap,'pickup',NOW())"
                ),
                {
                    "i": order,
                    "o": org,
                    "w": window,
                    "ps": payment_status,
                    "ap": amount_paid,
                },
            )
    return org, order


async def _cleanup(org: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for table in (
                "store_payment_events",
                "store_order_events",
                "store_orders",
                "store_order_windows",
            ):
                await conn.execute(
                    text(f"DELETE FROM {table} WHERE organization_id=:o"), {"o": org}
                )
            await conn.execute(
                text("DELETE FROM organizations WHERE id=:o"), {"o": org}
            )


@pytest.mark.usefixtures("_initialize_database")
async def test_a_payment_racing_another_is_not_lost():
    org, order = await _seed()
    first_locked = asyncio.Event()

    async def first():
        async with database_manager.engine.connect() as conn:
            async with conn.begin():
                await conn.execute(
                    text("SELECT amount_paid FROM store_orders WHERE id=:i FOR UPDATE"),
                    {"i": order},
                )
                first_locked.set()
                await asyncio.sleep(_HOLD_SECONDS)
                await conn.execute(
                    text(
                        "UPDATE store_orders SET amount_paid = amount_paid + 30 "
                        "WHERE id=:i"
                    ),
                    {"i": order},
                )

    async def second():
        await first_locked.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await StorefrontService(session).record_payment(
                    order, org, Decimal("20"), None, notify_member=False
                )
            finally:
                await session.close()

    try:
        await asyncio.gather(first(), second())
        async with database_manager.engine.connect() as conn:
            paid = (
                await conn.execute(
                    text("SELECT amount_paid FROM store_orders WHERE id=:i"),
                    {"i": order},
                )
            ).scalar_one()
    finally:
        await _cleanup(org)

    assert Decimal(paid) == Decimal("50"), (
        f"amount_paid is {paid} after payments of 30 and 20. Anything short of "
        "50 means the second payment read the balance before the first "
        "committed and wrote over it."
    )


async def _matched_event(org: str, order: str) -> str:
    event = str(uuid.uuid4())
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO store_payment_events (id,organization_id,provider,"
                    "external_id,amount,currency,status,matched_order_id) VALUES "
                    "(:i,:o,'paypal',:x,25,'USD','matched',:r)"
                ),
                {"i": event, "o": org, "x": f"CAP-{event[:8]}", "r": order},
            )
    return event


@pytest.mark.usefixtures("_initialize_database")
async def test_one_payment_event_is_applied_once():
    """An administrator applying an event the webhook is applying at the same
    moment must not pay the order twice: the second reads it applied."""
    org, order = await _seed()
    event = await _matched_event(org, order)
    first_locked = asyncio.Event()

    async def first():
        # Stands in for an application in flight: holds the event, settles the
        # payment and marks it applied in one commit, as the service does.
        async with database_manager.engine.connect() as conn:
            async with conn.begin():
                await conn.execute(
                    text(
                        "SELECT status FROM store_payment_events WHERE id=:e FOR UPDATE"
                    ),
                    {"e": event},
                )
                first_locked.set()
                await asyncio.sleep(_HOLD_SECONDS)
                await conn.execute(
                    text(
                        "UPDATE store_orders SET amount_paid = amount_paid + 25 "
                        "WHERE id=:i"
                    ),
                    {"i": order},
                )
                await conn.execute(
                    text(
                        "UPDATE store_payment_events SET status='applied' WHERE id=:e"
                    ),
                    {"e": event},
                )

    async def second():
        await first_locked.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await StorefrontService(session).apply_payment_event(event, org, None)
                await session.commit()
            finally:
                await session.close()

    try:
        await asyncio.gather(first(), second())
        async with database_manager.engine.connect() as conn:
            paid = (
                await conn.execute(
                    text("SELECT amount_paid FROM store_orders WHERE id=:i"),
                    {"i": order},
                )
            ).scalar_one()
    finally:
        await _cleanup(org)

    assert Decimal(paid) == Decimal("25"), (
        f"amount_paid is {paid} after one payment event of 25. 50 means the "
        "event was applied twice."
    )


@pytest.mark.usefixtures("_initialize_database")
async def test_a_refund_racing_a_payment_does_not_lose_it():
    """A refund computed from the balance before a concurrent payment landed
    must not overwrite that payment when its own write finally lands."""
    org, order = await _seed(amount_paid="50", payment_status="partial")
    first_locked = asyncio.Event()

    async def first():
        # Stands in for a payment landing (e.g. the PayPal webhook) while the
        # refund below is in flight.
        async with database_manager.engine.connect() as conn:
            async with conn.begin():
                await conn.execute(
                    text("SELECT amount_paid FROM store_orders WHERE id=:i FOR UPDATE"),
                    {"i": order},
                )
                first_locked.set()
                await asyncio.sleep(_HOLD_SECONDS)
                await conn.execute(
                    text(
                        "UPDATE store_orders SET amount_paid = amount_paid + 30 "
                        "WHERE id=:i"
                    ),
                    {"i": order},
                )

    async def second():
        await first_locked.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await StorefrontService(session).refund_order(
                    order, org, None, amount=Decimal("20"), notify_member=False
                )
            finally:
                await session.close()

    try:
        await asyncio.gather(first(), second())
        async with database_manager.engine.connect() as conn:
            paid = (
                await conn.execute(
                    text("SELECT amount_paid FROM store_orders WHERE id=:i"),
                    {"i": order},
                )
            ).scalar_one()
    finally:
        await _cleanup(org)

    assert Decimal(paid) == Decimal("60"), (
        f"amount_paid is {paid} after a payment of 30 landing on a balance of "
        "50 (-> 80), refunded 20 (-> 60). Anything short of 60 means the "
        "refund read the balance before the payment committed and wrote over "
        "it."
    )
