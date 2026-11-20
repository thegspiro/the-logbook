"""A store write returns the record as it now stands, not as it was loaded.

Each write loaded the record with its collections, committed, then re-selected
it to build the response. The re-select ran without ``populate_existing``, and
a collection already loaded is not reloaded, so the response kept the
collection from before the write:

- an order write returned its timeline without the event it had just added;
- a window edit returned the offerings it had just replaced;
- a product edit returned its variants without the ones it had just added.

The database was right and a refresh showed it; the response was not.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.storefront_service import StorefrontService

pytestmark = [pytest.mark.integration]


async def _org(db: AsyncSession) -> str:
    org = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id,name,organization_type,slug,"
            "timezone,active) VALUES (:i,'Store FD','fire_department',:s,'UTC',1)"
        ),
        {"i": org, "s": f"store-{org[:8]}"},
    )
    return org


async def _order(db: AsyncSession, org: str) -> str:
    window, order = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO store_order_windows (id,organization_id,name,status) "
            "VALUES (:i,:o,'Window','open')"
        ),
        {"i": window, "o": org},
    )
    await db.execute(
        text(
            "INSERT INTO store_orders (id,organization_id,window_id,order_number,"
            "customer_name,status,payment_status,subtotal,tax_amount,"
            "shipping_amount,discount_amount,total,amount_paid,fulfillment_method,"
            "submitted_at) VALUES (:i,:o,:w,'ORD-1','M','submitted','unpaid',100,"
            "0,0,0,100,0,'pickup',NOW())"
        ),
        {"i": order, "o": org, "w": window},
    )
    return order


class TestOrderWritesReturnTheirOwnEvent:
    async def test_a_message_is_in_the_returned_timeline(self, db_session):
        org = await _org(db_session)
        order_id = await _order(db_session, org)

        order = await StorefrontService(db_session).add_order_message(
            order_id, org, None, "Your jacket is in.", notify_member=False
        )

        assert [event.message for event in order.events] == ["Your jacket is in."]

    async def test_a_waiver_is_in_the_returned_timeline(self, db_session):
        org = await _org(db_session)
        order_id = await _order(db_session, org)

        order = await StorefrontService(db_session).waive_order_payment(
            order_id, org, None, reason="Retiree", notify_member=False
        )

        assert len(order.events) == 1


class TestWindowEditReturnsTheNewOfferings:
    async def test_replaced_offerings_are_returned(self, db_session):
        org = await _org(db_session)
        service = StorefrontService(db_session)
        helmet = await service.create_product(org, {"name": "Helmet"}, None)
        gloves = await service.create_product(org, {"name": "Gloves"}, None)
        window = await service.create_window(
            org, {"name": "Spring", "offerings": [{"product_id": helmet.id}]}, None
        )

        updated = await service.update_window(
            window.id, org, {"offerings": [{"product_id": gloves.id}]}
        )

        assert [offering.product_id for offering in updated.offerings] == [gloves.id]


class TestProductEditReturnsAddedVariants:
    async def test_an_added_variant_is_returned(self, db_session):
        org = await _org(db_session)
        service = StorefrontService(db_session)
        shirt = await service.create_product(
            org, {"name": "Shirt", "variants": [{"label": "M"}]}, None
        )
        medium = shirt.variants[0]

        updated = await service.update_product(
            shirt.id,
            org,
            {"variants": [{"id": medium.id, "label": "M"}, {"label": "L"}]},
        )

        assert sorted(variant.label for variant in updated.variants) == ["L", "M"]
