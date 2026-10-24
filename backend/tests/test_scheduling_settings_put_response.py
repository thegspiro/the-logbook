"""The PUT /scheduling/settings response reports what was saved.

It used to assemble its own response from the update's return value and left
``pre_shift_work_enabled`` out, so the schema default (True) came back: an
admin switched pre-shift work off, the database stored False, and the toggle
redrew as On. GET and PUT now share one builder.
"""

import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import scheduling as scheduling_endpoints
from app.schemas.scheduling import SchedulingFeatureSettings

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest.fixture
async def org_id(db_session: AsyncSession) -> str:
    oid = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Settings FD', 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {"id": oid, "slug": f"settings-{oid[:8]}", "settings": json.dumps({})},
    )
    await db_session.flush()
    return oid


@pytest.fixture
def caller(org_id, monkeypatch):
    # The call-type usage maps are permission-gated; they are not what this
    # test is about, so the caller simply does not see them.
    monkeypatch.setattr(
        scheduling_endpoints, "user_has_permission", lambda *_a, **_k: False
    )
    return SimpleNamespace(id=str(uuid.uuid4()), organization_id=org_id)


async def test_switching_pre_shift_work_off_reports_off(db_session, caller):
    response = await scheduling_endpoints.update_scheduling_feature_settings(
        data=SchedulingFeatureSettings(pre_shift_work_enabled=False),
        db=db_session,
        current_user=caller,
    )

    assert response.pre_shift_work_enabled is False


async def test_put_and_get_return_the_same_settings(db_session, caller):
    saved = await scheduling_endpoints.update_scheduling_feature_settings(
        data=SchedulingFeatureSettings(
            pre_shift_work_enabled=False,
            platoons_enabled=True,
            late_signup_grace_minutes=15,
        ),
        db=db_session,
        current_user=caller,
    )
    read = await scheduling_endpoints.get_scheduling_feature_settings(
        db=db_session, current_user=caller
    )

    assert saved.model_dump() == read.model_dump()
