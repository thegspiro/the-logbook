"""
DASH-3 (pass 2): the unified /dashboard/action-items feed merges the Meetings and
Minutes action-item modules and is not permission-gated at the route, so it must
gate each half in-code the way its owning module does — otherwise a member with
neither permission reads every action item's description org-wide (the XC-2
re-exposure DASH-1 only closed the inner minutes restricted-split for). The
meeting half needs meetings.view OR minutes.view; the minutes half needs
minutes.view. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_unified_action_items


def _perms(*granted):
    def _check(user, perm):
        return perm in granted

    return _check


def _empty_result():
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    return result


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1", positions=[])


class TestActionItemsGating:
    async def test_member_with_no_permission_reads_nothing(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_empty_result())
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=_perms(),  # neither meetings.view nor minutes.view
        ):
            items = await get_unified_action_items(None, False, db, _user())
        assert items == []
        # Neither half was even queried.
        db.execute.assert_not_awaited()

    async def test_meetings_view_only_queries_only_the_meeting_half(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_empty_result())
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=_perms("meetings.view"),
        ):
            await get_unified_action_items(None, False, db, _user())
        # Meeting half ran; minutes half (needs minutes.view) was skipped.
        assert db.execute.await_count == 1

    async def test_minutes_view_queries_both_halves(self):
        # minutes.view satisfies the meeting half's OR gate and the minutes half.
        db = MagicMock()
        db.execute = AsyncMock(return_value=_empty_result())
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=_perms("minutes.view"),
        ):
            await get_unified_action_items(None, False, db, _user())
        assert db.execute.await_count == 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
