"""
Tests for challenge-response verification (app/core/captcha.py).

The properties that matter: the control fails *closed* on a provider outage
(unlike the breached-password check), a misconfigured install does not brick
every public form, reCAPTCHA's score is honored, and provider error codes never
reach the client.
"""

from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException

from app.core.captcha import (
    get_widget_origins,
    is_captcha_configured,
    require_captcha,
    verify_captcha_token,
)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_ENABLED", True)
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_PROVIDER", "turnstile")
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_SECRET_KEY", "sekrit")
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_MIN_SCORE", 0.5)
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_TIMEOUT_SECONDS", 5.0)


def _mock_transport(monkeypatch, handler):
    real_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr("app.core.captcha.httpx.AsyncClient", _factory)


def _request(ip: str = "203.0.113.5", token: str | None = "tok") -> MagicMock:
    request = MagicMock()
    request.client.host = ip
    request.headers = {"X-Captcha-Token": token} if token is not None else {}
    request.url.path = "/api/public/v1/forms/x/submit"
    return request


@pytest.mark.unit
async def test_valid_token_passes(monkeypatch):
    def handler(_request):
        return httpx.Response(200, json={"success": True})

    _mock_transport(monkeypatch, handler)
    await require_captcha(_request())  # must not raise


@pytest.mark.unit
async def test_invalid_token_is_rejected(monkeypatch):
    def handler(_request):
        return httpx.Response(
            200, json={"success": False, "error-codes": ["invalid-input-response"]}
        )

    _mock_transport(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc_info:
        await require_captcha(_request())

    assert exc_info.value.status_code == 400
    # Provider error codes tell an attacker which part of the setup to probe.
    assert "invalid-input-response" not in exc_info.value.detail


@pytest.mark.unit
async def test_missing_token_is_rejected(monkeypatch):
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200, json={"success": True})

    _mock_transport(monkeypatch, handler)
    with pytest.raises(HTTPException):
        await require_captcha(_request(token=None))

    # An absent token is rejected locally — no round trip to the provider.
    assert called is False


@pytest.mark.unit
async def test_provider_outage_fails_closed(monkeypatch):
    """Unlike the breached-password check, an outage must NOT let traffic in."""

    def handler(_request):
        raise httpx.ConnectTimeout("provider unreachable")

    _mock_transport(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc_info:
        await require_captcha(_request())

    assert exc_info.value.status_code == 400


@pytest.mark.unit
async def test_provider_http_error_fails_closed(monkeypatch):
    def handler(_request):
        return httpx.Response(500, text="upstream boom")

    _mock_transport(monkeypatch, handler)
    with pytest.raises(HTTPException):
        await require_captcha(_request())


@pytest.mark.unit
async def test_secret_is_sent_and_token_forwarded(monkeypatch):
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"success": True})

    _mock_transport(monkeypatch, handler)
    await verify_captcha_token("abc123", "203.0.113.5")

    assert "secret=sekrit" in seen["body"]
    assert "response=abc123" in seen["body"]
    assert "remoteip=203.0.113.5" in seen["body"]


@pytest.mark.unit
async def test_disabled_is_a_no_op(monkeypatch):
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_ENABLED", False)
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200, json={"success": False})

    _mock_transport(monkeypatch, handler)
    await require_captcha(_request(token=None))  # must not raise

    assert called is False


@pytest.mark.unit
async def test_enabled_without_secret_does_not_brick_the_form(monkeypatch):
    """A half-finished setup must not reject every public submission."""
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_SECRET_KEY", "")

    assert is_captcha_configured() is False
    await require_captcha(_request(token=None))  # must not raise


@pytest.mark.unit
async def test_unknown_provider_does_not_brick_the_form(monkeypatch):
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_PROVIDER", "notreal")

    assert is_captcha_configured() is False
    await require_captcha(_request(token=None))  # must not raise


@pytest.mark.unit
async def test_recaptcha_low_score_is_rejected(monkeypatch):
    """v3 always returns success=True; a boolean-only read would accept bots."""
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_PROVIDER", "recaptcha")

    def handler(_request):
        return httpx.Response(200, json={"success": True, "score": 0.1})

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await verify_captcha_token("tok", None)

    assert is_valid is False


@pytest.mark.unit
async def test_recaptcha_high_score_passes(monkeypatch):
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_PROVIDER", "recaptcha")

    def handler(_request):
        return httpx.Response(200, json={"success": True, "score": 0.9})

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await verify_captcha_token("tok", None)

    assert is_valid is True


@pytest.mark.unit
async def test_score_is_ignored_for_turnstile(monkeypatch):
    """Turnstile omits score; a stray one must not gate a valid verdict."""

    def handler(_request):
        return httpx.Response(200, json={"success": True, "score": 0.0})

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await verify_captcha_token("tok", None)

    assert is_valid is True


@pytest.mark.unit
async def test_non_object_response_is_rejected(monkeypatch):
    def handler(_request):
        return httpx.Response(200, json=["not", "an", "object"])

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await verify_captcha_token("tok", None)

    assert is_valid is False


@pytest.mark.unit
def test_widget_origins_track_the_provider(monkeypatch):
    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_PROVIDER", "hcaptcha")
    assert any("hcaptcha" in origin for origin in get_widget_origins())

    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_ENABLED", False)
    assert get_widget_origins() == []


@pytest.mark.unit
def test_csp_widens_only_when_captcha_is_on(monkeypatch):
    """With CAPTCHA off the policy must be unchanged for every deployment."""
    from app.core.security_middleware import SecurityHeadersMiddleware

    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_ENABLED", False)
    off = dict(SecurityHeadersMiddleware._build_headers())[b"content-security-policy"]

    monkeypatch.setattr("app.core.captcha.settings.CAPTCHA_ENABLED", True)
    on = dict(SecurityHeadersMiddleware._build_headers())[b"content-security-policy"]

    assert b"frame-src" not in off
    assert b"challenges.cloudflare.com" not in off
    assert b"script-src 'self';" in off

    assert b"challenges.cloudflare.com" in on
    assert b"frame-src" in on
    # Widening must not have loosened anything else.
    assert b"object-src 'none'" in on
    assert b"frame-ancestors 'none'" in on
