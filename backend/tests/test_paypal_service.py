"""
Unit tests for the PayPal integration service.

Pure parsing/config logic only — no network. The webhook signature check is
deliberately not exercised here because it is a call to PayPal's own verify
API; mocking it would only assert that the mock was called.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.integration import INTEGRATION_CONFIG_SCHEMAS, PayPalConfig
from app.services.integration_services.paypal_service import (
    _first_nonempty,
    api_base,
    credentials_from_integration,
    extract_capture,
)

pytestmark = pytest.mark.unit


def _capture_event(**resource_overrides):
    resource = {
        "id": "8AB12345CD678901E",
        "amount": {"value": "45.00", "currency_code": "USD"},
        "invoice_id": "ORD-2026-0007",
    }
    resource.update(resource_overrides)
    return {
        "id": "WH-9XY87654321",
        "event_type": "PAYMENT.CAPTURE.COMPLETED",
        "resource": resource,
    }


class TestApiBase:
    def test_defaults_to_sandbox(self):
        # A config that has lost its environment must not start talking to the
        # live account.
        assert api_base(None) == "https://api-m.sandbox.paypal.com"
        assert api_base("") == "https://api-m.sandbox.paypal.com"

    def test_resolves_live(self):
        assert api_base("live") == "https://api-m.paypal.com"
        assert api_base("LIVE") == "https://api-m.paypal.com"

    def test_unknown_environment_falls_back_to_sandbox(self):
        assert api_base("production") == "https://api-m.sandbox.paypal.com"


class TestCredentials:
    def test_reads_secrets_then_config(self):
        class _Integration:
            config = {"environment": "live", "webhook_id": "8SR123"}

            def get_secret(self, key):
                return {"client_id": "cid", "client_secret": "csec"}.get(key)

        base, cid, secret, webhook = credentials_from_integration(_Integration())
        assert base == "https://api-m.paypal.com"
        assert (cid, secret, webhook) == ("cid", "csec", "8SR123")

    def test_missing_credentials_are_empty_not_none(self):
        class _Integration:
            config = {}

            def get_secret(self, key):
                return None

        base, cid, secret, webhook = credentials_from_integration(_Integration())
        assert base == "https://api-m.sandbox.paypal.com"
        assert (cid, secret, webhook) == ("", "", "")


class TestExtractCapture:
    def test_returns_none_for_other_event_types(self):
        # Subscribing to extra events in the PayPal dashboard is easy to do by
        # accident; those deliveries must be acknowledged, not parsed.
        assert extract_capture({"event_type": "PAYMENT.CAPTURE.REFUNDED"}) is None
        assert extract_capture({}) is None

    def test_flattens_a_capture(self):
        capture = extract_capture(_capture_event())
        assert capture is not None
        assert capture["capture_id"] == "8AB12345CD678901E"
        assert capture["event_id"] == "WH-9XY87654321"
        assert capture["amount"] == Decimal("45.00")
        assert capture["currency"] == "USD"
        assert capture["invoice_id"] == "ORD-2026-0007"

    def test_reads_custom_id_when_there_is_no_invoice(self):
        event = _capture_event(invoice_id=None, custom_id="ORD-2026-0012")
        capture = extract_capture(event)
        assert capture is not None
        assert capture["invoice_id"] is None
        assert capture["custom_id"] == "ORD-2026-0012"

    def test_blank_references_become_none(self):
        capture = extract_capture(_capture_event(invoice_id="   ", custom_id=""))
        assert capture is not None
        assert capture["invoice_id"] is None
        assert capture["custom_id"] is None

    def test_unparseable_amount_does_not_raise(self):
        # A malformed amount must not take the webhook down; it lands as zero
        # and the mismatch check then routes it to a human.
        capture = extract_capture(_capture_event(amount={"value": "not-a-number"}))
        assert capture is not None
        assert capture["amount"] == Decimal("0")

    def test_reads_payer_from_supplementary_data(self):
        event = _capture_event(
            supplementary_data={
                "payer": {
                    "email_address": "pat@example.org",
                    "name": {"given_name": "Pat", "surname": "Member"},
                }
            }
        )
        capture = extract_capture(event)
        assert capture is not None
        assert capture["payer_email"] == "pat@example.org"
        assert capture["payer_name"] == "Pat Member"

    def test_missing_payer_is_none_not_empty_string(self):
        capture = extract_capture(_capture_event())
        assert capture is not None
        assert capture["payer_name"] is None
        assert capture["payer_email"] is None

    def test_currency_is_uppercased(self):
        capture = extract_capture(
            _capture_event(amount={"value": "1.00", "currency_code": "cad"})
        )
        assert capture is not None
        assert capture["currency"] == "CAD"


class TestFirstNonempty:
    def test_skips_blank_and_whitespace(self):
        assert _first_nonempty(None, "", "   ", "value") == "value"

    def test_returns_none_when_all_blank(self):
        assert _first_nonempty(None, "", "  ") is None


class TestPayPalConfigSchema:
    def test_registered_in_the_config_registry(self):
        assert INTEGRATION_CONFIG_SCHEMAS["paypal"] is PayPalConfig

    def test_defaults_to_sandbox_with_auto_apply_on(self):
        config = PayPalConfig()
        assert config.environment == "sandbox"
        assert config.auto_apply_payments is True

    def test_rejects_an_unknown_environment(self):
        # PayPal has exactly two hosts; anything else is a typo that would
        # otherwise silently fall back to sandbox.
        with pytest.raises(ValidationError, match="environment"):
            PayPalConfig(environment="production")

    def test_rejects_unknown_keys(self):
        with pytest.raises(ValidationError, match="secret_backdoor"):
            PayPalConfig(secret_backdoor="x")
