"""An unpublished (draft) event stays hidden on the side paths too.

ADV-5 made ``GET /events/{id}`` answer 404 to a non-organizer for a draft, and
EV-6 refused an RSVP to one. Four other paths still served or acted on a
draft to anyone holding its id: the QR check-in payload (title, description,
location, times), self-check-in (which creates a checked-in RSVP), the event's
document folder (named after the title) and the event's training session.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints import training_sessions as sessions_endpoint
from app.api.v1.endpoints.events import (
    get_event,
    get_event_folder,
    list_event_attachments,
    list_events,
)
from app.models.event import EventRSVP
from app.models.training import TrainingSession, TrainingType
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


async def _drill_session(db_session, draft) -> str:
    """A training session on the draft event, as the calendar lists it."""
    session = TrainingSession(
        organization_id=draft["org"],
        event_id=draft["event"],
        course_name="Ladder Drill",
        training_type=TrainingType.SKILLS_PRACTICE,
        credit_hours=2.0,
    )
    db_session.add(session)
    await db_session.flush()
    return str(session.id)


async def _calendar(db_session, draft, permissions) -> set:
    items = await sessions_endpoint.list_training_sessions_calendar(
        start_after=None,
        start_before=None,
        training_type=None,
        include_finalized=True,
        pagination=PaginationParams(skip=0, limit=100),
        db=db_session,
        current_user=_caller(draft, permissions),
    )
    return {item["session_id"] for item in items["sessions"]}


@pytest.mark.parametrize(
    ("permissions", "listed"),
    [
        ((), False),
        (["training.view"], False),
        (["training.manage"], True),
        (["events.manage"], True),
    ],
)
async def test_the_training_calendar_shows_a_draft_only_to_its_managers(
    db_session, draft, permissions, listed
):
    """Owner decision 2026-11-23: the calendar listed a draft Training
    event's title and time to every member, which GET /events/{id} hides."""
    session_id = await _drill_session(db_session, draft)

    assert (session_id in await _calendar(db_session, draft, permissions)) is listed


async def test_a_training_manager_does_not_see_another_types_draft_on_the_calendar(
    db_session, draft
):
    """A session kept on an event re-typed away from Training: its draft is
    an events manager's, as the event itself is."""
    session_id = await _drill_session(db_session, draft)
    await db_session.execute(
        text("UPDATE events SET event_type = 'business_meeting' WHERE id = :id"),
        {"id": draft["event"]},
    )

    assert session_id not in await _calendar(db_session, draft, ["training.manage"])
    assert session_id in await _calendar(db_session, draft, ["events.manage"])


async def test_the_training_dashboard_follows_the_same_draft_rule(db_session, draft):
    """The dashboard's upcoming-capacity list reads the calendar's join, so
    it keeps the calendar's rule: a training manager does not see another
    type's draft that kept a session."""
    session_id = await _drill_session(db_session, draft)
    await db_session.execute(
        text(
            "UPDATE events SET event_type = 'business_meeting', max_attendees = 10, "
            "start_datetime = :start, end_datetime = :end WHERE id = :id"
        ),
        {
            "id": draft["event"],
            "start": datetime.now(timezone.utc) + timedelta(days=2),
            "end": datetime.now(timezone.utc) + timedelta(days=2, hours=2),
        },
    )

    summary = await training_endpoints.get_training_dashboard_summary(
        expiration_days=90,
        db=db_session,
        current_user=_caller(draft, ["training.manage"]),
    )

    listed = {row["session_id"] for row in summary["upcoming_session_capacity"]}
    assert session_id not in listed


async def _retype(db_session, draft, event_type: str) -> None:
    await db_session.execute(
        text("UPDATE events SET event_type = :t WHERE id = :id"),
        {"t": event_type, "id": draft["event"]},
    )


@pytest.mark.parametrize(
    ("event_type", "permissions", "opens"),
    [
        ("training", ["training.manage"], True),
        ("business_meeting", ["training.manage"], False),
        ("training", ["events.view"], False),
        ("business_meeting", ["events.manage"], True),
    ],
)
async def test_a_draft_opens_for_whoever_may_see_it(
    db_session, draft, event_type, permissions, opens
):
    """Owner decision 2026-11-23: training.manage opens a Training draft,
    which it administers; any other type's draft stays the events manager's."""
    await _retype(db_session, draft, event_type)
    caller = _caller(draft, permissions)

    if opens:
        event = await get_event(
            uuid.UUID(draft["event"]), db=db_session, current_user=caller
        )
        assert str(event.id) == draft["event"]
    else:
        with pytest.raises(HTTPException) as exc:
            await get_event(
                uuid.UUID(draft["event"]), db=db_session, current_user=caller
            )
        assert exc.value.status_code == 404


@pytest.mark.parametrize(
    ("event_type", "listed"), [("training", True), ("business_meeting", False)]
)
async def test_a_training_manager_lists_training_drafts_only(
    db_session, draft, event_type, listed
):
    await _retype(db_session, draft, event_type)
    items = await list_events(
        event_type=None,
        custom_category=None,
        exclude_event_types=None,
        start_after=None,
        start_before=None,
        end_after=None,
        end_before=None,
        include_cancelled=False,
        include_drafts=True,
        mandatory_only=False,
        recurrence_series_id=None,
        skip=0,
        limit=100,
        db=db_session,
        current_user=_caller(draft, ["training.manage"]),
    )

    assert (draft["event"] in {str(item.id) for item in items}) is listed


async def test_a_training_manager_reads_a_training_drafts_folder_and_attachments(
    db_session, draft
):
    """The event page loads both; a Training draft that opens must not 404
    on them."""
    caller = _caller(draft, ["training.manage", "events.view"])

    assert (
        await list_event_attachments(
            uuid.UUID(draft["event"]), db=db_session, current_user=caller
        )
        is not None
    )
    folder = await get_event_folder(
        uuid.UUID(draft["event"]), db=db_session, current_user=caller
    )
    assert folder is not None
