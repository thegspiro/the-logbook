"""
Tests for the storefront payment-link builders.

The resulting URLs are rendered as anchors in member-facing pages *and* in
outbound email, so the "reject anything that isn't a real Venmo/PayPal/Cash App
target" cases matter as much as the happy path.
"""

from decimal import Decimal

import pytest

from app.utils.storefront_payments import (
    build_cash_app_url,
    build_paypal_url,
    build_venmo_url,
    normalize_cashtag,
    normalize_paypal_me,
    normalize_venmo_handle,
    normalize_zelle_handle,
)


class TestVenmoHandle:
    def test_strips_leading_at(self):
        assert normalize_venmo_handle("@FallsChurchFire") == "FallsChurchFire"

    def test_accepts_dashes_and_underscores(self):
        assert normalize_venmo_handle("Falls-Church_Fire") == "Falls-Church_Fire"

    def test_rejects_empty(self):
        assert normalize_venmo_handle("") is None
        assert normalize_venmo_handle(None) is None

    def test_rejects_illegal_characters(self):
        assert normalize_venmo_handle("falls church") is None
        assert normalize_venmo_handle("javascript:alert(1)") is None
        assert normalize_venmo_handle("dept/../admin") is None

    def test_rejects_too_short(self):
        assert normalize_venmo_handle("ab") is None


class TestVenmoUrl:
    def test_builds_prefilled_link(self):
        url = build_venmo_url("FallsChurchFire", Decimal("45.00"), "ORD-2026-0001")
        assert url is not None
        assert url.startswith("https://venmo.com/FallsChurchFire?txn=pay")
        assert "amount=45.00" in url
        assert "note=ORD-2026-0001" in url

    def test_omits_amount_when_zero_or_negative(self):
        assert "amount=" not in (build_venmo_url("dept", Decimal("0")) or "")
        assert "amount=" not in (build_venmo_url("dept", Decimal("-5")) or "")

    def test_url_encodes_the_note(self):
        url = build_venmo_url("dept", Decimal("10"), "ORD 1 & 2")
        assert url is not None
        assert "ORD%201%20%26%202" in url

    def test_returns_none_for_a_bad_handle(self):
        assert build_venmo_url("not a handle", Decimal("10")) is None
        assert build_venmo_url(None, Decimal("10")) is None


class TestPayPal:
    def test_accepts_bare_slug(self):
        assert normalize_paypal_me("yourdept") == "https://paypal.me/yourdept"

    def test_accepts_full_url(self):
        assert (
            normalize_paypal_me("https://paypal.me/yourdept")
            == "https://paypal.me/yourdept"
        )

    def test_accepts_www_host(self):
        assert (
            normalize_paypal_me("https://www.paypal.me/yourdept/50")
            == "https://paypal.me/yourdept"
        )

    def test_rejects_other_hosts(self):
        assert normalize_paypal_me("https://evil.example.com/yourdept") is None

    def test_rejects_non_http_schemes(self):
        assert normalize_paypal_me("javascript:alert(1)") is None

    def test_appends_amount(self):
        assert (
            build_paypal_url("yourdept", Decimal("45.5"))
            == "https://paypal.me/yourdept/45.50"
        )

    def test_omits_amount_when_absent(self):
        assert build_paypal_url("yourdept") == "https://paypal.me/yourdept"

    def test_returns_none_when_unset(self):
        assert build_paypal_url(None, Decimal("10")) is None
        assert build_paypal_url("", Decimal("10")) is None


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        (Decimal("45"), "amount=45.00"),
        (Decimal("45.5"), "amount=45.50"),
        (Decimal("1234.567"), "amount=1234.57"),
    ],
)
def test_amount_is_always_two_decimals(amount, expected):
    url = build_venmo_url("dept", amount)
    assert url is not None
    assert expected in url


class TestCashApp:
    def test_accepts_a_bare_cashtag(self):
        assert normalize_cashtag("FallsChurchFire") == "FallsChurchFire"

    def test_strips_the_dollar_sign(self):
        assert normalize_cashtag("$FallsChurchFire") == "FallsChurchFire"

    def test_accepts_a_full_cash_app_url(self):
        assert normalize_cashtag("https://cash.app/$dept") == "dept"
        assert normalize_cashtag("cash.app/$dept") == "dept"

    def test_rejects_another_host(self):
        # The URL ends up as an anchor in a member's inbox.
        assert normalize_cashtag("https://evil.example/$dept") is None
        assert normalize_cashtag("javascript:alert(1)") is None

    def test_rejects_a_cashtag_that_does_not_start_with_a_letter(self):
        assert normalize_cashtag("$1dept") is None

    def test_rejects_an_over_long_cashtag(self):
        assert normalize_cashtag("a" * 21) is None

    def test_builds_a_url_with_the_amount_in_the_path(self):
        assert (
            build_cash_app_url("$dept", Decimal("45")) == "https://cash.app/$dept/45.00"
        )

    def test_omits_a_zero_or_missing_amount(self):
        assert build_cash_app_url("$dept") == "https://cash.app/$dept"
        assert build_cash_app_url("$dept", Decimal("0")) == "https://cash.app/$dept"

    def test_returns_none_rather_than_a_half_built_link(self):
        assert build_cash_app_url(None, Decimal("45")) is None
        assert build_cash_app_url("$1bad", Decimal("45")) is None


class TestZelle:
    def test_lowercases_an_email(self):
        assert (
            normalize_zelle_handle("Treasurer@Example.ORG") == "treasurer@example.org"
        )

    def test_formats_a_ten_digit_phone(self):
        assert normalize_zelle_handle("7035551234") == "(703) 555-1234"

    def test_normalizes_however_it_was_typed(self):
        # Members read this off a screen and type it into their bank's app, so
        # every entry style has to land on the same string.
        for entry in (
            "703-555-1234",
            "(703) 555-1234",
            "+1 703 555 1234",
            "17035551234",
        ):
            assert normalize_zelle_handle(entry) == "(703) 555-1234"

    def test_rejects_something_that_is_neither(self):
        assert normalize_zelle_handle("ask the chief") is None
        assert normalize_zelle_handle("555-1234") is None
        assert normalize_zelle_handle("") is None
        assert normalize_zelle_handle(None) is None
