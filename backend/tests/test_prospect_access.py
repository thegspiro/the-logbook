"""Per-applicant access: case managers, interviewers and prospective_members.view_all.

Through the real router and dependency stack, against the real schema: who an
applicant is visible to is decided by joins on prospect_assignments and by the
permissions a member's positions carry, and a mocked session evaluates
neither.

The members below hold exactly what their name says:

- ``coordinator``: view, manage and view_all, as every position that held
  view or manage does after migration c588f525fdbb;
- ``restricted``: manage without view_all, so only assigned applicants;
- ``case_manager`` and ``interviewer``: no pipeline permission at all, only
  their assignment (a board member, a trustee);
- ``stranger``: no permission and no assignment.
"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints
from app.core.database import get_db
from app.models.membership_pipeline import (
    ProspectActivityLog,
    ProspectAssignment,
    ProspectInterview,
)
from app.models.user import User
from app.services.email_service import EmailService
from app.services.membership_pipeline_service import MembershipPipelineService
from app.services.prospect_access import ProspectAccess

pytestmark = [pytest.mark.integration]

VIEW_ALL = [
    "prospective_members.view",
    "prospective_members.manage",
    "prospective_members.view_all",
]


def _uid() -> str:
    return str(uuid.uuid4())


async def _member(db: AsyncSession, org_id: str, name: str, perms=None) -> User:
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
    if perms is not None:
        position_id = _uid()
        await db.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": org_id,
                "name": name.title(),
                "slug": f"{name}-{position_id[:8]}",
                "perms": json.dumps(perms),
            },
        )
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
    await db.flush()
    return (
        await db.execute(
            select(User).where(User.id == user_id).options(selectinload(User.positions))
        )
    ).scalar_one()


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Access VFD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"access-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


@pytest.fixture
async def world(db_session: AsyncSession):
    org_id = await _org(db_session)
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Pipeline")
    for i in range(3):
        await svc.add_step(
            str(pipeline.id),
            org_id,
            {
                "name": f"Stage {i + 1}",
                "step_type": "checkbox",
                "required": False,
                "config": {},
            },
        )
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
    w = SimpleNamespace(org_id=org_id, pipeline_id=str(pipeline.id))
    w.applicant_id = str(applicant.id)
    w.other_id = str(other.id)
    w.coordinator = await _member(db_session, org_id, "coordinator", VIEW_ALL)
    w.restricted = await _member(
        db_session, org_id, "restricted", ["prospective_members.manage"]
    )
    w.case_manager = await _member(db_session, org_id, "casemgr")
    w.interviewer = await _member(db_session, org_id, "interviewer")
    w.stranger = await _member(db_session, org_id, "stranger")
    for member, role in (
        (w.case_manager, "case_manager"),
        (w.interviewer, "interviewer"),
    ):
        db_session.add(
            ProspectAssignment(
                organization_id=org_id,
                prospect_id=w.applicant_id,
                user_id=member.id,
                role=role,
                assigned_by=w.coordinator.id,
            )
        )
    await db_session.commit()
    return w


@pytest.fixture
def mail():
    sender = AsyncMock(return_value=True)
    with patch.object(EmailService, "send_applicant_assigned_email", sender):
        yield sender


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(pipeline_endpoints.router, prefix="/pm")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _call(db_session, user, method, path, **kwargs):
    async with _client(db_session, user) as client:
        return await client.request(method, f"/pm{path}", **kwargs)


class TestAccessRules:
    """The table the endpoints ask, without the HTTP layer."""

    @pytest.mark.parametrize(
        ("access", "see", "full", "work", "manage", "interview", "all_interviews"),
        [
            (ProspectAccess(True, True, frozenset()), 1, 1, 1, 1, 1, 1),
            (ProspectAccess(False, True, frozenset()), 0, 0, 0, 0, 0, 0),
            (ProspectAccess(False, True, frozenset({"interviewer"})), 1, 1, 1, 1, 1, 1),
            (
                ProspectAccess(False, False, frozenset({"case_manager"})),
                1,
                1,
                1,
                0,
                1,
                1,
            ),
            (
                ProspectAccess(False, False, frozenset({"interviewer"})),
                1,
                0,
                0,
                0,
                1,
                0,
            ),
            (ProspectAccess(False, False, frozenset()), 0, 0, 0, 0, 0, 0),
            (ProspectAccess(True, False, frozenset()), 1, 1, 0, 0, 0, 1),
        ],
        ids=[
            "coordinator",
            "manager-unassigned",
            "manager-assigned",
            "case-manager",
            "interviewer",
            "stranger",
            "view-all-only",
        ],
    )
    def test_levels(self, access, see, full, work, manage, interview, all_interviews):
        assert (
            access.can_see,
            access.can_see_full,
            access.can_work,
            access.can_manage,
            access.can_log_interview,
            access.sees_all_interviews,
        ) == tuple(
            bool(x) for x in (see, full, work, manage, interview, all_interviews)
        )


class TestSeeing:
    @pytest.mark.parametrize(
        ("who", "expected"),
        [
            ("coordinator", 200),
            ("case_manager", 200),
            ("interviewer", 200),
            ("restricted", 404),
            ("stranger", 404),
        ],
    )
    async def test_the_applicant(self, db_session, world, who, expected):
        res = await _call(
            db_session, getattr(world, who), "GET", f"/prospects/{world.applicant_id}"
        )

        assert res.status_code == expected, res.text

    async def test_an_assignment_reaches_one_applicant_only(self, db_session, world):
        res = await _call(
            db_session, world.case_manager, "GET", f"/prospects/{world.other_id}"
        )

        assert res.status_code == 404

    async def test_documents_reach_an_interviewer(self, db_session, world):
        res = await _call(
            db_session,
            world.interviewer,
            "GET",
            f"/prospects/{world.applicant_id}/documents",
        )

        assert res.status_code == 200

    @pytest.mark.parametrize("path", ["activity", "events", "election-package"])
    async def test_the_full_file_does_not_reach_an_interviewer(
        self, db_session, world, path
    ):
        res = await _call(
            db_session,
            world.interviewer,
            "GET",
            f"/prospects/{world.applicant_id}/{path}",
        )

        assert res.status_code == 403

    async def test_the_activity_log_reaches_a_case_manager(self, db_session, world):
        res = await _call(
            db_session,
            world.case_manager,
            "GET",
            f"/prospects/{world.applicant_id}/activity",
        )

        assert res.status_code == 200


class TestLists:
    async def test_without_view_all_the_list_holds_assigned_applicants_only(
        self, db_session, world
    ):
        db_session.add(
            ProspectAssignment(
                organization_id=world.org_id,
                prospect_id=world.other_id,
                user_id=world.restricted.id,
                role="case_manager",
            )
        )
        await db_session.commit()

        res = await _call(db_session, world.restricted, "GET", "/prospects")
        board = await _call(
            db_session,
            world.restricted,
            "GET",
            f"/pipelines/{world.pipeline_id}/kanban",
        )

        assert res.status_code == 200
        assert [p["id"] for p in res.json()["items"]] == [world.other_id]
        cards = [
            card["id"]
            for column in board.json()["columns"]
            for card in column["prospects"]
        ]
        assert cards == [world.other_id]

    async def test_with_view_all_the_list_holds_everyone(self, db_session, world):
        res = await _call(db_session, world.coordinator, "GET", "/prospects")

        assert {p["id"] for p in res.json()["items"]} == {
            world.applicant_id,
            world.other_id,
        }

    async def test_a_manager_assigned_to_nobody_sees_an_empty_list(
        self, db_session, world
    ):
        res = await _call(db_session, world.restricted, "GET", "/prospects")

        assert res.json()["items"] == []

    @pytest.mark.parametrize(
        "path", ["/pipelines/{pipeline}/stats", "/widget-summary", "/source-events"]
    )
    async def test_pipeline_wide_figures_need_view_all(self, db_session, world, path):
        path = path.format(pipeline=world.pipeline_id)
        refused = await _call(db_session, world.restricted, "GET", path)
        allowed = await _call(db_session, world.coordinator, "GET", path)

        assert refused.status_code == 403
        assert allowed.status_code == 200

    async def test_bulk_actions_need_view_all(self, db_session, world):
        res = await _call(
            db_session,
            world.restricted,
            "POST",
            "/prospects/bulk-status",
            json={"prospect_ids": [world.applicant_id], "status": "on_hold"},
        )

        assert res.status_code == 403

    async def test_an_assigned_member_reads_the_pipeline_stages(
        self, db_session, world
    ):
        assigned = await _call(
            db_session, world.interviewer, "GET", f"/pipelines/{world.pipeline_id}"
        )
        stranger = await _call(
            db_session, world.stranger, "GET", f"/pipelines/{world.pipeline_id}"
        )

        assert assigned.status_code == 200
        assert stranger.status_code == 403


class TestMyApplicants:
    async def test_lists_the_callers_applicants_with_their_roles(
        self, db_session, world
    ):
        res = await _call(db_session, world.interviewer, "GET", "/my-applicants")

        assert res.status_code == 200
        assert [(p["id"], p["my_roles"]) for p in res.json()] == [
            (world.applicant_id, ["interviewer"])
        ]

    async def test_is_empty_for_a_member_assigned_to_nobody(self, db_session, world):
        res = await _call(db_session, world.stranger, "GET", "/my-applicants")

        assert res.json() == []

    async def test_my_access_reports_the_callers_actions(self, db_session, world):
        res = await _call(
            db_session,
            world.case_manager,
            "GET",
            f"/prospects/{world.applicant_id}/my-access",
        )

        assert res.json() == {
            "roles": ["case_manager"],
            "view_all": False,
            "can_work": True,
            "can_manage": False,
            "can_see_full": True,
            "can_log_interview": True,
        }


class TestWorking:
    async def test_a_case_manager_advances_and_moves_back(self, db_session, world):
        advanced = await _call(
            db_session,
            world.case_manager,
            "POST",
            f"/prospects/{world.applicant_id}/advance",
            json={},
        )
        back = await _call(
            db_session,
            world.case_manager,
            "POST",
            f"/prospects/{world.applicant_id}/regress",
            json={},
        )

        assert advanced.status_code == 200, advanced.text
        assert back.status_code == 200, back.text

    @pytest.mark.parametrize("status", ["rejected", "on_hold", "withdrawn"])
    async def test_a_case_manager_cannot_close_the_application(
        self, db_session, world, status
    ):
        res = await _call(
            db_session,
            world.case_manager,
            "POST",
            f"/prospects/{world.applicant_id}/status",
            json={"status": status},
        )

        assert res.status_code == 403

    async def test_an_interviewer_cannot_advance(self, db_session, world):
        res = await _call(
            db_session,
            world.interviewer,
            "POST",
            f"/prospects/{world.applicant_id}/advance",
            json={},
        )

        assert res.status_code == 403

    async def test_a_case_manager_edits_the_applicant(self, db_session, world):
        res = await _call(
            db_session,
            world.case_manager,
            "PUT",
            f"/prospects/{world.applicant_id}",
            json={"notes": "Called back on Tuesday"},
        )

        assert res.status_code == 200, res.text


class TestInterviews:
    async def test_an_interviewer_logs_and_sees_only_their_own(self, db_session, world):
        db_session.add(
            ProspectInterview(
                prospect_id=world.applicant_id,
                interviewer_id=world.coordinator.id,
                notes="Coordinator's impressions",
            )
        )
        await db_session.commit()

        created = await _call(
            db_session,
            world.interviewer,
            "POST",
            f"/prospects/{world.applicant_id}/interviews",
            json={"notes": "Board interview"},
        )
        listed = await _call(
            db_session,
            world.interviewer,
            "GET",
            f"/prospects/{world.applicant_id}/interviews",
        )
        coordinator_view = await _call(
            db_session,
            world.coordinator,
            "GET",
            f"/prospects/{world.applicant_id}/interviews",
        )

        assert created.status_code == 201, created.text
        assert [i["notes"] for i in listed.json()] == ["Board interview"]
        assert len(coordinator_view.json()) == 2

    async def test_an_interviewer_changes_only_their_own_interview(
        self, db_session, world
    ):
        theirs = ProspectInterview(
            prospect_id=world.applicant_id,
            interviewer_id=world.coordinator.id,
            notes="Coordinator's impressions",
        )
        mine = ProspectInterview(
            prospect_id=world.applicant_id,
            interviewer_id=world.interviewer.id,
            notes="Draft",
        )
        db_session.add_all([theirs, mine])
        await db_session.commit()

        other = await _call(
            db_session,
            world.interviewer,
            "PUT",
            f"/interviews/{theirs.id}",
            json={"notes": "Overwritten"},
        )
        own = await _call(
            db_session,
            world.interviewer,
            "PUT",
            f"/interviews/{mine.id}",
            json={"notes": "Final"},
        )

        assert other.status_code == 403
        assert own.status_code == 200, own.text

    async def test_an_unassigned_interviewer_loses_their_interview(
        self, db_session, world
    ):
        mine = ProspectInterview(
            prospect_id=world.applicant_id,
            interviewer_id=world.interviewer.id,
            notes="Draft",
        )
        db_session.add(mine)
        await db_session.commit()
        assignment = (
            await db_session.execute(
                select(ProspectAssignment).where(
                    ProspectAssignment.user_id == world.interviewer.id
                )
            )
        ).scalar_one()
        await db_session.delete(assignment)
        await db_session.commit()

        res = await _call(
            db_session,
            world.interviewer,
            "PUT",
            f"/interviews/{mine.id}",
            json={"notes": "Final"},
        )

        assert res.status_code == 404

    async def test_seeing_everyone_is_not_licence_to_edit_an_old_interview(
        self, db_session, world
    ):
        """A member who sees every applicant but does not manage them, and
        logged an interview while assigned, cannot change it once unassigned:
        editing one's own interview is the assignment's grant, not view_all's."""
        observer = await _member(
            db_session, world.org_id, "observer", ["prospective_members.view_all"]
        )
        mine = ProspectInterview(
            prospect_id=world.applicant_id,
            interviewer_id=observer.id,
            notes="Draft",
        )
        db_session.add(mine)
        await db_session.commit()

        res = await _call(
            db_session,
            observer,
            "PUT",
            f"/interviews/{mine.id}",
            json={"notes": "Final"},
        )

        assert res.status_code == 403


class TestAssigning:
    async def test_a_coordinator_assigns_a_member_who_is_emailed(
        self, db_session, world, mail
    ):
        res = await _call(
            db_session,
            world.coordinator,
            "POST",
            f"/prospects/{world.other_id}/assignments",
            json={"user_id": world.stranger.id, "role": "interviewer"},
        )
        now_visible = await _call(
            db_session, world.stranger, "GET", f"/prospects/{world.other_id}"
        )

        assert res.status_code == 201, res.text
        assert res.json()["role"] == "interviewer"
        assert now_visible.status_code == 200
        kwargs = mail.await_args.kwargs
        assert kwargs["to_email"] == world.stranger.email
        assert kwargs["role_label"] == "interviewer"
        assert kwargs["applicant_url"].endswith(
            f"/prospective-members/my-applicants?applicant={world.other_id}"
        )
        logged = (
            await db_session.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == world.other_id,
                    ProspectActivityLog.action == "assignment_added",
                )
            )
        ).scalar_one()
        assert logged.details["role"] == "interviewer"

    async def test_assigning_twice_changes_nothing(self, db_session, world, mail):
        body = {"user_id": world.stranger.id, "role": "case_manager"}
        first = await _call(
            db_session,
            world.coordinator,
            "POST",
            f"/prospects/{world.other_id}/assignments",
            json=body,
        )
        second = await _call(
            db_session,
            world.coordinator,
            "POST",
            f"/prospects/{world.other_id}/assignments",
            json=body,
        )

        assert first.json()["id"] == second.json()["id"]
        assert mail.await_count == 1
        rows = (
            await db_session.execute(
                select(ProspectAssignment).where(
                    ProspectAssignment.prospect_id == world.other_id
                )
            )
        ).all()
        assert len(rows) == 1

    async def test_a_member_of_another_department_cannot_be_assigned(
        self, db_session, world, mail
    ):
        foreign_org = await _org(db_session)
        foreigner = await _member(db_session, foreign_org, "foreigner")
        await db_session.commit()

        res = await _call(
            db_session,
            world.coordinator,
            "POST",
            f"/prospects/{world.other_id}/assignments",
            json={"user_id": foreigner.id, "role": "interviewer"},
        )

        assert res.status_code == 400
        mail.assert_not_awaited()

    async def test_a_former_member_cannot_be_assigned(self, db_session, world, mail):
        await db_session.execute(
            text("UPDATE users SET status = 'retired' WHERE id = :id"),
            {"id": world.stranger.id},
        )
        await db_session.commit()

        res = await _call(
            db_session,
            world.coordinator,
            "POST",
            f"/prospects/{world.other_id}/assignments",
            json={"user_id": world.stranger.id, "role": "interviewer"},
        )

        assert res.status_code == 400

    async def test_a_case_manager_cannot_assign_people(self, db_session, world, mail):
        res = await _call(
            db_session,
            world.case_manager,
            "POST",
            f"/prospects/{world.applicant_id}/assignments",
            json={"user_id": world.stranger.id, "role": "interviewer"},
        )

        assert res.status_code == 403

    async def test_unassigning_ends_access_at_once(self, db_session, world):
        listed = await _call(
            db_session,
            world.coordinator,
            "GET",
            f"/prospects/{world.applicant_id}/assignments",
        )
        interviewer_row = next(
            a for a in listed.json() if a["user_id"] == world.interviewer.id
        )

        removed = await _call(
            db_session,
            world.coordinator,
            "DELETE",
            f"/prospects/{world.applicant_id}/assignments/{interviewer_row['id']}",
        )
        after = await _call(
            db_session, world.interviewer, "GET", f"/prospects/{world.applicant_id}"
        )

        assert removed.status_code == 204
        assert after.status_code == 404

    async def test_an_assignment_on_another_applicant_cannot_be_removed_through_this_one(
        self, db_session, world
    ):
        listed = await _call(
            db_session,
            world.coordinator,
            "GET",
            f"/prospects/{world.applicant_id}/assignments",
        )
        assignment_id = listed.json()[0]["id"]

        res = await _call(
            db_session,
            world.coordinator,
            "DELETE",
            f"/prospects/{world.other_id}/assignments/{assignment_id}",
        )

        assert res.status_code == 404
