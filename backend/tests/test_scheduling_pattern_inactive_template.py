"""A pattern whose template is inactive generates no new shifts.

``remove_template`` deactivates a template a pattern still names. Owner
decision (2026-10-22): such a pattern stops generating -- the scheduled
generator skips it and logs, manual generation answers 409 -- and resumes when
the template is reactivated or the pattern points at another one. A day/night
template in ``schedule_config`` holds the whole pattern, not just its half.
"""

import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.database import get_db
from app.models.training import PatternType, Shift, ShiftPattern, ShiftTemplate
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService
from tests.test_finance_budget_owners import _position, _user

pytestmark = pytest.mark.integration

START = date(2026, 3, 2)
END = date(2026, 3, 8)


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Pattern Hold VFD",
        slug=f"pat-hold-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    officer_pos = await _position(
        db_session, org.id, "Scheduler", ["scheduling.view", "scheduling.manage"]
    )
    user = await _user(db_session, org.id, "officer", [officer_pos])
    return {"db": db_session, "org_id": org.id, "user": user}


async def _template(dept, name: str, start="07:00", end="19:00") -> ShiftTemplate:
    template = ShiftTemplate(
        organization_id=dept["org_id"],
        name=name,
        start_time_of_day=start,
        end_time_of_day=end,
        duration_hours=12.0,
    )
    dept["db"].add(template)
    await dept["db"].flush()
    return template


async def _pattern(dept, template, schedule_config=None) -> ShiftPattern:
    pattern = ShiftPattern(
        organization_id=dept["org_id"],
        name="Daily cover",
        pattern_type=PatternType.DAILY,
        template_id=template.id,
        schedule_config=schedule_config,
        start_date=START,
        is_active=True,
    )
    dept["db"].add(pattern)
    await dept["db"].flush()
    return pattern


async def _shift_count(dept) -> int:
    return int(
        await dept["db"].scalar(
            select(func.count(Shift.id)).where(Shift.organization_id == dept["org_id"])
        )
        or 0
    )


def _client(dept) -> AsyncClient:
    app = FastAPI()
    app.include_router(scheduling_endpoint.router, prefix="/scheduling")
    app.dependency_overrides[get_current_user] = lambda: dept["user"]
    app.dependency_overrides[get_db] = lambda: dept["db"]
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestScheduledGeneration:
    async def test_skips_a_pattern_on_an_inactive_template_and_resumes(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Day Shift")
        await _pattern(dept, template)
        template.is_active = False
        await dept["db"].flush()

        created = await service.auto_generate_shifts_for_org(
            dept["org_id"], horizon_weeks=1, reference_date=START
        )
        assert created == 0
        assert await _shift_count(dept) == 0

        template.is_active = True
        await dept["db"].flush()
        created = await service.auto_generate_shifts_for_org(
            dept["org_id"], horizon_weeks=1, reference_date=START
        )
        assert created == 8  # START through START + 7 days, one a day
        assert await _shift_count(dept) == 8

    async def test_existing_shifts_stay(self, dept):
        service = SchedulingService(dept["db"])
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        shifts, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert len(shifts) == 7

        await service.remove_template(template.id, dept["org_id"])
        assert template.is_active is False
        assert await _shift_count(dept) == 7

    async def test_pointing_the_pattern_elsewhere_resumes(self, dept):
        service = SchedulingService(dept["db"])
        retired = await _template(dept, "Old Day")
        current = await _template(dept, "New Day")
        pattern = await _pattern(dept, retired)
        retired.is_active = False
        await dept["db"].flush()

        _, error = await service.update_pattern(
            pattern.id, dept["org_id"], {"template_id": current.id}
        )
        assert error is None
        shifts, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        assert error is None
        assert len(shifts) == 7

    async def test_an_inactive_night_template_holds_the_whole_pattern(self, dept):
        service = SchedulingService(dept["db"])
        main = await _template(dept, "Main")
        night = await _template(dept, "Nights", start="19:00", end="07:00")
        pattern = await _pattern(
            dept,
            main,
            schedule_config={"night_template_id": night.id},
        )
        night.is_active = False
        await dept["db"].flush()

        shifts, error = await service.generate_shifts_from_pattern(
            pattern.id, dept["org_id"], START, END, None
        )
        assert shifts == []
        assert error is not None
        assert '"Nights"' in error
        held = await service.inactive_templates_by_pattern([pattern], dept["org_id"])
        assert held == {str(pattern.id): ["Nights"]}


class TestEndpoints:
    async def test_manual_generate_is_refused_with_409(self, dept):
        template = await _template(dept, "Day Shift")
        pattern = await _pattern(dept, template)
        template.is_active = False
        await dept["db"].flush()

        async with _client(dept) as client:
            response = await client.post(
                f"/scheduling/patterns/{pattern.id}/generate",
                json={"start_date": str(START), "end_date": str(END)},
            )
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail.startswith(
            "Template inactive — this pattern is not generating shifts."
        )
        assert '"Day Shift"' in detail
        assert await _shift_count(dept) == 0

    async def test_pattern_list_flags_the_inactive_template(self, dept):
        held_template = await _template(dept, "Day Shift")
        fine_template = await _template(dept, "Other")
        held = await _pattern(dept, held_template)
        fine = await _pattern(dept, fine_template)
        held_template.is_active = False
        await dept["db"].flush()

        async with _client(dept) as client:
            response = await client.get("/scheduling/patterns")
        assert response.status_code == 200
        flags = {row["id"]: row["inactive_templates"] for row in response.json()}
        assert flags[str(held.id)] == ["Day Shift"]
        assert flags[str(fine.id)] == []
