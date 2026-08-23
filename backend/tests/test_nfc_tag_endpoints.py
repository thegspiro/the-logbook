"""NFC ID card endpoint authorization and response-shape regressions.

Three separate gates guard these routes, and each is here because losing it
would be quiet rather than loud:

* the **organization switch** — cards are an opt-in integration, enforced on
  the server rather than by hiding a screen, because a hidden screen leaves its
  endpoints reachable and these endpoints issue credentials;
* **card issuing** vs **station operation** as distinct permissions — handing
  somebody a credential is not the same act as recording attendance with one;
* **no self-service** — the surface that lets a member see their own card is
  the surface a later change turns into one that lets them register one.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.nfc_tags import router
from app.core.database import get_db
from app.schemas.nfc_tag import NfcCheckInStatus, NfcTagCreate

CHECK_IN_BODY = {
    "tag_uid": "04A2245B7C1180",
    "target_type": "shift",
    "target_id": "shift-1",
}
ISSUE_BODY = {"user_id": "u1", "tag_uid": "04A2245B7C1180"}


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


class TestPermissionGates:
    def test_issuing_a_card_needs_its_own_grant(self):
        assert _permission_set("", "POST") == {"members.manage_id_cards"}

    def test_revoking_a_card_needs_the_same_grant(self):
        assert _permission_set("/{tag_id}", "PATCH") == {"members.manage_id_cards"}
        assert _permission_set("/{tag_id}", "DELETE") == {"members.manage_id_cards"}

    def test_listing_cards_is_not_open_to_the_directory(self):
        """A card list is a credential inventory, not a member roster."""
        permissions = _permission_set("", "GET")
        assert permissions == {"members.manage_id_cards"}
        assert "members.view" not in permissions

    def test_running_a_station_does_not_require_editing_the_shift(self):
        permissions = _permission_set("/check-in", "POST")
        assert permissions == {"members.check_in"}
        assert "scheduling.manage" not in permissions
        assert "events.manage" not in permissions

    def test_every_route_is_staff_only(self):
        """There is no member-facing route here at all, read-only included."""
        for route in router.routes:
            gated = any(
                getattr(dependency.call, "required_permissions", None)
                for dependency in route.dependant.dependencies
            )
            assert gated, f"{route.path} has no permission gate"

    def test_no_route_is_addressed_to_the_calling_member(self):
        """`/me` is the shape a self-service path takes; there must not be one."""
        paths = {route.path for route in router.routes}
        assert "/me" not in paths
        assert "/mine" not in paths


class TestSchemaGuards:
    def test_a_credential_of_only_separators_is_rejected(self):
        """It normalizes to '' — every such card would hash alike, so the
        first one registered would answer for all of them."""
        with pytest.raises(ValueError, match="too short"):
            NfcTagCreate(user_id="u1", tag_uid="::::")

    def test_a_serial_is_accepted_in_any_reader_spelling(self):
        for spelling in ("04A2245B7C1180", "04:a2:24:5b:7c:11:80", "04-A2-24-5B"):
            assert NfcTagCreate(user_id="u1", tag_uid=spelling).tag_uid == spelling

    def test_a_code_written_onto_a_blank_tag_is_accepted(self):
        """Blank NTAG stickers carry no useful serial of their own, so the
        officer writes one — the pattern has to admit an alphanumeric code."""
        created = NfcTagCreate(
            user_id="u1",
            tag_uid="LBC1-9F2A4C7E1B3D5A80",
            credential_type="written",
        )
        assert created.credential_type.value == "written"

    def test_a_card_defaults_to_the_chip_serial(self):
        assert NfcTagCreate(user_id="u1", tag_uid="04A2245B").credential_type.value == (
            "serial"
        )

    def test_the_card_response_never_carries_the_credential(self):
        """A response field for the raw value would undo storing it hashed."""
        from app.schemas.nfc_tag import NfcTagResponse

        fields = set(NfcTagResponse.model_fields)
        assert "uid_hash" not in fields
        assert "tag_uid" not in fields
        assert "uid_preview" in fields


def _user(permissions=("*",)):
    return SimpleNamespace(
        id="admin-1",
        organization_id="org-1",
        username="chief",
        full_name="Chief Ellis",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(current_user):
    """Wire the router with the *real* permission checker over a stub user.

    Overriding the checker would not work — `require_permission` builds a fresh
    instance per call site, so an override keyed on a new one never matches the
    route's — and would stop the gates above from being exercised at all.
    """
    app = FastAPI()
    app.include_router(router, prefix="/nfc-tags")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return app


async def _integration_off(*_args, **_kwargs):
    raise HTTPException(status_code=403, detail="NFC ID cards are not enabled")


def _switch(*, on: bool):
    """Stand in for the org-level NFC ID Cards integration switch."""
    return patch(
        "app.api.v1.endpoints.nfc_tags.require_nfc_id_cards",
        AsyncMock() if on else AsyncMock(side_effect=_integration_off),
    )


async def _post(app, path: str, body: dict) -> object:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post(path, json=body)


class TestOrganizationSwitch:
    async def test_a_station_is_refused_while_cards_are_turned_off(self):
        """Hiding the screen is not the control — the endpoint is."""
        with _switch(on=False):
            response = await _post(
                _app_for(_user()), "/nfc-tags/check-in", CHECK_IN_BODY
            )
        assert response.status_code == 403

    async def test_a_card_cannot_be_issued_while_cards_are_turned_off(self):
        with _switch(on=False):
            response = await _post(_app_for(_user()), "/nfc-tags", ISSUE_BODY)
        assert response.status_code == 403

    async def test_the_switch_is_checked_before_anything_is_written(self):
        """A refusal must not leave a half-registered credential behind."""
        service = AsyncMock()
        with _switch(on=False), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ):
            await _post(_app_for(_user()), "/nfc-tags", ISSUE_BODY)
        service.register_tag.assert_not_called()


class TestGateIsEnforcedNotJustDeclared:
    async def test_a_member_without_the_grant_cannot_run_a_station(self):
        """Checking somebody else in is not something every member may do."""
        user = _user(permissions=("members.view", "scheduling.view"))
        with _switch(on=True):
            response = await _post(_app_for(user), "/nfc-tags/check-in", CHECK_IN_BODY)
        assert response.status_code == 403

    async def test_a_station_operator_cannot_issue_cards(self):
        """The two grants are separate so that running a door does not become
        the ability to hand somebody a working credential."""
        user = _user(permissions=("members.check_in",))
        with _switch(on=True):
            response = await _post(_app_for(user), "/nfc-tags", ISSUE_BODY)
        assert response.status_code == 403


class TestStationEndpoint:
    async def test_an_unregistered_card_comes_back_as_a_drawable_200(self):
        """A kiosk that throws is a kiosk somebody has to walk over and restart.

        Every domain outcome is a screen the station has to render, so it
        arrives as a normal response carrying `status`.
        """
        service = AsyncMock()
        service.check_in = AsyncMock(
            return_value={
                "status": NfcCheckInStatus.UNKNOWN_CARD,
                "message": "This card is not registered.",
                "target_name": None,
                "occurred_at": None,
                "duration_minutes": None,
            }
        )

        with _switch(on=True), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ), patch("app.api.v1.endpoints.nfc_tags.log_audit_event", AsyncMock()):
            response = await _post(
                _app_for(_user()), "/nfc-tags/check-in", CHECK_IN_BODY
            )

        assert response.status_code == 200
        assert response.json()["status"] == "unknown_card"

    async def test_a_target_that_does_not_exist_is_a_404(self):
        """That one really is a caller error, not something to draw."""
        service = AsyncMock()
        service.check_in = AsyncMock(side_effect=ValueError("Shift not found"))

        with _switch(on=True), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ):
            response = await _post(
                _app_for(_user()),
                "/nfc-tags/check-in",
                {**CHECK_IN_BODY, "target_id": "nope"},
            )

        assert response.status_code == 404

    async def test_only_a_recorded_tap_is_audited(self):
        """An unrecognised card waved at a reader is not an attendance event."""
        service = AsyncMock()
        service.check_in = AsyncMock(
            return_value={
                "status": NfcCheckInStatus.UNKNOWN_CARD,
                "message": "This card is not registered.",
                "target_name": None,
                "occurred_at": None,
                "duration_minutes": None,
            }
        )
        audit = AsyncMock()

        with _switch(on=True), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ), patch("app.api.v1.endpoints.nfc_tags.log_audit_event", audit):
            await _post(_app_for(_user()), "/nfc-tags/check-in", CHECK_IN_BODY)

        audit.assert_not_called()

    async def test_a_recorded_check_in_is_audited_and_names_the_member(self):
        service = AsyncMock()
        service.check_in = AsyncMock(
            return_value={
                "status": NfcCheckInStatus.CHECKED_IN,
                "message": "Checked in to E4.",
                "target_name": "E4",
                "user_id": "u1",
                "member_name": "Dana Ruiz",
                "membership_number": "1042",
                "occurred_at": None,
                "duration_minutes": None,
            }
        )
        audit = AsyncMock()

        with _switch(on=True), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ), patch("app.api.v1.endpoints.nfc_tags.log_audit_event", audit):
            response = await _post(
                _app_for(_user()),
                "/nfc-tags/check-in",
                {**CHECK_IN_BODY, "direction": "auto"},
            )

        assert response.status_code == 200
        # Responses are camelCase; requests are snake_case. Both halves of that
        # contract have broken before (Pitfall #5), so both are asserted.
        assert response.json()["memberName"] == "Dana Ruiz"
        audit.assert_called_once()
        assert audit.call_args.kwargs["event_type"] == "nfc_station_check_in"

    async def test_a_written_code_is_forwarded_alongside_the_serial(self):
        """A rewritten blank tag's serial may belong to its previous holder."""
        service = AsyncMock()
        service.check_in = AsyncMock(
            return_value={
                "status": NfcCheckInStatus.CHECKED_IN,
                "message": "Checked in.",
                "target_name": "E4",
                "user_id": "u1",
                "member_name": "Dana Ruiz",
                "membership_number": "1042",
                "occurred_at": None,
                "duration_minutes": None,
            }
        )

        with _switch(on=True), patch(
            "app.api.v1.endpoints.nfc_tags.NfcTagService", return_value=service
        ), patch("app.api.v1.endpoints.nfc_tags.log_audit_event", AsyncMock()):
            await _post(
                _app_for(_user()),
                "/nfc-tags/check-in",
                {**CHECK_IN_BODY, "tag_payload": "LBC1-9F2A4C7E"},
            )

        assert service.check_in.call_args.kwargs["tag_payload"] == "LBC1-9F2A4C7E"
