"""Document and folder update endpoints answer a cleared required column with a 4xx.

``DocumentUpdate`` and ``DocumentFolderUpdate`` type every field ``Optional`` so
a PATCH can omit it, and both handlers dump with ``exclude_unset``, so a ``null``
that was sent reaches the service. ``name`` and ``status`` (documents) and
``name`` and ``visibility`` (folders) are NOT NULL, and ``color`` / ``icon`` are
nullable columns whose response schema is not, so each has to be refused before
the write rather than failing at commit or at serialization. The nullable half is
paired with it: without it, a guard that rejected *every* null would pass.

Driven over HTTP against the real schema, because a mocked session never
evaluates a constraint and the status code is what is under test.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import documents as ep
from app.core.database import get_db
from app.models.document import (
    Document,
    DocumentFolder,
    DocumentStatus,
    FolderVisibility,
)
from app.models.user import User
from app.schemas.documents import DocumentFolderUpdate, DocumentUpdate

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def bench(db_session):
    org = str(uuid.uuid4())
    uid = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) VALUES (:id,'D','fire_department',:s,'UTC')"
        ),
        {"id": org, "s": f"d-{org[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, email, password_hash, status) VALUES (:id,:o,:u,'A','B',:e,'h','active')"
        ),
        {"id": uid, "o": org, "u": f"u-{uid[:8]}", "e": f"{uid[:8]}@t.example"},
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) VALUES (:id,:o,'Admin','admin','[\"documents.manage\",\"documents.view\"]')"
        ),
        {"id": pid, "o": org},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u,:p)"),
        {"u": uid, "p": pid},
    )
    f = DocumentFolder(
        id=str(uuid.uuid4()),
        organization_id=org,
        name="Reports",
        description="d",
        visibility=FolderVisibility.ORGANIZATION,
    )
    db_session.add(f)
    await db_session.flush()
    d = Document(
        id=str(uuid.uuid4()),
        organization_id=org,
        folder_id=f.id,
        name="Doc",
        description="x",
        status=DocumentStatus.ACTIVE,
    )
    db_session.add(d)
    await db_session.flush()
    u = await db_session.get(User, uid)
    await db_session.refresh(u, ["positions"])
    return u, f.id, d.id


def client(db, u):
    app = FastAPI()
    app.include_router(ep.router, prefix="/d")
    app.dependency_overrides[get_current_user] = lambda: u
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://t",
    )


def _not_null_fields(schema, model) -> list[str]:
    required = {c.key for c in model.__table__.columns if not c.nullable}
    return sorted(set(schema.model_fields) & required)


# Derived, so a new NOT NULL column becomes a new case the day it is added.
# color/icon are nullable columns behind a non-Optional response field, which
# the service refuses by hand (DOC-20), so they are named here.
CASES = (
    [("folder", f) for f in _not_null_fields(DocumentFolderUpdate, DocumentFolder)]
    + [("folder", "color"), ("folder", "icon")]
    + [("document", f) for f in _not_null_fields(DocumentUpdate, Document)]
)


def test_cases_cover_the_known_required_columns():
    assert {("folder", "name"), ("folder", "visibility")} <= set(CASES)
    assert {("document", "name"), ("document", "status")} <= set(CASES)


@pytest.mark.parametrize(("kind", "field"), CASES)
async def test_null_is_a_400_or_422_not_a_500(db_session, bench, kind, field):
    u, fid, did = bench
    path = f"/d/folders/{fid}" if kind == "folder" else f"/d/{did}"
    async with client(db_session, u) as c:
        r = await c.patch(path, json={field: None})
    assert r.status_code in (400, 422), (kind, field, r.status_code, r.text[:200])


@pytest.mark.parametrize(
    ("kind", "field"),
    [("folder", "description"), ("document", "description"), ("document", "tags")],
)
async def test_nullable_columns_still_clear(db_session, bench, kind, field):
    u, fid, did = bench
    path = f"/d/folders/{fid}" if kind == "folder" else f"/d/{did}"
    async with client(db_session, u) as c:
        r = await c.patch(path, json={field: None})
    assert r.status_code == 200, (kind, field, r.status_code, r.text[:200])
