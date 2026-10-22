"""``PATCH /reports/saved/{id}`` saves the change, answers 200, and refuses a
``null`` it cannot store.

Driven over HTTP against the real schema with a ``get_db`` that commits on success
and rolls back on an exception, as ``DatabaseManager.get_session`` does: a session
that never rolls back would hide a request that answered 500 and lost its write,
and a mocked session evaluates neither the ``onupdate`` expression nor the
response model.

The null cases are derived from the update schema and the model, so a new column
becomes a new case. A NOT NULL column must be refused with exactly 400 or 422 and
keep its value; a nullable one must accept the null. A guard that refused every
null, or none, would fail one half.
"""

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import reports as endpoints
from app.core.database import get_db
from app.models.analytics import SavedReport
from app.models.user import User
from app.schemas.reports import SavedReportUpdate

pytestmark = [pytest.mark.integration]


class _Bench:
    def __init__(self, db: AsyncSession, user: User, client: AsyncClient):
        self.db = db
        self.user = user
        self.client = client

    async def reset(self) -> None:
        """A rollback expires the caller; reload it before the next request."""
        self.db.expire_all()
        await self.db.refresh(self.user)
        await self.db.refresh(self.user, ["positions"])

    async def make(self, **fields: Any) -> str:
        row = SavedReport(
            organization_id=str(self.user.organization_id),
            name="Monthly attendance",
            report_type="event_attendance",
            created_by=str(self.user.id),
            **fields,
        )
        self.db.add(row)
        await self.db.flush()
        row_id = str(row.id)
        await self.db.commit()
        await self.reset()
        return row_id

    async def stored(self, row_id: str, column: str) -> Any:
        await self.reset()
        return (
            await self.db.execute(
                text(f"SELECT {column} FROM saved_reports WHERE id = :i"),
                {"i": row_id},
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
            "VALUES (:id, 'Reports Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"reports-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Reports Officer', 'reports_officer', "
            '\'["reports.manage", "reports.view"]\')'
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
    app.include_router(endpoints.router, prefix="/reports")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, user, client)


class TestARealChangeIsSavedAndAnswered:
    async def test_rename_is_saved(self, bench: _Bench) -> None:
        row_id = await bench.make()
        response = await bench.client.patch(
            f"/reports/saved/{row_id}", json={"name": "Quarterly attendance"}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored(row_id, "name") == "Quarterly attendance"

    async def test_turning_a_schedule_off_clears_the_next_run(
        self, bench: _Bench
    ) -> None:
        row_id = await bench.make()
        scheduled = await bench.client.patch(
            f"/reports/saved/{row_id}",
            json={
                "is_scheduled": True,
                "schedule_frequency": "monthly",
                "schedule_day": 1,
                "email_recipients": [f"officer-{uuid.uuid4().hex[:6]}@test.example"],
            },
        )
        await bench.reset()
        assert scheduled.status_code == 200, scheduled.text
        assert await bench.stored(row_id, "next_run_date") is not None
        off = await bench.client.patch(
            f"/reports/saved/{row_id}", json={"is_scheduled": False}
        )
        await bench.reset()
        assert off.status_code == 200, off.text
        assert await bench.stored(row_id, "next_run_date") is None


def _null_cases(not_null: bool):
    columns = {c.key: c for c in SavedReport.__table__.columns}
    return [
        pytest.param(name, id=name)
        for name in sorted(SavedReportUpdate.model_fields)
        if name in columns and (not columns[name].nullable) == not_null
    ]


class TestNullForANotNullColumn:
    @pytest.mark.parametrize("name", _null_cases(True))
    async def test_is_refused_and_the_value_survives(
        self, bench: _Bench, name: str
    ) -> None:
        row_id = await bench.make()
        before = await bench.stored(row_id, name)
        response = await bench.client.patch(
            f"/reports/saved/{row_id}", json={name: None}
        )
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        assert await bench.stored(row_id, name) == before


class TestNullForANullableColumn:
    @pytest.mark.parametrize("name", _null_cases(False))
    async def test_is_accepted_and_answered_200(self, bench: _Bench, name: str) -> None:
        row_id = await bench.make()
        response = await bench.client.patch(
            f"/reports/saved/{row_id}", json={name: None}
        )
        await bench.reset()
        assert response.status_code == 200, response.text
