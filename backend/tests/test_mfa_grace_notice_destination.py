"""The two-factor grace notice sends the member to the Security tab (W07-2).

When a member's positions start requiring two-factor authentication, they
are notified once. The notice said "set it up under Profile > Security" and
linked to ``/account``, which opens the Account (profile) tab. The screen is
named My Account, and two-factor setup is on its Security tab, which
``/account?tab=security`` opens. W05-11 fixed the same destination on the
grace banner.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.dependencies import evaluate_mfa_requirement
from app.core.error_codes import ERROR_CODE_CATALOG, ErrorCode

pytestmark = pytest.mark.unit


def _privileged_member():
    return SimpleNamespace(
        id="user-1",
        username="chief",
        positions=[SimpleNamespace(permissions=["audit.export"])],
        rank=None,
        mfa_enabled=False,
        mfa_grace_started_at=None,
    )


async def _notice_kwargs():
    db = MagicMock()
    db.flush = AsyncMock()
    with patch(
        "app.utils.security_notifications.notify_security_event", AsyncMock()
    ) as notify:
        await evaluate_mfa_requirement(db, _privileged_member(), False)
    notify.assert_awaited_once()
    return notify.await_args.kwargs


async def test_the_notice_links_to_the_security_tab():
    kwargs = await _notice_kwargs()

    assert kwargs["action_url"] == "/account?tab=security"


async def test_the_notice_names_the_screen_the_member_sees():
    kwargs = await _notice_kwargs()

    assert "My Account" in kwargs["message"]
    assert "Profile >" not in kwargs["message"]


def test_the_error_code_points_at_screens_that_exist():
    info = ERROR_CODE_CATALOG[ErrorCode.AUTH_MFA_ENROLLMENT_REQUIRED]
    text = " ".join(info.resolution)

    assert "My Account" in text
    assert "Profile" not in text
    assert "Settings → Authentication → MFA Policy" in text
