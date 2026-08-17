"""
Kiosk display-code redaction tests (no DB).

A location's display_code is a bearer credential for the unauthenticated
public kiosk endpoints (/api/public/v1/display/{code}). GET /locations only
requires authentication, so the endpoint layer must redact the code for
callers below the manager/editor bar — otherwise any member can enumerate
the exact kiosk URLs the manager-gated QR directory protects (raised in
review of PR #1411).
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.api.dependencies import can_view_kiosk_display_codes
from app.api.v1.endpoints.locations import (
    _location_to_list_item,
    _location_to_response,
)
from app.services.facilities_service import FacilitiesService


def _user_with(*permissions: str) -> SimpleNamespace:
    return SimpleNamespace(
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _location(**overrides) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    base = dict(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        name="Training Room",
        description=None,
        address=None,
        city=None,
        state=None,
        zip=None,
        latitude=None,
        longitude=None,
        building=None,
        floor=None,
        room_number=None,
        capacity=None,
        is_active=True,
        facility_id=None,
        facility_room_id=None,
        display_code="ABC12345",
        created_by=None,
        created_at=now,
        updated_at=now,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestCanViewKioskDisplayCodes:
    def test_managers_and_location_editors_may_read_codes(self):
        for perm in ("locations.manage", "facilities.manage", "locations.edit"):
            assert can_view_kiosk_display_codes(_user_with(perm)), perm

    def test_wildcards_are_honored(self):
        assert can_view_kiosk_display_codes(_user_with("locations.*"))
        assert can_view_kiosk_display_codes(_user_with("*"))

    def test_ordinary_members_and_viewers_may_not(self):
        assert not can_view_kiosk_display_codes(_user_with())
        assert not can_view_kiosk_display_codes(
            _user_with("locations.view", "facilities.view", "apparatus.view")
        )


class TestLocationResponseRedaction:
    def test_list_item_redacts_code_for_non_managers(self):
        loc = _location()
        assert (
            _location_to_list_item(loc, include_display_code=False).display_code is None
        )
        assert (
            _location_to_list_item(loc, include_display_code=True).display_code
            == "ABC12345"
        )

    def test_detail_response_redacts_code_for_non_managers(self):
        loc = _location()
        assert (
            _location_to_response(loc, include_display_code=False).display_code is None
        )
        assert (
            _location_to_response(loc, include_display_code=True).display_code
            == "ABC12345"
        )


class TestFacilityRoomCodeAttachment:
    async def test_list_rooms_skips_code_attachment_when_excluded(self):
        room = SimpleNamespace(id="room-1")
        rooms_result = MagicMock(
            scalars=MagicMock(
                return_value=MagicMock(all=MagicMock(return_value=[room]))
            )
        )
        db = SimpleNamespace(
            execute=AsyncMock(return_value=rooms_result),
            commit=AsyncMock(),
        )
        svc = FacilitiesService(db)

        result = await svc.list_rooms("org-1", include_display_codes=False)

        assert result == [room]
        # Only the room query ran — no Location code lookup, and the
        # transient display_code attribute was never set.
        assert db.execute.await_count == 1
        assert not hasattr(room, "display_code")
