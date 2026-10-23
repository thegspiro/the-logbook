"""Event and event-template updates save the change, answer 200, and refuse a
``null`` they cannot store.

``update_event`` and ``update_template`` wrote the payload with a bare ``setattr``
loop, so an explicit ``null`` for a NOT NULL column (``title``, ``event_type``,
``start_datetime``, the ``requires_rsvp`` / ``is_mandatory`` flags and the rest)
was not a 400: ``update_event`` compared the nulled times first and raised a
``TypeError``, and everything else reached the flush as an ``IntegrityError``.
Both came back as a 500 and the change was rolled back.

Driven over HTTP against the real schema with a ``get_db`` that commits on success
and rolls back on an exception, as ``DatabaseManager.get_session`` does. The null
cases are derived from the update schemas and the models, so a new column becomes a
new case: a NOT NULL column must be refused with exactly 400 or 422 and keep its
value, and a nullable one must be accepted. A guard that refused every null, or none,
would fail one half.
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import event_requests as request_endpoints
from app.api.v1.endpoints import events as endpoints
from app.core.database import get_db
from app.models.event import (
    Event,
    EventExternalAttendee,
    EventRSVP,
    EventTemplate,
    RSVPStatus,
)
from app.models.event_request import EventRequestEmailTemplate
from app.models.user import User
from app.schemas.event import EventTemplateUpdate, EventUpdate
from app.schemas.event_request import EmailTemplateUpdate

pytestmark = [pytest.mark.integration]

_KINDS = {
    "event": (Event, EventUpdate, "/events/{id}"),
    "template": (EventTemplate, EventTemplateUpdate, "/events/templates/{id}"),
    "request_email_template": (
        EventRequestEmailTemplate,
        EmailTemplateUpdate,
        "/event-requests/email-templates/{id}",
    ),
}
_RENAME = {"event": "title", "template": "name", "request_email_template": "name"}


def _required_value(column: Any, organization_id: str, start: datetime) -> Any:
    if column.key == "organization_id":
        return organization_id
    if getattr(column.type, "enums", None):
        return column.type.enums[0]
    python_type = column.type.python_type
    if python_type is datetime:
        end = column.key == "end_datetime"
        return start + timedelta(hours=1 if end else 0)
    if python_type is str:
        return "Bench"
    if python_type is int:
        return 1
    if python_type is bool:
        return False
    raise AssertionError(f"no bench value for {column.table.name}.{column.key}")


def _build(model: Any, organization_id: str, **extra: Any) -> Any:
    start = datetime.now(timezone.utc) + timedelta(days=3)
    values = {
        c.key: _required_value(c, organization_id, start)
        for c in model.__table__.columns
        if not (c.primary_key or c.nullable)
        and c.default is None
        and c.server_default is None
    }
    values.update(extra)
    return model(**values)


class _Bench:
    def __init__(self, db: AsyncSession, user: User, client: AsyncClient):
        self.db = db
        self.user = user
        self.client = client
        self.organization_id = str(user.organization_id)

    async def reset(self) -> None:
        """A rollback expires the caller; reload it before the next request."""
        self.db.expire_all()
        await self.db.refresh(self.user)
        await self.db.refresh(self.user, ["positions"])

    async def make(self, kind: str, **extra: Any) -> str:
        row = _build(_KINDS[kind][0], self.organization_id, **extra)
        self.db.add(row)
        await self.db.flush()
        row_id = str(row.id)
        await self.db.commit()
        await self.reset()
        return row_id

    async def stored(self, kind: str, row_id: str, column: str) -> Any:
        await self.reset()
        table = _KINDS[kind][0].__tablename__
        return (
            await self.db.execute(
                text(f"SELECT {column} FROM {table} WHERE id = :i"), {"i": row_id}
            )
        ).scalar()


@pytest.fixture
async def bench(db_session: AsyncSession) -> AsyncGenerator[_Bench]:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Events Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"events-bench-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Bench', 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"bench-{user_id[:8]}",
            "em": f"bench-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Events Officer', 'events_officer', "
            '\'["events.manage", "events.view"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])

    async def get_session_like() -> AsyncGenerator[AsyncSession]:
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app = FastAPI()
    app.include_router(request_endpoints.router)
    app.include_router(endpoints.router, prefix="/events")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, user, client)


class TestARealChangeIsSavedAndAnswered:
    @pytest.mark.parametrize("kind", sorted(_KINDS))
    async def test_rename_is_saved(self, bench: _Bench, kind: str) -> None:
        row_id = await bench.make(kind)
        column = _RENAME[kind]
        response = await bench.client.patch(
            _KINDS[kind][2].format(id=row_id), json={column: "Renamed by officer"}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored(kind, row_id, column) == "Renamed by officer"

    async def test_an_rsvp_override_is_saved(self, bench: _Bench) -> None:
        event_id = await bench.make("event")
        member_id = str(bench.user.id)
        rsvp = EventRSVP(
            organization_id=bench.organization_id,
            event_id=event_id,
            user_id=member_id,
            status=RSVPStatus.GOING,
        )
        bench.db.add(rsvp)
        await bench.db.flush()
        rsvp_id = str(rsvp.id)
        await bench.db.commit()
        await bench.reset()
        response = await bench.client.patch(
            f"/events/{event_id}/rsvps/{member_id}/override",
            json={"override_duration_minutes": 90},
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        row = await bench.db.get(EventRSVP, rsvp_id)
        assert row is not None
        assert row.override_duration_minutes == 90


def _null_cases(not_null: bool):
    cases = []
    for kind, (model, update, _path) in _KINDS.items():
        columns = {c.key: c for c in model.__table__.columns}
        for name in sorted(update.model_fields):
            column = columns.get(name)
            if column is not None and (not column.nullable) == not_null:
                cases.append(pytest.param(kind, name, id=f"{kind}.{name}"))
    return cases


class TestNullForANotNullColumn:
    @pytest.mark.parametrize(("kind", "name"), _null_cases(True))
    async def test_is_refused_and_the_value_survives(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        row_id = await bench.make(kind)
        before = await bench.stored(kind, row_id, name)
        response = await bench.client.patch(
            _KINDS[kind][2].format(id=row_id), json={name: None}
        )
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        assert await bench.stored(kind, row_id, name) == before


class TestNullForANullableColumn:
    @pytest.mark.parametrize(("kind", "name"), _null_cases(False))
    async def test_is_accepted_and_answered_200(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        row_id = await bench.make(kind)
        response = await bench.client.patch(
            _KINDS[kind][2].format(id=row_id), json={name: None}
        )
        await bench.reset()
        assert response.status_code == 200, response.text


class TestASeriesUpdateRefusesTheSameNulls:
    async def test_update_future_refuses_a_null_title(self, bench: _Bench) -> None:
        row_id = await bench.make("event")
        before = await bench.stored("event", row_id, "title")
        response = await bench.client.patch(
            f"/events/{row_id}/update-future", json={"title": None}
        )
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        assert await bench.stored("event", row_id, "title") == before

    async def test_update_future_still_saves_a_real_change(self, bench: _Bench) -> None:
        row_id = await bench.make("event")
        response = await bench.client.patch(
            f"/events/{row_id}/update-future", json={"title": "Series retitled"}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored("event", row_id, "title") == "Series retitled"


class TestAnExternalAttendeeEditRefusesANullName:
    async def _attendee(self, bench: _Bench) -> tuple[str, str]:
        event_id = await bench.make("event")
        attendee = EventExternalAttendee(
            organization_id=bench.organization_id,
            event_id=event_id,
            name="Guest Speaker",
            email="guest@test.example",
        )
        bench.db.add(attendee)
        await bench.db.flush()
        attendee_id = str(attendee.id)
        await bench.db.commit()
        await bench.reset()
        return event_id, attendee_id

    async def test_a_null_name_is_refused_and_the_name_survives(
        self, bench: _Bench
    ) -> None:
        event_id, attendee_id = await self._attendee(bench)
        response = await bench.client.patch(
            f"/events/{event_id}/external-attendees/{attendee_id}",
            json={"name": None},
        )
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        row = await bench.db.get(EventExternalAttendee, attendee_id)
        assert row is not None
        assert row.name == "Guest Speaker"

    async def test_a_null_email_still_clears_it(self, bench: _Bench) -> None:
        event_id, attendee_id = await self._attendee(bench)
        response = await bench.client.patch(
            f"/events/{event_id}/external-attendees/{attendee_id}",
            json={"email": None},
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        row = await bench.db.get(EventExternalAttendee, attendee_id)
        assert row is not None
        assert row.email is None
