"""Pattern generation and template lifecycle fixes.

* A deactivated template can be reactivated, and a pattern paused and resumed,
  through the ordinary update endpoints.
* The generation duplicate guard is scoped to the pattern's own template, so a
  second unit's shift at the same start time no longer swallows an occurrence.
* An overnight or 24-hour shift ends at its wall-clock end on the day the
  clocks change.
* A new shift cannot be built from an inactive template, and a shift built from
  a template carries the template's open-to-all flag.
* Generated seats go through the same seat, eligibility and seat-cap rules as
  an officer's assignment, and what generation could not seat is reported.
"""

import uuid
from datetime import date, datetime, timezone
from typing import Optional

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.database import get_db
from app.models.training import (
    PatternType,
    Shift,
    ShiftAssignment,
    ShiftPattern,
    ShiftStatus,
    ShiftTemplate,
)
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService
from tests.test_finance_budget_owners import _position, _user

pytestmark = pytest.mark.integration

START = date(2026, 3, 2)
END = date(2026, 3, 4)


async def _dept(db: AsyncSession, tz: str = "UTC", open_positions=None) -> dict:
    settings = {}
    if open_positions is not None:
        settings = {"scheduling": {"open_positions": open_positions}}
    org = Organization(
        id=str(uuid.uuid4()),
        name="Generation VFD",
        slug=f"gen-{uuid.uuid4().hex[:8]}",
        timezone=tz,
        settings=settings,
    )
    db.add(org)
    await db.flush()
    officer_pos = await _position(
        db,
        org.id,
        "Scheduler",
        ["scheduling.view", "scheduling.manage", "scheduling.assign"],
    )
    user = await _user(db, org.id, "officer", [officer_pos])
    return {"db": db, "org_id": org.id, "user": user}


@pytest.fixture
async def dept(db_session: AsyncSession):
    return await _dept(db_session)


async def _template(
    dept,
    name: str,
    start: str = "07:00",
    end: str = "19:00",
    positions=None,
    apparatus_id: Optional[str] = None,
    open_to_all: bool = False,
) -> ShiftTemplate:
    template = ShiftTemplate(
        organization_id=dept["org_id"],
        name=name,
        start_time_of_day=start,
        end_time_of_day=end,
        duration_hours=12.0,
        positions=positions,
        apparatus_id=apparatus_id,
        open_to_all_members=open_to_all,
    )
    dept["db"].add(template)
    await dept["db"].flush()
    return template


async def _pattern(
    dept,
    template,
    start: date = START,
    pattern_type=PatternType.DAILY,
    schedule_config=None,
    assigned_members=None,
) -> ShiftPattern:
    pattern = ShiftPattern(
        organization_id=dept["org_id"],
        name=f"Pattern {uuid.uuid4().hex[:6]}",
        pattern_type=pattern_type,
        template_id=template.id,
        schedule_config=schedule_config,
        assigned_members=assigned_members,
        start_date=start,
        is_active=True,
    )
    dept["db"].add(pattern)
    await dept["db"].flush()
    return pattern


def _client(dept) -> AsyncClient:
    app = FastAPI()
    app.include_router(scheduling_endpoint.router, prefix="/scheduling")
    app.dependency_overrides[get_current_user] = lambda: dept["user"]
    app.dependency_overrides[get_db] = lambda: dept["db"]
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _shifts_for(dept, template_id: str) -> list[Shift]:
    result = await dept["db"].execute(
        select(Shift)
        .where(Shift.organization_id == dept["org_id"])
        .where(Shift.template_id == template_id)
        .order_by(Shift.shift_date)
    )
    return list(result.scalars().all())


class TestReactivation:
    async def test_an_inactive_template_can_be_reactivated(self, dept):
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        template.is_active = False
        await dept["db"].flush()

        async with _client(dept) as client:
            response = await client.patch(
                f"/scheduling/templates/{template.id}", json={"is_active": True}
            )
            assert response.status_code == 200, response.text
            assert response.json()["is_active"] is True

            generated = await client.post(
                f"/scheduling/patterns/{pattern.id}/generate",
                json={"start_date": str(START), "end_date": str(END)},
            )
        assert generated.status_code == 200, generated.text
        assert generated.json()["shifts_created"] == 3

    async def test_an_explicit_null_is_refused(self, dept):
        template = await _template(dept, "Day Shift")
        template_id = template.id
        async with _client(dept) as client:
            response = await client.patch(
                f"/scheduling/templates/{template_id}", json={"is_active": None}
            )
        # The service rolls the session back on refusal, which in this fixture
        # unwinds the test's own rows too, so the refusal is asserted by its
        # status and wording rather than by re-reading the template.
        assert response.status_code == 400
        assert "is_active" in response.json()["detail"]

    async def test_a_paused_pattern_does_not_generate_until_resumed(self, dept):
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        async with _client(dept) as client:
            paused = await client.patch(
                f"/scheduling/patterns/{pattern.id}", json={"is_active": False}
            )
            assert paused.status_code == 200, paused.text
            assert paused.json()["is_active"] is False

            refused = await client.post(
                f"/scheduling/patterns/{pattern.id}/generate",
                json={"start_date": str(START), "end_date": str(END)},
            )
            assert refused.status_code == 409
            assert "paused" in refused.json()["detail"]

            await client.patch(
                f"/scheduling/patterns/{pattern.id}", json={"is_active": True}
            )
            resumed = await client.post(
                f"/scheduling/patterns/{pattern.id}/generate",
                json={"start_date": str(START), "end_date": str(END)},
            )
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["shifts_created"] == 3


class TestDuplicateGuard:
    async def test_two_units_at_the_same_start_time_both_generate(self, dept):
        service = SchedulingService(dept["db"])
        engine = await _template(dept, "Engine 1 Day")
        medic = await _template(dept, "Medic 1 Day")
        engine_pattern = await _pattern(dept, engine)
        medic_pattern = await _pattern(dept, medic)

        first, error = await service.generate_shifts_from_pattern(
            engine_pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert len(first) == 3
        second, error = await service.generate_shifts_from_pattern(
            medic_pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert len(second) == 3

    async def test_an_ad_hoc_shift_at_the_same_time_does_not_block(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        dept["db"].add(
            Shift(
                organization_id=dept["org_id"],
                shift_date=START,
                start_time=datetime(2026, 3, 2, 7, 0, tzinfo=timezone.utc),
                end_time=datetime(2026, 3, 2, 19, 0, tzinfo=timezone.utc),
            )
        )
        await dept["db"].flush()

        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert len(created) == 3

    async def test_rerunning_and_a_cancelled_occurrence_are_still_skipped(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        created, _ = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        created[0].status = ShiftStatus.CANCELLED
        await dept["db"].flush()

        again, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert again == []
        assert len(await _shifts_for(dept, template.id)) == 3


class TestDaylightSaving:
    @pytest.mark.parametrize(
        ("day", "start", "end", "expected_start", "expected_end"),
        [
            # Fall back: 2026-11-01 02:00 EDT -> 01:00 EST.
            (
                date(2026, 10, 31),
                "19:00",
                "07:00",
                datetime(2026, 10, 31, 23, 0, tzinfo=timezone.utc),
                datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc),
            ),
            (
                date(2026, 10, 31),
                "07:00",
                "07:00",
                datetime(2026, 10, 31, 11, 0, tzinfo=timezone.utc),
                datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc),
            ),
            # Spring forward: 2027-03-14 02:00 EST -> 03:00 EDT.
            (
                date(2027, 3, 13),
                "19:00",
                "07:00",
                datetime(2027, 3, 14, 0, 0, tzinfo=timezone.utc),
                datetime(2027, 3, 14, 11, 0, tzinfo=timezone.utc),
            ),
            (
                date(2027, 3, 13),
                "07:00",
                "07:00",
                datetime(2027, 3, 13, 12, 0, tzinfo=timezone.utc),
                datetime(2027, 3, 14, 11, 0, tzinfo=timezone.utc),
            ),
        ],
    )
    async def test_the_shift_ends_at_its_wall_clock_end(
        self, db_session, day, start, end, expected_start, expected_end
    ):
        dept = await _dept(db_session, tz="America/New_York")
        service = SchedulingService(db_session)
        template = await _template(dept, "Overnight", start=start, end=end)
        pattern = await _pattern(dept, template, start=day)

        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], day, day, None
        )
        assert error is None
        assert len(created) == 1
        assert _utc(created[0].start_time) == expected_start
        assert _utc(created[0].end_time) == expected_end


class TestShiftFromTemplate:
    async def test_an_inactive_template_is_refused(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Retired")
        template.is_active = False
        await dept["db"].flush()

        shift, error = await service.create_shift(
            dept["org_id"],
            {
                "shift_date": START,
                "start_time": datetime(2026, 3, 2, 7, tzinfo=timezone.utc),
                "template_id": template.id,
            },
            dept["user"].id,
        )
        assert shift is None
        assert error is not None
        assert "inactive" in error

    async def test_the_template_open_to_all_flag_is_carried(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Open Day", open_to_all=True)
        shift, error = await service.create_shift(
            dept["org_id"],
            {
                "shift_date": START,
                "start_time": datetime(2026, 3, 2, 7, tzinfo=timezone.utc),
                "template_id": template.id,
            },
            dept["user"].id,
        )
        assert error is None
        assert shift.open_to_all_members is True

    async def test_generated_shifts_carry_the_open_to_all_flag(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Open Day", open_to_all=True)
        pattern = await _pattern(dept, template)
        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, START, None
        )
        assert error is None
        assert created[0].open_to_all_members is True


SEATS = [
    {"position": "officer", "required": True},
    {"position": "firefighter", "required": True},
]


class TestGeneratedSeats:
    async def _members(self, dept, count: int) -> list:
        return [
            await _user(dept["db"], dept["org_id"], f"ff{i}", []) for i in range(count)
        ]

    async def _roster(self, dept, shift_id) -> list[tuple[str, str]]:
        result = await dept["db"].execute(
            select(ShiftAssignment.user_id, ShiftAssignment.position).where(
                ShiftAssignment.shift_id == shift_id
            )
        )
        return [(str(row[0]), str(row[1])) for row in result.all()]

    async def test_an_ineligible_seat_and_a_full_seat_are_reported(self, db_session):
        dept = await _dept(db_session, open_positions=["firefighter"])
        service = SchedulingService(db_session)
        a, b, c = await self._members(dept, 3)
        template = await _template(dept, "Crew", positions=SEATS)
        pattern = await _pattern(
            dept,
            template,
            assigned_members=[
                {"user_id": a.id, "position": "officer"},
                {"user_id": b.id, "position": "firefighter"},
                {"user_id": c.id, "position": "firefighter"},
            ],
        )

        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, START, None
        )
        assert error is None
        assert len(created) == 1
        assert await self._roster(dept, created[0].id) == [(b.id, "firefighter")]
        warnings = service.last_generation_seat_warnings
        assert len(warnings) == 2
        assert any("officer" in w for w in warnings)

    async def test_live_platoon_members_take_the_seats_they_qualify_for(
        self, db_session
    ):
        dept = await _dept(db_session, open_positions=["firefighter"])
        service = SchedulingService(db_session)
        members = await self._members(dept, 2)
        for member in members:
            member.platoon = "A"
        await db_session.flush()
        template = await _template(
            dept,
            "Crew",
            positions=SEATS + [{"position": "firefighter", "required": False}],
        )
        pattern = await _pattern(
            dept,
            template,
            pattern_type=PatternType.PLATOON,
            schedule_config={"platoons": ["A"], "cycle_pattern": ["on"]},
        )

        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, START, None
        )
        assert error is None
        assert len(created) == 1
        roster = await self._roster(dept, created[0].id)
        assert sorted(roster) == sorted((m.id, "firefighter") for m in members)
        assert service.last_generation_seat_warnings == []

    async def test_the_seat_warnings_reach_the_response(self, db_session):
        dept = await _dept(db_session, open_positions=["firefighter"])
        (a,) = await self._members(dept, 1)
        template = await _template(dept, "Crew", positions=SEATS)
        pattern = await _pattern(
            dept, template, assigned_members=[{"user_id": a.id, "position": "officer"}]
        )
        async with _client(dept) as client:
            response = await client.post(
                f"/scheduling/patterns/{pattern.id}/generate",
                json={"start_date": str(START), "end_date": str(START)},
            )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["shifts_created"] == 1
        assert len(body["seat_warnings"]) == 1

    async def test_count_of_assignments_matches_seats(self, db_session):
        dept = await _dept(db_session, open_positions=["firefighter", "officer"])
        service = SchedulingService(db_session)
        members = await self._members(dept, 4)
        template = await _template(dept, "Crew", positions=SEATS)
        pattern = await _pattern(
            dept,
            template,
            assigned_members=[
                {"user_id": m.id, "position": "firefighter"} for m in members
            ],
        )
        created, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, START, None
        )
        assert error is None
        filled = await db_session.scalar(
            select(func.count(ShiftAssignment.id)).where(
                ShiftAssignment.shift_id == created[0].id
            )
        )
        assert filled == 1
        assert len(service.last_generation_seat_warnings) == 3
