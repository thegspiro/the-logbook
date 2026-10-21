"""Admin-hours category, event-mapping and entry updates save the change, answer
200, and refuse a ``null`` they cannot store.

Driven over HTTP against the real schema with a ``get_db`` that commits on success
and rolls back on an exception, as ``DatabaseManager.get_session`` does: a session
that never rolls back would hide a request that answered 500 and lost its write,
and a mocked session evaluates neither the ``onupdate`` expression nor the
response model.

The null cases are derived from update schema and model, so a new column becomes a
new case. A NOT NULL column must be refused with exactly 400 or 422 and keep its
value; a nullable one must still accept the null. A guard that refused every null,
or none, would fail one half.
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
from app.api.v1.endpoints import admin_hours as endpoints
from app.core.database import get_db
from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
    EventHourMapping,
)
from app.models.user import User
from app.schemas.admin_hours import AdminHoursCategoryUpdate, EventHourMappingUpdate

pytestmark = [pytest.mark.integration]

# The model column, the endpoint path and the update schema for each updatable thing
# whose fields are all independent columns. Entry edits are separate: their service
# takes explicit parameters, where None means "leave alone" and a blank string clears.
_KINDS = {
    "category": (
        AdminHoursCategory,
        AdminHoursCategoryUpdate,
        "/admin-hours/categories",
    ),
    "mapping": (
        EventHourMapping,
        EventHourMappingUpdate,
        "/admin-hours/event-mappings",
    ),
}


class _Bench:
    def __init__(
        self, db: AsyncSession, user: User, owner_id: str, client: AsyncClient
    ):
        self.db = db
        self.user = user
        self.owner_id = owner_id
        self.client = client
        self.organization_id = str(user.organization_id)

    async def reset(self) -> None:
        """A rollback expires the caller; reload it before the next request."""
        self.db.expire_all()
        await self.db.refresh(self.user)
        await self.db.refresh(self.user, ["positions"])

    async def category(self) -> AdminHoursCategory:
        row = AdminHoursCategory(
            organization_id=self.organization_id,
            name=f"Station duty {uuid.uuid4().hex[:6]}",
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def make(self, kind: str) -> str:
        category = await self.category()
        if kind == "category":
            row_id = str(category.id)
        else:
            mapping = EventHourMapping(
                organization_id=self.organization_id,
                event_type="business_meeting",
                admin_hours_category_id=category.id,
                percentage=50,
            )
            self.db.add(mapping)
            await self.db.flush()
            row_id = str(mapping.id)
        await self.db.commit()
        await self.reset()
        return row_id

    async def pending_entry(self) -> str:
        category = await self.category()
        start = datetime.now(timezone.utc) - timedelta(hours=3)
        entry = AdminHoursEntry(
            organization_id=self.organization_id,
            user_id=self.owner_id,
            category_id=category.id,
            clock_in_at=start,
            clock_out_at=start + timedelta(hours=1),
            duration_minutes=60,
            entry_method=AdminHoursEntryMethod.MANUAL,
            status=AdminHoursEntryStatus.PENDING,
        )
        self.db.add(entry)
        await self.db.flush()
        entry_id = str(entry.id)
        await self.db.commit()
        await self.reset()
        return entry_id

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
    owner_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Admin Hours Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"hours-bench-{org_id[:8]}"},
    )
    for uid, label in ((user_id, "Officer"), (owner_id, "Member")):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Bench', :ln, :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "ln": label,
                "un": f"bench-{uid[:8]}",
                "em": f"bench-{uid[:8]}@test.example",
            },
        )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Hours Officer', 'hours_officer', "
            "'[\"admin_hours.manage\"]')"
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
    app.include_router(endpoints.router, prefix="/admin-hours")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, user, owner_id, client)


class TestARealChangeIsSavedAndAnswered:
    async def test_category_description_is_saved(self, bench: _Bench) -> None:
        row_id = await bench.make("category")
        response = await bench.client.patch(
            f"/admin-hours/categories/{row_id}", json={"description": "Hose testing"}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored("category", row_id, "description") == "Hose testing"

    async def test_mapping_percentage_is_saved(self, bench: _Bench) -> None:
        row_id = await bench.make("mapping")
        response = await bench.client.patch(
            f"/admin-hours/event-mappings/{row_id}", json={"percentage": 40}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored("mapping", row_id, "percentage") == 40

    async def test_officer_entry_edit_is_saved(self, bench: _Bench) -> None:
        entry_id = await bench.pending_entry()
        response = await bench.client.patch(
            f"/admin-hours/entries/{entry_id}", json={"description": "Corrected"}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        row = await bench.db.get(AdminHoursEntry, entry_id)
        assert row is not None
        assert row.description == "Corrected"


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
            f"{_KINDS[kind][2]}/{row_id}", json={name: None}
        )
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        assert await bench.stored(kind, row_id, name) == before


class TestNullForANullableColumn:
    @pytest.mark.parametrize(("kind", "name"), _null_cases(False))
    async def test_is_accepted_and_clears(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        row_id = await bench.make(kind)
        response = await bench.client.patch(
            f"{_KINDS[kind][2]}/{row_id}", json={name: None}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored(kind, row_id, name) is None
