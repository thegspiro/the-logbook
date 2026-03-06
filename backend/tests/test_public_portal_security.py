"""
Unit tests for public portal security rate limiting and cache cleanup.

Covers:
  - Per-key stale timestamp pruning in check_rate_limit
  - Per-IP stale timestamp pruning in check_ip_rate_limit
  - cleanup_rate_limit_cache forced eviction when over max keys
"""

import sys
import pytest
from collections import defaultdict
from datetime import datetime, timezone
from types import ModuleType
from unittest.mock import MagicMock

# Stub out heavy transitive imports that are not available in the test
# environment (bcrypt → cryptography → _cffi_backend).  We only need the
# rate-limit cache data structures and helpers, not the actual crypto.
_stubs: dict[str, ModuleType] = {}
for _mod_name in ("bcrypt",):
    if _mod_name not in sys.modules:
        stub = ModuleType(_mod_name)
        stub.__dict__.setdefault("gensalt", lambda: b"$2b$12$fakesalt")
        stub.__dict__.setdefault("hashpw", lambda pw, salt: b"$2b$12$fakehash")
        stub.__dict__.setdefault("checkpw", lambda pw, h: True)
        sys.modules[_mod_name] = stub
        _stubs[_mod_name] = stub

# Also stub transitive DB/model imports that the module pulls in
for _mod_name in (
    "aiomysql",
    "redis",
    "redis.asyncio",
    "app.models.public_portal",
):
    if _mod_name not in sys.modules:
        stub = MagicMock()
        sys.modules[_mod_name] = stub
        _stubs[_mod_name] = stub

from app.core.public_portal_security import (
    check_ip_rate_limit,
    cleanup_rate_limit_cache,
    ip_rate_limit_cache,
    rate_limit_cache,
    _MAX_RATE_LIMIT_KEYS,
    _MAX_IP_RATE_LIMIT_KEYS,
)


@pytest.fixture(autouse=True)
def clear_caches():
    """Clear global caches before and after each test."""
    rate_limit_cache.clear()
    ip_rate_limit_cache.clear()
    yield
    rate_limit_cache.clear()
    ip_rate_limit_cache.clear()


# ---------------------------------------------------------------------------
# cleanup_rate_limit_cache
# ---------------------------------------------------------------------------


class TestCleanupRateLimitCache:

    @pytest.mark.unit
    def test_removes_old_hour_timestamps(self):
        """Stale hour-buckets older than 1 hour should be removed."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())
        old_ts = current_ts - 7200  # 2 hours ago

        rate_limit_cache["key-1"][old_ts] = 50
        rate_limit_cache["key-1"][current_ts] = 10

        cleanup_rate_limit_cache()

        assert old_ts not in rate_limit_cache["key-1"]
        assert current_ts in rate_limit_cache["key-1"]

    @pytest.mark.unit
    def test_removes_empty_api_key_entries(self):
        """API key entries with no remaining timestamps should be removed."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())
        old_ts = current_ts - 7200

        rate_limit_cache["empty-key"][old_ts] = 5

        cleanup_rate_limit_cache()

        assert "empty-key" not in rate_limit_cache

    @pytest.mark.unit
    def test_removes_old_minute_timestamps(self):
        """Stale minute-buckets older than 2 minutes should be removed."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())
        old_ts = current_ts - 300  # 5 minutes ago

        ip_rate_limit_cache["1.2.3.4"][old_ts] = 20
        ip_rate_limit_cache["1.2.3.4"][current_ts] = 5

        cleanup_rate_limit_cache()

        assert old_ts not in ip_rate_limit_cache["1.2.3.4"]
        assert current_ts in ip_rate_limit_cache["1.2.3.4"]

    @pytest.mark.unit
    def test_force_evicts_api_keys_over_limit(self):
        """When rate_limit_cache exceeds _MAX_RATE_LIMIT_KEYS, oldest keys
        should be force-evicted."""
        now = datetime.now(timezone.utc)
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        current_ts = int(current_hour.timestamp())

        # Insert more keys than the limit
        num_keys = _MAX_RATE_LIMIT_KEYS + 100
        for i in range(num_keys):
            # Stagger timestamps so oldest are identifiable
            rate_limit_cache[f"key-{i}"][current_ts - i] = 1

        cleanup_rate_limit_cache()

        assert len(rate_limit_cache) <= _MAX_RATE_LIMIT_KEYS

    @pytest.mark.unit
    def test_force_evicts_ips_over_limit(self):
        """When ip_rate_limit_cache exceeds _MAX_IP_RATE_LIMIT_KEYS, oldest
        IPs should be force-evicted."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())

        num_keys = _MAX_IP_RATE_LIMIT_KEYS + 50
        for i in range(num_keys):
            ip_rate_limit_cache[f"10.0.{i // 256}.{i % 256}"][current_ts - (i % 60)] = 1

        cleanup_rate_limit_cache()

        assert len(ip_rate_limit_cache) <= _MAX_IP_RATE_LIMIT_KEYS


# ---------------------------------------------------------------------------
# check_ip_rate_limit (per-IP stale timestamp pruning)
# ---------------------------------------------------------------------------


class TestCheckIpRateLimit:

    @pytest.mark.unit
    async def test_prunes_stale_minute_buckets(self):
        """Old minute-buckets should be pruned when checking IP rate limit."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())
        old_ts = current_ts - 300  # 5 minutes ago

        ip_rate_limit_cache["5.6.7.8"][old_ts] = 99

        is_allowed, count, limit = await check_ip_rate_limit("5.6.7.8", limit=100)

        assert is_allowed is True
        # Old bucket should be gone
        assert old_ts not in ip_rate_limit_cache["5.6.7.8"]

    @pytest.mark.unit
    async def test_allows_requests_under_limit(self):
        """Requests under the limit should be allowed."""
        is_allowed, count, limit = await check_ip_rate_limit("9.9.9.9", limit=100)
        assert is_allowed is True

    @pytest.mark.unit
    async def test_blocks_requests_over_limit(self):
        """Requests over the limit should be blocked."""
        now = datetime.now(timezone.utc)
        current_minute = now.replace(second=0, microsecond=0)
        current_ts = int(current_minute.timestamp())

        ip_rate_limit_cache["9.9.9.9"][current_ts] = 100

        is_allowed, count, limit = await check_ip_rate_limit("9.9.9.9", limit=100)
        assert is_allowed is False
