"""The attachment dict the upload writes must survive an EventResponse read.

`EventBase.attachments` was `List[Dict[str, str]]` while the upload handler
writes `file_size` as an int and `description` as `None`. The upload itself
returns 201 — its own response field is `Dict[str, Any]` — so nothing fails at
write time. Every later read does: `_build_event_response` constructs
`EventResponse(...)` directly, so the ValidationError is raised inside the
handler body and escapes the `except ValueError` blocks as an unhandled 500.
The detail page, the edit form, publish, duplicate, cancel and uncancel all
stop working for that event, and deleting the attachment is the only way back.
"""

import ast
import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.schemas.event import (
    EventBase,
    EventResponse,
    EventUpdate,
    RecurringEventCreate,
)

pytestmark = pytest.mark.unit

_EVENTS_ENDPOINT = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "api"
    / "v1"
    / "endpoints"
    / "events.py"
)


def _uploaded_attachment() -> dict:
    """The literal the upload handler appends, with realistic values."""
    return {
        "id": "0f9c2b1a",
        "file_name": "sop.pdf",
        "file_path": "/app/uploads/event-attachments/org-1/sop.pdf",
        "file_size": 20481,
        "file_type": "application/pdf",
        "description": None,
        "uploaded_by": "user-1",
        "uploaded_at": datetime.now().isoformat(),
    }


def test_an_uploaded_attachment_round_trips_through_the_event_schema():
    start = datetime(2026, 9, 1, 10)

    event = EventBase(
        title="Engine drills",
        event_type="training",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        attachments=[_uploaded_attachment()],
    )

    assert event.attachments is not None
    assert event.attachments[0]["file_size"] == 20481
    assert event.attachments[0]["description"] is None


def test_the_response_schema_accepts_it_too():
    start = datetime(2026, 9, 1, 10)

    response = EventResponse(
        id="0f9c2b1a-0000-4000-8000-000000000001",
        organization_id="0f9c2b1a-0000-4000-8000-000000000002",
        title="Engine drills",
        event_type="training",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        status="scheduled",
        created_at=start,
        updated_at=start,
        attachments=[_uploaded_attachment()],
    )

    assert response.attachments is not None
    assert response.attachments[0]["file_size"] == 20481


def test_an_edit_can_echo_back_what_a_read_returned():
    """The PATCH schema takes the same shape or a save round-trip 422s."""
    update = EventUpdate(attachments=[_uploaded_attachment()])

    assert update.attachments is not None
    assert update.attachments[0]["file_size"] == 20481


def test_a_recurring_series_can_carry_one_too():
    start = datetime(2026, 9, 1, 10)

    series = RecurringEventCreate(
        title="Engine drills",
        event_type="training",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        recurrence_pattern="weekly",
        recurrence_end_date=(start + timedelta(days=90)).date(),
        attachments=[_uploaded_attachment()],
    )

    assert series.attachments is not None


def test_the_keys_the_upload_writes_are_the_ones_asserted_here():
    """Pin the fixture to the handler, so a new key cannot go unchecked."""
    source = _EVENTS_ENDPOINT.read_text()
    block = re.search(r"attachments\.append\(\s*(\{.*?\n        \})\s*\)", source, re.S)
    assert block, "attachments.append literal not found in events.py"
    written = {key.value for key in ast.parse(block.group(1)).body[0].value.keys}

    assert written == set(_uploaded_attachment())
