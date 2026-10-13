"""Auto-closing a stale admin-hours session writes one audit event per session.

CRON2-31-13: the auto-close rewrites a member's paid time (caps the clock-out
and sends the entry back to review) and used to leave no audit trail at all.
The owner chose one event per closed session, so a member disputing a capped
session can find the record for that session alone.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.audit import AuditLog, SeverityLevel
from app.models.user import Organization, User, UserStatus
from app.services.admin_hours_service import AdminHoursService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Auto Close Audit Department",
        slug=f"ahclose-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, first="Forgot") -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@ahclose.test",
        first_name=first,
        last_name="Clockout",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _active_entry(db_session, org, user, category, hours_ago) -> AdminHoursEntry:
    entry = AdminHoursEntry(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        category_id=category.id,
        clock_in_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        entry_method=AdminHoursEntryMethod.QR_SCAN,
        status=AdminHoursEntryStatus.ACTIVE,
    )
    db_session.add(entry)
    await db_session.flush()
    return entry


async def _setup(db_session):
    org = await _org(db_session)
    category = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Office {uuid.uuid4().hex[:6]}",
        is_active=True,
        require_approval=True,
        max_hours_per_session=4,
    )
    db_session.add(category)
    await db_session.flush()
    return org, category


async def _events_for(db_session, entry_ids):
    rows = (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "admin_hours.session_auto_closed"
                )
            )
        )
        .scalars()
        .all()
    )
    return [r for r in rows if r.event_data.get("entry_id") in entry_ids]


async def test_scheduled_sweep_writes_one_event_per_closed_session(db_session):
    org, category = await _setup(db_session)
    a = await _active_entry(db_session, org, await _user(db_session, org), category, 9)
    b = await _active_entry(
        db_session, org, await _user(db_session, org, "Also"), category, 6
    )
    fresh = await _active_entry(
        db_session, org, await _user(db_session, org, "Still"), category, 1
    )

    closed = await AdminHoursService(db_session).auto_close_stale_sessions()

    assert closed >= 2
    events = await _events_for(db_session, {a.id, b.id, fresh.id})
    assert sorted(e.event_data["entry_id"] for e in events) == sorted([a.id, b.id])
    for event in events:
        assert event.organization_id == org.id
        assert event.user_id is None
        assert event.event_data["trigger"] == "scheduled"
        assert event.event_data["duration_minutes"] == 240
        assert event.event_data["new_status"] == "pending"
        assert event.severity == SeverityLevel.WARNING
    by_entry = {e.event_data["entry_id"]: e for e in events}
    assert by_entry[a.id].event_data["member_user_id"] == a.user_id


async def test_manual_sweep_names_the_officer(db_session):
    org, category = await _setup(db_session)
    officer = await _user(db_session, org, "Officer")
    entry = await _active_entry(
        db_session, org, await _user(db_session, org), category, 10
    )

    closed = await AdminHoursService(db_session).auto_close_stale_sessions(
        organization_id=org.id,
        actor_user_id=officer.id,
        actor_username=officer.username,
    )

    assert closed == 1
    (event,) = await _events_for(db_session, {entry.id})
    assert event.user_id == officer.id
    assert event.username == officer.username
    assert event.event_data["trigger"] == "manual"
    assert event.organization_id == org.id


async def test_nothing_stale_writes_no_event(db_session):
    org, category = await _setup(db_session)
    entry = await _active_entry(
        db_session, org, await _user(db_session, org), category, 1
    )

    closed = await AdminHoursService(db_session).auto_close_stale_sessions(
        organization_id=org.id
    )

    assert closed == 0
    assert await _events_for(db_session, {entry.id}) == []
