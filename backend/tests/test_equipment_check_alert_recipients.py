"""Who hears that an equipment check failed, and what the settings screen says.

The same defect as the shift-decline notice
(``test_shift_decline_recipients.py``): ``equipment_check_alerts.notify_roles``
holds the scheduling panel's office keys, was matched against
``Position.slug`` as written, so the seeded ``fire_chief`` never heard, and a
retired member still carrying the position did.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.notification import NotificationLog
from app.models.training import Shift
from app.models.user import Organization, Position, User, UserStatus
from app.services.equipment_check_service import EquipmentCheckService
from app.services.organization_service import OrganizationService

pytestmark = [pytest.mark.integration]


async def _member(db_session, org, handle, position=None, status=UserStatus.ACTIVE):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"eqalert-{handle}-{uuid.uuid4().hex[:6]}",
        email=f"{handle}-{uuid.uuid4().hex[:6]}@eqalert.test",
        first_name=handle.title(),
        last_name="Member",
        password_hash="x",
        status=status,
    )
    user.positions = [position] if position is not None else []
    db_session.add(user)
    await db_session.flush()
    return user


async def _org(db_session, settings):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Equipment Alert FD",
        slug=f"eqalert-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings=settings,
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _position(db_session, org, slug):
    position = Position(
        id=str(uuid.uuid4()), organization_id=org.id, name=slug.title(), slug=slug
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _alerted(db_session, org, checker):
    start = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=date.fromordinal(start.toordinal()),
        start_time=start,
        end_time=start + timedelta(hours=12),
    )
    db_session.add(shift)
    await db_session.flush()
    await EquipmentCheckService(db_session)._send_check_failure_notification(
        organization_id=str(org.id),
        shift=shift,
        checked_by=str(checker.id),
        template_id=None,
        failed_count=1,
        total_count=5,
    )
    rows = await db_session.execute(
        select(NotificationLog.recipient_id).where(
            NotificationLog.organization_id == str(org.id),
            NotificationLog.category == "equipment_check",
        )
    )
    return sorted(str(r) for r in rows.scalars().all())


async def test_alert_reaches_the_fire_chief_and_skips_former_members(db_session):
    org = await _org(
        db_session, {"equipment_check_alerts": {"notify_roles": ["chief", "captain"]}}
    )
    captain = await _position(db_session, org, "captain")
    chief = await _member(
        db_session, org, "chief", await _position(db_session, org, "fire_chief")
    )
    active_captain = await _member(db_session, org, "captain", captain)
    await _member(db_session, org, "retired", captain, status=UserStatus.RETIRED)
    checker = await _member(db_session, org, "checker")

    assert await _alerted(db_session, org, checker) == sorted(
        [str(chief.id), str(active_captain.id)]
    )


async def test_unsaved_settings_alert_the_roles_the_panel_shows(db_session):
    # The panel shows Chief and Captain ticked for a department that never
    # saved it; the sender read an absent key as "nobody" (CLAUDE.md #19).
    org = await _org(db_session, {})
    chief = await _member(
        db_session, org, "chief", await _position(db_session, org, "fire_chief")
    )
    captain = await _member(
        db_session, org, "captain", await _position(db_session, org, "captain")
    )
    checker = await _member(db_session, org, "checker")

    assert await _alerted(db_session, org, checker) == sorted(
        [str(chief.id), str(captain.id)]
    )


async def test_settings_read_reports_the_defaults_the_sender_uses(db_session):
    org = await _org(db_session, {})

    read = await OrganizationService(db_session).get_organization_settings(org.id)

    assert read.equipment_check_alerts.model_dump() == {
        "notify_on_failure": True,
        "notify_roles": ["chief", "captain"],
        "notify_shift_officer": True,
        "send_email": False,
        "cc_emails": [],
    }


async def test_settings_read_keeps_saved_values_and_drops_malformed_ones(db_session):
    org = await _org(
        db_session,
        {
            "equipment_check_alerts": {
                "notify_roles": ["lieutenant", 7],
                "send_email": True,
                "notify_shift_officer": "yes",
                "cc_emails": ["qm@example.com", "not-an-address"],
            }
        },
    )

    read = await OrganizationService(db_session).get_organization_settings(org.id)

    assert read.equipment_check_alerts.model_dump() == {
        "notify_on_failure": True,
        "notify_roles": ["lieutenant"],
        "notify_shift_officer": True,
        "send_email": True,
        "cc_emails": ["qm@example.com"],
    }
