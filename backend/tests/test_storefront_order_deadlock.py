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
being counted — and it took two rounds of review to get the granularity right:

* Locking only the products leaves disjoint carts colliding in the gap.
  5 rounds -> 2 deadlocks. (Codex P2 on PR #2446.)
* Locking the window row fixes that and still deadlocks *across* windows:
  `store_orders` is indexed on (organization_id, window_id), so two open windows
  with empty ranges share one gap while their parent rows are different and
  therefore uncontended. The store supports several open windows at once —
  that is what `other_open_windows` is for. 4 rounds -> 1 deadlock. (Codex P3.)
* Locking the organisation's `store_settings` row covers every gap the tallies
  can touch, because all of those ranges are org-scoped. 0 deadlocks in both.

Both cases are exercised below, because the same-window one passing is exactly
what made the cross-window one easy to miss.

A deadlock is a race, so this file has to work at being a dependable detector
rather than assuming it is one. Two things do that, and both were measured by
re-running the rejected protocol (flip `_place`'s `lock_org` default to False)
rather than reasoned about: a rendezvous instead of a sleep, so the two
transactions genuinely overlap regardless of connection warmth, and clearing
the orders between rounds, so every round starts from the empty range the gap
lock needs. Whole-file detection went from 2 runs in 3 to 6 in 6.
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
_LOCK_ORG = text("SELECT id FROM store_settings WHERE organization_id = :o FOR UPDATE")

# How long a placement holds its locks waiting for the other one to catch up.
# Paid once per round in the passing direction only (see `_rendezvous`), so it
# buys determinism rather than costing it.
_RENDEZVOUS_TIMEOUT = 0.3


async def _rendezvous(barrier):
    """Hold this transaction's locks until the other has taken its own.

    A fixed `sleep` here made this a *probabilistic* detector: whether the two
    transactions really overlapped depended on connection and buffer-pool
    warmth, so re-running the rejected protocol caught it 4/4 in isolation but
    only ~2/3 of the time in a whole-file run — and a whole file is how CI runs
    it. A regression that reappears deserves catching every time.

    Timing out is the *expected* path once the org lock is in place: the second
    transaction is still blocked acquiring that lock and cannot arrive, so the
    first waits out the timeout, commits, and releases it. Without the org lock
    both arrive at once and both hold the same gap.
    """
    try:
        await asyncio.wait_for(barrier.wait(), timeout=_RENDEZVOUS_TIMEOUT)
    except (asyncio.TimeoutError, asyncio.BrokenBarrierError):
        # Broken rather than timed out means the other party was already cut
        # loose by its own timeout. Same conclusion: stop waiting, proceed.
        pass


async def _place(engine, org, window, product, number, barrier, *, lock_org=True):
    """One order placement, mirroring `_price_lines` -> insert in raw SQL.

    Raw SQL rather than the service so the test pins the *lock protocol* — the
    thing that deadlocks — without dragging in settings, pricing and
    notification machinery that have nothing to do with it.
    """
    async with engine.connect() as conn:
        tx = await conn.begin()
        try:
            # The service's order: organisation, then window, then the tally.
            # `lock_org=False` reproduces the rejected window-only protocol.
            if lock_org:
                await conn.execute(_LOCK_ORG, {"o": org})
            await conn.execute(_LOCK_WINDOW, {"w": window})
            await conn.execute(_TALLY, {"w": window, "o": org})
            await _rendezvous(barrier)
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


async def _seed(engine, org, windows, products):
    """Org + its store_settings row + the given windows and products."""
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
            # The row the per-org lock takes. `create_order` calls
            # `get_settings()` before `_price_lines`, so in production it always
            # exists by the time the lock is attempted.
            await conn.execute(
                text(
                    "INSERT INTO store_settings (id,organization_id,is_enabled,"
                    "store_name,currency,tax_rate) VALUES "
                    "(:i,:o,1,'Store','USD',0)"
                ),
                {"i": str(uuid.uuid4()), "o": org},
            )
            for index, window in enumerate(windows):
                await conn.execute(
                    text(
                        "INSERT INTO store_order_windows (id,organization_id,"
                        "name,status) VALUES (:i,:o,:n,'open')"
                    ),
                    {"i": window, "o": org, "n": f"Window {index}"},
                )
            for index, product in enumerate(products):
                await conn.execute(
                    text(
                        "INSERT INTO store_products (id,organization_id,"
                        "name,price,status) VALUES (:i,:o,:n,10,'active')"
                    ),
                    {"i": product, "o": org, "n": f"Item {index}"},
                )


async def _cleanup(engine, org):
    async with engine.connect() as conn:
        async with conn.begin():
            for table in (
                "store_order_items",
                "store_orders",
                "store_products",
                "store_order_windows",
                "store_settings",
            ):
                await conn.execute(
                    text(f"DELETE FROM {table} WHERE organization_id=:o"),
                    {"o": org},
                )
            await conn.execute(
                text("DELETE FROM organizations WHERE id=:o"), {"o": org}
            )


async def _clear_orders(engine, org):
    """Drop the rows a round placed, so the next one starts from an empty range.

    This is what makes each round an independent trial rather than a weaker
    repeat of the first. The gap lock only spans an *empty* range, which is
    precisely the state a freshly opened window is in — once a round's orders
    are sitting in the (organization_id, window_id) index, the two windows'
    entries can be separated by real rows and the shared gap the defect needs
    may simply not exist. Leaving them in place is why running more rounds did
    not raise the detection rate the way it should have.
    """
    async with engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("DELETE FROM store_order_items WHERE organization_id=:o"),
                {"o": org},
            )
            await conn.execute(
                text("DELETE FROM store_orders WHERE organization_id=:o"), {"o": org}
            )


async def _rounds(engine, org, pairs, count):
    """`count` rounds of two concurrent placements, flattened outcomes."""
    outcomes = []
    for index in range(count):
        (win_a, prod_a), (win_b, prod_b) = pairs
        # A fresh barrier per round: a timed-out wait leaves the barrier broken,
        # and reusing it would release the next round's pair immediately.
        barrier = asyncio.Barrier(2)
        outcomes.extend(
            await asyncio.gather(
                _place(
                    engine, org, win_a, prod_a, f"ORD-2026-{index * 2 + 1:04d}", barrier
                ),
                _place(
                    engine, org, win_b, prod_b, f"ORD-2026-{index * 2 + 2:04d}", barrier
                ),
            )
        )
        await _clear_orders(engine, org)
    return outcomes


class TestConcurrentDisjointCarts:
    async def test_different_products_in_one_window_do_not_deadlock(self, db_session):
        """Codex P2: the case the window lock was introduced for."""
        org, window = str(uuid.uuid4()), str(uuid.uuid4())
        products = [str(uuid.uuid4()), str(uuid.uuid4())]
        engine = database_manager.engine
        await _seed(engine, org, [window], products)
        try:
            outcomes = await _rounds(
                engine, org, [(window, products[0]), (window, products[1])], 3
            )
            assert outcomes.count("deadlock") == 0, (
                "two members ordering different products in one window "
                f"deadlocked; see this module's docstring.\noutcomes={outcomes}"
            )
            assert all(o == "ok" for o in outcomes), f"outcomes={outcomes}"
        finally:
            await _cleanup(engine, org)

    async def test_two_open_windows_do_not_deadlock(self, db_session):
        """Codex P3: the case the window lock did NOT cover.

        `store_orders` is indexed on (organization_id, window_id), so two open
        windows with empty ranges share a gap while their parent rows are
        different and therefore uncontended. Only a lock above both — the
        organisation — serializes this.
        """
        org = str(uuid.uuid4())
        windows = [str(uuid.uuid4()), str(uuid.uuid4())]
        products = [str(uuid.uuid4()), str(uuid.uuid4())]
        engine = database_manager.engine
        await _seed(engine, org, windows, products)
        try:
            outcomes = await _rounds(
                engine, org, [(windows[0], products[0]), (windows[1], products[1])], 4
            )
            assert outcomes.count("deadlock") == 0, (
                "concurrent orders into two different open windows deadlocked: "
                "the per-window lock does not serialize them, because the gap "
                "they contend for is org-scoped while their parent rows are "
                f"not.\noutcomes={outcomes}"
            )
            assert all(o == "ok" for o in outcomes), f"outcomes={outcomes}"
        finally:
            await _cleanup(engine, org)

    async def test_the_service_locks_the_org_before_the_window_and_tallies(self):
        """A source guard, so the DB-backed tests cannot be defeated by quietly
        dropping or reordering the locks they depend on."""
        import inspect

        from app.services.storefront_service import StorefrontService

        source = inspect.getsource(StorefrontService._price_lines)
        org_at = source.index("StoreSettings.organization_id == str(organization_id)")
        window_at = source.index("StoreOrderWindow.id == window.id")
        tally_at = source.index("_ordered_quantities")
        assert org_at < window_at < tally_at, (
            "lock order must be organisation -> window -> tallies. The org lock "
            "after the tallies cannot stop two transactions holding the same "
            "org-scoped gap concurrently, which is the cross-window case."
        )
