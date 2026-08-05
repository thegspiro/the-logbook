"""
Database-backed tests for StorefrontService.

These are the paths that pure-logic tests cannot reach: the order-number
allocator, the SQL rollups (which previously truncated at one page), the
stock/limit enforcement, the payment ledger, and — most importantly —
cross-tenant isolation. They also exercise the storefront migration, since
the schema has to exist for any of this to run.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models.storefront import (
    StoreFulfillmentMethod,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentMethod,
    StorePaymentPolicy,
    StorePaymentStatus,
    StoreProduct,
    StoreProductStatus,
    StoreProductVariant,
    StoreWindowStatus,
)
from app.models.user import Organization, User
from app.services.storefront_service import StorefrontService

pytestmark = pytest.mark.integration


# ======================================================================
# Fixtures / helpers
# ======================================================================


async def _make_org(db, name="Storefront FD"):
    org = Organization(name=name, slug=f"store-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_member(db, org, first="Pat", last="Member"):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name=first,
        last_name=last,
    )
    db.add(user)
    await db.flush()
    return user


async def _enable_store(service, org, **overrides):
    payload = {"is_enabled": True, "allow_pickup": True}
    payload.update(overrides)
    return await service.update_settings(org.id, payload)


async def _make_product(db, org, **overrides):
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": org.id,
        "name": "Job Shirt",
        "price": Decimal("45.00"),
        "status": StoreProductStatus.ACTIVE,
    }
    fields.update(overrides)
    product = StoreProduct(**fields)
    db.add(product)
    await db.flush()
    return product


async def _make_open_window(db, org, **overrides):
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": org.id,
        "name": "Fall apparel",
        "status": StoreWindowStatus.OPEN,
        "include_all_products": True,
        "notify_on_open": False,
    }
    fields.update(overrides)
    window = StoreOrderWindow(**fields)
    db.add(window)
    await db.flush()
    return window


def _cart(product_id, quantity=1, variant_id=None, text=None):
    return {
        "items": [
            {
                "product_id": product_id,
                "variant_id": variant_id,
                "quantity": quantity,
                "personalization_text": text,
            }
        ],
        "fulfillment_method": "pickup",
        "payment_method": StorePaymentMethod.VENMO,
    }


# ======================================================================
# Order placement
# ======================================================================


class TestOrderPlacement:
    async def test_places_an_order_and_prices_it_from_the_catalog(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)

        order = await service.create_order(org.id, member, _cart(product.id, 2))

        assert order.order_number.startswith("ORD-")
        assert order.subtotal == Decimal("90.00")
        assert order.total == Decimal("90.00")
        assert order.status == StoreOrderStatus.AWAITING_PAYMENT
        assert order.payment_status == StorePaymentStatus.UNPAID
        assert len(order.items) == 1
        assert order.items[0].unit_price == Decimal("45.00")

    async def test_order_numbers_do_not_repeat_within_an_org(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)

        numbers = {
            (await service.create_order(org.id, member, _cart(product.id))).order_number
            for _ in range(3)
        }
        assert len(numbers) == 3

    async def test_two_orgs_can_hold_the_same_order_number(self, db_session):
        service = StorefrontService(db_session)
        numbers = []
        for name in ("Org A", "Org B"):
            org = await _make_org(db_session, name)
            member = await _make_member(db_session, org)
            await _enable_store(service, org)
            product = await _make_product(db_session, org)
            await _make_open_window(db_session, org)
            order = await service.create_order(org.id, member, _cart(product.id))
            numbers.append(order.order_number)
        # Numbering is per-org, so both departments start at 0001.
        assert numbers[0] == numbers[1]

    async def test_rejects_an_order_when_the_store_is_offline(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await service.update_settings(org.id, {"is_enabled": False})
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="not currently open"):
            await service.create_order(org.id, member, _cart(product.id))

    async def test_rejects_an_order_with_no_open_window(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)

        with pytest.raises(ValueError, match="no open order window"):
            await service.create_order(org.id, member, _cart(product.id))

    async def test_a_draft_product_cannot_be_ordered(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, status=StoreProductStatus.DRAFT)
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="no longer available"):
            await service.create_order(org.id, member, _cart(product.id))

    async def test_applies_tax_only_to_taxable_lines(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org, tax_rate=Decimal("0.10"))
        taxable = await _make_product(
            db_session, org, name="Taxable", price=Decimal("100.00"), is_taxable=True
        )
        await _make_open_window(db_session, org)

        order = await service.create_order(org.id, member, _cart(taxable.id))
        assert order.tax_amount == Decimal("10.00")
        assert order.total == Decimal("110.00")


# ======================================================================
# Stock and per-member limits
# ======================================================================


class TestLimits:
    async def test_stock_cap_blocks_an_oversized_order(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, track_stock=True, stock_quantity=3
        )
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="remain available"):
            await service.create_order(org.id, member, _cart(product.id, 4))

    async def test_stock_is_consumed_across_separate_orders(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, track_stock=True, stock_quantity=3
        )
        await _make_open_window(db_session, org)

        await service.create_order(org.id, member, _cart(product.id, 2))
        with pytest.raises(ValueError, match="remain available"):
            await service.create_order(org.id, member, _cart(product.id, 2))

    async def test_cancelled_orders_release_their_stock(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, track_stock=True, stock_quantity=2
        )
        await _make_open_window(db_session, org)

        first = await service.create_order(org.id, member, _cart(product.id, 2))
        await service.cancel_order(
            first.id, org.id, str(member.id), notify_member=False
        )

        second = await service.create_order(org.id, member, _cart(product.id, 2))
        assert second.items[0].quantity == 2

    async def test_per_member_cap_counts_only_that_member(self, db_session):
        org = await _make_org(db_session)
        member_a = await _make_member(db_session, org)
        member_b = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, max_per_member=1)
        await _make_open_window(db_session, org)

        await service.create_order(org.id, member_a, _cart(product.id, 1))
        with pytest.raises(ValueError, match="remain available"):
            await service.create_order(org.id, member_a, _cart(product.id, 1))

        # The other member's allowance is untouched.
        assert await service.create_order(org.id, member_b, _cart(product.id, 1))

    async def test_a_products_cap_spans_its_variants(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, requires_variant=True, max_per_member=2
        )
        for label in ("L", "XL"):
            db_session.add(
                StoreProductVariant(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    product_id=product.id,
                    label=label,
                )
            )
        await db_session.flush()
        await _make_open_window(db_session, org)

        refreshed = await service.get_product(product.id, org.id)
        variant_ids = [v.id for v in refreshed.variants]

        payload = {
            "items": [
                {"product_id": product.id, "variant_id": variant_ids[0], "quantity": 2},
                {"product_id": product.id, "variant_id": variant_ids[1], "quantity": 1},
            ],
            "fulfillment_method": "pickup",
        }
        # The cap is per product, not per variant: 2 + 1 exceeds it.
        with pytest.raises(ValueError, match="remain available"):
            await service.create_order(org.id, member, payload)


# ======================================================================
# Personalization
# ======================================================================


class TestPersonalization:
    async def test_adds_the_upcharge_and_stores_the_text(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session,
            org,
            price=Decimal("45.00"),
            personalization_enabled=True,
            personalization_price=Decimal("8.00"),
            personalization_max_length=10,
        )
        await _make_open_window(db_session, org)

        order = await service.create_order(
            org.id, member, _cart(product.id, 1, text="SMITH")
        )
        assert order.items[0].personalization_text == "SMITH"
        assert order.items[0].unit_price == Decimal("53.00")

    async def test_text_is_discarded_when_the_product_does_not_offer_it(
        self, db_session
    ):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, personalization_enabled=False, price=Decimal("45.00")
        )
        await _make_open_window(db_session, org)

        order = await service.create_order(
            org.id, member, _cart(product.id, 1, text="SMITH")
        )
        # No upcharge is smuggled onto a product the department never
        # agreed to personalize.
        assert order.items[0].personalization_text is None
        assert order.items[0].unit_price == Decimal("45.00")

    async def test_rejects_text_over_the_limit(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session,
            org,
            personalization_enabled=True,
            personalization_max_length=5,
        )
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="limited to 5 characters"):
            await service.create_order(
                org.id, member, _cart(product.id, 1, text="WAY TOO LONG")
            )

    async def test_required_personalization_is_enforced(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session,
            org,
            personalization_enabled=True,
            personalization_required=True,
            personalization_label="a name",
        )
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="requires a name"):
            await service.create_order(org.id, member, _cart(product.id))

    async def test_different_texts_stay_separate_lines(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(
            db_session, org, personalization_enabled=True, personalization_max_length=20
        )
        window = await _make_open_window(db_session, org)

        payload = {
            "items": [
                {
                    "product_id": product.id,
                    "quantity": 1,
                    "personalization_text": "SMITH",
                },
                {
                    "product_id": product.id,
                    "quantity": 1,
                    "personalization_text": "JONES",
                },
            ],
            "fulfillment_method": "pickup",
        }
        order = await service.create_order(org.id, member, payload)
        assert len(order.items) == 2

        # The vendor sheet needs one row per name, never a merged count.
        tallies = await service._window_tallies(window.id, org.id)
        assert {t["personalization_text"] for t in tallies} == {"SMITH", "JONES"}


# ======================================================================
# Rollups (the paths that used to truncate at one page)
# ======================================================================


class TestRollups:
    async def test_window_summary_counts_every_order_past_the_page_size(
        self, db_session
    ):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))
        window = await _make_open_window(db_session, org)

        order_count = 12
        for _ in range(order_count):
            member = await _make_member(db_session, org)
            await service.create_order(org.id, member, _cart(product.id))

        summary = await service.get_window_summary(window.id, org.id)
        assert summary["order_count"] == order_count
        assert summary["member_count"] == order_count
        assert summary["gross_sales"] == Decimal("120.00")
        assert summary["outstanding"] == Decimal("120.00")
        # One product, one variant-less line: a single merged tally row.
        assert len(summary["tallies"]) == 1
        assert summary["tallies"][0]["quantity"] == order_count

    async def test_summary_excludes_cancelled_orders(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))
        window = await _make_open_window(db_session, org)

        keep = await service.create_order(org.id, member, _cart(product.id))
        drop = await service.create_order(org.id, member, _cart(product.id))
        await service.cancel_order(drop.id, org.id, str(member.id), notify_member=False)

        summary = await service.get_window_summary(window.id, org.id)
        assert summary["order_count"] == 1
        assert summary["gross_sales"] == Decimal("10.00")
        assert keep.id

    async def test_rollups_for_many_windows_come_back_in_one_call(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))

        window_a = await _make_open_window(db_session, org, name="A")
        await service.create_order(org.id, member, _cart(product.id, 2))
        await service.close_window(window_a.id, org.id, notify_members=False)

        window_b = await _make_open_window(db_session, org, name="B")
        await service.create_order(org.id, member, _cart(product.id))

        rollups = await service.get_window_rollups(org.id, [window_a.id, window_b.id])
        assert rollups[window_a.id]["gross_sales"] == Decimal("20.00")
        assert rollups[window_b.id]["gross_sales"] == Decimal("10.00")

    async def test_a_window_with_no_orders_rolls_up_to_zero(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        window = await _make_open_window(db_session, org)

        rollups = await service.get_window_rollups(org.id, [window.id])
        assert rollups[window.id]["order_count"] == 0
        assert rollups[window.id]["gross_sales"] == Decimal("0.00")

    async def test_csv_export_covers_every_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))
        await _make_open_window(db_session, org)

        for _ in range(7):
            member = await _make_member(db_session, org)
            await service.create_order(org.id, member, _cart(product.id))

        csv_text = await service.export_orders_csv(org.id)
        # Header plus one row per order line.
        assert len(csv_text.strip().splitlines()) == 8
        assert "Personalization" in csv_text.splitlines()[0]


# ======================================================================
# Payments
# ======================================================================


class TestPayments:
    async def test_recording_the_full_balance_marks_the_order_paid(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))

        updated = await service.record_payment(
            order.id, org.id, Decimal("45.00"), str(member.id), notify_member=False
        )
        assert updated.payment_status == StorePaymentStatus.PAID
        assert updated.status == StoreOrderStatus.PAID
        assert updated.paid_at is not None

    async def test_a_partial_payment_leaves_a_balance(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))

        updated = await service.record_payment(
            order.id, org.id, Decimal("20.00"), str(member.id), notify_member=False
        )
        assert updated.payment_status == StorePaymentStatus.PARTIAL
        assert updated.amount_paid == Decimal("20.00")

    async def test_a_member_report_never_settles_the_ledger(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))

        updated = await service.report_payment(
            order.id, org.id, str(member.id), StorePaymentMethod.VENMO, reference="abc"
        )
        assert updated.payment_status == StorePaymentStatus.PENDING_VERIFICATION
        # Self-reported means "please check", not "paid".
        assert updated.amount_paid == Decimal("0.00")

    async def test_mark_paid_settles_the_whole_balance(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id, 2))

        updated = await service.mark_order_paid(
            order.id, org.id, str(member.id), notify_member=False
        )
        assert updated.amount_paid == Decimal("90.00")
        assert updated.payment_status == StorePaymentStatus.PAID
        assert updated.status == StoreOrderStatus.PAID

    async def test_mark_paid_tops_up_a_partial_payment(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))
        await service.record_payment(
            order.id, org.id, Decimal("20.00"), str(member.id), notify_member=False
        )

        updated = await service.mark_order_paid(
            order.id, org.id, str(member.id), notify_member=False
        )
        # Pays the remaining 25, not another full 45.
        assert updated.amount_paid == Decimal("45.00")
        assert updated.payment_status == StorePaymentStatus.PAID

    async def test_mark_paid_on_a_settled_order_is_a_no_op(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))
        await service.mark_order_paid(
            order.id, org.id, str(member.id), notify_member=False
        )

        again = await service.mark_order_paid(
            order.id, org.id, str(member.id), notify_member=False
        )
        assert again.amount_paid == Decimal("45.00")

    async def test_a_cancelled_order_cannot_be_marked_paid(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))
        await service.cancel_order(
            order.id, org.id, str(member.id), notify_member=False
        )

        with pytest.raises(ValueError, match="cancelled order"):
            await service.mark_order_paid(
                order.id, org.id, str(member.id), notify_member=False
            )

    async def test_another_org_cannot_mark_an_order_paid(self, db_session):
        service = StorefrontService(db_session)
        org_a = await _make_org(db_session, "A")
        org_b = await _make_org(db_session, "B")
        member = await _make_member(db_session, org_a)
        await _enable_store(service, org_a)
        product = await _make_product(db_session, org_a)
        await _make_open_window(db_session, org_a)
        order = await service.create_order(org_a.id, member, _cart(product.id))

        with pytest.raises(ValueError, match="not found"):
            await service.mark_order_paid(order.id, org_b.id, None, notify_member=False)

    async def test_waiving_collects_nothing_but_clears_the_order(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        window = await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))

        waived = await service.waive_order_payment(
            order.id, org.id, str(member.id), reason="Comped", notify_member=False
        )
        assert waived.payment_status == StorePaymentStatus.WAIVED
        assert waived.status == StoreOrderStatus.PAID
        # No money moved, so the rollup must not invent revenue.
        assert waived.amount_paid == Decimal("0.00")
        summary = await service.get_window_summary(window.id, org.id)
        assert summary["collected"] == Decimal("0.00")
        assert summary["gross_sales"] == Decimal("45.00")

    async def test_bulk_mark_paid_settles_a_selection(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))
        window = await _make_open_window(db_session, org)

        orders = []
        for _ in range(4):
            member = await _make_member(db_session, org)
            orders.append(await service.create_order(org.id, member, _cart(product.id)))

        result = await service.bulk_mark_paid(
            org.id,
            [o.id for o in orders],
            None,
            payment_method=StorePaymentMethod.VENMO,
            reference="statement-2026-08",
            notify_members=False,
        )
        assert result["updated"] == 4
        assert result["skipped"] == 0

        summary = await service.get_window_summary(window.id, org.id)
        assert summary["collected"] == Decimal("40.00")
        assert summary["outstanding"] == Decimal("0.00")

    async def test_bulk_mark_paid_skips_already_settled_orders(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("10.00"))
        await _make_open_window(db_session, org)

        member_a = await _make_member(db_session, org)
        paid = await service.create_order(org.id, member_a, _cart(product.id))
        await service.mark_order_paid(paid.id, org.id, None, notify_member=False)
        member_b = await _make_member(db_session, org)
        unpaid = await service.create_order(org.id, member_b, _cart(product.id))

        result = await service.bulk_mark_paid(
            org.id, [paid.id, unpaid.id], None, notify_members=False
        )
        # A mixed selection must not fail on the already-handled ones.
        assert result["updated"] == 1
        assert result["skipped"] == 1
        assert result["errors"] == []

    async def test_bulk_mark_paid_reports_unknown_ids(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        result = await service.bulk_mark_paid(
            org.id, ["does-not-exist"], None, notify_members=False
        )
        assert result["updated"] == 0
        assert result["skipped"] == 1
        assert result["errors"][0]["order_id"] == "does-not-exist"

    async def test_refund_cannot_exceed_what_was_paid(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        await _make_open_window(db_session, org)
        order = await service.create_order(org.id, member, _cart(product.id))
        await service.record_payment(
            order.id, org.id, Decimal("45.00"), str(member.id), notify_member=False
        )

        with pytest.raises(ValueError, match="cannot exceed"):
            await service.refund_order(
                order.id,
                org.id,
                str(member.id),
                amount=Decimal("99.00"),
                notify_member=False,
            )


# ======================================================================
# Window lifecycle
# ======================================================================


class TestWindowLifecycle:
    async def test_scheduler_opens_and_closes_on_time(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        window = await _make_open_window(
            db_session,
            org,
            status=StoreWindowStatus.SCHEDULED,
            opens_at=past - timedelta(hours=1),
            closes_at=None,
            auto_open=True,
        )

        assert await service.run_window_lifecycle(org.id) >= 1
        reloaded = await service.get_window(window.id, org.id)
        assert reloaded.status == StoreWindowStatus.OPEN

        reloaded.closes_at = past
        reloaded.auto_close = True
        await db_session.commit()

        await service.run_window_lifecycle(org.id)
        closed = await service.get_window(window.id, org.id)
        assert closed.status == StoreWindowStatus.CLOSED

    async def test_a_closed_window_stops_accepting_orders(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        window = await _make_open_window(db_session, org)

        await service.close_window(window.id, org.id, notify_members=False)
        with pytest.raises(ValueError, match="no open order window"):
            await service.create_order(org.id, member, _cart(product.id))

    async def test_a_window_with_orders_cannot_be_deleted(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        window = await _make_open_window(db_session, org)
        await service.create_order(org.id, member, _cart(product.id))

        with pytest.raises(ValueError, match="already has orders"):
            await service.delete_window(window.id, org.id)


# ======================================================================
# Multi-tenant isolation (CLAUDE.md pitfall #14)
# ======================================================================


class TestOrgIsolation:
    async def _two_orgs_with_an_order(self, db_session):
        service = StorefrontService(db_session)
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        member = await _make_member(db_session, org_a)
        await _enable_store(service, org_a)
        product = await _make_product(db_session, org_a)
        await _make_open_window(db_session, org_a)
        order = await service.create_order(org_a.id, member, _cart(product.id))
        return service, org_a, org_b, order, product

    async def test_another_org_cannot_read_the_order(self, db_session):
        service, _org_a, org_b, order, _p = await self._two_orgs_with_an_order(
            db_session
        )
        assert await service.get_order(order.id, org_b.id) is None

    async def test_another_org_cannot_advance_the_order(self, db_session):
        service, _org_a, org_b, order, _p = await self._two_orgs_with_an_order(
            db_session
        )
        with pytest.raises(ValueError, match="not found"):
            await service.update_order_status(
                order.id,
                org_b.id,
                StoreOrderStatus.FULFILLED,
                None,
                notify_member=False,
            )

    async def test_another_org_cannot_record_a_payment(self, db_session):
        service, _org_a, org_b, order, _p = await self._two_orgs_with_an_order(
            db_session
        )
        with pytest.raises(ValueError, match="not found"):
            await service.record_payment(
                order.id, org_b.id, Decimal("10.00"), None, notify_member=False
            )

    async def test_another_org_cannot_read_the_product(self, db_session):
        service, _org_a, org_b, _order, product = await self._two_orgs_with_an_order(
            db_session
        )
        assert await service.get_product(product.id, org_b.id) is None

    async def test_a_window_cannot_offer_another_orgs_product(self, db_session):
        service, org_a, org_b, _order, product = await self._two_orgs_with_an_order(
            db_session
        )
        # Org B builds a window that points at Org A's catalog row.
        with pytest.raises(ValueError, match="Invalid product"):
            await service.create_window(
                org_b.id,
                {
                    "name": "Cross-tenant",
                    "include_all_products": False,
                    "offerings": [{"product_id": product.id, "sort_order": 0}],
                },
                None,
            )
        assert org_a.id != org_b.id

    async def test_another_orgs_orders_are_absent_from_the_export(self, db_session):
        service, _org_a, org_b, order, _p = await self._two_orgs_with_an_order(
            db_session
        )
        csv_text = await service.export_orders_csv(org_b.id)
        assert order.order_number not in csv_text

    async def test_a_member_only_sees_their_own_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)

        owner = await _make_member(db_session, org)
        other = await _make_member(db_session, org)
        order = await service.create_order(org.id, owner, _cart(product.id))

        assert await service.get_order(order.id, org.id, user_id=str(owner.id))
        assert await service.get_order(order.id, org.id, user_id=str(other.id)) is None


# ======================================================================
# Product photos
# ======================================================================


class TestProductImages:
    async def test_stores_and_replaces_a_photo(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        product = await _make_product(db_session, org)

        await service.set_product_image(
            product.id, org.id, b"first-bytes", "image/webp", None
        )
        stored = await service.get_product_image(product.id, org.id)
        assert stored.data == b"first-bytes"
        assert stored.byte_size == len(b"first-bytes")

        await service.set_product_image(
            product.id, org.id, b"second", "image/webp", None
        )
        replaced = await service.get_product_image(product.id, org.id)
        assert replaced.data == b"second"

    async def test_photos_are_org_scoped(self, db_session):
        service = StorefrontService(db_session)
        org_a = await _make_org(db_session, "A")
        org_b = await _make_org(db_session, "B")
        product = await _make_product(db_session, org_a)
        await service.set_product_image(
            product.id, org_a.id, b"bytes", "image/webp", None
        )

        assert await service.get_product_image(product.id, org_b.id) is None
        with pytest.raises(ValueError, match="not found"):
            await service.set_product_image(
                product.id, org_b.id, b"x", "image/webp", None
            )

    async def test_has_image_lookup_never_loads_the_bytes(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        with_photo = await _make_product(db_session, org, name="With")
        without = await _make_product(db_session, org, name="Without")
        await service.set_product_image(
            with_photo.id, org.id, b"bytes", "image/webp", None
        )

        found = await service.products_with_images(org.id, [with_photo.id, without.id])
        assert found == {with_photo.id}

    async def test_deleting_a_photo_falls_back_to_the_external_url(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        product = await _make_product(
            db_session, org, image_url="https://example.org/shirt.png"
        )
        await service.set_product_image(
            product.id, org.id, b"bytes", "image/webp", None
        )
        assert service.resolve_image_url(product, True).startswith(
            f"/api/v1/store/products/{product.id}/image"
        )

        await service.delete_product_image(product.id, org.id)
        assert await service.get_product_image(product.id, org.id) is None
        assert (
            service.resolve_image_url(product, False) == "https://example.org/shirt.png"
        )


class TestVendorOrderTotals:
    """The quartermaster's actual question: how many of each size do I buy?"""

    async def _window_with_personalized_orders(self, db_session, org, service):
        """Five members, one personalized shirt each, three distinct sizes."""
        product = await _make_product(
            db_session,
            org,
            price=Decimal("45.00"),
            personalization_enabled=True,
            personalization_required=True,
            requires_variant=True,
        )
        sizes = {}
        for label in ("M", "L", "XL"):
            variant = StoreProductVariant(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                product_id=product.id,
                label=label,
                price_delta=Decimal("0.00"),
            )
            db_session.add(variant)
            sizes[label] = variant
        await db_session.flush()
        window = await _make_open_window(db_session, org)

        for name, size, qty in [
            ("RIVERA", "L", 1),
            ("OKAFOR", "XL", 2),
            ("NGUYEN", "M", 1),
            ("FONTAINE", "L", 1),
            ("BRENNAN", "XL", 1),
        ]:
            member = await _make_member(db_session, org)
            await service.create_order(
                org.id,
                member,
                {
                    "items": [
                        {
                            "product_id": product.id,
                            "variant_id": sizes[size].id,
                            "quantity": qty,
                            "personalization_text": name,
                        }
                    ],
                    "fulfillment_method": "pickup",
                    "payment_method": StorePaymentMethod.VENMO,
                },
            )
        return product, window

    async def test_size_totals_merge_across_members(self, db_session):
        # Every line has a different name, so the per-name sheet cannot answer
        # "how many larges?" — that is what size_totals is for.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, window = await self._window_with_personalized_orders(
            db_session, org, service
        )

        summary = await service.get_window_summary(window.id, org.id)
        totals = {
            row["variant_label"]: row["quantity"] for row in summary["size_totals"]
        }

        assert totals == {"M": 1, "L": 2, "XL": 3}
        assert sum(totals.values()) == 6

    async def test_line_detail_still_lists_every_name(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, window = await self._window_with_personalized_orders(
            db_session, org, service
        )

        summary = await service.get_window_summary(window.id, org.id)
        names = {row["personalization_text"] for row in summary["tallies"]}

        # The embroidery list is the other half of the vendor hand-off.
        assert names == {"RIVERA", "OKAFOR", "NGUYEN", "FONTAINE", "BRENNAN"}
        assert len(summary["tallies"]) == 5

    async def test_cancelled_orders_drop_out_of_the_vendor_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, window = await self._window_with_personalized_orders(
            db_session, org, service
        )

        orders, _ = await service.list_orders(org.id, window_id=window.id)
        target = next(o for o in orders if o.items[0].personalization_text == "OKAFOR")
        await service.update_order_status(
            target.id, org.id, StoreOrderStatus.CANCELLED, None, notify_member=False
        )

        summary = await service.get_window_summary(window.id, org.id)
        totals = {
            row["variant_label"]: row["quantity"] for row in summary["size_totals"]
        }

        # OKAFOR's two XLs are gone; nobody should be buying shirts for a
        # cancelled order.
        assert totals == {"M": 1, "L": 2, "XL": 1}

    async def test_size_totals_do_not_leak_across_organizations(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        await _enable_store(service, org_a)
        _, window = await self._window_with_personalized_orders(
            db_session, org_a, service
        )

        with pytest.raises(ValueError, match="not found"):
            await service.get_window_summary(window.id, org_b.id)


class TestOrderInputCoercion:
    async def test_string_fulfillment_method_is_stored_as_the_enum(self, db_session):
        # Scripts and importers pass the wire string; the API passes the enum.
        # Storing the string unconverted survives the commit (the session does
        # not expire on commit) and then fails on a later `.value` access.
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)

        order = await service.create_order(
            org.id,
            member,
            {
                "items": [{"product_id": product.id, "quantity": 1}],
                "fulfillment_method": "pickup",
                "payment_method": "venmo",
            },
        )

        assert order.fulfillment_method is StoreFulfillmentMethod.PICKUP
        assert order.payment_method is StorePaymentMethod.VENMO
        # The failure this guards against surfaced here, not at the write.
        assert await service.export_orders_csv(org.id)

    async def test_an_unknown_fulfillment_method_is_refused(self, db_session):
        org = await _make_org(db_session)
        member = await _make_member(db_session, org)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        product = await _make_product(db_session, org)
        await _make_open_window(db_session, org)

        with pytest.raises(ValueError, match="Unknown delivery option"):
            await service.create_order(
                org.id,
                member,
                {
                    "items": [{"product_id": product.id, "quantity": 1}],
                    "fulfillment_method": "teleport",
                },
            )


class TestPaymentPolicy:
    """Sam ordered two XL job shirts and hasn't paid. What happens to him?"""

    async def _sam_and_a_paid_member(self, db_session, org, service, policy):
        await service.update_settings(org.id, {"payment_policy": policy})
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        window = await _make_open_window(db_session, org)

        paid_member = await _make_member(db_session, org, first="Pat")
        paid_order = await service.create_order(
            org.id, paid_member, _cart(product.id, 1)
        )
        await service.mark_order_paid(paid_order.id, org.id, None, notify_member=False)

        sam = await _make_member(db_session, org, first="Sam")
        sam_order = await service.create_order(org.id, sam, _cart(product.id, 2))
        return window, sam_order, paid_order

    # -- No gate: the store behaves exactly as it did before this setting ---

    async def test_no_gate_sends_everything_to_the_vendor(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        summary = await service.get_window_summary(window.id, org.id)
        assert sum(row["quantity"] for row in summary["size_totals"]) == 3
        assert summary["held_totals"] == []
        assert summary["held_order_count"] == 0

    async def test_no_gate_lets_an_unpaid_order_be_collected(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        done = await service.update_order_status(
            sam_order.id,
            org.id,
            StoreOrderStatus.FULFILLED,
            None,
            notify_member=False,
        )
        assert done.status == StoreOrderStatus.FULFILLED

    # -- Order it anyway, but he can't collect it --------------------------

    async def test_before_pickup_still_orders_sams_shirts(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        # The shirt gets made either way under this policy.
        summary = await service.get_window_summary(window.id, org.id)
        assert sum(row["quantity"] for row in summary["size_totals"]) == 3
        assert summary["held_totals"] == []

    async def test_before_pickup_blocks_handing_it_over(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        with pytest.raises(ValueError, match="payment before pickup"):
            await service.update_order_status(
                sam_order.id,
                org.id,
                StoreOrderStatus.FULFILLED,
                None,
                notify_member=False,
            )

    async def test_before_pickup_allows_every_step_short_of_handover(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        # Under this rule the shirt IS ordered, so it can be marked ordered and
        # put on the shelf. Only the handover waits.
        for status in (StoreOrderStatus.ORDERED, StoreOrderStatus.READY_FOR_PICKUP):
            moved = await service.update_order_status(
                sam_order.id, org.id, status, None, notify_member=False
            )
            assert moved.status == status

    async def test_before_vendor_order_also_blocks_marking_it_ordered(self, db_session):
        # The item was deliberately left off the vendor sheet, so claiming it
        # was ordered would put the record at odds with what the vendor got.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        with pytest.raises(ValueError, match="out of the vendor order"):
            await service.update_order_status(
                sam_order.id,
                org.id,
                StoreOrderStatus.ORDERED,
                None,
                notify_member=False,
            )

    async def test_before_vendor_order_still_allows_the_untouched_steps(
        self, db_session
    ):
        # Nothing reversible from the member's side is blocked — an unpaid
        # order can still be moved back to awaiting payment.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        moved = await service.update_order_status(
            sam_order.id,
            org.id,
            StoreOrderStatus.AWAITING_PAYMENT,
            None,
            notify_member=False,
        )
        assert moved.status == StoreOrderStatus.AWAITING_PAYMENT

    async def test_paying_lets_a_held_order_be_marked_ordered(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        await service.mark_order_paid(sam_order.id, org.id, None, notify_member=False)
        moved = await service.update_order_status(
            sam_order.id, org.id, StoreOrderStatus.ORDERED, None, notify_member=False
        )
        assert moved.status == StoreOrderStatus.ORDERED

    async def test_paying_releases_the_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        await service.mark_order_paid(sam_order.id, org.id, None, notify_member=False)
        done = await service.update_order_status(
            sam_order.id,
            org.id,
            StoreOrderStatus.FULFILLED,
            None,
            notify_member=False,
        )
        assert done.status == StoreOrderStatus.FULFILLED

    async def test_waiving_the_balance_also_releases_it(self, db_session):
        # A comp or a replacement clears the gate without money moving.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        await service.waive_order_payment(sam_order.id, org.id, None, reason="Comp")
        done = await service.update_order_status(
            sam_order.id,
            org.id,
            StoreOrderStatus.FULFILLED,
            None,
            notify_member=False,
        )
        assert done.status == StoreOrderStatus.FULFILLED

    # -- Sam gets nothing ---------------------------------------------------

    async def test_before_vendor_order_holds_sam_out_of_the_purchase_order(
        self, db_session
    ):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        summary = await service.get_window_summary(window.id, org.id)
        # Only the member who paid gets a shirt ordered.
        assert sum(row["quantity"] for row in summary["size_totals"]) == 1
        # Sam's two are reported, not silently dropped — somebody has to chase
        # him before the order goes in.
        assert sum(row["quantity"] for row in summary["held_totals"]) == 2
        assert summary["held_order_count"] == 1

    async def test_held_orders_rejoin_the_purchase_order_once_paid(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, sam_order, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        await service.mark_order_paid(sam_order.id, org.id, None, notify_member=False)

        summary = await service.get_window_summary(window.id, org.id)
        assert sum(row["quantity"] for row in summary["size_totals"]) == 3
        assert summary["held_totals"] == []
        assert summary["held_order_count"] == 0

    async def test_the_embroidery_list_matches_the_purchase_order(self, db_session):
        # The two hand-offs have to agree: no name on the stitching sheet for a
        # shirt that was never ordered.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        summary = await service.get_window_summary(window.id, org.id)
        ordered = sum(row["quantity"] for row in summary["size_totals"])
        stitched = sum(row["quantity"] for row in summary["tallies"])
        assert ordered == stitched == 1

    async def test_the_policy_is_reported_with_the_summary(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        summary = await service.get_window_summary(window.id, org.id)
        assert summary["payment_policy"] == StorePaymentPolicy.BEFORE_VENDOR_ORDER

    async def test_bulk_fulfill_reports_who_was_held_back(self, db_session):
        # Marking a whole window collected is one click; the ones that cannot
        # go have to come back named, not be silently skipped.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, sam_order, paid_order = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        result = await service.bulk_update_status(
            org.id,
            [paid_order.id, sam_order.id],
            StoreOrderStatus.FULFILLED,
            None,
            notify_members=False,
        )

        assert result["updated"] == 1
        assert result["skipped"] == 1
        assert result["errors"][0]["order_id"] == sam_order.id
        assert "payment before pickup" in result["errors"][0]["error"]

    async def test_the_export_marks_orders_held_from_the_vendor_order(self, db_session):
        # The CSV doubles as the treasurer's record, so it keeps every order —
        # but it must not read as a vendor sheet that quietly undoes the rule.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        csv_text = await service.export_orders_csv(org.id, window_id=window.id)
        header = csv_text.splitlines()[0].split(",")
        held_col = header.index("Held From Vendor Order")
        rows = [line.split(",") for line in csv_text.splitlines()[1:]]

        assert [r[held_col] for r in rows].count("yes") == 1
        assert [r[held_col] for r in rows].count("no") == 1

    async def test_no_gate_marks_nothing_as_held(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _, _ = await self._sam_and_a_paid_member(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        csv_text = await service.export_orders_csv(org.id, window_id=window.id)
        header = csv_text.splitlines()[0].split(",")
        held_col = header.index("Held From Vendor Order")
        rows = [line.split(",") for line in csv_text.splitlines()[1:]]

        # Nothing is held under this rule, so the whole sheet goes to the vendor.
        assert {r[held_col] for r in rows} == {"no"}


class TestQuartermasterWorkflow:
    """The four things the job actually consists of."""

    async def _window_with_mixed_payments(self, db_session, org, service, policy):
        await service.update_settings(
            org.id,
            {
                "payment_policy": policy,
                # A department that takes cash and Zelle at drill as well as
                # the apps — which is most of them.
                "accepted_payment_methods": ["venmo", "cash", "zelle"],
                "venmo_handle": "ScenarioFD",
                "zelle_handle": "treasurer@example.org",
            },
        )
        product = await _make_product(db_session, org, price=Decimal("45.00"))
        window = await _make_open_window(db_session, org)

        placed = {}
        for name, method, pay in (
            ("cash", StorePaymentMethod.CASH, True),
            ("zelle", StorePaymentMethod.ZELLE, True),
            ("venmo", StorePaymentMethod.VENMO, False),
        ):
            member = await _make_member(db_session, org, first=name)
            order = await service.create_order(
                org.id,
                member,
                {
                    "items": [{"product_id": product.id, "quantity": 1}],
                    "fulfillment_method": "pickup",
                    "payment_method": method,
                },
            )
            if pay:
                await service.mark_order_paid(
                    order.id, org.id, None, payment_method=method, notify_member=False
                )
            placed[name] = order
        return window, placed

    # -- See all orders, and how each was paid -----------------------------

    async def test_orders_can_be_filtered_by_how_they_were_paid(self, db_session):
        # "Who paid by Zelle?" — every app settles separately, so the
        # quartermaster reconciles one payout at a time.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        zelle, total = await service.list_orders(
            org.id, window_id=window.id, payment_method="zelle"
        )
        assert total == 1
        assert zelle[0].id == placed["zelle"].id

        everything, all_total = await service.list_orders(org.id, window_id=window.id)
        assert all_total == 3
        assert len(everything) == 3

    async def test_the_method_filter_composes_with_payment_status(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _ = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        _, unpaid_venmo = await service.list_orders(
            org.id,
            window_id=window.id,
            payment_method="venmo",
            payment_status="unpaid",
        )
        assert unpaid_venmo == 1

    # -- Record payment, in the method actually used -----------------------

    async def test_payment_can_be_recorded_under_a_different_method(self, db_session):
        # She chose Venmo at checkout and then handed over cash at drill. The
        # record has to say cash, or the treasurer's Venmo reconciliation is
        # short by one and nobody knows why.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.NONE
        )

        settled = await service.mark_order_paid(
            placed["venmo"].id,
            org.id,
            None,
            payment_method=StorePaymentMethod.CASH,
            reference="handed over at drill",
            notify_member=False,
        )

        assert settled.payment_status == StorePaymentStatus.PAID
        assert settled.payment_method == StorePaymentMethod.CASH
        assert settled.payment_reference == "handed over at drill"

    # -- Tell the vendor, and record that you did --------------------------

    async def test_recording_the_vendor_order_stamps_and_advances(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, _ = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.NONE
        )
        await service.close_window(window.id, org.id, notify_members=False)

        result = await service.record_vendor_order(
            window.id,
            org.id,
            None,
            vendor_name="Galls",
            vendor_reference="PO-8842",
            expected_delivery_date=date(2026, 11, 14),
            notify_members=False,
        )

        assert result["window"].vendor_name == "Galls"
        assert result["window"].vendor_reference == "PO-8842"
        assert result["window"].vendor_ordered_at is not None
        assert result["window"].expected_delivery_date == date(2026, 11, 14)
        # Under no gate, everything that was ordered gets marked ordered.
        assert result["advanced"] == 3
        assert result["skipped"] == []

    async def test_the_vendor_order_skips_what_the_payment_rule_held_back(
        self, db_session
    ):
        # The unpaid order was not on the sheet the vendor received, so saying
        # it was ordered would be a lie the member discovers at pickup.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )
        await service.close_window(window.id, org.id, notify_members=False)

        result = await service.record_vendor_order(
            window.id, org.id, None, vendor_name="Galls", notify_members=False
        )

        assert result["advanced"] == 2
        assert len(result["skipped"]) == 1
        assert result["skipped"][0]["order_id"] == placed["venmo"].id

        held = await service.get_order(placed["venmo"].id, org.id)
        assert held is not None
        assert held.status != StoreOrderStatus.ORDERED

    async def test_a_draft_window_has_nothing_to_order(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window = await _make_open_window(
            db_session, org, status=StoreWindowStatus.DRAFT
        )

        with pytest.raises(ValueError, match="Open the window"):
            await service.record_vendor_order(window.id, org.id, None)

    async def test_recording_a_vendor_order_is_org_scoped(self, db_session):
        org_a = await _make_org(db_session, "Org A")
        org_b = await _make_org(db_session, "Org B")
        service = StorefrontService(db_session)
        await _enable_store(service, org_a)
        window, _ = await self._window_with_mixed_payments(
            db_session, org_a, service, StorePaymentPolicy.NONE
        )

        with pytest.raises(ValueError, match="not found"):
            await service.record_vendor_order(window.id, org_b.id, None)

    # -- Then pickup --------------------------------------------------------

    async def test_the_window_walks_from_vendor_order_to_collected(self, db_session):
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        window, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.NONE
        )
        await service.close_window(window.id, org.id, notify_members=False)
        await service.record_vendor_order(
            window.id, org.id, None, vendor_name="Galls", notify_members=False
        )

        ids = [o.id for o in placed.values()]
        ready = await service.bulk_update_status(
            org.id, ids, StoreOrderStatus.READY_FOR_PICKUP, None, notify_members=False
        )
        assert ready["updated"] == 3

        done = await service.bulk_update_status(
            org.id, ids, StoreOrderStatus.FULFILLED, None, notify_members=False
        )
        assert done["updated"] == 3

        collected = await service.get_order(placed["cash"].id, org.id)
        assert collected is not None
        assert collected.status == StoreOrderStatus.FULFILLED
        assert collected.fulfilled_at is not None

    async def test_a_held_order_cannot_be_marked_ready_for_pickup(self, db_session):
        # Worse than merely inaccurate: "ready for pickup" emails the member to
        # come and collect a shirt that was never bought.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.BEFORE_VENDOR_ORDER
        )

        with pytest.raises(ValueError, match="ready for pickup"):
            await service.update_order_status(
                placed["venmo"].id,
                org.id,
                StoreOrderStatus.READY_FOR_PICKUP,
                None,
                notify_member=False,
            )

    async def test_before_pickup_still_shelves_an_unpaid_order(self, db_session):
        # Under the weaker rule the goods do exist, so they reach the shelf —
        # only the handover waits.
        org = await _make_org(db_session)
        service = StorefrontService(db_session)
        await _enable_store(service, org)
        _, placed = await self._window_with_mixed_payments(
            db_session, org, service, StorePaymentPolicy.BEFORE_PICKUP
        )

        moved = await service.update_order_status(
            placed["venmo"].id,
            org.id,
            StoreOrderStatus.READY_FOR_PICKUP,
            None,
            notify_member=False,
        )
        assert moved.status == StoreOrderStatus.READY_FOR_PICKUP
