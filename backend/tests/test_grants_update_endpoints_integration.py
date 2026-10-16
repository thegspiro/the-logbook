"""Every grants / fundraising PUT saves the change and answers 200, and a ``null`` it
cannot store is refused.

``updated_at`` on these models is ``onupdate=func.now()``, a server-side
expression that MySQL and MariaDB cannot return from an UPDATE, so SQLAlchemy
expires it and the first read lazy-loads, which an async session cannot do. Eight
of the ten PUT services returned the instance straight after ``flush()``, so the
response model failed on ``updated_at``, the request answered 500, and the
session's rollback discarded the update: the change was neither saved nor
reported as failed in any way a user could act on.

Driven over HTTP against the real schema with a ``get_db`` that commits on
success and rolls back on an exception, as ``DatabaseManager.get_session`` does.
A session that never rolls back would have shown the 500 but hidden that the
write was lost, and a mocked session evaluates neither the onupdate expression
nor the response model.

The null cases are derived from update schema and model, so a new column becomes a
new case. They are paired: a NOT NULL column must be refused with exactly 400 or
422 and keep its value, and a nullable one must still accept the null and read
back. A guard that refused every null, or none, would fail one half.
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import date, datetime, timezone
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import grants as endpoints
from app.core.database import get_db
from app.models import grant as models
from app.models.user import User
from app.schemas import grant as schemas

pytestmark = [pytest.mark.integration]

# kind -> (model, update schema, path, needs a parent application,
#          a field whose value a real change can be made to)
_KINDS: dict[str, tuple[Any, Any, str, bool, str]] = {
    "opportunity": (
        models.GrantOpportunity,
        schemas.GrantOpportunityUpdate,
        "/grants/{id}",
        False,
        "description",
    ),
    "application": (
        models.GrantApplication,
        schemas.GrantApplicationUpdate,
        "/grants/applications/{id}",
        False,
        "notes",
    ),
    "budget_item": (
        models.GrantBudgetItem,
        schemas.GrantBudgetItemUpdate,
        "/grants/budget-items/{id}",
        True,
        "notes",
    ),
    "expenditure": (
        models.GrantExpenditure,
        schemas.GrantExpenditureUpdate,
        "/grants/expenditures/{id}",
        True,
        "notes",
    ),
    "compliance_task": (
        models.GrantComplianceTask,
        schemas.GrantComplianceTaskUpdate,
        "/grants/compliance-tasks/{id}",
        True,
        "notes",
    ),
    "campaign": (
        models.FundraisingCampaign,
        schemas.CampaignUpdate,
        "/grants/campaigns/{id}",
        False,
        "description",
    ),
    "donor": (
        models.Donor,
        schemas.DonorUpdate,
        "/grants/donors/{id}",
        False,
        "notes",
    ),
    "donation": (
        models.Donation,
        schemas.DonationUpdate,
        "/grants/donations/{id}",
        False,
        "notes",
    ),
    "pledge": (
        models.Pledge,
        schemas.PledgeUpdate,
        "/grants/pledges/{id}",
        False,
        "notes",
    ),
    "fundraising_event": (
        models.FundraisingEvent,
        schemas.FundraisingEventUpdate,
        "/grants/fundraising-events/{id}",
        False,
        "description",
    ),
}


def _required_value(column: Any, organization_id: str) -> Any:
    if column.key == "organization_id":
        return organization_id
    if getattr(column.type, "enums", None):
        return column.type.enums[0]
    python_type = column.type.python_type
    if python_type is datetime:
        return datetime(2026, 1, 1, tzinfo=timezone.utc)
    if python_type is date:
        return date(2026, 1, 1)
    if python_type is int:
        return 1
    if python_type.__name__ == "Decimal":
        return 10
    if python_type is str:
        return "Bench"
    raise AssertionError(f"no bench value for {column.table.name}.{column.key}")


def _build(model: Any, organization_id: str, **extra: Any) -> Any:
    values = {
        c.key: _required_value(c, organization_id)
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

    async def make(self, kind: str) -> str:
        model, _update, _path, needs_parent, _field = _KINDS[kind]
        extra: dict[str, Any] = {}
        if needs_parent:
            parent = _build(models.GrantApplication, self.organization_id)
            self.db.add(parent)
            await self.db.flush()
            extra["application_id"] = parent.id
        row = _build(model, self.organization_id, **extra)
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
            "VALUES (:id, 'Grants Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"grants-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Fundraising Officer', 'fundraising_officer', "
            '\'["fundraising.manage", "fundraising.view"]\')'
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
    app.include_router(endpoints.router, prefix="/grants")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = get_session_like
    # An escaped exception must come back as the 500 a caller would see, not be
    # re-raised into the test, or the status code could never be asserted.
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, user, client)


class TestARealChangeIsSavedAndAnswered:
    @pytest.mark.parametrize("kind", sorted(_KINDS))
    async def test_put_answers_200_and_persists(self, bench: _Bench, kind: str) -> None:
        field = _KINDS[kind][4]
        row_id = await bench.make(kind)
        path = _KINDS[kind][2].format(id=row_id)
        response = await bench.client.put(path, json={field: "Changed by officer"})
        await bench.reset()
        assert response.status_code == 200, response.text
        assert await bench.stored(kind, row_id, field) == "Changed by officer"


def _null_cases(index: int):
    cases = []
    for kind, (model, update, *_rest) in _KINDS.items():
        columns = {c.key: c for c in model.__table__.columns}
        for name in sorted(update.model_fields):
            column = columns.get(name)
            if column is None:
                continue
            if (not column.nullable) == (index == 0):
                cases.append(pytest.param(kind, name, id=f"{kind}.{name}"))
    return cases


class TestNullForANotNullColumn:
    @pytest.mark.parametrize(("kind", "name"), _null_cases(0))
    async def test_is_refused_and_the_value_survives(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        row_id = await bench.make(kind)
        before = await bench.stored(kind, row_id, name)
        path = _KINDS[kind][2].format(id=row_id)
        response = await bench.client.put(path, json={name: None})
        await bench.reset()
        assert response.status_code in (400, 422), response.text
        assert await bench.stored(kind, row_id, name) == before


class TestNullForANullableColumn:
    @pytest.mark.parametrize(("kind", "name"), _null_cases(1))
    async def test_is_accepted_and_answered_200(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        row_id = await bench.make(kind)
        path = _KINDS[kind][2].format(id=row_id)
        response = await bench.client.put(path, json={name: None})
        await bench.reset()
        # The 200 is the proof the row reads back: the handler has already run
        # the response model over the post-update row.
        assert response.status_code == 200, response.text
