"""Kiosk endpoints: the grant, both switches, refusals as 409, and the audit
trail. The kiosk's rules themselves are in ``test_inventory_kiosk.py``,
against the database."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.inventory_kiosk import router
from app.core.database import get_db
from app.core.permissions import ALL_PERMISSIONS
from app.schemas.inventory_kiosk import KioskReturnRequest
from app.services.inventory_kiosk_service import KioskRefusal

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_kiosk"

CARD = {"serial_number": "04AA11BB22CC33"}
ITEM = {"code": "INVTABCD1234"}
CALLS = [
    ("/inventory/kiosk/identify", {"card": CARD}),
    ("/inventory/kiosk/preview", {"card": CARD, "item": ITEM}),
    ("/inventory/kiosk/checkout", {"card": CARD, "item": ITEM}),
    ("/inventory/kiosk/return", {"card": CARD, "item": ITEM}),
]


def _user(permissions=("inventory.kiosk",)):
    return SimpleNamespace(
        id="op-1",
        organization_id="org-1",
        username="kiosk-officer",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(user):
    app = FastAPI()
    app.include_router(router, prefix="/inventory")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return app


async def _post(app, path, body):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post(path, json=body)


async def _off(*_a, **_k):
    raise HTTPException(status_code=403, detail="off")


def _switches(*, nfc=True, cards=True):
    return (
        patch(
            f"{MODULE}.require_inventory_nfc",
            AsyncMock() if nfc else AsyncMock(side_effect=_off),
        ),
        patch(
            f"{MODULE}.require_nfc_id_cards",
            AsyncMock() if cards else AsyncMock(side_effect=_off),
        ),
    )


def _permission_set(path: str) -> set:
    for route in router.routes:
        if route.path == path:
            for dependency in route.dependant.dependencies:
                perms = getattr(dependency.call, "required_permissions", None)
                if perms is not None:
                    return set(perms)
    pytest.fail(f"no permission dependency on {path}")


class TestGates:
    def test_the_permission_is_registered(self):
        assert "inventory.kiosk" in {p.name for p in ALL_PERMISSIONS}

    @pytest.mark.parametrize(
        "path",
        ["/kiosk/identify", "/kiosk/preview", "/kiosk/checkout", "/kiosk/return"],
    )
    def test_every_route_needs_the_kiosk_grant(self, path):
        assert _permission_set(path) == {"inventory.kiosk"}

    @pytest.mark.parametrize(("path", "body"), CALLS)
    async def test_inventory_manage_alone_is_not_enough(self, path, body):
        """A quartermaster is not a kiosk: kiosk mode is granted on purpose."""
        nfc, cards = _switches()
        with nfc, cards:
            response = await _post(_app_for(_user(("inventory.manage",))), path, body)
        assert response.status_code == 403

    @pytest.mark.parametrize(("path", "body"), CALLS)
    @pytest.mark.parametrize("which", ["nfc", "cards"])
    async def test_both_switches_are_enforced(self, path, body, which):
        service = MagicMock()
        nfc, cards = _switches(nfc=which != "nfc", cards=which != "cards")
        with nfc, cards, patch(f"{MODULE}.InventoryKioskService", return_value=service):
            response = await _post(_app_for(_user()), path, body)
        assert response.status_code == 403
        assert not service.method_calls


class TestSchemas:
    def test_a_damaged_return_needs_a_note(self):
        with pytest.raises(ValidationError, match="Describe the damage"):
            KioskReturnRequest(card=CARD, item=ITEM, damaged=True, damage_notes=" ")

    def test_the_card_needs_something_read_off_it(self):
        with pytest.raises(ValidationError):
            KioskReturnRequest(card={}, item=ITEM)

    def test_there_is_no_member_id_to_send(self):
        """The card is the member's say-so; a tampered kiosk cannot name
        somebody else."""
        assert "user_id" not in KioskReturnRequest.model_fields
        assert "member_id" not in KioskReturnRequest.model_fields


def _result(**overrides):
    result = {
        "action": "checkout",
        "checkout_id": "co-1",
        "item_id": "item-1",
        "item_name": "Radio",
        "member_id": "m-1",
        "member_name": "Morgan Tester",
        "due_at": None,
        "damaged": False,
    }
    result.update(overrides)
    return result


class TestActions:
    async def test_a_refusal_is_a_409_with_the_reason(self):
        service = MagicMock()
        service.checkout = AsyncMock(
            side_effect=KioskRefusal("Radio is not available.")
        )
        nfc, cards = _switches()
        with nfc, cards, patch(f"{MODULE}.InventoryKioskService", return_value=service):
            response = await _post(
                _app_for(_user()),
                "/inventory/kiosk/checkout",
                {"card": CARD, "item": ITEM},
            )
        assert response.status_code == 409
        assert response.json()["detail"] == "Radio is not available."

    async def test_checkout_passes_both_reads_and_is_audited(self):
        service = MagicMock()
        service.checkout = AsyncMock(return_value=_result())
        audit = AsyncMock()
        nfc, cards = _switches()
        with nfc, cards, patch(
            f"{MODULE}.InventoryKioskService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _post(
                _app_for(_user()),
                "/inventory/kiosk/checkout",
                {"card": {"code": "NFCC1234", "serial_number": "04AA"}, "item": ITEM},
            )
        assert response.status_code == 200
        service.checkout.assert_awaited_once_with(
            "org-1", "op-1", ("NFCC1234", "04AA"), ("INVTABCD1234", None)
        )
        event = audit.await_args.kwargs
        assert event["event_type"] == "inventory_kiosk_checkout"
        assert event["event_data"]["member_id"] == "m-1"
        assert event["event_data"]["operator_id"] == "op-1"
        assert "member_id" not in response.json()

    async def test_a_damaged_return_is_audited_as_a_warning(self):
        service = MagicMock()
        service.return_item = AsyncMock(
            return_value=_result(action="return", damaged=True)
        )
        audit = AsyncMock()
        nfc, cards = _switches()
        with nfc, cards, patch(
            f"{MODULE}.InventoryKioskService", return_value=service
        ), patch(f"{MODULE}.log_audit_event", audit):
            response = await _post(
                _app_for(_user()),
                "/inventory/kiosk/return",
                {"card": CARD, "item": ITEM, "damaged": True, "damage_notes": "Bent"},
            )
        assert response.status_code == 200
        assert service.return_item.await_args.kwargs == {
            "damaged": True,
            "damage_notes": "Bent",
        }
        assert audit.await_args.kwargs["event_type"] == "inventory_kiosk_return"
        assert audit.await_args.kwargs["severity"] == "warning"
