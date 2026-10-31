"""Interview stages naming required interviewer positions, and case managers
told when their applicant needs them.

Through the real service and router against the real schema: who counts for a
position is decided by the positions a member holds, through user_positions,
and the snapshot taken when the interview is logged; a mocked session
evaluates neither.

The pipeline is Application -> Board Interview -> Done. Board Interview needs
one interview by the Chief and one by a member of the Board of Directors.
"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.membership_pipeline import (
    MembershipPipeline,
    ProspectAssignment,
    ProspectInterview,
)
from app.models.user import User
from app.services.email_service import EmailService
from app.services.membership_pipeline_service import (
    MembershipPipelineService,
    interviewer_title,
)
from app.services.prospect_assignment_service import ProspectAssignmentService
from tests.test_prospect_access import VIEW_ALL, _call, _org

pytestmark = [pytest.mark.integration]

REQUIRED = ["chief", "board_of_directors"]


def _uid() -> str:
    return str(uuid.uuid4())


async def _position(
    db: AsyncSession,
    org_id: str,
    slug: str,
    name: str,
    *,
    priority: int = 0,
    kind: str = "office",
    perms=(),
) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "priority, kind) VALUES (:id, :org, :name, :slug, :perms, :prio, :kind)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": slug,
            "perms": json.dumps(list(perms)),
            "prio": priority,
            "kind": kind,
        },
    )
    return position_id


async def _person(db: AsyncSession, org_id: str, name: str, *position_ids) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            ":fn, 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{name}-{user_id[:8]}",
            "fn": name.title(),
            "em": f"{name}-{user_id[:8]}@dept.example",
        },
    )
    for position_id in position_ids:
        await _hold(db, user_id, position_id)
    await db.flush()
    return await _reload(db, user_id)


async def _hold(db: AsyncSession, user_id: str, position_id: str) -> None:
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )


async def _reload(db: AsyncSession, user_id: str) -> User:
    db.expire_all()
    return (
        await db.execute(
            select(User).where(User.id == user_id).options(selectinload(User.positions))
        )
    ).scalar_one()


@pytest.fixture
async def board(db_session: AsyncSession):
    org_id = await _org(db_session)
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Pipeline")
    steps = {}
    for name, step_type, config in (
        ("Application", "checkbox", {}),
        (
            "Board Interview",
            "interview_requirement",
            {"required_count": 2, "required_interviewer_positions": REQUIRED},
        ),
        ("Done", "checkbox", {}),
    ):
        step = await svc.add_step(
            str(pipeline.id),
            org_id,
            {"name": name, "step_type": step_type, "required": False, "config": config},
        )
        steps[name] = str(step.id)

    applicant = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Riley",
            "last_name": "Bishop",
            "email": f"riley-{org_id[:8]}@example.com",
            "pipeline_id": str(pipeline.id),
        },
    )
    other = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Other",
            "last_name": "Applicant",
            "email": f"other-{org_id[:8]}@example.com",
            "pipeline_id": str(pipeline.id),
        },
    )

    chief = await _position(db_session, org_id, "fire_chief", "Fire Chief", priority=90)
    board_seat = await _position(
        db_session,
        org_id,
        "board_of_directors",
        "Board of Directors",
        priority=10,
        kind="committee",
    )
    coordinator_pos = await _position(
        db_session, org_id, "coordinator", "Coordinator", perms=VIEW_ALL
    )

    w = SimpleNamespace(org_id=org_id, steps=steps, pipeline_id=str(pipeline.id))
    w.applicant_id = str(applicant.id)
    w.other_id = str(other.id)
    w.chief_position = chief
    w.board_position = board_seat
    # Plain ids and addresses: a commit expires every loaded User, and reading
    # an expired attribute outside the session's own await fails.
    people = {}
    for name, positions in (
        ("chief", [chief]),
        ("director", [board_seat]),
        ("newcomer", []),
        ("coordinator", [coordinator_pos]),
        ("case_manager", []),
    ):
        member = await _person(db_session, org_id, name, *positions)
        people[name] = SimpleNamespace(id=str(member.id), email=member.email)
        setattr(w, name, people[name])
    for name, role in (
        ("case_manager", "case_manager"),
        ("chief", "interviewer"),
        ("director", "interviewer"),
        ("newcomer", "interviewer"),
    ):
        db_session.add(
            ProspectAssignment(
                organization_id=org_id,
                prospect_id=w.applicant_id,
                user_id=people[name].id,
                role=role,
                assigned_by=people["coordinator"].id,
            )
        )
    await db_session.commit()
    return w


async def _as(db: AsyncSession, member) -> User:
    """The member as a loaded User, for a request made as them."""
    return await _reload(db, member.id)


@pytest.fixture
def attention():
    sender = AsyncMock(return_value=True)
    with patch.object(EmailService, "send_applicant_needs_attention_email", sender):
        yield sender


async def _to_interview_stage(db: AsyncSession, w) -> None:
    await MembershipPipelineService(db).complete_step(
        w.applicant_id, w.org_id, w.steps["Application"], w.coordinator.id
    )


async def _interview(db: AsyncSession, w, member) -> ProspectInterview:
    return await MembershipPipelineService(db).create_interview(
        prospect_id=w.applicant_id,
        organization_id=w.org_id,
        interviewer_id=member.id,
        notes="Spoke for an hour.",
        recommendation="recommend",
    )


async def _complete_interview_stage(db: AsyncSession, w):
    return await MembershipPipelineService(db).complete_step(
        w.applicant_id, w.org_id, w.steps["Board Interview"], w.coordinator.id
    )


async def _set_required(db: AsyncSession, w, required) -> None:
    await db.execute(
        text("UPDATE membership_pipeline_steps SET config = :c WHERE id = :id"),
        {
            "c": json.dumps(
                {"required_count": 1, "required_interviewer_positions": required}
            ),
            "id": w.steps["Board Interview"],
        },
    )
    await db.commit()
    db.expire_all()


class TestSnapshot:
    async def test_an_interview_records_what_its_interviewer_held(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)

        interview = await _interview(db_session, board, board.chief)

        # The position's slug and name, and the office it maps to.
        assert {"fire_chief", "fire chief", "chief"} <= set(
            interview.interviewer_positions
        )
        assert "board_of_directors" not in interview.interviewer_positions


class TestGrading:
    async def test_the_stage_waits_for_each_required_position(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)
        await _interview(db_session, board, board.newcomer)

        with pytest.raises(
            ValueError,
            match=r"^An interview is still needed from: Board of Directors\.$",
        ):
            await _complete_interview_stage(db_session, board)

    async def test_it_completes_once_every_position_has_interviewed(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)
        await _interview(db_session, board, board.director)

        prospect = await _complete_interview_stage(db_session, board)

        assert str(prospect.current_step_id) == board.steps["Done"]

    async def test_an_interview_counts_for_the_office_held_that_day(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)
        await _interview(db_session, board, board.director)
        # The chief steps down after interviewing.
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"),
            {"u": board.chief.id},
        )
        await db_session.commit()

        prospect = await _complete_interview_stage(db_session, board)

        assert str(prospect.current_step_id) == board.steps["Done"]

    async def test_taking_an_office_later_does_not_count_an_earlier_interview(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)
        await _interview(db_session, board, board.newcomer)
        await _hold(db_session, board.newcomer.id, board.board_position)
        await db_session.commit()

        with pytest.raises(ValueError, match="Board of Directors"):
            await _complete_interview_stage(db_session, board)

    async def test_an_interview_from_before_snapshots_counts_current_positions(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)
        director_interview = await _interview(db_session, board, board.director)
        await db_session.execute(
            text(
                "UPDATE prospect_interviews SET interviewer_positions = NULL "
                "WHERE id = :id"
            ),
            {"id": director_interview.id},
        )
        await db_session.commit()
        db_session.expire_all()

        prospect = await _complete_interview_stage(db_session, board)

        assert str(prospect.current_step_id) == board.steps["Done"]

    async def test_a_blank_position_keeps_the_stage_closed(
        self, db_session, board, attention
    ):
        await _set_required(db_session, board, ["chief", " "])
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)

        with pytest.raises(ValueError, match="still needed"):
            await _complete_interview_stage(db_session, board)

    async def test_positions_are_matched_trimmed_and_case_blind(
        self, db_session, board, attention
    ):
        await _set_required(db_session, board, [" Chief "])
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)

        prospect = await _complete_interview_stage(db_session, board)

        assert str(prospect.current_step_id) == board.steps["Done"]


class TestProgress:
    async def test_it_reports_each_position_and_the_count(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)

        res = await _call(
            db_session,
            await _as(db_session, board.coordinator),
            "GET",
            f"/prospects/{board.applicant_id}/interview-requirement",
        )

        assert res.status_code == 200
        assert res.json() == {
            "step_id": board.steps["Board Interview"],
            "required_count": 2,
            "recorded_count": 1,
            "required_recommendation": None,
            "recommendation_met": None,
            "positions": [
                {"position": "chief", "label": "Chief", "satisfied": True},
                {
                    "position": "board_of_directors",
                    "label": "Board of Directors",
                    "satisfied": False,
                },
            ],
            "complete": False,
        }

    async def test_an_interviewer_is_not_told_how_others_recommended(
        self, db_session, board, attention
    ):
        await _set_required(db_session, board, [])
        await db_session.execute(
            text("UPDATE membership_pipeline_steps SET config = :c WHERE id = :id"),
            {
                "c": '{"required_count": 1, "required_recommendation": "recommend"}',
                "id": board.steps["Board Interview"],
            },
        )
        await db_session.commit()
        await _to_interview_stage(db_session, board)
        await _interview(db_session, board, board.chief)

        as_coordinator = await _call(
            db_session,
            await _as(db_session, board.coordinator),
            "GET",
            f"/prospects/{board.applicant_id}/interview-requirement",
        )
        as_interviewer = await _call(
            db_session,
            await _as(db_session, board.director),
            "GET",
            f"/prospects/{board.applicant_id}/interview-requirement",
        )

        assert as_coordinator.json()["recommendation_met"] is True
        assert as_interviewer.json()["recommendation_met"] is None

    async def test_it_is_null_off_an_interview_stage(
        self, db_session, board, attention
    ):
        res = await _call(
            db_session,
            await _as(db_session, board.coordinator),
            "GET",
            f"/prospects/{board.applicant_id}/interview-requirement",
        )

        assert res.status_code == 200
        assert res.json() is None

    async def test_a_member_with_no_access_gets_404(self, db_session, board, attention):
        res = await _call(
            db_session,
            await _as(db_session, board.case_manager),
            "GET",
            f"/prospects/{board.other_id}/interview-requirement",
        )

        assert res.status_code == 404


class TestInterviewerTitle:
    async def test_it_is_the_most_senior_office(self, db_session, board):
        await _hold(db_session, board.chief.id, board.board_position)
        await db_session.commit()

        res = await _call(
            db_session,
            await _as(db_session, board.chief),
            "GET",
            f"/prospects/{board.applicant_id}/my-access",
        )

        assert res.json()["interviewer_title"] == "Fire Chief"

    async def test_an_office_outranks_a_platform_position(self):
        positions = [
            SimpleNamespace(
                name="IT Manager", slug="it_manager", kind="system", priority=100
            ),
            SimpleNamespace(
                name="Treasurer", slug="treasurer", kind="office", priority=40
            ),
            SimpleNamespace(name="Member", slug="member", kind="system", priority=1),
        ]

        assert interviewer_title(positions) == "Treasurer"

    async def test_the_baseline_member_position_is_no_title(self):
        positions = [
            SimpleNamespace(name="Member", slug="member", kind="system", priority=1)
        ]

        assert interviewer_title(positions) is None


class TestCaseManagerNotices:
    async def test_reaching_an_interview_stage_tells_the_case_manager_only(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)

        assert [c.kwargs["to_email"] for c in attention.await_args_list] == [
            board.case_manager.email
        ]
        kwargs = attention.await_args.kwargs
        assert kwargs["event_summary"] == (
            "Riley Bishop has reached the Board Interview stage, which needs "
            "interviews."
        )
        assert kwargs["applicant_url"].endswith(
            f"/prospective-members/my-applicants?applicant={board.applicant_id}"
        )

    async def test_moving_onto_a_checkbox_stage_tells_nobody(
        self, db_session, board, attention
    ):
        await _to_interview_stage(db_session, board)
        attention.reset_mock()
        await _interview(db_session, board, board.chief)
        await _interview(db_session, board, board.director)

        await _complete_interview_stage(db_session, board)

        attention.assert_not_awaited()

    async def test_a_case_manager_already_told_is_skipped(
        self, db_session, board, attention
    ):
        prospect = await MembershipPipelineService(db_session).get_prospect(
            board.applicant_id, board.org_id
        )

        sent = await ProspectAssignmentService(db_session).notify_case_managers(
            prospect, "withdrew", already_told=[board.case_manager.id]
        )

        assert sent == 0
        attention.assert_not_awaited()

    async def test_a_self_withdrawal_tells_the_case_manager(
        self, db_session, board, attention
    ):
        pipeline = await db_session.get(MembershipPipeline, board.pipeline_id)
        pipeline.public_status_enabled = True
        prospect = await MembershipPipelineService(db_session).get_prospect(
            board.applicant_id, board.org_id
        )
        prospect.status_token = f"tok-{board.applicant_id}"
        await db_session.commit()

        with patch.object(
            MembershipPipelineService,
            "_notify_coordinators_of_withdrawal",
            AsyncMock(return_value=[]),
        ):
            await MembershipPipelineService(db_session).withdraw_prospect_by_token(
                f"tok-{board.applicant_id}", "Moving away"
            )

        [call] = attention.await_args_list
        assert call.kwargs["to_email"] == board.case_manager.email
        assert call.kwargs["event_summary"] == (
            "Riley Bishop withdrew their application from their application "
            "status page."
        )


class TestAssignedToMe:
    @pytest.mark.parametrize(
        ("query", "expected"),
        [("", {"applicant", "other"}), ("?assigned_to_me=true", {"applicant"})],
    )
    async def test_the_list(self, db_session, board, query, expected):
        db_session.add(
            ProspectAssignment(
                organization_id=board.org_id,
                prospect_id=board.applicant_id,
                user_id=board.coordinator.id,
                role="case_manager",
                assigned_by=board.coordinator.id,
            )
        )
        await db_session.commit()
        ids = {board.applicant_id: "applicant", board.other_id: "other"}

        sep = "&" if query else "?"
        res = await _call(
            db_session,
            await _as(db_session, board.coordinator),
            "GET",
            f"/prospects{query}{sep}pipeline_id={board.pipeline_id}",
        )

        assert {ids[i["id"]] for i in res.json()["items"]} == expected

    async def test_the_board(self, db_session, board):
        db_session.add(
            ProspectAssignment(
                organization_id=board.org_id,
                prospect_id=board.applicant_id,
                user_id=board.coordinator.id,
                role="interviewer",
                assigned_by=board.coordinator.id,
            )
        )
        await db_session.commit()

        res = await _call(
            db_session,
            await _as(db_session, board.coordinator),
            "GET",
            f"/pipelines/{board.pipeline_id}/kanban?assigned_to_me=true",
        )

        shown = {
            p["id"] for column in res.json()["columns"] for p in column["prospects"]
        }
        assert shown == {board.applicant_id}
