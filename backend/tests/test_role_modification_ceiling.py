"""
Tests for the role *modification* ceiling
(app/api/v1/endpoints/roles.py :: _enforce_role_modification_ceiling).

The pre-existing grant ceiling only inspects the permission list being written,
and returns early when that list is empty. That left the destructive direction
open: a ``roles.edit`` holder who is not a ``*`` holder could PUT the org's only
"System Owner" role with ``permissions: []`` and wipe it, locking the tenant out
of its own administration. These tests pin the rule that closes it — you may
only modify a role whose *current* permissions are within your own authority.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.roles import _enforce_role_modification_ceiling


def _user(*permissions: str) -> SimpleNamespace:
    """A stand-in user whose effective permissions come from one position."""
    return SimpleNamespace(
        id="user-1",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def _role(*permissions: str) -> SimpleNamespace:
    return SimpleNamespace(id="role-1", permissions=list(permissions))


@pytest.fixture
def no_alert():
    """Silence the security-monitoring side effect; assert on it where it matters."""
    with patch(
        "app.api.v1.endpoints.roles.report_privilege_escalation_attempt",
        new=AsyncMock(),
    ) as reporter:
        yield reporter


class TestRoleModificationCeiling:
    async def test_blocks_wiping_a_system_owner_role(self, no_alert):
        """The exact ORU-7 sabotage path: roles.edit holder vs the sole '*' role."""
        with pytest.raises(HTTPException) as exc:
            await _enforce_role_modification_ceiling(
                _user("roles.edit"), _role("*"), db=None, ip_address="10.0.0.1"
            )
        assert exc.value.status_code == 403
        assert "beyond" in exc.value.detail

    async def test_blocked_attempt_is_reported_to_security_monitoring(self, no_alert):
        with pytest.raises(HTTPException):
            await _enforce_role_modification_ceiling(
                _user("roles.edit"), _role("*"), db=None, ip_address="10.0.0.1"
            )
        no_alert.assert_awaited_once()

    async def test_allows_editing_a_role_within_your_authority(self, no_alert):
        await _enforce_role_modification_ceiling(
            _user("roles.edit", "events.*"),
            _role("events.view"),
            db=None,
            ip_address=None,
        )
        no_alert.assert_not_awaited()

    async def test_global_wildcard_holder_may_edit_anything(self, no_alert):
        await _enforce_role_modification_ceiling(
            _user("*"), _role("*", "security.manage"), db=None, ip_address=None
        )
        no_alert.assert_not_awaited()

    async def test_module_wildcard_covers_actions_in_that_module(self, no_alert):
        await _enforce_role_modification_ceiling(
            _user("settings.*"), _role("settings.edit"), db=None, ip_address=None
        )
        no_alert.assert_not_awaited()

    async def test_blocks_when_only_one_permission_exceeds(self, no_alert):
        """A single out-of-ceiling permission is enough to refuse the edit."""
        with pytest.raises(HTTPException):
            await _enforce_role_modification_ceiling(
                _user("events.*"),
                _role("events.view", "security.manage"),
                db=None,
                ip_address=None,
            )

    async def test_role_with_no_permissions_is_editable(self, no_alert):
        """Nothing to protect — an empty role is not privileged."""
        await _enforce_role_modification_ceiling(
            _user("roles.edit"), _role(), db=None, ip_address=None
        )
        no_alert.assert_not_awaited()
