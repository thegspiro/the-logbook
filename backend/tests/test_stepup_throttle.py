"""``POST /auth/step-up`` is rate-limited per account, and never locks it.

AUTH-23 (security review AUTH-01 pass 12), decided by the owner on 2026-11-01:
someone holding a member's live session but not their password or second
factor could guess against step-up at the shared per-address sign-in rate
indefinitely. Failures are now counted per *account* over a longer window and
refused with a 429 once over the limit. They are deliberately kept off
``failed_login_attempts`` / ``locked_until``: feeding those would let the same
session thief lock the real owner out of signing in by failing on purpose.
"""

import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.auth_service import AuthService

pytestmark = pytest.mark.real_stepup


class _FakeRedis:
    """The counter commands the step-up throttle uses."""

    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key):
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def expire(self, key, seconds):
        self.ttls[key] = seconds
        return True

    async def ttl(self, key):
        if key not in self.values:
            return -2
        return self.ttls.get(key, -1)

    async def delete(self, key):
        self.values.pop(key, None)
        self.ttls.pop(key, None)
        return 1


@pytest.fixture
def _no_redis(monkeypatch):
    from app.core import stepup_throttle
    from app.core.cache import cache_manager

    monkeypatch.setattr(cache_manager, "_connected", False)
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(
        stepup_throttle, "_memory_counter", stepup_throttle._InMemoryStepUpCounter()
    )


@pytest.fixture
def fake_redis(monkeypatch, _no_redis):
    from app.core.cache import cache_manager

    redis = _FakeRedis()
    monkeypatch.setattr(cache_manager, "redis_client", redis)
    monkeypatch.setattr(cache_manager, "_connected", True)
    return redis


def _user(user_id=None, mfa=True):
    return SimpleNamespace(
        id=user_id or str(uuid.uuid4()),
        username="chief",
        mfa_enabled=mfa,
        password_hash="hash",
        failed_login_attempts=0,
        locked_until=None,
    )


def _request():
    return SimpleNamespace(
        headers={"authorization": "Bearer tok"},
        client=SimpleNamespace(host="203.0.113.9"),
        state=SimpleNamespace(),
    )


async def _step_up(user, code_ok: bool, db=None):
    """One step-up with an authenticator code; returns the status code."""
    from app.api.v1.endpoints import auth as auth_endpoints
    from app.schemas.auth import StepUpRequest
    from app.services import passkey_service

    session = SimpleNamespace(id="s-1", user_id=user.id, stepup_verified_at=None)
    if db is None:
        db = MagicMock()
        db.commit = AsyncMock()
    with (
        patch.object(
            AuthService, "get_session_for_token", AsyncMock(return_value=session)
        ),
        patch.object(auth_endpoints, "log_audit_event", AsyncMock()),
        patch.object(passkey_service, "has_passkey", AsyncMock(return_value=False)),
        patch.object(passkey_service, "relying_party", return_value=None),
        patch.object(
            auth_endpoints,
            "_verify_and_consume_totp",
            AsyncMock(return_value=code_ok),
        ),
    ):
        try:
            await auth_endpoints.step_up(
                StepUpRequest(code="123456"), _request(), user, None, db
            )
        except HTTPException as exc:
            return exc.status_code, exc
    return 200, None


async def _fail(user, times: int, db=None) -> list[int]:
    return [(await _step_up(user, False, db))[0] for _ in range(times)]


def _limit() -> int:
    return settings.STEPUP_MAX_FAILED_ATTEMPTS


@pytest.mark.unit
@pytest.mark.usefixtures("_no_redis")
class TestInMemory:
    async def test_failures_over_the_limit_are_refused_with_429(self):
        user = _user()
        codes = await _fail(user, _limit() + 1)
        assert codes == [400] * _limit() + [429]

    async def test_the_refusal_carries_retry_after(self):
        user = _user()
        await _fail(user, _limit())
        status, exc = await _step_up(user, False)
        assert status == 429
        retry = int(exc.headers["Retry-After"])
        assert 0 < retry <= settings.STEPUP_FAILURE_WINDOW_MINUTES * 60

    async def test_the_account_lockout_columns_are_never_touched(self):
        user = _user()
        await _fail(user, _limit() + 3)
        assert user.failed_login_attempts == 0
        assert user.locked_until is None

    async def test_even_a_correct_code_is_refused_while_over_the_limit(self):
        user = _user()
        await _fail(user, _limit())
        assert (await _step_up(user, True))[0] == 429

    async def test_a_success_resets_the_count(self):
        user = _user()
        assert await _fail(user, _limit() - 1) == [400] * (_limit() - 1)
        assert (await _step_up(user, True))[0] == 200
        assert await _fail(user, _limit()) == [400] * _limit()

    async def test_another_member_is_unaffected(self):
        await _fail(_user(), _limit() + 1)
        assert (await _step_up(_user(), True))[0] == 200

    async def test_the_window_ends(self):
        user = _user()
        await _fail(user, _limit() + 1)
        later = time.time() + settings.STEPUP_FAILURE_WINDOW_MINUTES * 60 + 1
        with patch("app.core.stepup_throttle.time.time", return_value=later):
            assert (await _step_up(user, True))[0] == 200

    def test_the_counter_is_bounded(self):
        from app.core.stepup_throttle import _InMemoryStepUpCounter

        counter = _InMemoryStepUpCounter()
        counter._MAX_KEYS = 50
        for i in range(500):
            counter.reserve(f"user-{i}", max_attempts=5, window_seconds=900)
        assert len(counter._entries) <= 50


@pytest.mark.unit
class TestWithRedis:
    async def test_failures_over_the_limit_are_refused_with_429(self, fake_redis):
        user = _user()
        codes = await _fail(user, _limit() + 1)
        assert codes == [400] * _limit() + [429]
        assert any(user.id in key for key in fake_redis.values)

    async def test_the_counter_expires_with_the_window(self, fake_redis):
        user = _user()
        await _fail(user, 1)
        (key,) = fake_redis.values
        assert fake_redis.ttls[key] == settings.STEPUP_FAILURE_WINDOW_MINUTES * 60

    async def test_a_success_clears_the_counter(self, fake_redis):
        user = _user()
        await _fail(user, _limit() - 1)
        assert (await _step_up(user, True))[0] == 200
        assert fake_redis.values == {}

    async def test_a_redis_error_falls_back_to_the_in_memory_counter(
        self, fake_redis, monkeypatch
    ):
        async def broken(_key):
            raise TimeoutError("redis timed out")

        monkeypatch.setattr(fake_redis, "incr", broken)
        user = _user()
        codes = await _fail(user, _limit() + 1)
        assert codes[-1] == 429


@pytest.mark.unit
def test_the_defaults():
    from app.core.config import Settings

    fields = Settings.model_fields
    assert fields["STEPUP_MAX_FAILED_ATTEMPTS"].default == 5
    assert fields["STEPUP_FAILURE_WINDOW_MINUTES"].default == 15


@pytest.mark.integration
@pytest.mark.usefixtures("_no_redis")
async def test_a_real_members_lockout_columns_survive_failed_step_ups(db_session):
    """Against a stored member: failing step-up past the limit leaves the
    columns sign-in is measured against exactly as they were."""
    from sqlalchemy import select

    from app.models.user import Organization, User

    org = Organization(
        id=str(uuid.uuid4()),
        name="Step-up Throttle Department",
        slug=f"stepup-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"su-{uuid.uuid4().hex[:8]}",
        email=f"su-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Step",
        last_name="Up",
        password_hash="hashed",
        status="active",
        mfa_enabled=True,
    )
    db_session.add(user)
    await db_session.flush()

    user_id = user.id
    codes = await _fail(user, _limit() + 2, db=db_session)
    assert codes[-2:] == [429, 429]

    db_session.expire_all()
    stored = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalar_one()
    assert (stored.failed_login_attempts or 0) == 0
    assert stored.locked_until is None
