"""
Property return reminders run on a schedule.

They were implemented, tested and reachable by API, but nothing ever called
``POST /users/property-return-reminders/process`` -- no scheduled task, no
screen -- so a dropped member holding department property was never reminded.
These pin the task into the in-process scheduler and check the runner. DB
mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import scheduled_tasks

pytestmark = pytest.mark.unit


def test_registered_in_every_place_the_scheduler_reads():
    assert "property_return_reminders" in scheduled_tasks.TASK_RUNNERS
    assert scheduled_tasks.TASK_INTERVALS_SECONDS["property_return_reminders"] == (
        86400
    )
    assert scheduled_tasks.SCHEDULE["property_return_reminders"]["cron"] == (
        "45 7 * * *"
    )
    assert "task=property_return_reminders" in scheduled_tasks.__doc__


def _db_with_orgs(org_ids):
    result = MagicMock()
    result.scalars.return_value.all.return_value = [
        MagicMock(id=org_id) for org_id in org_ids
    ]
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


async def test_runs_each_organization_and_totals_the_reminders():
    db = _db_with_orgs(["A", "B"])
    service = MagicMock()
    service.process_reminders = AsyncMock(
        side_effect=[{"reminders_sent": 2}, {"reminders_sent": 1}]
    )
    with patch(
        "app.services.property_return_reminder_service."
        "PropertyReturnReminderService",
        return_value=service,
    ):
        out = await scheduled_tasks.run_property_return_reminders(db)

    assert out == {"task": "property_return_reminders", "total": 3, "errors": []}
    assert [
        c.kwargs["organization_id"] for c in service.process_reminders.await_args_list
    ] == ["A", "B"]


async def test_one_organizations_failure_does_not_stop_the_rest():
    db = _db_with_orgs(["A", "B", "C"])
    service = MagicMock()
    service.process_reminders = AsyncMock(
        side_effect=[
            {"reminders_sent": 1},
            RuntimeError("smtp down for B"),
            {"reminders_sent": 4},
        ]
    )
    with patch(
        "app.services.property_return_reminder_service."
        "PropertyReturnReminderService",
        return_value=service,
    ):
        out = await scheduled_tasks.run_property_return_reminders(db)

    assert out["total"] == 5
    assert [e["org_id"] for e in out["errors"]] == ["B"]
    db.rollback.assert_awaited_once()
