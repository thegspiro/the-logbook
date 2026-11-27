"""Starting a template from a ready-made form, and previewing a form with a
member's figures before it is published.

A starter must publish exactly as it stands, or it hands a first-time chief a
form that refuses to publish for reasons they did not cause. The preview reads
members' records, so who may point it at a real member — and that doing so is
audited and stays inside the department — is the other half of this file.
"""

import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date
from io import BytesIO

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.evaluation import EvaluationPeriod, EvaluationTemplateVersion
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import Position, User
from app.schemas.evaluation import definition_publish_errors, workflow_publish_errors
from app.services.evaluation_service import form_definition
from app.services.evaluation_starters import STARTERS, STARTERS_BY_KEY
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
        """A starter with officer sections publishes once the ranks it is
        created with are in place; it is never created without them."""
        definition = starter.definition()
        if starter.officer_sections:
            assert definition_publish_errors(definition) == [
                "Choose the ranks that receive the officer-only sections."
            ]
            definition = definition.model_copy(update={"officer_ranks": ["captain"]})
        assert definition_publish_errors(definition) == []
        assert workflow_publish_errors(starter.workflow(), starter.kind) == []

    def test_a_member_without_an_officer_rank_is_graded_on_the_rest(self):
        officer = STARTERS_BY_KEY["annual_with_officers"].definition()
        plain = STARTERS_BY_KEY["annual_member"].definition()

        member_form = form_definition(officer, officer=False)
        officer_form = form_definition(officer, officer=True)

        assert "leadership" not in [s.key for s in member_form.sections]
        assert "leadership" in [s.key for s in officer_form.sections]
        # The officer starter is the annual starter plus one section.
        assert [s.key for s in member_form.sections] == [s.key for s in plain.sections]
        # Without leadership the graded sections keep nearly the plain
        # starter's shares: 25/35/20 of 80 against 30/45/25 of 100.
        weights = {s.key: s.weight for s in member_form.sections if s.weight}
        total = sum(weights.values())
        for key, plain_weight in (
            (s.key, s.weight) for s in plain.sections if s.weight
        ):
            assert abs(weights[key] / total * 100 - plain_weight) < 2

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

    async def _rank(self, db_session, org: str, code: str) -> None:
        await db_session.execute(
            text(
                "INSERT INTO operational_ranks (id, organization_id, rank_code, "
                "display_name, sort_order, is_active) "
                "VALUES (:id, :org, :code, :name, 5, 1)"
            ),
            {"id": str(uuid.uuid4()), "org": org, "code": code, "name": code.title()},
        )

    async def test_the_officer_starter_takes_the_ranks_and_publishes(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        await self._rank(db_session, org, "captain")
        await self._rank(db_session, org, "lieutenant")
        builder = await _user(db_session, org, ["evaluations.configure"])
        client = await make_client(builder)

        catalog = (await client.get("/evaluations/templates/starters")).json()
        assert {s["key"]: s["needs_officer_ranks"] for s in catalog} == {
            "annual_member": False,
            "annual_with_officers": True,
            "probationary_check_in": False,
        }

        created = await client.post(
            "/evaluations/templates",
            json={
                "name": "Officer Annual",
                "kind": "annual",
                "starter": "annual_with_officers",
                "officer_ranks": ["captain", "lieutenant", "captain"],
            },
        )
        assert created.status_code == 201, created.text
        draft = created.json()["draft"]["definition"]
        assert draft["officer_ranks"] == ["captain", "lieutenant"]
        assert [s["key"] for s in draft["sections"] if s["officer_only"]] == [
            "leadership"
        ]

        published = await client.post(
            f"/evaluations/templates/{created.json()['id']}/publish"
        )
        assert published.status_code == 200, published.text
        assert published.json()["errors"] == []

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"starter": "annual_with_officers"}, "Choose the ranks"),
            (
                {"starter": "annual_with_officers", "officer_ranks": ["admiral"]},
                "not defined in your department",
            ),
            (
                {"starter": "annual_member", "officer_ranks": ["captain"]},
                "only for a starting point with officer sections",
            ),
            ({"officer_ranks": ["captain"]}, "only for a starting point"),
        ],
    )
    async def test_officer_ranks_are_required_known_and_only_for_that_starter(
        self, db_session, make_client, body, message
    ):
        org = await _org(db_session)
        await self._rank(db_session, org, "captain")
        builder = await _user(db_session, org, ["evaluations.configure"])

        response = await (await make_client(builder)).post(
            "/evaluations/templates",
            json={"name": "Refused", "kind": "annual", **body},
        )

        assert response.status_code == 400, response.text
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
        assert body["data"]["training.hours"] == {
            "available": True,
            "value": 11.5,
            "breakdown": "2 training records: Continuing Education 11.5 h",
        }
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


PDF_URL = "/evaluations/templates/preview-pdf"
PDF_EVENT = "evaluation_template_preview_pdf_downloaded"
PDF_DEFINITION = {
    **DEFINITION,
    "sections": [
        {
            **DEFINITION["sections"][0],
            "items": [
                {
                    **DEFINITION["sections"][0]["items"][0],
                    "help_text": "Count drills and classes alike.",
                },
                {
                    "key": "scene",
                    "label": "Scene performance",
                    "tool": "narrative",
                    "include_in_self_evaluation": False,
                },
            ],
        },
        DEFINITION["sections"][1],
    ],
}


def _workflow(position_id: str) -> dict:
    return {
        "steps": [
            {
                "key": "self",
                "type": "self_evaluation",
                "label": "Self-evaluation",
                "actor": {"kind": "member"},
                "due_days": 14,
            },
            {
                "key": "evaluator",
                "type": "evaluator",
                "label": "Evaluator",
                "actor": {"kind": "evaluator"},
                "due_days": 30,
            },
            {
                "key": "approval",
                "type": "approval",
                "label": "Chief's approval",
                "actor": {"kind": "position", "position_id": position_id},
                "due_days": 45,
            },
            {
                "key": "ack",
                "type": "member_acknowledgement",
                "label": "Member acknowledgement",
                "actor": {"kind": "member"},
                "due_days": 58,
            },
        ]
    }


async def _position(db, org_id: str, name: str) -> Position:
    position = Position(
        organization_id=org_id,
        name=name,
        slug=f"p-{uuid.uuid4().hex[:8]}",
        permissions=[],
    )
    db.add(position)
    await db.flush()
    return position


def _pdf_text(response) -> str:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    pages = PdfReader(BytesIO(response.content)).pages
    return " ".join(" ".join(page.extract_text() for page in pages).split())


async def _pdf_audits(db) -> list:
    return list(
        (
            await db.execute(select(AuditLog).where(AuditLog.event_type == PDF_EVENT))
        ).scalars()
    )


@pytest.mark.integration
class TestPreviewPdf:
    async def test_sample_figures_fill_a_blank_form_marked_as_a_preview(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        chief = await _position(db_session, org, "Fire Chief")

        response = await (await make_client(builder)).post(
            PDF_URL,
            json={
                "definition": PDF_DEFINITION,
                "workflow": _workflow(chief.id),
                "name": "Operational Annual",
            },
        )

        text = _pdf_text(response)
        assert "attachment" in response.headers["content-disposition"]
        for expected in (
            "PREVIEW",
            "NOT A RECORD",
            "Operational Annual",
            "Preview of the evaluator's form",
            "Sample member",
            "Sample figures, not a member's",
            # The figure, in the table and beside its item, and what it suggests.
            "Training hours: 36 h",
            "The figure suggests: L4",
            "Rated: L1 · L2 · L3 · L4 · L5",
            "Guidance: Count drills and classes alike.",
            "Scene performance",
            # Sample figures show the whole form, officer-only sections too.
            "Leadership (officers only)",
            "A weighted percentage of the ratings",
            # Only the steps that are signed, each naming who signs.
            "Chief's approval",
            "Fire Chief",
            "Member acknowledgement",
            "Not signed",
        ):
            assert expected in text, expected
        assert "Record fingerprint" not in text
        assert await _pdf_audits(db_session) == []

    async def test_a_member_s_figures_are_printed_and_the_download_is_audited(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        member = await _user(db_session, org, [])
        period = await _period(db_session, org)
        await _hours(db_session, org, member.id, 11.5, date(2025, 3, 4))
        position = await _position(db_session, org, "Fire Chief")

        response = await (await make_client(chief)).post(
            PDF_URL,
            json={
                "definition": PDF_DEFINITION,
                "workflow": _workflow(position.id),
                "name": "Operational Annual",
                "member_id": member.id,
                "period_id": period.id,
            },
        )

        text = _pdf_text(response)
        assert member.full_name in text
        assert "Sample member" not in text
        assert "2025 Annual" in text
        assert "Training hours: 11.5 h" in text
        # Not a captain: the officer-only section is not part of their form.
        assert "Leadership" not in text
        assert "NOT A RECORD" in text
        audits = await _pdf_audits(db_session)
        assert [row.event_data for row in audits] == [
            {"member_id": member.id, "period_id": period.id, "part": "evaluator"}
        ]

    async def test_the_self_evaluation_form_asks_only_its_items_and_is_not_signed(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        position = await _position(db_session, org, "Fire Chief")

        response = await (await make_client(builder)).post(
            PDF_URL,
            json={
                "definition": PDF_DEFINITION,
                "workflow": _workflow(position.id),
                "name": "Operational Annual",
                "part": "self_evaluation",
            },
        )

        text = _pdf_text(response)
        assert "Preview of the self-evaluation form" in text
        assert "Training hours: 36 h" in text
        assert "Scene performance" not in text
        # What the figures suggest is the evaluator's to see.
        assert "The figure suggests" not in text
        assert "Chief's approval" not in text
        assert "Signed by" not in text

    async def test_a_builder_without_view_all_cannot_print_a_member(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])
        member = await _user(db_session, org, [])
        position = await _position(db_session, org, "Fire Chief")

        response = await (await make_client(builder)).post(
            PDF_URL,
            json={
                "definition": PDF_DEFINITION,
                "workflow": _workflow(position.id),
                "name": "Operational Annual",
                "member_id": member.id,
            },
        )

        assert response.status_code == 403
        assert await _pdf_audits(db_session) == []

    async def test_view_all_alone_cannot_print_a_preview(self, db_session, make_client):
        org = await _org(db_session)
        reader = await _user(db_session, org, ["evaluations.view_all"])
        position = await _position(db_session, org, "Fire Chief")

        response = await (await make_client(reader)).post(
            PDF_URL,
            json={
                "definition": PDF_DEFINITION,
                "workflow": _workflow(position.id),
                "name": "Operational Annual",
            },
        )

        assert response.status_code == 403

    async def test_another_department_s_member_period_and_position_stay_theirs(
        self, db_session, make_client
    ):
        org, other = await _org(db_session), await _org(db_session)
        chief = await _user(
            db_session, org, ["evaluations.configure", "evaluations.view_all"]
        )
        outsider = await _user(db_session, other, [])
        their_period = await _period(db_session, other)
        their_position = await _position(db_session, other, "Their Commissioner")
        client = await make_client(chief)
        body = {
            "definition": PDF_DEFINITION,
            "workflow": _workflow(their_position.id),
            "name": "Operational Annual",
        }

        by_member = await client.post(PDF_URL, json={**body, "member_id": outsider.id})
        by_period = await client.post(
            PDF_URL, json={**body, "period_id": their_period.id}
        )
        by_position = await client.post(PDF_URL, json=body)

        assert by_member.status_code == 400
        assert by_member.json()["detail"] == "Member not found."
        assert by_period.status_code == 400
        assert by_period.json()["detail"] == "Review period not found."
        text = _pdf_text(by_position)
        assert "Their Commissioner" not in text
        assert "A position holder" in text
        assert await _pdf_audits(db_session) == []
