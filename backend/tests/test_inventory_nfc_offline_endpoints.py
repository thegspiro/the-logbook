"""Offline NFC replay endpoints: the gates, validation, and what gets audited.

What the replays do to the database is in
``test_inventory_nfc_offline_replay.py``; these run without one.
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
    MAX_AUDIT_TAPS,
    InventoryNfcAuditReplayRequest,
    InventoryNfcPutAwayReplayRequest,
    InventoryNfcReplayTap,
)

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_nfc"
READ = {"serial_number": "04A2245B7C1180"}


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
        full_name="Quarter Master",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(current_user):
    app = FastAPI()
    app.include_router(router, prefix="/inventory")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return app


async def _post(app, path: str, body: dict):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post(path, json=body)


async def _switched_off(*_args, **_kwargs):
    raise HTTPException(status_code=403, detail="NFC tag tracking is not enabled")


class TestGates:
    @pytest.mark.parametrize("path", ["/nfc/put-away/replay", "/nfc/audits/replay"])
    def test_replays_need_manage_like_the_screens_that_queue_them(self, path):
        assert _permission_set(path, "POST") == {"inventory.manage"}

    @pytest.mark.parametrize(
        ("path", "body"),
        [
            ("/inventory/nfc/put-away/replay", {"taps": [READ]}),
            (
                "/inventory/nfc/audits/replay",
                {"client_submission_id": "phone-abc-123", "taps": [READ]},
            ),
        ],
    )
    async def test_refused_while_the_switch_is_off(self, path, body):
        service = MagicMock()
        with patch(
            f"{MODULE}.require_inventory_nfc", AsyncMock(side_effect=_switched_off)
        ), patch(f"{MODULE}.InventoryNfcService", return_value=service):
            response = await _post(_app_for(_user()), path, body)
        assert response.status_code == 403
        assert not service.method_calls

    async def test_a_viewer_cannot_replay(self):
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()):
            response = await _post(
                _app_for(_user(("inventory.view",))),
                "/inventory/nfc/put-away/replay",
                {"taps": [READ]},
            )
        assert response.status_code == 403


class TestSchemas:
    def test_a_step_is_a_read_or_a_picked_shelf_never_both(self):
        with pytest.raises(ValidationError, match="either a tag read"):
            InventoryNfcReplayTap(serial_number="04A2245B", storage_area_id="a-1")
        with pytest.raises(ValidationError, match="either a tag read"):
            InventoryNfcReplayTap()

    def test_a_put_away_replay_needs_a_tap(self):
        with pytest.raises(ValidationError):
            InventoryNfcPutAwayReplayRequest(taps=[])

    def test_an_audit_replay_is_bounded_across_both_lists(self):
        half = MAX_AUDIT_TAPS // 2 + 1
        with pytest.raises(ValidationError, match="holds up to"):
            InventoryNfcAuditReplayRequest(
                client_submission_id="phone-abc-123",
                tapped=[{"item_id": f"i-{n}"} for n in range(half)],
                taps=[READ] * half,
            )

    @pytest.mark.parametrize("client_id", ["short", "has space in it", "x" * 65])
    def test_a_malformed_submission_id_is_rejected(self, client_id):
        with pytest.raises(ValidationError):
            InventoryNfcAuditReplayRequest(client_submission_id=client_id)


class TestPutAwayReplayRoute:
    async def test_each_move_is_audited_as_a_put_away(self):
        service = MagicMock()
        service.replay_put_away = AsyncMock(
            return_value={
                "results": [
                    {"index": 0, "outcome": "shelf_opened", "storage_area_name": "A"},
                    {
                        "index": 1,
                        "outcome": "moved",
                        "item_id": "i-1",
                        "item_name": "Helmet",
                        "storage_area_id": "a-1",
                        "storage_area_name": "A",
                        "from_storage_area_id": None,
                    },
                    {"index": 2, "outcome": "unread", "message": "Not linked."},
                ],
                "moved_count": 1,
                "refused_count": 0,
                "unread_count": 1,
                "held_item_name": None,
            }
        )
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _post(
                _app_for(_user()),
                "/inventory/nfc/put-away/replay",
                {"open_storage_area_id": "a-1", "taps": [READ, READ, READ]},
            )

        assert response.status_code == 200
        assert [s["outcome"] for s in response.json()["results"]] == [
            "shelf_opened",
            "moved",
            "unread",
        ]
        assert audit.await_count == 1
        event = audit.await_args.kwargs
        assert event["event_type"] == "inventory_items_put_away"
        assert event["event_data"]["method"] == "nfc_offline"
        assert event["event_data"]["item_ids"] == ["i-1"]
        kwargs = service.replay_put_away.await_args.kwargs
        assert kwargs["open_storage_area_id"] == "a-1"
        assert kwargs["scanned_by"] == "qm-1"
        assert len(kwargs["taps"]) == 3


class TestAuditReplayRoute:
    def _detail(self):
        return {
            "id": "audit-1",
            "storage_area_id": "a-1",
            "storage_area_name": "Shelf A",
            "expected_count": 1,
            "found_count": 1,
            "missing_count": 0,
            "unexpected_count": 0,
            "audited_by": "qm-1",
            "audited_by_name": "Quarter Master",
            "audited_at": "2026-09-25T12:00:00Z",
            "applied_by": None,
            "applied_by_name": None,
            "applied_at": None,
            "items": [],
        }

    async def _call(self, result):
        service = MagicMock()
        service.replay_audit = AsyncMock(return_value=result)
        audit = AsyncMock()
        with patch(f"{MODULE}.require_inventory_nfc", AsyncMock()), patch(
            f"{MODULE}.InventoryNfcService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _post(
                _app_for(_user()),
                "/inventory/nfc/audits/replay",
                {"client_submission_id": "phone-abc-123", "taps": [READ]},
            )
        return response, audit

    async def test_a_new_audit_is_saved_and_audited(self):
        response, audit = await self._call(
            {
                "audit": self._detail(),
                "created": True,
                "not_saved_reason": None,
                "unread_count": 2,
                "other_shelf_count": 0,
            }
        )
        assert response.status_code == 200
        assert response.json()["unread_count"] == 2
        assert audit.await_args.kwargs["event_data"]["offline"] is True

    async def test_a_resend_is_not_audited_twice(self):
        response, audit = await self._call(
            {
                "audit": self._detail(),
                "created": False,
                "not_saved_reason": None,
                "unread_count": 0,
                "other_shelf_count": 0,
            }
        )
        assert response.status_code == 200
        assert response.json()["audit"]["id"] == "audit-1"
        audit.assert_not_awaited()

    async def test_nothing_to_save_is_a_200_saying_why(self):
        response, audit = await self._call(
            {
                "audit": None,
                "created": False,
                "not_saved_reason": "No shelf was chosen or tapped.",
                "unread_count": 0,
                "other_shelf_count": 0,
            }
        )
        assert response.status_code == 200
        assert response.json()["audit"] is None
        assert "No shelf" in response.json()["not_saved_reason"]
        audit.assert_not_awaited()
