"""A new recurring series is announced to the chat integrations once.

create_event hands every new event to notify_entity_created, which posts it
to the department's Slack, Discord or Teams channels and generic webhooks.
The series endpoint never did, so a weekly drill created as a series was
never announced at all. It is announced once, as the series, rather than once
per occurrence, which would post a year of weekly drills as fifty-two
messages.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks

from app.api.v1.endpoints import events as events_endpoint
from app.models.user import User
from app.schemas.event import RecurringEventCreate
from app.services.integration_services.notification_dispatch import (
    notify_entity_created,
)

pytestmark = [pytest.mark.integration]


async def test_a_new_series_is_announced_once_with_its_first_occurrence(
    db_session, setup_org_and_admin
):
    org, admin = setup_org_and_admin
    actor = await db_session.get(User, admin)
    start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(
        second=0, microsecond=0
    )
    tasks = BackgroundTasks()

    created = await events_endpoint.create_recurring_event(
        recurring_data=RecurringEventCreate(
            title="Weekly Drill",
            event_type="business_meeting",
            location="Station 1",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            requires_rsvp=False,
            recurrence_pattern="weekly",
            recurrence_end_date=start + timedelta(weeks=2, hours=1),
        ),
        background_tasks=tasks,
        db=db_session,
        current_user=actor,
    )

    assert len(created) == 3
    [task] = tasks.tasks
    assert task.func is notify_entity_created
    assert task.args == (
        org,
        "event",
        {
            "title": "Weekly Drill",
            "event_type": "business_meeting",
            "start_time": min(e.start_datetime for e in created).isoformat(),
            "location": "Station 1",
        },
    )
