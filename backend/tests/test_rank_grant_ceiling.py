"""
ORU-7d: a member's operational rank grants that rank's default permissions
(see _collect_user_permissions), so setting a rank must clear the same
permission-grant ceiling as assigning a role — otherwise a members.manage
holder (e.g. a secretary) could set rank="fire_chief" and escalate to
settings.manage / security.manage through an unguarded permission source.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import _enforce_rank_grant_ceiling


def _user(perms):
    return SimpleNamespace(
        id="u1",
        positions=[SimpleNamespace(permissions=list(perms))],
        rank=None,
    )


class TestRankGrantCeiling:
    async def test_members_manage_cannot_grant_chief_rank(self):
        # A secretary-level caller (members.manage but not settings/security)
        # must not be able to hand out a chief rank that carries them.
        caller = _user(["members.manage", "users.create"])
        db = MagicMock()
        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            with pytest.raises(HTTPException) as exc:
                await _enforce_rank_grant_ceiling(caller, "fire_chief", db, "1.2.3.4")
        assert exc.value.status_code == 403
        assert "beyond your own" in exc.value.detail
        reported.assert_awaited_once()

    async def test_wildcard_caller_can_grant_chief_rank(self):
        caller = _user(["*"])
        db = MagicMock()
        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            # `*` covers every rank permission -> no raise, nothing reported.
            await _enforce_rank_grant_ceiling(caller, "fire_chief", db, None)
        reported.assert_not_awaited()

    async def test_no_rank_is_noop(self):
        caller = _user(["members.manage"])
        db = MagicMock()
        await _enforce_rank_grant_ceiling(caller, None, db, None)

    async def test_unknown_rank_carries_no_permissions(self):
        # An unrecognized rank resolves to [] default permissions, so there is
        # nothing to exceed and the ceiling does not block it.
        caller = _user(["members.manage"])
        db = MagicMock()
        await _enforce_rank_grant_ceiling(caller, "not_a_real_rank", db, None)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
