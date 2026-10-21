"""
A member who can no longer work comes off the shifts still ahead of them.

Soft-deleting, archiving, and changing a member's status to anything outside
``ACTIVE_ACCOUNT_STATUSES`` all used to leave their future seats on the
roster and their standing claims live, so the department kept counting on
somebody who could not sign in. Each path now calls
``release_future_shift_commitments``; these tests drive each endpoint against
a real database and check that only shifts which have not started lose the
member — finished and in-progress shifts are history and stay as they were.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import select, text

from app.api.v1.endpoints import member_status as member_status_endpoint
from app.api.v1.endpoints import users as users_endpoint
from app.models.training import Shift, ShiftAssignment, StandingShiftClaim
from app.services import member_shift_release_service

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Release FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"rel-{org_id[:8]}"},
    )
    return org_id


async def _add_member(db, org_id: str, status: str = "active") -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Test', 'Member', :em, 'hashed', :status)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"rel_{user_id[:8]}",
            "em": f"rel_{user_id[:8]}@test.com",
            "status": status,
        },
    )
    await db.flush()
    return user_id


async def _seat(db, org_id: str, user_id: str, start: datetime) -> str:
    shift = Shift(
        organization_id=org_id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=12),
    )
    db.add(shift)
    await db.flush()
    assignment = ShiftAssignment(
        organization_id=org_id,
        shift_id=shift.id,
        user_id=user_id,
        position="firefighter",
    )
    db.add(assignment)
    await db.flush()
    return assignment.id


@pytest.fixture
async def rostered(db_session):
    """A member seated on a finished, an in-progress and two future shifts,
    holding a standing claim, beside a colleague on the same future shift."""
    org_id = await _add_org(db_session)
    admin = await _add_member(db_session, org_id)
    member = await _add_member(db_session, org_id)
    colleague = await _add_member(db_session, org_id)
    now = datetime.now(timezone.utc)
    seats = {
        "past": await _seat(db_session, org_id, member, now - timedelta(days=3)),
        "in_progress": await _seat(
            db_session, org_id, member, now - timedelta(hours=2)
        ),
        "tomorrow": await _seat(db_session, org_id, member, now + timedelta(days=1)),
        "next_week": await _seat(db_session, org_id, member, now + timedelta(days=7)),
        "colleague": await _seat(
            db_session, org_id, colleague, now + timedelta(days=1)
        ),
    }
    claim = StandingShiftClaim(
        organization_id=org_id,
        user_id=member,
        weekday=2,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=90),
    )
    db_session.add(claim)
    await db_session.flush()
    return SimpleNamespace(
        org=org_id, admin=admin, member=member, seats=seats, claim=claim.id
    )


@pytest.fixture
def audit(monkeypatch):
    """The release's own audit event, captured; the endpoints' other audit
    writes are silenced, as are the guards with tests of their own."""
    release_audit = AsyncMock()
    monkeypatch.setattr(member_shift_release_service, "log_audit_event", release_audit)
    for module in (users_endpoint, member_status_endpoint):
        monkeypatch.setattr(module, "log_audit_event", AsyncMock())
        monkeypatch.setattr(module, "assert_not_last_administrator", AsyncMock())
        monkeypatch.setattr(module, "_enforce_account_reset_ceiling", AsyncMock())
    return release_audit


def _admin(r) -> SimpleNamespace:
    return SimpleNamespace(id=r.admin, organization_id=r.org, username="admin")


async def _remaining(db, r) -> set[str]:
    ids = set(
        (
            await db.execute(
                select(ShiftAssignment.id).where(
                    ShiftAssignment.id.in_(list(r.seats.values()))
                )
            )
        ).scalars()
    )
    return {name for name, seat in r.seats.items() if seat in ids}


async def _claim_active(db, r) -> bool:
    claim = (
        await db.execute(
            select(StandingShiftClaim)
            .where(StandingShiftClaim.id == r.claim)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return bool(claim.is_active)


def _assert_released(remaining: set[str], audit: AsyncMock, reason: str) -> None:
    assert remaining == {"past", "in_progress", "colleague"}
    audit.assert_awaited_once()
    data = audit.await_args.kwargs["event_data"]
    assert data["assignments_released"] == 2
    assert data["standing_claims_ended"] == 1
    assert data["reason"] == reason


class TestSoftDelete:
    async def test_releases_future_shifts_only(self, db_session, rostered, audit):
        await users_endpoint.delete_user(
            user_id=UUID(rostered.member),
            hard=False,
            db=db_session,
            current_user=_admin(rostered),
        )

        _assert_released(await _remaining(db_session, rostered), audit, "soft_deleted")
        assert not await _claim_active(db_session, rostered)


class TestArchive:
    async def test_releases_future_shifts_only(self, db_session, rostered, audit):
        await db_session.execute(
            text("UPDATE users SET status = 'dropped_voluntary' WHERE id = :id"),
            {"id": rostered.member},
        )

        await member_status_endpoint.archive_member(
            user_id=UUID(rostered.member),
            request=member_status_endpoint.ArchiveMemberRequest(reason="Moved away"),
            db=db_session,
            current_user=_admin(rostered),
        )

        _assert_released(await _remaining(db_session, rostered), audit, "archived")
        assert not await _claim_active(db_session, rostered)


class TestStatusChange:
    async def _change(self, db, r, new_status: str):
        return await member_status_endpoint.change_member_status(
            user_id=UUID(r.member),
            request=member_status_endpoint.MemberStatusChangeRequest(
                new_status=new_status, reason="Test"
            ),
            background_tasks=BackgroundTasks(),
            db=db,
            current_user=_admin(r),
        )

    async def test_a_status_that_cannot_work_releases_future_shifts(
        self, db_session, rostered, audit
    ):
        await self._change(db_session, rostered, "suspended")

        _assert_released(
            await _remaining(db_session, rostered), audit, "status_changed:suspended"
        )
        assert not await _claim_active(db_session, rostered)

    async def test_staying_in_an_active_status_releases_nothing(
        self, db_session, rostered, audit
    ):
        await self._change(db_session, rostered, "probationary")

        assert await _remaining(db_session, rostered) == set(rostered.seats)
        assert await _claim_active(db_session, rostered)
        audit.assert_not_awaited()

    async def test_reinstating_does_not_put_the_member_back(
        self, db_session, rostered, audit
    ):
        await self._change(db_session, rostered, "suspended")
        await self._change(db_session, rostered, "active")

        assert await _remaining(db_session, rostered) == {
            "past",
            "in_progress",
            "colleague",
        }
        assert not await _claim_active(db_session, rostered)
