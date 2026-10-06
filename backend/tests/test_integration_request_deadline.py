"""Every request from create_integration_client() has a wall-clock deadline.

httpx's Timeout caps each socket read, not the request: a server that sends
one byte every few seconds resets the read timer forever. The client the
factory returns wraps send() in asyncio.timeout, so connect, every read and
the body drain share one deadline (INT-7 follow-up).
"""

import asyncio

import httpx
import pytest

from app.services.integration_services import base as base_module
from app.services.integration_services.base import (
    INTEGRATION_DEADLINE_SECONDS,
    RequestDeadlineExceeded,
    _DeadlineAsyncClient,
    create_integration_client,
)

pytestmark = pytest.mark.unit


class _DripStream(httpx.AsyncByteStream):
    """One byte every ``interval`` seconds, for ``count`` bytes."""

    def __init__(self, interval: float, count: int) -> None:
        self._interval = interval
        self._count = count

    async def __aiter__(self):
        for _ in range(self._count):
            await asyncio.sleep(self._interval)
            yield b"x"


def _client(stream: httpx.AsyncByteStream, deadline: float) -> _DeadlineAsyncClient:
    return _DeadlineAsyncClient(
        deadline=deadline,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, stream=stream)
        ),
    )


async def test_a_dripping_body_is_cut_off_at_the_deadline():
    # Each byte arrives well inside any per-read timeout; only a total
    # deadline can end this.
    async with _client(_DripStream(interval=0.05, count=100), deadline=0.3) as client:
        with pytest.raises(RequestDeadlineExceeded):
            await client.get("https://example.test/")


async def test_the_deadline_is_an_httpx_timeout():
    # Connectors already handle httpx timeouts; this must reach the same code.
    assert issubclass(RequestDeadlineExceeded, httpx.TimeoutException)


async def test_a_response_inside_the_deadline_is_returned_whole():
    async with _client(_DripStream(interval=0.01, count=5), deadline=2.0) as client:
        response = await client.get("https://example.test/")
    assert response.content == b"xxxxx"


async def test_the_factory_returns_a_deadline_client_with_the_default():
    client = create_integration_client()
    try:
        assert isinstance(client, _DeadlineAsyncClient)
        assert client._deadline == INTEGRATION_DEADLINE_SECONDS
    finally:
        await client.aclose()


async def test_the_factory_keeps_a_per_call_deadline():
    client = base_module.create_integration_client(deadline=5.0)
    try:
        assert client._deadline == 5.0
    finally:
        await client.aclose()
