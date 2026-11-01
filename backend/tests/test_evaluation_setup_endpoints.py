"""Evaluation templates and review periods, driven over HTTP.

Covers who may do what (``evaluations.configure`` builds templates,
``evaluations.manage`` runs periods, each may read the other's), that every
id is resolved inside the caller's organization, and the draft → publish →
new draft cycle that keeps a published version frozen.
"""

import json
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import contextmanager
from datetime import date

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.evaluation import Evaluation, EvaluationTemplateVersion
from app.models.user import User

pytestmark = [pytest.mark.integration]

ClientFactory = Callable[..., Awaitable[AsyncClient]]

LEVELS = [
    {"value": v, "label": f"Level {v}", "anchor": f"Behavior at level {v}"}
    for v in range(1, 6)
]
FINISHED_DEFINITION = {
    "sections": [
        {
            "key": "training",
            "title": "Training",
            "items": [
                {
                    "key": "participation",
                    "label": "Training participation",
                    "tool": "labeled_scale",
                    "levels": LEVELS,
                    "weight": 100,
                    "data_block": {
                        "source": "training.session_attendance_pct",
                        "scoring_rule": {
                            "bands": [
                                {"min": 0, "max": 50, "score": 2},
                                {"min": 50, "score": 4},
                            ]
                        },
                    },
                }
            ],
        }
    ],
    "overall_mode": "weighted",
}


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Eval Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"eval-{org_id[:8]}"},
    )
    return org_id


async def _user(db: AsyncSession, org_id: str, permissions: list[str]) -> User:
    user_id, position_id = _uid(), _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Eval', 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"eval-{user_id[:8]}",
            "em": f"eval-{user_id[:8]}@test.example",
        },
    )
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"Pos {position_id[:6]}",
            "slug": f"pos-{position_id[:8]}",
            "perms": json.dumps(permissions),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    user = await db.get(User, user_id)
    assert user is not None
    await db.refresh(user, ["positions"])
    return user


@pytest.fixture
async def make_client(
    db_session: AsyncSession,
) -> AsyncGenerator[ClientFactory]:
    opened: list[AsyncClient] = []

    async def factory(user: User) -> AsyncClient:
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/evaluations")
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db_session
        client = AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        opened.append(client)
        return client

    yield factory
    for client in opened:
        await client.aclose()


async def _configurer(db, make_client, org_id=None):
    org_id = org_id or await _org(db)
    user = await _user(db, org_id, ["evaluations.configure"])
    return org_id, user, await make_client(user)


async def _create(client: AsyncClient, **body) -> dict:
    payload = {"name": f"Operational {_uid()[:6]}", "member_class": "operational"}
    payload.update(body)
    response = await client.post("/evaluations/templates", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _save(client: AsyncClient, template: dict, definition: dict) -> dict:
    workflow = template["draft"]["workflow"]
    response = await client.put(
        f"/evaluations/templates/{template['id']}/draft",
        json={"definition": definition, "workflow": workflow},
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestTemplateLifecycle:
    async def test_a_new_template_opens_a_draft_with_the_default_workflow(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)

        assert template["published_version"] is None
        assert template["has_draft"] is True
        assert template["draft"]["version_number"] == 1
        assert [s["type"] for s in template["draft"]["workflow"]["steps"]] == [
            "self_evaluation",
            "evaluator",
            "member_acknowledgement",
        ]

    async def test_an_unfinished_draft_reports_everything_left_to_do(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)

        response = await client.post(f"/evaluations/templates/{template['id']}/publish")

        assert response.status_code == 200
        body = response.json()
        assert body["published"] is False
        assert "Add at least one item." in body["errors"]

    async def test_publishing_freezes_the_version_and_the_next_edit_opens_v2(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)
        await _save(client, template, FINISHED_DEFINITION)

        published = await client.post(
            f"/evaluations/templates/{template['id']}/publish"
        )
        assert published.json()["published"] is True
        detail = published.json()["template"]
        assert detail["published_version"] == 1
        assert detail["draft"] is None

        edited = json.loads(json.dumps(FINISHED_DEFINITION))
        edited["sections"][0]["title"] = "Training and drills"
        detail = await _save(client, detail | {"draft": detail["published"]}, edited)

        assert detail["draft"]["version_number"] == 2
        # The published version is untouched by the edit.
        assert detail["published"]["definition"]["sections"][0]["title"] == "Training"
        v1 = await db_session.get(EvaluationTemplateVersion, detail["published"]["id"])
        await db_session.refresh(v1)
        assert v1.definition["sections"][0]["title"] == "Training"

        discarded = await client.delete(
            f"/evaluations/templates/{template['id']}/draft"
        )
        assert discarded.status_code == 200
        assert discarded.json()["draft"] is None

    async def test_the_stored_draft_is_the_canonical_shape(
        self, db_session, make_client
    ):
        """Bands entered out of order are stored sorted, and defaults the
        client left out are written, so every reader sees one shape."""
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)
        definition = json.loads(json.dumps(FINISHED_DEFINITION))
        definition["sections"][0]["items"][0]["data_block"]["scoring_rule"][
            "bands"
        ].reverse()

        detail = await _save(client, template, definition)

        stored = detail["draft"]["definition"]["sections"][0]["items"][0]
        assert [b["score"] for b in stored["data_block"]["scoring_rule"]["bands"]] == [
            2,
            4,
        ]
        assert stored["comment"] == "optional"
        assert stored["include_in_self_evaluation"] is True

    async def test_a_template_with_evaluations_cannot_be_deleted(
        self, db_session, make_client
    ):
        org_id, user, client = await _configurer(db_session, make_client)
        template = await _create(client)
        db_session.add(
            Evaluation(
                organization_id=org_id,
                member_id=str(user.id),
                template_version_id=template["draft"]["id"],
                period_start=date(2026, 1, 1),
                period_end=date(2026, 12, 31),
            )
        )
        await db_session.flush()

        response = await client.delete(f"/evaluations/templates/{template['id']}")

        assert response.status_code == 400
        assert "Retire it instead" in response.json()["detail"]


@contextmanager
def _captured_sql(db: AsyncSession):
    """Every statement the session sends, as the database receives it."""
    seen: list[str] = []
    engine = db.bind.sync_engine

    def record(conn, cursor, statement, *args):
        seen.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


class TestConcurrentEditors:
    """Read-then-write decisions are serialized (CLAUDE.md pitfall #27): the
    parent is locked AND the check is a current read, since a plain SELECT
    answers from the snapshot the permission check already established."""

    async def test_matching_is_decided_under_the_department_lock(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)

        with _captured_sql(db_session) as seen:
            await _create(client, name="Locked", member_class="administrative")

        lock = next(
            i for i, sql in enumerate(seen) if "INSERT INTO organization_locks" in sql
        )
        clash = next(
            i
            for i, sql in enumerate(seen)
            if sql.startswith("SELECT evaluation_templates.name")
        )
        assert lock < clash
        assert seen[clash].endswith("FOR UPDATE")

    async def test_writers_read_the_draft_with_a_locking_read(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)

        with _captured_sql(db_session) as seen:
            await _save(client, template, FINISHED_DEFINITION)
            await client.post(f"/evaluations/templates/{template['id']}/publish")

        draft_reads = [
            sql
            for sql in seen
            if sql.startswith("SELECT evaluation_template_versions.")
            and "published_at IS NULL" in sql
        ]
        assert len(draft_reads) >= 2
        assert all(sql.endswith("FOR UPDATE") for sql in draft_reads)


class TestAudit:
    async def test_saving_and_discarding_a_draft_are_audited(
        self, db_session, make_client
    ):
        _, user, client = await _configurer(db_session, make_client)
        template = await _create(client)
        await _save(client, template, FINISHED_DEFINITION)
        await client.post(f"/evaluations/templates/{template['id']}/publish")
        published = (
            await client.get(f"/evaluations/templates/{template['id']}")
        ).json()
        await _save(
            client, published | {"draft": published["published"]}, FINISHED_DEFINITION
        )
        await client.delete(f"/evaluations/templates/{template['id']}/draft")

        events = (
            (
                await db_session.execute(
                    select(AuditLog.event_type).where(
                        AuditLog.user_id == str(user.id),
                        AuditLog.event_type.like("evaluation_template_draft_%"),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(events) == [
            "evaluation_template_draft_discarded",
            "evaluation_template_draft_saved",
            "evaluation_template_draft_saved",
        ]


class TestReferencesStayInTheDepartment:
    async def test_another_departments_template_is_not_found(
        self, db_session, make_client
    ):
        _, _, theirs = await _configurer(db_session, make_client)
        template = await _create(theirs)
        _, _, ours = await _configurer(db_session, make_client)

        for response in (
            await ours.get(f"/evaluations/templates/{template['id']}"),
            await ours.patch(
                f"/evaluations/templates/{template['id']}", json={"name": "Mine"}
            ),
            await ours.put(
                f"/evaluations/templates/{template['id']}/draft",
                json={"definition": {}, "workflow": {}},
            ),
            await ours.post(f"/evaluations/templates/{template['id']}/publish"),
            await ours.delete(f"/evaluations/templates/{template['id']}"),
        ):
            assert response.status_code == 404, response.text

    async def test_an_approval_by_another_departments_position_is_refused(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        template = await _create(client)
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, ["events.view"])
        await db_session.refresh(outsider, ["positions"])
        foreign_position = outsider.positions[0].id
        workflow = template["draft"]["workflow"]
        workflow["steps"].insert(
            2,
            {
                "key": "chief",
                "type": "approval",
                "label": "Chief approval",
                "actor": {"kind": "position", "position_id": foreign_position},
                "due_days": 44,
            },
        )

        response = await client.put(
            f"/evaluations/templates/{template['id']}/draft",
            json={"definition": FINISHED_DEFINITION, "workflow": workflow},
        )

        assert response.status_code == 400
        assert "position that does not exist" in response.json()["detail"]

    async def test_officer_ranks_must_be_the_departments_own(
        self, db_session, make_client
    ):
        org_id, _, client = await _configurer(db_session, make_client)
        await db_session.execute(
            text(
                "INSERT INTO operational_ranks (id, organization_id, rank_code, "
                "display_name, sort_order, is_active) "
                "VALUES (:id, :org, 'lieutenant', 'Lieutenant', 5, 1)"
            ),
            {"id": _uid(), "org": org_id},
        )
        template = await _create(client)

        unknown = await client.put(
            f"/evaluations/templates/{template['id']}/draft",
            json={
                "definition": FINISHED_DEFINITION | {"officer_ranks": ["admiral"]},
                "workflow": template["draft"]["workflow"],
            },
        )
        known = await client.put(
            f"/evaluations/templates/{template['id']}/draft",
            json={
                "definition": FINISHED_DEFINITION | {"officer_ranks": ["lieutenant"]},
                "workflow": template["draft"]["workflow"],
            },
        )

        assert unknown.status_code == 400
        assert "admiral" in unknown.json()["detail"]
        assert known.status_code == 200
        assert known.json()["draft"]["definition"]["officer_ranks"] == ["lieutenant"]


class TestBuilderOptions:
    async def test_only_the_departments_own_positions_and_ranks(
        self, db_session, make_client
    ):
        org_id, user, client = await _configurer(db_session, make_client)
        await db_session.execute(
            text(
                "INSERT INTO operational_ranks (id, organization_id, rank_code, "
                "display_name, sort_order, is_active) "
                "VALUES (:id, :org, 'captain', 'Captain', 4, 1)"
            ),
            {"id": _uid(), "org": org_id},
        )
        outsider = await _user(db_session, await _org(db_session), ["events.view"])
        await db_session.refresh(outsider, ["positions"])

        body = (await client.get("/evaluations/builder-options")).json()

        position_ids = {p["id"] for p in body["positions"]}
        assert user.positions[0].id in position_ids
        assert outsider.positions[0].id not in position_ids
        assert body["ranks"] == [
            {"rank_code": "captain", "display_name": "Captain", "is_active": True}
        ]
        assert set(body["positions"][0]) == {"id", "name"}


class TestMatching:
    async def test_two_active_templates_cannot_claim_the_same_members(
        self, db_session, make_client
    ):
        _, _, client = await _configurer(db_session, make_client)
        await _create(client, name="Operational", member_class="operational")
        # More specific beside a general one is fine: the specific one wins.
        await _create(
            client,
            name="Probationary operational",
            member_class="operational",
            member_status="probationary",
        )

        clash = await client.post(
            "/evaluations/templates",
            json={"name": "Operational 2", "member_class": "operational"},
        )

        assert clash.status_code == 400
        assert "already applies" in clash.json()["detail"]

    async def test_a_retired_template_frees_its_members(self, db_session, make_client):
        _, _, client = await _configurer(db_session, make_client)
        old = await _create(client, name="Old", member_class="social")
        retired = await client.patch(
            f"/evaluations/templates/{old['id']}", json={"is_active": False}
        )
        assert retired.status_code == 200

        await _create(client, name="New", member_class="social")

        reactivated = await client.patch(
            f"/evaluations/templates/{old['id']}", json={"is_active": True}
        )
        assert reactivated.status_code == 400

    async def test_names_are_unique_ignoring_case(self, db_session, make_client):
        _, _, client = await _configurer(db_session, make_client)
        await _create(client, name="Annual", member_class="operational")

        response = await client.post(
            "/evaluations/templates",
            json={"name": "ANNUAL", "member_class": "administrative"},
        )

        assert response.status_code == 400


class TestPermissions:
    async def test_a_period_manager_reads_templates_but_cannot_build_them(
        self, db_session, make_client
    ):
        org_id, _, configurer = await _configurer(db_session, make_client)
        await _create(configurer)
        manager = await make_client(
            await _user(db_session, org_id, ["evaluations.manage"])
        )

        assert (await manager.get("/evaluations/templates")).status_code == 200
        created = await manager.post("/evaluations/templates", json={"name": "Nope"})
        assert created.status_code == 403
        assert (await manager.get("/evaluations/data-sources")).status_code == 403

    async def test_a_template_builder_reads_periods_but_cannot_open_them(
        self, db_session, make_client
    ):
        _, _, configurer = await _configurer(db_session, make_client)

        assert (await configurer.get("/evaluations/periods")).status_code == 200
        response = await configurer.post(
            "/evaluations/periods",
            json={"name": "2026", "start_date": "2026-01-01", "end_date": "2026-12-31"},
        )
        assert response.status_code == 403

    async def test_neither_grant_reads_nothing(self, db_session, make_client):
        org_id = await _org(db_session)
        member = await make_client(await _user(db_session, org_id, ["reports.view"]))

        assert (await member.get("/evaluations/templates")).status_code == 403
        assert (await member.get("/evaluations/periods")).status_code == 403


class TestPeriods:
    async def _manager(self, db_session, make_client):
        org_id = await _org(db_session)
        user = await _user(db_session, org_id, ["evaluations.manage"])
        return org_id, user, await make_client(user)

    async def test_open_rename_and_close_a_period(self, db_session, make_client):
        _, _, client = await self._manager(db_session, make_client)
        created = await client.post(
            "/evaluations/periods",
            json={
                "name": "2026 Annual Review",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
            },
        )
        assert created.status_code == 201, created.text
        period_id = created.json()["id"]

        updated = await client.patch(
            f"/evaluations/periods/{period_id}",
            json={"name": "2026 Annual", "is_closed": True},
        )

        assert updated.status_code == 200
        assert updated.json()["name"] == "2026 Annual"
        assert updated.json()["is_closed"] is True

    async def test_dates_are_fixed_once_evaluations_are_drafted(
        self, db_session, make_client
    ):
        org_id, user, client = await self._manager(db_session, make_client)
        _, _, configurer = await _configurer(db_session, make_client, org_id)
        template = await _create(configurer)
        period = (
            await client.post(
                "/evaluations/periods",
                json={
                    "name": "2026",
                    "start_date": "2026-01-01",
                    "end_date": "2026-12-31",
                },
            )
        ).json()
        db_session.add(
            Evaluation(
                organization_id=org_id,
                member_id=str(user.id),
                period_id=period["id"],
                template_version_id=template["draft"]["id"],
                period_start=date(2026, 1, 1),
                period_end=date(2026, 12, 31),
            )
        )
        await db_session.flush()

        moved = await client.patch(
            f"/evaluations/periods/{period['id']}", json={"end_date": "2026-11-30"}
        )
        closed = await client.patch(
            f"/evaluations/periods/{period['id']}", json={"is_closed": True}
        )
        deleted = await client.delete(f"/evaluations/periods/{period['id']}")

        assert moved.status_code == 400
        assert closed.status_code == 200
        assert closed.json()["evaluations_count"] == 1
        assert deleted.status_code == 400

    async def test_another_departments_period_is_not_found(
        self, db_session, make_client
    ):
        _, _, theirs = await self._manager(db_session, make_client)
        period = (
            await theirs.post(
                "/evaluations/periods",
                json={
                    "name": "Theirs",
                    "start_date": "2026-01-01",
                    "end_date": "2026-12-31",
                },
            )
        ).json()
        _, _, ours = await self._manager(db_session, make_client)

        patched = await ours.patch(
            f"/evaluations/periods/{period['id']}", json={"is_closed": True}
        )
        deleted = await ours.delete(f"/evaluations/periods/{period['id']}")

        assert patched.status_code == 404
        assert deleted.status_code == 404
        assert period["id"] not in [
            p["id"] for p in (await ours.get("/evaluations/periods")).json()
        ]

    async def test_an_explicit_null_cannot_clear_a_required_field(
        self, db_session, make_client
    ):
        _, _, client = await self._manager(db_session, make_client)
        period = (
            await client.post(
                "/evaluations/periods",
                json={
                    "name": "N",
                    "start_date": "2026-01-01",
                    "end_date": "2026-03-31",
                },
            )
        ).json()

        response = await client.patch(
            f"/evaluations/periods/{period['id']}", json={"name": None}
        )

        assert response.status_code == 400
