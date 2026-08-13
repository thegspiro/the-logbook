"""
What the storefront's emails actually contain.

The switch tests next door prove the right notice is *raised*; these prove the
notice that goes out is worth receiving — the order number is in the subject
line, the balance and the pay-with buttons are in the body, a member's typed
personalization cannot inject markup, and every send carries a plain-text
alternate for the clients that refuse HTML.

``EmailService`` is faked at the seam so nothing is delivered, but everything
up to the SMTP call — including ``wrap_email_body`` and the payment-option
builder — is the real code path.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List

import pytest

from app.models.storefront import (
    StoreOrder,
    StoreOrderItem,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentMethod,
    StorePaymentStatus,
    StoreSettings,
    StoreWindowStatus,
)
from app.models.user import Organization
from app.services import storefront_notification_service as notify_module
from app.services.storefront_notification_service import StorefrontNotificationService

pytestmark = pytest.mark.unit


class _FakeEmailService:
    """Captures the composed message instead of sending it."""

    sent: List[Dict[str, Any]] = []

    def __init__(self, organization=None, **_kwargs):
        self.organization = organization

    async def send_email(self, **kwargs) -> tuple:
        _FakeEmailService.sent.append(kwargs)
        recipients = len(kwargs.get("to_emails") or []) + len(
            kwargs.get("bcc_emails") or []
        )
        return recipients, 0


@pytest.fixture(autouse=True)
def _fake_email(monkeypatch):
    _FakeEmailService.sent = []
    monkeypatch.setattr(notify_module, "EmailService", _FakeEmailService)


def _org() -> Organization:
    return Organization(id=str(uuid.uuid4()), name="Falls Church FD", slug="fcfd")


def _settings(**overrides) -> StoreSettings:
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "store_name": "Falls Church Store",
        "currency": "USD",
        "accepted_payment_methods": ["venmo", "zelle", "cash"],
        "venmo_handle": "FallsChurchFire",
        "zelle_handle": "quartermaster@fallschurchfire.org",
        "cash_instructions": "Hand it to the quartermaster at drill.",
        "receipt_footer": "Questions? Ask the quartermaster.",
    }
    fields.update(overrides)
    return StoreSettings(**fields)


def _order(*, personalization=None, **overrides) -> StoreOrder:
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "order_number": "ORD-2026-0042",
        "customer_name": "Sam Member",
        "customer_email": "sam@example.org",
        "status": StoreOrderStatus.AWAITING_PAYMENT,
        "payment_status": StorePaymentStatus.UNPAID,
        "subtotal": Decimal("45.00"),
        "tax_amount": Decimal("0.00"),
        "shipping_amount": Decimal("0.00"),
        "discount_amount": Decimal("0.00"),
        "total": Decimal("45.00"),
        "amount_paid": Decimal("0.00"),
    }
    fields.update(overrides)
    order = StoreOrder(**fields)
    order.items = [
        StoreOrderItem(
            id=str(uuid.uuid4()),
            organization_id=fields["organization_id"],
            order_id=order.id,
            product_name="Job Shirt",
            variant_label="Large",
            personalization_text=personalization,
            quantity=1,
            unit_price=Decimal("45.00"),
            line_total=Decimal("45.00"),
        )
    ]
    return order


def _window(**overrides) -> StoreOrderWindow:
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "name": "Fall apparel",
        "status": StoreWindowStatus.OPEN,
        "pickup_instructions": "Collect at the station office.",
    }
    fields.update(overrides)
    return StoreOrderWindow(**fields)


def _last() -> Dict[str, Any]:
    assert _FakeEmailService.sent, "nothing was sent"
    return _FakeEmailService.sent[-1]


class TestOrderConfirmation:
    async def test_carries_the_order_number_lines_and_total(self):
        service = StorefrontNotificationService(None)
        sent = await service.send_order_confirmation(_order(), _settings(), _org())

        assert sent == 1
        message = _last()
        assert "ORD-2026-0042" in message["subject"]
        body = message["html_body"]
        assert "Job Shirt" in body
        assert "Large" in body
        assert "$45.00" in body
        assert "Questions? Ask the quartermaster." in body
        assert message["template_type"] == "storefront_order_confirmation"

    async def test_offers_every_configured_way_to_pay(self):
        """Not only the method chosen at checkout — the money just has to arrive."""
        service = StorefrontNotificationService(None)
        await service.send_order_confirmation(
            _order(payment_method=StorePaymentMethod.VENMO), _settings(), _org()
        )

        body = _last()["html_body"]
        assert "Pay with Venmo" in body
        assert "venmo.com" in body
        # Zelle has no deep link, so it appears as a handle to type in the
        # member's own banking app rather than a button.
        assert "quartermaster@fallschurchfire.org" in body
        assert "Hand it to the quartermaster at drill." in body

    async def test_the_venmo_link_carries_the_amount_and_the_order_number(self):
        service = StorefrontNotificationService(None)
        await service.send_order_confirmation(_order(), _settings(), _org())

        body = _last()["html_body"]
        assert "amount=45.00" in body
        assert "ORD-2026-0042" in body

    async def test_a_member_cannot_inject_markup_through_personalization(self):
        """Personalization is member-entered text rendered into an HTML email."""
        service = StorefrontNotificationService(None)
        await service.send_order_confirmation(
            _order(personalization='<script>alert("x")</script>'), _settings(), _org()
        )

        body = _last()["html_body"]
        assert "<script>" not in body
        assert "&lt;script&gt;" in body

    async def test_an_order_with_no_email_address_sends_nothing(self):
        service = StorefrontNotificationService(None)
        assert (
            await service.send_order_confirmation(
                _order(customer_email=None), _settings(), _org()
            )
            == 0
        )
        assert _FakeEmailService.sent == []

    async def test_a_settled_order_is_not_asked_to_pay_again(self):
        service = StorefrontNotificationService(None)
        await service.send_order_confirmation(
            _order(amount_paid=Decimal("45.00")), _settings(), _org()
        )

        body = _last()["html_body"]
        assert "Balance due" not in body
        assert "Pay with Venmo" not in body


class TestPaymentNotices:
    async def test_a_receipt_names_the_method_and_clears_the_balance(self):
        service = StorefrontNotificationService(None)
        await service.send_payment_received(
            _order(
                amount_paid=Decimal("45.00"),
                payment_status=StorePaymentStatus.PAID,
                payment_method=StorePaymentMethod.ZELLE,
            ),
            _settings(),
            _org(),
            amount=Decimal("45.00"),
        )

        body = _last()["html_body"]
        assert "via Zelle" in body
        assert "paid in full" in body

    async def test_a_part_payment_receipt_still_shows_how_to_pay_the_rest(self):
        service = StorefrontNotificationService(None)
        await service.send_payment_received(
            _order(
                amount_paid=Decimal("20.00"),
                payment_status=StorePaymentStatus.PARTIAL,
                payment_method=StorePaymentMethod.CASH,
            ),
            _settings(),
            _org(),
            amount=Decimal("20.00"),
        )

        body = _last()["html_body"]
        assert "$25.00" in body
        assert "Pay with Venmo" in body

    async def test_a_receipt_for_a_payment_with_no_method_recorded_still_sends(self):
        service = StorefrontNotificationService(None)
        sent = await service.send_payment_received(
            _order(amount_paid=Decimal("45.00"), payment_method=None),
            _settings(),
            _org(),
            amount=Decimal("45.00"),
        )

        assert sent == 1
        assert "We received" in _last()["html_body"]

    async def test_a_reminder_states_the_balance(self):
        service = StorefrontNotificationService(None)
        await service.send_payment_reminder(
            _order(amount_paid=Decimal("10.00")), _settings(), _org()
        )

        message = _last()
        assert "Payment reminder" in message["subject"]
        assert "$35.00" in message["html_body"]

    async def test_a_cancellation_promises_a_refund_only_when_money_moved(self):
        service = StorefrontNotificationService(None)
        await service.send_order_cancelled(
            _order(), "Vendor discontinued the style", _settings(), _org()
        )
        assert "refund" not in _last()["html_body"].lower()

        await service.send_order_cancelled(
            _order(amount_paid=Decimal("45.00")), None, _settings(), _org()
        )
        assert "refund" in _last()["html_body"].lower()


class TestWindowNotices:
    async def test_an_announcement_never_discloses_the_membership_list(self):
        """Store-wide notices go BCC — one member must not see the roster."""
        service = StorefrontNotificationService(None)
        recipients = [f"member{i}@example.org" for i in range(5)]
        await service.send_window_opened(
            _window(closes_at=datetime(2026, 9, 1, 17, 0, tzinfo=timezone.utc)),
            _settings(),
            _org(),
            recipients=recipients,
        )

        message = _last()
        assert message["to_emails"] == recipients[:1]
        assert message["bcc_emails"] == recipients[1:]

    async def test_an_opening_states_the_deadline_and_the_extra_message(self):
        service = StorefrontNotificationService(None)
        await service.send_window_opened(
            _window(closes_at=datetime(2026, 9, 1, 17, 0, tzinfo=timezone.utc)),
            _settings(),
            _org(),
            message="Sizing samples are in the day room.",
            recipients=["member@example.org"],
        )

        body = _last()["html_body"]
        assert "September 01, 2026" in body
        assert "Sizing samples are in the day room." in body
        assert "Collect at the station office." in body

    async def test_the_vendor_notice_names_the_vendor_and_the_date(self):
        service = StorefrontNotificationService(None)
        await service.send_vendor_order_placed(
            _window(
                vendor_name="Acme Apparel",
                expected_delivery_date=date(2026, 10, 15),
            ),
            _settings(),
            ["member@example.org"],
            _org(),
        )

        message = _last()
        assert "Acme Apparel" in message["html_body"]
        assert "October 15, 2026" in message["html_body"]
        assert message["template_type"] == "storefront_vendor_order_placed"

    async def test_the_vendor_notice_still_sends_without_a_delivery_date(self):
        """A promised date nobody has is worse than no date at all."""
        service = StorefrontNotificationService(None)
        await service.send_vendor_order_placed(
            _window(vendor_name="Acme Apparel"),
            _settings(),
            ["member@example.org"],
            _org(),
        )

        assert "as soon as it arrives" in _last()["html_body"]

    async def test_an_empty_recipient_list_sends_nothing(self):
        service = StorefrontNotificationService(None)
        assert await service.send_window_closed(_window(), _settings(), [], _org()) == 0
        assert _FakeEmailService.sent == []


class TestEveryNoticeIsWellFormed:
    async def test_waived_order_update_does_not_request_payment(self):
        service = StorefrontNotificationService(None)
        order = _order(payment_status=StorePaymentStatus.WAIVED)

        await service.send_order_update(order, "Payment waived.", _settings(), _org())

        body = _last()["html_body"]
        assert "Payment waived." in body
        assert "Balance due" not in body
        assert "Pay with" not in body

    async def test_each_one_carries_a_subject_a_body_and_a_text_alternate(self):
        service = StorefrontNotificationService(None)
        org, settings = _org(), _settings()
        window = _window()
        to = ["member@example.org"]

        await service.send_order_confirmation(_order(), settings, org)
        await service.send_order_update(_order(), "On the truck.", settings, org)
        await service.send_payment_reminder(_order(), settings, org)
        await service.send_payment_received(
            _order(amount_paid=Decimal("45.00")), settings, org
        )
        await service.send_order_cancelled(_order(), None, settings, org)
        await service.send_window_opened(window, settings, org, recipients=to)
        await service.send_window_closing_soon(window, settings, org, recipients=to)
        await service.send_window_closed(window, settings, to, org)
        await service.send_vendor_order_placed(window, settings, to, org)

        assert len(_FakeEmailService.sent) == 9
        for message in _FakeEmailService.sent:
            assert message["subject"].strip()
            assert message["html_body"].strip().startswith("<")
            assert message["text_body"].strip()
            assert message["template_type"].startswith("storefront_")

    async def test_a_broken_mail_server_never_breaks_the_order(self, monkeypatch):
        """A failed notice must not roll back the thing it describes."""

        class _Exploding(_FakeEmailService):
            async def send_email(self, **_kwargs):
                raise RuntimeError("SMTP is down")

        monkeypatch.setattr(notify_module, "EmailService", _Exploding)
        service = StorefrontNotificationService(None)

        assert await service.send_order_confirmation(_order(), _settings(), _org()) == 0
