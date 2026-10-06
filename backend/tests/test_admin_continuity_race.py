"""
Two concurrent removals cannot leave a department with no administrator (W11-8).

``assert_not_last_administrator`` counted administrators with a plain read.
Two requests, each removing a different one of two administrators, both
counted two and both went through. The count now runs under the
organization's ``admin_continuity`` lock and reads members and positions
with a locking read, so the second request sees the first one's removal.

Real connections, not ``db_session``: the race needs two transactions.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.models.user import user_positions
from app.services import admin_continuity_service
from app.services.admin_continuity_service import (
    LastAdministratorError,
    assert_positions_retain_administrator,
)

pytestmark = [pytest.mark.integration]

_HOLD_SECONDS = 0.3


async def _seed() -> tuple[str, list[str]]:
    org_id, position_id = str(uuid.uuid4()), str(uuid.uuid4())
    admins = [str(uuid.uuid4()) for _ in range(2)]
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Continuity Race Dept', 'fire_department', "
                    ":slug, 'UTC', 1)"
                ),
                {"id": org_id, "slug": f"continuity-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO positions (id, organization_id, name, slug, "
                    "permissions) VALUES (:id, :org, 'Officer', :slug, "
                    "'[\"members.manage\"]')"
                ),
                {"id": position_id, "org": org_id, "slug": f"officer-{org_id[:8]}"},
            )
            for user_id in admins:
                await conn.execute(
                    text(
                        "INSERT INTO users (id, organization_id, username, "
                        "first_name, last_name, email, password_hash, status) "
                        "VALUES (:id, :org, :un, 'Race', 'Admin', :em, 'x', "
                        "'active')"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": f"race-{user_id[:8]}",
                        "em": f"race-{user_id[:8]}@test.com",
                    },
                )
                await conn.execute(
                    text(
                        "INSERT INTO user_positions (user_id, position_id) "
                        "VALUES (:u, :p)"
                    ),
                    {"u": user_id, "p": position_id},
                )
    return org_id, admins


async def _cleanup(org_id: str, admins: list[str]) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for user_id in admins:
                await conn.execute(
                    text("DELETE FROM user_positions WHERE user_id = :u"),
                    {"u": user_id},
                )
            for statement in (
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM positions WHERE organization_id = :o",
                "DELETE FROM organization_locks WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.mark.usefixtures("_initialize_database")
async def test_two_concurrent_removals_leave_one_administrator(monkeypatch):
    org_id, admins = await _seed()
    checked = asyncio.Event()
    original = admin_continuity_service.assert_not_last_administrator
    calls = []

    # Hold the first request between its count and its write: the window the
    # race lives in.
    async def paused(*args, **kwargs):
        await original(*args, **kwargs)
        calls.append(1)
        if len(calls) == 1:
            checked.set()
            await asyncio.sleep(_HOLD_SECONDS)

    monkeypatch.setattr(
        admin_continuity_service, "assert_not_last_administrator", paused
    )

    async def strip(user_id, after=None):
        if after is not None:
            await after.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                # Begin a snapshot before the lock, as an endpoint that has
                # already loaded the member would.
                await session.execute(text("SELECT COUNT(*) FROM users"))
                await assert_positions_retain_administrator(
                    session, org_id, user_id, set()
                )
                await session.execute(
                    delete(user_positions).where(user_positions.c.user_id == user_id)
                )
                await session.commit()
                return "removed"
            except LastAdministratorError:
                await session.rollback()
                return "refused"
            finally:
                await session.close()

    try:
        results = await asyncio.gather(
            strip(admins[0]), strip(admins[1], after=checked)
        )
        async with database_manager.engine.connect() as conn:
            remaining = (
                await conn.execute(
                    text(
                        "SELECT COUNT(*) FROM user_positions up JOIN users u "
                        "ON u.id = up.user_id WHERE u.organization_id = :o"
                    ),
                    {"o": org_id},
                )
            ).scalar()
    finally:
        await _cleanup(org_id, admins)

    assert results == ["removed", "refused"], (
        f"two concurrent removals returned {results}; two 'removed' means both "
        "counted two administrators off a stale read"
    )
    assert remaining == 1
