"""Guard: the two account-state gates in ``get_current_user`` must always
leave a member a way out.

``get_current_user`` runs two sequential refusals against the same request:

1. ``must_change_password`` — everything but ``_MUST_CHANGE_PW_ALLOWED_SUFFIXES``.
2. an org-wide ``mfa_required`` with the member un-enrolled — everything but
   ``_MFA_ENROLL_ALLOWED_SUFFIXES``.

Because they run in sequence, a member in *both* states can only reach the
**intersection** of the two lists. Before AUTH-14 (security review pass 4) that
intersection contained no remediation route at all: the password gate refused
every ``/auth/mfa/*`` enrollment path and the MFA gate refused
``/auth/change-password``, so every admin-created member (``users.py`` and
onboarding both set ``must_change_password=True``) was permanently unable to
either change their password or enrol from the moment an organization turned
MFA on.

These tests drive the real dependency rather than asserting list membership,
so widening one list without re-checking the other still fails here.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.requests import Request

from app.api import dependencies as deps


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "client": ("203.0.113.9", 51234),
            "server": ("testserver", 80),
            "scheme": "http",
            "root_path": "",
            "app": None,
            "state": {},
        }
    )


class _OrgSettingsDB:
    """Stands in for the one query the MFA gate issues (org settings JSON)."""

    def __init__(self, org_settings: dict):
        self._org_settings = org_settings

    async def execute(self, _stmt):
        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=self._org_settings)
        return result


async def _resolve(path: str, *, must_change_password: bool, mfa_required: bool):
    """Run the real ``get_current_user`` and return ``None`` or the refusal."""
    user = SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        must_change_password=must_change_password,
        mfa_enabled=False,
        is_active=True,
    )
    db = _OrgSettingsDB({"security": {"mfa_required": mfa_required}})
    with patch.object(
        deps.AuthService, "get_user_from_token", AsyncMock(return_value=user)
    ):
        try:
            await deps.get_current_user(_request(path), None, "access-token", db)
        except Exception as exc:  # noqa: BLE001 - the refusal is the assertion
            return exc
    return None


def test_password_change_is_reachable_when_both_gates_apply():
    """The one route that clears state 1 must survive gate 2.

    This is the assertion that fails against the pre-AUTH-14 code: the MFA
    gate returned 403 "MFA enrollment required before continuing." for
    ``/auth/change-password``, so a member in both states could not change the
    temporary password an administrator had issued them.
    """
    refusal = asyncio.run(
        _resolve(
            "/api/v1/auth/change-password",
            must_change_password=True,
            mfa_required=True,
        )
    )
    assert refusal is None, (
        "A member who must change their password AND is un-enrolled in an "
        "MFA-required org has no way to change that password: "
        f"{getattr(refusal, 'detail', refusal)}"
    )


def test_enrollment_is_reachable_once_the_password_is_changed():
    """After state 1 clears, the enrollment routes must open.

    Together with the test above this proves the sequence terminates: change
    the password, then enrol. Neither test alone does.
    """
    for path in (
        "/api/v1/auth/mfa/setup",
        "/api/v1/auth/mfa/verify-setup",
        "/api/v1/auth/mfa/status",
    ):
        refusal = asyncio.run(
            _resolve(path, must_change_password=False, mfa_required=True)
        )
        assert refusal is None, (
            f"{path} must be reachable by an un-enrolled member in an "
            f"MFA-required org: {getattr(refusal, 'detail', refusal)}"
        )


@pytest.mark.parametrize(
    "path",
    ["/api/v1/events", "/api/v1/inventory/items", "/api/v1/training/programs"],
)
def test_ordinary_routes_stay_closed_while_either_gate_applies(path: str):
    """Widening a list must not open the app itself.

    The fix for AUTH-14 adds one entry to one list; this is the counterweight
    that keeps a future "just allow a bit more" from becoming a bypass.
    """
    for must_change_password, mfa_required in (
        (True, True),
        (True, False),
        (False, True),
    ):
        refusal = asyncio.run(
            _resolve(
                path,
                must_change_password=must_change_password,
                mfa_required=mfa_required,
            )
        )
        assert refusal is not None, (
            f"{path} was reachable with must_change_password="
            f"{must_change_password}, mfa_required={mfa_required}"
        )
        assert getattr(refusal, "status_code", None) == 403
