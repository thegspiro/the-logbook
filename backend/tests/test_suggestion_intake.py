"""
Suggestion box intake questions: branching follow-ups, and answers that route
a submission to another box.

Routing changes who can read a submission, so the integration tests assert on
where the row landed and who can open it, not on what the form previewed.
"""

import importlib.util
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints import suggestions as suggestion_endpoints
from app.models.suggestion import Suggestion, SuggestionBox
from app.schemas.suggestion import IntakeQuestion, SuggestionBoxWrite
from app.services import file_storage_service
from app.services import suggestion_intake as intake
from app.services.suggestion_service import SuggestionService
from tests.test_suggestion_boxes import _assign, _box, _client, _org, _position, _user


@pytest.fixture
async def dept(db_session):
    """A training officer reviewing through a position, a direct reviewer of
    nothing yet, a member, and an administrator holding suggestions.manage."""
    org_id = await _org(db_session)
    training_officer = await _user(db_session, org_id, "Tina")
    admin = await _user(db_session, org_id, "Ada")
    training_pos = await _position(db_session, org_id, "Training Officer")
    admin_pos = await _position(
        db_session, org_id, "Box Admin", permissions=["suggestions.manage"]
    )
    await _assign(db_session, training_officer, training_pos)
    await _assign(db_session, admin, admin_pos)
    dept = {
        "org": org_id,
        "training_officer": training_officer,
        "member": await _user(db_session, org_id, "Sam"),
        "admin": admin,
        "direct_reviewer": await _user(db_session, org_id, "Drew"),
        "training_pos": training_pos,
    }
    await db_session.flush()
    return dept


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def sent(monkeypatch):
    notices = []

    async def _capture(organization_id, user_ids, notice):
        notices.append((organization_id, sorted(user_ids), notice))

    monkeypatch.setattr(suggestion_endpoints, "send_suggestion_notice", _capture)
    return notices


def _q(**fields) -> IntakeQuestion:
    return IntakeQuestion.model_validate(fields)


def _yes_no(qid: str, label: str, route_yes=None, **extra) -> dict:
    return {
        "id": qid,
        "label": label,
        "type": "radio",
        "options": [
            {"value": "yes", "label": "Yes", "routeToBoxId": route_yes},
            {"value": "no", "label": "No"},
        ],
        **extra,
    }


# ---------------------------------------------------------------------------
# The question shape — no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestQuestionShape:
    def test_choice_question_needs_options(self):
        with pytest.raises(ValidationError, match="at least one option"):
            _q(label="Which?", type="select")

    def test_text_question_takes_no_options(self):
        with pytest.raises(ValidationError, match="not a choice question"):
            _q(label="Where?", type="text", options=[{"value": "a", "label": "A"}])

    def test_checkbox_option_cannot_route(self):
        with pytest.raises(ValidationError, match="cannot route"):
            _q(
                label="Which areas?",
                type="checkbox",
                options=[{"value": "a", "label": "A", "routeToBoxId": "box"}],
            )

    def test_option_value_cannot_hold_a_comma(self):
        with pytest.raises(ValidationError, match="comma"):
            _q(label="Q", type="radio", options=[{"value": "a,b", "label": "A"}])

    def test_branch_needs_question_and_rule_together(self):
        with pytest.raises(ValidationError, match="both a question and a rule"):
            _q(label="Q", type="text", conditionQuestionId="other")

    def test_valueless_rule_drops_a_stray_value(self):
        question = _q(
            label="Q",
            type="text",
            conditionQuestionId="p",
            conditionOperator="not_empty",
            conditionValue="ignored",
        )
        assert question.condition_value is None


@pytest.mark.unit
class TestNormalizeQuestions:
    def test_assigns_ids_and_stores_snake_case(self):
        stored = intake.normalize_questions([_q(label="Where?", type="text")])
        assert stored is not None
        (only,) = stored
        assert only["id"]
        assert set(only) == {
            "id",
            "label",
            "help_text",
            "type",
            "required",
            "options",
            "condition_question_id",
            "condition_operator",
            "condition_value",
        }

    def test_no_questions_stores_null(self):
        assert intake.normalize_questions([]) is None

    def test_cycle_is_refused(self):
        a = _q(
            id="a",
            label="A",
            type="text",
            conditionQuestionId="b",
            conditionOperator="not_empty",
        )
        b = _q(
            id="b",
            label="B",
            type="text",
            conditionQuestionId="a",
            conditionOperator="not_empty",
        )
        with pytest.raises(ValueError, match="depend"):
            intake.normalize_questions([a, b])

    def test_missing_parent_is_refused(self):
        orphan = _q(
            label="Orphan",
            type="text",
            conditionQuestionId="gone",
            conditionOperator="not_empty",
        )
        with pytest.raises(ValueError, match="not on this form"):
            intake.normalize_questions([orphan])

    def test_branch_on_a_value_the_parent_does_not_offer_is_refused(self):
        parent = _q(**_yes_no("p", "Injury?"))
        child = _q(
            label="Describe",
            type="text",
            conditionQuestionId="p",
            conditionOperator="equals",
            conditionValue="maybe",
        )
        with pytest.raises(ValueError, match="does not offer"):
            intake.normalize_questions([parent, child])

    def test_without_routes_to_copies_rather_than_mutates(self):
        stored = intake.normalize_questions([_q(**_yes_no("p", "Q", "gone"))])
        cleared = intake.without_routes_to(stored, ["gone"])
        assert intake.route_ids(cleared) == []
        assert intake.route_ids(stored) == ["gone"]


def _stored(*questions) -> list:
    stored = intake.normalize_questions([_q(**q) for q in questions])
    assert stored is not None
    return stored


@pytest.mark.unit
class TestResolveAnswers:
    def test_hidden_required_question_is_not_enforced_and_its_answer_dropped(self):
        questions = _stored(
            _yes_no("injury", "Was anyone hurt?", required=True),
            {
                "id": "who",
                "label": "Who was hurt?",
                "type": "text",
                "required": True,
                "conditionQuestionId": "injury",
                "conditionOperator": "equals",
                "conditionValue": "yes",
            },
        )
        snapshot, route = intake.resolve_answers(
            questions, {"injury": "no", "who": "stale answer"}
        )
        assert route is None
        assert snapshot == [
            {
                "question_id": "injury",
                "label": "Was anyone hurt?",
                "value": "no",
                "display": "No",
            }
        ]

    def test_shown_required_question_is_enforced(self):
        questions = _stored(
            _yes_no("injury", "Was anyone hurt?"),
            {
                "id": "who",
                "label": "Who was hurt?",
                "type": "text",
                "required": True,
                "conditionQuestionId": "injury",
                "conditionOperator": "equals",
                "conditionValue": "yes",
            },
        )
        with pytest.raises(ValueError, match="Who was hurt"):
            intake.resolve_answers(questions, {"injury": "yes"})

    def test_answer_outside_the_options_is_refused(self):
        questions = _stored(_yes_no("q", "Q"))
        with pytest.raises(ValueError, match="not one of its options"):
            intake.resolve_answers(questions, {"q": "perhaps"})

    def test_checkbox_answer_is_stored_in_option_order(self):
        questions = _stored(
            {
                "id": "areas",
                "label": "Areas",
                "type": "checkbox",
                "options": [
                    {"value": "ems", "label": "EMS"},
                    {"value": "fire", "label": "Fire"},
                ],
            }
        )
        snapshot, _ = intake.resolve_answers(questions, {"areas": "fire, ems,fire"})
        assert snapshot is not None
        assert snapshot[0]["value"] == "ems,fire"
        assert snapshot[0]["display"] == "EMS, Fire"

    @pytest.mark.parametrize(
        ("kind", "value", "message"),
        [("number", "lots", "needs a number"), ("date", "13/45", "needs a date")],
    )
    def test_typed_answers_are_checked(self, kind, value, message):
        questions = _stored({"id": "q", "label": "Q", "type": kind})
        with pytest.raises(ValueError, match=message):
            intake.resolve_answers(questions, {"q": value})

    def test_first_shown_routing_answer_wins(self):
        questions = _stored(
            _yes_no("first", "First?", route_yes="box-a"),
            _yes_no("second", "Second?", route_yes="box-b"),
        )
        _, route = intake.resolve_answers(questions, {"first": "yes", "second": "yes"})
        assert route == "box-a"
        _, route = intake.resolve_answers(questions, {"first": "no", "second": "yes"})
        assert route == "box-b"

    def test_answers_must_be_a_json_object_of_strings(self):
        with pytest.raises(ValueError, match="could not be read"):
            intake.parse_answers("[1, 2]")
        with pytest.raises(ValueError, match="could not be read"):
            intake.parse_answers(json.dumps({"q": 3}))
        assert intake.parse_answers(json.dumps({"q": " yes "})) == {"q": "yes"}


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


async def _routing_pair(db, dept, compliance_overrides=None, general_overrides=None):
    """A general box whose 'safety concern? yes' answer routes to a
    Compliance box reviewed by someone the general box's reviewers are not."""
    compliance = await _box(
        db,
        dept,
        name="Compliance",
        reviewer_position_ids=[],
        reviewer_member_ids=[dept["direct_reviewer"]],
        follow_up_enabled=True,
        **(compliance_overrides or {}),
    )
    general = await _box(
        db,
        dept,
        name="General",
        intake_questions=[
            _q(**_yes_no("safety", "Is this a safety concern?", compliance.id)),
            _q(
                id="where",
                label="Where did it happen?",
                type="text",
                conditionQuestionId="safety",
                conditionOperator="equals",
                conditionValue="yes",
            ),
        ],
        **(general_overrides or {}),
    )
    return general, compliance


async def _submit(db, box, user_id, answers, anonymous=False):
    return await SuggestionService(db).submit(
        box=box,
        user_id=user_id,
        title="Frayed harness",
        details="Seat 3 harness is frayed.",
        anonymous=anonymous,
        screenshots=[],
        answers=json.dumps(answers),
    )


@pytest.mark.integration
class TestRoutingConfiguration:
    async def test_route_to_another_departments_box_is_refused(self, db_session, dept):
        other_org = await _org(db_session)
        foreign = SuggestionBox(
            organization_id=other_org,
            name="Foreign",
            reviewers=[],
            watchers=[],
        )
        db_session.add(foreign)
        await db_session.flush()
        with pytest.raises(ValueError, match="does not exist"):
            await _box(
                db_session,
                dept,
                intake_questions=[_q(**_yes_no("q", "Q", foreign.id))],
            )

    async def test_route_to_own_box_is_refused(self, db_session, dept):
        box = await _box(db_session, dept, name="Self")
        data = SuggestionBoxWrite(
            name="Self",
            reviewer_position_ids=[dept["training_pos"]],
            intake_questions=[_q(**_yes_no("q", "Q", box.id))],
        )
        with pytest.raises(ValueError, match="its own box"):
            await SuggestionService(db_session).update_box(dept["org"], box.id, data)

    async def test_required_anonymity_cannot_route_to_a_named_only_box(
        self, db_session, dept
    ):
        named_only = await _box(db_session, dept, anonymity_mode="disabled")
        with pytest.raises(ValueError, match="requires anonymity"):
            await _box(
                db_session,
                dept,
                anonymity_mode="required",
                intake_questions=[_q(**_yes_no("q", "Q", named_only.id))],
            )

    async def test_saving_without_questions_keeps_them(self, db_session, dept):
        general, _ = await _routing_pair(db_session, dept)
        data = SuggestionBoxWrite(
            name="General renamed",
            reviewer_position_ids=[dept["training_pos"]],
        )
        view = await SuggestionService(db_session).update_box(
            dept["org"], general.id, data
        )
        assert view is not None
        assert [q["id"] for q in view["intake_questions"]] == ["safety", "where"]

    async def test_deleting_a_destination_removes_routes_to_it(self, db_session, dept):
        general, compliance = await _routing_pair(db_session, dept)
        service = SuggestionService(db_session)
        await service.delete_box(compliance, None)
        refreshed = await service.get_box(dept["org"], general.id)
        assert refreshed is not None
        assert intake.route_ids(refreshed.intake_questions) == []


@pytest.mark.integration
class TestRoutedSubmission:
    async def test_lands_in_the_destination_with_its_answers(self, db_session, dept):
        general, compliance = await _routing_pair(db_session, dept)
        suggestion, _ = await _submit(
            db_session,
            general,
            dept["member"],
            {"safety": "yes", "where": "Engine 2"},
        )
        assert suggestion.box_id == compliance.id
        assert suggestion.routed_from_box_id == general.id
        assert [a["display"] for a in suggestion.intake_answers] == [
            "Yes",
            "Engine 2",
        ]

        service = SuggestionService(db_session)
        # The general box's reviewer has no access to what was routed away.
        assert (
            await service.get_for_review(
                dept["org"], dept["training_officer"], suggestion.id
            )
            is None
        )
        found = await service.get_for_review(
            dept["org"], dept["direct_reviewer"], suggestion.id
        )
        assert found is not None
        view = await service.reviewer_view(found, dept["direct_reviewer"])
        assert view["routed_from_box_name"] == "General"
        assert view["intake_answers"][1]["label"] == "Where did it happen?"

    async def test_unrouted_answer_stays_in_the_chosen_box(self, db_session, dept):
        general, _ = await _routing_pair(db_session, dept)
        suggestion, _ = await _submit(
            db_session, general, dept["member"], {"safety": "no", "where": "stale"}
        )
        assert suggestion.box_id == general.id
        assert suggestion.routed_from_box_id is None
        assert [a["question_id"] for a in suggestion.intake_answers] == ["safety"]

    async def test_closed_destination_keeps_the_submission_where_it_was_sent(
        self, db_session, dept
    ):
        general, compliance = await _routing_pair(
            db_session, dept, compliance_overrides={"is_active": False}
        )
        suggestion, _ = await _submit(
            db_session, general, dept["member"], {"safety": "yes", "where": "Bay"}
        )
        assert suggestion.box_id == general.id
        assert suggestion.routed_from_box_id is None
        # And the member's form never offered the route in the first place.
        views = SuggestionService.public_box_views([general])
        assert intake.route_ids(views[0]["intake_questions"]) == []
        assert compliance.id

    async def test_anonymous_request_to_a_named_only_destination_is_refused(
        self, db_session, dept
    ):
        general, _ = await _routing_pair(
            db_session, dept, compliance_overrides={"anonymity_mode": "disabled"}
        )
        with pytest.raises(ValueError, match="does not accept anonymous"):
            await _submit(
                db_session,
                general,
                dept["member"],
                {"safety": "yes", "where": "Bay"},
                anonymous=True,
            )
        count = (
            await db_session.execute(
                select(Suggestion.id).where(Suggestion.organization_id == dept["org"])
            )
        ).all()
        assert count == []

    async def test_an_always_anonymous_box_stays_anonymous_when_routed(
        self, db_session, dept
    ):
        general, compliance = await _routing_pair(
            db_session, dept, general_overrides={"anonymity_mode": "required"}
        )
        assert compliance.anonymity_mode == "allowed"
        suggestion, _ = await _submit(
            db_session, general, dept["member"], {"safety": "yes", "where": "Bay"}
        )
        assert suggestion.box_id == compliance.id
        assert suggestion.is_anonymous is True
        assert suggestion.submitted_by is None

    async def test_destination_decides_follow_up(self, db_session, dept):
        # The general box takes no follow-up; Compliance does, so an anonymous
        # submission routed there gets a key.
        general, _ = await _routing_pair(db_session, dept)
        assert not general.follow_up_enabled
        suggestion, key = await _submit(
            db_session,
            general,
            dept["member"],
            {"safety": "yes", "where": "Bay"},
            anonymous=True,
        )
        assert key
        assert suggestion.submitted_by is None


@pytest.mark.integration
class TestRoutedOverHttp:
    async def test_only_the_destination_is_notified(
        self, db_session, dept, upload_dir, sent
    ):
        general, compliance = await _routing_pair(db_session, dept)
        async with await _client(db_session, dept["member"]) as client:
            listed = await client.get("/suggestions/boxes")
            resp = await client.post(
                f"/suggestions/boxes/{general.id}/submissions",
                data={
                    "title": "Harness",
                    "details": "Frayed",
                    "answers": json.dumps({"safety": "yes", "where": "E2"}),
                },
            )
        assert listed.status_code == 200
        general_view = next(b for b in listed.json() if b["id"] == general.id)
        assert (
            general_view["intakeQuestions"][0]["options"][0]["routeToBoxId"]
            == compliance.id
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["boxName"] == "Compliance"
        ((_, recipients, _notice),) = sent
        assert recipients == [dept["direct_reviewer"]]

    async def test_missing_required_answer_is_a_400(
        self, db_session, dept, upload_dir, sent
    ):
        box = await _box(
            db_session,
            dept,
            intake_questions=[_q(**_yes_no("q", "Anyone hurt?", required=True))],
        )
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.post(
                f"/suggestions/boxes/{box.id}/submissions",
                data={"title": "T", "details": "D"},
            )
        assert resp.status_code == 400
        assert "Anyone hurt?" in resp.json()["detail"]
        assert sent == []


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

_REVISION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261011_0857_778c3de73086_suggestion_intake_questions.py"
)


@pytest.mark.unit
def test_migration_adds_only_nullable_columns():
    spec = importlib.util.spec_from_file_location("intake_migration", _REVISION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0a55dae43a0a"
    source = _REVISION.read_text()
    assert "nullable=False" not in source
    assert 'ondelete="SET NULL"' in source
