"""Send-time Web Push DNS pinning and legacy-subscription tests."""

import socket
from unittest.mock import MagicMock

import pytest

import app.services.push_service as push_module
from app.services.push_service import PushService

_SUB = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
    "keys": {"p256dh": "k", "auth": "a"},
}


def _answer(address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return (family, socket.SOCK_STREAM, 6, "", (address, 443))


@pytest.fixture
def service():
    return PushService(MagicMock())


@pytest.mark.parametrize(
    "answers",
    [
        [_answer("127.0.0.1")],
        [_answer("169.254.169.254")],
        [_answer("2606:4700:4700::1111"), _answer("::1")],
        [_answer("8.8.8.8"), _answer("10.0.0.1")],
    ],
)
def test_rebinding_or_mixed_dns_never_reaches_webpush(service, monkeypatch, answers):
    monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(push_module.socket, "getaddrinfo", lambda *args, **kw: answers)
    outbound = MagicMock()
    monkeypatch.setattr(push_module, "webpush", outbound)

    with pytest.raises(ValueError, match="public IPs"):
        service._send_one(_SUB, "{}")

    outbound.assert_not_called()


@pytest.mark.parametrize("environment", ["development", "test", "prod", ""])
def test_any_environment_name_is_pinned_by_default(service, monkeypatch, environment):
    """MSG-15: pinning used to run only for ENVIRONMENT exactly "production"
    or "staging", so a deployment left at the default sent unpinned."""
    monkeypatch.setattr(push_module.settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(
        push_module.socket, "getaddrinfo", lambda *args, **kw: [_answer("127.0.0.1")]
    )
    outbound = MagicMock()
    monkeypatch.setattr(push_module, "webpush", outbound)

    with pytest.raises(ValueError, match="public IPs"):
        service._send_one(_SUB, "{}")

    outbound.assert_not_called()


def test_the_test_only_bypass_sends_unpinned(service, monkeypatch):
    monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(push_module, "_UNPINNED_SENDS_FOR_TESTS", True)
    outbound = MagicMock()
    monkeypatch.setattr(push_module, "webpush", outbound)

    service._send_one(_SUB, "{}")

    assert outbound.call_args.kwargs["requests_session"] is None


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_the_bypass_never_unpins_production(service, monkeypatch, environment):
    monkeypatch.setattr(push_module.settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(push_module, "_UNPINNED_SENDS_FOR_TESTS", True)
    monkeypatch.setattr(
        push_module.socket, "getaddrinfo", lambda *args, **kw: [_answer("10.0.0.1")]
    )
    outbound = MagicMock()
    monkeypatch.setattr(push_module, "webpush", outbound)

    with pytest.raises(ValueError, match="public IPs"):
        service._send_one(_SUB, "{}")

    outbound.assert_not_called()


def test_validated_address_is_bound_to_transport_and_tls_name(service, monkeypatch):
    monkeypatch.setattr(push_module.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(
        push_module.socket,
        "getaddrinfo",
        lambda *args, **kw: [_answer("8.8.8.8"), _answer("1.1.1.1")],
    )
    outbound = MagicMock()
    monkeypatch.setattr(push_module, "webpush", outbound)

    service._send_one(_SUB, "{}")

    session = outbound.call_args.kwargs["requests_session"]
    adapter = session.adapters["https://"]
    assert adapter.address == "1.1.1.1"
    assert adapter.hostname == "fcm.googleapis.com"
    assert adapter.poolmanager.connection_pool_kw["assert_hostname"] == adapter.hostname
    assert adapter.poolmanager.connection_pool_kw["server_hostname"] == adapter.hostname


def test_redirects_are_disabled_on_hardened_session(monkeypatch):
    monkeypatch.setattr(
        push_module.socket,
        "getaddrinfo",
        lambda *args, **kw: [_answer("1.1.1.1")],
    )
    session = push_module._pinned_session(_SUB["endpoint"])
    send = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(push_module.requests.Session, "request", send)

    session.post(_SUB["endpoint"], data=b"payload")

    assert send.call_args.kwargs["allow_redirects"] is False
