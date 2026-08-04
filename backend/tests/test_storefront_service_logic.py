"""
Tests for the storefront service's pure pricing/limit logic.

These cover the parts that decide what a member is allowed to buy and what
they're told to pay — no database needed, since the inputs are already-loaded
model objects and the tallies the service computed from them.
"""

from decimal import Decimal

from app.models.storefront import (
    StoreOrder,
    StorePaymentMethod,
    StoreProduct,
    StoreProductVariant,
    StoreSettings,
    StoreWindowProduct,
)
from app.services.storefront_service import StorefrontService


def _service() -> StorefrontService:
    # None is a safe session here: every method under test is pure.
    return StorefrontService(None)


def _product(**kwargs) -> StoreProduct:
    defaults = {
        "id": "p1",
        "organization_id": "org1",
        "name": "Job Shirt",
        "price": Decimal("45.00"),
        "track_stock": False,
        "stock_quantity": None,
        "max_per_member": None,
    }
    defaults.update(kwargs)
    return StoreProduct(**defaults)


class TestRemainingUnits:
    def test_unlimited_when_nothing_is_capped(self):
        assert (
            _service()._remaining_units(
                product=_product(),
                offering=None,
                window_totals={},
                member_totals={},
                max_per_member=None,
            )
            is None
        )

    def test_stock_cap_subtracts_what_is_already_ordered(self):
        remaining = _service()._remaining_units(
            product=_product(track_stock=True, stock_quantity=10),
            offering=None,
            window_totals={("p1", None): 4},
            member_totals={},
            max_per_member=None,
        )
        assert remaining == 6

    def test_stock_cap_never_goes_negative(self):
        remaining = _service()._remaining_units(
            product=_product(track_stock=True, stock_quantity=3),
            offering=None,
            window_totals={("p1", None): 9},
            member_totals={},
            max_per_member=None,
        )
        assert remaining == 0

    def test_stock_is_ignored_when_tracking_is_off(self):
        assert (
            _service()._remaining_units(
                product=_product(track_stock=False, stock_quantity=2),
                offering=None,
                window_totals={},
                member_totals={},
                max_per_member=None,
            )
            is None
        )

    def test_window_quantity_limit_applies(self):
        offering = StoreWindowProduct(
            id="o1",
            organization_id="org1",
            window_id="w1",
            product_id="p1",
            quantity_limit=20,
        )
        remaining = _service()._remaining_units(
            product=_product(),
            offering=offering,
            window_totals={("p1", None): 5, ("p1", "v1"): 3},
            member_totals={},
            max_per_member=None,
        )
        assert remaining == 12

    def test_per_member_cap_counts_only_that_member(self):
        remaining = _service()._remaining_units(
            product=_product(),
            offering=None,
            window_totals={("p1", None): 40},
            member_totals={("p1", None): 1},
            max_per_member=2,
        )
        assert remaining == 1

    def test_tightest_cap_wins(self):
        offering = StoreWindowProduct(
            id="o1",
            organization_id="org1",
            window_id="w1",
            product_id="p1",
            quantity_limit=50,
        )
        remaining = _service()._remaining_units(
            product=_product(track_stock=True, stock_quantity=8),
            offering=offering,
            window_totals={("p1", None): 2},
            member_totals={("p1", None): 0},
            max_per_member=3,
        )
        # stock leaves 6, window leaves 48, per-member leaves 3
        assert remaining == 3

    def test_variant_totals_count_against_the_parent_product(self):
        remaining = _service()._remaining_units(
            product=_product(track_stock=True, stock_quantity=10),
            offering=None,
            window_totals={("p1", "v1"): 4, ("p1", "v2"): 2},
            member_totals={},
            max_per_member=None,
        )
        assert remaining == 4


class TestVariantRemaining:
    def test_falls_back_to_the_product_cap_when_untracked(self):
        variant = StoreProductVariant(
            id="v1", organization_id="org1", product_id="p1", label="L"
        )
        assert _service()._variant_remaining(variant, {}, 5) == 5
        assert _service()._variant_remaining(variant, {}, None) is None

    def test_uses_its_own_stock_when_set(self):
        variant = StoreProductVariant(
            id="v1",
            organization_id="org1",
            product_id="p1",
            label="L",
            stock_quantity=6,
        )
        assert _service()._variant_remaining(variant, {("p1", "v1"): 2}, None) == 4

    def test_is_capped_by_the_product_remainder(self):
        variant = StoreProductVariant(
            id="v1",
            organization_id="org1",
            product_id="p1",
            label="L",
            stock_quantity=6,
        )
        assert _service()._variant_remaining(variant, {}, 2) == 2


class TestPaymentInstructions:
    def _settings(self, **kwargs) -> StoreSettings:
        defaults = {
            "id": "s1",
            "organization_id": "org1",
            "store_name": "Store",
            "currency": "USD",
            "venmo_handle": "FallsChurchFire",
            "paypal_me_url": "https://paypal.me/fcfd",
            "check_payable_to": "Falls Church Fire Dept",
            "payment_instructions": "Questions? Ask the treasurer.",
        }
        defaults.update(kwargs)
        return StoreSettings(**defaults)

    def _order(self, **kwargs) -> StoreOrder:
        defaults = {
            "id": "o1",
            "organization_id": "org1",
            "order_number": "ORD-2026-0001",
            "customer_name": "A. Member",
            "total": Decimal("45.00"),
            "amount_paid": Decimal("0.00"),
            "payment_method": StorePaymentMethod.VENMO,
        }
        defaults.update(kwargs)
        return StoreOrder(**defaults)

    def test_none_when_the_order_is_settled(self):
        order = self._order(amount_paid=Decimal("45.00"))
        assert _service().build_payment_instructions(order, self._settings()) is None

    def test_venmo_link_carries_the_balance_and_order_number(self):
        payload = _service().build_payment_instructions(
            self._order(amount_paid=Decimal("20.00")), self._settings()
        )
        assert payload is not None
        assert payload["amount_due"] == Decimal("25.00")
        assert payload["handle"] == "@FallsChurchFire"
        assert "amount=25.00" in payload["payment_url"]
        assert "note=ORD-2026-0001" in payload["payment_url"]

    def test_paypal_link_appends_the_balance(self):
        payload = _service().build_payment_instructions(
            self._order(payment_method=StorePaymentMethod.PAYPAL), self._settings()
        )
        assert payload is not None
        assert payload["payment_url"] == "https://paypal.me/fcfd/45.00"

    def test_check_falls_back_to_the_general_note(self):
        payload = _service().build_payment_instructions(
            self._order(payment_method=StorePaymentMethod.CHECK), self._settings()
        )
        assert payload is not None
        assert payload["handle"] == "Falls Church Fire Dept"
        assert payload["payment_url"] is None
        assert payload["instructions"] == "Questions? Ask the treasurer."

    def test_a_bad_handle_yields_no_link_rather_than_a_broken_one(self):
        payload = _service().build_payment_instructions(
            self._order(), self._settings(venmo_handle="not a handle")
        )
        assert payload is not None
        assert payload["payment_url"] is None
