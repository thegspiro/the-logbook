"""Inventory NFC tag endpoints: the switch, the permission gates, the shapes.

The database behaviour (hashing, uniqueness, org isolation) is in
``test_inventory_nfc_service.py``; these run without a database.
"""

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
    InventoryNfcResolveRequest,
    InventoryNfcTagCreate,
    InventoryNfcTagResponse,
)
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
