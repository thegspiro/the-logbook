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

    access_token, refresh_token = await AuthService(db).refresh_access_token(
        stale_token
    )

    assert (access_token, refresh_token) == (None, None)
    assert db.execute.await_count == 2
    db.flush.assert_awaited_once()
