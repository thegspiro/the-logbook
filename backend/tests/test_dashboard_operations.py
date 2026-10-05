from datetime import date, datetime, time, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from app.api.v1.endpoints.dashboard import get_operations_dashboard


def _result(*, scalar=None, row=None):
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    result.scalar.return_value = scalar
    if row is not None:
        result.one.return_value = row
    return result


def _user(*permissions):
    return SimpleNamespace(
        id="leader",
        organization_id="org-a",
        permissions=list(permissions),
        positions=[],
    )


async def _call(user, enabled, results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=results)
    modules = SimpleNamespace(enabled_modules=enabled)
    granted = set(user.permissions)
    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=modules),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in granted,
        ),
    ):
        response = await get_operations_dashboard(db, user)
    return response, db


@pytest.mark.asyncio
async def test_partial_permission_returns_one_section_without_other_counts():
    response, db = await _call(
        _user("members.manage"),
        ["members", "training", "minutes"],
        [_result(scalar=SimpleNamespace(timezone="UTC")), _result(scalar=7)],
    )
    assert [section.key for section in response.sections] == ["membership_health"]
    assert response.sections[0].items[0].count == 7
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_disabled_module_is_not_queried_or_disclosed():
    response, db = await _call(
        _user("scheduling.manage"),
        ["members"],
        [_result(scalar=SimpleNamespace(timezone="UTC"))],
    )
    assert response.sections == []
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_minutes_count_requires_sensitive_minutes_permission():
    response, _ = await _call(
        _user("meetings.manage"),
        ["minutes"],
        [_result(scalar=SimpleNamespace(timezone="UTC")), _result(row=(2, None))],
    )
    items = response.sections[0].items
    assert [item.key for item in items] == ["overdue_action_items"]


@pytest.mark.asyncio
async def test_event_boundaries_use_organization_timezone_and_tenant_scope():
    response, db = await _call(
        _user("events.manage"),
        ["events"],
        [
            _result(scalar=SimpleNamespace(timezone="Pacific/Kiritimati")),
            _result(row=(0, None)),
        ],
    )
    assert response.timezone == "Pacific/Kiritimati"
    statement = db.execute.await_args_list[1].args[0]
    params = statement.compile().params
    assert "org-a" in params.values()
    # Both inclusive start and exclusive end are present, preventing a local
    # midnight item from leaking into the adjacent reporting period.
    rendered = str(statement)
    assert "events.start_datetime >=" in rendered
    assert "events.start_datetime <" in rendered


@pytest.mark.asyncio
async def test_every_data_query_is_scoped_to_current_organization():
    response, db = await _call(
        _user("members.manage", "events.manage"),
        ["members", "events"],
        [
            _result(scalar=SimpleNamespace(timezone="UTC")),
            _result(scalar=1),
            _result(row=(1, None)),
        ],
    )
    assert len(response.sections) == 2
    for call in db.execute.await_args_list[1:]:
        assert "org-a" in call.args[0].compile().params.values()


class _FrozenDatetime(datetime):
    """``datetime`` with a fixed ``now()``; everything else is the real class.

    Subclassed rather than mocked because the endpoint also calls
    ``datetime.combine``, which has to keep working.
    """

    @classmethod
    def now(cls, tz=None):
        fixed = datetime(2026, 10, 4, 16, 0, tzinfo=timezone.utc)
        return fixed if tz is not None else fixed.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_thirty_day_event_window_ends_at_a_local_midnight_across_dst():
    """The window is 30 department days, not 30x24h.

    ``local_midnight`` is already a UTC instant, so adding ``timedelta(days=30)``
    to it lands on 23:00 or 01:00 local whenever a DST transition falls inside
    the window, moving an event in that hour into or out of the next reporting
    period.

    The clock is frozen on purpose. With the real one this assertion would hold
    for most of the year under the arithmetic it is meant to reject, so the
    fixed date puts the US DST end (2026-11-01) inside the 30 days and makes the
    check mean the same thing in June as in October.
    """
    org_tz = ZoneInfo("America/New_York")

    with patch("app.api.v1.endpoints.dashboard.datetime", _FrozenDatetime):
        _, db = await _call(
            _user("events.manage"),
            ["events"],
            [
                _result(scalar=SimpleNamespace(timezone="America/New_York")),
                _result(row=(0, None)),
            ],
        )

    params = db.execute.await_args_list[1].args[0].compile().params
    bounds = sorted(v for v in params.values() if isinstance(v, datetime))
    assert len(bounds) == 2, f"expected a start and an end bound, got {bounds}"
    start, end = bounds

    # EDT on 4 October, EST on 3 November: both are local midnight, and the
    # two instants are 30 days and one hour apart because the department
    # gained an hour in between.
    assert start.astimezone(org_tz).date() == date(2026, 10, 4)
    assert end.astimezone(org_tz).date() == date(2026, 11, 3)
    assert start.astimezone(org_tz).time() == time.min
    assert end.astimezone(org_tz).time() == time.min, (
        "the window ends at "
        f"{end.astimezone(org_tz).time()} local, not midnight — the boundary "
        "was computed by UTC arithmetic rather than a local-day shift"
    )
