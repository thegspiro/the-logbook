"""Starting a template from a ready-made form, and previewing a form with a
member's figures before it is published.

A starter must publish exactly as it stands, or it hands a first-time chief a
form that refuses to publish for reasons they did not cause. The preview reads
members' records, so who may point it at a real member — and that doing so is
audited and stays inside the department — is the other half of this file.
"""

from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.evaluation import EvaluationPeriod, EvaluationTemplateVersion
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import User
from app.schemas.evaluation import definition_publish_errors, workflow_publish_errors
from app.services.evaluation_starters import STARTERS
from tests.test_evaluation_workflow import _org, _user

ClientFactory = Callable[[User], Awaitable[AsyncClient]]


@pytest.fixture
async def make_client(db_session: AsyncSession) -> AsyncGenerator[ClientFactory]:
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


LEVELS = [{"value": v, "label": f"L{v}", "anchor": f"A{v}"} for v in range(1, 6)]
DEFINITION = {
    "overall_mode": "weighted",
    "officer_ranks": ["captain"],
    "sections": [
        {
            "key": "core",
            "title": "Core",
            "items": [
                {
                    "key": "training",
                    "label": "Training",
                    "tool": "labeled_scale",
                    "levels": LEVELS,
                    "weight": 100,
                    "data_block": {
                        "source": "training.hours",
                        "scoring_rule": {
                            "bands": [
                                {"min": 0, "max": 10, "score": 2},
                                {"min": 10, "score": 4},
                            ]
                        },
                    },
                }
            ],
        },
        {
            "key": "leadership",
            "title": "Leadership",
            "officer_only": True,
            "items": [
                {
                    "key": "admin",
                    "label": "Admin hours",
                    "tool": "narrative",
                    "data_block": {"source": "admin_hours.hours"},
                }
            ],
        },
    ],
}


@pytest.mark.unit
class TestStarterContent:
    @pytest.mark.parametrize("starter", STARTERS, ids=lambda s: s.key)
    def test_every_starter_publishes_as_it_stands(self, starter):
        assert definition_publish_errors(starter.definition()) == []
        assert workflow_publish_errors(starter.workflow(), starter.kind) == []

    def test_starter_keys_are_unique(self):
        keys = [s.key for s in STARTERS]
        assert len(keys) == len(set(keys))


@pytest.mark.integration
class TestCreatingFromAStarter:
    async def test_the_catalog_lists_each_starter_with_its_sections(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        response = await (await make_client(builder)).get(
            "/evaluations/templates/starters"
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert [s["key"] for s in body] == [s.key for s in STARTERS]
        annual = body[0]
        assert annual["kind"] == "annual"
        assert annual["section_titles"][0] == "Training and readiness"

    async def test_the_first_draft_holds_the_starter_and_publishes(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        client = await make_client(builder)
        created = await client.post(
            "/evaluations/templates",
            json={
                "name": "Our Annual",
                "kind": "annual",
                "starter": "annual_member",
            },
        )
        assert created.status_code == 201, created.text
        template = created.json()
        sections = template["draft"]["definition"]["sections"]
        assert [s["key"] for s in sections] == [
            s.key for s in STARTERS[0].definition().sections
        ]

        published = await client.post(
            f"/evaluations/templates/{template['id']}/publish"
        )
        assert published.status_code == 200, published.text
        assert published.json()["published"] is True
        assert published.json()["errors"] == []

        audit = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "evaluation_template_created"
                )
            )
        ).scalars()
        assert any(
            row.event_data.get("template_id") == template["id"]
            and row.event_data.get("starter") == "annual_member"
            for row in audit
        )

    async def test_without_a_starter_the_draft_is_empty(self, db_session, make_client):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        created = await (await make_client(builder)).post(
            "/evaluations/templates", json={"name": "Blank", "kind": "annual"}
        )
        assert created.status_code == 201, created.text
        assert created.json()["draft"]["definition"]["sections"] == []

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"starter": "nope", "kind": "annual"}, "does not exist"),
            (
                {"starter": "probationary_check_in", "kind": "annual"},
                "different kind",
            ),
        ],
    )
    async def test_an_unknown_or_mismatched_starter_is_refused_and_nothing_is_made(
        self, db_session, make_client, body, message
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        response = await (await make_client(builder)).post(
            "/evaluations/templates", json={"name": "Refused", **body}
        )

        assert response.status_code == 400
        assert message in response.json()["detail"]
        versions = (
            await db_session.execute(
                select(EvaluationTemplateVersion).where(
                    EvaluationTemplateVersion.organization_id == org
                )
            )
        ).all()
        assert versions == []

    async def test_a_period_manager_cannot_read_the_catalog(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        manager = await _user(db_session, org, ["evaluations.manage"])
        response = await (await make_client(manager)).get(
            "/evaluations/templates/starters"
        )
        assert response.status_code == 403


async def _period(db, org_id: str) -> EvaluationPeriod:
    period = EvaluationPeriod(
        organization_id=org_id,
        name="2025 Annual",
        start_date=date(2025, 1, 1),
        end_date=date(2025, 12, 31),
    )
    db.add(period)
    await db.flush()
    return period


async def _hours(db, org_id: str, user_id: str, hours: float, day: date) -> None:
    db.add(
        TrainingRecord(
            organization_id=org_id,
            user_id=user_id,
            course_name="Pump ops",
            training_type=TrainingType.CONTINUING_EDUCATION,
            hours_completed=hours,
            status=TrainingStatus.COMPLETED,
            completion_date=day,
        )
    )
    await db.flush()


@pytest.mark.integration
class TestPreview:
    async def test_a_member_s_real_figures_fill_the_form_and_the_read_is_audited(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        member = await _user(db_session, org, [])
        period = await _period(db_session, org)
        await _hours(db_session, org, member.id, 6, date(2025, 3, 4))
        await _hours(db_session, org, member.id, 5.5, date(2025, 9, 9))
        # Outside the period: not counted.
        await _hours(db_session, org, member.id, 40, date(2024, 12, 30))

        response = await (await make_client(chief)).post(
            "/evaluations/templates/preview",
            json={
                "definition": DEFINITION,
                "member_id": member.id,
                "period_id": period.id,
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["sample"] is False
        assert body["member_name"] == member.full_name
        assert body["period_name"] == "2025 Annual"
        assert body["data"]["training.hours"] == {"available": True, "value": 11.5}
        assert body["suggested_scores"] == {"training": 4}
        # Not a captain, so the officer-only section and its figure are left out.
        assert body["includes_officer_sections"] is False
        assert [s["key"] for s in body["sources"]] == ["training.hours"]

        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "evaluation_template_previewed"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert any(row.event_data.get("member_id") == member.id for row in audit)

    async def test_an_officer_s_preview_includes_the_officer_sections(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        captain = await _user(db_session, org, [], rank="captain")
        await _period(db_session, org)

        body = (
            await (await make_client(chief)).post(
                "/evaluations/templates/preview",
                json={"definition": DEFINITION, "member_id": captain.id},
            )
        ).json()

        assert body["includes_officer_sections"] is True
        assert [s["key"] for s in body["sources"]] == [
            "training.hours",
            "admin_hours.hours",
        ]

    async def test_without_a_member_it_shows_sample_figures_and_reads_no_one(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])

        response = await (await make_client(builder)).post(
            "/evaluations/templates/preview", json={"definition": DEFINITION}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["sample"] is True
        assert body["member_name"] is None
        assert body["includes_officer_sections"] is True
        assert body["data"]["training.hours"]["value"] == 36.0
        assert body["suggested_scores"] == {"training": 4}
        # No period yet: the year so far.
        assert body["period_name"] is None
        assert body["period_start"].endswith("-01-01")
        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "evaluation_template_previewed",
                        AuditLog.user_id == builder.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert audit == []

    async def test_a_builder_without_view_all_cannot_read_a_member(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        member = await _user(db_session, org, [])

        response = await (await make_client(builder)).post(
            "/evaluations/templates/preview",
            json={"definition": DEFINITION, "member_id": member.id},
        )

        assert response.status_code == 403

    async def test_view_all_alone_cannot_preview(self, db_session, make_client):
        org = await _org(db_session)
        reader = await _user(db_session, org, ["evaluations.view_all"])
        response = await (await make_client(reader)).post(
            "/evaluations/templates/preview", json={"definition": DEFINITION}
        )
        assert response.status_code == 403

    async def test_another_department_s_member_and_period_are_not_found(
        self, db_session, make_client
    ):
        org, other = await _org(db_session), await _org(db_session)
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        outsider = await _user(db_session, other, [])
        their_period = await _period(db_session, other)
        client = await make_client(chief)

        by_member = await client.post(
            "/evaluations/templates/preview",
            json={"definition": DEFINITION, "member_id": outsider.id},
        )
        by_period = await client.post(
            "/evaluations/templates/preview",
            json={"definition": DEFINITION, "period_id": their_period.id},
        )

        assert by_member.status_code == 400
        assert by_member.json()["detail"] == "Member not found."
        assert by_period.status_code == 400
        assert by_period.json()["detail"] == "Review period not found."

    async def test_the_options_list_members_only_for_view_all(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        period = await _period(db_session, org)

        as_builder = (
            await (await make_client(builder)).get(
                "/evaluations/templates/preview-options"
            )
        ).json()
        as_chief = (
            await (await make_client(chief)).get(
                "/evaluations/templates/preview-options"
            )
        ).json()

        assert as_builder["can_use_member_data"] is False
        assert as_builder["members"] == []
        assert [p["id"] for p in as_builder["periods"]] == [period.id]
        assert as_chief["can_use_member_data"] is True
        assert {m["id"] for m in as_chief["members"]} == {builder.id, chief.id}
