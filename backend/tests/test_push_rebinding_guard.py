"""
NOTIF2-3 (app-review B11 pass 4): the DNS-rebinding residual on Web Push.

`validate_push_endpoint` screens the endpoint host at subscribe time, but a
public hostname can be re-pointed at an internal IP afterward, so `_send_one`
now re-resolves the host immediately before dispatch (via the shared
`assert_outbound_url_safe`) and fails closed on a private/internal address. The
re-check is gated to production/staging so the loopback push emulator used by the
wire-format tests (and local dev) still works.

DB-free: exercises `_send_one` directly with `webpush` and the resolver stubbed.
"""

from unittest.mock import MagicMock

import pytest

import app.services.push_service as push_module
from app.services.push_service import PushService

_SUB = {
    "endpoint": "https://push.example.com/abc",
    "keys": {"p256dh": "k", "auth": "a"},
}


@pytest.fixture
def service():
    return PushService(MagicMock())


class TestSendTimeRebindingGuard:
    def test_production_blocks_endpoint_resolving_to_private_ip(
        self, service, monkeypatch
    ):
        monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "production")
        webpush = MagicMock()
        monkeypatch.setattr(push_module, "webpush", webpush)
        # Resolver reports the host now points at an internal IP.
        guard = MagicMock(side_effect=ValueError("resolves to a private IP"))
        monkeypatch.setattr(push_module, "assert_outbound_url_safe", guard)

        with pytest.raises(ValueError):
            service._send_one(_SUB, "{}")

        guard.assert_called_once_with(_SUB["endpoint"])
        webpush.assert_not_called()  # never dispatched to the internal target

    def test_production_allows_public_endpoint(self, service, monkeypatch):
        monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "production")
        webpush = MagicMock()
        monkeypatch.setattr(push_module, "webpush", webpush)
        monkeypatch.setattr(
            push_module, "assert_outbound_url_safe", MagicMock()  # resolves public
        )

        service._send_one(_SUB, "{}")
        webpush.assert_called_once()

    def test_staging_also_guards(self, service, monkeypatch):
        monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "staging")
        monkeypatch.setattr(push_module, "webpush", MagicMock())
        guard = MagicMock()
        monkeypatch.setattr(push_module, "assert_outbound_url_safe", guard)

        service._send_one(_SUB, "{}")
        guard.assert_called_once_with(_SUB["endpoint"])

    def test_development_skips_guard(self, service, monkeypatch):
        # Local dev / the loopback wire-format tests must not re-resolve, so a
        # http://127.0.0.1 emulator endpoint still reaches webpush.
        monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "development")
        webpush = MagicMock()
        monkeypatch.setattr(push_module, "webpush", webpush)
        guard = MagicMock(side_effect=AssertionError("must not run in development"))
        monkeypatch.setattr(push_module, "assert_outbound_url_safe", guard)

        loopback = {"endpoint": "http://127.0.0.1:9/x", "keys": _SUB["keys"]}
        service._send_one(loopback, "{}")
        guard.assert_not_called()
        webpush.assert_called_once()
