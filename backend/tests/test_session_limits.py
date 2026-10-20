"""Idle and absolute session limits, and what they do on refresh.

An idle session used to be deleted by the access-token check, and the refresh
that followed found no row and was read as a replayed token, which revoked every
other session the member had. These tests pin the replacement: the row stays,
refresh finds it, and the answer is an ordinary "sign in again".
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.dependencies import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.services.auth_service import AuthService, session_end_reason

NOW = datetime.now(timezone.utc)


def _session(idle_minutes=1, age_hours=1, **extra):
    return SimpleNamespace(
        id="session-1",
        user_id="user-123",
        last_activity=NOW - timedelta(minutes=idle_minutes),
        created_at=NOW - timedelta(hours=age_hours),
        **extra,
    )


@pytest.mark.unit
class TestSessionEndReason:
    def test_a_recent_young_session_continues(self):
        assert session_end_reason(_session(), NOW) is None

    def test_idle_past_the_limit_ends_it(self):
        idle = settings.HIPAA_SESSION_TIMEOUT_MINUTES + 1
        assert session_end_reason(_session(idle_minutes=idle), NOW) == "idle"

    def test_old_past_the_cap_ends_it_even_while_active(self):
        old = settings.SESSION_ABSOLUTE_MAX_HOURS + 1
        assert session_end_reason(_session(age_hours=old), NOW) == "absolute"

    def test_a_limit_of_zero_is_off(self):
        stale = _session(idle_minutes=10_000, age_hours=10_000)
        with (
            patch.object(settings, "HIPAA_SESSION_TIMEOUT_MINUTES", 0),
            patch.object(settings, "SESSION_ABSOLUTE_MAX_HOURS", 0),
        ):
            assert session_end_reason(stale, NOW) is None

    def test_naive_timestamps_are_read_as_utc(self):
        naive = _session(idle_minutes=1, age_hours=100)
        naive.created_at = naive.created_at.replace(tzinfo=None)
        assert session_end_reason(naive, NOW) == "absolute"

    def test_a_column_that_is_not_a_timestamp_does_not_end_the_session(self):
        odd = SimpleNamespace(last_activity=MagicMock(), created_at=None)
        assert session_end_reason(odd, NOW) is None

    def test_the_default_cap_is_twelve_hours(self):
        assert type(settings).model_fields["SESSION_ABSOLUTE_MAX_HOURS"].default == 12


def _refresh_db(session):
    found = MagicMock()
    found.scalar_one_or_none.return_value = session
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[found])
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.unit
class TestRefreshEnforcesTheLimits:
    async def _refresh(self, session):
        token = create_refresh_token({"sub": "user-123"})
        session.refresh_token = token
        db = _refresh_db(session)
        result = await AuthService(db).refresh_access_token(token)
        return result, db

    async def test_an_idle_session_is_not_renewed_and_is_not_a_replay(self):
        idle = settings.HIPAA_SESSION_TIMEOUT_MINUTES + 5
        result, db = await self._refresh(_session(idle_minutes=idle))

        assert result == (None, None)
        db.delete.assert_awaited_once()
        db.commit.assert_awaited_once()
        # Only the session lookup ran: no bulk DELETE of the member's sessions.
        assert db.execute.await_count == 1

    async def test_a_session_past_the_absolute_cap_is_not_renewed(self):
        old = settings.SESSION_ABSOLUTE_MAX_HOURS + 1
        result, db = await self._refresh(_session(age_hours=old))

        assert result == (None, None)
        db.delete.assert_awaited_once()
        assert db.execute.await_count == 1

    async def test_a_genuine_replay_still_revokes_every_session(self):
        token = create_refresh_token({"sub": "user-123"})
        missing = MagicMock()
        missing.scalar_one_or_none.return_value = None
        revoked = MagicMock(rowcount=2)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[missing, revoked])
        db.flush = AsyncMock()
        db.commit = AsyncMock()

        assert await AuthService(db).refresh_access_token(token) == (None, None)
        assert db.execute.await_count == 2


def _access_db(session):
    found = MagicMock()
    found.scalar_one_or_none.return_value = session
    user = MagicMock(id="user-123")
    user.is_active = True
    user_found = MagicMock()
    user_found.scalar_one_or_none.return_value = user
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[found, user_found])
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


def _live(**kw):
    token = create_access_token({"sub": "user-123"})
    return token, _session(token=token, expires_at=NOW + timedelta(minutes=20), **kw)


@pytest.mark.unit
class TestAccessTokenCheck:
    async def _check(self, session, token, **kwargs):
        db = _access_db(session)
        user = await AuthService(db).get_user_from_token(token, **kwargs)
        return user, db

    async def test_an_idle_session_is_rejected_but_its_row_is_kept(self):
        idle = settings.HIPAA_SESSION_TIMEOUT_MINUTES + 5
        token, session = _live(idle_minutes=idle)
        user, db = await self._check(session, token)

        assert user is None
        db.delete.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_a_session_past_the_cap_is_rejected_but_its_row_is_kept(self):
        token, session = _live(age_hours=settings.SESSION_ABSOLUTE_MAX_HOURS + 1)
        user, db = await self._check(session, token)

        assert user is None
        db.delete.assert_not_awaited()

    async def test_a_request_counts_as_activity_by_default(self):
        token, session = _live(idle_minutes=10)
        user, _db = await self._check(session, token)

        assert user is not None
        assert session.last_activity > NOW - timedelta(minutes=1)

    async def test_a_background_request_does_not_extend_the_idle_timer(self):
        token, session = _live(idle_minutes=10)
        before = session.last_activity
        user, db = await self._check(session, token, touch_activity=False)

        assert user is not None
        assert session.last_activity == before
        db.flush.assert_not_awaited()

    async def test_a_background_request_on_an_idle_session_is_still_refused(self):
        idle = settings.HIPAA_SESSION_TIMEOUT_MINUTES + 5
        token, session = _live(idle_minutes=idle)
        user, _db = await self._check(session, token, touch_activity=False)

        assert user is None


@pytest.mark.unit
class TestBackgroundHeader:
    async def _resolve(self, headers):
        request = SimpleNamespace(
            state=SimpleNamespace(), headers=headers, url=SimpleNamespace(path="/x")
        )
        get_user = AsyncMock(return_value=MagicMock(id="u"))
        with patch.object(AuthService, "get_user_from_token", get_user):
            try:
                await get_current_user(
                    request=request,
                    authorization=None,
                    access_token="tok",
                    db=MagicMock(),
                )
            except Exception:
                # Later gates (MFA, password age) are not what is under test.
                pass
        return get_user

    async def test_the_header_marks_the_request_as_background(self):
        get_user = await self._resolve({"x-background-request": "1"})
        assert get_user.await_args.kwargs["touch_activity"] is False

    async def test_no_header_means_the_request_counts(self):
        get_user = await self._resolve({})
        assert get_user.await_args.kwargs["touch_activity"] is True

    async def test_any_other_value_means_the_request_counts(self):
        get_user = await self._resolve({"x-background-request": "yes"})
        assert get_user.await_args.kwargs["touch_activity"] is True


@pytest.mark.integration
class TestIdleExpiryDoesNotSignTheMemberOutEverywhere:
    """The regression this change exists for, against a real database."""

    async def _member_with_two_devices(self, db_session):
        import uuid

        from app.models.user import Organization, Session, User

        org = Organization(name="Session FD", slug=f"ses-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = User(
            organization_id=org.id,
            username=f"m-{uuid.uuid4().hex[:8]}",
            email=f"m-{uuid.uuid4().hex[:8]}@example.org",
            status="active",
        )
        db_session.add(user)
        await db_session.flush()

        rows = {}
        for name, idle_minutes in (("laptop", 1), ("tablet", 60)):
            data = {"sub": str(user.id), "org_id": str(org.id), "device": name}
            access = create_access_token(data)
            refresh = create_refresh_token(data)
            row = Session(
                user_id=str(user.id),
                token=access,
                refresh_token=refresh,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=20),
                last_activity=datetime.now(timezone.utc)
                - timedelta(minutes=idle_minutes),
                created_at=datetime.now(timezone.utc) - timedelta(hours=1),
            )
            db_session.add(row)
            rows[name] = (row, access, refresh)
        await db_session.flush()
        return user, rows

    async def test_an_idle_device_signs_in_again_and_the_others_survive(
        self, db_session
    ):
        from sqlalchemy import select

        from app.models.user import Session

        user, rows = await self._member_with_two_devices(db_session)
        _tablet, tablet_access, tablet_refresh = rows["tablet"]
        laptop_row, laptop_access, _ = rows["laptop"]
        service = AuthService(db_session)

        # The tablet was idle for an hour: its access token is refused...
        assert await service.get_user_from_token(tablet_access) is None
        # ...but its row is still there for the refresh that follows.
        assert (
            await db_session.execute(
                select(Session).where(Session.token == tablet_access)
            )
        ).scalar_one_or_none() is not None

        # The refresh is an ordinary refusal, not a replay.
        assert await service.refresh_access_token(tablet_refresh) == (None, None)

        remaining = (
            (
                await db_session.execute(
                    select(Session.token).where(Session.user_id == str(user.id))
                )
            )
            .scalars()
            .all()
        )
        assert remaining == [laptop_access]
        assert await service.get_user_from_token(laptop_access) is not None
