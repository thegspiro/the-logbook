"""``GET /scheduling/shifts/{id}/my-attendance`` for a member not yet checked in.

The check-in page and the shift panel ask this on every opening, and for a
member who has not checked in the endpoint answered 404 "No attendance record
found". The page read that as "not yet", but the browser logged a failed
request on every ordinary visit (twice: the load, then the visibility
refresh), which reads as a fault in the console and in error tracking
(workflow review W34-4). Not having checked in is a normal state, so it is now
a 200 with a ``null`` body.

A shift the caller cannot see (another department's, or one that does not
exist) still answers ``null`` and nothing more, exactly as it answered the
same 404 before, so the change reveals nothing about other departments.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.database import get_db
from app.models.training import Shift, ShiftAttendance
from app.models.user import Organization
from tests.test_finance_budget_owners import _user

pytestmark = pytest.mark.integration


async def _org(db: AsyncSession, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"my-att-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _shift(db: AsyncSession, org_id: str) -> Shift:
    shift = Shift(
        organization_id=org_id,
        shift_date=date(2026, 11, 2),
        start_time=datetime(2026, 11, 2, 13, tzinfo=timezone.utc),
        end_time=datetime(2026, 11, 3, 1, tzinfo=timezone.utc),
    )
    db.add(shift)
    await db.flush()
    return shift


def _client(db: AsyncSession, user) -> AsyncClient:
    app = FastAPI()
    app.include_router(scheduling_endpoint.router, prefix="/scheduling")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _org(db_session, "My Attendance VFD")
    member = await _user(db_session, org.id, "member", [])
    shift = await _shift(db_session, org.id)
    return {"db": db_session, "org": org, "member": member, "shift": shift}


async def test_not_checked_in_is_a_200_with_no_record(dept):
    async with _client(dept["db"], dept["member"]) as client:
        response = await client.get(
            f"/scheduling/shifts/{dept['shift'].id}/my-attendance"
        )

    assert response.status_code == 200
    assert response.json() is None


async def test_a_check_in_is_still_returned(dept):
    db = dept["db"]
    db.add(
        ShiftAttendance(
            shift_id=dept["shift"].id,
            user_id=dept["member"].id,
            checked_in_at=datetime(2026, 11, 2, 13, 5, tzinfo=timezone.utc),
        )
    )
    await db.flush()

    async with _client(db, dept["member"]) as client:
        response = await client.get(
            f"/scheduling/shifts/{dept['shift'].id}/my-attendance"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["shift_id"] == dept["shift"].id
    assert body["user_id"] == dept["member"].id
    assert body["checked_in_at"].startswith("2026-11-02T13:05:00")


async def test_another_departments_shift_reveals_nothing(dept):
    db = dept["db"]
    other = await _org(db, "Other VFD")
    their_shift = await _shift(db, other.id)
    their_member = await _user(db, other.id, "theirs", [])
    db.add(
        ShiftAttendance(
            shift_id=their_shift.id,
            user_id=their_member.id,
            checked_in_at=datetime(2026, 11, 2, 13, 5, tzinfo=timezone.utc),
        )
    )
    await db.flush()

    async with _client(db, dept["member"]) as client:
        foreign = await client.get(f"/scheduling/shifts/{their_shift.id}/my-attendance")
        missing = await client.get(f"/scheduling/shifts/{uuid.uuid4()}/my-attendance")

    # The same answer as a shift of their own they have not checked in to.
    assert (foreign.status_code, foreign.json()) == (200, None)
    assert (missing.status_code, missing.json()) == (200, None)
