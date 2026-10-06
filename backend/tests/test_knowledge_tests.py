"""Online knowledge tests: question bank, delivery, grading and credit.

Driven through a real app against MySQL. The properties that matter most are
the ones a member could exploit: the answers never reach them before they
submit, the score is the server's, and the requirement's attempt cap holds
the same way it does for an officer's typed-in score.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import knowledge_tests as endpoint
from app.models.knowledge_test import KnowledgeTestAttempt
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Position, User, user_positions

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    return org_id


async def _make_user(
    db: AsyncSession, org_id: str, first: str, officer: bool = False
) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'X', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "fn": first,
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    if officer:
        position = Position(
            organization_id=org_id,
            name="Training Officer",
            slug=f"to-{user_id[:8]}",
            permissions=["training.manage"],
        )
        db.add(position)
        await db.flush()
        await db.execute(
            insert(user_positions).values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user_id)
        )
    ).scalar_one()


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _make_org(db_session)
    officer = await _make_user(db_session, org_id, "Olive", officer=True)
    member = await _make_user(db_session, org_id, "Mary")
    requirement = TrainingRequirement(
        organization_id=org_id,
        name="Hazmat Awareness Exam",
        requirement_type=RequirementType.KNOWLEDGE_TEST,
        frequency=RequirementFrequency.ONE_TIME,
        passing_score=80,
        max_attempts=2,
    )
    hours = TrainingRequirement(
        organization_id=org_id,
        name="Annual hours",
        requirement_type=RequirementType.HOURS,
        frequency=RequirementFrequency.ANNUAL,
    )
    db_session.add_all([requirement, hours])
    await db_session.flush()
    program = TrainingProgram(organization_id=org_id, name="Probationary")
    db_session.add(program)
    await db_session.flush()
    enrollment = ProgramEnrollment(
        program_id=program.id,
        user_id=member.id,
        organization_id=org_id,
        status=EnrollmentStatus.ACTIVE,
    )
    db_session.add(enrollment)
    await db_session.flush()
    progress = RequirementProgress(
        enrollment_id=enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.NOT_STARTED,
    )
    db_session.add(progress)

    other_org = await _make_org(db_session)
    outsider = await _make_user(db_session, other_org, "Otto", officer=True)
    await db_session.flush()
    return {
        "org_id": org_id,
        "officer": officer,
        "member": member,
        "requirement": requirement,
        "hours": hours,
        "progress": progress,
        "outsider": outsider,
    }


def _client(db_session, viewer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(endpoint.router, prefix="/kt")
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


QUESTIONS = [
    {
        "prompt": "Placard colour for flammable liquids?",
        "question_type": "single_choice",
        "options": [
            {"text": "Red", "correct": True},
            {"text": "Green", "correct": False},
            {"text": "White", "correct": False},
        ],
        "explanation": "Class 3 placards are red.",
    },
    {
        "prompt": "Which are PPE levels?",
        "question_type": "multiple_choice",
        "options": [
            {"text": "Level A", "correct": True},
            {"text": "Level B", "correct": True},
            {"text": "Level Z", "correct": False},
        ],
    },
    {
        "prompt": "The ERG is published every four years.",
        "question_type": "true_false",
        "options": [
            {"text": "True", "correct": True},
            {"text": "False", "correct": False},
        ],
    },
    {
        "prompt": "Isolation distance for an unknown spill?",
        "question_type": "single_choice",
        "options": [
            {"text": "330 ft", "correct": True},
            {"text": "30 ft", "correct": False},
        ],
    },
    {
        "prompt": "Decon happens in which zone?",
        "question_type": "single_choice",
        "options": [
            {"text": "Warm", "correct": True},
            {"text": "Cold", "correct": False},
        ],
    },
]


async def _published_test(db_session, dept, **settings) -> dict:
    async with _client(db_session, dept["officer"]) as client:
        created = await client.post(
            "/kt",
            json={
                "name": "Hazmat Awareness",
                "requirement_id": dept["requirement"].id,
                **settings,
            },
        )
        assert created.status_code == 201, created.text
        test_id = created.json()["id"]
        for q in QUESTIONS:
            resp = await client.post(f"/kt/{test_id}/questions", json=q)
            assert resp.status_code == 201, resp.text
        published = await client.patch(f"/kt/{test_id}", json={"status": "published"})
        assert published.status_code == 200, published.text
    return published.json()


def _correct_answers(test_detail: dict, attempt: dict) -> dict:
    by_id = {q["id"]: q for q in test_detail["questions"]}
    return {
        q["id"]: [o["id"] for o in by_id[q["id"]]["options"] if o["correct"]]
        for q in attempt["questions"]
    }


class TestAuthoring:
    async def test_member_cannot_author_or_see_drafts(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            draft = (await client.post("/kt", json={"name": "Draft"})).json()
        async with _client(db_session, dept["member"]) as client:
            create = await client.post("/kt", json={"name": "Mine"})
            listed = await client.get("/kt")
            got = await client.get(f"/kt/{draft['id']}")
        assert create.status_code == 403
        assert listed.json() == []
        assert got.status_code == 404

    async def test_requirement_link_must_be_an_own_knowledge_test(
        self, db_session, dept
    ):
        async with _client(db_session, dept["officer"]) as client:
            hours = await client.post(
                "/kt", json={"name": "X", "requirement_id": dept["hours"].id}
            )
        async with _client(db_session, dept["outsider"]) as client:
            foreign = await client.post(
                "/kt", json={"name": "X", "requirement_id": dept["requirement"].id}
            )
        assert hours.status_code == 400
        assert foreign.status_code == 400

    async def test_question_validation(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            test = (await client.post("/kt", json={"name": "Q"})).json()
            two_right = await client.post(
                f"/kt/{test['id']}/questions",
                json={
                    "prompt": "?",
                    "question_type": "single_choice",
                    "options": [
                        {"text": "a", "correct": True},
                        {"text": "b", "correct": True},
                    ],
                },
            )
            empty_publish = await client.patch(
                f"/kt/{test['id']}", json={"status": "published"}
            )
        assert two_right.status_code == 422
        assert empty_publish.status_code == 409

    async def test_other_departments_test_is_invisible(self, db_session, dept):
        test = await _published_test(db_session, dept)
        async with _client(db_session, dept["outsider"]) as client:
            got = await client.get(f"/kt/{test['id']}")
            start = await client.post(f"/kt/{test['id']}/attempts")
        assert got.status_code == 404
        assert start.status_code == 404


class TestSitting:
    async def test_answers_are_never_delivered_before_submission(
        self, db_session, dept
    ):
        test = await _published_test(db_session, dept, show_correct_answers=False)
        async with _client(db_session, dept["member"]) as client:
            detail = await client.get(f"/kt/{test['id']}")
            attempt = await client.post(f"/kt/{test['id']}/attempts")
        assert "questions" not in detail.json()
        body = attempt.json()
        assert attempt.status_code == 201
        assert body["review"] is None
        for q in body["questions"]:
            assert set(q) == {"id", "prompt", "question_type", "options", "points"}
            for option in q["options"]:
                assert set(option) == {"id", "text"}

    async def test_a_full_pass_is_graded_and_credited(self, db_session, dept):
        test = await _published_test(db_session, dept, show_correct_answers=True)
        async with _client(db_session, dept["officer"]) as client:
            detail = (await client.get(f"/kt/{test['id']}")).json()
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
            # Starting again resumes rather than drawing a second paper.
            again = (await client.post(f"/kt/{test['id']}/attempts")).json()
            saved = await client.put(
                f"/kt/attempts/{attempt['id']}/answers",
                json={"answers": _correct_answers(detail, attempt)},
            )
            result = await client.post(f"/kt/attempts/{attempt['id']}/submit")
        assert again["id"] == attempt["id"]
        assert saved.status_code == 200
        body = result.json()
        assert body["status"] == "submitted"
        assert body["score"] == 100.0
        assert body["passed"] is True
        assert body["credited"] is True
        assert all(q["correct"] for q in body["review"])
        await db_session.refresh(dept["progress"])
        assert dept["progress"].status == RequirementProgressStatus.COMPLETED
        notes = dept["progress"].progress_notes
        assert notes["test_attempts"][-1]["source"] == "online_test"
        assert notes["latest_score"] == 100.0

    async def test_multiple_choice_needs_the_exact_set(self, db_session, dept):
        test = await _published_test(db_session, dept)
        async with _client(db_session, dept["officer"]) as client:
            detail = (await client.get(f"/kt/{test['id']}")).json()
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
            answers = _correct_answers(detail, attempt)
            multi = next(
                q
                for q in attempt["questions"]
                if q["question_type"] == "multiple_choice"
            )
            # Ticking every box is not "including the right ones".
            answers[multi["id"]] = [o["id"] for o in multi["options"]]
            await client.put(
                f"/kt/attempts/{attempt['id']}/answers", json={"answers": answers}
            )
            result = (await client.post(f"/kt/attempts/{attempt['id']}/submit")).json()
        assert result["score"] == 80.0
        # Answers hidden: the test does not show them, and this is the member.
        assert result["review"] is None

    async def test_answers_are_validated_against_the_paper(self, db_session, dept):
        test = await _published_test(db_session, dept)
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
            single = next(
                q for q in attempt["questions"] if q["question_type"] == "single_choice"
            )
            bad_question = await client.put(
                f"/kt/attempts/{attempt['id']}/answers",
                json={"answers": {"nope": []}},
            )
            two_for_one = await client.put(
                f"/kt/attempts/{attempt['id']}/answers",
                json={"answers": {single["id"]: [o["id"] for o in single["options"]]}},
            )
        assert bad_question.status_code == 400
        assert two_for_one.status_code == 400

    async def test_another_member_cannot_touch_an_attempt(self, db_session, dept):
        test = await _published_test(db_session, dept)
        other = await _make_user(db_session, dept["org_id"], "Nosy")
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
        async with _client(db_session, other) as client:
            got = await client.get(f"/kt/attempts/{attempt['id']}")
            submit = await client.post(f"/kt/attempts/{attempt['id']}/submit")
        async with _client(db_session, dept["officer"]) as client:
            officer_view = await client.get(f"/kt/attempts/{attempt['id']}")
            officer_submit = await client.post(f"/kt/attempts/{attempt['id']}/submit")
        assert got.status_code == 404
        assert submit.status_code == 404
        assert officer_view.status_code == 200
        # Only the member sitting it may submit it.
        assert officer_submit.status_code == 404

    async def test_question_count_draws_a_subset(self, db_session, dept):
        test = await _published_test(db_session, dept, question_count=3)
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
            listed = (await client.get("/kt")).json()
        assert len(attempt["questions"]) == 3
        # A member is told how many they will be asked, not the bank size.
        assert listed[0]["active_question_count"] == 3

    async def test_an_expired_attempt_is_graded_on_what_was_saved(
        self, db_session, dept
    ):
        test = await _published_test(db_session, dept, time_limit_minutes=5)
        async with _client(db_session, dept["member"]) as client:
            attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
        row = await db_session.get(KnowledgeTestAttempt, attempt["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        await db_session.flush()
        async with _client(db_session, dept["member"]) as client:
            late = await client.put(
                f"/kt/attempts/{attempt['id']}/answers", json={"answers": {}}
            )
            got = (await client.get(f"/kt/attempts/{attempt['id']}")).json()
        assert late.status_code == 409
        assert got["status"] == "submitted"
        assert got["score"] == 0.0


class TestAttemptCap:
    async def test_the_requirement_cap_is_shared_with_officer_scores(
        self, db_session, dept
    ):
        test = await _published_test(db_session, dept)
        # Two failed attempts already recorded the old way, by an officer.
        dept["progress"].progress_notes = {
            "test_attempts": [{"score": 40, "passed": False}] * 2
        }
        dept["progress"].status = RequirementProgressStatus.IN_PROGRESS
        await db_session.flush()
        async with _client(db_session, dept["member"]) as client:
            refused = await client.post(f"/kt/{test['id']}/attempts")
        assert refused.status_code == 400
        assert "Maximum attempts" in refused.json()["detail"]

    async def test_a_failed_attempt_spends_one(self, db_session, dept):
        test = await _published_test(db_session, dept)
        async with _client(db_session, dept["member"]) as client:
            for _ in range(2):
                attempt = (await client.post(f"/kt/{test['id']}/attempts")).json()
                done = (
                    await client.post(f"/kt/attempts/{attempt['id']}/submit")
                ).json()
                assert done["passed"] is False
                assert done["credited"] is True
            third = await client.post(f"/kt/{test['id']}/attempts")
        assert third.status_code == 400

    async def test_delete_is_refused_once_sat(self, db_session, dept):
        test = await _published_test(db_session, dept)
        async with _client(db_session, dept["member"]) as client:
            await client.post(f"/kt/{test['id']}/attempts")
        async with _client(db_session, dept["officer"]) as client:
            refused = await client.delete(f"/kt/{test['id']}")
            attempts = (await client.get(f"/kt/{test['id']}/attempts")).json()
        assert refused.status_code == 409
        assert [a["user_name"] for a in attempts] == [dept["member"].display_name]
