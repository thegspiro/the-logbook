"""The inventory NFC tag register's endpoints: gates, the export, bulk and move.

The queries are in ``test_inventory_nfc_register.py`` against the database;
these run without one.
"""

import csv
import io
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.inventory_nfc import router
from app.core.database import get_db
from app.models.inventory import InventoryNfcTagStatus
from app.models.nfc_tag import NfcCredentialType
from app.schemas.inventory_nfc import (
    InventoryNfcTagBulkStatusRequest,
    InventoryNfcTagMove,
)

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_nfc"
LINKED_AT = datetime(2026, 10, 20, 14, 0, tzinfo=timezone.utc)


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


def _user(permissions=("inventory.manage",)):
    return SimpleNamespace(
        id="qm-1",
        organization_id="org-1",
        username="qm",
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


def _tag(*, compartment=False, item_id="item-1", **overrides):
    tag = {
        "id": "tag-1",
        "item_id": None if compartment else item_id,
        "storage_area_id": None,
        "check_compartment_id": "comp-1" if compartment else None,
        "uid_preview": "1180",
        "credential_type": NfcCredentialType.SERIAL,
        "label": None,
        "status": InventoryNfcTagStatus.ACTIVE,
        "linked_by": None,
        "linked_by_name": None,
        "linked_at": LINKED_AT,
    }
    tag.update(overrides)
    return tag


def _row(**overrides):
    row = {
        **_tag(),
        "kind": "item",
        "target_name": "Helmet 12",
        "template_name": None,
        "last_scanned_at": None,
    }
    row.update(overrides)
    return row


class TestPermissionGates:
    @pytest.mark.parametrize(
        ("path", "method"),
        [
            ("/nfc-tags", "GET"),
            ("/nfc-tags/export", "GET"),
            ("/nfc-tags/bulk-status", "POST"),
            ("/nfc-tags/move-targets", "GET"),
            ("/nfc-tags/{tag_id}/move", "POST"),
        ],
    )
    def test_the_register_admits_either_manager(self, path, method):
        # Owner's decision (2026-10-24): checklist managers open the register
        # too, limited to compartment tags (TestChecklistManager below).
        assert _permission_set(path, method) == {
            "inventory.manage",
            "inventory.check_manage",
        }

    async def test_a_viewer_cannot_open_the_register(self):
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()):
            response = await _request(
                _app_for(_user(("inventory.view",))),
                "GET",
                "/inventory/nfc-tags",
            )
        assert response.status_code == 403


class TestChecklistManager:
    """inventory.check_manage alone reads and changes compartment tags only."""

    CHECKLIST = ("inventory.check_manage",)

    async def _list(self, permissions, query=""):
        register = MagicMock()
        register.list_tags = AsyncMock(return_value=([], 0))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ):
            response = await _request(
                _app_for(_user(permissions)), "GET", f"/inventory/nfc-tags{query}"
            )
        return response, register

    async def test_sees_compartment_tags_only(self):
        response, register = await self._list(self.CHECKLIST)
        assert response.status_code == 200
        assert register.list_tags.await_args.kwargs["kind"] == "compartment"

    @pytest.mark.parametrize("kind", ["item", "storage_area"])
    async def test_asking_for_another_kind_is_refused(self, kind):
        response, register = await self._list(self.CHECKLIST, f"?kind={kind}")
        assert response.status_code == 403
        register.list_tags.assert_not_awaited()

    async def test_the_quartermaster_still_sees_every_kind(self):
        response, register = await self._list(("inventory.manage",))
        assert response.status_code == 200
        assert register.list_tags.await_args.kwargs["kind"] is None

    async def test_the_export_is_compartment_tags_only(self):
        register = MagicMock()
        register.list_tags = AsyncMock(return_value=([], 0))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ), patch(
            f"{MODULE}.resolve_scheduling_timezone",
            AsyncMock(return_value=ZoneInfo("UTC")),
        ), patch(
            f"{MODULE}.log_audit_event", AsyncMock()
        ):
            response = await _request(
                _app_for(_user(self.CHECKLIST)), "GET", "/inventory/nfc-tags/export"
            )
        assert response.status_code == 200
        assert register.list_tags.await_args.kwargs["kind"] == "compartment"

    async def test_bulk_changes_are_limited_to_compartment_tags(self):
        register = MagicMock()
        register.bulk_update_status = AsyncMock(return_value=([], []))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ):
            response = await _request(
                _app_for(_user(self.CHECKLIST)),
                "POST",
                "/inventory/nfc-tags/bulk-status",
                {"tag_ids": ["tag-1"], "status": "lost"},
            )
        assert response.status_code == 200
        register.bulk_update_status.assert_awaited_once_with(
            "org-1", ["tag-1"], InventoryNfcTagStatus.LOST, ("compartment",)
        )

    async def test_move_targets_are_compartments_only(self):
        register = MagicMock()
        register.move_targets = AsyncMock(return_value=[])
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ):
            refused = await _request(
                _app_for(_user(self.CHECKLIST)),
                "GET",
                "/inventory/nfc-tags/move-targets?kind=item",
            )
            allowed = await _request(
                _app_for(_user(self.CHECKLIST)),
                "GET",
                "/inventory/nfc-tags/move-targets?kind=compartment",
            )
        assert refused.status_code == 403
        assert allowed.status_code == 200
        register.move_targets.assert_awaited_once_with("org-1", "compartment", None)


class TestRegisterList:
    async def test_passes_the_filters_through(self):
        register = MagicMock()
        register.list_tags = AsyncMock(return_value=([_row()], 1))
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ):
            response = await _request(
                _app_for(_user()),
                "GET",
                "/inventory/nfc-tags?kind=compartment&status=lost&search=cab"
                "&limit=25&offset=50",
            )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["kind"] == "item"
        assert body["items"][0]["target_name"] == "Helmet 12"
        register.list_tags.assert_awaited_once_with(
            "org-1",
            kind="compartment",
            status=InventoryNfcTagStatus.LOST,
            search="cab",
            limit=25,
            offset=50,
        )

    async def test_an_unknown_kind_is_rejected(self):
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()):
            response = await _request(
                _app_for(_user()), "GET", "/inventory/nfc-tags?kind=apparatus"
            )
        assert response.status_code == 422


class TestExport:
    async def test_writes_the_register_safely_and_is_audited(self):
        register = MagicMock()
        register.list_tags = AsyncMock(
            return_value=(
                [
                    _row(target_name="=HYPERLINK(1)", label="Brim"),
                    _row(
                        kind="compartment",
                        target_name="Cab",
                        template_name="Engine 1",
                        status=InventoryNfcTagStatus.LOST,
                        last_scanned_at=LINKED_AT,
                    ),
                ],
                2,
            )
        )
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ), patch(
            f"{MODULE}.resolve_scheduling_timezone",
            AsyncMock(return_value=ZoneInfo("UTC")),
        ), patch(
            f"{MODULE}.log_audit_event", audit
        ):
            response = await _request(
                _app_for(_user()), "GET", "/inventory/nfc-tags/export?kind=item"
            )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        rows = list(csv.reader(io.StringIO(response.text)))
        assert rows[0][:3] == ["Kind", "Tagged", "Checklist"]
        # A target name a member could have typed must not run as a formula.
        assert rows[1][1] == "'=HYPERLINK(1)"
        assert rows[2][:6] == ["Compartment", "Cab", "Engine 1", "", "…1180", "Lost"]
        assert rows[2][8] == "2026-10-20 14:00 UTC"
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_type"] == "inventory_nfc_tags_exported"
        assert audit.await_args.kwargs["event_data"]["rows"] == 2


class TestBulkStatus:
    async def test_reports_failures_and_audits_each_change(self):
        register = MagicMock()
        register.bulk_update_status = AsyncMock(
            return_value=(
                [_tag(status=InventoryNfcTagStatus.LOST)],
                [{"id": "tag-9", "detail": "NFC tag not found"}],
            )
        )
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcRegisterService", return_value=register
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _request(
                _app_for(_user()),
                "POST",
                "/inventory/nfc-tags/bulk-status",
                {"tag_ids": ["tag-1", "tag-9"], "status": "lost"},
            )
        assert response.status_code == 200
        body = response.json()
        assert [t["id"] for t in body["updated"]] == ["tag-1"]
        assert body["failed"] == [{"id": "tag-9", "detail": "NFC tag not found"}]
        register.bulk_update_status.assert_awaited_once_with(
            "org-1",
            ["tag-1", "tag-9"],
            InventoryNfcTagStatus.LOST,
            ("item", "storage_area", "compartment"),
        )
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_data"]["bulk"] is True

    def test_the_selection_is_capped(self):
        with pytest.raises(ValidationError):
            InventoryNfcTagBulkStatusRequest(
                tag_ids=[f"t-{i}" for i in range(201)], status="lost"
            )


class TestMove:
    async def _move(self, permissions, *, compartment, body=None, error=None):
        service = MagicMock()
        service.get_tag = AsyncMock(return_value=_tag(compartment=compartment))
        register = MagicMock()
        register.move_tag = AsyncMock(
            side_effect=error,
            return_value=(
                _tag(compartment=compartment),
                _tag(compartment=compartment, item_id="item-2"),
            ),
        )
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.InventoryNfcRegisterService", return_value=register), patch(
            f"{MODULE}.log_audit_event", audit
        ):
            response = await _request(
                _app_for(_user(permissions)),
                "POST",
                "/inventory/nfc-tags/tag-1/move",
                body or {"item_id": "item-2"},
            )
        return response, register, audit

    async def test_moves_and_audits_where_from_and_to(self):
        response, register, audit = await self._move(
            ("inventory.manage",), compartment=False
        )
        assert response.status_code == 200
        assert response.json()["item_id"] == "item-2"
        register.move_tag.assert_awaited_once_with(
            "tag-1",
            "org-1",
            item_id="item-2",
            storage_area_id=None,
            check_compartment_id=None,
        )
        data = audit.await_args.kwargs["event_data"]
        assert audit.await_args.kwargs["event_type"] == "inventory_nfc_tag_moved"
        assert data["from"]["item_id"] == "item-1"
        assert data["to"]["item_id"] == "item-2"

    async def test_a_checklist_builder_cannot_move_an_item_tag(self):
        response, register, audit = await self._move(
            ("inventory.check_manage",), compartment=False
        )
        assert response.status_code == 403
        register.move_tag.assert_not_awaited()
        audit.assert_not_awaited()

    async def test_a_quartermaster_moves_a_compartment_tag(self):
        response, register, _ = await self._move(
            ("inventory.manage",),
            compartment=True,
            body={"check_compartment_id": "comp-2"},
        )
        assert response.status_code == 200
        register.move_tag.assert_awaited_once()

    async def test_a_refused_move_is_a_400_saying_why(self):
        response, _, audit = await self._move(
            ("inventory.manage",),
            compartment=False,
            error=ValueError("A tag can only move to the same kind of target"),
        )
        assert response.status_code == 400
        assert "same kind" in response.json()["detail"]
        audit.assert_not_awaited()

    async def test_a_target_outside_the_department_is_a_404(self):
        response, _, audit = await self._move(
            ("inventory.manage",),
            compartment=False,
            error=LookupError("Item not found"),
        )
        assert response.status_code == 404
        audit.assert_not_awaited()

    @pytest.mark.parametrize(
        "body",
        [{}, {"item_id": "a", "storage_area_id": "b"}, {"item_id": ""}],
    )
    def test_names_exactly_one_target(self, body):
        with pytest.raises(ValidationError):
            InventoryNfcTagMove(**body)
