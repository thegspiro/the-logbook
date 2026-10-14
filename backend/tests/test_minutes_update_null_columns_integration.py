"""Minutes update endpoints answer an explicit ``null`` on a NOT NULL column with a 400/422.

Every ``*Update`` schema in ``app/schemas/minute.py`` types its fields
``Optional``, but several of the columns behind them are ``NOT NULL``. A client
that sends ``{"name": null}`` has to be refused cleanly. The minutes, motion and
action-item handlers do that through ``handle_service_errors``; the template
handler had no such wrapper, so the ``ValueError`` that ``apply_updates`` raises
for a cleared NOT NULL column escaped as an unhandled 500.

Driven over HTTP against the real schema because a mocked session never
evaluates a constraint, and because the status code is the thing under test.
The nullable half is paired with the NOT NULL half on purpose: without it, a
guard that rejected *every* null would pass this file.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import minutes as minutes_endpoints
from app.core.database import get_db
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesMeetingType,
    MinutesStatus,
    MinutesTemplate,
    Motion,
    MotionStatus,
)
from app.models.user import User

pytestmark = [pytest.mark.integration]


class _Desk:
    def __init__(
        self, user: User, minutes_id: str, motion_id: str, item_id: str, tpl_id: str
    ):
        self.user = user
        self.minutes_id = minutes_id
        self.motion_id = motion_id
        self.item_id = item_id
        self.template_id = tpl_id


@pytest.fixture
async def desk(db_session: AsyncSession) -> _Desk:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Minutes Desk', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"minutes-desk-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Desk', 'Secretary', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"desk-{user_id[:8]}",
            "em": f"desk-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Secretary', 'secretary', "
            '\'["minutes.view", "minutes.manage"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )

    minutes = MeetingMinutes(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title="October business meeting",
        meeting_type=MinutesMeetingType.BUSINESS,
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        location="Station 1",
        status=MinutesStatus.DRAFT,
    )
    db_session.add(minutes)
    await db_session.flush()
    motion = Motion(
        id=str(uuid.uuid4()),
        minutes_id=minutes.id,
        order=1,
        motion_text="Buy a hose",
        moved_by="Alex",
        status=MotionStatus.PASSED,
    )
    item = ActionItem(
        id=str(uuid.uuid4()),
        minutes_id=minutes.id,
        description="Order the hose",
        assignee_name="Alex",
    )
    template = MinutesTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Business template",
        description="Used monthly",
        meeting_type=MinutesMeetingType.BUSINESS,
        sections=[{"order": 0, "key": "call", "title": "Call to order"}],
    )
    db_session.add_all([motion, item, template])
    await db_session.flush()

    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])
    return _Desk(user, minutes.id, motion.id, item.id, template.id)


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(minutes_endpoints.router, prefix="/minutes")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    # An escaped exception must come back as the 500 a caller would see, not be
    # re-raised into the test, or the status code could never be asserted.
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


def _path(desk: _Desk, kind: str) -> str:
    return {
        "minutes": f"/minutes/{desk.minutes_id}",
        "motion": f"/minutes/{desk.minutes_id}/motions/{desk.motion_id}",
        "action_item": f"/minutes/{desk.minutes_id}/action-items/{desk.item_id}",
        "template": f"/minutes/templates/{desk.template_id}",
    }[kind]


NOT_NULL_FIELDS = [
    ("minutes", "title"),
    ("minutes", "meeting_type"),
    ("minutes", "meeting_date"),
    ("motion", "motion_text"),
    ("motion", "order"),
    ("motion", "status"),
    ("action_item", "description"),
    ("action_item", "priority"),
    ("action_item", "status"),
    ("template", "name"),
    ("template", "meeting_type"),
    ("template", "is_default"),
    ("template", "sections"),
]


class TestClearingARequiredColumnIsRefused:
    @pytest.mark.parametrize(("kind", "field"), NOT_NULL_FIELDS)
    async def test_null_is_a_4xx_not_a_500(
        self, db_session: AsyncSession, desk: _Desk, kind: str, field: str
    ):
        async with _client(db_session, desk.user) as client:
            resp = await client.put(_path(desk, kind), json={field: None})
        # Exactly 400/422, not any 4xx: a 404/405 from a wrong route would
        # otherwise satisfy this and prove nothing about the guard.
        assert resp.status_code in (400, 422), (kind, field, resp.status_code)


class TestNullableColumnsStillClear:
    async def test_minutes_location_clears(self, db_session: AsyncSession, desk: _Desk):
        async with _client(db_session, desk.user) as client:
            resp = await client.put(_path(desk, "minutes"), json={"location": None})
        assert resp.status_code == 200, resp.text
        row = await db_session.get(MeetingMinutes, desk.minutes_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.location is None
        assert row.title == "October business meeting"

    async def test_motion_moved_by_clears(self, db_session: AsyncSession, desk: _Desk):
        async with _client(db_session, desk.user) as client:
            resp = await client.put(_path(desk, "motion"), json={"moved_by": None})
        assert resp.status_code == 200, resp.text
        row = await db_session.get(Motion, desk.motion_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.moved_by is None
        assert row.motion_text == "Buy a hose"

    async def test_action_item_assignee_name_clears(
        self, db_session: AsyncSession, desk: _Desk
    ):
        async with _client(db_session, desk.user) as client:
            resp = await client.put(
                _path(desk, "action_item"), json={"assignee_name": None}
            )
        assert resp.status_code == 200, resp.text
        row = await db_session.get(ActionItem, desk.item_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.assignee_name is None
        assert row.description == "Order the hose"

    async def test_template_description_clears(
        self, db_session: AsyncSession, desk: _Desk
    ):
        async with _client(db_session, desk.user) as client:
            resp = await client.put(_path(desk, "template"), json={"description": None})
        assert resp.status_code == 200, resp.text
        row = await db_session.get(MinutesTemplate, desk.template_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.description is None
        assert row.name == "Business template"
