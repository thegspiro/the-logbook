"""The department store's administration metrics and attention queue.

The store admin page moved inside Inventory Administration and now renders the
shared admin frame, which means the store needs a `MODULE_REGISTRY` entry like
every other admin page. `test_admin_hub_db.py` parametrizes over that registry
and proves each resolver *runs*; this file is about what the numbers mean.

Two distinctions the store's model draws, and these tests hold it to:

  * money and fulfillment are tracked apart — `payment_status` moves
    independently of `status`, because an order can be paid and undelivered or
    delivered and unpaid;
  * a cancelled order owes nothing and blocks nobody, so it belongs in neither
    the balance nor the queue.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models.storefront import (
    StoreOrder,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentEvent,
    StorePaymentEventStatus,
    StorePaymentStatus,
    StoreProduct,
    StoreProductStatus,
    StoreWindowStatus,
)
from app.models.user import Organization, Position, User, UserStatus
from app.services.admin_hub_service import MODULE_REGISTRY, AdminHubService

pytestmark = pytest.mark.integration

NOW = datetime.now(timezone.utc)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Store Test Department",
        slug=f"store-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={"modules": {"storefront": True, "_user_configured": True}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _admin(db_session, org) -> User:
    """A store administrator, with the grant carried by a position.

    `user.positions` is assigned explicitly even though nothing here reads the
    grant: on a freshly flushed User the collection is unloaded, so any
    permission check becomes deferred IO and raises MissingGreenlet under
    asyncio rather than answering "no permissions". `test_admin_hub_db.py`'s
    member fixture does the same, for the same reason.
    """
    handle = uuid.uuid4().hex[:10]
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Store Manager {handle}",
        slug=f"store-manager-{handle}",
        permissions=["storefront.manage"],
    )
    db_session.add(position)
    await db_session.flush()

    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"store-admin-{handle}",
        email=f"{handle}@store.test",
        first_name="Sam",
        last_name="Reed",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    user.positions = [position]
    db_session.add(user)
    await db_session.flush()
    return user


async def _order(
    db_session,
    org,
    user,
    *,
    status: StoreOrderStatus = StoreOrderStatus.SUBMITTED,
    payment_status: StorePaymentStatus = StorePaymentStatus.UNPAID,
    total: str = "100.00",
    amount_paid: str = "0.00",
    reported_at: datetime | None = None,
) -> StoreOrder:
    order = StoreOrder(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        order_number=f"SO-{uuid.uuid4().hex[:8]}",
        customer_name=f"{user.first_name} {user.last_name}",
        status=status,
        payment_status=payment_status,
        total=Decimal(total),
        amount_paid=Decimal(amount_paid),
        payment_reported_at=reported_at,
    )
    db_session.add(order)
    await db_session.flush()
    return order


async def _metric(db_session, user, key: str) -> tuple[str, str]:
    ctx = await AdminHubService(db_session)._context(user)
    spec = next(m for m in MODULE_REGISTRY["storefront"].metrics if m.key == key)
    return await spec.resolve(ctx)


async def _queue(db_session, user) -> dict:
    """Run the resolver directly.

    `get_summary` swallows exceptions so one broken query cannot blank the
    page — which is exactly the behaviour that would turn a failing test green.
    """
    ctx = await AdminHubService(db_session)._context(user)
    items = await MODULE_REGISTRY["storefront"].attention(ctx)
    return {item.key: item for item in items}


class TestOpenOrders:
    async def test_counts_everything_still_in_flight(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(db_session, org, admin, status=StoreOrderStatus.SUBMITTED)
        await _order(db_session, org, admin, status=StoreOrderStatus.PAID)
        await _order(db_session, org, admin, status=StoreOrderStatus.READY_FOR_PICKUP)

        value, context = await _metric(db_session, admin, "open_orders")

        assert value == "3"
        assert context == "1 ready for pickup"

    async def test_excludes_finished_and_called_off_orders(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(db_session, org, admin, status=StoreOrderStatus.FULFILLED)
        await _order(db_session, org, admin, status=StoreOrderStatus.CANCELLED)

        value, _ = await _metric(db_session, admin, "open_orders")

        assert value == "0"


class TestOutstandingBalance:
    async def test_sums_what_is_still_owed_rather_than_order_totals(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.PARTIAL,
            total="100.00",
            amount_paid="40.00",
        )
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.UNPAID,
            total="25.00",
        )

        value, context = await _metric(db_session, admin, "outstanding_balance")

        assert value == "$85"
        assert context == "across 2 orders"

    async def test_ignores_settled_waived_and_cancelled_orders(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.PAID,
            total="60.00",
            amount_paid="60.00",
        )
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.WAIVED,
            total="70.00",
        )
        await _order(
            db_session,
            org,
            admin,
            status=StoreOrderStatus.CANCELLED,
            payment_status=StorePaymentStatus.UNPAID,
            total="80.00",
        )

        value, _ = await _metric(db_session, admin, "outstanding_balance")

        assert value == "$0"

    async def test_an_overpaid_order_does_not_erase_another_members_debt(
        self, db_session
    ):
        # Floored per row, not in aggregate: netting them would report $0 owed
        # while one member is still $50 short.
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.PARTIAL,
            total="10.00",
            amount_paid="60.00",
        )
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.UNPAID,
            total="50.00",
        )

        value, _ = await _metric(db_session, admin, "outstanding_balance")

        assert value == "$50"


class TestActiveProducts:
    async def test_separates_what_members_can_order_from_drafts(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        for status in (
            StoreProductStatus.ACTIVE,
            StoreProductStatus.ACTIVE,
            StoreProductStatus.DRAFT,
            StoreProductStatus.ARCHIVED,
        ):
            db_session.add(
                StoreProduct(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    name=f"Job Shirt {uuid.uuid4().hex[:4]}",
                    status=status,
                )
            )
        await db_session.flush()

        value, context = await _metric(db_session, admin, "active_products")

        assert value == "2"
        assert context == "1 still in draft"


class TestStorefrontAttentionQueue:
    async def test_raises_a_payment_the_member_says_they_made(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            payment_status=StorePaymentStatus.PENDING_VERIFICATION,
            reported_at=NOW - timedelta(days=3),
        )

        queue = await _queue(db_session, admin)

        item = queue["store_pending_verification"]
        assert item.count == 1
        assert item.oldest_age_days == 3
        assert item.href == "/inventory/admin/store?tab=orders"

    async def test_raises_money_the_matcher_could_not_settle(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        for status in (
            StorePaymentEventStatus.UNMATCHED,
            # Matched but not applied: it found the order and stopped, so a
            # person still has to agree before the balance moves.
            StorePaymentEventStatus.MATCHED,
            StorePaymentEventStatus.APPLIED,
            StorePaymentEventStatus.IGNORED,
        ):
            db_session.add(
                StorePaymentEvent(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    provider="paypal",
                    external_id=uuid.uuid4().hex,
                    status=status,
                    amount=Decimal("25.00"),
                )
            )
        await db_session.flush()

        queue = await _queue(db_session, admin)

        assert queue["store_unmatched_payments"].count == 2
        assert (
            queue["store_unmatched_payments"].href
            == "/inventory/admin/store?tab=payments"
        )

    async def test_raises_a_window_closed_and_never_handed_out(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        db_session.add(
            StoreOrderWindow(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Spring order",
                status=StoreWindowStatus.CLOSED,
                closes_at=NOW - timedelta(days=50),
                closed_at=NOW - timedelta(days=45),
            )
        )
        await db_session.flush()

        queue = await _queue(db_session, admin)

        assert queue["store_unfulfilled_windows"].count == 1
        assert (
            queue["store_unfulfilled_windows"].href
            == "/inventory/admin/store?tab=windows"
        )

    async def test_leaves_a_recently_closed_window_alone(self, db_session):
        # Closing and distributing are days apart in practice; flagging on day
        # one would put a row on the queue for every normal order period.
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        db_session.add(
            StoreOrderWindow(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Just closed",
                status=StoreWindowStatus.CLOSED,
                closes_at=NOW - timedelta(days=2),
                closed_at=NOW - timedelta(days=2),
            )
        )
        await db_session.flush()

        assert "store_unfulfilled_windows" not in await _queue(db_session, admin)

    async def test_dates_a_late_close_from_when_it_actually_closed(self, db_session):
        """`closed_at`, not `closes_at`.

        A window scheduled to close two months ago but closed today has not
        stranded anyone yet; dating it from the schedule would file it as
        60 days stale the moment it closed.
        """
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        db_session.add(
            StoreOrderWindow(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Closed late",
                status=StoreWindowStatus.CLOSED,
                closes_at=NOW - timedelta(days=60),
                closed_at=NOW - timedelta(days=1),
            )
        )
        await db_session.flush()

        assert "store_unfulfilled_windows" not in await _queue(db_session, admin)

    async def test_reports_a_window_that_never_had_a_schedule(self, db_session):
        """A hand-managed window has no `closes_at` and was never reported."""
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        db_session.add(
            StoreOrderWindow(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="No schedule",
                status=StoreWindowStatus.CLOSED,
                closes_at=None,
                closed_at=NOW - timedelta(days=40),
            )
        )
        await db_session.flush()

        assert (await _queue(db_session, admin))["store_unfulfilled_windows"].count == 1

    async def test_drops_a_cancelled_order_from_the_verification_queue(
        self, db_session
    ):
        """`cancel_order` leaves `payment_status` alone.

        So an order cancelled while awaiting verification keeps the flag for
        ever, and recording a payment against a cancelled order is refused —
        the row would advertise work nobody can do.
        """
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            status=StoreOrderStatus.CANCELLED,
            payment_status=StorePaymentStatus.PENDING_VERIFICATION,
            reported_at=NOW - timedelta(days=5),
        )

        assert "store_pending_verification" not in await _queue(db_session, admin)
        value, _ = await _metric(db_session, admin, "pending_verification")
        assert value == "0"

    async def test_says_nothing_when_the_store_is_running_cleanly(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _order(
            db_session,
            org,
            admin,
            status=StoreOrderStatus.FULFILLED,
            payment_status=StorePaymentStatus.PAID,
            total="20.00",
            amount_paid="20.00",
        )

        assert await _queue(db_session, admin) == {}

    async def test_does_not_report_another_departments_store(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        my_admin = await _admin(db_session, mine)
        their_admin = await _admin(db_session, theirs)
        await _order(
            db_session,
            theirs,
            their_admin,
            payment_status=StorePaymentStatus.PENDING_VERIFICATION,
            reported_at=NOW - timedelta(days=1),
        )

        assert await _queue(db_session, my_admin) == {}
