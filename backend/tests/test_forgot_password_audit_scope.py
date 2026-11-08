"""A reset request is audited in the department's own log (W03-9).

``forgot_password`` wrote ``auth.password_reset_requested`` with the
department's id only inside ``event_data``. The audit log is read by its
``organization_id`` column (``audit_logs.py``), so no administrator could see
a reset request, whether a token was issued, refused because email is off, or
asked for an address that matches nobody. Every request now stamps the
column, and a request that matched a member names them.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest
from fastapi import BackgroundTasks

from app.api.v1.endpoints import auth as auth_ep
from app.schemas.auth import PasswordResetRequest

pytestmark = pytest.mark.unit

ORG = SimpleNamespace(id="org-a", name="Review FD", settings={})


def _db():
    result = MagicMock()
    result.scalar_one_or_none.return_value = ORG
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


async def _audit_kwargs(*, email_on=True, matched=None):
    token = (matched, "raw-token") if matched else (None, None)
    audit = AsyncMock()
    with patch.object(auth_ep, "log_audit_event", new=audit), patch.object(
        auth_ep.AuthService,
        "create_password_reset_token",
        new=AsyncMock(return_value=token),
    ), patch(
        "app.services.email_service.EmailService.can_send",
        new_callable=PropertyMock,
        return_value=email_on,
    ):
        await auth_ep.forgot_password(
            reset_request=PasswordResetRequest(email="someone@example.org"),
            request=MagicMock(),
            background_tasks=BackgroundTasks(),
            db=_db(),
        )
    audit.assert_awaited_once()
    return audit.await_args.kwargs


async def test_a_request_with_email_off_lands_in_the_department_log():
    kwargs = await _audit_kwargs(email_on=False)

    assert kwargs["organization_id"] == "org-a"


async def test_a_request_for_an_unknown_address_lands_in_the_department_log():
    kwargs = await _audit_kwargs()

    assert kwargs["organization_id"] == "org-a"
    assert kwargs.get("user_id") is None


async def test_a_request_that_matched_a_member_names_them():
    member = SimpleNamespace(
        id="user-1",
        email="someone@example.org",
        preferred_name=None,
        first_name="Sam",
        username="sam",
        display_name="Sam Smith",
    )

    kwargs = await _audit_kwargs(matched=member)

    assert kwargs["organization_id"] == "org-a"
    assert kwargs["user_id"] == "user-1"
