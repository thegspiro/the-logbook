"""Waiving an order's payment is refused once the order is settled (SF8-04-3).

``waive_order_payment`` used to set ``payment_status = WAIVED`` whatever the
order already held. A waive from a stale tab on an order that had since been
paid left ``amount_paid = 100`` beside ``payment_status = waived``, and the
sales rollup, which keys off ``payment_status``, then reported money the
department had collected as uncollected. A paid order is refunded, not waived.

A partly paid order may still be waived: the department is forgiving the
balance, and the money already received stays recorded against it.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.storefront import StorePaymentStatus
from app.services.storefront_service import StorefrontService

pytestmark = [pytest.mark.integration]


async def _seed(
    db: AsyncSession, amount_paid: str, payment_status: str
) -> tuple[str, str]:
    org, window, order = (str(uuid.uuid4()) for _ in range(3))
    await db.execute(
        text(
            "INSERT INTO organizations (id,name,organization_type,slug,"
            "timezone,active) VALUES (:i,'Waive FD','fire_department',:s,'UTC',1)"
        ),
        {"i": org, "s": f"waive-{org[:8]}"},
    )
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
            "submitted_at) VALUES (:i,:o,:w,'ORD-1','M','submitted',:ps,100,0,0,0,"
            "100,:ap,'pickup',NOW())"
        ),
        {"i": order, "o": org, "w": window, "ps": payment_status, "ap": amount_paid},
    )
    return org, order


async def _payment_state(db: AsyncSession, order: str) -> tuple[str, Decimal]:
    row = (
        await db.execute(
            text("SELECT payment_status, amount_paid FROM store_orders WHERE id=:i"),
            {"i": order},
        )
    ).one()
    return row[0], Decimal(row[1])


@pytest.mark.parametrize(
    ("amount_paid", "payment_status", "message"),
    [
        ("100", "paid", "already paid"),
        ("0", "waived", "already waived"),
    ],
)
async def test_a_settled_order_cannot_be_waived(
    db_session: AsyncSession, amount_paid: str, payment_status: str, message: str
):
    org, order = await _seed(db_session, amount_paid, payment_status)

    with pytest.raises(ValueError, match=message):
        await StorefrontService(db_session).waive_order_payment(
            order, org, None, notify_member=False
        )

    assert await _payment_state(db_session, order) == (
        payment_status,
        Decimal(amount_paid),
    )


async def test_a_partly_paid_order_can_still_be_waived(db_session: AsyncSession):
    org, order = await _seed(db_session, "40", "partial")

    result = await StorefrontService(db_session).waive_order_payment(
        order, org, None, notify_member=False
    )

    assert result.payment_status == StorePaymentStatus.WAIVED
    assert await _payment_state(db_session, order) == ("waived", Decimal("40"))
