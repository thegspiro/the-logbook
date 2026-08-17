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


def _user_with(permissions, user_id="u-1", email="supply@example.org"):
    """A member whose roles grant ``permissions``.

    Recipients are resolved off the roles relationship, never a scalar
    ``user.role`` — ``User`` has no such column, and a MagicMock answering
    one is what let a broken recipient filter pass its tests.
    """
    role = MagicMock()
    role.permissions = list(permissions)
    user = MagicMock()
    user.id = user_id
    user.email = email
    user.roles = [role]
    return user


def _admin():
    return _user_with(["inventory.manage"])


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


_lot_counter = 0


def _lot(item_name="4x4 Gauze", expiration=SOON, quantity=6, lot_id=None):
    """A shelf lot. ``id`` matters: the task subtracts the medical lots from
    the full set by id to derive the gear ones."""
    global _lot_counter
    _lot_counter += 1
    lot = MagicMock()
    lot.id = lot_id or f"lot-{_lot_counter}"
    lot.lot_number = f"LOT-{_lot_counter}"
    lot.expiration_date = expiration
    lot.quantity = quantity
    return (lot, item_name)


def _lots_by_domain(medical, gear):
    """Answer ``get_expiring_lots`` per its ``item_types`` argument."""

    async def _side_effect(_org, _days=30, item_types=None):
        return list(medical) if item_types else list(medical) + list(gear)

    return _side_effect


@pytest.fixture
def sent():
    """Patch the pieces the task composes; collect the email that goes out."""
    captured = {}
    # Every send, not just the last: the task now emits one message per
    # audience, and the whole point of the split is what each one contains.
    captured["all"] = []

    async def _send_email(**kwargs):
        captured["all"].append(kwargs)
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

        assert captured["all"] == []
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

        member = _user_with(
            ["inventory.view"], user_id="u-2", email="member@example.org"
        )

        result = await run_supply_expiration_alerts(_db(users=[member]))

        assert captured["all"] == []
        assert result["total"] == 0

    async def test_any_role_granted_inventory_manage_is_notified(self, sent):
        """Departments split stock duties differently.

        A department that gives medical supplies to an EMS supply officer
        rather than the quartermaster must still get the alert, so the filter
        is the permission, not the title holding it.
        """
        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("4x4 Gauze", ready_stock=0)]}
        lots.return_value = []

        ems_officer = _user_with(
            ["inventory.manage"], user_id="u-3", email="ems@example.org"
        )

        await run_supply_expiration_alerts(_db(users=[ems_officer]))

        assert captured["to_emails"] == ["ems@example.org"]

    async def test_module_wildcard_grant_is_notified(self, sent):
        """``inventory.*`` and ``*`` are real grants; they must match too."""
        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("4x4 Gauze", ready_stock=0)]}
        lots.return_value = []

        wildcard = _user_with(["inventory.*"], user_id="u-4", email="chief@example.org")

        await run_supply_expiration_alerts(_db(users=[wildcard]))

        assert captured["to_emails"] == ["chief@example.org"]

    async def test_the_medical_only_officer_is_notified(self, sent):
        """The whole point of the ems_supply_officer role.

        It holds ``inventory.manage_medical`` and nothing broader, so a
        recipient filter checking only ``inventory.manage`` left the one person
        appointed to own this stock off the alert about it.
        """
        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("Epi 1:1000", ready_stock=0)]}
        lots.return_value = []

        ems = _user_with(
            ["inventory.manage_medical"], user_id="u-5", email="ems@example.org"
        )

        await run_supply_expiration_alerts(_db(users=[ems]))

        assert captured["to_emails"] == ["ems@example.org"]

    async def test_the_seeded_ems_supply_officer_role_qualifies(self, sent):
        """Pinned against the real seeded role, not a hand-written grant list.

        A future edit that drops the medical grant from that role would
        otherwise silently reintroduce the same silence.
        """
        from app.core.permissions import DEFAULT_ROLES

        captured, overview, lots = sent
        overview.return_value = {"items": [_deployed("Epi 1:1000", ready_stock=0)]}
        lots.return_value = []

        seeded = _user_with(
            DEFAULT_ROLES["ems_supply_officer"]["permissions"],
            user_id="u-6",
            email="seeded@example.org",
        )

        await run_supply_expiration_alerts(_db(users=[seeded]))

        assert captured["to_emails"] == ["seeded@example.org"]


class TestDomainIsolationInAlerts:
    """Widening the recipient list must not widen what each one is shown.

    The body is a rendered table, so mailing every row to everyone is the same
    disclosure as serving it — and the API refuses a medical-only officer the
    gear rows on purpose.
    """

    def _mixed(self, lots):
        """One medical lot and one gear lot on the shelf."""
        medical = [_lot(item_name="Epi 1:1000", lot_id="med-1")]
        gear = [_lot(item_name="Turnout Hood", lot_id="gear-1")]
        lots.side_effect = _lots_by_domain(medical, gear)

    async def test_a_medical_only_officer_is_not_mailed_gear_lots(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        self._mixed(lots)

        ems = _user_with(
            ["inventory.manage_medical"], user_id="u-9", email="ems@example.org"
        )
        await run_supply_expiration_alerts(_db(users=[ems]))

        assert len(captured["all"]) == 1
        body = captured["all"][0]["html_body"]
        assert "Epi 1:1000" in body
        assert "Turnout Hood" not in body

    async def test_a_broad_manager_is_mailed_both(self, sent):
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        self._mixed(lots)

        boss = _user_with(["inventory.manage"], user_id="u-10", email="qm@example.org")
        await run_supply_expiration_alerts(_db(users=[boss]))

        assert len(captured["all"]) == 1
        body = captured["all"][0]["html_body"]
        assert "Epi 1:1000" in body
        assert "Turnout Hood" in body

    async def test_each_audience_gets_its_own_message(self, sent):
        """Two officers, two different emails — not one shared blast."""
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        self._mixed(lots)

        ems = _user_with(
            ["inventory.manage_medical"], user_id="u-11", email="ems@example.org"
        )
        boss = _user_with(["inventory.manage"], user_id="u-12", email="qm@example.org")
        await run_supply_expiration_alerts(_db(users=[ems, boss]))

        by_recipient = {
            tuple(send["to_emails"]): send["html_body"] for send in captured["all"]
        }
        assert len(by_recipient) == 2
        assert "Turnout Hood" not in by_recipient[("ems@example.org",)]
        assert "Turnout Hood" in by_recipient[("qm@example.org",)]

    async def test_a_holder_of_both_grants_gets_one_complete_email(self, sent):
        """Not two partial ones — the broad grant already covers medical."""
        captured, overview, lots = sent
        overview.return_value = {"items": []}
        self._mixed(lots)

        both = _user_with(
            ["inventory.manage", "inventory.manage_medical"],
            user_id="u-13",
            email="chief@example.org",
        )
        await run_supply_expiration_alerts(_db(users=[both]))

        assert len(captured["all"]) == 1
        body = captured["all"][0]["html_body"]
        assert "Epi 1:1000" in body
        assert "Turnout Hood" in body
