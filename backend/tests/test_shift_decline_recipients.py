"""Who hears that a member declined or dropped a shift.

``notify_roles`` is stored as the scheduling panel's office keys —
``chief``, ``deputy_chief``, ``captain`` — and was matched against
``Position.slug`` as written. The seeded Chief position is ``fire_chief``, so
the Chief never heard of a declined shift, and a retired captain still
carrying the position heard of every one. Recipients now resolve the way the
2026-08-26 role-group fix does (``position_slugs_for_offices``), and only
current members (``ACTIVE_ACCOUNT_STATUSES``, not deleted) are notified.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.training import Shift
from app.models.user import Organization, Position, User, UserStatus
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


async def _org(db_session, scheduling=None):
    settings = {} if scheduling is None else {"scheduling": scheduling}
    org = Organization(
        id=str(uuid.uuid4()),
        name="Decline Notice FD",
        slug=f"decline-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings=settings,
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _position(db_session, org, slug):
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=slug.replace("_", " ").title(),
        slug=slug,
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _member(db_session, org, handle, position=None, status=UserStatus.ACTIVE):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"decline-{handle}-{uuid.uuid4().hex[:6]}",
        email=f"{handle}-{uuid.uuid4().hex[:6]}@decline.test",
        first_name=handle.title(),
        last_name="Member",
        password_hash="x",
        status=status,
    )
    user.positions = [position] if position is not None else []
    db_session.add(user)
    await db_session.flush()
    return user


async def _shift(db_session, org):
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=2)
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=date.fromordinal(start.toordinal()),
        start_time=start,
        end_time=start + timedelta(hours=12),
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _recipients(db_session, org, shift, decliner):
    service = SchedulingService(db_session)
    with patch.object(service, "_send_notification", AsyncMock()) as send:
        await service._notify_shift_decline(
            shift_id=str(shift.id),
            user_id=str(decliner.id),
            position="firefighter",
            organization_id=str(org.id),
        )
    if not send.await_count:
        return set()
    return set(send.await_args.kwargs["recipient_ids"])


async def test_chief_office_reaches_the_seeded_fire_chief(db_session):
    org = await _org(db_session, {"notify_roles": ["chief", "captain"]})
    chief = await _member(
        db_session, org, "chief", await _position(db_session, org, "fire_chief")
    )
    captain = await _member(
        db_session, org, "captain", await _position(db_session, org, "captain")
    )
    decliner = await _member(db_session, org, "decliner")
    shift = await _shift(db_session, org)

    assert await _recipients(db_session, org, shift, decliner) == {
        str(chief.id),
        str(captain.id),
    }


async def test_former_members_holding_the_position_are_not_notified(db_session):
    org = await _org(db_session, {"notify_roles": ["captain"]})
    captain = await _position(db_session, org, "captain")
    current = await _member(db_session, org, "current", captain)
    probationary = await _member(
        db_session, org, "probie", captain, status=UserStatus.PROBATIONARY
    )
    await _member(db_session, org, "retired", captain, status=UserStatus.RETIRED)
    deleted = await _member(db_session, org, "deleted", captain)
    deleted.deleted_at = datetime.now(timezone.utc)
    decliner = await _member(db_session, org, "decliner")
    shift = await _shift(db_session, org)
    await db_session.flush()

    assert await _recipients(db_session, org, shift, decliner) == {
        str(current.id),
        str(probationary.id),
    }


async def test_unsaved_settings_notify_the_defaults_the_panel_shows(db_session):
    # GET /organization/settings answers a department that never saved the
    # scheduling panel with SchedulingNotificationSettings' defaults, so the
    # panel shows Chief, Deputy Chief and Captain ticked. The sender read an
    # absent key as "nobody", contradicting the screen (CLAUDE.md #19, #29).
    org = await _org(db_session)
    chief = await _member(
        db_session, org, "chief", await _position(db_session, org, "fire_chief")
    )
    decliner = await _member(db_session, org, "decliner")
    shift = await _shift(db_session, org)

    assert await _recipients(db_session, org, shift, decliner) == {str(chief.id)}
