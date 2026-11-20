"""The EVOC driver gate, proved against a real database.

``check_driver_evoc_eligibility`` decides who may be seated in a vehicle's
driver's seat. Until app-review B2 pass 6 its level algebra was covered only by
mocked-session tests, and pass 5 recorded that as the next gap worth closing:
a mocked session hands back whatever rows the stub was given, so it cannot show
that the certification filters (active, certified, not expired on the shift's
date) and the organization filter are really in the SQL.

Each refusal here is paired with an acceptance that differs in one respect, so
a gate that refused everyone would fail the file rather than pass it.
"""

import uuid
from datetime import date

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusOperator,
    ApparatusStatus,
    ApparatusType,
    EvocLevel,
)
from app.models.training import BasicApparatus
from app.models.user import Organization, User
from app.services.evoc_level_service import EvocLevelService

pytestmark = [pytest.mark.integration]

SHIFT_DAY = date(2026, 6, 15)


async def _org(db_session, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org: Organization) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"driver-{suffix}",
        email=f"driver-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _level(
    db_session, org: Organization, number: int, *, cumulative: bool
) -> EvocLevel:
    level = EvocLevel(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        level_number=number,
        name=f"EVOC {number}",
        code=f"EV{uuid.uuid4().hex[:6]}",
        is_cumulative=cumulative,
    )
    db_session.add(level)
    await db_session.flush()
    return level


async def _apparatus(
    db_session, org: Organization, required: EvocLevel | None = None
) -> Apparatus:
    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([apparatus_type, status])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
        required_evoc_level_id=required.id if required else None,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


async def _certify(
    db_session,
    member: User,
    apparatus: Apparatus,
    level: EvocLevel,
    *,
    expires: date | None = None,
    is_certified: bool = True,
    is_active: bool = True,
) -> ApparatusOperator:
    operator = ApparatusOperator(
        id=str(uuid.uuid4()),
        organization_id=member.organization_id,
        apparatus_id=apparatus.id,
        user_id=member.id,
        evoc_level_id=level.id,
        is_certified=is_certified,
        is_active=is_active,
        certification_expiration=expires,
    )
    db_session.add(operator)
    await db_session.flush()
    return operator


async def _check(db_session, member: User, vehicle_id: str, on: date = SHIFT_DAY):
    return await EvocLevelService(db_session).check_driver_evoc_eligibility(
        member.id, vehicle_id, member.organization_id, on_date=on
    )


class TestRequirementAndLevels:
    async def test_no_requirement_seats_anyone(self, db_session):
        org = await _org(db_session, "Dept")
        member = await _member(db_session, org)
        engine = await _apparatus(db_session, org)

        result = await _check(db_session, member, engine.id)

        assert result["eligible"] is True
        assert result["required_level"] is None

    async def test_exact_level_qualifies_and_no_certification_does_not(
        self, db_session
    ):
        org = await _org(db_session, "Dept")
        level_2 = await _level(db_session, org, 2, cumulative=False)
        engine = await _apparatus(db_session, org, required=level_2)
        certified = await _member(db_session, org)
        uncertified = await _member(db_session, org)
        await _certify(db_session, certified, engine, level_2)

        accepted = await _check(db_session, certified, engine.id)
        refused = await _check(db_session, uncertified, engine.id)

        assert accepted["eligible"] is True
        assert accepted["user_level"].id == level_2.id
        assert refused["eligible"] is False
        assert "has no EVOC certification" in refused["warning"]

    async def test_cumulative_higher_level_covers_and_non_cumulative_does_not(
        self, db_session
    ):
        org = await _org(db_session, "Dept")
        level_2 = await _level(db_session, org, 2, cumulative=False)
        cumulative_3 = await _level(db_session, org, 3, cumulative=True)
        specialist_4 = await _level(db_session, org, 4, cumulative=False)
        engine = await _apparatus(db_session, org, required=level_2)
        covered = await _member(db_session, org)
        specialist = await _member(db_session, org)
        await _certify(db_session, covered, engine, cumulative_3)
        await _certify(db_session, specialist, engine, specialist_4)

        accepted = await _check(db_session, covered, engine.id)
        refused = await _check(db_session, specialist, engine.id)

        assert accepted["eligible"] is True
        assert refused["eligible"] is False
        assert "EVOC Level 4" in refused["warning"]

    async def test_every_held_level_is_considered_not_only_the_highest(
        self, db_session
    ):
        """A non-cumulative Level 4 alongside a cumulative Level 3 must not hide
        the 3 that covers a Level 2 vehicle, and the level reported is the one
        relied on — the lowest that qualifies.

        A member has one operator row per vehicle (a unique index on
        apparatus and user), so two levels are held through rows on two
        vehicles; the gate reads every current row the member has."""
        org = await _org(db_session, "Dept")
        level_2 = await _level(db_session, org, 2, cumulative=False)
        cumulative_3 = await _level(db_session, org, 3, cumulative=True)
        specialist_4 = await _level(db_session, org, 4, cumulative=False)
        engine = await _apparatus(db_session, org, required=level_2)
        ladder = await _apparatus(db_session, org, required=specialist_4)
        member = await _member(db_session, org)
        await _certify(db_session, member, ladder, specialist_4)
        await _certify(db_session, member, engine, cumulative_3)

        result = await _check(db_session, member, engine.id)

        assert result["eligible"] is True
        assert result["user_level"].id == cumulative_3.id


class TestCertificationIsCurrentOnTheShiftDate:
    async def test_card_expiring_before_the_shift_does_not_qualify(self, db_session):
        org = await _org(db_session, "Dept")
        level_2 = await _level(db_session, org, 2, cumulative=False)
        engine = await _apparatus(db_session, org, required=level_2)
        member = await _member(db_session, org)
        await _certify(db_session, member, engine, level_2, expires=SHIFT_DAY)

        on_the_last_day = await _check(db_session, member, engine.id, on=SHIFT_DAY)
        the_day_after = await _check(
            db_session, member, engine.id, on=date(2026, 6, 16)
        )

        assert on_the_last_day["eligible"] is True
        assert the_day_after["eligible"] is False

    async def test_uncertified_or_inactive_record_does_not_qualify(self, db_session):
        org = await _org(db_session, "Dept")
        level_2 = await _level(db_session, org, 2, cumulative=False)
        engine = await _apparatus(db_session, org, required=level_2)
        pending = await _member(db_session, org)
        removed = await _member(db_session, org)
        await _certify(db_session, pending, engine, level_2, is_certified=False)
        await _certify(db_session, removed, engine, level_2, is_active=False)

        assert (await _check(db_session, pending, engine.id))["eligible"] is False
        assert (await _check(db_session, removed, engine.id))["eligible"] is False


class TestVehicleResolution:
    async def test_basic_apparatus_has_no_requirement(self, db_session):
        org = await _org(db_session, "Dept")
        member = await _member(db_session, org)
        basic = BasicApparatus(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            unit_number=f"B-{uuid.uuid4().hex[:5]}",
            name="Brush 1",
        )
        db_session.add(basic)
        await db_session.flush()

        result = await _check(db_session, member, basic.id)

        assert result["eligible"] is True
        assert result["warning"] is None

    async def test_vehicle_in_neither_table_refuses_the_seat(self, db_session):
        """AP2-4, owner decision 2026-10-31: fail closed."""
        org = await _org(db_session, "Dept")
        member = await _member(db_session, org)

        result = await _check(db_session, member, str(uuid.uuid4()))

        assert result["eligible"] is False
        assert "no longer exists" in result["warning"]

    async def test_another_departments_vehicle_does_not_resolve(self, db_session):
        """The organization filter is in the SQL: a vehicle id from another
        department is treated as unknown, not as that vehicle."""
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        member = await _member(db_session, mine)
        their_engine = await _apparatus(db_session, theirs)

        result = await _check(db_session, member, their_engine.id)

        assert result["eligible"] is False
        assert "no longer exists" in result["warning"]
