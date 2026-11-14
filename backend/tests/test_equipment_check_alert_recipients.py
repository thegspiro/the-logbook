"""Who hears that an equipment check failed.

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


async def test_alert_reaches_the_fire_chief_and_skips_former_members(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Equipment Alert FD",
        slug=f"eqalert-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={"equipment_check_alerts": {"notify_roles": ["chief", "captain"]}},
    )
    db_session.add(org)
    await db_session.flush()
    fire_chief = Position(
        id=str(uuid.uuid4()), organization_id=org.id, name="Chief", slug="fire_chief"
    )
    captain = Position(
        id=str(uuid.uuid4()), organization_id=org.id, name="Captain", slug="captain"
    )
    db_session.add_all([fire_chief, captain])
    await db_session.flush()
    chief = await _member(db_session, org, "chief", fire_chief)
    active_captain = await _member(db_session, org, "captain", captain)
    await _member(db_session, org, "retired", captain, status=UserStatus.RETIRED)
    checker = await _member(db_session, org, "checker")

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

    recipients = (
        (
            await db_session.execute(
                select(NotificationLog.recipient_id).where(
                    NotificationLog.organization_id == str(org.id),
                    NotificationLog.category == "equipment_check",
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted(str(r) for r in recipients) == sorted(
        [str(chief.id), str(active_captain.id)]
    )
