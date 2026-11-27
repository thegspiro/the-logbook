"""Departed members stop receiving the department's alerts.

NOTIF2-10: certification-expiry alerts looked the member up by id with no
status filter, so a retired or inactive member kept getting 90/60/30/7-day
emails and in-app alerts (pushed to their phone), and officers were copied.

NOTIF2-11: event reminders for the "going" audience loaded the members who had
RSVP'd with no active filter — unlike the "all" audience — and leaving the
department never removes an RSVP, so a departed member kept being reminded.

Probationary members are current members and keep receiving both (pitfall #32).
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select

from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.notification import NotificationLog
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import Organization, User, UserStatus
from app.services import scheduled_tasks
from app.services.cert_alert_service import CertAlertService
from app.services.email_service import EmailService

pytestmark = [pytest.mark.integration]


async def _org(db, settings=None):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Departed FD",
        slug=f"dep-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings=settings or {},
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, status):
    tag = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{tag}",
        email=f"{tag}@departed.test",
        first_name="P",
        last_name=tag,
        password_hash="x",
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


async def _alerts(db, org, user):
    return (
        await db.execute(
            select(func.count())
            .select_from(NotificationLog)
            .where(
                NotificationLog.organization_id == org.id,
                NotificationLog.recipient_id == user.id,
            )
        )
    ).scalar()


def _cert(org, user):
    today = date.today()
    return TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        course_name="CPR",
        training_type=TrainingType.CERTIFICATION,
        completion_date=today - timedelta(days=700),
        expiration_date=today + timedelta(days=5),
        hours_completed=8,
        status=TrainingStatus.COMPLETED,
    )


async def test_cert_alerts_skip_a_departed_member_and_reach_a_probationary_one(
    db_session,
):
    org = await _org(db_session, {"cert_alert_config": {"enabled": True}})
    gone = await _user(db_session, org, UserStatus.INACTIVE)
    probie = await _user(db_session, org, UserStatus.PROBATIONARY)
    db_session.add_all([_cert(org, gone), _cert(org, probie)])
    await db_session.commit()

    with patch.object(EmailService, "send_email", AsyncMock(return_value=(1, 0))):
        await CertAlertService(db_session).process_alerts(org.id)

    assert await _alerts(db_session, org, gone) == 0
    assert await _alerts(db_session, org, probie) == 1


async def test_going_reminders_skip_a_departed_member(db_session):
    org = await _org(db_session)
    active = await _user(db_session, org, UserStatus.ACTIVE)
    gone = await _user(db_session, org, UserStatus.INACTIVE)
    now = datetime.now(timezone.utc)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Drill",
        event_type=EventType.TRAINING,
        start_datetime=now + timedelta(hours=2),
        end_datetime=now + timedelta(hours=4),
        send_reminders=True,
        reminder_schedule=[3],
        reminder_target="going",
    )
    db_session.add(event)
    await db_session.flush()
    for user in (active, gone):
        db_session.add(
            EventRSVP(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                event_id=event.id,
                user_id=user.id,
                status=RSVPStatus.GOING,
            )
        )
    await db_session.commit()

    with patch.object(
        EmailService, "send_event_reminder", AsyncMock(return_value=True)
    ) as sent:
        await scheduled_tasks.run_event_reminders(db_session)

    recipients = set(
        (
            await db_session.execute(
                select(NotificationLog.recipient_id).where(
                    NotificationLog.organization_id == org.id
                )
            )
        )
        .scalars()
        .all()
    )
    emailed = {c.kwargs["to_email"] for c in sent.await_args_list}
    assert gone.id not in recipients
    assert gone.email not in emailed
    assert active.id in recipients
    assert active.email in emailed
