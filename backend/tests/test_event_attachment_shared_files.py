"""Reference-aware attachment deletion tests (no DB).

Recurring-occurrence generation and event duplication copy attachment
metadata — including file_path — across events. Deleting an attachment
from one occurrence must not remove a file that other events (or another
attachment on the same event) still reference (raised in review of
PRs #1452/#1456).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import app.api.v1.endpoints.events as events_endpoint
from app.api.v1.endpoints.events import delete_event_attachment

ORG_ID = str(uuid4())
FILE_PATH = f"{events_endpoint.ATTACHMENT_UPLOAD_DIR}/{ORG_ID}/shared-file.pdf"


def _event(attachments):
    return SimpleNamespace(
        id=str(uuid4()),
        organization_id=ORG_ID,
        attachments=attachments,
        updated_at=None,
    )


def _db(event, other_reference_count):
    event_result = MagicMock(scalar_one_or_none=MagicMock(return_value=event))
    count_result = MagicMock(scalar=MagicMock(return_value=other_reference_count))
    return SimpleNamespace(
        execute=AsyncMock(side_effect=[event_result, count_result]),
        commit=AsyncMock(),
    )


def _user():
    return SimpleNamespace(id=str(uuid4()), organization_id=ORG_ID)


@pytest.fixture
def removed_paths(monkeypatch):
    removed = []
    monkeypatch.setattr(events_endpoint.os.path, "exists", lambda p: True)
    monkeypatch.setattr(events_endpoint.os, "remove", removed.append)
    return removed


async def test_deletes_file_when_no_other_event_references_it(removed_paths):
    event = _event([{"id": "att-1", "file_path": FILE_PATH}])
    db = _db(event, other_reference_count=0)

    await delete_event_attachment(uuid4(), "att-1", db, _user())

    assert removed_paths == [FILE_PATH]
    assert event.attachments == []
    db.commit.assert_awaited_once()


async def test_keeps_file_shared_with_sibling_occurrences(removed_paths):
    event = _event([{"id": "att-1", "file_path": FILE_PATH}])
    db = _db(event, other_reference_count=2)

    await delete_event_attachment(uuid4(), "att-1", db, _user())

    # Metadata removed from this event; the shared file stays on disk.
    assert removed_paths == []
    assert event.attachments == []
    db.commit.assert_awaited_once()


async def test_keeps_file_still_referenced_by_this_event(removed_paths):
    event = _event(
        [
            {"id": "att-1", "file_path": FILE_PATH},
            {"id": "att-2", "file_path": FILE_PATH},
        ]
    )
    db = _db(event, other_reference_count=0)

    await delete_event_attachment(uuid4(), "att-1", db, _user())

    assert removed_paths == []
    assert [a["id"] for a in event.attachments] == ["att-2"]


async def test_never_removes_files_outside_the_upload_tree(removed_paths):
    outside = "/etc/passwd"
    event = _event([{"id": "att-1", "file_path": outside}])
    db = _db(event, other_reference_count=0)

    await delete_event_attachment(uuid4(), "att-1", db, _user())

    assert removed_paths == []
    assert event.attachments == []
