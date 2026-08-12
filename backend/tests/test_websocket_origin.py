"""Tests for explicit WebSocket Origin validation."""

import pytest

from app.utils.websocket_origin import is_websocket_origin_allowed


@pytest.mark.parametrize(
    ("origin", "host", "allowed"),
    [
        (None, "api.example.org", []),
        ("https://app.example.org", "api.internal:3001", ["https://app.example.org"]),
        ("https://example.org", "example.org", []),
        ("http://localhost:3000", "localhost:3000", []),
    ],
)
def test_allows_non_browser_configured_and_same_host_origins(origin, host, allowed):
    assert is_websocket_origin_allowed(origin, host, allowed)


@pytest.mark.parametrize(
    ("origin", "host"),
    [
        ("https://evil.example", "app.example.org"),
        ("null", "app.example.org"),
        ("javascript:alert(1)", "app.example.org"),
        ("https://app.example.org", None),
    ],
)
def test_rejects_cross_site_and_malformed_browser_origins(origin, host):
    assert not is_websocket_origin_allowed(origin, host, ["https://trusted.example"])
