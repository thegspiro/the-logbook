"""
Tests for the storefront request/response schema contract.

The SPA sends camelCase bodies (Pitfall #5 in CLAUDE.md — a schema/frontend
mismatch here surfaces as a 422 the user can't act on), so every request schema
must accept camelCase *and* snake_case, and the cross-field validators must
fire before anything reaches the service layer.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.storefront import (
    StoreOrderCreate,
    StoreOrderPaymentRecord,
    StoreOrderWindowCreate,
    StoreProductCreate,
    StoreSettingsUpdate,
)


class TestCamelCaseRequests:
    def test_order_create_accepts_camel_case(self):
        order = StoreOrderCreate.model_validate(
            {
                "windowId": "window-1",
                "items": [{"productId": "p1", "variantId": "v1", "quantity": 2}],
                "paymentMethod": "venmo",
                "fulfillmentMethod": "pickup",
                "memberNotes": "Second shirt for my spouse",
            }
        )
        assert order.window_id == "window-1"
        assert order.items[0].product_id == "p1"
        assert order.items[0].variant_id == "v1"
        assert order.payment_method.value == "venmo"
        assert order.member_notes == "Second shirt for my spouse"

    def test_order_create_still_accepts_snake_case(self):
        order = StoreOrderCreate.model_validate(
            {
                "window_id": "window-1",
                "items": [{"product_id": "p1", "quantity": 1}],
                "fulfillment_method": "pickup",
            }
        )
        assert order.window_id == "window-1"
        assert order.items[0].product_id == "p1"

    def test_window_create_accepts_camel_case_offerings(self):
        window = StoreOrderWindowCreate.model_validate(
            {
                "name": "Fall apparel",
                "includeAllProducts": False,
                "notifyOnOpen": True,
                "offerings": [
                    {"productId": "p1", "priceOverride": 40, "maxPerMember": 2}
                ],
            }
        )
        assert window.include_all_products is False
        assert window.offerings[0].product_id == "p1"
        assert window.offerings[0].price_override == Decimal("40")
        assert window.offerings[0].max_per_member == 2


class TestOrderValidation:
    def test_shipping_requires_an_address(self):
        with pytest.raises(ValidationError, match="shipping address"):
            StoreOrderCreate.model_validate(
                {
                    "items": [{"productId": "p1", "quantity": 1}],
                    "fulfillmentMethod": "ship",
                }
            )

    def test_shipping_with_address_is_accepted(self):
        order = StoreOrderCreate.model_validate(
            {
                "items": [{"productId": "p1", "quantity": 1}],
                "fulfillmentMethod": "ship",
                "shippingAddress": "1 Main St",
            }
        )
        assert order.shipping_address == "1 Main St"

    def test_an_order_needs_at_least_one_line(self):
        with pytest.raises(ValidationError):
            StoreOrderCreate.model_validate(
                {"items": [], "fulfillmentMethod": "pickup"}
            )

    def test_quantity_must_be_positive(self):
        with pytest.raises(ValidationError):
            StoreOrderCreate.model_validate(
                {
                    "items": [{"productId": "p1", "quantity": 0}],
                    "fulfillmentMethod": "pickup",
                }
            )

    def test_no_client_supplied_price(self):
        """A tampered client must not be able to name its own price."""
        order = StoreOrderCreate.model_validate(
            {
                "items": [{"productId": "p1", "quantity": 1, "unitPrice": 0.01}],
                "fulfillmentMethod": "pickup",
            }
        )
        assert not hasattr(order.items[0], "unit_price")

    def test_payment_amount_must_be_positive(self):
        with pytest.raises(ValidationError):
            StoreOrderPaymentRecord.model_validate({"amount": 0})


class TestProductValidation:
    def test_variant_required_needs_a_variant(self):
        with pytest.raises(ValidationError, match="at least one variant"):
            StoreProductCreate.model_validate(
                {"name": "Job shirt", "price": 45, "requiresVariant": True}
            )

    def test_variant_required_with_variants_is_accepted(self):
        product = StoreProductCreate.model_validate(
            {
                "name": "Job shirt",
                "price": 45,
                "requiresVariant": True,
                "variants": [{"label": "L", "priceDelta": 0}],
            }
        )
        assert product.variants[0].label == "L"

    def test_price_cannot_be_negative(self):
        with pytest.raises(ValidationError):
            StoreProductCreate.model_validate({"name": "Coin", "price": -1})


class TestSettingsValidation:
    def test_venmo_handle_is_normalized(self):
        settings = StoreSettingsUpdate.model_validate({"venmoHandle": "  @Dept  "})
        assert settings.venmo_handle == "Dept"

    def test_currency_is_upper_cased(self):
        assert StoreSettingsUpdate.model_validate({"currency": "usd"}).currency == "USD"

    def test_tax_rate_is_a_fraction_not_a_percentage(self):
        # 0.06 == 6%; anything above 1 is a caller confusing the two.
        assert StoreSettingsUpdate.model_validate(
            {"taxRate": 0.06}
        ).tax_rate == Decimal("0.06")
        with pytest.raises(ValidationError):
            StoreSettingsUpdate.model_validate({"taxRate": 6})

    def test_exclude_unset_only_carries_touched_fields(self):
        payload = StoreSettingsUpdate.model_validate({"isEnabled": True}).model_dump(
            exclude_unset=True
        )
        assert payload == {"is_enabled": True}

    def test_cashtag_is_normalized(self):
        settings = StoreSettingsUpdate.model_validate({"cashAppCashtag": " $Dept "})
        assert settings.cash_app_cashtag == "Dept"

    def test_a_malformed_cashtag_is_rejected_not_dropped(self):
        # Silently dropping it would make the Cash App button vanish with no
        # explanation to the administrator who typed it.
        with pytest.raises(ValidationError, match="cashtag"):
            StoreSettingsUpdate.model_validate({"cashAppCashtag": "$1nope"})

    def test_zelle_phone_is_normalized(self):
        settings = StoreSettingsUpdate.model_validate({"zelleHandle": "703-555-1234"})
        assert settings.zelle_handle == "(703) 555-1234"

    def test_zelle_email_is_lowercased(self):
        settings = StoreSettingsUpdate.model_validate(
            {"zelleHandle": "Treasurer@Example.ORG"}
        )
        assert settings.zelle_handle == "treasurer@example.org"

    def test_a_zelle_handle_that_is_neither_is_rejected(self):
        with pytest.raises(ValidationError, match="email address"):
            StoreSettingsUpdate.model_validate({"zelleHandle": "ask the chief"})

    def test_blank_handles_stay_none(self):
        settings = StoreSettingsUpdate.model_validate(
            {"cashAppCashtag": "   ", "zelleHandle": ""}
        )
        assert settings.cash_app_cashtag is None
        assert settings.zelle_handle is None

    def test_the_new_methods_are_accepted(self):
        settings = StoreSettingsUpdate.model_validate(
            {"acceptedPaymentMethods": ["cash_app", "zelle"]}
        )
        assert [m.value for m in settings.accepted_payment_methods or []] == [
            "cash_app",
            "zelle",
        ]
