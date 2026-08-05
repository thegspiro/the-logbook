"""
Every storefront notice is switched by exactly one setting.

The module sends eleven different emails. Before these tests, only four of
them were behind a setting and the rest went out whenever the calling code
happened to pass ``notify_members=True`` — so a department that did not want
the "ordering is open" blast had no way to say so. These tests pin the whole
mapping: with a switch off the notice must not be raised, and with it on it
must.

The notification service itself is swapped for a recorder. What is under test
is the decision to send, not the HTML.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List

import pytest

from app.models.storefront import (
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentMethod,
    StoreProduct,
    StoreProductStatus,
    StoreWindowStatus,
)
from app.models.user import Organization, User
from app.services.storefront_service import StorefrontService

pytestmark = pytest.mark.integration


class _Recorder:
    """Stands in for StorefrontNotificationService and logs what was asked for.

    Returns 1 from every ``send_*`` so callers that stamp a "notice sent"
    timestamp on success behave as they would with a working mail server.
    """

    def __init__(self) -> None:
        self.sent: List[str] = []

    def __getattr__(self, name: str):
        async def _record(*_args, **_kwargs) -> int:
            self.sent.append(name)
            return 1

        return _record


async def _make_org(db) -> Organization:
    org = Organization(name="Notify FD", slug=f"notify-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_member(db, org) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Sam",
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _make_product(db, org) -> StoreProduct:
    product = StoreProduct(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Job Shirt",
        price=Decimal("45.00"),
        status=StoreProductStatus.ACTIVE,
    )
    db.add(product)
    await db.flush()
    return product


async def _make_window(db, org, **overrides) -> StoreOrderWindow:
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": org.id,
        "name": "Fall apparel",
        "status": StoreWindowStatus.OPEN,
        "include_all_products": True,
        "notify_on_open": True,
    }
    fields.update(overrides)
    window = StoreOrderWindow(**fields)
    db.add(window)
    await db.flush()
    return window


async def _setup(db, **settings_overrides):
    """An enabled store, a member, a product and an open window."""
    org = await _make_org(db)
    member = await _make_member(db, org)
    product = await _make_product(db, org)
    window = await _make_window(db, org)
    service = StorefrontService(db)
    payload = {"is_enabled": True, "allow_pickup": True}
    payload.update(settings_overrides)
    await service.update_settings(org.id, payload)
    recorder = _Recorder()
    service.notifications = recorder  # type: ignore[assignment]
    return service, recorder, org, member, product, window


async def _place_order(service, org, member, product) -> object:
    return await service.create_order(
        org.id,
        member,
        {
            "items": [{"product_id": product.id, "quantity": 1}],
            "fulfillment_method": "pickup",
            "payment_method": "cash",
        },
    )


# ======================================================================
# Order notices
# ======================================================================


class TestOrderNoticeSwitches:
    async def test_confirmation_and_admin_alert_fire_when_on(self, db_session):
        service, recorder, org, member, product, _ = await _setup(db_session)
        await _place_order(service, org, member, product)
        assert "send_order_confirmation" in recorder.sent
        assert "send_admin_new_order" in recorder.sent

    async def test_confirmation_off_suppresses_only_the_confirmation(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, send_order_confirmation=False
        )
        await _place_order(service, org, member, product)
        assert "send_order_confirmation" not in recorder.sent
        assert "send_admin_new_order" in recorder.sent

    async def test_admin_alert_off_suppresses_only_the_alert(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, notify_admins_on_order=False
        )
        await _place_order(service, org, member, product)
        assert "send_admin_new_order" not in recorder.sent
        assert "send_order_confirmation" in recorder.sent

    async def test_status_updates_off_suppresses_status_change(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, send_status_updates=False
        )
        order = await _place_order(service, org, member, product)
        recorder.sent.clear()
        await service.update_order_status(order.id, org.id, StoreOrderStatus.PAID, None)
        assert recorder.sent == []

    async def test_status_updates_off_suppresses_cancellation(self, db_session):
        """The cancellation notice rides the status-update switch."""
        service, recorder, org, member, product, _ = await _setup(
            db_session, send_status_updates=False
        )
        order = await _place_order(service, org, member, product)
        recorder.sent.clear()
        await service.cancel_order(order.id, org.id, None, reason="Vendor discontinued")
        assert recorder.sent == []

    async def test_status_updates_on_sends_both(self, db_session):
        service, recorder, org, member, product, _ = await _setup(db_session)
        order = await _place_order(service, org, member, product)
        recorder.sent.clear()
        await service.update_order_status(order.id, org.id, StoreOrderStatus.PAID, None)
        assert "send_order_update" in recorder.sent
        await service.cancel_order(order.id, org.id, None)
        assert "send_order_cancelled" in recorder.sent


class TestPaymentReceiptSwitch:
    async def test_receipts_off_suppresses_payment_waiver_and_refund(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, send_payment_receipts=False
        )
        paid_order = await _place_order(service, org, member, product)
        waived_order = await _place_order(service, org, member, product)
        recorder.sent.clear()

        await service.mark_order_paid(
            paid_order.id, org.id, None, payment_method=StorePaymentMethod.CASH
        )
        await service.refund_order(paid_order.id, org.id, None)
        await service.waive_order_payment(waived_order.id, org.id, None)
        assert recorder.sent == []

    async def test_receipts_on_sends_each_of_them(self, db_session):
        service, recorder, org, member, product, _ = await _setup(db_session)
        paid_order = await _place_order(service, org, member, product)
        waived_order = await _place_order(service, org, member, product)
        recorder.sent.clear()

        await service.mark_order_paid(
            paid_order.id, org.id, None, payment_method=StorePaymentMethod.CASH
        )
        assert "send_payment_received" in recorder.sent

        recorder.sent.clear()
        await service.refund_order(paid_order.id, org.id, None)
        assert "send_order_update" in recorder.sent

        recorder.sent.clear()
        await service.waive_order_payment(waived_order.id, org.id, None)
        assert "send_order_update" in recorder.sent

    async def test_reminders_off_stops_the_scheduled_run(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, send_payment_reminders=False, payment_reminder_days=1
        )
        order = await _place_order(service, org, member, product)
        order.submitted_at = datetime.now(timezone.utc) - timedelta(days=5)
        await db_session.flush()
        recorder.sent.clear()

        assert await service.run_payment_reminders(org.id) == 0
        assert recorder.sent == []

    async def test_reminders_on_nudges_the_unpaid_order(self, db_session):
        service, recorder, org, member, product, _ = await _setup(
            db_session, payment_reminder_days=1
        )
        order = await _place_order(service, org, member, product)
        order.submitted_at = datetime.now(timezone.utc) - timedelta(days=5)
        await db_session.flush()
        recorder.sent.clear()

        assert await service.run_payment_reminders(org.id) == 1
        assert recorder.sent == ["send_payment_reminder"]


# ======================================================================
# Order window notices
# ======================================================================


class TestWindowNoticeSwitches:
    async def test_window_opened_off_suppresses_the_announcement(self, db_session):
        service, recorder, org, _, _, _ = await _setup(
            db_session, send_window_opened=False
        )
        window = await _make_window(
            db_session, org, status=StoreWindowStatus.DRAFT, notify_on_open=True
        )
        await service.open_window(window.id, org.id)
        assert recorder.sent == []

    async def test_window_opened_on_announces(self, db_session):
        service, recorder, org, _, _, _ = await _setup(db_session)
        window = await _make_window(
            db_session, org, status=StoreWindowStatus.DRAFT, notify_on_open=True
        )
        await service.open_window(window.id, org.id)
        assert recorder.sent == ["send_window_opened"]

    async def test_a_single_window_can_still_opt_out(self, db_session):
        """The per-window flag narrows the setting; it cannot widen it."""
        service, recorder, org, _, _, _ = await _setup(db_session)
        window = await _make_window(
            db_session, org, status=StoreWindowStatus.DRAFT, notify_on_open=False
        )
        await service.open_window(window.id, org.id)
        assert recorder.sent == []

    async def test_window_closed_off_suppresses_the_notice(self, db_session):
        service, recorder, org, member, product, window = await _setup(
            db_session, send_window_closed=False
        )
        await _place_order(service, org, member, product)
        recorder.sent.clear()
        await service.close_window(window.id, org.id)
        assert recorder.sent == []

    async def test_window_closed_on_notifies_everyone_who_ordered(self, db_session):
        service, recorder, org, member, product, window = await _setup(db_session)
        await _place_order(service, org, member, product)
        recorder.sent.clear()
        await service.close_window(window.id, org.id)
        assert recorder.sent == ["send_window_closed"]

    async def test_vendor_updates_off_suppresses_the_placed_notice(self, db_session):
        service, recorder, org, member, product, window = await _setup(
            db_session, send_vendor_order_updates=False
        )
        await _place_order(service, org, member, product)
        recorder.sent.clear()

        result = await service.record_vendor_order(
            window.id, org.id, None, vendor_name="Acme Apparel", advance_orders=False
        )
        assert result["notified"] == 0
        assert recorder.sent == []

    async def test_vendor_updates_on_tells_everyone_who_ordered(self, db_session):
        service, recorder, org, member, product, window = await _setup(db_session)
        await _place_order(service, org, member, product)
        recorder.sent.clear()

        result = await service.record_vendor_order(
            window.id, org.id, None, vendor_name="Acme Apparel", advance_orders=False
        )
        assert result["notified"] == 1
        assert recorder.sent == ["send_vendor_order_placed"]

    async def test_closing_reminder_off_suppresses_last_call(self, db_session):
        service, recorder, org, _, _, window = await _setup(
            db_session, send_window_closing_reminder=False, window_reminder_hours=48
        )
        window.closes_at = datetime.now(timezone.utc) + timedelta(hours=2)
        await db_session.flush()
        recorder.sent.clear()

        await service.run_window_lifecycle(org.id)
        assert recorder.sent == []
        assert window.closing_reminder_sent_at is None

    async def test_closing_reminder_on_sends_last_call(self, db_session):
        service, recorder, org, _, _, window = await _setup(
            db_session, window_reminder_hours=48
        )
        window.closes_at = datetime.now(timezone.utc) + timedelta(hours=2)
        await db_session.flush()
        recorder.sent.clear()

        await service.run_window_lifecycle(org.id)
        assert recorder.sent == ["send_window_closing_soon"]


class TestDirectMessagesAreNotSwitched:
    async def test_a_typed_message_sends_with_every_switch_off(self, db_session):
        """A message the quartermaster wrote is not an automated notice.

        Switching the automated notices off should not silently swallow a note
        someone deliberately typed and pressed send on.
        """
        service, recorder, org, member, product, _ = await _setup(
            db_session,
            send_order_confirmation=False,
            send_status_updates=False,
            send_payment_receipts=False,
            notify_admins_on_order=False,
        )
        order = await _place_order(service, org, member, product)
        recorder.sent.clear()

        await service.add_order_message(
            order.id, org.id, None, "Your shirt is on the truck."
        )
        assert recorder.sent == ["send_order_update"]


class TestDefaults:
    async def test_a_new_store_has_every_notice_on(self, db_session):
        """Defaults match the behaviour the module had before the switches."""
        org = await _make_org(db_session)
        settings = await StorefrontService(db_session).get_settings(org.id)
        assert settings.send_order_confirmation is True
        assert settings.send_status_updates is True
        assert settings.send_payment_reminders is True
        assert settings.send_payment_receipts is True
        assert settings.notify_admins_on_order is True
        assert settings.send_window_opened is True
        assert settings.send_window_closing_reminder is True
        assert settings.send_window_closed is True
        assert settings.send_vendor_order_updates is True
