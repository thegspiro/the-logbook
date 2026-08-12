"""
Expiration hand-off between the inventory module and the shift check.

The checklist item on a truck and the stock lot on the shelf both carry an
expiration, and the two have to stay in step: a unit replaced during a check
must update the template it came from, and stock that expired on the shelf must
not be swappable onto an apparatus. These tests cover that hand-off.

Mocked sessions — no DB — so they run in the sandbox.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.equipment_check import update_deployed_lot
from app.models.apparatus import (
    CheckItemDeployedLot,
    CheckTemplateItem,
    TemplateChangeLog,
)
from app.schemas.equipment_check import DeployedLotUpdateRequest
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import InventoryService

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
    def test_found_date_does_not_supersede_template(self, service):
        item = _template_item()
        resolved = service._resolve_expiration(
            {"template_item_id": "ti-1", "expiration_found": NEXT_YEAR}, item
        )
        assert resolved == YESTERDAY

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

    def test_replacement_date_cannot_clear_the_auto_fail(self, service):
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
        assert items[0]["status"] == "fail"
        assert items[0]["is_expired"] is True
        assert items[0]["expiration_date"] == YESTERDAY
        assert (failed, overall) == (1, "fail")

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

    def test_not_applicable_is_complete_without_failing(self, service):
        items = [{"template_item_id": "ti-1", "status": "not_applicable"}]
        total, completed, failed, overall = service._compute_check_status(items)
        assert (total, completed, failed, overall) == (1, 1, 0, "pass")

    def test_out_of_service_is_complete_and_fails_check(self, service):
        items = [{"template_item_id": "ti-1", "status": "out_of_service"}]
        total, completed, failed, overall = service._compute_check_status(items)
        assert (total, completed, failed, overall) == (1, 1, 1, "fail")


class TestTrendOutcomeBuckets:
    def test_new_outcomes_are_not_misreported_as_unchecked(self, service):
        assert service._trend_bucket_for_status("not_applicable") == (
            "not_applicable_count"
        )
        assert service._trend_bucket_for_status("out_of_service") == "fail_count"
        assert service._trend_bucket_for_status("not_checked") == "not_checked_count"


class TestApplyFoundValuesToTemplate:
    def test_expiration_is_not_written_back_to_template(self, service):
        item = _template_item()
        changed = service._apply_found_values_to_template(
            item, lot_found="LOT-77", expiration_found=NEXT_YEAR
        )
        assert changed is True
        assert item.lot_number == "LOT-77"
        assert item.expiration_date == YESTERDAY
        assert item.has_expiration is True

    def test_expiration_does_not_turn_on_tracking_for_an_untracked_item(self, service):
        item = _template_item(has_expiration=False, expiration_date=None)
        assert not service._apply_found_values_to_template(
            item, expiration_found=TOMORROW
        )
        assert item.has_expiration is False
        assert item.expiration_date is None

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
    async def test_a_check_recount_becomes_the_on_truck_figure(self, service, mock_db):
        tmpl_item = _template_item(
            expected_quantity=4, quantity_on_truck=4, restock_needed=False
        )
        items_data = [
            {
                "template_item_id": "ti-1",
                "item_name": "4x4 Gauze",
                "status": "pass",
                "quantity_found": 2,
            }
        ]

        await service._create_check_items(
            "check-1", items_data, {"ti-1": tmpl_item}, "org-1"
        )

        # A crew standing at the compartment counting outranks a running total
        # that has drifted.
        assert tmpl_item.quantity_on_truck == 2

    async def test_a_full_check_count_settles_a_standing_report(self, service, mock_db):
        tmpl_item = _template_item(
            expected_quantity=4,
            quantity_on_truck=1,
            restock_needed=True,
            restock_note="used three",
        )
        items_data = [
            {
                "template_item_id": "ti-1",
                "item_name": "4x4 Gauze",
                "status": "pass",
                "quantity_found": 4,
            }
        ]

        await service._create_check_items(
            "check-1", items_data, {"ti-1": tmpl_item}, "org-1"
        )

        assert tmpl_item.quantity_on_truck == 4
        assert tmpl_item.restock_needed is False

    async def test_an_uncounted_position_ignores_quantity_found(self, service, mock_db):
        tmpl_item = _template_item(required_quantity=None, expected_quantity=None)
        items_data = [
            {
                "template_item_id": "ti-1",
                "item_name": "Halligan",
                "status": "pass",
                "quantity_found": 9,
            }
        ]

        await service._create_check_items(
            "check-1", items_data, {"ti-1": tmpl_item}, "org-1"
        )

        assert tmpl_item.quantity_on_truck is None

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
            "check-1", items_data, {"ti-1": tmpl_item}, "org-1"
        )
        assert tmpl_item.expiration_date == YESTERDAY
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

    async def test_swap_settles_an_outstanding_restock_report(self, service, mock_db):
        item = _template_item(
            inventory_item_id="inv-1",
            restock_needed=True,
            restock_note="used two",
            restock_reported_by="u-9",
        )
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=4,
            lot_number="LOT-NEW",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        result = await service.swap_item_lot("ti-1", "lot-1", "org-1")

        # Fresh stock is in the bracket, so the item must leave the worklist.
        assert item.restock_needed is False
        assert item.restock_note is None
        assert result["restock_needed"] is False

    async def test_restocking_several_draws_them_all_off_the_lot(
        self, service, mock_db
    ):
        item = _template_item(
            inventory_item_id="inv-1",
            expected_quantity=4,
            quantity_on_truck=1,
            restock_needed=True,
        )
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=10,
            lot_number="LOT-NEW",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        result = await service.swap_item_lot("ti-1", "lot-1", "org-1", quantity=3)

        assert lot.quantity == 7
        assert item.quantity_on_truck == 4
        # Back to the target, so the shortfall report is settled.
        assert item.restock_needed is False
        assert result["quantity_on_truck"] == 4

    async def test_a_partial_restock_keeps_the_item_on_the_worklist(
        self, service, mock_db
    ):
        item = _template_item(
            inventory_item_id="inv-1",
            expected_quantity=4,
            quantity_on_truck=0,
            restock_needed=True,
        )
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=2,
            lot_number="LOT-NEW",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        result = await service.swap_item_lot("ti-1", "lot-1", "org-1", quantity=2)

        assert item.quantity_on_truck == 2
        # Still two short: dropping it off the list here would close the gap on
        # paper only.
        assert item.restock_needed is True
        assert result["restock_needed"] is True

    async def test_a_lot_short_of_the_requested_quantity_is_refused(
        self, service, mock_db
    ):
        item = _template_item(inventory_item_id="inv-1", expected_quantity=4)
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=2,
            lot_number="LOT-NEW",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        with pytest.raises(ValueError, match="only 2 on hand"):
            await service.swap_item_lot("ti-1", "lot-1", "org-1", quantity=5)

        assert lot.quantity == 2
        mock_db.commit.assert_not_awaited()

    async def test_a_zero_quantity_restock_is_refused(self, service, mock_db):
        with pytest.raises(ValueError, match="at least 1"):
            await service.swap_item_lot("ti-1", "lot-1", "org-1", quantity=0)

    async def test_units_already_aboard_keep_their_own_date_through_a_swap(
        self, service, mock_db
    ):
        # Regression: the item's columns were overwritten before the existing
        # units were given a row, so they inherited the incoming lot's date —
        # the substitution the deployed-lot table exists to prevent.
        item = _template_item(
            inventory_item_id="inv-1",
            expected_quantity=4,
            quantity_on_truck=2,
            lot_number="OLD-1",
            expiration_date=TOMORROW,
        )
        lot = MagicMock(
            id="lot-1",
            inventory_item_id="inv-1",
            quantity=9,
            lot_number="NEW-1",
            expiration_date=NEXT_YEAR,
        )
        self._wire(mock_db, item, lot)

        await service.swap_item_lot("ti-1", "lot-1", "org-1", quantity=2)

        by_number = {dl.lot_number: dl for dl in item.deployed_lots}
        assert by_number["OLD-1"].expiration_date == TOMORROW
        assert by_number["NEW-1"].expiration_date == NEXT_YEAR
        assert service._on_truck(item) == 4
        # The truck is exposed by its oldest units, not its newest.
        assert service._soonest_expiration(item) == TOMORROW

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


def _deployed(lot_id, quantity, expiration, lot_number=None):
    return CheckItemDeployedLot(
        id=lot_id,
        organization_id="org-1",
        template_item_id="ti-1",
        lot_number=lot_number or lot_id.upper(),
        expiration_date=expiration,
        quantity=quantity,
    )


class TestDeployedLots:
    """A four-slot bracket can hold units from several lots with several dates.
    The count is their sum and the exposure is the earliest of them."""

    def test_count_is_the_sum_of_what_is_aboard(self, service):
        item = _template_item(expected_quantity=4, quantity_on_truck=99)
        item.deployed_lots = [
            _deployed("lot-a", 1, NEXT_YEAR),
            _deployed("lot-b", 2, TOMORROW),
        ]
        # The lots outrank the scalar: they are actual units with actual dates.
        assert service._on_truck(item) == 3
        assert service._is_short(item) is True

    def test_exposure_is_the_soonest_date_aboard(self, service):
        item = _template_item(expiration_date=NEXT_YEAR)
        item.deployed_lots = [
            _deployed("lot-a", 1, NEXT_YEAR),
            _deployed("lot-b", 1, TOMORROW),
        ]
        # Not the newest unit's date — the truck is exposed by its oldest.
        assert service._soonest_expiration(item) == TOMORROW

    def test_undated_lots_sort_last(self, service):
        item = _template_item()
        item.deployed_lots = [
            _deployed("lot-a", 1, None),
            _deployed("lot-b", 1, TOMORROW),
        ]
        assert [lot.id for lot in service._deployed_lots(item)] == ["lot-b", "lot-a"]
        assert service._soonest_expiration(item) == TOMORROW

    def test_empty_lots_are_not_aboard(self, service):
        item = _template_item(expected_quantity=4)
        item.deployed_lots = [
            _deployed("lot-a", 0, TOMORROW),
            _deployed("lot-b", 2, NEXT_YEAR),
        ]
        assert service._on_truck(item) == 2
        # A lot counted to nothing must not keep dragging its date along.
        assert service._soonest_expiration(item) == NEXT_YEAR

    def test_an_item_with_no_lots_keeps_its_own_reading(self, service):
        item = _template_item(expected_quantity=4, quantity_on_truck=3)
        item.deployed_lots = []
        assert service._on_truck(item) == 3
        assert service._soonest_expiration(item) == YESTERDAY

    def test_consumption_draws_from_the_soonest_first(self, service):
        item = _template_item(expected_quantity=4)
        soon = _deployed("lot-a", 2, TOMORROW)
        later = _deployed("lot-b", 2, NEXT_YEAR)
        item.deployed_lots = [later, soon]

        drawn = service._consume_deployed(item, 3)

        assert drawn == 3
        assert soon.quantity == 0
        assert later.quantity == 1

    def test_units_already_aboard_get_a_row_before_the_first_lot_joins(self, service):
        # Without this the lot sum becomes the authority the moment any lot
        # exists, and the three units nobody had recorded a lot for vanish.
        item = _template_item(
            expected_quantity=4, quantity_on_truck=3, lot_number="OLD-1"
        )
        item.deployed_lots = []

        service._materialize_untracked_units(item, "org-1")

        assert len(item.deployed_lots) == 1
        assert item.deployed_lots[0].quantity == 3
        assert item.deployed_lots[0].lot_number == "OLD-1"
        assert item.deployed_lots[0].expiration_date == YESTERDAY

    def test_materializing_is_a_no_op_once_lots_exist(self, service):
        item = _template_item(expected_quantity=4, quantity_on_truck=3)
        item.deployed_lots = [_deployed("lot-a", 2, TOMORROW)]

        service._materialize_untracked_units(item, "org-1")

        assert len(item.deployed_lots) == 1

    def test_an_empty_bracket_gets_no_phantom_row(self, service):
        item = _template_item(expected_quantity=4, quantity_on_truck=0)
        item.deployed_lots = []

        service._materialize_untracked_units(item, "org-1")

        assert item.deployed_lots == []

    def test_a_recount_below_the_record_comes_off_soonest_first(self, service):
        item = _template_item(expected_quantity=4)
        soon = _deployed("lot-a", 2, TOMORROW)
        later = _deployed("lot-b", 2, NEXT_YEAR)
        item.deployed_lots = [later, soon]

        service._reconcile_to_total(item, 3, "org-1")

        assert (soon.quantity, later.quantity) == (1, 2)

    def test_a_recount_above_the_record_lands_in_an_undated_row(self, service):
        item = _template_item(expected_quantity=4)
        item.deployed_lots = [_deployed("lot-a", 2, TOMORROW)]

        service._reconcile_to_total(item, 5, "org-1")

        surplus = [lot for lot in item.deployed_lots if lot.lot_number is None]
        assert len(surplus) == 1
        assert surplus[0].quantity == 3
        # Nobody knows when found stock expires; an undated row says so, and
        # does not flatter the position's soonest-date reading.
        assert surplus[0].expiration_date is None
        assert service._soonest_expiration(item) == TOMORROW

    def test_an_unchanged_recount_touches_nothing(self, service):
        item = _template_item(expected_quantity=4)
        lot = _deployed("lot-a", 2, TOMORROW)
        item.deployed_lots = [lot]

        service._reconcile_to_total(item, 2, "org-1")

        assert (len(item.deployed_lots), lot.quantity) == (1, 2)

    def test_a_lot_drawn_to_nothing_stops_being_aboard(self, service):
        item = _template_item(expected_quantity=4)
        soon = _deployed("lot-a", 2, TOMORROW)
        later = _deployed("lot-b", 2, NEXT_YEAR)
        item.deployed_lots = [soon, later]

        service._consume_deployed(item, 2)

        # Not merely zeroed: a spent lot is no longer on the truck, and the row
        # would otherwise accumulate against every position ever restocked.
        assert item.deployed_lots == [later]

    def test_consuming_more_than_is_aboard_takes_what_there_is(self, service):
        item = _template_item(expected_quantity=4)
        lot = _deployed("lot-a", 1, TOMORROW)
        item.deployed_lots = [lot]

        drawn = service._consume_deployed(item, 5)

        # A correction to the record, not a negative quantity.
        assert (drawn, lot.quantity) == (1, 0)


class TestUpdateDeployedLot:
    """A crew changing a drug out records the new date in the same act, or the
    application keeps asserting an expiration for a box that has left."""

    def _wire(self, mock_db, item):
        result = MagicMock()
        result.first.return_value = (item, "tmpl-1")
        mock_db.execute = AsyncMock(return_value=result)
        mock_db.flush = AsyncMock()

    async def test_a_new_date_and_lot_number_reach_the_record(self, service, mock_db):
        item = _template_item(expected_quantity=2)
        lot = _deployed("dl-1", 2, TOMORROW, lot_number="OLD-1")
        item.deployed_lots = [lot]
        self._wire(mock_db, item)

        await service.update_deployed_lot(
            "ti-1",
            "dl-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            {"quantity": 2, "lot_number": "NEW-9", "expiration_date": NEXT_YEAR},
        )

        assert lot.lot_number == "NEW-9"
        assert lot.expiration_date == NEXT_YEAR
        assert service._soonest_expiration(item) == NEXT_YEAR

    async def test_an_omitted_field_is_left_alone(self, service, mock_db):
        item = _template_item(expected_quantity=4)
        lot = _deployed("dl-1", 4, TOMORROW, lot_number="KEEP-1")
        item.deployed_lots = [lot]
        self._wire(mock_db, item)

        # Correcting only the count must not wipe the date the box carries.
        await service.update_deployed_lot(
            "ti-1",
            "dl-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            {"quantity": 3},
        )

        assert (lot.quantity, lot.lot_number) == (3, "KEEP-1")
        assert lot.expiration_date == TOMORROW

    async def test_an_explicit_null_clears_the_date(self, service, mock_db):
        item = _template_item(expected_quantity=2)
        lot = _deployed("dl-1", 2, TOMORROW)
        item.deployed_lots = [lot]
        self._wire(mock_db, item)

        await service.update_deployed_lot(
            "ti-1",
            "dl-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            {"quantity": 2, "expiration_date": None},
        )

        assert lot.expiration_date is None

    async def test_zero_takes_the_lot_off_the_truck(self, service, mock_db):
        item = _template_item(expected_quantity=2)
        gone = _deployed("dl-1", 1, TOMORROW)
        kept = _deployed("dl-2", 1, NEXT_YEAR)
        item.deployed_lots = [gone, kept]
        self._wire(mock_db, item)

        await service.update_deployed_lot(
            "ti-1",
            "dl-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            {"quantity": 0},
        )

        assert item.deployed_lots == [kept]
        # The removed lot stops driving the position's exposure.
        assert service._soonest_expiration(item) == NEXT_YEAR

    async def test_an_unknown_lot_is_not_found(self, service, mock_db):
        item = _template_item()
        item.deployed_lots = []
        self._wire(mock_db, item)

        result = await service.update_deployed_lot(
            "ti-1", "nope", "org-1", MagicMock(), {"quantity": 1}
        )

        assert result is None


class TestUpdateDeployedLotAuthorization:
    """Counts are crew corrections; compliance metadata is privileged."""

    @staticmethod
    def _user():
        return MagicMock(organization_id="org-1")

    async def test_submitter_cannot_rewrite_expiration(self, mock_db):
        with patch(
            "app.api.v1.endpoints.equipment_check._collect_user_permissions",
            return_value={"equipment_check.submit"},
        ):
            with pytest.raises(HTTPException) as exc:
                await update_deployed_lot(
                    "ti-1",
                    "dl-1",
                    DeployedLotUpdateRequest(
                        quantity=1, expiration_date=date(2099, 1, 1)
                    ),
                    mock_db,
                    self._user(),
                )

        assert exc.value.status_code == 403

    async def test_submitter_can_still_correct_quantity(self, mock_db):
        with (
            patch(
                "app.api.v1.endpoints.equipment_check._collect_user_permissions",
                return_value={"equipment_check.submit"},
            ),
            patch(
                "app.api.v1.endpoints.equipment_check.EquipmentCheckService"
            ) as service_class,
        ):
            service_class.return_value.update_deployed_lot = AsyncMock(
                return_value={"lots": []}
            )
            await update_deployed_lot(
                "ti-1",
                "dl-1",
                DeployedLotUpdateRequest(quantity=1),
                mock_db,
                self._user(),
            )

        service_class.return_value.update_deployed_lot.assert_awaited_once()

    async def test_inventory_manager_can_rewrite_expiration(self, mock_db):
        with (
            patch(
                "app.api.v1.endpoints.equipment_check._collect_user_permissions",
                return_value={"inventory.manage"},
            ),
            patch(
                "app.api.v1.endpoints.equipment_check.EquipmentCheckService"
            ) as service_class,
        ):
            service_class.return_value.update_deployed_lot = AsyncMock(
                return_value={"lots": []}
            )
            await update_deployed_lot(
                "ti-1",
                "dl-1",
                DeployedLotUpdateRequest(quantity=1, expiration_date=None),
                mock_db,
                self._user(),
            )

        updates = service_class.return_value.update_deployed_lot.await_args.kwargs[
            "updates"
        ]
        assert updates == {"quantity": 1, "expiration_date": None}


class TestUnitLabels:
    """ "2/4" does not say whether a crew is looking for boxes or gloves."""

    async def test_labels_come_from_the_linked_catalog_item(self, service, mock_db):
        linked = _template_item(id="ti-1", inventory_item_id="inv-1")
        unlinked = _template_item(id="ti-2", inventory_item_id=None)
        result = MagicMock()
        result.all.return_value = [("inv-1", "Box")]
        mock_db.execute = AsyncMock(return_value=result)

        await service._attach_unit_labels("org-1", [linked, unlinked])

        assert linked.unit_of_measure == "Box"
        assert unlinked.unit_of_measure is None

    async def test_a_foreign_item_resolves_to_no_label(self, service, mock_db):
        # EC2-4: the org-scoped lookup returns nothing for another org's item,
        # so its label never renders here.
        item = _template_item(inventory_item_id="other-org-item")
        result = MagicMock()
        result.all.return_value = []
        mock_db.execute = AsyncMock(return_value=result)

        await service._attach_unit_labels("org-1", [item])

        assert item.unit_of_measure is None

    async def test_nothing_linked_skips_the_query(self, service, mock_db):
        mock_db.execute = AsyncMock()

        await service._attach_unit_labels("org-1", [_template_item()])

        mock_db.execute.assert_not_awaited()


class TestApparatusInventory:
    """The standing view: what a truck carries, read at any hour, no check."""

    def _wire(self, mock_db, rows, units=(), apparatus=MagicMock(id="app-1")):
        """Rows first, then the unit-label lookup that follows it."""
        rows_result = MagicMock()
        rows_result.all.return_value = rows
        units_result = MagicMock()
        units_result.all.return_value = list(units)
        mock_db.scalar = AsyncMock(return_value=apparatus)
        mock_db.execute = AsyncMock(side_effect=[rows_result, units_result])

    def _compartment(self, name="Compartment 1", cid="c-1"):
        compartment = MagicMock(id=cid)
        compartment.name = name
        return compartment

    async def test_unknown_apparatus_returns_empty(self, service, mock_db):
        mock_db.scalar = AsyncMock(return_value=None)

        assert await service.get_apparatus_inventory("app-1", "org-1") == {}

    async def test_items_are_grouped_by_compartment(self, service, mock_db):
        template = MagicMock(id="tmpl-1")
        first = self._compartment("Front Bumper", "c-1")
        second = self._compartment("Officer Side", "c-2")
        self._wire(
            mock_db,
            [
                (_template_item(id="ti-1"), first, template),
                (_template_item(id="ti-2"), first, template),
                (_template_item(id="ti-3"), second, template),
            ],
        )

        result = await service.get_apparatus_inventory("app-1", "org-1")

        assert [c["compartment_name"] for c in result["compartments"]] == [
            "Front Bumper",
            "Officer Side",
        ]
        assert len(result["compartments"][0]["items"]) == 2

    async def test_headers_and_free_text_are_left_out(self, service, mock_db):
        template = MagicMock(id="tmpl-1")
        compartment = self._compartment()
        self._wire(
            mock_db,
            [
                (_template_item(id="ti-1", check_type="header"), compartment, template),
                (_template_item(id="ti-2", check_type="text"), compartment, template),
                (_template_item(id="ti-3"), compartment, template),
            ],
        )

        result = await service.get_apparatus_inventory("app-1", "org-1")

        # Checklist scaffolding is not something anyone stocks.
        assert len(result["compartments"]) == 1
        assert [i["template_item_id"] for i in result["compartments"][0]["items"]] == [
            "ti-3"
        ]

    async def test_a_restock_report_is_carried_through(self, service, mock_db):
        template = MagicMock(id="tmpl-1")
        item = _template_item(restock_needed=True, restock_note="used two")
        self._wire(mock_db, [(item, self._compartment(), template)])

        result = await service.get_apparatus_inventory("app-1", "org-1")

        row = result["compartments"][0]["items"][0]
        assert row["restock_needed"] is True
        assert row["restock_note"] == "used two"

    async def test_expired_shelf_stock_is_not_offered_as_a_replacement(
        self, service, mock_db
    ):
        template = MagicMock(id="tmpl-1")
        item = _template_item(inventory_item_id="inv-1")
        self._wire(
            mock_db, [(item, self._compartment(), template)], units=[("inv-1", "Box")]
        )

        fresh = MagicMock(id="lot-1", quantity=5, expiration_date=NEXT_YEAR)
        stale = MagicMock(id="lot-2", quantity=9, expiration_date=YESTERDAY)
        with patch.object(
            InventoryService,
            "get_lots_for_items",
            new_callable=AsyncMock,
            return_value={"inv-1": [fresh, stale]},
        ):
            result = await service.get_apparatus_inventory("app-1", "org-1")

        row = result["compartments"][0]["items"][0]
        # The swap refuses expired stock, so offering it here would only invite
        # a swap that fails.
        assert row["ready_stock"] == 5
        assert [lot["id"] for lot in row["ready_lots"]] == ["lot-1"]
        assert row["unit_of_measure"] == "Box"


class TestReportItemUsed:
    """A crew records consumption when it happens, rather than leaving the gap
    for the next morning's check to discover."""

    def _wire(self, service, mock_db, item):
        result = MagicMock()
        result.first.return_value = (item, "tmpl-1")
        mock_db.execute = AsyncMock(return_value=result)
        mock_db.flush = AsyncMock()

    async def test_report_records_who_what_and_when(self, service, mock_db):
        item = _template_item()
        self._wire(service, mock_db, item)
        user = MagicMock(id="u-1", first_name="Dana", last_name="Reed")

        result = await service.report_item_used(
            "ti-1", "org-1", user, note="  used two on a call  "
        )

        assert item.restock_needed is True
        assert item.restock_reported_by == "u-1"
        assert item.restock_reported_at is not None
        assert item.restock_note == "used two on a call"
        assert result["restock_needed"] is True
        mock_db.commit.assert_awaited_once()

    async def test_a_blank_note_is_stored_as_null_not_empty(self, service, mock_db):
        item = _template_item()
        self._wire(service, mock_db, item)

        await service.report_item_used(
            "ti-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            note="   ",
        )

        assert item.restock_note is None

    async def test_report_is_logged_against_the_template(self, service, mock_db):
        item = _template_item()
        self._wire(service, mock_db, item)
        user = MagicMock(id="u-1", first_name="Dana", last_name="Reed")

        await service.report_item_used("ti-1", "org-1", user)

        entries = [
            call.args[0]
            for call in mock_db.add.call_args_list
            if isinstance(call.args[0], TemplateChangeLog)
        ]
        assert [e.action for e in entries] == ["restock_needed"]
        assert entries[0].user_name == "Dana Reed"

    async def test_a_foreign_item_is_not_found(self, service, mock_db):
        result = MagicMock()
        result.first.return_value = None
        mock_db.execute = AsyncMock(return_value=result)

        assert await service.report_item_used("ti-1", "org-1", MagicMock()) is None
        mock_db.commit.assert_not_awaited()

    async def test_clearing_drops_the_whole_report(self, service, mock_db):
        item = _template_item(
            restock_needed=True,
            restock_note="used two",
            restock_reported_by="u-9",
        )
        self._wire(service, mock_db, item)

        await service.clear_item_restock(
            "ti-1", "org-1", MagicMock(id="u-1", first_name="A", last_name="B")
        )

        # Leaving the reporter or note behind would misattribute the next report.
        assert item.restock_needed is False
        assert item.restock_note is None
        assert item.restock_reported_by is None
        assert item.restock_reported_at is None


class TestQuantityOnTruck:
    """The live count: how many are aboard, as against how many should be."""

    def _wire(self, mock_db, item):
        result = MagicMock()
        result.first.return_value = (item, "tmpl-1")
        mock_db.execute = AsyncMock(return_value=result)
        mock_db.flush = AsyncMock()

    def test_an_uncounted_item_reads_as_its_target(self, service):
        item = _template_item(expected_quantity=4, quantity_on_truck=None)
        # NULL means nobody has counted, not that the bracket is empty.
        assert service._on_truck(item) == 4
        assert service._is_short(item) is False

    def test_required_quantity_outranks_expected(self, service):
        item = _template_item(required_quantity=6, expected_quantity=4)
        assert service._target_quantity(item) == 6

    def test_a_position_with_no_target_is_never_short(self, service):
        item = _template_item(required_quantity=None, expected_quantity=None)
        assert service._target_quantity(item) is None
        assert service._is_short(item) is False

    async def test_use_takes_the_count_down_and_reports_it(self, service, mock_db):
        item = _template_item(expected_quantity=4, quantity_on_truck=4)
        self._wire(mock_db, item)
        user = MagicMock(id="u-1", first_name="Dana", last_name="Reed")

        result = await service.report_item_used("ti-1", "org-1", user, quantity_used=2)

        assert item.quantity_on_truck == 2
        assert result["quantity_on_truck"] == 2
        assert result["is_short"] is True
        assert item.restock_needed is True

    async def test_use_floors_at_zero(self, service, mock_db):
        item = _template_item(expected_quantity=4, quantity_on_truck=1)
        self._wire(mock_db, item)

        # A crew reporting more than the record held is telling you the record
        # was wrong; a negative count is not a fact about any truck.
        await service.report_item_used(
            "ti-1",
            "org-1",
            MagicMock(id="u-1", first_name="A", last_name="B"),
            quantity_used=5,
        )

        assert item.quantity_on_truck == 0

    async def test_use_without_a_quantity_leaves_the_count_alone(
        self, service, mock_db
    ):
        item = _template_item(expected_quantity=4, quantity_on_truck=4)
        self._wire(mock_db, item)

        await service.report_item_used(
            "ti-1", "org-1", MagicMock(id="u-1", first_name="A", last_name="B")
        )

        assert item.quantity_on_truck == 4
        assert item.restock_needed is True

    async def test_recount_settles_a_report_once_the_truck_is_full(
        self, service, mock_db
    ):
        item = _template_item(
            expected_quantity=4, quantity_on_truck=1, restock_needed=True
        )
        self._wire(mock_db, item)

        result = await service.set_item_quantity(
            "ti-1", "org-1", MagicMock(id="u-1", first_name="A", last_name="B"), 4
        )

        assert item.quantity_on_truck == 4
        assert item.restock_needed is False
        assert result["is_short"] is False

    async def test_a_partial_recount_leaves_the_report_standing(self, service, mock_db):
        item = _template_item(
            expected_quantity=4, quantity_on_truck=0, restock_needed=True
        )
        self._wire(mock_db, item)

        await service.set_item_quantity(
            "ti-1", "org-1", MagicMock(id="u-1", first_name="A", last_name="B"), 2
        )

        # Two of four back is still a truck that is short two.
        assert item.restock_needed is True

    async def test_a_recount_reaches_a_lot_carrying_position(self, service, mock_db):
        # Regression: the scalar was written and the lot sum kept being read,
        # so a recount on a lot-carrying position vanished without a word.
        item = _template_item(expected_quantity=4, restock_needed=True)
        item.deployed_lots = [_deployed("lot-a", 4, TOMORROW)]
        self._wire(mock_db, item)

        result = await service.set_item_quantity(
            "ti-1", "org-1", MagicMock(id="u-1", first_name="A", last_name="B"), 2
        )

        assert service._on_truck(item) == 2
        assert result["quantity_on_truck"] == 2
        assert result["is_short"] is True

    async def test_recount_rejects_a_negative(self, service, mock_db):
        with pytest.raises(ValueError, match="negative"):
            await service.set_item_quantity("ti-1", "org-1", MagicMock(), -1)

    async def test_recount_rejects_an_uncounted_position(self, service, mock_db):
        item = _template_item(required_quantity=None, expected_quantity=None)
        self._wire(mock_db, item)

        with pytest.raises(ValueError, match="does not carry a quantity"):
            await service.set_item_quantity("ti-1", "org-1", MagicMock(), 3)


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
