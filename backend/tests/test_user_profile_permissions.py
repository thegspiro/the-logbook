"""Authorization regression tests for member profile updates."""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import update_user_profile
from app.schemas.user import UserUpdate


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


@pytest.mark.asyncio
async def test_users_edit_cannot_change_anothers_hire_date():
    """Tier-eligibility hire dates require members.manage."""
    caller_id = uuid4()
    target_id = uuid4()
    caller = SimpleNamespace(
        id=str(caller_id),
        organization_id=str(uuid4()),
        rank=None,
        positions=[SimpleNamespace(permissions=["users.edit"])],
    )
    target = SimpleNamespace(id=str(target_id), rank=None)
    db = AsyncMock()
    db.execute.side_effect = [
        _Result(caller),
        _Result(target),
        _Result(caller),
    ]

    with pytest.raises(HTTPException) as exc:
        await update_user_profile(
            target_id,
            UserUpdate(hire_date=date(1980, 1, 1)),
            db,
            caller,
        )

    assert exc.value.status_code == 403
    assert "hire date" in exc.value.detail
    db.commit.assert_not_awaited()
