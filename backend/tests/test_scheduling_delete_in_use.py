"""Shift templates and basic apparatus in use are deactivated, not deleted.

Deleting a shift template nulled ``shifts.template_id`` and cascaded away the
template's equipment-checklist links, so existing shifts silently fell back to
the apparatus's default checklists; a pattern naming it went NULL and then
refused to generate. Deleting a basic apparatus left every
``apparatus_id`` naming it dangling (none has a foreign key), after which a
template naming it failed to save with "Apparatus not found".

Each is now deactivated while anything uses it, and still deleted when nothing
does. The endpoints keep their 204 and report which in ``X-Delete-Outcome``.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.database import get_db
from app.models.training import (
    BasicApparatus,
    PatternType,
    Shift,
    ShiftPattern,
    ShiftPreWorkSession,
    ShiftTemplate,
)
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService
from app.utils.apparatus_ref import resolve_apparatus_ref
from tests.test_finance_budget_owners import _position, _user

pytestmark = pytest.mark.integration


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Schedule Delete VFD",
        slug=f"sch-del-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    officer_pos = await _position(
        db_session, org.id, "Scheduler", ["scheduling.view", "scheduling.manage"]
    )
    user = await _user(db_session, org.id, "officer", [officer_pos])
    return {"db": db_session, "org_id": org.id, "user": user}


async def _template(dept, name="Day Shift", apparatus_id=None) -> ShiftTemplate:
    template = ShiftTemplate(
        organization_id=dept["org_id"],
        name=name,
        start_time_of_day="07:00",
        end_time_of_day="19:00",
        duration_hours=12.0,
        apparatus_id=apparatus_id,
    )
    dept["db"].add(template)
    await dept["db"].flush()
    return template


async def _shift(dept, **refs) -> Shift:
    shift = Shift(
        organization_id=dept["org_id"],
        shift_date=date(2026, 3, 1),
        start_time=datetime(2026, 3, 1, 7, tzinfo=timezone.utc),
        **refs,
    )
    dept["db"].add(shift)
    await dept["db"].flush()
    return shift


async def _apparatus(dept, unit="E1") -> BasicApparatus:
    apparatus = BasicApparatus(
        organization_id=dept["org_id"],
        unit_number=unit,
        name=f"Engine {unit}",
        apparatus_type="engine",
    )
    dept["db"].add(apparatus)
    await dept["db"].flush()
    return apparatus


async def _gone(db: AsyncSession, model, row_id: str) -> bool:
    found = await db.execute(select(model.id).where(model.id == row_id))
    return found.scalar_one_or_none() is None


def _client(dept) -> AsyncClient:
    app = FastAPI()
    app.include_router(scheduling_endpoint.router, prefix="/scheduling")
    app.dependency_overrides[get_current_user] = lambda: dept["user"]
    app.dependency_overrides[get_db] = lambda: dept["db"]
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestShiftTemplateDelete:
    async def test_a_template_a_past_shift_uses_is_deactivated(self, dept):
        db = dept["db"]
        template = await _template(dept)
        shift = await _shift(dept, template_id=template.id)

        deleted, error = await SchedulingService(db).remove_template(
            template.id, dept["org_id"]
        )

        assert (deleted, error) == (False, None)
        await db.refresh(template)
        assert template.is_active is False
        await db.refresh(shift)
        assert shift.template_id == template.id

    async def test_a_template_a_pattern_uses_is_deactivated(self, dept):
        db = dept["db"]
        template = await _template(dept)
        pattern = ShiftPattern(
            organization_id=dept["org_id"],
            name="A/B/C",
            pattern_type=PatternType.PLATOON,
            start_date=date(2026, 1, 1),
            template_id=template.id,
        )
        db.add(pattern)
        await db.flush()

        deleted, _ = await SchedulingService(db).remove_template(
            template.id, dept["org_id"]
        )

        assert deleted is False
        await db.refresh(pattern)
        assert pattern.template_id == template.id

    async def test_a_template_named_only_in_a_pattern_config_is_deactivated(self, dept):
        db = dept["db"]
        anchor = await _template(dept, "Anchor")
        night = await _template(dept, "Night")
        db.add(
            ShiftPattern(
                organization_id=dept["org_id"],
                name="Day/Night",
                pattern_type=PatternType.CUSTOM,
                start_date=date(2026, 1, 1),
                template_id=anchor.id,
                schedule_config={"night_template_id": night.id},
            )
        )
        await db.flush()

        assert await SchedulingService(db).template_in_use(night.id, dept["org_id"])

    async def test_an_unused_template_is_deleted(self, dept):
        db = dept["db"]
        template = await _template(dept)

        deleted, error = await SchedulingService(db).remove_template(
            template.id, dept["org_id"]
        )

        assert (deleted, error) == (True, None)
        assert await _gone(db, ShiftTemplate, template.id)

    async def test_the_legacy_wrapper_still_answers_success(self, dept):
        db = dept["db"]
        template = await _template(dept)
        await _shift(dept, template_id=template.id)

        assert await SchedulingService(db).delete_template(
            template.id, dept["org_id"]
        ) == (True, None)

    async def test_endpoint_reports_the_outcome(self, dept):
        used = await _template(dept, "Used")
        await _shift(dept, template_id=used.id)
        spare = await _template(dept, "Spare")

        async with _client(dept) as client:
            kept = await client.delete(f"/scheduling/templates/{used.id}")
            gone = await client.delete(f"/scheduling/templates/{spare.id}")

        assert kept.status_code == 204
        assert kept.headers["X-Delete-Outcome"] == "deactivated"
        assert gone.status_code == 204
        assert gone.headers["X-Delete-Outcome"] == "deleted"


class TestBasicApparatusDelete:
    async def test_a_vehicle_a_template_names_is_deactivated_and_still_resolves(
        self, dept
    ):
        db = dept["db"]
        apparatus = await _apparatus(dept)
        template = await _template(dept, apparatus_id=apparatus.id)

        deleted = await SchedulingService(db).remove_basic_apparatus(
            apparatus, dept["org_id"]
        )

        assert deleted is False
        await db.refresh(apparatus)
        assert apparatus.is_active is False
        ref = await resolve_apparatus_ref(db, apparatus.id, dept["org_id"])
        assert ref.exists
        # The edit form resends the stored id; it must still save.
        updated, error = await SchedulingService(db).update_template(
            template.id, dept["org_id"], {"apparatus_id": apparatus.id, "name": "Days"}
        )
        assert error is None
        assert updated.apparatus_id == apparatus.id

    async def test_a_vehicle_a_shift_names_is_deactivated(self, dept):
        db = dept["db"]
        apparatus = await _apparatus(dept)
        shift = await _shift(dept, apparatus_id=apparatus.id)

        assert (
            await SchedulingService(db).remove_basic_apparatus(
                apparatus, dept["org_id"]
            )
            is False
        )
        await db.refresh(shift)
        assert shift.apparatus_id == apparatus.id

    async def test_a_vehicle_a_pre_work_session_names_is_deactivated(self, dept):
        db = dept["db"]
        apparatus = await _apparatus(dept)
        shift = await _shift(dept)
        db.add(
            ShiftPreWorkSession(
                organization_id=dept["org_id"],
                shift_id=shift.id,
                user_id=dept["user"].id,
                apparatus_id=apparatus.id,
                started_at=datetime(2026, 3, 1, 6, 30, tzinfo=timezone.utc),
            )
        )
        await db.flush()

        assert await SchedulingService(db).basic_apparatus_in_use(
            apparatus.id, dept["org_id"]
        )

    async def test_an_unused_vehicle_is_deleted(self, dept):
        db = dept["db"]
        apparatus = await _apparatus(dept)

        assert (
            await SchedulingService(db).remove_basic_apparatus(
                apparatus, dept["org_id"]
            )
            is True
        )
        assert await _gone(db, BasicApparatus, apparatus.id)

    async def test_endpoint_reports_the_outcome(self, dept):
        used = await _apparatus(dept, "E1")
        await _shift(dept, apparatus_id=used.id)
        spare = await _apparatus(dept, "E2")

        async with _client(dept) as client:
            kept = await client.delete(f"/scheduling/apparatus/{used.id}")
            gone = await client.delete(f"/scheduling/apparatus/{spare.id}")

        assert kept.status_code == 204
        assert kept.headers["X-Delete-Outcome"] == "deactivated"
        assert gone.status_code == 204
        assert gone.headers["X-Delete-Outcome"] == "deleted"
