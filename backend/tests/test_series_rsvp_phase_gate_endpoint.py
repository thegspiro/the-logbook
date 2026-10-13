"""EV-23: POST /events/{id}/rsvp-series answers an ahead-of-phase series with a
409 listing every such session, and passes ``override`` through on the retry.

The endpoint is called directly with the service patched; the gate itself is
covered in test_event_rsvp_waitlist.py. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.events import rsvp_to_series
from app.schemas.event import RSVPCreate
from app.services.event_service import SeriesPhaseGateWarning

pytestmark = pytest.mark.unit

_SERVICE = "app.api.v1.endpoints.events.EventService.rsvp_to_series"


def _db():
    event = SimpleNamespace(id="e1", recurrence_parent_id="parent-1")
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=event))
    )
    return db


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1")


_OCCURRENCES = [
    {
        "event_id": "e2",
        "title": "Live burn",
        "start_datetime": "2026-11-08T23:00:00+00:00",
        "message": "This session is part of Phase 3 (Live Fire).",
    },
    {
        "event_id": "e3",
        "title": "RIT",
        "start_datetime": "2026-11-15T23:00:00+00:00",
        "message": "This session is part of Phase 4 (RIT).",
    },
]


async def test_ahead_of_phase_series_is_a_409_listing_every_session():
    with patch(
        _SERVICE, new=AsyncMock(side_effect=SeriesPhaseGateWarning(_OCCURRENCES))
    ):
        with pytest.raises(HTTPException) as exc:
            await rsvp_to_series(
                event_id="e1",
                rsvp_data=RSVPCreate(status="going"),
                override=False,
                db=_db(),
                current_user=_user(),
            )
    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["warning_type"] == "phase_gate"
    assert detail["message"].startswith("2 sessions are in this series")
    assert detail["occurrences"] == _OCCURRENCES


async def test_override_is_passed_to_the_service():
    with patch(_SERVICE, new=AsyncMock(return_value=4)) as service:
        out = await rsvp_to_series(
            event_id="e1",
            rsvp_data=RSVPCreate(status="going"),
            override=True,
            db=_db(),
            current_user=_user(),
        )
    assert out.rsvp_count == 4
    assert service.await_args.kwargs["override"] is True
    assert service.await_args.kwargs["parent_event_id"] == "parent-1"
