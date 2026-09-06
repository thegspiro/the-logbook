"""Guard tests for INT-7: MAX_RESPONSE_SIZE is enforced centrally.

`create_integration_client()` wraps its transport with
`_SizeLimitedTransport`, which aborts a response mid-read once it exceeds
`MAX_RESPONSE_SIZE` bytes — before httpx's non-streaming `.get()`/`.request()`
calls can fully buffer an oversized body into memory. See
docs/security-review/INT-27-integrations.md (INT-7) and base.py's docstrings
for why this single-file, transport-level fix covers every connector without
each one changing its call site.

Response bodies must be handed to `httpx.Response(..., stream=...)`, not
`content=...`, to exercise this: `content=` eagerly materializes
`Response._content` inside `httpx.MockTransport`'s dispatch call, which is
how a synthetic Response differs from a real transport's (real transports
build `Response(..., stream=AsyncResponseStream(...))`, so `_content` is not
set until something actually reads the stream) — with `content=`, the
wrapping transport never gets a chance to intercept anything.
"""

from unittest.mock import patch

import httpx
import pytest

from app.services.integration_services import base as base_module
from app.services.integration_services.base import (
    MAX_RESPONSE_SIZE,
    ResponseTooLargeError,
    _SizeLimitedTransport,
    create_integration_client,
)
from app.services.integration_services.calcom_service import CalcomService


class _ChunkedStream(httpx.AsyncByteStream):
    """Simulates a real transport's streamed response body."""

    def __init__(self, body: bytes, chunk_size: int = 1000) -> None:
        self._body = body
        self._chunk_size = chunk_size

    async def __aiter__(self):
        for i in range(0, len(self._body), self._chunk_size):
            yield self._body[i : i + self._chunk_size]


def _streaming_dispatch(body: bytes):
    def dispatch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=_ChunkedStream(body))

    return dispatch


async def test_oversized_response_aborts_before_full_buffering():
    body = b"x" * 6000
    transport = _SizeLimitedTransport(
        httpx.MockTransport(_streaming_dispatch(body)), max_bytes=5000
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(ResponseTooLargeError):
            await client.get("https://example.test/big")


async def test_response_at_or_under_the_limit_is_unaffected():
    body = b"y" * 5000
    transport = _SizeLimitedTransport(
        httpx.MockTransport(_streaming_dispatch(body)), max_bytes=5000
    )
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get("https://example.test/ok")
        assert response.content == body


async def test_create_integration_client_wires_the_size_limited_transport():
    """Structural guard: if create_integration_client() ever stops wrapping
    its transport, this fails even though the two tests above (which build
    their own _SizeLimitedTransport directly) would still pass."""
    client = create_integration_client()
    try:
        assert isinstance(client._transport, _SizeLimitedTransport)
        assert client._transport._max_bytes == MAX_RESPONSE_SIZE
    finally:
        await client.aclose()


async def test_real_connector_call_aborts_on_an_oversized_response():
    """End-to-end through an actual connector (CalcomService), with only the
    network-facing httpx.AsyncHTTPTransport replaced — proving the cap is
    enforced along the real code path a connector call takes, not just in
    the transport unit tests above."""
    oversized_body = b"z" * (MAX_RESPONSE_SIZE + 1024)

    class _FakeNetworkTransport(httpx.AsyncBaseTransport):
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._inner = httpx.MockTransport(_streaming_dispatch(oversized_body))

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return await self._inner.handle_async_request(request)

    service = CalcomService({"api_base_url": "https://api.cal.com/v1", "api_key": "k"})
    with patch.object(base_module.httpx, "AsyncHTTPTransport", _FakeNetworkTransport):
        with pytest.raises(ResponseTooLargeError):
            await service.test_connection()
