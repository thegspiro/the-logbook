"""Roles and users update endpoints refuse a ``null`` they cannot store, and never
store one a response cannot read back.

The update contract has three states (omit, clear, set), and an update schema types
every field ``Optional`` so a request can omit it, which lets an explicit ``null``
validate. What happens next depends on the handler: a NOT NULL column fails at the
flush (500), and a nullable column behind a response field that is not is stored and
then fails to serialize on every later read.

Driven over HTTP against the real schema. The update routes, their body schemas and
their response schemas come from the application's own OpenAPI document, and each row is
built from its model, so a new field becomes a new case the day it is added. The cases
are paired, so a guard that refused every null, or none, fails one half: a NOT NULL
column or a column the response requires must be refused with exactly 400 or 422 and
keep its value; anything else must still clear.
"""

import re
import uuid
from collections.abc import AsyncGenerator
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic.alias_generators import to_camel, to_snake
from sqlalchemy import null, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.api import api_router
from app.core.database import Base, get_db
from app.models.user import MemberLeaveOfAbsence, Position, User

pytestmark = [pytest.mark.integration]

# path template -> model. The last path parameter is the row's own id.
_ROUTES: dict[str, Any] = {
    "/roles/{role_id}": Position,
    "/users/{user_id}/profile": User,
    "/users/{user_id}/contact-info": User,
    "/users/leaves-of-absence/{leave_id}": MemberLeaveOfAbsence,
}


def _spec() -> dict[str, Any]:
    app = FastAPI()
    app.include_router(api_router)
    return app.openapi()


_SPEC = _spec()
_SCHEMAS = _SPEC["components"]["schemas"]


def _operation(path: str) -> tuple[str, dict[str, Any]]:
    ops = _SPEC["paths"][path]
    method = "patch" if "patch" in ops else "put"
    return method, ops[method]


def _ref(schema: dict[str, Any]) -> dict[str, Any]:
    name = schema.get("$ref", "").split("/")[-1]
    return _SCHEMAS.get(name, {})


def _body(path: str) -> dict[str, Any]:
    _, op = _operation(path)
    return _ref(op["requestBody"]["content"]["application/json"]["schema"])


def _response(path: str) -> dict[str, Any]:
    _, op = _operation(path)
    return _ref(op["responses"]["200"]["content"]["application/json"]["schema"])


def _response_needs_a_value(response: dict[str, Any], name: str) -> bool:
    """Whether the response model rejects ``null`` for *name*.

    A default does not make it nullable: ``active: bool = True`` still fails to
    serialize a stored NULL, so required-ness is not the test, the type is.
    """
    prop = response.get("properties", {}).get(name)
    if prop is None:
        return False
    options = prop.get("anyOf", [prop])
    return not any(option.get("type") == "null" for option in options)


def _wire_name(properties: dict[str, Any], column: str) -> str:
    """The key a schema serializes *column* under: finance responses are camelCase."""
    return to_camel(column) if to_camel(column) in properties else column


def _first_alternative(pattern: str | None) -> str | None:
    match = re.match(r"^\^\(([^)]*)\)\$$", pattern or "")
    return match.group(1).split("|")[0] if match else None


def _value_for(column: Any, prop: dict[str, Any]) -> Any:
    alternative = _first_alternative(prop.get("pattern"))
    if alternative:
        return alternative
    if "email" in column.key:
        return f"bench-{uuid.uuid4().hex[:8]}@test.example"
    if prop.get("type") == "array":
        return []
    if getattr(column.type, "enums", None):
        return column.type.enums[0]
    python_type = column.type.python_type
    if python_type is datetime:
        return datetime.now(timezone.utc)
    if python_type is date:
        return date(2026, 1, 1)
    if python_type is str:
        return "Bench"
    if python_type is bool:
        return False
    if python_type is int:
        return 1
    if python_type in (Decimal, float):
        return 1
    if python_type is list:
        return []
    if python_type in (dict, object):
        return {}
    raise AssertionError(f"no bench value for {column.table.name}.{column.key}")


def _model_for_table(name: str) -> Any:
    for mapper in Base.registry.mappers:
        if mapper.class_.__tablename__ == name:
            return mapper.class_
    raise KeyError(name)


# Encrypted JSON columns a fixture row stores as SQL NULL. Left to the ORM, a
# missing value is written as an encrypted JSON ``null``, and the database's own
# JSON_VALID check refuses that ciphertext, failing the insert rather than testing
# the update.
_LEFT_NULL: dict[str, tuple[str, ...]] = {"User": ("emergency_contacts",)}


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

    async def _build(
        self,
        model: Any,
        response: dict[str, Any],
        parents: dict[str, str],
    ) -> Any:
        props = response.get("properties", {})
        values: dict[str, Any] = {}
        for column in model.__table__.columns:
            if column.primary_key:
                continue
            wire = _wire_name(props, column.key)
            prop = props.get(wire, {})
            wanted = prop.get("pattern") or _response_needs_a_value(response, wire)
            required = (
                not column.nullable
                and column.default is None
                and column.server_default is None
            )
            if column.key in _LEFT_NULL.get(model.__name__, ()):
                values[column.key] = null()
                continue
            if not (required or wanted):
                continue
            if column.key == "organization_id":
                values[column.key] = self.organization_id
            elif column.foreign_keys:
                table = next(iter(column.foreign_keys)).column.table.name
                if table == "organizations":
                    values[column.key] = self.organization_id
                elif table == "users":
                    values[column.key] = str(self.user.id)
                else:
                    if table not in parents:
                        parent = await self._build(_model_for_table(table), {}, parents)
                        parents[table] = str(parent.id)
                    values[column.key] = parents[table]
            else:
                values[column.key] = _value_for(column, prop)
        row = model(**values)
        self.db.add(row)
        await self.db.flush()
        return row

    async def make(self, path: str) -> tuple[str, str]:
        """Create a row for *path*; return (url, row id)."""
        model = _ROUTES[path]
        row = await self._build(model, _response(path), {})
        names = re.findall(r"{(\w+)}", path)
        params = {
            name: (str(row.id) if name == names[-1] else str(getattr(row, name)))
            for name in names
        }
        url = path.format(**params)
        row_id = str(row.id)
        await self.db.commit()
        await self.reset()
        return url, row_id

    async def patch(self, path: str, url: str, body: dict[str, Any]) -> int:
        method, _ = _operation(path)
        response = await getattr(self.client, method)(url, json=body)
        await self.reset()
        return int(response.status_code)

    async def seed(
        self, model: Any, row_id: str, column: Any, response: dict[str, Any]
    ) -> bool:
        """Give a nullable column a value, so clearing it is a visible change.

        Encrypted and JSON columns are left alone: a raw write bypasses the type
        that reads them back. Returns whether a value was written.
        """
        if type(column.type).__name__.startswith(("Encrypted", "JSON")):
            return False
        prop = response.get("properties", {}).get(
            _wire_name(response.get("properties", {}), column.key), {}
        )
        try:
            value = _value_for(column, prop)
        except AssertionError:
            return False
        await self.db.execute(
            text(f"UPDATE {model.__tablename__} SET {column.key} = :v WHERE id = :i"),
            {"v": value, "i": row_id},
        )
        await self.db.commit()
        await self.reset()
        return True

    async def stored(self, model: Any, row_id: str, column: str) -> Any:
        await self.reset()
        return (
            await self.db.execute(
                text(f"SELECT {column} FROM {model.__tablename__} WHERE id = :i"),
                {"i": row_id},
            )
        ).scalar()


# One application for the whole module. Mounting the full router tree costs
# seconds on the first request (the routers are included lazily), which is more
# than every other step of a case together; paid per test it made the file the
# slowest in the integration job. The overrides read the current test's user and
# session from here instead of closing over them.
_CURRENT: dict[str, Any] = {}
_APP: FastAPI | None = None


async def _current_session() -> AsyncGenerator[AsyncSession]:
    db: AsyncSession = _CURRENT["db"]
    try:
        yield db
        await db.commit()
    except Exception:
        await db.rollback()
        raise


def _app() -> FastAPI:
    global _APP
    if _APP is None:
        _APP = FastAPI()
        _APP.include_router(api_router)
        _APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
        _APP.dependency_overrides[get_db] = _current_session
    return _APP


@pytest.fixture
async def bench(db_session: AsyncSession) -> AsyncGenerator[_Bench]:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Roles Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"roles-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Roles Officer', 'roles_officer', '[\"*\"]')"
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

    _CURRENT["user"] = user
    _CURRENT["db"] = db_session
    async with AsyncClient(
        transport=ASGITransport(app=_app(), raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, user, client)


_EMPTY = (None, "", "null", "[]", "{}")

# Nullable fields whose null is refused on purpose: the handler or service reads
# None as "not provided", so a null would answer 200 and change nothing.
_REFUSED_BY_DESIGN = {
    ("Position", "description"),
    ("User", "notification_preferences"),
}

# Fields whose null clears even though the response schema is not nullable.
_CLEARS_BY_DESIGN: set[tuple[str, str]] = set()

# Fields a null re-derives rather than empties: the reconciliation listener on
# User fills member_class and member_status from membership_type when they are
# cleared, so the stored value is the default, not NULL.
_REDERIVED = {("User", "member_class"), ("User", "member_status")}


def _cases() -> dict[str, list[Any]]:
    refused: list[Any] = []
    cleared: list[Any] = []
    for path, model in _ROUTES.items():
        columns = {c.key: c for c in model.__table__.columns}
        response = _response(path)
        for name in sorted(_body(path).get("properties", {})):
            column = columns.get(to_snake(name))
            if column is None:
                continue
            case = pytest.param(path, name, id=f"{model.__name__}.{name}")
            key = (model.__name__, to_snake(name))
            if (
                not column.nullable
                or key in _REFUSED_BY_DESIGN
                or (
                    _response_needs_a_value(response, name)
                    and key not in _CLEARS_BY_DESIGN
                )
            ):
                refused.append(case)
            else:
                cleared.append(case)
    return {"refused": refused, "cleared": cleared}


_CASES = _cases()


class TestEveryRouteHasAReadableRowToTest:
    @pytest.mark.parametrize("path", sorted(_ROUTES))
    async def test_an_empty_update_is_a_200(self, bench: _Bench, path: str) -> None:
        url, _ = await bench.make(path)
        assert await bench.patch(path, url, {}) == 200


class TestNullForAFieldThatCannotBeEmpty:
    @pytest.mark.parametrize(("path", "name"), _CASES["refused"])
    async def test_is_refused_and_the_row_still_reads(
        self, bench: _Bench, path: str, name: str
    ) -> None:
        model = _ROUTES[path]
        url, row_id = await bench.make(path)
        before = await bench.stored(model, row_id, to_snake(name))
        status = await bench.patch(path, url, {name: None})
        assert status in (400, 422), f"{path} {name}: {status}"
        assert await bench.stored(model, row_id, to_snake(name)) == before
        assert await bench.patch(path, url, {}) == 200


class TestNullForAFieldThatCanBeEmpty:
    @pytest.mark.parametrize(("path", "name"), _CASES["cleared"])
    async def test_is_accepted_and_the_row_still_reads(
        self, bench: _Bench, path: str, name: str
    ) -> None:
        model = _ROUTES[path]
        column = model.__table__.columns[to_snake(name)]
        url, row_id = await bench.make(path)
        seeded = await bench.seed(model, row_id, column, _response(path))
        assert await bench.patch(path, url, {name: None}) == 200
        assert await bench.patch(path, url, {}) == 200
        # 200 alone is not "cleared": a handler that skips a null answers 200 too.
        if seeded and (model.__name__, column.key) not in _REDERIVED:
            assert (
                await bench.stored(model, row_id, column.key) in _EMPTY
            ), f"{path} {name}: acknowledged but not cleared"


class TestARealChangeStillSaves:
    """The refusal is on ``null`` only: values written through the same routes persist."""

    async def test_a_role_is_renamed(self, bench: _Bench) -> None:
        path = "/roles/{role_id}"
        url, row_id = await bench.make(path)
        assert await bench.patch(path, url, {"name": "Rescue Lead"}) == 200
        assert await bench.stored(Position, row_id, "name") == "Rescue Lead"

    async def test_a_role_description_is_emptied_with_an_empty_string(
        self, bench: _Bench
    ) -> None:
        path = "/roles/{role_id}"
        url, row_id = await bench.make(path)
        await bench.patch(path, url, {"description": "Crew lead"})
        assert await bench.stored(Position, row_id, "description") == "Crew lead"
        assert await bench.patch(path, url, {"description": ""}) == 200
        assert await bench.stored(Position, row_id, "description") == ""

    async def test_a_changed_email_is_saved_and_must_be_verified_again(
        self, bench: _Bench
    ) -> None:
        path = "/users/{user_id}/contact-info"
        url, row_id = await bench.make(path)
        address = f"changed-{uuid.uuid4().hex[:8]}@test.example"
        assert await bench.patch(path, url, {"email": address}) == 200
        assert await bench.stored(User, row_id, "email") == address
        assert not await bench.stored(User, row_id, "email_verified")
