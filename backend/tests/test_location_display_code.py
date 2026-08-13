"""
Tests for kiosk display code rotation and facility-room code exposure.

LocationService.regenerate_display_code rotates the public code that gates
unauthenticated kiosk access at /display/{code}; FacilitiesService
_attach_display_codes surfaces each room's linked Location code on room
responses. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.facilities_service import FacilitiesService
from app.services.location_service import LocationService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


class TestRegenerateDisplayCode:
    async def test_rotates_code_and_commits(self):
        location = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            display_code="OLDCODE1",
        )
        # Result order: org-scoped location fetch, then the uniqueness
        # check for the freshly generated code (no collision).
        db = RecordingSession([_one(location), _one(None)])
        svc = LocationService(db)

        result = await svc.regenerate_display_code(uuid4(), "org-1")

        assert result is location
        assert location.display_code != "OLDCODE1"
        assert len(location.display_code) == 8
        db.commit.assert_awaited_once()
        db.refresh.assert_awaited_once_with(location)

    async def test_missing_location_returns_none_without_commit(self):
        db = RecordingSession([_one(None)])
        svc = LocationService(db)

        result = await svc.regenerate_display_code(uuid4(), "org-1")

        assert result is None
        db.commit.assert_not_awaited()


class TestAttachDisplayCodes:
    async def test_attaches_codes_from_linked_locations(self):
        room_with_code = SimpleNamespace(id="room-1")
        room_without_code = SimpleNamespace(id="room-2")
        location_rows = [
            SimpleNamespace(facility_room_id="room-1", display_code="ABC12345"),
        ]
        db = RecordingSession([location_rows])
        svc = FacilitiesService(db)

        await svc._attach_display_codes([room_with_code, room_without_code], "org-1")

        assert room_with_code.display_code == "ABC12345"
        assert room_without_code.display_code is None

    async def test_empty_room_list_skips_query(self):
        db = RecordingSession([])
        svc = FacilitiesService(db)

        await svc._attach_display_codes([], "org-1")

        assert db.statements == []
