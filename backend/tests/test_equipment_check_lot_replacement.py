"""Replacing expired stock has to take the expired unit off the truck.

``swap_item_lot`` only ever appended the incoming lot, and a position's
exposure is read from ``deployed_lots`` rather than from the scalar
``expiration_date`` the swap rewrote. So an item whose bracket held an expired
box was still EXPIRED — force-failed, Pass disabled — the instant after the
crew was told fresh stock had been swapped in, and the form offered no way to
retire the old row.

What becomes of the removed unit differs by department: destroyed on the spot,
handed straight back to the supplying pharmacy, or pulled off the truck for
somebody to exchange days later. All three take it off the apparatus, so the
removal is unconditional and the disposition is recorded rather than assumed.

Mocked session — no MySQL.
"""

import inspect
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.equipment_check_service import EquipmentCheckService

TODAY = date.today()


def _deployed(lot_id, number, days, quantity=1):
    return SimpleNamespace(
        id=lot_id,
        inventory_lot_id=f"inv-{lot_id}",
        lot_number=number,
        expiration_date=TODAY + timedelta(days=days),
        quantity=quantity,
    )


@pytest.fixture
def item():
    return SimpleNamespace(
        id="ti-1",
        name="Epinephrine 1mg",
        inventory_item_id="inv-item-1",
        lot_number="OLD-1",
        expiration_date=TODAY - timedelta(days=10),
        has_expiration=True,
        restock_needed=False,
        quantity_on_truck=1,
        required_quantity=None,
        expected_quantity=None,
        deployed_lots=[_deployed("dl-expired", "OLD-1", -10)],
    )


@pytest.fixture
def fresh_lot():
    return SimpleNamespace(
        id="inv-lot-fresh",
        organization_id="org-1",
        inventory_item_id="inv-item-1",
        lot_number="NEW-9",
        expiration_date=TODAY + timedelta(days=400),
        quantity=6,
    )


@pytest.fixture
def service(item, fresh_lot):
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.scalar = AsyncMock(return_value=fresh_lot)
    svc = EquipmentCheckService(db)
    svc._get_item_with_template = AsyncMock(return_value=(item, "tmpl-1"))
    svc._materialize_untracked_units = MagicMock()
    svc._sync_restock_after_restocking = MagicMock()
    svc.log_template_change = AsyncMock()
    return svc


async def _swap(service, **kwargs):
    return await service.swap_item_lot(
        template_item_id="ti-1",
        inventory_lot_id="inv-lot-fresh",
        organization_id="org-1",
        **kwargs,
    )


class TestReplacingExpiredStock:
    async def test_the_replaced_lot_leaves_the_apparatus(self, service, item):
        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="discarded",
        )

        assert [lot.lot_number for lot in item.deployed_lots] == ["NEW-9"]

    async def test_the_position_is_no_longer_exposed_by_the_old_date(
        self, service, item
    ):
        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="returned_for_exchange",
        )

        assert EquipmentCheckService._soonest_expiration(item) > TODAY

    async def test_the_response_carries_the_lots_now_aboard(self, service):
        result = await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="discarded",
        )

        assert [lot["lot_number"] for lot in result["lots_aboard"]] == ["NEW-9"]
        assert result["lots_aboard"][0]["is_expired"] is False

    @pytest.mark.parametrize(
        "disposition",
        ["discarded", "returned_for_exchange", "awaiting_exchange"],
    )
    async def test_every_disposition_is_recorded_against_the_removed_lot(
        self, service, disposition
    ):
        result = await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition=disposition,
        )

        assert result["disposition"] == disposition
        assert result["replaced_lot_number"] == "OLD-1"

    # A unit pulled for somebody else to exchange later exists nowhere else:
    # it is off the truck and owed back, and the changelog is the only record.
    async def test_the_changelog_names_the_lot_and_what_became_of_it(self, service):
        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="awaiting_exchange",
            user=SimpleNamespace(id="u-1", first_name="Dana", last_name="Reyes"),
        )

        changes = service.log_template_change.await_args.kwargs["changes"]
        assert changes["replaced_deployed_lot_id"] == "dl-expired"
        assert changes["replaced_lot_number"] == "OLD-1"
        assert changes["disposition"] == "awaiting_exchange"


class TestAPositionWhoseUnitsWereNeverLotTracked:
    """There is no lot id to name — the units aboard are one blob with one date.

    ``_materialize_untracked_units`` gives that blob a row on the way through
    this swap, so the row the crew means did not exist when their client read
    the template. Reporting a disposition is what marks the swap a replacement.
    """

    @pytest.fixture
    def item(self):
        return SimpleNamespace(
            id="ti-1",
            name="Epinephrine 1mg",
            inventory_item_id="inv-item-1",
            lot_number="OLD-1",
            expiration_date=TODAY - timedelta(days=10),
            has_expiration=True,
            restock_needed=False,
            quantity_on_truck=1,
            required_quantity=1,
            expected_quantity=1,
            deployed_lots=[],
        )

    async def test_the_expired_blob_is_retired_without_naming_a_lot(
        self, service, item
    ):
        # Stand in for the real materializer, which is mocked out above.
        item.deployed_lots.append(_deployed("dl-materialized", "OLD-1", -10))

        await _swap(service, disposition="awaiting_exchange")

        assert [lot.lot_number for lot in item.deployed_lots] == ["NEW-9"]

    async def test_the_disposition_still_reaches_the_changelog(self, service, item):
        item.deployed_lots.append(_deployed("dl-materialized", "OLD-1", -10))

        result = await _swap(
            service,
            disposition="awaiting_exchange",
            user=SimpleNamespace(id="u-1", first_name="Dana", last_name="Reyes"),
        )

        assert result["disposition"] == "awaiting_exchange"
        changes = service.log_template_change.await_args.kwargs["changes"]
        assert changes["disposition"] == "awaiting_exchange"

    async def test_in_date_stock_is_never_retired_by_a_disposition(self, service, item):
        item.deployed_lots.append(_deployed("dl-good", "GOOD-2", 200))

        with pytest.raises(ValueError, match="no expired stock"):
            await _swap(service, disposition="discarded")

    # One unit in, one unit out, and the one that goes is the one that expired
    # first. Two expired boxes are two exchanges, so the later of them stays
    # aboard — keeping the position expired, which is true: there is still an
    # expired box in the bag.
    async def test_one_swapped_unit_retires_the_earliest_expiring(self, service, item):
        item.deployed_lots.append(_deployed("dl-old-a", "OLD-1", -10))
        item.deployed_lots.append(_deployed("dl-old-b", "OLD-2", -40))

        await _swap(service, disposition="discarded")

        assert sorted(lot.lot_number for lot in item.deployed_lots) == [
            "NEW-9",
            "OLD-1",
        ]

    # The rows come back from the database in no defined order, so retiring the
    # first one handed over could leave last month's box aboard and take one
    # expiring next week.
    async def test_the_order_rows_arrive_in_does_not_decide_which_goes(
        self, service, item
    ):
        item.deployed_lots.append(_deployed("dl-recent", "RECENT", -1))
        item.deployed_lots.append(_deployed("dl-ancient", "ANCIENT", -400))

        await _swap(service, disposition="discarded")

        assert "ANCIENT" not in [lot.lot_number for lot in item.deployed_lots]

    async def test_a_multi_unit_swap_retires_that_many(self, service, item):
        item.deployed_lots.append(_deployed("dl-old-a", "OLD-1", -10))
        item.deployed_lots.append(_deployed("dl-old-b", "OLD-2", -40))

        await _swap(service, disposition="discarded", quantity=2)

        assert [lot.lot_number for lot in item.deployed_lots] == ["NEW-9"]

    # The incoming lot can never itself be expired — deploying expired stock is
    # refused outright, one guard above — so the units this swap puts aboard
    # cannot be caught by the sweep that retires the expired ones.
    async def test_expired_ready_stock_is_refused_before_any_of_this(
        self, service, fresh_lot
    ):
        fresh_lot.expiration_date = TODAY - timedelta(days=1)

        with pytest.raises(ValueError, match="has expired and cannot be deployed"):
            await _swap(service, disposition="discarded")


class TestUnitsRatherThanRows:
    """A bracket holding four boxes of one lot is one row with a quantity.

    Dropping that row to swap a single box deleted the three still in the bag,
    recorded them all as disposed of, and left the position reading three short
    of a par it actually met.
    """

    async def test_replacing_one_box_leaves_the_rest_of_its_lot_aboard(
        self, service, item
    ):
        item.deployed_lots[0].quantity = 4

        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="discarded",
        )

        remaining = next(lot for lot in item.deployed_lots if lot.lot_number == "OLD-1")
        assert remaining.quantity == 3

    async def test_the_row_goes_once_its_last_unit_does(self, service, item):
        item.deployed_lots[0].quantity = 2

        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="discarded",
            quantity=2,
        )

        assert [lot.lot_number for lot in item.deployed_lots] == ["NEW-9"]

    async def test_taking_more_than_the_lot_holds_empties_it_not_negative(
        self, service, item
    ):
        item.deployed_lots[0].quantity = 1

        await _swap(
            service,
            replaced_deployed_lot_id="dl-expired",
            disposition="discarded",
            quantity=3,
        )

        assert [lot.lot_number for lot in item.deployed_lots] == ["NEW-9"]


class TestOnlyExpiredStockIsReplaceable:
    """The form offers a replacement only on a position reading expired, but
    that is a property of the screen and not of the API — and the disposition
    this records is specifically an expired-stock one."""

    async def test_an_in_date_lot_cannot_be_retired_under_a_disposition(
        self, service, item
    ):
        item.deployed_lots.append(_deployed("dl-good", "GOOD-2", 200))

        with pytest.raises(ValueError, match="has not expired"):
            await _swap(
                service,
                replaced_deployed_lot_id="dl-good",
                disposition="discarded",
            )

    async def test_a_lot_with_no_date_at_all_cannot_be_retired(self, service, item):
        undated = _deployed("dl-undated", "NODATE", 0)
        undated.expiration_date = None
        item.deployed_lots.append(undated)

        with pytest.raises(ValueError, match="has not expired"):
            await _swap(
                service,
                replaced_deployed_lot_id="dl-undated",
                disposition="discarded",
            )


class TestLinkingAPositionToTheCatalog:
    """The first swap binds a checklist row to a catalog item, permanently.

    That decision has its own manage-only screen. Left open to submitters, the
    swap endpoint was a way around it: attach any catalog item to any row and
    draw its stock.
    """

    async def test_a_submitter_cannot_link_an_unlinked_position(self, service, item):
        item.inventory_item_id = None

        with pytest.raises(PermissionError, match="not linked to the supply catalog"):
            await _swap(service, allow_first_link=False)

    async def test_a_manager_still_links_on_the_first_swap(self, service, item):
        item.inventory_item_id = None

        await _swap(service, allow_first_link=True)

        assert item.inventory_item_id == "inv-item-1"

    async def test_a_submitter_may_still_swap_an_already_linked_position(
        self, service, item
    ):
        await _swap(service, allow_first_link=False)

        assert "NEW-9" in [lot.lot_number for lot in item.deployed_lots]


class TestSubmitterLimits:
    async def test_a_submitter_cannot_top_up_a_full_position(self, service, item):
        item.expected_quantity = 1

        with pytest.raises(PermissionError, match="position's shortfall"):
            await _swap(service, enforce_submitter_limits=True)

        service.db.commit.assert_not_awaited()

    async def test_a_submitter_cannot_overfill_a_short_position(self, service, item):
        item.expected_quantity = 2

        with pytest.raises(PermissionError, match="position's shortfall"):
            await _swap(service, quantity=2, enforce_submitter_limits=True)

    async def test_a_submitter_can_fill_exactly_the_shortfall(self, service, item):
        item.expected_quantity = 2

        await _swap(service, enforce_submitter_limits=True)

        assert EquipmentCheckService._on_truck(item) == 2

    async def test_a_submitter_cannot_replace_more_than_the_expired_lot(self, service):
        with pytest.raises(PermissionError, match="expired units aboard"):
            await _swap(
                service,
                quantity=2,
                replaced_deployed_lot_id="dl-expired",
                disposition="discarded",
                enforce_submitter_limits=True,
            )

    async def test_a_manager_can_still_top_up_without_a_shortfall(self, service):
        await _swap(service, quantity=2)

        assert service.db.commit.await_count == 1


class TestToppingUpIsUnchanged:
    async def test_a_swap_naming_no_replacement_retires_nothing(self, service, item):
        await _swap(service)

        assert sorted(lot.lot_number for lot in item.deployed_lots) == [
            "NEW-9",
            "OLD-1",
        ]
        # And so the position stays exposed by the older box — which is the
        # whole defect when this append-only behaviour is what a *replacement*
        # gets. Correct for a top-up, wrong for the button labelled Replace.
        assert EquipmentCheckService._soonest_expiration(item) < TODAY

    async def test_a_replacement_must_say_what_became_of_the_unit(self, service):
        with pytest.raises(ValueError, match="what became of it"):
            await _swap(service, replaced_deployed_lot_id="dl-expired")

    async def test_a_lot_that_is_not_aboard_cannot_be_replaced(self, service):
        with pytest.raises(ValueError, match="not aboard"):
            await _swap(
                service,
                replaced_deployed_lot_id="dl-nowhere",
                disposition="discarded",
            )

    # Topping a position up from the same lot it already carries increments the
    # existing row; naming that row as the replacement would delete the units
    # just added along with the ones already there.
    async def test_the_incoming_lot_cannot_replace_itself(self, service, item):
        item.deployed_lots.append(_deployed("dl-same", "NEW-9", 400))
        item.deployed_lots[-1].inventory_lot_id = "inv-lot-fresh"

        with pytest.raises(ValueError, match="cannot replace itself"):
            await _swap(
                service,
                replaced_deployed_lot_id="dl-same",
                disposition="discarded",
            )


class TestReportItemUsedIsLocked:
    """Two crews reporting use of the same item at once must be serialized,
    or both read the same starting quantity and both decrement it
    independently -- the count ends up one use short instead of two."""

    def test_the_item_row_is_locked(self):
        source = inspect.getsource(EquipmentCheckService.report_item_used)
        assert "for_update=True" in source

    def test_the_deployed_lots_are_locked_before_the_read_modify_write(self):
        source = inspect.getsource(EquipmentCheckService.report_item_used)
        assert "with_for_update()" in source
        # The lock must be acquired before quantities are read/consumed, not
        # after -- a lock taken post-read guards nothing.
        assert source.index("with_for_update()") < source.index(
            "self._consume_deployed"
        )
