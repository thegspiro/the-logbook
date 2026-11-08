"""The dated history of positions held (owner decision 2026-11-06).

``member_position_terms`` must agree with ``user_positions`` whichever path
changed it -- the relationship collection, a Core statement in the position
service, a position deleted outright -- in the same transaction, and a second
run of the same change must not open or close anything twice. The profile
reads the closed terms back.
"""

import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.api.v1.endpoints.users import (
    add_role_to_user,
    get_user_with_roles,
    remove_role_from_user,
)
from app.models.member_position_term import MemberPositionTerm, sync_position_terms
from app.models.user import Position, User, user_positions
from app.services.member_position_term_service import past_positions_for
from app.services.role_service import RoleManagementService

pytestmark = [pytest.mark.integration]


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Terms {org_id[:8]}", "slug": f"terms-{org_id[:8]}"},
    )
    return org_id


async def _member(db: AsyncSession, org_id: str, name: str) -> str:
    uid = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Terms', :em, 'hashed', 'active')"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"{name}-{uid[:8]}",
            "fn": name,
            "em": f"{name}-{uid[:8]}@test.example",
        },
    )
    return uid


async def _position(
    db: AsyncSession,
    org_id: str,
    name: str,
    *,
    kind: str = "office",
    slug: str | None = None,
    is_system: bool = False,
    permissions: list[str] | None = None,
) -> Position:
    position = Position(
        organization_id=org_id,
        name=name,
        slug=slug or f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        kind=kind,
        is_system=is_system,
        permissions=permissions or [],
    )
    db.add(position)
    await db.flush()
    return position


async def _load(db: AsyncSession, uid: str) -> User:
    return (
        await db.execute(
            select(User)
            .where(User.id == uid)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _terms(db: AsyncSession, uid: str) -> list[MemberPositionTerm]:
    return list(
        (
            await db.execute(
                select(MemberPositionTerm)
                .where(MemberPositionTerm.user_id == uid)
                .order_by(MemberPositionTerm.started_at, MemberPositionTerm.id)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session)
    member_id = await _member(db_session, org_id, "member")
    officer_id = await _member(db_session, org_id, "officer")
    treasurer = await _position(db_session, org_id, "Treasurer")
    await db_session.flush()
    return {
        "db": db_session,
        "org": org_id,
        "member": member_id,
        "officer": officer_id,
        "treasurer": treasurer,
    }


class TestTheRelationshipPath:
    async def test_assigning_opens_a_term_and_removing_closes_it(self, dept):
        db = dept["db"]
        user = await _load(db, dept["member"])
        user.positions.append(dept["treasurer"])
        await db.flush()

        (term,) = await _terms(db, dept["member"])
        assert term.position_id == dept["treasurer"].id
        assert term.position_name == "Treasurer"
        assert term.position_kind == "office"
        assert term.organization_id == dept["org"]
        assert term.ended_at is None

        user.positions.remove(dept["treasurer"])
        await db.flush()
        (term,) = await _terms(db, dept["member"])
        assert term.ended_at is not None
        assert term.open_marker is None

    async def test_holding_it_again_opens_a_second_term(self, dept):
        db = dept["db"]
        user = await _load(db, dept["member"])
        user.positions.append(dept["treasurer"])
        await db.flush()
        user.positions.remove(dept["treasurer"])
        await db.flush()
        user.positions.append(dept["treasurer"])
        await db.flush()

        # Both terms can start in the same second, so compare as a set.
        terms = await _terms(db, dept["member"])
        assert sorted(t.ended_at is None for t in terms) == [False, True]

    async def test_replacing_the_collection_touches_only_the_changed_pairs(self, dept):
        db = dept["db"]
        secretary = await _position(db, dept["org"], "Secretary")
        user = await _load(db, dept["member"])
        user.positions = [dept["treasurer"]]
        await db.flush()
        user.positions = [dept["treasurer"], secretary]
        await db.flush()

        open_names = sorted(
            t.position_name for t in await _terms(db, dept["member"]) if not t.ended_at
        )
        assert open_names == ["Secretary", "Treasurer"]
        assert len(await _terms(db, dept["member"])) == 2

    async def test_the_endpoint_records_who_assigned_and_who_removed(self, dept):
        db = dept["db"]
        boss = await _position(db, dept["org"], "Chief Officer", permissions=["*"])
        officer = await _load(db, dept["officer"])
        officer.positions.append(boss)
        await db.flush()
        officer = await _load(db, dept["officer"])
        request = Request({"type": "http", "headers": [], "client": ("10.0.0.1", 1)})

        await add_role_to_user(
            user_id=UUID(dept["member"]),
            role_id=UUID(dept["treasurer"].id),
            request=request,
            db=db,
            current_user=officer,
            _stepup=officer,
        )
        await remove_role_from_user(
            user_id=UUID(dept["member"]),
            role_id=UUID(dept["treasurer"].id),
            db=db,
            current_user=officer,
            _stepup=officer,
        )

        (term,) = await _terms(db, dept["member"])
        assert term.assigned_by == dept["officer"]
        assert term.ended_by == dept["officer"]
        assert term.ended_at is not None


class TestTheCorePaths:
    async def test_the_position_service_opens_and_closes_terms(self, dept):
        db = dept["db"]
        service = RoleManagementService()
        kwargs = {"organization_id": dept["org"]}
        assert await service.assign_role_to_user(
            db, dept["member"], dept["treasurer"].id, dept["officer"], **kwargs
        )
        (term,) = await _terms(db, dept["member"])
        assert (term.assigned_by, term.ended_at) == (dept["officer"], None)

        # A repeat assignment is refused by the service and opens nothing.
        assert not await service.assign_role_to_user(
            db, dept["member"], dept["treasurer"].id, dept["officer"], **kwargs
        )
        assert len(await _terms(db, dept["member"])) == 1

        assert await service.remove_role_from_user(
            db, dept["member"], dept["treasurer"].id, dept["officer"], **kwargs
        )
        (term,) = await _terms(db, dept["member"])
        assert term.ended_by == dept["officer"]
        assert term.ended_at is not None

        # Removing a position no longer held does not fail, and closes nothing
        # again.
        ended = term.ended_at
        assert not await service.remove_role_from_user(
            db, dept["member"], dept["treasurer"].id, dept["officer"], **kwargs
        )
        (term,) = await _terms(db, dept["member"])
        assert term.ended_at == ended

    async def test_set_user_roles_reconciles_the_whole_set(self, dept):
        db = dept["db"]
        secretary = await _position(db, dept["org"], "Secretary")
        service = RoleManagementService()
        await service.set_user_roles(
            db,
            dept["member"],
            [dept["treasurer"].id],
            dept["officer"],
            organization_id=dept["org"],
        )
        await service.set_user_roles(
            db,
            dept["member"],
            [secretary.id],
            dept["officer"],
            organization_id=dept["org"],
        )
        by_name = {t.position_name: t for t in await _terms(db, dept["member"])}
        assert by_name["Treasurer"].ended_at is not None
        assert by_name["Secretary"].ended_at is None

    async def test_syncing_twice_opens_one_term(self, dept):
        db = dept["db"]
        await db.execute(
            user_positions.insert().values(
                user_id=dept["member"], position_id=dept["treasurer"].id
            )
        )
        pair = [(dept["member"], dept["treasurer"].id)]
        await sync_position_terms(db, pair)
        await sync_position_terms(db, pair)
        assert len(await _terms(db, dept["member"])) == 1

    async def test_the_database_admits_one_open_term_per_pair(self, dept):
        db = dept["db"]
        now = datetime.now(timezone.utc)
        for _ in range(2):
            db.add(
                MemberPositionTerm(
                    organization_id=dept["org"],
                    user_id=dept["member"],
                    position_id=dept["treasurer"].id,
                    position_name="Treasurer",
                    started_at=now,
                )
            )
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


class TestAPositionDeletedOutright:
    async def test_its_terms_are_closed_and_survive_under_its_name(self, dept):
        db = dept["db"]
        # The deletion guard wants an administrator left in the department.
        admin = await _position(
            db, dept["org"], "Chief Officer", permissions=["members.manage"]
        )
        officer = await _load(db, dept["officer"])
        officer.positions.append(admin)
        user = await _load(db, dept["member"])
        user.positions.append(dept["treasurer"])
        await db.flush()

        await RoleManagementService().delete_role(
            db, dept["treasurer"].id, dept["org"], dept["officer"]
        )

        (term,) = await _terms(db, dept["member"])
        assert term.position_id is None
        assert term.position_name == "Treasurer"
        assert term.ended_at is not None
        assert term.ended_by == dept["officer"]


class TestTheProfile:
    async def test_past_positions_lists_closed_terms_without_the_baseline(self, dept):
        db = dept["db"]
        committee = await _position(db, dept["org"], "History", kind="committee")
        baseline = await _position(
            db, dept["org"], "Member", kind="system", slug="member", is_system=True
        )
        mirror = await _position(
            db, dept["org"], "Captain", slug="captain", is_system=True
        )
        user = await _load(db, dept["member"])
        user.positions = [dept["treasurer"], committee, baseline, mirror]
        await db.flush()
        user.positions = []
        await db.flush()
        # Give the terms distinct dates so the order is decided.
        await db.execute(
            update(MemberPositionTerm)
            .where(MemberPositionTerm.position_id == committee.id)
            .values(ended_at=datetime.now(timezone.utc) + timedelta(days=1))
        )

        names = [
            p["name"] for p in await past_positions_for(db, dept["member"], dept["org"])
        ]
        assert names == ["History", "Treasurer"]

    async def test_the_profile_response_carries_them_in_org(self, dept):
        db = dept["db"]
        user = await _load(db, dept["member"])
        user.positions.append(dept["treasurer"])
        await db.flush()
        user.positions.remove(dept["treasurer"])
        await db.flush()

        body = await get_user_with_roles(
            user_id=UUID(dept["member"]),
            db=db,
            current_user=await _load(db, dept["member"]),
        )
        assert [p.name for p in body.past_positions] == ["Treasurer"]
        assert body.past_positions[0].position_id == dept["treasurer"].id

        # Another department's read of the same member finds nothing.
        assert await past_positions_for(db, dept["member"], str(uuid.uuid4())) == []
