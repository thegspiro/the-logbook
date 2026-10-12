"""
The department competency heat-map is built from the levels already stored per
member — the same rows ``/competency/members/{id}`` serves — and grades nothing
itself (CLAUDE.md pitfall #29).
"""

import uuid

import pytest
from sqlalchemy import text

from app.models.training import CompetencyLevel, MemberCompetency, SkillEvaluation
from app.services.training_enhancement_service import CompetencyService

pytestmark = pytest.mark.integration


async def _member(db_session, org_id: str, last: str, status: str = "active") -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, station, `rank`) "
            "VALUES (:id, :org, :un, 'Sam', :ln, :em, 'x', :st, 'Station 2', "
            "'captain')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"hm-{user_id[:8]}",
            "ln": last,
            "em": f"hm-{user_id[:8]}@test.com",
            "st": status,
        },
    )
    await db_session.flush()
    return user_id


class TestDepartmentCompetencies:
    async def test_cells_are_the_stored_levels_the_member_view_reports(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        evaluated = await _member(db_session, org_id, "Alpha")
        unevaluated = await _member(db_session, org_id, "Bravo")
        departed = await _member(db_session, org_id, "Charlie", status="inactive")

        skill = SkillEvaluation(
            organization_id=org_id, name="Ladder Raise", category="Firefighting"
        )
        retired_skill = SkillEvaluation(
            organization_id=org_id, name="Old Drill", category="Legacy", active=False
        )
        db_session.add_all([skill, retired_skill])
        await db_session.flush()
        for user_id in (evaluated, departed):
            db_session.add(
                MemberCompetency(
                    organization_id=org_id,
                    user_id=user_id,
                    skill_evaluation_id=skill.id,
                    current_level=CompetencyLevel.PROFICIENT,
                    evaluation_count=2,
                )
            )
        await db_session.flush()

        svc = CompetencyService(db_session)
        heatmap = await svc.get_department_competencies(org_id)

        member_ids = [m["user_id"] for m in heatmap["members"]]
        # An active member with no evaluation is a row of empty cells, not
        # missing; a member who has left is not on the readiness map at all.
        assert evaluated in member_ids
        assert unevaluated in member_ids
        assert departed not in member_ids
        evaluated_row = next(m for m in heatmap["members"] if m["user_id"] == evaluated)
        assert evaluated_row["station"] == "Station 2"
        assert evaluated_row["rank"] == "captain"

        assert [s["name"] for s in heatmap["skills"]] == ["Ladder Raise"]

        cells = heatmap["competencies"]
        assert [(str(c.user_id), c.current_level) for c in cells] == [
            (evaluated, CompetencyLevel.PROFICIENT)
        ]
        assert cells[0].skill_name == "Ladder Raise"

        own_view = await svc.get_member_competencies(evaluated, org_id)
        assert [(c.id, c.current_level, c.skill_name) for c in own_view] == [
            (cells[0].id, cells[0].current_level, cells[0].skill_name)
        ]

    async def test_another_departments_rows_never_appear(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"hm-other-{other_org[:8]}"},
        )
        outsider = await _member(db_session, other_org, "Outsider")
        foreign_skill = SkillEvaluation(organization_id=other_org, name="Foreign")
        db_session.add(foreign_skill)
        await db_session.flush()
        db_session.add(
            MemberCompetency(
                organization_id=other_org,
                user_id=outsider,
                skill_evaluation_id=foreign_skill.id,
                current_level=CompetencyLevel.EXPERT,
                evaluation_count=1,
            )
        )
        await db_session.flush()

        heatmap = await CompetencyService(db_session).get_department_competencies(
            org_id
        )

        assert outsider not in [m["user_id"] for m in heatmap["members"]]
        assert heatmap["skills"] == []
        assert heatmap["competencies"] == []
