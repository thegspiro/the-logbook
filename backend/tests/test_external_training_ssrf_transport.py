"""Regression tests for DNS-rebinding-safe external training requests."""

import socket

import httpx
import pytest

from app.utils.ssrf_transport import SSRFSafeAsyncTransport, join_endpoint
from app.utils.url_validator import validate_integration_url


def _dns_answers(*addresses: str):
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (address, 443, 0, 0) if ":" in address else (address, 443),
        )
        for address in addresses
    ]


@pytest.mark.parametrize(
    "forbidden",
    ["127.0.0.1", "10.20.30.40", "169.254.1.2", "fd00::1", "169.254.169.254"],
)
async def test_dns_change_cannot_reach_forbidden_address(monkeypatch, forbidden):
    calls = iter([_dns_answers("93.184.216.34"), _dns_answers(forbidden)])
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: next(calls))
    validate_integration_url("https://provider.example/api")

    reached = []

    async def dispatch(request):
        reached.append(request.url.host)
        return httpx.Response(200)

    transport = SSRFSafeAsyncTransport(transport=httpx.MockTransport(dispatch))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="non-global"):
            await client.get("https://provider.example/api/records")

    assert reached == []


async def test_mixed_public_private_dns_answers_fail_closed(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: _dns_answers("93.184.216.34", "192.168.1.10"),
    )
    reached = []
    transport = SSRFSafeAsyncTransport(
        transport=httpx.MockTransport(lambda request: reached.append(request.url))
    )

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ValueError, match="non-global"):
            await client.get("https://provider.example/records")
    assert reached == []


async def test_connection_is_pinned_while_host_and_tls_name_are_preserved(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: _dns_answers("93.184.216.34"),
    )

    async def dispatch(request):
        assert request.url.host == "93.184.216.34"
        assert request.headers["Host"] == "provider.example"
        assert request.extensions["sni_hostname"] == "provider.example"
        return httpx.Response(200)

    transport = SSRFSafeAsyncTransport(transport=httpx.MockTransport(dispatch))
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get("https://provider.example/records")
    assert response.status_code == 200


async def test_redirect_to_internal_destination_is_not_followed(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: _dns_answers("93.184.216.34"),
    )
    reached = []

    async def dispatch(request):
        reached.append(request.url.host)
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/"})

    transport = SSRFSafeAsyncTransport(transport=httpx.MockTransport(dispatch))
    async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
        response = await client.get("https://provider.example/records")

    assert response.status_code == 302
    assert reached == ["93.184.216.34"]


@pytest.mark.parametrize(
    "endpoint",
    ["https://evil.example/records", "//evil.example/records", "records"],
)
def test_endpoint_overrides_must_be_relative_paths(endpoint):
    with pytest.raises(ValueError, match="relative paths"):
        join_endpoint("https://provider.example/api", endpoint)
