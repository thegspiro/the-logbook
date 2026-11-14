"""Section and overall grades: the arithmetic, the grade ranges, the
evaluator's changed grades and the reasons they need, and where the grades
reach — the detail response, the stateless calculation and the PDF."""

from collections.abc import AsyncGenerator, Awaitable, Callable
from io import BytesIO

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.user import User
from app.schemas.evaluation import (
    PartContent,
    TemplateDefinition,
    definition_publish_errors,
)
from app.services.evaluation_grading import (
    describe_calculated,
    grade_content,
    grade_errors,
    grade_value,
    override_reason_errors,
)
from app.utils.evaluation_pdf import render_evaluation_pdf
from tests.test_evaluation_pdf import RECORD
from tests.test_evaluation_workflow import _org, _period, _template, _user

FIVE = [{"value": v, "label": f"L{v}", "anchor": f"A{v}"} for v in range(1, 6)]
THREE = [{"value": v, "label": f"T{v}", "anchor": f"B{v}"} for v in range(1, 4)]


def _rated(key: str, weight: int, levels=None, tool: str = "labeled_scale") -> dict:
    item = {"key": key, "label": key.title(), "tool": tool, "weight": weight}
    if tool != "meets":
        item["levels"] = levels or FIVE
    return item


def _definition(**overrides) -> dict:
    definition = {
        "overall_mode": "sectioned",
        "sections": [
            {
                "key": "ops",
                "title": "Operations",
                "weight": 60,
                "items": [_rated("scene", 50), _rated("safety", 50)],
            },
            {
                "key": "conduct",
                "title": "Conduct",
                "weight": 40,
                "items": [
                    _rated("attitude", 50, THREE),
                    _rated("meetings", 50, tool="meets"),
                ],
            },
            {
                "key": "goals",
                "title": "Goals",
                "items": [
                    {"key": "next", "label": "Next year", "tool": "goals"},
                ],
            },
        ],
    }
    definition.update(overrides)
    return definition


def _grade(answers: dict, **content) -> dict:
    result = grade_content(
        TemplateDefinition.model_validate(_definition()),
        PartContent.model_validate(
            {"answers": {k: {"rating": v} for k, v in answers.items()}, **content}
        ),
    )
    assert result is not None
    return result


@pytest.mark.unit
class TestTheArithmetic:
    def test_every_scale_is_placed_on_the_grade_scale(self):
        definition = TemplateDefinition.model_validate(_definition())
        scene = definition.sections[0].items[0]
        attitude, meetings = definition.sections[1].items
        assert [grade_value(scene, r) for r in (1, 3, 5)] == [1.0, 3.0, 5.0]
        assert [grade_value(attitude, r) for r in (1, 2, 3)] == [1.0, 3.0, 5.0]
        assert [grade_value(meetings, r) for r in (0, 1)] == [1.0, 5.0]

    def test_meets_expectations_everywhere_reads_as_meets_not_fifty_percent(self):
        result = _grade({"scene": 3, "safety": 3, "attitude": 2, "meetings": 1})
        assert [s["score"] for s in result["sections"]] == [3.0, 4.0]
        assert result["sections"][0]["label"] == "Meets expectations"
        # 0.6 * 3.0 + 0.4 * 4.0
        assert result["overall"]["score"] == 3.4
        assert result["overall"]["label"] == "Meets expectations"
        assert describe_calculated(result["overall"]) == (
            "3.4 of 5 — Meets expectations"
        )

    def test_the_grade_is_read_from_the_score_as_it_is_shown(self):
        # 0.5 * 4 + 0.5 * 3 = 3.5 exactly: on the Exceeds boundary.
        result = _grade({"scene": 4, "safety": 3})
        assert result["sections"][0]["score"] == 3.5
        assert result["sections"][0]["label"] == "Exceeds expectations"

    def test_an_unanswered_or_na_item_drops_out_and_its_weight_is_shared(self):
        result = _grade({"scene": 5})
        assert result["sections"][0]["score"] == 5.0
        # Conduct has nothing rated, so the overall is Operations alone.
        assert result["sections"][1]["score"] is None
        assert result["sections"][1]["label"] is None
        assert result["overall"]["score"] == 5.0

    def test_an_unweighted_section_is_not_graded(self):
        result = _grade({"scene": 3})
        assert [s["key"] for s in result["sections"]] == ["ops", "conduct"]

    def test_a_form_not_graded_by_section_has_no_grades(self):
        definition = TemplateDefinition.model_validate(
            _definition(overall_mode="weighted")
        )
        assert grade_content(definition, PartContent()) is None

    def test_the_department_s_own_ranges_decide_the_grade(self):
        bands = [
            {"level": 1, "min": 1},
            {"level": 2, "min": 2},
            {"level": 3, "min": 3.5},
            {"level": 4, "min": 4.5},
            {"level": 5, "min": 4.9},
        ]
        definition = TemplateDefinition.model_validate(_definition(grade_bands=bands))
        result = grade_content(
            definition,
            PartContent.model_validate(
                {"answers": {"scene": {"rating": 3}, "safety": {"rating": 3}}}
            ),
        )
        assert result is not None
        assert result["sections"][0]["label"] == "Needs improvement"


@pytest.mark.unit
class TestEvaluatorGrades:
    def test_a_changed_grade_stands_beside_the_calculated_one(self):
        result = _grade(
            {"scene": 3, "safety": 3, "attitude": 2, "meetings": 1},
            section_grades={"ops": {"level": 5, "reason": "Led the warehouse fire."}},
        )
        ops = result["sections"][0]
        assert (ops["calculated_label"], ops["override_label"], ops["label"]) == (
            "Meets expectations",
            "Outstanding",
            "Outstanding",
        )
        assert ops["reason"] == "Led the warehouse fire."
        # The overall counts Operations at the grade that stands: 0.6*5 + 0.4*4.
        assert result["overall"]["score"] == 4.6

    def test_naming_the_calculated_grade_is_not_a_change(self):
        result = _grade(
            {"scene": 3, "safety": 3},
            section_grades={"ops": {"level": 3}},
        )
        assert result["sections"][0]["override_level"] is None
        assert (
            override_reason_errors(
                TemplateDefinition.model_validate(_definition()),
                PartContent.model_validate(
                    {
                        "answers": {"scene": {"rating": 3}, "safety": {"rating": 3}},
                        "section_grades": {"ops": {"level": 3}},
                    }
                ),
            )
            == []
        )

    def test_a_changed_grade_needs_a_reason_before_submitting(self):
        definition = TemplateDefinition.model_validate(_definition())
        content = PartContent.model_validate(
            {
                "answers": {"scene": {"rating": 3}, "safety": {"rating": 3}},
                "section_grades": {"ops": {"level": 5, "reason": "  "}},
                "overall_rating": 1,
            }
        )
        errors = override_reason_errors(definition, content)
        assert errors == [
            "Explain why 'Operations' is graded Outstanding rather than Meets "
            "expectations.",
            "Explain why the overall grade is Unsatisfactory rather than "
            "Outstanding.",
        ]

    def test_only_the_evaluator_grades_and_only_graded_sections(self):
        definition = TemplateDefinition.model_validate(_definition())
        regraded = PartContent.model_validate(
            {"section_grades": {"goals": {"level": 4, "reason": "x"}}}
        )
        assert grade_errors(definition, regraded, evaluator=True) == [
            "A section grade names a section that is not graded."
        ]
        assert grade_errors(definition, regraded, evaluator=False) == [
            "Only the evaluator grades sections."
        ]


@pytest.mark.unit
class TestTheFormsRules:
    @pytest.mark.parametrize(
        "bands",
        [
            [{"level": 1, "min": 1}, {"level": 2, "min": 2}],
            [
                {"level": 1, "min": 1.5},
                {"level": 2, "min": 2},
                {"level": 3, "min": 3},
                {"level": 4, "min": 4},
                {"level": 5, "min": 4.5},
            ],
            [
                {"level": 1, "min": 1},
                {"level": 2, "min": 3},
                {"level": 3, "min": 2.5},
                {"level": 4, "min": 4},
                {"level": 5, "min": 4.5},
            ],
        ],
        ids=["missing grades", "lowest above 1", "out of order"],
    )
    def test_grade_ranges_must_cover_every_grade_in_order(self, bands):
        with pytest.raises(ValidationError):
            TemplateDefinition.model_validate(_definition(grade_bands=bands))

    def test_an_older_form_without_ranges_gets_the_defaults(self):
        definition = TemplateDefinition.model_validate({"sections": []})
        assert [(b.level, b.min) for b in definition.grade_bands] == [
            (1, 1.0),
            (2, 1.5),
            (3, 2.5),
            (4, 3.5),
            (5, 4.5),
        ]

    def test_a_finished_form_publishes(self):
        definition = TemplateDefinition.model_validate(_definition())
        assert definition_publish_errors(definition) == []

    def test_the_weights_must_add_up_in_every_section_and_across_them(self):
        broken = _definition()
        broken["sections"][0]["weight"] = 50
        broken["sections"][1]["items"][0]["weight"] = 30
        broken["sections"][2]["items"].append(_rated("extra", 100))
        errors = definition_publish_errors(TemplateDefinition.model_validate(broken))
        assert errors == [
            "Item weights in 'Conduct' add up to 80%, not 100%.",
            "Section 'Goals' has weighted items; give the section a weight too.",
            "Section weights add up to 90%, not 100%.",
        ]


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


SCORED_ANSWERS = {
    "answers": {
        "scene": {"rating": 3},
        "safety": {"rating": 3},
        "attitude": {"rating": 2},
        "meetings": {"rating": 1},
        "next": {"text": "Lead a drill."},
    },
}


@pytest.mark.integration
class TestOnAnEvaluation:
    async def _evaluation(self, db, make_client):
        org = await _org(db)
        manager = await _user(
            db,
            org,
            ["evaluations.manage", "evaluations.conduct", "evaluations.view_all"],
        )
        evaluator = await _user(db, org, ["evaluations.conduct"])
        member = await _user(db, org, [])
        period = await _period(db, org)
        await _template(db, org, definition=_definition())
        response = await (await make_client(manager)).post(
            "/evaluations",
            json={
                "member_id": member.id,
                "period_id": period.id,
                "evaluator_id": evaluator.id,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"], await make_client(evaluator), member

    async def test_the_detail_reports_the_grades_the_ratings_come_to(
        self, db_session, make_client
    ):
        evaluation_id, evaluator, member = await self._evaluation(
            db_session, make_client
        )
        url = f"/evaluations/{evaluation_id}"
        saved = await evaluator.put(
            f"{url}/parts/evaluator", json={"content": SCORED_ANSWERS}
        )
        assert saved.status_code == 200, saved.text

        grades = saved.json()["grades"]
        assert [(s["key"], s["score"], s["label"]) for s in grades["sections"]] == [
            ("ops", 3.0, "Meets expectations"),
            ("conduct", 4.0, "Exceeds expectations"),
        ]
        assert grades["overall"]["score"] == 3.4
        # The member cannot read the evaluator's part yet, so not its grades.
        as_member = await (await make_client(member)).get(url)
        assert as_member.json()["grades"] is None

    async def test_a_changed_grade_is_refused_at_submit_until_it_says_why(
        self, db_session, make_client
    ):
        evaluation_id, evaluator, _ = await self._evaluation(db_session, make_client)
        url = f"/evaluations/{evaluation_id}"
        unexplained = {
            **SCORED_ANSWERS,
            "section_grades": {"ops": {"level": 5}},
        }
        await evaluator.put(f"{url}/parts/evaluator", json={"content": unexplained})

        refused = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert refused.status_code == 400
        assert "Explain why 'Operations' is graded Outstanding" in refused.text

        explained = {
            **SCORED_ANSWERS,
            "section_grades": {"ops": {"level": 5, "reason": "Led the rescue."}},
        }
        await evaluator.put(f"{url}/parts/evaluator", json={"content": explained})
        submitted = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert submitted.status_code == 200, submitted.text

    async def test_a_grade_for_a_section_that_is_not_graded_is_refused_on_save(
        self, db_session, make_client
    ):
        evaluation_id, evaluator, _ = await self._evaluation(db_session, make_client)
        response = await evaluator.put(
            f"/evaluations/{evaluation_id}/parts/evaluator",
            json={
                "content": {
                    **SCORED_ANSWERS,
                    "section_grades": {"goals": {"level": 4, "reason": "x"}},
                }
            },
        )
        assert response.status_code == 400
        assert "not graded" in response.text

    async def test_the_calculation_alone_reads_nothing_and_saves_nothing(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        member = await _user(db_session, org, [])
        refused = await (await make_client(member)).post(
            "/evaluations/grades",
            json={"definition": _definition(), "content": SCORED_ANSWERS},
        )
        assert refused.status_code == 403

        member = await _user(db_session, org, ["evaluations.conduct"])
        response = await (await make_client(member)).post(
            "/evaluations/grades",
            json={"definition": _definition(), "content": SCORED_ANSWERS},
        )
        assert response.status_code == 200, response.text
        assert response.json()["overall"]["label"] == "Meets expectations"

        ungraded = await (await make_client(member)).post(
            "/evaluations/grades",
            json={
                "definition": _definition(overall_mode="weighted"),
                "content": SCORED_ANSWERS,
            },
        )
        assert ungraded.json() is None


def _pdf_text(pdf: bytes) -> str:
    text = " ".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    return " ".join(text.split())


@pytest.mark.unit
def test_the_pdf_prints_each_section_grade_and_the_overall():
    record = {
        **RECORD,
        "sections": [
            {
                **RECORD["sections"][0],
                "grade": {
                    "calculated": "3.0 of 5 — Meets expectations",
                    "override": "Outstanding",
                    "reason": "Led the rescue.",
                },
            }
        ],
        "grade_rows": [("Core duties", "100%", "Outstanding (evaluator's grade)")],
        "overall": "3.0 of 5 — Meets expectations",
        "overall_override": {"label": "Outstanding", "reason": "Best year yet."},
    }
    text = _pdf_text(render_evaluation_pdf(record))
    assert "Section grade: 3.0 of 5 — Meets expectations" in text
    assert "Evaluator's grade: Outstanding" in text
    assert "Why: Led the rescue." in text
    assert "Overall: 3.0 of 5 — Meets expectations" in text
    assert "Evaluator's overall grade: Outstanding" in text
    assert "Why: Best year yet." in text


@pytest.mark.unit
def test_the_document_words_a_changed_grade_with_the_calculated_one_beside_it():
    from app.services.evaluation_document_service import _grade_lines, _standing

    result = _grade(
        {"scene": 3, "safety": 3},
        section_grades={"ops": {"level": 5, "reason": "Led the rescue."}},
    )
    ops = result["sections"][0]
    assert _grade_lines(ops) == {
        "calculated": "3.0 of 5 — Meets expectations",
        "override": "Outstanding",
        "reason": "Led the rescue.",
    }
    assert _standing(ops) == (
        "Outstanding (evaluator's grade; calculated 3.0 of 5 — Meets expectations)"
    )
    assert _grade_lines(None) is None
