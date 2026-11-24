"""An unpublished (draft) event stays hidden on the side paths too.

ADV-5 made ``GET /events/{id}`` answer 404 to a non-organizer for a draft, and
EV-6 refused an RSVP to one. Four other paths still served or acted on a
draft to anyone holding its id: the QR check-in payload (title, description,
location, times), self-check-in (which creates a checked-in RSVP), the event's
document folder (named after the title) and the event's training session.
"""

import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import training_sessions as sessions_endpoint
from app.api.v1.endpoints.events import get_event_folder
from app.models.event import EventRSVP
from app.services.event_service import EventService
from tests.test_event_attendance_petitions import _event, _org, _user

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def draft(db_session):
    org_id = await _org(db_session)
    organizer = await _user(db_session, org_id, "Olive")
    member = await _user(db_session, org_id, "Sam")
    # Still running, so only the draft flag can refuse it.
    event_id = await _event(
        db_session, org_id, organizer, ended_ago=timedelta(minutes=-30)
    )
    await db_session.execute(
        text("UPDATE events SET is_draft = 1 WHERE id = :id"), {"id": event_id}
    )
    await db_session.flush()
    return {"org": org_id, "member": member, "event": event_id}


def _caller(draft, permissions=()):
    return SimpleNamespace(
        id=draft["member"],
        organization_id=draft["org"],
        positions=[SimpleNamespace(slug="member", permissions=list(permissions))],
        roles=[],
        rank=None,
    )


async def test_the_qr_payload_of_a_draft_is_not_served(db_session, draft):
    data, error = await EventService(db_session).get_qr_check_in_data(
        uuid.UUID(draft["event"]), draft["org"], user_id=draft["member"]
    )

    assert data is None
    assert error == "Event not found"


async def test_a_member_cannot_check_in_to_a_draft(db_session, draft):
    rsvp, error, _ = await EventService(db_session).self_check_in(
        event_id=uuid.UUID(draft["event"]),
        user_id=draft["member"],
        organization_id=draft["org"],
    )

    assert rsvp is None
    assert error == "Cannot check in to an unpublished event"
    created = (
        await db_session.execute(
            select(EventRSVP).where(EventRSVP.event_id == draft["event"])
        )
    ).scalar_one_or_none()
    assert created is None


async def test_a_drafts_folder_is_not_a_non_organizers(db_session, draft):
    with pytest.raises(HTTPException) as exc:
        await get_event_folder(
            uuid.UUID(draft["event"]),
            db=db_session,
            current_user=_caller(draft, ["events.view"]),
        )

    assert exc.value.status_code == 404


async def test_a_drafts_training_session_reads_as_none(db_session, draft):
    session = MagicMock()
    with (
        patch.object(
            sessions_endpoint.TrainingSessionService,
            "get_session_by_event",
            AsyncMock(return_value=session),
        ),
        patch.object(
            sessions_endpoint, "_session_payload", AsyncMock(return_value="payload")
        ),
    ):
        hidden = await sessions_endpoint.get_training_session_by_event(
            uuid.UUID(draft["event"]),
            db=db_session,
            current_user=_caller(draft),
        )
        organizer_view = await sessions_endpoint.get_training_session_by_event(
            uuid.UUID(draft["event"]),
            db=db_session,
            current_user=_caller(draft, ["events.manage"]),
        )

    assert hidden is None
    assert organizer_view == "payload"


async def _session_read(db_session, draft, permissions):
    with (
        patch.object(
            sessions_endpoint.TrainingSessionService,
            "get_session_by_event",
            AsyncMock(return_value=MagicMock()),
        ),
        patch.object(
            sessions_endpoint, "_session_payload", AsyncMock(return_value="payload")
        ),
    ):
        return await sessions_endpoint.get_training_session_by_event(
            uuid.UUID(draft["event"]),
            db=db_session,
            current_user=_caller(draft, permissions),
        )


async def test_a_training_manager_reads_a_training_drafts_session(db_session, draft):
    """training.manage administers every Training event, drafts included, and
    was told "No training details" on one whose details were attached."""
    assert await _session_read(db_session, draft, ["training.manage"]) == "payload"


async def test_a_training_manager_does_not_read_another_types_draft(db_session, draft):
    await db_session.execute(
        text("UPDATE events SET event_type = 'business_meeting' WHERE id = :id"),
        {"id": draft["event"]},
    )

    assert await _session_read(db_session, draft, ["training.manage"]) is None
