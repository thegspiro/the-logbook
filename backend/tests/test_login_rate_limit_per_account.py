"""Sign-in limits are counted per account at an address, not per address.

Owner decision of 2026-11-01 ("Sign-in From a Shared Station Address" in
docs/KNOWN_LIMITATIONS.md): a station's members share one public address, so
the 5-a-minute sign-in limit counted per address turned the sixth member at
shift change away, and on the in-memory fallback locked everyone behind that
address out for half an hour. The limit is now counted per (address, account),
with a looser per-address backstop so one address still cannot spray accounts
without bound. Account lockout and the suspicious-IP throttle, which cover the
cross-account case, are untouched.

These drive the real ``/auth/login`` and ``/auth/mfa/login`` routes over ASGI,
with credential checking stubbed to "wrong password", so what is measured is
the limiter as FastAPI runs it.
"""

import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import security_middleware
from app.core.security import create_mfa_pending_token
from app.core.security_middleware import RateLimiter

pytestmark = pytest.mark.unit


class _FakePipeline:
    def __init__(self, redis: "_FakeRedis") -> None:
        self._redis = redis
        self._ops: list[tuple] = []

    def zremrangebyscore(self, key, low, high):
        self._ops.append(("zrem", key, low, high))
        return self

    def zcard(self, key):
        self._ops.append(("zcard", key))
        return self

    def zadd(self, key, mapping):
        self._ops.append(("zadd", key, mapping))
        return self

    def expire(self, key, seconds):
        self._ops.append(("expire", key, seconds))
        return self

    async def execute(self):
        results = []
        for op in self._ops:
            zset = self._redis.zsets.setdefault(op[1], [])
            if op[0] == "zrem":
                zset[:] = [s for s in zset if not (op[2] <= s <= op[3])]
                results.append(None)
            elif op[0] == "zcard":
                results.append(len(zset))
            elif op[0] == "zadd":
                zset.extend(op[2].values())
                results.append(1)
            else:
                results.append(True)
        return results


class _FakeRedis:
    """Just enough of redis-py's asyncio client for the sliding-window limiter."""

    def __init__(self) -> None:
        self.zsets: dict[str, list[float]] = {}

    def pipeline(self):
        return _FakePipeline(self)


@pytest.fixture
def limiter_state(monkeypatch):
    """A fresh in-memory limiter, Redis disconnected, and the suspicious-IP
    throttle out of the way (it is a separate control with its own tests)."""
    from app.core.cache import cache_manager

    fresh = RateLimiter()
    monkeypatch.setattr(security_middleware, "rate_limiter", fresh)
    monkeypatch.setattr(cache_manager, "_connected", False)
    monkeypatch.setattr(security_middleware.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(
        security_middleware.settings, "SUSPICIOUS_IP_THROTTLE_ENABLED", False
    )
    return fresh


@pytest.fixture
def fake_redis(monkeypatch, limiter_state):
    from app.core.cache import cache_manager

    redis = _FakeRedis()
    monkeypatch.setattr(cache_manager, "redis_client", redis)
    monkeypatch.setattr(cache_manager, "_connected", True)
    return redis


def _client(ip: str):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.endpoints.auth import router
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(router, prefix="/auth")
    db = MagicMock()
    db.commit = AsyncMock()
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(
            app=app, raise_app_exceptions=False, client=(ip, 40000)
        ),
        base_url="http://test",
    )


def _wrong_password():
    """Every credential check fails the way a mistyped password does."""
    from app.api.v1.endpoints import auth as auth_endpoints
    from app.services.auth_service import AuthService

    return (
        patch.object(
            AuthService,
            "authenticate_user",
            AsyncMock(return_value=(None, "Incorrect username or password")),
        ),
        patch.object(auth_endpoints, "record_auth_failure", AsyncMock()),
        patch.object(auth_endpoints, "_audit_refused_sign_in", AsyncMock()),
        patch.object(
            auth_endpoints.security_monitor,
            "detect_brute_force",
            AsyncMock(return_value=None),
        ),
        patch.object(auth_endpoints, "_pending_mfa_user", AsyncMock(return_value=None)),
    )


def _address() -> str:
    # A fresh documentation-range address per test, so no test inherits
    # another's history even on a shared limiter.
    n = uuid.uuid4().int
    return f"198.51.{n % 250}.{(n >> 8) % 250 + 1}"


async def _sign_in(client, username: str) -> int:
    response = await client.post(
        "/auth/login", json={"username": username, "password": "not-the-password"}
    )
    return response.status_code


async def _attempts(ip: str, usernames: list[str]) -> list[int]:
    p1, p2, p3, p4, p5 = _wrong_password()
    with p1, p2, p3, p4, p5:
        async with _client(ip) as client:
            return [await _sign_in(client, name) for name in usernames]


class TestInMemoryFallback:
    async def test_a_sixth_member_at_the_same_address_is_not_refused(
        self, limiter_state
    ):
        codes = await _attempts(_address(), ["alice"] * 5 + ["bob"])
        assert codes == [401] * 6

    async def test_six_members_signing_in_once_each_are_all_answered(
        self, limiter_state
    ):
        names = [f"member{i}" for i in range(8)]
        assert await _attempts(_address(), names) == [401] * 8

    async def test_the_same_account_is_refused_on_its_sixth_attempt(
        self, limiter_state
    ):
        codes = await _attempts(_address(), ["alice"] * 6)
        assert codes == [401] * 5 + [429]

    async def test_the_account_is_matched_however_it_is_typed(self, limiter_state):
        names = ["alice", "Alice", " ALICE", "alice ", "aLiCe", "alice"]
        codes = await _attempts(_address(), names)
        assert codes[-1] == 429

    async def test_the_lockout_does_not_lock_the_address_for_other_accounts(
        self, limiter_state
    ):
        ip = _address()
        assert (await _attempts(ip, ["alice"] * 6))[-1] == 429

        # Past the minute: alice is still inside her 30-minute fallback
        # lockout, and nobody else at the address is.
        later = time.time() + 120
        with patch("app.core.security_middleware.time.time", return_value=later):
            codes = await _attempts(ip, ["alice", "bob", "carol"])
        assert codes == [429, 401, 401]

    async def test_the_address_backstop_still_refuses(self, limiter_state):
        cap = security_middleware.LOGIN_ADDRESS_MAX_ATTEMPTS
        names = [f"spray{i}" for i in range(cap + 1)]
        codes = await _attempts(_address(), names)
        assert codes[:cap] == [401] * cap
        assert codes[cap] == 429

    async def test_the_backstop_does_not_lock_the_address_for_half_an_hour(
        self, limiter_state
    ):
        ip = _address()
        cap = security_middleware.LOGIN_ADDRESS_MAX_ATTEMPTS
        assert (await _attempts(ip, [f"s{i}" for i in range(cap + 1)]))[-1] == 429

        later = time.time() + security_middleware.LOGIN_ADDRESS_WINDOW_SECONDS + 5
        with patch("app.core.security_middleware.time.time", return_value=later):
            assert await _attempts(ip, ["dave"]) == [401]

    async def test_another_address_is_unaffected(self, limiter_state):
        assert (await _attempts(_address(), ["alice"] * 6))[-1] == 429
        assert await _attempts(_address(), ["alice"]) == [401]


class TestWithRedis:
    async def test_a_sixth_member_at_the_same_address_is_not_refused(self, fake_redis):
        codes = await _attempts(_address(), ["alice"] * 5 + ["bob"])
        assert codes == [401] * 6

    async def test_the_same_account_is_refused_on_its_sixth_attempt(self, fake_redis):
        codes = await _attempts(_address(), ["alice"] * 6)
        assert codes == [401] * 5 + [429]

    async def test_the_address_backstop_still_refuses(self, fake_redis):
        cap = security_middleware.LOGIN_ADDRESS_MAX_ATTEMPTS
        codes = await _attempts(_address(), [f"spray{i}" for i in range(cap + 1)])
        assert codes[cap] == 429

    async def test_no_username_reaches_a_redis_key(self, fake_redis):
        await _attempts(_address(), ["alice.member@example.org"])
        assert fake_redis.zsets
        assert not any("alice" in key for key in fake_redis.zsets)


class TestSecondFactorStep:
    """``/mfa/login`` carries no username; the pending-MFA token names the
    member, so that is the account it is counted against."""

    async def _mfa(self, ip: str, tokens: list[str]) -> list[int]:
        p1, p2, p3, p4, p5 = _wrong_password()
        with p1, p2, p3, p4, p5:
            async with _client(ip) as client:
                return [
                    (
                        await client.post(
                            "/auth/mfa/login",
                            json={"temp_token": token, "code": "000000"},
                        )
                    ).status_code
                    for token in tokens
                ]

    async def test_one_members_guesses_do_not_spend_anothers_allowance(
        self, limiter_state
    ):
        alice = create_mfa_pending_token(str(uuid.uuid4()))
        bob = create_mfa_pending_token(str(uuid.uuid4()))
        codes = await self._mfa(_address(), [alice] * 6 + [bob])
        assert codes == [401] * 5 + [429, 401]

    async def test_unreadable_tokens_share_one_allowance_per_address(
        self, limiter_state
    ):
        codes = await self._mfa(_address(), [f"forged-{i}" for i in range(6)])
        assert codes == [401] * 5 + [429]
