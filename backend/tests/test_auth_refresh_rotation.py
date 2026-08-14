"""Regression tests for refresh-token replay handling."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.security import create_refresh_token
from app.services.auth_service import AuthService


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
