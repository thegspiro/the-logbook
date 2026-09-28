"""Forgot-password reports how long its link lasts.

The page guessed "1 hour" while ``RESET_TOKEN_EXPIRY_MINUTES`` is 30 and the
email itself said 30. The response now carries the value, identically for
every address, so it reveals nothing about which accounts exist (workflow
review W03-1).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks

from app.api.v1.endpoints import auth as auth_ep
from app.schemas.auth import PasswordResetRequest
from app.services.auth_service import RESET_TOKEN_EXPIRY_MINUTES

pytestmark = pytest.mark.unit


def _db_returning(organization):
    result = MagicMock()
    result.scalar_one_or_none.return_value = organization
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


async def _forgot(db, email="nobody@example.org"):
    with patch.object(auth_ep, "log_audit_event", new=AsyncMock()), patch.object(
        auth_ep.AuthService,
        "create_password_reset_token",
        new=AsyncMock(return_value=(None, None)),
    ):
        return await auth_ep.forgot_password(
            reset_request=PasswordResetRequest(email=email),
            request=MagicMock(),
            background_tasks=BackgroundTasks(),
            db=db,
        )


async def test_an_unknown_address_is_told_the_expiry():
    org = SimpleNamespace(id="org-a", name="Review FD", settings={})

    body = await _forgot(_db_returning(org))

    assert body["expires_in_minutes"] == RESET_TOKEN_EXPIRY_MINUTES


async def test_no_organization_answers_in_the_same_shape():
    body = await _forgot(_db_returning(None))

    assert body["expires_in_minutes"] == RESET_TOKEN_EXPIRY_MINUTES
    assert body["message"] == (
        "If an account with that email exists, a reset link has been sent."
    )
