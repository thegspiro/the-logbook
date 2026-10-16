"""Equipment-check update endpoints refuse an explicit ``null`` on a NOT NULL column.

The three ``*Update`` schemas in ``app/schemas/equipment_check.py`` type every
field ``Optional`` so a PUT can omit it, and each handler dumps with
``exclude_unset``, so a ``null`` that *was* sent reaches the service. For the
item update that lands in ``apply_updates``, which refuses it. The template and
compartment updates applied their changes with a bare ``setattr`` loop, which
wrote the ``None`` onto the row and let the database reject it at commit -- an
``IntegrityError`` surfaced as a 500 instead of the 400 the handler already
returns for a ``ValueError``.

Driven over HTTP against the real schema, because a mocked session never
evaluates a constraint and the status code is what is under test. The
parametrization is derived from the schema and the model, so a new NOT NULL
column becomes a new case the day it is added. The nullable half is paired with
it: without it, a guard that rejected *every* null would pass this file.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import equipment_check as equipment_check_endpoints
from app.core.database import get_db
from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.user import User
from app.schemas.equipment_check import (
    CheckTemplateCompartmentUpdate,
    CheckTemplateItemUpdate,
    EquipmentCheckTemplateUpdate,
)

pytestmark = [pytest.mark.integration]

# A NOT NULL column the update schema can name, minus the ones the service
# refuses for a reason of its own before the null is reached.
_ITEM_HANDLED_ELSEWHERE = {"compartment_id"}


def _not_null_fields(schema, model, exclude=frozenset()) -> list[str]:
    required = {c.key for c in model.__table__.columns if not c.nullable}
    return sorted((set(schema.model_fields) & required) - exclude)


class _Bench:
    def __init__(self, user: User, template_id: str, comp_id: str, item_id: str):
        self.user = user
        self.template_id = template_id
        self.compartment_id = comp_id
        self.item_id = item_id


@pytest.fixture
async def bench(db_session: AsyncSession) -> _Bench:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Check Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"check-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Check Officer', 'check_officer', "
            '\'["inventory.check_manage", "inventory.check_view"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )

    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Engine 1 daily",
        description="Start of shift",
        check_timing="start_of_shift",
        template_type="equipment",
        is_active=False,
    )
    db_session.add(template)
    await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=str(uuid.uuid4()),
        template_id=template.id,
        name="Driver side",
        description="Cab",
    )
    db_session.add(compartment)
    await db_session.flush()
    item = CheckTemplateItem(
        id=str(uuid.uuid4()),
        compartment_id=compartment.id,
        name="Halligan",
        description="Forcible entry",
    )
    db_session.add(item)
    await db_session.flush()

    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])
    return _Bench(user, template.id, compartment.id, item.id)


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(equipment_check_endpoints.router, prefix="/checks")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    # An escaped exception must come back as the 500 a caller would see, not be
    # re-raised into the test, or the status code could never be asserted.
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


def _path(bench: _Bench, kind: str) -> str:
    return {
        "template": f"/checks/templates/{bench.template_id}",
        "compartment": f"/checks/compartments/{bench.compartment_id}",
        "item": f"/checks/items/{bench.item_id}",
    }[kind]


CASES = (
    [
        ("template", f)
        for f in _not_null_fields(EquipmentCheckTemplateUpdate, EquipmentCheckTemplate)
    ]
    + [
        ("compartment", f)
        for f in _not_null_fields(
            CheckTemplateCompartmentUpdate, CheckTemplateCompartment
        )
    ]
    + [
        ("item", f)
        for f in _not_null_fields(
            CheckTemplateItemUpdate, CheckTemplateItem, _ITEM_HANDLED_ELSEWHERE
        )
    ]
)


class TestClearingARequiredColumnIsRefused:
    def test_cases_are_derived_not_empty(self):
        assert {kind for kind, _ in CASES} == {"template", "compartment", "item"}

    @pytest.mark.parametrize(("kind", "field"), CASES)
    async def test_null_is_a_400_or_422_not_a_500(
        self, db_session: AsyncSession, bench: _Bench, kind: str, field: str
    ):
        async with _client(db_session, bench.user) as client:
            resp = await client.put(_path(bench, kind), json={field: None})
        # Exactly 400/422, not any 4xx: a 404/405 from a wrong route would
        # otherwise satisfy this and prove nothing about the guard.
        assert resp.status_code in (400, 422), (kind, field, resp.status_code)

    async def test_item_compartment_id_null_is_refused(
        self, db_session: AsyncSession, bench: _Bench
    ):
        async with _client(db_session, bench.user) as client:
            resp = await client.put(_path(bench, "item"), json={"compartment_id": None})
        assert resp.status_code in (400, 422), resp.status_code


class TestNullableColumnsStillClear:
    async def test_template_description_clears(
        self, db_session: AsyncSession, bench: _Bench
    ):
        async with _client(db_session, bench.user) as client:
            resp = await client.put(
                _path(bench, "template"), json={"description": None}
            )
        assert resp.status_code == 200, resp.text
        row = await db_session.get(EquipmentCheckTemplate, bench.template_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.description is None
        assert row.name == "Engine 1 daily"

    async def test_compartment_description_clears(
        self, db_session: AsyncSession, bench: _Bench
    ):
        async with _client(db_session, bench.user) as client:
            resp = await client.put(
                _path(bench, "compartment"), json={"description": None}
            )
        assert resp.status_code == 200, resp.text
        row = await db_session.get(CheckTemplateCompartment, bench.compartment_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.description is None
        assert row.name == "Driver side"

    async def test_item_description_clears(
        self, db_session: AsyncSession, bench: _Bench
    ):
        async with _client(db_session, bench.user) as client:
            resp = await client.put(_path(bench, "item"), json={"description": None})
        assert resp.status_code == 200, resp.text
        row = await db_session.get(CheckTemplateItem, bench.item_id)
        assert row is not None
        await db_session.refresh(row)
        assert row.description is None
        assert row.name == "Halligan"
