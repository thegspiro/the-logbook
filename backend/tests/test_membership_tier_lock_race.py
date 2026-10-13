"""The tier-advancement scan and a tier removal cannot pass each other (USR-10a).

``update_membership_tier_config`` refuses to remove a tier members hold. It
counts them under the Organization lock, but ``MembershipTierService.advance_all``
— the unattended scan — wrote ``membership_type`` without ever taking that lock,
and the count is a plain read answered from the snapshot the request took at
its first read, before it asked for the lock. A scan committing a member onto
the tier in between left that member on a tier the config no longer has.

The owner chose to have the scan hold the Organization lock for its whole run.
Both properties are driven here on real connections: the edit waits for a scan
in progress, and once it gets the lock it sees what the scan committed — even
when its own transaction began before the scan did.
"""

import asyncio
import json
import uuid
from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import member_status
from app.core.database import database_manager
from app.models.user import User
from app.services import membership_tier_service
from app.services.membership_tier_service import MembershipTierService

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_initialize_database")]

_HOLD_SECONDS = 0.5

_LADDER = {
    "auto_advance": True,
    "tiers": [
        {"id": "active", "name": "Active", "years_required": 0, "sort_order": 0},
        {"id": "senior", "name": "Senior", "years_required": 5, "sort_order": 1},
    ],
}
# The edit under test: drop Senior, the tier the scan is about to fill.
_WITHOUT_SENIOR = {"auto_advance": True, "tiers": [_LADDER["tiers"][0]]}


async def _seed() -> tuple[str, str, str]:
    org_id, admin_id, member_id = (str(uuid.uuid4()) for _ in range(3))
    ten_years_ago = date.today().replace(year=date.today().year - 10)
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active, settings) "
                    "VALUES (:id, 'Tier Race Dept', 'fire_department', :slug, "
                    "'UTC', 1, :settings)"
                ),
                {
                    "id": org_id,
                    "slug": f"tier-race-{org_id[:8]}",
                    "settings": json.dumps({"membership_tiers": _LADDER}),
                },
            )
            for user_id, handle in ((admin_id, "admin"), (member_id, "member")):
                await conn.execute(
                    text(
                        "INSERT INTO users (id, organization_id, username, "
                        "first_name, last_name, email, password_hash, status, "
                        "membership_type, hire_date) VALUES (:id, :org, :un, "
                        "'Tier', 'Racer', :em, 'hashed', 'active', 'active', :hired)"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": f"tier-race-{handle}-{user_id[:8]}",
                        "em": f"tier-race-{handle}-{user_id[:8]}@test.com",
                        # The admin is hired today, so only the member qualifies.
                        "hired": ten_years_ago if handle == "member" else date.today(),
                    },
                )
    return org_id, admin_id, member_id


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id}
            )
            await conn.execute(
                text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
            )


@pytest.fixture
def _no_audit(monkeypatch):
    """The audit chain is shared; these tests are about locks, not records."""
    monkeypatch.setattr(membership_tier_service, "log_audit_event", AsyncMock())
    monkeypatch.setattr(member_status, "log_audit_event", AsyncMock())


async def _membership_type(member_id: str) -> str:
    async with database_manager.engine.connect() as conn:
        row = await conn.execute(
            text("SELECT membership_type FROM users WHERE id = :id"), {"id": member_id}
        )
        return row.scalar_one()


async def _stored_tier_ids(org_id: str) -> list[str]:
    async with database_manager.engine.connect() as conn:
        row = await conn.execute(
            text("SELECT settings FROM organizations WHERE id = :id"), {"id": org_id}
        )
        settings = row.scalar_one()
    if isinstance(settings, str):
        settings = json.loads(settings)
    return [t["id"] for t in settings["membership_tiers"]["tiers"]]


async def _advance(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            await MembershipTierService(session).advance_all(org_id, "system")
        finally:
            await session.close()


async def _edit_after(org_id, admin_id, *, began: asyncio.Event, go: asyncio.Event):
    """A config edit whose transaction has already read before the scan ran.

    The first plain read stands in for the auth dependency's User lookup,
    which is what fixes the request's snapshot in production.
    """
    async with database_manager.engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            admin = (
                await session.execute(select(User).where(User.id == admin_id))
            ).scalar_one()
            began.set()
            await go.wait()
            return await member_status.update_membership_tier_config(
                dict(_WITHOUT_SENIOR), db=session, current_user=admin
            )
        finally:
            await session.close()


@pytest.mark.usefixtures("_no_audit")
async def test_an_edit_begun_before_a_scan_sees_what_the_scan_committed():
    org_id, admin_id, member_id = await _seed()
    try:
        began, go = asyncio.Event(), asyncio.Event()
        edit = asyncio.create_task(_edit_after(org_id, admin_id, began=began, go=go))
        await began.wait()

        await _advance(org_id)
        assert await _membership_type(member_id) == "senior"
        go.set()

        with pytest.raises(HTTPException) as exc:
            await edit
        assert exc.value.status_code == 400
        assert "'senior' is held by 1 member" in exc.value.detail
        assert await _stored_tier_ids(org_id) == ["active", "senior"]
    finally:
        await _cleanup(org_id)


@pytest.mark.usefixtures("_no_audit")
async def test_an_edit_waits_for_a_scan_in_progress(monkeypatch):
    org_id, admin_id, member_id = await _seed()
    in_scan = asyncio.Event()
    original = MembershipTierService._advance_members
    finished: dict[str, float] = {}

    async def slow_scan(self, *args, **kwargs):
        result = await original(self, *args, **kwargs)
        in_scan.set()
        await asyncio.sleep(_HOLD_SECONDS)
        # Still inside advance_all: its commit, which releases the lock, is
        # after this.
        finished["scan_held_until"] = asyncio.get_running_loop().time()
        return result

    monkeypatch.setattr(MembershipTierService, "_advance_members", slow_scan)

    async def scan():
        await _advance(org_id)

    async def edit():
        await in_scan.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                admin = (
                    await session.execute(select(User).where(User.id == admin_id))
                ).scalar_one()
                try:
                    await member_status.update_membership_tier_config(
                        dict(_WITHOUT_SENIOR), db=session, current_user=admin
                    )
                except HTTPException as exc:
                    finished["edit"] = asyncio.get_running_loop().time()
                    return exc
            finally:
                await session.close()
        finished["edit"] = asyncio.get_running_loop().time()
        return None

    try:
        _, refused = await asyncio.gather(scan(), edit())
        assert refused is not None
        assert refused.status_code == 400
        assert finished["edit"] >= finished["scan_held_until"]
        assert await _membership_type(member_id) == "senior"
        assert await _stored_tier_ids(org_id) == ["active", "senior"]
    finally:
        await _cleanup(org_id)
