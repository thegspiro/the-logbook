"""
Expiration hand-off between the inventory module and the shift check.

The checklist item on a truck and the stock lot on the shelf both carry an
expiration, and the two have to stay in step: a unit replaced during a check
must update the template it came from, and stock that expired on the shelf must
not be swappable onto an apparatus. These tests cover that hand-off.

Mocked sessions — no DB — so they run in the sandbox.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.apparatus import CheckTemplateItem, TemplateChangeLog
from app.services.equipment_check_service import EquipmentCheckService

YESTERDAY = date.today() - timedelta(days=1)
TOMORROW = date.today() + timedelta(days=1)
NEXT_YEAR = date.today() + timedelta(days=365)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


def _template_item(**kwargs) -> CheckTemplateItem:
    defaults = {
        "id": "ti-1",
        "compartment_id": "comp-1",
        "name": "4x4 Gauze",
        "check_type": "date_lot",
        "has_expiration": True,
        "expiration_date": YESTERDAY,
    }
    defaults.update(kwargs)
    return CheckTemplateItem(**defaults)


class TestResolveExpiration:
    def test_found_date_supersedes_template(self, service):
        item = _template_item()
        resolved = service._resolve_expiration(
            {"template_item_id": "ti-1", "expiration_found": NEXT_YEAR}, item
        )
        assert resolved == NEXT_YEAR

    def test_template_beats_client_supplied_date(self, service):
        item = _template_item()
        resolved = service._resolve_expiration(
            {"template_item_id": "ti-1", "expiration_date": NEXT_YEAR}, item
        )
        assert resolved == YESTERDAY

    def test_untracked_template_item_has_no_expiration(self, service):
        item = _template_item(has_expiration=False)
        resolved = service._resolve_expiration(
            {"template_item_id": "ti-1", "expiration_date": YESTERDAY}, item
        )
        assert resolved is None

    def test_falls_back_to_client_value_without_a_template_item(self, service):
        resolved = service._resolve_expiration({"expiration_date": YESTERDAY}, None)
        assert resolved == YESTERDAY


class TestComputeCheckStatus:
    """Expiry decides whether a safety-critical item is force-failed, so it is
    recomputed from the department's own record rather than trusted from the
    submitted flag."""

    def test_expired_template_item_fails_despite_client_claim(self, service):
        items = [
            {
                "template_item_id": "ti-1",
                "status": "pass",
                "is_expired": False,
            }
        ]
        total, completed, failed, overall = service._compute_check_status(
            items, {"ti-1": _template_item()}
        )
        assert items[0]["status"] == "fail"
        assert items[0]["is_expired"] is True
        assert (total, completed, failed, overall) == (1, 1, 1, "fail")

    def test_replacement_date_clears_the_auto_fail(self, service):
        items = [
            {
                "template_item_id": "ti-1",
                "status": "pass",
                "expiration_found": NEXT_YEAR,
            }
        ]
        _, _, failed, overall = service._compute_check_status(
            items, {"ti-1": _template_item()}
        )
        assert items[0]["status"] == "pass"
        assert items[0]["is_expired"] is False
        assert items[0]["expiration_date"] == NEXT_YEAR
        assert (failed, overall) == (0, "pass")

    def test_item_expiring_today_is_not_yet_expired(self, service):
        items = [{"template_item_id": "ti-1", "status": "pass"}]
        service._compute_check_status(
            items, {"ti-1": _template_item(expiration_date=date.today())}
        )
        assert items[0]["is_expired"] is False
        assert items[0]["status"] == "pass"

    def test_client_flag_ignored_when_template_item_is_in_date(self, service):
        items = [
            {"template_item_id": "ti-1", "status": "pass", "is_expired": True},
        ]
        _, _, failed, overall = service._compute_check_status(
            items, {"ti-1": _template_item(expiration_date=NEXT_YEAR)}
        )
        assert items[0]["status"] == "pass"
        assert (failed, overall) == (0, "pass")

    def test_under_quantity_still_fails(self, service):
        items = [
            {
                "template_item_id": "ti-1",
                "status": "pass",
                "required_quantity": 4,
                "quantity_found": 2,
            }
        ]
        _, _, failed, overall = service._compute_check_status(
            items, {"ti-1": _template_item(has_expiration=False)}
        )
        assert (failed, overall) == (1, "fail")


class TestApplyFoundValuesToTemplate:
    def test_expiration_written_back_to_template(self, service):
        item = _template_item()
        changed = service._apply_found_values_to_template(
            item, lot_found="LOT-77", expiration_found=NEXT_YEAR
        )
        assert changed is True
        assert item.lot_number == "LOT-77"
        assert item.expiration_date == NEXT_YEAR
        assert item.has_expiration is True

    def test_expiration_turns_on_tracking_for_an_untracked_item(self, service):
        item = _template_item(has_expiration=False, expiration_date=None)
        assert service._apply_found_values_to_template(item, expiration_found=TOMORROW)
        assert item.has_expiration is True
        assert item.expiration_date == TOMORROW

    def test_unchanged_values_do_not_flag_an_update(self, service):
        item = _template_item(lot_number="LOT-1")
        changed = service._apply_found_values_to_template(
            item, lot_found="LOT-1", expiration_found=YESTERDAY
        )
        assert changed is False

    def test_missing_template_item_is_a_no_op(self, service):
        assert (
            service._apply_found_values_to_template(None, expiration_found=NEXT_YEAR)
            is False
        )


class TestCreateCheckItems:
    async def test_submitted_expiration_reaches_the_template(self, service, mock_db):
        tmpl_item = _template_item()
        items_data = [
            {
                "template_item_id": "ti-1",
                "item_name": "4x4 Gauze",
                "status": "pass",
                "lot_found": "LOT-77",
                "expiration_found": NEXT_YEAR,
            }
        ]
        created = await service._create_check_items(
            "check-1", items_data, {"ti-1": tmpl_item}
        )
        assert tmpl_item.expiration_date == NEXT_YEAR
        assert created[0].expiration_found == NEXT_YEAR
        # Flags the result so the report shows the truck's record was changed.
        assert created[0].updated_serial is True


class TestSwapItemLot:
    """Ready stock that expired on the shelf is not a replacement — deploying
    it would fail the item on the very next check."""

    def _wire(self, mock_db, item, lot):
        result = MagicMock()
        result.first.return_value = (item, "tmpl-1")
        mock_db.execute = AsyncMock(return_value=result)
        mock_db.scalar = AsyncMock(return_value=lot)
        mock_db.flush = AsyncMock()

    async def test_expired_lot_is_refused(self, service, mock_db):
        item = _template_item(inventory_item_id="inv-1")
        lot = MagicMock(
            inventory_item_id="inv-1", quantity=5, expiration_date=YESTERDAY
        )
        self._wire(mock_db, item, lot)

        with pytest.raises(ValueError, match="expired"):
            await service.swap_item_lot("ti-1", "lot-1", "org-1")

        assert lot.quantity == 5
        mock_db.commit.assert_not_awaited()

    async def test_in_date_lot_is_deployed(self, service, mock_db):
        item = _template_item(inventory_item_id="inv-1")
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=5,
            lot_number="LOT-9",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        result = await service.swap_item_lot("ti-1", "lot-1", "org-1")

        assert lot.quantity == 4
        assert item.expiration_date == NEXT_YEAR
        assert item.lot_number == "LOT-9"
        assert result["expiration_date"] == NEXT_YEAR

    async def test_lot_without_an_expiration_is_allowed(self, service, mock_db):
        item = _template_item(inventory_item_id="inv-1")
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=2,
            lot_number="LOT-3",
            expiration_date=None,
        )
        self._wire(mock_db, item, lot)

        await service.swap_item_lot("ti-1", "lot-1", "org-1")
        assert lot.quantity == 1

    async def test_swap_is_recorded_in_the_template_changelog(self, service, mock_db):
        item = _template_item(inventory_item_id="inv-1", lot_number="LOT-OLD")
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=3,
            lot_number="LOT-NEW",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)
        user = MagicMock(id="u-1", first_name="Dana", last_name="Reed")

        await service.swap_item_lot("ti-1", "lot-1", "org-1", user=user)

        entries = [
            call.args[0]
            for call in mock_db.add.call_args_list
            if isinstance(call.args[0], TemplateChangeLog)
        ]
        assert len(entries) == 1
        assert entries[0].action == "swap"
        assert entries[0].user_name == "Dana Reed"
        # Both sides recorded: a lot number appearing on a truck with no prior
        # value and no source lot is not an audit trail.
        assert entries[0].changes["from"]["lot_number"] == "LOT-OLD"
        assert entries[0].changes["to"]["lot_number"] == "LOT-NEW"
        assert entries[0].changes["inventory_lot_id"] == "lot-1"

    async def test_swap_without_a_user_still_succeeds(self, service, mock_db):
        item = _template_item(inventory_item_id="inv-1")
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=1,
            lot_number="LOT-9",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        await service.swap_item_lot("ti-1", "lot-1", "org-1")

        assert not [
            call.args[0]
            for call in mock_db.add.call_args_list
            if isinstance(call.args[0], TemplateChangeLog)
        ]


class TestItemDeployments:
    """The supply link read from the item's side — which trucks carry this."""

    async def test_rows_carry_apparatus_and_expiry(self, service, mock_db):
        item = _template_item(lot_number="LOT-2")
        compartment_name = "Compartment 1"
        template = MagicMock(id="tmpl-1", apparatus_id="app-1", apparatus_type=None)
        template.name = "Engine 1 Daily"

        rows = MagicMock()
        rows.all.return_value = [(item, compartment_name, template)]
        names = MagicMock()
        names.all.return_value = [("app-1", "Engine 1")]
        mock_db.execute = AsyncMock(side_effect=[rows, names])

        result = await service.get_item_deployments("inv-1", "org-1")

        assert len(result) == 1
        assert result[0]["apparatus_name"] == "Engine 1"
        assert result[0]["compartment_name"] == "Compartment 1"
        assert result[0]["lot_number"] == "LOT-2"
        assert result[0]["is_expired"] is True

    async def test_untracked_expiration_is_not_reported_as_expired(
        self, service, mock_db
    ):
        item = _template_item(has_expiration=False)
        template = MagicMock(id="tmpl-1", apparatus_id=None, apparatus_type="engine")
        template.name = "Engine Daily"

        rows = MagicMock()
        rows.all.return_value = [(item, "Compartment 1", template)]
        mock_db.execute = AsyncMock(side_effect=[rows])

        result = await service.get_item_deployments("inv-1", "org-1")

        assert result[0]["expiration_date"] is None
        assert result[0]["is_expired"] is False
        # A type-level template names no vehicle; the type keeps the row usable.
        assert result[0]["apparatus_type"] == "engine"

    async def test_no_deployments_returns_empty(self, service, mock_db):
        rows = MagicMock()
        rows.all.return_value = []
        mock_db.execute = AsyncMock(return_value=rows)

        assert await service.get_item_deployments("inv-1", "org-1") == []


class TestCloneCompartment:
    async def test_clone_keeps_the_inventory_link(self, service, mock_db):
        source = MagicMock()
        source.name = "Compartment 1"
        source.items = [_template_item(inventory_item_id="inv-1")]
        source.children = []
        mock_db.flush = AsyncMock()

        await service._clone_compartment("tmpl-2", source, None)

        cloned_items = [
            call.args[0]
            for call in mock_db.add.call_args_list
            if isinstance(call.args[0], CheckTemplateItem)
        ]
        assert len(cloned_items) == 1
        # Without the link the clone loses ready-stock tracking and lot swaps,
        # which is exactly how a second engine gets stood up.
        assert cloned_items[0].inventory_item_id == "inv-1"
        assert cloned_items[0].expiration_date == YESTERDAY
