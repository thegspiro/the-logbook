"""Window responses carry the vendor order, and recording one returns a full window.

Two faults in the same response shape:

- ``_window_payload`` built every window response without ``vendor_name``,
  ``vendor_reference`` or ``vendor_ordered_at``, so the windows list always
  reported them as null. The Windows tab keys its "Update vendor order" label
  and its "Already recorded …" note on ``vendorOrderedAt``, so neither ever
  showed, however many times the order had been recorded.
- ``POST /windows/{id}/vendor-order`` returned the ORM window as-is instead of
  through ``_window_payload``. ``product_name`` and the window's
  ``order_count`` / ``total_sales`` / ``outstanding_balance`` are not model
  attributes, so the response carried null and zeros for them.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import storefront as storefront_endpoints
from app.models.user import User, UserStatus
from app.schemas.storefront import (
    StoreOrderWindowResponse,
    StoreVendorOrderRequest,
    StoreVendorOrderResult,
)
from app.services.storefront_service import StorefrontService

pytestmark = [pytest.mark.integration]


async def _open_window_with_an_order(db: AsyncSession):
    org = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id,name,organization_type,slug,"
            "timezone,active) VALUES (:i,'Vendor FD','fire_department',:s,'UTC',1)"
        ),
        {"i": org, "s": f"vendor-{org[:8]}"},
    )
    service = StorefrontService(db)
    helmet = await service.create_product(org, {"name": "Helmet"}, None)
    window = await service.create_window(
        org, {"name": "Spring", "offerings": [{"product_id": helmet.id}]}, None
    )
    await db.execute(
        text("UPDATE store_order_windows SET status='closed' WHERE id=:w"),
        {"w": window.id},
    )
    await db.execute(
        text(
            "INSERT INTO store_orders (id,organization_id,window_id,order_number,"
            "customer_name,status,payment_status,subtotal,tax_amount,"
            "shipping_amount,discount_amount,total,amount_paid,fulfillment_method,"
            "submitted_at) VALUES (:i,:o,:w,'ORD-1','M','submitted','partial',100,"
            "0,0,0,100,40,'pickup',NOW())"
        ),
        {"i": str(uuid.uuid4()), "o": org, "w": window.id},
    )
    handle = uuid.uuid4().hex[:10]
    quartermaster = User(
        id=str(uuid.uuid4()),
        organization_id=org,
        username=f"qm-{handle}",
        email=f"{handle}@vendor.test",
        first_name="Quinn",
        last_name="Master",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(quartermaster)
    await db.flush()
    # A new request starts with nothing in the session.
    db.expunge_all()
    user = await db.get(User, quartermaster.id)
    return user, window.id


async def _record(db, user, window_id):
    return await storefront_endpoints.record_vendor_order(
        window_id=window_id,
        payload=StoreVendorOrderRequest(
            vendor_name="Acme Gear",
            vendor_reference="PO-77",
            advance_orders=False,
            notify_members=False,
        ),
        db=db,
        current_user=user,
    )


class TestVendorOrderResponse:
    async def test_returns_product_names_and_the_windows_totals(
        self, db_session: AsyncSession
    ):
        user, window_id = await _open_window_with_an_order(db_session)

        result = StoreVendorOrderResult.model_validate(
            await _record(db_session, user, window_id)
        )

        window = result.window
        assert window.vendor_name == "Acme Gear"
        assert window.vendor_reference == "PO-77"
        assert window.vendor_ordered_at is not None
        assert [o.product_name for o in window.offerings] == ["Helmet"]
        assert window.order_count == 1
        assert window.total_sales == Decimal("100")
        assert window.outstanding_balance == Decimal("60")


class TestWindowResponsesCarryTheVendorOrder:
    async def test_the_window_detail_reports_a_recorded_vendor_order(
        self, db_session: AsyncSession
    ):
        user, window_id = await _open_window_with_an_order(db_session)
        await _record(db_session, user, window_id)
        db_session.expunge_all()

        window = StoreOrderWindowResponse.model_validate(
            await storefront_endpoints.get_window(
                window_id=window_id, db=db_session, current_user=user
            )
        )

        assert window.vendor_name == "Acme Gear"
        assert window.vendor_ordered_at is not None

    async def test_the_windows_list_reports_a_recorded_vendor_order(
        self, db_session: AsyncSession
    ):
        user, window_id = await _open_window_with_an_order(db_session)
        await _record(db_session, user, window_id)
        db_session.expunge_all()

        windows = await storefront_endpoints.list_windows(
            status_filter=None, db=db_session, current_user=user
        )

        listed = StoreOrderWindowResponse.model_validate(windows[0])
        assert listed.vendor_reference == "PO-77"
        assert listed.vendor_ordered_at is not None
