"""The forms intake path must do everything the JSON intake path does.

A department publishes its request form through the Forms module — that is what
the "Generate public request form" button in Events settings builds, and it is
the route the public actually uses. Until 2026-08-24 that path created the
``EventRequest`` row and stopped: no default coordinator was assigned, no
acknowledgement went to the requester, and no coordinator was told a request
had arrived. The same request posted to ``/event-requests/public`` was assigned
and emailed immediately.

These pin the two paths together, and cover the one place they are deliberately
different: a short-notice request. The JSON endpoint refuses it while the
submitter is still there to pick another date; a form submission has already
been accepted, so it is flagged for the coordinator rather than dropped behind
a success page nobody can appeal.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.forms import IntegrationType
from app.services.forms_service import FormsService

ORG_ID = "00000000-0000-0000-0000-000000000001"
COORDINATOR_ID = "00000000-0000-0000-0000-0000000000aa"
SUBMISSION_ID = "00000000-0000-0000-0000-0000000000cc"


def _org(pipeline_overrides=None):
    return SimpleNamespace(
        id=ORG_ID,
        name="Oakville Fire Department",
        active=True,
        timezone="America/New_York",
        settings={"events": {"request_pipeline": dict(pipeline_overrides or {})}},
    )


def _submission(data):
    return SimpleNamespace(
        id=SUBMISSION_ID,
        organization_id=ORG_ID,
        data=data,
        ip_address="203.0.113.9",
    )


def _integration(mappings):
    return SimpleNamespace(
        integration_type=IntegrationType.EVENT_REQUEST,
        is_active=True,
        field_mappings=mappings,
    )


def _service(org, *, coordinator_found=True):
    """A FormsService whose session answers the two lookups the path makes."""
    db = AsyncMock()
    db.add = MagicMock()
    # 1) the organization, 2) the default coordinator's org membership check
    db.scalar.side_effect = [org, COORDINATOR_ID if coordinator_found else None]
    db.execute.return_value = SimpleNamespace(first=lambda: ("Sam", "Ortiz"))
    return FormsService(db), db


def _mappings():
    return {
        "f_name": "contact_name",
        "f_email": "contact_email",
        "f_type": "outreach_type",
        "f_desc": "description",
        "f_flex": "date_flexibility",
        "f_start": "preferred_date_start",
    }


def _data(**overrides):
    payload = {
        "f_name": "Dana Reyes",
        "f_email": "dana@example.org",
        "f_type": "fire_safety_demo",
        "f_desc": "Fire safety talk for a third grade class.",
    }
    payload.update(overrides)
    return payload


async def _process(service, submission, integration):
    with patch(
        "app.services.event_request_service.send_request_notification",
        AsyncMock(),
    ) as notify:
        result = await service._process_event_request(
            submission, integration=integration, form=None
        )
    return result, notify


def _added_request(db):
    """The EventRequest instance handed to ``session.add``."""
    from app.models.event_request import EventRequest

    for call in db.add.call_args_list:
        if isinstance(call.args[0], EventRequest):
            return call.args[0]
    raise AssertionError("no EventRequest was added")


def _added_activity_actions(db):
    from app.models.event_request import EventRequestActivity

    return [
        call.args[0].action
        for call in db.add.call_args_list
        if isinstance(call.args[0], EventRequestActivity)
    ]


@pytest.mark.asyncio
async def test_a_form_request_is_assigned_to_the_default_coordinator():
    org = _org({"default_assignee_id": COORDINATOR_ID})
    service, db = _service(org)

    result, _ = await _process(service, _submission(_data()), _integration(_mappings()))

    assert result["success"] is True
    assert _added_request(db).assigned_to == COORDINATOR_ID
    assert "auto_assigned" in _added_activity_actions(db)


@pytest.mark.asyncio
async def test_a_form_request_sends_the_submission_notification():
    org = _org({"default_assignee_id": COORDINATOR_ID})
    service, _ = _service(org)

    _, notify = await _process(service, _submission(_data()), _integration(_mappings()))

    assert notify.await_count == 1
    assert notify.await_args.args[2] == "on_submitted"


@pytest.mark.asyncio
async def test_a_departed_coordinator_leaves_the_request_unassigned():
    """Assigning to somebody who left hides the request from the queue."""
    org = _org({"default_assignee_id": COORDINATOR_ID})
    service, db = _service(org, coordinator_found=False)

    await _process(service, _submission(_data()), _integration(_mappings()))

    assert _added_request(db).assigned_to is None
    assert "auto_assigned" not in _added_activity_actions(db)


@pytest.mark.asyncio
async def test_a_short_notice_form_request_is_flagged_not_dropped():
    org = _org({"min_lead_time_days": 21, "default_assignee_id": None})
    service, db = _service(org)
    soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()

    result, _ = await _process(
        service,
        _submission(_data(f_flex="specific_dates", f_start=soon)),
        _integration(_mappings()),
    )

    assert result["success"] is True
    request = _added_request(db)
    assert request.reviewer_notes is not None
    assert "Short notice" in request.reviewer_notes
    assert "lead_time_warning" in _added_activity_actions(db)


@pytest.mark.asyncio
async def test_a_request_with_enough_notice_carries_no_warning():
    org = _org({"min_lead_time_days": 21, "default_assignee_id": None})
    service, db = _service(org)
    later = (datetime.now(timezone.utc) + timedelta(days=45)).isoformat()

    await _process(
        service,
        _submission(_data(f_flex="specific_dates", f_start=later)),
        _integration(_mappings()),
    )

    assert _added_request(db).reviewer_notes is None
    assert "lead_time_warning" not in _added_activity_actions(db)
