"""
Renaming a rank's code carries every stored reference to it along.

A rank is referenced by its code, with no foreign key, in four places that
match it exactly: members (``users.rank``), org chart seats
(``org_chart_nodes.rank_code``), training requirements scoped by rank
(``training_requirements.required_roles``) and saved inventory impact plans
(``inventory_impact_plans.filters["ranks"]``). Only the first used to follow a
rename, so a renamed rank's seats showed no holders, its requirements graded
nobody and its saved plans selected no one.

Real database: the point is what the UPDATEs and JSON rewrites actually leave
in the rows, and that another organization using the same code is untouched.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.inventory import InventoryImpactPlan
from app.models.operational_rank import OperationalRank
from app.models.org_chart import OrgChartNode
from app.models.training import (
    RequirementFrequency,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.operational_rank import RankUpdate
from app.services.operational_rank_service import OperationalRankService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _department(db: AsyncSession) -> dict:
    """An organization whose custom battalion-chief rank is referenced from
    every store. Custom, because a built-in rank's code cannot change."""
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"org-{org_id[:8]}"},
    )
    member_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, `rank`) "
            "VALUES (:id, :org, :un, 'Pat', 'Tester', :em, 'hashed', 'active', "
            "'battalion_chief')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"pat-{member_id[:8]}",
            "em": f"pat-{member_id[:8]}@test.com",
        },
    )
    rank = OperationalRank(
        organization_id=org_id,
        rank_code="battalion_chief",
        display_name="Battalion Chief",
        sort_order=3,
    )
    seat = OrgChartNode(
        organization_id=org_id, title="Battalion Chief", rank_code="battalion_chief"
    )
    requirement = TrainingRequirement(
        organization_id=org_id,
        name="Officer development",
        requirement_type=RequirementType.HOURS,
        frequency=RequirementFrequency.ANNUAL,
        applies_to_all=False,
        required_roles=["battalion_chief", "lieutenant"],
    )
    plan = InventoryImpactPlan(
        organization_id=org_id,
        name="Officer coats",
        filters={"ranks": ["battalion_chief"], "statuses": ["active"]},
    )
    db.add_all([rank, seat, requirement, plan])
    await db.flush()
    return {
        "org": org_id,
        "member": member_id,
        "rank": str(rank.id),
        "seat": str(seat.id),
        "requirement": str(requirement.id),
        "plan": str(plan.id),
    }


async def _references(db: AsyncSession, dept: dict) -> dict:
    db.expire_all()
    member = await db.get(User, dept["member"])
    seat = await db.get(OrgChartNode, dept["seat"])
    requirement = await db.get(TrainingRequirement, dept["requirement"])
    plan = await db.get(InventoryImpactPlan, dept["plan"])
    assert member is not None
    assert seat is not None
    assert requirement is not None
    assert plan is not None
    return {
        "member": member.rank,
        "seat": seat.rank_code,
        "requirement": requirement.required_roles,
        "plan": plan.filters,
    }


async def _rename(db: AsyncSession, dept: dict, actor: str = "chief-1"):
    return await OperationalRankService(db).update_rank(
        uuid.UUID(dept["rank"]),
        RankUpdate(rank_code="district_chief"),
        dept["org"],
        actor_id=None,
        actor_username=actor,
    )


class TestRankRenameMovesReferences:
    async def test_every_store_follows_the_rename(self, db_session):
        dept = await _department(db_session)

        renamed = await _rename(db_session, dept)

        assert renamed is not None
        assert renamed.rank_code == "district_chief"
        assert await _references(db_session, dept) == {
            "member": "district_chief",
            "seat": "district_chief",
            "requirement": ["district_chief", "lieutenant"],
            "plan": {"ranks": ["district_chief"], "statuses": ["active"]},
        }

    async def test_another_department_using_the_same_code_is_untouched(
        self, db_session
    ):
        ours = await _department(db_session)
        theirs = await _department(db_session)

        await _rename(db_session, ours)

        assert await _references(db_session, theirs) == {
            "member": "battalion_chief",
            "seat": "battalion_chief",
            "requirement": ["battalion_chief", "lieutenant"],
            "plan": {"ranks": ["battalion_chief"], "statuses": ["active"]},
        }

    async def test_a_label_edit_moves_nothing(self, db_session):
        dept = await _department(db_session)

        await OperationalRankService(db_session).update_rank(
            uuid.UUID(dept["rank"]), RankUpdate(display_name="Skipper"), dept["org"]
        )

        assert (await _references(db_session, dept))["seat"] == "battalion_chief"

    async def test_the_rename_is_audited_with_both_codes_and_counts(self, db_session):
        dept = await _department(db_session)
        # A second seat, so the count is not the trivial 1.
        db_session.add(
            OrgChartNode(
                organization_id=dept["org"], title="Acting", rank_code="battalion_chief"
            )
        )
        await db_session.flush()

        await _rename(db_session, dept, actor="chief-audit")

        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.organization_id == dept["org"],
                        AuditLog.event_type == "operational_rank.code_renamed",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(entries) == 1
        entry = entries[0]
        assert entry.username == "chief-audit"
        assert entry.event_data["old_rank_code"] == "battalion_chief"
        assert entry.event_data["new_rank_code"] == "district_chief"
        assert entry.event_data["references_updated"] == {
            "members": 1,
            "org_chart_seats": 2,
            "training_requirements": 1,
            "impact_plans": 1,
        }


async def _built_in_captain(db: AsyncSession) -> dict:
    """A department holding the seeded captain rank, with one captain."""
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Built-in Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"bi-{org_id[:8]}"},
    )
    member_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, `rank`) "
            "VALUES (:id, :org, :un, 'Cap', 'Tester', :em, 'hashed', 'active', "
            "'captain')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"cap-{member_id[:8]}",
            "em": f"cap-{member_id[:8]}@test.com",
        },
    )
    rank = OperationalRank(
        organization_id=org_id,
        rank_code="captain",
        display_name="Captain",
        sort_order=3,
    )
    db.add(rank)
    await db.flush()
    return {"org": org_id, "member": member_id, "rank": str(rank.id)}


class TestBuiltInRankCodeIsLocked:
    """Owner decision 2026-10-22: the registry keys a built-in rank's default
    permissions by its code, so the code stays; the display name may change."""

    async def test_a_code_change_is_refused_and_moves_nothing(self, db_session):
        dept = await _built_in_captain(db_session)

        with pytest.raises(ValueError, match="built-in rank"):
            await OperationalRankService(db_session).update_rank(
                uuid.UUID(dept["rank"]),
                RankUpdate(rank_code="company_captain"),
                dept["org"],
            )

        db_session.expire_all()
        rank = await db_session.get(OperationalRank, dept["rank"])
        member = await db_session.get(User, dept["member"])
        assert rank is not None
        assert rank.rank_code == "captain"
        assert member is not None
        assert member.rank == "captain"

    async def test_the_display_name_still_changes(self, db_session):
        dept = await _built_in_captain(db_session)

        renamed = await OperationalRankService(db_session).update_rank(
            uuid.UUID(dept["rank"]),
            # Re-sending the unchanged code, as a full form save does, is fine.
            RankUpdate(rank_code="captain", display_name="Company Officer"),
            dept["org"],
        )

        assert renamed is not None
        assert renamed.rank_code == "captain"
        assert renamed.display_name == "Company Officer"

    async def test_a_custom_rank_renamed_onto_nothing_built_in_is_free(
        self, db_session
    ):
        dept = await _department(db_session)
        renamed = await _rename(db_session, dept)
        assert renamed is not None
        assert renamed.rank_code == "district_chief"
