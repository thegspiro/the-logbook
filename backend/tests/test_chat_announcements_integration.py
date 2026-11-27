"""What the department's chat integrations are told.

INT2-11: creating an event announced it to Slack, Discord, Teams and the
generic webhooks even as a draft, and publishing it announced nothing — so a
draft's title went out early, and the published event never did. Drafts are
now skipped at creation and announced when published.

INT2-12: every new training record was announced as "<member> completed
<course>", whatever its status. A record defaults to "scheduled", so a
scheduled, cancelled or failed record posted a false completion about a named
member to a third-party channel. Only a completed record is announced.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks

from app.api.v1.endpoints import events as events_endpoint
from app.api.v1.endpoints import training as training_endpoint
from app.models.user import User
from app.schemas.event import EventCreate
from app.schemas.training import TrainingRecordCreate
from app.services.integration_services.notification_dispatch import (
    notify_entity_created,
)

pytestmark = [pytest.mark.integration]


def _announcements(tasks: BackgroundTasks) -> list:
    return [t for t in tasks.tasks if t.func is notify_entity_created]


async def test_a_draft_is_announced_when_published_not_when_created(
    db_session, setup_org_and_admin
):
    _, admin = setup_org_and_admin
    actor = await db_session.get(User, admin)
    start = (datetime.now(timezone.utc) + timedelta(days=3)).replace(
        second=0, microsecond=0
    )
    created_tasks = BackgroundTasks()

    event = await events_endpoint.create_event(
        event_data=EventCreate(
            title="Not yet announced",
            event_type="business_meeting",
            location="Station 1",
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            requires_rsvp=False,
            is_draft=True,
        ),
        background_tasks=created_tasks,
        db=db_session,
        current_user=actor,
    )
    assert _announcements(created_tasks) == []

    published_tasks = BackgroundTasks()
    await events_endpoint.publish_event(
        event_id=event.id,
        background_tasks=published_tasks,
        db=db_session,
        current_user=actor,
    )

    [announcement] = _announcements(published_tasks)
    assert announcement.args[1] == "event"
    assert announcement.args[2]["title"] == "Not yet announced"


@pytest.mark.parametrize(
    ("status", "announced"),
    [("scheduled", False), ("failed", False), ("completed", True)],
)
async def test_only_a_completed_training_record_is_announced(
    db_session, setup_org_and_admin, status, announced
):
    _, admin = setup_org_and_admin
    actor = await db_session.get(User, admin)
    tasks = BackgroundTasks()

    await training_endpoint.create_record(
        record=TrainingRecordCreate(
            user_id=admin,
            course_name="Pump operations",
            training_type="continuing_education",
            completion_date=date.today(),
            hours_completed=4,
            status=status,
        ),
        background_tasks=tasks,
        db=db_session,
        current_user=actor,
    )

    assert bool(_announcements(tasks)) is announced
