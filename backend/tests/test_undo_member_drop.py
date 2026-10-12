"""
Undo a mistaken drop (W15-3).

A member dropped by mistake could not be put back the same day: a rejoin
refuses a return date on or before the last day of service. The owner chose an
undo-drop action instead of redefining how service is counted. Within a week of
the drop it restores the member and reopens the stint the drop closed, so the
member's service runs on unbroken — no gap, no second stint.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.member_status import (
    UNDO_DROP_WINDOW_DAYS,
    UndoDropRequest,
    get_undo_drop_availability,
    undo_member_drop,
)
from app.models.user import MemberServicePeriod, Organization, User, UserStatus

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Undo Drop Department",
        slug=f"undodrop-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, **overrides) -> User:
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u-{handle}",
        email=f"{handle}@undodrop.test",
        first_name="Sam",
        last_name="Smith",
        password_hash="x",
        status=UserStatus.ACTIVE,
        hire_date=date(2018, 3, 1),
    )
    fields.update(overrides)
    user = User(**fields)
    db_session.add(user)
    await db_session.flush()
    return user


async def _dropped(db_session, org, *, days_ago=0, status=UserStatus.DROPPED_VOLUNTARY):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    member = await _user(db_session, org, status=status, status_changed_at=when)
    period = MemberServicePeriod(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=member.id,
        start_date=None,
        end_date=when.date(),
        separation_status=status.value,
        counts_toward_service=True,
    )
    db_session.add(period)
    await db_session.flush()
    return member, period


async def test_undo_restores_the_member_and_reopens_their_service(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member, period = await _dropped(db_session, org)

    result = await undo_member_drop(
        user_id=uuid.UUID(member.id),
        request=UndoDropRequest(reason="Dropped the wrong Smith"),
        db=db_session,
        current_user=officer,
    )

    assert result.previous_status == "dropped_voluntary"
    assert result.new_status == "active"
    assert member.status == UserStatus.ACTIVE
    periods = (
        (
            await db_session.execute(
                select(MemberServicePeriod).where(
                    MemberServicePeriod.user_id == member.id
                )
            )
        )
        .scalars()
        .all()
    )
    # The same stint, reopened — not a new one beside it.
    assert [p.id for p in periods] == [period.id]
    assert periods[0].end_date is None
    assert periods[0].separation_status is None


async def test_undo_can_restore_another_status(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member, _ = await _dropped(db_session, org, status=UserStatus.DROPPED_INVOLUNTARY)

    await undo_member_drop(
        user_id=uuid.UUID(member.id),
        request=UndoDropRequest(restore_status="leave"),
        db=db_session,
        current_user=officer,
    )

    assert member.status == UserStatus.LEAVE


async def test_undo_will_not_launder_a_suspension(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member, _ = await _dropped(db_session, org)

    with pytest.raises(HTTPException) as exc:
        await undo_member_drop(
            user_id=uuid.UUID(member.id),
            request=UndoDropRequest(restore_status="suspended"),
            db=db_session,
            current_user=officer,
        )

    assert exc.value.status_code == 400
    assert member.status == UserStatus.DROPPED_VOLUNTARY


async def test_after_the_window_it_is_a_rejoin_instead(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member, _ = await _dropped(db_session, org, days_ago=UNDO_DROP_WINDOW_DAYS + 1)

    availability = await get_undo_drop_availability(
        user_id=uuid.UUID(member.id), db=db_session, current_user=officer
    )
    assert availability.available is False
    assert "change their status" in availability.detail

    with pytest.raises(HTTPException) as exc:
        await undo_member_drop(
            user_id=uuid.UUID(member.id),
            request=UndoDropRequest(),
            db=db_session,
            current_user=officer,
        )
    assert exc.value.status_code == 400


async def test_only_a_dropped_member_can_be_undone(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    retired = await _user(
        db_session,
        org,
        status=UserStatus.RETIRED,
        status_changed_at=datetime.now(timezone.utc),
    )

    availability = await get_undo_drop_availability(
        user_id=uuid.UUID(retired.id), db=db_session, current_user=officer
    )

    assert availability.available is False


async def test_another_organization_cannot_undo_it(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    outsider = await _user(db_session, other)
    member, _ = await _dropped(db_session, org)

    with pytest.raises(HTTPException) as exc:
        await undo_member_drop(
            user_id=uuid.UUID(member.id),
            request=UndoDropRequest(),
            db=db_session,
            current_user=outsider,
        )

    assert exc.value.status_code == 404
