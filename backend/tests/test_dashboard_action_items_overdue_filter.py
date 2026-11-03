"""
DASH-37: the operations dashboard's two overdue action-item cards link to
``/action-items`` with ``status=overdue`` (and a ``source``), and the unified
feed behind that page applies the very predicate each card counts by, so the
page opens on the rows the card counted. DB mocked; no MySQL.
"""

import datetime as dt
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.dashboard import (
    get_operations_dashboard,
    get_unified_action_items,
)

pytestmark = pytest.mark.unit

# 7:50 PM on 3 October in Chicago is already 4 October in UTC.
CHICAGO_TODAY = date(2026, 10, 3)


def _sql(statement) -> str:
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


def _empty_result():
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    return result


def _user(*granted):
    return SimpleNamespace(
        id="u1", organization_id="org-1", positions=[], permissions=list(granted)
    )


def _patches(user):
    granted = set(user.permissions)
    return (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["minutes"])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in granted,
        ),
        patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=CHICAGO_TODAY),
        ),
    )


async def _feed(user, **kwargs):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_empty_result())
    modules, perms, today = _patches(user)
    with modules, perms, today:
        await get_unified_action_items(None, False, db, user, **kwargs)
    return [_sql(call.args[0]) for call in db.execute.await_args_list]


class TestOverdueFeed:
    async def test_without_parameters_the_feed_is_unchanged(self):
        meeting_sql, minutes_sql = await _feed(_user("minutes.view"))
        assert "due_date <" not in meeting_sql
        assert "due_date <" not in minutes_sql

    async def test_overdue_meeting_items_use_the_department_calendar(self):
        (meeting_sql,) = await _feed(
            _user("minutes.manage", "minutes.view"), overdue=True, source="meeting"
        )
        assert "meeting_action_items.organization_id = 'org-1'" in meeting_sql
        assert "meeting_action_items.status IN ('open', 'in_progress')" in meeting_sql
        assert "meeting_action_items.due_date < '2026-10-03'" in meeting_sql

    async def test_overdue_minutes_items_cut_off_at_the_departments_today(self):
        (minutes_sql,) = await _feed(
            _user("minutes.manage", "minutes.view"), overdue=True, source="minutes"
        )
        assert "meeting_minutes.organization_id = 'org-1'" in minutes_sql
        assert "minutes_action_items.status IN ('pending', 'in_progress')" in (
            minutes_sql
        )
        # A due date is the UTC midnight of its calendar day, so an item due
        # 4 October is not late on the evening of the 3rd in Chicago.
        assert "minutes_action_items.due_date < '2026-10-03 00:00:00" in minutes_sql

    async def test_source_still_respects_each_halfs_permission_gate(self):
        # No minutes.view: the minutes half serves only the caller's own items.
        (minutes_sql,) = await _feed(
            _user("meetings.view"), overdue=True, source="minutes"
        )
        assert "minutes_action_items.assignee_id = 'u1'" in minutes_sql


class TestCardsAndFeedAgree:
    async def _operations(self):
        user = _user("meetings.manage", "minutes.manage")
        db = MagicMock()
        org = MagicMock()
        org.scalar_one_or_none.return_value = SimpleNamespace(
            timezone="America/Chicago"
        )
        counted = MagicMock()
        counted.one.return_value = (0, None)
        db.execute = AsyncMock(side_effect=[org, counted, counted])
        modules, perms, _ = _patches(user)
        with modules, perms, patch(
            "app.api.v1.endpoints.dashboard.datetime",
            wraps=dt.datetime,
        ) as clock:
            clock.now.return_value = datetime(2026, 10, 4, 0, 50, tzinfo=timezone.utc)
            response = await get_operations_dashboard(db, user)
        sqls = [_sql(call.args[0]) for call in db.execute.await_args_list[1:]]
        return response.sections[0].items, sqls

    async def test_each_card_links_to_the_rows_it_counted(self):
        items, (meeting_count, minutes_count) = await self._operations()
        hrefs = {item.key: item.href for item in items}
        assert hrefs["overdue_action_items"] == (
            "/action-items?source=meeting&status=overdue"
        )
        assert hrefs["minutes_action_items"] == (
            "/action-items?source=minutes&status=overdue"
        )

        (meeting_feed,) = await _feed(
            _user("minutes.manage", "minutes.view"), overdue=True, source="meeting"
        )
        (minutes_feed,) = await _feed(
            _user("minutes.manage", "minutes.view"), overdue=True, source="minutes"
        )
        for predicate in (
            "meeting_action_items.status IN ('open', 'in_progress')",
            "meeting_action_items.due_date < '2026-10-03'",
        ):
            assert predicate in meeting_count
            assert predicate in meeting_feed
        for predicate in (
            "minutes_action_items.status IN ('pending', 'in_progress')",
            "minutes_action_items.due_date < '2026-10-03 00:00:00",
        ):
            assert predicate in minutes_count
            assert predicate in minutes_feed


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
