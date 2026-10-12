"""
Suggestion box answer types beyond text and choices: a 1–5 rating, a time of
day, and picking a member or a vehicle.

A pick answer is an id the server resolves in the box's own department, so the
integration tests assert on what is accepted and what name is kept, not on what
the form offered.
"""

import json

import pytest
from pydantic import ValidationError

from app.models.training import BasicApparatus
from app.schemas.suggestion import IntakeQuestion
from app.services import suggestion_intake as intake
from app.services.suggestion_service import SuggestionService
from tests.test_suggestion_boxes import (
    _assign,
    _box,
    _client,
    _org,
    _position,
    _user,
)


def _q(**fields) -> IntakeQuestion:
    return IntakeQuestion.model_validate(fields)


def _stored(*questions) -> list:
    stored = intake.normalize_questions([_q(**q) for q in questions])
    assert stored is not None
    return stored


RATING = {"id": "urgency", "label": "How urgent?", "type": "rating"}


# ---------------------------------------------------------------------------
# Rating and time — no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestRating:
    def test_stores_the_number_and_shows_it_out_of_five(self):
        snapshot, _ = intake.resolve_answers(_stored(RATING), {"urgency": "4"})
        assert snapshot == [
            {
                "question_id": "urgency",
                "label": "How urgent?",
                "value": "4",
                "display": "4 / 5",
            }
        ]

    @pytest.mark.parametrize("answer", ["0", "6", "4.5", "high"])
    def test_refuses_anything_but_one_to_five(self, answer):
        with pytest.raises(ValueError, match="rating from 1 to 5"):
            intake.resolve_answers(_stored(RATING), {"urgency": answer})

    def test_follow_up_appears_at_or_above_a_threshold(self):
        questions = _stored(
            RATING,
            {
                "id": "deadline",
                "label": "What's the deadline?",
                "type": "date",
                "required": True,
                "conditionQuestionId": "urgency",
                "conditionOperator": "at_least",
                "conditionValue": "4",
            },
        )
        snapshot, _ = intake.resolve_answers(questions, {"urgency": "3"})
        assert [a["question_id"] for a in snapshot or []] == ["urgency"]
        with pytest.raises(ValueError, match="deadline"):
            intake.resolve_answers(questions, {"urgency": "5"})

    def test_a_threshold_outside_one_to_five_is_refused(self):
        with pytest.raises(ValueError, match="ratings run 1 to 5"):
            _stored(
                RATING,
                {
                    "id": "x",
                    "label": "Follow-up",
                    "type": "text",
                    "conditionQuestionId": "urgency",
                    "conditionOperator": "at_least",
                    "conditionValue": "7",
                },
            )

    def test_at_least_is_refused_under_a_text_question(self):
        with pytest.raises(ValueError, match="number question"):
            _stored(
                {"id": "where", "label": "Where?", "type": "text"},
                {
                    "id": "x",
                    "label": "Follow-up",
                    "type": "text",
                    "conditionQuestionId": "where",
                    "conditionOperator": "at_least",
                    "conditionValue": "3",
                },
            )

    def test_a_rating_takes_no_options(self):
        with pytest.raises(ValidationError, match="not a choice question"):
            _q(**RATING, options=[{"value": "a", "label": "A"}])


@pytest.mark.unit
class TestTimeAndNumber:
    @pytest.mark.parametrize("answer", ["00:00", "07:05", "23:59"])
    def test_accepts_a_24_hour_time_as_entered(self, answer):
        questions = _stored({"id": "when", "label": "When?", "type": "time"})
        snapshot, _ = intake.resolve_answers(questions, {"when": answer})
        assert snapshot is not None
        assert snapshot[0]["display"] == answer

    @pytest.mark.parametrize("answer", ["24:00", "7:05", "noon", "07:60"])
    def test_refuses_anything_else(self, answer):
        questions = _stored({"id": "when", "label": "When?", "type": "time"})
        with pytest.raises(ValueError, match="needs a time"):
            intake.resolve_answers(questions, {"when": answer})

    def test_a_time_parent_only_supports_answered_rules(self):
        with pytest.raises(ValueError, match="whether 'When\\?' is answered"):
            _stored(
                {"id": "when", "label": "When?", "type": "time"},
                {
                    "id": "x",
                    "label": "Follow-up",
                    "type": "text",
                    "conditionQuestionId": "when",
                    "conditionOperator": "equals",
                    "conditionValue": "07:00",
                },
            )

    @pytest.mark.parametrize("answer", ["1e3", "1_000", "inf"])
    def test_a_number_must_be_a_plain_decimal(self, answer):
        # The reading "at least" / "at most" use, so every accepted number is
        # one a numeric rule can compare.
        questions = _stored({"id": "n", "label": "How many?", "type": "number"})
        with pytest.raises(ValueError, match="needs a number"):
            intake.resolve_answers(questions, {"n": answer})


@pytest.mark.unit
class TestPickAnswersWithoutTheDatabase:
    MEMBER = {"id": "who", "label": "Who is this about?", "type": "member"}
    VEHICLE = {"id": "rig", "label": "Which vehicle?", "type": "apparatus"}

    def test_keeps_the_name_the_reviewer_will_read(self):
        snapshot, _ = intake.resolve_answers(
            _stored(self.MEMBER),
            {"who": "u1"},
            {"member": {"u1": "Sam Member"}},
        )
        assert snapshot is not None
        assert snapshot[0]["value"] == "u1"
        assert snapshot[0]["display"] == "Sam Member"

    def test_refuses_an_id_the_lookup_did_not_find(self):
        with pytest.raises(ValueError, match="not on the list"):
            intake.resolve_answers(
                _stored(self.MEMBER), {"who": "elsewhere"}, {"member": {}}
            )

    def test_an_empty_fleet_skips_a_required_vehicle_question(self):
        questions = _stored({**self.VEHICLE, "required": True})
        snapshot, _ = intake.resolve_answers(questions, {}, {"apparatus": {}})
        assert snapshot is None

    def test_a_pick_parent_only_supports_answered_rules(self):
        with pytest.raises(ValueError, match="is answered"):
            _stored(
                self.MEMBER,
                {
                    "id": "x",
                    "label": "Follow-up",
                    "type": "text",
                    "conditionQuestionId": "who",
                    "conditionOperator": "equals",
                    "conditionValue": "u1",
                },
            )


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    reviewer = await _user(db_session, org_id, "Tina")
    reviewer_pos = await _position(db_session, org_id, "Safety Officer")
    await _assign(db_session, reviewer, reviewer_pos)
    admin = await _user(db_session, org_id, "Ada")
    dept = {
        "org": org_id,
        "admin": admin,
        "training_pos": reviewer_pos,
        "member": await _user(db_session, org_id, "Sam"),
        "subject": await _user(db_session, org_id, "Riley"),
        "former": await _user(db_session, org_id, "Old", status="inactive"),
    }
    await db_session.flush()
    return dept


async def _vehicle(db, org_id, unit, *, active=True):
    vehicle = BasicApparatus(
        organization_id=org_id,
        unit_number=unit,
        name=f"{unit} name",
        apparatus_type="engine",
        is_active=active,
    )
    db.add(vehicle)
    await db.flush()
    return vehicle.id


async def _pick_box(db, dept, *questions):
    return await _box(db, dept, intake_questions=[_q(**q) for q in questions])


async def _submit(db, box, user_id, answers, anonymous=False):
    return await SuggestionService(db).submit(
        box=box,
        user_id=user_id,
        title="Seat 3 harness",
        details="Frayed strap.",
        anonymous=anonymous,
        screenshots=[],
        answers=json.dumps(answers),
    )


@pytest.mark.integration
class TestPickAnswers:
    MEMBER = {
        "id": "who",
        "label": "Who is this about?",
        "type": "member",
        "required": True,
    }
    VEHICLE = {"id": "rig", "label": "Which vehicle?", "type": "apparatus"}

    async def test_member_answer_keeps_the_name_in_an_anonymous_box(
        self, db_session, dept
    ):
        box = await _pick_box(db_session, dept, self.MEMBER)
        suggestion, _ = await _submit(
            db_session, box, dept["member"], {"who": dept["subject"]}, anonymous=True
        )
        assert suggestion.is_anonymous is True
        assert suggestion.submitted_by is None
        (answer,) = suggestion.intake_answers
        assert answer["value"] == dept["subject"]
        assert answer["display"] == "Riley Member"

    async def test_member_from_another_department_is_refused(self, db_session, dept):
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, "Out")
        box = await _pick_box(db_session, dept, self.MEMBER)
        with pytest.raises(ValueError, match="not on the list"):
            await _submit(db_session, box, dept["member"], {"who": outsider})

    async def test_inactive_member_is_refused(self, db_session, dept):
        box = await _pick_box(db_session, dept, self.MEMBER)
        with pytest.raises(ValueError, match="not on the list"):
            await _submit(db_session, box, dept["member"], {"who": dept["former"]})

    async def test_vehicle_answer_is_checked_against_the_fleet(self, db_session, dept):
        engine = await _vehicle(db_session, dept["org"], "E1")
        retired = await _vehicle(db_session, dept["org"], "E9", active=False)
        box = await _pick_box(db_session, dept, self.VEHICLE)

        suggestion, _ = await _submit(db_session, box, dept["member"], {"rig": engine})
        assert suggestion.intake_answers[0]["display"] == "E1 name"
        with pytest.raises(ValueError, match="not on the list"):
            await _submit(db_session, box, dept["member"], {"rig": retired})

    async def test_required_vehicle_question_does_not_block_an_empty_fleet(
        self, db_session, dept
    ):
        box = await _pick_box(db_session, dept, {**self.VEHICLE, "required": True})
        suggestion, _ = await _submit(db_session, box, dept["member"], {})
        assert suggestion.intake_answers is None


@pytest.mark.integration
class TestPickOptionsEndpoint:
    async def test_lists_only_this_departments_active_members_by_name(
        self, db_session, dept
    ):
        other_org = await _org(db_session)
        await _user(db_session, other_org, "Out")
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.get("/suggestions/pick-options?kind=member")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert all(set(row) == {"id", "name"} for row in rows)
        ids = {row["id"] for row in rows}
        assert dept["subject"] in ids
        assert dept["former"] not in ids
        assert len(ids) == 4

    async def test_lists_this_departments_vehicles(self, db_session, dept):
        engine = await _vehicle(db_session, dept["org"], "E1")
        await _vehicle(db_session, dept["org"], "E9", active=False)
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.get("/suggestions/pick-options?kind=apparatus")
        assert resp.status_code == 200, resp.text
        assert resp.json() == [{"id": engine, "name": "E1 name"}]

    async def test_refuses_an_unknown_kind(self, db_session, dept):
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.get("/suggestions/pick-options?kind=email")
        assert resp.status_code == 422
