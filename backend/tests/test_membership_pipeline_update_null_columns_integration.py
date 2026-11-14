"""Membership-pipeline update endpoints answer an explicit ``null`` on a NOT NULL column with a 4xx.

The ``*Update`` schemas type every field ``Optional`` so a PUT can omit it, and
the handlers dump with ``exclude_unset``, so a ``null`` that was sent reaches the
service, where ``apply_updates`` refuses it for a NOT NULL column by raising
``ValueError``. Every handler has to turn that into a 400; a handler without the
``except ValueError`` lets it escape as a 500.

Driven over HTTP against the real schema, because a mocked session never
evaluates a constraint and the status code is what is under test. The NOT NULL
cases are derived from the schemas and models, so a new column becomes a new case
the day it is added. The nullable half is paired with it: without it, a guard that
rejected *every* null would pass this file.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import membership_pipeline as endpoints
from app.core.database import get_db
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectElectionPackage,
    ProspectiveMember,
)
from app.models.user import User
from app.schemas.membership_pipeline import (
    ElectionPackageUpdate,
    PipelineStepUpdate,
    PipelineUpdate,
    ProspectUpdate,
)

pytestmark = [pytest.mark.integration]


# The step update strips sort_order on purpose (a stage moves through
# reorder_steps; see _STEP_PROTECTED_FIELDS), so a value for it, null included,
# is ignored rather than written or refused. That is pinned separately below.
_STEP_ORDER_IS_IGNORED = {"sort_order"}


def _not_null_fields(schema, model, exclude=frozenset()) -> list[str]:
    required = {c.key for c in model.__table__.columns if not c.nullable}
    return sorted((set(schema.model_fields) & required) - exclude)


class _Bench:
    def __init__(self, user, pipeline_id, step_id, prospect_id):
        self.user = user
        self.pipeline_id = pipeline_id
        self.step_id = step_id
        self.prospect_id = prospect_id


@pytest.fixture
async def bench(db_session: AsyncSession) -> _Bench:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Pipeline Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"pipeline-bench-{org_id[:8]}"},
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
            "VALUES (:id, :org, 'Membership Officer', 'membership_officer', "
            '\'["prospective_members.manage", "prospective_members.view", '
            '"prospective_members.view_all"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )

    pipeline = MembershipPipeline(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Standard pipeline",
        description="Used for every applicant",
    )
    db_session.add(pipeline)
    await db_session.flush()
    step = MembershipPipelineStep(
        id=str(uuid.uuid4()),
        pipeline_id=pipeline.id,
        name="Application",
        description="Paperwork",
    )
    prospect = ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        pipeline_id=pipeline.id,
        first_name="Pat",
        last_name="Applicant",
        email=f"pat-{uuid.uuid4().hex[:8]}@test.example",
        notes="First contact at open house",
    )
    db_session.add_all([step, prospect])
    await db_session.flush()
    package = ProspectElectionPackage(
        id=str(uuid.uuid4()),
        prospect_id=prospect.id,
        coordinator_notes="Ready for the board",
    )
    db_session.add(package)
    await db_session.flush()

    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])
    return _Bench(user, pipeline.id, step.id, prospect.id)


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(endpoints.router, prefix="/pipeline")
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
        "pipeline": f"/pipeline/pipelines/{bench.pipeline_id}",
        "step": f"/pipeline/pipelines/{bench.pipeline_id}/steps/{bench.step_id}",
        "prospect": f"/pipeline/prospects/{bench.prospect_id}",
        "package": f"/pipeline/prospects/{bench.prospect_id}/election-package",
    }[kind]


CASES = (
    [("pipeline", f) for f in _not_null_fields(PipelineUpdate, MembershipPipeline)]
    + [
        ("step", f)
        for f in _not_null_fields(
            PipelineStepUpdate, MembershipPipelineStep, _STEP_ORDER_IS_IGNORED
        )
    ]
    + [("prospect", f) for f in _not_null_fields(ProspectUpdate, ProspectiveMember)]
    + [
        ("package", f)
        for f in _not_null_fields(ElectionPackageUpdate, ProspectElectionPackage)
    ]
)


def test_cases_cover_the_known_required_columns():
    assert {("pipeline", "name"), ("step", "name"), ("prospect", "email")} <= set(CASES)


@pytest.mark.parametrize(("kind", "field"), CASES)
async def test_null_is_a_400_or_422_not_a_500(
    db_session: AsyncSession, bench: _Bench, kind: str, field: str
):
    async with _client(db_session, bench.user) as client:
        resp = await client.put(_path(bench, kind), json={field: None})
    # Exactly 400/422, not any 4xx: a 404/405 from a wrong route would otherwise
    # satisfy this and prove nothing about the guard.
    assert resp.status_code in (400, 422), (kind, field, resp.status_code)


@pytest.mark.parametrize(
    ("kind", "field", "model", "attr"),
    [
        ("pipeline", "description", MembershipPipeline, "description"),
        ("step", "description", MembershipPipelineStep, "description"),
        ("prospect", "notes", ProspectiveMember, "notes"),
        ("package", "coordinator_notes", ProspectElectionPackage, "coordinator_notes"),
    ],
)
async def test_nullable_columns_still_clear(
    db_session: AsyncSession, bench: _Bench, kind: str, field: str, model, attr: str
):
    ids = {
        "pipeline": bench.pipeline_id,
        "step": bench.step_id,
        "prospect": bench.prospect_id,
    }
    async with _client(db_session, bench.user) as client:
        resp = await client.put(_path(bench, kind), json={field: None})
    assert resp.status_code == 200, (kind, field, resp.status_code, resp.text[:200])
    if kind == "package":
        from sqlalchemy import select

        row = (
            await db_session.execute(
                select(model).where(model.prospect_id == bench.prospect_id)
            )
        ).scalar_one()
    else:
        row = await db_session.get(model, ids[kind])
    assert row is not None
    await db_session.refresh(row)
    assert getattr(row, attr) is None


async def test_step_sort_order_on_update_is_ignored(
    db_session: AsyncSession, bench: _Bench
):
    before = (await db_session.get(MembershipPipelineStep, bench.step_id)).sort_order
    async with _client(db_session, bench.user) as client:
        resp = await client.put(_path(bench, "step"), json={"sort_order": 7})
    assert resp.status_code == 200, resp.text
    step = await db_session.get(MembershipPipelineStep, bench.step_id)
    await db_session.refresh(step)
    assert step.sort_order == before
