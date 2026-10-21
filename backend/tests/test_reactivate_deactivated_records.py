"""A basic apparatus or training pipeline deactivated by a delete can come back.

Delete deactivates either one while it is in use, which hides it from every
list. Without a way back, a vehicle or pipeline deleted by mistake was gone for
good as far as the department could see. Each now has an explicit,
permission-gated, org-scoped reactivation that is audited and restores the
flag alone: enrollments the deactivation withdrew stay withdrawn, and no
vehicle is put back on a shift.

DB-backed throughout, so marked ``integration`` (pitfall #30b).
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
from app.api.v1.endpoints import training_programs as training_programs_endpoint
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.training import (
    BasicApparatus,
    EnrollmentStatus,
    ProgramEnrollment,
    Shift,
    TrainingProgram,
)
from app.models.user import Organization, User
from app.schemas.training_program import TrainingProgramCreate
from app.services.scheduling_service import SchedulingService
from app.services.training_program_service import TrainingProgramService
from tests.test_finance_budget_owners import _position, _user

pytestmark = pytest.mark.integration


async def _org(db: AsyncSession, name: str) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"react-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org.id


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "Reactivate VFD")
    other_org_id = await _org(db_session, "Neighbouring VFD")
    officer = await _user(
        db_session,
        org_id,
        "officer",
        [
            await _position(
                db_session,
                org_id,
                "Officer",
                ["scheduling.view", "scheduling.manage", "training.manage"],
            )
        ],
    )
    member = await _user(
        db_session,
        org_id,
        "member",
        [
            await _position(
                db_session,
                org_id,
                "Member",
                ["scheduling.view", "training.view"],
            )
        ],
    )
    return {
        "db": db_session,
        "org_id": org_id,
        "other_org_id": other_org_id,
        "officer": officer,
        "member": member,
    }


def _client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(scheduling_endpoint.router, prefix="/scheduling")
    app.include_router(training_programs_endpoint.router, prefix="/training/programs")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _reload(db: AsyncSession, model, row_id):
    result = await db.execute(
        select(model)
        .where(model.id == str(row_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _audit_actions(db: AsyncSession, event_type: str, key: str, value: str):
    rows = await db.execute(select(AuditLog).where(AuditLog.event_type == event_type))
    return [
        row.event_data
        for row in rows.scalars().all()
        if (row.event_data or {}).get(key) == value
    ]


# ---------------------------------------------------------------------------
# Basic apparatus
# ---------------------------------------------------------------------------


async def _apparatus(db: AsyncSession, org_id: str, unit="E1") -> BasicApparatus:
    apparatus = BasicApparatus(
        organization_id=org_id,
        unit_number=unit,
        name=f"Engine {unit}",
        apparatus_type="engine",
    )
    db.add(apparatus)
    await db.flush()
    return apparatus


async def _deactivated_vehicle(dept) -> tuple[BasicApparatus, Shift]:
    """A vehicle a past shift names, deactivated through the real delete."""
    db = dept["db"]
    apparatus = await _apparatus(db, dept["org_id"])
    shift = Shift(
        organization_id=dept["org_id"],
        shift_date=date(2026, 3, 1),
        start_time=datetime(2026, 3, 1, 7, tzinfo=timezone.utc),
        apparatus_id=apparatus.id,
    )
    db.add(shift)
    await db.flush()
    deleted = await SchedulingService(db).remove_basic_apparatus(
        apparatus, dept["org_id"]
    )
    assert deleted is False
    return apparatus, shift


class TestBasicApparatusReactivate:
    async def test_reactivates_and_lists_it_again(self, dept):
        db = dept["db"]
        apparatus, _ = await _deactivated_vehicle(dept)

        async with _client(db, dept["officer"]) as client:
            hidden = await client.get("/scheduling/apparatus")
            inactive = await client.get(
                "/scheduling/apparatus", params={"is_active": "false"}
            )
            response = await client.post(
                f"/scheduling/apparatus/{apparatus.id}/reactivate"
            )
            listed = await client.get("/scheduling/apparatus")

        assert apparatus.id not in [a["id"] for a in hidden.json()]
        assert apparatus.id in [a["id"] for a in inactive.json()]
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is True
        assert (await _reload(db, BasicApparatus, apparatus.id)).is_active is True
        assert apparatus.id in [a["id"] for a in listed.json()]

    async def test_is_audited(self, dept):
        db = dept["db"]
        apparatus, _ = await _deactivated_vehicle(dept)

        async with _client(db, dept["officer"]) as client:
            await client.post(f"/scheduling/apparatus/{apparatus.id}/reactivate")

        events = await _audit_actions(
            db, "basic_apparatus_reactivated", "apparatus_id", apparatus.id
        )
        assert len(events) == 1
        assert events[0]["unit_number"] == "E1"

    async def test_an_active_vehicle_is_left_alone_and_not_audited(self, dept):
        db = dept["db"]
        apparatus = await _apparatus(db, dept["org_id"], "E2")

        async with _client(db, dept["officer"]) as client:
            response = await client.post(
                f"/scheduling/apparatus/{apparatus.id}/reactivate"
            )

        assert response.status_code == 200
        assert not await _audit_actions(
            db, "basic_apparatus_reactivated", "apparatus_id", apparatus.id
        )

    async def test_touches_nothing_but_the_flag(self, dept):
        db = dept["db"]
        apparatus, shift = await _deactivated_vehicle(dept)

        async with _client(db, dept["officer"]) as client:
            await client.post(f"/scheduling/apparatus/{apparatus.id}/reactivate")

        kept = await _reload(db, Shift, shift.id)
        assert kept.apparatus_id == apparatus.id
        assert (
            await db.execute(select(Shift.id).where(Shift.apparatus_id == apparatus.id))
        ).scalars().all() == [shift.id]

    async def test_another_departments_vehicle_is_not_found(self, dept):
        db = dept["db"]
        foreign = await _apparatus(db, dept["other_org_id"], "X9")
        foreign.is_active = False
        await db.flush()

        async with _client(db, dept["officer"]) as client:
            response = await client.post(
                f"/scheduling/apparatus/{foreign.id}/reactivate"
            )

        # The endpoint's own 404, not a missing route's.
        assert response.status_code == 404
        assert response.json()["detail"] == "Apparatus not found"
        assert (await _reload(db, BasicApparatus, foreign.id)).is_active is False

    async def test_requires_scheduling_manage(self, dept):
        db = dept["db"]
        apparatus, _ = await _deactivated_vehicle(dept)

        async with _client(db, dept["member"]) as client:
            response = await client.post(
                f"/scheduling/apparatus/{apparatus.id}/reactivate"
            )

        assert response.status_code == 403
        assert (await _reload(db, BasicApparatus, apparatus.id)).is_active is False


# ---------------------------------------------------------------------------
# Training pipelines
# ---------------------------------------------------------------------------


async def _program(db: AsyncSession, org_id: str, admin_id: str, name: str):
    program, error = await TrainingProgramService(db).create_training_program(
        TrainingProgramCreate(name=name), org_id, admin_id
    )
    assert error is None, error
    return program


async def _enroll(db: AsyncSession, org_id, user_id, program_id, status):
    enrollment = ProgramEnrollment(
        organization_id=org_id,
        user_id=user_id,
        program_id=program_id,
        status=status,
    )
    db.add(enrollment)
    await db.flush()
    return enrollment


async def _deactivated_pipeline(dept):
    """A pipeline with a graduate and a trainee, deactivated by the delete."""
    db = dept["db"]
    officer, member = dept["officer"], dept["member"]
    program = await _program(db, dept["org_id"], officer.id, "Recruit School")
    graduate = await _enroll(
        db, dept["org_id"], officer.id, program.id, EnrollmentStatus.COMPLETED
    )
    trainee = await _enroll(
        db, dept["org_id"], member.id, program.id, EnrollmentStatus.ACTIVE
    )
    outcome, _ = await TrainingProgramService(db).delete_training_program(
        uuid.UUID(program.id), dept["org_id"]
    )
    assert outcome == "deactivated"
    return program, graduate, trainee


class TestTrainingPipelineReactivate:
    async def test_reactivates_and_lists_it_again(self, dept):
        db = dept["db"]
        program, _, _ = await _deactivated_pipeline(dept)

        async with _client(db, dept["officer"]) as client:
            hidden = await client.get("/training/programs/programs")
            with_inactive = await client.get(
                "/training/programs/programs", params={"include_inactive": "true"}
            )
            response = await client.patch(
                f"/training/programs/programs/{program.id}", json={"active": True}
            )
            listed = await client.get("/training/programs/programs")

        assert program.id not in [p["id"] for p in hidden.json()]
        shown = [p for p in with_inactive.json() if p["id"] == program.id]
        assert len(shown) == 1
        assert shown[0]["active"] is False
        assert response.status_code == 200, response.text
        assert response.json()["active"] is True
        assert program.id in [p["id"] for p in listed.json()]

    async def test_withdrawn_enrollments_stay_withdrawn(self, dept):
        db = dept["db"]
        program, graduate, trainee = await _deactivated_pipeline(dept)

        async with _client(db, dept["officer"]) as client:
            await client.patch(
                f"/training/programs/programs/{program.id}", json={"active": True}
            )

        assert (
            await _reload(db, ProgramEnrollment, trainee.id)
        ).status == EnrollmentStatus.WITHDRAWN
        assert (
            await _reload(db, ProgramEnrollment, graduate.id)
        ).status == EnrollmentStatus.COMPLETED

    async def test_is_audited_as_a_reactivation(self, dept):
        db = dept["db"]
        program, _, _ = await _deactivated_pipeline(dept)

        async with _client(db, dept["officer"]) as client:
            await client.patch(
                f"/training/programs/programs/{program.id}", json={"active": True}
            )
            # Resending active: true on an active program is an edit.
            await client.patch(
                f"/training/programs/programs/{program.id}",
                json={"active": True, "description": "Updated"},
            )

        actions = [
            event["action"]
            for event in await _audit_actions(
                db, "training_program_updated", "program_id", program.id
            )
        ]
        assert sorted(actions) == ["program_reactivated", "program_updated"]

    async def test_null_active_is_refused(self, dept):
        db = dept["db"]
        program = await _program(db, dept["org_id"], dept["officer"].id, "Driver")

        async with _client(db, dept["officer"]) as client:
            response = await client.patch(
                f"/training/programs/programs/{program.id}", json={"active": None}
            )

        assert response.status_code == 400
        assert (await _reload(db, TrainingProgram, program.id)).active is True

    async def test_another_departments_pipeline_is_not_found(self, dept):
        db = dept["db"]
        other_admin = await _user(db, dept["other_org_id"], "other", [])
        foreign = await _program(db, dept["other_org_id"], other_admin.id, "Theirs")
        foreign.active = False
        await db.flush()

        async with _client(db, dept["officer"]) as client:
            response = await client.patch(
                f"/training/programs/programs/{foreign.id}", json={"active": True}
            )
            listed = await client.get(
                "/training/programs/programs", params={"include_inactive": "true"}
            )

        assert response.status_code == 404
        assert (await _reload(db, TrainingProgram, foreign.id)).active is False
        assert foreign.id not in [p["id"] for p in listed.json()]

    async def test_requires_training_manage(self, dept):
        db = dept["db"]
        program, _, _ = await _deactivated_pipeline(dept)

        async with _client(db, dept["member"]) as client:
            response = await client.patch(
                f"/training/programs/programs/{program.id}", json={"active": True}
            )

        assert response.status_code == 403
        assert (await _reload(db, TrainingProgram, program.id)).active is False
