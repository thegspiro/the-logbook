"""Payment-method rules for member self-service (no DB).

PR #1418's review flagged two gaps:

1. ``build_payment_instructions`` deliberately keeps showing an order's
   ORIGINAL payment method after the store stops accepting it, but
   ``report_payment`` rejected any method missing from the currently
   accepted list — so a member following the displayed instructions could
   not report the payment they were told to make. The order's own stored
   method is now grandfathered in.

2. ``update_member_payment_method`` allowed swapping the method while a
   payment report was pending verification, leaving
   ``payment_reference`` / ``payment_reported_at`` describing a report
   made against the old method. That change is now rejected.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.storefront import (
    StoreOrderStatus,
    StorePaymentMethod,
    StorePaymentStatus,
)
from app.services.storefront_service import StorefrontService


def _order(
    payment_method=StorePaymentMethod.VENMO,
    payment_status=StorePaymentStatus.UNPAID,
    status=StoreOrderStatus.AWAITING_PAYMENT,
):
    return SimpleNamespace(
        id="order-1",
        organization_id="org-1",
        user_id="member-1",
        order_number="ORD-2026-0001",
        status=status,
        payment_status=payment_status,
        payment_method=payment_method,
        payment_reference=None,
        payment_reported_at=None,
        total=Decimal("45.00"),
        amount_paid=Decimal("0.00"),
    )


def _settings(accepted):
    return SimpleNamespace(
        accepted_payment_methods=accepted,
        notify_admins_on_order=False,
        payment_instructions=None,
    )


def _service(order, settings):
    service = StorefrontService(None)
    service.db = SimpleNamespace(add=MagicMock(), commit=AsyncMock())
    service.get_order = AsyncMock(return_value=order)
    service.get_settings = AsyncMock(return_value=settings)
    service.notifications = SimpleNamespace(send_admin_new_order=AsyncMock())
    return service


class TestReportPaymentGrandfathering:
    async def test_accepts_the_orders_own_no_longer_offered_method(self):
        # Venmo was dropped after checkout; the instructions still show it,
        # so reporting a Venmo payment must still work.
        order = _order(payment_method=StorePaymentMethod.VENMO)
        service = _service(order, _settings(["zelle"]))

        result = await service.report_payment(
            "order-1", "org-1", "member-1", StorePaymentMethod.VENMO
        )

        assert result.payment_status == StorePaymentStatus.PENDING_VERIFICATION
        assert result.payment_method == StorePaymentMethod.VENMO

    async def test_still_rejects_other_non_accepted_methods(self):
        order = _order(payment_method=StorePaymentMethod.VENMO)
        service = _service(order, _settings(["zelle"]))

        with pytest.raises(ValueError, match="not accepted"):
            await service.report_payment(
                "order-1", "org-1", "member-1", StorePaymentMethod.CASH
            )

    async def test_no_grandfathering_when_order_has_no_stored_method(self):
        order = _order(payment_method=None)
        service = _service(order, _settings(["zelle"]))

        with pytest.raises(ValueError, match="not accepted"):
            await service.report_payment(
                "order-1", "org-1", "member-1", StorePaymentMethod.VENMO
            )

    async def test_currently_accepted_method_still_works(self):
        order = _order(payment_method=StorePaymentMethod.VENMO)
        service = _service(order, _settings(["zelle"]))

        result = await service.report_payment(
            "order-1", "org-1", "member-1", StorePaymentMethod.ZELLE
        )

        assert result.payment_status == StorePaymentStatus.PENDING_VERIFICATION
        assert result.payment_method == StorePaymentMethod.ZELLE

    async def test_empty_accepted_list_still_allows_any_method(self):
        order = _order(payment_method=None)
        service = _service(order, _settings([]))

        result = await service.report_payment(
            "order-1", "org-1", "member-1", StorePaymentMethod.CHECK
        )

        assert result.payment_status == StorePaymentStatus.PENDING_VERIFICATION


class TestUpdateMethodDuringPendingVerification:
    async def test_rejects_change_while_a_report_awaits_verification(self):
        order = _order(
            payment_method=StorePaymentMethod.VENMO,
            payment_status=StorePaymentStatus.PENDING_VERIFICATION,
        )
        order.payment_reference = "venmo-1234"
        service = _service(order, _settings(["venmo", "zelle"]))

        with pytest.raises(ValueError, match="awaiting verification"):
            await service.update_member_payment_method(
                "order-1", "org-1", "member-1", StorePaymentMethod.ZELLE
            )
        assert order.payment_method == StorePaymentMethod.VENMO
        assert order.payment_reference == "venmo-1234"

    async def test_allows_change_while_unpaid(self):
        order = _order(payment_method=StorePaymentMethod.VENMO)
        service = _service(order, _settings(["venmo", "zelle"]))

        result = await service.update_member_payment_method(
            "order-1", "org-1", "member-1", StorePaymentMethod.ZELLE
        )

        assert result.payment_method == StorePaymentMethod.ZELLE

    async def test_still_rejects_settled_orders(self):
        order = _order(payment_status=StorePaymentStatus.PAID)
        service = _service(order, _settings(["venmo", "zelle"]))

        with pytest.raises(ValueError, match="settled"):
            await service.update_member_payment_method(
                "order-1", "org-1", "member-1", StorePaymentMethod.ZELLE
            )

    async def test_still_rejects_cancelled_orders(self):
        order = _order(status=StoreOrderStatus.CANCELLED)
        service = _service(order, _settings(["venmo", "zelle"]))

        with pytest.raises(ValueError, match="cancelled"):
            await service.update_member_payment_method(
                "order-1", "org-1", "member-1", StorePaymentMethod.ZELLE
            )
