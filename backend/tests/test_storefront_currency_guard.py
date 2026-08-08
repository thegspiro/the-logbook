"""
SF-4 (pass 2): record_external_payment must not auto-settle a capture whose
currency differs from the store currency — the numeric amount can equal the
order balance while being worth materially more or less (StoreOrder has no
currency column to catch it downstream). A mismatch routes to AMBIGUOUS for a
human; a matching-currency exact amount still auto-applies. DB mocked; no MySQL.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.storefront import StoreOrderStatus, StorePaymentEventStatus
from app.services.storefront_service import StorefrontService


def _order():
    return SimpleNamespace(
        id="order-1",
        order_number="ORD-1001",
        status=StoreOrderStatus.AWAITING_PAYMENT,
        total=Decimal("45.00"),
        amount_paid=Decimal("0.00"),
    )


def _service(store_currency="USD"):
    db = MagicMock()
    # The only real db.execute here is the dedup lookup -> no existing event.
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    svc = StorefrontService(db)
    svc.find_order_by_reference = AsyncMock(return_value=_order())
    svc.get_settings = AsyncMock(return_value=SimpleNamespace(currency=store_currency))
    svc.apply_payment_event = AsyncMock(return_value=SimpleNamespace())
    return svc


def _capture(currency, amount=Decimal("45.00")):
    return {
        "capture_id": "CAP-1",
        "event_id": "WH-1",
        "amount": amount,
        "currency": currency,
        "invoice_id": "ORD-1001",
    }


class TestForeignCurrencyGuard:
    async def test_foreign_currency_capture_is_ambiguous_not_applied(self):
        svc = _service(store_currency="USD")
        event = await svc.record_external_payment("org-1", "paypal", _capture("CAD"))
        assert event.status == StorePaymentEventStatus.AMBIGUOUS
        assert "currency" in (event.note or "").lower()
        svc.apply_payment_event.assert_not_awaited()  # never auto-settled

    async def test_matching_currency_exact_amount_still_auto_applies(self):
        # Regression: the currency guard must not block the legitimate path.
        svc = _service(store_currency="USD")
        await svc.record_external_payment("org-1", "paypal", _capture("USD"))
        svc.apply_payment_event.assert_awaited_once()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
