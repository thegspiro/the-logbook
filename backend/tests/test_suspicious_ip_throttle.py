"""
Tests for cross-account per-IP auth throttling (app/core/suspicious_ip.py).

The control this covers is specifically the credential-stuffing spray that the
two pre-existing brute-force controls miss: one IP trying a couple of passwords
each against many different accounts stays under the 5/min per-IP rate limit and
never reaches MAX_LOGIN_ATTEMPTS on any single account.
"""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.core.suspicious_ip import (
    _memory_tracker,
    clear_auth_failures,
    enforce_suspicious_ip,
    get_block_remaining,
    record_auth_failure,
)


@pytest.fixture(autouse=True)
def _isolated_tracker(monkeypatch):
    """Force the in-memory path and start every test from a clean tracker."""
    monkeypatch.setattr("app.core.suspicious_ip._redis", lambda: None)
    monkeypatch.setattr(
        "app.core.suspicious_ip.settings.SUSPICIOUS_IP_THROTTLE_ENABLED", True
    )
    monkeypatch.setattr("app.core.suspicious_ip.settings.SUSPICIOUS_IP_MAX_FAILURES", 5)
    monkeypatch.setattr(
        "app.core.suspicious_ip.settings.SUSPICIOUS_IP_WINDOW_SECONDS", 3600
    )
    monkeypatch.setattr(
        "app.core.suspicious_ip.settings.SUSPICIOUS_IP_BLOCK_SECONDS", 900
    )
    _memory_tracker.failures.clear()
    _memory_tracker.blocks.clear()
    _memory_tracker._last_eviction = 0.0
    yield
    _memory_tracker.failures.clear()
    _memory_tracker.blocks.clear()


def _request(ip: str) -> MagicMock:
    request = MagicMock()
    request.client.host = ip
    request.headers = {}
    return request


@pytest.mark.unit
async def test_ip_is_blocked_after_threshold_failures():
    ip = "198.51.100.10"
    triggered = [await record_auth_failure(ip) for _ in range(5)]

    # Only the failure that crosses the threshold reports True.
    assert triggered == [False, False, False, False, True]
    assert await get_block_remaining(ip) > 0


@pytest.mark.unit
async def test_below_threshold_is_not_blocked():
    ip = "198.51.100.11"
    for _ in range(4):
        await record_auth_failure(ip)

    assert await get_block_remaining(ip) == 0
    await enforce_suspicious_ip(_request(ip))  # must not raise


@pytest.mark.unit
async def test_enforce_raises_429_with_retry_after():
    ip = "198.51.100.12"
    for _ in range(5):
        await record_auth_failure(ip)

    with pytest.raises(HTTPException) as exc_info:
        await enforce_suspicious_ip(_request(ip))

    assert exc_info.value.status_code == 429
    assert int(exc_info.value.headers["Retry-After"]) > 0
    # The message must not confirm whether any particular account exists.
    assert "account" not in exc_info.value.detail.lower()


@pytest.mark.unit
async def test_failures_accrue_across_different_accounts():
    """The spray case: the counter is keyed on IP only, never on username."""
    ip = "198.51.100.13"
    for _username in ("alice", "bob", "carol", "dave", "erin"):
        await record_auth_failure(ip)

    with pytest.raises(HTTPException):
        await enforce_suspicious_ip(_request(ip))


@pytest.mark.unit
async def test_success_clears_the_counter():
    ip = "198.51.100.14"
    for _ in range(4):
        await record_auth_failure(ip)
    await clear_auth_failures(ip)

    # Having been reset, four more failures must still not reach the threshold.
    for _ in range(4):
        await record_auth_failure(ip)
    assert await get_block_remaining(ip) == 0


@pytest.mark.unit
async def test_clear_does_not_lift_an_active_block():
    """An attacker holding one valid credential must not unblock themselves."""
    ip = "198.51.100.15"
    for _ in range(5):
        await record_auth_failure(ip)
    await clear_auth_failures(ip)

    assert await get_block_remaining(ip) > 0
    with pytest.raises(HTTPException):
        await enforce_suspicious_ip(_request(ip))


@pytest.mark.unit
async def test_block_is_per_ip_not_global():
    """One blocked IP must not deny service to every other client."""
    attacker, innocent = "198.51.100.16", "198.51.100.17"
    for _ in range(5):
        await record_auth_failure(attacker)

    with pytest.raises(HTTPException):
        await enforce_suspicious_ip(_request(attacker))
    await enforce_suspicious_ip(_request(innocent))  # must not raise


@pytest.mark.unit
async def test_disabled_setting_is_a_no_op(monkeypatch):
    monkeypatch.setattr(
        "app.core.suspicious_ip.settings.SUSPICIOUS_IP_THROTTLE_ENABLED", False
    )
    ip = "198.51.100.18"
    for _ in range(10):
        await record_auth_failure(ip)

    assert await get_block_remaining(ip) == 0
    await enforce_suspicious_ip(_request(ip))  # must not raise


@pytest.mark.unit
async def test_memory_tracker_is_bounded(monkeypatch):
    """Pitfall #9: attacker-controlled keys must not grow the dict unbounded."""
    monkeypatch.setattr(_memory_tracker, "_MAX_KEYS", 50)
    for i in range(500):
        await record_auth_failure(f"203.0.113.{i}")

    # Eviction is periodic, so allow the interval's worth of slack rather than
    # asserting an exact cap.
    assert len(_memory_tracker.failures) <= 500
    _memory_tracker._last_eviction = 0.0
    await record_auth_failure("203.0.113.254")
    assert len(_memory_tracker.failures) <= 51


@pytest.mark.unit
async def test_redis_error_still_counts_the_failure(monkeypatch):
    """A Redis outage must not mean attempts go uncounted (the CI-11 lesson)."""

    class FailingPipeline:
        def __getattr__(self, _name):
            return lambda *args, **kwargs: self

        async def execute(self):
            raise TimeoutError("Redis command timed out")

    class FailingRedis:
        def pipeline(self):
            return FailingPipeline()

        async def ttl(self, _key):
            raise TimeoutError("Redis command timed out")

    monkeypatch.setattr("app.core.suspicious_ip._redis", lambda: FailingRedis())

    ip = "198.51.100.19"
    for _ in range(5):
        await record_auth_failure(ip)

    assert await get_block_remaining(ip) > 0
