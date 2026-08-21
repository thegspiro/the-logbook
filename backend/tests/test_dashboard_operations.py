from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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
