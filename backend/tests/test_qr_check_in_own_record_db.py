"""The QR data's record of the member who scanned, against a real database.

The mocked suite in test_qr_check_in.py takes the query on trust; this runs it,
and checks the one property a mock cannot: that a member is told about their
own check-in and never someone else's.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.events import get_qr_check_in_data
from app.models.event import EventRSVP
from app.models.user import User
from app.services.event_service import EventService
from tests.test_event_attendance_petitions import _event, _org, _user

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def hall(db_session):
    org_id = await _org(db_session)
    organizer = await _user(db_session, org_id, "Olive")
    ids = {
        "org": org_id,
        "member": await _user(db_session, org_id, "Sam"),
        "other": await _user(db_session, org_id, "Bea"),
        # Still running, so the check-in window is open.
        "event": await _event(
            db_session, org_id, organizer, ended_ago=timedelta(minutes=-30)
        ),
    }
    await db_session.flush()
    return ids


async def _qr(db_session, hall, user_id):
    data, error = await EventService(db_session).get_qr_check_in_data(
        uuid.UUID(hall["event"]), hall["org"], user_id=user_id
    )
    assert error is None
    return data


def _rsvp(hall, user_id, **fields):
    return EventRSVP(
        organization_id=hall["org"],
        event_id=hall["event"],
        user_id=user_id,
        status="going",
        **fields,
    )


@pytest.mark.asyncio
async def test_a_member_who_has_not_checked_in_has_neither_time(db_session, hall):
    data = await _qr(db_session, hall, hall["member"])

    assert data["user_checked_in_at"] is None
    assert data["user_checked_out_at"] is None


@pytest.mark.asyncio
async def test_a_checked_in_member_gets_their_check_in_time(db_session, hall):
    arrived = datetime(2026, 10, 20, 14, 5, tzinfo=timezone.utc)
    db_session.add(_rsvp(hall, hall["member"], checked_in=True, checked_in_at=arrived))
    await db_session.flush()

    data = await _qr(db_session, hall, hall["member"])

    assert data["user_checked_in_at"] == "2026-10-20T14:05:00Z"
    assert data["user_checked_out_at"] is None


@pytest.mark.asyncio
async def test_a_member_who_left_gets_both_times(db_session, hall):
    arrived = datetime(2026, 10, 20, 14, 5, tzinfo=timezone.utc)
    left = datetime(2026, 10, 20, 16, 30, tzinfo=timezone.utc)
    db_session.add(
        _rsvp(
            hall,
            hall["member"],
            checked_in=True,
            checked_in_at=arrived,
            checked_out_at=left,
        )
    )
    await db_session.flush()

    data = await _qr(db_session, hall, hall["member"])

    assert data["user_checked_in_at"] == "2026-10-20T14:05:00Z"
    assert data["user_checked_out_at"] == "2026-10-20T16:30:00Z"


@pytest.mark.asyncio
async def test_an_rsvp_alone_is_not_a_check_in(db_session, hall):
    db_session.add(_rsvp(hall, hall["member"], checked_in=False))
    await db_session.flush()

    data = await _qr(db_session, hall, hall["member"])

    assert data["user_checked_in_at"] is None


@pytest.mark.asyncio
async def test_a_member_is_never_told_about_someone_elses_check_in(db_session, hall):
    db_session.add(
        _rsvp(
            hall,
            hall["other"],
            checked_in=True,
            checked_in_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
    )
    await db_session.flush()

    data = await _qr(db_session, hall, hall["member"])

    assert data["user_checked_in_at"] is None
    assert data["user_checked_out_at"] is None


@pytest.mark.asyncio
async def test_the_endpoint_answers_each_caller_with_their_own_record(db_session, hall):
    arrived = datetime(2026, 10, 20, 14, 5, tzinfo=timezone.utc)
    db_session.add(_rsvp(hall, hall["member"], checked_in=True, checked_in_at=arrived))
    await db_session.flush()

    async def as_caller(user_id):
        caller = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        # request and scan are what FastAPI would inject; a direct call has to
        # pass them (scan=False: this test is not about the analytics scan).
        return await get_qr_check_in_data(
            uuid.UUID(hall["event"]),
            request=SimpleNamespace(headers={}),
            scan=False,
            db=db_session,
            current_user=caller,
        )

    own = await as_caller(hall["member"])
    someone_else = await as_caller(hall["other"])

    assert own.user_checked_in_at == "2026-10-20T14:05:00Z"
    assert someone_else.user_checked_in_at is None
