"""PATCH /events/{id} for an event that does not exist is a 404, not a 500.

``EventService.get_event`` answers a missing event with ``(None, None)``. The
update endpoint snapshots the old values of a significant edit (title, times,
location) through it and tested the *tuple* for truth — a non-empty tuple is
always truthy — so an edit to an unknown id went on to read ``.rsvps`` off
``None`` and surfaced as a 500 instead of the 404 the update itself reports.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import events
from app.schemas.event import EventUpdate

pytestmark = pytest.mark.unit


def _user():
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        username="officer",
        positions=[],
        rank=None,
    )


@pytest.mark.parametrize(
    "change",
    [
        {"title": "Renamed drill"},
        {"location": "Station 2"},
        # Not a significant field: never touched the snapshot, so it was
        # already a 404 and must stay one.
        {"description": "Bring gloves"},
    ],
)
async def test_patching_an_unknown_event_is_a_404(change):
    service = MagicMock()
    service.get_event = AsyncMock(return_value=(None, None))
    service.update_event = AsyncMock(return_value=None)

    with patch.object(events, "EventService", return_value=service):
        with pytest.raises(HTTPException) as exc:
            await events.update_event(
                event_id=uuid4(),
                event_data=EventUpdate(**change),
                db=MagicMock(),
                current_user=_user(),
            )

    assert exc.value.status_code == 404
    assert exc.value.detail == "Event not found"
