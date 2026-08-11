"""
The weekly expiring-supplies alert.

Both ends of the shelf-to-truck loop are reported together on purpose: a
deployed item with no in-date lot behind it is a reorder, one with stock ready
is only a swap, and neither module can tell those apart alone. These tests pin
that split and the no-op when nothing is expiring.

Mocked sessions and mail — no DB — so they run in the sandbox.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.user import Organization
from app.services.scheduled_tasks import run_supply_expiration_alerts

YESTERDAY = date.today() - timedelta(days=1)
SOON = date.today() + timedelta(days=10)


def _org():
    # A real model instance, not a mock: the email chrome reads several
    # optional org attributes and a mock answers every one of them with a
    # MagicMock, which blows up inside the HTML builder rather than in the
    # code under test.
    return Organization(id="org-1", name="Test FD")


def _admin():
    user = MagicMock()
    user.id = "u-1"
    user.role = "quartermaster"
    user.email = "supply@example.org"
    return user


def _db(users=None):
    """A session whose two selects return the org list, then the admin list."""
    org_result = MagicMock()
    org_result.scalars.return_value.all.return_value = [_org()]
    user_result = MagicMock()
    user_result.scalars.return_value.all.return_value = (
        [_admin()] if users is None else users
    )
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[org_result, user_result])
    return db


def _deployed(name, ready_stock, days=10):
    return {
        "item_name": name,
        "apparatus_name": "Engine 1",
        "compartment_name": "Compartment 1",
        "expiration_date": SOON,
        "days_until_expiration": days,
        "ready_stock": ready_stock,
    }


def _lot(item_name="4x4 Gauze", expiration=SOON, quantity=6):
    lot = MagicMock()
    lot.lot_number = "LOT-1"
    lot.expiration_date = expiration
    lot.quantity = quantity
    return (lot, item_name)


@pytest.fixture
def sent():
    """Patch the pieces the task composes; collect the email that goes out."""
    captured = {}

    async def _send_email(**kwargs):
        captured.update(kwargs)
        return 1, []

    email_svc = MagicMock()
    email_svc.send_email = AsyncMock(side_effect=_send_email)

    with patch(
        "app.services.email_service.EmailService", return_value=email_svc
    ), patch.object(
        __import__(
            "app.services.equipment_check_service", fromlist=["EquipmentCheckService"]
        ).EquipmentCheckService,
        "get_supply_overview",
        new_callable=AsyncMock,
    ) as overview, patch.object(
        __import__(
            "app.services.inventory_service", fromlist=["InventoryService"]
        ).InventoryService,
        "get_expiring_lots",
        new_callable=AsyncMock,
    ) as lots:
        yield captured, overview, lots


class TestSupplyExpirationAlerts:
    async def test_nothing_expiring_sends_nothing(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        lots.return_value = []

        result = await run_supply_expiration_alerts(_db())

        assert captured == {}
        assert result["total"] == 0

    async def test_reorders_and_swaps_are_reported_separately(self, sent):
        captured, overview, lots = sent
        overview.return_value = {
            "items": [
                _deployed("Epi 1:1000", ready_stock=0),
                _deployed("4x4 Gauze", ready_stock=12),
            ]
        }
        lots.return_value = []

        await run_supply_expiration_alerts(_db())

        html = captured["html_body"]
        assert "On apparatus — no replacement stock (1)" in html
        assert "On apparatus — replacement ready (1)" in html
        # The count a supply officer acts on leads the plain-text summary.
        assert "1 have no replacement stock on hand" in captured["text_body"]

    async def test_shelf_stock_is_reported_alongside_the_trucks(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("4x4 Gauze", ready_stock=4)]}
        lots.return_value = [_lot(), _lot(expiration=YESTERDAY)]

        await run_supply_expiration_alerts(_db())

        html = captured["html_body"]
        assert "Replacement stock on the shelf (2)" in html
        # An already-expired lot is called out rather than shown as "-1d".
        assert "expired" in html

    async def test_shelf_stock_alone_still_alerts(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        lots.return_value = [_lot()]

        await run_supply_expiration_alerts(_db())

        assert "Replacement stock on the shelf (1)" in captured["html_body"]

    async def test_no_supply_recipients_sends_nothing(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("4x4 Gauze", ready_stock=0)]}
        lots.return_value = []

        member = MagicMock()
        member.id = "u-2"
        member.role = "member"
        member.email = "member@example.org"

        result = await run_supply_expiration_alerts(_db(users=[member]))

        assert captured == {}
        assert result["total"] == 0
