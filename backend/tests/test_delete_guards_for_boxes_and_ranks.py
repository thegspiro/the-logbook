"""Deleting a position or a rank must not strand what depends on it.

- A suggestion box's reviewer grant cascades with its position, so deleting
  the only position that reviews an open box left a box accepting submissions
  nobody could read — the state the box form itself refuses to save.
- An org chart seat names its rank by code with no foreign key, so a deleted
  rank left the seat linked to nothing. Members holding the rank already
  blocked the delete; a seat using it did not.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.models.operational_rank import OperationalRank
from app.models.org_chart import OrgChartNode
from app.models.suggestion import SuggestionBox, SuggestionBoxReviewer
from app.models.user import Position, user_roles
from app.services.operational_rank_service import OperationalRankService
from app.services.role_service import role_service

pytestmark = pytest.mark.integration


async def _position(db, org_id, name, permissions=None):
    position = Position(
        organization_id=org_id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        permissions=permissions or [],
    )
    db.add(position)
    await db.flush()
    return position


async def _box(db, org_id, name, *, active=True, positions=(), members=()):
    box = SuggestionBox(organization_id=org_id, name=name, is_active=active)
    db.add(box)
    await db.flush()
    for position_id in positions:
        db.add(
            SuggestionBoxReviewer(
                organization_id=org_id, box_id=box.id, position_id=position_id
            )
        )
    for user_id in members:
        db.add(
            SuggestionBoxReviewer(
                organization_id=org_id, box_id=box.id, user_id=user_id
            )
        )
    await db.flush()
    return box


async def _other_org(db):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    return org_id


@pytest.fixture
async def dept(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    # Deleting a position is refused if it would leave no administrator.
    chief = await _position(db_session, org_id, "Chief", ["*"])
    await db_session.execute(
        user_roles.insert().values(user_id=admin_id, position_id=chief.id)
    )
    await db_session.flush()
    return org_id, admin_id


async def _exists(db, model, row_id):
    return (
        await db.execute(select(model.id).where(model.id == row_id))
    ).scalar_one_or_none() is not None


class TestDeletingTheOnlyReviewerOfABox:
    async def test_it_is_refused_naming_the_box(self, db_session, dept):
        org_id, admin_id = dept
        safety = await _position(db_session, org_id, "Safety Officer")
        safety_id = str(safety.id)
        await _box(db_session, org_id, "Safety Concerns", positions=[safety_id])
        await db_session.commit()

        with pytest.raises(ValueError, match="only reviewer.*Safety Concerns"):
            await role_service.delete_role(db_session, safety_id, org_id, admin_id)

        assert await _exists(db_session, Position, safety_id)

    async def test_it_is_allowed_when_the_box_has_another_reviewer(
        self, db_session, dept
    ):
        org_id, admin_id = dept
        safety = await _position(db_session, org_id, "Safety Officer")
        captain = await _position(db_session, org_id, "Captain")
        safety_id, captain_id = str(safety.id), str(captain.id)
        box = await _box(
            db_session, org_id, "Safety Concerns", positions=[safety_id, captain_id]
        )
        box_id = box.id
        await db_session.commit()

        await role_service.delete_role(db_session, safety_id, org_id, admin_id)

        assert not await _exists(db_session, Position, safety_id)
        remaining = (
            (
                await db_session.execute(
                    select(SuggestionBoxReviewer.position_id).where(
                        SuggestionBoxReviewer.box_id == box_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert remaining == [captain_id]

    async def test_a_member_reviewer_counts_as_another_reviewer(self, db_session, dept):
        org_id, admin_id = dept
        safety = await _position(db_session, org_id, "Safety Officer")
        safety_id = str(safety.id)
        await _box(
            db_session,
            org_id,
            "Safety Concerns",
            positions=[safety_id],
            members=[admin_id],
        )
        await db_session.commit()

        await role_service.delete_role(db_session, safety_id, org_id, admin_id)

        assert not await _exists(db_session, Position, safety_id)

    async def test_a_closed_box_does_not_hold_it_back(self, db_session, dept):
        org_id, admin_id = dept
        safety = await _position(db_session, org_id, "Safety Officer")
        safety_id = str(safety.id)
        await _box(db_session, org_id, "Old Box", active=False, positions=[safety_id])
        await db_session.commit()

        await role_service.delete_role(db_session, safety_id, org_id, admin_id)

        assert not await _exists(db_session, Position, safety_id)


async def _rank(db, org_id, code, name):
    rank = OperationalRank(
        organization_id=org_id, rank_code=code, display_name=name, sort_order=1
    )
    db.add(rank)
    await db.flush()
    return rank


class TestDeletingARankAnOrgChartSeatUses:
    async def test_it_is_refused_naming_the_seat(self, db_session, dept):
        org_id, _ = dept
        rank = await _rank(db_session, org_id, "battalion_chief", "Battalion Chief")
        rank_id = rank.id
        db_session.add(
            OrgChartNode(
                organization_id=org_id,
                title="Shift Commander",
                rank_code="battalion_chief",
            )
        )
        await db_session.commit()

        with pytest.raises(ValueError, match="org chart seats.*'Shift Commander'"):
            await OperationalRankService(db_session).delete_rank(rank_id, org_id)

        assert await _exists(db_session, OperationalRank, rank_id)

    async def test_another_orgs_seat_does_not_hold_it_back(self, db_session, dept):
        org_id, _ = dept
        other_org = await _other_org(db_session)
        rank = await _rank(db_session, org_id, "battalion_chief", "Battalion Chief")
        rank_id = rank.id
        db_session.add(
            OrgChartNode(
                organization_id=other_org,
                title="Their Shift Commander",
                rank_code="battalion_chief",
            )
        )
        await db_session.commit()

        assert await OperationalRankService(db_session).delete_rank(rank_id, org_id)

        assert not await _exists(db_session, OperationalRank, rank_id)
