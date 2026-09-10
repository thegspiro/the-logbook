"""Two members ordering different products must not deadlock each other.

Making the availability tallies locking reads (pitfall #27) is necessary — a
plain read answers from a stale snapshot and both claimants are sold the last
unit — but on its own it is *harmful*. Those tallies are range reads over an
order window, and a window is empty exactly when it opens, so InnoDB takes
next-key/gap locks over that empty range.

Gap locks do not conflict with each other. So two members ordering **different**
products both pass `_lock_products` (their product rows are disjoint) and both
acquire the same gap; each one's INSERT then needs an insertion-intention lock
that the other's gap lock blocks, and InnoDB breaks the cycle by killing one
order with a 1213. Different products is the common case when a window opens, so
the tally lock on its own traded a rare same-product oversell for a frequent
different-product failure.

The fix is the other half of pitfall #27 — lock the *parent* row, not the rows
being counted. `_price_lines` takes an exclusive lock on the window before the
tallies, so the decision serializes and the gaps are never held concurrently.

Codex raised this as a P2 on PR #2446 against the commit that added the tally
locks. Measured before the fix: 2 deadlocks in 5 rounds. After: 0.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from app.core.database import database_manager

pytestmark = [pytest.mark.integration]

_TALLY = text("""
    SELECT i.product_id, i.variant_id, SUM(i.quantity)
    FROM store_order_items i
    JOIN store_orders o ON o.id = i.order_id
    WHERE o.window_id = :w AND o.organization_id = :o AND o.status <> 'cancelled'
    GROUP BY i.product_id, i.variant_id
    FOR UPDATE
    """)

_LOCK_WINDOW = text("SELECT id FROM store_order_windows WHERE id = :w FOR UPDATE")


async def _place(engine, org, window, product, number, *, lock_window):
    """One order placement, mirroring `_price_lines` -> insert in raw SQL.

    Raw SQL rather than the service so the test pins the *lock protocol* — the
    thing that deadlocks — without dragging in settings, pricing and
    notification machinery that have nothing to do with it.
    """
    async with engine.connect() as conn:
        tx = await conn.begin()
        try:
            if lock_window:
                await conn.execute(_LOCK_WINDOW, {"w": window})
            await conn.execute(_TALLY, {"w": window, "o": org})
            # Widen the overlap the way real request handling does: both
            # transactions hold their locks while the other is still working.
            await asyncio.sleep(0.15)
            order_id = str(uuid.uuid4())
            await conn.execute(
                text(
                    "INSERT INTO store_orders (id,organization_id,window_id,"
                    "order_number,customer_name,status,payment_status,subtotal,"
                    "tax_amount,shipping_amount,discount_amount,total,amount_paid,"
                    "fulfillment_method,submitted_at) VALUES (:i,:o,:w,:n,'M',"
                    "'submitted','unpaid',10,0,0,0,10,0,'pickup',NOW())"
                ),
                {"i": order_id, "o": org, "w": window, "n": number},
            )
            await conn.execute(
                text(
                    "INSERT INTO store_order_items (id,organization_id,order_id,"
                    "product_id,product_name,unit_price,quantity,line_total,"
                    "fulfilled_quantity) VALUES (:i,:o,:r,:p,'X',10,1,10,0)"
                ),
                {"i": str(uuid.uuid4()), "o": org, "r": order_id, "p": product},
            )
            await tx.commit()
            return "ok"
        except Exception as exc:  # noqa: BLE001 - the point is which error
            await tx.rollback()
            return "deadlock" if "1213" in str(exc) else f"other:{exc}"


class TestConcurrentDisjointCarts:
    async def test_two_members_ordering_different_products_both_succeed(
        self, db_session
    ):
        org = str(uuid.uuid4())
        window = str(uuid.uuid4())
        products = [str(uuid.uuid4()), str(uuid.uuid4())]
        engine = database_manager.engine

        async with engine.connect() as conn:
            async with conn.begin():
                await conn.execute(
                    text(
                        "INSERT INTO organizations (id,name,organization_type,"
                        "slug,timezone,active) VALUES (:i,'Deadlock FD',"
                        "'fire_department',:s,'UTC',1)"
                    ),
                    {"i": org, "s": f"deadlock-{org[:8]}"},
                )
                await conn.execute(
                    text(
                        "INSERT INTO store_order_windows (id,organization_id,"
                        "name,status) VALUES (:i,:o,'Spring order','open')"
                    ),
                    {"i": window, "o": org},
                )
                for index, product in enumerate(products):
                    await conn.execute(
                        text(
                            "INSERT INTO store_products (id,organization_id,"
                            "name,price,status) VALUES (:i,:o,:n,10,'active')"
                        ),
                        {"i": product, "o": org, "n": f"Item {index}"},
                    )

        try:
            outcomes = []
            for round_index in range(3):
                outcomes.extend(
                    await asyncio.gather(
                        _place(
                            engine,
                            org,
                            window,
                            products[0],
                            f"ORD-2026-{round_index * 2 + 1:04d}",
                            lock_window=True,
                        ),
                        _place(
                            engine,
                            org,
                            window,
                            products[1],
                            f"ORD-2026-{round_index * 2 + 2:04d}",
                            lock_window=True,
                        ),
                    )
                )

            assert outcomes.count("deadlock") == 0, (
                "concurrent orders for different products deadlocked: the "
                "window row is not serializing the decision, so both "
                "transactions hold gap locks over the empty order range and "
                "block each other's insert. See this module's docstring.\n"
                f"outcomes={outcomes}"
            )
            assert all(o == "ok" for o in outcomes), f"outcomes={outcomes}"
        finally:
            async with engine.connect() as conn:
                async with conn.begin():
                    for table in (
                        "store_order_items",
                        "store_orders",
                        "store_products",
                        "store_order_windows",
                    ):
                        await conn.execute(
                            text(f"DELETE FROM {table} WHERE organization_id=:o"),
                            {"o": org},
                        )
                    await conn.execute(
                        text("DELETE FROM organizations WHERE id=:o"), {"o": org}
                    )

    async def test_the_service_takes_the_window_lock(self):
        """A source guard, so the DB-backed test above cannot be defeated by
        quietly dropping the lock it depends on."""
        import inspect

        from app.services.storefront_service import StorefrontService

        source = inspect.getsource(StorefrontService._price_lines)
        assert "StoreOrderWindow.id == window.id" in source
        assert "with_for_update()" in source
        lock_at = source.index("StoreOrderWindow.id == window.id")
        tally_at = source.index("_ordered_quantities")
        assert lock_at < tally_at, (
            "the window lock must be taken BEFORE the tallies — after them it "
            "cannot stop the two transactions holding the gap concurrently"
        )
