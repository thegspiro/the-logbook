"""
Two concurrent enrollments of one member in one program leave one enrollment.

``enroll_member`` read for an existing ACTIVE enrollment and then inserted
one. Off a plain SELECT both requests read "not enrolled" and both inserted,
leaving two ACTIVE rows. The check now runs under the department's
enrollment lock and reads with a locking read.

Real connections, not ``db_session``: the race needs two transactions.
"""

import asyncio
import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.schemas.training_program import ProgramEnrollmentCreate
from app.services import training_program_service
from app.services.training_program_service import TrainingProgramService

pytestmark = [pytest.mark.integration]

_HOLD_SECONDS = 0.3


async def _seed() -> tuple[str, str, str]:
    org_id, user_id, program_id = (str(uuid.uuid4()) for _ in range(3))
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Enrollment Race Dept', 'fire_department', "
                    ":slug, 'UTC', 1)"
                ),
                {"id": org_id, "slug": f"enroll-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Enroll', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"enroll-race-{user_id[:8]}",
                    "em": f"enroll-race-{user_id[:8]}@test.com",
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO training_programs (id, organization_id, name) "
                    "VALUES (:id, :org, 'Probationary')"
                ),
                {"id": program_id, "org": org_id},
            )
    return org_id, user_id, program_id


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM program_enrollments WHERE organization_id = :o",
                "DELETE FROM training_programs WHERE organization_id = :o",
                "DELETE FROM organization_locks WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.mark.usefixtures("_initialize_database")
async def test_concurrent_enrollments_leave_one_active_row(monkeypatch):
    org_id, user_id, program_id = await _seed()
    checked = asyncio.Event()
    calls = []

    # resolve_org_today is the first thing enroll_member does after its
    # duplicate check, so pausing the first caller there holds it between
    # the check and the insert: the window the race lives in.
    async def today_after_the_check(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            checked.set()
            await asyncio.sleep(_HOLD_SECONDS)
        return date(2027, 3, 1)

    monkeypatch.setattr(
        training_program_service, "resolve_org_today", today_after_the_check
    )

    async def enroll(after=None):
        if after is not None:
            await after.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            service = TrainingProgramService(session)
            monkeypatch.setattr(service, "_notify_enrollment", _no_notification)
            try:
                _, error = await service.enroll_member(
                    ProgramEnrollmentCreate(
                        user_id=uuid.UUID(user_id), program_id=uuid.UUID(program_id)
                    ),
                    uuid.UUID(org_id),
                )
                await session.commit()
                return error or "enrolled"
            finally:
                await session.close()

    try:
        results = await asyncio.gather(enroll(), enroll(after=checked))
        async with database_manager.engine.connect() as conn:
            active = (
                await conn.execute(
                    text(
                        "SELECT COUNT(*) FROM program_enrollments WHERE "
                        "organization_id = :o AND status = 'active'"
                    ),
                    {"o": org_id},
                )
            ).scalar()
    finally:
        await _cleanup(org_id)

    assert results == [
        "enrolled",
        "User is already enrolled in this program",
    ], f"two concurrent enrollments returned {results}"
    assert active == 1, f"{active} ACTIVE enrollments for one member and program"


async def _no_notification(*_args, **_kwargs):
    return None
