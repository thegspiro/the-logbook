"""Form, field and integration updates refuse an explicit ``null`` they cannot store.

The ``*Update`` schemas type every field ``Optional`` so a PATCH can omit it, and
the service writes through ``apply_updates``, which refuses a ``null`` only for a
NOT NULL column. Two further shapes were open:

* a NOT NULL column (``name``, ``label``, ``field_type``, ``sort_order``,
  ``field_mappings``…) — ``apply_updates`` raises and the service answers 400;
* a **nullable** column behind a response field typed as a plain ``bool`` /
  ``str`` (``require_authentication``, ``is_public``, ``required``, ``width``,
  ``is_active``…) — the NULL was stored, the commit succeeded, and serializing the
  row failed, so the form's detail view and list answered 500 until someone
  repaired the row by hand. A NULL ``require_authentication`` is also falsy in the
  submit path.

Driven over HTTP against the real schema, because a mocked session never
evaluates a constraint or a response model. Both case lists are derived from the
schemas and models, so a new column becomes a new case the day it is added, and
the nullable half is paired with the refused half: a guard that refused every
null would pass the refusals and fail the clears.
"""

import typing
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import forms as endpoints
from app.core.database import get_db
from app.models.forms import Form, FormField, FormIntegration
from app.models.user import User
from app.schemas.forms import (
    FormFieldResponse,
    FormFieldUpdate,
    FormIntegrationResponse,
    FormIntegrationUpdate,
    FormResponse,
    FormUpdate,
)

pytestmark = [pytest.mark.integration]


def _accepts_null(response_model: type, name: str) -> bool:
    annotation = response_model.model_fields[name].annotation
    return type(None) in typing.get_args(annotation)


def _cases(update_schema: type, model: type, response_model: type):
    """(not_null, flags, clearable): what each update field's null must do."""
    columns = {c.key: c for c in model.__table__.columns}
    not_null: list[str] = []
    flags: list[str] = []
    clearable: list[str] = []
    for name in sorted(update_schema.model_fields):
        column = columns.get(name)
        if column is None:
            continue
        if not column.nullable:
            not_null.append(name)
        elif name in response_model.model_fields and not _accepts_null(
            response_model, name
        ):
            flags.append(name)
        else:
            clearable.append(name)
    return not_null, flags, clearable


_FORM = _cases(FormUpdate, Form, FormResponse)
_FIELD = _cases(FormFieldUpdate, FormField, FormFieldResponse)
_INTEGRATION = _cases(FormIntegrationUpdate, FormIntegration, FormIntegrationResponse)

# A null for these is meaningful: the column and the response both allow it.
_EXPECTED_FLAGS = {
    "form": {
        "allow_multiple_submissions",
        "is_public",
        "notify_on_submission",
        "require_authentication",
    },
    "field": {"required", "width"},
    "integration": {"is_active"},
}


class _Bench:
    def __init__(self, db_session: AsyncSession, user: User, client: AsyncClient):
        self.db = db_session
        self.user = user
        self.client = client
        self.form_id = ""
        self.field_id = ""
        self.integration_id = ""

    async def reset(self) -> None:
        """A service rollback expires the caller; reload it before the next request."""
        self.db.expire_all()
        await self.db.refresh(self.user)
        await self.db.refresh(self.user, ["positions"])

    async def make_form(self) -> None:
        created = await self.client.post(
            "/forms",
            json={
                "name": "Turnout Survey",
                "category": "operations",
                "fields": [{"label": "Station", "field_type": "text"}],
            },
        )
        assert created.status_code == 201, created.text
        self.form_id = created.json()["id"]
        self.field_id = created.json()["fields"][0]["id"]
        integration = await self.client.post(
            f"/forms/{self.form_id}/integrations",
            json={
                "target_module": "membership",
                "integration_type": "membership_interest",
                "field_mappings": {},
            },
        )
        assert integration.status_code == 201, integration.text
        self.integration_id = integration.json()["id"]

    def path(self, kind: str) -> str:
        base = f"/forms/{self.form_id}"
        if kind == "field":
            return f"{base}/fields/{self.field_id}"
        if kind == "integration":
            return f"{base}/integrations/{self.integration_id}"
        return base

    async def stored(self, table: str, row_id: str, column: str) -> Any:
        await self.reset()
        return (
            await self.db.execute(
                text(f"SELECT {column} FROM {table} WHERE id = :i"), {"i": row_id}
            )
        ).scalar()

    async def detail_status(self) -> int:
        await self.reset()
        return (await self.client.get(f"/forms/{self.form_id}")).status_code


@pytest.fixture
async def bench(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Forms Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"forms-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Forms Officer', 'forms_officer', "
            '\'["forms.manage", "forms.view"]\')'
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

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/forms")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    # An escaped exception must come back as the 500 a caller would see, not be
    # re-raised into the test, or the status code could never be asserted.
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        harness = _Bench(db_session, user, client)
        await harness.make_form()
        yield harness


_KINDS = {
    "form": (_FORM, "forms"),
    "field": (_FIELD, "form_fields"),
    "integration": (_INTEGRATION, "form_integrations"),
}


def _params(index: int):
    return [
        pytest.param(kind, name, id=f"{kind}.{name}")
        for kind, (cases, _table) in _KINDS.items()
        for name in cases[index]
    ]


def _row_id(bench: _Bench, kind: str) -> str:
    return {
        "form": bench.form_id,
        "field": bench.field_id,
        "integration": bench.integration_id,
    }[kind]


class TestTheCaseListsAreWhatWeThinkTheyAre:
    @pytest.mark.parametrize("kind", sorted(_KINDS))
    def test_the_derived_flags_match_the_known_ones(self, kind: str) -> None:
        # A new nullable-but-plain-typed column must be a deliberate addition
        # here, not something that slips through as a "clearable" field.
        assert set(_KINDS[kind][0][1]) == _EXPECTED_FLAGS[kind]


class TestNullForANotNullColumn:
    @pytest.mark.parametrize(("kind", "name"), _params(0))
    async def test_is_refused_and_the_value_survives(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        table = _KINDS[kind][1]
        before = await bench.stored(table, _row_id(bench, kind), name)
        response = await bench.client.patch(bench.path(kind), json={name: None})
        assert response.status_code in (400, 422), response.text
        assert await bench.stored(table, _row_id(bench, kind), name) == before
        assert await bench.detail_status() == 200


class TestNullForAFlagThatIsReadBackAsAPlainValue:
    @pytest.mark.parametrize(("kind", "name"), _params(1))
    async def test_is_refused_and_the_form_still_loads(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        table = _KINDS[kind][1]
        before = await bench.stored(table, _row_id(bench, kind), name)
        assert before is not None
        response = await bench.client.patch(bench.path(kind), json={name: None})
        assert response.status_code == 422, response.text
        assert await bench.stored(table, _row_id(bench, kind), name) == before
        assert await bench.detail_status() == 200
        listing = await bench.client.get("/forms")
        assert listing.status_code == 200

    @pytest.mark.parametrize(("kind", "name"), _params(1))
    async def test_omitting_the_key_still_leaves_it_alone(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        table = _KINDS[kind][1]
        before = await bench.stored(table, _row_id(bench, kind), name)
        response = await bench.client.patch(bench.path(kind), json=_another_edit(kind))
        assert response.status_code == 200, response.text
        assert await bench.stored(table, _row_id(bench, kind), name) == before


def _another_edit(kind: str) -> dict[str, Any]:
    return {
        "form": {"description": "Edited"},
        "field": {"help_text": "Edited"},
        "integration": {"field_mappings": {}},
    }[kind]


class TestNullForANullableColumnStillClears:
    @pytest.mark.parametrize(("kind", "name"), _params(2))
    async def test_is_written_as_null(
        self, bench: _Bench, kind: str, name: str
    ) -> None:
        table = _KINDS[kind][1]
        seed = _seed_value(kind, name)
        if seed is not None:
            seeded = await bench.client.patch(bench.path(kind), json={name: seed})
            assert seeded.status_code == 200, seeded.text
            assert await bench.stored(table, _row_id(bench, kind), name) is not None
        response = await bench.client.patch(bench.path(kind), json={name: None})
        assert response.status_code == 200, response.text
        # A JSON column stores the JSON literal ``null`` rather than SQL NULL;
        # the ORM reads either back as None.
        cleared = await bench.stored(table, _row_id(bench, kind), name)
        assert cleared in (None, "null")
        assert await bench.detail_status() == 200


_SEEDS: dict[tuple[str, str], Any] = {
    ("form", "description"): "Pre-incident survey",
    ("form", "notification_emails"): ["chief@test.example"],
    ("form", "integration_type"): None,
    ("field", "placeholder"): "Engine 1",
    ("field", "help_text"): "Which station?",
    ("field", "default_value"): "1",
    ("field", "min_length"): 2,
    ("field", "max_length"): 40,
    ("field", "min_value"): 1,
    ("field", "max_value"): 9,
    ("field", "validation_pattern"): "^[A-Z]+$",
    ("field", "options"): [{"value": "a", "label": "A"}],
    ("field", "condition_value"): "yes",
    ("field", "condition_operator"): "equals",
    ("field", "condition_field_id"): None,
}


def _seed_value(kind: str, name: str) -> Any:
    return _SEEDS.get((kind, name))
