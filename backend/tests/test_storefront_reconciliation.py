"""
Database-backed tests for external payment reconciliation.

The rule these exist to protect: a payment is only applied automatically when
the reference names exactly one order and the amount equals that order's
balance exactly. Everything else has to reach a human, because applying money
to the wrong member's order is worse than leaving it in a queue.
"""

import uuid
from decimal import Decimal

import pytest

from app.models.storefront import (
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentEventStatus,
    StorePaymentMethod,
    StorePaymentStatus,
    StoreProduct,
    StoreProductStatus,
    StoreWindowStatus,
)
from app.models.user import Organization, User
from app.services.storefront_service import StorefrontService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Reconcile FD"):
    org = Organization(name=name, slug=f"recon-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_member(db, org):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _placed_order(db, org, service, price=Decimal("45.00")):
    """An enabled store, an open window, and one unpaid order on it."""
    await service.update_settings(
        org.id,
        {
            "is_enabled": True,
            "allow_pickup": True,
            "send_order_confirmation": False,
            "notify_admins_on_order": False,
            "send_status_updates": False,
        },
    )
    product = StoreProduct(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Job Shirt",
        price=price,
        status=StoreProductStatus.ACTIVE,
    )
    db.add(product)
    window = StoreOrderWindow(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Fall apparel",
        status=StoreWindowStatus.OPEN,
        include_all_products=True,
        notify_on_open=False,
    )
    db.add(window)
    await db.flush()

    member = await _make_member(db, org)
    return await service.create_order(
        org.id,
        member,
        {
            "items": [{"product_id": product.id, "quantity": 1}],
            "fulfillment_method": "pickup",
            "payment_method": StorePaymentMethod.PAYPAL,
        },
    )


def _capture(order_number=None, amount=Decimal("45.00"), capture_id=None, **extra):
    payload = {
        "capture_id": capture_id or f"CAP-{uuid.uuid4().hex[:12]}",
        "event_id": f"WH-{uuid.uuid4().hex[:12]}",
        "amount": amount,
        "currency": "USD",
        "invoice_id": order_number,
        "custom_id": None,
        "note": None,
        "payer_name": "Pat Member",
        "payer_email": "pat@example.org",
    }
    payload.update(extra)
    return payload


class TestReferenceMatching:
    async def test_finds_the_order_named_in_the_reference(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        found = await service.find_order_by_reference(org.id, order.order_number)
        assert found is not None
        assert found.id == order.id

    async def test_reads_an_order_number_out_of_free_text(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        found = await service.find_order_by_reference(
            org.id, f"paying for {order.order_number.lower()} thanks!"
        )
        assert found is not None
        assert found.id == order.id

    async def test_a_phone_number_is_not_an_order_number(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _placed_order(db_session, org, service)

        assert (
            await service.find_order_by_reference(org.id, "call me 703-555-1234")
            is None
        )
        assert await service.find_order_by_reference(org.id, None) is None
        assert await service.find_order_by_reference(org.id, "") is None

    async def test_will_not_guess_between_two_named_orders(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        first = await _placed_order(db_session, org, service)
        second = await _placed_order(db_session, org, service)

        found = await service.find_order_by_reference(
            org.id, f"{first.order_number} and {second.order_number}"
        )
        assert found is None

    async def test_does_not_reach_across_organizations(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org_a, service)

        assert (
            await service.find_order_by_reference(org_b.id, order.order_number) is None
        )


class TestRecordExternalPayment:
    async def test_exact_match_applies_and_settles_the_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )

        assert event.status == StorePaymentEventStatus.APPLIED
        assert event.matched_order_id == order.id

        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.payment_status == StorePaymentStatus.PAID
        assert settled.amount_paid == Decimal("45.00")

    async def test_auto_apply_off_leaves_the_order_unpaid(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id,
            "paypal",
            _capture(order.order_number, Decimal("45.00")),
            auto_apply=False,
        )

        assert event.status == StorePaymentEventStatus.MATCHED
        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.payment_status == StorePaymentStatus.UNPAID

    async def test_unmatchable_payment_is_still_recorded(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("45.00"))
        )

        # The money has left the member's account; dropping the notification
        # would leave them chasing an order that still says unpaid.
        assert event.status == StorePaymentEventStatus.UNMATCHED
        assert event.matched_order_id is None
        assert event.amount == Decimal("45.00")

    async def test_short_payment_is_ambiguous_not_applied(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("20.00"))
        )

        assert event.status == StorePaymentEventStatus.AMBIGUOUS
        assert event.matched_order_id == order.id
        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.amount_paid == Decimal("0.00")

    async def test_overpayment_is_ambiguous_not_applied(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("100.00"))
        )
        assert event.status == StorePaymentEventStatus.AMBIGUOUS

    async def test_payment_against_a_settled_order_is_ambiguous(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)
        await service.mark_order_paid(order.id, org.id, None, notify_member=False)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )
        assert event.status == StorePaymentEventStatus.AMBIGUOUS
        assert "no balance" in (event.note or "")

    async def test_payment_against_a_cancelled_order_is_ambiguous(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)
        await service.update_order_status(
            order.id,
            org.id,
            StoreOrderStatus.CANCELLED,
            None,
            notify_member=False,
        )

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )
        assert event.status == StorePaymentEventStatus.AMBIGUOUS

    async def test_redelivery_does_not_pay_the_order_twice(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)
        capture = _capture(order.order_number, Decimal("45.00"))

        first = await service.record_external_payment(org.id, "paypal", capture)
        second = await service.record_external_payment(org.id, "paypal", capture)

        assert first.id == second.id
        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.amount_paid == Decimal("45.00")

    async def test_a_capture_with_no_identifier_is_refused(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)

        with pytest.raises(ValueError, match="no identifier"):
            await service.record_external_payment(
                org.id, "paypal", {"amount": Decimal("5.00")}
            )

    async def test_matching_is_scoped_to_the_paying_organization(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org_a, service)

        # Org B's PayPal account reporting a payment whose reference happens to
        # name an org A order must not settle it.
        event = await service.record_external_payment(
            org_b.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )
        assert event.status == StorePaymentEventStatus.UNMATCHED

        untouched = await service.get_order(order.id, org_a.id)
        assert untouched is not None
        assert untouched.payment_status == StorePaymentStatus.UNPAID


class TestApplyAndIgnore:
    async def test_an_administrator_can_attach_an_unmatched_payment(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)
        member = await _make_member(db_session, org)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("45.00"))
        )
        assert event.status == StorePaymentEventStatus.UNMATCHED

        applied = await service.apply_payment_event(
            event.id, org.id, member.id, order_id=order.id
        )
        assert applied.status == StorePaymentEventStatus.APPLIED
        assert applied.matched_order_id == order.id

        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.payment_status == StorePaymentStatus.PAID

    async def test_applying_twice_is_a_no_op(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )
        again = await service.apply_payment_event(event.id, org.id, None)

        assert again.status == StorePaymentEventStatus.APPLIED
        settled = await service.get_order(order.id, org.id)
        assert settled is not None
        assert settled.amount_paid == Decimal("45.00")

    async def test_applying_with_no_target_order_is_refused(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        event = await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("45.00"))
        )

        with pytest.raises(ValueError, match="Choose an order"):
            await service.apply_payment_event(event.id, org.id, None)

    async def test_cannot_apply_another_organizations_payment(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org_a, service)
        event = await service.record_external_payment(
            org_a.id, "paypal", _capture(None, Decimal("45.00"))
        )

        with pytest.raises(ValueError, match="Payment not found"):
            await service.apply_payment_event(
                event.id, org_b.id, None, order_id=order.id
            )

    async def test_dismissing_records_the_reason(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        event = await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("12.00"))
        )

        dismissed = await service.ignore_payment_event(
            event.id, org.id, None, reason="Donation, not a store order"
        )
        assert dismissed.status == StorePaymentEventStatus.IGNORED
        assert dismissed.note == "Donation, not a store order"

    async def test_an_applied_payment_cannot_be_dismissed(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)
        event = await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )

        with pytest.raises(ValueError, match="cannot be dismissed"):
            await service.ignore_payment_event(event.id, org.id, None)


class TestListing:
    async def test_unresolved_only_hides_settled_and_dismissed(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        order = await _placed_order(db_session, org, service)

        await service.record_external_payment(
            org.id, "paypal", _capture(order.order_number, Decimal("45.00"))
        )
        pending = await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("10.00"))
        )

        unresolved = await service.list_payment_events(org.id, unresolved_only=True)
        assert [e.id for e in unresolved] == [pending.id]
        assert await service.count_unresolved_payment_events(org.id) == 1

        everything = await service.list_payment_events(org.id)
        assert len(everything) == 2

    async def test_status_filter_accepts_a_known_value(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await service.record_external_payment(
            org.id, "paypal", _capture(None, Decimal("10.00"))
        )

        rows = await service.list_payment_events(org.id, status="unmatched")
        assert len(rows) == 1

    async def test_unknown_status_filter_is_refused(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)

        with pytest.raises(ValueError, match="Unknown payment status"):
            await service.list_payment_events(org.id, status="nonsense")

    async def test_listing_does_not_leak_across_organizations(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        await service.record_external_payment(
            org_a.id, "paypal", _capture(None, Decimal("10.00"))
        )

        assert await service.list_payment_events(org_b.id) == []
        assert await service.count_unresolved_payment_events(org_b.id) == 0
