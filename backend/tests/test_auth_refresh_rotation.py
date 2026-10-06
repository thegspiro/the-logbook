"""Regression tests for refresh-token replay handling."""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select, text

from app.core.security import create_refresh_token
from app.models.user import Session as UserSession
from app.services.auth_service import AuthService, RefreshTokenSuperseded


@pytest.mark.unit
@pytest.mark.asyncio
async def test_previous_refresh_token_is_rejected_as_replay():
    """A stale token must revoke sessions rather than receive rotated tokens."""
    stale_token = create_refresh_token({"sub": "user-123"})

    missing_session_result = MagicMock()
    missing_session_result.scalar_one_or_none.return_value = None
    revoke_result = MagicMock(rowcount=1)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[missing_session_result, revoke_result])
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    access_token, refresh_token = await AuthService(db).refresh_access_token(
        stale_token
    )

    assert (access_token, refresh_token) == (None, None)
    assert db.execute.await_count == 2
    db.flush.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_replay_revocation_is_committed_before_the_401():
    """Replay-triggered revocation must be committed, not just flushed.

    The endpoint answers a replayed token with a 401 and the request-scoped
    session rolls back on that exception, so a flush-only revocation would be
    silently undone and the stolen tokens would keep working.
    """
    stale_token = create_refresh_token({"sub": "user-123"})

    missing_session_result = MagicMock()
    missing_session_result.scalar_one_or_none.return_value = None
    revoke_result = MagicMock(rowcount=1)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[missing_session_result, revoke_result])
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    access_token, refresh_token = await AuthService(db).refresh_access_token(
        stale_token
    )

    assert (access_token, refresh_token) == (None, None)
    db.commit.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_refresh_user_lookup_requires_active_organization():
    """Refresh must mirror login's Organization.active filter.

    Without it, members of a deactivated organization keep re-issuing 7-day
    refresh tokens forever. The failure surfaces as the same (None, None) as
    every other refresh failure, so it stays indistinguishable to callers.
    """
    token = create_refresh_token({"sub": "user-123"})

    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = MagicMock(refresh_token=token)
    # The active-org join filters the user row out for a deactivated org.
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = None

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[session_result, user_result])
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    access_token, refresh_token = await AuthService(db).refresh_access_token(token)

    assert (access_token, refresh_token) == (None, None)
    assert db.execute.await_count == 2
    db.commit.assert_not_awaited()

    user_query = str(db.execute.await_args_list[1].args[0])
    assert "JOIN organizations" in user_query
    assert "organizations.active IS true" in user_query


def _live_session_mocks(token: str, rowcount: int) -> MagicMock:
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = MagicMock(
        id="session-1", refresh_token=token
    )
    user = MagicMock(id="user-123", username="member", organization_id="org-1")
    user.is_active = True
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user
    rotation_result = MagicMock(rowcount=rowcount)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[session_result, user_result, rotation_result])
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.unit
async def test_a_concurrent_rotation_is_not_treated_as_replay():
    """AUTH-21: the loser of a double-fire must not revoke every session."""
    token = create_refresh_token({"sub": "user-123"})
    db = _live_session_mocks(token, rowcount=0)

    with pytest.raises(RefreshTokenSuperseded):
        await AuthService(db).refresh_access_token(token)

    # Session, user, conditional rotation — and no revocation DELETE.
    assert db.execute.await_count == 3
    db.commit.assert_not_awaited()
    db.flush.assert_not_awaited()


@pytest.mark.unit
async def test_the_rotation_is_conditional_on_the_presented_token():
    token = create_refresh_token({"sub": "user-123"})
    db = _live_session_mocks(token, rowcount=1)

    access_token, refresh_token = await AuthService(db).refresh_access_token(token)

    assert access_token
    assert refresh_token
    assert refresh_token != token
    db.commit.assert_awaited_once()
    rotation = db.execute.await_args_list[2].args[0]
    compiled = rotation.compile()
    assert "UPDATE sessions" in str(compiled)
    assert compiled.params["refresh_token_1"] == token


@pytest.mark.integration
async def test_losing_a_rotation_race_keeps_every_session(
    db_session, setup_org_and_admin
):
    """Interleave a parallel rotation between the read and the write.

    The conditional UPDATE then matches nothing: the request is answered as
    superseded, and neither the session nor the member's other one is
    revoked — where the old code wrote over the winner's token and left the
    winner's client to trip replay detection on its next refresh.
    """
    _org_id, user_id = setup_org_and_admin
    token = create_refresh_token({"sub": user_id})
    expires = datetime.now(timezone.utc) + timedelta(minutes=30)
    racing_id, other_id = str(uuid.uuid4()), str(uuid.uuid4())
    db_session.add_all(
        [
            UserSession(
                id=racing_id,
                user_id=user_id,
                token=f"access-{racing_id}",
                refresh_token=token,
                expires_at=expires,
            ),
            UserSession(
                id=other_id,
                user_id=user_id,
                token=f"access-{other_id}",
                refresh_token=f"refresh-{other_id}",
                expires_at=expires,
            ),
        ]
    )
    await db_session.commit()

    real_execute = db_session.execute
    calls = 0

    async def execute_with_a_parallel_rotation(statement, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            # The parallel request's rotation lands between this request's
            # read of the session and its own write.
            await real_execute(
                text("UPDATE sessions SET refresh_token = :t WHERE id = :i"),
                {"t": "rotated-by-the-other-tab", "i": racing_id},
            )
        return await real_execute(statement, *args, **kwargs)

    db_session.execute = execute_with_a_parallel_rotation
    try:
        with pytest.raises(RefreshTokenSuperseded):
            await AuthService(db_session).refresh_access_token(token)
    finally:
        db_session.execute = real_execute

    rows = (
        await db_session.execute(
            select(UserSession.id, UserSession.refresh_token).where(
                UserSession.user_id == user_id
            )
        )
    ).all()
    assert dict(rows) == {
        racing_id: "rotated-by-the-other-tab",
        other_id: f"refresh-{other_id}",
    }
