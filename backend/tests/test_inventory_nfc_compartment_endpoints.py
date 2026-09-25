"""NFC tags on equipment-check compartments: the permission gates and shapes.

The database behaviour (org scoping through the template, what a tap during a
check resolves to) is in ``test_inventory_nfc_compartments.py``; these run
without a database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.inventory_nfc import router
from app.core.database import get_db
from app.services.inventory_nfc_service import (
    InventoryNfcTagNotFound,
    ResolvedCheckTap,
)

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_nfc"
RESOLVE_CHECK_BODY = {"serial_number": "04A2245B7C1180", "template_id": "tmpl-1"}


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
        id="user-1",
        organization_id="org-1",
        username="crew",
        full_name="Crew Member",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(current_user):
    app = FastAPI()
    app.include_router(router, prefix="/inventory")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return app


async def _request(app, method: str, path: str, body: dict | None = None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.request(method, path, json=body)


def _tag(*, compartment: bool):
    return {
        "id": "tag-1",
        "item_id": None if compartment else "item-1",
        "storage_area_id": None,
        "check_compartment_id": "comp-1" if compartment else None,
        "uid_preview": "1180",
        "credential_type": "serial",
        "label": None,
        "status": "active",
        "linked_by": None,
        "linked_by_name": None,
        "linked_at": "2026-09-25T00:00:00Z",
    }


class TestGates:
    def test_compartment_tags_belong_to_checklist_builders(self):
        path = "/check-compartments/{compartment_id}/nfc-tags"
        assert _permission_set(path, "GET") == {"inventory.check_manage"}
        assert _permission_set(path, "POST") == {"inventory.check_manage"}

    def test_a_tap_during_a_check_is_for_whoever_performs_checks(self):
        assert _permission_set("/nfc/resolve-check", "POST") == {
            "inventory.check_submit",
            "inventory.check_manage",
        }


class TestTagKindDecidesThePermission:
    """The shared /nfc-tags/{id} routes admit either permission; the tag's
    target says which one this caller needs."""

    async def _call(self, permissions, method, *, compartment):
        service = MagicMock()
        service.get_tag = AsyncMock(return_value=_tag(compartment=compartment))
        service.update_tag = AsyncMock(return_value=_tag(compartment=compartment))
        service.unlink_tag = AsyncMock(return_value=_tag(compartment=compartment))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", AsyncMock()):
            response = await _request(
                _app_for(_user(permissions)),
                method,
                "/inventory/nfc-tags/tag-1",
                {"label": "Door"} if method == "PATCH" else None,
            )
        return response, service

    @pytest.mark.parametrize("method", ["PATCH", "DELETE"])
    async def test_a_checklist_builder_manages_a_compartment_tag(self, method):
        response, service = await self._call(
            ("inventory.check_manage",), method, compartment=True
        )
        assert response.status_code in (200, 204)
        assert service.update_tag.await_count + service.unlink_tag.await_count == 1

    @pytest.mark.parametrize("method", ["PATCH", "DELETE"])
    async def test_a_checklist_builder_cannot_touch_an_item_tag(self, method):
        response, service = await self._call(
            ("inventory.check_manage",), method, compartment=False
        )
        assert response.status_code == 403
        service.update_tag.assert_not_awaited()
        service.unlink_tag.assert_not_awaited()

    @pytest.mark.parametrize("method", ["PATCH", "DELETE"])
    async def test_a_quartermaster_cannot_touch_a_compartment_tag(self, method):
        response, service = await self._call(
            ("inventory.manage",), method, compartment=True
        )
        assert response.status_code == 403
        service.update_tag.assert_not_awaited()
        service.unlink_tag.assert_not_awaited()

    async def test_an_unknown_tag_is_a_404(self):
        service = MagicMock()
        service.get_tag = AsyncMock(side_effect=LookupError("NFC tag not found"))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user(("inventory.check_manage",))),
                "DELETE",
                "/inventory/nfc-tags/tag-1",
            )
        assert response.status_code == 404


class TestResolveCheck:
    def _checks(self, *, template=True, positions=None):
        checks = MagicMock()
        checks.get_template = AsyncMock(
            return_value=SimpleNamespace(id="tmpl-1") if template else None
        )
        checks.get_user_check_positions = AsyncMock(return_value=positions or set())
        return checks

    async def _call(self, permissions, service, checks):
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.EquipmentCheckService", return_value=checks):
            return await _request(
                _app_for(_user(permissions)),
                "POST",
                "/inventory/nfc/resolve-check",
                RESOLVE_CHECK_BODY,
            )

    async def test_a_submitter_is_limited_to_their_assigned_templates(self):
        service = MagicMock()
        service.resolve_check = AsyncMock()
        checks = self._checks(template=False, positions={"driver"})
        response = await self._call(("inventory.check_submit",), service, checks)

        assert response.status_code == 404
        assert checks.get_template.await_args.kwargs["visible_positions"] == {"driver"}
        service.resolve_check.assert_not_awaited()

    async def test_a_checklist_builder_sees_every_template(self):
        service = MagicMock()
        service.resolve_check = AsyncMock(
            side_effect=InventoryNfcTagNotFound("x is not on this checklist.")
        )
        checks = self._checks()
        await self._call(("inventory.check_manage",), service, checks)

        assert checks.get_template.await_args.kwargs["visible_positions"] is None
        checks.get_user_check_positions.assert_not_awaited()

    async def test_a_compartment_tap_names_the_compartment(self):
        service = MagicMock()
        service.resolve_check = AsyncMock(
            return_value=ResolvedCheckTap(
                tag=SimpleNamespace(id="tag-1"),
                kind="compartment",
                compartment=SimpleNamespace(id="comp-1", name="Driver side 1"),
            )
        )
        service.record_scan = AsyncMock()
        response = await self._call(
            ("inventory.check_submit", "inventory.manage"), service, self._checks()
        )

        assert response.status_code == 200
        assert response.json() == {
            "kind": "compartment",
            "tag_id": "tag-1",
            "compartment_id": "comp-1",
            "compartment_name": "Driver side 1",
            "item_name": None,
            "template_item_ids": [],
        }
        # Only an item tap is an item sighting.
        service.record_scan.assert_not_awaited()
        service.resolve_check.assert_awaited_once_with(
            "org-1", "tmpl-1", (None, "04A2245B7C1180")
        )

    @pytest.mark.parametrize(
        ("permissions", "recorded"),
        [
            (("inventory.check_submit",), False),
            (("inventory.check_submit", "inventory.manage"), True),
        ],
    )
    async def test_an_item_tap_is_logged_only_for_staff(self, permissions, recorded):
        service = MagicMock()
        service.resolve_check = AsyncMock(
            return_value=ResolvedCheckTap(
                tag=SimpleNamespace(id="tag-1"),
                kind="item",
                item=SimpleNamespace(id="item-1", name="Halligan"),
                template_item_ids=["ti-1", "ti-2"],
            )
        )
        service.record_scan = AsyncMock()
        response = await self._call(permissions, service, self._checks())

        assert response.status_code == 200
        body = response.json()
        assert body["kind"] == "item"
        assert body["item_name"] == "Halligan"
        assert body["template_item_ids"] == ["ti-1", "ti-2"]
        assert service.record_scan.await_count == (1 if recorded else 0)

    async def test_a_refused_tap_is_a_404_saying_why(self):
        service = MagicMock()
        service.resolve_check = AsyncMock(
            side_effect=InventoryNfcTagNotFound(
                "This tag is on a compartment of another checklist."
            )
        )
        response = await self._call(
            ("inventory.check_submit",), service, self._checks()
        )
        assert response.status_code == 404
        assert "another checklist" in response.json()["detail"]

    async def test_a_template_id_is_required(self):
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()):
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc/resolve-check",
                {"serial_number": "04A2245B7C1180"},
            )
        assert response.status_code == 422


class TestCompartmentLinking:
    async def test_linking_is_audited_with_the_compartment(self):
        service = MagicMock()
        service.link_tag = AsyncMock(return_value=_tag(compartment=True))
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _request(
                _app_for(_user(("inventory.check_manage",))),
                "POST",
                "/inventory/check-compartments/comp-1/nfc-tags",
                {"tag_uid": "04A2245B7C1180"},
            )

        assert response.status_code == 201
        assert response.json()["check_compartment_id"] == "comp-1"
        assert service.link_tag.await_args.kwargs["check_compartment_id"] == "comp-1"
        assert audit.await_args.kwargs["event_data"]["check_compartment_id"] == (
            "comp-1"
        )

    async def test_a_compartment_in_another_organization_is_a_404(self):
        service = MagicMock()
        service.list_compartment_tags = AsyncMock(
            side_effect=LookupError("Compartment not found")
        )
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user(("inventory.check_manage",))),
                "GET",
                "/inventory/check-compartments/comp-1/nfc-tags",
            )
        assert response.status_code == 404

    async def test_an_already_linked_tag_is_a_400(self):
        service = MagicMock()
        service.link_tag = AsyncMock(
            side_effect=ValueError('This tag is already linked to "Helmet 4".')
        )
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ):
            response = await _request(
                _app_for(_user(("inventory.check_manage",))),
                "POST",
                "/inventory/check-compartments/comp-1/nfc-tags",
                {"tag_uid": "04A2245B7C1180"},
            )
        assert response.status_code == 400
