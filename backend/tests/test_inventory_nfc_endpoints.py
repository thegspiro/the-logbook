"""Inventory NFC tag endpoints: the switch, the permission gates, the shapes.

The database behaviour (hashing, uniqueness, org isolation) is in
``test_inventory_nfc_service.py``; these run without a database.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.inventory_nfc import router
from app.core.database import get_db
from app.schemas.inventory_nfc import (
    MAX_AUDIT_TAPS,
    InventoryAuditScheduleUpdate,
    InventoryNfcAuditApply,
    InventoryNfcAuditCreate,
    InventoryNfcMemberResponse,
    InventoryNfcResolveRequest,
    InventoryNfcTagCreate,
    InventoryNfcTagResponse,
)
from app.schemas.nfc_tag import NfcCheckInStatus
from app.schemas.organization import OrganizationSettingsUpdate
from app.utils.inventory_nfc import (
    inventory_nfc_enabled,
    nfc_tracking_enabled_in,
    require_inventory_nfc,
)

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_nfc"


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


def _user(permissions=("*",)):
    return SimpleNamespace(
        id="admin-1",
        organization_id="org-1",
        username="qm",
        full_name="Quarter Master",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(current_user):
    """The real permission checker over a stub user (see test_nfc_tag_endpoints)."""
    app = FastAPI()
    app.include_router(router, prefix="/inventory")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return app


async def _switched_off(*_args, **_kwargs):
    raise HTTPException(status_code=403, detail="NFC tag tracking is not enabled")


def _switch(*, on: bool):
    return patch(
        f"{MODULE}.require_inventory_nfc",
        AsyncMock() if on else AsyncMock(side_effect=_switched_off),
    )


async def _request(app, method: str, path: str, body: dict | None = None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.request(method, path, json=body)


LINK_BODY = {"tag_uid": "04A2245B7C1180"}
RESOLVE_BODY = {"serial_number": "04A2245B7C1180"}

# Every route that acts on tags, with a body that passes validation. The
# settings read is not here: it is how a screen learns the switch is off, so
# it must answer while the switch is off.
GUARDED_CALLS = [
    ("POST", "/inventory/nfc/resolve", RESOLVE_BODY),
    ("GET", "/inventory/items/item-1/nfc-tags", None),
    ("POST", "/inventory/items/item-1/nfc-tags", LINK_BODY),
    ("PATCH", "/inventory/nfc-tags/tag-1", {"label": "Left cuff"}),
    ("DELETE", "/inventory/nfc-tags/tag-1", None),
    ("POST", "/inventory/nfc/resolve-any", RESOLVE_BODY),
    ("POST", "/inventory/nfc/put-away", {"item_id": "i-1", "storage_area_id": "a-1"}),
    ("GET", "/inventory/items/item-1/nfc-scans", None),
    ("GET", "/inventory/storage-areas/area-1/nfc-tags", None),
    ("POST", "/inventory/storage-areas/area-1/nfc-tags", LINK_BODY),
    ("POST", "/inventory/nfc/audits", {"storage_area_id": "a-1", "tapped": []}),
    ("GET", "/inventory/nfc/audits", None),
    ("GET", "/inventory/nfc/audits/audit-1", None),
    ("POST", "/inventory/nfc/audits/audit-1/apply", {"item_ids": ["i-1"]}),
    ("POST", "/inventory/nfc/resolve-member", RESOLVE_BODY),
    ("GET", "/inventory/nfc/untagged", None),
    ("GET", "/inventory/nfc/audit-schedule", None),
    (
        "PUT",
        "/inventory/storage-areas/area-1/audit-schedule",
        {"audit_frequency": "weekly"},
    ),
]


class TestSettingReader:
    @pytest.mark.parametrize(
        "settings",
        [
            None,
            {},
            {"inventory": None},
            {"inventory": {}},
            {"inventory": {"nfc_tracking_enabled": False}},
            # Unvalidated JSON: a string must not read as on.
            {"inventory": {"nfc_tracking_enabled": "false"}},
            {"inventory": {"nfc_tracking_enabled": "true"}},
            {"inventory": {"nfc_tracking_enabled": 1}},
            {"nfc_tracking_enabled": True},
        ],
    )
    def test_anything_but_a_literal_true_is_off(self, settings):
        assert nfc_tracking_enabled_in(settings) is False

    def test_a_literal_true_is_on(self):
        assert nfc_tracking_enabled_in({"inventory": {"nfc_tracking_enabled": True}})

    async def test_a_missing_organization_reads_as_off(self):
        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=result)
        assert await inventory_nfc_enabled(db, "org-1") is False

    async def test_require_raises_403_when_off(self):
        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = {"inventory": {}}
        db.execute = AsyncMock(return_value=result)
        with pytest.raises(HTTPException) as exc:
            await require_inventory_nfc(db, "org-1")
        assert exc.value.status_code == 403


class TestSettingsSchema:
    def test_the_switch_can_be_saved(self):
        update = OrganizationSettingsUpdate(inventory={"nfc_tracking_enabled": True})
        assert update.model_dump(exclude_unset=True) == {
            "inventory": {"nfc_tracking_enabled": True}
        }

    def test_saving_the_switch_does_not_send_the_rest_of_the_section(self):
        """The endpoint deep-merges; an unset sibling must stay unset, or the
        save would blank the write-off threshold stored beside it."""
        dumped = OrganizationSettingsUpdate(
            inventory={"nfc_tracking_enabled": False}
        ).model_dump(exclude_unset=True)
        assert set(dumped["inventory"]) == {"nfc_tracking_enabled"}

    def test_existing_untyped_inventory_keys_still_pass_through(self):
        dumped = OrganizationSettingsUpdate(
            inventory={"write_off_acknowledgement_threshold": 500}
        ).model_dump(exclude_unset=True)
        assert dumped == {"inventory": {"write_off_acknowledgement_threshold": 500}}

    def test_a_non_boolean_switch_is_rejected(self):
        with pytest.raises(ValidationError):
            OrganizationSettingsUpdate(inventory={"nfc_tracking_enabled": "maybe"})


class TestPermissionGates:
    def test_reading_the_switch_needs_only_view(self):
        assert _permission_set("/nfc/settings", "GET") == {"inventory.view"}

    def test_resolving_a_tap_matches_the_barcode_lookup(self):
        assert _permission_set("/nfc/resolve", "POST") == {"inventory.view"}

    def test_changing_tags_needs_manage(self):
        assert _permission_set("/items/{item_id}/nfc-tags", "GET") == {
            "inventory.manage"
        }
        assert _permission_set("/items/{item_id}/nfc-tags", "POST") == {
            "inventory.manage"
        }
        assert _permission_set("/nfc-tags/{tag_id}", "PATCH") == {"inventory.manage"}
        assert _permission_set("/nfc-tags/{tag_id}", "DELETE") == {"inventory.manage"}

    def test_a_tap_that_may_name_a_shelf_needs_only_view(self):
        """The tag page resolves through it for every member."""
        assert _permission_set("/nfc/resolve-any", "POST") == {"inventory.view"}

    def test_moving_items_and_reading_the_trail_need_manage(self):
        assert _permission_set("/nfc/put-away", "POST") == {"inventory.manage"}
        assert _permission_set("/items/{item_id}/nfc-scans", "GET") == {
            "inventory.manage"
        }
        assert _permission_set("/storage-areas/{storage_area_id}/nfc-tags", "GET") == {
            "inventory.manage"
        }
        assert _permission_set("/storage-areas/{storage_area_id}/nfc-tags", "POST") == {
            "inventory.manage"
        }

    async def test_a_viewer_cannot_put_an_item_away(self):
        with _switch(on=True):
            response = await _request(
                _app_for(_user(permissions=("inventory.view",))),
                "POST",
                "/inventory/nfc/put-away",
                {"item_id": "i-1", "storage_area_id": "a-1"},
            )
        assert response.status_code == 403

    async def test_a_viewer_cannot_link_a_tag(self):
        with _switch(on=True):
            response = await _request(
                _app_for(_user(permissions=("inventory.view",))),
                "POST",
                "/inventory/items/item-1/nfc-tags",
                LINK_BODY,
            )
        assert response.status_code == 403


class TestSwitchIsEnforced:
    @pytest.mark.parametrize(("method", "path", "body"), GUARDED_CALLS)
    async def test_every_tag_route_is_refused_while_off(self, method, path, body):
        """Hiding the buttons is not the control — the endpoint is."""
        service = AsyncMock()
        with _switch(on=False), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(_app_for(_user()), method, path, body)
        assert response.status_code == 403
        assert not service.method_calls

    async def test_the_settings_read_answers_while_off(self):
        with patch(f"{MODULE}.inventory_nfc_enabled", AsyncMock(return_value=False)):
            response = await _request(
                _app_for(_user(permissions=("inventory.view",))),
                "GET",
                "/inventory/nfc/settings",
            )
        assert response.status_code == 200
        assert response.json() == {"enabled": False}


class TestSchemas:
    def test_a_tag_of_only_separators_is_rejected(self):
        with pytest.raises(ValidationError, match="too short"):
            InventoryNfcTagCreate(tag_uid="::::")

    def test_a_serial_is_accepted_in_any_reader_spelling(self):
        for spelling in ("04A2245B7C1180", "04:a2:24:5b:7c:11:80", "04-A2-24-5B"):
            assert InventoryNfcTagCreate(tag_uid=spelling).tag_uid == spelling

    def test_resolving_needs_something_read_off_the_tag(self):
        with pytest.raises(ValidationError):
            InventoryNfcResolveRequest()

    def test_the_response_never_carries_the_identifier(self):
        fields = set(InventoryNfcTagResponse.model_fields)
        assert "uid_hash" not in fields
        assert "tag_uid" not in fields
        assert "uid_preview" in fields


class TestResolveResponses:
    async def test_an_unknown_tag_is_a_404_with_the_reason(self):
        from app.services.inventory_nfc_service import InventoryNfcTagNotFound

        service = MagicMock()
        service.resolve = AsyncMock(
            side_effect=InventoryNfcTagNotFound("This tag is not linked to any item.")
        )
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user()), "POST", "/inventory/nfc/resolve", RESOLVE_BODY
            )
        assert response.status_code == 404
        assert response.json()["detail"] == "This tag is not linked to any item."

    async def test_the_written_code_is_tried_before_the_serial(self):
        service = MagicMock()
        service.resolve = AsyncMock(
            side_effect=HTTPException(status_code=418, detail="stop")
        )
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/resolve",
                {"code": "INVTABCD1234", "serial_number": "04A2245B"},
            )
        service.resolve.assert_awaited_once_with("org-1", ("INVTABCD1234", "04A2245B"))


def _resolved_item():
    """An item the response model accepts without a database behind it."""
    from app.schemas.inventory import InventoryItemResponse

    return InventoryItemResponse.model_construct(id=uuid.UUID(int=1), name="Helmet")


class TestOnlyStaffTapsAreLogged:
    """A member opening a written tag must not leave a trail of where they were."""

    def _service(self):
        from app.services.inventory_nfc_service import ResolvedTag

        tag = SimpleNamespace(id="tag-1", uid_preview="1180")
        item = SimpleNamespace(id="item-1")
        service = MagicMock()
        service.resolve = AsyncMock(return_value=(tag, item))
        service.resolve_any = AsyncMock(return_value=ResolvedTag(tag=tag, item=item))
        service.record_scan = AsyncMock()
        return service

    async def _call(self, permissions, path, body):
        service = self._service()
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(
            f"{MODULE}.ScanLookupResponse",
            side_effect=lambda **kw: {
                "item": _resolved_item(),
                "matched_field": kw["matched_field"],
                "matched_value": kw["matched_value"],
            },
        ), patch(
            f"{MODULE}.InventoryNfcResolveAnyResponse",
            side_effect=lambda **kw: {**kw, "item": _resolved_item()},
        ):
            await _request(_app_for(_user(permissions)), "POST", path, body)
        return service

    @pytest.mark.parametrize(
        "path", ["/inventory/nfc/resolve", "/inventory/nfc/resolve-any"]
    )
    async def test_a_member_tap_is_resolved_but_not_recorded(self, path):
        service = await self._call(("inventory.view",), path, RESOLVE_BODY)
        service.record_scan.assert_not_awaited()

    @pytest.mark.parametrize(
        "path", ["/inventory/nfc/resolve", "/inventory/nfc/resolve-any"]
    )
    async def test_a_quartermaster_tap_is_recorded(self, path):
        service = await self._call(
            ("inventory.manage", "inventory.view"), path, RESOLVE_BODY
        )
        service.record_scan.assert_awaited_once()
        assert service.record_scan.await_args.kwargs["scanned_by"] == "admin-1"

    async def test_the_put_away_screen_can_skip_the_lookup_row(self):
        service = await self._call(
            ("inventory.manage",),
            "/inventory/nfc/resolve-any",
            {**RESOLVE_BODY, "record": False},
        )
        service.record_scan.assert_not_awaited()


class TestPhase3Gates:
    @pytest.mark.parametrize(
        ("path", "method"),
        [
            ("/nfc/audits", "POST"),
            ("/nfc/audits", "GET"),
            ("/nfc/audits/{audit_id}", "GET"),
            ("/nfc/audits/{audit_id}/apply", "POST"),
            ("/nfc/resolve-member", "POST"),
            ("/nfc/untagged", "GET"),
        ],
    )
    def test_quartermaster_tools_need_manage(self, path, method):
        assert _permission_set(path, method) == {"inventory.manage"}

    async def test_a_viewer_cannot_look_up_a_member_card(self):
        with _switch(on=True):
            response = await _request(
                _app_for(_user(permissions=("inventory.view",))),
                "POST",
                "/inventory/nfc/resolve-member",
                RESOLVE_BODY,
            )
        assert response.status_code == 403


class TestAuditSchemas:
    def test_a_submission_is_capped(self):
        taps = [{"item_id": f"i-{n}"} for n in range(MAX_AUDIT_TAPS + 1)]
        with pytest.raises(ValidationError):
            InventoryNfcAuditCreate(storage_area_id="a-1", tapped=taps)

    def test_an_empty_audit_is_allowed(self):
        """A shelf that should be empty, audited and found empty, is a result."""
        assert InventoryNfcAuditCreate(storage_area_id="a-1").tapped == []

    def test_applying_needs_at_least_one_item(self):
        with pytest.raises(ValidationError):
            InventoryNfcAuditApply(item_ids=[])

    def test_applying_rejects_a_malformed_id(self):
        with pytest.raises(ValidationError):
            InventoryNfcAuditApply(item_ids=["x" * 37])


class TestAuditRoutes:
    async def test_submitting_passes_the_taps_through_and_is_audited(self):
        detail = {
            "id": "audit-1",
            "storage_area_id": "a-1",
            "storage_area_name": "Shelf A",
            "expected_count": 1,
            "found_count": 1,
            "missing_count": 0,
            "unexpected_count": 0,
            "audited_at": "2026-09-24T12:00:00Z",
            "items": [],
        }
        service = MagicMock()
        service.create_audit = AsyncMock(return_value=detail)
        audit_log = AsyncMock()
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit_log):
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/audits",
                {
                    "storage_area_id": "a-1",
                    "tapped": [{"item_id": "i-1", "tag_id": "t-1"}, {"item_id": "i-2"}],
                },
            )
        assert response.status_code == 201
        kwargs = service.create_audit.await_args.kwargs
        assert kwargs["tapped"] == [("i-1", "t-1"), ("i-2", None)]
        assert kwargs["organization_id"] == "org-1"
        assert (
            audit_log.await_args.kwargs["event_type"] == "inventory_nfc_shelf_audited"
        )

    async def test_an_invalid_apply_is_a_400_with_the_reason(self):
        service = MagicMock()
        service.apply_audit = AsyncMock(
            side_effect=ValueError("Only items this audit found unexpectedly")
        )
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/audits/audit-1/apply",
                {"item_ids": ["i-1"]},
            )
        assert response.status_code == 400
        assert "Only items" in response.json()["detail"]

    async def test_an_unknown_audit_is_a_404(self):
        service = MagicMock()
        service.get_audit = AsyncMock(side_effect=LookupError("Audit not found"))
        with _switch(on=True), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user()), "GET", "/inventory/nfc/audits/nope"
            )
        assert response.status_code == 404


class TestResolveMember:
    def _patches(self, *, cards_on: bool, resolved):
        async def _cards_off(*_a, **_k):
            raise HTTPException(status_code=403, detail="NFC ID cards are not enabled")

        card_service = MagicMock()
        card_service.resolve_tag = AsyncMock(return_value=resolved)
        return (
            patch(
                f"{MODULE}.require_nfc_id_cards",
                AsyncMock() if cards_on else AsyncMock(side_effect=_cards_off),
            ),
            patch(f"{MODULE}.NfcTagService", return_value=card_service),
            card_service,
        )

    async def test_needs_the_id_card_integration(self):
        gate, svc, card_service = self._patches(cards_on=False, resolved=None)
        with _switch(on=True), gate, svc:
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/resolve-member",
                RESOLVE_BODY,
            )
        assert response.status_code == 403
        card_service.resolve_tag.assert_not_awaited()

    async def test_returns_the_member_and_never_the_identifier(self):
        member = SimpleNamespace(
            id=uuid.uuid4(),
            first_name="Dana",
            last_name="Reyes",
            username="dreyes",
            membership_number="117",
        )
        gate, svc, card_service = self._patches(
            cards_on=True, resolved=(MagicMock(), member, None)
        )
        with _switch(on=True), gate, svc:
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/resolve-member",
                {"code": "NFCABCD1234", "serial_number": "04A2245B"},
            )
        assert response.status_code == 200
        assert response.json() == {
            "user_id": str(member.id),
            "member_name": "Dana Reyes",
            "membership_number": "117",
        }
        assert set(InventoryNfcMemberResponse.model_fields) == {
            "user_id",
            "member_name",
            "membership_number",
        }
        card_service.resolve_tag.assert_awaited_once_with(
            "org-1", ("NFCABCD1234", "04A2245B")
        )

    @pytest.mark.parametrize(
        ("refusal", "fragment"),
        [
            (NfcCheckInStatus.UNKNOWN_CARD, "not registered"),
            (NfcCheckInStatus.CARD_INACTIVE, "no longer works"),
            (NfcCheckInStatus.MEMBER_INACTIVE, "not currently active"),
        ],
    )
    async def test_a_refused_card_is_a_404_saying_why(self, refusal, fragment):
        gate, svc, _ = self._patches(cards_on=True, resolved=(None, None, refusal))
        with _switch(on=True), gate, svc:
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/resolve-member",
                RESOLVE_BODY,
            )
        assert response.status_code == 404
        assert fragment in response.json()["detail"]


class TestAuditSchedule:
    @pytest.mark.parametrize(
        ("path", "method"),
        [
            ("/nfc/audit-schedule", "GET"),
            ("/storage-areas/{storage_area_id}/audit-schedule", "PUT"),
        ],
    )
    def test_needs_manage(self, path, method):
        assert _permission_set(path, method) == {"inventory.manage"}

    def test_an_empty_body_cannot_clear_a_schedule(self):
        with pytest.raises(ValidationError):
            InventoryAuditScheduleUpdate()

    def test_null_clears_and_a_value_sets(self):
        assert (
            InventoryAuditScheduleUpdate(audit_frequency=None).audit_frequency is None
        )
        assert (
            InventoryAuditScheduleUpdate(
                audit_frequency="quarterly"
            ).audit_frequency.value
            == "quarterly"
        )

    def test_an_unknown_frequency_is_rejected(self):
        with pytest.raises(ValidationError):
            InventoryAuditScheduleUpdate(audit_frequency="daily")

    async def test_setting_a_schedule_is_audited(self):
        service = MagicMock()
        service.set_frequency = AsyncMock(
            return_value={
                "storage_area_id": "area-1",
                "storage_area_name": "Shelf A",
                "audit_frequency": "monthly",
                "overdue": True,
            }
        )
        audit_log = AsyncMock()
        with _switch(on=True), patch(
            f"{MODULE}.InventoryAuditScheduleService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit_log):
            response = await _request(
                _app_for(_user()),
                "PUT",
                "/inventory/storage-areas/area-1/audit-schedule",
                {"audit_frequency": "monthly"},
            )
        assert response.status_code == 200
        service.set_frequency.assert_awaited_once()
        assert service.set_frequency.await_args.args[:2] == ("area-1", "org-1")
        kwargs = audit_log.await_args.kwargs
        assert kwargs["event_type"] == "inventory_audit_schedule_changed"
        assert kwargs["event_data"]["audit_frequency"] == "monthly"

    async def test_an_unknown_area_is_a_404(self):
        service = MagicMock()
        service.set_frequency = AsyncMock(
            side_effect=LookupError("Storage area not found")
        )
        with _switch(on=True), patch(
            f"{MODULE}.InventoryAuditScheduleService", return_value=service
        ):
            response = await _request(
                _app_for(_user()),
                "PUT",
                "/inventory/storage-areas/nope/audit-schedule",
                {"audit_frequency": None},
            )
        assert response.status_code == 404
