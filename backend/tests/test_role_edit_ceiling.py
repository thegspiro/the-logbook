"""
ORU-7: editing a role's permissions requires the caller's own ceiling to cover
the role's CURRENT permissions — so a lower-privileged caller cannot wipe or
downgrade a more privileged role (e.g. set the `*` "System Owner" role to []).
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.roles import _enforce_role_edit_ceiling


def _user(perms):
    return SimpleNamespace(
        id="u1",
        positions=[SimpleNamespace(permissions=list(perms))],
        rank=None,
    )


class TestRoleEditCeiling:
    async def test_weak_caller_cannot_edit_wildcard_role(self):
        caller = _user(["events.*"])  # not a `*` holder
        db = MagicMock()
        with patch(
            "app.api.v1.endpoints.roles.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            with pytest.raises(HTTPException) as exc:
                await _enforce_role_edit_ceiling(caller, ["*"], db, "1.2.3.4")
        assert exc.value.status_code == 403
        assert "beyond your own" in exc.value.detail
        reported.assert_awaited_once()

    async def test_wildcard_caller_can_edit_wildcard_role(self):
        caller = _user(["*"])
        db = MagicMock()
        # Covers the role's current `*` -> no raise.
        await _enforce_role_edit_ceiling(caller, ["*"], db, "1.2.3.4")

    async def test_empty_existing_permissions_is_allowed(self):
        # A role that currently holds nothing can be edited by anyone otherwise
        # authorized (nothing to exceed).
        caller = _user(["events.view"])
        db = MagicMock()
        await _enforce_role_edit_ceiling(caller, [], db, "1.2.3.4")
