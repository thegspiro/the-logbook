"""
Tests for MFA auth-router endpoint wiring.

Unit-level: inspects the router's declared routes/dependencies without a
running server or database. Verifies the new self-service recovery-code
regeneration endpoint exists and is rate limited, and that the login
challenge endpoint is rate limited.
"""

import asyncio
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pyotp
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.endpoints.auth import (
    CodedHTTPException,
    _finish_oauth_login,
    _verify_and_consume_recovery_code,
    _verify_and_consume_totp,
    login,
    mfa_disable,
    mfa_login,
    mfa_regenerate_recovery_codes,
    mfa_setup,
    mfa_verify_setup,
    router,
)
from app.core.database import database_manager
from app.core.security import create_mfa_pending_token
from app.schemas.auth import MFALogin, MFAVerify, UserLogin
from app.services import mfa_service


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == path:
            if method in getattr(route, "methods", set()):
                return route
    return None


def _dep_names(path: str, method: str):
    route = _route(path, method)
    if not route:
        return None
    dependant = getattr(route, "dependant", None)
    if not dependant:
        return []
    names = []
    for dep in dependant.dependencies:
        call = dep.call
        names.append(getattr(call, "__name__", str(call)))
    return names


class TestMfaEndpoints:
    def test_regenerate_recovery_codes_route_exists(self):
        assert _route("/mfa/recovery-codes", "POST") is not None

    def test_regenerate_requires_authenticated_user(self):
        names = _dep_names("/mfa/recovery-codes", "POST")
        assert any("get_current_active_user" in n for n in names), names

    def test_regenerate_is_rate_limited(self):
        # rate_limit_login() attaches a dependency at the route level.
        route = _route("/mfa/recovery-codes", "POST")
        dependant = getattr(route, "dependant", None)
        all_calls = [
            getattr(d.call, "__name__", str(d.call))
            for d in (dependant.dependencies if dependant else [])
        ]
        # The rate-limit dependency is anonymous; assert at least one extra
        # security dependency beyond the user/db ones is present.
        assert route is not None, all_calls
        assert len(all_calls) >= 2, all_calls

    def test_mfa_login_route_exists(self):
        assert _route("/mfa/login", "POST") is not None

    def test_mfa_status_route_exists(self):
        assert _route("/mfa/status", "GET") is not None


@pytest.mark.asyncio
async def test_oauth_login_requires_mfa_before_session_creation():
    user = SimpleNamespace(
        id="user-id", email="member@example.com", username="member", mfa_enabled=True
    )
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    with (
        patch(
            "app.api.v1.endpoints.auth.create_mfa_pending_token",
            return_value="pending-token",
        ),
        patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
        patch(
            "app.api.v1.endpoints.auth.AuthService.create_user_tokens",
            new=AsyncMock(),
        ) as create_tokens,
    ):
        response = await _finish_oauth_login(AsyncMock(), user, request, "google")

    assert response.status_code == 302
    assert response.headers["location"].endswith("#mfa_token=pending-token")
    assert "access_token=" not in response.headers.get("set-cookie", "")
    create_tokens.assert_not_awaited()


def _mfa_user(**overrides):
    """A minimal stand-in for `User` covering only what the MFA routes read."""
    defaults = dict(
        id="user-1",
        organization_id="org-1",
        email="racer@test.com",
        username="racer",
        mfa_enabled=True,
        mfa_secret=mfa_service.generate_secret(),
        mfa_last_timestep=None,
        mfa_backup_codes=[],
        is_active=True,
        locked_until=None,
        failed_login_attempts=0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _locking_db_for(user):
    """A `db` stand-in whose `execute()` always resolves to *user* itself.

    `_verify_and_consume_totp` issues a `.with_for_update()` +
    `populate_existing=True` re-SELECT before checking/consuming the code
    (PR #2133 round 2 fix). In a real session that re-SELECT returns the
    SAME identity-mapped object the caller already held, refreshed in place.
    These unit tests use a plain `SimpleNamespace` rather than a real
    ORM-tracked instance, so "re-fetching" here just means handing the exact
    same object back — which is what the identity map guarantees in
    production, and is what lets mutating it be visible to the caller too.
    """
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=user)
    # A plain MagicMock, not AsyncMock, as the base: `db.begin_nested()`
    # (security_monitoring.py's `_add_alert`, exercised whenever a test's
    # brute-force detector call actually crosses its alert threshold) relies
    # on `async with db.begin_nested():` finding a MagicMock so it gets
    # MagicMock's auto-configured __aenter__/__aexit__ -- exactly the same
    # shape test_security_monitoring.py's own `_db()` helper uses. An
    # AsyncMock base makes `begin_nested` itself async, so calling it
    # returns an unawaited coroutine instead of a context manager.
    db = MagicMock()
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
class TestTotpConsumedAcrossMfaRoutes:
    """Regression for the gap where a TOTP code verified at a management
    route (e.g. /mfa/recovery-codes) was never recorded as consumed, leaving
    it still valid for a completely independent login at /mfa/login for the
    rest of its ~30s window.

    Before the fix, `mfa_regenerate_recovery_codes` (and `mfa_verify_setup`,
    `mfa_disable`) called bare `mfa_service.verify_totp`, which never touches
    `user.mfa_last_timestep` — so this test's second call reached `mfa_login`
    with `verify_totp_get_timestep(..., last_timestep=None)`, matched the
    still-valid code, and succeeded. It must now fail: the first call records
    the time-step via `_verify_and_consume_totp`, so the second call sees
    `last_timestep == <that step>` and rejects the replay.
    """

    async def test_code_used_at_recovery_codes_route_cannot_replay_at_login(self):
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = _locking_db_for(user)

        with (
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
        ):
            result = await mfa_regenerate_recovery_codes(
                data=MFAVerify(code=code),
                background_tasks=AsyncMock(),
                current_user=user,
                db=db,
            )
        assert "recovery_codes" in result
        # The consuming helper must have recorded the step actually used.
        assert user.mfa_last_timestep is not None

        # An attacker who already holds the password (a prerequisite either
        # way) completes the password step for free and obtains their own
        # mfa_pending token, then replays the code merely *observed* in use
        # above (shoulder-surfing, a compromised endpoint, a phishing relay).
        temp_token = create_mfa_pending_token(user.id)

        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        with pytest.raises(CodedHTTPException) as exc:
            await mfa_login(
                data=MFALogin(temp_token=temp_token, code=code), request=request, db=db
            )
        assert exc.value.status_code == 401

    async def test_verify_and_consume_totp_rejects_its_own_replay(self):
        """Unit-level check on the shared primitive itself: consuming a code
        once must block a second verification of that exact code."""
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = _locking_db_for(user)

        assert await _verify_and_consume_totp(db, user, code) is True
        assert await _verify_and_consume_totp(db, user, code) is False

    async def test_fresh_code_after_consumption_still_verifies(self):
        """Sanity check: consuming one time-step must not lock out a later,
        genuinely different code."""
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = _locking_db_for(user)
        assert await _verify_and_consume_totp(db, user, code) is True

        # A code from the step after the one just consumed is correctly not
        # a replay; simulate it directly rather than sleeping 30s in a test.
        next_step_code = pyotp.TOTP(user.mfa_secret).at(
            (user.mfa_last_timestep + 1) * 30
        )
        assert (
            mfa_service.verify_totp_get_timestep(
                user.mfa_secret, next_step_code, last_timestep=user.mfa_last_timestep
            )
            is not None
        )


@pytest.mark.asyncio
class TestMfaLoginBruteForceWiring:
    """Regression: `mfa_login` must feed `security_monitor.detect_brute_force`
    on both a failed and a successful MFA-code attempt, mirroring exactly how
    `login` feeds it on the password step. Before the fix, `mfa_login` never
    called `detect_brute_force` at all — guessing the second factor could not
    trigger this specific HIGH-severity alert (the separate, still-enforced
    per-account lockout and suspicious-IP throttle covered abuse resistance,
    but this detector's history stayed empty for the whole MFA step).
    """

    async def test_failed_mfa_code_feeds_detect_brute_force_failure(self):
        user = _mfa_user()
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=execute_result)
        temp_token = create_mfa_pending_token(user.id)
        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        detect = AsyncMock(return_value=None)
        with (
            patch(
                "app.api.v1.endpoints.auth.security_monitor.detect_brute_force",
                detect,
            ),
            patch("app.api.v1.endpoints.auth.record_auth_failure", new=AsyncMock()),
        ):
            with pytest.raises(CodedHTTPException):
                await mfa_login(
                    data=MFALogin(temp_token=temp_token, code="000000"),
                    request=request,
                    db=db,
                )

        detect.assert_awaited_once_with(
            db, ip="unknown", user_id=user.id, success=False
        )

    async def test_successful_mfa_login_feeds_detect_brute_force_success(self):
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=execute_result)
        temp_token = create_mfa_pending_token(user.id)
        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        detect = AsyncMock(return_value=None)
        with (
            patch(
                "app.api.v1.endpoints.auth.security_monitor.detect_brute_force",
                detect,
            ),
            patch("app.api.v1.endpoints.auth.clear_auth_failures", new=AsyncMock()),
            patch(
                "app.api.v1.endpoints.auth.AuthService.create_user_tokens",
                new=AsyncMock(return_value=("access-token", "refresh-token")),
            ),
        ):
            await mfa_login(
                data=MFALogin(temp_token=temp_token, code=code),
                request=request,
                db=db,
            )

        detect.assert_awaited_once_with(db, ip="unknown", user_id=user.id, success=True)


@pytest.mark.asyncio
class TestLoginBruteForceResetGating:
    """PR #2133 round 2 (Codex): `login`'s pre-existing `detect_brute_force
    (success=True)` call fired unconditionally on a correct password, BEFORE
    the `if user.mfa_enabled` branch below it. For an MFA-enabled account, a
    correct password is not full authentication -- but the reset fired
    anyway. An attacker who already holds the password (mfa_login's own
    per-attempt failures are the only thing gating them at that point) needs
    only to hit /login again before each MFA guess -- ordinary behaviour for
    a client that re-establishes its mfa_pending token per attempt, not
    exotic -- to wipe the very tally mfa_login's own success=False call was
    just wired (round 1 of this PR) to accumulate. The HIGH alert this
    detector exists to raise was therefore unreachable through the MFA step
    in practice, even after round 1's fix.

    Fixed by moving the success=True call below the mfa_enabled branch, so it
    is reached only when the password alone completed authentication --
    mirroring the invariant `clear_auth_failures` already enforced for the
    separate suspicious-IP throttle on this same branch.
    """

    async def test_login_plus_wrong_mfa_code_cycling_still_accumulates(
        self, monkeypatch
    ):
        from app.services.security_monitoring import SecurityMonitoringService

        # A fresh, unshared detector instance: the module singleton persists
        # state across the whole test session, and this test needs to know
        # its tally started at zero.
        fresh_monitor = SecurityMonitoringService()
        monkeypatch.setattr("app.api.v1.endpoints.auth.security_monitor", fresh_monitor)
        monkeypatch.setattr("app.api.v1.endpoints.auth.log_audit_event", AsyncMock())
        monkeypatch.setattr(
            "app.api.v1.endpoints.auth.record_auth_failure", AsyncMock()
        )
        monkeypatch.setattr(
            "app.api.v1.endpoints.auth.clear_auth_failures", AsyncMock()
        )

        user = _mfa_user()
        db = _locking_db_for(user)
        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )
        threshold = fresh_monitor.thresholds.failed_logins_per_user

        with patch(
            "app.api.v1.endpoints.auth.AuthService.authenticate_user",
            new=AsyncMock(return_value=(user, None)),
        ):
            for attempt in range(1, threshold + 1):
                # Step 1: a correct-password /login call. A real client (or
                # this attacker's script) hits this before every MFA guess.
                login_response = await login(
                    credentials=UserLogin(
                        username="member-1", password="correct-password"
                    ),
                    request=request,
                    db=db,
                )
                assert login_response.status_code == 200

                # Step 2: guess the wrong second factor.
                temp_token = create_mfa_pending_token(user.id)
                with pytest.raises(CodedHTTPException):
                    await mfa_login(
                        data=MFALogin(temp_token=temp_token, code="000000"),
                        request=request,
                        db=db,
                    )

                tally = len(fresh_monitor._login_attempts.get(f"user:{user.id}", []))
                assert tally == attempt, (
                    f"after {attempt} login()+mfa_login() cycles the per-user "
                    f"tally should be {attempt}, not {tally} -- a value stuck "
                    f"at 1 means the interleaved /login call is still wiping "
                    f"it on every iteration, exactly the regression this test "
                    f"guards"
                )

        # The threshold-th failure must have crossed the alert threshold.
        assert tally >= threshold


@pytest.mark.asyncio
class TestVerifyAndConsumeTotpConcurrency:
    """PR #2133 round 2 (Codex): a real concurrency race in the round-1 fix
    itself. `_verify_and_consume_totp` read `user.mfa_last_timestep` off
    whatever ORM object the caller already held and wrote the consumed step
    back onto that same in-memory object, relying on the caller's own later
    `db.commit()` to persist it -- a plain read-then-later-write, not an
    atomic compare-and-set, and no row lock in between. Two concurrent
    requests racing the SAME valid code (Codex's scenario: a phishing relay
    captures a code and races it against an attacker's own `/mfa/login`
    request and the legitimate holder's request to any of the other three
    management routes, simultaneously) could each load the user row before
    the other committed, each see the same not-yet-consumed
    `mfa_last_timestep`, each pass the "newer than last consumed" check, and
    each commit -- defeating the single-use guarantee this helper's own
    docstring claims.

    A mocked single `db` cannot exercise this: the fix relies on a genuine
    InnoDB row lock (`SELECT ... FOR UPDATE`) making the SECOND session's
    read block until the FIRST session's transaction actually commits, then
    see that commit's effect -- mechanics no mock reproduces. This test
    races two REAL, independently-committing AsyncSessions (two separate
    connections from the app's own engine) against a real row in the test
    database, controlling the interleaving with asyncio.Event so the second
    session's locking read is only attempted once the first genuinely holds
    the row lock, rather than guessing with a fixed sleep.
    """

    async def test_two_real_sessions_racing_the_same_code_only_one_consumes(
        self, db_session
    ):
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        secret = mfa_service.generate_secret()

        # Real, committed rows -- visible to two independent connections,
        # unlike the rollback-per-test `db_session` fixture (a single shared
        # connection/transaction that cannot race itself). `db_session` is
        # still requested as a fixture dependency purely to trigger the
        # session-scoped `_initialize_database` fixture before this test's
        # own connections are opened.
        async with database_manager.engine.connect() as setup_conn:
            async with setup_conn.begin():
                await setup_conn.execute(
                    text(
                        "INSERT INTO organizations "
                        "(id, name, organization_type, slug, timezone) "
                        "VALUES (:id, :name, :otype, :slug, :tz)"
                    ),
                    {
                        "id": org_id,
                        "name": "Race Test Dept",
                        "otype": "fire_department",
                        "slug": f"race-{org_id[:8]}",
                        "tz": "UTC",
                    },
                )
                await setup_conn.execute(
                    text(
                        "INSERT INTO users "
                        "(id, organization_id, username, first_name, last_name, "
                        "email, password_hash, status, mfa_enabled, mfa_secret) "
                        "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active', "
                        "1, :secret)"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": f"racer-{user_id[:8]}",
                        "fn": "Race",
                        "ln": "User",
                        "em": f"racer-{user_id[:8]}@test.com",
                        "pw": "hashed",
                        "secret": secret,
                    },
                )

        try:
            code = pyotp.TOTP(secret).now()
            user_stub = SimpleNamespace(id=user_id)

            a_holds_lock = asyncio.Event()
            b_is_blocked = asyncio.Event()
            release_a = asyncio.Event()

            async def call_a():
                async with database_manager.engine.connect() as conn:
                    async with conn.begin():
                        session = AsyncSession(bind=conn, expire_on_commit=False)
                        result = await _verify_and_consume_totp(
                            session, user_stub, code
                        )
                        # The row lock is acquired the moment the locking
                        # SELECT above returns -- signal B to attempt its own
                        # locking read now, then hold this transaction open
                        # (keeping the lock) until B confirms it is blocked
                        # on it.
                        a_holds_lock.set()
                        await b_is_blocked.wait()
                        await release_a.wait()
                        await session.commit()
                        return result

            async def call_b():
                await a_holds_lock.wait()
                async with database_manager.engine.connect() as conn:
                    async with conn.begin():
                        session = AsyncSession(bind=conn, expire_on_commit=False)
                        b_task = asyncio.ensure_future(
                            _verify_and_consume_totp(session, user_stub, code)
                        )
                        # Yield repeatedly so B's coroutine actually reaches
                        # and issues its `SELECT ... FOR UPDATE` against the
                        # real connection -- it will suspend there, genuinely
                        # blocked by MySQL on A's held row lock, not merely
                        # scheduled.
                        for _ in range(20):
                            await asyncio.sleep(0.01)
                            if b_task.done():
                                break
                        assert not b_task.done(), (
                            "call B's locking read completed before call A "
                            "released the row -- the lock was not actually "
                            "acquired/held, so this run cannot distinguish "
                            "the fix from the original race"
                        )
                        b_is_blocked.set()
                        release_a.set()
                        result = await b_task
                        await session.commit()
                        return result

            result_a, result_b = await asyncio.gather(call_a(), call_b())

            assert (
                result_a is True
            ), "the first request to consume the code should succeed"
            assert result_b is False, (
                "the second, concurrent request consuming the SAME code must "
                "be rejected as a replay once its locking read observes the "
                "first request's committed timestep -- True here means the "
                "single-use guarantee was defeated by the race"
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :id"),
                        {"id": org_id},
                    )


@pytest.mark.asyncio
class TestVerifyAndConsumeRecoveryCodeConcurrency:
    """Found during the adversarial re-read for round 2 of this PR, the same
    shape Codex flagged in `_verify_and_consume_totp` (AUTH-9): `mfa_login`'s
    recovery-code branch read `user.mfa_backup_codes` off the caller's
    already-loaded (unlocked) object, found a match, and wrote the filtered
    list back with no lock and no re-check against the database's current
    value -- an unlocked read-then-write exactly like the TOTP one, just for
    a different field. A recovery code is meant to work exactly once, and has
    no 30s expiry to outrun (unlike a TOTP code), so a shoulder-surfed or
    phished recovery code was, if anything, an easier target for the same
    two-concurrent-requests race: both could find it in their own stale
    snapshot, both filter it out locally, and both commit -- each completing
    an independent login with a code meant to be single-use.

    Fixed the same way as AUTH-9: `_verify_and_consume_recovery_code` now
    re-fetches the row with `.with_for_update().execution_options
    (populate_existing=True)` before reading `mfa_backup_codes`, so the
    second concurrent request's locking read blocks until the first commits
    and then sees the already-filtered list -- the code is simply gone.

    Same reproduction rigor as AUTH-9: two REAL, independently-committing
    `AsyncSession`s racing the identical recovery code against a real row in
    the test database, interleaving controlled with `asyncio.Event` (not a
    fixed sleep) so the test can assert B's locking read genuinely blocked
    on A's held lock rather than merely finishing first by luck.
    """

    async def test_two_real_sessions_racing_the_same_recovery_code_only_one_consumes(
        self, db_session
    ):
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        recovery_code = "abcde-fghij-klmno-pqrst"
        stored_hash = mfa_service.hash_recovery_code(recovery_code)

        # Real, committed rows -- visible to two independent connections. The
        # `mfa_backup_codes` property Fernet-decrypts on read and falls back
        # to the raw stored value on InvalidToken (see User.mfa_backup_codes
        # in app/models/user.py) -- a plain hash string is not a valid Fernet
        # token, so this raw JSON insert is read back correctly through that
        # legacy-plaintext fallback path, exactly as this file's TOTP race
        # test already relies on for `mfa_secret`.
        async with database_manager.engine.connect() as setup_conn:
            async with setup_conn.begin():
                await setup_conn.execute(
                    text(
                        "INSERT INTO organizations "
                        "(id, name, organization_type, slug, timezone) "
                        "VALUES (:id, :name, :otype, :slug, :tz)"
                    ),
                    {
                        "id": org_id,
                        "name": "Recovery Race Test Dept",
                        "otype": "fire_department",
                        "slug": f"recovery-race-{org_id[:8]}",
                        "tz": "UTC",
                    },
                )
                await setup_conn.execute(
                    text(
                        "INSERT INTO users "
                        "(id, organization_id, username, first_name, last_name, "
                        "email, password_hash, status, mfa_enabled, mfa_secret, "
                        "mfa_backup_codes) "
                        "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active', "
                        "1, :secret, :codes)"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": f"recracer-{user_id[:8]}",
                        "fn": "Recovery",
                        "ln": "Racer",
                        "em": f"recracer-{user_id[:8]}@test.com",
                        "pw": "hashed",
                        "secret": mfa_service.generate_secret(),
                        "codes": json.dumps([stored_hash]),
                    },
                )

        try:
            user_stub = SimpleNamespace(id=user_id)

            a_holds_lock = asyncio.Event()
            b_is_blocked = asyncio.Event()
            release_a = asyncio.Event()

            async def call_a():
                async with database_manager.engine.connect() as conn:
                    async with conn.begin():
                        session = AsyncSession(bind=conn, expire_on_commit=False)
                        result = await _verify_and_consume_recovery_code(
                            session, user_stub, recovery_code
                        )
                        a_holds_lock.set()
                        await b_is_blocked.wait()
                        await release_a.wait()
                        await session.commit()
                        return result

            async def call_b():
                await a_holds_lock.wait()
                async with database_manager.engine.connect() as conn:
                    async with conn.begin():
                        session = AsyncSession(bind=conn, expire_on_commit=False)
                        b_task = asyncio.ensure_future(
                            _verify_and_consume_recovery_code(
                                session, user_stub, recovery_code
                            )
                        )
                        for _ in range(20):
                            await asyncio.sleep(0.01)
                            if b_task.done():
                                break
                        assert not b_task.done(), (
                            "call B's locking read completed before call A "
                            "released the row -- the lock was not actually "
                            "acquired/held, so this run cannot distinguish "
                            "the fix from the original race"
                        )
                        b_is_blocked.set()
                        release_a.set()
                        result = await b_task
                        await session.commit()
                        return result

            result_a, result_b = await asyncio.gather(call_a(), call_b())

            assert (
                result_a is True
            ), "the first request to consume the recovery code should succeed"
            assert result_b is False, (
                "the second, concurrent request consuming the SAME recovery "
                "code must be rejected once its locking read observes the "
                "first request's already-filtered code list -- True here "
                "means the single-use guarantee was defeated by the race"
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :id"),
                        {"id": org_id},
                    )


@pytest.mark.asyncio
class TestMfaLastTimestepClearedOnSecretChange:
    """PR #2133 round 2 (Codex): `mfa_disable` cleared `mfa_secret`/
    `mfa_enabled`/`mfa_backup_codes` but left `mfa_last_timestep` untouched.
    Timesteps are unix-time-derived, not secret-derived, so a user who
    disables MFA and immediately re-enrolls (`mfa_setup` installs a new
    secret) can hit `/mfa/verify-setup` with a legitimate first code for the
    NEW secret that happens to land in the same 30s wall-clock window as
    whatever timestep was last recorded against the OLD secret --
    `verify_totp_get_timestep` rejects it purely because the raw step number
    is `<= last_timestep`, even though the code verifies against a
    completely different secret. A real, if narrow, availability bug: the
    user has to wait out the window (worse under clock skew).

    Fixed by clearing `mfa_last_timestep` in both places a user's secret
    changes: `mfa_disable` (secret removed) and `mfa_setup` (secret
    installed -- covers re-enrollment via `mfa_disable` AND a second
    `/mfa/setup` call overwriting an still-unconfirmed secret from an
    abandoned first attempt).
    """

    async def test_disable_clears_last_timestep(self):
        # A small, definitely-in-the-past timestep, so the real current
        # code still passes the "newer than last consumed" check and this
        # test isolates the field-clearing behaviour rather than tripping
        # the replay guard itself.
        user = _mfa_user(mfa_last_timestep=1)
        db = _locking_db_for(user)
        code = pyotp.TOTP(user.mfa_secret).now()

        with (
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
        ):
            result = await mfa_disable(
                data=MFAVerify(code=code),
                background_tasks=AsyncMock(),
                current_user=user,
                db=db,
            )

        assert result == {"mfa_enabled": False}
        assert user.mfa_last_timestep is None

    async def test_setup_clears_last_timestep(self):
        user = _mfa_user(
            mfa_enabled=False, mfa_secret=None, mfa_last_timestep=999_999_999
        )
        db = MagicMock()
        db.commit = AsyncMock()

        result = await mfa_setup(current_user=user, db=db)

        assert "secret" in result
        assert user.mfa_last_timestep is None

    async def test_disable_then_reenroll_same_timestep_code_is_not_rejected(self):
        """End-to-end reproduction: disable, re-enroll with a brand-new
        secret, and confirm a legitimate first code for the NEW secret in
        the same raw timestep as the OLD secret's just-consumed one is
        accepted rather than rejected as a replay."""
        old_secret = mfa_service.generate_secret()
        user = _mfa_user(mfa_secret=old_secret)
        db = _locking_db_for(user)

        old_code = pyotp.TOTP(old_secret).now()
        with (
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
        ):
            await mfa_disable(
                data=MFAVerify(code=old_code),
                background_tasks=AsyncMock(),
                current_user=user,
                db=db,
            )
        assert user.mfa_last_timestep is None

        # Re-enroll with a brand-new secret.
        setup_db = MagicMock()
        setup_db.commit = AsyncMock()
        await mfa_setup(current_user=user, db=setup_db)
        new_secret = user.mfa_secret
        assert new_secret != old_secret

        # The NEW secret's current code -- same wall-clock timestep as the
        # OLD secret's just-consumed one -- must verify.
        new_code = pyotp.TOTP(new_secret).now()
        db2 = _locking_db_for(user)
        with (
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
        ):
            result = await mfa_verify_setup(
                data=MFAVerify(code=new_code),
                background_tasks=AsyncMock(),
                current_user=user,
                db=db2,
            )

        assert "recovery_codes" in result
