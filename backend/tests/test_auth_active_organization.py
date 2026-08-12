"""Regression tests for organization status checks during password login."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.auth_service import AuthService


@pytest.mark.asyncio
async def test_authenticate_user_only_queries_active_organizations():
    canonical_result = MagicMock()
    canonical_result.scalar_one_or_none.return_value = None

    candidate_result = MagicMock()
    candidate_result.scalars.return_value.all.return_value = []

    db = AsyncMock()
    db.execute.side_effect = [canonical_result, candidate_result]

    with patch(
        "app.services.auth_service.hash_password", return_value="dummy-hash"
    ), patch("app.services.auth_service.verify_password", return_value=(False, False)):
        user, error = await AuthService(db).authenticate_user("member", "password")

    assert user is None
    assert error == "Incorrect username or password"

    candidate_query = str(db.execute.await_args_list[1].args[0])
    assert "JOIN organizations" in candidate_query
    assert "organizations.active IS true" in candidate_query
