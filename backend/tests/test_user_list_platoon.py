"""``UserListResponse`` declares ``platoon``, ``member_class``, ``member_status``
and ``compliance_exempt`` (the last three since the membership-tier split), but
``UserService.get_users_for_organization`` only ever set a subset of the
model's columns into the dict it builds each row from — the rest silently came
back as the schema's default regardless of what was actually stored.

``platoon`` is the one with a real, broken consumer:
``PlatoonRosterPanel.tsx`` reads ``u.platoon`` straight off ``GET /users`` to
seed its "current assignment" column, so every member showed as unassigned on
load. This asserts the service call site actually forwards it. DB mocked; no
MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.user_service import UserService


def _user(**overrides):
    defaults = dict(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        username="jdoe",
        first_name="Jane",
        middle_name=None,
        last_name="Doe",
        full_name="Jane Doe",
        membership_number="M-100",
        photo_url=None,
        status=SimpleNamespace(value="active"),
        membership_type="active",
        hire_date=None,
        rank="firefighter",
        station="1",
        platoon="B",
        email="jane@example.com",
        phone=None,
        mobile=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _db_returning(users):
    result = MagicMock()
    result.scalars.return_value.all.return_value = users
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_platoon_is_forwarded_from_the_real_column():
    """A member's stored platoon must survive into the roster response —
    without this, PlatoonRosterPanel's "current assignment" column is blank
    for every member regardless of what is actually on file."""
    member = _user(platoon="C")
    service = UserService(_db_returning([member]))

    responses = await service.get_users_for_organization(member.organization_id)

    assert len(responses) == 1
    assert responses[0].platoon == "C"


@pytest.mark.asyncio
async def test_platoon_of_none_round_trips_as_none():
    member = _user(platoon=None)
    service = UserService(_db_returning([member]))

    responses = await service.get_users_for_organization(member.organization_id)

    assert responses[0].platoon is None
