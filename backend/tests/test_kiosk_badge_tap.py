"""Member ID card taps at a room's public kiosk.

The one unauthenticated write that acts for a member, so each safeguard the
owner approved on 2026-10-02 is pinned here:

* **off by default, per room** — the room's own switch and the NFC ID Cards
  integration must both be on, checked on every tap;
* **the room decides the event** — exactly one open event, refused on overlap
  unless the member is checked in to exactly one of them (a check-out);
* **in, or out when already in** — the station's AUTO direction;
* **minimal display** — first name and last initial, never an id, full name
  or membership number;
* **audited** — every tap that moves attendance, with the room and caller IP.

LocationService, the NFC integration switch and the rate limiter are mocked;
no database.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import app.api.public.display as display
import app.services.nfc_tag_service as nfc_service_module
from app.models.user import UserStatus
from app.schemas.nfc_tag import (
    KioskBadgeTapRequest,
    KioskBadgeTapResponse,
    NfcCheckInDirection,
    NfcCheckInStatus,
    NfcCheckInTarget,
)
from app.services.nfc_tag_service import NfcTagService

pytestmark = pytest.mark.unit

ORG = "org-1"
ROOM_ID = "6f1c2a4e-1d3b-4c5a-9e7f-0a1b2c3d4e5f"
TAP = KioskBadgeTapRequest(tag_uid="04A2245B7C1180")


def _event(event_id: str, title: str = "Monthly Drill"):
    return SimpleNamespace(id=event_id, title=title)


def _location(enabled: bool = True):
    return SimpleNamespace(
        id=ROOM_ID,
        organization_id=ORG,
        name="Training Room",
        nfc_badge_check_in_enabled=enabled,
    )


def _patch_events(monkeypatch, events):
    fake = SimpleNamespace(
        get_current_events_in_check_in_window=AsyncMock(return_value=events)
    )
    monkeypatch.setattr(nfc_service_module, "LocationService", lambda db: fake)
    return fake


def _checked_in(member_name="Alex Tester"):
    return {
        "status": NfcCheckInStatus.CHECKED_IN,
        "message": "Checked in to Monthly Drill.",
        "target_name": "Monthly Drill",
        "occurred_at": datetime.now(timezone.utc),
        "duration_minutes": None,
        "user_id": "u-1",
        "member_name": member_name,
        "membership_number": "FF-0042",
    }


# ---------------------------------------------------------------------------
# Service — which event, which direction, what is shown
# ---------------------------------------------------------------------------


class TestKioskCheckIn:
    async def test_no_open_event_is_refused_without_touching_attendance(
        self, monkeypatch
    ):
        _patch_events(monkeypatch, [])
        service = NfcTagService(MagicMock())
        service.check_in = AsyncMock()

        result = await service.kiosk_check_in(location=_location(), tag_uid="04A2")

        assert result["status"] == NfcCheckInStatus.REFUSED
        assert "No event in this room" in result["message"]
        service.check_in.assert_not_called()

    async def test_one_open_event_toggles_in_or_out_on_it(self, monkeypatch):
        _patch_events(monkeypatch, [_event("evt-1")])
        service = NfcTagService(MagicMock())
        service.check_in = AsyncMock(return_value=_checked_in())

        result = await service.kiosk_check_in(
            location=_location(), tag_uid="04A2", tag_payload="LBC1-ABC"
        )

        service.check_in.assert_awaited_once_with(
            organization_id=ORG,
            tag_uid="04A2",
            tag_payload="LBC1-ABC",
            target_type=NfcCheckInTarget.EVENT,
            target_id="evt-1",
            direction=NfcCheckInDirection.AUTO,
        )
        assert result["status"] == NfcCheckInStatus.CHECKED_IN
        assert result["event_id"] == "evt-1"

    async def test_overlap_is_refused_for_a_member_checked_in_to_neither(
        self, monkeypatch
    ):
        _patch_events(monkeypatch, [_event("evt-1"), _event("evt-2")])
        service = NfcTagService(MagicMock())
        service.check_in = AsyncMock()
        service._only_event_checked_into = AsyncMock(return_value=None)

        result = await service.kiosk_check_in(location=_location(), tag_uid="04A2")

        assert result["status"] == NfcCheckInStatus.REFUSED
        assert "More than one event" in result["message"]
        service.check_in.assert_not_called()

    async def test_overlap_checks_a_member_out_of_the_one_they_are_in(
        self, monkeypatch
    ):
        events = [_event("evt-1"), _event("evt-2")]
        _patch_events(monkeypatch, events)
        service = NfcTagService(MagicMock())
        service.check_in = AsyncMock(return_value=_checked_in())
        service._only_event_checked_into = AsyncMock(return_value=events[1])

        await service.kiosk_check_in(location=_location(), tag_uid="04A2")

        assert service.check_in.await_args.kwargs["target_id"] == "evt-2"

    async def test_the_result_names_the_member_by_first_name_and_initial(
        self, monkeypatch
    ):
        _patch_events(monkeypatch, [_event("evt-1")])
        service = NfcTagService(MagicMock())
        service.check_in = AsyncMock(return_value=_checked_in("Mary Ann Smith"))

        result = await service.kiosk_check_in(location=_location(), tag_uid="04A2")

        assert result["member_display_name"] == "Mary S."
        assert "member_name" not in result
        assert "membership_number" not in result

    @pytest.mark.parametrize(
        ("full_name", "shown"), [("Cher", "Cher"), ("", None), (None, None)]
    )
    def test_display_name_edge_cases(self, full_name, shown):
        result = NfcTagService._kiosk_result(
            {
                "status": NfcCheckInStatus.CHECKED_IN,
                "message": "ok",
                "member_name": full_name,
            }
        )
        assert result["member_display_name"] == shown


class TestOnlyEventCheckedInto:
    def _service(self, rsvps):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=rsvps))
                )
            )
        )
        service = NfcTagService(db)
        member = SimpleNamespace(id="u-1", status=UserStatus.ACTIVE)
        service.resolve_tag = AsyncMock(return_value=(object(), member, None))
        return service

    async def test_exactly_one_open_check_in_names_that_event(self):
        events = [_event("evt-1"), _event("evt-2")]
        service = self._service([SimpleNamespace(event_id="evt-2")])
        assert (
            await service._only_event_checked_into(ORG, events, ("04A2",)) is events[1]
        )

    async def test_checked_in_to_both_is_still_ambiguous(self):
        events = [_event("evt-1"), _event("evt-2")]
        service = self._service(
            [SimpleNamespace(event_id="evt-1"), SimpleNamespace(event_id="evt-2")]
        )
        assert await service._only_event_checked_into(ORG, events, ("04A2",)) is None

    async def test_an_unknown_card_says_nothing_about_attendance(self):
        service = NfcTagService(MagicMock())
        service.resolve_tag = AsyncMock(
            return_value=(None, None, NfcCheckInStatus.UNKNOWN_CARD)
        )
        result = await service._only_event_checked_into(
            ORG, [_event("evt-1"), _event("evt-2")], ("04A2",)
        )
        assert result is None


# ---------------------------------------------------------------------------
# Endpoint — the gates in front of the service
# ---------------------------------------------------------------------------


def _request(ip="203.0.113.7"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": (ip, 1234),
            "query_string": b"",
        }
    )


@pytest.fixture
def endpoint(monkeypatch):
    """Wire the endpoint's collaborators; tests flip what they need."""
    state = SimpleNamespace(
        location=_location(),
        integration_on=True,
        result=NfcTagService._kiosk_result({**_checked_in(), "event_id": "evt-1"}),
        audit=AsyncMock(),
        kiosk_check_in=AsyncMock(),
    )
    monkeypatch.setattr(
        display, "public_rate_limit", AsyncMock(return_value=(False, None))
    )
    monkeypatch.setattr(
        display,
        "LocationService",
        lambda db: SimpleNamespace(
            get_location_by_display_code=AsyncMock(
                side_effect=lambda code: state.location
            )
        ),
    )
    monkeypatch.setattr(
        display,
        "nfc_id_cards_enabled",
        AsyncMock(side_effect=lambda db, org: state.integration_on),
    )
    state.kiosk_check_in.side_effect = lambda **kwargs: state.result
    monkeypatch.setattr(
        display,
        "NfcTagService",
        lambda db: SimpleNamespace(kiosk_check_in=state.kiosk_check_in),
    )
    monkeypatch.setattr(display, "log_audit_event", state.audit)
    return state


async def _tap(code="ROOM1CODE"):
    return await display.kiosk_badge_tap(code, TAP, _request(), db=MagicMock())


class TestBadgeTapEndpoint:
    async def test_a_malformed_code_404s_before_any_lookup(self, endpoint):
        with pytest.raises(HTTPException) as exc:
            await _tap("bad code!")
        assert exc.value.status_code == 404
        endpoint.kiosk_check_in.assert_not_called()

    async def test_an_unknown_display_404s(self, endpoint):
        endpoint.location = None
        with pytest.raises(HTTPException) as exc:
            await _tap()
        assert exc.value.status_code == 404

    async def test_a_room_with_badge_taps_off_refuses(self, endpoint):
        endpoint.location = _location(enabled=False)
        with pytest.raises(HTTPException) as exc:
            await _tap()
        assert exc.value.status_code == 403
        endpoint.kiosk_check_in.assert_not_called()

    async def test_the_integration_switched_off_refuses_even_an_enabled_room(
        self, endpoint
    ):
        endpoint.integration_on = False
        with pytest.raises(HTTPException) as exc:
            await _tap()
        assert exc.value.status_code == 403
        endpoint.kiosk_check_in.assert_not_called()

    async def test_a_tap_that_moves_attendance_is_audited_with_room_and_ip(
        self, endpoint
    ):
        await _tap()

        endpoint.audit.assert_awaited_once()
        kwargs = endpoint.audit.await_args.kwargs
        assert kwargs["event_type"] == "nfc_kiosk_badge_tap"
        assert kwargs["organization_id"] == ORG
        assert kwargs["ip_address"] == "203.0.113.7"
        assert kwargs["event_data"]["location_id"] == ROOM_ID
        assert kwargs["event_data"]["event_id"] == "evt-1"
        assert kwargs["event_data"]["member_id"] == "u-1"

    async def test_a_refused_tap_is_not_audited(self, endpoint):
        endpoint.result = NfcTagService._kiosk_result(
            {"status": NfcCheckInStatus.UNKNOWN_CARD, "message": "Not registered."}
        )
        response = await _tap()
        assert response.status == NfcCheckInStatus.UNKNOWN_CARD
        endpoint.audit.assert_not_called()

    async def test_the_response_shows_no_more_than_a_first_name_and_initial(
        self, endpoint
    ):
        response = await _tap()
        body = response.model_dump(by_alias=True)

        assert body["memberDisplayName"] == "Alex T."
        for leaked in ("userId", "memberName", "membershipNumber", "eventId"):
            assert leaked not in body

    async def test_the_room_ceiling_is_enforced(self, endpoint, monkeypatch):
        monkeypatch.setattr(
            display, "public_rate_limit", AsyncMock(return_value=(True, None))
        )
        with pytest.raises(HTTPException) as exc:
            await _tap()
        assert exc.value.status_code == 429
        endpoint.kiosk_check_in.assert_not_called()


class TestDisplayReportsTheReader:
    async def _display(self, monkeypatch, enabled, integration_on):
        location = _location(enabled=enabled)
        monkeypatch.setattr(
            display,
            "LocationService",
            lambda db: SimpleNamespace(
                get_location_by_display_code=AsyncMock(return_value=location),
                get_current_events_in_check_in_window=AsyncMock(return_value=[]),
            ),
        )
        integration = AsyncMock(return_value=integration_on)
        monkeypatch.setattr(display, "nfc_id_cards_enabled", integration)
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value="UTC"))
        )
        info = await display.get_public_location_display("ROOM1CODE", db=db)
        return info, integration

    async def test_reader_runs_only_with_both_switches_on(self, monkeypatch):
        info, _ = await self._display(monkeypatch, enabled=True, integration_on=True)
        assert info.badge_check_in_enabled is True

    async def test_room_switch_off_hides_the_reader(self, monkeypatch):
        info, integration = await self._display(
            monkeypatch, enabled=False, integration_on=True
        )
        assert info.badge_check_in_enabled is False
        integration.assert_not_called()

    async def test_integration_off_hides_the_reader(self, monkeypatch):
        info, _ = await self._display(monkeypatch, enabled=True, integration_on=False)
        assert info.badge_check_in_enabled is False


class TestResponseSchema:
    def test_the_public_response_has_no_identifying_fields(self):
        fields = set(KioskBadgeTapResponse.model_fields)
        assert {"user_id", "member_name", "membership_number"}.isdisjoint(fields)
        assert "member_display_name" in fields


# ---------------------------------------------------------------------------
# The room switch
# ---------------------------------------------------------------------------


class TestRoomSwitch:
    def test_only_room_tag_officers_may_flip_it(self):
        from app.api.v1.endpoints.locations import router

        route = next(
            r
            for r in router.routes
            if r.path == "/{location_id}/badge-check-in" and "PUT" in r.methods
        )
        permissions = {
            p
            for dependency in route.dependant.dependencies
            for p in (getattr(dependency.call, "required_permissions", None) or ())
        }
        assert permissions == {"locations.manage_nfc_tags"}

    def test_it_is_not_a_field_on_the_general_location_form(self):
        from app.schemas.location import LocationUpdate

        assert "nfc_badge_check_in_enabled" not in LocationUpdate.model_fields

    async def _set(self, monkeypatch, enabled, integration_on):
        import app.api.v1.endpoints.locations as locations
        from app.schemas.location import LocationBadgeCheckInUpdate

        location = SimpleNamespace(
            id=ROOM_ID,
            organization_id="6f1c2a4e-1d3b-4c5a-9e7f-0a1b2c3d4e60",
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
            display_code="ROOM1CODE",
            nfc_badge_check_in_enabled=enabled,
            created_by=None,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        setter = AsyncMock(return_value=location)
        monkeypatch.setattr(
            locations,
            "LocationService",
            lambda db: SimpleNamespace(set_badge_check_in=setter),
        )
        monkeypatch.setattr(
            locations, "nfc_id_cards_enabled", AsyncMock(return_value=integration_on)
        )
        audit = AsyncMock()
        monkeypatch.setattr(locations, "log_audit_event", audit)
        user = SimpleNamespace(
            id="u-1",
            username="chief",
            organization_id=location.organization_id,
            positions=[SimpleNamespace(permissions=["locations.manage_nfc_tags"])],
            rank=None,
        )
        response = await locations.set_badge_check_in(
            ROOM_ID,
            LocationBadgeCheckInUpdate(enabled=enabled),
            db=MagicMock(),
            current_user=user,
        )
        return response, setter, audit

    async def test_enabling_needs_the_nfc_integration(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            await self._set(monkeypatch, enabled=True, integration_on=False)
        assert exc.value.status_code == 400

    async def test_disabling_is_always_allowed(self, monkeypatch):
        response, setter, _ = await self._set(
            monkeypatch, enabled=False, integration_on=False
        )
        assert setter.await_args.kwargs["enabled"] is False
        assert response.nfc_badge_check_in_enabled is False

    async def test_enabling_is_audited_as_a_warning(self, monkeypatch):
        _, _, audit = await self._set(monkeypatch, enabled=True, integration_on=True)
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "location_badge_check_in_enabled"
        assert kwargs["severity"] == "warning"
